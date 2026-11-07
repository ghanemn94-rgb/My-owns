-- 0126 P6 DG6 round-6 repair: the records a report section's aggregate figures include (T-DG6-BE-Z9; F-DG6-400;
-- ADR-0051 §2 "Totals and rollups"; D-195 Q3; ADR-0045 §3). Authored by backend-workflow-engineer. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
-- Id: the next above the highest shipped file on this branch (0125, D-196 item 2); the orchestrator renumbers at merge
-- if another task shipped a higher id first.
--
-- A report section whose figures are aggregates (the executive pack's `metrics_<subject>`, the executive dashboard's
-- `area_value`, the gate pack's unverified-evidence counts) references only its subject or its own rows, yet its
-- figures include the values of other records (the dashboard facts' benefits and business cases; the evidence items
-- counted). The read-time label "Includes restricted records" is decided from those records, per reader, when the
-- document leaves the API (apps/api reporting/reports/restricted.ts). A live report knows them from its assembly; a
-- stored snapshot keeps them here, beside its content, so the content and its contentSha256 are unchanged:
--   * report_snapshot_aggregate: one row per (snapshot, section, record) the section's aggregate includes. Written
--     only by the snapshot's creating transaction (report_snapshot_child_guard), append-only, INSERT and SELECT for
--     mth_app, like report_snapshot_source. It is NOT a source: it never names a row of the document, it is never
--     listed by GET …/sources, and the export refusal of D-199 (exports/jobs.ts, report_snapshot_source) does not read
--     it (an aggregate shows a value to every reader, D-195 Q3; it does not include the record).
--   * report_snapshot.aggregates_recorded boolean: true for every snapshot written from now on (the column default);
--     false for the snapshots stored before 0126, whose aggregates were not recorded. For those, the API decides the
--     label conservatively (restricted.ts `legacyAggregates`). Immutable after insert (report_snapshot_aggregates_
--     recorded_immutable), so no update can turn a recorded snapshot into a legacy one or the reverse.
-- No existing row changes except that every existing snapshot gets aggregates_recorded = false. Nothing here approves
-- anything (no business approval, G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE report_snapshot ADD COLUMN aggregates_recorded boolean NOT NULL DEFAULT false;
ALTER TABLE report_snapshot ALTER COLUMN aggregates_recorded SET DEFAULT true;

CREATE FUNCTION report_snapshot_aggregates_recorded_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.aggregates_recorded IS DISTINCT FROM OLD.aggregates_recorded THEN
    RAISE EXCEPTION 'report_snapshot: aggregates_recorded is set when the snapshot is created and never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_aggregates_recorded_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_snapshot_aggregates_recorded_immutable BEFORE UPDATE ON report_snapshot
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_aggregates_recorded_immutable();

CREATE TABLE report_snapshot_aggregate (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_id       uuid NOT NULL,
  section_key       text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  record_type       text NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  record_id         uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_snapshot_aggregate_snapshot_fkey FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_aggregate_key UNIQUE (snapshot_id, section_key, record_type, record_id)
);
CREATE TRIGGER report_snapshot_aggregate_guard BEFORE INSERT ON report_snapshot_aggregate
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_child_guard();
SELECT p2_attach_append_only('report_snapshot_aggregate');
SELECT p2_attach_guards('report_snapshot_aggregate', false);
GRANT SELECT, INSERT ON report_snapshot_aggregate TO mth_app;
