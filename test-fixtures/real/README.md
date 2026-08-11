# `test-fixtures/real/` — gerçek (anonimleştirilmiş) Behördenbrief'ler

Bugüne kadarki **tüm** doğrulama sentetik fixture'larla yapıldı (D-005). Sentetik
metin gerçek dünyanın üç şeyini temsil etmiyor:

1. **Tarama/fotoğraf gürültüsü** — eğrilik, gölge, kırışık kâğıt, damga, el yazısı
   notlar. D-046'nın OCR ölçümü temiz bir A4 render'ı üzerindeydi; o rakamlar
   gerçek dünyanın **iyimser alt sınırı**.
2. **Gerçek Beamtendeutsch varyasyonu** — kurumdan kuruma değişen kalıplar,
   dipnotlar, ek listeleri, yasa maddesi atıfları.
3. **Beklenmedik yapılar** — iki dilli mektuplar, tablo hâlinde belge listeleri,
   birden çok son tarih, "bu bir bilgilendirmedir" tuzakları.

Bu dizin o boşluğu kapatmak içindir. **Dosya bırakıldığı anda testler
kendiliğinden koşar** — ayrıca bir şey yapmanız gerekmez.

---

## ⚠️ Önce gizlilik

Gerçek mektuplar gerçek insanların verisidir. Bu dizindeki içerik **`.gitignore`
ile repoya girmez** (`README.md` ve `*.example.*` hariç). Bu bilinçli:
anonimleştirme yapıldığını *sanmak* ile *doğrulamak* aynı şey değil, ve bir kez
commit'lenen veri git geçmişinden kolay silinmez.

**Kullanmadan önce:**

```bash
npm run check:real-fixtures
```

Bu araç her dosyayı maskeleme motorundan geçirir ve **hangi PII'yi bulduğunu**
(değerleri değil, tiplerini ve konumlarını) raporlar. Beklediğiniz alanlar
görünmüyorsa anonimleştirme fazla agresif olmuş, beklemediğiniz bir şey
görünüyorsa eksik kalmış demektir.

> Araç bir anonimleştirme *garantisi* değildir — maskeleme motorunun ne
> gördüğünü söyler. D-028 gereği tetikleyicisiz isimler zaten yakalanmaz.
> Son kontrol sizde.

---

## Nasıl eklenir

### 1. Mektup metnini koyun

`test-fixtures/real/<kısa-ad>.txt` — düz metin. Fotoğraftan geliyorsa önce
OCR'dan geçirip metni kaydedin; ham fotoğrafı bu dizine koymayın.

Kısa ad serbest ama açıklayıcı olsun: `abh-muenchen-fristverlaengerung.txt`.

### 2. Beklentileri yazın

`test-fixtures/real/expected.json` — sentetik sürümle **aynı şema**
(`behordenbriefe/expected.json`'a bakın). Minimum:

```json
{
  "abh-muenchen-fristverlaengerung": {
    "file": "abh-muenchen-fristverlaengerung.txt",
    "authority": "Ausländerbehörde München",
    "expectedRiskLevel": "high",
    "expectedDeadline": "2026-09-15",
    "expectedPiiTypes": ["NAME", "ADDRESS", "DATE", "AKTENZEICHEN"]
  }
}
```

`expectedDeadline` bilinmiyorsa `null` verin; testler o alanı atlar.

### 3. (İsteğe bağlı) Profil ekleyin

`test-fixtures/real/profiles.json` — anahtar `expected.json` ile aynı olmalı.
Buradaki her değer mektup metninde **birebir** geçmelidir; bilinen-değer
maskelemesi bunu kullanır. Anonimleştirilmiş adı/adresi yazın, gerçeğini değil.

### 4. Koşun

```bash
npm test                       # gerçek fixture testleri otomatik dâhil olur
npm run check:real-fixtures    # ne bulunduğunu raporlar
npm run bench:ocr-mask -- --real --write   # OCR dayanıklılık ölçümü
```

---

## Testler ne doğrular

Sentetik fixture'larla **aynı invaryantlar** (`pii.real-fixtures.spec.ts`):

- `unmask(mask(x)) === x` — round-trip kayıpsız
- maskeli metinde ham PII kalmıyor (`detectLeaks`)
- profil değerleri maskeli metinde geçmiyor
- beklenen PII tipleri gerçekten yakalanıyor
- aşırı maskeleme yok (token/kelime < %15) — belge analiz edilebilir kalıyor

Bunlara ek olarak, gerçek metinde **maskelenmemiş kalıntı** taraması
(`ocr-residue.ts`, D-046) da koşar.

---

## Dizin boşken ne olur

Testler atlanır — ama **sessizce değil**: suite bir bilgi mesajı basar.
`REQUIRE_REAL_FIXTURES=1` verilirse atlamak yerine **FAIL** eder (D-045'teki
ile aynı mantık: sessiz atlama, bu projede dört kez ısıran "araç ✓ diyor ama
doğrulamıyor" sınıfıdır).
