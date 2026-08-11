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

## v1.3 — Canlı üretim doğrulaması — tamamlandı
- [x] L-1 (Kullanıcı+O) Anahtar rotasyonu turu: legacy Supabase JWT + eski Anthropic
      anahtarı iptal edildi, ikisi de `HTTP 401` ile bağımsız doğrulandı
- [x] L-2 (O) cloudflared tüneli + webhook kaydı (ilk adres düştü, teşhis edilip yenilendi)
- [x] L-3 (O) `npm run live:check` — gerçek Claude + gerçek Supabase birlikte (11/11)
- [x] L-4 (Kullanıcı+O) **Canlı uçtan uca test**: /start → rıza → onboarding →
      metin ✅ → fotoğraf (ilk denemede başarısız)
- [x] L-5 (O) **D-034** — fotoğraf yolu kırıktı (MIME uzantıdan tahmin ediliyordu);
      içerik-imzası tespitiyle düzeltildi + 12 regresyon testi + HEIC yönlendirmesi
- [x] L-6 (O) Düzeltme sonrası fotoğraf doğrulandı; gerçek DB'de ham PII YOK
- [x] L-7 (Kullanıcı+O) **Taslak onay/ret akışı canlı doğrulandı** — reddedilmiş
      gerçek taslağa saldırı: `rejected→sent` ❌, `approvedAt` uydurma ❌ (D-014)
- [x] L-8 (O) **D-035** — PII üretim anahtarı, 48 kayıt kaybedilmeden rotate edildi
- [x] L-9 (O) **D-036** — güvenlik kararları (D-010/D-014/D-022/D-030) canlı
      ortamda, gerçek veriye karşı yeniden doğrulandı
- [x] L-10 (O) Belge tutarlılık denetimi: heredoc çakışması yüzünden sessizce
      yazılmayan STATUS/TODO güncellemeleri tespit edilip tamamlandı

## v1.4 — Güvenlik borcu + dağıtım hazırlığı (2026-07-29)
- [x] R-1 (O) **D-037** — `npm run rotate:supabase-key` fail-safe rotasyon aracı.
      Yeni anahtar TAM doğrulanmadan (`/rest/v1/` tür kontrolü + 8/8 tablo +
      gerçek insert/read-back/delete round-trip) `.env` yazılmaz. Atomik
      tmp+rename, yedek dosya YOK (sızmış kopya sayısını artırmamak için).
      4 senaryo gerçek projeye karşı koşuldu; 3 ret senaryosunda `.env` md5'i
      değişmedi. Yan bulgu: `rotate:pii-key` package.json'da yokmuş, eklendi.
- [x] R-2 (Kullanıcı+O) **ROTASYON TAMAMLANDI (2026-07-29).** Yeni secret key
      (`bukov`) üretildi, `--apply` ile `.env`'e işlendi, eski anahtar (`bukov2`)
      Dashboard'dan silindi. Doğrulandı: eski anahtar `HTTP 401 "Unregistered
      API key"` · yeni anahtarla 16/16 entegrasyon testi · `pii_vault` 48/48
      kayıt sağlam (`key_version: 2`) · `check:deploy` GO.
      **Yeni anahtar sohbete hiç girmedi** — rotasyon kullanıcının kendi
      terminalinde koşuldu, buraya yalnızca maskeli parmak izi ulaştı.
- [ ] R-3 (Kullanıcı) **`default` adlı üçüncü secret anahtarı sil** (isteğe
      bağlı sıkılaştırma). Proje onu kullanmıyor — kodda ve `.env`'de tek
      secret anahtar var, doğrulandı. Kullanılmayan tam yetkili kimlik bilgisi
      saf saldırı yüzeyi. Silmeden önce Dashboard'daki "Last used" kontrol
      edilmeli; doluysa başka bir tüketici var demektir.
- [x] D-1 (O) **D-038** — Railway dağıtım yolundaki üç sessiz arıza kapatıldı:
      hedefsiz build yanlış imajı üretiyordu · `/health` yoktu · webhook
      `localhost`'a kaydolacaktı (`PUBLIC_BASE_URL` tavuk-yumurta).
- [x] D-2 (O) `railway.json` (numReplicas=1 — cron süreç içinde) +
      `npm run check:deploy` GO/NO-GO aracı (gerçek `validateEnv()`, ortamı
      okur → `railway run` ile platformda koşar, token harcamaz).
- [x] D-3 (O) Gerçek Docker doğrulaması: hedefsiz build → 218 MB / Node 22,
      üretim modunda temiz açılış, `/health` 200, HEALTHCHECK `healthy`.
- [x] D-4 (O) **D-039** — CI hedefsiz build edip imajın `runtime` olduğunu
      kanıtlıyor (regresyon guard'ı). Guard iki yönlü doğrulandı ve yazarken
      yaptığım yanlış varsayımı (playwright JS paketi imajda VAR) yakaladı.
- [x] D-5 (O) `docs/DEPLOYMENT.md` kapanmış iki sorunu (D-020, D-021) hâlâ açık
      gibi anlatıyordu — dağıtımı yapanı yanlış yönlendirirdi; düzeltildi.
- [~] D-6 (Kullanıcı) **Railway hesabı + repo bağlama + Variables**
      → `MANUAL_ACTIONS_REQUIRED.md` §8 (adım adım, kopyalanabilir liste).
      **Durum (2026-07-29, CLI ile doğrulandı):** hesap ✅ açık, ama **0 proje**
      var — deploy henüz yapılmadı. Ayrıca GitHub repo'su BOŞ (35 commit hiç
      push edilmemiş), yani Railway'in çekeceği bir kaynak da yok.
      **Kullanıcı kararı: deploy ertelendi, önce Supabase rotasyonu.**
      Gerekçe: şimdi dağıtmak sızmış `sb_secret` anahtarını üretime taşırdı.
- [x] D-7 (O) Kod GitHub'a push edildi (sır denetimi sonrası), CI başarılı.

## v1.6 — ÜRETİMDE (2026-08-11) — https://b-ko-production.up.railway.app
- [x] P-1 (O) GitHub push + CI yeşil (D-039 guard'ı gerçek Actions'ta koştu)
- [x] P-2 (O) **D-042** — "yeşil deploy, sağır bot": üç Variables hatası
      (`TELEGRAM_WEBHOOK_SECRET` yok · `PUBLIC_BASE_URL=localhost` ·
      `NODE_ENV=development`). Hiçbiri konteyneri çökertmediği için platform
      göstergeleri göremiyordu; `railway logs` yakaladı.
- [x] P-3 (O) **D-041** — `check:deploy` platform ortamında `.env` yüklüyordu,
      eksik değişkenleri göremiyordu → yanlış GO verdi. Düzeltildi.
- [x] P-4 (O) Üç değişken düzeltildi (sır `--set-from-stdin` ile, transkripte
      yazılmadan) + tek redeploy. Canlı doğrulama: production modu · webhook
      Railway domainine kayıtlı · `check:deploy` GO · **D-030 üretimde
      saldırıyla sınandı** (sırsız → 401, yanlış sır → 401).
- [ ] P-5 (Kullanıcı) **Telegram'dan uçtan uca canlı deneme** — `/start` →
      mektup fotoğrafı → analiz → taslak. Üretim yolunun gerçekten çalıştığını
      yalnızca bu doğrular; şu ana kadarki canlı test yerel tünel üzerindeydi.

---

## Açık işler

### Bilinen sınır (bilinçli, belgelenmiş)
- [ ] **D-028 — tetikleyicisiz üçüncü taraf isimleri** (ör. "von Petra Hoffmann geprüft")
      maskelenmiyor. Yerel NER gerektiriyor (Faz B, ~5.5 gün tahmini).
      Kalıcı test sınırı sabitliyor; README/STATUS'ta açıkça ilan edildi.
      **Kullanıcı kararı: şimdilik girilmeyecek.**

### Sıradaki aday işler (öncelik sırasız)
- [ ] **CI'da Playwright testleri sessizce atlanıyor.** `appointment-checker.spec.ts`
      gerçek Chromium istiyor (`isPlaywrightBrowserAvailable() ? describe : describe.skip`);
      CI `npx playwright install chromium` çalıştırmadığı için 3 test atlanıyor
      (CI: 544 geçti/19 atlandı · yerel: 547/16). Yani randevu izleme PoC'sinin
      TEK gerçek testi CI'da hiç koşmuyor. Bu projede aynı desen iki kez ısırdı
      (D-032, D-034). Düzeltme tek satır: CI'a `npx playwright install chromium`
      eklemek (~1-2 dk maliyet). Bilinçli boşluk olarak bırakılabilir de —
      watcher opsiyonel bir modül ve üretim imajında tarayıcı yok.
- [x] ~~Telegram canlı uçtan uca deneme~~ — **2026-07-29'da YAPILDI** (@BuKo749_bot
      + cloudflared tüneli). /start → rıza → onboarding → metin VE fotoğraf analizi
      → taslak üretimi → onay/ret akışı, hepsi gerçek Claude + gerçek Supabase ile
      çalıştı. Canlı test **D-034**'ü buldu (fotoğraf yolu kırıktı) ve onay kapısı
      gerçek veriye karşı saldırıyla doğrulandı.
- [ ] Gerçek (anonimleştirilmiş) Behördenbrief örnekleriyle doğrulama —
      şu ana kadarki tüm doğrulama SENTETİK fixture'larla yapıldı
- [x] ~~`PII_MASTER_KEY` üretim değeri + rotasyon prosedürü~~ — **2026-07-29'da YAPILDI.**
      Üretim anahtarı üretildi (`openssl rand -hex 32`) ve `.env`'e işlendi.
      Mevcut 48 şifreli kayıt KAYBEDİLMEDEN rotate edildi (`npm run rotate:pii-key`,
      key_version 1→2). Doğrulandı: profil 6/6 alan, 3 belgenin 42 token'ı tamamen
      çözülüyor, `DEV-ONLY` uyarısı kayboldu. Prosedür: **D-035**,
      araç: `npm run rotate:pii-key` (üç fazlı, fail-safe, varsayılan kuru koşum).
- [ ] RLS politikaları — yalnızca web dashboard eklenirse gerekli (şu an service_role)
- [~] Deployment (Railway) — **kod tarafı BİTTİ ve gerçek Docker ile doğrulandı**
      (`railway.json`, `/health`, `PUBLIC_BASE_URL` otomatiği, `check:deploy`,
      CI regresyon guard'ı). Kalan tek şey hesap bağlama → MANUAL §8.
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
- [x] ~~Mevcut `sb_secret_...` anahtarı da döndürülmeli~~ — **2026-07-29'da
      YAPILDI.** Bkz. R-2. Sızmış anahtar `HTTP 401` ile ölü, uygulama yeni
      anahtarla çalışıyor, vault 48/48 sağlam.
      ⚠️ Railway'e dağıtım yapıldığında Variables'a **yeni** anahtar girilecek
      (`.env` yalnızca yereldir).
