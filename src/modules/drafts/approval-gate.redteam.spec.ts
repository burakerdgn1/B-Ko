import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { DraftRepository } from '../persistence/repositories/draft.repository';
import { Draft } from '../../common/types/domain';

/**
 * KIRMIZI TAKIM (red team) — onay kapısını KIRMAYI DENEYEN testler.
 *
 * Bu dosya diğer testlerden farklı bir soru sorar. Diğerleri "doğru kullanım
 * çalışıyor mu?" diye sorar; bu dosya **"kötü niyetli veya dikkatsiz bir çağıran
 * insan onayını atlayabilir mi?"** diye sorar.
 *
 * Neden ayrı bir dosya: D-014'te bu kapı GERÇEKTEN aşılabiliyordu ve o dönemki
 * test seti bunu "doğru davranış" sanıp doğruluyordu. Kural (CLAUDE.md §7) şudur:
 *
 *   Bir taslak 'sent' durumuna YALNIZCA, daha önce ve AYRI bir işlemde
 *   'approved' olmuşsa geçebilir. Onay aynı çağrıda "uydurulamaz".
 *
 * Her `it` bloğu bir saldırı vektörüdür ve HEPSİ reddedilmelidir.
 */
describe('Onay kapısı — kırmızı takım (bypass denemeleri)', () => {
  let app: INestApplication;
  let drafts: DraftRepository;

  const ORIGINAL_ENV = process.env;

  beforeEach(async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      LLM_MOCK: 'true',
      DB_DRIVER: 'memory',
      TELEGRAM_MODE: 'disabled',
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    drafts = app.get(DraftRepository);
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  const newDraft = (status: Draft['status'] = 'draft') =>
    drafts.create({
      analysisId: 'analysis-redteam',
      content: 'maskeli içerik [[NAME_1]]',
      subject: 'Test',
      language: 'de',
      status,
      approvedAt: null,
      rejectedAt: null,
      sentAt: null,
      rejectReason: null,
      deleteAfter: null,
    });

  /** Kaydın gerçekten 'sent' OLMADIĞINI doğrular. */
  const assertNotSent = async (id: string) => {
    const after = await drafts.findById(id);
    expect(after?.status).not.toBe('sent');
    expect(after?.sentAt).toBeFalsy();
  };

  // ── Saldırı 1: onayı aynı çağrıda uydurmak (D-014'ün ta kendisi) ──────────
  it('VEKTÖR 1: {status:"sent", approvedAt:now} tek çağrısı REDDEDİLİR', async () => {
    const draft = await newDraft('draft');

    await expect(
      drafts.update(draft.id, { status: 'sent', approvedAt: new Date() }),
    ).rejects.toThrow(/onay/i);

    await assertNotSent(draft.id);
  });

  // ── Saldırı 2: iki adımda onayı taklit etmek ──────────────────────────────
  it('VEKTÖR 2: önce approvedAt yazıp sonra sent yapmak REDDEDİLİR', async () => {
    const draft = await newDraft('draft');

    // 'approved' durumuna GEÇMEDEN yalnızca zaman damgasını yazmayı dene.
    await drafts.update(draft.id, { approvedAt: new Date() });

    await expect(drafts.update(draft.id, { status: 'sent' })).rejects.toThrow(
      /onay/i,
    );

    await assertNotSent(draft.id);
  });

  // ── Saldırı 3: doğrudan 'sent' olarak yaratmak ────────────────────────────
  // Bu vektör ilk çalıştırmada GERÇEK bir boşluk ortaya çıkardı: create() kapıyı
  // zorlamıyordu, yani kayıt en baştan 'sent' yaratılarak update() kapısı
  // tamamen atlanabiliyordu. Artık her iki sürücü de INSERT'te reddediyor.
  it('VEKTÖR 3: taslağı doğrudan "sent" durumunda YARATMAK reddedilir', async () => {
    await expect(newDraft('sent')).rejects.toThrow(/doğrudan 'sent'/);
  });

  it('VEKTÖR 3b: "approved" durumunda yaratmak engellenmez (meşru senaryo)', async () => {
    // Onay akışının kendisi bu durumu üretebilmeli; yasak olan yalnızca 'sent'.
    const draft = await newDraft('approved');
    expect(draft.status).toBe('approved');
  });

  // ── Saldırı 4: reddedilmiş taslağı göndermek ──────────────────────────────
  it('VEKTÖR 4: "rejected" taslak sent yapılamaz (approvedAt verilse bile)', async () => {
    const draft = await newDraft('draft');
    await drafts.update(draft.id, { status: 'rejected' });

    await expect(
      drafts.update(draft.id, { status: 'sent', approvedAt: new Date() }),
    ).rejects.toThrow(/onay/i);

    await assertNotSent(draft.id);
  });

  // ── Saldırı 5: onay beklerken atlamak ─────────────────────────────────────
  it('VEKTÖR 5: "pending_approval" durumundan doğrudan sent REDDEDİLİR', async () => {
    const draft = await newDraft('pending_approval');

    await expect(drafts.update(draft.id, { status: 'sent' })).rejects.toThrow(
      /onay/i,
    );

    await assertNotSent(draft.id);
  });

  // ── Saldırı 6: sahte bir onay zaman damgasıyla geçmişe gitmek ────────────
  it('VEKTÖR 6: geçmiş tarihli sahte approvedAt işe yaramaz', async () => {
    const draft = await newDraft('draft');

    await expect(
      drafts.update(draft.id, {
        status: 'sent',
        approvedAt: new Date('2020-01-01'),
      }),
    ).rejects.toThrow(/onay/i);

    await assertNotSent(draft.id);
  });

  // ── Meşru yol: GERÇEKTEN çalışmalı ────────────────────────────────────────
  it('MEŞRU YOL: ayrı bir onay adımından sonra sent BAŞARILI olur', async () => {
    const draft = await newDraft('draft');

    // 1. adım — insan onayı (ayrı, kalıcılaşan işlem)
    const approved = await drafts.update(draft.id, { status: 'approved' });
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeInstanceOf(Date);

    // 2. adım — ancak şimdi gönderilebilir
    const sent = await drafts.update(draft.id, { status: 'sent' });
    expect(sent.status).toBe('sent');
    expect(sent.approvedAt).toBeInstanceOf(Date);
  });

  // ── Kapının kendisi bozulmasın: hata mesajı sızdırmamalı ─────────────────
  it('hata mesajı taslak içeriğini (olası PII) sızdırmaz', async () => {
    const draft = await newDraft('draft');

    await expect(
      drafts.update(draft.id, { status: 'sent' }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('[[NAME_1]]'),
      }),
    );
  });
});
