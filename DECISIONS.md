# DECISIONS.md — Mühendislik Kararları ve Gerekçeleri

Her karar: bağlam → karar → gerekçe. Plandan sapmalar açıkça işaretli.

## D-001 — Git binary'si CLT üzerinden
- **Bağlam:** Sistem `/usr/bin/git` bozuk Xcode kurulumuna bağlı, `dlopen` hatası veriyor.
- **Karar:** `/Library/Developer/CommandLineTools/usr/bin/git` kullanılıyor.
- **Gerekçe:** Çalışan tek git. Kullanıcı `xcode-select --switch`'i manuel yaparsa düzelir → `MANUAL_ACTIONS_REQUIRED.md`.

## D-002 — Telegram ile başla (WhatsApp değil)
- **Karar:** İlk kanal Telegram (grammY). WhatsApp `MockChannelAdapter` arkasında.
- **Gerekçe:** WhatsApp Business doğrulaması insan-eylemi + ücret gerektirir. Telegram bot token'ı ücretsiz/hızlı. CLAUDE.md §5 ile uyumlu. `ChannelAdapter` arayüzü ile WhatsApp sonradan tek adapter olarak eklenir.

## D-003 — PII maskeleme yaklaşımı (KRİTİK, moat)
- **Bağlam:** GDPR + "PII asla çıplak LLM'e gitmez" DoD kriteri. Ağır NER modelleri (spaCy/HF) 15 günlük MVP için maliyetli ve Node ekosisteminde sürtünmeli.
- **Karar:** **Hibrit deterministik tokenizasyon:**
  1. **Bilinen-değer maskeleme (yüksek recall):** Onboarding'de kullanıcının kendi PII'si (ad, doğum tarihi, adres, Ausländernummer) toplanır; belgede bu değerlerin birebir/normalize eşleşmeleri maskelenir. En riskli PII zaten kullanıcının kendi verisidir → yüksek isabet.
  2. **Yapısal desen maskeleme (regex):** Steuer-ID (11 hane), IBAN, e-posta, telefon, tarih, PLZ+şehir, Aktenzeichen/dosya no, sağlık sigortası no, Ausländernummer formatları.
  3. **Tokenizasyon:** her benzersiz orijinal değer → kararlı yer tutucu `«TYPE_n»` (ör. `«NAME_1»`, `«STEUERID_1»`). Belge bazında çift yönlü map.
  4. **Tersine çevrim:** `unmask(mask(x)) === x` round-trip testi + "maskeli metinde hiçbir orijinal PII substring'i yok" invaryant testi.
- **Gerekçe:** Bilinen-değer + regex kombinasyonu, ağır NER olmadan MVP için yeterli recall sağlar; deterministik → test edilebilir → denetlenebilir. NER v2'ye ertelendi.
- **Not:** Map yalnızca process-içi + `pii_vault`'ta AES-256-GCM ile şifreli. Düz PII asla persist edilmez, asla LLM'e gitmez.

## D-004 — Veri modeli (KRİTİK)
- **Karar:** §4/migration'daki şema. PII vault ayrı tabloda, **yalnızca ciphertext**. `analyses.raw_model_output` maskeli saklanır.
- **Gerekçe:** PII'yi iş verisinden ayırmak, minimizasyon ve silmeyi (Art.17) `delete_after` ile tek noktadan yönetmeyi sağlar.

## D-005 — Sentetik test fixture'ları
- **Karar:** Gerçek Behördenbrief olmadığı için `test-fixtures/behordenbriefe/` altına gerçekçi **sentetik** Almanca mektuplar üretilir (uydurma isim/adres/dosya no).
- **Gerekçe:** CLAUDE.md §6 Faz-2 izin veriyor. Gerçek kişisel veri kullanılmaz (etik + GDPR).

## D-006 — Model dağılımı (orkestrasyon)
- **Karar:** Ana oturum (Opus) mimari + PII + veri modeli + güvenlik + entegrasyon/commit. Rutin implementasyon (NestJS modülleri, LLM servis, testler, docs, DevOps) Sonnet subagent'lara devredilir; dosya sahiplikleri ayrık tutulur (paralel çakışma yok).
- **Gerekçe:** Kullanıcı direktifi + maliyet/hız verimliliği.

## D-007 — LLM çağrı katmanı PII zorunlu geçiş
- **Karar:** `LlmService`, PII maskeleme yapılmamış ham metni kabul etmez; API `maskAndComplete()` etrafında kurulur, "kaçış" mümkün olmasın diye ham `messages.create` sarmalayıcının dışına açılmaz.
- **Gerekçe:** Güvenliği API tasarımına gömmek, UX metnine bırakmaktan daha güçlü (CLAUDE.md §7).

## D-008 — Yer tutucu biçimi `[[TYPE_n]]` (D-003'ten sapma)
- **Bağlam:** D-003 `«TYPE_n»` (guillemet) öngörüyordu. Ancak Alman tipografisinde `»...«`
  gerçek tırnak işareti olarak kullanılır ve Behördenbrief metinlerinde geçebilir.
- **Karar:** Yer tutucu biçimi `[[TYPE_n]]` (ör. `[[NAME_1]]`).
- **Gerekçe:** Belge metniyle çakışma riski pratikte sıfır; LLM'ler bu biçimi bozmadan
  geri döndürüyor; regex ile ayrıştırması güvenli. Ek savunma: girdideki mevcut
  `[[...]]` dizileri maskeleme öncesi etkisizleştirilir (token enjeksiyonu savunması,
  `pii.service.spec.ts` ile test edildi).

## D-009 — Tarihler de maskelenir; deadline TOKEN üzerinden çıkarılır
- **Bağlam:** Doğum tarihi PII'dir, ama son tarih (Frist) analiz için gerekli. Tüm
  tarihleri maskelemek modelin deadline çıkarmasını engelliyor gibi görünüyor.
- **Karar:** Tüm tarihler maskelenir. Model, son tarihi *takvim değeri* olarak değil,
  ilgili **`[[DATE_n]]` token'ı** olarak döndürür (`LlmAnalysisResult.deadlineToken`).
  Gerçek tarih yerelde `unmask` ile elde edilir.
- **Gerekçe:** Model hangi tarihin son tarih olduğunu bağlamdan seçer ("bis zum ... ein"),
  takvim değerini bilmesine gerek yoktur. Böylece gizlilik VE işlevsellik korunur.
  Doğum tarihi ile son tarih ayrımı da modelden gizlenmiş olur.

## D-010 — OCR/Vision gizlilik gerilimi açıkça modellendi (KRİTİK)
- **Bağlam:** CLAUDE.md hem "Claude native vision ile OCR" hem "PII asla çıplak LLM'e
  gitmez" diyor. Bir mektup FOTOĞRAFI zorunlu olarak ham PII içerir; görseli sağlayıcıya
  yollamak maskelemeyi bu tek adımda baypas eder. Bu gerilim gerçektir ve gizlenmemelidir.
- **Karar:** `OcrProvider` soyutlaması + iki mod:
  1. `claude-vision` (varsayılan): görsel Claude'a gider, YALNIZCA düz metin transkripsiyonu
     istenir. Maskeleme bundan sonraki TÜM adımları (analiz, taslak, kalıcı depolama,
     denetim izi) korur. Sınırlama kod yorumunda ve README'de açıkça yazılır.
  2. `local` (`OCR_PROVIDER=local`): `tesseract.js` ile yerel OCR → sıfır ham-PII sızıntısı.
     Lazy `import()` ile yüklenir; kurulu değilse anlamlı hata, uygulama çökmez.
- **Gerekçe:** "Tam gizlilik" iddiası ancak yerel OCR ile dürüsttür. Varsayılanı çalışır
  tutup (kurulum sürtünmesi yok), gizlilik-maksimum modu tek env değişkeniyle sunmak
  MVP için doğru denge. Metin/PDF girdilerinde zaten ham veri hiç LLM'e gitmez.

## D-011 — Türkçe noktasız `ı` case-folding düzeltmesi
- **Bağlam:** Unicode case-folding'de `ı` (U+0131) ile `I` EŞLEŞMEZ; `/i` regex bayrağı
  tek başına "Yılmaz" ↔ "YILMAZ" eşleşmesini kaçırıyordu (test ile yakalandı).
- **Karar:** Bilinen-değer desenlerinde i-ailesi karakterleri `[iıIİ]` sınıfına genişletilir.
- **Gerekçe:** Türk kullanıcılar ürünün ana hedef kitlesinde; büyük harfle yazılmış
  isimler resmi mektuplarda yaygın. Bu, sessiz ve ciddi bir PII sızıntısı olurdu.
  Regresyon testi eklendi. Aynı sorun Azerice/Kazakça isimleri de kapsar.

## D-012 — Paylaşılan alan tipleri tek dosyada
- **Karar:** `src/common/types/domain.ts` tek doğruluk kaynağı; tüm modüller oradan import eder.
- **Gerekçe:** Paralel subagent'lar aynı sözleşmeye kodladığı için tip kayması (contract
  drift) riski yüksekti; sözleşmeyi agent'lar başlamadan önce sabitlemek entegrasyon
  maliyetini ortadan kaldırdı.

## D-013 — Bulunan PII değerinin TÜM geçişleri maskelenir (gerçek sızıntı düzeltmesi)
- **Bağlam:** Yapısal desen maskelemesi bağlam etiketine dayanıyordu
  ("Aktenzeichen: X"). Sentetik `08-gebuehrenbescheid` fixture'ı, aynı dosya
  numarasının ikinci kez **"Verwendungszweck: X"** etiketiyle geçtiğini ortaya
  çıkardı — bu etiket desen listesinde olmadığı için değer MASKELENMEDEN
  LLM'e gidiyordu. Ödeme referansında dosya numarasını tekrarlamak gerçek
  Gebührenbescheid'lerde standart bir uygulamadır; yani bu kurgusal değil,
  gerçekçi bir sızıntıydı.
- **Karar:** Maskeleme iki geçişli hâle getirildi. Birinci geçişte bulunan her
  benzersiz değer için, belgenin TAMAMI o değerin diğer geçişleri için yeniden
  taranır ve hepsi aynı token'a bağlanır.
- **Gerekçe:** Bağlam etiketi bir değerin PII olduğunu **bir kez** kanıtlar;
  ondan sonra kanıt değerin kendisidir, bulunduğu yer değil. Etiket listesini
  genişletmek (whitelist yaklaşımı) bu sınıfın yalnızca bilinen üyelerini
  kapatırdı; değer yayılımı sınıfın tamamını kapatır.
- **Not:** ≤3 karakterlik değerler yayılmaz (belge genelinde yanlış eşleşme
  gürültüsü üretirdi). Regresyon testleri eklendi.
- **Süreç dersi:** Bu hata, subagent'ın kendi doğrulamasının "sızıntı yok"
  raporuna rağmen ana oturumun BAĞIMSIZ testi tarafından yakalandı. Agent
  raporları doğrulanmadan kabul edilmiyor.

## D-014 — Onay kapısı KAYITLI duruma bakar (güvenlik sertleştirmesi)
- **Bağlam:** Persistence subagent'ı onay kapısını `{...existing, ...patch}` birleşimi
  üzerinden kontrol ediyordu ve bunu bir testle "beklenen davranış" olarak
  sabitlemişti: `update(id, {status:'sent', approvedAt: new Date()})` tek çağrıda
  kapıdan geçiyordu. Yani insan onayı hiç gerçekleşmeden bir taslak "gönderildi"
  sayılabilirdi. Aynı zayıflık DB trigger'ında da vardı (`new.approved_at`).
- **Karar:** 'sent' geçişi artık YALNIZCA kayıtta önceden `status='approved'` VE
  `approved_at` dolu ise kabul edilir. Üç katmanda da düzeltildi: memory repository,
  supabase repository, Postgres trigger (`OLD` satırına bakar; INSERT ile doğrudan
  'sent' yaratmak da reddedilir).
- **Gerekçe:** CLAUDE.md §7 onayın "sadece UX metni değil, kod seviyesinde bir adım"
  olmasını şart koşuyor. Onayın aynı işlemde uydurulabilmesi, kapıyı tamamen anlamsız
  kılardı. Onay, önceden kalıcılaşmış ve ayrı bir insan eylemi olmak zorundadır.
- **Not:** Yanlış davranışı doğrulayan test tersine çevrildi; bypass'ı, reddedilmiş
  taslağı ve `pending_approval`→`sent` geçişini kapsayan regresyon testleri eklendi.
- **Süreç dersi:** İkinci kez, subagent'ın "tüm testler geçiyor" raporu doğru ama
  YETERSİZDİ — testler yanlış davranışı doğruluyordu. Geçen test sayısı değil, neyin
  test edildiği önemli.

## D-015 — Tam adın PARÇALARI da maskelenir (yüksek etkili recall açığı)
- **Bağlam:** Onboarding'de kullanıcı genellikle tek bir "tam ad" alanı doldurur
  ("Ahmet Yılmaz"). Alman resmi mektupları ise kişiye neredeyse HER ZAMAN yalnızca
  soyadıyla hitap eder: "Sehr geehrter Herr Yılmaz". Bilinen-değer maskelemesi tam
  adı arıyordu, dolayısıyla selamlamadaki soyadı MASKELENMEDEN LLM'e gidiyordu.
  DI bütünlük testi yazarken tesadüfen ortaya çıktı.
- **Karar:** `fullName` verildiğinde ad parçaları da ayrı ayrı bilinen-değer olarak
  kaydedilir. 3 karakterden kısa parçalar ve ad bağlaçları/unvanlar
  (van, von, de, bin, al, Dr, Herr...) hariç tutulur.
- **Gerekçe:** Bu, teorik değil tipik bir senaryodur — neredeyse HER Behördenbrief'te
  gerçekleşirdi. Bağlaçları hariç tutmak, metnin okunabilirliğini korur (aksi hâlde
  "von hier" gibi sıradan ifadeler maskelenirdi); gizlilik açısından bağlaçlar tek
  başına kimlik belirtmez.
- **Ödünleşim:** Aşırı maskeleme (bir ad parçasının sıradan bir kelimeyle çakışması)
  kabul edilir; eksik maskeleme kabul edilmez. Gizlilik aracında yön daima
  aşırı-maskeleme lehinedir.

## D-016 — DI bütünlük testi (modül entegrasyonu kanıtı)
- **Karar:** `src/app.module.spec.ts` tüm modülleri birlikte ayağa kaldırır, hiçbir
  gerçek API anahtarı olmadan mock modda uçtan uca bir analiz çağrısı ve bir
  repository yazma/okuma işlemi yapar.
- **Gerekçe:** Modüller ayrı ayrı yeşilken birleşince DI grafiği çözülemeyebilir
  (eksik export, yanlış token, döngüsel bağımlılık). Ayrıca bu test,
  MANUAL_ACTIONS_REQUIRED.md'nin "her şey mock arkasında çalışıyor" iddiasının
  yürütülebilir kanıtıdır — iddia belgede kalmaz, CI'da doğrulanır.

## D-017 — Onay ≠ gönderim (ürün akışında netleştirildi)
- **Bağlam:** `drafts.status = 'sent'` adı yanıltıcı olabilir; sistemin belgeyi
  kuruma gönderdiği izlenimi verir.
- **Karar:** `sent`, "kullanıcı onaylanan metni aldı ve kendisi gönderebilir"
  anlamına gelir. `ConversationService` onay sonrası metni KULLANICIYA yollar ve
  mesajda açıkça "BüKo hiçbir belgeyi sizin adınıza resmî kuruma göndermez" der.
  Sistemin kuruma giden hiçbir kanalı YOKTUR (kod içinde böyle bir çağrı bulunmuyor).
- **Gerekçe:** CLAUDE.md §4/§7 otomatik form gönderimini kesin olarak yasaklıyor.
  Yasağı yalnızca "yapmayarak" değil, kullanıcıya da açıkça söyleyerek uyguluyoruz;
  test bu cümlenin varlığını doğruluyor.

## D-018 — v1'de onboarding PII profili toplanmıyor
- **Bağlam:** Bilinen-değer maskelemesi (D-003 adım 1) kullanıcının kendi PII'sini
  gerektirir; ancak `users` tablosunda tasarım gereği düz PII saklanmıyor.
- **Karar:** v1'de `ConversationService` boş profil geçiyor; maskeleme yalnızca
  yapısal desenlerle (regex + checksum) çalışıyor. Onboarding akışı v1.1'e ertelendi.
- **Gerekçe:** Yapısal desenler mektuplardaki isim/adres/numaraların büyük kısmını
  zaten yakalıyor (fixture testleri bunu gösteriyor). Profil toplamak ek bir rıza
  ve saklama sorumluluğu getirir; MVP için hazır altyapıyı (pii_vault + profil
  parametresi) kurup akışı sonraya bırakmak daha doğru.
- **Etki (dürüst değerlendirme):** Bu, bilinen-değer maskelemesinin recall
  avantajının v1'de DEVREDE OLMADIĞI anlamına gelir. `PiiService` profil desteğini
  tam olarak içeriyor ve test ediliyor; yalnızca akış onu henüz beslemiyor.
  Onboarding eklendiğinde tek satırlık bir değişiklikle devreye girer.

## D-019 — GDPR silme, hatırlatma durumundan bağımsız olmalı
- **Bağlam:** `RetentionService.deleteUserData` hatırlatmaları `findDue()` ile
  tarıyordu (repository'de `findByUser` yoktu). `findDue` yalnızca
  `status: 'scheduled'` kayıtları döndürdüğü için, kullanıcının "verilerimi sil"
  talebinde `sent` ve `cancelled` hatırlatmalar VERİTABANINDA KALIYORDU.
  Subagent bu eksikliği kendi raporunda dürüstçe bildirdi.
- **Karar:** `ReminderRepository.findByUser(userId)` eklendi (soyut sınıf + memory
  + supabase) ve `deleteUserData` buna geçirildi.
- **Gerekçe:** Art.17 "silinme hakkı" kısmi silmeye izin vermez. Hatırlatma kayıtları
  kullanıcının kimliğine ve işlem geçmişine bağlıdır; geride kalmaları uyumsuzluktur.
- **Not:** Regresyon testi üç durumu da (scheduled/sent/cancelled) kapsıyor.
- **Süreç notu:** Bu, subagent'ın kapsam dışı kalan bir sorunu gizlemek yerine
  raporlamasıyla ortaya çıktı — doğru davranış.
