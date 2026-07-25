# PROGRESS.md — Kronolojik İlerleme Logu

Format: `- [faz/görev] (sahip) ne yapıldı — kararlar/testler`

## Faz 0 — Scaffold
- [F0.1] (Opus) Dizin iskeleti + tracking dosyaları (ARCHITECTURE, DECISIONS, TODO, PROGRESS, STATUS, MANUAL_ACTIONS) oluşturuldu. Mimari + kritik kararlar (PII, veri modeli, güvenlik) belgelendi.
- [F0.2/F0.3] (Opus) Scaffold doğrulandı, `npm install` tamam, ilk commit `2a07cf2` atıldı.
- [F1a] (Opus) `0001_init.sql`: 8 tablo + enum'lar. Onay kapısı DB trigger'ı (`enforce_draft_approval_gate`), `purge_expired_data()` (GDPR Art.17), RLS hazırlığı, `updated_at` otomasyonu.
- [F1d] (Opus) Config modülü: Zod fail-fast doğrulama; ÜRETİMDE mock/dev kaçış yolları (LLM_MOCK, memory DB, dev PII anahtarı) şema seviyesinde reddediliyor.
- [F1c] (Opus) **PII moat tamamlandı.** Deterministik tokenizasyon (bilinen-değer + 15 yapısal desen), AES-256-GCM vault (AAD bağlama ile confused-deputy savunması). IBAN mod-97 ve Steuer-ID yapısal doğrulaması ile yanlış pozitif elemesi. Token enjeksiyonu savunması. **54/54 test geçti** — round-trip ve "sızıntı yok" invaryantları dâhil.
- [F1c-fix] (Opus) Test, Türkçe noktasız `ı`/`I` case-folding kaçağını yakaladı (D-011); düzeltildi + regresyon testi eklendi. Hedef kitle Türk göçmenler olduğu için sessiz bir PII sızıntısı olurdu.
- [F1g] (Opus) `src/common/types/domain.ts` — paylaşılan sözleşmeler paralel agent'lar başlamadan sabitlendi (D-012).
- [F2.0] (Opus) Almanca tarih ayrıştırma + deadline'a göre risk yükseltme + hatırlatma zamanlaması. **30/30 test geçti.** Risk yalnızca yükseltilir, asla düşürülmez.
- [F1b/F1e/F1f/F2.3] (Opus) 4 Sonnet subagent paralel başlatıldı: persistence, LLM servis, kanal adaptörleri, sentetik fixture'lar. Dosya sahiplikleri ayrık.

## Faz 1 — Entegrasyon (subagent çıktıları doğrulandı)
- [F1f] (Sonnet) Kanal katmanı: `ChannelAdapter` soyutlaması, grammY Telegram adaptörü, mock adapter, 3 dilde AI şeffaflık metni, 4096 karakter bölme, onay inline keyboard. 69 test. Ana oturum bağımsız doğruladı: geçti.
- [F2.3] (Sonnet) 8 sentetik Behördenbrief (Ausländerbehörde ×6, Bürgeramt, bilgilendirme) + expected.json + profiles.json. Türk/Suriyeli/Hintli/Somalili/Vietnamlı/Nijeryalı/Ukraynalı/Romen isimleri, 8 farklı şehir.
- [F1b] (Sonnet) Persistence: 8 repository × (memory + supabase), mappers, driver seçimi. 36 test.
- [F1e] (Sonnet) LLM servis: fail-closed sızıntı denetimi, Zod yapılandırılmış çıktı + 1 onarım denemesi, deterministik mock, `OcrProvider` soyutlaması (claude-vision / local tesseract).
- [F1c-fix] (Opus) **D-013 gerçek PII sızıntısı bulundu ve kapatıldı** — fixture tabanlı bağımsız test, aynı Aktenzeichen'in ikinci etiket altında maskesiz kaldığını ortaya çıkardı. Maskeleme iki geçişli hâle getirildi.
- [F1b-fix] (Opus) **D-014 onay kapısı bypass'ı bulundu ve kapatıldı** — tek çağrıda `{status:'sent', approvedAt}` insan onayını atlıyordu; üç katmanda da (memory/supabase/DB trigger) düzeltildi, yanlış davranışı doğrulayan test tersine çevrildi.
- [F1h] (Opus) `app.module.ts` entegrasyonu + `app.module.spec.ts` DI bütünlük testi (anahtarsız boot kanıtı).
- [F1c-fix2] (Opus) **D-015 yüksek etkili recall açığı** — profil yalnızca tam ad içerdiğinde Alman mektuplarının standart hitabındaki ("Sehr geehrter Herr Yılmaz") soyadı maskelenmiyordu. Ad parçaları artık ayrı maskeleniyor.
- [F1e-verify] (Opus) `llm.leak-guard.spec.ts` — 8 gerçek fixture mektubu sahte istemciyle gönderilerek API payload'ında ham PII olmadığı ve sızıntı hâlinde 0 istek gittiği bağımsız olarak kanıtlandı.

## Faz 2 — Çekirdek akış
- [F2.0] (Opus) Deadline/risk yardımcıları — 30 test.
- [F2.1/F2.2] (Opus) **AnalysisPipeline** tamamlandı: ingest → OCR/maskeleme → LLM → vault (şifreli) → deadline token çözümü → risk yükseltme → analiz kaydı → hatırlatma → audit. Uçtan uca test: DB'de ham PII yok, vault round-trip çalışıyor, kullanıcı çıktısı unmask edilmiş, hata yolunda PII loglanmıyor. 298/298 test geçiyor.
- [F3a/F3b/F5.1/F5.3] (Opus) 4 subagent paralel başlatıldı: taslak üretimi, Playwright PoC, hatırlatma+GDPR cron, DevOps.

## Faz 3 & 4 — Üretim, izleme, arayüz
- [F3a] (Sonnet) `DraftsService`: Beamtendeutsch taslak üretimi + tam onay durum makinesi. Vault AAD'ini belgenin GERÇEK sahibine bağlamış (confused-deputy koruması) ve modelin ÜRETTİĞİ metin üzerinde de fail-closed sızıntı denetimi eklemiş — istenmemişti, doğru karar. 9 test.
- [F3b] (Sonnet) `WatcherService` + `AppointmentChecker`: Playwright randevu izleme PoC'si. Gerçek kurum sitesine istek atmaz (etik); yerel mock HTML sayfalarıyla çalışır. Tarayıcı kurulu değilse testler skip edilir, uygulama çökmez. 30 dakikalık bilinçli "kibar polling" aralığı. 10 test + 3 skip.
- [F4.1] (Opus) **`ConversationService` — son halka.** Botu ürün akışına bağlar: /start → AI şeffaflığı → rıza → belge → analiz özeti → /taslak → onay butonları → İNSAN ONAYI → metin kullanıcıya. tr/de/en. 15 test.
  - Kod seviyesinde zorlanan iki kural test edildi: (1) rıza olmadan belge işlenmez — onaysız gönderimde hiç kayıt oluşmaz; (2) hiçbir şey kullanıcı adına kuruma gönderilmez.
- [F1h] (Opus) Tüm modüller `app.module.ts`'e bağlandı; 343 test geçiyor, tsc temiz.

## Faz 5 — Test & Teslim
- [F5.1] (Sonnet) `RemindersService` (saatlik) + `RetentionService` (GDPR Art.17). Silme sırası `purge_expired_data()` ile birebir. Ajan, kapsamı dışında kalan bir eksikliği gizlemek yerine raporladı → D-019.
- [F5.1-fix] (Opus) **D-019 eksik GDPR silme** — `deleteUserData` yalnızca `scheduled` hatırlatmaları siliyordu; `ReminderRepository.findByUser` eklendi (abstract+memory+supabase), üç durumu kapsayan regresyon testi yazıldı.
- [F5.3] (Sonnet) Dockerfile (multi-stage, non-root, healthcheck) + `with-browsers` hedefi, docker-compose, GitHub Actions CI, deployment scriptleri, `docs/DEPLOYMENT.md`. **İmajı gerçekten build etti (218 MB) ve çalıştırdı** — bu sayede iki gerçek hata bulundu.
- [F5.3-fix] (Opus) **D-020 açılışta çökme** — `.env.example` kopyalamak uygulamayı çökertiyordu (boş env değeri Zod `.optional()`'ı geçmiyordu). Merkezî düzeltme + regresyon testi + gerçek boot doğrulaması.
- [F5.3-fix] (Opus) **D-021** — kullanılmayan global `ValidationPipe` kaldırıldı (2 bağımlılık eklemek yerine; uygulamada hiç HTTP controller'ı yok).
- [F5.4] (Opus) README (sorun/çözüm, PII garantisi + dürüst OCR sınırlaması, demo senaryosu) + mermaid diyagramlar.
- [F5.5] (Opus) **DoD doğrulaması tamamlandı.** Playwright tarayıcısı kuruldu; daha önce atlanan 3 test artık gerçekten çalışıyor. **361/361 test geçiyor, 0 atlanan.** MVP bitti.
