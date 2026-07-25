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
