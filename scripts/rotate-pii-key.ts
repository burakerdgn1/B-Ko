/**
 * PII vault anahtar rotasyonu — mevcut şifreli veriyi KAYBETMEDEN.
 *
 * Neden gerekli: `PII_MASTER_KEY` değiştirildiğinde vault'taki tüm kayıtlar
 * AES-GCM auth tag doğrulamasında başarısız olur ve KALICI olarak okunamaz
 * hâle gelir. Yani anahtarı "sadece .env'de değiştirmek" veri kaybıdır:
 *   - profil kayıtları giderse bilinen-değer maskelemesi çalışmaz
 *   - belge token'ları giderse `masked_text` bir daha ASLA çözülemez
 *
 * Bu script eski anahtarla çözüp yeni anahtarla yeniden şifreler.
 *
 * Kullanım:
 *   # 1) Önce kuru koşum (hiçbir şey yazmaz):
 *   PII_KEY_NEW=<64-hex> npx ts-node -T scripts/rotate-pii-key.ts
 *   # 2) Onaylayınca uygula:
 *   PII_KEY_NEW=<64-hex> npx ts-node -T scripts/rotate-pii-key.ts --apply
 *
 * Eski anahtar kaynağı:
 *   - `PII_KEY_OLD` verilmişse o kullanılır
 *   - verilmemişse `.env`'deki `PII_MASTER_KEY`
 *   - o da boşsa DEV türetilmiş anahtar (mevcut durum)
 *
 * GÜVENLİK: Bu script çözülmüş PII'yi ASLA loglamaz; yalnızca sayaç ve token adı.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { bootScriptContext, assertSupabaseDriver } from './script-context';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PiiVaultRepository } from '../src/modules/persistence/repositories/pii-vault.repository';
// `import type` DEĞİL: aşağıda `app.get(AppConfigService)` ile DI token'ı
// olarak kullanılıyor, yani çalışma zamanında değere ihtiyaç var.
import { AppConfigService } from '../src/config/config.service';

/** Verilen anahtarla (ya da dev fallback ile) bir CryptoService kurar. */
function cryptoWith(hexKey?: string): CryptoService {
  const fakeConfig = {
    piiMasterKey: hexKey,
    isProduction: false,
  } as AppConfigService;
  return new CryptoService(fakeConfig);
}

/** `PiiVaultService.aad` ile BİREBİR aynı olmalı — yoksa çözme başarısız olur. */
function aad(userId: string | undefined, documentId: string | undefined, token: string): string {
  return `bueko:v1:${userId ?? '-'}:${documentId ?? '-'}:${token}`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const newKey = process.env.PII_KEY_NEW?.trim();
  const oldKey = process.env.PII_KEY_OLD?.trim() || process.env.PII_MASTER_KEY?.trim();

  if (!newKey || !/^[0-9a-fA-F]{64}$/.test(newKey)) {
    console.error('✗ PII_KEY_NEW gerekli (64 hex karakter).');
    console.error('  Üretmek için: openssl rand -hex 32');
    process.exit(1);
  }
  if (oldKey && newKey.toLowerCase() === oldKey.toLowerCase()) {
    console.error('✗ Yeni anahtar eskisiyle aynı — rotasyon anlamsız.');
    process.exit(1);
  }

  // D-043: Telegram botu BAŞLATILMAZ (üretim webhook'unu ezme riski).
  const app = await bootScriptContext();

  // D-048: bellek sürücüsünde kasa BOŞ görünür; script "0 kayıt rotate
  // edildi" deyip BAŞARILI çıkardı — oysa gerçek kasaya hiç dokunulmamıştır.
  // Yerel varsayılan `memory` olduğu için bu sessiz başarısızlık artık
  // gerçekten olasıydı.
  const cfg = app.get(AppConfigService);
  if (cfg.dbDriver !== 'supabase') {
    await app.close();
    assertSupabaseDriver(cfg.dbDriver, 'rotate:pii-key');
  }

  const vaultRepo = app.get(PiiVaultRepository);

  const oldCrypto = cryptoWith(oldKey);
  const newCrypto = cryptoWith(newKey);

  console.log('\n═══════ PII VAULT ANAHTAR ROTASYONU ═══════\n');
  console.log(`  Mod        : ${apply ? 'UYGULA (yazacak)' : 'KURU KOŞUM (yazmaz)'}`);
  console.log(`  Eski anahtar: ${oldKey ? 'PII_MASTER_KEY / PII_KEY_OLD' : 'DEV türetilmiş (env boş)'}`);
  console.log(`  Yeni anahtar: ${newKey.slice(0, 8)}… (${newKey.length} hex)\n`);

  // Tüm kayıtları topla (repository kullanıcı/belge bazlı çalışıyor; burada
  // rotasyon için hepsine ihtiyacımız var → doğrudan sorgu).
  const rows = await (vaultRepo as unknown as {
    findAllForRotation?: () => Promise<unknown[]>;
  }).findAllForRotation?.() ?? null;

  if (!rows) {
    console.error(
      '✗ Repository toplu okuma desteklemiyor. Bu script `findAllForRotation()` bekler.',
    );
    await app.close();
    process.exit(1);
  }

  type Row = {
    id: string;
    token: string;
    entityType: string;
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: number;
    userId?: string | null;
    documentId?: string | null;
  };
  const all = rows as Row[];
  console.log(`  Toplam kayıt: ${all.length}\n`);

  // ── FAZ 1: hepsini ÇÖZ (hiçbir şey yazmadan) ──
  // Tek bir kayıt bile çözülemiyorsa hiç yazma — yarım rotasyon en kötü sonuç.
  const decrypted = new Map<string, string>();
  const failures: string[] = [];

  for (const r of all) {
    try {
      const plain = oldCrypto.open(
        { ciphertext: r.ciphertext, iv: r.iv, authTag: r.authTag, keyVersion: r.keyVersion },
        aad(r.userId ?? undefined, r.documentId ?? undefined, r.token),
      );
      decrypted.set(r.id, plain);
    } catch {
      failures.push(`${r.token} (${r.entityType})`);
    }
  }

  console.log(`  ── Faz 1: çözme ──`);
  console.log(`  ✓ çözülen : ${decrypted.size}/${all.length}`);
  if (failures.length) {
    console.log(`  ✗ ÇÖZÜLEMEYEN: ${failures.length}`);
    for (const f of failures.slice(0, 5)) console.log(`      ${f}`);
    console.error('\n  ✗ İPTAL — eski anahtar yanlış ya da kayıtlar karışık.');
    console.error('    Hiçbir şey yazılmadı.');
    await app.close();
    process.exit(1);
  }

  // ── FAZ 2: yeniden şifrele + round-trip DOĞRULA (bellekte) ──
  const rotated = new Map<string, { ciphertext: string; iv: string; authTag: string }>();
  for (const r of all) {
    const plain = decrypted.get(r.id)!;
    const a = aad(r.userId ?? undefined, r.documentId ?? undefined, r.token);
    const sealed = newCrypto.seal(plain, a);

    // Yazmadan ÖNCE yeni anahtarla geri çözülebildiğini kanıtla.
    const check = newCrypto.open(
      { ...sealed, keyVersion: sealed.keyVersion },
      a,
    );
    if (check !== plain) {
      console.error(`  ✗ round-trip doğrulaması BAŞARISIZ (${r.token}) — iptal.`);
      await app.close();
      process.exit(1);
    }
    rotated.set(r.id, {
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
    });
  }
  console.log(`\n  ── Faz 2: yeniden şifreleme ──`);
  console.log(`  ✓ round-trip doğrulandı: ${rotated.size}/${all.length}`);

  if (!apply) {
    console.log('\n  KURU KOŞUM — hiçbir şey yazılmadı.');
    console.log('  Uygulamak için: --apply ekleyin.');
    console.log('\n═══════════════════════════════════════════\n');
    await app.close();
    return;
  }

  // ── FAZ 3: yaz ──
  let written = 0;
  for (const r of all) {
    const next = rotated.get(r.id)!;
    await vaultRepo.update(r.id, {
      ciphertext: next.ciphertext,
      iv: next.iv,
      authTag: next.authTag,
      keyVersion: r.keyVersion + 1,
    } as never);
    written++;
  }

  console.log(`\n  ── Faz 3: yazma ──`);
  console.log(`  ✓ güncellenen kayıt: ${written}/${all.length}`);
  console.log(`  ✓ key_version → ${all[0]?.keyVersion + 1}`);
  console.log('\n  SIRADAKİ ADIM: .env içinde PII_MASTER_KEY=<yeni anahtar> yapın');
  console.log('  ve uygulamayı yeniden başlatın.');
  console.log('\n═══════════════════════════════════════════\n');

  await app.close();
}

void main();
