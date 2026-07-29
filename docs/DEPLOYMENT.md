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

> ✅ **Çözüldü (D-020):** Bu bölümde eskiden `PII_MASTER_KEY=` boş satırının
> uygulamayı çökerttiği bir uyarı vardı. `env.schema.ts` artık `blankToUndefined()`
> ile boş string'leri "tanımsız" sayıyor; `cp .env.example .env` sonrası hiçbir
> değişiklik yapmadan açılış temiz. Regresyon testi: `env.schema.spec.ts` →
> "boş değerler (D-020 regresyonu)".

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

Repoda `railway.json` hazır: Dockerfile builder, `/health` healthcheck'i,
`ON_FAILURE` yeniden başlatma politikası ve **`numReplicas: 1`**.

> **Neden tek replika?** Cron işleri (`@nestjs/schedule`) süreç İÇİNDE çalışıyor:
> GDPR silme (`DELETION_CRON`) ve hatırlatma gönderimi. İki replika = aynı
> hatırlatmanın kullanıcıya İKİ KEZ gitmesi ve silme işinin çakışması demek.
> Yatay ölçekleme istenirse önce zamanlayıcı ayrı bir servise çıkarılmalı (v2).

### 2.1 Kurulum

1. Railway'de yeni proje → "Deploy from GitHub repo" → bu repo.
2. Build ayarı gerekmez: `railway.json` builder'ı `DOCKERFILE` olarak sabitler.
   **Dockerfile hedefi de ayarlanmaz** — `runtime` bilinçli olarak dosyanın SON
   aşamasıdır, hedefsiz build daima onu üretir (bkz. Dockerfile başlığı ve §6).
3. Variables sekmesine §4'teki değişkenleri girin. Asgari üretim seti:
   ```
   NODE_ENV=production
   LLM_MOCK=false
   ANTHROPIC_API_KEY=sk-ant-...
   DB_DRIVER=supabase
   SUPABASE_URL=https://<proje>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   PII_MASTER_KEY=<openssl rand -hex 32>
   TELEGRAM_MODE=webhook
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
   ```
4. **`PORT` ve `PUBLIC_BASE_URL` girmeyin.** Railway `PORT`'u kendisi enjekte eder;
   `PUBLIC_BASE_URL` ise Railway'in `RAILWAY_PUBLIC_DOMAIN` değişkeninden otomatik
   türetilir (`https://<domain>`). Bu, "tavuk-yumurta" sorununu çözer: uygulamanın
   genel adresi ancak ilk dağıtımdan sonra bilinir, ama webhook kaydı AÇILIŞTA
   gerekir. Özel alan adı kullanıyorsanız `PUBLIC_BASE_URL`'i açıkça girin —
   açık değer her zaman kazanır.
5. Networking → "Generate Domain" ile genel alan adını üretin (yoksa
   `RAILWAY_PUBLIC_DOMAIN` tanımlı olmaz ve webhook `localhost`'a kaydolur).
6. Migration'lar Supabase tarafında zaten uygulanmış olmalı (8/8 tablo). Yeni bir
   proje ise:
   ```bash
   DATABASE_URL="<Supabase connection string>" scripts/apply-migrations.sh
   ```
   (Supabase panelinde: Project Settings → Database → Connection string.)

### 2.2 Deploy öncesi ve sonrası doğrulama

```bash
# YEREL değişkenlerle (.env):
npm run check:deploy

# RAILWAY'deki GERÇEK değişken setiyle — asıl önemli olan bu:
railway run npm run check:deploy
```

`check:deploy` token harcamaz (yalnızca ücretsiz uç noktalar) ve şunları doğrular:
gerçek `validateEnv()` üretim modunda geçiyor mu · `PUBLIC_BASE_URL` dış dünyadan
erişilebilir ve https mi · `TELEGRAM_MODE=webhook` iken sır tanımlı ve Telegram'ın
kabul ettiği biçimde mi (yoksa endpoint fail-closed davranır ve bot **sessizce
sağır** olur — D-030) · Supabase anahtarı SECRET türünde ve 8/8 tablo erişilebilir
mi · Anthropic anahtarı ve `LLM_MODEL` geçerli mi.

Deploy sonrası:

```bash
curl -s https://<domain>/health          # {"status":"ok","uptime":N}
```

Telegram webhook'unun gerçekten kayıtlı olduğunu Telegram'a sorarak doğrulayın:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
# url alanı https://<domain>/webhook/telegram olmalı,
# last_error_message boş olmalı.
```

### 2.3 Anahtar rotasyonundan sonra

Supabase/Anthropic anahtarını döndürdüğünüzde **Railway Variables'ı da güncelleyin** —
`.env` yalnızca yereldir. Rotasyon prosedürleri: `MANUAL_ACTIONS_REQUIRED.md` §3b
(`npm run rotate:supabase-key`) ve `DECISIONS.md` D-035/D-037.

## 3. Coolify Dağıtımı

1. Coolify'da "New Resource → Docker Compose" veya "Dockerfile" kaynak tipini seçin.
2. Dockerfile tabanlı dağıtımda **Build Target: `runtime`** olarak ayarlayın.
3. Port: `3000` (veya `.env`'deki `PORT` neyse) — Coolify'ın proxy'sine bu portu bağlayın.
4. Ortam değişkenlerini Coolify'ın "Environment Variables" panelinden girin (§4 tablo).
5. Healthcheck: Dockerfile'daki `HEALTHCHECK` talimatı (`GET /health`) Coolify
   tarafından otomatik algılanır; ek yapılandırma gerekmez.
   ⚠️ Coolify'da `PUBLIC_BASE_URL`'i **elle** girin — `RAILWAY_PUBLIC_DOMAIN`
   otomatiği yalnızca Railway'e özgüdür.
6. Migration'ları deploy öncesi elle çalıştırın (§2 madde 5 ile aynı script).

## 4. Ortam Değişkenleri (`.env.example` ile birebir tutarlı)

| Değişken | Zorunlu mu? | Açıklama |
|---|---|---|
| `NODE_ENV` | Hayır (varsayılan `development`) | `production` iken sıkı doğrulama devreye girer (§6). |
| `PORT` | Hayır (varsayılan `3000`) | HTTP portu. |
| `PUBLIC_BASE_URL` | Railway'de HAYIR, başka yerde webhook için EVET | Webhook adresinin temeli. Railway'de `RAILWAY_PUBLIC_DOMAIN`'den otomatik türetilir; açıkça verilen değer her zaman kazanır. |
| `RAILWAY_PUBLIC_DOMAIN` | Platform enjekte eder | Elle GİRMEYİN. Yalnızca `PUBLIC_BASE_URL` boşsa okunur. |
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
| `SUPABASE_SERVICE_ROLE_KEY` | `DB_DRIVER=supabase` ise EVET | Supabase gizli anahtarı — `sb_secret_...` (RLS'i bypass eder). Rotasyon: `npm run rotate:supabase-key`. |
| `SUPABASE_ANON_KEY` | Hayır | Publishable anahtar (`sb_publishable_...`). Backend bununla ÇALIŞMAZ; yalnızca ileride istemci eklenirse. |
| `PII_MASTER_KEY` | Üretimde EVET | `openssl rand -hex 32` — 64 hex karakter. |
| `DATA_RETENTION_DAYS` | Hayır (varsayılan `30`) | GDPR Art.17 saklama süresi. |
| `DELETION_CRON` | Hayır (varsayılan `0 3 * * *`) | Otomatik silme cron ifadesi. |
| `WHATSAPP_TOKEN` | Hayır (v2, opsiyonel) | Henüz kullanılmıyor. |

## 5. Üretim Öncesi Kontrol Listesi

İki araç var, ikisi de aynı listeyi farklı açıdan kontrol eder:

```bash
npm run check:deploy                 # ÖNERİLEN — gerçek validateEnv() + canlı yoklama
railway run npm run check:deploy     # platformdaki GERÇEK değişken setiyle
scripts/check-env.sh .env.production # bash tabanlı, dosya okur, ağ erişimi gerektirmez
```

`check:deploy` gerçek `validateEnv()`'i çağırdığı için `env.schema.ts` ile
kayması mümkün değildir; `check-env.sh` ise kuralları bash'te tekrarlar
(ağ olmayan ortamlar için hâlâ yararlı, ama kural kopyasıdır).

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
- [ ] `TELEGRAM_MODE=webhook` ise `TELEGRAM_WEBHOOK_SECRET` DOLU (boşsa endpoint
      fail-closed davranır ve bot hiçbir mesaj almaz — D-030)
- [ ] `PUBLIC_BASE_URL` dış dünyadan erişilebilir bir **https** adresi
      (Railway'de otomatik; başka yerde elle)
- [ ] Deploy sonrası `GET /health` → 200 ve `getWebhookInfo` → doğru url, hatasız

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
# Varsayılan (küçük, tarayıcısız) — hedef belirtmeye GEREK YOK
docker build -t bueko:latest .

# Watcher/Playwright'ı gerçekten çalıştırmak için (açıkça istenir)
docker build --target with-browsers -t bueko:with-browsers .
```

> ⚠️ **`runtime` aşaması Dockerfile'ın SONUNDA olmalı — sırasını değiştirmeyin.**
> `--target` verilmeyen bir build (Railway'in Dockerfile builder'ı dâhil) daima
> son aşamayı derler. Aşamalar eskiden `runtime` → `with-browsers` sırasındaydı;
> bu hâliyle Railway sessizce ~2 GB'lık, Node 20 tabanlı Playwright imajını
> üretirdi. Sıra düzeltildi ve `docker build` (hedefsiz) ile doğrulandı:
> üretilen imaj 218 MB / Node 22.

Neden ayrım var: `playwright` `package.json`'da `optionalDependencies` altında ve
Alpine'in musl libc'si üzerinde Chromium/WebKit/Firefox resmi olarak desteklenmiyor
(Microsoft yalnızca Debian/Ubuntu tabanlı resmi Playwright imajı yayınlıyor). Watcher
opsiyonel bir PoC modülü (ARCHITECTURE.md §3) olduğu için ana kullanım senaryosunu
(Telegram bot) gereksiz yere ~1GB+ büyütmemek adına iki ayrı hedef tanımlandı.

> **Küçük ama önemli düzeltme:** `runtime` imajında `node_modules/playwright`
> **vardır** (~18 MB) — `playwright` bir `optionalDependency` ve
> `npm ci --omit=dev` optional bağımlılıkları atmaz. Kaçınılan asıl maliyet
> tarayıcı BINARY'leridir (~1.8 GB); `--ignore-scripts` onların indirilmesini
> engeller. Yani "tarayıcı içermez" ifadesi binary'ler için doğrudur, JS paketi
> için değil. CI bu ayrımı tam olarak böyle doğrular (`/ms-playwright` yokluğu).

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
5. `docker build` **hedefsiz** (push YOK) — Railway ile aynı yol. Ardından
   üretilen imajın gerçekten `runtime` olduğu kanıtlanır: Node 22 + Alpine +
   tarayıcı binary'si yok. Hedef verilseydi, aşama sırası bozulduğunda CI yeşil
   kalır ama Railway yanlış imajı üretirdi (D-038).

## 8. Bilinen Sorunlar — hepsi KAPANDI

Bu bölümde eskiden iki açık bulgu vardı; ikisi de düzeltildi ve testle korunuyor:

1. ~~`PII_MASTER_KEY=` boş satırı çöküşe sebep olur~~ → **D-020**, `blankToUndefined()`.
2. ~~`class-validator` / `class-transformer` bağımlılığı eksik~~ → **D-021**: global
   `ValidationPipe` KALDIRILDI (sıfır DTO için iki çalışma-zamanı bağımlılığı
   eklemek yerine). Gerekçe `src/main.ts` içinde yorum olarak duruyor; HTTP DTO
   doğrulaması gerektiğinde oradaki iki satırlık talimat izlenir.

**Gerçek `docker build` + `docker run` ile son doğrulama (2026-07-29):**
hedefsiz build → `runtime` (218 MB, Node 22) · `NODE_ENV=production` +
gerçek `.env` ile temiz açılış (0 hata) · `GET /health` → `200
{"status":"ok","uptime":N}` · Docker HEALTHCHECK → `healthy`.

## 8b. Ölçekleme Sınırı (bilinçli)

Uygulama **tek replika** varsayar. Zamanlayıcı (`@nestjs/schedule`) süreç içinde
çalıştığı için ikinci bir replika:

- aynı hatırlatmayı kullanıcıya iki kez gönderir,
- GDPR silme işini (`purge_expired_data()`) eşzamanlı iki kez tetikler.

`railway.json` bu yüzden `numReplicas: 1` sabitler. Yatay ölçekleme gerekirse
zamanlayıcının ayrı bir servise (veya dağıtık kilide) taşınması gerekir — v2.

## 9. Şeffaflık ve Konumlandırma Hatırlatması

Üretime alırken README/bot mesajlarında şu ifadelerin korunduğundan emin olun
(CLAUDE.md §7, ARCHITECTURE.md §6):

- Bot her oturumda yapay zeka olduğunu açıkça belirtir.
- Ürün "hukuki tavsiye değil, bilgilendirme/hazırlık asistanı" olarak konumlandırılır.
- Hiçbir taslak/form, kullanıcı onayı (`approved` state) olmadan otomatik gönderilmez.
