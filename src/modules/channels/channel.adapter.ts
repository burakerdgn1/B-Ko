import { ChannelKind } from '../../common/types/domain';

/**
 * Kanaldan (Telegram/WhatsApp/mock) gelen normalize edilmiş mesaj.
 *
 * ÖNEMLİ: Bu tip, tüm kanalların ortak paydası olan sözleşmedir
 * (ARCHITECTURE.md §7). Kanal-özel alanlar (grammY Context vb.) burada
 * SIZDIRILMAZ — böylece downstream modüller (documents/analysis) hangi
 * kanaldan geldiğini bilmeden çalışabilir.
 */
export interface IncomingMessage {
  channel: ChannelKind;
  channelUserId: string;
  kind: 'text' | 'photo' | 'document' | 'command' | 'callback';
  text?: string;
  command?: string;
  callbackData?: string;
  file?: {
    fileId: string;
    mimeType?: string;
    sizeBytes?: number;
    fileName?: string;
  };
  locale?: string;
}

/** Human-in-the-loop onay kapısı için sunulacak taslak. */
export interface ApprovalRequest {
  draftId: string;
  title: string;
  /** Kullanıcıya gösterilecek (UNMASK edilmiş) taslak metni. */
  body: string;
  approveLabel?: string;
  rejectLabel?: string;
}

/** `presentApproval` tarafından üretilen callback data'nın parse edilmiş hâli. */
export interface ParsedApprovalCallback {
  action: 'approve' | 'reject';
  draftId: string;
}

/**
 * Kanal-agnostik mesajlaşma sözleşmesi (ARCHITECTURE.md §7, D-002).
 *
 * `interface` değil `abstract class` olarak tanımlanır — NestJS DI token'ı
 * olarak doğrudan kullanılabilsin diye (interface'ler runtime'da yok olur,
 * DI için token gerekir). Somut kanallar (`TelegramAdapter`,
 * `MockChannelAdapter`) bu sınıfı extend eder.
 */
export abstract class ChannelAdapter {
  abstract readonly kind: ChannelKind;

  /** Metin mesajı gönderir. Kanal limiti varsa (Telegram: 4096) otomatik böler. */
  abstract sendMessage(
    channelUserId: string,
    text: string,
    opts?: { markdown?: boolean },
  ): Promise<void>;

  abstract sendDocument(
    channelUserId: string,
    file: Buffer,
    fileName: string,
    caption?: string,
  ): Promise<void>;

  /** Kullanıcının gönderdiği ham dosyayı (foto/pdf) indirir. */
  abstract downloadIncomingFile(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }>;

  /** Human-in-the-loop onay kapısı — onay/ret butonlarıyla taslağı sunar. */
  abstract presentApproval(
    channelUserId: string,
    req: ApprovalRequest,
  ): Promise<void>;

  /** Gelen mesajlar için handler kaydı. Birden fazla handler kaydedilebilir. */
  abstract onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}

/** Telegram'ın tek mesaj sınırı (Bot API). Diğer kanallar da referans alabilir. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Uzun metni kanal sınırına göre böler.
 *
 * Mümkün olduğunca satır sonlarından (`\n`) böler ki cümle/paragraf ortadan
 * kesilmesin; satır sonu bulunamazsa sert kesme yapılır (aksi hâlde bölünmez
 * bir kelime sonsuz döngüye sokabilir).
 */
export function splitLongMessage(
  text: string,
  limit: number = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  if (text.length <= limit) return text.length > 0 ? [text] : [''];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit; // satır sonu yoksa sert kes
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length > 0) chunks.push(rest);

  return chunks;
}

/**
 * `presentApproval` tarafından üretilen `approve:<draftId>` / `reject:<draftId>`
 * callback data formatını parse eder. Tüm kanallarda ortak format — bu yüzden
 * merkezi tek yerde tutulur.
 */
export function parseApprovalCallback(
  data: string | undefined,
): ParsedApprovalCallback | null {
  if (!data) return null;
  const m = /^(approve|reject):(.+)$/.exec(data);
  if (!m) return null;
  return { action: m[1] as 'approve' | 'reject', draftId: m[2] };
}

export function buildApprovalCallback(
  action: 'approve' | 'reject',
  draftId: string,
): string {
  return `${action}:${draftId}`;
}
