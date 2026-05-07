-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 45 — SEED
--  Source seq      : s002
--  Source migration: seeds/002_seed_contracts.sql
--  Purpose         : contracts incl. CMH_01-C01
--  Run order       : STEP 45 of 48 (after STEP 44, before STEP 46).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
--  SEED files perform INSERTs; they are idempotent (`ON CONFLICT DO NOTHING`).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Real Contracts Seed
--  File: 003_seed_real_contracts.sql
--
--  Ministry of Municipalities and Housing
--  وزارة البلديات والإسكان — إدارة التطوير والتأهيل
--
--  CONTRACTS SEEDED:
--  ┌─────────────────────────────────────────────────────────────────┐
--  │  1. Contract 231001101771  (Beeah Engineering Consulting)       │
--  │     الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة          │
--  │     للشؤون الإدارية والمرافق لتنفيذ كافة متطلبات تحسين بيئة  │
--  │     العمل                                                       │
--  │     Type: design_supervision | Model: count | Value: 13,676,250 │
--  │     BOQ: 12 items  Staff: 21 positions  Retention: 5%           │
--  │                                                                 │
--  │  2. Contract 241039011332  (Sharat Al-Insha Contracting)        │
--  │     استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا        │
--  │     Type: construction | Model: count | Value: 3,459,945        │
--  │     BOQ: 45 items  Staff: none  Retention: 0%                   │
--  └─────────────────────────────────────────────────────────────────┘
--
--  DATA SOURCE: Verified from primary documents:
--    • POs.xlsx — 29 claim sheets for contract 231001101771
--    • Approving_payment_01.pdf — claim #1 for contract 241039011332
--    • استمارة التدقيق sheet — full project title, dates, values
--
--  USER UUID REFERENCES (from 004_test_users.sql):
--    Director  (Ma.Alarfaj):              a1000001-0000-0000-0000-000000000001
--    Admin     (halhablayn):              a1000002-0000-0000-0000-000000000002
--    Reviewer  (mahmoud.ragab):           a1000003-0000-0000-0000-000000000003
--    Contractor-Beeah (abdullah.albahdal):a1000004-0000-0000-0000-000000000004
--    Contractor-Sharat (arfaj001@gmail):  a1000005-0000-0000-0000-000000000005
--
--  IDEMPOTENCY:
--    ON CONFLICT (contract_no) DO NOTHING on contracts.
--    ON CONFLICT (contract_id, item_no) DO NOTHING on templates.
--    Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  STEP 0: Verify prerequisites
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_profiles   BOOLEAN;
  v_has_contracts  BOOLEAN;
  v_has_boq_tmpl   BOOLEAN;
  v_director_ok    BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='profiles') INTO v_has_profiles;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='contracts') INTO v_has_contracts;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='contract_boq_templates') INTO v_has_boq_tmpl;
  SELECT EXISTS (SELECT 1 FROM profiles
    WHERE id = 'a1000001-0000-0000-0000-000000000001') INTO v_director_ok;

  IF NOT v_has_profiles  THEN RAISE EXCEPTION 'Run migrations 001–004 first.'; END IF;
  IF NOT v_has_contracts  THEN RAISE EXCEPTION 'Run migrations 001–004 first.'; END IF;
  IF NOT v_has_boq_tmpl   THEN RAISE EXCEPTION 'Run migration 004 first.'; END IF;
  IF NOT v_director_ok    THEN RAISE EXCEPTION
    'Director profile not found. Run 004_test_users.sql first.'; END IF;

  RAISE NOTICE 'Prerequisites verified ✓';
END $$;


-- ═══════════════════════════════════════════════════════════════════
--  CONTRACT 1 — 231001101771
--  الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة للشؤون الإدارية
--  والمرافق لتنفيذ كافة متطلبات تحسين بيئة العمل
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
--  1A. Contract header
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contracts (
  id,
  contract_no,
  title,
  title_ar,
  type,
  status,
  party_name,
  party_name_ar,
  party_tax_no,
  -- base_value confirmed from ALL 29 claim sheets
  -- vat_value and total_value are GENERATED columns (15% and 115%)
  base_value,
  retention_pct,       -- 5% applied claims 1-13, user sets 0% from claim 14+
  boq_progress_model,  -- count: period = curr_progress × unit_price
  start_date,          -- تاريخ مباشرة العمل from all claim sheets
  duration_months,
  end_date,
  region,
  description,
  director_id,
  admin_id,
  reviewer_id,
  external_user_id,
  created_by,
  updated_by
)
VALUES (
  'b1000001-0000-0000-0000-000000000001',
  '231001101771',
  'Studies, Design & Supervision of Projects — General Administration '
    'of Administrative Affairs & Facilities — Workplace Improvement',
  'الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة للشؤون الإدارية '
    'والمرافق لتنفيذ كافة متطلبات تحسين بيئة العمل',
  'design_supervision',
  'active',
  'Beeah Planners Architects & Engineers Co.',
  'شركة البيئة مخططون معماريون ومهندسون',
  '310121971800003',
  13676250.00,
  5.00,
  'count',
  '2023-12-03',
  36,
  '2026-12-03',
  'الرياض',
  'الدراسات والتصاميم الهندسية والإشراف على مشاريع الإدارة العامة للشؤون الإدارية '
    'والمرافق لتنفيذ كافة متطلبات تحسين بيئة العمل — إدارة التطوير والتأهيل',
  'a1000001-0000-0000-0000-000000000001',   -- director: محمد العرفج
  'a1000002-0000-0000-0000-000000000002',   -- admin: حسام الحبلين
  'a1000003-0000-0000-0000-000000000003',   -- reviewer: محمود رجب
  'a1000004-0000-0000-0000-000000000004',   -- external: عبدالله البهدل (Beeah)
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000001'
)
ON CONFLICT (contract_no) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  1B. BOQ templates — 12 engineering report deliverables
--
--  Each item: unit=عدد, contractual_qty=1, progress_model=NULL (inherits count)
--  Billing: period = 1 × unit_price when report is delivered
--  Items 1-9: 200,000 SAR each | Items 10-12: 100,000 SAR each
--  BOQ total: 2,100,000 SAR
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contract_boq_templates
  (id, contract_id, item_no, description, description_ar, unit, unit_price, contractual_qty, progress_model, sort_order)
VALUES
  ('c1010001-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 1,
   'Status Quo Report No.1','تقرير الوضع الراهن الأول','عدد',200000,1,NULL,10),
  ('c1010002-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 2,
   'Status Quo Report No.2','تقرير الوضع الراهن الثاني','عدد',200000,1,NULL,20),
  ('c1010003-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 3,
   'Status Quo Report No.3','تقرير الوضع الراهن الثالث','عدد',200000,1,NULL,30),
  ('c1010004-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 4,
   'Engineering Studies & Design Report No.1',
   'تقرير الدراسات والتصاميم الهندسية — الأول','عدد',200000,1,NULL,40),
  ('c1010005-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 5,
   'Engineering Studies & Design Report No.2',
   'تقرير الدراسات والتصاميم الهندسية — الثاني','عدد',200000,1,NULL,50),
  ('c1010006-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 6,
   'Engineering Studies & Design Report No.3',
   'تقرير الدراسات والتصاميم الهندسية — الثالث','عدد',200000,1,NULL,60),
  ('c1010007-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 7,
   'Design Results & Drawings Report No.1',
   'تقرير نتائج التصاميم والمخططات — الأول','عدد',200000,1,NULL,70),
  ('c1010008-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 8,
   'Design Results & Drawings Report No.2',
   'تقرير نتائج التصاميم والمخططات — الثاني','عدد',200000,1,NULL,80),
  ('c1010009-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 9,
   'Design Results & Drawings Report No.3',
   'تقرير نتائج التصاميم والمخططات — الثالث','عدد',200000,1,NULL,90),
  ('c1010010-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',10,
   'Implementation Programs & Quality Control Report No.1',
   'تقرير برامج التنفيذ ومنهجية ضبط جودة الأداء — الأول','عدد',100000,1,NULL,100),
  ('c1010011-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',11,
   'Implementation Programs & Quality Control Report No.2',
   'تقرير برامج التنفيذ ومنهجية ضبط جودة الأداء — الثاني','عدد',100000,1,NULL,110),
  ('c1010012-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',12,
   'Implementation Programs & Quality Control Report No.3',
   'تقرير برامج التنفيذ ومنهجية ضبط جودة الأداء — الثالث','عدد',100000,1,NULL,120)
ON CONFLICT (contract_id, item_no) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  1C. Staff templates — 21 base supervision positions
--
--  Billing model: days_prorated (always for staff)
--  Formulas (verified against real claim data):
--    basic_amount = (working_days / 30) × monthly_rate
--    extra_amount = (monthly_rate / 192) × 1.5 × overtime_hours
--    after_perf   = (basic + extra) × (performance_pct / 100)
--  All 21 positions: 24 months contracted
--  Note: منسق فني (position 22, 25 months) was added via VO-01 Change Order
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contract_staff_templates
  (id, contract_id, item_no, position, position_ar, monthly_rate, contract_months, sort_order)
VALUES
  ('s1010001-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 1,
   'Project Manager – Professional Engineer','مدير المشروع - مهندس محترف',25000,24,10),
  ('s1010002-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 2,
   'Professional Architect (1)','مهندس معمارى محترف (1)',24000,24,20),
  ('s1010003-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 3,
   'Professional Architect (2)','مهندس معمارى محترف (2)',24000,24,30),
  ('s1010004-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 4,
   'Professional Civil Engineer (1)','مهندس مدني محترف (1)',24000,24,40),
  ('s1010005-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 5,
   'Professional Civil Engineer (2)','مهندس مدني محترف (2)',24000,24,50),
  ('s1010006-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 6,
   'Professional Electrical Engineer (1)','مهندس كهرباء محترف (1)',24000,24,60),
  ('s1010007-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 7,
   'Professional Electrical Engineer (2)','مهندس كهرباء محترف (2)',24000,24,70),
  ('s1010008-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 8,
   'Professional Mechanical Engineer (1)','مهندس ميكانيك محترف (1)',24000,24,80),
  ('s1010009-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 9,
   'Professional Mechanical Engineer (2)','مهندس ميكانيك محترف (2)',24000,24,90),
  ('s1010010-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',10,
   'Materials Specialist (1)','أخصائي مواد (1)',20000,24,100),
  ('s1010011-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',11,
   'Materials Specialist (2)','أخصائي مواد (2)',20000,24,110),
  ('s1010012-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',12,
   'Quantity Surveyor (1)','حاسب كميات (1)',20000,24,120),
  ('s1010013-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',13,
   'Quantity Surveyor (2)','حاسب كميات (2)',20000,24,130),
  ('s1010014-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',14,
   'Quantity Surveyor (3)','حاسب كميات (3)',20000,24,140),
  ('s1010015-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',15,
   'Quantity Surveyor (4)','حاسب كميات (4)',20000,24,150),
  ('s1010016-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',16,
   'Safety Specialist (1)','أخصائي سلامة (1)',20000,24,160),
  ('s1010017-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',17,
   'Safety Specialist (2)','أخصائي سلامة (2)',20000,24,170),
  ('s1010018-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',18,
   'Site Inspector (1)','مراقب (1)',16000,24,180),
  ('s1010019-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',19,
   'Site Inspector (2)','مراقب (2)',16000,24,190),
  ('s1010020-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',20,
   'Site Inspector (3)','مراقب (3)',16000,24,200),
  ('s1010021-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',21,
   'Site Inspector (4)','مراقب (4)',16000,24,210)
ON CONFLICT (contract_id, item_no) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
--  CONTRACT 2 — 241039011332
--  استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
--  2A. Contract header
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contracts (
  id,
  contract_no,
  title,
  title_ar,
  type,
  status,
  party_name,
  party_name_ar,
  party_tax_no,
  -- base_value = sum of 45 BOQ items = 3,459,945 SAR (verified to the riyal)
  base_value,
  -- Retention: 0% confirmed from claim #1 استمارة تدقيق (حجز تأمين الأعمال = لا يوجد)
  retention_pct,
  boq_progress_model,
  start_date,
  duration_months,
  end_date,
  region,
  description,
  director_id,
  admin_id,
  reviewer_id,
  external_user_id,
  created_by,
  updated_by
)
VALUES (
  'b1000002-0000-0000-0000-000000000002',
  '241039011332',
  'Completing Safety & Security Requirements for Ministry Building — Al-Ulaya',
  'استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا',
  'construction',
  'active',
  'Sharat Al-Insha Construction Est.',
  'مؤسسة شارة الإنشاء للمقاولات',
  '7011595498',
  3459945.00,
  0.00,
  'count',
  '2025-02-04',
  12,
  '2026-02-04',
  'الرياض',
  'استكمال تركيب منظومة الحماية من الحريق والإنذار والمراقبة الأمنية '
    'لمبنى الوزارة الرئيسي بالعليا — المنافسة رقم 2000000423',
  'a1000001-0000-0000-0000-000000000001',   -- director: محمد العرفج
  'a1000002-0000-0000-0000-000000000002',   -- admin: حسام الحبلين
  NULL,                                     -- no reviewer (direct admin+director flow)
  'a1000005-0000-0000-0000-000000000005',   -- contractor: مالك العقاب (Sharat)
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000001'
)
ON CONFLICT (contract_no) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  2B. BOQ templates — 45 construction items
--
--  Source: claim #1 BOQ attachment (Approving_payment_01.pdf pages 1-5)
--  Verification: Sum = 3,459,945 SAR = contract base_value ✓
--  Claim #1 check: items 6,7,8,10,19,41 × quantities = 388,801 SAR ✓
--  progress_model: NULL (inherits contract default 'count')
--  Billing: period = qty_executed × unit_price
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contract_boq_templates
  (id, contract_id, item_no, description, description_ar, unit, unit_price, contractual_qty, progress_model, sort_order)
VALUES
  -- ── Fire Suppression / Sprinkler (1-9) ─────────────────────────
  ('c2010001-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 1,
   'Fire-resistant doors — supply & install',
   'توريد وتركيب أبواب مقاومة للحريق','عدد',7000,5,NULL,10),
  ('c2010002-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 2,
   'Fire-resistant lobby & elevator — rehab, supply & install',
   'تأهيل وتطوير بهو مقاوم للحريق وتوريد وتركيب مصعد','عدد',352000,1,NULL,20),
  ('c2010003-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 3,
   'Black iron pipe Ø65mm',
   'ماسورة حديد اسود قطر 65 مم','م ط',250,20,NULL,30),
  ('c2010004-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 4,
   'Black iron pipe Ø50mm',
   'ماسورة حديد اسود قطر 50 مم','م ط',235,30,NULL,40),
  ('c2010005-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 5,
   'Black iron pipe Ø40mm',
   'ماسورة حديد اسود قطر 40 مم','م ط',230,70,NULL,50),
  -- item 6: claim#1 verified: 19.75 × 220 = 4,345 ✓
  ('c2010006-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 6,
   'Black iron pipe Ø32mm',
   'ماسورة حديد اسود قطر 32 مم','م ط',220,35,NULL,60),
  -- item 7: claim#1 verified: 202.28 × 200 = 40,456 ✓
  ('c2010007-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 7,
   'Black iron pipe Ø25mm',
   'ماسورة حديد اسود قطر 25 مم','م ط',200,350,NULL,70),
  -- item 8: claim#1 verified: 1 × 8,000 = 8,000 ✓
  ('c2010008-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 8,
   'Zone control valve Ø150mm CZS — exposed network',
   'محبس تحكم بالنطاق داخلي قطر 150 مم CZS للشبكة الظاهرة','عدد',8000,1,NULL,80),
  ('c2010009-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 9,
   'Fire hose cabinet CLASS II FHC — supply, install, test & commission',
   'توريد وتركيب واختبار وتشغيل صندوق إطفاء حريق CLASS II FHC','عدد',5000,8,NULL,90),

  -- ── Extinguishers, Rooms (10-14) ───────────────────────────────
  -- item 10: claim#1 verified: 80 × 400 = 32,000 ✓
  ('c2010010-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',10,
   'Fire sprinkler head',
   'رشاش حريق','عدد',400,100,NULL,100),
  ('c2010011-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',11,
   'Wall-mounted ABC powder extinguisher 6kg',
   'طفاية حريق جدارية بودرة نوعية ABC سعة 6 كجم','عدد',250,10,NULL,110),
  ('c2010012-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',12,
   'Wall-mounted CO2 extinguisher 6kg',
   'طفاية حريق جدارية CO2 سعة 6 كجم','عدد',380,8,NULL,120),
  ('c2010013-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',13,
   'Electrical rooms — rehabilitation & development',
   'تأهيل وتطوير غرف الكهرباء','قطوعة',50000,4,NULL,130),
  ('c2010014-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',14,
   'IT rooms — rehabilitation & development',
   'تأهيل وتطوير غرف تقنية المعلومات','قطوعة',50000,2,NULL,140),

  -- ── Smoke Control (15) ─────────────────────────────────────────
  ('c2010015-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',15,
   'Smoke control system — supply, install & commission',
   'توريد وتركيب وتشغيل نظام التحكم في الدخان','قطوعة',140000,1,NULL,150),

  -- ── Emergency Lighting & Signage (16-18) ──────────────────────
  ('c2010016-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',16,
   'Emergency EXIT sign',
   'علامة خروج طوارئ EXIT','عدد',950,20,NULL,160),
  ('c2010017-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',17,
   'LED emergency lighting unit',
   'وحدة انارة طوارئ LED','عدد',800,40,NULL,170),
  ('c2010018-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',18,
   'Addressable control panel 4-loop',
   'لوحة تحكم من النوع المعنون سعة 4 لوب','عدد',15000,1,NULL,180),

  -- ── Fire Alarm & Detection (19-25) ────────────────────────────
  -- item 19: claim#1 verified: 100 × 700 = 70,000 ✓
  ('c2010019-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',19,
   'Addressable ceiling smoke detector',
   'كاشف دخان معنون يثبت بالسقف','عدد',700,180,NULL,190),
  ('c2010020-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',20,
   'Addressable ceiling heat detector',
   'كاشف حراري معنون يثبت بالسقف','عدد',700,4,NULL,200),
  ('c2010021-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',21,
   'Addressable multi-sensor (smoke+heat) detector',
   'كاشف متعدد معنون دخان وحرارة','عدد',760,4,NULL,210),
  ('c2010022-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',22,
   'Addressable audio-visual alarm sounder',
   'جرس معنون صوت وفلاش','عدد',720,16,NULL,220),
  ('c2010023-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',23,
   'Addressable manual call point (glass break)',
   'كاسر زجاجي من النوع المعنون','عدد',740,16,NULL,230),
  ('c2010024-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',24,
   'Addressable external systems monitoring interface',
   'وحدة ربط ومراقبة الأنظمة الخارجية معنون','عدد',4500,10,NULL,240),
  ('c2010025-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',25,
   'Addressable external systems control interface (AC/fans/lifts)',
   'وحدة ربط وتحكم في الأنظمة الخارجية معنون (تكييف ومراوح ومصاعد)','عدد',4300,10,NULL,250),

  -- ── PA / Voice Evacuation (26-27) ─────────────────────────────
  ('c2010026-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',26,
   'Acoustics control panel — 2nd floor',
   'توريد وتركيب لوحة تحكم خاصة بنظام الصوتيات بالدور الثاني','عدد',55000,1,NULL,260),
  ('c2010027-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',27,
   'Flush-mounted ceiling speaker 8/4/6W',
   'توريد تركيب مكبر صوت 8/4/6 وات غاطس يثبت في السقف','عدد',1700,30,NULL,270),

  -- ── CCTV Infrastructure (28-36) ────────────────────────────────
  ('c2010028-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',28,
   'Free-standing rack cabinet',
   'توريد وتركيب CABINET RACK MOUNTED FREE','عدد',14195,1,NULL,280),
  ('c2010029-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',29,
   'Network video recorder NVR — supply, install, test & commission',
   'توريد وتركيب وتشغيل واختبار وحدة جهاز التسجيل الشبكي','عدد',35000,2,NULL,290),
  ('c2010030-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',30,
   'Surveillance monitoring system — supply, install, test & activate',
   'توريد وتركيب واختبار وتفعيل نظام مراقبة','عدد',3000,24,NULL,300),
  ('c2010031-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',31,
   'Network switch type 1 — supply, install, test & program',
   'توريد وتركيب وتشغيل واختبار وبرمجة سويتش (نوع 1)','عدد',15600,10,NULL,310),
  ('c2010032-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',32,
   'Network switch type 2 — supply, install, test & program',
   'توريد وتركيب وتشغيل واختبار وبرمجة سويتش (نوع 2)','عدد',13000,7,NULL,320),
  ('c2010033-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',33,
   'Panel type 1 — supply, install & test',
   'توريد وتركيب وتشغيل واختبار لوحة (نوع 1)','عدد',6000,10,NULL,330),
  ('c2010034-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',34,
   'Panel type 2 — supply, install & test',
   'توريد وتركيب وتشغيل واختبار لوحة (نوع 2)','عدد',6000,10,NULL,340),
  ('c2010035-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',35,
   'Receiver unit — supply, install & test',
   'توريد وتركيب وتشغيل واختبار مستقبل','عدد',2200,48,NULL,350),
  ('c2010036-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',36,
   'Media converter — supply, install & test',
   'توريد وتركيب وتشغيل واختبار محول وسط','عدد',1300,16,NULL,360),

  -- ── Cameras, Control & Fibre (37-45) ───────────────────────────
  ('c2010037-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',37,
   'Main display unit — supply & install',
   'توريد وتركيب وتشغيل وحدة عرض رئيسية','عدد',2000,10,NULL,370),
  ('c2010038-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',38,
   'Ethernet outlet category A',
   'توريد وتركيب واختبار مخرج إثرنت صنف أ','عدد',550,120,NULL,380),
  ('c2010039-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',39,
   'Ethernet outlet category B',
   'توريد وتركيب واختبار مخرج إثرنت صنف ب','عدد',550,100,NULL,390),
  ('c2010040-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',40,
   'Ethernet outlet category C',
   'توريد وتركيب واختبار مخرج إثرنت صنف ج','عدد',1500,20,NULL,400),
  -- item 41: claim#1 verified: 130 × 1,800 = 234,000 ✓
  ('c2010041-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',41,
   'Indoor surveillance camera (audio+motion) — standard',
   'توريد وتركيب وتشغيل أجهزة مراقبة داخلية (صوتي/حركي) — عادية','عدد',1800,420,NULL,410),
  ('c2010042-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',42,
   'Outdoor surveillance camera (audio+motion) — weatherproof',
   'توريد وتركيب وتشغيل أجهزة مراقبة خارجية (صوتي/حركي) مقاومة للعوامل الجوية','عدد',1800,75,NULL,420),
  ('c2010043-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',43,
   'Indoor high-resolution surveillance camera (audio+motion)',
   'توريد وتركيب أجهزة مراقبة داخلية دقة عالية (صوتي/حركي)','عدد',7000,15,NULL,430),
  ('c2010044-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',44,
   'Master control unit — supply, install & commission',
   'توريد وتركيب وتشغيل جهاز التحكم','عدد',11760,1,NULL,440),
  ('c2010045-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',45,
   'Fibre optic cable — supply, install, test & commission',
   'توريد وتركيب وتشغيل واختبار كابل فايبر','م ط',190,1000,NULL,450)
ON CONFLICT (contract_id, item_no) DO NOTHING;


-- Contract 241039011332 has NO staff templates — pure construction contract.
-- claim_type for all claims will be 'boq_only'.


-- ─────────────────────────────────────────────────────────────────
--  VERIFICATION — confirm both contracts seeded correctly
-- ─────────────────────────────────────────────────────────────────

SELECT
  c.contract_no,
  LEFT(c.title_ar, 55)                          AS title_ar,
  c.type::TEXT                                   AS type,
  c.base_value,
  c.vat_value,
  c.retention_pct                                AS retention,
  c.boq_progress_model                           AS model,
  c.start_date,
  c.duration_months                              AS months,
  p_ext.full_name_ar                             AS contractor,
  COUNT(DISTINCT boq.id)                         AS boq_items,
  COUNT(DISTINCT stf.id)                         AS staff_items,
  SUM(boq.unit_price * boq.contractual_qty)      AS boq_total_value
FROM contracts c
LEFT JOIN profiles                p_ext ON c.external_user_id = p_ext.id
LEFT JOIN contract_boq_templates  boq   ON boq.contract_id = c.id
LEFT JOIN contract_staff_templates stf  ON stf.contract_id = c.id
WHERE c.contract_no IN ('231001101771', '241039011332')
GROUP BY c.id, p_ext.full_name_ar
ORDER BY c.start_date;
