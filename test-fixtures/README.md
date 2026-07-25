# test-fixtures/

Bu dizindeki tüm veriler **sentetiktir** (bkz. `DECISIONS.md` D-005). Hiçbir
dosya gerçek bir kişiye, gerçek bir kuruma ait yazışmaya veya gerçek bir kimlik
numarasına/banka hesabına dayanmaz. İsimler, adresler, doğum tarihleri,
Aktenzeichen/Vorgangsnummer değerleri, Steuer-ID, IBAN, telefon ve e-posta
adresleri uydurmadır. Her mektup dosyasının en başında bunu belirten bir uyarı
bloğu bulunur.

Amaç: CLAUDE.md §6 Faz-2 kapsamında ("belge okuma → sınıflandırma →
deadline/risk çıkarma → eksik belge listesi") ve PII maskeleme katmanı için
gerçekçi ama tamamen zararsız test girdileri sağlamak.

## İçerik

```
test-fixtures/
├── profiles.json                  ← her mektuba karşılık gelen sentetik KnownPiiProfile
└── behordenbriefe/
    ├── 01-aufenthaltserlaubnis-verlaengerung.txt
    ├── 02-termin-einladung.txt
    ├── 03-blaue-karte-eu.txt
    ├── 04-ablehnung-widerspruchsfrist.txt
    ├── 05-verpflichtungserklaerung-familiennachzug.txt
    ├── 06-buergeramt-anmeldung.txt
    ├── 07-informationsschreiben.txt
    ├── 08-gebuehrenbescheid.txt
    └── expected.json              ← her mektup için beklenen analiz sonucu
```

### `behordenbriefe/*.txt`

Sekiz farklı senaryoyu kapsayan sentetik Behördenbrief metni (Beamtendeutsch
üslubunda): eksik belge talebi (yüksek risk), randevu daveti, Blaue Karte EU
başvurusu, RED kararı + Widerspruchsfrist (kritik risk), aile
birleşimi/Verpflichtungserklärung, Bürgeramt eksik evrak (düşük risk), saf
bilgilendirme mektubu (son tarih yok, düşük risk) ve Gebührenbescheid (IBAN +
ödeme son tarihi). Detaylı senaryo/PII matrisi için `behordenbriefe/expected.json`
dosyasındaki `notes` alanlarına bakın.

Her mektupta kasıtlı olarak maskelenmesi gereken PII türleri bulunur: isim,
adres, PLZ+şehir, tarih(ler), Aktenzeichen/Vorgangsnummer, ve senaryoya göre
Steuer-ID, IBAN, Ausländernummer, Reisepassnummer, Versichertennummer, telefon,
e-posta. Kullanılan tüm IBAN'lar mod-97 (ISO 13616) checksum'ını geçer; tüm
Steuer-ID'ler `src/common/pii/pii.patterns.ts` içindeki `isPlausibleSteuerId`
yapısal kuralına (11 hane, ilk hane ≠ 0, ilk 10 hanede en fazla bir rakam
tekrarı) uyar — ama bunlar da uydurma sayılardır, gerçek bir vergi kimliğine
karşılık gelmez.

Göçmen kitlesinin çeşitliliğini yansıtmak için isimler kasıtlı olarak farklı
kökenlerden seçildi (Türkçe, Arapça/Suriye, Hint, Vietnam, Nijerya, Ukrayna,
Romence dâhil), en az biri Türkçe'ye özgü noktasız `ı` harfi içerir
(Yasin Kılıç).

### `behordenbriefe/expected.json`

Her mektup için testlerin doğrulayacağı beklenen analiz çıktısı: `authority`,
`requestType`, `expectedDeadline` (ISO `YYYY-MM-DD` veya `null`),
`expectedRiskLevel` (`RiskLevel` enum'ıyla birebir), `expectedMissingDocuments`,
`expectedPiiTypes` (`PiiEntityType` enum değerleriyle birebir — bkz.
`src/common/pii/pii.types.ts`) ve kısa bir `notes` açıklaması.

### `profiles.json`

Her mektuba karşılık gelen sentetik `KnownPiiProfile` (bkz.
`src/common/pii/pii.types.ts`) — "bilinen-değer maskeleme" (D-003 adım 1) test
edilirken kullanılır. **Kritik kısıt:** buradaki her alan değeri, ilgili mektup
dosyasının metninde harfiyen (substring olarak) geçmelidir; aksi hâlde
bilinen-değer maskeleme testleri anlamsız olur. Anahtarlar
`behordenbriefe/expected.json` ile birebir aynı kısa-ad'lardır. `_comment`
anahtarı yalnızca dokümantasyon amaçlıdır, bir profil değildir — tüketen kod
bu anahtarı atlamalıdır.

Not: IBAN, `KnownPiiProfile` şemasında bir alan olarak yer almaz (kurumun
tahsilat hesabıdır, kullanıcının kendi PII'si değildir); bu yüzden IBAN
`08-gebuehrenbescheid.txt` içinde yalnızca yapısal desen (regex + mod-97)
maskelemesiyle yakalanır, `profiles.json`'da karşılığı yoktur — bu kasıtlıdır.

## Nasıl kullanılır (örnek)

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '../../test-fixtures/behordenbriefe');
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf-8'));
const profiles = JSON.parse(
  readFileSync(join(__dirname, '../../test-fixtures/profiles.json'), 'utf-8'),
);

for (const [key, meta] of Object.entries(expected)) {
  const text = readFileSync(join(dir, meta.file), 'utf-8');
  const profile = profiles[key]; // KnownPiiProfile
  // ... maskAndAnalyze(text, profile) çağır, meta ile karşılaştır
}
```

## Yeni fixture ekleme

1. `behordenbriefe/NN-kisa-ad.txt` oluştur; en üste sentetik uyarı bloğunu
   (mevcut dosyalardaki formatı) kopyala.
2. Gerçekçi ama uydurma isim/adres/tarih/Aktenzeichen kullan. IBAN
   eklerken mod-97 checksum'ının geçerli olduğundan emin ol (bkz.
   `isValidIban`, `src/common/pii/pii.patterns.ts`); Steuer-ID eklerken
   `isPlausibleSteuerId` kuralına uy.
3. `behordenbriefe/expected.json` içine aynı kısa-ad ile bir giriş ekle.
4. `profiles.json` içine aynı kısa-ad ile bir `KnownPiiProfile` girişi ekle;
   her alanın mektup metninde birebir geçtiğini doğrula.
5. Gerçek kişisel veri KULLANMA (D-005).
