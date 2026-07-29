# STATUS.md — Şu An Neredeyiz

**Güncelleme:** MVP tamamlandı — Definition of Done karşılandı
**Genel durum:** 🟢 Çalışır durumda, testli, dağıtıma hazır

## Tek cümlede
Kullanıcı Telegram'dan bir Behördenbrief gönderdiğinde; kimlik bilgileri maskeleniyor,
belge analiz ediliyor, son tarih/risk/eksik belgeler çıkarılıyor, hatırlatmalar
kuruluyor, istenirse resmî dilde taslak yanıt üretilip **insan onayına** sunuluyor.
Numaralar/adresler/tarihler maskeleniyor; **isimler v1'de maskelenmiyor** (bkz. aşağıdaki
kapsam boşluğu).

## Sayılar
- **555 test geçiyor** (39 suite), **0 atlanan**
- `tsc --noEmit` temiz · Docker imajı gerçekten build edildi (218 MB)
- `cp .env.example .env && node dist/main.js` → temiz açılış (gerçek anahtar gerekmez)
- 10 commit, ana dal `main`

## Definition of Done (CLAUDE.md §10) — doğrulama

| Kriter | Durum | Kanıt |
|---|---|---|
| Uçtan uca döngü (analiz → deadline/risk → eksik belge → taslak) | ✅ | `analysis.pipeline.spec.ts`, `conversation.service.spec.ts` (21 test) |
| PII maskeleme test edilmiş, LLM'e ham PII gitmiyor | ✅ | 110 test; `llm.leak-guard.spec.ts` API payload'ını denetliyor |
| Playwright randevu izleme PoC | ✅ | Gerçek Chromium + mock sayfalarla 13 test |
| README + mimari diyagram + demo senaryosu | ✅ | `README.md`, `docs/architecture-diagram.md` |
| `MANUAL_ACTIONS_REQUIRED.md` net ve eyleme geçirilebilir | ✅ | 8 madde, hepsi tek `.env` değişikliğiyle çözülür |

## Geliştirme sırasında bulunan ve kapatılan GERÇEK hatalar
Subagent raporları doğrulanmadan kabul edilmedi; bağımsız testler **7 gerçek hata** buldu:

| # | Hata | Neden önemliydi |
|---|---|---|
| D-011 | Türkçe `ı`/`I` case-folding | Büyük harfli soyadlar maskelenmiyordu |
| D-013 | Aynı dosya no ikinci etiketle ("Verwendungszweck") | Ham numara LLM'e gidiyordu; gerçek ödeme yazılarında standart |
| D-014 | Onay kapısı tek çağrıda aşılabiliyordu | İnsan onayı olmadan "gönderildi" işaretlenebilirdi |
| D-015 | Yalnızca tam ad verildiğinde soyadı maskelenmiyordu | "Sehr geehrter Herr Yılmaz" — neredeyse HER mektupta |
| D-019 | GDPR silme `sent`/`cancelled` hatırlatmaları bırakıyordu | Art.17 kısmi silmeye izin vermez |
| D-020 | `.env.example` kopyalamak uygulamayı çökertiyordu | README'nin ilk adımı bozuk kuruluma yol açıyordu |
| D-021 | Eksik paket her açılışta uyarı üretiyordu | Sıfır endpoint için 2 bağımlılık eklemek yerine kaldırıldı |

D-014 özellikle dikkate değer: subagent yanlış davranışı **doğru diye test etmişti**.
Geçen test sayısı değil, neyin doğrulandığı önemli.

## ✅ D-018/D-024 KAPATILDI — onboarding profili devrede
Onboarding akışı eklendi (D-027): kullanıcı kendi ad/adres bilgisini bir kez verir,
bu bilgi `pii_vault`'ta **şifreli** saklanır ve her belgede bilinen-değer maskelemesini
besler. Uçtan uca kanıtlandı (`onboarding.e2e.spec.ts`):
- Kullanıcının adı artık Claude payload'ına GİTMİYOR
- Kullanıcının adı artık `documents.masked_text` içinde SAKLANMIYOR
- Profil değerleri `users` tablosunda düz metin olarak YOK
- Log/audit/hata kanallarının hiçbiri profil değerlerini içermiyor
- `/atla` diyen kullanıcıda eski davranış sürüyor ve bu kullanıcıya AÇIKÇA bildiriliyor

## ✅ Üçüncü taraf isimleri — bağlamsal tetikleyici eklendi (D-029, Faz A)
Memur adı, aile üyesi, avukat gibi üçüncü taraf isimleri artık TETİKLEYİCİ
bağlamlarda maskeleniyor: `Sehr geehrte Frau X`, `Sachbearbeiterin: X`,
`Herrn X`, `i. A. X`, `Ihrer Ehefrau X`, `Rechtsanwältin X`.
Deterministik — NER yok, denetlenebilirlik korundu.

**Ölçüm:** 8 sentetik mektupta 16 NAME eşleşmesinin 16'sı da gerçek isim
(sıfır yanlış pozitif). Alan terimleri maskelenmiyor, token oranı %15'in altında.
Daha önce yalnızca ortak soyadı maskelenip ön adı sızan aile üyesi vakası da kapandı.

## 🟡 Kalan sınır — TETİKLEYİCİSİZ isimler (v2, D-028)
Hiçbir unvan/etiket olmadan cümle içinde geçen adlar hâlâ maskelenmiyor
("Der Antrag wurde von Petra Hoffmann geprüft"). Yerel NER gerektiriyor, v2 kapsamında.
Kalıcı test bu sınırı sabitliyor, böylece sessizce kaymaz.

## Bilinçli kapsam kararları (dürüst liste)
- **D-010 — OCR gizlilik istisnası.** `claude-vision` modunda mektup GÖRSELİ ham PII
  içerir ve sağlayıcıya ulaşır. `OCR_PROVIDER=local` sıfır sızıntı sunar.
  Metin/PDF girdilerinde ham veri zaten hiç dışarı çıkmaz.
- **Web dashboard** — CLAUDE.md §4 gereği kapsam dışı.

## Sıradaki adımlar (v1.1 önerisi)
1. **Eval setine sınır vakalar ekle** — mevcut 8 fixture'da her alan %100,
   yani ayırt edici güç YOK (tavan etkisi). Prompt değişikliklerini ölçebilmek
   için belirsiz/zor vakalar gerekiyor (D-031)
2. Yerel NER → tetikleyicisiz isimler (D-028) — kalan tek gizlilik boşluğu
3. Gerçek Behördenbrief örnekleriyle (anonimleştirilmiş) doğrulama
4. WhatsApp adapter (v2)

## 🚀 CANLI UÇTAN UCA TEST (2026-07-29) — gerçek Telegram + gerçek Claude + gerçek Supabase

İlk kez tüm zincir gerçek bileşenlerle çalıştırıldı: @BuKo749_bot → cloudflared
tüneli → webhook → OCR → maskeleme → Claude → Supabase.

| Adım | Sonuç |
|---|---|
| Webhook kaydı + gizli anahtar | ✅ doğru anahtar 200 · yanlış 401 |
| /start → rıza → onboarding (3 adım) | ✅ profil vault'a şifreli yazıldı |
| **Metin** mektup analizi | ✅ analyzed |
| **Fotoğraf** analizi | ✅ `image/jpeg` · 160 KB · analyzed |
| Model çıktısı | Ausländerbehörde Berlin · Unterlagennachforderung · **critical** · son tarih 2024-06-30 · güven 0.95 · 4 eksik belge |
| **Gizlilik denetimi** | ✅ **HAM PII YOK** — `masked_text`, `analyses` ve `pii_vault` tarandı |
| Vault | 14 şifreli token · `masked_text` içinde 16 yer tutucu |

### Taslak akışı — insan onayı canlı doğrulandı
Kullanıcı bir taslağı ONAYLADI, farklı bir belge için üretilen ikincisini REDDETTİ:

| Taslak | Akış | approved_at | rejected_at | sent_at |
|---|---|---|---|---|
| #1 | generated → presented → **approved** → sent | ✓ | — | ✓ |
| #2 | generated → presented → **rejected** | — | ✓ | — |

Denetim izi eksiksiz ve ham PII içermiyor (yalnızca id/model adı).

**Kapı canlı veriye karşı SALDIRIYLA test edildi** (gerçek reddedilmiş taslak):
```
✓ reddedilmiş → sent          REDDEDİLDİ
✓ approvedAt uydurma (D-014)  REDDEDİLDİ
✓ durum hâlâ 'rejected' · sent_at yok
✓ taslak içeriğinde ham PII YOK (27 yer tutucu)
```
"İnsan onayı olmadan hiçbir şey gönderilmez" kuralı artık yalnızca birim
testlerinde değil, gerçek Postgres verisinde de kanıtlı.

### D-034 — canlı testin bulduğu gerçek hata
İlk fotoğraf denemesi başarısız oldu (`mime=application/octet-stream`). MIME tipi
Telegram'ın `file_path` uzantısından tahmin ediliyordu; uzantı eşleşmeyince Claude
vision reddediyordu — **yani kullanıcı bota fotoğraf gönderemiyordu.** 555 birim
testinin hiçbiri bunu yakalayamazdı (hepsi `MockChannelAdapter` kullanıyor, gerçek
`getFile` yanıtından geçmiyor). Düzeltme: tür artık İÇERİKTEN (sihirli baytlar)
tespit ediliyor; 12 regresyon testi. HEIC (iPhone varsayılanı) için de net
yönlendirme mesajı eklendi.

OCR adımında beklenen uyarı loglandı: ham görsel Anthropic'e gitti (D-010 —
ilan edilmiş mimari istisna); sonraki tüm adımlar maskeli metinle çalıştı.

## ✅ Supabase CANLI — şema uygulandı, sürücü gerçek DB'de doğrulandı (2026-07-26)

**Bağlantı denetimi** (`npm run check:supabase`):

| Kontrol | Sonuç |
|---|---|
| Proje erişilebilirliği | ✅ AYAKTA (GoTrue v2.193.1) |
| Anahtar türü | ✅ SECRET (service_role) |
| Şema | ✅ **8/8 tablo** |
| Backend `DB_DRIVER=supabase` | ✅ **ÇALIŞABİLİR** |

**Anahtar rotasyonu (2026-07-26):** Legacy `service_role` JWT'si iptal edildi ve
`sb_secret_...` biçimine geçildi. Doğrulandı: eski anahtar `HTTP 401
"Legacy API keys are disabled"`, yeni anahtarla 16/16 entegrasyon testi geçiyor.
Legacy **anon** anahtarı da kapandı; `.env`'deki publishable anahtar yeni biçim
olduğu için etkilenmedi.

**Duman testi** (`npm run smoke:supabase`) — **16/16 geçti.**
Bu önemliydi: 527 birim/entegrasyon testinin tamamı `memory` sürücüsüyle koşuyor;
Supabase repository'leri, mapper'lar ve DB trigger'ları gerçek Postgres'te
HİÇ çalıştırılmamıştı. Doğrulananlar:

- CRUD + `findByChannel`, cascade silme (user → documents)
- Mapper'lar: snake_case↔camelCase, `timestamptz`→`Date`, `date`→`Date`
- Enum eşlemeleri (`document_status`, `risk_level`, `draft_status`), `jsonb`, `numeric`
- `0002` migration: `profile_completed_at` yazılabiliyor
- `pii_vault`: yalnızca ciphertext yazımı
- **ONAY KAPISI trigger'ı GERÇEK DB'de ilk kez çalıştı** ve üç varyantı da reddetti:
  onaysız `sent`, aynı çağrıda `approvedAt` ile bypass (D-014), doğrudan
  `sent` olarak INSERT (D-022). Onay sonrası `sent` başarılı.

Test verisi sentetikti ve koşum sonunda silindi (cascade).

**`DB_DRIVER=supabase` YAPILDI** ve gerçek veritabanına karşı **tekrarlanabilir
entegrasyon testi** yazıldı: `npm run test:supabase` → **16/16 geçti**
(`src/modules/persistence/supabase/supabase.integration.spec.ts`).

Kullanıcının özellikle istediği üç alan, gerçek Postgres'te kanıtlandı:

1. **Mapper'lar** — `snake_case↔camelCase`; `timestamptz`/`date` → gerçek `Date`
   (string değil); `jsonb` (iç içe nesne/dizi) yapısını koruyor;
   **`numeric(3,2)` → `number`** (PostgREST bunu string döndürebilirdi — test
   `typeof === 'number'` doğruluyor); enum'lar (`document_status`, `risk_level`,
   `draft_status`, `reminder_kind`). Değerler create dönüşünde DEĞİL, ayrıca
   yeniden `SELECT` ile de doğrulandı.
2. **`profile_completed_at`** (0002) — yazılıyor, `Date` olarak dönüyor,
   null bırakılabiliyor; yeniden okumayla teyit edildi.
3. **Onay kapısı trigger'ı** — 7 senaryo: onaysız `sent` ❌ · aynı çağrıda
   `approvedAt` bypass ❌ (D-014) · `pending_approval`→`sent` ❌ ·
   doğrudan `sent` INSERT ❌ (D-022) · reddedilmiş taslak ❌ ·
   `approved`→`sent` ✅ · `approvedAt`/`rejectedAt` trigger tarafından dolduruluyor.

Ayrıca cascade silme (GDPR) gerçek DB'de doğrulandı.

**Test izolasyonu korundu:** entegrasyon testi `RUN_SUPABASE_TESTS=1` olmadan
ATLANIR. `.env`'de `DB_DRIVER=supabase` olmasına rağmen normal koşum hâlâ
hermetik: `527 passed, 16 skipped, 6s` — gerçek DB'ye çıkılmıyor (D-032).

## 🔑 Anahtar durumu (2026-07-26 sonu)
| Anahtar | Durum |
|---|---|
| Supabase legacy `service_role` JWT | ✅ İPTAL (401 ile doğrulandı) |
| Supabase `sb_secret_...` | 🟢 Aktif — 16/16 entegrasyon testi geçiyor |
| Supabase `sb_publishable_...` | 🟢 Aktif (yeni biçim, legacy iptalinden etkilenmedi) |
| `ANTHROPIC_API_KEY` | ✅ İPTAL (401 ile doğrulandı) → `LLM_MOCK=true` |

Anthropic anahtarı iptal edildiği için `.env` temizlendi ve mock moda dönüldü;
uygulama sorunsuz açılıyor. **Aşağıdaki ölçüm sonuçları anahtar aktifken
alınmıştır ve geçerliliğini korur** — ancak yeni ölçüm için yeni anahtar gerekir.

## 📊 Gerçek API ölçümü (2026-07-26, `claude-sonnet-5`)
`npm run eval:prompts` — **14 sentetik Behördenbrief** (8 temel + 6 sınır vakası),
GERÇEK Claude çağrıları:

| Alan | Sonuç |
|---|---|
| authority | 13/14 (%93) |
| deadline (token→tarih çözümü, D-009) | 14/14 (%100) |
| riskLevel | 14/14 (%100) |
| missingDocuments (ortalama recall) | %100 |
| **PII sızıntısı** | **YOK ✅** |

Sınır vakaların tamamında (6/6) doğru risk seviyesi üretildi — bunlar naif bir
okumanın yanılacağı tuzaklar içeriyor (bkz. aşağıda).

Çekirdek akış gerçek modelle uçtan uca doğrulandı: token sözleşmesi çalışıyor,
model yer tutucuları bozmadan koruyor, deadline doğru token'dan çözülüyor ve
maskeli metinde sızıntı yok.

### ⚠️ riskLevel rubric'i (D-031): İKİ KEZ ölçüldü, hipotez DOĞRULANMADI
İlk ölçümde tavan etkisi vardı, bu yüzden rubric'in ayrımlarını sınamak için
**6 sınır vakası** üretildi (09-14): "DRINGEND" tonlu ama rutin talep; sakin
tonlu ama gömülü statü kaybı; Widerruf + itiraz süresi; son tarih olmayan
tarih; icra tehdidi ama statü sağlam; "ausreisepflichtig" ama karar yok.

| | rubric YOK | rubric VAR |
|---|---|---|
| sınır vakalar (n=6) | **6/6** | **6/6** |
| tüm set (n=14) | 14/14 | 14/14 |
| **farklı çıktı veren vaka** | — | **0** |
| ortalama confidence (sınır) | 0.857 | 0.892 |

**Model tuzakların hepsini rubric olmadan da doğru bildi**; ayrıca iki ayrı
rubric'siz koşum arasında da 0 fark çıktı (davranış kararlı). Ölçülen tek etki,
kendi bildirdiği confidence'ın hafif yükselmesi — bu bir doğruluk kazancı değil.

**KARAR: Rubric KALDIRILDI.** Ölçülen faydası olmayan bir metni her çağrıda
taşımak gereksiz maliyet. Sistem promptu 990 → 723 token
(**~267 token/çağrı, %27 tasarruf**). Bu yapılandırma zaten iki kez ölçülmüştü
(14/14, koşumlar arası 0 fark) ve kaldırma sonrası prompt ölçülen sürümle
bayt-eşdeğer — gereksiz doğrulama koşumu yapılmadı.

6 sınır fixture'ı (09-14) repoda KALICI: model sürümü değişip risk ölçeği
kayarsa `npm run eval:prompts` yakalar ve rubric ölçülerek geri eklenebilir.
Karar geri alınabilir ve testlerle korumalı.

### Ölçüm aracında bulunan hata (D-033)
İlk koşumda `authority` 7/8 göründü; incelenince bunun bir MODEL hatası değil,
EVAL hatası olduğu anlaşıldı: model `"Bürgeramt [[ADDRESS_1]]-Mitte"` döndürmüştü
— yani maskeleme sözleşmesine DOĞRU uymuştu. Karşılaştırma unmask edilmeden
yapılıyordu. Düzeltildi → 8/8.

### Test izolasyonu (D-032)
`.env`'e gerçek anahtar eklenince 24 test kırıldı ve suite 7s→52s çıktı;
testler gerçek API'ye çıkıyordu. `ignoreEnvFile` ile testler artık `.env`'den
izole (hermetik koşum).

## v1.1'de tamamlananlar
- **Telegram webhook endpoint'i** (D-030): gizli anahtar sabit zamanlı doğrulanır,
  sır tanımsızsa fail-closed 401, işleme hatasında bile 200 (retry döngüsü yok),
  loglarda yalnızca `update_id`. Açılışta `setWebhook` ile otomatik kayıt.
- **Prompt değerlendirme koşumu** (D-031): `npm run eval:prompts` — alan bazında
  doğruluk + PII sızıntı raporu, öncesi/sonrası karşılaştırması için `--out`.
- **riskLevel ölçütü** prompt'a eklendi (ölçüm gerektirmeyen belirsizlik giderme).

## Engel
Yok. Kalan tek şey gerçek API anahtarları/hesaplar: `MANUAL_ACTIONS_REQUIRED.md`.
