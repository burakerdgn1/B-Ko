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

## 3. Supabase — ✅ TAMAMLANDI (2026-07-26)
- ✓ Proje ayakta: `https://gvvsuelxvwdjlobaqmgq.supabase.co`
- ✓ `service_role` anahtarı `.env`'de, SECRET olarak doğrulandı
- ✓ `0001_init.sql` + `0002_onboarding_profile.sql` uygulandı — 8/8 tablo
- ✓ Sürücü gerçek DB'de doğrulandı: `npm run smoke:supabase` → 16/16

**Kalan tek adım (opsiyonel):** `.env`'de `DB_DRIVER=supabase` yapın.
Şu an `memory`; uygulama kalıcı veriyle çalışsın istiyorsanız değiştirin.

## 3b. ✅ TAMAMLANDI (2026-07-29) — `sb_secret_...` anahtar rotasyonu

Sızmış anahtar (`bukov2`) **iptal edildi**, uygulama yeni anahtarla (`bukov`)
çalışıyor. Doğrulandı: eski anahtar `HTTP 401 "Unregistered API key"` · yeni
anahtarla 16/16 entegrasyon testi · `pii_vault` 48/48 kayıt sağlam · GO.

> **Rotasyonun altın kuralı — bir dahaki sefere de geçerli:**
> Yeni anahtar, rotasyonu tetikleyen kanaldan (burada: sohbet transkripti)
> GEÇMEMELİ. Bu yüzden `--apply` adımı kullanıcının kendi terminalinde koşuldu;
> bu oturuma yalnızca maskeli parmak izi ulaştı. Aksi hâlde rotasyon,
> kapattığı borcu aynı anda yeniden yaratır.
> **Eski** anahtarı paylaşmak serbesttir — ama yalnızca revoke edildikten
> SONRA. (Bu turda sıra karıştı: anahtar revoke'tan önce paylaşıldı ve kısa
> süre canlı kaldı.)

**⚠️ Kalan sıkılaştırma:** Supabase'de `default` adlı ÜÇÜNCÜ bir secret anahtar
daha var. Proje onu kullanmıyor (kodda ve `.env`'de tek secret anahtar var,
doğrulandı). Kullanılmayan tam yetkili kimlik bilgisi saf saldırı yüzeyidir —
Dashboard'da "Last used" boşsa silin.

### Prosedür (ileride tekrar gerekirse)

**Araç:** `npm run rotate:supabase-key` (fail-safe; yeni anahtar tam olarak
doğrulanmadan `.env`'e YAZMAZ). Yalnızca 1. ve 4. adımlar insan eylemi:

1. 🧑 **Dashboard → Project Settings → API Keys → "Create new secret key"**
   (eskisini HENÜZ silmeyin — ikisi de canlı kalsın, kesintisiz geçiş için)
2. 🤖 Kuru koşum — yeni anahtarı doğrular, hiçbir şey yazmaz:
   ```bash
   SUPABASE_KEY_NEW=sb_secret_... npm run rotate:supabase-key
   ```
   Doğruladıkları: proje ayakta · anahtar SECRET türünde · 8/8 tabloya erişim ·
   gerçek yazma round-trip'i (insert → read-back → delete)
3. 🤖 Uygula (`.env` atomik olarak güncellenir, yedek dosya bırakılmaz):
   ```bash
   SUPABASE_KEY_NEW=sb_secret_... npm run rotate:supabase-key -- --apply
   npm run test:supabase          # 16/16 geçmeli
   ```
4. 🧑 **Dashboard → API Keys → ESKİ secret key → Revoke**
5. 🤖 İptali bağımsız kanıtla (401 beklenir):
   ```bash
   SUPABASE_KEY_OLD=<eski anahtar> npm run rotate:supabase-key -- --check-revoked
   ```
6. 🧑 Deployment ortam değişkenlerini de güncelleyin (Railway → Variables).

**Fail-safe davranışı canlı doğrulandı:** publishable anahtar ❌ · geçersiz
`sb_secret_` ❌ · `.env` satırı 0 veya 2 kez bulunursa yazma iptal ❌ —
üç durumda da `.env` bit-bit değişmeden kaldı (md5 karşılaştırmasıyla).

⚠️ Anthropic anahtarı için de aynısı geçerliydi; o **2026-07-26'da iptal edildi**
(401 ile doğrulandı) ve yerine yeni anahtar konuldu.

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

## 8. 🔴 AÇIK — Railway dağıtımı (hesap gerektirir)

**Kod tarafı HAZIR ve doğrulandı** (2026-07-29): `railway.json`, `/health`
liveness probe, `PUBLIC_BASE_URL` otomatiği, `npm run check:deploy` GO/NO-GO
aracı. Hedefsiz `docker build` gerçekten çalıştırıldı → 218 MB / Node 22,
konteyner `healthy`. Kalan tek şey hesap bağlama:

1. 🧑 [railway.app](https://railway.app) → hesap aç → **New Project →
   Deploy from GitHub repo** → bu repo.
2. 🧑 **Settings → Networking → Generate Domain** (bu yapılmazsa
   `RAILWAY_PUBLIC_DOMAIN` tanımlanmaz ve webhook `localhost`'a kaydolur).
3. 🧑 **Variables** sekmesine şunları girin (`PORT` ve `PUBLIC_BASE_URL` HARİÇ —
   ikisi de otomatik):
   ```
   NODE_ENV=production
   LLM_MOCK=false
   ANTHROPIC_API_KEY=<.env'deki değer>
   DB_DRIVER=supabase
   SUPABASE_URL=<.env'deki değer>
   SUPABASE_SERVICE_ROLE_KEY=<ROTASYON SONRASI yeni sb_secret_...>
   PII_MASTER_KEY=<.env'deki değer — vault bu anahtarla şifrelendi, DEĞİŞTİRMEYİN>
   TELEGRAM_MODE=webhook
   TELEGRAM_BOT_TOKEN=<.env'deki değer>
   TELEGRAM_WEBHOOK_SECRET=<.env'deki değer>
   OCR_PROVIDER=claude-vision
   DATA_RETENTION_DAYS=30
   DELETION_CRON=0 3 * * *
   ```
   ⚠️ `PII_MASTER_KEY` mevcut değerle AYNI olmalı — vault'taki 48 kayıt onunla
   şifreli (D-035). Farklı bir değer girmek onları okunamaz yapar.
   ⚠️ Supabase anahtarını **§3b rotasyonundan SONRA** girin, yoksa sızmış
   anahtarı üretime taşımış olursunuz.
4. 🤖 Deploy sonrası doğrulama:
   ```bash
   railway run npm run check:deploy      # platformdaki gerçek değişkenlerle
   curl -s https://<domain>/health       # {"status":"ok","uptime":N}
   curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```
5. 🧑 Bota Telegram'dan bir mektup gönderip uçtan uca akışı canlı ortamda teyit edin.

**Ölçekleme sınırı:** `railway.json` `numReplicas: 1` sabitler — cron süreç
içinde çalışıyor, ikinci replika hatırlatmaları çift gönderir
(bkz. docs/DEPLOYMENT.md §8b). Bu değeri artırmayın.

Ayrıntılı rehber: `docs/DEPLOYMENT.md` §2.
