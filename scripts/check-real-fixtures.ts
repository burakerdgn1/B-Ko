/**
 * ════════════════════════════════════════════════════════════════════════════
 * Gerçek fixture anonimleştirme kontrolü (D-048)
 *
 * `test-fixtures/real/` altındaki her mektubu maskeleme motorundan geçirir ve
 * NE BULDUĞUNU raporlar — tipleri ve konumları, **değerleri değil**.
 *
 * Amaç: dosyayı kullanmadan önce iki yönlü bir sağlama yapabilmek —
 *   - beklediğiniz alan görünmüyorsa → anonimleştirme FAZLA agresif olmuş,
 *     mektup gerçekçiliğini kaybetmiş olabilir,
 *   - beklemediğiniz bir şey görünüyorsa → anonimleştirme EKSİK kalmış.
 *
 * ⚠️ Bu bir anonimleştirme GARANTİSİ değildir. Yalnızca maskeleme motorunun ne
 * gördüğünü söyler; D-028 gereği tetikleyicisiz isimler zaten yakalanmaz.
 * Son kontrol insandadır.
 *
 * Değerler bilinçli olarak BASILMAZ: bu çıktı bir terminale, bir log dosyasına
 * veya bir asistan transkriptine düşebilir. D-040'ın dersi tam olarak budur.
 * `--show-values` ile açıkça istenebilir (kendi terminalinizde).
 *
 * NOT (D-043): bu script `AppModule` boot ETMEZ — `PiiService` bağımsızdır.
 *
 * Kullanım:
 *   npm run check:real-fixtures
 *   npm run check:real-fixtures -- --show-values   # ⚠️ ham PII yazdırır
 * ════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PiiService } from '../src/common/pii/pii.service';
import { KnownPiiProfile } from '../src/common/pii/pii.types';

const REAL_DIR = join(__dirname, '..', 'test-fixtures', 'real');

function loadJson<T>(p: string): T | null {
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}

function main(): void {
  const showValues = process.argv.includes('--show-values');

  if (!existsSync(REAL_DIR)) {
    console.log('test-fixtures/real/ yok. Kurulum: test-fixtures/real/README.md');
    process.exit(0);
  }

  const letters = readdirSync(REAL_DIR).filter((f) => f.endsWith('.txt'));
  if (letters.length === 0) {
    console.log('Henüz gerçek mektup eklenmemiş.');
    console.log('Kurulum: test-fixtures/real/README.md');
    process.exit(0);
  }

  const expected =
    loadJson<Record<string, { file: string }>>(join(REAL_DIR, 'expected.json')) ?? {};
  const profiles =
    loadJson<Record<string, KnownPiiProfile>>(join(REAL_DIR, 'profiles.json')) ?? {};
  const keyByFile = new Map(
    Object.entries(expected)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => [v.file, k]),
  );

  const pii = new PiiService();
  let problems = 0;

  console.log('═'.repeat(74));
  console.log('GERÇEK FIXTURE ANONİMLEŞTİRME KONTROLÜ');
  if (!showValues) {
    console.log('(değerler gizli — görmek için: -- --show-values)');
  }
  console.log('═'.repeat(74));

  for (const file of letters) {
    const key = keyByFile.get(file);
    const text = readFileSync(join(REAL_DIR, file), 'utf8');
    const profile = key ? profiles[key] : undefined;
    const { maskedText, map } = pii.mask(text, { profile });

    const byType = new Map<string, number>();
    for (const m of map.matches) {
      byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
    }

    const tokens = (maskedText.match(/\[\[[A-Z]+_\d+\]\]/g) ?? []).length;
    const words = maskedText.split(/\s+/).filter(Boolean).length;
    const ratio = words ? tokens / words : 0;

    console.log(`\n── ${file}`);
    console.log(`   expected.json kaydı : ${key ?? '⚠️  YOK — testler bu dosyayı ATLAR'}`);
    console.log(`   profil              : ${profile ? 'var' : 'yok (isteğe bağlı)'}`);
    console.log(`   uzunluk             : ${text.length} karakter`);

    if (!key) problems++;

    if (byType.size === 0) {
      console.log('   ⚠️  HİÇ PII BULUNAMADI — anonimleştirme fazla agresif olabilir;');
      console.log('       mektup artık gerçekçi bir test vakası olmayabilir.');
      problems++;
    } else {
      console.log('   bulunan PII:');
      for (const [type, n] of [...byType].sort()) {
        console.log(`     ${type.padEnd(14)} ${n} benzersiz değer`);
      }
    }

    // Round-trip, tüm boru hattının temel invaryantı.
    const roundTripOk = pii.unmask(maskedText, map) === text;
    console.log(`   round-trip          : ${roundTripOk ? '✓' : '✗ BOZUK'}`);
    if (!roundTripOk) problems++;

    const leaks = pii.detectLeaks(maskedText, map);
    console.log(`   sızıntı denetimi    : ${leaks.length === 0 ? '✓ temiz' : '✗ ' + leaks.join(', ')}`);
    if (leaks.length > 0) problems++;

    // Sınır `pii.real-fixtures.spec.ts` ile AYNI olmalı — iki aracın farklı
    // eşik kullanması, bu projede dört kez ısıran "araç yanlış" sınıfıdır.
    // Adres blokları sabit maliyet olduğu için kısa mektuplarda oran yapısal
    // olarak yükselir (D-048).
    const limit = words >= 150 ? 0.15 : 0.32;
    console.log(
      `   maskeleme yoğunluğu : %${(ratio * 100).toFixed(1)} ` +
        `(${words} kelime, sınır %${(limit * 100).toFixed(0)}) ` +
        (ratio >= limit ? '✗ AŞIRI — belge analiz edilemez hâle gelir' : '✓'),
    );
    if (ratio >= limit) problems++;

    if (showValues) {
      console.log('   ── maskelenen değerler (⚠️ ham PII) ──');
      for (const m of map.matches) {
        console.log(`     ${m.type.padEnd(14)} ${JSON.stringify(m.original)}`);
      }
    }
  }

  console.log(`\n${'═'.repeat(74)}`);
  if (problems === 0) {
    console.log(`✅ ${letters.length} dosya — belirgin sorun yok.`);
    console.log('   NOT: bu bir anonimleştirme garantisi DEĞİLDİR (D-028: tetikleyicisiz');
    console.log('   isimler yakalanmaz). Son kontrol sizde.');
  } else {
    console.log(`⚠️  ${problems} sorun bulundu — yukarıya bakın.`);
  }
  console.log('═'.repeat(74));
  process.exit(problems === 0 ? 0 : 1);
}

main();
