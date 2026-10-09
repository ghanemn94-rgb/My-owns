-- 0029 P4 identity and governance routing: governed groups and membership, the governance-party catalogue (the T11
-- and T12 role columns), per-transformation role mapping to a named person or a governed group, and the delegation
-- extension (revocation, absence note, the loop guard) (T-DG4-ARCH-01; ADR-0026 §1-§3). Authored by
-- solution-architect. Contract: docs/architecture/data-dictionary.md ("P4" section). Runs as mth_owner inside one
-- transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- A group is a ROUTING target (who receives an approval or a task). It grants no permission: scoped_assignment stays
-- the only source of access (ADR-0006), so a technical administrator added to a group still holds no business
-- approval permission (REQ-S10-003).

-- -----------------------------------------------------------------------------------------------------------------
-- access_group: a governed group of people (REQ-S16-011 "Group", REQ-S10-008 "governed groups"), e.g. SteerCo.
CREATE TABLE access_group (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code            text NOT NULL CONSTRAINT access_group_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name_en         text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar         text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  description     text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 2000),
  owner_user_id   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT access_group_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT access_group_org_id_key UNIQUE (organization_id, id)
);
SELECT p2_attach_guards('access_group', true);
GRANT SELECT, INSERT, UPDATE ON access_group TO mth_app;

-- access_group_member: membership with an effective window; removal is recorded, never deleted.
CREATE TABLE access_group_member (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  group_id        uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz NULL,
  removed_at      timestamptz NULL,
  removed_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  remove_reason   text NULL CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 1 AND 1000),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT access_group_member_group_fkey FOREIGN KEY (organization_id, group_id)
    REFERENCES access_group (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT access_group_member_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT access_group_member_removal_complete CHECK (
    (removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (remove_reason IS NULL))
);
CREATE UNIQUE INDEX access_group_member_active_key ON access_group_member (group_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX access_group_member_user_idx ON access_group_member (user_id) WHERE removed_at IS NULL;
-- A member must belong to the group's organization.
CREATE FUNCTION access_group_member_same_org() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = NEW.user_id AND u.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'access_group_member: user % is not in organization %', NEW.user_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'access_group_member_same_org';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER access_group_member_same_org BEFORE INSERT ON access_group_member
  FOR EACH ROW EXECUTE FUNCTION access_group_member_same_org();
SELECT p2_attach_guards('access_group_member', true);
GRANT SELECT, INSERT, UPDATE ON access_group_member TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- governance_party: the parties named by T11 (B0099) and T12 (B0101), seeded and read-only. role_code links a party
-- to the platform role whose holders it usually means; the mapping per transformation (role_mapping) decides who it
-- is. label_en is the source wording; label_ar is a PROVISIONAL translation.
CREATE TABLE governance_party (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  ordinal    smallint NOT NULL CHECK (ordinal >= 1),
  kind       text NOT NULL CHECK (kind IN ('role', 'forum', 'office', 'owner_group')),
  role_code  text NULL REFERENCES role (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  label_en   text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar   text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT governance_party_ordinal_key UNIQUE (ordinal)
);
GRANT SELECT ON governance_party TO mth_app;
INSERT INTO governance_party (code, ordinal, kind, role_code, label_en, label_ar, source_ref) VALUES
  ('SP', 1, 'role', 'SP', 'Sponsor', 'الراعي', 'B0099;B0101'),
  ('TL', 2, 'role', 'TL', 'Transformation Lead', 'قائد التحول', 'B0099;B0101'),
  ('BO', 3, 'role', 'BO', 'Business Owner', 'مالك الأعمال', 'B0099;B0101'),
  ('WL', 4, 'role', 'WL', 'Workstream Lead', 'قائد مسار العمل', 'B0101'),
  ('FIN', 5, 'role', 'FIN', 'Finance', 'المالية', 'B0099;B0101'),
  ('TD', 6, 'role', 'TD', 'Tech/Data', 'التقنية/البيانات', 'B0101'),
  ('TO', 7, 'office', 'TO', 'Transformation Office', 'مكتب التحول', 'B0099'),
  ('STEERCO', 8, 'forum', NULL, 'SteerCo', 'اللجنة التوجيهية', 'B0099'),
  ('PMO', 9, 'office', NULL, 'PMO', 'مكتب إدارة المشاريع', 'B0099'),
  ('DESIGN_OWNER', 10, 'role', NULL, 'Design owner', 'مالك التصميم', 'B0099'),
  ('INITIATIVE_OWNER', 11, 'role', NULL, 'Initiative owner', 'مالك المبادرة', 'B0099'),
  ('INITIATIVE_OWNERS', 12, 'owner_group', NULL, 'Initiative owners', 'مالكو المبادرات', 'B0099'),
  ('BUSINESS_OWNERS', 13, 'owner_group', NULL, 'Business owners', 'ملاك الأعمال', 'B0099'),
  ('WORKSTREAMS', 14, 'owner_group', NULL, 'Workstreams', 'مسارات العمل', 'B0099'),
  ('RISK', 15, 'role', NULL, 'Risk', 'المخاطر', 'B0099'),
  ('TECH', 16, 'role', NULL, 'Tech', 'التقنية', 'B0099'),
  ('OPS', 17, 'role', NULL, 'Ops', 'العمليات', 'B0099'),
  ('CX', 18, 'role', NULL, 'CX', 'تجربة العملاء', 'B0099');

-- -----------------------------------------------------------------------------------------------------------------
-- role_mapping: who a party IS in one transformation (REQ-S10-008, M0211): exactly one named person or one governed
-- group per active mapping, at most one active mapping per (transformation, party). No fallback: an unmapped party
-- blocks routing with a visible error (ADR-0026 §2).
CREATE TABLE role_mapping (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  party_code        text NOT NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_kind       text NOT NULL CHECK (target_kind IN ('user', 'group')),
  user_id           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  group_id          uuid NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  ended_at          timestamptz NULL,
  ended_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  end_reason        text NULL CHECK (end_reason IS NULL OR char_length(end_reason) BETWEEN 1 AND 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT role_mapping_group_fkey FOREIGN KEY (organization_id, group_id)
    REFERENCES access_group (organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT role_mapping_one_target CHECK (
    (target_kind = 'user' AND user_id IS NOT NULL AND group_id IS NULL)
    OR (target_kind = 'group' AND group_id IS NOT NULL AND user_id IS NULL)),
  CONSTRAINT role_mapping_end_complete CHECK (
    (status = 'ended') = (ended_at IS NOT NULL) AND (ended_at IS NULL) = (ended_by IS NULL)
    AND (ended_at IS NULL) = (end_reason IS NULL))
);
CREATE UNIQUE INDEX role_mapping_active_key ON role_mapping (transformation_id, party_code) WHERE status = 'active';
CREATE INDEX role_mapping_user_idx ON role_mapping (user_id) WHERE status = 'active';
-- A mapped person must be in the transformation's organization; an ended mapping never becomes active again.
CREATE FUNCTION role_mapping_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = NEW.user_id AND u.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'role_mapping: user % is not in organization %', NEW.user_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'role_mapping_same_org';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN
      RAISE EXCEPTION 'role_mapping: an ended mapping cannot be reactivated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'role_mapping_ended_final';
    END IF;
    IF NEW.party_code IS DISTINCT FROM OLD.party_code OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
       OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
      RAISE EXCEPTION 'role_mapping: party and target are immutable; end the mapping and create a new one'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'role_mapping_target_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_mapping_guard BEFORE INSERT OR UPDATE ON role_mapping FOR EACH ROW EXECUTE FUNCTION role_mapping_guard();
SELECT p2_attach_guards('role_mapping', true);
GRANT SELECT, INSERT, UPDATE ON role_mapping TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- delegation (0001) extension (REQ-S10-010, M0211). Additive: new nullable columns, a revocation-completeness CHECK
-- that every existing row satisfies (all NULL), the row guard (version step, immutable identity) and the loop guard.
-- The audit-required trigger is NOT attached: DG3 integration fixtures insert delegation rows directly, and adding it
-- would change a DG1-approved table's write contract. Audit coverage for delegation writes is enforced by the API
-- and its tests (ADR-0026 §3).
ALTER TABLE delegation
  ADD COLUMN absence_note       text NULL CHECK (absence_note IS NULL OR char_length(absence_note) BETWEEN 1 AND 1000),
  ADD COLUMN requested_by_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN revoked_at         timestamptz NULL,
  ADD COLUMN revoked_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN revoke_reason      text NULL CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 1 AND 1000),
  ADD CONSTRAINT delegation_revocation_complete CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)
    AND (revoked_at IS NULL OR status = 'revoked'));
COMMENT ON COLUMN delegation.requested_by_user_id IS
  'Set when an access administrator records the delegation on the delegator''s request (REQ-S10-010 "ADM on request").';

-- Loop guard (REQ-S10-010 "A delegating to B and B to A is rejected"; ADR-0006 "Cycles (A->B->A, A->B->C->A)").
-- A delegation that is active and not yet ended may not close a path back to its delegator through other active,
-- not-yet-ended delegations of the same organization, whatever their scopes and windows. Serialized per organization
-- with advisory-lock class 730224 (ADR-0016 §6), so two concurrent halves of a loop cannot both commit.
CREATE FUNCTION delegation_loop_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  delegation_graph_lock_class CONSTANT integer := 730224;
  loops boolean;
BEGIN
  IF NEW.status <> 'active' OR NEW.effective_to <= now() THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(delegation_graph_lock_class, hashtext(NEW.organization_id::text));
  WITH RECURSIVE reach (user_id, depth) AS (
    SELECT NEW.delegate_user_id, 0
    UNION
    SELECT d.delegate_user_id, r.depth + 1
    FROM reach r
    JOIN delegation d ON d.delegator_user_id = r.user_id
    WHERE d.organization_id = NEW.organization_id AND d.status = 'active' AND d.effective_to > now()
      AND d.id <> NEW.id AND r.depth < 50
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE user_id = NEW.delegator_user_id) INTO loops;
  IF loops THEN
    RAISE EXCEPTION 'delegation: % -> % would create a delegation loop', NEW.delegator_user_id, NEW.delegate_user_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'delegation_no_loop';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delegation_loop_guard BEFORE INSERT OR UPDATE OF status, delegator_user_id, delegate_user_id, effective_to
  ON delegation FOR EACH ROW EXECUTE FUNCTION delegation_loop_guard();
SELECT p2_attach_guards('delegation', false);
