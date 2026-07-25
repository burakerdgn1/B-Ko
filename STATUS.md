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
- **463 test geçiyor** (36 suite), **0 atlanan**
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
1. Yerel NER → tetikleyicisiz isimler (D-028) — kalan tek gizlilik boşluğu
2. Telegram webhook controller'ı (üretim için polling yerine)
3. `LLM_MOCK=false` ile gerçek Claude çağrılarında prompt tuning
4. Gerçek Behördenbrief örnekleriyle (anonimleştirilmiş) doğrulama

## Engel
Yok. Kalan tek şey gerçek API anahtarları/hesaplar: `MANUAL_ACTIONS_REQUIRED.md`.
