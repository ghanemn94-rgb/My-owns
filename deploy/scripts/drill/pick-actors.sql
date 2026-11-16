-- deploy/scripts/drill/pick-actors.sql: the drill's actors on the target T (ADR-0069 §4 D7-D9; ADR-0064 A3.6;
-- p7-work-split §B.7 DO-D3 and §B.8 DO-D4; T-DG7-DO-D3, T-DG7-DO-D4). Used by transfer-drill.sh (pick_actors) and by
-- T-B17/T-B18, so the tests measure the drill's own choice. psql variable :unbound is the carried user left unmapped
-- (never chosen); pass the nil uuid when there is none.
-- Only REBOUND users are chosen (an identity_rebind_event 'rebound'), by permission and configuration, never "whatever
-- is new". A grant counts in the transformation's scope or in its organization's scope.
--   admin          an operations.read holder (D7 status);
--   transformation one transformation on which S, P and a KPI user exist;
--   submitter  S   a gate.submit holder there (D8 creates, RAID item, the gate submission C3);
--   gate           the lowest gate there in draft, changes_requested or deferred (A3.6);
--   approver   P   the gate's configured approver: approver_user_id when set, else a holder of its approver role; with
--                  gate.decide; P <> S (C4, C5);
--   kpiUser, kpiDefinition, kpiValueNature: the first KPI below (the DO-D3 routine update; kept for the CLI);
--   kpis           per active KPI definition of the transformation: { user K (kpi_actual.submit, owner or steward),
--                  reviewer V (kpi_actual.accept, the active version's reviewer party resolved through role_mapping to
--                  the person or the group's current members; null when the version has no reviewer party), K <> V,
--                  valueNature } (A3.6 remedy g5.performance_*; null members when nobody qualifies);
--   evidenceReviewer W  an evidence.review holder, W <> S (remedy g5.performance_pilot_evidence_missing);
--   decisionOwner  O    an executive_decision.decide holder (remedy g5.decision_log_empty);
--   decisionOwners      per executive decision of the transformation: its owner when rebound and holding
--                       executive_decision.decide, else null (remedies g5.decision_date_missing, g5.decision_overdue);
--   trainer    L   a proficiency.record holder (remedy via a training_records adoption source);
--   riskEditor X   a raid.edit holder (remedy g5.risk_open);
--   periodManager R  a reporting_period.manage holder by an ORGANIZATION-scoped grant, with organization.read
--                  (the period routes are organization routes; reporting-periods.ts requireManage) (opens the current reporting period for the KPI remedy;
--                  T-DG7-DO-D5);
--   accessAdmin    G  a rebound access.assign holder by an ORGANIZATION-scoped grant on the transformation's organization
--                  (createRoleAssignment at organization scope needs it: rules.ts grantApplies never lets a business-unit
--                  grant act on an organization target); used only when no periodManager exists (D-262 (a); T-DG7-DO-D6);
--   periodGrantee  the rebound user G grants the organization-wide TO role (reporting_period.manage, organization.read):
--                  the first rebound reporting_period.manage holder on the transformation, else the first KPI user K;
--                  never G itself (access.self_grant). SYNTHETIC; the grant is journalled and audited, and approves nothing;
--   adoptionEditor A  an adoption.edit holder (remedy g5.adoption_none; T-DG7-DO-D5, D-261);
--   adoptionLink   { templateKey, kpiDefinition }: the first KPI-fed adoption template (by indicator and measure
--                  ordinal) whose unit_kind and polarity equal an active KPI of the transformation that has a KPI user
--                  K, with no active link of that template on the transformation yet (createAdoptionMetricLink's
--                  kpi_mismatch and exists rules); null when none matches. Configuration through the API, never a seed edit.
-- A role nobody fills is null; journey.mjs stops D8 with `D8 FAIL: no rebound user holds <permission>` when a needed
-- remedy (or S/P) has no actor. Prints one JSON object. SYNTHETIC drill users; choosing an actor approves nothing.
WITH rebound AS (
  SELECT DISTINCT e.user_id FROM identity_rebind_event e JOIN app_user u ON u.id = e.user_id
   WHERE e.action = 'rebound' AND u.status = 'active' AND e.user_id <> :'unbound'::uuid),
held AS (
  -- (user, transformation, permission, role): transformation-scoped grants, and organization-scoped grants spread to
  -- every transformation of that organization
  SELECT sa.user_id, t.id AS t, rp.permission_code, r.code AS role_code
    FROM scoped_assignment sa JOIN role_permission rp ON rp.role_id = sa.role_id JOIN role r ON r.id = sa.role_id
    JOIN transformation t ON (sa.scope_type = 'transformation' AND sa.scope_id = t.id)
                          OR (sa.scope_type = 'organization' AND sa.scope_id = t.organization_id)
   WHERE sa.revoked_at IS NULL AND (sa.effective_to IS NULL OR sa.effective_to > now())
     AND sa.user_id IN (SELECT user_id FROM rebound)),
kpi AS (
  SELECT h.t, h.user_id AS kpi_user, k.id AS kpi_definition
    FROM held h JOIN kpi_definition k ON k.transformation_id = h.t AND k.status = 'active'
     AND h.user_id IN (k.owner_user_id, k.steward_user_id)
   WHERE h.permission_code = 'kpi_actual.submit'
     -- a number (journey.mjs sends "1.5", or the ratio "3" / "2"): an active version that is not a milestone
     AND EXISTS (SELECT FROM kpi_version v WHERE v.kpi_definition_id = k.id AND v.status = 'active'
                   AND v.value_nature <> 'milestone' AND v.measure_type <> 'binary_milestone')),
gates AS (
  -- the lowest gate of the transformation that can be submitted (not approved, not pending a decision)
  SELECT g.transformation_id AS t, g.gate_code, g.approver_role_code, g.approver_user_id, gd.ordinal
    FROM gate_instance g JOIN gate_definition gd ON gd.code = g.gate_code
   WHERE g.status IN ('draft', 'changes_requested', 'deferred')),
pairs AS (
  SELECT s.t, s.user_id AS submitter, d.user_id AS approver, kpi.kpi_user, kpi.kpi_definition, gates.gate_code
    FROM held s
    JOIN gates ON gates.t = s.t
    JOIN held d ON d.t = s.t AND d.permission_code = 'gate.decide'
     AND (CASE WHEN gates.approver_user_id IS NOT NULL THEN d.user_id = gates.approver_user_id
               ELSE d.role_code = gates.approver_role_code END)
    JOIN kpi ON kpi.t = s.t AND kpi.kpi_user <> d.user_id
   WHERE s.permission_code = 'gate.submit' AND s.user_id <> d.user_id
   ORDER BY gates.ordinal, 1, 2, 3, 4, 5 LIMIT 1),
holder AS (
  -- the first rebound holder of a permission on the chosen transformation, by user id
  SELECT h.permission_code, min(h.user_id::text)::uuid AS user_id,
         min(h.user_id::text) FILTER (WHERE h.user_id <> (SELECT submitter FROM pairs))::uuid AS not_submitter
    FROM held h WHERE h.t = (SELECT t FROM pairs) GROUP BY h.permission_code),
party AS (
  -- the people a KPI version's reviewer party resolves to (actuals.ts reviewersOf): the mapped person, or the current
  -- members of the mapped active group
  SELECT k.id AS kpi_definition, m.user_id FROM kpi_definition k
    JOIN kpi_version v ON v.kpi_definition_id = k.id AND v.status = 'active'
    JOIN role_mapping m ON m.transformation_id = k.transformation_id AND m.party_code = v.reviewer_party_code
     AND m.status = 'active' AND m.target_kind <> 'group'
  UNION
  SELECT k.id, gm.user_id FROM kpi_definition k
    JOIN kpi_version v ON v.kpi_definition_id = k.id AND v.status = 'active'
    JOIN role_mapping m ON m.transformation_id = k.transformation_id AND m.party_code = v.reviewer_party_code
     AND m.status = 'active' AND m.target_kind = 'group'
    JOIN access_group g ON g.id = m.group_id AND g.status = 'active'
    JOIN access_group_member gm ON gm.group_id = g.id AND gm.removed_at IS NULL AND gm.effective_from <= now()
     AND (gm.effective_to IS NULL OR gm.effective_to > now())),
kpis AS (
  SELECT k.id AS kpi_definition,
         (SELECT v.value_nature FROM kpi_version v WHERE v.kpi_definition_id = k.id AND v.status = 'active'
           ORDER BY v.id LIMIT 1) AS value_nature,
         (SELECT v.reviewer_party_code FROM kpi_version v WHERE v.kpi_definition_id = k.id AND v.status = 'active'
           ORDER BY v.id LIMIT 1) AS reviewer_party,
         ku.user_id AS kpi_user,
         (SELECT min(p.user_id::text)::uuid FROM party p JOIN held h ON h.user_id = p.user_id AND h.t = k.transformation_id
           AND h.permission_code = 'kpi_actual.accept'
           WHERE p.kpi_definition = k.id AND p.user_id <> ku.user_id) AS reviewer
    FROM kpi_definition k
    LEFT JOIN LATERAL (
      -- K: an owner or steward holding kpi_actual.submit; one who is not the only possible reviewer comes first
      SELECT h.user_id FROM held h
       WHERE h.t = k.transformation_id AND h.permission_code = 'kpi_actual.submit'
         AND h.user_id IN (k.owner_user_id, k.steward_user_id)
       ORDER BY (SELECT count(*) FROM party p WHERE p.kpi_definition = k.id AND p.user_id <> h.user_id) = 0, h.user_id
       LIMIT 1) ku ON true
   WHERE k.transformation_id = (SELECT t FROM pairs) AND k.status = 'active'),
adoption AS (
  SELECT tp.key AS template_key, k.id AS kpi_definition
    FROM adoption_indicator_template tp
    JOIN kpi_definition k ON k.transformation_id = (SELECT t FROM pairs) AND k.status = 'active'
     AND k.unit_kind = tp.unit_kind AND k.polarity = tp.polarity
    JOIN kpis ON kpis.kpi_definition = k.id AND kpis.kpi_user IS NOT NULL
   WHERE tp.value_source = 'kpi_actuals'
     AND NOT EXISTS (SELECT FROM adoption_metric_link l WHERE l.transformation_id = k.transformation_id
                       AND l.template_key = tp.key AND l.target_kind = 'transformation' AND l.status = 'active')
   ORDER BY tp.indicator_ordinal, tp.measure_ordinal, k.id LIMIT 1),
decisions AS (
  SELECT d.id, CASE WHEN EXISTS (SELECT FROM held h WHERE h.user_id = d.owner_user_id AND h.t = d.transformation_id
                                   AND h.permission_code = 'executive_decision.decide')
                    THEN d.owner_user_id END AS owner
    FROM decision d WHERE d.kind = 'executive' AND d.transformation_id = (SELECT t FROM pairs))
SELECT json_build_object(
  'admin', (SELECT h.user_id FROM held h WHERE h.permission_code = 'operations.read' ORDER BY h.user_id LIMIT 1),
  'transformation', (SELECT t FROM pairs), 'submitter', (SELECT submitter FROM pairs),
  'approver', (SELECT approver FROM pairs), 'kpiUser', (SELECT kpi_user FROM pairs),
  'kpiDefinition', (SELECT kpi_definition FROM pairs), 'gate', (SELECT gate_code FROM pairs),
  'kpiValueNature', (SELECT v.value_nature FROM kpi_version v JOIN pairs ON v.kpi_definition_id = pairs.kpi_definition
                      WHERE v.status = 'active' ORDER BY v.id LIMIT 1),
  'kpis', coalesce((SELECT json_object_agg(kpi_definition, json_build_object('user', kpi_user, 'reviewer', reviewer,
                      'reviewerParty', reviewer_party, 'valueNature', value_nature)) FROM kpis), '{}'::json),
  'evidenceReviewer', (SELECT not_submitter FROM holder WHERE permission_code = 'evidence.review'),
  'decisionOwner', (SELECT user_id FROM holder WHERE permission_code = 'executive_decision.decide'),
  'decisionOwners', coalesce((SELECT json_object_agg(id, owner) FROM decisions), '{}'::json),
  'trainer', (SELECT user_id FROM holder WHERE permission_code = 'proficiency.record'),
  'riskEditor', (SELECT user_id FROM holder WHERE permission_code = 'raid.edit'),
  'adoptionEditor', (SELECT user_id FROM holder WHERE permission_code = 'adoption.edit'),
  'periodManager', (SELECT min(sa.user_id::text)::uuid FROM scoped_assignment sa JOIN role_permission rp ON rp.role_id = sa.role_id
                      JOIN transformation t ON t.id = (SELECT t FROM pairs)
                     WHERE sa.scope_type = 'organization' AND sa.scope_id = t.organization_id AND sa.revoked_at IS NULL
                       AND (sa.effective_to IS NULL OR sa.effective_to > now()) AND rp.permission_code = 'reporting_period.manage'
                       AND sa.user_id IN (SELECT user_id FROM rebound)
                       AND EXISTS (SELECT FROM held h WHERE h.user_id = sa.user_id AND h.t = t.id AND h.permission_code = 'organization.read')),
  'accessAdmin', (SELECT min(sa.user_id::text)::uuid FROM scoped_assignment sa JOIN role_permission rp ON rp.role_id = sa.role_id
                    JOIN transformation t ON t.id = (SELECT t FROM pairs)
                   WHERE sa.scope_type = 'organization' AND sa.scope_id = t.organization_id AND sa.revoked_at IS NULL
                     AND (sa.effective_to IS NULL OR sa.effective_to > now()) AND rp.permission_code = 'access.assign'
                     AND sa.user_id IN (SELECT user_id FROM rebound)),
  'periodGrantee', coalesce(
     (SELECT min(h.user_id::text)::uuid FROM held h WHERE h.t = (SELECT t FROM pairs)
         AND h.permission_code = 'reporting_period.manage'
         AND h.user_id IS DISTINCT FROM (SELECT min(sa.user_id::text)::uuid FROM scoped_assignment sa
               JOIN role_permission rp ON rp.role_id = sa.role_id JOIN transformation t ON t.id = (SELECT t FROM pairs)
              WHERE sa.scope_type = 'organization' AND sa.scope_id = t.organization_id AND sa.revoked_at IS NULL
                AND (sa.effective_to IS NULL OR sa.effective_to > now()) AND rp.permission_code = 'access.assign'
                AND sa.user_id IN (SELECT user_id FROM rebound))),
     (SELECT kpi_user FROM pairs)),
  'adoptionLink', (SELECT json_build_object('templateKey', template_key, 'kpiDefinition', kpi_definition) FROM adoption));
