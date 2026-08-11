# BüKo — Devir Notu (HANDOFF) · **v3**

**Tarih:** 2026-08-11 · **HEAD:** `5e94952` · **42 commit** · **553 test geçiyor** (40 suite, 1 atlanır) · **43 karar** (D-001…D-043)

> **v3'ün tabanı hakkında dürüst not.** v2 dosya olarak bulunamadı — repoda,
> git geçmişinde, `~/Desktop` altında ve oturum hafızasında "handoff" adlı bir
> dosya yok; bu oturum da temiz bağlamla başladı. Bu yüzden v3, v2'nin üzerine
> yazılarak değil, projenin **birincil kayıtlarından** (`PROGRESS.md`,
> `DECISIONS.md`, `STATUS.md`, `TODO.md`, git geçmişi) ve bu turun doğrudan
> gözlemlerinden yeniden kuruldu. v2'de yalnızca orada bulunan bir bölüm varsa
> BURADA YOKTUR — v2 elinizdeyse paylaşın, birleştireyim.

---

## 1. Tek cümlede

Almanya'daki göçmenlerin resmî kurum yazışmalarını yöneten Telegram botu:
mektup fotoğrafı/metni gelir → kimlik bilgileri **yerelde maskelenir** → Claude
analiz eder (kurum, talep, son tarih, risk, eksik belgeler) → hatırlatma kurulur
→ istenirse resmî dilde taslak yanıt üretilip **insan onayına** sunulur.

**Konumlandırma (kodda ve README'de korunmalı):** hukuki tavsiye değil,
bilgilendirme/hazırlık asistanı. Bot her oturumda yapay zekâ olduğunu bildirir.

---

## 2. 🚀 CANLI — üretim koordinatları

| | |
|---|---|
| **Uygulama** | https://b-ko-production.up.railway.app |
| **Bot** | @BuKo749_bot |
| **Railway** | proje `resplendent-generosity` · servis `B-Ko` · env `production` · **1 replika** |
| **GitHub** | `burakerdgn1/B-Ko` (private) · dal `main` · her push'ta CI |
| **Supabase** | `gvvsuelxvwdjlobaqmgq` · 8/8 tablo · `DB_DRIVER=supabase` |
| **Model** | `claude-sonnet-5` |

### Uçtan uca doğrulandı (2026-08-11)

```
LOG [Bootstrap]       BüKo production modunda :8080 portunda çalışıyor
LOG [TelegramService] Telegram webhook kaydedildi:
                      https://b-ko-production.up.railway.app/webhook/telegram
```

| Kontrol | Sonuç |
|---|---|
| `GET /health` | ✅ 200 `{"status":"ok","uptime":N}` |
| Açılış modu | ✅ `production` — güvenlik kapısı (`superRefine`) aktif |
| Webhook | ✅ doğru adres · `last_error_message` boş · 0 bekleyen update |
| **Fail-closed (D-030), canlı üretimde** | ✅ sırsız → **401** · yanlış sır → **401** |
| `railway run npm run check:deploy` | ✅ **GO** — 0 hata |
| CI (GitHub Actions) | ✅ başarılı — D-039 Docker guard'ı dâhil |
| **Gerçek kullanıcı akışı** | ✅ fotoğraf → `analyzed` · Ausländerbehörde Berlin · `critical` · son tarih 2024-06-30 · 4 eksik belge · güven 0.95 |
| Üretim kaydının gizlilik denetimi | ✅ 16 yer tutucu · vault'taki 20 gerçek değerin **hiçbiri** içerikte yok · desen taraması 0 kalıntı |

> Doğru sırla sahte update **kasıtlı olarak gönderilmedi** — gerçek bota
> enjeksiyon olurdu. Fail-closed testi yalnızca reddedilme yolunu sınar.

### Dağıtım mimarisi notları

- **`runtime` aşaması Dockerfile'ın SONUNDA olmalı.** Hedefsiz `docker build`
  (Railway'in yolu) daima son aşamayı derler. Sıra bozulursa Railway sessizce
  ~2 GB / Node 20 Playwright imajını üretir. CI bunu hedefsiz build edip
  Node 22 + Alpine + tarayıcı binary'si yokluğunu doğrulayarak korur (D-039).
- **`numReplicas: 1` bilinçli.** Cron (`@nestjs/schedule`) süreç içinde çalışır;
  ikinci replika hatırlatmaları çift gönderir ve GDPR silmesini çakıştırır.
  Yatay ölçekleme için zamanlayıcı ayrı servise çıkarılmalı (v2 kapsamı).
- **`PUBLIC_BASE_URL` Railway'de GİRİLMEZ** — `RAILWAY_PUBLIC_DOMAIN`'den
  türetilir. Açıkça verilen değer her zaman kazanır (özel alan adı için).

---

## 3. Doğrulama komutları

```bash
npm test                       # 553 test, hermetik (.env'den izole)
npm run check:deploy           # GO/NO-GO — token harcamaz
railway run npm run check:deploy   # PLATFORMDAKİ gerçek değişken setiyle
npm run test:supabase          # gerçek Postgres'e karşı 16 entegrasyon testi
npm run live:check             # gerçek Claude + gerçek Supabase (⚠️ ücretli)
npm run eval:prompts           # 14 fixture ile prompt doğruluğu (⚠️ ücretli)
npm run rotate:supabase-key    # Supabase secret rotasyonu (fail-safe)
npm run rotate:pii-key         # PII vault anahtar rotasyonu (veri kaybetmeden)
```

---

## 4. 🔐 Güvenlik duruşu

### Anahtar durumu

| Anahtar | Durum |
|---|---|
| Supabase `sb_secret` (`bukov`) | 🟢 Aktif — **rotate edildi**, eskisi (`bukov2`) `HTTP 401` |
| `PII_MASTER_KEY` | 🟢 Üretim değeri · `key_version: 2` · 62 şifreli kayıt |
| `ANTHROPIC_API_KEY` | 🟢 Aktif (eski anahtar iptal, 401 ile doğrulandı) |
| `TELEGRAM_BOT_TOKEN` / `WEBHOOK_SECRET` | 🟢 Aktif · webhook sırrı Railway'de tanımlı |
| Supabase `default` secret | 🟡 **Kullanılmıyor ama canlı** — silinmesi öneriliyor |

### D-037 — Supabase rotasyonu: doğrulama ÖNCE, yazma SONRA

D-035'in (PII anahtarı) **tersi** sırayla çalışır. Orada risk veri kaybıydı
(yanlış anahtar → AES-GCM auth tag bozulur → kayıtlar kalıcı okunamaz), burada
hizmet kaybı (hatalı anahtar → uygulama açılmaz). Bu yüzden önce **tam
doğrulama**, sonra yazma.

"Tam doğrulama" salt-okunur DEĞİL: `/rest/v1/` ile anahtar **türü**
(publishable yapıştırmak en olası insan hatası ve o anahtar bazı salt-okunur
probe'ları geçerdi), 8/8 tablo, ve gerçek `insert → read-back → delete`
round-trip'i. `.env` yedeği **bilinçli olarak yazılmaz** — bir `.env.bak`,
canlı secret'ın diskteki ikinci kopyası olurdu; atomik `tmp`+`rename` (0600),
hedef satır tam 1 kez bulunmazsa yazma iptal.

### 🔴 D-040 — Rotasyonun altın kuralı (en kolay unutulan ders)

> **Yeni anahtar, rotasyonu TETİKLEYEN kanaldan geçmemeli.**

Rotasyonun sebebi eski anahtarın sohbet transkriptinde görünmesiydi. Yeni
anahtarı `SUPABASE_KEY_NEW=... npm run ...` biçiminde asistan oturumuna yazmak,
onu da aynı transkripte sokar — yani rotasyon, kapattığı borcu **aynı anda
yeniden yaratır**. Bu yüzden `--apply` adımı kullanıcının kendi terminalinde
koşuldu; oturuma yalnızca maskeli parmak izi ulaştı.

Araç bu ayrımı destekleyecek şekilde tasarlandı: sır içeren adım (`--apply`)
ile doğrulama adımları (`--check-revoked`, `test:supabase`, `check:deploy`)
ayrı komutlar ve doğrulama adımlarının hiçbiri yeni anahtarın **değerini**
istemez — `.env`'den okurlar.

**Eski anahtar için kural farklı:** paylaşılabilir, ama **yalnızca revoke
edildikten SONRA.** Bu turda sıra karıştı; anahtar revoke'tan önce paylaşıldı ve
kısa süre hem canlı hem transkriptte kaldı. Zarar sınırlıydı (`pii_vault`
içeriği ayrıca `PII_MASTER_KEY` ile şifreli ve o hiç paylaşılmadı).

**Yayılma gecikmesi:** revoke'tan hemen sonraki kontrol `HTTP 200`, kısa süre
sonraki `HTTP 401` döndü. Tek bir "hâlâ canlı" ölçümü kesin kanıt DEĞİLDİR —
iptal doğrulaması tekrarlanmalı.

---

## 5. 🕳️ Kör noktalar — üretimde bulundu, tekrar etmesin

### D-042 — "Deploy yeşil, bot sağır"

İlk Railway dağıtımı **başarılı görünüyordu**: konteyner ayakta, `/health` 200,
platform yeşil. Ama bot hiçbir mesaj alamıyordu. Üç Variables hatası vardı ve
**hiçbiri konteyneri çökertmediği için platformun sağlık göstergeleri bunları
göremezdi**:

| Değişken | Yanlış | Sonuç |
|---|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | **hiç yoktu** | `webhook KAYDEDİLMEDİ` — kayıt denenmedi bile |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | açık değer kazandığı için `RAILWAY_PUBLIC_DOMAIN` otomatiği devreye girmedi |
| `NODE_ENV` | `development` | **üretim güvenlik kapısı hiç çalışmadı** |

**`NODE_ENV` özellikle sinsi:** Dockerfile `runtime` aşamasında
`ENV NODE_ENV=production` var ama **platform Variables bunu EZER**. Yani imaj
doğru varsayılanı taşısa bile ortam sessizce geri alabiliyor —
`LLM_MOCK=true`, dev PII anahtarı ve `DB_DRIVER=memory` teknik olarak serbest
kalmıştı; tam da D-005'te "üretimde imkânsız" diye kapatılan şeyler.

**Teşhisi 553 test değil, tek bir log satırı sağladı:**
`TELEGRAM_WEBHOOK_SECRET tanımsız — webhook KAYDEDİLMEDİ`. Bu, D-030'un
fail-closed tasarımının ikinci faydası: yalnızca reddetmiyor, **sebebini
loglayıp sessiz başarısızlığı görünür kılıyor.**

### D-041 — Doğrulama aracının kendisi yanlış "GO" verdi

`railway run npm run check:deploy` ilk koşuda **"✓ webhook sırrı tanımlı"**
dedi — oysa Railway'de yoktu. Kök neden: `railway run` platform değişkenlerini
enjekte eder, ama script ayrıca `dotenv` ile yerel `.env`'i yüklüyordu.
`dotenv` mevcut `process.env`'i **ezmez**; dolayısıyla platformda **yanlış**
olanlar doğru okunuyordu (bu yüzden `PUBLIC_BASE_URL` hatası yakalandı) ama
platformda **EKSİK** olanlar sessizce `.env`'den dolduruluyordu.

Yani araç, "asıl önemli olan bu" diye belgelenen kullanımda **en tehlikeli
sınıfa (eksik değişken) kördü.**

**Düzeltme:** `RAILWAY_ENVIRONMENT`/`RAILWAY_PROJECT_ID` görünüyorsa (ya da
`--no-dotenv`) `.env` **hiç** yüklenmez; çıktı hangi kaynağı denetlediğini
başlıkta yazar. Doğrulandı: aynı ortamda önce 1 hata, sonra 2 hata.

---

## 6. 🆕 Bu turun ana bulgusu — D-043

### Olay

Bir teşhis script'i, DB'ye erişmek için `AppModule`'ün **tamamını yerelde**
boot etti. Bu `TelegramService.onModuleInit`'i tetikledi ve yerel `.env`'deki
ölü cloudflared adresiyle `setWebhook` çağrıldı. Telegram çağrıyı
`400 bad webhook: Failed to resolve host` ile **reddetti — ama mevcut kaydı da
sildi.** `getWebhookInfo` → `url: ""`. **Üretimdeki bot birkaç dakika sağır
kaldı**; `railway redeploy` ile geri alındı.

### Kök neden: izolasyon YOKLUĞU

Bot token'ı **tek ve globaldir**. Telegram tarafında "yerel" ile "üretim"
ayrımı yoktur; aynı token'la yapılan her çağrı **aynı botu** etkiler. Yani
`AppModule`'ü yerelde boot etmek, tanım gereği üretim durumuna yazma iznidir.

**Webhook'tan daha geniş bir sorun:** `TELEGRAM_MODE=polling` olsaydı yerel
süreç update **çekmeye** başlardı — üretimdeki bota gönderilen gerçek kullanıcı
mesajları yerelde tüketilir, kullanıcı hiç cevap alamazdı. Bu, webhook'un
ezilmesinden **daha sinsi: hiçbir hata logu üretmez.**

### Düzeltme

- **`TELEGRAM_SKIP_STARTUP`** (boolish, varsayılan `false`) →
  `onModuleInit`'te **EN BAŞTA**, mode/token kontrollerinden **önce** sınanır.
  Sonra sınansaydı geçerli bir webhook yapılandırmasında sızıp çalışırdı.
  Bayrak açıkken grammY `Bot` nesnesi **hiç oluşturulmaz** (nesne varsa ağ
  çağrısı yapılabilir hâle gelir).
- **`scripts/script-context.ts`** → script'ler artık `NestFactory` çağırmaz,
  `bootScriptContext()` kullanır ve bayrak **varsayılan olarak açık** gelir.
  Kanal yan etkisi isteniyorsa `{ allowChannels: true }` ile **açıkça**
  istenmeli. Amaç doğru davranışı VARSAYILAN yapmak — gelecekteki script'ler
  hatırlamak zorunda kalmasın.
- **Uygulandığı yerler:** `live-check.ts`, `rotate-pii-key.ts` (ikisi de aynı
  tuzağı taşıyordu, fark edilmemişti).

### Doğrulama

`rotate:pii-key` kuru koşumu **gerçekten çalıştırıldı** (tam `AppModule` boot
eden yol); öncesi/sonrası `getWebhookInfo` **değişmedi**, 62/62 vault kaydı
çözüldü. 6 regresyon testi: bayrak açıkken TAM geçerli webhook
yapılandırmasında bile bot başlamıyor · polling'de de başlamıyor · bayrak
kapalıyken davranış birebir aynı · boş string varsayılana düşüyor (D-020
tuzağı). **553 test geçiyor**, `tsc` temiz, push edildi, CI yeşil.

### ⚠️ KAPATILMAYAN KISIM — `npm run start:dev` korunmuyor

Guard yalnızca bakım script'lerini kapsar. Uygulamayı yerelde
`TELEGRAM_MODE=webhook` veya `polling` ile açmak **hâlâ üretimdeki botu
etkiler.** Bu bilinçli: orada bot başlatmak *doğru davranış* — asıl çözüm kod
değil hesap işi.

**Gereken:** @BotFather'dan **ikinci bir test bot token'ı**. O güne kadar
yerelde `TELEGRAM_MODE=disabled` kullanın.
Kayıtlı: `docs/DEPLOYMENT.md §8a`, `.env.example`, `TODO.md` (P-7).

---

## 7. Önceki turun yanlış alarmı — düzeltilmiş kayıt

Bir önceki turda "son tarih alanı boş, hatırlatma kurulamaz, ürün açısından
anlamlı bir kayıp" diye rapor edilmişti. **Bu YANLIŞTI.**

Sebep: denetim script'i `analyses.deadline` okuyordu; sütunun gerçek adı
**`deadline_date`**. Olmayan alan `undefined` döndü ve "—" olarak basıldı.

**Gerçek durum — çıkarım mantığında hata yok:**

```
[[DATE_1]] = "12.03.1990" → 1990-03-12   (doğum tarihi)
[[DATE_2]] = "15.05.2024" → 2024-05-15
[[DATE_3]] = "02.04.2024" → 2024-04-02
[[DATE_4]] = "30.06.2024" → 2024-06-30   ← model doğru olanı seçti
```

`deadline_date = 2024-06-30` DOLU. Model dört tarih arasından son tarih olanı
doğru ayırt etmiş (D-009 token sözleşmesi çalışıyor), `parseGermanDate` doğru
çözmüş. **Hatırlatma sayısının 0 olması da doğru davranış:** son tarih bugüne
göre 772 gün geçmişte (sentetik fixture), `reminderDatesFor()` geçmiş noktaları
eler. Aynı sebeple risk `critical`'a yükseltilmiş.

Ayrıca: üretimden gelen **fotoğrafın** `masked_text`'i, 28 Temmuz'daki **metin**
girdisiyle bayt-bayt aynı (sha1 `53b37dd29c`) — yani aynı mektup.

---

## 8. 🧭 Tekrar eden ders: aracı da doğrula

Bu projede **dört kez** doğrulama aracının kendisi yanıldı:

| # | Araç | Ne oldu |
|---|---|---|
| D-033 | `eval:prompts` | Maskeli çıktıyı ham beklentiyle karşılaştırıyordu → model hatası sanıldı |
| D-039 | CI Docker guard | "playwright paketi bulunmamalı" varsayımı yanlıştı (optionalDependency) |
| D-041 | `check:deploy` | Platform ortamında `.env` yükleyip eksik değişkeni gizledi → yanlış GO |
| — | teşhis script'i | Olmayan sütunu okuyup sahte bir ürün hatası uydurdu |

Dördünde de hatayı yakalayan şey aynıydı: **aracın çıktısını bağımsız bir
kanıtla karşılaştırmak** (loglar, şema, imaj içeriği, ham kayıt). Bir aracın
"✓" demesi, doğrulamanın kendisi değildir.

**Ek ders (D-043):** "Sadece okuyacağım" diye yazılan bir script tüm uygulamayı
boot ediyorsa okuma script'i değildir. Bağlam ne kadar geniş boot edilirse o
kadar çok `onModuleInit` — yani o kadar çok dış dünya yan etkisi — devreye
girer. Refleks: script'e **minimum** bağlamı ver.

---

## 9. Gizlilik duruşu (ürünün moat'ı)

- **PII asla ham çıkmaz.** Maskeleme LLM çağrısından ÖNCE yerelde yapılır;
  yanıt gelince yerelde geri eşlenir. `llm.leak-guard.spec.ts` API payload'ını
  denetler.
- **Onboarding profili** (D-027) kullanıcının kendi ad/adres bilgisini bir kez
  alır, `pii_vault`'ta **şifreli** saklar ve her belgede bilinen-değer
  maskelemesini besler.
- **Üçüncü taraf isimleri** (D-029) tetikleyici bağlamlarda maskelenir
  (`Sehr geehrte Frau X`, `Sachbearbeiterin: X`, …) — deterministik, NER yok.
- **İnsan onayı zorunlu** (D-014/D-022): onay kapısı **DB trigger'ı** seviyesinde;
  `rejected→sent`, aynı çağrıda `approvedAt` uydurma ve doğrudan `sent` INSERT
  gerçek Postgres'te reddedildi.
- **GDPR Art. 17:** `purge_expired_data()` + cascade silme, gerçek DB'de test edildi.

### Bilinçli boşluklar (dürüst liste)

- **D-010 — OCR istisnası.** `OCR_PROVIDER=claude-vision` iken mektup
  **GÖRSELİ** ham PII ile Anthropic'e ulaşır. Sonraki tüm adımlar maskeli
  metinle çalışır. **Üretimde şu an `claude-vision`.**
  🔴 **Ve ilan edilen kaçış yolu yok:** `OCR_PROVIDER=local` fiilen çalışmıyor —
  `LocalOcrProvider` `tesseract.js`'i lazy import ediyor ama paket
  `package.json`'da HİÇ yok; `local` seçilirse ilk fotoğrafta patlar. Yani
  "sıfır sızıntı seçeneği mevcut" iddiası bugüne kadar **yanlış** sunulmuş.
  Gerekli: `npm i tesseract.js` + üretimde gerçek fotoğrafla doğrulama.
- **D-028 — tetikleyicisiz isimler.** Hiçbir unvan/etiket olmadan cümle içinde
  geçen adlar maskelenmez ("Der Antrag wurde von Petra Hoffmann geprüft").
  Yerel NER gerektirir (v2). Kalıcı test bu sınırı sabitler.

---

## 10. Açık işler

### Kullanıcı eylemi gerektiren
1. **`default` Supabase secret anahtarını sil** — kullanılmıyor (kod envanteri
   ile doğrulandı), ama RLS'i bypass ediyor. Dashboard'da "Last used" boşsa sil.
2. **İkinci bir test bot token'ı** (@BotFather) — `start:dev` koruması için (P-7).
3. **`OCR_PROVIDER` kararı** — `claude-vision` (D-010 ödünü) mü, `local` mi?

### Kod tarafı
4. **CI'da Playwright testleri sessizce atlanıyor** — `appointment-checker.spec.ts`
   gerçek Chromium ister, CI kurmuyor (CI 544/19, yerel 553/16). Randevu izleme
   PoC'sinin TEK gerçek testi CI'da hiç koşmuyor. Düzeltme tek satır:
   `npx playwright install chromium`.
5. **Gerçek (anonimleştirilmiş) Behördenbrief'lerle doğrulama** — bugüne kadarki
   tüm doğrulama sentetik fixture'larla.
6. **Yerel NER** → D-028 boşluğu (v2).
7. **RLS politikaları** — yalnızca web dashboard eklenirse gerekli.
8. **WhatsApp adapter** — v2 (`ChannelAdapter` arayüzü hazır).

---

## 11. Kod haritası (hızlı yönelim)

```
src/
  config/           env.schema.ts ← TÜM ortam doğrulaması + üretim kapısı
  common/
    crypto/         AES-256-GCM zarf (pii_vault)
    pii/            maskeleme motoru + desenler  ← ürünün moat'ı
  modules/
    channels/telegram/  adapter · service (onModuleInit!) · controller (webhook)
    analysis/       pipeline.ts · deadline.util.ts
    drafts/         taslak üretimi + onay state machine
    persistence/    memory + supabase repository'ler
    reminders/      cron: hatırlatma + GDPR silme
    watcher/        Playwright randevu izleme PoC (opsiyonel)
    health/         /health liveness probe
scripts/            script-context.ts ← YENİ script'ler bunu kullanmalı
supabase/migrations/  0001_init.sql (onay kapısı trigger'ı) · 0002
```

**Okuma sırası (yeni gelen için):** `CLAUDE.md` → bu dosya → `STATUS.md` →
`ARCHITECTURE.md` → `DECISIONS.md` (kritik: D-010, D-014, D-030, D-038, D-040,
D-041, D-042, D-043).
