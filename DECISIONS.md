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
