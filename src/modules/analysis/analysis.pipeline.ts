import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { PiiService } from '../../common/pii/pii.service';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { KnownPiiProfile } from '../../common/pii/pii.types';
import {
  Analysis,
  DocumentRecord,
  DocumentSource,
  MissingDocument,
  RiskLevel,
} from '../../common/types/domain';
import { LlmService } from '../llm/llm.service';
import { OcrImage } from '../llm/ocr.provider';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { ReminderRepository } from '../persistence/repositories/reminder.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';
import {
  escalateRiskByDeadline,
  parseGermanDate,
  reminderDatesFor,
} from './deadline.util';

export interface AnalyzeDocumentInput {
  userId: string;
  source: DocumentSource;
  text?: string;
  image?: OcrImage;
  profile?: KnownPiiProfile;
  mimeType?: string;
  sizeBytes?: number;
  storageRef?: string;
}

/** Kullanıcıya gösterilecek, UNMASK EDİLMİŞ sonuç. */
export interface AnalysisOutcome {
  document: DocumentRecord;
  analysis: Analysis;
  /** Gerçek değerlerle (unmask edilmiş) özet. */
  summary: string;
  deadline: Date | null;
  riskLevel: RiskLevel;
  missingDocuments: MissingDocument[];
  nextSteps: string[];
  remindersCreated: number;
  inScope: boolean;
}

/**
 * Belge analiz hattı — ürünün çekirdek akışı (CLAUDE.md §4).
 *
 * Durum makinesi:
 *   received → processing → analyzed        (başarı)
 *                        └→ failed          (hata; belge kaydı korunur)
 *
 * Gizlilik sözleşmesi (ihlal edilemez):
 *   - LLM'e YALNIZCA maskeli metin gider (LlmService kendi içinde de doğrular).
 *   - DB'ye YALNIZCA maskeli metin/özet yazılır.
 *   - Ham PII yalnızca pii_vault'ta ŞİFRELİ olarak durur.
 *   - Kullanıcıya dönen metin bellek içinde unmask edilir, hiçbir zaman
 *     düz hâliyle persist edilmez.
 */
@Injectable()
export class AnalysisPipeline {
  private readonly logger = new Logger(AnalysisPipeline.name);

  constructor(
    private readonly llm: LlmService,
    private readonly pii: PiiService,
    private readonly vault: PiiVaultService,
    private readonly config: AppConfigService,
    private readonly documents: DocumentRepository,
    private readonly analyses: AnalysisRepository,
    private readonly vaultRepo: PiiVaultRepository,
    private readonly reminders: ReminderRepository,
    private readonly audit: AuditRepository,
  ) {}

  async run(input: AnalyzeDocumentInput): Promise<AnalysisOutcome> {
    const deleteAfter = this.config.deleteAfterFrom();

    // ── 1. ingest ──
    const document = await this.documents.create({
      userId: input.userId,
      source: input.source,
      status: 'processing',
      storageRef: input.storageRef ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      maskedText: null,
      errorMessage: null,
      deleteAfter,
    });

    try {
      // ── 2-4. OCR (gerekiyorsa) → maskeleme → LLM analizi ──
      // Maskeleme LlmService içinde yapılır; ham metin bu hattın hiçbir
      // noktasında kalıcılaştırılmaz.
      const llmOut = await this.llm.analyzeDocument({
        text: input.text,
        image: input.image,
        profile: input.profile,
      });

      // ── 5. PII haritasını ŞİFRELİ olarak sakla ──
      // Not: vault'a önce yazıyoruz ki, sonraki adımlarda hata olsa bile
      // maskeli metindeki token'lar çözümlenebilir kalsın (yetim token olmasın).
      const sealed = this.vault.seal(
        llmOut.map,
        { userId: input.userId, documentId: document.id },
        deleteAfter,
      );
      if (sealed.length > 0) {
        await this.vaultRepo.saveMany(sealed);
      }

      // ── 6. Maskeli metni belgeye yaz ──
      await this.documents.update(document.id, {
        maskedText: llmOut.maskedText,
      });

      // ── 7. Deadline'ı token üzerinden çöz (D-009) ──
      const deadline = this.resolveDeadline(llmOut.result.deadlineToken, llmOut.map);

      // ── 8. Riski takvime göre yükselt (asla düşürme) ──
      const riskLevel = escalateRiskByDeadline(llmOut.result.riskLevel, deadline);

      // ── 9. Analizi MASKELİ hâliyle kalıcılaştır ──
      const analysis = await this.analyses.create({
        documentId: document.id,
        authority: llmOut.result.authority,
        requestType: llmOut.result.requestType,
        summary: llmOut.result.summary, // maskeli
        deadlineDate: deadline,
        riskLevel,
        missingDocuments: llmOut.result.missingDocuments, // maskeli
        nextSteps: llmOut.result.nextSteps,
        rawModelOutput: llmOut.rawMaskedOutput, // maskeli (D-004)
        model: llmOut.model,
        confidence: llmOut.result.confidence,
        deleteAfter,
      });

      // ── 10. Hatırlatmaları oluştur ──
      const remindersCreated = await this.createReminders(
        input.userId,
        analysis.id,
        deadline,
        deleteAfter,
      );

      await this.documents.update(document.id, { status: 'analyzed' });

      await this.audit.append({
        userId: input.userId,
        action: 'analysis.completed',
        entityType: 'analysis',
        entityId: analysis.id,
        // ASLA ham PII yazma — yalnızca sayaç/sınıf bilgisi.
        detail: {
          documentId: document.id,
          riskLevel,
          maskedEntityCount: llmOut.map.matches.length,
          hasDeadline: deadline !== null,
          model: llmOut.model,
        },
      });

      // ── 11. Kullanıcıya dönecek sonucu BELLEKTE unmask et ──
      return {
        document: { ...document, status: 'analyzed', maskedText: llmOut.maskedText },
        analysis,
        summary: this.pii.unmask(llmOut.result.summary, llmOut.map),
        deadline,
        riskLevel,
        missingDocuments: this.pii.unmaskDeep(
          llmOut.result.missingDocuments,
          llmOut.map,
        ),
        nextSteps: this.pii.unmaskDeep(llmOut.result.nextSteps, llmOut.map),
        remindersCreated,
        inScope: llmOut.result.inScope,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.documents.update(document.id, {
        status: 'failed',
        // Hata mesajı ham PII içerebilir (ör. bir kütüphane metni yankılarsa);
        // bu yüzden sabit, güvenli bir sınıf mesajı yazıyoruz.
        errorMessage: this.safeErrorMessage(message),
      });

      await this.audit.append({
        userId: input.userId,
        action: 'analysis.failed',
        entityType: 'document',
        entityId: document.id,
        detail: { reason: this.safeErrorMessage(message) },
      });

      this.logger.error(
        `Belge analizi başarısız (documentId=${document.id}): ${this.safeErrorMessage(message)}`,
      );
      throw error;
    }
  }

  /**
   * Modelin döndürdüğü `[[DATE_n]]` token'ını gerçek tarihe çevirir.
   * Model uydurma/bilinmeyen bir token döndürürse `null` (sessizce yanlış
   * tarih üretmektense son tarihsiz devam etmek daha güvenli).
   */
  private resolveDeadline(
    token: string | null,
    map: Parameters<PiiService['unmask']>[1],
  ): Date | null {
    if (!token) return null;

    const unmasked = this.pii.unmask(token, map);
    // Çözülemediyse token olduğu gibi geri gelir — bu bir tarih değildir.
    if (unmasked === token) {
      this.logger.warn(
        `Model bilinmeyen bir deadline token'ı döndürdü (${token}) — son tarih atlandı.`,
      );
      return null;
    }

    const parsed = parseGermanDate(unmasked);
    if (!parsed) {
      this.logger.warn(
        'Deadline token\'ı çözüldü ancak geçerli bir tarihe ayrıştırılamadı — atlandı.',
      );
    }
    return parsed;
  }

  private async createReminders(
    userId: string,
    analysisId: string,
    deadline: Date | null,
    deleteAfter: Date,
  ): Promise<number> {
    if (!deadline) return 0;

    const dates = reminderDatesFor(deadline);
    for (const dueDate of dates) {
      await this.reminders.create({
        userId,
        analysisId,
        kind: 'deadline',
        dueDate,
        // Mesaj metni gönderim anında üretilir; burada PII saklamıyoruz.
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter,
      });
    }
    return dates.length;
  }

  /**
   * Hata mesajlarını kullanıcı verisinden arındırır.
   * Alt katmanlardan gelen mesajlar belge içeriğini yankılayabilir; bunu
   * DB'ye veya loga yazmak bir PII sızıntısı olurdu.
   */
  private safeErrorMessage(message: string): string {
    if (/sızıntı|leak/i.test(message)) {
      return 'PII sızıntı denetimi çağrıyı engelledi (fail-closed).';
    }
    if (/OCR/i.test(message)) {
      return 'Belge metne dönüştürülemedi (OCR hatası).';
    }
    if (/JSON|şema|schema|zod/i.test(message)) {
      return 'Model yanıtı beklenen yapıda değildi.';
    }
    return 'Belge analizi sırasında beklenmeyen bir hata oluştu.';
  }
}
