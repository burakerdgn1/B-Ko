import { DocumentRecord } from '../../../common/types/domain';

export type CreateDocumentInput = Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateDocumentInput = Partial<
  Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'>
>;

/** `DocumentRecord` varlığı için repository sözleşmesi. */
export abstract class DocumentRepository {
  abstract create(input: CreateDocumentInput): Promise<DocumentRecord>;
  abstract findById(id: string): Promise<DocumentRecord | null>;
  abstract update(id: string, patch: UpdateDocumentInput): Promise<DocumentRecord>;
  abstract delete(id: string): Promise<void>;

  /** Kullanıcının tüm belgeleri (en yeni önce). */
  abstract findByUser(userId: string): Promise<DocumentRecord[]>;

  /** GDPR Art.17 — süresi geçmiş kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}
