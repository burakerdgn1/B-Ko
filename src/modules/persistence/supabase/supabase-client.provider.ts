import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfigService } from '../../../config/config.service';

/**
 * Supabase istemcisini tek noktadan üretir (service-role key ile — RLS bypass,
 * bkz. 0001_init.sql §RLS hazırlığı).
 *
 * Tembel (lazy) kurulum: constructor asla fırlatmaz, böylece `DB_DRIVER=memory`
 * iken bu servis DI graf'ına eklense bile Supabase env'i eksik olsa dahi hata
 * vermez. Hata yalnızca `.client` gerçekten okunduğunda (yani supabase driver
 * fiilen kullanıldığında) fırlatılır.
 */
@Injectable()
export class SupabaseClientProvider {
  private cached: SupabaseClient | null = null;

  constructor(private readonly config: AppConfigService) {}

  get client(): SupabaseClient {
    if (!this.cached) {
      const url = this.config.supabaseUrl;
      const key = this.config.supabaseServiceRoleKey;
      if (!url || !key) {
        throw new Error(
          'DB_DRIVER=supabase seçili ancak SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ' +
            'tanımsız. bkz. MANUAL_ACTIONS_REQUIRED.md.',
        );
      }
      this.cached = createClient(url, key, {
        auth: { persistSession: false },
      });
    }
    return this.cached;
  }
}
