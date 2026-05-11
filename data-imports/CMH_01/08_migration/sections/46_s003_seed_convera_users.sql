-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 46 — SEED
--  Source seq      : s003
--  Source migration: seeds/003_seed_convera_users.sql
--  Purpose         : official MoMaH users
--  Run order       : STEP 46 of 48 (after STEP 45, before STEP 47).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
--  SEED files perform INSERTs; they are idempotent (`ON CONFLICT DO NOTHING`).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Seed: convera_users (Prototype Auth)
--  File: 003_seed_convera_users.sql
--
--  Run order: 3 (after 001_seed_profiles, 002_seed_contracts)
--  Depends on: 006_convera_users_otp.sql migration
--
--  Creates entries in convera_users for the prototype login flow.
--  Each user matches an existing profiles row by email.
--
--  ╔═══════════════════════════════════════════════════════════════╗
--  ║  ⚠️  BOOTSTRAP PASSWORD: <set via SET LOCAL custom.bootstrap_password — see preamble>  ║
--  ║  This is a TEMPORARY password for testing/staging ONLY.     ║
--  ║  ALL users must change their password before production.    ║
--  ║  Never deploy with this password to a public environment.   ║
--  ╚═══════════════════════════════════════════════════════════════╝
--
--  USER MAP:
--  ┌──────────────────┬──────────────────────────────────┬──────────────┐
--  │ Name             │ Email                            │ Role         │
--  ├──────────────────┼──────────────────────────────────┼──────────────┤
--  │ محمد العرفج      │ Ma.Alarfaj@momah.gov.sa          │ director     │
--  │ حسام الحبلين     │ halhablayn-Contractor@momah.gov.sa│ admin       │
--  │ محمود رجب        │ mahmoud.ragab@beeah.sa           │ consultant   │
--  │ عبدالله البهدل   │ abdullah.albahdal@beeah.sa       │ contractor   │
--  │ مالك العقاب      │ arfaj001@gmail.com               │ contractor   │
--  │ أحمد الراشدي     │ reviewer@momah.gov.sa            │ reviewer     │
--  └──────────────────┴──────────────────────────────────┴──────────────┘
--
--  Idempotency: ON CONFLICT (email) DO UPDATE
-- ═══════════════════════════════════════════════════════════════════

-- ── Required runtime parameter ──────────────────────────────────────
-- Set the bootstrap password before running this seed. Examples:
--   psql -v ON_ERROR_STOP=1 \
--        -c "SET LOCAL custom.bootstrap_password = '<your-pwd>';" \
--        -f 46_s003_seed_convera_users.sql
-- Or in Studio's SQL editor, prepend ONE line to your paste:
--   SET LOCAL custom.bootstrap_password = '<your-pwd>';
DO $$
BEGIN
  IF current_setting('custom.bootstrap_password', true) IS NULL
     OR length(trim(current_setting('custom.bootstrap_password', true))) < 8
  THEN
    RAISE EXCEPTION
      'BOOTSTRAP_PASSWORD_NOT_SET — run: SET LOCAL custom.bootstrap_password = ''<at-least-8-chars>''; before this seed';
  END IF;
END $$;

INSERT INTO convera_users (
  email, password_hash, name, name_ar, role,
  phone, phone_masked, avatar, avatar_color,
  contract_no, organization, is_active, approved
)
VALUES
  -- Director — full access
  (
    'Ma.Alarfaj@momah.gov.sa',
    current_setting('custom.bootstrap_password'),
    'Mohammed Alarfaj',
    'محمد العرفج',
    'director',
    '+966555180602',
    '+966 *** *** 602',
    'م',
    '#026D69',
    NULL,
    'وزارة البلديات والإسكان',
    true, true
  ),

  -- Admin — review, manage, forward
  (
    'halhablayn-Contractor@momah.gov.sa',
    current_setting('custom.bootstrap_password'),
    'Hossam Al-Hablayn',
    'حسام الحبلين',
    'admin',
    '+966554319723',
    '+966 *** *** 723',
    'ح',
    '#1A4B8C',
    NULL,
    'وزارة البلديات والإسكان',
    true, true
  ),

  -- Consultant — Beeah (external, submit/track)
  (
    'mahmoud.ragab@beeah.sa',
    current_setting('custom.bootstrap_password'),
    'Mahmoud Ragab',
    'محمود رجب',
    'consultant',
    NULL,
    NULL,
    'م',
    '#6A5ACD',
    '231001101771',
    'شركة البيئة مخططون معماريون ومهندسون',
    true, true
  ),

  -- Contractor — Beeah (external, contract 231001101771)
  (
    'abdullah.albahdal@beeah.sa',
    current_setting('custom.bootstrap_password'),
    'Abdullah Albahdal',
    'عبدالله البهدل',
    'contractor',
    '+966541311397',
    '+966 *** *** 397',
    'ع',
    '#2E8B57',
    '231001101771',
    'شركة البيئة مخططون معماريون ومهندسون',
    true, true
  ),

  -- Contractor — Sharat (external, contract 241039011332)
  (
    'arfaj001@gmail.com',
    current_setting('custom.bootstrap_password'),
    'Malik Al-Oqab',
    'مالك العقاب',
    'contractor',
    NULL,
    NULL,
    'م',
    '#DC143C',
    '241039011332',
    'مؤسسة شارة الإنشاء للمقاولات',
    true, true
  ),

  -- Internal Reviewer
  (
    'reviewer@momah.gov.sa',
    current_setting('custom.bootstrap_password'),
    'Ahmed Al-Rashidi',
    'أحمد الراشدي',
    'consultant',
    '+966551234567',
    '+966 *** *** 567',
    'أ',
    '#4682B4',
    NULL,
    'وزارة البلديات والإسكان',
    true, true
  )

ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name          = EXCLUDED.name,
  name_ar       = EXCLUDED.name_ar,
  role          = EXCLUDED.role,
  phone         = EXCLUDED.phone,
  phone_masked  = EXCLUDED.phone_masked,
  avatar        = EXCLUDED.avatar,
  avatar_color  = EXCLUDED.avatar_color,
  contract_no   = EXCLUDED.contract_no,
  organization  = EXCLUDED.organization,
  is_active     = EXCLUDED.is_active,
  approved      = EXCLUDED.approved,
  updated_at    = NOW();


-- ─── Verification ──────────────────────────────────────────────

SELECT
  id,
  email,
  name_ar,
  role,
  contract_no,
  is_active
FROM convera_users
ORDER BY id;
