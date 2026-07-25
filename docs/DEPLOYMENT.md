# BüKo — Deployment Rehberi

> Bu doküman, DevOps agent'ının sahip olduğu dosyalarla (`Dockerfile`, `docker-compose.yml`,
> `.github/workflows/ci.yml`, `scripts/`) nasıl çalışılacağını anlatır. Ürün/mimari kararları
> için bkz. `ARCHITECTURE.md` ve `DECISIONS.md`; env değişkenlerinin kaynağı `.env.example`'dır
> (bu doküman ondan sapmaz — yeni değişken uydurulmamıştır).

## 1. Lokal Çalıştırma

### 1a. Docker olmadan (doğrudan Node)

```bash
cp .env.example .env
# .env içinde en azından varsayılanlar yeterlidir (LLM_MOCK=true, DB_DRIVER=memory).
npm ci
npm run build
npm run start:prod
# veya geliştirme sırasında hot-reload için:
npm run start:dev
```

Varsayılan `.env.example` değerleriyle proje **hiçbir gerçek anahtar olmadan** ayağa kalkması
gerekir (mock LLM, in-memory DB, Telegram devre dışı) — bkz. `MANUAL_ACTIONS_REQUIRED.md`.

> ⚠️ **Bilinen sorun (doğrulandı, `env.schema.ts` kapsamında — bu agent'ın dosya
> sahipliği dışında, config/backend sahibine bildirilmeli):** `.env.example`'da
> `PII_MASTER_KEY=` satırı BOŞ bırakılmış. `dotenv`/`@nestjs/config` bunu `""` (boş
> string) olarak okur — `undefined` değil. `env.schema.ts`'deki
> `z.string().regex(/^[0-9a-fA-F]{64}$/).optional()` tanımı yalnızca `undefined`'ı
> "yok" sayar; `""` regex'e karşı test edilir ve BAŞARISIZ olur. Sonuç: `cp .env.example .env`
> sonrası hiçbir değişiklik yapmadan `npm run start:prod` / `docker compose up` çalıştırmak
> "PII_MASTER_KEY 64 hex karakter olmalı" hatasıyla **process'i başlatmadan çökertir** —
> bu, `node dist/main.js` ile lokal olarak ve Docker içinde bağımsız olarak doğrulandı.
> **Geçici çözüm:** `.env` dosyanızda `PII_MASTER_KEY=` satırını tamamen SİLİN (veya
> yorum satırı yapın) ki değişken gerçekten tanımsız sayılsın; ya da
> `openssl rand -hex 32` ile gerçek bir dev anahtarı girin. **Kalıcı düzeltme** için
> `env.schema.ts`'de bu alanın boş string'i `undefined`'a çeviren bir `transform`
> eklemesi önerilir (örn. `z.string().optional().refine(v => !v || regex.test(v), ...)`).

### 1b. docker-compose ile

```bash
cp .env.example .env
docker compose up --build
```

Bu, yalnızca `app` servisini (üretim benzeri Alpine imajı, `runtime` hedefi) ayağa kaldırır.
`.env` dosyanız `env_file` olarak konteynere aktarılır.

**Opsiyonel yerel Postgres** (yalnızca şema/psql denemesi için — aşağıdaki uyarıya bakın):

```bash
docker compose --profile local-db up --build
```

Bu profil, `supabase/migrations/0001_init.sql`'i konteyner ilk açılışında
`docker-entrypoint-initdb.d` mekanizmasıyla otomatik uygulayan bir `postgres:16-alpine`
servisi ekler (bağlantı: `postgresql://bueko:bueko_dev_only@localhost:5432/bueko`).

> ⚠️ **Önemli sınırlama:** Bu yerel `postgres` servisi `DB_DRIVER=supabase` modunun tam bir
> ikamesi DEĞİLDİR. Uygulama Postgres'e ham SQL bağlantısıyla değil, `@supabase/supabase-js`
> istemcisiyle Supabase'in REST/PostgREST katmanına bağlanır. Yani `SUPABASE_URL` düz bir
> Postgres connection string'i değil, bir Supabase proje URL'idir. Yerelde Supabase'in
> tam davranışını (PostgREST, Auth, Storage) denemek isterseniz Supabase CLI kullanın:
> ```bash
> supabase start   # ayrı kurulum gerektirir: https://supabase.com/docs/guides/cli
> ```
> Buradaki `postgres` profili yalnızca migration dosyasını psql ile test etmek veya şemayı
> incelemek içindir.

## 2. Railway Dağıtımı

1. Railway'de yeni proje oluşturun, bu repo'yu bağlayın.
2. Railway, `Dockerfile`'ı otomatik algılar. **Build ayarlarında hedefi `runtime` olarak
   sabitleyin** (Playwright/watcher gerekmedikçe — varsayılan zaten `runtime`, ekstra ayar
   gerekmez, sadece Railway arayüzünde "Dockerfile target" alanı varsa boş bırakmayın).
3. Ortam değişkenlerini Railway'in "Variables" sekmesinde girin (bkz. §4 tablo).
   Özellikle: `NODE_ENV=production`, `LLM_MOCK=false`, `ANTHROPIC_API_KEY`, `DB_DRIVER=supabase`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PII_MASTER_KEY`.
4. Railway otomatik olarak bir `PORT` değişkeni enjekte eder — uygulama zaten
   `process.env.PORT`'u okuyor (`src/config/env.schema.ts`), ekstra ayar gerekmez.
5. Deploy öncesi migration'ları uygulayın:
   ```bash
   DATABASE_URL="<Supabase connection string>" scripts/apply-migrations.sh
   ```
   (Supabase panelinde: Project Settings → Database → Connection string.)
6. Deploy sonrası `scripts/check-env.sh` ile üretim değişkenlerini yerelde/CI'da
   simüle edip doğrulayabilirsiniz (bkz. §5).

## 3. Coolify Dağıtımı

1. Coolify'da "New Resource → Docker Compose" veya "Dockerfile" kaynak tipini seçin.
2. Dockerfile tabanlı dağıtımda **Build Target: `runtime`** olarak ayarlayın.
3. Port: `3000` (veya `.env`'deki `PORT` neyse) — Coolify'ın proxy'sine bu portu bağlayın.
4. Ortam değişkenlerini Coolify'ın "Environment Variables" panelinden girin (§4 tablo).
5. Healthcheck: Dockerfile'daki `HEALTHCHECK` talimatı Coolify tarafından otomatik
   algılanır; ek yapılandırma gerekmez.
6. Migration'ları deploy öncesi elle çalıştırın (§2 madde 5 ile aynı script).

## 4. Ortam Değişkenleri (`.env.example` ile birebir tutarlı)

| Değişken | Zorunlu mu? | Açıklama |
|---|---|---|
| `NODE_ENV` | Hayır (varsayılan `development`) | `production` iken sıkı doğrulama devreye girer (§6). |
| `PORT` | Hayır (varsayılan `3000`) | HTTP portu. |
| `PUBLIC_BASE_URL` | Hayır | Webhook/URL üretimi için temel adres. |
| `ANTHROPIC_API_KEY` | Üretimde EVET | Claude API anahtarı; yoksa `LLM_MOCK=true` gerekir. |
| `LLM_MOCK` | Üretimde `false` olmalı | `true` iken deterministik mock LLM yanıtı kullanılır. |
| `LLM_MODEL` | Hayır (varsayılan `claude-sonnet-5`) | Kullanılacak model kimliği. |
| `LLM_MAX_TOKENS` | Hayır (varsayılan `2048`) | Claude çağrısı token limiti. |
| `OCR_PROVIDER` | Hayır (varsayılan `claude-vision`) | `claude-vision` veya `local` (bkz. DECISIONS D-010). |
| `TELEGRAM_BOT_TOKEN` | Bot aktifse EVET | @BotFather token'ı. |
| `TELEGRAM_MODE` | Hayır (varsayılan `disabled`) | `webhook` \| `polling` \| `disabled`. |
| `TELEGRAM_WEBHOOK_SECRET` | `TELEGRAM_MODE=webhook` ise önerilir | Webhook doğrulama sırrı. |
| `DB_DRIVER` | Üretimde `supabase` olmalı | `memory` \| `supabase`. |
| `SUPABASE_URL` | `DB_DRIVER=supabase` ise EVET | Supabase proje URL'i (AB bölgesi). |
| `SUPABASE_SERVICE_ROLE_KEY` | `DB_DRIVER=supabase` ise EVET | Supabase servis rolü anahtarı (gizli!). |
| `PII_MASTER_KEY` | Üretimde EVET | `openssl rand -hex 32` — 64 hex karakter. |
| `DATA_RETENTION_DAYS` | Hayır (varsayılan `30`) | GDPR Art.17 saklama süresi. |
| `DELETION_CRON` | Hayır (varsayılan `0 3 * * *`) | Otomatik silme cron ifadesi. |
| `WHATSAPP_TOKEN` | Hayır (v2, opsiyonel) | Henüz kullanılmıyor. |

## 5. Üretim Öncesi Kontrol Listesi

`scripts/check-env.sh` bu listeyi otomatik kontrol eder:

```bash
NODE_ENV=production scripts/check-env.sh .env.production
```

Kontrol listesi:

- [ ] `NODE_ENV=production`
- [ ] `LLM_MOCK=false`
- [ ] `ANTHROPIC_API_KEY` dolu (gerçek anahtar)
- [ ] `DB_DRIVER=supabase` (ve `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` dolu, AB bölgesi projesi)
- [ ] `PII_MASTER_KEY` dolu, 64 hex karakter, **gerçek/rastgele üretilmiş** (dev anahtarı değil)
- [ ] Supabase projesi **EU (AB) bölgesinde** oluşturulmuş (GDPR — bkz. CLAUDE.md §5)
- [ ] `supabase/migrations/0001_init.sql` hedef veritabanına uygulanmış
     (`scripts/apply-migrations.sh`)
- [ ] Telegram kullanılacaksa `TELEGRAM_BOT_TOKEN` + uygun `TELEGRAM_MODE` ayarlı

### Kod seviyesinde zorlanan güvenlik kapısı

`src/config/env.schema.ts` içindeki `superRefine` bloğu, `NODE_ENV=production` iken
şunları **uygulama başlamadan reddeder** (fail-fast — bu bir öneri değil, kod zorunluluğudur):

- `LLM_MOCK=true` → hata: "Üretimde LLM_MOCK=false olmalı"
- `ANTHROPIC_API_KEY` boş → hata: "Üretimde ANTHROPIC_API_KEY zorunlu"
- `PII_MASTER_KEY` boş → hata: "Üretimde PII_MASTER_KEY zorunlu (dev anahtarı ASLA kullanılmaz)"
- `DB_DRIVER=memory` → hata: "Üretimde DB_DRIVER=supabase olmalı"
- `DB_DRIVER=supabase` ama `SUPABASE_URL` boş → hata

Yani **mock modda üretime çıkmak teknik olarak imkansızdır** — `npm run start:prod` (veya
Docker imajı) `NODE_ENV=production` ile bu koşullardan biri eksikse process anında hata
verip çıkar. `scripts/check-env.sh` bu hataları deploy'dan ÖNCE, insan-okunur şekilde
gösterir; ama son söz her zaman `env.schema.ts`'dedir.

## 6. Docker İmaj Hedefleri

| Hedef | Ne zaman kullanılır | Boyut/özellik |
|---|---|---|
| `runtime` (varsayılan) | Standart üretim — Telegram bot + LLM analiz + PII + reminders | Alpine, küçük, **Playwright/watcher YOK** |
| `with-browsers` | Randevu izleme (WatcherService/Playwright) gerçekten kullanılacaksa | Debian tabanlı (`mcr.microsoft.com/playwright`), Chromium önceden kurulu, çok daha büyük |

```bash
# Varsayılan (küçük, tarayıcısız)
docker build --target runtime -t bueko:latest .

# Watcher/Playwright'ı gerçekten çalıştırmak için
docker build --target with-browsers -t bueko:with-browsers .
```

Neden ayrım var: `playwright` `package.json`'da `optionalDependencies` altında ve
Alpine'in musl libc'si üzerinde Chromium/WebKit/Firefox resmi olarak desteklenmiyor
(Microsoft yalnızca Debian/Ubuntu tabanlı resmi Playwright imajı yayınlıyor). Watcher
opsiyonel bir PoC modülü (ARCHITECTURE.md §3) olduğu için ana kullanım senaryosunu
(Telegram bot) gereksiz yere ~1GB+ büyütmemek adına iki ayrı hedef tanımlandı.

**Gerçek ölçüm (lokal `docker build` ile doğrulandı):**

| Hedef | Ölçülen imaj boyutu | Node sürümü |
|---|---|---|
| `runtime` | ~218 MB | 22 (Alpine) |
| `with-browsers` | ~2.08 GB | **20** (Microsoft'un `playwright:v1.48.0-jammy` taban imajı Node 22 değil, Node 20 ile geliyor) |

⚠️ **Dikkat:** `with-browsers` hedefi Node 20 üzerinde çalışır (taban imajın sürümü),
`runtime` hedefi ise Node 22. `npm ci` sırasında `@supabase/*` paketleri için
`EBADENGINE` uyarısı görülür (paket Node ≥22 istiyor) — kurulum yine de başarılı olur,
ancak bu tutarsızlık bilinçli bir ödün: watcher hedefi yalnızca PoC amaçlı, üretimde
Telegram/LLM/PII akışı için `runtime` hedefi kullanılmalıdır.

## 7. CI (`.github/workflows/ci.yml`)

Her PR ve `main` push'unda otomatik çalışır:

1. `npm ci` — kilitli bağımlılık kurulumu.
2. `npx tsc --noEmit` — tip kontrolü.
3. `npx jest --ci` — birim testleri.
4. `npm run build` — üretim derlemesi.
5. `docker build --target runtime` (push YOK, sadece build edilebilirlik doğrulaması,
   GitHub Actions cache ile hızlandırılmış).

## 8. Bilinen Sorunlar (Docker build/run doğrulaması sırasında bulundu)

Bu bulgular `src/**` / `package.json` kapsamında — bu agent'ın dosya sahipliği dışında,
ama gerçek `docker build` + `docker run` denemesiyle doğrulandığı için burada not edildi:

1. **`PII_MASTER_KEY=` boş satırı çöküşe sebep olur** — bkz. §1a üstündeki uyarı kutusu.
2. **`class-validator` / `class-transformer` bağımlılığı eksik.** `src/main.ts`,
   `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`
   çağırıyor; NestJS'in `ValidationPipe`'ı bu iki paketi runtime'da lazy-require eder.
   `package.json`'da (`dependencies` VE `devDependencies` içinde) bu paketler **hiç yok**
   (doğrulandı: `package-lock.json`'da da yok, `node_modules`'ta da yok — devDependency
   hoisting'ten değil, tamamen eksik). Sonuç: hem lokalde tam `npm ci` ile hem de üretim
   Docker imajında (`--omit=dev`) başlangıçta
   `[PackageLoader] The "class-validator" package is missing` hatası loglanıyor.
   Şu an DTO'larda `class-validator` dekoratörü kullanılmıyorsa etkisiz olabilir, ama
   `ValidationPipe`'ın `transform: true` ile global kullanılması bu paketlerin üretim
   bağımlılığı olarak eklenmesini gerektirir. **Öneri:** `npm i class-validator
   class-transformer --save` (backend/config sahibine iletilmeli).

## 9. Şeffaflık ve Konumlandırma Hatırlatması

Üretime alırken README/bot mesajlarında şu ifadelerin korunduğundan emin olun
(CLAUDE.md §7, ARCHITECTURE.md §6):

- Bot her oturumda yapay zeka olduğunu açıkça belirtir.
- Ürün "hukuki tavsiye değil, bilgilendirme/hazırlık asistanı" olarak konumlandırılır.
- Hiçbir taslak/form, kullanıcı onayı (`approved` state) olmadan otomatik gönderilmez.
