# BüKo — Mimari Diyagramlar

> Kaynak: `ARCHITECTURE.md`. Bu dosya görsel (mermaid) karşılıklarını içerir.
> GitHub bu diyagramları doğrudan render eder.

## 1. Sistem Bileşenleri

```mermaid
graph TB
    subgraph user["Kullanıcı"]
        TG["Telegram<br/>(mektup foto / PDF)"]
    end

    subgraph backend["NestJS Backend"]
        CH["ChannelAdapter<br/>telegram · mock(WhatsApp)"]
        DOC["DocumentsService"]
        PIPE["AnalysisPipeline<br/>(state machine)"]
        DRAFT["DraftsService<br/>human-in-the-loop"]
        REM["RemindersService<br/>deadline + GDPR cron"]
        WATCH["WatcherService<br/>Playwright PoC"]

        subgraph guard["Gizlilik Katmanı"]
            PII["PiiService<br/>mask / unmask"]
            CRYPTO["CryptoService<br/>AES-256-GCM"]
        end

        LLM["LlmService<br/>(PII zorunlu geçiş)"]
    end

    subgraph ext["Dış Servisler"]
        CLAUDE["Claude API<br/>vision + analiz"]
        DB[("Supabase / Postgres<br/>+ pii_vault")]
    end

    TG --> CH --> DOC --> PIPE
    PIPE --> PII
    PII --> LLM
    LLM -->|"yalnızca MASKELİ veri"| CLAUDE
    CLAUDE -->|"token'lı çıktı"| LLM
    LLM --> PII
    PIPE --> DRAFT --> CH
    PIPE --> REM --> CH
    WATCH --> CH
    PII --> CRYPTO --> DB
    PIPE --> DB
    DRAFT --> DB

    style guard fill:#fff4e6,stroke:#e8890c
    style CLAUDE fill:#e6f0ff,stroke:#3b6fd4
```

## 2. Belge Analiz Akışı (çekirdek döngü)

```mermaid
sequenceDiagram
    autonumber
    actor U as Kullanıcı
    participant CH as ChannelAdapter
    participant P as AnalysisPipeline
    participant PII as PiiService
    participant L as LlmService
    participant C as Claude API
    participant DB as Supabase

    U->>CH: Mektup fotoğrafı
    CH->>P: IncomingMessage + dosya
    P->>L: OCR (OcrProvider)
    Note over L,C: claude-vision modunda görsel<br/>ham PII içerir (D-010).<br/>local modda hiç dışarı çıkmaz.
    L-->>P: ham metin

    P->>PII: mask(ham metin, kullanıcı profili)
    PII-->>P: maskeli metin + eşleme tablosu

    P->>L: analyzeDocument(maskeli metin)
    L->>L: detectLeaks() — sızıntı varsa ÇAĞRI YAPILMAZ
    L->>C: yalnızca maskeli metin
    C-->>L: JSON (token'lar içerir)
    L->>L: Zod doğrulaması
    L-->>P: LlmAnalysisResult

    P->>PII: unmaskDeep(sonuç)
    PII-->>P: gerçek değerlerle sonuç

    P->>DB: analiz (MASKELİ) + pii_vault (ŞİFRELİ)
    P->>DB: hatırlatmalar (deadline'dan türetilir)
    P->>CH: özet + risk + eksik belgeler
    CH->>U: sonuç mesajı
```

## 3. Human-in-the-Loop Onay Kapısı

```mermaid
stateDiagram-v2
    [*] --> draft: taslak üretildi
    draft --> pending_approval: kullanıcıya sunuldu
    pending_approval --> approved: kullanıcı ONAYLADI
    pending_approval --> rejected: kullanıcı REDDETTİ
    rejected --> draft: yeniden üret
    approved --> sent: kullanıcı gönderdi/indirdi
    sent --> [*]

    note right of approved
        'sent' durumuna geçiş
        approved_at olmadan
        REDDEDİLİR — hem uygulama
        katmanında hem DB trigger'ında.
    end note

    note left of pending_approval
        BüKo hiçbir belgeyi resmi
        kuruma OTOMATİK göndermez.
        Gönderim eylemi her zaman
        kullanıcıya aittir.
    end note
```

## 4. PII Maskeleme Veri Akışı

```mermaid
flowchart LR
    RAW["Ham metin<br/>'Ahmet Yılmaz, Frist 30.06.2024'"]

    subgraph mask["mask()"]
        K["1· Bilinen-değer<br/>(kullanıcı profili)"]
        R["2· Yapısal desen<br/>(regex + checksum)"]
        T["3· Tokenizasyon<br/>değer → [[TYPE_n]]"]
    end

    MASKED["'[[NAME_1]], Frist [[DATE_1]]'"]
    LLMBOX["Claude API"]
    OUT["Model çıktısı<br/>deadlineToken: '[[DATE_1]]'"]
    FINAL["unmask → '30.06.2024'"]
    VAULT[("pii_vault<br/>AES-256-GCM<br/>ciphertext")]

    RAW --> K --> R --> T --> MASKED
    MASKED -->|"güvenli"| LLMBOX --> OUT --> FINAL
    T -.->|"eşleme tablosu<br/>ŞİFRELİ"| VAULT
    VAULT -.-> FINAL

    style RAW fill:#ffe6e6,stroke:#c92a2a
    style MASKED fill:#e6ffe9,stroke:#2f9e44
    style LLMBOX fill:#e6f0ff,stroke:#3b6fd4
    style VAULT fill:#fff4e6,stroke:#e8890c
```

## 5. Veri Modeli (ilişkiler)

```mermaid
erDiagram
    users ||--o{ documents : "gönderir"
    users ||--o{ reminders : "alır"
    users ||--o{ appointment_watches : "izler"
    users ||--o{ pii_vault : "profil PII'si"
    documents ||--o| analyses : "analiz edilir"
    documents ||--o{ pii_vault : "belge PII'si"
    analyses ||--o{ drafts : "taslak üretir"
    analyses ||--o{ reminders : "deadline doğurur"

    users {
        uuid id PK
        text channel_user_id
        timestamptz consent_at
        timestamptz ai_disclosure_ack_at
        timestamptz delete_after "GDPR Art.17"
    }
    documents {
        uuid id PK
        text masked_text "ham metin ASLA"
        timestamptz delete_after
    }
    analyses {
        uuid id PK
        date deadline_date
        risk_level risk_level
        jsonb missing_documents
    }
    drafts {
        uuid id PK
        draft_status status "onay kapısı"
        timestamptz approved_at
    }
    pii_vault {
        uuid id PK
        text token "[[NAME_1]]"
        text ciphertext "YALNIZCA şifreli"
        text iv
        text auth_tag
    }
```
