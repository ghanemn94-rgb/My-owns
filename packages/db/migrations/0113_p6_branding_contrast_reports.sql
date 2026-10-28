-- 0113 P6 slice I: the contrast report of a published branding version (T-DG6-ARCH-06; ADR-0061 §1). Authored by
-- solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit
-- once merged. SQL floor: PostgreSQL 16.
--
-- REQ-S15-003 ("An automated check computes WCAG contrast for every text/background combination and fails the build
-- below 4.5:1 (3:1 for large text)"). Since P5 a published branding version (0089) replaces brand.primary and
-- brand.deep at runtime, so the build-time check alone no longer covers every pair the screens render. ADR-0061 §1:
-- the publish evaluates every declared pair of the token source with the version's two colours (the derived shades
-- re-derived from them) and is refused with 422 branding.contrast_insufficient when any pair is below its threshold;
-- a version that is published records its report here, in the same transaction.
--   branding_contrast_report  at most one per branding version (organization_id, branding_version_no; composite
--                             foreign key to branding_version's unique key). The rule set (closed set), the SHA-256 of
--                             the token source the check ran against, and the number of pairs. Append-only; audited
--                             (record id; no version column). At COMMIT it has exactly pair_count pair rows, numbered
--                             1..pair_count (deferred check branding_contrast_report_pairs_complete).
--   branding_contrast_pair    one evaluated pair: foreground and background token names, their colours, the use
--                             (text 4.5:1; large-text and ui 3:1; WCAG 2.x AA), the ratio rounded DOWN to two decimals
--                             (the @mth/design-tokens floor2 rule, so 4.499 is stored as 4.49) and the threshold. A
--                             stored pair always passes (CHECK branding_contrast_pair_passes): the database can never
--                             hold a published report with a failing pair. Append-only.
-- What this migration does NOT do (ADR-0061 §1, "Consequences"): it does not require a report for every new branding
-- version. That deferred rule (branding_version_contrast_required) ships with the API change that writes the report
-- (work split §I/K.1, BE-W), as the next migration id at merge time, so the DG5 publish path keeps committing until
-- then. Versions published before that rule have no report; GET .../contrast evaluates them at read time and marks the
-- result not_recorded. No existing branding row is read, changed or deleted here.
-- Product gates G1-G6 are business approvals; branding is configuration, never an approval, and nothing here reads or
-- writes the engineering delivery gates DG0-DG7. #0078FF is a provisional brand token, not a verified Mobily colour.

CREATE TABLE branding_contrast_report (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  branding_version_no integer NOT NULL CHECK (branding_version_no >= 1),
  rules               text NOT NULL CHECK (rules IN ('wcag2x-aa-v1')),
  token_source_sha256 text NOT NULL CHECK (token_source_sha256 ~ '^[0-9a-f]{64}$'),
  pair_count          integer NOT NULL CHECK (pair_count BETWEEN 1 AND 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT branding_contrast_report_version_key UNIQUE (organization_id, branding_version_no),
  CONSTRAINT branding_contrast_report_version_fkey FOREIGN KEY (organization_id, branding_version_no)
    REFERENCES branding_version (organization_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT
);
SELECT p2_attach_guards('branding_contrast_report', true);
SELECT p2_attach_append_only('branding_contrast_report');
GRANT SELECT, INSERT ON branding_contrast_report TO mth_app;

CREATE TABLE branding_contrast_pair (
  id         uuid PRIMARY KEY,
  report_id  uuid NOT NULL REFERENCES branding_contrast_report (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal    integer NOT NULL CHECK (ordinal >= 1),
  fg_token   text NOT NULL CHECK (char_length(fg_token) <= 80 AND fg_token ~ '^[a-z]+(\.[a-z0-9-]+)+$'),
  bg_token   text NOT NULL CHECK (char_length(bg_token) <= 80 AND bg_token ~ '^[a-z]+(\.[a-z0-9-]+)+$'),
  use        text NOT NULL CHECK (use IN ('text', 'large-text', 'ui')),
  fg_hex     text NOT NULL CHECK (fg_hex ~ '^#[0-9A-F]{6}$'),
  bg_hex     text NOT NULL CHECK (bg_hex ~ '^#[0-9A-F]{6}$'),
  ratio      numeric(4, 2) NOT NULL CHECK (ratio BETWEEN 1 AND 21),
  threshold  numeric(2, 1) NOT NULL,
  usage_note text NOT NULL CHECK (char_length(usage_note) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branding_contrast_pair_ordinal_key UNIQUE (report_id, ordinal),
  CONSTRAINT branding_contrast_pair_pair_key UNIQUE (report_id, fg_token, bg_token, use),
  CONSTRAINT branding_contrast_pair_threshold_for_use CHECK (
    (use = 'text' AND threshold = 4.5) OR (use IN ('large-text', 'ui') AND threshold = 3.0)),
  CONSTRAINT branding_contrast_pair_passes CHECK (ratio >= threshold)
);
SELECT p2_attach_append_only('branding_contrast_pair');
GRANT SELECT, INSERT ON branding_contrast_pair TO mth_app;

-- At COMMIT, a report has exactly pair_count pairs, numbered 1..pair_count. Fired by the report's INSERT and by every
-- pair INSERT, so a pair added to a report committed earlier is refused as well.
CREATE FUNCTION branding_contrast_report_pairs_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_row jsonb := to_jsonb(NEW);
  rid uuid := (CASE WHEN TG_TABLE_NAME = 'branding_contrast_report' THEN n_row->>'id' ELSE n_row->>'report_id' END)::uuid;
  expected integer;
  n integer;
  top integer;
BEGIN
  SELECT r.pair_count INTO expected FROM branding_contrast_report r WHERE r.id = rid;
  SELECT count(*), coalesce(max(p.ordinal), 0) INTO n, top FROM branding_contrast_pair p WHERE p.report_id = rid;
  IF n <> expected OR top <> expected THEN
    RAISE EXCEPTION 'branding_contrast_report %: % pair(s) numbered up to %, expected exactly % numbered 1..%',
      rid, n, top, expected, expected
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'branding_contrast_report_pairs_complete';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER branding_contrast_report_pairs_complete AFTER INSERT ON branding_contrast_report
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION branding_contrast_report_pairs_complete();
CREATE CONSTRAINT TRIGGER branding_contrast_pair_report_complete AFTER INSERT ON branding_contrast_pair
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION branding_contrast_report_pairs_complete();
