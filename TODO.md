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
- [~] F0.2 (O) `.gitignore`, `package.json`, `tsconfig`, `nest-cli.json`, `.env.example`
- [ ] F0.3 (O) İlk commit

## Faz 1 — Temel
- [ ] F1a (O) Supabase şema + migration `0001_init.sql` (veri modeli — kritik)
- [ ] F1c (O) **PII maskeleme modülü** + crypto zarf + testler (moat — kritik)
- [ ] F1d (O) Config modülü (Zod env validasyonu)
- [ ] F1b (S) Persistence: Supabase istemcisi + repository'ler + tipler
- [ ] F1e (S) LLM servis: Claude sarmalayıcı (PII zorunlu geçiş) + prompt iskeleti
- [ ] F1f (S) Telegram kanal iskeleti (grammY) + ChannelAdapter arayüzü + mock adapter

## Faz 2 — Çekirdek Agent Mantığı
- [ ] F2.1 (O) Analysis state machine + pipeline tasarımı (kritik akış)
- [ ] F2.2 (S) Pipeline implementasyonu: ingest→mask→LLM→unmask→classify→deadline/risk→missing-docs
- [ ] F2.3 (S) 6+ sentetik Behördenbrief fixture (Almanca, uydurma PII)
- [ ] F2.4 (S) Analysis + documents modül testleri

## Faz 3 — Üretim + İzleme
- [ ] F3a (S) Taslak mektup üretimi (Beamtendeutsch) + approval state machine (human-in-loop)
- [ ] F3b (S) Playwright randevu izleme PoC (tek kurum, mock sayfa)

## Faz 4 — Arayüz
- [ ] F4.1 (S) Telegram UX akışı cilası (onboarding→consent→AI disclosure→belge→onay)
- [ ] F4.2 (S) (opsiyonel) minimal web dashboard — ertelendi (v1 kapsam dışı)

## Faz 5 — Test & Teslim
- [ ] F5.1 (S) Reminders + GDPR silme cron + testleri
- [ ] F5.2 (S) Uçtan uca (e2e) senaryo testi (fixture ile tam döngü)
- [ ] F5.3 (S) Dockerfile + docker-compose + deployment scriptleri
- [ ] F5.4 (S) README + mimari diyagram (mermaid) + demo senaryosu
- [ ] F5.5 (O) Final entegrasyon + DoD doğrulama + STATUS güncelle
