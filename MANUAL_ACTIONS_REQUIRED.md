# MANUAL_ACTIONS_REQUIRED.md — Yalnızca İnsanın Yapabileceği Eylemler

> Bu dosya boşsa proje tamamen otonom ilerliyor demektir. Aşağıdaki maddeler kodun
> çalışmasını **engellemez** (hepsi mock/stub arkasında geliştirildi); yalnızca gerçek
> dağıtım/canlı kullanım için gereklidir. Mimari, her biri tek `.env` değişikliğiyle
> gerçek anahtara geçecek şekilde kuruldu.

## 1. Anthropic API anahtarı
- **Neden:** Claude vision/analiz çağrıları.
- **Aksiyon:** console.anthropic.com'dan API key al → `.env` içinde `ANTHROPIC_API_KEY=...`
- **O ana kadar:** `LLM_MOCK=true` ile deterministik mock yanıtlar kullanılıyor.
- **Prompt kalitesi için:** Anahtar geldiğinde `ANTHROPIC_API_KEY=sk-... npm run eval:prompts`
  çalıştırın. 8 sentetik mektubu gerçek modelden geçirip alan bazında doğruluk
  (kurum / son tarih / risk / eksik belge) ve PII sızıntı raporu üretir.
  Prompt değişikliği ÖNCESİ ve SONRASI karşılaştırması için `--out baseline.json`.
  ⚠️ Gerçek API çağrısıdır, ücretlendirilir (8 çağrı).

## 2. Telegram Bot Token
- **Neden:** Gerçek Telegram botu.
- **Aksiyon:** @BotFather'dan token al → `.env` içinde `TELEGRAM_BOT_TOKEN=...` ve
  `TELEGRAM_MODE=polling` (yerel geliştirme) veya `TELEGRAM_MODE=webhook` (üretim).
- **O ana kadar:** Bot polling/webhook devre dışı; kanal mantığı `MockChannelAdapter` + testlerle doğrulanıyor.

## 2b. Telegram webhook sırrı (üretim modu)
- **Neden:** Webhook endpoint'i (`POST /webhook/telegram`) tahmin edilebilir bir
  adrestir; gizli anahtar olmadan üçüncü taraflar sahte update enjekte edebilir.
- **Aksiyon:**
  1. `openssl rand -hex 32` ile bir sır üret → `.env` içine `TELEGRAM_WEBHOOK_SECRET=...`
  2. `TELEGRAM_MODE=webhook` ve `PUBLIC_BASE_URL=https://<alan-adiniz>` ayarla
  3. Uygulama açılışta webhook'u Telegram'a otomatik kaydeder (`setWebhook`)
- **O ana kadar:** `TELEGRAM_MODE=polling` (yerel geliştirme) veya `disabled`.
- **DİKKAT:** Sır tanımlı değilse endpoint **tüm istekleri 401 ile reddeder**
  (fail-closed). Bu bilinçlidir — sırsız bir webhook açık kapıdır.

## 3. Supabase — şema uygulanmalı + GİZLİ anahtar gerekli  ⛔ AKTİF ENGEL
**Durum (2026-07-26 denetimi — `npm run check:supabase`):**
- ✓ Proje AYAKTA: `https://gvvsuelxvwdjlobaqmgq.supabase.co`
- ✗ Şema UYGULANMAMIŞ — 8 tablonun hiçbiri yok
- ⚠ Eldeki anahtar **publishable/anon** (`sb_publishable_...`) → backend için YETERSİZ

### 3a. Migration'ları uygula (2 dakika, tarayıcıdan)
Bu adım **API ile yapılamaz**: DDL (CREATE TABLE) için doğrudan Postgres bağlantısı
gerekir; anon anahtarla PostgREST üzerinden SQL çalıştırılamaz.

**En kolay yol — Supabase SQL Editor:**
1. https://supabase.com/dashboard/project/gvvsuelxvwdjlobaqmgq/sql/new
2. `supabase/migrations/0001_init.sql` içeriğini yapıştır → **Run**
3. `supabase/migrations/0002_onboarding_profile.sql` için tekrarla
4. Doğrula: `npm run check:supabase` → 8/8 tablo görünmeli

**Alternatif — psql (şifre gerekir):**
```bash
# Dashboard → Settings → Database → Connection string (URI)
export DATABASE_URL='postgresql://postgres:[ŞİFRE]@db.gvvsuelxvwdjlobaqmgq.supabase.co:5432/postgres'
./scripts/apply-migrations.sh
```

### 3b. Service role anahtarını gir
- Dashboard → **Settings → API → `service_role`** (veya yeni `sb_secret_...`)
- `.env` → `SUPABASE_SERVICE_ROLE_KEY=...` ve `DB_DRIVER=supabase`

⚠️ **Bu anahtarı sohbete YAPIŞTIRMAYIN.** service_role anahtarı RLS'i bypass eder
ve veritabanının tamamına tam yetki verir. Doğrudan `.env` dosyanıza yazın
(veya bu oturumda `! ` önekiyle kendiniz çalıştırın).
Paylaştığınız publishable anahtar ise zaten herkese açık olacak şekilde
tasarlanmıştır — onu paylaşmanız bir risk oluşturmaz.

### 3c. Neden anon anahtar yetmiyor (tasarım gereği)
`0001_init.sql` tüm tablolarda **RLS'i etkinleştiriyor ve HİÇBİR politika
tanımlamıyor** (ARCHITECTURE §4). Bu bilinçlidir: backend `service_role` ile
bağlanır ve RLS'i bypass eder. Anon anahtarla her sorgu **reddedilir** —
yani şema uygulansa bile uygulama bu anahtarla çalışmaz.
İleride web dashboard eklenirse kullanıcı-bazlı RLS politikaları yazılacak;
o zaman anon anahtar anlamlı hâle gelir (`SUPABASE_ANON_KEY` alanı hazır).

- **O ana kadar:** `DB_DRIVER=memory` — tüm testler ve akışlar çalışıyor.

## 4. PII Vault master key (üretim)
- **Neden:** PII vault AES-256-GCM şifreleme anahtarı.
- **Aksiyon:** `openssl rand -hex 32` → `.env` içinde `PII_MASTER_KEY=...` (üretimde KMS önerilir).
- **O ana kadar:** Dev için sabit test anahtarı türetiliyor (üretimde ASLA kullanılmaz — uyarı loglanır).

## 5. Playwright tarayıcısı (yalnızca randevu izleme özelliği için)
- **Neden:** Ausländerbehörde randevu sayfası izleme PoC'si tarayıcı gerektirir.
- **Aksiyon:** `npx playwright install chromium`
- **O ana kadar:** İzleme servisi mock sayfalarla test edilir; tarayıcı yoksa ilgili
  testler atlanır (skip) ve uygulama çökmez.

## 6. WhatsApp Business API (opsiyonel, v2)
- **Neden:** WhatsApp kanalı.
- **Aksiyon:** Meta Business doğrulama + telefon no + `WHATSAPP_TOKEN`.
- **O ana kadar:** `MockChannelAdapter`; kapsam v1'de Telegram.

## 7. Sistem git düzeltmesi (opsiyonel, geliştirme rahatlığı)
- **Neden:** `/usr/bin/git` bozuk Xcode'a bağlı.
- **Aksiyon:** `sudo xcode-select --switch /Library/Developer/CommandLineTools`
- **O ana kadar:** CLT git tam yol ile kullanılıyor (bkz. DECISIONS D-001).

## 8. Deployment hosting hesabı (teslim aşaması)
- **Neden:** Railway/Coolify canlı dağıtım.
- **Aksiyon:** Hesap + repo bağla + env değişkenlerini gir.
- **O ana kadar:** Dockerfile + docker-compose ile lokal çalışır.
