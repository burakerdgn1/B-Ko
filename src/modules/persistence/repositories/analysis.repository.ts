import { Analysis } from '../../../common/types/domain';

export type CreateAnalysisInput = Omit<Analysis, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAnalysisInput = Partial<Omit<Analysis, 'id' | 'createdAt' | 'updatedAt'>>;

/** `Analysis` varlığı için repository sözleşmesi. */
export abstract class AnalysisRepository {
  abstract create(input: CreateAnalysisInput): Promise<Analysis>;
  abstract findById(id: string): Promise<Analysis | null>;
  abstract update(id: string, patch: UpdateAnalysisInput): Promise<Analysis>;
  abstract delete(id: string): Promise<void>;

  /** Bir belgeye ait tüm analizler. */
  abstract findByDocument(documentId: string): Promise<Analysis[]>;

  /**
   * `deadlineDate` dolu ve verilen tarihten önce/eşit olan analizler
   * (RemindersService'in yaklaşan deadline taraması için).
   */
  abstract findWithUpcomingDeadlines(before: Date): Promise<Analysis[]>;

  /** GDPR Art.17 — süresi geçmiş kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}
