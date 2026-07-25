# MANUAL_ACTIONS_REQUIRED.md — Yalnızca İnsanın Yapabileceği Eylemler

> Bu dosya boşsa proje tamamen otonom ilerliyor demektir. Aşağıdaki maddeler kodun
> çalışmasını **engellemez** (hepsi mock/stub arkasında geliştirildi); yalnızca gerçek
> dağıtım/canlı kullanım için gereklidir. Mimari, her biri tek `.env` değişikliğiyle
> gerçek anahtara geçecek şekilde kuruldu.

## 1. Anthropic API anahtarı
- **Neden:** Claude vision/analiz çağrıları.
- **Aksiyon:** console.anthropic.com'dan API key al → `.env` içinde `ANTHROPIC_API_KEY=...`
- **O ana kadar:** `LLM_MOCK=true` ile deterministik mock yanıtlar kullanılıyor.

## 2. Telegram Bot Token
- **Neden:** Gerçek Telegram botu.
- **Aksiyon:** @BotFather'dan token al → `.env` içinde `TELEGRAM_BOT_TOKEN=...`
- **O ana kadar:** Bot polling/webhook devre dışı; kanal mantığı `MockChannelAdapter` + testlerle doğrulanıyor.

## 3. Supabase projesi (AB bölgesi)
- **Neden:** Postgres DB + storage (GDPR için EU region).
- **Aksiyon:** supabase.com'da EU projesi aç → `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` → `.env`; `supabase/migrations/0001_init.sql`'i uygula.
- **O ana kadar:** `DB_DRIVER=memory` in-memory repository ile çalışıyor.

## 4. PII Vault master key (üretim)
- **Neden:** PII vault AES-256-GCM şifreleme anahtarı.
- **Aksiyon:** `openssl rand -hex 32` → `.env` içinde `PII_MASTER_KEY=...` (üretimde KMS önerilir).
- **O ana kadar:** Dev için sabit test anahtarı türetiliyor (üretimde ASLA kullanılmaz — uyarı loglanır).

## 5. WhatsApp Business API (opsiyonel, v2)
- **Neden:** WhatsApp kanalı.
- **Aksiyon:** Meta Business doğrulama + telefon no + `WHATSAPP_TOKEN`.
- **O ana kadar:** `MockChannelAdapter`; kapsam v1'de Telegram.

## 6. Sistem git düzeltmesi (opsiyonel, geliştirme rahatlığı)
- **Neden:** `/usr/bin/git` bozuk Xcode'a bağlı.
- **Aksiyon:** `sudo xcode-select --switch /Library/Developer/CommandLineTools`
- **O ana kadar:** CLT git tam yol ile kullanılıyor (bkz. DECISIONS D-001).

## 7. Deployment hosting hesabı (teslim aşaması)
- **Neden:** Railway/Coolify canlı dağıtım.
- **Aksiyon:** Hesap + repo bağla + env değişkenlerini gir.
- **O ana kadar:** Dockerfile + docker-compose ile lokal çalışır.
