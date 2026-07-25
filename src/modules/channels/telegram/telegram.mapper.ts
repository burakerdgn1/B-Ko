import { IncomingMessage } from '../channel.adapter';
import { resolveLocale } from '../messages';

/**
 * Telegram Bot API `Message`'ının burada kullanılan alt kümesi.
 *
 * grammY'nin `ctx.message` değeri yapısal olarak bu arayüzle uyumludur
 * (fazladan alanlar yok sayılır) — bu sayede gerçek bot çalıştırmadan,
 * sade obje literalleriyle birim testi yazılabilir.
 */
export interface TelegramMessageLike {
  from?: { id: number; language_code?: string };
  chat: { id: number | string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
}

export interface TelegramCallbackQueryLike {
  id: string;
  from: { id: number; language_code?: string };
  data?: string;
  message?: { chat: { id: number | string } };
}

export interface TelegramUpdateLike {
  message?: TelegramMessageLike;
  callback_query?: TelegramCallbackQueryLike;
}

/**
 * Ham Telegram update'ini kanal-agnostik `IncomingMessage`'a çevirir.
 *
 * İşlenemeyen update tipleri (edited_message, my_chat_member, vb.) için
 * `null` döner — çağıran bunu sessizce yok sayar.
 */
export function mapTelegramUpdateToIncoming(
  update: TelegramUpdateLike,
): IncomingMessage | null {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    return {
      channel: 'telegram',
      channelUserId: String(chatId),
      kind: 'callback',
      callbackData: cq.data,
      locale: resolveLocale(cq.from.language_code),
    };
  }

  if (update.message) {
    const msg = update.message;
    const channelUserId = String(msg.chat.id);
    const locale = resolveLocale(msg.from?.language_code);

    if (msg.text?.startsWith('/')) {
      const command = msg.text.slice(1).split(/[\s@]/)[0].toLowerCase();
      return {
        channel: 'telegram',
        channelUserId,
        kind: 'command',
        command,
        text: msg.text,
        locale,
      };
    }

    if (msg.photo && msg.photo.length > 0) {
      // Telegram aynı fotoğrafı birden çok çözünürlükte gönderir;
      // dizideki son eleman en yüksek çözünürlüklü olandır.
      const largest = msg.photo[msg.photo.length - 1];
      return {
        channel: 'telegram',
        channelUserId,
        kind: 'photo',
        text: msg.caption,
        file: {
          fileId: largest.file_id,
          mimeType: 'image/jpeg',
          sizeBytes: largest.file_size,
        },
        locale,
      };
    }

    if (msg.document) {
      return {
        channel: 'telegram',
        channelUserId,
        kind: 'document',
        text: msg.caption,
        file: {
          fileId: msg.document.file_id,
          mimeType: msg.document.mime_type,
          sizeBytes: msg.document.file_size,
          fileName: msg.document.file_name,
        },
        locale,
      };
    }

    if (msg.text) {
      return {
        channel: 'telegram',
        channelUserId,
        kind: 'text',
        text: msg.text,
        locale,
      };
    }
  }

  return null;
}
