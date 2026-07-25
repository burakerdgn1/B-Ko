# TODO.md — Canlı Görev Listesi (WBS)

Durumlar: `[ ]` pending · `[~]` in_progress · `[x]` completed · `[!]` blocked (manuel aksiyon)
Sahip: `O`=Ana oturum (Opus) · `S`=Sonnet subagent

## Bağımlılık Grafiği
```
F0 Scaffold ─► F1a DB şema ─► F1b Persistence ─┬─► F2 Analysis pipeline ─► F3a Draft üretim
            └► F1c PII (O) ──────────────────────┤                       └► F3b Playwright PoC
            └► F1d Config ─► F1e LLM servis ─────┘
            └► F1f Telegram kanal ─────────────────────────────────► F4 UX cilası
   Tümü ─► F5 Test/DevOps/Docs (kısmen paralel)
```

## Faz 0 — Scaffold
- [x] F0.1 (O) Dizin iskeleti + tracking dosyaları
- [x] F0.2 (O) `.gitignore`, `package.json`, `tsconfig`, `nest-cli.json`, `.env.example`
- [x] F0.3 (O) `npm install` + ilk commit (`2a07cf2`)

## Faz 1 — Temel
- [x] F1a (O) Supabase şema + migration `0001_init.sql` — onay kapısı trigger'ı + `purge_expired_data()`
- [x] F1c (O) **PII maskeleme modülü** + crypto zarf + testler (moat) — 54 test geçti
- [x] F1d (O) Config modülü (Zod env validasyonu, üretimde mock kaçışı kapalı)
- [x] F1g (O) Paylaşılan alan tipleri `src/common/types/domain.ts` (sözleşme kayması önlemi)
- [x] F1b (S) Persistence: memory + supabase repository'ler, onay kapısı
- [x] F1e (S) LLM servis: Claude sarmalayıcı (PII zorunlu geçiş) + OcrProvider + mock
- [x] F1f (S) Telegram kanal (grammY) + ChannelAdapter + mock adapter
- [x] F1h (O) `app.module.ts` entegrasyonu + DI bütünlük testi

## Faz 2 — Çekirdek Agent Mantığı
- [x] F2.0 (O) Deadline/risk yardımcıları + testleri (30 test geçti)
- [x] F2.3 (S) 8 sentetik Behördenbrief fixture + expected.json + profiles.json
- [x] F2.1 (O) Analysis state machine + pipeline + uçtan uca test
- [x] F2.2 (O) Belge alımı pipeline içinde modellendi (ayrı modüle gerek kalmadı)
- [x] F2.4 (O) Fixture tabanlı PII + pipeline testleri

## Faz 3 — Üretim + İzleme
- [x] F3a (S) Taslak mektup üretimi (Beamtendeutsch) + approval state machine
- [x] F3b (S) Playwright randevu izleme PoC (tek kurum, mock sayfa)

## Faz 4 — Arayüz
- [x] F4.1 (O) ConversationService — tam sohbet akışı (tr/de/en)
- [ ] F4.2 (—) minimal web dashboard — **ertelendi** (v1 kapsam dışı, CLAUDE.md §4)

## Faz 5 — Test & Teslim
- [x] F5.1 (S) Reminders + GDPR silme cron + testleri (+D-019 eksik silme düzeltmesi)
- [x] F5.2 (O) Uçtan uca senaryo testleri (pipeline + conversation, fixture ile tam döngü)
- [x] F5.3 (S) Dockerfile + docker-compose + CI + deployment scriptleri (imaj gerçekten build edildi)
- [x] F5.4 (O) README + mermaid diyagramlar + demo senaryosu
- [x] F5.5 (O) Final entegrasyon + DoD doğrulama + STATUS güncelle — **MVP TAMAMLANDI**
