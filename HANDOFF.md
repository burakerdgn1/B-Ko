# BüKo — Devir Notu (HANDOFF) · **v4**

**Tarih:** 2026-08-12 · **`main` = `01f3817`** · **659 test geçiyor** (46 suite, 1 atlanır) · **50 karar** (D-001…D-050) · **üretimde canlı ve doğrulandı**

> ### v4 — bir turda kapatılan altı karar
>
> Hepsi aynı akışla üretime alındı: **feature dalı → PR → CI yeşil DOĞRULANDI →
> ancak ondan sonra** `main`'e fast-forward merge → Railway otomatik deploy →
> deploy bağımsız doğrulandı.
>
> | Karar | Konu | Durum |
> |---|---|---|
> | D-045 | CI'da Playwright testlerinin sessiz atlanması yasaklandı | ✅ üretimde |
> | D-046 | OCR bozulmalarına dayanıklı maskeleme — **D-044 blokajı kalktı** | ✅ üretimde |
> | D-047 | Yerel geliştirme izolasyonu: ayrı test botu + cron guard'ı | ✅ üretimde |
> | D-048 | Gerçek mektup düzeneği · yerel DB izolasyonu · `scripts/` tip kontrolü · yetim süreçler | ✅ üretimde |
> | D-049 | Test hermetikliği açıkça sabitlendi | ✅ üretimde |
> | D-050 | CI sonucu beklenmeden merge'den söz edilmez (süreç kuralı) | ✅ CLAUDE.md §8.1 |
>
> **Ortak desen — bu turun asıl dersi:** yedi ayrı sessiz arıza bulundu ve
> **hiçbiri hata üretmiyordu.** Hepsini yakalayan şey aracın "✓" demesine değil,
> **bağımsız bir kanıta** bakmaktı (§8). Ayrıntı: `STATUS.md` → "Bu turda
> bulunan ve kapatılan sessiz arızalar".

> **v3'ün tabanı.** v2 repoda dosya olarak yoktu (sohbet üzerinden paylaşıldı).
> v3 önce birincil kayıtlardan (`PROGRESS.md`, `DECISIONS.md`, `STATUS.md`,
> `TODO.md`, git geçmişi) kuruldu; ardından v2'de bulunup burada eksik olan
> bölümler (**§0 Bu doküman kimin için**, **§2b Ortam/Kurulum ve Claude Code
> çalışma notları**, **§12 Oturum yürütme notları**) eklendi.
>
> v2'nin "açık işler" listesi kasıtlı olarak DEVREDİLMEDİ: o listedeki
> D-037 (Supabase rotasyonu) ve D-038/D-039 (Railway) maddeleri **tamamlandı**;
> güncel durum §4, §2 ve §10'da.

---

## 0. Bu doküman kimin için

Yeni bir **Cowork/Claude oturumuna devretmek** için hazırlandı. Amaç: Burak'ın
Claude Code ile yürüttüğü otonom BüKo implementasyonuna kesintisiz destek
verebilmek. v1 → v2 → v3 zinciri; proje bu süreçte MVP'den **canlı, üretimde
çalışan** bir ürüne geçti.

**Rol ayrımı (önemli):** Ağır implementasyon **Claude Code**'un yerel
oturumunda yürüyor (repo, `.env`, gerçek anahtarlar orada). Bu doküman, o işi
takip eden/koordine eden oturum içindir. İkisi aynı makinede ama **aynı bağlam
değil**.

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
| **Bot (üretim)** | `@BuKo749_bot` |
| **Bot (yerel test)** | `@BuKoTest749_bot` — ayrı token, `.env`'de (D-047) |
| **Railway** | proje `resplendent-generosity` · servis `B-Ko` · env `production` · **1 replika** |
| **GitHub** | `burakerdgn1/B-Ko` (private) · dal `main` · her push'ta CI |
| **Supabase** | `gvvsuelxvwdjlobaqmgq` · 8/8 tablo · üretimde `DB_DRIVER=supabase` |
| **Model** | `claude-sonnet-5` |

> ⚠️ **Yerelde `DB_DRIVER=memory`** (D-048b) — bu tablo ÜRETİM koordinatlarıdır.
> Yerel `.env` üretim veritabanına yazmaz; gerçek DB gerektiren script'ler onu
> açıkça talep eder (`DB_DRIVER=supabase npm run live:check`).

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

## 2b. Ortam / Kurulum (v2'den devralındı, güncellendi)

- **Repo:** `/Users/burakerdogan/Desktop/claude test/B-Ko` (yerel).
- **`CLAUDE.md` repo kökünde** — proje tanımı, mimari, otonomi direktifleri
  orada. Yeni oturumda önce bunu okutmak yeterli. (`AGENTS.md` aynı içeriğin
  Codex sürümü.)
- **`.claude/settings.json`:** `defaultMode: bypassPermissions` + tehlikeli
  komut deny listesi. Kalıcı, tekrar kurulmasına gerek yok.
- **Claude Code:** Claude Max planı, Opus 5, 1M context. 5 saatlik/haftalık
  limite birkaç kez takıldı — "devam et" ile çözülüyor; terminal kapanmasından
  `claude --continue` ile kurtarıldı (kanıtlanmış, çalışıyor).
- **Gerçek altyapı:** gerçek Supabase projesi (AB bölgesi), gerçek Anthropic
  anahtarı, gerçek Telegram botu (@BuKo749_bot).
- **`git` bozuk:** `/usr/bin/git` çalışmayan bir Xcode kurulumuna bağlı
  (`xcodebuild` hatası). Tam yol kullanılıyor:
  `/Library/Developer/CommandLineTools/usr/bin/git`. Kalıcı düzeltme:
  `sudo xcode-select --switch /Library/Developer/CommandLineTools` (D-001).
  Aynı sebeple `/usr/bin/python3` de bozuk — YAML doğrulaması için `js-yaml`
  kullanıldı.
- **Railway CLI** kuruldu (`npm i -g @railway/cli`), oturum açık, proje bu
  dizine bağlı (`railway link`). `railway login`/`link` **interaktif** — asistan
  çalıştıramaz, kullanıcı `!` önekiyle kendi çalıştırmalı.

### ⚠️ cloudflared tüneli artık GEREKMİYOR

v2'de "tünel ayrı terminalde açık tutulmalı" yazıyordu. **Bu artık geçersiz:**
uygulama Railway'de kendi kalıcı domaini ile çalışıyor
(`b-ko-production.up.railway.app`). Tünel yalnızca yerel geliştirme için gerekir
— ve o durumda bile aşağıdaki uyarı geçerli.

### ✅ Yerel geliştirme artık İZOLE (D-047 / D-048)

v2'deki "`start:dev` ile başlatmamalı" uyarısı **artık geçersiz** — ama izolasyon
iki ayrı yüzeyde ayrı ayrı kurulduğu için ikisini de bilmek gerekiyor:

| Yüzey | Nasıl izole edildi |
|---|---|
| Telegram kanalı | Ayrı test botu `@BuKoTest749_bot` (`.env`) · yerel mod `polling` |
| Zamanlayıcı (cron) | `SCHEDULER_SKIP_STARTUP=true` — ayrı token bunu KAPSAMIYORDU |
| Veritabanı | Yerel `DB_DRIVER=memory` — mesaj işleme yolu guard'lanamaz |

Servis açılışta hangi botu sürdüğünü loglar (üretim dışında `warn`):
`Telegram botu: @BuKoTest749_bot — mod=polling, ortam=development`.

⚠️ **Yeni bir makinede `.env` kurarken üretim token'ını yapıştırmayın.** Kod
bunu engelleyemez; tek uyarı o log satırıdır. Şüphe varsa `getMe` ile doğrulayın.

⚠️ Gerçek DB gerektiren script'ler artık `memory` ile çalışmayı **reddediyor**
(`live:check`, `rotate:pii-key`) — aksi hâlde `rotate:pii-key` boş kasada
"0 kayıt, başarılı" derdi. Tek seferlik: `DB_DRIVER=supabase npm run <komut>`.

### 🔍 Oturum sonu refleksi: yetim süreç taraması (D-048d)

```bash
ps -eo pid,etime,command | grep -E "dist/main|ts-node.*B-Ko" | grep -v grep
```

Gerçek vaka: makinede **13 gündür** çalışan bir `node dist/main.js` (D-038
öncesi eski build, `:3000`'i işgal ediyordu) ve 1,5 saatlik bir yetim
`ts-node src/main.ts` (test botunu polling'e devam ediyordu) bulundu. İkincisi
"öldürdüm" sanılan bir süreçti: `spawn`'a `detached: true` verilmediği için
süreç grubu yoktu ve yalnızca `npx` sarmalayıcısı ölmüş, torun süreç kalmıştı.

Bu, D-047b'nin "yerel örnek = ikinci replika" uyarısının **varsayımsal
olmadığının** kanıtı. Ve bu sınıf tehlike sessizdir: boş tablolarda cron'lar
hiçbir iz bırakmaz, dolayısıyla "zarar vermedi" ancak süreç bulunup
sonlandırıldıktan sonra söylenebilir.

## 3. Doğrulama komutları

```bash
npm test                       # 659 test, hermetik (jest.setup.ts ile SABİTLENDİ — D-049)
npm run typecheck:scripts      # scripts/ tip kontrolü (kök tsc bunu KAPSAMAZ — D-048c)
npm run check:real-fixtures    # gerçek mektup anonimleştirme kontrolü (D-048a)
npm run check:deploy           # GO/NO-GO — token harcamaz
railway run npm run check:deploy   # PLATFORMDAKİ gerçek değişken setiyle
npm run test:supabase          # gerçek Postgres'e karşı 16 entegrasyon testi
npm run live:check             # gerçek Claude + gerçek Supabase (⚠️ ücretli)
npm run eval:prompts           # 14 fixture ile prompt doğruluğu (⚠️ ücretli)
npm run rotate:supabase-key    # Supabase secret rotasyonu (fail-safe)
npm run rotate:pii-key         # PII vault anahtar rotasyonu (veri kaybetmeden)
npm run bench:ocr-mask         # OCR ↔ maskeleme dayanıklılık ölçümü (D-046)
```

> `bench:ocr-mask` önbellekli çalışır: `test-fixtures/ocr/` altındaki GERÇEK
> tesseract çıktılarını kullanır, token harcamaz, saniyeler sürer. `--write`
> ile çıktıları yeniden üretir (Playwright render + OCR, ~15 sn/mektup).
> Ölçüm bozuksa **çıkış kodu 1** döner — sessiz "GO" vermez (D-041 dersi).

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

**Ek ders (D-046) — dersin OLUMLU tarafı.** OCR dayanıklılığı çalışmasında bu
refleks baştan uygulandı: girdi elle uydurulmuş "bozuk metin" değil **gerçek
tesseract çıktısı**, ikinci metrik ise maskeleme kurallarından bağımsız
(Levenshtein). Karşılığını da verdi — bağımsız oracle, token sayımının
GÖRMEDİĞİ iki gerçek sızıntı buldu (`MénckebergstraBe 7`, `Diisseldorf`) ve
üstüne OCR'dan tamamen bağımsız, önceden var olan bir desen boşluğunu
(`Karl-Marx-Allee` hiç maskelenmiyordu) ortaya çıkardı. Ayrıca oracle'ın
KENDİSİ de teste bağlandı: artığı bulabildiği ayrıca kanıtlanıyor, yoksa
"0 sızıntı" hiçbir şey ifade etmezdi.

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
  ✅ **Kaçış yolu artık GERÇEKTEN mevcut:** `tesseract.js` eklendi (D-044) ve
  onu kullanılamaz kılan gizlilik regresyonu kapatıldı (D-046) — maskeleme OCR
  bozulmalarına dayanıklı, `npm run bench:ocr-mask` 14 mektupta 0 kayıp/0 artık.
  ⚖️ Geçiş kararı hâlâ **kullanıcınındır** ve önce gerçek bir telefon
  fotoğrafıyla doğrulanmalıdır: D-046 ölçümü temiz bir A4 render'ı üzerinde,
  yani gerçek dünyanın iyimser alt sınırı.
- **D-028 — tetikleyicisiz isimler.** Hiçbir unvan/etiket olmadan cümle içinde
  geçen adlar maskelenmez ("Der Antrag wurde von Petra Hoffmann geprüft").
  Yerel NER gerektirir (v2). Kalıcı test bu sınırı sabitler.

---

## 10. Açık işler

> **Kod tarafında bekleyen iş YOK.** Aşağıdaki 1-3 yalnızca kullanıcının
> yapabileceği dış-dünya eylemleri; 4-6 bilinçli v2 kapsamı.

### Kullanıcı eylemi gerektiren (sıralı — 1, 3'ün ön koşulu)

1. 🥇 **Gerçek (anonimleştirilmiş) Behördenbrief'ler.** Bugüne kadarki TÜM
   doğrulama sentetik (D-005). **Düzenek hazır (D-048a):**
   `test-fixtures/real/` altına `.txt` + `expected.json` bırakmak yeterli,
   testler kendiliğinden koşar. Dizin `.gitignore`'da (gerçek insan verisi).
   Bırakmadan önce `npm run check:real-fixtures` — maskelemenin ne gördüğünü
   **değerleri basmadan** raporlar. Ayrıntı: `test-fixtures/real/README.md`.
   > **Neden en değerli:** D-046'da, OCR'la hiç ilgisi olmayan ve sentetik
   > fixture'larda **yıllardır** duran bir desen boşluğu (`Karl-Marx-Allee`
   > hiç maskelenmiyordu) ancak yeni bir bakış açısıyla görülebildi.

2. **`default` Supabase secret anahtarını sil** — kullanılmıyor (kod envanteri
   ile doğrulandı), ama RLS'i bypass ediyor. Dashboard'da "Last used" boşsa sil.
   > Asistan bunu **bağımsız doğrulayamaz**: anahtar listelemek `sbp_`
   > Management API token'ı ister, anahtarın değeri ise kasıtlı olarak hiç
   > istenmedi (D-040).

3. **`OCR_PROVIDER` kararı** — `claude-vision` (D-010 ödünü: mektup GÖRSELİ ham
   PII ile sağlayıcıya gider) mi, `local` mi? **Teknik blokaj kalmadı** (D-046,
   14 mektupta 0 kayıp/0 artık). Kalan tek şart: ölçümün **gerçek bir telefon
   fotoğrafıyla** tekrarlanması — mevcut ölçüm temiz bir A4 render'ı üzerinde,
   yani gerçek dünyanın **iyimser alt sınırı**. Yani 1. maddeye bağlı.

### v2 kapsamı (bilinçli ertelendi)

4. **Yerel NER** → D-028 boşluğu (tetikleyicisiz üçüncü taraf isimleri).
5. **RLS politikaları** — yalnızca web dashboard eklenirse gerekli.
6. **WhatsApp adapter** — `ChannelAdapter` arayüzü hazır.

### Bu turda kapananlar (ayrıntı: `DECISIONS.md`)

CI'da Playwright sessiz atlaması (D-045) · OCR dayanıklı maskeleme (D-046) ·
yerel geliştirme izolasyonu — bot + cron + DB (D-047, D-048b) · gerçek mektup
düzeneği (D-048a) · `scripts/` tip kontrolü (D-048c) · yetim süreçler (D-048d) ·
test hermetikliği (D-049) · CI/merge süreç kuralı (D-050).

---

## 11. Kod haritası (hızlı yönelim)

```
src/
  config/           env.schema.ts ← TÜM ortam doğrulaması + üretim kapısı
  common/
    crypto/         AES-256-GCM zarf (pii_vault)
    pii/            maskeleme motoru + desenler  ← ürünün moat'ı
      ocr-tolerance.ts   OCR karışıklık tablosu (ß→B, ö→é, ü→ii…)   [D-046]
      ocr-residue.ts     Levenshtein artık taraması — BAĞIMSIZ oracle [D-046]
    testing/        boot-with-config.ts ← env override'ı GERÇEKTEN etkili [D-049]
  modules/
    channels/telegram/  adapter · service (onModuleInit!) · controller (webhook)
    analysis/       pipeline.ts · deadline.util.ts
    drafts/         taslak üretimi + onay state machine
    persistence/    memory + supabase repository'ler
    reminders/      cron: hatırlatma + GDPR silme  ← guard EN BAŞTA [D-047]
    watcher/        Playwright randevu izleme PoC (opsiyonel)
    health/         /health liveness probe
scripts/            script-context.ts ← YENİ script'ler bunu kullanmalı
                    ocr-mask-bench.ts · check-real-fixtures.ts
test-fixtures/
  behordenbriefe/   14 sentetik mektup (D-005)
  ocr/              GERÇEK tesseract çıktıları — ölçüm tekrarlanabilir [D-046]
  real/             gerçek anonimleştirilmiş mektuplar — GITIGNORE'DA [D-048]
supabase/migrations/  0001_init.sql (onay kapısı trigger'ı) · 0002
jest.setup.ts       hermetik taban — import'lardan ÖNCE koşar [D-049]
tsconfig.scripts.json  scripts/ tip kontrolü (kök tsconfig'e EKLEME! [D-048c])
```

⚠️ **`tsconfig.json`'ın `include`'una `scripts/**` EKLENMEZ.** `nest build` aynı
dosyayı kullanır; scripts dâhil edilirse çıktı `dist/main.js` yerine
`dist/src/main.js` olur ve Dockerfile'daki `node dist/main.js` **kırılır**
(denendi, ölçüldü). Tip kontrolü `tsconfig.scripts.json` ile ayrı yapılır.

**Okuma sırası (yeni gelen için):** `CLAUDE.md` (özellikle **§8.1** — CI kuralı)
→ bu dosya → `STATUS.md` → `ARCHITECTURE.md` → `DECISIONS.md`.

**En kritik kararlar:** D-010 (OCR gizlilik takası) · D-014 (onay kapısı) ·
D-030 (fail-closed webhook) · D-040 (rotasyonun altın kuralı) · D-041/D-042
(aracın ve platformun yanılması) · D-043/D-047/D-048 (yerel↔üretim izolasyonu)
· D-046 (OCR dayanıklı maskeleme) · D-049 (test hermetikliği) · D-050 (CI kuralı).

---

## 12. Oturum yürütme notları (v2'den devralındı)

**Anahtarlar bu sohbete ASLA yapıştırılmamalı.** Yalnızca Claude Code'un yerel
oturumuna verilmeli. D-040 bunun neden kritik olduğunu gösterdi: rotasyonun
sebebi eski anahtarın transkriptte görünmesiydi; yenisini de aynı yere yazmak
borcu anında yeniden yaratır. **Uygulanan kural:**

| | Nerede çalıştırılır | Neden |
|---|---|---|
| Sır İÇEREN adım (`--apply`) | Kullanıcının **kendi terminali** | Değer transkripte girmesin |
| Doğrulama adımları | Asistan oturumu serbest | Hiçbiri sırrın DEĞERİNİ istemiyor, `.env`'den okuyorlar |
| Eski/iptal edilmiş anahtar | Paylaşılabilir — **ama revoke SONRASI** | Zaten sızmış kabul ediliyor |

**Kullanım limitleri:** 5 saatlik/haftalık limite takılırsa "devam et" yeterli;
terminal kapanırsa `claude --continue`.

**İnteraktif komutlar asistan tarafından çalıştırılamaz** (`railway login`,
`railway link`, `git rebase -i`). Kullanıcı `!` önekiyle kendi çalıştırmalı.

**Uzun süren işler** (Docker build, CI izleme) arka planda çalıştırılmalı;
Docker Desktop kapalıysa `open -a Docker` ile açılıp beklenmeli.

### Bu projede tekrarlayan çalışma deseni

Kullanıcı "yapıldı" dediğinde bile **bağımsız kanıt aranmalı.** Bu oturumda üç
kez kullanıcının bildirdiği durum gerçekle uyuşmadı:

| İddia | Gerçek |
|---|---|
| "Railway hesabını bağladım" | Hesap vardı ama **0 proje**; GitHub repo'su da boştu (35 commit push edilmemiş) |
| "`bukov2`'yi sildim" | İlk kontrolde hâlâ canlıydı (yayılma gecikmesi); ikinci kontrolde 401 |
| "`OCR_PROVIDER=local` uygulandı" | Railway'de de `.env`'de de hâlâ `claude-vision` |

Hiçbiri kötü niyet değil — dağıtık sistemlerde "yaptım" ile "etkisi görünür
oldu" arasında gerçek bir gecikme var. Refleks: **önce ölç, sonra yaz.**

> **v4 notu — kural simetriktir.** Bu turda kullanıcı "ikinci bot token'ını
> ekledim" dedi ve `getMe` ile doğrulandığında **doğruydu** (`@BuKoTest749_bot`).
> Kural "kullanıcı yanılır" değil, **"iddia ölçülür"**. Aynı turda ölçüm
> asistanın kendi iddialarını üç kez çürüttü (aşağıda).

### v4 — asistanın KENDİ hataları (aynı standart)

Doğrulama disiplini asistana da uygulanır; bu turda üç kez tutmadı:

| Ne oldu | Nasıl yakalandı |
|---|---|
| "Yerel uygulamayı kapattım" — kapanmamıştı. `spawn`'a `detached: true` verilmediği için süreç grubu yoktu; `npx` sarmalayıcısı ölürken **torun süreç 1,5 saat yaşadı** ve test botunu polling'e devam etti | Kullanıcının bildirdiği takılı süreçten yola çıkan `ps` taraması (D-048d) |
| "660 test geçiyor" — gerçek sayı **659**'du; sayım, commit'ten önce silinen bir hata ayıklama dosyasını içeriyordu | CI'ın 659 raporlaması → CI/yerel eşitliği invaryantı (D-045) |
| "CI koşuyor, merge kararı sende" — koşu **bitmemişti** | Kullanıcı düzeltti → CLAUDE.md **§8.1** (D-050) |

**Çıkarılan kurallar:**
- Kısa ömürlü bir uygulama boot'u başlatan script `detached: true` kullanmalı,
  süreç **grubunu** öldürmeli ve öldürdüğünü `ps` ile **doğrulamalı**.
- Bir sayı raporlanmadan önce ölçümün neyi içerdiği kontrol edilmeli.
- CI tetikleyen her commit'ten sonra sonuç **beklenir**; "yeşil" demek için
  `conclusion: success` yetmez, log'dan bağımsız kanıt okunur (§8.1).
