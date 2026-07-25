import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChannelAdapter, IncomingMessage } from '../channels/channel.adapter';
import { parseApprovalCallback } from '../channels/channel.adapter';
import { aiDisclosureText } from '../channels/messages';
import { AnalysisPipeline } from '../analysis/analysis.pipeline';
import { daysUntil } from '../analysis/deadline.util';
import { DraftsService } from '../drafts/drafts.service';
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

  constructor(
    private readonly channel: ChannelAdapter,
    private readonly pipeline: AnalysisPipeline,
    private readonly drafts: DraftsService,
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
        return;

      case 'taslak':
      case 'entwurf':
      case 'draft':
        await this.handleDraftRequest(user);
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
        profile: this.buildProfile(user),
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
      this.logger.error(
        `Analiz başarısız (userId=${user.id}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.send(user, m.error);
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
   * Kullanıcının bilinen PII'sinden maskeleme profili kurar.
   *
   * v1'de onboarding profil alanları (ad/adres) henüz toplanmıyor; `users`
   * tablosunda düz PII saklanmadığı için (tasarım gereği) profil şu an boş
   * kalır ve maskeleme yalnızca yapısal desenlerle çalışır. Onboarding
   * eklendiğinde değerler `pii_vault`'tan çözülüp buraya verilecek.
   */
  private buildProfile(_user: User): undefined {
    return undefined;
  }

  private async send(
    user: User,
    text: string,
    opts?: { markdown?: boolean },
  ): Promise<void> {
    await this.channel.sendMessage(user.channelUserId, text, opts);
  }
}
