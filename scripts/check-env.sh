#!/usr/bin/env bash
# ============================================================================
# check-env.sh — Dağıtım öncesi .env kontrolü
#
# Amaç: src/config/env.schema.ts içindeki doğrulama kurallarının bir "erken
# uyarı" kopyasını komut satırında sunmak. Uygulama zaten fail-fast doğrulama
# yapıyor (Zod), ama bu script gerçek başlatmadan ÖNCE, insan-okunur bir
# özetle eksikleri göstermek için var (özellikle üretim öncesi kontrol listesi
# — bkz. docs/DEPLOYMENT.md).
#
# Kullanım:
#   scripts/check-env.sh                # ./.env dosyasını kontrol eder
#   scripts/check-env.sh path/to/.env    # belirtilen dosyayı kontrol eder
#   ENV_FILE=.env.production scripts/check-env.sh
# ============================================================================
set -euo pipefail

ENV_FILE="${1:-${ENV_FILE:-.env}}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "HATA: '$ENV_FILE' bulunamadı. Önce 'cp .env.example $ENV_FILE' çalıştırıp değerleri doldurun." >&2
  exit 1
fi

# .env dosyasını mevcut shell ortamını bozmadan oku (subshell + export).
get_val() {
  local key="$1"
  # Yorum satırlarını ve boş satırları atla; ilk eşleşen KEY=değer satırını al.
  grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d'=' -f2- || true
}

warnings=0
errors=0

warn() {
  echo "  UYARI: $1"
  warnings=$((warnings + 1))
}

fail() {
  echo "  HATA:  $1"
  errors=$((errors + 1))
}

echo "== BüKo .env kontrolü ($ENV_FILE) =="

NODE_ENV_VAL="$(get_val NODE_ENV)"
NODE_ENV_VAL="${NODE_ENV_VAL:-development}"
echo "NODE_ENV = ${NODE_ENV_VAL:-<boş>}"

# ── Her ortamda zorunlu olan temel değişkenler (.env.example ile tutarlı) ──
base_required=(PORT PUBLIC_BASE_URL LLM_MOCK OCR_PROVIDER TELEGRAM_MODE DB_DRIVER DATA_RETENTION_DAYS DELETION_CRON)
for key in "${base_required[@]}"; do
  val="$(get_val "$key")"
  if [[ -z "$val" ]]; then
    warn "$key ayarlanmamış (schema varsayılanı kullanılacak, bkz. .env.example)."
  fi
done

# ── env.schema.ts'in superRefine bloğu: NODE_ENV=production'da mock/dev
#    kaçış yolları kapatılır. Bu script aynı kuralları burada tekrarlar. ──
if [[ "$NODE_ENV_VAL" == "production" ]]; then
  echo "-- Üretim modu tespit edildi, sıkı kontroller uygulanıyor --"

  llm_mock="$(get_val LLM_MOCK)"
  if [[ "$llm_mock" == "true" || "$llm_mock" == "1" || -z "$llm_mock" ]]; then
    fail "LLM_MOCK=false olmalı (üretimde mock LLM yanıtı YASAK — env.schema.ts bunu reddeder)."
  fi

  anthropic_key="$(get_val ANTHROPIC_API_KEY)"
  if [[ -z "$anthropic_key" ]]; then
    fail "ANTHROPIC_API_KEY zorunlu (üretimde boş bırakılamaz)."
  fi

  pii_key="$(get_val PII_MASTER_KEY)"
  if [[ -z "$pii_key" ]]; then
    fail "PII_MASTER_KEY zorunlu (üretimde dev-türetilmiş anahtar ASLA kullanılmaz). 'openssl rand -hex 32' ile üretin."
  elif ! [[ "$pii_key" =~ ^[0-9a-fA-F]{64}$ ]]; then
    fail "PII_MASTER_KEY 64 hex karakter olmalı (32 byte). Mevcut değer bu formatta değil."
  fi

  db_driver="$(get_val DB_DRIVER)"
  if [[ "$db_driver" != "supabase" ]]; then
    fail "DB_DRIVER=supabase olmalı (üretimde 'memory' sürücüsü reddedilir)."
  else
    supabase_url="$(get_val SUPABASE_URL)"
    supabase_key="$(get_val SUPABASE_SERVICE_ROLE_KEY)"
    [[ -z "$supabase_url" ]] && fail "DB_DRIVER=supabase için SUPABASE_URL zorunlu."
    [[ -z "$supabase_key" ]] && warn "SUPABASE_SERVICE_ROLE_KEY boş — repository çağrıları başarısız olur."
  fi

  telegram_token="$(get_val TELEGRAM_BOT_TOKEN)"
  telegram_mode="$(get_val TELEGRAM_MODE)"
  if [[ "$telegram_mode" != "disabled" && -z "$telegram_token" ]]; then
    warn "TELEGRAM_MODE='$telegram_mode' ama TELEGRAM_BOT_TOKEN boş — bot devre dışı kalır."
  fi
else
  echo "-- Üretim dışı ortam: mock modlar kabul edilir (LLM_MOCK=true, DB_DRIVER=memory vb.) --"
fi

echo ""
echo "== Özet: $errors hata, $warnings uyarı =="

if [[ "$errors" -gt 0 ]]; then
  echo "SONUÇ: BAŞARISIZ — üretime almadan önce yukarıdaki hataları düzeltin."
  exit 1
fi

echo "SONUÇ: OK"
