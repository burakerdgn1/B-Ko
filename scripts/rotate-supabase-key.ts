/**
 * Supabase `sb_secret_...` (service-role) anahtar rotasyonu — fail-safe.
 *
 * NEDEN: Mevcut secret anahtar sohbet geçmişinde göründü. Bu anahtar RLS'i
 * BYPASS eder ve `pii_vault` dâhil tüm tablolara tam yetki verir; gerçek
 * kullanıcı verisiyle çalışmadan önce döndürülmelidir (TODO "Güvenlik borcu").
 *
 * PII anahtarından FARKI: bu anahtar veri şifrelemez, yalnızca kimlik doğrular.
 * Yani veri kaybı riski YOK — risk, hatalı bir anahtarla `.env`'i bozup
 * uygulamayı çalışamaz hâle getirmektir. Bu yüzden sıralama tersine çevrildi:
 * ÖNCE yeni anahtar tam olarak doğrulanır, SONRA `.env` yazılır.
 *
 * Supabase'in yeni anahtar modelinde iki secret anahtar aynı anda canlı
 * olabilir; doğru sıra şudur:
 *
 *   1. Dashboard → Project Settings → API Keys → "Create new secret key"
 *      (eskisini HENÜZ silmeyin — kesintisiz geçiş için ikisi de canlı kalsın)
 *   2. SUPABASE_KEY_NEW=sb_secret_... npm run rotate:supabase-key
 *        → kuru koşum: yeni anahtarı doğrular, hiçbir şey yazmaz
 *   3. SUPABASE_KEY_NEW=sb_secret_... npm run rotate:supabase-key -- --apply
 *        → `.env` atomik olarak güncellenir
 *   4. Dashboard'dan ESKİ anahtarı silin ("Revoke")
 *   5. SUPABASE_KEY_OLD=<eski> npm run rotate:supabase-key -- --check-revoked
 *        → eski anahtarın gerçekten öldüğünü (401) bağımsız kanıtlar
 *
 * GÜVENLİK NOTLARI:
 *   - `.env` yedeği YAZILMAZ. Bir `.env.bak` dosyası, canlı bir secret'ın diskte
 *     ikinci bir kopyası demektir; rotasyonun amacı tam olarak bunu azaltmaktır.
 *     Bunun yerine geçici dosya + `rename()` ile atomik yazma kullanılır.
 *   - Anahtarlar hiçbir zaman tam olarak loglanmaz; yalnızca önek + uzunluk.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

// Varsayılan hedef proje kökündeki `.env`. `ROTATE_ENV_PATH` ile
// değiştirilebilir — böylece yazma yolu gerçek `.env`'e dokunmadan
// (geçici bir kopya üzerinde) test edilebilir.
const ENV_PATH = process.env.ROTATE_ENV_PATH
  ? resolve(process.env.ROTATE_ENV_PATH)
  : resolve(__dirname, '..', '.env');
const ENV_VAR = 'SUPABASE_SERVICE_ROLE_KEY';

const TABLES = [
  'users',
  'documents',
  'analyses',
  'drafts',
  'reminders',
  'pii_vault',
  'audit_log',
  'appointment_watches',
] as const;

/** Anahtarı loglanabilir hâle getirir — tam değer ASLA yazdırılmaz. */
function fingerprint(key: string): string {
  return `${key.slice(0, 13)}…${key.slice(-4)} (${key.length} ch)`;
}

interface Probe {
  status: number | string;
  body: string;
}

async function probe(
  url: string,
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<Probe> {
  try {
    const res = await fetch(url + path, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (error) {
    return {
      status: 'ERR',
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Yeni anahtarın gerçekten çalıştığını kanıtlar.
 * Salt-okunur kontroller YETMEZ: secret anahtar hem okuma hem yazma yetkisi
 * gerektirir, bu yüzden gerçek bir yazma round-trip'i de yapılır (ve temizlenir).
 */
async function verifyKey(url: string, key: string): Promise<boolean> {
  let ok = true;

  // 1) Proje ayakta mı?
  const health = await probe(url, key, '/auth/v1/health');
  const up = health.status === 200;
  console.log(`  1) proje erişilebilirliği : ${up ? '✓ AYAKTA' : `✗ ${health.status}`}`);
  if (!up) ok = false;

  // 2) Anahtar TÜRÜ — `/rest/v1/` kökü yalnızca secret anahtarla 200 döner.
  //    publishable/anon anahtar buraya erişemez; yanlış anahtarı yapıştırmak
  //    en olası hata olduğu için bu kontrol kritik.
  const root = await probe(url, key, '/rest/v1/');
  const isSecret = root.status === 200;
  console.log(
    `  2) anahtar türü           : ${
      isSecret ? '✓ SECRET (service-role)' : '✗ SECRET DEĞİL — backend için yetersiz'
    }`,
  );
  if (!isSecret) {
    console.log(`     └ sunucu: ${root.body.replace(/\s+/g, ' ')}`);
    ok = false;
  }

  // 3) Şemanın tamamı erişilebilir mi?
  let reachable = 0;
  for (const table of TABLES) {
    const r = await probe(url, key, `/rest/v1/${table}?select=id&limit=1`);
    if (r.status === 200) reachable++;
    else console.log(`     ✗ ${table}: ${r.status} ${r.body.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  console.log(
    `  3) tablo erişimi          : ${reachable === TABLES.length ? '✓' : '✗'} ${reachable}/${TABLES.length}`,
  );
  if (reachable !== TABLES.length) ok = false;

  // 4) YAZMA round-trip'i — insert → read-back → delete.
  //    Sentetik, açıkça işaretli bir kayıt kullanılır ve her hâlükârda silinir.
  const marker = `rotation-probe-${process.pid}-${process.hrtime.bigint()}`;
  const insert = await probe(url, key, '/rest/v1/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ channel: 'telegram', channel_user_id: marker, locale: 'de' }),
  });
  const created = insert.status === 201;

  // Geri okuma marker ÜZERİNDEN doğrulanır (insert gövdesi üzerinden değil):
  // `probe` yanıt gövdesini 300 karaktere kırpar, dolayısıyla insert yanıtının
  // JSON'u güvenilir biçimde parse edilemez.
  const readBack = created
    ? await probe(
        url,
        key,
        `/rest/v1/users?channel_user_id=eq.${encodeURIComponent(marker)}&select=channel_user_id`,
      )
    : { status: 'ATLANDI', body: '' };
  const readOk = readBack.status === 200 && readBack.body.includes(marker);

  // Temizlik: insert başarılı olduysa HER DURUMDA silinir.
  let cleaned = true;
  if (created) {
    const del = await probe(url, key, `/rest/v1/users?channel_user_id=eq.${marker}`, {
      method: 'DELETE',
    });
    cleaned = del.status === 200 || del.status === 204;
  }

  console.log(
    `  4) yazma round-trip       : ${created && readOk ? '✓' : '✗'} insert=${insert.status} read=${
      readBack.status
    } temizlik=${cleaned ? '✓' : '✗ ELLE SİLİN: ' + marker}`,
  );
  if (!created || !readOk || !cleaned) {
    if (!created) console.log(`     └ sunucu: ${insert.body.replace(/\s+/g, ' ')}`);
    ok = false;
  }

  return ok;
}

/**
 * `.env` içindeki tek satırı atomik olarak değiştirir.
 * Dosyanın geri kalanı (yorumlar, sıralama, diğer anahtarlar) BİREBİR korunur.
 */
function writeEnv(newKey: string): void {
  const original = readFileSync(ENV_PATH, 'utf8');
  const lines = original.split('\n');
  let replaced = 0;

  const next = lines
    .map((line) => {
      if (new RegExp(`^\\s*${ENV_VAR}\\s*=`).test(line)) {
        replaced++;
        return `${ENV_VAR}=${newKey}`;
      }
      return line;
    })
    .join('\n');

  if (replaced !== 1) {
    throw new Error(
      `.env içinde ${ENV_VAR} satırı ${replaced} kez bulundu (1 bekleniyordu) — yazma iptal edildi.`,
    );
  }

  // Atomik: geçici dosyaya yaz → rename. Yarım yazılmış bir `.env` bırakmaz.
  const tmp = `${ENV_PATH}.tmp`;
  try {
    writeFileSync(tmp, next, { mode: 0o600 });
    renameSync(tmp, ENV_PATH);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* geçici dosya zaten yoksa sorun değil */
    }
    throw error;
  }
}

/** Eski anahtarın gerçekten iptal edildiğini kanıtlar (401 beklenir). */
async function checkRevoked(url: string, oldKey: string): Promise<void> {
  console.log('\n═══════ ESKİ ANAHTAR İPTAL DENETİMİ ═══════\n');
  console.log(`  Anahtar : ${fingerprint(oldKey)}\n`);

  const r = await probe(url, oldKey, '/rest/v1/users?select=id&limit=1');
  const dead = r.status === 401 || r.status === 403;

  if (dead) {
    console.log(`  ✓ İPTAL EDİLMİŞ — HTTP ${r.status}`);
    console.log(`    └ sunucu: ${r.body.replace(/\s+/g, ' ').slice(0, 160)}`);
    console.log('\n  ✓ Rotasyon TAMAMLANDI. Güvenlik borcu kapandı.\n');
  } else {
    console.log(`  ✗ HÂLÂ CANLI — HTTP ${r.status}`);
    console.log('\n  ⚠ ROTASYON TAMAMLANMADI. Eski anahtar hâlâ tüm tablolara');
    console.log('    tam yetkiyle erişebiliyor. Dashboard → Project Settings →');
    console.log('    API Keys → eski secret key → Revoke.\n');
    process.exitCode = 1;
  }
  console.log('═══════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const revokeCheck = process.argv.includes('--check-revoked');
  const url = process.env.SUPABASE_URL?.trim();

  if (!url) {
    console.error('✗ SUPABASE_URL tanımsız (.env)');
    process.exit(1);
  }

  if (revokeCheck) {
    const oldKey = process.env.SUPABASE_KEY_OLD?.trim();
    if (!oldKey) {
      console.error('✗ SUPABASE_KEY_OLD gerekli (iptal edildiği doğrulanacak anahtar).');
      process.exit(1);
    }
    await checkRevoked(url, oldKey);
    return;
  }

  const newKey = process.env.SUPABASE_KEY_NEW?.trim();
  const currentKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  console.log('\n═══════ SUPABASE SECRET ANAHTAR ROTASYONU ═══════\n');
  console.log(`  Mod     : ${apply ? 'UYGULA (.env yazılacak)' : 'KURU KOŞUM (yazmaz)'}`);
  console.log(`  Proje   : ${url}`);

  if (!newKey) {
    console.error('\n✗ SUPABASE_KEY_NEW tanımsız.');
    console.error('  Dashboard → Project Settings → API Keys → "Create new secret key"');
    console.error('  Sonra: SUPABASE_KEY_NEW=sb_secret_... npm run rotate:supabase-key');
    process.exit(1);
  }
  if (!newKey.startsWith('sb_secret_')) {
    console.error(`\n✗ Yeni anahtar "sb_secret_" ile başlamıyor (${fingerprint(newKey)}).`);
    console.error('  Legacy JWT (`eyJ...`) anahtarları bu projede İPTAL edildi;');
    console.error('  publishable (`sb_publishable_...`) anahtar backend için yetersizdir.');
    process.exit(1);
  }
  if (currentKey && newKey === currentKey) {
    console.error('\n✗ Yeni anahtar `.env`\'dekiyle AYNI — rotasyon anlamsız.');
    process.exit(1);
  }

  console.log(`  Mevcut  : ${currentKey ? fingerprint(currentKey) : '(tanımsız)'}`);
  console.log(`  Yeni    : ${fingerprint(newKey)}\n`);

  // ── FAZ 1: yeni anahtarı DOĞRULA (yazmadan önce) ──
  console.log('  ── Faz 1: yeni anahtar doğrulama ──');
  const valid = await verifyKey(url, newKey);

  if (!valid) {
    console.error('\n  ✗ İPTAL — yeni anahtar doğrulanamadı. `.env` DEĞİŞTİRİLMEDİ.');
    console.log('\n═══════════════════════════════════════════\n');
    process.exit(1);
  }
  console.log('\n  ✓ Yeni anahtar tam yetkiyle çalışıyor.');

  if (!apply) {
    console.log('\n  KURU KOŞUM — `.env` değiştirilmedi.');
    console.log('  Uygulamak için: --apply ekleyin.');
    console.log('\n═══════════════════════════════════════════\n');
    return;
  }

  // ── FAZ 2: `.env` yaz (atomik) ──
  console.log('\n  ── Faz 2: `.env` yazma ──');
  writeEnv(newKey);
  console.log(`  ✓ ${ENV_VAR} güncellendi (atomik rename, yedek dosya bırakılmadı)`);

  // ── FAZ 3: yazılan değeri diskten geri OKU ve doğrula ──
  const onDisk = readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${ENV_VAR}=`))
    ?.slice(ENV_VAR.length + 1)
    .trim();

  if (onDisk !== newKey) {
    console.error('  ✗ Diskten geri okuma UYUŞMADI — `.env` elle kontrol edilmeli!');
    process.exit(1);
  }
  console.log('  ✓ diskten geri okuma doğrulandı');

  console.log('\n  ── SIRADAKİ ADIMLAR ──');
  console.log('  1. npm run test:supabase        → 16/16 geçmeli (gerçek DB)');
  console.log('  2. Dashboard → API Keys → ESKİ secret key → Revoke');
  console.log(
    `  3. SUPABASE_KEY_OLD=${currentKey ? currentKey.slice(0, 13) + '…' : '<eski>'} \\\n` +
      '       npm run rotate:supabase-key -- --check-revoked',
  );
  console.log('  4. Railway/hosting ortam değişkenlerini de güncelleyin');
  console.log('\n═══════════════════════════════════════════\n');
}

void main();
