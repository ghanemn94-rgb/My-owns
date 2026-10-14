-- 0080 P5 slice F: report definitions, immutable report snapshots, structured owner updates (T-DG5-ARCH-04; ADR-0045;
-- REQ-S13-004, REQ-S13-007, REQ-S13-008, REQ-S13-010, REQ-S09-011, REQ-S10-013). Authored by solution-architect.
-- Contract: docs/architecture/data-dictionary.md ("P5 tables, slice F"). Runs as mth_owner inside one transaction
-- opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Additive: new tables, one work-item kind and one job schedule; no DG1-DG4 table, constraint or function changes.
-- A report snapshot is the assembled content of one report definition for one subject at one as-of instant, with the
-- record revisions, configuration and calculation versions and the evidence it used. Its content never changes after
-- the INSERT; only its status moves (generated -> issued | discarded; issued -> superseded by a reissue). Snapshots are
-- never deleted. Owner updates are the structured per-period updates the executive pack is generated from (M0185).
-- Nothing here grants, decides or records a business approval, and nothing reads or writes the engineering gates
-- DG0-DG7: a snapshot only records the approval state its sources had at the as-of instant.

-- -----------------------------------------------------------------------------------------------------------------
-- report_definition: the catalogue of generated outputs. The ten M0253 outputs ('generated_output') plus the S09-011
-- executive pack and the S10-013 meeting pack. formats are the export formats each output offers (ADR-0046 §1).
-- Read-only to mth_app; rows come from migrations.
CREATE TABLE report_definition (
  code                   text PRIMARY KEY CHECK (code IN ('charter', 'diagnostic', 'tom', 'business_cases', 'roadmap',
                           'registers', 'meeting_minutes', 'gate_pack', 'executive_dashboard', 'handover',
                           'executive_pack', 'meeting_pack')),
  ordinal                smallint NOT NULL CONSTRAINT report_definition_ordinal_key UNIQUE CHECK (ordinal BETWEEN 1 AND 99),
  output_kind            text NOT NULL CHECK (output_kind IN ('generated_output', 'executive_pack', 'meeting_pack')),
  subject_type           text NOT NULL CHECK (subject_type IN ('transformation', 'meeting', 'gate_instance', 'business_case', 'bau_handover')),
  needs_reporting_period boolean NOT NULL,
  formats                text[] NOT NULL CHECK (cardinality(formats) BETWEEN 1 AND 5
                           AND formats <@ ARRAY['pdf', 'docx', 'xlsx', 'pptx', 'csv']::text[]),
  label_en               text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 200),
  label_ar               text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 200),
  description_en         text NOT NULL CHECK (char_length(description_en) BETWEEN 1 AND 500),
  description_ar         text NOT NULL CHECK (char_length(description_ar) BETWEEN 1 AND 500),
  source_ref             text NOT NULL CHECK (source_ref ~ '^M[0-9]{4}$'),
  playbook_ref           text NULL CHECK (playbook_ref IS NULL OR playbook_ref ~ '^B[0-9]{4}( B[0-9]{4})*$')
);
GRANT SELECT ON report_definition TO mth_app;

-- The Arabic labels are provisional translations (not reviewed by a Mobily Arabic editor), as every DG1-DG4 seed.
INSERT INTO report_definition (code, ordinal, output_kind, subject_type, needs_reporting_period, formats, label_en, label_ar, description_en, description_ar, source_ref, playbook_ref) VALUES
  ('charter', 1, 'generated_output', 'transformation', false, ARRAY['pdf', 'docx'], 'Transformation charter', 'ميثاق التحول', 'The current charter, North Star, outcomes and guardrails of the transformation.', 'الميثاق الحالي والنجم الشمالي والنتائج والضوابط الاستراتيجية للتحول.', 'M0253', 'B0034'),
  ('diagnostic', 2, 'generated_output', 'transformation', false, ARRAY['pdf', 'docx', 'xlsx'], 'Current-state diagnostic', 'تشخيص الوضع الحالي', 'The diagnostic items, findings, baselines and value pools with their evidence.', 'بنود التشخيص والنتائج وخطوط الأساس ومجمّعات القيمة مع أدلتها.', 'M0253', 'B0030'),
  ('tom', 3, 'generated_output', 'transformation', false, ARRAY['pdf', 'docx', 'xlsx'], 'Target operating model', 'نموذج التشغيل المستهدف', 'The ten TOM dimensions, the canvas, the gaps and the design decisions.', 'أبعاد نموذج التشغيل العشرة واللوحة والفجوات وقرارات التصميم.', 'M0253', 'B0055 B0057'),
  ('business_cases', 4, 'generated_output', 'transformation', false, ARRAY['pdf', 'docx', 'xlsx'], 'Business cases', 'دراسات الجدوى', 'The business cases with their benefit formulas, values and validation states.', 'دراسات الجدوى مع معادلات المنافع وقيمها وحالات التحقق منها.', 'M0253', 'B0083'),
  ('roadmap', 5, 'generated_output', 'transformation', false, ARRAY['pdf', 'pptx', 'xlsx'], 'Wave roadmap', 'خارطة الطريق بالموجات', 'The waves, initiatives, milestones and dependencies of the roadmap.', 'الموجات والمبادرات والمعالم والاعتماديات في خارطة الطريق.', 'M0253', 'B0078 B0080'),
  ('registers', 6, 'generated_output', 'transformation', false, ARRAY['xlsx', 'csv', 'pdf'], 'Registers', 'السجلات', 'One register (RAID, benefits, KPIs, decisions, dependencies or actions) with the selected filters.', 'سجل واحد (المخاطر، المنافع، المؤشرات، القرارات، الاعتماديات أو الإجراءات) وفق عوامل التصفية المختارة.', 'M0253', 'B0122 B0127 B0129'),
  ('meeting_minutes', 7, 'generated_output', 'meeting', false, ARRAY['pdf', 'docx'], 'Meeting minutes', 'محضر الاجتماع', 'The minutes, attendance, decisions and actions of one meeting.', 'محضر اجتماع واحد والحضور والقرارات والإجراءات.', 'M0253', 'B0093'),
  ('gate_pack', 8, 'generated_output', 'gate_instance', false, ARRAY['pdf', 'pptx', 'docx'], 'Gate pack', 'حزمة البوابة', 'One product gate with its criteria, evidence and decision state.', 'بوابة منتج واحدة مع معاييرها وأدلتها وحالة قرارها.', 'M0253', 'B0023'),
  ('executive_dashboard', 9, 'generated_output', 'transformation', true, ARRAY['pdf', 'pptx', 'xlsx'], 'Executive transformation dashboard', 'لوحة التحول التنفيذية', 'The executive dashboard of one reporting period from the canonical metrics.', 'اللوحة التنفيذية لفترة تقارير واحدة من المقاييس المعتمدة.', 'M0253', 'B0094'),
  ('handover', 10, 'generated_output', 'bau_handover', false, ARRAY['pdf', 'docx'], 'BAU handover', 'التسليم إلى العمليات الاعتيادية', 'One BAU handover with its owners, controls, KPIs and evidence.', 'تسليم واحد إلى العمليات الاعتيادية مع ملاكه وضوابطه ومؤشراته وأدلته.', 'M0253', 'B0100'),
  ('executive_pack', 11, 'executive_pack', 'transformation', true, ARRAY['pdf', 'pptx', 'docx'], 'Executive pack', 'الحزمة التنفيذية', 'The submitted owner updates of one reporting period with the current canonical metrics.', 'تحديثات الملاك المقدّمة لفترة تقارير واحدة مع المقاييس المعتمدة الحالية.', 'M0185', 'B0093'),
  ('meeting_pack', 12, 'meeting_pack', 'meeting', false, ARRAY['pdf', 'pptx'], 'Meeting pack', 'حزمة الاجتماع', 'The printable pack of one meeting: agenda, linked decision briefs and asks.', 'الحزمة القابلة للطباعة لاجتماع واحد: جدول الأعمال وملخصات القرارات المرتبطة والطلبات.', 'M0212', 'B0093');

-- -----------------------------------------------------------------------------------------------------------------
-- report_snapshot: one assembled output (REQ-S13-007). content is the ADR-0045 §3 document model (validated by the
-- API against content_schema_version), content_sha256 the SHA-256 of its canonical JSON (computed by the API).
-- Columns from definition_code to unknown_value_count never change after the INSERT (report_snapshot_guard).
CREATE TABLE report_snapshot (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  definition_code         text NOT NULL REFERENCES report_definition (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_type            text NOT NULL CHECK (subject_type IN ('transformation', 'meeting', 'gate_instance', 'business_case', 'bau_handover')),
  subject_id              uuid NOT NULL,
  reporting_period_id     uuid NULL REFERENCES reporting_period (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  period_label            text NULL CHECK (period_label IS NULL OR char_length(period_label) BETWEEN 1 AND 32),
  period_start            date NULL,
  period_end              date NULL,
  parameters              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object' AND octet_length(parameters::text) <= 8192),
  as_of                   timestamptz NOT NULL,
  content_schema_version  smallint NOT NULL CHECK (content_schema_version = 1),
  content                 jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_sha256          char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  methodology_version_id  uuid NOT NULL REFERENCES methodology_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_state          text NOT NULL CHECK (approval_state IN ('approved', 'pending', 'not_submitted', 'changes_requested', 'rejected', 'mixed', 'not_applicable')),
  provisional_value_count integer NOT NULL CHECK (provisional_value_count >= 0),
  unknown_value_count     integer NOT NULL CHECK (unknown_value_count >= 0),
  series_id               uuid NOT NULL,
  reissue_of_id           uuid NULL REFERENCES report_snapshot (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reissue_reason          text NULL CHECK (reissue_reason IS NULL OR char_length(reissue_reason) BETWEEN 3 AND 1000),
  status                  text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'issued', 'superseded', 'discarded')),
  issue_version           integer NULL CHECK (issue_version IS NULL OR issue_version >= 1),
  issued_at               timestamptz NULL,
  issued_by               uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  issue_note              text NULL CHECK (issue_note IS NULL OR char_length(issue_note) BETWEEN 1 AND 1000),
  superseded_at           timestamptz NULL,
  superseded_by_id        uuid NULL REFERENCES report_snapshot (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  discarded_at            timestamptz NULL,
  discarded_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  discard_reason          text NULL CHECK (discard_reason IS NULL OR char_length(discard_reason) BETWEEN 3 AND 1000),
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT report_snapshot_series_issue_key UNIQUE (series_id, issue_version),
  CONSTRAINT report_snapshot_period_copy CHECK ((reporting_period_id IS NULL) = (period_label IS NULL)
    AND (reporting_period_id IS NULL) = (period_start IS NULL) AND (reporting_period_id IS NULL) = (period_end IS NULL)),
  CONSTRAINT report_snapshot_reissue_shape CHECK ((reissue_of_id IS NULL) = (reissue_reason IS NULL)
    AND (reissue_of_id IS NOT NULL OR series_id = id) AND (reissue_of_id IS NULL OR series_id <> id)),
  CONSTRAINT report_snapshot_subject_transformation CHECK (subject_type <> 'transformation' OR subject_id = transformation_id),
  CONSTRAINT report_snapshot_issue_complete CHECK ((status IN ('issued', 'superseded')) = (issue_version IS NOT NULL)
    AND (issue_version IS NULL) = (issued_at IS NULL) AND (issued_at IS NULL) = (issued_by IS NULL)
    AND (issue_note IS NULL OR issued_at IS NOT NULL)),
  CONSTRAINT report_snapshot_supersede_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)
    AND (superseded_at IS NULL) = (superseded_by_id IS NULL)),
  CONSTRAINT report_snapshot_discard_complete CHECK ((status = 'discarded') = (discarded_at IS NOT NULL)
    AND (discarded_at IS NULL) = (discarded_by IS NULL) AND (discarded_at IS NULL) = (discard_reason IS NULL))
);
-- At most one current issued snapshot per series (the reissue supersedes the previous one first; ADR-0045 §4).
CREATE UNIQUE INDEX report_snapshot_one_issued_key ON report_snapshot (series_id) WHERE status = 'issued';
CREATE INDEX report_snapshot_list_idx ON report_snapshot (transformation_id, definition_code, created_at DESC, id DESC);

CREATE FUNCTION report_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d report_definition%ROWTYPE;
  p reporting_period%ROWTYPE;
  prev report_snapshot%ROWTYPE;
  subject_ok boolean;
  next_issue integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'generated' THEN
      RAISE EXCEPTION 'report_snapshot: a snapshot is created as generated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_created_generated';
    END IF;
    SELECT * INTO d FROM report_definition WHERE code = NEW.definition_code;
    IF FOUND AND d.subject_type <> NEW.subject_type THEN
      RAISE EXCEPTION 'report_snapshot: % reports on a %, not a %', d.code, d.subject_type, NEW.subject_type
        USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_subject_type';
    END IF;
    IF FOUND AND d.needs_reporting_period <> (NEW.reporting_period_id IS NOT NULL) THEN
      RAISE EXCEPTION 'report_snapshot: % % a reporting period', d.code,
        CASE WHEN d.needs_reporting_period THEN 'needs' ELSE 'takes no' END
        USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_period_required';
    END IF;
    IF NEW.reporting_period_id IS NOT NULL THEN
      SELECT * INTO p FROM reporting_period WHERE id = NEW.reporting_period_id;
      IF FOUND AND (p.organization_id <> NEW.organization_id OR p.period_label <> NEW.period_label
                    OR p.period_start <> NEW.period_start OR p.period_end <> NEW.period_end) THEN
        RAISE EXCEPTION 'report_snapshot: the period copy must equal the organization''s reporting period'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_period_matches';
      END IF;
    END IF;
    IF NEW.subject_type <> 'transformation' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.subject_type)
        INTO subject_ok USING NEW.subject_id, NEW.transformation_id;
      IF NOT subject_ok THEN
        RAISE EXCEPTION 'report_snapshot: % % does not exist in transformation %', NEW.subject_type, NEW.subject_id, NEW.transformation_id
          USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'report_snapshot_subject_ref';
      END IF;
    END IF;
    IF NEW.reissue_of_id IS NOT NULL THEN
      SELECT * INTO prev FROM report_snapshot WHERE id = NEW.reissue_of_id;
      IF FOUND AND (prev.status <> 'issued' OR prev.definition_code <> NEW.definition_code
                    OR prev.transformation_id <> NEW.transformation_id OR prev.subject_id <> NEW.subject_id
                    OR prev.reporting_period_id IS DISTINCT FROM NEW.reporting_period_id
                    OR prev.series_id <> NEW.series_id) THEN
        RAISE EXCEPTION 'report_snapshot: a reissue continues the series of the current issued snapshot of the same output, subject and period'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_reissue_of_issued';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: the content and its context never change (REQ-S13-007 "issued snapshots are immutable").
  IF (NEW.definition_code, NEW.subject_type, NEW.subject_id, NEW.reporting_period_id, NEW.period_label,
      NEW.period_start, NEW.period_end, NEW.parameters, NEW.as_of, NEW.content_schema_version, NEW.content,
      NEW.content_sha256, NEW.methodology_version_id, NEW.approval_state, NEW.provisional_value_count,
      NEW.unknown_value_count, NEW.series_id, NEW.reissue_of_id, NEW.reissue_reason)
     IS DISTINCT FROM
     (OLD.definition_code, OLD.subject_type, OLD.subject_id, OLD.reporting_period_id, OLD.period_label,
      OLD.period_start, OLD.period_end, OLD.parameters, OLD.as_of, OLD.content_schema_version, OLD.content,
      OLD.content_sha256, OLD.methodology_version_id, OLD.approval_state, OLD.provisional_value_count,
      OLD.unknown_value_count, OLD.series_id, OLD.reissue_of_id, OLD.reissue_reason) THEN
    RAISE EXCEPTION 'report_snapshot: the content, as-of, period, versions and series of a snapshot never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_content_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'generated' AND NEW.status IN ('issued', 'discarded'))
            OR (OLD.status = 'issued' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'report_snapshot: % -> % is not a snapshot transition', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_transition';
    END IF;
    IF NEW.status = 'issued' THEN
      SELECT coalesce(max(s.issue_version), 0) + 1 INTO next_issue FROM report_snapshot s
       WHERE s.series_id = NEW.series_id AND s.id <> NEW.id AND s.issue_version IS NOT NULL;
      IF NEW.issue_version IS DISTINCT FROM next_issue THEN
        RAISE EXCEPTION 'report_snapshot: the issue version must be % (the next of its series)', next_issue
          USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_issue_next';
      END IF;
    END IF;
  ELSIF (NEW.issue_version, NEW.issued_at, NEW.issued_by, NEW.issue_note, NEW.superseded_at, NEW.superseded_by_id,
         NEW.discarded_at, NEW.discarded_by, NEW.discard_reason)
        IS DISTINCT FROM
        (OLD.issue_version, OLD.issued_at, OLD.issued_by, OLD.issue_note, OLD.superseded_at, OLD.superseded_by_id,
         OLD.discarded_at, OLD.discarded_by, OLD.discard_reason) THEN
    RAISE EXCEPTION 'report_snapshot: issue, supersede and discard stamps change only with their transition'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_stamps_frozen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_snapshot_guard BEFORE INSERT OR UPDATE ON report_snapshot
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_guard();

-- At COMMIT: a superseded snapshot names the issued snapshot of its own series with a higher issue version that
-- replaced it (a reissue supersedes, nothing else does).
CREATE FUNCTION report_snapshot_supersede_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'superseded' AND NOT EXISTS (
    SELECT 1 FROM report_snapshot r
     WHERE r.id = NEW.superseded_by_id AND r.series_id = NEW.series_id AND r.status IN ('issued', 'superseded')
       AND r.issue_version > NEW.issue_version) THEN
    RAISE EXCEPTION 'report_snapshot: % is superseded only by a later issued snapshot of its series', NEW.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'report_snapshot_superseded_by_issued';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER report_snapshot_supersede_check AFTER INSERT OR UPDATE ON report_snapshot
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION report_snapshot_supersede_check();
SELECT p2_attach_guards('report_snapshot', true);
GRANT SELECT, INSERT, UPDATE ON report_snapshot TO mth_app;

-- The children below are written only in the transaction that created their snapshot (created_at = now(), the
-- transaction timestamp), so a snapshot's captured sources, versions and evidence can never grow or change later.
-- They are append-only and carry no audit event of their own: the snapshot's report_snapshot.generate event covers
-- them (the job_run / processed_message precedent for derived rows; ADR-0045 §3).
CREATE FUNCTION report_snapshot_child_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  s report_snapshot%ROWTYPE;
BEGIN
  SELECT * INTO s FROM report_snapshot WHERE id = NEW.snapshot_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF s.transformation_id <> NEW.transformation_id OR s.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION '%: a child row belongs to its snapshot''s transformation', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_same_transformation';
  END IF;
  IF s.status <> 'generated' OR s.created_at <> now() THEN
    RAISE EXCEPTION '%: rows are written only in the transaction that creates the snapshot', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_creation_only';
  END IF;
  RETURN NEW;
END $$;

-- report_snapshot_source: the revision of every source record the snapshot used (REQ-S13-007 "source record
-- revisions"), with its approval state at the as-of instant where the record has one.
CREATE TABLE report_snapshot_source (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_id       uuid NOT NULL,
  section_key       text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  record_type       text NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  record_id         uuid NOT NULL,
  record_version    integer NOT NULL CHECK (record_version >= 1),
  record_updated_at timestamptz NULL,
  approval_state    text NULL CHECK (approval_state IS NULL OR approval_state IN ('approved', 'pending', 'not_submitted', 'changes_requested', 'rejected', 'not_applicable')),
  validation_state  text NOT NULL CHECK (validation_state IN ('validated', 'provisional', 'unknown', 'stale', 'not_applicable')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_snapshot_source_snapshot_fkey FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_source_record_key UNIQUE (snapshot_id, record_type, record_id)
);
CREATE TRIGGER report_snapshot_source_guard BEFORE INSERT ON report_snapshot_source
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_child_guard();
SELECT p2_attach_append_only('report_snapshot_source');
SELECT p2_attach_guards('report_snapshot_source', false);
GRANT SELECT, INSERT ON report_snapshot_source TO mth_app;

-- report_snapshot_version: the configuration and calculation versions the snapshot used (REQ-S13-007 "methodology
-- version, calculation versions"). The pinned methodology version is also on the snapshot itself.
CREATE TABLE report_snapshot_version (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_id       uuid NOT NULL,
  version_kind      text NOT NULL CHECK (version_kind IN ('methodology_version', 'config_version', 'kpi_version', 'formula_version', 'weight_set', 'calculation_engine', 'scoring_scheme')),
  reference_id      uuid NULL,
  reference_key     text NOT NULL CHECK (char_length(reference_key) BETWEEN 1 AND 120),
  version_label     text NOT NULL CHECK (char_length(version_label) BETWEEN 1 AND 64),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_snapshot_version_snapshot_fkey FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_version_key UNIQUE (snapshot_id, version_kind, reference_key)
);
CREATE TRIGGER report_snapshot_version_guard BEFORE INSERT ON report_snapshot_version
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_child_guard();
SELECT p2_attach_append_only('report_snapshot_version');
SELECT p2_attach_guards('report_snapshot_version', false);
GRANT SELECT, INSERT ON report_snapshot_version TO mth_app;

-- report_snapshot_evidence: the evidence items a snapshot cites, with the content revision, checksum and review
-- status they had at the as-of instant (REQ-S13-010 "export/report linkage"). A note or link has no content.
CREATE TABLE report_snapshot_evidence (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_id       uuid NOT NULL,
  section_key       text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  evidence_id       uuid NOT NULL,
  content_id        uuid NULL,
  content_revision  integer NULL CHECK (content_revision IS NULL OR content_revision >= 1),
  content_sha256    char(64) NULL CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  review_status     text NOT NULL CHECK (review_status IN ('unverified', 'verified', 'rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_snapshot_evidence_snapshot_fkey FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_evidence_evidence_fkey FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_evidence_content_fkey FOREIGN KEY (evidence_id, content_id) REFERENCES evidence_content (evidence_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT report_snapshot_evidence_key UNIQUE (snapshot_id, section_key, evidence_id),
  CONSTRAINT report_snapshot_evidence_content_shape CHECK ((content_id IS NULL) = (content_revision IS NULL)
    AND (content_id IS NULL) = (content_sha256 IS NULL))
);
CREATE FUNCTION report_snapshot_evidence_content_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.content_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM evidence_content c
     WHERE c.id = NEW.content_id AND c.revision = NEW.content_revision AND c.sha256 = NEW.content_sha256) THEN
    RAISE EXCEPTION 'report_snapshot_evidence: the revision and checksum must be those of the cited content'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'report_snapshot_evidence_content_matches';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_snapshot_evidence_guard BEFORE INSERT ON report_snapshot_evidence
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_child_guard();
CREATE TRIGGER report_snapshot_evidence_content BEFORE INSERT ON report_snapshot_evidence
  FOR EACH ROW EXECUTE FUNCTION report_snapshot_evidence_content_check();
SELECT p2_attach_append_only('report_snapshot_evidence');
SELECT p2_attach_guards('report_snapshot_evidence', false);
GRANT SELECT, INSERT ON report_snapshot_evidence TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- owner_update: one structured update per subject (the transformation or one workstream) and reporting period
-- (REQ-S09-011, M0185: "achievements, next steps, milestones, outcomes, adoption, risks, dependencies and asks").
-- Written only while its reporting period is open. A submission copies the eight fields into owner_update_revision.
CREATE TABLE owner_update (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  subject_type        text NOT NULL CHECK (subject_type IN ('transformation', 'workstream')),
  subject_id          uuid NOT NULL,
  reporting_period_id uuid NOT NULL REFERENCES reporting_period (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_user_id       uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  achievements        text NULL CHECK (achievements IS NULL OR char_length(achievements) BETWEEN 1 AND 2000),
  next_steps          text NULL CHECK (next_steps IS NULL OR char_length(next_steps) BETWEEN 1 AND 2000),
  milestones          text NULL CHECK (milestones IS NULL OR char_length(milestones) BETWEEN 1 AND 2000),
  outcomes            text NULL CHECK (outcomes IS NULL OR char_length(outcomes) BETWEEN 1 AND 2000),
  adoption            text NULL CHECK (adoption IS NULL OR char_length(adoption) BETWEEN 1 AND 2000),
  risks               text NULL CHECK (risks IS NULL OR char_length(risks) BETWEEN 1 AND 2000),
  dependencies        text NULL CHECK (dependencies IS NULL OR char_length(dependencies) BETWEEN 1 AND 2000),
  asks                text NULL CHECK (asks IS NULL OR char_length(asks) BETWEEN 1 AND 2000),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  revision_no         integer NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  submitted_at        timestamptz NULL,
  submitted_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reopen_reason       text NULL CHECK (reopen_reason IS NULL OR char_length(reopen_reason) BETWEEN 3 AND 1000),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT owner_update_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT owner_update_subject_period_key UNIQUE (transformation_id, subject_type, subject_id, reporting_period_id),
  CONSTRAINT owner_update_subject_transformation CHECK (subject_type <> 'transformation' OR subject_id = transformation_id),
  CONSTRAINT owner_update_submit_complete CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)
    AND (submitted_at IS NULL) = (submitted_by IS NULL) AND (status = 'draft' OR revision_no >= 1)),
  CONSTRAINT owner_update_submitted_has_content CHECK (status = 'draft' OR num_nonnulls(achievements, next_steps,
    milestones, outcomes, adoption, risks, dependencies, asks) >= 1)
);
CREATE INDEX owner_update_period_idx ON owner_update (reporting_period_id, transformation_id);

CREATE FUNCTION owner_update_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  p reporting_period%ROWTYPE;
BEGIN
  SELECT * INTO p FROM reporting_period WHERE id = NEW.reporting_period_id;
  IF FOUND AND p.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'owner_update: the reporting period belongs to another organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_period_organization';
  END IF;
  IF FOUND AND p.status <> 'open' THEN
    RAISE EXCEPTION 'owner_update: updates are written only while their reporting period is open (it is %)', p.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_period_open';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.revision_no <> 0 OR NEW.reopen_reason IS NOT NULL THEN
      RAISE EXCEPTION 'owner_update: an update is created as a draft with no revision'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_created_draft';
    END IF;
    IF NEW.subject_type = 'workstream' AND NOT EXISTS (
      SELECT 1 FROM workstream w WHERE w.id = NEW.subject_id AND w.transformation_id = NEW.transformation_id) THEN
      RAISE EXCEPTION 'owner_update: workstream % does not exist in transformation %', NEW.subject_id, NEW.transformation_id
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'owner_update_subject_ref';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.subject_type, NEW.subject_id, NEW.reporting_period_id) IS DISTINCT FROM
     (OLD.subject_type, OLD.subject_id, OLD.reporting_period_id) THEN
    RAISE EXCEPTION 'owner_update: the subject and the period never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_identity_immutable';
  END IF;
  IF OLD.status = 'submitted' AND NEW.status = 'submitted' THEN
    RAISE EXCEPTION 'owner_update: a submitted update changes only by reopening it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_submitted_frozen';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.revision_no <> OLD.revision_no + 1 THEN
    RAISE EXCEPTION 'owner_update: each submission is the next revision'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_revision_step';
  END IF;
  IF NOT (OLD.status = 'draft' AND NEW.status = 'submitted') AND NEW.revision_no <> OLD.revision_no THEN
    RAISE EXCEPTION 'owner_update: the revision number moves only on submission'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_revision_step';
  END IF;
  IF OLD.status = 'submitted' AND NEW.status = 'draft' AND NEW.reopen_reason IS NULL THEN
    RAISE EXCEPTION 'owner_update: reopening a submitted update needs a reason'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'owner_update_reopen_reason';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER owner_update_guard BEFORE INSERT OR UPDATE ON owner_update
  FOR EACH ROW EXECUTE FUNCTION owner_update_guard();
-- At COMMIT: a submitted update has the revision row of its current revision with the same eight fields.
CREATE FUNCTION owner_update_revision_present() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'submitted' AND NOT EXISTS (
    SELECT 1 FROM owner_update_revision r
     WHERE r.owner_update_id = NEW.id AND r.revision_no = NEW.revision_no
       AND (r.achievements, r.next_steps, r.milestones, r.outcomes, r.adoption, r.risks, r.dependencies, r.asks)
           IS NOT DISTINCT FROM
           (NEW.achievements, NEW.next_steps, NEW.milestones, NEW.outcomes, NEW.adoption, NEW.risks, NEW.dependencies, NEW.asks)) THEN
    RAISE EXCEPTION 'owner_update: submitted revision % of % has no matching revision row', NEW.revision_no, NEW.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'owner_update_revision_present';
  END IF;
  RETURN NULL;
END $$;
SELECT p2_attach_guards('owner_update', true);
GRANT SELECT, INSERT, UPDATE ON owner_update TO mth_app;

-- owner_update_revision: the submitted text of each revision (append-only history; the executive pack cites the
-- revision it used). Covered by the owner_update.submit audit event.
CREATE TABLE owner_update_revision (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_update_id   uuid NOT NULL,
  revision_no       integer NOT NULL CHECK (revision_no >= 1),
  achievements      text NULL CHECK (achievements IS NULL OR char_length(achievements) BETWEEN 1 AND 2000),
  next_steps        text NULL CHECK (next_steps IS NULL OR char_length(next_steps) BETWEEN 1 AND 2000),
  milestones        text NULL CHECK (milestones IS NULL OR char_length(milestones) BETWEEN 1 AND 2000),
  outcomes          text NULL CHECK (outcomes IS NULL OR char_length(outcomes) BETWEEN 1 AND 2000),
  adoption          text NULL CHECK (adoption IS NULL OR char_length(adoption) BETWEEN 1 AND 2000),
  risks             text NULL CHECK (risks IS NULL OR char_length(risks) BETWEEN 1 AND 2000),
  dependencies      text NULL CHECK (dependencies IS NULL OR char_length(dependencies) BETWEEN 1 AND 2000),
  asks              text NULL CHECK (asks IS NULL OR char_length(asks) BETWEEN 1 AND 2000),
  submitted_at      timestamptz NOT NULL,
  submitted_by      uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_update_revision_update_fkey FOREIGN KEY (transformation_id, owner_update_id) REFERENCES owner_update (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT owner_update_revision_key UNIQUE (owner_update_id, revision_no),
  CONSTRAINT owner_update_revision_has_content CHECK (num_nonnulls(achievements, next_steps, milestones, outcomes,
    adoption, risks, dependencies, asks) >= 1)
);
SELECT p2_attach_append_only('owner_update_revision');
SELECT p2_attach_guards('owner_update_revision', false);
GRANT SELECT, INSERT ON owner_update_revision TO mth_app;
CREATE CONSTRAINT TRIGGER owner_update_revision_present AFTER INSERT OR UPDATE ON owner_update
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owner_update_revision_present();

-- -----------------------------------------------------------------------------------------------------------------
-- The owner-update task (REQ-S09-011 automation "Reporting period opens -> update tasks"): one My Work item per open
-- monthly reporting period, subject and owner, created by the daily job below (exactly once through the work_item
-- dedupe key; ADR-0045 §6). Monthly is the Executive SteerCo cadence of B0093.
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref, urgency) VALUES
  ('owner_update_due', 'reporting', 'Structured update due for the reporting period', 'تحديث منظَّم مستحق لفترة التقارير', 'M0185', 'normal');

INSERT INTO job_schedule (id, code, queue_name, cron, timezone, description_en, description_ar, owner_module) VALUES
  ('01920005-0080-7000-8000-000000000001', 'reports.owner_update_tasks', 'reports.owner_update_tasks', '40 0 * * *', 'Asia/Riyadh', 'Create one structured-update task per open monthly reporting period, subject and owner (REQ-S09-011).', 'إنشاء مهمة تحديث منظَّم واحدة لكل فترة تقارير شهرية مفتوحة وموضوع ومالك.', 'reporting');
INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
SELECT mth_uuid_v7(), 'system', 'job_schedule.create', 'job_schedule', s.id, 1, 'migration'
  FROM job_schedule s WHERE s.code = 'reports.owner_update_tasks';
