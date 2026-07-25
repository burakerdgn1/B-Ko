import { PostgrestError } from '@supabase/supabase-js';

/**
 * Supabase yanıtındaki `error` alanını kontrol eder; doluysa anlamlı bir
 * `Error` fırlatır. Tüm `*.supabase.repository.ts` dosyaları bunu kullanır —
 * sessiz başarısızlık (silent failure) olmasın diye.
 */
export function assertNoError(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message} (code=${error.code ?? '-'})`);
  }
}

/** `.single()` sonrası veri gelmediyse (beklenmedik durum) anlamlı hata fırlatır. */
export function assertData<T>(data: T | null, context: string): T {
  if (data == null) {
    throw new Error(`${context}: Supabase sorgusu veri döndürmedi.`);
  }
  return data;
}
