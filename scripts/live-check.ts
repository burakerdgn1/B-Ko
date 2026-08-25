/**
 * CANLI tam yığın doğrulaması: gerçek Claude + gerçek Supabase + gerçek pipeline.
 *
 * Neden ayrı: `eval:prompts` gerçek Claude kullanır ama in-memory DB ile;
 * `test:supabase` gerçek DB kullanır ama mock LLM ile. Bu script ikisini
 * BİRLİKTE çalıştırır — üretimdeki gerçek yol budur.
 *
 * Kullanım:  npx ts-node -T scripts/live-check.ts
 * ⚠️ Gerçek API çağrısı yapar (ücretlendirilir) ve gerçek DB'ye yazar.
 *    Yazdığı her satırı sonunda siler.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootScriptContext, assertSupabaseDriver } from './script-context';
import { AnalysisPipeline } from '../src/modules/analysis/analysis.pipeline';
import { ProfileService } from '../src/modules/profile/profile.service';
import { UserRepository } from '../src/modules/persistence/repositories/user.repository';
import { DocumentRepository } from '../src/modules/persistence/repositories/document.repository';
import { AppConfigService } from '../src/config/config.service';
import type { KnownPiiProfile } from '../src/common/pii/pii.types';

const FIXTURES = join(__dirname, '../test-fixtures');
const LETTERS = join(FIXTURES, 'behordenbriefe');

async function main(): Promise<void> {
  // D-043: Telegram botu BAŞLATILMAZ — yerel bir boot, üretimdeki botun
  // webhook kaydını ezebilir veya update'lerini çalabilir.
  const app = await bootScriptContext();
  const config = app.get(AppConfigService);

  console.log('\n═══════ CANLI TAM YIĞIN DOĞRULAMASI ═══════\n');
  console.log(`  LLM_MOCK  : ${config.llmMock}  (false olmalı)`);
  console.log(`  DB_DRIVER : ${config.dbDriver}  (supabase olmalı)`);
  console.log(`  Model     : ${config.llmModel}\n`);

  if (config.llmMock) {
    console.error('  ✗ LLM_MOCK=true — gerçek çağrı yapılmayacak. İptal.');
    await app.close();
    process.exit(1);
  }

  // D-048: Eskiden burada yalnızca "(supabase olmalı)" YAZIYORDU ama script
  // bellek sürücüsüyle de sonuna kadar koşup "canlı doğrulama başarılı"
  // diyordu. Yerel varsayılan `memory` olduğu için bu artık gerçek bir tuzak.
  if (config.dbDriver !== 'supabase') {
    await app.close();
    assertSupabaseDriver(config.dbDriver, 'live:check');
  }

  const users = app.get(UserRepository);
  const documents = app.get(DocumentRepository);
  const profiles = app.get(ProfileService);
  const pipeline = app.get(AnalysisPipeline);

  const expected = JSON.parse(
    readFileSync(join(LETTERS, 'expected.json'), 'utf8'),
  ) as Record<string, { file: string }>;
  const allProfiles = JSON.parse(
    readFileSync(join(FIXTURES, 'profiles.json'), 'utf8'),
  ) as Record<string, KnownPiiProfile>;
  const key = '01-aufenthaltserlaubnis-verlaengerung';
  const letter = readFileSync(join(LETTERS, expected[key].file), 'utf8');
  const profile = allProfiles[key];

  let userId: string | undefined;
  let ok = 0;
  let fail = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (pass) {
      ok++;
    } else {
      fail++;
    }
  };

  try {
    // Gerçek kullanıcı + onboarding profili (şifreli vault'a yazılır)
    const user = await users.create({
      channel: 'mock',
      channelUserId: `live-${Date.now()}`,
      locale: 'tr',
    });
    userId = user.id;
    await profiles.save(user.id, profile);
    check('onboarding profili gerçek DB vault\'una şifreli yazıldı', true);

    // Profil geri çözülebiliyor mu?
    const loaded = await profiles.load(user.id);
    check(
      'profil vault\'tan çözüldü',
      loaded?.fullName === profile.fullName,
      loaded?.fullName ? 'ad eşleşti' : 'ÇÖZÜLEMEDİ',
    );

    // ── ASIL AKIŞ: gerçek Claude + gerçek Supabase ──
    const t0 = Date.now();
    const outcome = await pipeline.run({
      userId: user.id,
      source: 'text',
      text: letter,
      profile: loaded,
    });
    const ms = Date.now() - t0;

    check('pipeline tamamlandı (gerçek Claude çağrısı)', true, `${ms} ms`);
    check('belge durumu analyzed', outcome.document.status === 'analyzed');
    check(
      'kurum tanındı',
      !!outcome.analysis.authority,
      outcome.analysis.authority ?? '—',
    );
    check(
      'son tarih token\'dan çözüldü (D-009)',
      outcome.deadline instanceof Date,
      outcome.deadline?.toISOString().slice(0, 10) ?? 'yok',
    );
    check('risk seviyesi üretildi', !!outcome.riskLevel, outcome.riskLevel);
    check(
      'eksik belgeler listelendi',
      outcome.missingDocuments.length > 0,
      `${outcome.missingDocuments.length} kalem`,
    );
    check(
      'hatırlatmalar kuruldu',
      typeof outcome.remindersCreated === 'number',
      `${outcome.remindersCreated} adet`,
    );

    // ── GİZLİLİK: gerçek DB'de ham PII var mı? ──
    const stored = await documents.findById(outcome.document.id);
    const secrets = [
      profile.fullName,
      profile.familyName,
      profile.address,
      profile.email,
      profile.steuerId,
    ].filter((v): v is string => typeof v === 'string' && v.length > 3);

    const dbDump = JSON.stringify(stored);
    const leaked = secrets.filter((s) => dbDump.includes(s));
    check(
      'GERÇEK DB\'de ham PII YOK',
      leaked.length === 0,
      leaked.length ? `SIZINTI: ${leaked.length} değer` : `${secrets.length} değer kontrol edildi`,
    );

    // Kullanıcıya dönen metin unmask edilmiş mi?
    check(
      'kullanıcı çıktısı token göstermiyor',
      !/\[\[[A-Z]+_\d+\]\]/.test(outcome.summary),
    );

    console.log(`\n  ── Model özeti (unmask edilmiş) ──`);
    console.log(`  ${outcome.summary.slice(0, 220)}…`);
  } catch (error) {
    check(
      'BEKLENMEYEN HATA',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (userId) {
      try {
        await users.delete(userId);
        console.log('\n  (temizlik: test kullanıcısı ve bağlı kayıtlar silindi)');
      } catch {
        console.log(`\n  ⚠ temizlik başarısız — elle sil: users.id=${userId}`);
      }
    }
    await app.close();
  }

  console.log(`\n  ── SONUÇ: ${ok}/${ok + fail} geçti ──`);
  console.log('\n═══════════════════════════════════════════\n');
  process.exit(fail === 0 ? 0 : 1);
}

void main();
