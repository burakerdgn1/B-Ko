# BüKo — AI Bureaucracy Copilot 🇩🇪

> Almanya'daki göçmenlerin resmî kurum yazışmalarını anlamasına ve zamanında
> yanıtlamasına yardımcı olan bir Telegram asistanı.

**BüKo hukuki tavsiye vermez.** Bilgilendirme ve hazırlık asistanıdır; bağlayıcı
konularda bir avukata veya ilgili kuruma danışın.

---

## Sorun

Ausländerbehörde'den gelen bir mektup, Almanca bilmeyen biri için üç ayrı problem üretir:
**ne isteniyor**, **son tarih ne zaman**, **hangi belgeleri hazırlamalıyım**.
Kaçırılan bir Frist, oturum izninin uzatılmamasına kadar gidebilir.

BüKo bu üç soruyu yanıtlar ve **sizin kimlik bilgilerinizin** yapay zekâya
gitmesini engeller — neyin kapsandığı aşağıda **ölçülmüş** olarak listelidir.

## Nasıl çalışır

```
Kullanıcı mektup fotoğrafı gönderir
        ↓
  OCR (Claude vision veya yerel tesseract)
        ↓
  🔒 PII MASKELEME  ← kullanıcının kendi adı/adresi + tüm yapısal
        ↓             alanlar [[NAME_1]] gibi yer tutuculara çevrilir
                      (üçüncü taraf isimleri: v2)
  Claude analizi (yalnızca maskeli metin görür)
        ↓
  🔓 yerel geri çevirme
        ↓
  Özet · son tarih · risk · eksik belgeler · hatırlatmalar
        ↓
  /taslak → resmî dilde yanıt taslağı → ✋ İNSAN ONAYI → kullanıcıya metin
```

Ayrıntılı diyagramlar: [`docs/architecture-diagram.md`](docs/architecture-diagram.md)

---

## Ayırt edici özellik: PII maskeleme katmanı

Bu, sonradan eklenmiş bir "gizlilik özelliği" değil; mimarinin merkezinde.

**Nasıl:** Belgedeki kimlik bilgileri LLM'e gitmeden önce deterministik yer
tutuculara çevrilir. Model `[[STEUERID_1]]` görür, gerçek numarayı değil. Yanıt
geldiğinde yerelde geri çevrilir. Eşleme tablosu **AES-256-GCM ile şifreli**
saklanır. Maskelenen her değer için düz PII yalnızca şifreli vault'ta durur.

**Neyin kapsandığı (ölçülmüş, iddia değil):**

Onboarding'de kullanıcı kendi ad/adres bilgisini bir kez verir. Bu bilgiler
**AES-256-GCM ile şifreli** olarak `pii_vault`'ta saklanır (asla düz metin,
asla yapay zekâya gönderilmez) ve her belgede "bilinen-değer maskeleme"yi besler.

| Alan | Durum |
|---|---|
| Steuer-ID, IBAN, e-posta, telefon, tarih, Aktenzeichen, Ausländernummer, pasaport, sigorta no | ✅ Her zaman maskelenir (yapısal desen + checksum) |
| Adres — standart Alman biçimi (`…straße 12`, `10827 Berlin`) | ✅ Her zaman maskelenir |
| **Kullanıcının kendi adı ve adresi** | ✅ **Onboarding sonrası maskelenir** |
| Kullanıcının adresi — standart dışı biçim | ✅ Onboarding sonrası (birebir eşleşme) |
| **Mektuptaki ÜÇÜNCÜ TARAF isimleri** (memur, aile üyesi, avukat) | ❌ **Maskelenmez — v2** |
| Profil vermeyi reddeden (`/atla`) kullanıcının adı | ❌ Maskelenmez (kullanıcıya açıkça bildirilir) |

### ⚠️ v2 sınırlaması: üçüncü taraf isimleri

Maskeleme, **kullanıcının kendi verisi** için bilinen-değer eşleşmesine dayanır.
Mektupta geçen ve kullanıcıya ait olmayan isimler — **memurun adı**
(`Sachbearbeiterin: Frau …`), **aile üyeleri**, avukatlar, referans verilen
üçüncü kişiler — bu yöntemle yakalanamaz, çünkü sistem onları önceden bilmez ve
bir ismin *biçimi* onu tanınabilir kılmaz.

Bunları yakalamak **yerel NER (adlandırılmış varlık tanıma)** gerektirir; bu
bilinçli olarak **v2 kapsamına** bırakılmıştır (bkz. [`DECISIONS.md`](DECISIONS.md)
D-028). Bunu küçümsemiyoruz: memur adları da kişisel veridir ve şu anda
Claude'a ulaşmaktadır.

İnce bir davranış: üçüncü taraf kullanıcıyla **aynı soyadı** taşıyorsa (ör. eş),
soyadı maskelenir ama **ön adı sızar** (`Elif Kılıç` → `Elif [[NAME_2]]`). Metin
maskelenmiş *görünür* ama tam değildir. Geçici çözüm: aile üyeleri profile
`extra` alanı üzerinden eklenebilir.

**Son tarih nasıl çıkarılıyor?** Model, takvim değerini değil ilgili
`[[DATE_n]]` yer tutucusunu döndürür — hangi tarihin son tarih olduğunu
bağlamdan seçer. Gerçek tarih yerelde çözülür. Gizlilik ve işlevsellik birlikte korunur.

**Kanıt (iddia değil):**
- `unmask(mask(x)) === x` — kayıpsız round-trip
- Maskeli metinde hiçbir orijinal PII substring'i kalmadığı testle doğrulanır
- 8 gerçekçi Behördenbrief üzerinde, API'ye giden **payload denetlenerek**
  ham PII bulunmadığı kanıtlanır (`llm.leak-guard.spec.ts`)
- Maskeleme başarısız olursa çağrı **hiç yapılmaz** (fail-closed)
- **Sızıntı yalnızca payload'da değil, TÜM kanallarda denetlenir**: log satırları,
  DB'ye yazılan hata mesajları, exception/stack trace ve audit kayıtları
  (`leak-channels.spec.ts`)
- Vault, maskeli metinden ÖNCE yazılır → çözülemeyen "yetim" belge kalmaz;
  eşzamanlı analizler ve kullanıcı izolasyonu test edilir (`pipeline.concurrency.spec.ts`)
- Maskelemenin **neyi kaçırdığı** da ölçülür ve sabitlenir (`pii.gap-audit.spec.ts`)

### Dürüst sınırlama ⚠️

**Fotoğraf gönderildiğinde OCR adımı bir istisnadır.** Bir mektup görseli
zorunlu olarak PII içerir; `claude-vision` modunda bu görsel Anthropic'e ulaşır.
Maskeleme, bundan **sonraki** her adımı (analiz, taslak üretimi, veritabanı,
denetim izi) korur.

Sıfır sızıntı isteyenler için: `OCR_PROVIDER=local` (tesseract.js ile yerel OCR).
Metin/PDF girdilerinde ham veri zaten hiç LLM'e gitmez.
Ayrıntı: [`DECISIONS.md`](DECISIONS.md) D-010.

---

## Güvenlik kuralları (kod seviyesinde zorlanır)

| Kural | Nasıl zorlanıyor |
|---|---|
| **Hiçbir şey kullanıcı adına kuruma gönderilmez** | Kodda kuruma giden hiçbir kanal yok. Onay yalnızca metni kullanıcıya verir; mesaj bunu açıkça söyler. |
| **Onay olmadan "gönderildi" olmaz** | Üç katmanda kapı: uygulama servisi + repository + Postgres trigger. Onay, önceden kalıcılaşmış ayrı bir insan eylemi olmalı. |
| **Rıza olmadan belge işlenmez** | Rızasız gönderilen belge için sıfır kayıt oluşur (test edilir). |
| **PII loglanmaz** | Sızıntı denetimi yalnızca *tip* loglar. Hata mesajları sınıflandırılır; alt katman metni ham hâliyle yazılmaz. |
| **Veri minimizasyonu** | Her kayıtta `delete_after`; günlük silme cron'u + kullanıcının `/sil` komutu. |
| **Yapay zekâ olduğu bildirilir** | Her `/start`'ta, üç dilde. |

---

## Teknoloji

TypeScript · NestJS 10 · Claude (`@anthropic-ai/sdk`) · grammY (Telegram) ·
Supabase/Postgres · Zod · Playwright · Jest

## Durum

**437 test geçiyor** (36 suite) · TypeScript strict · gerçek API anahtarı olmadan
uçtan uca çalışır (mock modlar).

| Faz | Durum |
|---|---|
| Veri modeli, PII maskeleme, config, crypto | ✅ |
| Persistence (memory + Supabase), LLM sarmalayıcı, kanal adaptörleri | ✅ |
| Analiz hattı (özet/son tarih/risk/eksik belge) | ✅ |
| Taslak üretimi + insan onayı akışı | ✅ |
| Hatırlatma + GDPR silme cron'ları | ✅ |
| Randevu izleme (Playwright PoC, mock sayfa) | ✅ |
| Telegram sohbet akışı (tr/de/en) | ✅ |
| Onboarding PII profili (bilinen-değer maskeleme) | ✅ |
| Üçüncü taraf isimleri için yerel NER | ⏳ v2 (bkz. D-028) |
| Web dashboard | ⏳ kapsam dışı |

---

## Hızlı başlangıç

```bash
git clone <repo> && cd B-Ko
npm install
cp .env.example .env      # anahtarsız çalışır: LLM_MOCK=true, DB_DRIVER=memory
npm test                  # 437 test
npm run start:dev
```

Gerçek anahtarlarla çalıştırmak için: [`MANUAL_ACTIONS_REQUIRED.md`](MANUAL_ACTIONS_REQUIRED.md)
Dağıtım: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

### Demo senaryosu

`test-fixtures/behordenbriefe/` altında 8 sentetik Behördenbrief var (gerçek kişi
verisi içermez). Örnek akış:

```
Kullanıcı:  /start
BüKo:       🤖 Ben bir yapay zekâ asistanıyım — gerçek bir memur/avukat değilim.
            ⚠️ Verdiğim bilgiler hukuki tavsiye değildir.
BüKo:       Verilerinizi işlememe onay veriyor musunuz? (/onayla)

Kullanıcı:  /onayla
BüKo:       Son bir adım: mektuplarınızdaki KENDİ bilgilerinizi yapay zekâya
            göndermeden gizleyebilmem için bunları bir kez öğrenmem gerekiyor.
            Bu bilgiler şifrelenerek saklanır ve yapay zekâya ASLA gönderilmez.
            (İstemezseniz /atla)
BüKo:       1/3 — Adınız ve soyadınız?
Kullanıcı:  Yasin Kılıç
BüKo:       2/3 — Adresiniz?
Kullanıcı:  Kolonnenstraße 12
BüKo:       3/3 — Posta kodu ve şehir?
Kullanıcı:  10827 Berlin
BüKo:       ✅ Artık mektuplarınızdaki bu bilgiler yapay zekâya gitmeden gizlenecek.

Kullanıcı:  [Ausländerbehörde mektubunun fotoğrafı]

BüKo:       🟠 Ausländerbehörde Berlin

            Oturum izni uzatma başvurunuz için ek belgeler isteniyor.

            📅 30.06.2024 — 29 gün kaldı

            📎 Eksik/istenen belgeler:
            • Aktueller Mietvertrag
            • Nachweis über Krankenversicherung
            • Aktuelle Gehaltsabrechnungen (letzte 3 Monate)

            ✅ Önerilen adımlar:
            1. Belgeleri toplayın
            2. Son tarihten önce yanıt gönderin

            İsterseniz taslak yanıt hazırlayabilirim: /taslak
            ⚖️ BüKo hukuki tavsiye vermez.

Kullanıcı:  /taslak
BüKo:       [resmî dilde taslak]  [✅ Onayla]  [❌ Reddet]

Kullanıcı:  ✅ Onayla
BüKo:       Metni kopyalayıp kuruma kendiniz gönderebilirsiniz.
            BüKo hiçbir belgeyi sizin adınıza resmî kuruma göndermez.
```

Son tarih yaklaştıkça 14/7/3/1 gün kala otomatik hatırlatma gönderilir.

---

## Proje belgeleri

| Dosya | İçerik |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Mimari, modül haritası, veri modeli |
| [`DECISIONS.md`](DECISIONS.md) | Her mühendislik kararı + gerekçesi (19 karar) |
| [`STATUS.md`](STATUS.md) | Şu an neredeyiz |
| [`PROGRESS.md`](PROGRESS.md) | Kronolojik ilerleme |
| [`TODO.md`](TODO.md) | Görev listesi + bağımlılık grafiği |
| [`MANUAL_ACTIONS_REQUIRED.md`](MANUAL_ACTIONS_REQUIRED.md) | İnsan gerektiren adımlar |

`DECISIONS.md` özellikle okunmaya değer: geliştirme sırasında bulunan **gerçek
güvenlik açıkları** (Türkçe `ı` case-folding kaçağı, etiketsiz tekrar eden dosya
numarası sızıntısı, onay kapısı bypass'ı, eksik GDPR silme) ve nasıl kapatıldıkları
orada kayıtlı.

## Kapsam

**v1:** Ausländerbehörde + genel resmî mektup.
**Kapsam dışı:** Finanzamt/Jobcenter/Elterngeld, otomatik form gönderimi (asla),
tam web dashboard.

## Lisans

MIT
