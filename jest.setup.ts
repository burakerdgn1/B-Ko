/**
 * ════════════════════════════════════════════════════════════════════════════
 * Jest `setupFiles` — HERMETİK TABAN (D-049)
 *
 * Bu dosya, spec dosyasının HİÇBİR import'u çalışmadan önce koşar. Tek işi,
 * testlerin dayandığı ortamı AÇIKÇA sabitlemek.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * `config.module.ts` şöyle diyor:
 *     ignoreEnvFile: process.env.NODE_ENV === 'test'
 * yani testlerin `.env`'den izole olması (D-032) tamamen `NODE_ENV`'in import
 * anında 'test' olmasına bağlı. Bunu bugüne kadar **Jest'in örtük varsayılanı**
 * sağlıyordu; repoda garanti eden hiçbir şey yoktu.
 *
 * Ölçüldü (D-049): `NODE_ENV=development npx jest` ile koşulduğunda config
 * `.env`'i okumaya başlıyor — `telegramMode` şema varsayılanı `disabled`
 * yerine `.env`'deki `polling` geliyor. Sonuçları:
 *   - `LLM_MOCK=false` + gerçek `ANTHROPIC_API_KEY` → testler ÜCRETLİ gerçek
 *     API'ye çıkar (bu bir kez yaşandı ve 24 test kırılmıştı — D-032),
 *   - `TELEGRAM_MODE=polling` → test suite'i GERÇEK botu başlatmaya çalışır,
 *     yani D-043 sınıfı bir yan etki.
 *
 * ── Neden `setupFiles` (setupFilesAfterEach değil) ──────────────────────────
 * `setupFiles` test çerçevesi kurulmadan ve spec'in modülleri yüklenmeden
 * önce çalışır. `ConfigModule.forRoot()` doğrulamayı IMPORT ANINDA yaptığı
 * için env'in o noktada doğru olması şart; daha geç çalışan bir kanca geç
 * kalırdı.
 *
 * ── Buradaki değerleri bilinçli olarak override etmek isteyen spec'ler ──────
 * Kendi `process.env` atamasını KENDİ import'larından ÖNCE yapmalıdır
 * (örnek: `supabase.integration.spec.ts`, D-023). Test GÖVDESİNDE yapılan
 * atama ETKİSİZDİR — bunun için `bootAppWithEnv()` kullanın
 * (`src/common/testing/boot-with-env.ts`).
 * ════════════════════════════════════════════════════════════════════════════
 */

// Hermetikliğin dayandığı tek koşul — artık örtük değil, açık.
process.env.NODE_ENV = 'test';

/**
 * Şema varsayılanlarıyla AYNI değerler. Amaç davranışı değiştirmek değil,
 * `.env` sızsa bile testlerin bilinen bir tabandan başlamasını garanti etmek.
 */
process.env.LLM_MOCK ??= 'true';
process.env.DB_DRIVER ??= 'memory';
process.env.TELEGRAM_MODE ??= 'disabled';

/**
 * ⚠️ `TELEGRAM_SKIP_STARTUP` / `SCHEDULER_SKIP_STARTUP` BİLİNÇLİ OLARAK
 * BURADA ZORLANMIYOR.
 *
 * İkisinin de şema varsayılanı `false`. Burada `true` yapmak "ekstra güvenlik"
 * gibi görünür ama test SEMANTİĞİNİ değiştirir: `reminders.service.spec.ts`
 * `handleDueReminders()`'ın gerçekten çalışmasını bekler ve guard devreye
 * girseydi sessizce erken dönerdi — testler geçer, ama artık hiçbir şey
 * doğrulamazlardı. Bu dosyanın işi tabanı ŞEMA VARSAYILANLARINA sabitlemek,
 * yeni bir davranış dayatmak değil.
 *
 * Yan etki koruması zaten var: `TELEGRAM_MODE=disabled` botu başlatmaz,
 * `DB_DRIVER=memory` gerçek veritabanına dokunmaz.
 */
