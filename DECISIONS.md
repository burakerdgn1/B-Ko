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

## D-020 — Boş env değeri = tanımsız (açılışta çökme düzeltmesi)
- **Bağlam:** `.env.example` içindeki `PII_MASTER_KEY=` (boş) satırı, dotenv
  tarafından `""` olarak okunuyordu. Zod'un `.optional()`'ı yalnızca `undefined`
  değerini muaf tutar; `""` yine regex doğrulamasına girip **uygulamayı açılışta
  çökertiyordu**. Yani README'nin ilk adımı (`cp .env.example .env`) doğrudan
  bozuk bir kuruluma yol açıyordu.
- **Karar:** `validateEnv`, tüm boş/yalnızca-boşluk string'leri `undefined`'a
  çevirerek doğrular.
- **Gerekçe:** `.env`'de boş bırakılan bir anahtar "ayarlanmadı" demektir; bu tüm
  opsiyonel anahtarlar için geçerli genel bir kuraldır (tek tek yamamak yerine
  merkezî çözüm). Geçersiz (boş olmayan) değerler hâlâ reddediliyor.
- **Nasıl bulundu:** DevOps subagent'ı imajı GERÇEKTEN kurup çalıştırdığı için
  yakalandı — birim testleri bu yolu hiç denemiyordu. Regresyon testi eklendi
  (`env.schema.spec.ts`), ayrıca `.env.example` kopyalanarak gerçek açılış doğrulandı.

## D-021 — Global ValidationPipe kaldırıldı (bağımlılık eklemek yerine)
- **Bağlam:** `main.ts` global `ValidationPipe` kuruyordu; bu, `class-validator` ve
  `class-transformer` paketlerini tembel yüklemeye çalışıp her açılışta
  "package is missing" uyarısı üretiyordu. Paketler `package.json`'da yoktu.
- **Karar:** İki bağımlılık eklemek yerine `ValidationPipe` kaldırıldı; ne zaman
  geri ekleneceği `main.ts`'te yorumla yazıldı.
- **Gerekçe:** Uygulamada **hiç HTTP controller'ı yok** (giriş kanalı Telegram),
  dolayısıyla doğrulanacak DTO da yok. Sıfır endpoint'e hizmet etmek için iki
  çalışma-zamanı bağımlılığı taşımak gereksiz. HTTP endpoint'i (ör. Telegram
  webhook) eklendiğinde tek satırla geri gelir.

## D-022 — Onay kapısı INSERT tarafında da kapatıldı (kırmızı takım bulgusu)
- **Bağlam:** D-014'ün gerçekten kapandığını doğrulamak için bir **kırmızı takım
  (red team) test seti** yazıldı: kapıyı kırmayı DENEYEN 6 saldırı vektörü.
  Vektörlerden biri gerçek bir boşluk ortaya çıkardı: `update()` kapısı sağlamdı,
  ancak `create()` hiçbir kontrol yapmıyordu — yani bir çağıran, kaydı en baştan
  `status: 'sent'` olarak YARATARAK kapıyı tamamen atlayabilirdi.
  (Postgres trigger'ı bunu zaten reddediyordu; açık yalnızca uygulama
  katmanındaydı, dolayısıyla `DB_DRIVER=memory` ile çalışan geliştirme/test
  ortamlarını etkiliyordu.)
- **Karar:** Paylaşılan `assertNotBornSent()` koruması eklendi; hem memory hem
  supabase sürücüsünün `create()` metodu bunu çağırıyor. Üç katman artık aynı
  davranışı gösteriyor.
- **Gerekçe:** Bir güvenlik kapısı, yalnızca en zayıf girişi kadar güçlüdür.
  `update()`'i korurken `create()`'i açık bırakmak, kapıyı kilitleyip pencereyi
  açık bırakmaktır.
- **Süreç dersi:** "Düzeltildi" demek yetmiyor. D-014 doğru düzeltilmişti, ama
  düzeltmenin KAPSAMI eksikti; bu ancak kapıyı aktif olarak kırmaya çalışan bir
  test setiyle görüldü. `approval-gate.redteam.spec.ts` kalıcı olarak repoda.

## D-023 — Test'te env, import'lardan ÖNCE ayarlanmalı (sessiz tuzak)
- **Bağlam:** Sızıntı denetimi yazarken `beforeEach` içinde `LLM_MOCK='false'`
  atanmasına rağmen servis mock modda kaldı. Sebep: `ConfigModule.forRoot()`
  doğrulamayı **import anında senkron** çalıştırır; spec dosyasının tepesindeki
  `import` satırları `beforeEach`'ten önce çalıştığı için env ataması GEÇ KALIR
  ve sessizce yok sayılır.
- **Karar:** Env'e duyarlı spec dosyalarında `process.env` atamaları dosyanın
  EN BAŞINA, import'lardan önce yazılır (bkz. `leak-channels.spec.ts`,
  `pipeline.concurrency.spec.ts`).
- **ÜRETİMİ ETKİLEMEZ:** Üretimde env değişkenleri süreç başlamadan önce verilir,
  dolayısıyla import anında zaten doğrudur. Bu yalnızca bir test altyapısı tuzağıdır.
- **Neden önemli:** Mevcut testler bu tuzaktan etkilenmemişti çünkü istedikleri
  değerler zaten VARSAYILANLARDI (`LLM_MOCK=true`, `DB_DRIVER=memory`) — yani
  doğru sonucu şans eseri alıyorlardı. Varsayılandan FARKLI bir değer gerektiren
  ilk test yazıldığında tuzak ortaya çıktı.

## D-024 — v1'de isimler maskelenmiyor (ölçülmüş kapsam, README düzeltildi)
- **Bağlam:** D-018 "onboarding profili v1'de toplanmıyor" diyordu. Bu denetimde
  bunun GERÇEK sonucu ölçüldü: `PII_PATTERNS` içinde **NAME için hiçbir yapısal
  desen yoktur** (bir isim biçiminden tanınamaz; bu ancak NER ile yapılır).
  İsim maskeleme yalnızca bilinen-değer stratejisiyle çalışır ve v1 akışı
  profil beslemediği için **kişi adları Claude'a çıplak gidiyor.**
- **Ölçüm:** `leak-channels.spec.ts` bunu doğrudan test ediyor: profilsiz akışta
  payload isim İÇERİYOR; profil verilirse içermiyor. `pii.gap-audit.spec.ts`
  ayrıca standart dışı adres biçimlerinin (`Am Alten Bahnhof 3b`, `c/o …`,
  `Postfach …`) de kaçtığını sabitliyor.
- **Karar:** README'deki iddia DÜZELTİLDİ. Başlık "PII asla çıplak dışarı çıkmaz"
  → "PII maskeleme katmanı"; hangi alanın kapsandığı ölçülmüş bir tabloyla ve
  ayrı bir uyarı bölümüyle veriliyor.
- **Gerekçe:** Ürünün ana farklılaştırıcısı gizlilik iddiasıdır; bu iddiayı
  olduğundan güçlü göstermek, kullanıcıyı yanlış bir güvenlik hissiyle gerçek
  riske sokar. Kapsamı küçültmek değil, doğru anlatmak gerekir.
- **Kapatma yolu:** Onboarding akışı (v1.1 ilk iş) → profil beslenir → isim ve
  standart dışı adresler de maskelenir. Motor tarafı HAZIR ve test edilmiş durumda.

## D-025 — Sızıntı denetimi tüm kanallarda; sıralama ve eşzamanlılık doğrulandı
- **Karar/Kapsam:** Sızıntı yalnızca API payload'ında değil, şu kanalların
  hepsinde denetleniyor: log satırları (tüm seviyeler), DB'ye yazılan hata
  mesajları, exception/stack trace, audit kayıtları (`leak-channels.spec.ts`).
- **Sıralama garantisi:** Vault (şifreli anahtarlar) belgeye maskeli metin
  yazılmadan ÖNCE kalıcılaşır. Aksi hâlde süreç arada ölürse GERİ ÇEVRİLEMEZ bir
  belge kalırdı. Vault yazımı başarısız olursa maskeli metin hiç yazılmaz →
  "yetim token" oluşmaz (`pipeline.concurrency.spec.ts`).
- **Eşzamanlılık:** Aynı kullanıcı için paralel iki analiz, 8 paralel analiz ve
  kullanıcı izolasyonu test edildi; AAD bağlaması sayesinde bir kullanıcının
  vault kaydı başka bir kullanıcının bağlamıyla çözülemiyor.

## D-026 — İsim boşluğu yalnızca LLM'i değil, SAKLAMAYI da etkiliyor
- **Bağlam:** D-024 isimlerin LLM'e çıplak gittiğini gösterdi. Denetim derinleştirilince
  ikinci sonuç ortaya çıktı: `documents.masked_text` alanı adı "maskeli" olsa da
  maskeleme NAME'i kapsamadığı için **isimler veritabanında ham hâliyle kalıcılaşıyor.**
- **Etki:** Bu yalnızca bir "LLM'e gönderim" konusu değil, bir **GDPR saklama yüzeyi**
  konusudur. Veri minimizasyonu iddiası isimler için geçerli değil (silme yine çalışıyor:
  `delete_after` + `/sil` bu satırları da siliyor).
- **Karar:** İddia edilen davranış DÜZELTİLDİ (README, STATUS, ARCHITECTURE). Kalıcı test
  eklendi (`leak-channels.spec.ts` — "Kanal 6"): profilsiz akışta isim `masked_text`
  içinde bulunur, profille bulunmaz.
- **Gerekçe:** Şemadaki `masked_text` adı, alanın içeriği hakkında olduğundan güçlü bir
  garanti ima ediyordu. Yanıltıcı bir alan adının etrafında sessizce çalışmak yerine
  sınırı ölçüp belgelemek doğru olan.
- **Kapatma:** Onboarding profili (v1.1) hem gönderim hem saklama tarafını aynı anda kapatır.

## D-027 — Onboarding profili: bilinen-değer maskeleme DEVREYE ALINDI
- **Bağlam:** D-018/D-024, isim maskelemesinin motorda hazır olduğunu ama akışın
  profil beslemediğini gösteriyordu; sonuç olarak isimler hem Claude'a gidiyor
  hem de `documents.masked_text` içinde saklanıyordu.
- **Karar:** Rıza sonrası 3 adımlı onboarding (ad → adres → PLZ/şehir) eklendi.
  - Profil DEĞERLERİ `users` tablosunda DEĞİL, `pii_vault`'ta kullanıcı kapsamlı
    (`document_id IS NULL`) ve **AES-256-GCM ile şifreli** saklanır. AAD kullanıcıya
    bağlıdır → başka bağlamda çözülemez.
  - `users.profile_completed_at` (migration 0002) yalnızca DURUM tutar, veri değil.
  - Ad girildiğinde ad/soyad parçaları da kaydedilir (D-015 — mektuplar genelde
    yalnızca soyadıyla hitap eder).
  - "10827 Berlin" girdisi posta kodu + şehir olarak ayrıştırılır.
- **Kullanıcı reddedebilir:** `/atla` — onboarding tamamlanmış sayılır, profil boş
  kalır ve **adının maskelenmeyeceği kullanıcıya açıkça bildirilir.** Gizlilik
  tercihini zorlamak yerine sonucunu şeffaf anlatmak doğru olan.
- **Kanıt (`onboarding.e2e.spec.ts`, 16 test):** kullanıcının adı artık payload'a
  gitmiyor, `masked_text`'te saklanmıyor, log/audit/hata kanallarında görünmüyor;
  `/atla` durumunda eski davranışın sürdüğü karşılaştırmalı olarak gösteriliyor.
- **UX notu:** Onboarding sırasında 80 karakterden uzun metin ADIM CEVABI değil
  BELGE sayılır — kullanıcı araya mektup yapıştırdığında bunun "ad" olarak
  yutulması kötü bir deneyim olurdu (test edildi).

## D-028 — Üçüncü taraf isimleri: yerel NER, v2 kapsamı (AÇIK SINIR)
- **Bağlam:** Bilinen-değer maskeleme yalnızca KULLANICININ KENDİ verisini kapsar.
  Mektuptaki memur adı (`Sachbearbeiterin: Frau …`), aile üyeleri, avukatlar ve
  referans verilen üçüncü kişiler bu yöntemle yakalanamaz — sistem onları önceden
  bilmez ve bir ismin *biçimi* onu tanınabilir kılmaz (NAME için yapısal desen
  yazılamaz).
- **Karar:** Bu boşluk v2'ye bırakıldı; çözüm **yerel NER** (spaCy/HF benzeri bir
  model ya da Almanca'ya uygun hafif bir alternatif). Üstü ÖRTÜLMEDİ: README'de
  ayrı bir "v2 sınırlaması" bölümü, STATUS'ta ayrı bir başlık ve kalıcı testler
  (`onboarding.e2e.spec.ts` — "BULGU: memur adı payload'a çıplak gider") var.
- **Gerekçe:** NER, MVP için ciddi bir bağımlılık ve doğruluk/performans riski
  getirir (yanlış pozitifler metni okunamaz hâle getirir, yanlış negatifler
  sahte güven verir). Kullanıcının kendi verisi — ki en yüksek riskli ve en çok
  tekrar eden PII odur — artık tam kapsanıyor. Kalan boşluğu ölçüp ilan etmek,
  yarım bir NER ile "çözüldü" demekten dürüst.
- **İnce davranış (belgelendi):** Üçüncü taraf kullanıcıyla AYNI SOYADI taşıyorsa
  (ör. eş) soyadı maskelenir ama ÖN ADI sızar: `Elif Kılıç` → `Elif [[NAME_2]]`.
  Metin maskelenmiş GÖRÜNÜR ama tam değildir — kısmi maskeleme yanıltıcı olabilir.
- **Geçici çözüm:** Aile üyeleri `KnownPiiProfile.extra` üzerinden profile
  eklenebilir; test bunun çalıştığını gösteriyor.

## D-029 — Üçüncü taraf isimleri: bağlamsal tetikleyici (Faz A, NER değil)
- **Bağlam:** D-028, üçüncü taraf isimlerini (memur, aile üyesi, avukat) v2'ye
  bırakmıştı. Kullanıcı onayıyla önce ucuz ve deterministik olan "Faz A"
  uygulandı; NER kararı ölçüm sonrasına bırakıldı.
- **Karar:** Bir ismin *biçimi* onu tanınabilir kılmaz, ama Alman resmî
  yazışmasında isimlerin geçtiği BAĞLAMLAR düzenlidir. Beş tetikleyici desen
  ailesi eklendi: selamlama (`Sehr geehrte(r) Herr/Frau X`), görevli alanları
  (`Sachbearbeiter(in)/Ansprechpartner/Bearbeiter/Rechtsanwalt`), imza blokları
  (`i. A.` / `i. V.` / `gez.`), adres bloğu (`Herrn/Herr/Frau X`) ve aile bağı
  (`Ehefrau/Ehemann/Sohn/Tochter/Vater/Mutter X`).
- **Gerekçe:** Olasılıksal bir model eklemeden, D-003'ün "deterministik →
  test edilebilir → denetlenebilir" ilkesini bozmadan gerçek sızıntıyı kapatır.
  Maliyet ~1 gün; NER ~5.5 gün ve üretime olasılıksal bir katman sokardı.
- **Yanlış pozitif tasarımı (kritik):** Almancada TÜM isimler büyük harfle
  başlar; "büyük harf = özel ad" sezgisi Almanca'da felaketle sonuçlanırdı.
  Bu yüzden büyük harf ASLA tek başına sinyal değil — eşleşme yalnızca
  tetikleyici bağlamda olur, ayrıca `NOT_A_NAME` stoplist'i (`Damen`, `Herren`,
  `Behörde`, `Abteilung`, `Betreff` …) uygulanır.
- **Unicode:** `\p{Lu}[\p{L}'’-]+` kullanıldı; ASCII `[A-Z]` Türkçe (Kılıç),
  Vietnamca (Nguyễn), Arapça latinizasyonu (Al-Rashid) ve tireli adları
  (Müller-Schmidt) KAÇIRIRDI — hedef kitle tam olarak bu isimler.
- **Satır sonu hatası (geliştirme sırasında bulundu):** İsim öbeğinde `\s+`
  kullanmak satır sonunu aşıyor ve "Sabine Brandt\nBitte" gibi öbekler
  yakalanıyordu. Ad öbeği içinde yalnızca YATAY boşluk (`[ \t]+`) kullanılıyor;
  tetikleyici→ad arasında ise en fazla BİR satır sonuna izin var (Alman adres
  blokları iki satırlıdır: "Herrn\nMax Mustermann").
- **Ölçüm:** 8 sentetik mektupta 16 NAME eşleşmesinin 16'sı da gerçek isim —
  sıfır yanlış pozitif. Kalıcı testler alan terimlerinin maskelenmediğini,
  her mektupta en az bir ad yakalandığını ve token oranının %15'i aşmadığını
  (aşırı maskeleme yok) doğruluyor.
- **Yan kazanç:** D-026'daki "kısmi maskeleme yanıltıcıdır" vakası kapandı —
  aile üyesi artık ortak soyadıyla değil, aile bağı tetikleyicisiyle TAM
  yakalanıyor (`Elif Kılıç` → tek token).
- **KALAN SINIR (D-028 devam ediyor):** Tetikleyicisiz, cümle içinde çıplak
  geçen adlar ("von Petra Hoffmann geprüft") maskelenmiyor. Kalıcı bir test bu
  sınırı sabitliyor ki sessizce kaymasın.

## D-030 — Telegram webhook endpoint'i fail-closed (v1.1)
- **Karar:** `POST /webhook/telegram` eklendi. Gizli anahtar
  (`X-Telegram-Bot-Api-Secret-Token`) **sabit zamanlı** karşılaştırılır
  (`CryptoService.safeEqual`). Sunucuda `TELEGRAM_WEBHOOK_SECRET` TANIMSIZSA
  endpoint tüm istekleri 401 ile reddeder.
- **Gerekçe:** Webhook adresi tahmin edilebilir. "Sır yoksa herkese açık"
  varsayılanı bir gizlilik ürününde kabul edilemez — sahte update enjeksiyonu,
  başka bir kullanıcının adına belge göndermek anlamına gelirdi.
- **Yanıt sözleşmesi:** İşleme hatasında bile **200** döner. Telegram 200
  dışındaki yanıtlarda update'i tekrar gönderir; bozuk bir belge sonsuz
  yeniden deneme döngüsü yaratırdı. Kimlik doğrulama hatası istisnadır (401).
- **Loglama:** Hata logunda yalnızca `update_id` geçer — update gövdesi ham PII
  içerir ve ASLA loglanmaz (test ile doğrulandı).
- **Not (D-021 devamı):** Artık bir HTTP endpoint'i var, ancak `ValidationPipe`
  hâlâ eklenmedi: doğrulama DTO ile değil, gizli anahtar + grammY tip eşlemesi
  ile yapılıyor. `class-validator` bağımlılığı için hâlâ gerekçe yok.

## D-031 — Prompt "tuning" ölçüm olmadan yapılmaz (v1.1)
- **Bağlam:** v1.1 planında "gerçek Claude çağrılarıyla prompt tuning" vardı.
  Ortamda `ANTHROPIC_API_KEY` YOK; gerçek çağrı yapılamıyor.
- **Karar:** Prompt'ları körlemesine "iyileştirmek" yerine ÖLÇÜM ALTYAPISI
  kuruldu: `npm run eval:prompts` (`scripts/prompt-eval.ts`). 8 sentetik
  mektubu gerçek modelden geçirir; kurum / son tarih / risk / eksik belge
  alanlarında doğruluk ve PII sızıntı raporu üretir. `--out` ile öncesi/sonrası
  karşılaştırması yapılabilir.
- **Gerekçe:** Ölçmeden yapılan prompt değişikliği tahmindir ve bu projede
  tekrar tekrar görüldüğü gibi (D-013, D-014, D-024) doğrulanmamış varsayımlar
  gerçek hatalara dönüşüyor. Anahtar geldiğinde tek komutla ölçüm yapılabilir.
- **Tek istisna — ölçüm gerektirmeyen düzeltme:** `riskLevel` alanı prompt'ta
  ölçütsüz bir enum olarak duruyordu; model "high" ile "medium" arasındaki farkı
  bilemezdi. Bu bir *belirsizlik*tir, tercih değil. Fixture semantiğinden
  türetilen açık bir ölçüt eklendi. Ayrıca modele, tarihleri MASKELİ gördüğü
  için zaman baskısını değerlendirmemesi gerektiği açıkça söylendi — bunu sistem
  zaten yerelde `escalateRiskByDeadline` ile yapıyor.
- **ÖLÇÜM SONUCU (2026-07-26, gerçek API ile — hipotez DOĞRULANMADI):**
  Rubric'li ve rubric'siz iki koşum yapıldı (`claude-sonnet-5`, 8 fixture):

  | | rubric YOK | rubric VAR |
  |---|---|---|
  | riskLevel doğruluğu | 8/8 | 8/8 |
  | farklı çıktı veren vaka | — | **0** |
  | ortalama confidence | 0.909 | 0.906 |

  Model, rubric OLMADAN da 8 vakanın tamamında beklenen risk seviyesini
  üretti; rubric hiçbir vakada çıktıyı değiştirmedi. Yani **"riskLevel
  belirsizdi ve bu hatalara yol açıyor" hipotezim bu veri setinde
  doğrulanmadı.**
- **Neden ölçemedik (tavan etkisi):** 8 fixture'da temel başarı zaten %100;
  bir iyileştirmenin görülebileceği alan YOK. Bu eval seti rubric'i test
  edecek ayırt edici güce sahip değil — sınır vakalar (belirsiz risk içeren
  mektuplar) gerekir.
- **Karar:** Rubric KORUNDU. Gerekçe: ölçülebilir bir zarar yok (0 fark),
  spesifikasyon boşluğunu kapatıyor ve fixture setinde bulunmayan gerçek
  dünya mektupları için belirsizliği azaltması beklenir. Ancak bu bir
  **beklenti**, kanıt değil — bu şekilde işaretlendi.
- **İKİNCİ ÖLÇÜM (2026-07-26) — sınır vakalarla, hipotez YİNE doğrulanmadı:**
  Eval setine rubric'in ayrımlarını sınamak için özel olarak tasarlanmış
  **6 sınır vakası** eklendi (toplam 14). Her biri, naif bir okumanın YANLIŞ
  cevap vereceği bir tuzak içeriyor:

  | fixture | sınır | tuzak | doğru |
  |---|---|---|---|
  | 09 | medium↔high | "DRINGEND" tonu, ama rutin talep | medium |
  | 10 | high↔medium | sakin ton, gömülü "erlischt" | high |
  | 11 | critical↔high | Widerruf + Widerspruchsfrist | critical |
  | 12 | low↔medium | tarih var ama son tarih DEĞİL | low |
  | 13 | medium↔critical | Zwangsvollstreckung tehdidi, statü sağlam | medium |
  | 14 | high↔critical | "ausreisepflichtig" ama karar YOK | high |

  Sonuç:

  | | rubric YOK | rubric VAR |
  |---|---|---|
  | sınır vakalar riskLevel | **6/6** | **6/6** |
  | tüm set (n=14) | 14/14 | 14/14 |
  | farklı çıktı veren vaka | — | **0** |
  | ortalama confidence (sınır) | 0.857 | 0.892 |

  **Model, tuzakların HEPSİNİ rubric olmadan da doğru bildi.** Ayrıca iki
  ayrı rubric'siz koşum arasında da 0 fark çıktı — yani davranış kararlı,
  rubric tutarlılık için de gerekmiyor.
- **Neden böyle:** Ground truth zaten rubric'ten türetilmişti ve model rubric'i
  GÖRMEDEN aynı sonuca vardı. Yani rubric, modelin mevcut önyargısını (prior)
  yeniden yazmıyor — onu **kodluyor**. Yeni bilgi eklemiyor.
- **Ölçülen tek etki:** Kendi bildirdiği confidence hafif yükseliyor
  (sınır vakalarda 0.857 → 0.892). Bu bir DOĞRULUK kazancı değildir.
- **NİHAİ KARAR (kullanıcı kararı): Rubric KALDIRILDI.**
  İki bağımsız ölçüm, 6'sı özel olarak tuzak amaçlı 14 vakada rubric'in
  doğruluğa **hiçbir** etkisi olmadığını gösterdi. Ölçülen faydası olmayan
  bir metni her analiz çağrısında taşımak gereksiz maliyettir.

  | | değer |
  |---|---|
  | sistem promptu (rubric'li) | 3960 karakter (~990 token) |
  | sistem promptu (rubric'siz) | 2891 karakter (~723 token) |
  | **tasarruf** | **~267 token/çağrı (sistem promptunun %27'si)** |

  Bu yapılandırma (rubric'siz) zaten **iki kez** ölçüldü: 14/14 doğruluk,
  koşumlar arası 0 fark. Kaldırma sonrası prompt, ölçülen sürümle
  bayt-eşdeğerdir (diff ile doğrulandı) — bu yüzden gereksiz bir doğrulama
  koşumu yapılmadı.
- **Riski ne koruyor:** 6 sınır fixture'ı (09-14) repoda kalıcı. Model sürümü
  değişip risk ölçeği kayarsa `npm run eval:prompts` bunu yakalar; o noktada
  rubric geri eklenip ölçülebilir. Yani karar geri alınabilir ve korumalı.
- **Ders:** Bir prompt eklemesi "mantıklı göründüğü" için tutulmaz. Ölçüm
  yoksa fayda da yoktur; ölçüm varsa ve fayda çıkmıyorsa, doğru hamle
  eklemeyi geri almaktır. Bu projede prompt'a eklenen tek şey ölçülmüştü ve
  ölçüm onu geri aldırdı.
- **Metodolojik uyarı:** Ground truth'u rubric'ten türetip sonra rubric'i
  test etmek dairesel bir riske sahiptir. Burada bu risk sonucu ZAYIFLATMIYOR,
  çünkü bulgu "rubric işe yarıyor" değil, "rubric gereksiz" yönünde çıktı.

## D-032 — Testler `.env` dosyasından İZOLE edilmeli (hermetik koşum)
- **Bağlam:** Gerçek API anahtarı `.env`'e eklenince (`LLM_MOCK=false`)
  **24 test kırıldı** ve suite 7 saniyeden 52 saniyeye çıktı — testler gerçek
  Anthropic API'sine çıkmaya başlamıştı.
- **Kök neden:** `ConfigModule.forRoot()` `.env`'i import anında okur (D-023);
  geliştiricinin yerel dosyası test davranışını sessizce değiştiriyordu.
- **Karar:** `ignoreEnvFile: process.env.NODE_ENV === 'test'`. Testler yalnızca
  spec dosyalarının açıkça kurduğu `process.env` değerlerine dayanır.
- **Gerekçe:** Test koşumu hermetik olmalı; aksi hâlde CI ile yerel sonuçlar
  ayrışır ve daha kötüsü, testler farkında olmadan ücretli API çağrısı yapar.
  Bir geliştiricinin makinesindeki dosya, testin ne doğruladığını
  değiştirmemeli.

## D-033 — Eval betiğinde ölçüm hatası: maskeli çıktı ham beklentiyle karşılaştırılıyordu
- **Bulgu:** İlk koşumda `authority` 7/8 çıktı. Tek "hata" şuydu:
  beklenen `"Bürgeramt Berlin-Mitte"`, gelen `"Bürgeramt [[ADDRESS_1]]-Mitte"`.
- **Bu bir MODEL HATASI DEĞİLDİ.** Model maskeli metin gördüğü için "Berlin"i
  bilemez ve token'ı doğru şekilde AYNEN korumuştu — yani maskeleme
  sözleşmesine tam uymuştu. Hatalı olan ÖLÇÜMDÜ: karşılaştırma unmask
  edilmemiş çıktıyla yapılıyordu.
- **Düzeltme:** Eval, karşılaştırmadan önce `pii.unmaskDeep(out.result, out.map)`
  uygular (üretim hattı zaten bunu yapıyordu). Düzeltme sonrası `authority` 8/8.
- **Ders:** Ölçüm aracının kendisi de hatalı olabilir. "Model yanlış yaptı"
  sonucuna varmadan önce ölçümün doğru şeyi karşılaştırdığı doğrulanmalı —
  aksi hâlde var olmayan bir sorunu "düzeltmek" için prompt bozulurdu.

## D-034 — Dosya türü uzantıdan değil İÇERİKTEN tespit edilir (canlı test bulgusu)
- **Bağlam:** İlk gerçek Telegram fotoğraf gönderiminde analiz başarısız oldu:
  `Desteklenmeyen görsel türü: "application/octet-stream"`. MIME tipi
  `getFile.file_path` uzantısından tahmin ediliyordu; uzantı eşleşmeyince
  `application/octet-stream` üretiliyor ve Claude vision çağrısı reddediliyordu.
  **Sonuç: kullanıcı bota fotoğraf gönderemiyordu** — ürünün ana giriş yolu kırıktı.
- **Neden testler yakalamadı:** 555 test `MockChannelAdapter` veya doğrudan metin
  girdisi kullanıyordu; hiçbiri Telegram'ın gerçek `getFile` yanıtından geçmiyordu.
  Bu, yalnızca gerçek kanal üzerinden yapılan canlı testle görülebilirdi.
- **Karar:** Tür artık **sihirli baytlardan** tespit ediliyor
  (`detectMimeFromBytes`): JPEG, PNG, GIF, WebP, PDF, HEIC/HEIF. Uzantı haritası
  yalnızca yedek. Kaynak ne iddia ederse etsin, içerik doğruyu söyler.
- **Ek bulgu — HEIC:** iPhone varsayılanı HEIC'tir ve Claude vision desteklemez.
  Eski kod bu durumda "daha net bir fotoğrafla deneyin" gibi YANILTICI bir mesaj
  veriyordu (sorun netlik değil, biçimdi). Artık ayrı bir mesaj kullanıcıya ne
  yapacağını söylüyor (Dosya yerine Fotoğraf gönder ya da JPEG/PNG kaydet).
- **Doğrulama:** Düzeltme sonrası gerçek fotoğraf `image/jpeg` (160 KB) olarak
  tanındı ve uçtan uca analiz edildi; DB'de ham PII bulunmadığı ayrıca denetlendi.
- **Ders:** "Testler geçiyor" ile "sahada çalışıyor" farkı tam olarak burada.
  Dış sistemlerin sözleşmesi (Telegram'ın file_path'i) ancak gerçek entegrasyonda
  görülür; mock'lar kendi varsayımımızı doğrular, dış dünyayı değil.

## D-035 — PII anahtar rotasyonu veri kaybetmeden yapılır
- **Bağlam:** `PII_MASTER_KEY` üretim değerine geçilecekti. Ancak vault'ta canlı
  testten kalan **48 şifreli kayıt** vardı (6 profil alanı + 42 belge token'ı),
  hepsi DEV türetilmiş anahtarla şifreliydi. Anahtarı yalnızca `.env`'de
  değiştirmek AES-GCM auth tag doğrulamasını bozar ve bu kayıtları **kalıcı
  olarak okunamaz** hâle getirirdi:
    - profil kayıtları giderse bilinen-değer maskelemesi (D-027) çalışmaz
    - belge token'ları giderse `masked_text` bir daha ASLA çözülemez
- **Karar:** `scripts/rotate-pii-key.ts` (`npm run rotate:pii-key`) yazıldı.
  Üç fazlı ve **fail-safe**:
    1. **Çöz** — tüm kayıtlar eski anahtarla çözülür. Bir tanesi bile
       başarısızsa HİÇBİR ŞEY YAZILMADAN iptal edilir (yarım rotasyon en kötü sonuç).
    2. **Yeniden şifrele + doğrula** — her kayıt yeni anahtarla mühürlenip
       yazmadan ÖNCE geri çözülerek round-trip kanıtlanır.
    3. **Yaz** — yalnızca `--apply` ile; `key_version` artırılır.
  Varsayılan mod KURU KOŞUM'dur; yanlışlıkla çalıştırmak veri değiştirmez.
- **Sonuç (gerçek veri üzerinde):** 48/48 çözüldü, 48/48 round-trip doğrulandı,
  48/48 yazıldı, `key_version` 1→2. Rotasyon sonrası doğrulama: profil 6/6 alan
  çözülüyor, 3 belgenin 42 token'ı tamamen geri kuruluyor (kalan token 0),
  açılıştaki `DEV-ONLY` uyarısı kayboldu.
- **Gerekçe:** Anahtar rotasyonu bir güvenlik gereğidir ama veri kaybı riski
  taşır. "Anahtarı değiştir" ile "anahtarı güvenle değiştir" arasındaki fark bu
  script'tir; `.env` yorumuna da bu uyarı yazıldı.

## D-036 — Güvenlik kararları CANLI ortamda doğrulandı (birim testi değil, gerçek veri)
- **Bağlam:** D-014 (onay kapısı bypass), D-022 (INSERT tarafı kapısı) ve D-030
  (fail-closed webhook) birim/entegrasyon testleriyle kanıtlanmıştı. Ancak bu
  projede tekrar tekrar görüldü ki (D-024, D-032, D-034) testlerin doğruladığı
  şey ile sahada olan şey ayrışabilir. Bu yüzden kararlar gerçek kurulum üzerinde
  yeniden sınandı: gerçek Telegram botu → cloudflared tüneli → gerçek Claude →
  gerçek Supabase.
- **Doğrulanan sonuçlar (2026-07-29):**
  - **D-030 fail-closed webhook:** tünel üzerinden doğru gizli anahtar → 200,
    yanlış anahtar → 401, başlık yok → 401.
  - **D-014 / D-022 onay kapısı:** kullanıcı bir taslağı onayladı
    (`generated → presented → approved → sent`), başka bir belgeninkini reddetti
    (`→ rejected`). Ardından GERÇEK reddedilmiş kayıt üzerinde saldırı denendi:
    `rejected → sent` REDDEDİLDİ, aynı çağrıda `approvedAt` uydurma REDDEDİLDİ,
    durum bozulmadı, `sent_at` boş kaldı.
  - **PII sözleşmesi:** gerçek fotoğraf akışında `documents.masked_text`,
    `analyses` ve `pii_vault` tarandı → ham PII YOK. Taslak içeriği de maskeli
    saklanıyor (27 yer tutucu).
  - **D-010 OCR istisnası:** beklenen uyarı loglandı (ham görsel sağlayıcıya
    gitti), sonraki tüm adımlar maskeli metinle çalıştı — ilan edildiği gibi.
- **Gerekçe:** "Testler geçiyor" ile "sahada çalışıyor" arasındaki fark bu projede
  somut bir bedelle görüldü (D-034: fotoğraf yolu tamamen kırıktı ve 555 testin
  hiçbiri fark etmedi). En güvenlik-kritik iddiaların gerçek veriye karşı
  sınanması, belge iddiası olmaktan çıkıp kanıt olmasını sağlar.
- **Not:** Bu bir "karar" değil bir DOĞRULAMA kaydıdır; kararların (D-014/D-022/
  D-030/D-010) üretimde tuttuğunu belgelemek için buraya işlendi.

## D-037 — Supabase secret anahtar rotasyonu: doğrulama ÖNCE, yazma SONRA
- **Bağlam:** Kalan tek güvenlik borcu, sohbet geçmişinde görünen
  `sb_secret_...` (service-role) anahtarıydı. Bu anahtar RLS'i bypass eder ve
  `pii_vault` dâhil her tabloya tam yetki verir.
- **Karar:** Rotasyon için ayrı bir araç yazıldı (`npm run rotate:supabase-key`).
  Faz sırası D-035'in (PII anahtarı) TERSİ:
  - D-035'te risk **veri kaybıydı** (yanlış anahtar → AES-GCM auth tag bozulur →
    kayıtlar kalıcı olarak okunamaz). Orada sıra: çöz → round-trip doğrula → yaz.
  - Burada anahtar veri şifrelemez, yalnızca kimlik doğrular. Risk **veri kaybı
    değil, hizmet kaybı**: hatalı bir anahtarla `.env`'i bozmak uygulamayı
    çalışamaz hâle getirir. Bu yüzden sıra: yeni anahtarı TAM doğrula → yaz →
    diskten geri oku → eski anahtarın öldüğünü ayrıca kanıtla.
- **"Tam doğrulama" neyi kapsıyor:** salt-okunur kontroller YETMEZ. Secret anahtar
  hem okuma hem yazma yetkisi gerektirdiği için gerçek bir yazma round-trip'i
  yapılır (insert → read-back → delete, sentetik `rotation-probe-*` kaydıyla,
  her hâlükârda temizlenir). Ayrıca `/rest/v1/` kökü ile anahtar TÜRÜ doğrulanır —
  en olası insan hatası publishable anahtarı yapıştırmaktır ve o anahtar
  salt-okunur bazı probe'ları geçebilirdi.
- **`.env` yedeği bilinçli olarak YAZILMIYOR:** bir `.env.bak`, canlı bir
  secret'ın diskte ikinci kopyası demektir — rotasyonun amacı tam olarak sızmış
  kopya sayısını azaltmak. Bunun yerine geçici dosya + `rename()` ile atomik
  yazma kullanılır (mode 0600), yarım yazılmış `.env` bırakmaz. Ek koruma:
  hedef satır tam olarak 1 kez bulunmazsa (0 veya 2+) yazma iptal edilir.
- **Doğrulama (gerçek projeye karşı koşuldu):**
  | Senaryo | Sonuç |
  |---|---|
  | geçerli secret anahtar (kuru koşum) | ✓ 8/8 tablo · yazma round-trip ✓ |
  | publishable (`sb_publishable_...`) anahtar `--apply` ile | ✗ önek kontrolünde reddedildi |
  | sahte `sb_secret_...` anahtar `--apply` ile | ✗ 0/8 tablo · iptal |
  | `.env` yazma (geçici kopya üzerinde) | ✓ yalnızca hedef satır değişti, yorumlar korundu |
  | hedef satır 0 kez / 2 kez | ✗ iki durumda da yazma iptal |
  | `--check-revoked`, hâlâ canlı anahtarla | ✗ "HÂLÂ CANLI" + exit 1 |
  Reddedilen üç senaryonun ardından `.env` md5'i değişmedi; ayrıca
  `rotation-probe-*` kaydı DB'de kalmadı (sorguyla teyit).
- **Yazma yolu nasıl test edildi:** `ROTATE_ENV_PATH` ile hedef dosya
  değiştirilebilir yapıldı; böylece gerçek `.env`'e dokunmadan geçici bir kopya
  üzerinde tam yazma yolu koşuldu. (Betikler `src/` dışında olduğu için jest
  kapsamına girmiyor — bu, script'ler için repodaki mevcut yaklaşımla tutarlı.)
- **Yan bulgu:** `rotate:pii-key` (D-035) `package.json`'a hiç eklenmemişti; üç
  dokümanda `npm run rotate:pii-key` diye anılmasına rağmen komut yoktu. Eklendi.

## D-038 — Railway dağıtımı: üç sessiz arıza kapatıldı
- **Bağlam:** Dockerfile, CI ve docker-compose MVP'den beri hazırdı; eksik olan
  yalnızca hesap bağlamak sanılıyordu. Dağıtım yolu gerçekten incelenince
  **kod tarafında üç ayrı sessiz arıza** bulundu — üçü de deploy'u "yeşil"
  gösterip ürünü çalışmaz bırakırdı.

- **(1) Hedefsiz `docker build` YANLIŞ imajı üretiyordu.** Dockerfile'ın son
  aşaması `with-browsers` idi. `--target` verilmeyen her build (Railway'in
  Dockerfile builder'ı dâhil) daima SON aşamayı derler. `docker-compose.yml` ve
  CI `target: runtime` yazdığı için bu yerelde hiç görünmüyordu; Railway ise
  sessizce ~2 GB'lık, **Node 20** tabanlı Playwright imajını üretecekti
  (`runtime` Node 22). **Karar:** aşamalar `deps → builder → with-browsers →
  runtime` sırasına alındı; `runtime` artık SON. Dosya başına ve §6'ya
  "sırasını değiştirmeyin" uyarısı eklendi. Doğrulandı: hedefsiz
  `docker build` → 218 MB, Node 22.

- **(2) Healthcheck yolu yoktu.** Uygulamada hiç HTTP controller'ı yoktu, bu
  yüzden Dockerfile `/`'ı yokluyor ve "5xx değilse sağlıklı" gibi gevşek bir
  kural kullanıyordu (`/` zaten 404 döner). Railway healthcheck'i 404'te
  dağıtımı unhealthy sayıp yeniden başlatma döngüsüne sokabilirdi.
  **Karar:** `GET /health` (HealthModule) eklendi; Dockerfile ve `railway.json`
  bu yolu kullanıyor, kural `statusCode === 200`'e sıkılaştırıldı.
  - **Bilinçli olarak LIVENESS, readiness değil:** Supabase/Anthropic'e
    dokunulmuyor. Sağlayıcı kesintisi çalışan bir süreci öldürmemeli —
    yeniden başlatmak dış servisi düzeltmez, yalnızca bekleyen işi kaybettirir.
    Bağımlılıkların gerçekten çalıştığı `npm run live:check` ile ayrıca ölçülüyor.
  - **Bilinçli olarak SIFIR bilgi:** endpoint kimlik doğrulaması isteyemez
    (platform probe'unun anahtarı yoktur), yani herkese açıktır. Yanıt sadece
    `{status, uptime}`; sürüm/ortam/sürücü ASLA yazılmaz. Alan listesini TAM
    eşleştiren bir test var, böylece ileride "debug için" eklenen bir alan
    testi kırar ve karar bilinçli olarak yeniden verilir.

- **(3) `PUBLIC_BASE_URL` tavuk-yumurta sorunu.** Webhook kaydı AÇILIŞTA
  `PUBLIC_BASE_URL` ister, ama Railway'de genel adres ancak İLK dağıtımdan
  sonra bilinir. Elle girilemediği için ilk deploy `http://localhost:3000`
  adresine webhook kaydeder → **bot sessizce hiçbir mesaj almaz.**
  **Karar:** `PUBLIC_BASE_URL` boşsa `RAILWAY_PUBLIC_DOMAIN`'den
  `https://<domain>` olarak türetilir. Açıkça verilen değer HER ZAMAN kazanır
  (özel alan adı bozulmasın). Boş string tuzağı D-020 ile aynı sırayla çözüldü:
  önce `blankToUndefined`, sonra platform varsayılanı — 4 test bunu sabitliyor.

- **`railway.json` — `numReplicas: 1` bilinçli:** cron (`@nestjs/schedule`)
  süreç İÇİNDE çalışıyor. İkinci replika aynı hatırlatmayı kullanıcıya iki kez
  gönderir ve GDPR silme işini çakıştırır. Yatay ölçekleme için önce
  zamanlayıcı ayrı bir servise çıkarılmalı (v2). `restartPolicyType=ON_FAILURE`
  + 10 deneme: env doğrulaması fail-fast olduğu için hatalı bir değişken
  sonsuz döngü yerine BAŞARISIZ DEPLOY olarak görünür.

- **`npm run check:deploy` (yeni) — neden `check-env.sh` yetmedi:** o script
  bir `.env` DOSYASI okur ve `env.schema.ts` kurallarını bash'te TEKRARLAR
  (kural kopyası = kayma riski). Yenisi gerçek `validateEnv()`'i çağırır
  (kopya yok) ve süreç ORTAMINI okur — yani `railway run npm run check:deploy`
  ile platformdaki GERÇEK değişken seti denetlenebilir. Ayrıca şemanın
  göremediği tuzakları yakalar: yerel/http `PUBLIC_BASE_URL`, `webhook` modunda
  eksik veya geçersiz biçimli sır (D-030 fail-closed → bot sağır olur),
  publishable Supabase anahtarı, geçersiz `LLM_MODEL`. Token HARCAMAZ:
  Anthropic yalnızca ücretsiz `/v1/models` ile yoklanır.
  `check-env.sh` ağ erişimi olmayan ortamlar için korundu.

- **Doğrulama (gerçekten çalıştırıldı, iddia değil):** hedefsiz `docker build`
  → 218 MB / Node 22 · `NODE_ENV=production` + gerçek `.env` ile konteyner
  temiz açıldı (0 hata) · `GET /health` → `200 {"status":"ok","uptime":8}` ·
  `/` → 404 (beklenen) · Docker HEALTHCHECK → `healthy` · `check:deploy`
  gerçek ortamda 0 hata, ve bozuk konfigürasyonlarla NO-GO senaryoları
  (localhost adres, sırsız webhook, `LLM_MOCK=true`, sahte Supabase/Anthropic
  anahtarı) tek tek tetiklendi.

- **Yan düzeltme:** `docs/DEPLOYMENT.md` iki KAPANMIŞ sorunu hâlâ açık gibi
  anlatıyordu (D-020 boş `PII_MASTER_KEY` çöküşü, D-021 eksik
  `class-validator`). Dağıtımı yapan kişiyi yanlış yönlendirirdi; düzeltildi.

## D-039 — CI artık HEDEFSİZ build eder (regresyon guard'ı, kendi hatasını yakaladı)
- **Bağlam:** D-038'de Dockerfile aşama sırası düzeltildi, ama düzeltmeyi koruyan
  hiçbir şey yoktu. CI `target: runtime` yazdığı için sıra tekrar bozulsa CI yeşil
  kalır, Railway ise yanlış imajı üretirdi — yani düzeltme sessizce geri alınabilirdi.
- **Karar:** CI hedefsiz build eder (Railway ile AYNI yol) ve ardından üretilen
  imajın gerçekten `runtime` olduğunu KANITLAR: Node 22 + Alpine tabanı +
  tarayıcı binary'si yok. `load: true` eklendi (build-push-action imajı
  varsayılan olarak yerel daemon'a aktarmaz, `docker run` doğrulaması buna muhtaç).
- **Guard'ın ilk kurbanı kendi varsayımım oldu:** ilk yazdığım kontrol
  "`node_modules/playwright` bulunmamalı" diyordu. Yerelde çalıştırınca KIRILDI —
  paket imajda GERÇEKTEN var (~18 MB), çünkü `playwright` bir
  `optionalDependency` ve `npm ci --omit=dev` optional'ları atmaz. Kaçınılan
  asıl maliyet tarayıcı binary'leri (~1.8 GB) ve onları `--ignore-scripts`
  engelliyor. Kontrol doğru ayrımla değiştirildi: `/ms-playwright` yokluğu.
  Dockerfile'daki "tarayıcı içermez" ifadesi binary'ler için doğru, JS paketi
  için değildi; DEPLOYMENT.md §6'ya bu ayrım yazıldı.
- **Guard İKİ YÖNLÜ doğrulandı** (varsayım değil, çalıştırıldı):
  | İmaj | Sonuç |
  |---|---|
  | hedefsiz build (`runtime`) | ✓ Node 22 · ✓ Alpine · ✓ binary yok · exit 0 |
  | `--target with-browsers` | ✗ Node 20 yakalandı · **exit 1** |
  `with-browsers` hedefi hâlâ derleniyor (2.08 GB — dokümandaki rakamla aynı).

## D-040 — Rotasyonun altın kuralı: yeni anahtar, sızıntı kanalından geçmemeli
- **Bağlam:** D-037'de araç yazılmıştı; 2026-07-29'da gerçekten uygulandı.
  Rotasyonun SEBEBİ eski anahtarın sohbet transkriptinde görünmesiydi.
- **Karar:** `--apply` adımı Claude Code oturumunda DEĞİL, kullanıcının kendi
  terminalinde koşuldu. Bu oturuma yalnızca maskeli parmak izi ulaştı
  (`sb_secret_rDq…ID3_`). Gerekçe basit ama kolayca gözden kaçıyor: yeni
  anahtarı `SUPABASE_KEY_NEW=... npm run ...` biçiminde buraya yazmak, onu da
  transkripte sokar — yani rotasyon, kapattığı borcu aynı anda yeniden yaratır.
  Araç bu ayrımı destekleyecek şekilde tasarlanmıştı: sır içeren adım (`--apply`)
  ile doğrulama adımları (`--check-revoked`, `test:supabase`, `check:deploy`)
  ayrı komutlar, ve doğrulama adımlarının hiçbiri yeni anahtarın DEĞERİNİ
  istemiyor — `.env`'den okuyorlar.
- **Eski anahtar için kural farklı:** o zaten sızmış kabul edildiği için
  paylaşılabilir — ama yalnızca **revoke edildikten SONRA**. Bu turda sıra
  karıştı: anahtar revoke'tan önce paylaşıldı, ilk `--check-revoked` `HTTP 200`
  döndü ve anahtar kısa bir süre hem canlı hem tam olarak transkriptte kaldı.
  Zarar sınırlıydı (`pii_vault` içeriği ayrıca `PII_MASTER_KEY` ile şifreli ve
  o anahtar hiç paylaşılmadı), ama doğru sıra netleştirilip
  MANUAL_ACTIONS_REQUIRED.md §3b'ye yazıldı.
- **Yayılma gecikmesi gözlendi:** revoke'tan hemen sonraki kontrol `HTTP 200`,
  kısa süre sonraki `HTTP 401 "Unregistered API key"` döndü. Yani tek bir
  "hâlâ canlı" ölçümü kesin kanıt değil — iptal doğrulaması tekrarlanmalı.
- **Sonuç doğrulaması:** eski anahtar 401 · yeni anahtarla 16/16 gerçek DB
  entegrasyon testi · `pii_vault` 48/48 kayıt (`key_version: 2`, D-035'ten
  beri değişmemiş — Supabase anahtarı şifreleme yapmadığı için etkilenmemesi
  gerekiyordu ve etkilenmedi) · 8/8 tablo · `check:deploy` GO.
- **Yan bulgu — kullanılmayan üçüncü anahtar:** projede `default` adlı bir
  secret anahtar daha var. Kod envanteri çıkarıldı: `src/` ve `scripts/`
  yalnızca `SUPABASE_SERVICE_ROLE_KEY` ve `SUPABASE_ANON_KEY` okuyor, `.env`'de
  de tek secret anahtar var. Kullanılmayan ama RLS'i bypass eden bir kimlik
  bilgisi saf saldırı yüzeyidir; silinmesi önerildi ("Last used" kontrolünden
  sonra). Değeri KASITLI olarak istenmedi — test etmek için onu transkripte
  sokmak, tam da bu kararın yasakladığı şey olurdu.

## D-041 — `check:deploy` platform ortamında `.env` YÜKLEMEZ (yanlış "GO" düzeltmesi)
- **Bağlam:** İlk gerçek Railway dağıtımında `railway run npm run check:deploy`
  "✓ webhook sırrı tanımlı ve geçerli biçimde — 64 karakter" dedi. Bu YANLIŞTI:
  `TELEGRAM_WEBHOOK_SECRET` Railway Variables'ta hiç yoktu. Uygulama açılışta
  `TELEGRAM_WEBHOOK_SECRET tanımsız — webhook KAYDEDİLMEDİ` hatası verip botu
  tamamen sağır bıraktı.
- **Kök neden:** `railway run` platform değişkenlerini sürece enjekte eder, ama
  script ayrıca `dotenv` ile yerel `.env`'i yüklüyordu. `dotenv` mevcut
  `process.env` girdilerini EZMEZ; dolayısıyla platformda TANIMLI olanlar doğru
  okunuyordu (bu yüzden `PUBLIC_BASE_URL` hatası doğru yakalandı) ama platformda
  EKSİK olan her değişken sessizce yerel `.env`'den dolduruluyordu. Yani araç
  yanlış değerleri görebiliyor, EKSİK değerleri göremiyordu.
- **Neden özellikle kötü:** D-038'de bu komut "asıl önemli olan bu" diye
  belgelenmişti — platformdaki gerçek değişken setini denetlediği iddiasıyla.
  Gerçekte en tehlikeli sınıfı (eksik değişken) kör noktasındaydı ve tam da
  yakalaması gereken vakada yanlış güven verdi.
- **Karar:** `RAILWAY_ENVIRONMENT` / `RAILWAY_PROJECT_ID` görünüyorsa (ya da
  `--no-dotenv` verilmişse) `.env` HİÇ yüklenmez. Araç hangi kaynağı denetlediğini
  de başlıkta yazar ("Kaynak: PLATFORM ortamı — yerel `.env` KASITLI olarak
  yüklenmedi"), böylece çıktı tek başına okunduğunda belirsizlik kalmaz.
- **Doğrulama:** aynı Railway ortamına karşı düzeltme öncesi 1 hata (yalnızca
  `PUBLIC_BASE_URL`), sonrası 2 hata — eksik `TELEGRAM_WEBHOOK_SECRET` yakalandı.
- **Genel ders (bu projede üçüncü kez):** doğrulama aracının kendisi de
  doğrulanmalı. D-033'te eval betiği model hatası sanılan bir ÖLÇÜM hatası
  üretmişti; D-039'da CI guard'ı yanlış varsayımla yazılmıştı; burada da
  GO/NO-GO aracı yanlış GO verdi. Üçünde de hatayı yakalayan şey, aracı
  gerçek dünyaya karşı koşturup çıktısını bağımsız kanıtla (loglar, imaj
  içeriği, unmask edilmiş metin) karşılaştırmak oldu.

## D-042 — İlk üretim dağıtımı: "yeşil deploy, sağır bot"
- **Bağlam:** Railway'e ilk dağıtım yapıldı. `/health` 200 dönüyordu, konteyner
  ayaktaydı, Railway dağıtımı başarılı gösteriyordu — ama bot hiçbir mesaj
  alamıyordu. Üç Variables hatası vardı ve hiçbiri konteyneri çökertmediği için
  platformun sağlık göstergeleri bunları GÖREMEZ:
  | Değişken | Yanlış | Sonuç |
  |---|---|---|
  | `TELEGRAM_WEBHOOK_SECRET` | hiç yoktu | `webhook KAYDEDİLMEDİ` — kayıt denenmedi bile |
  | `PUBLIC_BASE_URL` | `http://localhost:3000` | açık değer kazandığı için `RAILWAY_PUBLIC_DOMAIN` otomatiği (D-038) devreye girmedi |
  | `NODE_ENV` | `development` | üretim güvenlik kapısı (`superRefine`) hiç çalışmadı |
- **`NODE_ENV` özellikle sinsi:** Dockerfile `runtime` aşamasında
  `ENV NODE_ENV=production` var, ama platform Variables bunu EZER. Yani imaj
  doğru varsayılanı taşısa bile ortam değişkeni sessizce geri alabiliyor.
  Sonuç: `LLM_MOCK=true`, dev PII anahtarı ve `DB_DRIVER=memory` teknik olarak
  serbest kalıyordu — tam da D-005'te "üretimde imkânsız" diye kapatılan şeyler.
- **Teşhisi mümkün kılan şey loglar oldu, testler değil.** 547 birim testinin
  hiçbiri bunu yakalayamazdı: hepsi doğru yapılandırma varsayıyor. Yakalayan
  şey `railway logs`'taki tek satırdı:
  `TELEGRAM_WEBHOOK_SECRET tanımsız — webhook KAYDEDİLMEDİ`.
  Bu, D-030'un fail-closed tasarımının ikinci faydası: yalnızca isteği reddetmiyor,
  SEBEBİNİ de açıkça loglayıp sessiz başarısızlığı görünür kılıyor.
- **Düzeltme yöntemi:** `railway variables --skip-deploys` ile üçü toplandı,
  tek `railway redeploy` ile uygulandı (her değişiklikte ayrı yeniden başlatma
  olmasın diye). Sır `--set-from-stdin` ile geçirildi — değer komut satırına,
  dolayısıyla oturum transkriptine HİÇ yazılmadı (D-040'ın kuralı).
- **Düzeltme sonrası canlı doğrulama:** production modunda açılış · webhook
  Railway domainine kaydedildi (`last_error_message` boş) · `check:deploy` GO ·
  **D-030 üretimde saldırıyla sınandı: sırsız istek → 401, yanlış sır → 401.**
  Doğru sırla sahte update KASITLI olarak gönderilmedi — gerçek bota enjeksiyon
  olurdu.
- **`railway domain` argümansız çalıştırılınca LİSTELEMEZ, OLUŞTURUR.** Domain
  durumunu sorgulamak için kullanıldı ve yeni bir domain yarattı. Zararsızdı
  (domain zaten gerekliydi) ama komutun okuma değil YAZMA olduğu kaydedilsin.

## D-043 — Bakım script'leri Telegram botunu BAŞLATMAZ (üretim olayından doğdu)
- **Olay:** Bir teşhis script'i, DB'ye erişmek için `AppModule`'ün tamamını
  YERELDE boot etti. Bu `TelegramService.onModuleInit`'i tetikledi ve yerel
  `.env`'deki eski cloudflared adresiyle `setWebhook` çağrıldı. Telegram çağrıyı
  `400 bad webhook: Failed to resolve host` ile REDDETTİ — ama mevcut kaydı da
  SİLDİ. Sonuç: `getWebhookInfo` → `url: ""`, **üretimdeki bot birkaç dakika
  sağır kaldı.** `railway redeploy` ile geri alındı.
- **Kök neden — izolasyon YOKLUĞU:** Bot token'ı tek ve globaldir. "Yerel" ile
  "üretim" arasında Telegram tarafında hiçbir ayrım yoktur; aynı token'la
  yapılan her `setWebhook`/`getUpdates` çağrısı AYNI botu etkiler. Yani
  `AppModule`'ü yerelde boot etmek, tanım gereği üretim durumuna yazma iznidir.
- **Webhook'tan daha geniş bir sorun:** `TELEGRAM_MODE=polling` olsaydı yerel
  süreç update ÇEKMEYE başlardı — üretimdeki bota gönderilen gerçek kullanıcı
  mesajları yerelde tüketilir, kullanıcı hiç cevap alamazdı. Bu, webhook'un
  ezilmesinden daha sinsi: hiçbir hata logu üretmez.
- **Karar:** `TELEGRAM_SKIP_STARTUP` (boolish, varsayılan `false`) eklendi ve
  `onModuleInit`'te **en başta** — mode/token kontrollerinden ÖNCE — sınanıyor.
  Sonra sınansaydı geçerli bir webhook yapılandırmasında sızıp çalışırdı.
  Bayrak açıkken grammY `Bot` nesnesi HİÇ oluşturulmuyor (nesne varsa ağ
  çağrısı yapılabilir hâle gelir).
- **`scripts/script-context.ts`:** script'ler artık `NestFactory` çağırmıyor,
  `bootScriptContext()` kullanıyor — bayrağı varsayılan olarak açar. Kanal yan
  etkisi gerçekten isteniyorsa `{ allowChannels: true }` ile AÇIKÇA istenmeli.
  Amaç, doğru davranışı VARSAYILAN yapmak: gelecekte yazılacak script'ler
  hatırlamak zorunda kalmasın.
- **Uygulandığı yerler:** `live-check.ts`, `rotate-pii-key.ts` (ikisi de aynı
  tuzağı taşıyordu ve fark edilmemişti).
- **Doğrulama:** `rotate:pii-key` kuru koşumu gerçekten çalıştırıldı;
  öncesi/sonrası `getWebhookInfo` **değişmedi** (üretim webhook'u yerinde,
  62/62 vault kaydı çözüldü). 6 regresyon testi: bayrak açıkken TAM geçerli
  webhook yapılandırmasında bile bot başlamıyor · polling'de de başlamıyor ·
  bayrak kapalıyken davranış birebir aynı · boş string varsayılana düşüyor.
- **Genel ders:** "Sadece okuyacağım" niyetiyle yazılan bir script, tüm
  uygulamayı boot ederse okuma script'i değildir. Bağlam ne kadar geniş
  boot edilirse, o kadar çok `onModuleInit` — yani o kadar çok dış dünya
  yan etkisi — devreye girer. Doğru refleks: script'e MİNİMUM bağlamı vermek.

## D-044 — `tesseract.js` eklendi; `OCR_PROVIDER=local` HÂLÂ ÖNERİLMİYOR (ölçüldü)
- **Bağlam:** D-010 yıllardır "sıfır sızıntı için `OCR_PROVIDER=local`" diyordu,
  ama `tesseract.js` `package.json`'da HİÇ YOKTU — yani ilan edilen kaçış yolu
  mevcut değildi. Paket eklendi ve yol gerçekten çalıştırıldı. **İki ayrı hata
  ve bir gizlilik regresyonu bulundu.**

- **(1) ESM/CJS interop — üretimde patlıyordu.** `await import('tesseract.js')`
  derlenmiş CJS'te (üretim imajı) namespace'i
  `{ OEM, PSM, createScheduler, createWorker, default }` olarak verir ve
  `recognize` YALNIZCA `default` altındadır. ts-node/ts-jest altında ise
  namespace doğrudan çağrılabiliyordu. Sonuç: kod yerelde çalışıyor, ÜRETİM
  imajında `t.recognize is not a function` ile patlıyordu. Gerçek üretim
  imajının İÇİNDE çalıştırılarak bulundu — **D-034'ün birebir aynı deseni.**
  Düzeltildi (her iki şekil kabul ediliyor) ve üretim imajında doğrulandı:
  5.3 s, 1780 karakter. 3 regresyon testi eklendi; CJS mock'unun
  `__esModule: true` taşıması ŞART, yoksa TypeScript'in `__importStar`
  yardımcısı `default`'u modülün kendisiyle ezer ve test yanlış şekli sınar.

- **(2) Eski test geçersiz varsayıma dayanıyordu.** "tesseract.js kurulu
  değilse anlamlı hata fırlatır" testi paketin YOKLUĞUNA dayanıyordu
  ("gerçek, mock'lanmamış senaryo"). Paket kurulunca test gerçek tesseract'ı
  1 baytlık sahte görselle çalıştırıp başka sebeple hata veriyordu — iddiasını
  artık doğrulamıyordu. Eksiklik açıkça mock'lanacak şekilde yeniden yazıldı.

- **(3) 🔴 ASIL BULGU — `local` gizliliği İYİLEŞTİRMİYOR, KÖTÜLEŞTİRİYOR.**
  Sentetik fixture 01 bir görsele render edilip iki yol karşılaştırıldı:
  | | orijinal metin | tesseract OCR |
  |---|---|---|
  | ADDRESS token | 9 | **7** |
  | diğer tüm tipler (NAME/STEUERID/AUSLNR/DOB/PHONE/EMAIL/DATE/AKTENZEICHEN) | — | değişmedi |
  Sebep: tesseract `ß`'yi `B` olarak okuyor — `Torstraße 15` → `TorstraBe 15`.
  Bilinen-değer maskelemesi TAM EŞLEŞME yaptığı için kaçırıyor ve **kullanıcının
  kendi adresi maskelenmeden Claude'a gidiyor.** Umlaut'lar da bozuluyor
  (`Ausländerbehörde` → `Auslanderbehérde`).
  **Yani takas şu:** `claude-vision` görseli sağlayıcıya gönderir (ilan edilmiş,
  anlaşılmış istisna); `local` görseli göndermez ama METİN maskelemesini
  sessizce delik bırakır. İkincisi daha sinsi — hiçbir uyarı üretmez.

- **KARAR: Üretim `claude-vision` olarak BIRAKILDI.** `local`'a geçmek şu hâliyle
  gizliliği kötüleştirirdi. Geçiş için önce maskelemenin OCR bozulmalarına
  dayanıklı hâle gelmesi gerekir (ß/umlaut normalizasyonu + bilinen-değer
  eşleşmesinde fuzzy karşılaştırma), sonra bu ölçüm tekrarlanmalı.
- **Maliyet:** paket üretim imajını **218 MB → 269 MB** büyüttü (43 MB
  `tesseract.js-core` wasm). Yol henüz kullanılmıyor ama seçenek artık
  GERÇEKTEN mevcut ve çalışır durumda; kaldırılması da tek satır.
- **Not:** ölçüm temiz bir RENDER üzerinde yapıldı (Quick Look ile üretilen
  2000×2000 JPEG). Gerçek bir telefon fotoğrafında (eğrilik, gölge, gürültü)
  tesseract'ın daha da kötü olması beklenir — yani bu rakamlar **iyimser üst
  sınır**.

## D-045 — CI'da Playwright testlerinin SESSİZ atlanması yasaklandı
- **Bağlam:** `appointment-checker.spec.ts` gerçek chromium ister ve
  `isPlaywrightBrowserAvailable()` false ise `describe.skip`'e düşer. CI
  `playwright install` çalıştırmadığı için randevu izleme PoC'sinin **TEK
  gerçek testi CI'da hiç koşmuyordu** (CI 544/19 · yerel 553/16) — ama CI
  yeşildi. Bu, bu projede dört kez ısıran desenin aynısı: **araç "✓" diyor,
  ama iddia ettiği şeyi doğrulamıyor** (D-033, D-039, D-041 + teşhis script'i).
- **KARAR: yalnızca kurulum adımı eklemek YETMEZ.** `npx playwright install
  --with-deps chromium` eklendi, ama o adım ileride silinse/bozulsa aynı sessiz
  boşluk geri gelir ve CI yine yeşil kalırdı. Bu yüzden **atlama CI'da
  yasaklandı:** Jest adımına `REQUIRE_PLAYWRIGHT=1` verilir ve bayrak açıkken
  tarayıcı yoksa test **SKIP değil FAIL** eder.
- **Neden bayrak, neden koşulsuz zorunluluk değil:** yerel geliştiricinin
  chromium kurmadan tüm suite'i koşabilmesi korunmalı. Zorunluluk yalnızca
  CI'da anlamlı.
- **D-020 tuzağı:** bayrak boolish semantiğini izler; boş string varsayılana
  (kapalı) düşer.
- **Doğrulama — üç yolun ÜÇÜ de koşuldu:** tarayıcı var → 3/3 geçti ·
  tarayıcı yok + `REQUIRE_PLAYWRIGHT=1` → guard ateşledi, FAIL ·
  tarayıcı yok + bayrak yok/boş → eski SKIP davranışı birebir korundu.
  (Guard'ın kendisini doğrulamadan "koruma ekledim" demek, bu kararın
  eleştirdiği hatanın tekrarı olurdu.)

## D-046 — OCR bozulmalarına dayanıklı maskeleme (D-044'ün ön koşulu kapandı)
- **Bağlam:** D-044 `OCR_PROVIDER=local` geçişini bir **gizlilik regresyonu**
  bulduğu için bloke etmişti: tesseract `ß`'yi `B` okuyor (`Torstraße 15` →
  `TorstraBe 15`), bilinen-değer maskelemesi TAM EŞLEŞME yaptığı için
  kaçırıyor ve **kullanıcının kendi adresi maskelenmeden LLM'e gidiyordu.**
  Ve bu sessizdi — hiçbir uyarı üretmiyordu.

- **ÖNCE ÖLÇÜMÜ TEKRARLANABİLİR YAPTIM.** D-044'ün ölçümü tek seferlikti:
  render bir Quick Look JPEG'iydi, script commit edilmedi, sayılar yalnızca
  düzyazı olarak kaldı — yani "düzelttim" iddiası doğrulanamazdı.
  `scripts/ocr-mask-bench.ts` (`npm run bench:ocr-mask`) mektubu Playwright ile
  render eder, **gerçek** tesseract'tan geçirir ve çıktıyı
  `test-fixtures/ocr/` altına yazar.

- **İki metrik, ikisi de eşleştirme kurallarımdan BAĞIMSIZ.** Kendi bozulma
  simülatörümü kendi fuzzy eşleştiricimle doğrulamak kendini onaylayan bir
  döngü olurdu (§8 dersi). Bu yüzden: (1) girdi gerçek tesseract çıktısı,
  (2) metrikler token sayısı paritesi + **Levenshtein artık taraması** —
  standart bir ölçü, kurallarıma göre ayarlanmadı, dolayısıyla
  KAÇIRDIKLARIMI yakalayabilir.

- **Sonuç (14 sentetik mektup):** `8 kayıp token · 3 tanınabilir artık`
  → **`0 · 0`**.

- **Bulunan sızıntılar tek bir sebepten değildi** — dört ayrı yol:
  | # | Yol | Vaka |
  |---|---|---|
  | 1 | bilinen-değer (tam eşleşme) | `ß→B`, `ö→é`, `ü→ii`, `ä→a` (+ `ss↔ß` yazım varyantı) |
  | 2 | desen / sokak eki | `Amtsstraße 5` → `AmtsstraBe 5` |
  | 3 | desen / tireli sokak adı | `Karl-Marx-Allee` **hiç** eşleşmiyordu |
  | 4 | desen / kapı numarası | `Platz 1` → `Platz ı` (U+0131) |
  | 5 | IBAN | `DE94` → `DEg4`, token tamamen kayboldu |

- **(3) OCR'dan BAĞIMSIZ, önceden var olan bir boşluktu.** `Karl-Marx-Allee`,
  `Rosa-Luxemburg-Straße`, `Ernst-Reuter-Platz` Almanya'da çok yaygın ve temiz
  metinde de maskelenmiyordu. İki sebep vardı: gövde sınıfı ilk harften sonra
  büyük harf kabul etmiyordu, ve son ek alternasyonu yalnızca küçük harfliydi
  (tireli adlarda ek de büyük harfle başlar: `-Allee`). **Bunu OCR ölçümü
  ortaya çıkardı** — yeni bir bakış açısı, eski bir hatayı görünür kıldı.

- **(4) İkinci bir tuzak taşıyordu:** JS'te `\b` ASCII tabanlıdır. `ı`
  (U+0131) kelime karakteri sayılmaz, dolayısıyla desenin sonundaki `\b`
  satır sonunda TUTMUYORDU — düzeltme sessizce etkisiz kalırdı. Sonlandırıcı
  `(?![A-Za-z0-9])` ile değiştirildi.

- **(5) KARAR: IBAN'da kapsamı genişletirken kesinlikten ödün verilmedi.**
  Harf↔rakam karışıklıklarını desene gömüp gevşetmek yerine, aday dize
  ONARILIR ve **mod-97 checksum'ına doğrulatılır**. Bir harf birden çok rakama
  karşılık gelebildiği için (`g` → `9` mi `6` mı?) tek bir onarım seçilmez,
  adayların hepsi denenir ve kararı checksum verir. Yani tahmin değil
  doğrulama; kapsam artar, kesinlik düşmez. Arama `IBAN_MAX_REPAIR_SITES` ile
  sınırlı (kombinatoryal patlama koruması).

- **Neden genişletme yönü güvenli:** hata maliyeti asimetriktir —
  *kaçırma* = kimlik bilgisi sağlayıcıya gider (gerçek zarar);
  *fazla maskeleme* = metin okunaksızlaşır (kalite kaybı). Kararsız kalınan
  yerde maskelemek doğru varsayılandır. Ama bedelsiz değil: token/kelime
  oranı < %15 ve alan terimlerinin NAME sayılmaması testleri bu genişletmenin
  **üst sınırıdır** ve OCR metinlerinde de zorunlu kılındı.

- **Oracle'ın kendisi de doğrulandı.** "0 artık" ancak tarayıcı artığı
  BULABİLİYORSA anlamlıdır; bozuk bir tarayıcı da her zaman "0" der. Bu yüzden
  `pii.ocr-resilience.spec.ts` ayrıca D-044'ün somut vakasını tarayıcıya
  buldurur. Ayrıca hızlandırma ön elemesi (34 sn → 4.4 sn) kaba kuvvet
  referans implementasyonuyla karşılaştırılır — optimizasyon sessizce sızıntı
  gizlemesin diye.

- **Birim testi tabloda gerçek bir hata yakaladı:** i-ailesi girdilerine `1`
  eklenmişti ama `1`'in karşılıklarına `ı` eklenmemişti. Tablo simetrik
  olmadığı için bilinen-değer eşleşmesi o yönü kaçırıyordu. (Uçtan uca test
  bunu maskelemişti, çünkü aynı vakayı desen tarafı ayrıca yakalıyordu —
  iki bağımsız test seviyesinin neden gerektiğinin örneği.)

- **KAPSAM DIŞI (bilinçli):** karakter EKLEME/SİLME (`Torstra Be`) kapsanmaz;
  hizalama tabanlı bir yaklaşım gerekir, bugünkü ölçümde ihtiyaç görülmedi.
  Artık taraması bu boşluğu bağımsız olarak izlemeye devam eder.

- **ÜRETİM HÂLÂ `claude-vision`.** Bu karar `local`'a geçişin ÖNÜNÜ açar,
  geçişi YAPMAZ. Sebep: buradaki render **temiz** (Playwright/A4), yani
  ölçülen bozulma gerçek dünyanın **iyimser alt sınırı**. Gerçek bir telefon
  fotoğrafında (eğrilik, gölge, gürültü) tesseract daha kötü olur. Geçiş
  kararı kullanıcınındır ve gerçek fotoğrafla doğrulanmalıdır (D-010 takası
  hâlâ geçerli).

## D-047 — Yerel geliştirme izolasyonu TAMAMLANDI (ve kalan yarısı bulundu)
- **Bağlam:** D-043, `npm run start:dev`'in korunmadığını ve çözümün "kod değil
  hesap işi" olduğunu yazmıştı. Kullanıcı @BotFather'dan ikinci bir bot açtı
  (üretim `@BuKo749_bot` · test `@BuKoTest749_bot`) ve `.env`'e ekledi.

- **ÖNCE DOĞRULADIM, SONRA KULLANDIM.** `.env`'deki token'ın gerçekten test
  botuna ait olduğu salt-okunur `getMe` ile ölçüldü. Bu paranoya değil: HANDOFF
  §12'de kullanıcının bildirdiği durumun gerçekle uyuşmadığı üç vaka kayıtlı.
  Yanlışlıkla üretim token'ı durursa `start:dev` D-043'ü birebir tekrarlardı.
  Ölçüm sonucu: `@BuKoTest749_bot`, webhook'u boş, 0 bekleyen update. ✅

- **Yerel `.env`'de iki tehlikeli kalıntı vardı:** `TELEGRAM_MODE=webhook` ve
  `PUBLIC_BASE_URL=https://…trycloudflare.com` — yani **D-043'ü tetikleyen ölü
  adresin ta kendisi.** Test botuyla artık zararsız ama bozuk. `polling` +
  `localhost` yapıldı: ayrı token'ın asıl kazancı polling'in güvenli hale
  gelmesidir (tünel hiç gerekmez).

- **UÇTAN UCA DOĞRULANDI:** uygulama yerelde test botuyla polling'de açıldı
  (`Telegram bot polling modunda başladı`), ardından ÜRETİM ölçüldü — uptime
  kesintisiz (restart yok), webhook yerinde, `pending_update_count: 0`, hata
  yok. **D-043'ün daha önce hiç geçemediği test budur.**

### (a) Bot kimliği artık açılışta GÖRÜNÜR
- D-043'ün kök nedeni token'ın global olması değil, **hangi bota ait olduğunun
  hiçbir yerde görünmemesiydi.** Servis artık `bot.init()` sonrası bot adını
  loglar; üretim DIŞINDA `warn` seviyesinde, çünkü hata orada yapılıyor.
- Kimlik logu D-043 guard'ının **ARKASINDA** — `TELEGRAM_SKIP_STARTUP` açıkken
  `init()` (bir ağ çağrısı) hiç çalışmamalı. Test bunu ayrıca sabitler.

### (b) 🔴 ASIL BULGU — ayrı token VERİTABANINI izole etmiyor
- Ayrı bot token'ı Telegram **kanalını** izole eder. Ama `@Cron` işleri süreç
  içinde koşar ve yerel `.env`'de `DB_DRIVER=supabase` — yani **üretim
  veritabanı.** `start:dev` artık gerçekten kullanılabilir olduğu için bu
  tehlike de ilk kez gerçek hale geldi:
  - `reminders-due`: aynı hatırlatmayı ikinci kez gönderir **veya** üretim
    göndermeden önce `sent` işaretler → **kullanıcı hatırlatmasını hiç almaz**
    (sessiz veri kaybı, hiçbir hata üretmez),
  - `gdpr-purge`: silme işlemiyle çakışır.
- Bu tam olarak HANDOFF'ta `numReplicas: 1`'in gerekçesi olarak yazılan durum.
  **Yerel bir `start:dev` fiilen ikinci replikadır** — bu bağlantı bugüne kadar
  kurulmamıştı.
- **KARAR:** `SCHEDULER_SKIP_STARTUP` (boolish, varsayılan `false` — üretim
  davranışı değişmez). D-043 ile aynı disiplin: her iki cron handler'ında
  **EN BAŞTA**, herhangi bir DB erişiminden ÖNCE sınanır. Sonra sınansaydı
  `findDue()`/`purgeNow()` üretim veritabanına çoktan gitmiş olurdu; guard
  "çalışıyor" görünüp işe yaramazdı.
- `bootScriptContext()` bayrağı **varsayılan olarak açar** (`allowScheduler`
  ile açıkça istenebilir): uzun süren bir rotasyon/ölçüm script'i cron
  penceresine düşebilirdi.
- **Guard yalnızca CRON yolunu kapatır;** elle çağrılan `purgeNow()` çalışmaya
  devam eder — orada niyet açıktır ve GDPR silme aracı kullanılabilir kalmalı.

### (c) 🔍 Yan bulgu — spec'lerde `process.env` override'ı ETKİSİZ
- `SCHEDULER_SKIP_STARTUP` testini önce `AppModule` boot ederek yazdım; guard
  tutmadı. Sebep: **`ConfigModule.forRoot()` doğrulamayı import anında
  çalıştırır.** Spec gövdesinde `process.env` değiştirmek, `AppModule` dosyanın
  en üstünde import edildiği için ETKİSİZDİR.
- Ölçüldü: `SCHEDULER_SKIP_STARTUP='true'` atandıktan sonra boot edilen
  uygulamada `ConfigService.get(...)` hâlâ `false` dönüyor. Kıyas olarak
  `TELEGRAM_SKIP_STARTUP` de aynı şekilde okunmuyor.
- **Sonuç (dikkat):** `beforeEach` içinde env kuran ve `AppModule` boot eden
  mevcut spec'ler, aslında o değerleri DEĞİL **şema varsayılanlarını** test
  ediyor. Bugüne kadar fark edilmemesinin sebebi, kurulan değerlerin
  (`DB_DRIVER=memory`, `LLM_MOCK=true`, `TELEGRAM_MODE=disabled`) zaten
  varsayılanlarla aynı olması. Yani testler yanlış değil ama **iddia
  ettiklerini kanıtlamıyorlar.** Varsayılandan FARKLI bir env değerine dayanan
  bir test yazılırsa sessizce yanlış şeyi ölçer.
- Bu tura özgü çözüm: guard testleri servisi doğrudan sahte config ile kurar
  (D-043 testlerinin de bilinçli olarak yaptığı şey). Genel çözüm (`isolateModules`
  veya env'i import'tan önce kuran bir setup dosyası) `TODO.md`'ye eklendi.

## D-048 — Gerçek mektup düzeneği + yerel DB izolasyonu (+ iki kör nokta)

### (a) `test-fixtures/real/` — bırak-ve-koş
- Gerçek mektupları kullanıcı sağlayacak; kod tarafında bekleyen her şey hazır.
  Dosya bırakıldığı anda `pii.real-fixtures.spec.ts` sentetiklerle **aynı
  invaryantları** uygular (round-trip, sızıntı yok, beklenen tipler, bulanık
  artık taraması, aşırı maskeleme sınırı).
- **Gizlilik kararı: bu dizin `.gitignore`'dadır** (README + `*.example.json`
  hariç). Anonimleştirildiğini *sanmak* ile *doğrulamak* aynı şey değil ve bir
  kez commit'lenen veri git geçmişinden kolay silinmez.
- `npm run check:real-fixtures` maskeleme motorunun **ne gördüğünü** raporlar
  (tipler ve sayılar; değerler `--show-values` olmadan BASILMAZ — çıktı bir
  transkripte düşebilir, D-040 dersi). İki yönlü sağlama sağlar: beklenen alan
  görünmüyorsa anonimleştirme fazla agresif, beklenmeyen görünüyorsa eksik.
- **Sessiz atlama yok (D-045 dersi):** dizin boşken suite görünür bir "henüz
  eklenmedi" testi basar; `.txt` var ama `expected.json` kaydı yoksa **HATA**
  verir (sık yapılan yarım kurulum); `REQUIRE_REAL_FIXTURES=1` ile atlama
  tamamen yasaklanır. Dört yolun dördü de koşularak doğrulandı.
- **Aşırı maskeleme sınırı uzunluğa duyarlı yapıldı.** Adres blokları SABİT
  maliyettir (~10 token), mektup uzunluğundan bağımsız. Sabit %15 eşiği kısa
  mektuplarda yanlış alarm verir: ölçüldü, 59 kelimelik gerçekçi bir mektupta
  oran %25,4 çıktı ama maskeli metin tamamen analiz edilebilirdi (kurum, konu,
  son tarih token'ı, eksik belge listesi — hepsi yerinde). Sınır ≥150 kelimede
  %15, altında %32. Asıl ölçü ise orandan çok içerik: kurum/konu/kapanış
  metinlerinin ayakta kalması ayrıca test edilir.

### (b) Yerel `DB_DRIVER` varsayılanı `memory` oldu
- D-047 cron'ları durdurdu ama **mesaj işleme yolu** hâlâ üretim veritabanına
  yazıyordu (o yolu guard'lamak doğru olmaz — kullanıcı etkileşimiyle
  tetikleniyor). Yerel `.env` artık `DB_DRIVER=memory`.
- **Ama önce bir tuzak kapatıldı:** `memory` varsayılanı, gerçek DB gerektiren
  script'leri SESSİZCE ANLAMSIZ hâle getirirdi:
  - `rotate:pii-key` bellekte BOŞ kasa görür, "0 kayıt rotate edildi" der ve
    **başarılı görünür** — oysa gerçek kasaya hiç dokunulmamıştır,
  - `live:check` bellekte koşarsa "canlı yığın doğrulandı" iddiası boştur;
    üstelik kodda yalnızca `(supabase olmalı)` YAZIYORDU, engellemiyordu.
  - Ortak `assertSupabaseDriver()` eklendi: bu script'ler artık DB_DRIVER'ı
    varsaymaz, **talep eder** ve `memory` ile çalışmayı reddeder. Uyarı basıp
    devam etmek yetmez — D-041'de tam da öyle bir araç yanlış "GO" vermişti.
  - `test:supabase` / `smoke:supabase` kendi env'ini kendisi kurar (etkilenmez).

### (c) 🔴 `scripts/` HİÇ tip kontrolünden geçmiyormuş
- Kök `tsconfig.json`'ın `include`'u `["src/**/*","test/**/*"]` — `scripts/`
  yok. Script'ler `ts-node -T` ile koşuyor ve `-T` = **transpile-only**, yani
  tip kontrolü yok. Sonuç: `scripts/` bugüne kadar hiç tip denetlenmedi.
- Gerçek vaka (bu turda): `import type` ile alınan `AppConfigService` DI
  token'ı olarak kullanıldı; `tsc --noEmit` hiçbir şey demedi.
- **Kök tsconfig'e `scripts/**` EKLEMEK YANLIŞ ÇÖZÜM — üretimi kırar.**
  Denendi ve ölçüldü: `nest build` aynı dosyayı kullanıyor; scripts dâhil
  edilince çıktı `dist/main.js` yerine `dist/src/main.js` oluyor ve
  Dockerfile'daki `node dist/main.js` **kırılıyor** (konteyner açılışta
  çökerdi), ayrıca `dist/scripts/` imajı şişiriyor.
- **Çözüm:** ayrı `tsconfig.scripts.json` (yalnızca `noEmit`) +
  `npm run typecheck:scripts` + CI adımı. Kanıt: kasıtlı `import type` hatası
  enjekte edildi → yeni kontrol `TS1361` yakaladı, eski `tsc` sustu.

## D-049 — Test hermetikliği ÖRTÜK bir varsayıma dayanıyormuş

- **Bulgu:** `config.module.ts` şunu diyor:
  `ignoreEnvFile: process.env.NODE_ENV === 'test'`. Yani testlerin yerel
  `.env`'den izole olması (D-032) tamamen `NODE_ENV`'in **import anında**
  'test' olmasına bağlı — ve bunu repoda hiçbir şey garanti etmiyordu,
  yalnızca **Jest'in örtük varsayılanı** sağlıyordu.
- **Ölçüldü:** `NODE_ENV=development npx jest` ile config `.env`'i okumaya
  başlıyor; `telegramMode` şema varsayılanı `disabled` yerine `.env`'deki
  `polling` geliyor. İki somut sonuç:
  - `LLM_MOCK=false` + gerçek anahtar → testler **ÜCRETLİ** gerçek API'ye
    çıkar (bu bir kez yaşandı, 24 test kırılmıştı — D-032),
  - `TELEGRAM_MODE=polling` → test suite'i **gerçek botu** başlatmaya çalışır,
    yani D-043 sınıfı bir yan etki.
- **KARAR:** `jest.setup.ts` (`setupFiles`) hermetik tabanı AÇIKÇA sabitler.
  `setupFiles` seçildi çünkü spec'in modülleri yüklenmeden ÖNCE koşar;
  `ConfigModule.forRoot()` import anında okuduğu için daha geç bir kanca geç
  kalırdı. Doğrulandı: `NODE_ENV=development` ile artık sızıntı yok.
- **Bilinçli kısıtlama:** setup dosyası yalnızca ŞEMA VARSAYILANLARINI
  sabitler. `TELEGRAM_SKIP_STARTUP`/`SCHEDULER_SKIP_STARTUP` "ekstra güvenlik"
  diye `true` yapılmadı: ikisinin de varsayılanı `false` ve zorlamak test
  SEMANTİĞİNİ değiştirirdi — `reminders.service.spec.ts` guard yüzünden
  sessizce erken döner, testler geçer ama hiçbir şey doğrulamazdı.

### D-047c'nin DÜZELTİLMİŞ hâli — ilk ifade fazla genel
- İlk kayıt "beforeEach'te env kuran spec'ler varsayılanları test ediyor"
  diyordu. **Denetlendi (12 spec):** 8'i env'i import'tan SONRA kuruyor
  (etkisiz), 4'ü ÖNCE (çalışıyor, ör. `supabase.integration.spec.ts` — D-023
  bunu zaten biliyordu; TypeScript'in CJS emit'i `require`'ları kaynak
  sırasında bıraktığı için doğru çalışır).
- **Pratik etki bugün SIFIR:** 8 riskli spec'in kurduğu değerlerin hepsi zaten
  şema varsayılanı (`memory`, `true`, `disabled`) + `NODE_ENV=test` (Jest zaten
  koyuyor). Yani hiçbir test bugün yanlış şey ölçmüyor. Risk gelecekte:
  varsayılandan FARKLI bir değere dayanan ilk test sessizce yanlış ölçerdi.
- **Tuzak artık teste bağlandı:** `test-hermeticity.spec.ts` "test gövdesinde
  env değiştirmek etkisizdir" davranışını sabitler. Bir gün `ConfigModule`
  tembel okumaya geçerse bu test kırılır ve tuzağın kalktığını haber verir.
- **Doğru yol için yardımcı:** `bootAppWithConfig()`. İlk denenen çözüm
  (`jest.resetModules()` + dinamik import) **ÇALIŞMADI ve terk edildi**:
  reset sonrası tepede statik import edilmiş `AppConfigService`, yeniden
  yüklenen grafikteki sınıftan farklı bir nesne olduğu için
  `app.get(...)` "provider does not exist" ile düşüyor. Yardımcı bunun yerine
  boot edilmiş config örneğinin getter'larını `app.init()`'ten ÖNCE gölgeler.

### D-048d — Yetim süreçler: tehlikenin gerçek dünyadaki kanıtı

D-047b, "yerel bir `start:dev` fiilen ikinci replikadır" derken **varsayımsal**
bir riskten bahsediyordu. Aynı gün makinede üç yetim süreç bulundu ve risk
varsayımsal olmadığı görüldü:

| Süreç | Yaş | Durum |
|---|---|---|
| `jest src/common/testing` | 44 dk | Testler bitmiş, **açık handle** yüzünden Jest çıkamamış (terk edilen `resetModules` yaklaşımının kalıntısı) |
| `ts-node src/main.ts` | 1 sa 32 dk | **Telegram'a açık bağlantı** — test botunu polling'e devam ediyordu |
| `node dist/main.js` | **13 gün** | `/health` öncesi (D-038 öncesi) eski build, `:3000`'i işgal ediyordu |

- **13 günlük süreç en öğretici olanı.** Telegram'a bağlantısı yoktu (update
  çalmıyordu) ama cron'ları üretim veritabanına karşı koşuyor olabilirdi ve
  bunu **ne kanıtlayabildim ne çürütebildim**: `reminders` tablosu boş olduğu
  için hatırlatma cron'u iz bırakmaz, `gdpr-purge` ise silecek bir şey yoksa
  audit kaydı yazmaz. Yani bu sınıf tehlike **sessiz** — tam da D-047b'nin
  iddiası. Kullanıcı onayıyla sonlandırıldı.
- **Kendi temizleme mantığım hatalıydı.** D-047 doğrulaması için açtığım
  uygulamayı öldürdüğümü sanıyordum: `spawn` çağrısında `detached: true`
  vermediğim için süreç grubu yoktu, `process.kill(-pid)` boşa gitti ve
  `npx` sarmalayıcısını öldürmek TORUN süreci (asıl uygulama) hayatta bıraktı.
  **Kural:** kısa ömürlü bir uygulama boot'u başlatan her script `detached: true`
  ile başlatmalı ve süreç GRUBUNU öldürmeli; ayrıca öldürdüğünü `ps` ile
  DOĞRULAMALI. "Öldürdüm" ile "öldü" arasındaki fark, bu projede tekrar tekrar
  çıkan "yaptım" ile "etkisi görünür oldu" farkının aynısı.
- **Refleks:** uzun bir oturumun sonunda `ps -eo pid,etime,command | grep dist/main`
  ile yetim süreç taraması yapılmalı. Üretim etkilenmemişti (uptime kesintisiz,
  webhook yerinde, 0 bekleyen update) ama bu şansa bırakılacak bir şey değil.

## D-050 — CI sonucu beklenmeden merge'den söz edilmez (süreç kuralı)

- **Bağlam:** Bir dokümantasyon commit'i push edildi, CI tetiklendi ve koşu
  **daha bitmeden** "merge kararı sende" denildi. Kullanıcı bunu düzeltti.
- **Neden gerçek bir risk:** Bu repoda `main`'e merge → Railway **otomatik
  deploy** demek. "CI koşuyor, merge kararı sende" cümlesi, sonucu bilinmeyen
  bir değişikliği onaya sunmaktır; kullanıcı "merge et" der ve koşu kırmızı
  çıkarsa kırık kod doğrudan üretime gider. Bekleme maliyeti birkaç dakika,
  hatanın maliyeti canlı bir bot.
- **KARAR (CLAUDE.md §8.1, bağlayıcı):** commit CI'ı tetiklediyse koşu bitip
  sonucu teyit edilmeden merge sorulmaz, önerilmez ve karar kullanıcıya
  devredilmez. Yeşilse sonuç **gösterilerek** bildirilir; kırmızıysa sebebi
  (job, adım, test, log satırları) açıklanır ve merge gündeme getirilmez.
- **Teyit, `conclusion: success` görmek DEĞİLDİR.** Job sonucuna ek olarak
  log'dan bağımsız kanıt okunur: test/suite sayıları yerelle eşit mi (D-045
  invaryantı), kritik suite'ler gerçekten `PASS` satırı üretmiş mi, yeni
  eklenen CI adımları gerçekten koşmuş mu. Bu projede aracın kendisi dört kez
  yanıldı (D-033, D-039, D-041 + teşhis script'i).
- **`AGENTS.md` de senkronlandı.** İki dosya birebir kopyaydı; yalnızca
  `CLAUDE.md`'yi güncellemek Codex oturumunun ESKİ kuralla çalışması demekti.
  Kural: bu iki dosyadan biri değişirse diğeri aynı commit'te güncellenir.

## D-051 — `pii.real-fixtures.spec.ts`: gitignore'lu `expected.json` şema uyuşmazlığı canlıda test çökertti

- **Bağlam:** Bir mühendislik denetiminde `npm test` bu makinede `1 failed, 1
  skipped, 44 passed` verdi. Kırmızı olan `src/common/pii/pii.real-fixtures.spec.ts`
  bir assertion'da değil, suite YÜKLENİRKEN `TypeError` ile çöküyordu.
- **Kök neden:** `test-fixtures/real/expected.json` — D-048 ile eklenen, `.gitignore`'lu,
  yalnızca bu makinede var olan gerçek fixture beklentileri dosyası — spec'in
  beklediği kanonik şemayla (`{ file, expectedRiskLevel, expectedDeadline,
  expectedPiiTypes }`, bkz. README.md ve `expected.example.json`) değil, anahtarın
  kendisini zaten dosya adı olarak kullanan, alan adları farklı (`riskLevel`,
  `deadline`, `piiMustBeMasked`) daha zengin bir şemayla yazılmıştı. Dosyanın
  kendi `_schema_note` alanı bunu itiraf ediyordu: "kanonik şemaya erişim
  olmadan yazıldı, hizalanması gerekiyor." Spec kayıtsız şartsız
  `expected[k].file` okuyunca `undefined` çıktı, `join(REAL_DIR, undefined)`
  patladı — cryptic bir `TypeError`, anlamlı bir hata değil.
  Dosya gitignore'lu olduğu için kalıcı düzeltme dosyada değil, KOD'da olmalıydı.
- **KARAR:** `pii.real-fixtures.spec.ts`'e bir `normalizeEntry()` adımı eklendi:
  (1) `.file` alanı yoksa anahtarın kendisi (gerekirse `.txt` eklenerek) dosya
  adı olarak kullanılır; (2) girdi nesne değilse (string/array/null) sessizce
  atlamak yerine hangi anahtarda ne bulunduğunu söyleyen açık bir hata
  fırlatılır. Bilinçli olarak YAPILMAYAN şey: `expectedPiiTypes`'ı zengin
  şemadaki `piiMustBeMasked`'ın anahtarlarından otomatik türetmek. Denendi —
  gerçek fixture'larda STEUERID/IBAN/PHONE'un maskeleme motoru tarafından
  yakalanmadığını ortaya çıkardı (muhtemelen boşluklu IBAN/Steuer-ID biçimleri,
  D-046 sınıfı bir desen boşluğu olabilir). Bu gerçek ve ilginç bir bulgu ama
  BAŞKA bir görev — bu görevin kapsamı "test altyapısını onar", "üretim
  maskeleme motorunu genişlet" değil; ikisini aynı düzeltmede karıştırmak hem
  denetim kapsamını bulanıklaştırır hem de kimin onayladığı belirsiz bir
  davranış değişikliğini sessizce içeri sokar.
- **Doğrulama:** `npx jest --testPathPattern pii.real-fixtures` → 1 suite, 40
  test, hepsi yeşil (önceden: suite çöktüğü için 0 test bile çalışmıyordu).
  Tam `npm test`: 45/46 suite yeşil (1 skip, önceden de öyleydi, ilgisiz),
  698 test yeşil, 0 kırmızı.
- **Açık iş:** STEUERID/IBAN/PHONE'un `piiMustBeMasked` altında listelenip
  maskeleme motorunca gerçekten yakalanıp yakalanmadığı henüz doğrulanmadı —
  bir sonraki oturumda `npm run check:real-fixtures` ile veya
  `expectedPiiTypes`'ı bilinçli olarak elle `expected.json`'a ekleyip
  ayrı bir görev olarak incelenmeli.

## D-052 — `RetentionService`: statik `@Cron` yerine `SchedulerRegistry` ile runtime yeniden-zamanlama

- **Bağlam:** Bir mühendislik denetiminde `retention.service.ts`'te
  `@Cron(DEFAULT_DELETION_CRON, { name: 'gdpr-purge' })` dekoratörünün
  **derleme zamanında sabit** bir string kullandığı, `.env`'deki
  `DELETION_CRON` farklı bir değer verse bile gerçek cron zamanlamasının
  ASLA değişmediği (yalnızca `onModuleInit`'te bir uyarı logu basıldığı)
  tespit edildi. Kök neden: `@Cron`'un argümanı sınıf gövdesi
  değerlendirilirken (DI enjeksiyonundan ÖNCE) sabitlenmek zorunda —
  enjekte edilen `AppConfigService`'e decorator içinden erişilemiyordu.
- **KARAR:** Statik `@Cron` dekoratörü KALDIRILDI. Bunun yerine NestJS'in
  resmi "Dynamic schedule module" deseni uygulandı: `RetentionService`
  artık `SchedulerRegistry`'yi enjekte ediyor, `onModuleInit()` içinde
  `AppConfigService.deletionCron`'dan okunan GERÇEK değerle `cron`
  paketinin `CronJob`'ını oluşturup `schedulerRegistry.addCronJob('gdpr-purge', job)`
  ile RUNTIME'DA kaydediyor ve `job.start()` ile başlatıyor.
  `DEFAULT_DELETION_CRON` ('0 3 * * *') sabiti yalnızca dokümantasyon/log
  amaçlı korundu — `env.schema.ts`'teki gerçek varsayımla birebir eşleşiyor.
- **`cron` paketi ek bağımlılık olarak eklenmedi:** `@nestjs/schedule@^4.1.1`
  zaten `cron@3.2.1`'i (tipleriyle birlikte) geçişli bağımlılık olarak
  `node_modules/cron`'a kuruyor; `SchedulerRegistry.addCronJob` zaten bu
  paketin `CronJob` tipini bekliyor. `npm install` gerekmedi,
  `package.json` değiştirilmedi.
- **`handlePurgeCron()`'daki `SCHEDULER_SKIP_STARTUP` guard'ı (D-047)
  KORUNDU** — kaldırılmadı, çünkü hem `scheduler-isolation.spec.ts`'in
  servisi DOĞRUDAN (`new RetentionService(...)`, Nest lifecycle'ı
  atlayarak) kurup `handlePurgeCron()`'u çağıran testleri hem de "elle
  tetiklenen cron callback'i her zaman güvenli olmalı" ilkesi buna bağımlı.
  Guard, cron job'ın KAYDINI değil, tetiklendiğinde DB'ye dokunmasını
  engelliyor — iki kaygı kasıtlı olarak ayrı tutuldu.
- **Test stratejisi (D-043/D-047 ile aynı, kanıtlanmış desen izlendi):**
  `retention.service.spec.ts`'e `DELETE_CRON dinamik yeniden-zamanlama`
  başlıklı yeni bir `describe` eklendi. İlk denenen yaklaşım —
  `it()` içinde `process.env.DELETION_CRON`'u değiştirip `AppModule`'ü
  yeniden `Test.createTestingModule(...)` ile derlemek — ÇALIŞMADI:
  `scheduler-isolation.spec.ts`'in zaten belgelediği gibi `AppModule` bu
  spec dosyasının tepesinde STATİK import edildiğinden, `ConfigModule.forRoot()`
  doğrulaması `process.env`'i test gövdesi çalışmadan ÖNCE okuyup dondurmuş
  oluyor; sonradan `process.env`'i değiştirmek etkisiz kalıyor (spy 3 çağrı
  yakaladı ama hiçbiri özel cron değerini taşımıyordu). Bunun yerine
  `RetentionService`'i sahte bir `AppConfigService` ile DOĞRUDAN kurup
  (gerçek, DI'sız bir `SchedulerRegistry` örneğiyle) `onModuleInit()`'i elle
  çağıran bir birim testine geçildi — hem `jest.spyOn(schedulerRegistry,
  'addCronJob')` ile çağrının GERÇEKTEN özel zamanlamayla yapıldığı, hem de
  `schedulerRegistry.getCronJob('gdpr-purge').cronTime.source` ile kaydın
  kalıcı ve `running: true` olduğu doğrulanıyor. Ayrı bir test, varsayılan
  env ile boot edilen ana `app`'te de aynı job'ın `DEFAULT_DELETION_CRON`
  ile ve çalışır durumda kayıtlı olduğunu doğruluyor.
- **Doğrulama:** `npx jest --testPathPattern "retention.service|scheduler-isolation"`
  → 2 suite, 16 test, hepsi yeşil. Tam `npm test`: 45/46 suite yeşil (1 skip,
  ilgisiz), 700 test yeşil, 0 kırmızı (D-051'deki 698'den +2 — yeni testler).
  `npx tsc --noEmit` temiz.

## D-053 — ESLint hiç kurulu değildi: `npm run lint` yıllardır `command not found` veriyordu

- **Bağlam:** Bir mühendislik denetiminde `package.json`'daki
  `"lint": "eslint ... --fix"` script'inin ÇALIŞTIRILAMADIĞI bulundu:
  `eslint` hiçbir zaman `devDependencies`'e eklenmemiş, hiçbir
  `.eslintrc`/`eslint.config.*` dosyası da yoktu. Proje bugüne kadar HİÇ
  statik analizden geçmemişti — `npm test`/`tsc` yeşildi ama bu, kör bir
  nokta olduğu gerçeğini değiştirmiyordu.
- **KARAR:** Güncel (flat config) bir ESLint kurulumu eklendi:
  `eslint@10`, `typescript-eslint@8`, `@eslint/js`, `eslint-config-prettier`
  devDependency olarak kuruldu; `eslint.config.mjs` oluşturuldu. Kural seti
  `eslint.configs.recommended` + `tseslint.configs.recommendedTypeChecked`
  — bilinçli olarak `strict`/`stylistic` setleri DEĞİL: ~130 dosyalık,
  şimdiye kadar hiç lint edilmemiş bir kod tabanında daha agresif bir set
  yüzlerce kozmetik hataya yol açardı. `npm run lint` glob'u `{src,test}`
  idi, `scripts` EKSİKTİ — `{src,test,scripts}` olarak düzeltildi (aksi
  halde `scripts/` hem tip kontrolünden hem lint'ten muaf kalmaya devam
  ederdi, D-048'in `typecheck:scripts` ile kapattığı boşluğun lint eşdeğeri).
- **İlk koşuda 220 hata çıktı, tamamı düzeltildi (sıfıra indirildi), davranış
  DEĞİŞTİRİLMEDEN:**
  - **`@typescript-eslint/no-unsafe-assignment` (25 örnek, `supabase/*.repository.ts`):**
    Supabase client generic tip almadan kullanıldığından `.single()`/
    `.maybeSingle()` sonrası `data: any`. Gerçek düzeltme: yanıtı doğrudan
    `(await ...) as { data: XRow | null; error: PostgrestError | null }`
    ile cast edip use-site'daki eski `data as XRow` cast'lerini kaldırmak
    (artık gereksizdi). 8 repository dosyasının tamamında uygulandı — bu
    projenin production kod yolundaki TEK gerçek `any` sızıntısıydı.
  - **`@typescript-eslint/require-await` (72 örnek, ezici çoğunluk
    `persistence/memory/*.repository.ts` + `channels/mock/mock.adapter.ts`):**
    Bu sınıflar, gerçek (Supabase/Telegram) implementasyonlarla AYNI async
    arayüzü sürücüden bağımsız olarak uygulamak ZORUNDA (`persistence.module.ts`
    `DB_DRIVER`'a göre ikisi arasında sessizce geçiş yapıyor) ama kendi
    gövdeleri I/O yapmadığından hiç `await` içermiyor — hata değil, kasıtlı
    mimari kısıt. Kural bu üç dizin için `eslint.config.mjs`'de KAPATILDI
    (yorumla gerekçelendirildi), spec dosyaları için de aynı şekilde (jest
    mock'ları `async () => value` deseniyle aynı false-positive'i üretiyor).
  - **`no-unsafe-*` ailesi + `unbound-method` + `no-require-imports`
    (spec dosyalarında, ~90 örnek):** grammy/Supabase/Anthropic SDK'larını
    taklit eden elle yazılmış test mock'ları doğası gereği `any` sızdırıyor;
    test kodu deploy edilmediği için bunları tip-güvenli hale getirmenin
    üretim güvenliğine katkısı yok, efor kapsam dışı. `**/*.spec.ts` için
    kapatıldı — gerekçe `eslint.config.mjs`'de.
  - **`preserve-caught-error` (5 örnek, `llm.service.ts`/`ocr.provider.ts`
    dahil production dosyaları):** yakalanan hata yeniden fırlatılırken
    `cause` eklenmiyordu (debug için orijinal stack kayboluyordu). GERÇEK
    düzeltme: `{ cause: err }` eklendi. Bu, `Error`'ın 2-argümanlı
    constructor'ının tip bilgisini gerektiriyor ve `tsconfig.json`'ın
    `target: ES2021` varsayılan lib'i bunu içermiyordu (TS2554) — `"lib":
    ["ES2021", "ES2022.Error"]` eklendi. Bunun derleme ÇIKTISINI
    etkilemediği doğrulandı: Node 22 `cause`'u runtime'da zaten native
    destekliyor, `target` yalnızca sözdizimi/polyfill'i etkiler; `npm run
    build` + `dist/main.js`'in konumu (D-048 invaryantı) sonrasında
    doğrulandı.
  - **`no-unnecessary-type-assertion` (12 örnek):** `--fix` ile otomatik
    temizlendi — TEK istisna `telegram.controller.spec.ts`: autofix, private
    `logger` alanına erişmek için kasıtlı konan `as never as {...}` köprü
    cast'ini "gereksiz" sanıp SİLDİ ve `tsc`'yi TS2341 ile kırdı (autofix'in
    kendisi hatalıydı — otomatik düzeltmeyi bile kör güvenmemek gerektiğinin
    bir örneği daha). Cast geri eklendi, satıra hedefli bir
    `eslint-disable-next-line` gerekçeli yorumla kondu.
  - **İki gerçek D-043 tekrarı bulundu ve düzeltildi:** `scripts/prompt-eval.ts`
    ve `scripts/smoke-supabase.ts`, D-043'ün önlemeye çalıştığı TAM deseni
    zaten işliyordu — `NestFactory.createApplicationContext(AppModule)`'ü
    DOĞRUDAN çağırıyorlardı (yeni eklenen `no-restricted-imports` kuralı bunu
    yakaladı). İkisi de `bootScriptContext()`'e geçirildi; davranış aynı
    kaldı (ikisi de zaten kanal/scheduler'a ihtiyaç duymuyordu).
  - Küçük gerçek hatalar: `pii.service.ts`'de iki ölü fonksiyon
    (`escapeRegex`/`foldLocaleCase`, gerçek implementasyon zaten
    `ocr-tolerance.ts`'te) kaldırıldı; `config.service.ts`'de bir gereksiz
    cast; `conversation.service.ts`'de kullanılmayan `catch (error)` binding'i
    (`catch` olarak sadeleştirildi).
- **`scripts/` için D-043'ü YAPISAL olarak zorlayan yeni kural:**
  `eslint.config.mjs`'de `scripts/**/*.ts` (yalnızca `script-context.ts`
  muaf) için `no-restricted-imports` ile `@nestjs/core` import'u yasaklandı.
  Artık bu ihlal `npm run lint`'te (ve CI'da) DERLEME ZAMANINDA yakalanıyor,
  denetimde tesadüfen bulunmayı beklemiyor.
- **CI'a `ESLint` adımı eklendi** (`.github/workflows/ci.yml`, tsc-scripts
  adımından hemen sonra, Jest'ten önce) — ama `npm run lint` DEĞİL, ham
  `npx eslint ... ` (─fix'siz): `npm run lint`'in `--fix`'i CI çalıştırıcısında
  bir hatayı sessizce onarıp yeşil çıkarabilir, oysa asıl PR dalında hata
  DURUR — tam olarak bu projenin dört kez ısırıldığı "araç ✓ diyor ama
  gerçekte doğrulamıyor" sınıfı (D-033/D-039/D-041). CI kapısı kasıtlı olarak
  daha sert.
- **Doğrulama:** `npm run lint` → 0 hata/0 uyarı. `npx tsc --noEmit` → temiz.
  `npm run typecheck:scripts` → temiz. `npm run build` → başarılı,
  `dist/main.js` doğru konumda (D-048 invaryantı korundu). `npm test` →
  45/46 suite yeşil (1 skip, ilgisiz), 700/700 test yeşil, 0 kırmızı —
  D-052'deki sayıyla birebir aynı (lint/tip düzeltmeleri test DAVRANIŞINI
  değiştirmedi, yalnızca tip/lint uyumluluğu sağladı).

## D-054 — README/ARCHITECTURE gerçek durumdan geride kalmıştı; artık CI'da otomatik çapraz doğrulanıyor

- **Bağlam:** Ayrı bir mühendislik denetiminde README.md'nin ve
  ARCHITECTURE.md'nin gerçek koddan geride kaldığı, somut ve kanıtlı şekilde
  bulundu:
  - README.md "**547 test geçiyor**" (40 suite) diyordu; `npm test` gerçekte
    **700 test, 45 suite** (1 suite ilgisiz nedenle skip) veriyordu.
  - README.md "Proje belgeleri" tablosunda DECISIONS.md için "(19 karar)"
    yazıyordu; `grep -c "^## D-" DECISIONS.md` gerçekte **53** veriyordu.
  - README.md "Lisans: MIT" diyordu ama repo kökünde `LICENSE` dosyası hiç
    yoktu (`package.json`'daki `"license": "MIT"` alanına rağmen).
  - ARCHITECTURE.md, `modules/documents/` diye aktif bir modülden ("mektup
    alımı, durum yönetimi, depolama referansı") bahsediyordu; ama
    `src/modules/documents/` gerçekte tamamen boştu (kod yok, yalnızca boş
    bir `dto/` alt klasörü) — TODO.md (F2.2) zaten bunun terk edildiğini,
    belge alımının `modules/analysis/` pipeline'ı içinde modellendiğini
    kaydediyordu.
- **Düzeltmeler:**
  - README.md'deki test sayısı → "700 test geçiyor" (45 suite; 1 suite
    ilgisiz nedenle skip), karar sayısı → "(53 karar)" olarak güncellendi.
  - Repo köküne standart bir MIT `LICENSE` eklendi. Telif satırı gerçek bir
    kişi adı UYDURMAK yerine `Copyright (c) 2026 BüKo project contributors`
    olarak yazıldı (`package.json`'daki proje adı + son commit'in yılı).
  - ARCHITECTURE.md'deki `modules/documents/` satırı kaldırıldı;
    `modules/analysis/` maddesine, belge alımının ayrı bir modül olarak değil
    bu pipeline içinde modellendiğine dair açık bir not eklendi.
  - `src/modules/documents/` (kod barındırmayan, yalnızca boş `dto/`
    içeren, git tarafından hiç izlenmeyen bir klasör — boş dizinler git'e
    girmez) dosya sisteminden silindi. Var olmayan bir modülü var gibi
    göstermek yerine gerçek durumu yansıtmak tercih edildi.
- **Kalıcı çözüm (tek seferlik yama değil):** Bu sınıf kayma ("iddia" ile
  "gerçek durum" arasında biri güncellenir, diğeri unutulur) D-050'nin
  belgelediği "araç ✓ diyor ama gerçekte doğrulamıyor" ailesine çok benziyor.
  Bunu bir daha manuel denetime bırakmamak için `scripts/check-docs-sync.ts`
  eklendi:
  - DECISIONS.md'deki gerçek `## D-XXX` sayısını sayar, README.md'nin
    "(N karar)" ifadesindeki N ile karşılaştırır.
  - README.md'nin "**N test geçiyor**" ifadesindeki N'i gerçek Jest
    sonucundaki `numPassedTests` ile karşılaştırır.
  - İkisinden biri uyuşmazsa `process.exit(1)` ile kırmızı çıkar ve hangi
    sayının hangi sayı olduğunu (README vs. gerçek) net yazar.
  - **Test sayısı kaynağı — tasarım kararı:** jest'i CI'da İKİNCİ KEZ
    çalıştırmak yerine (chromium kurulumu + tüm suite'i tekrar koşturmak
    CI dakikası israfı olurdu), `.github/workflows/ci.yml`'deki mevcut
    "Birim testleri (Jest)" adımı `--json --outputFile=jest-results.json`
    ile zaten makine-okunur bir sonuç üretecek şekilde genişletildi; script
    CI'da bu dosyayı OKUR. Yerelde (`npm run check:docs-sync`) böyle bir
    dosya genelde yok — script bu durumda kendi kendine yeterli olsun diye
    jest'i kendisi bir kez çalıştırıp geçici bir JSON üretir. Bu, "CI
    yapısına en az invaziv" seçenekti.
  - `package.json`'a `"check:docs-sync": "ts-node -T scripts/check-docs-sync.ts"`
    eklendi; CI'da yeni bir "Doküman senkron kontrolü" adımı olarak, Jest
    adımından hemen sonra ve build'den önce çalıştırılıyor.
- **Doğrulama:** `npm run check:docs-sync` → yeşil (Karar sayısı: DECISIONS.md
  54 = README.md 54 — bu kaydın kendisi eklendikten SONRAKİ nihai sayı; Test
  sayısı: Jest 700 = README.md 700). `npx tsc --noEmit`
  → temiz. `npm run typecheck:scripts` → temiz. `npm run lint` → 0 hata/0
  uyarı (yeni script `scripts/**` ESLint kurallarından — D-053'te eklenen
  `no-restricted-imports`/type-checked kurallar dahil — temiz geçti). `npm
  test` → 45/46 suite yeşil (1 skip, ilgisiz), 700/700 test yeşil, 0 kırmızı
  (bu kararın kendisi test davranışını değiştirmedi).

## D-055 — /start'ta AI şeffaflık mesajı İKİ KEZ gönderiliyordu — canlı kullanıcı testiyle bulundu

- **Bağlam:** Denetim raporundaki düzeltmeler production'a deploy edildikten
  sonra, botun gerçekten çalıştığını doğrulamak için kullanıcı Telegram'dan
  gerçek bir `/start` mesajı gönderdi. Railway HTTP loglarında istek `200`
  dönüyordu, ama kullanıcının Telegram'dan kopyalayıp paylaştığı gerçek
  transkriptte AI şeffaflık açıklaması ("🤖 Merhaba! Ben BüKo... HUKUKİ TAVSİYE
  DEĞİLDİR...") **birebir aynı metinle iki kez** görünüyordu.
- **Kök neden:** İki bağımsız kod yolu aynı mesajı gönderiyordu:
  1. `TelegramService.dispatch()` — `/start` komutunda kanal seviyesinde
     `aiDisclosureText` gönderiyordu ("kanal seviyesinde garanti edilir —
     downstream modüllere bırakılmaz" yorumuyla savunulmuştu).
  2. `ConversationService.handleCommand('start')` — kanal-agnostik akışın
     PARÇASI olarak AYRICA aynı metni gönderiyordu (CLAUDE.md §7 gereği her
     kanalda çalışması gerektiği için).
  İkisi de kendi biriminde "doğru" görünüyordu: `telegram.service.spec.ts`
  sahte bir `handler = jest.fn()` kullanıyordu (gerçek `ConversationService`
  hiç devreye girmiyordu), `conversation.service.spec.ts` ise sahte bir
  `MockChannelAdapter` ile `ConversationService`'i tek başına test ediyordu.
  Hiçbir test TelegramService → TelegramAdapter → ConversationService
  zincirini GERÇEKTEN uçtan uca kurup mesaj SAYISINI doğrulamıyordu — tam da
  bu projenin daha önce defalarca vurguladığı "birim ✓ diyor ama kompozisyon
  doğrulanmıyor" sınıfı bir boşluk.
  Ayrıca `MockChannelAdapter`'da bu "kanal seviyesi garanti" hiç yoktu — yani
  WhatsApp/Mock kanalında AI şeffaflığı yalnızca `ConversationService`
  üzerinden çalışıyordu. Bu da kanıtlıyor ki channel-level kopya bir güvence
  değil, yalnızca Telegram'a özgü bir mükerrerlik kaynağıydı.
- **Karar:** `TelegramService.dispatch()`'teki kanal-seviyesi gönderim
  (`trySendDisclosure`) tamamen kaldırıldı. Tek kaynak artık
  `ConversationService`'tir — kanal-agnostik, tüm adaptörlerde (Telegram,
  Mock, gelecekteki WhatsApp) aynı şekilde çalışır.
- **Regresyon testi:** Yeni bir dosya —
  `telegram.ai-disclosure.e2e.spec.ts` — gerçek `TelegramService` +
  gerçek `TelegramAdapter`'ı `ConversationService`'in `ChannelAdapter`'ı
  olarak DI'a bağlar (yalnızca grammY'nin ağ çağıran `api.sendMessage`'ı
  sahte) ve `/start`'ın TAM ZİNCİRDEN geçtiğinde şeffaflık mesajının tam
  olarak bir kez gönderildiğini doğrular. Eski koda karşı ÖNCE kırmızı
  olduğu (`toHaveLength(1)` beklenirken `2` alındığı) doğrulandıktan sonra
  düzeltme uygulandı ve yeşile döndü — testin gerçekten bu regresyonu
  yakaladığının kanıtı.
- **Doğrulama:** `npm test` → 46/47 suite yeşil (1 skip, ilgisiz), 702/702
  test yeşil (yerelde, gerçek fixture'larla) — CI'ın kanonik sayısı 663
  (46 suite). `npx tsc --noEmit` ve `npm run lint` temiz. README/
  `check:docs-sync` yeni sayıya (663) güncellendi.
- **Ders:** Ölçülen her şey testliydi (PII sızıntısı, onay kapısı, GDPR
  silme), ama iki AYRI birimin BİR ARADA doğru davrandığını hiç kimse
  test etmemişti. Gerçek kullanıcı trafiği, unit test'lerin kör noktasını
  (kompozisyon) birim testlerden daha hızlı buldu.

## D-056 — `/profil` hiçbir rıza kontrolü yapmıyordu — canlı kullanıcı testiyle bulundu

- **Bağlam:** D-055'in doğrulanmasının ardından, "/onayla → belge işleme"
  akışının rıza kapısı kod tabanında zaten test edilmişti
  (`rıza olmadan belge işlenmez (GDPR)` bloğu). Bunun BENZERİ bir kontrolün
  `/profil` komutunda da var olup olmadığı canlıda denendi: `/sil` ile
  temizlenmiş, rızası hiç kaydedilmemiş bir kullanıcı doğrudan `/profil`
  gönderdi — `/onayla` HİÇ çağrılmadan.
- **Bulgu:** Bot doğrudan onboarding'e geçti ve "1/3 — Adınız ve soyadınız?"
  diye sordu. `handleCommand`'daki `'profil'/'profile'` case'i ve
  çağırdığı `startOnboarding()`/`ProfileService.save()` zincirinin HİÇBİRİ
  `user.consentAt` kontrolü yapmıyordu — yalnızca `handleDocument()` bu
  kontrolü yapıyordu.
- **Neden önemli:** Onboarding, kullanıcının GERÇEK (maskelenmemiş) ad ve
  adresini toplayıp `pii_vault`'a AES-256-GCM ile şifreli yazan TEK akış
  (D-027). Bu, belgedeki üçüncü taraf bilgisini işlemekten daha AZ değil,
  daha FAZLA hassasiyet taşıyor — ama tutarsız biçimde daha ZAYIF bir
  kapıya (hiç kapı yok) sahipti. Proje genelinde "rıza olmadan kişisel veri
  işlenmez" ilkesinin en kritik uygulama noktasında bir istisna vardı.
- **Karar:** `'profil'/'profile'` case'ine `handleDocument()`'takiyle AYNI
  kontrol eklendi: `if (!user.consentAt) { send(needConsent); return; }`,
  `startOnboarding()`'den ÖNCE. `onboardingStep` haritası artık yalnızca
  rıza verilmiş kullanıcılar için doldurulabiliyor; bu da `/gec` ve serbest
  metin cevap yollarını da dolaylı olarak korumaya alıyor (onboardingStep
  hiç set edilmediği için).
- **Regresyon testi:** `conversation.service.spec.ts`'e yeni bir blok —
  `/onayla` çağrılmadan `/profil` gönderildiğinde onboarding'in
  BAŞLAMADIĞINI (yanıtta "adınız ve soyadınız" GEÇMEDİĞİNİ) ve ardından
  gelen bir "isim" cevabının `pii_vault`'a YAZILMADIĞINI (`profile:` önekli
  kayıt sayısı 0) doğruluyor; ayrıca `/onayla` sonrası `/profil`'in normal
  çalıştığını da doğruluyor. Eski koda karşı ÖNCE kırmızı olduğu
  (`toMatch(/onayla/)` beklenirken doğrudan onboarding metni alındığı)
  ampirik olarak doğrulandıktan sonra düzeltme uygulandı.
- **Doğrulama:** `npm test` → 46/47 suite yeşil (1 skip, ilgisiz), 704/704
  test yeşil (yerelde) — CI'ın kanonik sayısı 665 (46 suite). `npx tsc
  --noEmit` ve `npm run lint` temiz. README (665 test, 56 karar) senkron.
- **Ders:** İki farklı komutun (`/taslak` gerektirmeyen belge akışı vs.
  `/profil`) aynı ilkeyi (rıza) uygulaması gerektiğinde, ilkeyi TEK bir
  yerde (örn. ortak bir guard/decorator) zorlamak yerine her `case`'e ayrı
  ayrı eklemek, tam olarak bu sınıf kayıp noktasını yaratıyor. Kısa vadede
  düzeltme yeterli; uzun vadede "rıza gerektiren komutlar" listesini
  merkezi bir yerde tanımlamak aynı hatanın üçüncü bir komutta tekrarını
  önler (açık iş — bkz. TODO.md).
