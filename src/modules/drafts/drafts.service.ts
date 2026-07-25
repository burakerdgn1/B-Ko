import { Injectable, Logger } from '@nestjs/common';
import { PiiService } from '../../common/pii/pii.service';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { PiiMap } from '../../common/pii/pii.types';
import { Analysis, Draft, DocumentRecord, LlmAnalysisResult } from '../../common/types/domain';
import { LlmService } from '../llm/llm.service';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { DraftRepository } from '../persistence/repositories/draft.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';

export interface GenerateForAnalysisInput {
  analysisId: string;
  userId: string;
  userProfileHints?: { visaType?: string; familyStatus?: string };
}

export interface GenerateForAnalysisOutcome {
  draft: Draft;
  /** Kullanıcıya gösterilecek, unmask edilmiş mektup gövdesi. */
  unmaskedContent: string;
  /** Kullanıcıya gösterilecek, unmask edilmiş konu (Betreff). */
  unmaskedSubject: string;
}

/** Bir analize/belgeye ait, çalışır durumdaki (unmask edilmiş) PII bağlamı. */
interface AnalysisContext {
  analysis: Analysis;
  document: DocumentRecord;
  map: PiiMap;
}

/**
 * Taslak mektup üretimi + human-in-the-loop onay durum makinesi (CLAUDE.md §7, F3a).
 *
 * Durum makinesi (DECISIONS D-014 ile aynı sertlik ilkesiyle):
 *   draft → pending_approval → approved → sent
 *                            ↘ rejected
 *
 * Gizlilik sözleşmesi (analysis.pipeline.ts'teki desenin birebir aynısı):
 *   - Taslak içeriği (subject/content) DB'ye HER ZAMAN maskeli yazılır
 *     (LLM'in ürettiği [[TYPE_n]] yer tutucularıyla).
 *   - Kullanıcıya gösterim için `pii_vault`'tan harita geri kurulur ve
 *     BELLEKTE unmask edilir; düz PII asla persist edilmez.
 *   - `LlmService.generateDraft`'a giden `analysis`/`maskedContext` DB'de zaten
 *     maskeli hâliyle kullanılır — burada ASLA unmask edilmez.
 *
 * Onay kapısı (D-014, CLAUDE.md §7): `markSent` yalnızca kayıtlı durum
 * `approved` VE `approvedAt` doluysa çalışır. `DraftRepository` implementasyonu
 * bunu zaten zorluyor (birinci savunma hattı orada); bu servis ikinci, servis
 * seviyesinde net bir Türkçe hata ile aynı kapıyı tekrar doğrular — tek bir
 * repository hatasına güvenmek yerine savunmayı katmanlar.
 */
@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly pii: PiiService,
    private readonly vault: PiiVaultService,
    private readonly analyses: AnalysisRepository,
    private readonly documents: DocumentRepository,
    private readonly drafts: DraftRepository,
    private readonly vaultRepo: PiiVaultRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Bir analizden taslak yanıt mektubu üretir.
   *
   * ASLA otomatik onaylamaz/göndermez — üretilen taslak her zaman `draft`
   * durumunda başlar; `pending_approval`/`approved`/`sent`'e yalnızca ayrı,
   * açık metot çağrılarıyla (insan eylemiyle) geçilebilir.
   */
  async generateForAnalysis(
    input: GenerateForAnalysisInput,
  ): Promise<GenerateForAnalysisOutcome> {
    const { analysis, document, map } = await this.loadContext(input.analysisId);

    // LLM'e giden analiz/bağlam DB'de zaten MASKELİ — olduğu gibi kullanıyoruz,
    // unmask ETMİYORUZ (görev talimatı, kural 2).
    const llmAnalysisResult: LlmAnalysisResult = {
      authority: analysis.authority ?? null,
      requestType: analysis.requestType ?? null,
      summary: analysis.summary ?? '',
      // Taslak üretimi takvim değerine ihtiyaç duymaz — gerçek deadline zaten
      // `analysis.deadlineDate`'e çözülmüş durumda (D-009); burada yeniden bir
      // DATE token'ı iddia etmiyoruz.
      deadlineToken: null,
      riskLevel: analysis.riskLevel,
      missingDocuments: analysis.missingDocuments,
      nextSteps: analysis.nextSteps,
      confidence: analysis.confidence ?? 0,
      inScope: true,
    };

    // Maskeli belge metni yoksa (ör. çok eski/bozuk kayıt), analiz özetiyle devam et.
    const maskedContext = document.maskedText ?? analysis.summary ?? '';

    const llmOut = await this.llm.generateDraft({
      analysis: llmAnalysisResult,
      maskedContext,
      map,
      userProfileHints: input.userProfileHints,
    });

    // Fail-closed son kontrol: LLM'in ÜRETTİĞİ taslak metninde de (girdide
    // değil, çıktıda) ham PII substring'i olmadığını doğrula. Girdi tarafı
    // zaten LlmService.assertNoLeaks ile korunuyor; bu, modelin bağlamda hiç
    // görmediği bir değeri "uydurma" ihtimaline karşı ikinci bir kilittir
    // (D-013/D-014 dersi: "testler geçti" tek başına yeterli değil).
    const leaked = this.pii.detectLeaks(
      `${llmOut.result.subject}\n${llmOut.result.body}`,
      map,
    );
    if (leaked.length > 0) {
      this.logger.error(
        `Üretilen taslakta PII sızıntısı tespit edildi — kayıt ENGELLENDİ (fail-closed). ` +
          `Sızan tipler: ${leaked.join(', ')} (değerlerin kendisi ASLA loglanmaz).`,
      );
      throw new Error(
        'Üretilen taslakta PII sızıntısı tespit edildi; güvenlik nedeniyle kaydedilmedi. ' +
          `Sızan alan tipleri: ${leaked.join(', ')}.`,
      );
    }

    const draft = await this.drafts.create({
      analysisId: analysis.id,
      content: llmOut.result.body, // MASKELİ — DB'ye ham PII yazılmaz
      subject: llmOut.result.subject, // MASKELİ
      language: 'de', // mektup gövdesi Beamtendeutsch/Almanca
      status: 'draft',
      approvedAt: null,
      rejectedAt: null,
      sentAt: null,
      rejectReason: null,
      deleteAfter: analysis.deleteAfter ?? document.deleteAfter ?? null,
    });

    await this.audit.append({
      userId: input.userId,
      action: 'draft.generated',
      entityType: 'draft',
      entityId: draft.id,
      // ASLA ham PII yazma — yalnızca id/model bilgisi.
      detail: { analysisId: analysis.id, documentId: document.id, model: llmOut.model },
    });

    return {
      draft,
      unmaskedContent: this.pii.unmask(llmOut.result.body, map),
      unmaskedSubject: this.pii.unmask(llmOut.result.subject, map),
    };
  }

  /** Kullanıcıya sunulmak üzere 'pending_approval'a geçirir. */
  async presentForApproval(draftId: string): Promise<Draft> {
    const draft = await this.getOrThrow(draftId);

    if (draft.status !== 'draft') {
      throw new Error(
        `Taslak ${draftId} '${draft.status}' durumunda; yalnızca 'draft' durumundaki ` +
          "bir taslak onaya sunulabilir ('pending_approval').",
      );
    }

    const updated = await this.drafts.update(draftId, { status: 'pending_approval' });

    await this.audit.append({
      action: 'draft.presented',
      entityType: 'draft',
      entityId: draftId,
      detail: { analysisId: updated.analysisId },
    });

    return updated;
  }

  /**
   * İNSAN onayı — yalnızca bu metot 'approved' üretir.
   * `draft` veya `pending_approval` durumundan çağrılabilir (sunum adımı UX
   * kolaylığıdır, sert bir ön koşul değildir); zaten onaylanmış bir taslakta
   * idempotent davranır. 'rejected'/'sent' durumlarından onaya İZİN VERİLMEZ.
   */
  async approve(draftId: string, userId: string): Promise<Draft> {
    const draft = await this.getOrThrow(draftId);

    if (draft.status === 'approved') return draft; // idempotent

    if (draft.status === 'rejected' || draft.status === 'sent') {
      throw new Error(
        `Taslak ${draftId} '${draft.status}' durumunda; bu durumdan 'approved'a geçilemez.`,
      );
    }

    const updated = await this.drafts.update(draftId, {
      status: 'approved',
      approvedAt: new Date(),
    });

    await this.audit.append({
      userId,
      action: 'draft.approved',
      entityType: 'draft',
      entityId: draftId,
      detail: { analysisId: updated.analysisId },
    });

    return updated;
  }

  /** İNSAN reddi. 'sent' durumundaki bir taslak reddedilemez. */
  async reject(draftId: string, userId: string, reason?: string): Promise<Draft> {
    const draft = await this.getOrThrow(draftId);

    if (draft.status === 'rejected') return draft; // idempotent

    if (draft.status === 'sent') {
      throw new Error(`Taslak ${draftId} zaten gönderilmiş; artık reddedilemez.`);
    }

    const updated = await this.drafts.update(draftId, {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectReason: reason ?? null,
    });

    await this.audit.append({
      userId,
      action: 'draft.rejected',
      entityType: 'draft',
      entityId: draftId,
      // Reddetme gerekçesinin serbest metnini asla audit'e yazma — yalnızca var/yok bilgisi.
      detail: { analysisId: updated.analysisId, hasReason: Boolean(reason) },
    });

    return updated;
  }

  /**
   * Onaylanmış taslağı 'sent' işaretler (kullanıcı kendi gönderdi/indirdi).
   *
   * KRİTİK (D-014): yalnızca kayıtlı durum 'approved' VE 'approvedAt' doluysa
   * çalışır. `DraftRepository.update` bunu zaten zorluyor (birinci hat); burada
   * aynı kapıyı servis seviyesinde de doğrulayıp net bir Türkçe hata veriyoruz
   * (ikinci hat — tek bir katmana güvenmiyoruz).
   */
  async markSent(draftId: string): Promise<Draft> {
    const draft = await this.getOrThrow(draftId);

    if (draft.status !== 'approved' || !draft.approvedAt) {
      throw new Error(
        `Taslak ${draftId} insan onayı olmadan 'sent' durumuna geçirilemez. ` +
          `Mevcut durum: '${draft.status}'. Önce kullanıcı taslağı ayrı bir adımda ` +
          "onaylamalı (approve()), ancak ondan sonra 'sent' işaretlenebilir.",
      );
    }

    const updated = await this.drafts.update(draftId, {
      status: 'sent',
      sentAt: new Date(),
    });

    await this.audit.append({
      action: 'draft.sent',
      entityType: 'draft',
      entityId: draftId,
      detail: { analysisId: updated.analysisId },
    });

    return updated;
  }

  /** Kullanıcıya gösterilecek UNMASK EDİLMİŞ içerik. */
  async getUnmaskedContent(draftId: string): Promise<string> {
    const draft = await this.getOrThrow(draftId);
    const { map } = await this.loadContext(draft.analysisId);
    return this.pii.unmask(draft.content, map);
  }

  // ── iç yardımcılar ────────────────────────────────────────────────────────

  private async getOrThrow(draftId: string): Promise<Draft> {
    const draft = await this.drafts.findById(draftId);
    if (!draft) {
      throw new Error(`Taslak bulunamadı: ${draftId}`);
    }
    return draft;
  }

  /**
   * Bir analize ait belgeyi ve pii_vault'tan geri kurulmuş çalışır PII
   * haritasını yükler. Harita, vault kaydı sırasında kullanılan AAD kapsamıyla
   * (userId + documentId) açılmak ZORUNDADIR — bu yüzden `documentId` üzerinden
   * gerçek `userId`'yi (belgenin sahibi) buluyoruz, dışarıdan alınan bir
   * `userId` parametresine güvenmiyoruz (confused-deputy'ye karşı tutarlılık).
   */
  private async loadContext(analysisId: string): Promise<AnalysisContext> {
    const analysis = await this.analyses.findById(analysisId);
    if (!analysis) {
      throw new Error(`Analiz bulunamadı: ${analysisId}`);
    }

    const document = await this.documents.findById(analysis.documentId);
    if (!document) {
      throw new Error(`Belge bulunamadı: ${analysis.documentId}`);
    }

    const sealedRecords = await this.vaultRepo.findByDocument(document.id);
    const map = this.vault.open(sealedRecords, {
      userId: document.userId,
      documentId: document.id,
    });

    return { analysis, document, map };
  }
}
