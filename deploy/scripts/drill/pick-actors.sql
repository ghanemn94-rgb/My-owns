-- deploy/scripts/drill/pick-actors.sql: the drill's actors on the target T (ADR-0069 §4 D7-D9; p7-work-split §B.7
-- DO-D3; T-DG7-DO-D3). Used by transfer-drill.sh (pick_actors) and by T-B17, so the test measures the drill's own
-- choice. psql variable :unbound is the carried user left unmapped (never chosen); pass the nil uuid when there is none.
-- Only REBOUND users are chosen (an identity_rebind_event 'rebound'), by permission, never "whatever is new":
--   admin          an operations.read holder (D7 status);
--   transformation one transformation on which all of the following hold;
--   submitter      a gate.submit holder there (D8 (b) creates, RAID item, gate submission);
--   gate           the lowest gate there in draft, changes_requested or deferred (D8 (b) submits and decides it);
--   approver       a different gate.decide holder there who holds that gate's approver role (D8 (b) decision);
--   kpiUser        a kpi_actual.submit holder there who owns or stewards an active KPI definition of it (the routine
--                  update's record-level rule, apps/api/src/modules/kpi/actuals.ts maySubmitActuals); it may be the
--                  submitter; the definition's active version is not a milestone;
--   kpiDefinition  that definition, and kpiValueNature its active version's value_nature (journey --kpi-value-nature).
-- Prints one JSON object. SYNTHETIC drill users; choosing an actor approves nothing.
WITH held AS (
  SELECT sa.user_id, sa.scope_type, sa.scope_id, rp.permission_code, r.code AS role_code
    FROM scoped_assignment sa JOIN role_permission rp ON rp.role_id = sa.role_id JOIN role r ON r.id = sa.role_id
   WHERE sa.revoked_at IS NULL AND (sa.effective_to IS NULL OR sa.effective_to > now())
     AND sa.user_id <> :'unbound'::uuid
     AND EXISTS (SELECT FROM identity_rebind_event e WHERE e.user_id = sa.user_id AND e.action = 'rebound')),
kpi AS (
  SELECT h.scope_id AS t, h.user_id AS kpi_user, k.id AS kpi_definition
    FROM held h JOIN kpi_definition k ON k.transformation_id = h.scope_id AND k.status = 'active'
     AND h.user_id IN (k.owner_user_id, k.steward_user_id)
   WHERE h.scope_type = 'transformation' AND h.permission_code = 'kpi_actual.submit'
     -- a number (journey.mjs sends "1.5", or the ratio "3" / "2"): an active version that is not a milestone
     AND EXISTS (SELECT FROM kpi_version v WHERE v.kpi_definition_id = k.id AND v.status = 'active'
                   AND v.value_nature <> 'milestone' AND v.measure_type <> 'binary_milestone')),
gates AS (
  -- the lowest gate of the transformation that can be submitted (not approved, not pending a decision)
  SELECT g.transformation_id AS t, g.gate_code, g.approver_role_code, gd.ordinal
    FROM gate_instance g JOIN gate_definition gd ON gd.code = g.gate_code
   WHERE g.status IN ('draft', 'changes_requested', 'deferred')),
pairs AS (
  SELECT s.scope_id AS t, s.user_id AS submitter, d.user_id AS approver, kpi.kpi_user, kpi.kpi_definition, gates.gate_code
    FROM held s
    JOIN gates ON gates.t = s.scope_id
    JOIN held d ON d.scope_type = 'transformation' AND d.scope_id = s.scope_id AND d.role_code = gates.approver_role_code
    JOIN kpi ON kpi.t = s.scope_id AND kpi.kpi_user <> d.user_id
   WHERE s.scope_type = 'transformation' AND s.permission_code = 'gate.submit' AND d.permission_code = 'gate.decide'
     AND s.user_id <> d.user_id
   ORDER BY gates.ordinal, 1, 2, 3, 4, 5 LIMIT 1)
SELECT json_build_object(
  'admin', (SELECT user_id FROM held WHERE permission_code = 'operations.read' ORDER BY user_id LIMIT 1),
  'transformation', (SELECT t FROM pairs), 'submitter', (SELECT submitter FROM pairs),
  'approver', (SELECT approver FROM pairs), 'kpiUser', (SELECT kpi_user FROM pairs),
  'kpiDefinition', (SELECT kpi_definition FROM pairs), 'gate', (SELECT gate_code FROM pairs),
  'kpiValueNature', (SELECT v.value_nature FROM kpi_version v JOIN pairs ON v.kpi_definition_id = pairs.kpi_definition
                      WHERE v.status = 'active' ORDER BY v.id LIMIT 1));
