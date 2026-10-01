-- 0008 creator assignments derived from a business-unit grant (T-DG1-BE3, F-DG1-106; ADR-0006).
-- A role that is granted at business-unit scope WITHOUT downward inheritance (e.g. TL) may create a transformation in
-- that unit, but on its own it never covers the transformation record. The API therefore gives the creator an
-- EXPLICIT, audited transformation-scope assignment of the same role (never a role holding an approval permission),
-- with the source grant's effective_to. `derived_from_assignment_id` links it to the source grant, so revoking the
-- source also revokes the derived assignment (in the same transaction, audited). NULL for every directly granted row.
ALTER TABLE scoped_assignment
  ADD COLUMN derived_from_assignment_id uuid NULL
    REFERENCES scoped_assignment (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT scoped_assignment_derived_not_self CHECK (derived_from_assignment_id IS DISTINCT FROM id),
  ADD CONSTRAINT scoped_assignment_derived_is_transformation
    CHECK (derived_from_assignment_id IS NULL OR scope_type = 'transformation');

CREATE INDEX scoped_assignment_derived_from_idx ON scoped_assignment (derived_from_assignment_id)
  WHERE derived_from_assignment_id IS NOT NULL AND revoked_at IS NULL;
