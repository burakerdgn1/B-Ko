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
  gif: 'image/gif',
  pdf: 'application/pdf',
  heic: 'image/heic',
  heif: 'image/heic',
  webp: 'image/webp',
};

/**
 * Dosya türünü İÇERİKTEN (sihirli baytlar) tespit eder.
 *
 * Neden uzantıya güvenilmez: Telegram `getFile.file_path` her zaman anlamlı bir
 * uzantı vermez (bazı fotoğraf/doküman gönderimlerinde uzantısız ya da beklenmedik
 * olur). Uzantıya güvenen sürüm canlı testte `application/octet-stream` üretti ve
 * Claude vision çağrısı reddedildi — yani KULLANICI FOTOĞRAF GÖNDEREMİYORDU.
 * Bayt imzası, kaynak ne derse desin doğruyu verir.
 */
export function detectMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  // GIF87a / GIF89a
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif';
  }
  // WebP: 'RIFF' .... 'WEBP'
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // PDF: %PDF
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  // HEIC/HEIF: ....ftyp{heic,heix,hevc,mif1,msf1}
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'heim', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
  }
  return null;
}

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

    // ÖNCE içerik imzası, SONRA uzantı — uzantı güvenilmez (bkz. detectMimeFromBytes).
    const ext = file.file_path.split('.').pop()?.toLowerCase() ?? '';
    const mimeType =
      detectMimeFromBytes(buffer) ??
      EXTENSION_MIME[ext] ??
      'application/octet-stream';

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
