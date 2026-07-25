#!/usr/bin/env bash
# ============================================================================
# apply-migrations.sh — supabase/migrations/*.sql dosyalarını psql ile uygular
#
# NOT: Bu script ham Postgres bağlantısı (DATABASE_URL) üzerinden çalışır.
# Üretimde uygulama Supabase'e supabase-js (REST/PostgREST) üzerinden bağlanır
# (bkz. .env SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY); ŞEMA MİGRASYONU ise
# doğrudan Postgres bağlantısı gerektirir — Supabase projenizin "Connection
# string" (Settings → Database) değerini DATABASE_URL olarak kullanın.
# Yerel `docker compose --profile local-db up` ile açılan postgres servisi için:
#   DATABASE_URL=postgresql://bueko:bueko_dev_only@localhost:5432/bueko
#
# Kullanım:
#   DATABASE_URL=postgresql://... scripts/apply-migrations.sh
#   scripts/apply-migrations.sh postgresql://...   (argüman da kabul edilir)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"

DATABASE_URL="${1:-${DATABASE_URL:-}}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "HATA: DATABASE_URL ayarlanmamış." >&2
  echo "Kullanım: DATABASE_URL=postgresql://kullanici:sifre@host:5432/veritabani $0" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "HATA: 'psql' bulunamadı. Postgres client kurun (örn. 'brew install libpq' + PATH'e ekleyin)." >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "HATA: Migration dizini yok: $MIGRATIONS_DIR" >&2
  exit 1
fi

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "UYARI: $MIGRATIONS_DIR içinde .sql dosyası bulunamadı, yapılacak bir şey yok."
  exit 0
fi

# Dosya adına göre sırala (0001_, 0002_, ... sıralı numaralandırma varsayımı).
IFS=$'\n' migrations=($(sort <<<"${migrations[*]}"))
unset IFS

echo "== BüKo migration uygulama =="
echo "Hedef: ${DATABASE_URL%%@*}@<gizli>"
echo "Bulunan dosya sayısı: ${#migrations[@]}"

for file in "${migrations[@]}"; do
  echo ""
  echo "-> Uygulanıyor: $(basename "$file")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
  echo "   OK: $(basename "$file")"
done

echo ""
echo "== Tüm migration'lar başarıyla uygulandı =="
