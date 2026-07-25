import { Injectable } from '@nestjs/common';
import { InlineKeyboard, InputFile } from 'grammy';
import { ChannelKind } from '../../../common/types/domain';
import {
  ApprovalRequest,
  buildApprovalCallback,
  ChannelAdapter,
  IncomingMessage,
  splitLongMessage,
} from '../channel.adapter';
import { defaultApprovalLabels } from '../messages';
import { TelegramService } from './telegram.service';

/** Bilinen dosya uzantıları için mime-type haritası (Telegram `getFile` mime döndürmez). */
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  heic: 'image/heic',
  webp: 'image/webp',
};

/**
 * `ChannelAdapter` sözleşmesinin Telegram (grammY) implementasyonu.
 *
 * Bot yaşam döngüsü (başlat/durdur, polling/webhook, update dağıtımı)
 * `TelegramService`'te; bu sınıf yalnızca sözleşme metodlarını grammY Bot
 * API çağrılarına çevirir. Bot çalışmıyorsa (disabled mod/token yok)
 * `sendMessage` vb. anlamlı bir hata fırlatır — sessizce yutulmaz.
 */
@Injectable()
export class TelegramAdapter extends ChannelAdapter {
  readonly kind: ChannelKind = 'telegram';

  constructor(private readonly telegram: TelegramService) {
    super();
  }

  async sendMessage(
    channelUserId: string,
    text: string,
    opts?: { markdown?: boolean },
  ): Promise<void> {
    const api = this.requireApi();
    for (const chunk of splitLongMessage(text)) {
      await api.sendMessage(channelUserId, chunk, {
        parse_mode: opts?.markdown ? 'Markdown' : undefined,
      });
    }
  }

  async sendDocument(
    channelUserId: string,
    file: Buffer,
    fileName: string,
    caption?: string,
  ): Promise<void> {
    const api = this.requireApi();
    await api.sendDocument(channelUserId, new InputFile(file, fileName), {
      caption,
    });
  }

  async downloadIncomingFile(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const api = this.requireApi();
    const file = await api.getFile(fileId);
    if (!file.file_path) {
      throw new Error(
        `Telegram dosyası indirilemedi: '${fileId}' için file_path yok.`,
      );
    }

    const url = this.telegram.getFileDownloadUrl(file.file_path);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Telegram dosya indirme başarısız: HTTP ${res.status} (${fileId})`,
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = file.file_path.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = EXTENSION_MIME[ext] ?? 'application/octet-stream';
    return { buffer, mimeType };
  }

  async presentApproval(
    channelUserId: string,
    req: ApprovalRequest,
  ): Promise<void> {
    const api = this.requireApi();
    const labels = defaultApprovalLabels();
    const keyboard = new InlineKeyboard().text(
      req.approveLabel ?? labels.approve,
      buildApprovalCallback('approve', req.draftId),
    );
    keyboard.text(
      req.rejectLabel ?? labels.reject,
      buildApprovalCallback('reject', req.draftId),
    );

    const text = `*${req.title}*\n\n${req.body}`;
    const parts = splitLongMessage(text);

    // Onay/ret butonları yalnızca SON parçaya eklenir — kullanıcının tüm
    // metni gördükten sonra karar vermesi beklenir.
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      await api.sendMessage(channelUserId, parts[i], {
        parse_mode: 'Markdown',
        reply_markup: isLast ? keyboard : undefined,
      });
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.telegram.registerHandler(handler);
  }

  private requireApi() {
    const api = this.telegram.api;
    if (!api) {
      throw new Error(
        'Telegram botu çalışmıyor (TELEGRAM_MODE=disabled veya ' +
          'TELEGRAM_BOT_TOKEN tanımsız) — bkz. MANUAL_ACTIONS_REQUIRED.md.',
      );
    }
    return api;
  }
}
