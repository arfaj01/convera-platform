-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 23 — MIGRATION
--  Source seq      : 026
--  Source migration: migrations/026_rls_contract_scoped_roles.sql
--  Purpose         : RLS for contract-scoped roles
--  Run order       : STEP 23 of 48 (after STEP 22, before STEP 24).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  Migration 026: RLS Migration to Contract-Scoped Roles (Sprint C)
--  CONVERA — وزارة البلديات والإسكان
--
--  PURPOSE:
--    Make user_contract_roles the AUTHORITATIVE source for
--    contract-level access at the database (RLS) layer.
--
--  ARCHITECTURE CHANGE:
--    BEFORE: user_contracts + profiles.role → permissive global policies
--    AFTER:  user_contract_roles → contract-scoped policies
--
--    Director: global access (only role NOT contract-scoped)
--    Auditor (admin):   scoped via has_contract_role(contract_id, 'auditor')
--    Reviewer:          scoped via has_contract_role(contract_id, 'reviewer')
--    Supervisor (consultant): scoped via has_contract_role(contract_id, 'supervisor')
--    Contractor:        scoped via has_contract_role(contract_id, 'contractor')
--    Viewer:            read-only via has_contract_access(contract_id)
--
--  TABLES MODIFIED (12):
--    contracts, claims, claim_workflow, documents,
--    change_orders, change_order_boq_items, change_order_staff_items,
--    change_order_workflow, contract_boq_templates, contract_staff_templates,
--    contract_amendments, kpi_snapshots
--
--  TABLES UNCHANGED (relies on parent RLS piggybacking):
--    claim_boq_items, claim_staff_items
--    (their SELECT uses `claim_id IN (SELECT id FROM claims)` which
--     is automatically filtered by the new claims RLS policies)
--
--  TABLES UNAFFECTED:
--    profiles, audit_logs, notifications, user_contracts,
--    user_contract_roles, convera_users, convera_otp
--
--  HELPER FUNCTIONS USED:
--    has_contract_access(UUID)           — from migration 025
--    has_contract_role(UUID, contract_role) — from migration 025
--    get_contract_role(UUID)             — from migration 025
--    is_director()                       — NEW (created in this migration)
--
--  ROLLBACK:
--    This migration is designed with a companion rollback section at the
--    bottom. To revert: run the rollback SQL, then re-apply migrations
--    019, 020, 023 to restore the legacy user_contracts-based policies.
--
--  IDEMPOTENT: All statements use DROP IF EXISTS before CREATE.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 0 — New helper function: is_director()
--
--  Unlike is_internal() (which includes admin + reviewer), this
--  returns TRUE only for the director role — the ONLY truly global
--  role in the contract-scoped architecture.
--
--  SECURITY DEFINER: bypasses RLS on profiles to avoid recursion.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_director()
RETURNS BOOLEAN AS $$
  SELECT (SELECT role FROM profiles WHERE id = auth.uid()) = 'director';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION is_director() IS
  'Returns TRUE only for the director role. Unlike is_internal() which '
  'includes admin+reviewer, this is for the only truly global role in '
  'the contract-scoped architecture. Created by migration 026.';


-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — contracts
--
--  DROPPED (4):
--    contracts_internal_all      (001) — is_internal() → too broad
--    contracts_internal_select   (020) — role IN (dir,admin,rev) → too broad
--    contracts_contractor_select (019) — profiles.role + user_contracts
--    contracts_consultant_select (019) — profiles.role + user_contracts
--
--  CREATED (2):
--    contracts_director_all      — director global access
--    contracts_scoped_select     — anyone with active role on contract
-- ════════════════════════════════════════════════════════════════════

-- Drop legacy policies
DROP POLICY IF EXISTS "contracts_internal_all"      ON contracts;
DROP POLICY IF EXISTS "contracts_internal_select"   ON contracts;
DROP POLICY IF EXISTS "contracts_contractor_select" ON contracts;
DROP POLICY IF EXISTS "contracts_consultant_select" ON contracts;
-- Defensive: drop any stale policies that might exist from earlier migrations
DROP POLICY IF EXISTS "contracts_external_select_own" ON contracts;
DROP POLICY IF EXISTS "contracts_supervisor_select"   ON contracts;
DROP POLICY IF EXISTS "contracts_auth_read"           ON contracts;

-- Director: full global access to all contracts
CREATE POLICY "contracts_director_all"
  ON contracts FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped: anyone with active contract_role can SELECT their assigned contracts
CREATE POLICY "contracts_scoped_select"
  ON contracts FOR SELECT
  USING (has_contract_access(id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — claims
--
--  DROPPED (9):
--    claims_internal_all        (001) — is_internal() → too broad
--    claims_internal_select     (020) — role IN (dir,admin,rev) → too broad
--    claims_contractor_select   (019) — profiles.role + user_contracts
--    claims_contractor_insert   (019) — profiles.role + user_contracts
--    claims_contractor_update   (019) — profiles.role + user_contracts
--    claims_consultant_select   (019) — profiles.role + user_contracts
--    claims_consultant_update   (019) — profiles.role + user_contracts
--    claims_admin_update        (012) — profiles.role = admin (no scope)
--    claims_reviewer_update     (012) — profiles.role = reviewer (no scope)
--    claims_director_update     (012) — replaced by director_all
--
--  CREATED (7):
--    claims_director_all        — director global access
--    claims_scoped_select       — anyone with contract role can read
--    claims_contractor_insert   — contractor creates claims
--    claims_contractor_update   — contractor edits draft/returned claims
--    claims_supervisor_update   — supervisor reviews at their stage
--    claims_auditor_update      — auditor reviews at their stage
--    claims_reviewer_update     — reviewer reviews at their stage
--
--  NOTE: Director UPDATE is covered by claims_director_all.
-- ════════════════════════════════════════════════════════════════════

-- Drop legacy policies
DROP POLICY IF EXISTS "claims_internal_all"        ON claims;
DROP POLICY IF EXISTS "claims_internal_select"     ON claims;
DROP POLICY IF EXISTS "claims_contractor_select"   ON claims;
DROP POLICY IF EXISTS "claims_contractor_insert"   ON claims;
DROP POLICY IF EXISTS "claims_contractor_update"   ON claims;
DROP POLICY IF EXISTS "claims_consultant_select"   ON claims;
DROP POLICY IF EXISTS "claims_consultant_update"   ON claims;
DROP POLICY IF EXISTS "claims_admin_update"        ON claims;
DROP POLICY IF EXISTS "claims_reviewer_update"     ON claims;
DROP POLICY IF EXISTS "claims_director_update"     ON claims;
-- Defensive: stale policies from earlier migrations
DROP POLICY IF EXISTS "claims_external_select"          ON claims;
DROP POLICY IF EXISTS "claims_external_insert"          ON claims;
DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;
DROP POLICY IF EXISTS "claims_supervisor_select"        ON claims;
DROP POLICY IF EXISTS "claims_auth_read"                ON claims;

-- Director: full global access to all claims
CREATE POLICY "claims_director_all"
  ON claims FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped: anyone with active contract_role can SELECT claims on their contracts
CREATE POLICY "claims_scoped_select"
  ON claims FOR SELECT
  USING (has_contract_access(contract_id));

-- Contractor: INSERT new claims on their assigned contracts (active contracts only)
CREATE POLICY "claims_contractor_insert"
  ON claims FOR INSERT
  WITH CHECK (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = claims.contract_id
        AND c.status = 'active'
    )
  );

-- Contractor: UPDATE own draft/returned claims
CREATE POLICY "claims_contractor_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
    AND status IN (
      'draft',
      'returned_by_supervisor',
      'returned_by_auditor',
      'returned_by_consultant',
      'returned_by_admin'
    )
  )
  WITH CHECK (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
  );

-- Supervisor: UPDATE claims at supervisor review stage
CREATE POLICY "claims_supervisor_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'supervisor')
    AND status IN ('submitted', 'under_supervisor_review')
  )
  WITH CHECK (
    has_contract_role(contract_id, 'supervisor')
  );

-- Auditor: UPDATE claims at auditor review stage
CREATE POLICY "claims_auditor_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'auditor')
    AND status IN ('under_auditor_review')
  )
  WITH CHECK (
    has_contract_role(contract_id, 'auditor')
  );

-- Reviewer: UPDATE claims at reviewer check stage
CREATE POLICY "claims_reviewer_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'reviewer')
    AND status IN ('under_reviewer_check')
  )
  WITH CHECK (
    has_contract_role(contract_id, 'reviewer')
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — claim_workflow
--
--  DROPPED (4):
--    workflow_internal_all         (001) — is_internal() → too broad
--    workflow_external_select      (001) — external_user_id (deprecated)
--    workflow_external_insert      (002) — external_user_id (deprecated)
--    claim_workflow_roles_insert   (012) — profiles.role IN (...) no scope
--
--  CREATED (3):
--    claim_workflow_director_all    — director global access
--    claim_workflow_scoped_select   — piggybacks on claims RLS
--    claim_workflow_scoped_insert   — actor_id check + claims RLS
--
--  NOTE: Internal review/approve/reject entries are written via
--  service role (bypasses RLS). These policies cover direct user
--  inserts (submit, resubmit, comment) and internal SELECT.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "workflow_internal_all"       ON claim_workflow;
DROP POLICY IF EXISTS "workflow_external_select"    ON claim_workflow;
DROP POLICY IF EXISTS "workflow_external_insert"    ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_roles_insert" ON claim_workflow;
-- Defensive
DROP POLICY IF EXISTS "claim_workflow_director_all"   ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_select"  ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_insert"  ON claim_workflow;

-- Director: full global access
CREATE POLICY "claim_workflow_director_all"
  ON claim_workflow FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: piggybacks on claims RLS — if you can see the claim,
-- you can see its workflow history.
CREATE POLICY "claim_workflow_scoped_select"
  ON claim_workflow FOR SELECT
  USING (
    claim_id IN (SELECT id FROM claims)
  );

-- Scoped INSERT: user must be the actor and must have access to the claim's contract.
-- Action validation (submit/approve/return/reject) enforced at API layer.
CREATE POLICY "claim_workflow_scoped_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND claim_id IN (SELECT id FROM claims)
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 4 — documents
--
--  DROPPED (4):
--    documents_internal_all      (023) — is_internal() → too broad
--    documents_external_select   (023) — user_contracts scoping
--    documents_external_insert   (023) — user_contracts scoping
--    documents_external_delete   (023) — user_contracts scoping
--
--  CREATED (4):
--    documents_director_all       — director global access
--    documents_scoped_select      — contract-scoped via claim/contract FK
--    documents_scoped_insert      — contract-scoped with state checks
--    documents_scoped_delete      — own docs on draft claims only
--
--  NOTE: documents.claim_id → claims.contract_id (XOR)
--        documents.contract_id → direct contract link
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "documents_internal_all"    ON documents;
DROP POLICY IF EXISTS "documents_external_select" ON documents;
DROP POLICY IF EXISTS "documents_external_insert" ON documents;
DROP POLICY IF EXISTS "documents_external_delete" ON documents;
-- Defensive: stale policies from earlier migrations
DROP POLICY IF EXISTS "public_all_documents"      ON documents;
DROP POLICY IF EXISTS "documents_auth_read"       ON documents;
DROP POLICY IF EXISTS "documents_view"            ON documents;
DROP POLICY IF EXISTS "documents_insert"          ON documents;
-- Defensive: our own names in case of re-run
DROP POLICY IF EXISTS "documents_director_all"    ON documents;
DROP POLICY IF EXISTS "documents_scoped_select"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_insert"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_delete"   ON documents;

-- Director: full global access
CREATE POLICY "documents_director_all"
  ON documents FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: claim documents accessible via claims RLS piggybacking;
-- contract documents accessible via has_contract_access.
CREATE POLICY "documents_scoped_select"
  ON documents FOR SELECT
  USING (
    (claim_id IS NOT NULL AND claim_id IN (SELECT id FROM claims))
    OR
    (contract_id IS NOT NULL AND has_contract_access(contract_id))
  );

-- Scoped INSERT: own uploads on accessible claims (editable states) or contracts
CREATE POLICY "documents_scoped_insert"
  ON documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      (claim_id IS NOT NULL AND claim_id IN (
        SELECT id FROM claims
        WHERE status IN (
          'draft', 'returned_by_supervisor', 'returned_by_auditor',
          'returned_by_consultant', 'returned_by_admin',
          'submitted', 'under_supervisor_review', 'under_auditor_review',
          'under_reviewer_check', 'pending_director_approval'
        )
      ))
      OR
      (contract_id IS NOT NULL AND has_contract_access(contract_id))
    )
  );

-- Scoped DELETE: own uploads on draft claims only, or own contract docs
CREATE POLICY "documents_scoped_delete"
  ON documents FOR DELETE
  USING (
    uploaded_by = auth.uid()
    AND (
      (claim_id IS NOT NULL AND claim_id IN (
        SELECT id FROM claims WHERE status = 'draft'
      ))
      OR
      (contract_id IS NOT NULL AND has_contract_access(contract_id))
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 5 — change_orders
--
--  DROPPED (4):
--    co_internal_all              (003) — is_internal() → too broad
--    change_orders_internal_select (020) — role IN (...) → too broad
--    co_external_select           (023) — user_contracts
--    co_external_insert           (023) — user_contracts
--    co_external_update_draft     (023) — user_contracts
--
--  CREATED (4):
--    co_director_all              — director global access
--    co_scoped_select             — contract-scoped read
--    co_contractor_insert         — contractor creates COs
--    co_scoped_update_draft       — creator/submitter updates draft COs
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_internal_all"              ON change_orders;
DROP POLICY IF EXISTS "change_orders_internal_select" ON change_orders;
DROP POLICY IF EXISTS "co_external_select"           ON change_orders;
DROP POLICY IF EXISTS "co_external_insert"           ON change_orders;
DROP POLICY IF EXISTS "co_external_update_draft"     ON change_orders;
-- Defensive
DROP POLICY IF EXISTS "co_director_all"              ON change_orders;
DROP POLICY IF EXISTS "co_scoped_select"             ON change_orders;
DROP POLICY IF EXISTS "co_contractor_insert"         ON change_orders;
DROP POLICY IF EXISTS "co_scoped_update_draft"       ON change_orders;

-- Director: full global access
CREATE POLICY "co_director_all"
  ON change_orders FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: anyone with contract access
CREATE POLICY "co_scoped_select"
  ON change_orders FOR SELECT
  USING (has_contract_access(contract_id));

-- Contractor INSERT: create draft COs on active contracts they're assigned to
CREATE POLICY "co_contractor_insert"
  ON change_orders FOR INSERT
  WITH CHECK (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = change_orders.contract_id
        AND c.status = 'active'
    )
  );

-- Scoped UPDATE: creator/submitter can update their own draft COs
CREATE POLICY "co_scoped_update_draft"
  ON change_orders FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND has_contract_access(contract_id)
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND has_contract_access(contract_id)
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 6 — change_order_boq_items
--
--  DROPPED (5):
--    co_boq_internal_all      (003) — is_internal() → too broad
--    co_boq_external_select   (003) — external_user_id (deprecated)
--    co_boq_external_insert   (003) — external_user_id (deprecated)
--    co_boq_external_update   (003) — external_user_id (deprecated)
--    co_boq_external_delete   (003) — external_user_id (deprecated)
--
--  CREATED (5):
--    Piggybacks on change_orders RLS via subquery pattern.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_boq_internal_all"    ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_select" ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_insert" ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_update" ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_delete" ON change_order_boq_items;
-- Defensive: our own names
DROP POLICY IF EXISTS "co_boq_director_all"    ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_select"   ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_insert"   ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_update"   ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_delete"   ON change_order_boq_items;

-- Director: full global access
CREATE POLICY "co_boq_director_all"
  ON change_order_boq_items FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: piggybacks on change_orders RLS
CREATE POLICY "co_boq_scoped_select"
  ON change_order_boq_items FOR SELECT
  USING (
    change_order_id IN (SELECT id FROM change_orders)
  );

-- Scoped INSERT: only on accessible draft COs
CREATE POLICY "co_boq_scoped_insert"
  ON change_order_boq_items FOR INSERT
  WITH CHECK (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

-- Scoped UPDATE: only on accessible draft COs
CREATE POLICY "co_boq_scoped_update"
  ON change_order_boq_items FOR UPDATE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

-- Scoped DELETE: only on accessible draft COs
CREATE POLICY "co_boq_scoped_delete"
  ON change_order_boq_items FOR DELETE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 7 — change_order_staff_items (same pattern as Phase 6)
--
--  DROPPED (5): co_staff_internal_all, co_staff_external_*
--  CREATED (5): co_staff_director_all, co_staff_scoped_*
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_staff_internal_all"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_select" ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_insert" ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_update" ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_delete" ON change_order_staff_items;
-- Defensive
DROP POLICY IF EXISTS "co_staff_director_all"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_select"   ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_insert"   ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_update"   ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_delete"   ON change_order_staff_items;

CREATE POLICY "co_staff_director_all"
  ON change_order_staff_items FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "co_staff_scoped_select"
  ON change_order_staff_items FOR SELECT
  USING (
    change_order_id IN (SELECT id FROM change_orders)
  );

CREATE POLICY "co_staff_scoped_insert"
  ON change_order_staff_items FOR INSERT
  WITH CHECK (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

CREATE POLICY "co_staff_scoped_update"
  ON change_order_staff_items FOR UPDATE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

CREATE POLICY "co_staff_scoped_delete"
  ON change_order_staff_items FOR DELETE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 8 — change_order_workflow
--
--  DROPPED (3):
--    co_workflow_internal_all     (003) — is_internal() → too broad
--    co_workflow_external_select  (003) — external_user_id (deprecated)
--    co_workflow_external_insert  (003) — external_user_id (deprecated)
--
--  CREATED (3):
--    Piggybacks on change_orders RLS via subquery pattern.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_workflow_internal_all"    ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_external_select" ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_external_insert" ON change_order_workflow;
-- Defensive
DROP POLICY IF EXISTS "co_workflow_director_all"    ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_select"   ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_insert"   ON change_order_workflow;

CREATE POLICY "co_workflow_director_all"
  ON change_order_workflow FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "co_workflow_scoped_select"
  ON change_order_workflow FOR SELECT
  USING (
    change_order_id IN (SELECT id FROM change_orders)
  );

-- INSERT: actor must be self, and must have access to the CO's contract
CREATE POLICY "co_workflow_scoped_insert"
  ON change_order_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND change_order_id IN (SELECT id FROM change_orders)
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 9 — contract_boq_templates + contract_staff_templates
--
--  DROPPED (4):
--    boq_tmpl_internal_all      (004) — is_internal() → too broad
--    boq_tmpl_external_select   (004) — external_user_id (deprecated)
--    staff_tmpl_internal_all    (004) — is_internal() → too broad
--    staff_tmpl_external_select (004) — external_user_id (deprecated)
--
--  CREATED (4):
--    Templates are read-only for non-directors. Director manages them.
-- ════════════════════════════════════════════════════════════════════

-- contract_boq_templates
DROP POLICY IF EXISTS "boq_tmpl_internal_all"    ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_external_select" ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_director_all"    ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_scoped_select"   ON contract_boq_templates;

CREATE POLICY "boq_tmpl_director_all"
  ON contract_boq_templates FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "boq_tmpl_scoped_select"
  ON contract_boq_templates FOR SELECT
  USING (has_contract_access(contract_id));

-- contract_staff_templates
DROP POLICY IF EXISTS "staff_tmpl_internal_all"    ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_external_select" ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_director_all"    ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_scoped_select"   ON contract_staff_templates;

CREATE POLICY "staff_tmpl_director_all"
  ON contract_staff_templates FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "staff_tmpl_scoped_select"
  ON contract_staff_templates FOR SELECT
  USING (has_contract_access(contract_id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 10 — contract_amendments
--
--  DROPPED (2):
--    amendments_internal_select  (023) — is_internal() → too broad for read
--    amendments_external_select  (023) — user_contracts
--
--  KEPT (2, unchanged):
--    amendments_insert_admin     (007) — auth_role() IN (director,admin)
--    amendments_update_director  (007) — auth_role() = director
--
--  CREATED (2):
--    amendments_director_all     — director full access
--    amendments_scoped_select    — contract-scoped read
--
--  NOTE: INSERT/UPDATE policies from 007 are kept because they use
--  auth_role() and are for internal-only operations. Amendment
--  creation is an admin/director function, not a contract-role check.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "amendments_internal_select" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_external_select" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_select_all"      ON contract_amendments;
-- Defensive
DROP POLICY IF EXISTS "amendments_director_all"    ON contract_amendments;
DROP POLICY IF EXISTS "amendments_scoped_select"   ON contract_amendments;

CREATE POLICY "amendments_director_all"
  ON contract_amendments FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "amendments_scoped_select"
  ON contract_amendments FOR SELECT
  USING (has_contract_access(contract_id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 11 — kpi_snapshots
--
--  DROPPED (4):
--    kpi_internal_all                (001) — is_internal() → too broad
--    kpi_external_own                (001) — external_user_id (deprecated)
--    kpi_snapshots_internal_select   (010/020) — role-based, no scope
--    kpi_snapshots_supervisor_select (010) — user_contracts
--
--  CREATED (2):
--    kpi_director_all                — director full access
--    kpi_scoped_select               — contract-scoped read
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "kpi_internal_all"                ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_external_own"                ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_snapshots_internal_select"   ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_snapshots_supervisor_select" ON kpi_snapshots;
-- Defensive
DROP POLICY IF EXISTS "kpi_director_all"                ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_scoped_select"               ON kpi_snapshots;

CREATE POLICY "kpi_director_all"
  ON kpi_snapshots FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "kpi_scoped_select"
  ON kpi_snapshots FOR SELECT
  USING (has_contract_access(contract_id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 12 — Audit log entry
-- ════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_logs')
  THEN
    INSERT INTO audit_logs (
      action, entity_type, entity_id, entity_label,
      old_values, new_values, metadata
    ) VALUES (
      'create'::audit_action,
      'rls_policies',
      gen_random_uuid(),
      'Migration 026 — RLS Contract-Scoped Roles',
      NULL,
      jsonb_build_object(
        'migration', '026_rls_contract_scoped_roles',
        'description', 'Replaced user_contracts + profiles.role RLS with user_contract_roles-based policies',
        'tables_modified', 12,
        'policies_dropped', 42,
        'policies_created', 36,
        'executed_at', NOW()::text
      ),
      jsonb_build_object('source', 'migration', 'version', '026')
    );
    RAISE NOTICE '✓ Audit log entry created for migration 026.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '⊘ audit_logs insert failed: % — skipping (non-blocking).', SQLERRM;
END $$;


COMMIT;


-- ════════════════════════════════════════════════════════════════════
--  VERIFICATION QUERIES (run after COMMIT)
-- ════════════════════════════════════════════════════════════════════


-- ── V1: Complete policy inventory — all modified tables ────────────
SELECT
  tablename,
  policyname,
  cmd,
  permissive,
  LEFT(qual, 100)       AS using_clause,
  LEFT(with_check, 100) AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts', 'claims', 'claim_workflow', 'documents',
    'change_orders', 'change_order_boq_items', 'change_order_staff_items',
    'change_order_workflow', 'contract_boq_templates', 'contract_staff_templates',
    'contract_amendments', 'kpi_snapshots'
  )
ORDER BY tablename, policyname;


-- ── V2: ZERO legacy policies should remain ─────────────────────────
-- Checks for: is_internal(), user_contracts, external_user_id, auth.uid() IS NOT NULL, (true)
SELECT
  tablename,
  policyname,
  'LEGACY/OPEN POLICY FOUND' AS warning
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts', 'claims', 'claim_workflow', 'documents',
    'change_orders', 'change_order_boq_items', 'change_order_staff_items',
    'change_order_workflow', 'contract_boq_templates', 'contract_staff_templates',
    'contract_amendments', 'kpi_snapshots'
  )
  AND (
    qual LIKE '%is_internal()%'
    OR qual LIKE '%user_contracts%'
    OR qual LIKE '%external_user_id%'
    OR qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  );
-- EXPECTED: 0 rows


-- ── V3: Confirm new helper function exists ─────────────────────────
SELECT
  routine_name,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('is_director', 'has_contract_access', 'has_contract_role', 'get_contract_role')
ORDER BY routine_name;
-- EXPECTED: 4 rows, all DEFINER


-- ── V4: Policy count per table ─────────────────────────────────────
SELECT
  tablename,
  COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts', 'claims', 'claim_workflow', 'documents',
    'change_orders', 'change_order_boq_items', 'change_order_staff_items',
    'change_order_workflow', 'contract_boq_templates', 'contract_staff_templates',
    'contract_amendments', 'kpi_snapshots'
  )
GROUP BY tablename
ORDER BY tablename;
-- EXPECTED:
--   contracts:                    2  (director_all, scoped_select)
--   claims:                       7  (director_all, scoped_select, contractor_insert/update, supervisor/auditor/reviewer_update)
--   claim_workflow:               3  (director_all, scoped_select, scoped_insert)
--   documents:                    4  (director_all, scoped_select/insert/delete)
--   change_orders:                4  (director_all, scoped_select, contractor_insert, scoped_update_draft)
--   change_order_boq_items:       5  (director_all, scoped_select/insert/update/delete)
--   change_order_staff_items:     5  (director_all, scoped_select/insert/update/delete)
--   change_order_workflow:        3  (director_all, scoped_select, scoped_insert)
--   contract_boq_templates:       2  (director_all, scoped_select)
--   contract_staff_templates:     2  (director_all, scoped_select)
--   contract_amendments:          4  (director_all, scoped_select, insert_admin, update_director)
--   kpi_snapshots:                2  (director_all, scoped_select)


-- ── V5: Unchanged tables — should still have their original policies ─
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'claim_boq_items', 'claim_staff_items',
    'profiles', 'audit_logs', 'notifications',
    'user_contracts', 'user_contract_roles'
  )
ORDER BY tablename, policyname;


-- ── V6: Confirm NO open/backdoor policies on ANY public table ──────
SELECT tablename, policyname, LEFT(qual, 80) AS condition
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  )
ORDER BY tablename;
-- EXPECTED: Only convera_users and convera_otp (public by design for OTP flow)


-- ════════════════════════════════════════════════════════════════════
--  ROLLBACK SQL (run manually if needed to revert to pre-026 state)
--
--  After rollback, re-apply migrations 019, 020, 023 to restore
--  the legacy user_contracts-based policies.
-- ════════════════════════════════════════════════════════════════════

/*
-- ROLLBACK START —————————————————————————————————

BEGIN;

-- Phase 1: Drop all 026 policies on contracts
DROP POLICY IF EXISTS "contracts_director_all"    ON contracts;
DROP POLICY IF EXISTS "contracts_scoped_select"   ON contracts;

-- Phase 2: Drop all 026 policies on claims
DROP POLICY IF EXISTS "claims_director_all"       ON claims;
DROP POLICY IF EXISTS "claims_scoped_select"      ON claims;
DROP POLICY IF EXISTS "claims_contractor_insert"  ON claims;
DROP POLICY IF EXISTS "claims_contractor_update"  ON claims;
DROP POLICY IF EXISTS "claims_supervisor_update"  ON claims;
DROP POLICY IF EXISTS "claims_auditor_update"     ON claims;
DROP POLICY IF EXISTS "claims_reviewer_update"    ON claims;

-- Phase 3: Drop all 026 policies on claim_workflow
DROP POLICY IF EXISTS "claim_workflow_director_all"   ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_select"  ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_insert"  ON claim_workflow;

-- Phase 4: Drop all 026 policies on documents
DROP POLICY IF EXISTS "documents_director_all"    ON documents;
DROP POLICY IF EXISTS "documents_scoped_select"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_insert"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_delete"   ON documents;

-- Phase 5: Drop all 026 policies on change_orders
DROP POLICY IF EXISTS "co_director_all"           ON change_orders;
DROP POLICY IF EXISTS "co_scoped_select"          ON change_orders;
DROP POLICY IF EXISTS "co_contractor_insert"      ON change_orders;
DROP POLICY IF EXISTS "co_scoped_update_draft"    ON change_orders;

-- Phase 6: Drop all 026 policies on change_order_boq_items
DROP POLICY IF EXISTS "co_boq_director_all"       ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_select"      ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_insert"      ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_update"      ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_delete"      ON change_order_boq_items;

-- Phase 7: Drop all 026 policies on change_order_staff_items
DROP POLICY IF EXISTS "co_staff_director_all"     ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_select"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_insert"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_update"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_delete"    ON change_order_staff_items;

-- Phase 8: Drop all 026 policies on change_order_workflow
DROP POLICY IF EXISTS "co_workflow_director_all"   ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_select"  ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_insert"  ON change_order_workflow;

-- Phase 9: Drop all 026 policies on templates
DROP POLICY IF EXISTS "boq_tmpl_director_all"      ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_scoped_select"     ON contract_boq_templates;
DROP POLICY IF EXISTS "staff_tmpl_director_all"    ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_scoped_select"   ON contract_staff_templates;

-- Phase 10: Drop all 026 policies on amendments
DROP POLICY IF EXISTS "amendments_director_all"    ON contract_amendments;
DROP POLICY IF EXISTS "amendments_scoped_select"   ON contract_amendments;

-- Phase 11: Drop all 026 policies on kpi_snapshots
DROP POLICY IF EXISTS "kpi_director_all"           ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_scoped_select"          ON kpi_snapshots;

-- Phase 12: Drop new helper function
DROP FUNCTION IF EXISTS is_director();

-- Phase 13: Restore legacy is_internal()-based policies
-- Re-apply from migrations 001, 019, 020, 023:

CREATE POLICY "contracts_internal_all"
  ON contracts FOR ALL USING (is_internal());
CREATE POLICY "contracts_internal_select"
  ON contracts FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));
CREATE POLICY "contracts_contractor_select"
  ON contracts FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = contracts.id));
CREATE POLICY "contracts_consultant_select"
  ON contracts FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = contracts.id));

CREATE POLICY "claims_internal_all"
  ON claims FOR ALL USING (is_internal());
CREATE POLICY "claims_internal_select"
  ON claims FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));
CREATE POLICY "claims_contractor_select"
  ON claims FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_contractor_insert"
  ON claims FOR INSERT
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (SELECT 1 FROM user_contracts uc JOIN contracts c ON c.id = uc.contract_id
      WHERE uc.user_id = auth.uid() AND uc.contract_id = claims.contract_id AND c.status = 'active')
    AND created_by = auth.uid());
CREATE POLICY "claims_contractor_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND created_by = auth.uid()
    AND status IN ('draft','returned_by_consultant','returned_by_admin','returned_by_supervisor','returned_by_auditor')
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor' AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_consultant_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND status IN ('submitted','under_supervisor_review')
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_admin_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' AND status IN ('under_auditor_review'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "claims_reviewer_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer' AND status IN ('under_reviewer_check'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer');
CREATE POLICY "claims_director_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'director' AND status IN ('pending_director_approval'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'director');

CREATE POLICY "workflow_internal_all"
  ON claim_workflow FOR ALL USING (is_internal());
CREATE POLICY "workflow_external_select"
  ON claim_workflow FOR SELECT
  USING (claim_id IN (SELECT c.id FROM claims c JOIN contracts ct ON c.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "workflow_external_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (actor_id = auth.uid() AND action IN ('submit','resubmit','comment')
    AND claim_id IN (SELECT c.id FROM claims c JOIN contracts ct ON c.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "claim_workflow_roles_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('consultant','admin','reviewer','director','contractor'));

CREATE POLICY "documents_internal_all"
  ON documents FOR ALL USING (is_internal());
CREATE POLICY "documents_external_select"
  ON documents FOR SELECT
  USING ((claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM claims cl JOIN user_contracts uc ON uc.contract_id = cl.contract_id WHERE cl.id = documents.claim_id AND uc.user_id = auth.uid()))
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = documents.contract_id)));
CREATE POLICY "documents_external_insert"
  ON documents FOR INSERT
  WITH CHECK (uploaded_by = auth.uid() AND (
    (claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM claims cl JOIN user_contracts uc ON uc.contract_id = cl.contract_id WHERE cl.id = documents.claim_id AND uc.user_id = auth.uid() AND cl.status IN ('draft','returned_by_consultant','returned_by_admin','returned_by_supervisor','returned_by_auditor')))
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = documents.contract_id))));
CREATE POLICY "documents_external_delete"
  ON documents FOR DELETE
  USING (uploaded_by = auth.uid() AND (
    (claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM claims cl JOIN user_contracts uc ON uc.contract_id = cl.contract_id WHERE cl.id = documents.claim_id AND uc.user_id = auth.uid() AND cl.status = 'draft'))
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = documents.contract_id))));

CREATE POLICY "co_internal_all"
  ON change_orders FOR ALL USING (is_internal());
CREATE POLICY "change_orders_internal_select"
  ON change_orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));
CREATE POLICY "co_external_select"
  ON change_orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = change_orders.contract_id));
CREATE POLICY "co_external_insert"
  ON change_orders FOR INSERT
  WITH CHECK (created_by = auth.uid() AND status = 'draft'
    AND EXISTS (SELECT 1 FROM user_contracts uc JOIN contracts c ON c.id = uc.contract_id WHERE uc.user_id = auth.uid() AND uc.contract_id = change_orders.contract_id AND c.status = 'active'));
CREATE POLICY "co_external_update_draft"
  ON change_orders FOR UPDATE
  USING ((created_by = auth.uid() OR submitted_by = auth.uid()) AND status = 'draft'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = change_orders.contract_id))
  WITH CHECK ((created_by = auth.uid() OR submitted_by = auth.uid()) AND status = 'draft'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = change_orders.contract_id));

CREATE POLICY "co_boq_internal_all" ON change_order_boq_items FOR ALL USING (is_internal());
CREATE POLICY "co_boq_external_select" ON change_order_boq_items FOR SELECT
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "co_boq_external_insert" ON change_order_boq_items FOR INSERT
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_boq_external_update" ON change_order_boq_items FOR UPDATE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'))
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_boq_external_delete" ON change_order_boq_items FOR DELETE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));

CREATE POLICY "co_staff_internal_all" ON change_order_staff_items FOR ALL USING (is_internal());
CREATE POLICY "co_staff_external_select" ON change_order_staff_items FOR SELECT
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "co_staff_external_insert" ON change_order_staff_items FOR INSERT
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_staff_external_update" ON change_order_staff_items FOR UPDATE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'))
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_staff_external_delete" ON change_order_staff_items FOR DELETE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));

CREATE POLICY "co_workflow_internal_all" ON change_order_workflow FOR ALL USING (is_internal());
CREATE POLICY "co_workflow_external_select" ON change_order_workflow FOR SELECT
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "co_workflow_external_insert" ON change_order_workflow FOR INSERT
  WITH CHECK (actor_id = auth.uid() AND action IN ('submit','comment')
    AND change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));

CREATE POLICY "boq_tmpl_internal_all" ON contract_boq_templates FOR ALL USING (is_internal());
CREATE POLICY "boq_tmpl_external_select" ON contract_boq_templates FOR SELECT
  USING (contract_id IN (SELECT id FROM contracts WHERE external_user_id = auth.uid()));
CREATE POLICY "staff_tmpl_internal_all" ON contract_staff_templates FOR ALL USING (is_internal());
CREATE POLICY "staff_tmpl_external_select" ON contract_staff_templates FOR SELECT
  USING (contract_id IN (SELECT id FROM contracts WHERE external_user_id = auth.uid()));

CREATE POLICY "amendments_internal_select" ON contract_amendments FOR SELECT USING (is_internal());
CREATE POLICY "amendments_external_select" ON contract_amendments FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = contract_amendments.contract_id));

CREATE POLICY "kpi_internal_all" ON kpi_snapshots FOR ALL USING (is_internal());
CREATE POLICY "kpi_external_own" ON kpi_snapshots FOR SELECT
  USING (contract_id IN (SELECT id FROM contracts WHERE external_user_id = auth.uid()));
CREATE POLICY "kpi_snapshots_internal_select" ON kpi_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));

COMMIT;

-- ROLLBACK END ———————————————————————————————————
*/
