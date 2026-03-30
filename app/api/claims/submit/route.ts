/**
 * POST /api/claims/submit
 * Atomic claim submission endpoint (v2 — production hardened)
 *
 * Validates (API-level, before DB call):
 *   1. User is authenticated and is the claim's contractor
 *   2. Invoice document exists and is attached
 *   3. Technical report document exists and is attached
 *   4. No period overlap with existing approved claims
 *   5. Activate the claim (set status = submitted)
 *
 * Executes:
 *    - Create Completion Certificate PDF (Auto-generated on approval)
 *    - Create Audit Form PDF (Auto-generated on approval)
 *    - Insert claim workflow log entry
 *    - Notify supervisor / auditor
 * 
 */CELARL$EOF
