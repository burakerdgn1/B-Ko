/**
 * Supabase bağlantı ve şema denetimi.
 *
 * Kullanım:  npx ts-node -T scripts/check-supabase.ts
 *            (değerleri `.env`'den okur)
 *
 * Ne yapar:
 *   1. Projenin ayakta olduğunu doğrular (auth health)
 *   2. Verilen anahtarın TÜRÜNÜ belirler (publishable/anon vs secret/service-role)
 *   3. Şemanın uygulanıp uygulanmadığını tablo tablo kontrol eder
 *   4. Backend'in bu yapılandırmayla çalışıp çalışamayacağını söyler
 *
 * Hiçbir yazma işlemi YAPMAZ; salt-okunur bir teşhis aracıdır.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

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

interface Probe {
  status: number | string;
  body: string;
}

async function probe(
  url: string,
  key: string,
  path: string,
  withAuth = true,
): Promise<Probe> {
  const headers: Record<string, string> = { apikey: key };
  if (withAuth) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await fetch(url + path, { headers });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (error) {
    return {
      status: 'ERR',
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;

  console.log('\n═══════ SUPABASE BAĞLANTI DENETİMİ ═══════\n');

  if (!url) {
    console.error('✗ SUPABASE_URL tanımsız (.env)');
    process.exit(1);
  }
  if (!key) {
    console.error('✗ Hiçbir Supabase anahtarı tanımlı değil (.env)');
    process.exit(1);
  }

  console.log(`  Proje URL : ${url}`);
  console.log(
    `  Anahtar   : ${serviceKey ? 'SERVICE_ROLE (gizli)' : 'ANON/PUBLISHABLE (herkese açık)'}`,
  );

  // 1. Proje ayakta mı?
  const health = await probe(url, key, '/auth/v1/health', false);
  console.log(
    `\n  1) Proje erişilebilirliği : ${health.status === 200 ? '✓ AYAKTA' : `✗ ${health.status}`}`,
  );

  // 2. Anahtar türü — /rest/v1/ kökü yalnızca secret anahtar kabul eder.
  const root = await probe(url, key, '/rest/v1/');
  const isSecret = root.status === 200;
  console.log(
    `  2) Anahtar türü doğrulama : ${
      isSecret
        ? '✓ SECRET (backend için uygun)'
        : '⚠ PUBLISHABLE — backend için YETERSİZ'
    }`,
  );
  if (!isSecret) {
    console.log(`     └ sunucu yanıtı: ${root.body.replace(/\s+/g, ' ')}`);
  }

  // 3. Şema uygulanmış mı?
  console.log('\n  3) Şema kontrolü:');
  let present = 0;
  let missing = 0;
  for (const table of TABLES) {
    const r = await probe(url, key, `/rest/v1/${table}?select=*&limit=1`);
    const notFound = r.status === 404 || r.body.includes('PGRST205');
    const denied = r.status === 401 || r.status === 403;

    if (notFound) {
      missing++;
      console.log(`     ✗ ${table.padEnd(20)} YOK (migration uygulanmamış)`);
    } else if (denied) {
      present++;
      console.log(`     ⚠ ${table.padEnd(20)} var ama ERİŞİM ENGELLİ (RLS)`);
    } else {
      present++;
      console.log(`     ✓ ${table.padEnd(20)} erişilebilir`);
    }
  }

  // 4. Sonuç
  console.log('\n  ── SONUÇ ──');
  if (missing === TABLES.length) {
    console.log('  ✗ Şema UYGULANMAMIŞ. `supabase/migrations/` çalıştırılmalı.');
  } else if (missing > 0) {
    console.log(`  ⚠ ${present}/${TABLES.length} tablo var — şema EKSİK.`);
  } else {
    console.log(`  ✓ ${TABLES.length}/${TABLES.length} tablo mevcut.`);
  }

  const ready = isSecret && missing === 0;
  console.log(
    `  ${ready ? '✓' : '✗'} Backend DB_DRIVER=supabase ile ${
      ready ? 'ÇALIŞABİLİR' : 'ÇALIŞAMAZ'
    }`,
  );
  if (!isSecret) {
    console.log(
      '     └ Gerekli: SUPABASE_SERVICE_ROLE_KEY (Dashboard → Settings → API)',
    );
  }
  if (missing > 0) {
    console.log('     └ Gerekli: migration uygulanmalı (MANUAL_ACTIONS §3)');
  }
  console.log('\n═══════════════════════════════════════════\n');
}

void main();
