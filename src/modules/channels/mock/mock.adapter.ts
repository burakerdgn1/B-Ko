import { Injectable } from '@nestjs/common';
import { ChannelKind } from '../../../common/types/domain';
import {
  ApprovalRequest,
  ChannelAdapter,
  IncomingMessage,
} from '../channel.adapter';

export interface MockSentMessage {
  channelUserId: string;
  text: string;
  markdown: boolean;
}

export interface MockSentDocument {
  channelUserId: string;
  file: Buffer;
  fileName: string;
  caption?: string;
}

export interface MockApprovalRequest {
  channelUserId: string;
  request: ApprovalRequest;
}

/**
 * WhatsApp gerçek kimlik bilgisi gelene kadar onun yerine geçen kanal
 * (D-002). Ayrıca bütün kanal-agnostik testlerde (documents/analysis/drafts)
 * `ChannelAdapter` bağımlılığını gerçek ağ çağrısı olmadan doğrulamak için
 * kullanılır: gönderilen her şey bellekte biriktirilir, gelen mesajlar
 * `simulateIncoming()` ile tetiklenir.
 */
@Injectable()
export class MockChannelAdapter extends ChannelAdapter {
  readonly kind: ChannelKind = 'mock';

  readonly sentMessages: MockSentMessage[] = [];
  readonly sentDocuments: MockSentDocument[] = [];
  readonly approvalRequests: MockApprovalRequest[] = [];

  private readonly handlers: Array<(msg: IncomingMessage) => Promise<void>> =
    [];
  private readonly incomingFiles = new Map<
    string,
    { buffer: Buffer; mimeType: string }
  >();

  async sendMessage(
    channelUserId: string,
    text: string,
    opts?: { markdown?: boolean },
  ): Promise<void> {
    this.sentMessages.push({
      channelUserId,
      text,
      markdown: opts?.markdown ?? false,
    });
  }

  async sendDocument(
    channelUserId: string,
    file: Buffer,
    fileName: string,
    caption?: string,
  ): Promise<void> {
    this.sentDocuments.push({ channelUserId, file, fileName, caption });
  }

  async downloadIncomingFile(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const found = this.incomingFiles.get(fileId);
    if (!found) {
      throw new Error(
        `MockChannelAdapter: '${fileId}' için kayıtlı test dosyası yok ` +
          '(önce registerIncomingFile ile ekleyin).',
      );
    }
    return found;
  }

  async presentApproval(
    channelUserId: string,
    req: ApprovalRequest,
  ): Promise<void> {
    this.approvalRequests.push({ channelUserId, request: req });
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.handlers.push(handler);
  }

  // ── Test yardımcıları ─────────────────────────────────────────────────────

  /** `downloadIncomingFile` çağrılarında dönecek sahte dosyayı kaydeder. */
  registerIncomingFile(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
  ): void {
    this.incomingFiles.set(fileId, { buffer, mimeType });
  }

  /** Gelen bir mesajı simüle eder — kayıtlı tüm handler'ları sırayla çağırır. */
  async simulateIncoming(msg: IncomingMessage): Promise<void> {
    for (const handler of this.handlers) {
      await handler(msg);
    }
  }

  /** Testler arası temiz durum için tüm birikmiş kayıtları sıfırlar. */
  reset(): void {
    this.sentMessages.length = 0;
    this.sentDocuments.length = 0;
    this.approvalRequests.length = 0;
    this.incomingFiles.clear();
  }
}
