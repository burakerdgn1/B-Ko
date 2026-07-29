/**
 * Dağıtım öncesi GO / NO-GO kontrolü.
 *
 * `scripts/check-env.sh`'den FARKI: o script bir `.env` DOSYASINI okur ve
 * `env.schema.ts` kurallarını bash'te tekrarlar (kopyalanmış kural = kayma
 * riski). Bu script ise:
 *   1. Gerçek `validateEnv()`'i çağırır — kural tek yerde kalır, kopya yok.
 *   2. Süreç ORTAMINI okur (dosyayı değil), dolayısıyla platformun üzerinde de
 *      koşturulabilir: `railway run npm run check:deploy` gerçekten dağıtılmış
 *      değişken setini denetler.
 *   3. Şemanın göremediği DAĞITIMA ÖZGÜ tuzakları kontrol eder (aşağıda).
 *
 * `live:check`'ten FARKI: bu script TOKEN HARCAMAZ. Anthropic yalnızca
 * `/v1/models` ile (ücretsiz) yoklanır, Claude'a hiçbir mesaj gönderilmez.
 *
 * Kullanım:
 *   npm run check:deploy                 # yereldeki `.env` ile
 *   railway run npm run check:deploy     # Railway'deki gerçek değişkenlerle
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { validateEnv } from '../src/config/env.schema';

const TABLES = [
  'users',
  'documents',
  'analyses',
  'drafts',
  'reminders',
  'pii_vault',
  'audit_log',
  'appointment_watches',
];

let errors = 0;
let warnings = 0;

function ok(msg: string, detail = ''): void {
  console.log(`  ✓ ${msg}${detail ? ` — ${detail}` : ''}`);
}
function fail(msg: string, detail = ''): void {
  console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`);
  errors++;
}
function warn(msg: string, detail = ''): void {
  console.log(`  ⚠ ${msg}${detail ? ` — ${detail}` : ''}`);
  warnings++;
}

/**
 * Şema kapısı: uygulama `NODE_ENV=production` ile GERÇEKTEN açılır mıydı?
 *
 * `NODE_ENV` burada zorla `production` yapılıyor — amaç yereldeki geliştirme
 * ayarlarını değil, dağıtımda ne olacağını ölçmek.
 */
function checkSchema(): void {
  console.log('\n  ── 1) Şema kapısı (NODE_ENV=production ile) ──');
  try {
    validateEnv({ ...process.env, NODE_ENV: 'production' });
    ok('uygulama üretim modunda AÇILIRDI', 'env.schema.ts superRefine geçti');
  } catch (error) {
    fail('uygulama üretim modunda AÇILMAZDI');
    for (const line of (error instanceof Error ? error.message : String(error)).split('\n').slice(1)) {
      console.log(`      ${line.trim()}`);
    }
  }
}

/**
 * Şemanın YAKALAYAMADIĞI dağıtım tuzakları.
 * Hepsi "teknik olarak geçerli konfig ama sahada bot ölür" kategorisinde.
 */
function checkDeploymentTraps(): void {
  console.log('\n  ── 2) Dağıtıma özgü tuzaklar ──');

  // (a) PUBLIC_BASE_URL — webhook adresinin TEMELİ. localhost ile dağıtıma
  //     çıkmak, Telegram'ın asla ulaşamayacağı bir adrese webhook kaydetmek
  //     demektir: bot sessizce hiçbir mesaj almaz.
  const base = process.env.PUBLIC_BASE_URL?.trim();
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const effectiveBase = base || (railwayDomain ? `https://${railwayDomain}` : undefined);

  if (!effectiveBase) {
    warn('PUBLIC_BASE_URL yok', 'varsayılan http://localhost:3000 kullanılır');
  } else if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(effectiveBase)) {
    fail('PUBLIC_BASE_URL yerel bir adres', `${effectiveBase} — Telegram buraya ULAŞAMAZ`);
  } else if (!effectiveBase.startsWith('https://')) {
    fail('PUBLIC_BASE_URL https değil', `${effectiveBase} — Telegram webhook https ZORUNLU kılar`);
  } else {
    ok(
      'PUBLIC_BASE_URL dış dünyadan erişilebilir görünüyor',
      base ? effectiveBase : `${effectiveBase} (RAILWAY_PUBLIC_DOMAIN'den türetildi)`,
    );
  }

  // (b) webhook modu + sır. Sır YOKSA endpoint fail-closed davranır ve HER
  //     update'i 401 ile reddeder (D-030) — yani bot tamamen sağır olur.
  //     Bu, "her şey yeşil görünüyor ama bot cevap vermiyor" vakasının
  //     en olası sebebidir.
  const mode = process.env.TELEGRAM_MODE?.trim() || 'disabled';
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  if (mode === 'webhook') {
    if (!secret) {
      fail(
        'TELEGRAM_MODE=webhook ama TELEGRAM_WEBHOOK_SECRET yok',
        'endpoint fail-closed: TÜM update\'ler 401 ile reddedilir (D-030)',
      );
    } else if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
      fail(
        'TELEGRAM_WEBHOOK_SECRET Telegram\'ın kabul ettiği biçimde değil',
        'yalnızca A-Z a-z 0-9 _ - ve 1..256 karakter (setWebhook reddeder)',
      );
    } else {
      ok('webhook sırrı tanımlı ve geçerli biçimde', `${secret.length} karakter`);
    }
    if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
      fail('TELEGRAM_BOT_TOKEN yok', 'webhook modunda bot hiç kaydolamaz');
    } else {
      ok('TELEGRAM_BOT_TOKEN tanımlı');
    }
  } else if (mode === 'polling') {
    warn(
      'TELEGRAM_MODE=polling',
      'dağıtımda webhook önerilir (polling tek replika varsayar ve yeniden başlatmalarda update kaybedebilir)',
    );
  } else {
    warn('TELEGRAM_MODE=disabled', 'bot dağıtımda CEVAP VERMEZ — bilinçliyse sorun yok');
  }

  // (c) OCR sağlayıcısı — ilan edilmiş gizlilik ödünü (D-010).
  if ((process.env.OCR_PROVIDER?.trim() || 'claude-vision') === 'claude-vision') {
    warn(
      'OCR_PROVIDER=claude-vision',
      'mektup GÖRSELİ ham PII ile sağlayıcıya gider (D-010 — ilan edilmiş istisna). Sıfır sızıntı için: local',
    );
  } else {
    ok('OCR_PROVIDER=local', 'ham görsel dışarı çıkmaz');
  }
}

/** Supabase: anahtar türü + şema erişimi (yazma denemesi YAPILMAZ). */
async function checkSupabase(): Promise<void> {
  console.log('\n  ── 3) Supabase ──');
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    fail('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik');
    return;
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    // `/rest/v1/` kökü yalnızca SECRET anahtarla 200 döner — publishable
    // anahtarı yanlışlıkla yapıştırmak en olası insan hatası.
    const root = await fetch(`${url}/rest/v1/`, { headers });
    if (root.status === 200) ok('anahtar SECRET türünde (service-role)');
    else {
      fail('anahtar SECRET değil', `HTTP ${root.status} — backend repository'leri çalışmaz`);
      return;
    }

    let reachable = 0;
    for (const table of TABLES) {
      const r = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, { headers });
      if (r.status === 200) reachable++;
    }
    if (reachable === TABLES.length) ok(`şema tam`, `${reachable}/${TABLES.length} tablo`);
    else fail('şema eksik', `${reachable}/${TABLES.length} tablo — migration uygulanmamış olabilir`);
  } catch (error) {
    fail('Supabase\'e ulaşılamadı', error instanceof Error ? error.message : String(error));
  }
}

/** Anthropic: anahtar geçerli mi? `/v1/models` ücretsizdir, token harcamaz. */
async function checkAnthropic(): Promise<void> {
  console.log('\n  ── 4) Anthropic ──');
  const key = process.env.ANTHROPIC_API_KEY?.trim();

  if (!key) {
    fail('ANTHROPIC_API_KEY yok', 'üretimde zorunlu (LLM_MOCK=true kabul edilmez)');
    return;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (res.status === 200) {
      ok('API anahtarı geçerli', 'token harcanmadı (/v1/models)');

      // İstenen modelin gerçekten listede olduğunu doğrula — model kimliği
      // yanlışsa ilk gerçek çağrıya kadar fark edilmez.
      const wanted = process.env.LLM_MODEL?.trim() || 'claude-sonnet-5';
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data ?? []).map((m) => m.id).filter(Boolean) as string[];
      if (ids.some((id) => id === wanted || id.startsWith(wanted))) {
        ok(`LLM_MODEL erişilebilir`, wanted);
      } else {
        warn(
          `LLM_MODEL "${wanted}" model listesinde bulunamadı`,
          'takma ad (alias) olabilir; değilse ilk çağrıda 404 alırsınız',
        );
      }
    } else {
      fail('API anahtarı reddedildi', `HTTP ${res.status}`);
    }
  } catch (error) {
    fail('Anthropic\'e ulaşılamadı', error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  console.log('\n═══════ DAĞITIM ÖNCESİ GO / NO-GO ═══════');
  console.log('  (token harcamaz — yalnızca ücretsiz uç noktalar yoklanır)');

  checkSchema();
  checkDeploymentTraps();
  await checkSupabase();
  await checkAnthropic();

  console.log('\n  ── SONUÇ ──');
  console.log(`  ${errors} hata, ${warnings} uyarı`);
  if (errors > 0) {
    console.log('  ⛔ NO-GO — yukarıdaki hatalar dağıtımı bozar.');
  } else if (warnings > 0) {
    console.log('  ✅ GO — uyarıları bilinçli kabul ettiyseniz dağıtabilirsiniz.');
  } else {
    console.log('  ✅ GO');
  }
  console.log('\n═══════════════════════════════════════════\n');
  process.exit(errors > 0 ? 1 : 0);
}

void main();
