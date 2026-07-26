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

---

## Güvenlik Denetimi (MVP sonrası) — tamamlandı
- [x] S-1 (O) Kırmızı takım: onay kapısı bypass denemeleri → **D-022 açığı bulundu ve kapatıldı**
- [x] S-2 (O) Sızıntı kanalı denetimi (payload · log · DB hata · stack trace · audit)
- [x] S-3 (O) D-024: v1 maskeleme kapsamının ÖLÇÜLMESİ (isim boşluğu tespiti)
- [x] S-4 (O) D-026: boşluğun saklama tarafına etkisi + doküman iddialarının düzeltilmesi
- [x] S-5 (O) D-023: test env izolasyon tuzağının tespiti
- [x] S-6 (O) Yarış durumu / eşzamanlılık / AAD izolasyon denetimi

## v1.1 — tamamlandı
- [x] V1.1a (O) **Onboarding profili** → bilinen-değer maskeleme DEVREDE (D-027; D-018/D-024 kapandı)
- [x] V1.1b (O) **Üçüncü taraf isimleri — Faz A** bağlamsal tetikleyiciler (D-029, sıfır yanlış pozitif)
- [x] V1.1c (O) **Telegram webhook endpoint'i** (D-030, fail-closed gizli anahtar)
- [x] V1.1d (O) **Prompt ölçüm koşumu** `npm run eval:prompts` (D-031)
- [x] V1.1e (O) Gerçek API ölçümü → **rubric hipotezi çürütüldü, rubric kaldırıldı** (~267 token/çağrı)
- [x] V1.1f (O) 6 sınır vakası fixture (09-14) — rubric/risk ölçeği regresyon koruması
- [x] V1.1g (O) D-032 test hermetikliği · D-033 eval ölçüm hatası düzeltmesi

## v1.2 — Supabase canlı — tamamlandı
- [x] DB-1 (O) `npm run check:supabase` teşhis aracı (anahtar türü + şema)
- [x] DB-2 (O) anon/service-role ayrımı + `SUPABASE_ANON_KEY` alanı (yanlış etiketleme önlendi)
- [x] DB-3 (Kullanıcı) Migration'lar SQL Editor'dan uygulandı → 8/8 tablo
- [x] DB-4 (O) `DB_DRIVER=supabase` + gerçek DB entegrasyon testleri → **16/16**
- [x] DB-5 (O) Test izolasyonu doğrulandı (527 passed / 16 skipped, gerçek DB'ye çıkılmıyor)

---

## Açık işler

### Bilinen sınır (bilinçli, belgelenmiş)
- [ ] **D-028 — tetikleyicisiz üçüncü taraf isimleri** (ör. "von Petra Hoffmann geprüft")
      maskelenmiyor. Yerel NER gerektiriyor (Faz B, ~5.5 gün tahmini).
      Kalıcı test sınırı sabitliyor; README/STATUS'ta açıkça ilan edildi.
      **Kullanıcı kararı: şimdilik girilmeyecek.**

### Sıradaki aday işler (öncelik sırasız)
- [ ] Telegram bot token'ı ile canlı uçtan uca deneme (MANUAL_ACTIONS §2)
      — webhook kodu yazıldı ve test edildi, ancak GERÇEK Telegram'a karşı hiç çalışmadı
- [ ] Gerçek (anonimleştirilmiş) Behördenbrief örnekleriyle doğrulama —
      şu ana kadarki tüm doğrulama SENTETİK fixture'larla yapıldı
- [ ] `PII_MASTER_KEY` üretim değeri + anahtar rotasyon prosedürü (şu an dev anahtarı)
- [ ] RLS politikaları — yalnızca web dashboard eklenirse gerekli (şu an service_role)
- [ ] Deployment (Railway/Coolify) — Dockerfile ve CI hazır, hesap bağlanmadı
- [ ] F4.2 minimal web dashboard — **ertelendi** (v1 kapsam dışı, CLAUDE.md §4)
- [ ] WhatsApp adapter — v2 (ChannelAdapter arayüzü hazır)

### Güvenlik borcu (kullanıcı eylemi)
- [x] ~~Supabase `service_role` (legacy JWT) rotasyonu~~ — **2026-07-26'da İPTAL EDİLDİ.**
      Doğrulandı: eski anahtar `HTTP 401 "Legacy API keys are disabled"`,
      yeni `sb_secret_...` çalışıyor, 16/16 entegrasyon testi geçiyor.
      Yan etki: legacy **anon** anahtarı da kapandı; `.env`'deki publishable
      anahtar yeni biçim olduğu için etkilenmedi (HTTP 200 ile doğrulandı).
- [x] ~~`ANTHROPIC_API_KEY` rotasyonu~~ — **2026-07-26'da İPTAL EDİLDİ.**
      Doğrulandı: `HTTP 401 "API key is invalid."` (`/v1/models` ile, token
      harcamadan). `.env` temizlendi ve `LLM_MOCK=true` yapıldı; uygulama
      anahtarsız çalışmaya devam ediyor.
      ⚠️ Sonuç: `npm run eval:prompts` artık çalışmaz (gerçek anahtar ister).
      Prompt ölçümü yapılacaksa yeni bir anahtar gerekir.
- [ ] Mevcut `sb_secret_...` anahtarı da gerçek kullanıcı verisiyle çalışmaya
      başlamadan önce döndürülmeli (o da transkriptte).
