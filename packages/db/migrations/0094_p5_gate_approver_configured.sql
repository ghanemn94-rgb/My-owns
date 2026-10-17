-- 0094 (P5 repair; D-164 (b), D-165; T-DG5-BE-C4; ADR-0039 §3, ADR-0015 §2). Forward-only, additive.
--
-- gate_instance.approver_configured remembers that the approver of a gate was set explicitly through the approver
-- configuration operation (PATCH /transformations/{t}/gates/{gateCode}, audit action 'gate_instance.configure').
-- Before this column, "no named user and the catalogue default role" could not be told apart from "never configured",
-- so an explicit role-only choice of the catalogue default (for example SP for G3) was overridden by the default of
-- the transformation's pinned methodology version (for example BO). routedApproverOf now keeps the stored approver
-- when this flag is true, and otherwise applies the earlier rule unchanged.
--
-- Backfill: true for every instance that has at least one 'gate_instance.configure' audit event. The backfill changes
-- ONLY the new column: version, updated_at, updated_by and every other value stay byte-identical (p5-plan R2), so
-- ETags and audit history are unchanged. For that, the two row-level guards of gate_instance (p2_row_guard: version
-- step; p2_audit_required: an audit event per version) are disabled for the backfill statement only, inside this
-- migration's own transaction, and re-enabled before it commits. No audit event is written: the flag records a fact
-- already in the audit trail; no business value changes. gate_instance_approver_allowed fires only on
-- UPDATE OF approver_role_code and is not affected.
--
-- Nothing here is a business approval: product gates G1-G6 are business approvals inside the product, and nothing
-- here touches the engineering gates DG0-DG7.

ALTER TABLE gate_instance ADD COLUMN approver_configured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN gate_instance.approver_configured IS
  'True once the approver was set through the approver configuration (audit action gate_instance.configure); '
  'routedApproverOf then keeps the stored approver instead of the pinned methodology default (0094, D-164 b).';

ALTER TABLE gate_instance DISABLE TRIGGER gate_instance_row_guard;
ALTER TABLE gate_instance DISABLE TRIGGER gate_instance_audit_required;

UPDATE gate_instance g
   SET approver_configured = true
 WHERE EXISTS (
   SELECT 1 FROM audit_event a
    WHERE a.record_type = 'gate_instance'
      AND a.record_id = g.id
      AND a.action = 'gate_instance.configure'
 );

ALTER TABLE gate_instance ENABLE TRIGGER gate_instance_audit_required;
ALTER TABLE gate_instance ENABLE TRIGGER gate_instance_row_guard;
