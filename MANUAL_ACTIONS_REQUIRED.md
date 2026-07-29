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

## 3b. 🔴 AÇIK — `sb_secret_...` anahtar rotasyonu (tek kalan güvenlik borcu)

**Neden:** Mevcut `sb_secret_...` anahtarı sohbet geçmişinde göründü. Bu anahtar
RLS'i **bypass eder** ve `pii_vault` dâhil tüm tablolara tam yetki verir. Gerçek
kullanıcı verisiyle çalışmaya başlamadan önce döndürülmeli.

**Araç hazır:** `npm run rotate:supabase-key` (fail-safe; yeni anahtar tam olarak
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

## 8. Deployment hosting hesabı (teslim aşaması)
- **Neden:** Railway/Coolify canlı dağıtım.
- **Aksiyon:** Hesap + repo bağla + env değişkenlerini gir.
- **O ana kadar:** Dockerfile + docker-compose ile lokal çalışır.
