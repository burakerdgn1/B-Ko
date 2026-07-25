-- ============================================================================
-- BüKo — 0002_onboarding_profile.sql
--
-- Onboarding profili (D-027): kullanıcının KENDİ kimlik bilgileri toplanır ve
-- "bilinen-değer maskeleme" (DECISIONS D-003 adım 1) böylece devreye girer.
--
-- ÖNEMLİ: Profil DEĞERLERİ bu tabloda TUTULMAZ. Değerler `pii_vault` içinde,
-- kullanıcı kapsamlı (document_id IS NULL) ve AES-256-GCM ile ŞİFRELİ olarak
-- saklanır. Burada yalnızca "onboarding tamamlandı mı" durumu tutulur.
-- ============================================================================

alter table users
  add column if not exists profile_completed_at timestamptz;

comment on column users.profile_completed_at is
  'Onboarding profili tamamlandığında (veya kullanıcı atlamayı seçtiğinde) set edilir. '
  'Profil DEĞERLERİ burada değil, pii_vault içinde şifreli tutulur.';
