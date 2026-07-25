-- ============================================================================
-- BüKo — 0001_init.sql
-- AI Bureaucracy Copilot — başlangıç şeması
--
-- Tasarım ilkeleri (ARCHITECTURE.md §4, §6):
--   1. PII iş verisinden AYRI tutulur (pii_vault) ve YALNIZCA ciphertext olarak saklanır.
--   2. Veri minimizasyonu: her kullanıcı-verisi tablosunda `delete_after` (GDPR Art. 17).
--   3. Human-in-the-loop: drafts.status kod+DB seviyesinde onay kapısı; 'sent' yalnızca
--      'approved'dan sonra gelebilir (trigger ile zorlanır).
--   4. Şeffaflık: audit_log + users.ai_disclosure_ack_at.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── ENUM tipleri ────────────────────────────────────────────────────────────
do $$ begin
  create type channel_kind as enum ('telegram', 'whatsapp', 'mock');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_status as enum (
    'received', 'processing', 'analyzed', 'failed', 'deleted'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_source as enum ('photo', 'pdf', 'text');
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_level as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Human-in-the-loop akışı. 'sent' asla otomatik atanmaz (CLAUDE.md §7).
  create type draft_status as enum (
    'draft', 'pending_approval', 'approved', 'rejected', 'sent'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_kind as enum ('deadline', 'followup', 'appointment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_status as enum ('scheduled', 'sent', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type watch_status as enum ('active', 'paused', 'found', 'error');
exception when duplicate_object then null; end $$;

-- ── users ───────────────────────────────────────────────────────────────────
-- Not: kullanıcının ADI/ADRESİ gibi PII burada DÜZ saklanmaz; profil yalnızca
-- maskeleme için gerekli *sınıf* bilgisini (visa_type vb.) tutar. Kullanıcının
-- kendi PII değerleri (bilinen-değer maskelemesi için) pii_vault'ta şifreli durur.
create table if not exists users (
  id                    uuid primary key default gen_random_uuid(),
  channel               channel_kind not null,
  channel_user_id       text not null,
  locale                text not null default 'de',

  -- profil (PII değil — sınıflandırma bilgisi)
  visa_type             text,
  family_status         text,
  city                  text,

  -- uyum / şeffaflık
  consent_at            timestamptz,
  ai_disclosure_ack_at  timestamptz,

  -- veri minimizasyonu
  delete_after          timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint users_channel_uid_uniq unique (channel, channel_user_id)
);

create index if not exists users_delete_after_idx on users (delete_after)
  where delete_after is not null;

-- ── documents ───────────────────────────────────────────────────────────────
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  source        document_source not null,
  status        document_status not null default 'received',

  -- Dosyanın kendisi object storage'da; burada yalnızca referans.
  storage_ref   text,
  mime_type     text,
  size_bytes    integer,

  -- Ham metin ASLA burada tutulmaz (PII içerir). Yalnızca MASKELİ metin.
  masked_text   text,

  error_message text,
  delete_after  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_user_idx on documents (user_id);
create index if not exists documents_status_idx on documents (status);
create index if not exists documents_delete_after_idx on documents (delete_after)
  where delete_after is not null;

-- ── analyses ────────────────────────────────────────────────────────────────
create table if not exists analyses (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents(id) on delete cascade,

  authority          text,               -- ör. 'Ausländerbehörde Berlin'
  request_type       text,               -- ör. 'Unterlagennachforderung'
  summary            text,               -- MASKELİ özet
  deadline_date      date,
  risk_level         risk_level not null default 'medium',
  missing_documents  jsonb not null default '[]'::jsonb,
  next_steps         jsonb not null default '[]'::jsonb,

  -- Model çıktısı denetim için saklanır — MASKELİ hâliyle (D-004).
  raw_model_output   text,
  model              text,
  confidence         numeric(3,2),

  delete_after       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists analyses_document_idx on analyses (document_id);
create index if not exists analyses_deadline_idx on analyses (deadline_date)
  where deadline_date is not null;

-- ── drafts (human-in-the-loop) ──────────────────────────────────────────────
create table if not exists drafts (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references analyses(id) on delete cascade,

  content      text not null,            -- kullanıcıya gösterilirken unmask edilir
  subject      text,
  language     text not null default 'de',
  status       draft_status not null default 'draft',

  approved_at  timestamptz,
  rejected_at  timestamptz,
  sent_at      timestamptz,
  reject_reason text,

  delete_after timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists drafts_analysis_idx on drafts (analysis_id);
create index if not exists drafts_status_idx on drafts (status);

-- Onay kapısı: 'sent' durumuna yalnızca approved_at doluysa geçilebilir.
-- Bu, "insan onayı olmadan hiçbir şey gönderilmez" kuralının DB seviyesindeki karşılığı.
create or replace function enforce_draft_approval_gate()
returns trigger as $$
begin
  -- 'sent'e geçiş, ÖNCEDEN kalıcılaşmış bir onay gerektirir.
  -- OLD satırına bakılır: aynı UPDATE içinde approved_at set edilerek kapı
  -- aşılamaz. Onay, ayrı ve önceki bir insan eylemi olmak zorundadır.
  if new.status = 'sent' then
    if tg_op = 'INSERT' then
      raise exception
        'draft % cannot be created directly in sent state (human approval required first)',
        new.id;
    end if;

    if old.status is distinct from 'sent'
       and (old.status is distinct from 'approved' or old.approved_at is null) then
      raise exception
        'draft % cannot be marked sent without prior human approval (current status: %)',
        new.id, old.status;
    end if;
  end if;

  if new.status = 'approved' and new.approved_at is null then
    new.approved_at := now();
  end if;

  if new.status = 'rejected' and new.rejected_at is null then
    new.rejected_at := now();
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists drafts_approval_gate on drafts;
create trigger drafts_approval_gate
  before insert or update on drafts
  for each row execute function enforce_draft_approval_gate();

-- ── reminders ───────────────────────────────────────────────────────────────
create table if not exists reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  analysis_id  uuid references analyses(id) on delete cascade,

  kind         reminder_kind not null default 'deadline',
  due_date     timestamptz not null,
  message      text,
  status       reminder_status not null default 'scheduled',
  sent_at      timestamptz,

  delete_after timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists reminders_due_idx on reminders (due_date)
  where status = 'scheduled';
create index if not exists reminders_user_idx on reminders (user_id);

-- ── pii_vault (KRİTİK) ──────────────────────────────────────────────────────
-- Orijinal PII değeri ASLA düz metin saklanmaz. AES-256-GCM ciphertext + iv + auth tag.
-- `token` = maskeli metindeki yer tutucu (ör. «NAME_1»).
-- Kapsam: doküman bazlı (document_id) veya kullanıcı bazlı (user_id, onboarding PII'si).
create table if not exists pii_vault (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete cascade,
  document_id  uuid references documents(id) on delete cascade,

  token        text not null,            -- «NAME_1»
  entity_type  text not null,            -- NAME | STEUERID | IBAN | ADDRESS | ...

  ciphertext   text not null,            -- base64
  iv           text not null,            -- base64
  auth_tag     text not null,            -- base64
  key_version  integer not null default 1,

  delete_after timestamptz,
  created_at   timestamptz not null default now(),

  -- En az bir sahiplik bağı olmalı ki silme (Art.17) her zaman kapsasın.
  constraint pii_vault_owner_chk check (user_id is not null or document_id is not null)
);

create unique index if not exists pii_vault_doc_token_uniq
  on pii_vault (document_id, token) where document_id is not null;
create unique index if not exists pii_vault_user_token_uniq
  on pii_vault (user_id, token) where document_id is null;
create index if not exists pii_vault_delete_after_idx on pii_vault (delete_after)
  where delete_after is not null;

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Şeffaflık izi. `detail` alanına ASLA ham PII yazılmaz (yalnızca token/id).
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null,
  action      text not null,             -- ör. 'llm.call', 'draft.approved', 'gdpr.delete'
  entity_type text,
  entity_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_user_idx on audit_log (user_id);
create index if not exists audit_log_action_idx on audit_log (action);
create index if not exists audit_log_created_idx on audit_log (created_at);

-- ── appointment_watches (Playwright PoC) ────────────────────────────────────
create table if not exists appointment_watches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,

  authority_key text not null,           -- ör. 'auslaenderbehoerde-berlin'
  target_url    text not null,
  service_label text,
  status        watch_status not null default 'active',

  last_checked_at timestamptz,
  last_result     jsonb not null default '{}'::jsonb,
  found_at        timestamptz,
  check_count     integer not null default 0,
  error_message   text,

  delete_after  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists watches_status_idx on appointment_watches (status);
create index if not exists watches_user_idx on appointment_watches (user_id);

-- ── updated_at otomasyonu ───────────────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'documents', 'analyses', 'drafts', 'reminders', 'appointment_watches'
  ] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I
       for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ── GDPR Art. 17 — süresi dolan veriyi silme ────────────────────────────────
-- Uygulama tarafındaki silme cron'u bu fonksiyonu çağırır (idempotent).
create or replace function purge_expired_data()
returns table (table_name text, deleted_count bigint) as $$
declare
  n bigint;
begin
  delete from pii_vault where delete_after is not null and delete_after < now();
  get diagnostics n = row_count;
  table_name := 'pii_vault'; deleted_count := n; return next;

  delete from drafts where delete_after is not null and delete_after < now();
  get diagnostics n = row_count;
  table_name := 'drafts'; deleted_count := n; return next;

  delete from analyses where delete_after is not null and delete_after < now();
  get diagnostics n = row_count;
  table_name := 'analyses'; deleted_count := n; return next;

  delete from reminders where delete_after is not null and delete_after < now();
  get diagnostics n = row_count;
  table_name := 'reminders'; deleted_count := n; return next;

  delete from documents where delete_after is not null and delete_after < now();
  get diagnostics n = row_count;
  table_name := 'documents'; deleted_count := n; return next;

  delete from users where delete_after is not null and delete_after < now();
  get diagnostics n = row_count;
  table_name := 'users'; deleted_count := n; return next;
end;
$$ language plpgsql;

-- ── RLS hazırlığı ───────────────────────────────────────────────────────────
-- v1 backend service-role ile bağlanır (RLS bypass). Tablolar yine de RLS'e
-- hazır: ileride kullanıcı-bazlı erişim (web dashboard) eklendiğinde politika yazılır.
alter table users               enable row level security;
alter table documents           enable row level security;
alter table analyses            enable row level security;
alter table drafts              enable row level security;
alter table reminders           enable row level security;
alter table pii_vault           enable row level security;
alter table audit_log           enable row level security;
alter table appointment_watches enable row level security;
