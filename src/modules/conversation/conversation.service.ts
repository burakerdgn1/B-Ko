import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChannelAdapter, IncomingMessage } from '../channels/channel.adapter';
import { parseApprovalCallback } from '../channels/channel.adapter';
import { aiDisclosureText } from '../channels/messages';
import { AnalysisPipeline } from '../analysis/analysis.pipeline';
import { daysUntil } from '../analysis/deadline.util';
import { DraftsService } from '../drafts/drafts.service';
import { ProfileService } from '../profile/profile.service';
import { KnownPiiProfile } from '../../common/pii/pii.types';
import { UserRepository } from '../persistence/repositories/user.repository';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';
import { User } from '../../common/types/domain';
import { formatAnalysis, t } from './conversation.messages';

/**
 * Sohbet orkestrasyonu — botu ürün akışına bağlayan son halka.
 *
 * Akış (CLAUDE.md §4):
 *   /start → AI şeffaflığı → onay (consent) → belge → analiz → özet
 *          → /taslak → taslak → İNSAN ONAYI → "kendiniz gönderin"
 *
 * İki kural kod seviyesinde zorlanır:
 *   1. **Onay olmadan belge işlenmez** (GDPR — açık rıza).
 *   2. **Hiçbir şey kullanıcı adına kuruma gönderilmez.** Onaylanan taslak
 *      yalnızca kullanıcıya metin olarak verilir; `markSent` "kullanıcı kendisi
 *      gönderdi" anlamına gelir, sistem gönderimi DEĞİL.
 */
@Injectable()
export class ConversationService implements OnModuleInit {
  private readonly logger = new Logger(ConversationService.name);

  /** Kullanıcı başına son analiz — /taslak komutunun hedefi. */
  private readonly lastAnalysisByUser = new Map<string, string>();

  /**
   * Onboarding adımı (kullanıcı başına).
   *
   * Süreç yeniden başlarsa yarım kalan onboarding sıfırlanır ve kullanıcı
   * /profil ile yeniden başlayabilir. TAMAMLANMA durumu ise kalıcıdır
   * (`users.profile_completed_at`), yani veri kaybı yaşanmaz.
   */
  private readonly onboardingStep = new Map<string, OnboardingStep>();
  private readonly onboardingDraft = new Map<string, KnownPiiProfile>();

  constructor(
    private readonly channel: ChannelAdapter,
    private readonly pipeline: AnalysisPipeline,
    private readonly drafts: DraftsService,
    private readonly profiles: ProfileService,
    private readonly users: UserRepository,
    private readonly analyses: AnalysisRepository,
    private readonly documents: DocumentRepository,
    private readonly audit: AuditRepository,
  ) {}

  onModuleInit(): void {
    this.channel.onMessage((msg) => this.handle(msg));
  }

  /** Tek giriş noktası — gelen her mesaj buradan geçer. */
  async handle(msg: IncomingMessage): Promise<void> {
    try {
      const user = await this.resolveUser(msg);

      if (msg.kind === 'callback') {
        await this.handleCallback(user, msg);
        return;
      }

      // Onboarding sürüyorsa KISA serbest metin, adım cevabıdır.
      //
      // Uzun metin (>80 karakter) onboarding sırasında bile BELGE sayılır:
      // kullanıcı araya bir mektup yapıştırdığında bunun "ad" olarak
      // yutulması kötü bir deneyim olurdu.
      if (
        msg.kind === 'text' &&
        (msg.text ?? '').trim().length <= ONBOARDING_ANSWER_MAX_LENGTH &&
        this.onboardingStep.has(user.id) &&
        this.onboardingStep.get(user.id) !== 'done'
      ) {
        await this.handleOnboardingAnswer(user, msg.text ?? '');
        return;
      }

      if (msg.kind === 'command') {
        await this.handleCommand(user, msg);
        return;
      }
      if (msg.kind === 'photo' || msg.kind === 'document') {
        await this.handleDocument(user, msg);
        return;
      }
      if (msg.kind === 'text' && msg.text && msg.text.trim().length > 80) {
        // Uzun metin = yapıştırılmış mektup içeriği olarak kabul edilir.
        await this.handleDocument(user, msg);
        return;
      }

      await this.send(user, t(user.locale).unsupported);
    } catch (error) {
      this.logger.error(
        `Mesaj işlenemedi (channel=${msg.channel}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ── Komutlar ──────────────────────────────────────────────────────────────

  private async handleCommand(user: User, msg: IncomingMessage): Promise<void> {
    const m = t(user.locale);
    const cmd = (msg.command ?? '').toLowerCase();

    switch (cmd) {
      case 'start':
        // AI şeffaflığı HER oturum başında (CLAUDE.md §7).
        await this.send(user, aiDisclosureText(user.locale));
        await this.send(user, m.welcome);
        await this.send(user, m.consentAsk);
        await this.users.update(user.id, { aiDisclosureAckAt: new Date() });
        return;

      case 'onayla':
      case 'zustimmen':
      case 'agree':
        await this.users.update(user.id, { consentAt: new Date() });
        await this.audit.append({
          userId: user.id,
          action: 'consent.granted',
          entityType: 'user',
          entityId: user.id,
          detail: {},
        });
        await this.send(user, m.consentDone);
        // Rıza alındıktan sonra profil onboarding'i başlar (D-027).
        if (!user.profileCompletedAt) await this.startOnboarding(user);
        return;

      case 'taslak':
      case 'entwurf':
      case 'draft':
        await this.handleDraftRequest(user);
        return;

      case 'profil':
      case 'profile':
        // D-056: kullanıcının KENDİ ad/adres bilgisi burada toplanır ve
        // pii_vault'a şifreli yazılır — belge işleme kadar hassas, ama bu
        // kontrol eksikti. Diğer her rıza kontrolüyle tutarlı olsun diye
        // handleDocument'takiyle AYNI kapı burada da uygulanır.
        if (!user.consentAt) {
          await this.send(user, m.needConsent);
          return;
        }
        await this.startOnboarding(user);
        return;

      case 'atla':
      case 'ueberspringen':
      case 'skip':
        await this.profiles.skip(user.id);
        this.onboardingStep.delete(user.id);
        this.onboardingDraft.delete(user.id);
        await this.send(user, m.onbSkipped);
        return;

      case 'gec':
      case 'weiter':
      case 'next':
        // Onboarding dışında anlamsız — adım atlama yalnızca akış içindeyken.
        if (this.onboardingStep.has(user.id)) {
          await this.handleOnboardingAnswer(user, '');
        } else {
          await this.send(user, m.unsupported);
        }
        return;

      case 'sil':
      case 'loeschen':
      case 'delete':
        await this.handleDelete(user);
        return;

      case 'yardim':
      case 'hilfe':
      case 'help':
        await this.send(user, m.help);
        return;

      default:
        await this.send(user, m.unsupported);
    }
  }

  // ── Belge akışı ───────────────────────────────────────────────────────────

  private async handleDocument(user: User, msg: IncomingMessage): Promise<void> {
    const m = t(user.locale);

    // GDPR: açık rıza olmadan belge işlenmez.
    if (!user.consentAt) {
      await this.send(user, m.needConsent);
      return;
    }

    await this.send(user, m.analyzing);

    try {
      const outcome = await this.pipeline.run({
        userId: user.id,
        ...(await this.resolveSource(msg)),
        profile: await this.buildProfile(user),
      });

      this.lastAnalysisByUser.set(user.id, outcome.analysis.id);

      if (!outcome.inScope) {
        await this.send(user, m.outOfScope);
      }

      await this.send(
        user,
        formatAnalysis(
          {
            authority: outcome.analysis.authority ?? null,
            summary: outcome.summary,
            deadline: outcome.deadline,
            daysLeft: outcome.deadline ? daysUntil(outcome.deadline) : null,
            riskLevel: outcome.riskLevel,
            missingDocuments: outcome.missingDocuments,
            nextSteps: outcome.nextSteps,
          },
          user.locale,
        ),
        { markdown: true },
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      this.logger.error(`Analiz başarısız (userId=${user.id}): ${raw}`);

      // Desteklenmeyen görsel biçimi, kullanıcının DÜZELTEBİLECEĞİ bir durumdur;
      // genel "tekrar deneyin" mesajı yanıltıcı olur (canlı testte HEIC/octet-stream
      // ile yaşandı). Ne yapması gerektiğini açıkça söylüyoruz.
      const unsupported =
        /Desteklenmeyen görsel|unsupported image|image type|media type/i.test(raw);
      await this.send(user, unsupported ? m.unsupportedImage : m.error);
    }
  }

  /** Gelen mesajı pipeline girdisine çevirir (dosya indirme dâhil). */
  private async resolveSource(
    msg: IncomingMessage,
  ): Promise<{
    source: 'photo' | 'pdf' | 'text';
    text?: string;
    image?: { base64: string; mediaType: string };
    mimeType?: string;
    sizeBytes?: number;
  }> {
    if (msg.kind === 'text') {
      return { source: 'text', text: msg.text };
    }

    if (!msg.file) {
      return { source: 'text', text: msg.text ?? '' };
    }

    const { buffer, mimeType } = await this.channel.downloadIncomingFile(
      msg.file.fileId,
    );

    if (mimeType === 'application/pdf') {
      // PDF metni de vision ile okunur; ayrı bir PDF ayrıştırıcı v2'ye ertelendi.
      return {
        source: 'pdf',
        image: { base64: buffer.toString('base64'), mediaType: mimeType },
        mimeType,
        sizeBytes: buffer.length,
      };
    }

    return {
      source: 'photo',
      image: { base64: buffer.toString('base64'), mediaType: mimeType },
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  // ── Taslak akışı (human-in-the-loop) ──────────────────────────────────────

  private async handleDraftRequest(user: User): Promise<void> {
    const m = t(user.locale);

    const analysisId = this.lastAnalysisByUser.get(user.id);
    if (!analysisId) {
      await this.send(user, m.unsupported);
      return;
    }

    const { draft, unmaskedContent, unmaskedSubject } =
      await this.drafts.generateForAnalysis({
        analysisId,
        userId: user.id,
        userProfileHints: {
          visaType: user.visaType ?? undefined,
          familyStatus: user.familyStatus ?? undefined,
        },
      });

    await this.drafts.presentForApproval(draft.id);
    await this.send(user, m.draftIntro);

    // Onay/ret butonlarıyla sun — karar KULLANICININ.
    await this.channel.presentApproval(user.channelUserId, {
      draftId: draft.id,
      title: unmaskedSubject,
      body: unmaskedContent,
    });
  }

  private async handleCallback(user: User, msg: IncomingMessage): Promise<void> {
    const m = t(user.locale);
    const parsed = parseApprovalCallback(msg.callbackData ?? '');
    if (!parsed) return;

    if (parsed.action === 'approve') {
      await this.drafts.approve(parsed.draftId, user.id);
      // ÖNEMLİ: onay, "gönderildi" demek DEĞİLDİR. Metni kullanıcıya veriyoruz;
      // resmî kuruma gönderme eylemi her zaman kullanıcıya aittir (CLAUDE.md §7).
      const content = await this.drafts.getUnmaskedContent(parsed.draftId);
      await this.send(user, m.draftApproved);
      await this.send(user, content);
      await this.drafts.markSent(parsed.draftId);
      return;
    }

    await this.drafts.reject(parsed.draftId, user.id);
    await this.send(user, m.draftRejected);
  }

  // ── GDPR ──────────────────────────────────────────────────────────────────

  private async handleDelete(user: User): Promise<void> {
    const docs = await this.documents.findByUser(user.id);
    for (const doc of docs) {
      await this.documents.delete(doc.id);
    }
    await this.users.delete(user.id);
    this.lastAnalysisByUser.delete(user.id);
    this.onboardingStep.delete(user.id);
    this.onboardingDraft.delete(user.id);

    await this.audit.append({
      userId: null,
      action: 'gdpr.user_deleted',
      entityType: 'user',
      entityId: user.id,
      detail: { documentCount: docs.length },
    });

    await this.send(user, t(user.locale).deleted);
  }

  // ── Yardımcılar ───────────────────────────────────────────────────────────

  private async resolveUser(msg: IncomingMessage): Promise<User> {
    return this.users.upsertByChannel(msg.channel, msg.channelUserId, {
      locale: msg.locale ?? 'de',
    });
  }

  /**
   * Kullanıcının bilinen PII'sini `pii_vault`'tan ÇÖZEREK maskeleme profili
   * kurar (D-027 — D-018/D-024'ün kapatılması).
   *
   * Profil yoksa (kullanıcı /atla dediyse) `undefined` döner ve maskeleme
   * yalnızca yapısal desenlerle çalışır — bu durum kullanıcıya açıkça bildirilir.
   */
  private async buildProfile(user: User): Promise<KnownPiiProfile | undefined> {
    try {
      return await this.profiles.load(user.id);
    } catch {
      // Profil çözülemezse analiz durmamalı; yalnızca recall düşer.
      this.logger.error(
        `Profil yüklenemedi (userId=${user.id}) — yapısal maskelemeyle devam ediliyor.`,
      );
      return undefined;
    }
  }

  // ── Onboarding (D-027) ────────────────────────────────────────────────────

  private async startOnboarding(user: User): Promise<void> {
    const m = t(user.locale);
    this.onboardingStep.set(user.id, 'name');
    this.onboardingDraft.set(user.id, {});
    await this.send(user, m.onbIntro);
    await this.send(user, m.onbAskName);
  }

  /**
   * Onboarding adım cevabını işler.
   * Boş cevap = adımı atla (/gec). Profil alanı boş kalır.
   */
  private async handleOnboardingAnswer(user: User, raw: string): Promise<void> {
    const m = t(user.locale);
    const step = this.onboardingStep.get(user.id);
    if (!step) return;

    const answer = raw.trim();
    const draft = this.onboardingDraft.get(user.id) ?? {};

    if (step === 'name') {
      if (answer.length > 0) {
        if (answer.length < 3) {
          await this.send(user, m.onbTooShort);
          return;
        }
        draft.fullName = answer;
        // Ad/soyad parçalarını da kaydet — mektuplar genelde yalnızca soyadıyla
        // hitap eder (D-015).
        const parts = answer.split(/\s+/).filter((p) => p.length >= 2);
        if (parts.length >= 2) {
          draft.givenName = parts[0];
          draft.familyName = parts[parts.length - 1];
        }
      }
      this.onboardingDraft.set(user.id, draft);
      this.onboardingStep.set(user.id, 'address');
      await this.send(user, m.onbAskAddress);
      return;
    }

    if (step === 'address') {
      if (answer.length >= 3) draft.address = answer;
      this.onboardingDraft.set(user.id, draft);
      this.onboardingStep.set(user.id, 'city');
      await this.send(user, m.onbAskCity);
      return;
    }

    if (step === 'city') {
      if (answer.length >= 3) {
        // "10827 Berlin" → posta kodu + şehir olarak da ayrıştır.
        const match = /^(\d{5})\s+(.+)$/.exec(answer);
        if (match) {
          draft.postalCode = match[1];
          draft.city = match[2].trim();
        } else {
          draft.city = answer;
        }
      }

      await this.profiles.save(user.id, draft);
      this.onboardingStep.set(user.id, 'done');
      this.onboardingDraft.delete(user.id);
      await this.send(user, m.onbDone);
    }
  }

  private async send(
    user: User,
    text: string,
    opts?: { markdown?: boolean },
  ): Promise<void> {
    await this.channel.sendMessage(user.channelUserId, text, opts);
  }
}

/** Onboarding akışındaki adımlar. */
type OnboardingStep = 'name' | 'address' | 'city' | 'done';

/**
 * Onboarding cevabı sayılacak azami uzunluk. Bunun üstü BELGE kabul edilir —
 * `handleDocument`'taki eşikle aynıdır, böylece iki yol çakışmaz.
 */
const ONBOARDING_ANSWER_MAX_LENGTH = 80;
