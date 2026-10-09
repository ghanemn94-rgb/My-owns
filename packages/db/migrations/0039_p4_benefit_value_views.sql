-- 0039 P4 benefit value read views: which benefits are counted in totals, and the separate value series
-- (T-DG4-ARCH-03; ADR-0030 §6-§7; REQ-PB-058, REQ-PB-075, REQ-PB-076, REQ-S08-001, REQ-S08-014, REQ-S08-016,
-- REQ-S08-018). Authored by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Read-only views: no row is written here.
-- The totals service (KBE-E, benefits/totals.ts) sums benefit_value_line joined to benefit_counting with decimal
-- arithmetic; it never reads benefit_scenario_value (scenarios are never actuals, REQ-S08-018) and never multiplies by
-- allocation shares for a portfolio or transformation total (a shared benefit counts once, REQ-PB-058).

-- benefit_counting: one row per benefit. counted = the benefit's values may enter a total:
--   archived benefits, parent benefits (roll-up containers: their children carry the values), members of a
--   shared-benefit group other than its counted member (or every member while no counted member is named), and the
--   excluded side of a Finance 'duplicate' overlap resolution are never counted. overlap_open = an open overlap warning
--   involves the benefit: its values stay out of validated totals until Finance resolves it (REQ-S08-014).
CREATE VIEW benefit_counting AS
SELECT b.id AS benefit_id,
       b.organization_id,
       b.transformation_id,
       b.value_class,
       b.currency,
       (x.reason IS NULL) AS counted,
       x.reason AS exclusion_reason,
       EXISTS (SELECT 1 FROM benefit_overlap o WHERE o.status = 'open' AND b.id IN (o.benefit_a_id, o.benefit_b_id)) AS overlap_open
FROM benefit b
LEFT JOIN benefit_group g ON g.id = b.benefit_group_id
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN b.status <> 'active' THEN 'archived'
    WHEN EXISTS (SELECT 1 FROM benefit c WHERE c.parent_benefit_id = b.id) THEN 'parent_rollup'
    WHEN b.benefit_group_id IS NOT NULL AND g.counted_benefit_id IS NULL THEN 'group_counted_member_not_named'
    WHEN b.benefit_group_id IS NOT NULL AND g.counted_benefit_id <> b.id THEN 'group_member_not_counted'
    WHEN EXISTS (SELECT 1 FROM benefit_overlap o WHERE o.status = 'resolved' AND o.excluded_benefit_id = b.id) THEN 'overlap_duplicate'
    ELSE NULL END AS reason
) x;
GRANT SELECT ON benefit_counting TO mth_app;

-- benefit_value_line: every value of every benefit tagged with exactly ONE value state (REQ-S08-001):
--   planned, forecast        benefit_plan_value rows of that kind
--   measured                 measurements (kind 'measurement') submitted or validated, at their measured amount
--   submitted                measurements waiting for Finance (pending; never validated value, REQ-S07-014, REQ-S08-016)
--   validated                validated rows measured before the Sustain step, at their validated (signed) amount,
--                            amendments and reversals included, so a reversal nets the original (REQ-S08-017)
--   sustained                validated rows measured in the Sustain step
--   rejected                 rejected measurements, kept visible at their measured amount
-- 'measured' overlaps 'submitted' and 'validated' by definition (it is what was measured); a total is always computed
-- for ONE state, never by adding states together. amount is NULL for a non-financial value (Value n/a, REQ-PB-076):
-- a NULL is never summed as 0.
CREATE VIEW benefit_value_line AS
SELECT p.benefit_id, p.transformation_id, p.value_kind AS value_state, p.period_start, p.period_end, p.amount, p.kpi_value,
       p.currency, 'benefit_plan_value'::text AS record_table, p.id AS record_id
FROM benefit_plan_value p
UNION ALL
SELECT m.benefit_id, m.transformation_id, 'measured', m.period_start, m.period_end, m.amount, m.kpi_value, m.currency,
       'benefit_measurement', m.id
FROM benefit_measurement m WHERE m.kind = 'measurement' AND m.status IN ('submitted', 'validated')
UNION ALL
SELECT m.benefit_id, m.transformation_id, 'submitted', m.period_start, m.period_end, m.amount, m.kpi_value, m.currency,
       'benefit_measurement', m.id
FROM benefit_measurement m WHERE m.status = 'submitted'
UNION ALL
SELECT m.benefit_id, m.transformation_id, CASE WHEN m.sustain_phase THEN 'sustained' ELSE 'validated' END, m.period_start,
       m.period_end, m.validated_amount, m.kpi_value, m.currency, 'benefit_measurement', m.id
FROM benefit_measurement m WHERE m.status = 'validated'
UNION ALL
SELECT m.benefit_id, m.transformation_id, 'rejected', m.period_start, m.period_end, m.amount, m.kpi_value, m.currency,
       'benefit_measurement', m.id
FROM benefit_measurement m WHERE m.status = 'rejected';
GRANT SELECT ON benefit_value_line TO mth_app;
