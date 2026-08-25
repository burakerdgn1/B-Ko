# BüKo — Mimari (ARCHITECTURE.md)

> Ana orkestratör (Opus) tarafından tasarlandı. Kritik kararlar: veri modeli, PII maskeleme,
> güvenlik. Uygulama detayları Sonnet subagent'lara devredildi.

## 1. Sistem Genel Bakış

BüKo, Almanya'daki göçmenlerin resmi kurum mektuplarını (v1: Ausländerbehörde + genel
"resmi mektup") yönetmesine yardımcı olan bir **Telegram botu** (kanal-agnostik altyapı).

```
Kullanıcı (Telegram)
      │  mektup foto/PDF
      ▼
┌─────────────────────────────────────────────────────────────┐
│  NestJS Backend                                              │
│                                                              │
│  Channel Adapter (Telegram / WhatsApp-mock)                  │
│        │                                                     │
│        ▼                                                     │
│  DocumentsService  ──►  AnalysisPipeline (state machine)     │
│        │                    │                                │
│        │                    ├─ 1. ingest (foto/pdf)          │
│        │                    ├─ 2. PII MASK  ◄── PiiService   │
│        │                    ├─ 3. LLM: OCR/vision + analiz   │
│        │                    │      (Claude, maskeli veri)    │
│        │                    ├─ 4. PII UNMASK ◄── PiiService  │
│        │                    ├─ 5. classify/deadline/risk     │
│        │                    ├─ 6. missing-docs               │
│        │                    └─ 7. draft (approval gerekli)   │
│        ▼                                                     │
│  Persistence (Supabase / Postgres) + PII Vault (AES-GCM)     │
│                                                              │
│  RemindersService (deadline cron + GDPR silme cron)          │
│  WatcherService (Playwright randevu izleme PoC)              │
└─────────────────────────────────────────────────────────────┘
```

## 2. Teknoloji Seçimleri (bağlayıcı)

| Katman | Seçim | Not |
|---|---|---|
| Dil/Runtime | TypeScript / Node 22 | |
| Framework | NestJS 10 | Modüler DI, test edilebilir |
| Telegram | grammY | Modern, tip-güvenli bot framework |
| LLM | Anthropic Claude (`@anthropic-ai/sdk`) | Native vision = OCR |
| DB | Supabase (Postgres) | AB bölgesi (GDPR) |
| DB erişim | `@supabase/supabase-js` + SQL migration | |
| Validasyon | Zod | env + DTO |
| Test | Jest + Supertest | |
| Tarayıcı | Playwright | Randevu izleme PoC |
| Şifreleme | Node `crypto` AES-256-GCM | PII vault at-rest |
| Deploy | Docker + Railway/Coolify | |

Model default: `claude-sonnet-5` (analiz), vision destekli. Model ID `.env` ile değiştirilebilir.

## 3. Modül Haritası

- `config/` — Zod ile doğrulanan env; tüm sırlar buradan.
- `common/pii/` — **PII maskeleme (moat, kritik).** Deterministik tokenizasyon.
- `common/crypto/` — AES-256-GCM zarf; PII vault şifreleme.
- `modules/channels/` — `ChannelAdapter` arayüzü; `telegram/` (gerçek), `mock/` (WhatsApp yerine).
- `modules/analysis/` — orkestrasyon state machine + pipeline; belge alımı
  (mektup fotoğrafı/PDF, durum yönetimi, depolama referansı) ayrı bir
  `documents/` modülü olarak değil, bu pipeline'ın içinde modellendi
  (bkz. TODO.md F2.2).
- `modules/llm/` — Claude sarmalayıcı; **her çağrı PiiService'ten geçer**, prompt şablonları.
- `modules/drafts/` — taslak mektup üretimi + **human-in-the-loop approval state**.
- `modules/reminders/` — deadline hatırlatma + GDPR (Art.17) silme cron.
- `modules/watcher/` — Playwright randevu/form izleme PoC (tek kurum).
- `modules/persistence/` — Supabase istemcisi + repository'ler.

## 4. Veri Modeli (özet — detay `supabase/migrations/0001_init.sql`)

- `users` — kanal kimliği, profil (visa_type, family_status), **consent_at**, **ai_disclosure_ack_at**, `delete_after`.
- `documents` — user_id, kaynak tipi, storage_ref, status, `delete_after`.
  `masked_text` yalnızca MASKELİ metni tutar; ancak maskeleme NAME'i kapsamadığı
  için v1'de isimler bu alanda ham kalır (bkz. DECISIONS D-024).
- `analyses` — document_id, authority, summary, request_type, **deadline_date**, **risk_level**, `missing_documents` (jsonb).
- `drafts` — analysis_id, content, **status (draft/pending_approval/approved/rejected/sent)** — kod seviyesinde onay kapısı.
- `reminders` — due_date, kind, sent_at, status.
- `pii_vault` — document_id, token, entity_type, **ciphertext + iv + authTag** (orijinal PII asla düz metin saklanmaz).
- `audit_log` — şeffaflık/güvenlik izi.
- `appointment_watches` — Playwright izleme durumu.

Tüm tablolarda RLS için hazırlık; `delete_after` ile veri minimizasyonu.

## 5. Kritik Akış: PII-Güvenli LLM Çağrısı

```
metin/görsel  ─► PiiService.mask() ─► {maskedText, map}
                                          │
                    Claude API (yalnızca maskedText/masked görsel) 
                                          │
              model çıktısı (token'lar içerir) ─► PiiService.unmask(map)
                                          │
                                 kullanıcıya/DB'ye
```
- LLM'e giden hiçbir veride ham kimlik bilgisi bulunmaz (test ile doğrulanır — DoD).
- Map yalnızca process içi + `pii_vault`'ta **şifreli** saklanır.

## 6. Güvenlik & Uyum (mimariye gömülü)

1. **Human-in-the-loop:** hiçbir taslak, `approved` state'ine geçmeden "gönderildi" sayılmaz; otomatik kurum gönderimi **yok**.
2. **PII asla çıplak çıkmaz:** bkz. §5; testsiz "tamam" sayılmaz.
3. **Veri minimizasyonu:** `delete_after` + silme cron (GDPR Art.17).
4. **Şeffaflık:** her oturum başında AI olduğunu bildirir; `ai_disclosure_ack_at`.
5. **Konumlandırma:** "hukuki tavsiye değil, bilgilendirme/hazırlık asistanı" — kod & README.

## 7. Kanal-Agnostiklik

`ChannelAdapter` arayüzü: `sendMessage`, `sendDocument`, `downloadIncomingFile`, `presentApproval`.
Telegram gerçek implementasyon; WhatsApp gerçek kimlik gelene kadar `MockChannelAdapter`.
Gerçek WhatsApp anahtarı geldiğinde tek `.env` + yeni adapter ile devreye girer.
