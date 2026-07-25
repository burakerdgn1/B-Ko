import { Draft, DraftStatus } from '../../../common/types/domain';

export type CreateDraftInput = Omit<Draft, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateDraftInput = Partial<Omit<Draft, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * `Draft` varlığı için repository sözleşmesi.
 *
 * KRİTİK (CLAUDE.md §7 — human-in-the-loop): `update()` çağrısı `status: 'sent'`
 * hedefliyorsa ve kayıtta (mevcut ya da patch ile gelen) `approvedAt` yoksa,
 * implementasyon bir `Error` fırlatmak ZORUNDADIR. DB tarafında aynı kural
 * `drafts_approval_gate` trigger'ı ile ikinci savunma hattı olarak da uygulanır;
 * uygulama katmanındaki bu kontrol birinci hattır ve driver'dan bağımsızdır.
 */
export abstract class DraftRepository {
  abstract create(input: CreateDraftInput): Promise<Draft>;
  abstract findById(id: string): Promise<Draft | null>;
  abstract update(id: string, patch: UpdateDraftInput): Promise<Draft>;
  abstract delete(id: string): Promise<void>;

  /** Bir analize ait tüm taslaklar. */
  abstract findByAnalysis(analysisId: string): Promise<Draft[]>;

  /** GDPR Art.17 — süresi geçmiş kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}

/**
 * Onay kapısının INSERT tarafı (CLAUDE.md §7).
 *
 * Bir taslak doğrudan `sent` durumunda YARATILAMAZ; aksi hâlde `update()`
 * kapısı, kaydı en baştan `sent` olarak yaratmak suretiyle tamamen atlanabilirdi.
 * Her iki sürücü (memory + supabase) bunu çağırır; Postgres trigger'ı
 * (`enforce_draft_approval_gate`, `tg_op = 'INSERT'` kolu) son savunma hattıdır.
 */
export function assertNotBornSent(status: DraftStatus | undefined): void {
  if (status === 'sent') {
    throw new Error(
      "Taslak doğrudan 'sent' durumunda yaratılamaz — insan onayı önce " +
        "gerçekleşmeli ('draft' → 'pending_approval' → 'approved' → 'sent').",
    );
  }
}
