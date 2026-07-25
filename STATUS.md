# STATUS.md — Şu An Neredeyiz

**Güncelleme:** MVP tamamlandı — Definition of Done karşılandı
**Genel durum:** 🟢 Çalışır durumda, testli, dağıtıma hazır

## Tek cümlede
Kullanıcı Telegram'dan bir Behördenbrief gönderdiğinde; kimlik bilgileri maskeleniyor,
belge analiz ediliyor, son tarih/risk/eksik belgeler çıkarılıyor, hatırlatmalar
kuruluyor, istenirse resmî dilde taslak yanıt üretilip **insan onayına** sunuluyor —
ve bunların hiçbirinde ham kimlik bilgisi veritabanına yazılmıyor.

## Sayılar
- **361 test geçiyor** (31 suite), **0 atlanan**
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

## Bilinçli kapsam kararları (dürüst liste)
- **D-018 — Onboarding PII profili v1'de toplanmıyor.** Bilinen-değer maskelemesi
  (`PiiService`'te tam olarak var ve test edilmiş) akış tarafından beslenmiyor;
  v1 maskeleme yapısal desenlerle çalışıyor. Onboarding eklendiğinde tek satırla devreye girer.
- **D-010 — OCR gizlilik istisnası.** `claude-vision` modunda mektup GÖRSELİ ham PII
  içerir ve sağlayıcıya ulaşır. `OCR_PROVIDER=local` sıfır sızıntı sunar.
  Metin/PDF girdilerinde ham veri zaten hiç dışarı çıkmaz.
- **Web dashboard** — CLAUDE.md §4 gereği kapsam dışı.

## Sıradaki adımlar (v1.1 önerisi)
1. Onboarding akışı → bilinen-değer maskelemesini devreye al (D-018)
2. Telegram webhook controller'ı (üretim için polling yerine)
3. `LLM_MOCK=false` ile gerçek Claude çağrılarında prompt tuning
4. Gerçek Behördenbrief örnekleriyle (anonimleştirilmiş) doğrulama

## Engel
Yok. Kalan tek şey gerçek API anahtarları/hesaplar: `MANUAL_ACTIONS_REQUIRED.md`.
