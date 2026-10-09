-- 0044 P4 slice D: the transformation operating system (five forum layers seeded verbatim from B0093), per-transformation
-- forums with configurable participants, quorum, cut-off and agenda rules, meeting series with a recurrence rule
-- (future-only regeneration), meetings, agenda items (with the executive-ask brief), attendance, minutes (immutable once
-- published), meeting outputs linked to canonical records, and meeting action links
-- (T-DG4-ARCH-05; ADR-0032; REQ-PB-060, REQ-PB-061, REQ-PB-068, REQ-S10-005, REQ-S10-011, REQ-S16-019).
-- Authored by solution-architect. Contract: docs/architecture/data-dictionary.md ("P4 tables, slice D").
-- Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged.
-- SQL floor: PostgreSQL 16. Nothing here approves anything, and nothing touches DG0-DG7.

-- The closed set of meeting output kinds: the "Outputs" column of B0093, one code per named output.
CREATE FUNCTION p4_meeting_output_kinds_valid(p_kinds text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_kinds <@ ARRAY['decision', 'unblocker', 'benefit_view', 'integrated_status', 'decision_log', 'milestone',
                          'action', 'raid', 'test', 'evidence', 'recommendation', 'benefit_evidence', 'forecast',
                          'corrective_action']::text[]
$$;

-- -----------------------------------------------------------------------------------------------------------------
-- forum_template: the five operating-system layers of B0093, verbatim (Layer, Cadence, Purpose, Participants, Outputs),
-- read-only. Arabic is PROVISIONAL (ar_provisional = true) until a Mobily reviewer confirms it. The default recurrence
-- is the platform's reading of the Cadence text (ADR-0032 §1); the Cadence text itself stays verbatim.
CREATE TABLE forum_template (
  key                         text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  ordinal                     smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 99),
  source_layer_en             text NOT NULL,
  source_cadence_en           text NOT NULL,
  source_purpose_en           text NOT NULL,
  source_participants_en      text NOT NULL,
  source_outputs_en           text NOT NULL,
  layer_ar                    text NOT NULL,
  cadence_ar                  text NOT NULL,
  purpose_ar                  text NOT NULL,
  participants_ar             text NOT NULL,
  outputs_ar                  text NOT NULL,
  ar_provisional              boolean NOT NULL DEFAULT true,
  chair_party_code            text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participant_parties         text[] NOT NULL CHECK (p4_parties_known(participant_parties)),
  output_kinds                text[] NOT NULL CHECK (cardinality(output_kinds) >= 1 AND p4_meeting_output_kinds_valid(output_kinds)),
  publish_requires_any_output text[] NOT NULL DEFAULT '{}' CHECK (publish_requires_any_output <@ output_kinds),
  executive_asks_only         boolean NOT NULL,
  default_frequency           text NOT NULL CHECK (default_frequency IN ('daily', 'weekly', 'monthly')),
  default_interval            smallint NOT NULL CHECK (default_interval BETWEEN 1 AND 12),
  source_ref                  text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 50),
  CONSTRAINT forum_template_ordinal_key UNIQUE (ordinal)
);
GRANT SELECT ON forum_template TO mth_app;
INSERT INTO forum_template (key, ordinal, source_layer_en, source_cadence_en, source_purpose_en, source_participants_en, source_outputs_en, layer_ar, cadence_ar, purpose_ar, participants_ar, outputs_ar, chair_party_code, participant_parties, output_kinds, publish_requires_any_output, executive_asks_only, default_frequency, default_interval, source_ref) VALUES
  ('executive_steerco', 1, 'Executive SteerCo', 'Monthly', 'Outcomes, major trade-offs, funding, escalation', 'Sponsor + CxOs + Transformation Lead', 'Decisions, unblockers, benefit view',
   'اللجنة التوجيهية التنفيذية', 'شهريًا', 'النتائج والمفاضلات الرئيسية والتمويل والتصعيد', 'الراعي + كبار التنفيذيين + قائد التحول', 'القرارات وإزالة العوائق ورؤية المنافع',
   'SP', ARRAY['SP', 'TL'], ARRAY['decision', 'unblocker', 'benefit_view'], '{}', true, 'monthly', 1, 'B0093;M0191'),
  ('transformation_review', 2, 'Transformation Review', 'Bi-weekly', 'Portfolio health, dependencies, risks, decisions', 'Transformation Lead + workstream leads', 'Integrated status, decision log',
   'مراجعة التحول', 'كل أسبوعين', 'سلامة المحفظة والاعتماديات والمخاطر والقرارات', 'قائد التحول + قادة مسارات العمل', 'الحالة المتكاملة وسجل القرارات',
   'TL', ARRAY['TL', 'WL'], ARRAY['integrated_status', 'decision_log'], '{}', false, 'weekly', 2, 'B0093;M0192'),
  ('workstream_review', 3, 'Workstream Review', 'Weekly', 'Delivery, issues, actions', 'Workstream lead + team', 'Milestones, actions, RAID',
   'مراجعة مسار العمل', 'أسبوعيًا', 'التسليم والقضايا والإجراءات', 'قائد مسار العمل + الفريق', 'المعالم والإجراءات وسجل المخاطر',
   'WL', ARRAY['WL'], ARRAY['milestone', 'action', 'raid'], '{}', false, 'weekly', 1, 'B0093;M0193'),
  ('rapid_response', 4, 'Rapid Response / Sprint', 'Daily / 2-3x week', 'Solve high-priority cross-functional issue', 'Small empowered team', 'Test, evidence, recommendation',
   'الاستجابة السريعة / السباق', 'يوميًا / 2-3 مرات أسبوعيًا', 'حل قضية متعددة الوظائف عالية الأولوية', 'فريق صغير مُمكَّن', 'الاختبار والدليل والتوصية',
   'TL', ARRAY[]::text[], ARRAY['test', 'evidence', 'recommendation'], '{}', false, 'daily', 1, 'B0093;M0194'),
  ('value_review', 5, 'Value Review', 'Monthly', 'Validate realized benefits vs plan', 'Finance + benefit owners', 'Benefit evidence, forecast, corrective action',
   'مراجعة القيمة', 'شهريًا', 'التحقق من المنافع المحققة مقابل الخطة', 'المالية + مالكو المنافع', 'دليل المنافع والتوقعات والإجراء التصحيحي',
   'FIN', ARRAY['FIN', 'BUSINESS_OWNERS'], ARRAY['benefit_evidence', 'forecast', 'corrective_action'], ARRAY['benefit_evidence', 'forecast'], false, 'monthly', 1, 'B0093;M0195');

-- -----------------------------------------------------------------------------------------------------------------
-- forum: one governance forum of a transformation (REQ-PB-060, REQ-S10-005). The five layers are copied from the template
-- at instantiation; teams edit their copy (participants, quorum, cut-off, agenda rules) and may add forums. The source
-- texts stay on the template; the copy's labels are editable configuration.
CREATE TABLE forum (
  id                          uuid PRIMARY KEY,
  organization_id             uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id           uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  template_key                text NULL REFERENCES forum_template (key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ordinal                     smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  name_en                     text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 200),
  name_ar                     text NOT NULL CHECK (char_length(name_ar) BETWEEN 1 AND 200),
  cadence_label               text NOT NULL CHECK (char_length(cadence_label) BETWEEN 1 AND 200),
  purpose                     text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 2000),
  participants_label          text NOT NULL CHECK (char_length(participants_label) BETWEEN 1 AND 500),
  outputs_label               text NOT NULL CHECK (char_length(outputs_label) BETWEEN 1 AND 500),
  chair_party_code            text NULL REFERENCES governance_party (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  secretary_user_id           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participant_parties         text[] NOT NULL DEFAULT '{}' CONSTRAINT forum_participant_parties_known CHECK (p4_parties_known(participant_parties)),
  output_kinds                text[] NOT NULL CONSTRAINT forum_output_kinds_valid CHECK (cardinality(output_kinds) >= 1 AND p4_meeting_output_kinds_valid(output_kinds)),
  publish_requires_any_output text[] NOT NULL DEFAULT '{}' CONSTRAINT forum_publish_outputs_subset CHECK (publish_requires_any_output <@ output_kinds),
  executive_asks_only         boolean NOT NULL DEFAULT false,
  quorum_min                  smallint NULL CHECK (quorum_min IS NULL OR quorum_min BETWEEN 1 AND 100),
  cutoff_working_days         smallint NOT NULL DEFAULT 2 CHECK (cutoff_working_days BETWEEN 0 AND 20),
  agenda_max_items            smallint NULL CHECK (agenda_max_items IS NULL OR agenda_max_items BETWEEN 1 AND 50),
  late_items_rule             text NOT NULL DEFAULT 'flag' CHECK (late_items_rule IN ('flag', 'refuse')),
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version                     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT forum_transformation_id_id_key UNIQUE (transformation_id, id)
);
-- One copy of each template layer per transformation (the instantiation is idempotent).
CREATE UNIQUE INDEX forum_template_key ON forum (transformation_id, template_key) WHERE template_key IS NOT NULL;
CREATE INDEX forum_transformation_ordinal_idx ON forum (transformation_id, ordinal, id);
CREATE FUNCTION forum_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.template_key IS DISTINCT FROM OLD.template_key THEN
    RAISE EXCEPTION 'forum %: the template key is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'forum_template_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'archived' THEN
    RAISE EXCEPTION 'forum %: an archived forum is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'forum_archived_final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER forum_guard BEFORE INSERT OR UPDATE ON forum FOR EACH ROW EXECUTE FUNCTION forum_guard();
SELECT p2_attach_guards('forum', true);
GRANT SELECT, INSERT, UPDATE ON forum TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- forum_participant: named participants of a forum (a person or a governed group), beside the party list on the forum
-- (REQ-S10-005 "participants"). counts_for_quorum marks the voting members. Removal is a status change, never a DELETE.
CREATE TABLE forum_participant (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  forum_id          uuid NOT NULL,
  user_id           uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  group_id          uuid NULL REFERENCES access_group (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  counts_for_quorum boolean NOT NULL DEFAULT true,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at        timestamptz NULL,
  removed_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT forum_participant_forum_id_fkey FOREIGN KEY (transformation_id, forum_id) REFERENCES forum (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT forum_participant_one_target CHECK ((user_id IS NULL) <> (group_id IS NULL)),
  CONSTRAINT forum_participant_removed_complete CHECK ((status = 'removed') = (removed_at IS NOT NULL) AND (removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX forum_participant_active_user_key ON forum_participant (forum_id, user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX forum_participant_active_group_key ON forum_participant (forum_id, group_id) WHERE status = 'active' AND group_id IS NOT NULL;
CREATE FUNCTION forum_participant_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'removed' THEN
      RAISE EXCEPTION 'forum_participant %: a removed participant is final', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'forum_participant_removed_final';
    END IF;
    IF NEW.forum_id IS DISTINCT FROM OLD.forum_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
      RAISE EXCEPTION 'forum_participant %: forum and participant are immutable', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'forum_participant_identity';
    END IF;
  ELSIF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'forum_participant: a new participant is active'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'forum_participant_starts_active';
  END IF;
  IF NEW.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM access_group g WHERE g.id = NEW.group_id AND g.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'forum_participant: the group belongs to another organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'forum_participant_same_org';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER forum_participant_guard BEFORE INSERT OR UPDATE ON forum_participant FOR EACH ROW EXECUTE FUNCTION forum_participant_guard();
SELECT p2_attach_guards('forum_participant', true);
GRANT SELECT, INSERT, UPDATE ON forum_participant TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- meeting_series: the configured recurrence of a forum (REQ-PB-060 "a forum meeting series generates meetings on the
-- configured recurrence"; REQ-S10-005). At most one active series per forum. Every change to a recurrence field steps
-- rule_version by exactly 1 (trigger), so each generated meeting names the rule it came from.
CREATE TABLE meeting_series (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id     uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  forum_id              uuid NOT NULL,
  frequency             text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  interval_count        smallint NOT NULL CHECK (interval_count BETWEEN 1 AND 12),
  weekdays              smallint[] NULL,
  month_day             smallint NULL CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 28),
  start_date            date NOT NULL,
  end_date              date NULL,
  start_time            time NOT NULL,
  duration_minutes      smallint NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  timezone              text NOT NULL DEFAULT 'Asia/Riyadh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  non_working_day_rule  text NOT NULL DEFAULT 'next_working_day' CHECK (non_working_day_rule IN ('next_working_day', 'skip', 'keep')),
  horizon_days          smallint NOT NULL DEFAULT 90 CHECK (horizon_days BETWEEN 7 AND 366),
  location              text NULL CHECK (location IS NULL OR char_length(location) BETWEEN 1 AND 300),
  rule_version          integer NOT NULL DEFAULT 1 CHECK (rule_version >= 1),
  generated_through     date NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  ended_at              timestamptz NULL,
  ended_by              uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_series_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT meeting_series_forum_id_fkey FOREIGN KEY (transformation_id, forum_id) REFERENCES forum (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- weekly needs 1-7 distinct ISO weekdays (1 = Monday ... 7 = Sunday); monthly needs a day of month; daily takes neither.
  CONSTRAINT meeting_series_rule_shape CHECK (
    (frequency = 'weekly' AND weekdays IS NOT NULL AND p4_valid_workweek(weekdays) AND month_day IS NULL)
    OR (frequency = 'monthly' AND weekdays IS NULL AND month_day IS NOT NULL)
    OR (frequency = 'daily' AND weekdays IS NULL AND month_day IS NULL)),
  CONSTRAINT meeting_series_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT meeting_series_ended_complete CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX meeting_series_one_active_key ON meeting_series (forum_id) WHERE status = 'active';
CREATE TRIGGER meeting_series_timezone_known BEFORE INSERT OR UPDATE OF timezone ON meeting_series
  FOR EACH ROW EXECUTE FUNCTION p4_timezone_known();
CREATE FUNCTION meeting_series_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  rule_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.rule_version <> 1 THEN
      RAISE EXCEPTION 'meeting_series: a new series is active at rule version 1'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_starts_active';
    END IF;
    IF NEW.created_by IS NULL OR NEW.updated_by IS NULL THEN
      RAISE EXCEPTION 'meeting_series: a series is created by a person'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_author_required';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'ended' THEN
    RAISE EXCEPTION 'meeting_series %: an ended series is final', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_ended_final';
  END IF;
  IF NEW.forum_id IS DISTINCT FROM OLD.forum_id THEN
    RAISE EXCEPTION 'meeting_series %: the forum is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_forum_immutable';
  END IF;
  rule_changed := (NEW.frequency, NEW.interval_count, NEW.weekdays, NEW.month_day, NEW.start_date, NEW.end_date,
                   NEW.start_time, NEW.duration_minutes, NEW.timezone, NEW.non_working_day_rule)
                  IS DISTINCT FROM
                  (OLD.frequency, OLD.interval_count, OLD.weekdays, OLD.month_day, OLD.start_date, OLD.end_date,
                   OLD.start_time, OLD.duration_minutes, OLD.timezone, OLD.non_working_day_rule);
  IF rule_changed AND NEW.rule_version IS DISTINCT FROM OLD.rule_version + 1 THEN
    RAISE EXCEPTION 'meeting_series %: a recurrence change steps rule_version by exactly 1', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_rule_version_step';
  END IF;
  IF NOT rule_changed AND NEW.rule_version IS DISTINCT FROM OLD.rule_version THEN
    RAISE EXCEPTION 'meeting_series %: rule_version changes only with the recurrence', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_rule_version_step';
  END IF;
  -- A person changes the recurrence; the generation job (actor service) only advances generated_through.
  IF rule_changed AND NEW.updated_by IS NULL THEN
    RAISE EXCEPTION 'meeting_series %: a recurrence change is made by a person', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_series_author_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_series_guard BEFORE INSERT OR UPDATE ON meeting_series FOR EACH ROW EXECUTE FUNCTION meeting_series_guard();
SELECT p2_attach_guards('meeting_series', true);
GRANT SELECT, INSERT, UPDATE ON meeting_series TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- meeting: one forum meeting (REQ-S10-011, REQ-S16-019 "Meeting"). Generated from a series by the worker
-- (created_source 'worker', created_by NULL; the audit actor is the service) or created ad hoc by a person.
-- Status: scheduled -> agenda_published -> in_session -> held -> minutes_published; scheduled | agenda_published ->
-- cancelled. minutes_published and cancelled are final.
CREATE TABLE meeting (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id   uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  forum_id            uuid NOT NULL,
  series_id           uuid NULL,
  series_rule_version integer NULL CHECK (series_rule_version IS NULL OR series_rule_version >= 1),
  occurrence_date     date NULL,
  scheduled_date      date NOT NULL,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  timezone            text NOT NULL DEFAULT 'Asia/Riyadh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  location            text NULL CHECK (location IS NULL OR char_length(location) BETWEEN 1 AND 300),
  chair_user_id       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  secretary_user_id   uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  quorum_min          smallint NULL CHECK (quorum_min IS NULL OR quorum_min BETWEEN 1 AND 100),
  cutoff_date         date NULL,
  cutoff_unknown_reason text NULL CHECK (cutoff_unknown_reason IS NULL OR cutoff_unknown_reason IN ('calendar_not_configured')),
  status              text NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'agenda_published', 'in_session', 'held', 'minutes_published', 'cancelled')),
  cancel_reason       text NULL CHECK (cancel_reason IS NULL OR cancel_reason IN ('series_regenerated', 'series_ended', 'manual')),
  cancel_note         text NULL CHECK (cancel_note IS NULL OR char_length(cancel_note) BETWEEN 3 AND 2000),
  cancelled_at        timestamptz NULL,
  cancelled_by        uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  started_at          timestamptz NULL,
  held_at             timestamptz NULL,
  created_source      text NOT NULL CHECK (created_source IN ('api', 'worker')),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT meeting_forum_id_fkey FOREIGN KEY (transformation_id, forum_id) REFERENCES forum (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_series_id_fkey FOREIGN KEY (transformation_id, series_id) REFERENCES meeting_series (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_times CHECK (ends_at > starts_at),
  -- A series meeting names its rule version and nominal occurrence date; an ad-hoc meeting has neither.
  CONSTRAINT meeting_series_fields CHECK ((series_id IS NULL) = (series_rule_version IS NULL) AND (series_id IS NULL) = (occurrence_date IS NULL)),
  -- A worker-generated meeting comes from a series; an API meeting has a person as author.
  CONSTRAINT meeting_created_source CHECK ((created_source = 'worker' AND series_id IS NOT NULL AND created_by IS NULL)
                                           OR (created_source = 'api' AND created_by IS NOT NULL)),
  CONSTRAINT meeting_cutoff_known_or_reason CHECK ((cutoff_date IS NULL) = (cutoff_unknown_reason IS NOT NULL)),
  CONSTRAINT meeting_cancelled_complete CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)
                                               AND (status = 'cancelled') = (cancel_reason IS NOT NULL)
                                               AND (cancel_reason IS DISTINCT FROM 'manual' OR (cancelled_by IS NOT NULL AND cancel_note IS NOT NULL)))
);
-- No duplicate occurrence of a series: at most one meeting that is not cancelled per (series, nominal date), so the
-- generation job is idempotent and a regeneration never doubles a date.
CREATE UNIQUE INDEX meeting_series_occurrence_key ON meeting (series_id, occurrence_date) WHERE status <> 'cancelled' AND series_id IS NOT NULL;
CREATE INDEX meeting_forum_date_idx ON meeting (forum_id, scheduled_date, id);
CREATE INDEX meeting_transformation_date_idx ON meeting (transformation_id, scheduled_date DESC, id DESC);
CREATE TRIGGER meeting_timezone_known BEFORE INSERT OR UPDATE OF timezone ON meeting
  FOR EACH ROW EXECUTE FUNCTION p4_timezone_known();
CREATE FUNCTION meeting_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'scheduled' THEN
      RAISE EXCEPTION 'meeting: a new meeting starts scheduled'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_starts_scheduled';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('minutes_published', 'cancelled') THEN
    RAISE EXCEPTION 'meeting %: a % meeting is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_final';
  END IF;
  IF NEW.forum_id IS DISTINCT FROM OLD.forum_id OR NEW.series_id IS DISTINCT FROM OLD.series_id
     OR NEW.series_rule_version IS DISTINCT FROM OLD.series_rule_version OR NEW.occurrence_date IS DISTINCT FROM OLD.occurrence_date
     OR NEW.created_source IS DISTINCT FROM OLD.created_source THEN
    RAISE EXCEPTION 'meeting %: forum, series, rule version, occurrence and source are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_identity_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['scheduled>agenda_published', 'agenda_published>in_session',
       'scheduled>in_session', 'in_session>held', 'held>minutes_published', 'scheduled>cancelled', 'agenda_published>cancelled']) THEN
    RAISE EXCEPTION 'meeting %: % -> % is not a legal transition (ADR-0032)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_status_transition';
  END IF;
  -- Regeneration replaces FUTURE meetings only (REQ-S10-005): a meeting cancelled because its series changed must be
  -- scheduled after today's business date in its own timezone, and must not have started.
  IF NEW.status = 'cancelled' AND NEW.cancel_reason IN ('series_regenerated', 'series_ended')
     AND (OLD.series_id IS NULL OR OLD.scheduled_date <= p4_business_date(now(), OLD.timezone) OR OLD.status <> 'scheduled') THEN
    RAISE EXCEPTION 'meeting %: only a future, still scheduled series meeting is replaced when the series changes', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_regenerate_future_only';
  END IF;
  IF NEW.status = 'minutes_published' AND NOT EXISTS (
       SELECT 1 FROM meeting_minutes m WHERE m.meeting_id = NEW.id AND m.status = 'published') THEN
    RAISE EXCEPTION 'meeting %: minutes_published needs published minutes', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_guard BEFORE INSERT OR UPDATE ON meeting FOR EACH ROW EXECUTE FUNCTION meeting_guard();
SELECT p2_attach_guards('meeting', true);
GRANT SELECT, INSERT, UPDATE ON meeting TO mth_app;

-- Children of a meeting (agenda items, attendance, outputs, action links, blocker statuses) are frozen once the
-- meeting's minutes are published or the meeting is cancelled (REQ-S10-011 "published minutes are immutable").
CREATE FUNCTION p4_meeting_child_editable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m_status text;
BEGIN
  SELECT m.status INTO m_status FROM meeting m WHERE m.id = NEW.meeting_id;
  IF m_status IN ('minutes_published', 'cancelled') THEN
    RAISE EXCEPTION '%: the meeting is % and its records are frozen', TG_TABLE_NAME, m_status
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_meeting_frozen';
  END IF;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------------------------------------------
-- agenda_item: one item on a meeting's agenda (REQ-S16-019 "AgendaItem"). kind 'executive_ask' is an escalated
-- decision (B0102 "Escalate decisions, not status"): it either links a T16 executive decision (decision_id) or carries a
-- draft brief in the ask_* columns, never both. Publication needs the five B0102 elements (REQ-PB-068) plus why now and
-- the required date (REQ-S10-012); publishing a brief creates the T16 row and moves the brief into it (the ask_*
-- columns are cleared in the same statement), so no second copy of an ask exists.
-- Status: draft -> published -> closed; draft | published -> withdrawn. Published and closed items are frozen except
-- for the status edge and the outcome fields.
CREATE TABLE agenda_item (
  id                      uuid PRIMARY KEY,
  organization_id         uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id       uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id              uuid NOT NULL,
  ordinal                 smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  item_kind               text NOT NULL CHECK (item_kind IN ('executive_ask', 'discussion', 'information')),
  title                   text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description             text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 8000),
  presenter_user_id       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  duration_minutes        smallint NULL CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 480),
  materials_evidence_ids  uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(materials_evidence_ids) <= 20),
  decision_id             uuid NULL,
  ask_decision_required   text NULL CHECK (ask_decision_required IS NULL OR char_length(ask_decision_required) BETWEEN 1 AND 500),
  ask_why_now             text NULL CHECK (ask_why_now IS NULL OR char_length(ask_why_now) BETWEEN 1 AND 4000),
  ask_options             text[] NULL CHECK (ask_options IS NULL OR cardinality(ask_options) BETWEEN 1 AND 26),
  ask_recommendation      text NULL CHECK (ask_recommendation IS NULL OR char_length(ask_recommendation) BETWEEN 1 AND 4000),
  ask_impact_of_delay     text NULL CHECK (ask_impact_of_delay IS NULL OR char_length(ask_impact_of_delay) BETWEEN 1 AND 4000),
  ask_owner_user_id       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ask_required_date       date NULL,
  late                    boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'withdrawn')),
  published_at            timestamptz NULL,
  published_by            uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  outcome                 text NULL CHECK (outcome IS NULL OR outcome IN ('decided', 'deferred', 'noted')),
  outcome_quorum_present  smallint NULL CHECK (outcome_quorum_present IS NULL OR outcome_quorum_present >= 0),
  outcome_recorded_at     timestamptz NULL,
  outcome_recorded_by     uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version                 integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT agenda_item_transformation_id_id_key UNIQUE (transformation_id, id),
  CONSTRAINT agenda_item_meeting_id_fkey FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT agenda_item_decision_id_fkey FOREIGN KEY (transformation_id, decision_id) REFERENCES decision (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT agenda_item_ordinal_key UNIQUE (meeting_id, ordinal) DEFERRABLE INITIALLY DEFERRED,
  -- Only an executive ask links a decision or carries a brief; a linked ask carries no brief (one copy of an ask).
  CONSTRAINT agenda_item_ask_shape CHECK (
    (item_kind = 'executive_ask' OR (decision_id IS NULL AND ask_decision_required IS NULL AND ask_why_now IS NULL
       AND ask_options IS NULL AND ask_recommendation IS NULL AND ask_impact_of_delay IS NULL AND ask_owner_user_id IS NULL
       AND ask_required_date IS NULL))
    AND (decision_id IS NULL OR (ask_decision_required IS NULL AND ask_why_now IS NULL AND ask_options IS NULL
       AND ask_recommendation IS NULL AND ask_impact_of_delay IS NULL AND ask_owner_user_id IS NULL AND ask_required_date IS NULL))),
  -- REQ-PB-068: a published executive ask states its elements, which after publication live on the linked T16 row.
  CONSTRAINT agenda_item_published_ask_linked CHECK (item_kind <> 'executive_ask' OR status IN ('draft', 'withdrawn') OR decision_id IS NOT NULL),
  CONSTRAINT agenda_item_published_complete CHECK ((status IN ('published', 'closed')) = (published_at IS NOT NULL)
                                                   AND (published_at IS NULL) = (published_by IS NULL)),
  CONSTRAINT agenda_item_outcome_complete CHECK ((outcome IS NULL) = (outcome_recorded_at IS NULL)
                                                 AND (outcome_recorded_at IS NULL) = (outcome_recorded_by IS NULL)
                                                 AND (outcome IS NULL OR status = 'closed')
                                                 AND (outcome IS DISTINCT FROM 'decided' OR item_kind = 'executive_ask'))
);
CREATE INDEX agenda_item_meeting_idx ON agenda_item (meeting_id, ordinal);
CREATE INDEX agenda_item_decision_idx ON agenda_item (decision_id) WHERE decision_id IS NOT NULL;
CREATE FUNCTION agenda_item_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  f record;
  m record;
  present integer;
BEGIN
  SELECT x.status, x.quorum_min, x.forum_id INTO m FROM meeting x WHERE x.id = NEW.meeting_id;
  SELECT fo.executive_asks_only INTO f FROM forum fo WHERE fo.id = m.forum_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'agenda_item: a new agenda item starts as a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_starts_draft';
    END IF;
    -- "Escalate decisions, not status" (B0102): an executive forum's agenda takes executive asks only.
    IF f.executive_asks_only AND NEW.item_kind <> 'executive_ask' THEN
      RAISE EXCEPTION 'agenda_item: this forum''s agenda takes executive asks only'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_executive_asks_only';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('closed', 'withdrawn') THEN
    RAISE EXCEPTION 'agenda_item %: a % item is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_final';
  END IF;
  IF NEW.meeting_id IS DISTINCT FROM OLD.meeting_id OR NEW.item_kind IS DISTINCT FROM OLD.item_kind THEN
    RAISE EXCEPTION 'agenda_item %: meeting and kind are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_identity_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['draft>published', 'published>closed', 'draft>withdrawn', 'published>withdrawn']) THEN
    RAISE EXCEPTION 'agenda_item %: % -> % is not a legal transition (ADR-0032)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_status_transition';
  END IF;
  -- A published item is frozen: only the status edge and the outcome fields may change, and an executive ask's
  -- decision link (set by publication) never changes afterwards.
  IF OLD.status = 'published' AND (NEW.title, NEW.description, NEW.presenter_user_id, NEW.duration_minutes,
       NEW.materials_evidence_ids, NEW.decision_id, NEW.ordinal)
     IS DISTINCT FROM (OLD.title, OLD.description, OLD.presenter_user_id, OLD.duration_minutes,
       OLD.materials_evidence_ids, OLD.decision_id, OLD.ordinal) THEN
    RAISE EXCEPTION 'agenda_item %: a published item is frozen', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_published_frozen';
  END IF;
  -- REQ-S10-011: with quorum configured, a decision is not recorded below quorum.
  IF NEW.outcome = 'decided' AND OLD.outcome IS NULL THEN
    IF m.status NOT IN ('in_session', 'held') THEN
      RAISE EXCEPTION 'agenda_item %: decisions are recorded while the meeting is in session or held', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_meeting_not_in_session';
    END IF;
    IF m.quorum_min IS NOT NULL THEN
      SELECT count(*) INTO present FROM meeting_attendance a
      WHERE a.meeting_id = NEW.meeting_id AND a.attendance = 'present' AND a.counts_for_quorum;
      IF present < m.quorum_min OR NEW.outcome_quorum_present IS DISTINCT FROM present THEN
        RAISE EXCEPTION 'agenda_item %: quorum % not met (% counted present)', OLD.id, m.quorum_min, present
          USING ERRCODE = 'check_violation', CONSTRAINT = 'agenda_item_quorum_met';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agenda_item_guard BEFORE INSERT OR UPDATE ON agenda_item FOR EACH ROW EXECUTE FUNCTION agenda_item_guard();
CREATE TRIGGER agenda_item_meeting_editable BEFORE INSERT OR UPDATE ON agenda_item FOR EACH ROW EXECUTE FUNCTION p4_meeting_child_editable();
SELECT p2_attach_guards('agenda_item', true);
GRANT SELECT, INSERT, UPDATE ON agenda_item TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- meeting_attendance: one person's attendance at one meeting (REQ-S16-019 "Attendance"; REQ-S10-011 "record
-- attendance/quorum where configured"). Quorum counts rows with attendance 'present' and counts_for_quorum.
CREATE TABLE meeting_attendance (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id    uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id           uuid NOT NULL,
  user_id              uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  attendance           text NOT NULL CHECK (attendance IN ('present', 'absent', 'apologies')),
  counts_for_quorum    boolean NOT NULL DEFAULT true,
  on_behalf_of_user_id uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  note                 text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_attendance_meeting_id_fkey FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_attendance_person_key UNIQUE (meeting_id, user_id),
  CONSTRAINT meeting_attendance_not_self_proxy CHECK (on_behalf_of_user_id IS NULL OR on_behalf_of_user_id <> user_id),
  -- A representative is present for someone; an absent person represents nobody.
  CONSTRAINT meeting_attendance_proxy_present CHECK (on_behalf_of_user_id IS NULL OR attendance = 'present')
);
CREATE FUNCTION meeting_attendance_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.meeting_id IS DISTINCT FROM OLD.meeting_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'meeting_attendance %: meeting and person are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_attendance_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_attendance_guard BEFORE INSERT OR UPDATE ON meeting_attendance FOR EACH ROW EXECUTE FUNCTION meeting_attendance_guard();
CREATE TRIGGER meeting_attendance_meeting_editable BEFORE INSERT OR UPDATE ON meeting_attendance FOR EACH ROW EXECUTE FUNCTION p4_meeting_child_editable();
SELECT p2_attach_guards('meeting_attendance', true);
GRANT SELECT, INSERT, UPDATE ON meeting_attendance TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- meeting_output: one output of a meeting, as defined for its layer (B0093 Outputs; REQ-PB-061), linked to the
-- canonical record it is about. Append-only: a wrong output is answered by a later one, never edited.
CREATE TABLE meeting_output (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id        uuid NOT NULL,
  agenda_item_id    uuid NULL,
  output_kind       text NOT NULL CONSTRAINT meeting_output_kind_valid CHECK (p4_meeting_output_kinds_valid(ARRAY[output_kind])),
  record_type       text NULL,
  record_id         uuid NULL,
  note              text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 4000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_output_meeting_id_fkey FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_output_agenda_item_id_fkey FOREIGN KEY (transformation_id, agenda_item_id) REFERENCES agenda_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_output_record_pair CHECK ((record_type IS NULL) = (record_id IS NULL)),
  -- Each kind links the canonical record type(s) it is about; the kinds that are records must link one; a kind
  -- without a record states a note.
  CONSTRAINT meeting_output_record_type CHECK (coalesce(
    CASE output_kind
      WHEN 'decision' THEN record_type = 'decision'
      WHEN 'decision_log' THEN record_type IS NULL OR record_type = 'decision'
      WHEN 'unblocker' THEN record_type IS NULL OR record_type IN ('raid_entry', 'dependency', 'decision')
      WHEN 'benefit_view' THEN record_type IS NULL OR record_type = 'benefit'
      WHEN 'integrated_status' THEN record_type IS NULL
      WHEN 'milestone' THEN record_type = 'milestone'
      WHEN 'action' THEN record_type = 'action_item'
      WHEN 'raid' THEN record_type IN ('raid_entry', 'dependency')
      WHEN 'test' THEN record_type IS NULL OR record_type = 'evidence'
      WHEN 'evidence' THEN record_type = 'evidence'
      WHEN 'recommendation' THEN record_type IS NULL OR record_type = 'decision'
      WHEN 'benefit_evidence' THEN record_type IN ('benefit_evidence', 'benefit_measurement')
      WHEN 'forecast' THEN record_type IN ('benefit', 'benefit_measurement')
      WHEN 'corrective_action' THEN record_type = 'corrective_case'
      ELSE false
    END, false)),
  CONSTRAINT meeting_output_note_or_record CHECK (record_id IS NOT NULL OR note IS NOT NULL)
);
CREATE INDEX meeting_output_meeting_idx ON meeting_output (meeting_id, output_kind, created_at, id);
CREATE FUNCTION meeting_output_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  found_it boolean;
  kinds text[];
BEGIN
  SELECT fo.output_kinds INTO kinds FROM meeting m JOIN forum fo ON fo.id = m.forum_id WHERE m.id = NEW.meeting_id;
  IF NOT NEW.output_kind = ANY (kinds) THEN
    RAISE EXCEPTION 'meeting_output: % is not an output of this forum', NEW.output_kind
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_output_kind_of_forum';
  END IF;
  IF NEW.record_id IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND transformation_id = $2)', NEW.record_type)
      INTO found_it USING NEW.record_id, NEW.transformation_id;
    IF NOT found_it THEN
      RAISE EXCEPTION 'meeting_output: % % does not exist in transformation %', NEW.record_type, NEW.record_id, NEW.transformation_id
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'meeting_output_record_ref';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_output_guard BEFORE INSERT ON meeting_output FOR EACH ROW EXECUTE FUNCTION meeting_output_guard();
CREATE TRIGGER meeting_output_meeting_editable BEFORE INSERT ON meeting_output FOR EACH ROW EXECUTE FUNCTION p4_meeting_child_editable();
SELECT p2_attach_append_only('meeting_output');
SELECT p2_attach_guards('meeting_output', true);
GRANT SELECT, INSERT ON meeting_output TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- meeting_action_link: an action assigned or reviewed in a meeting (REQ-S16-019 "MeetingActionLink"; REQ-S10-011
-- "assign actions -> monitor closure"). The action itself is the canonical action_item (person-authored, ADR-0031 §4);
-- the link is append-only, one per (meeting, action).
CREATE TABLE meeting_action_link (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id        uuid NOT NULL,
  agenda_item_id    uuid NULL,
  action_item_id    uuid NOT NULL,
  link_kind         text NOT NULL CHECK (link_kind IN ('assigned', 'reviewed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_action_link_meeting_id_fkey FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_action_link_agenda_item_id_fkey FOREIGN KEY (transformation_id, agenda_item_id) REFERENCES agenda_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_action_link_action_item_id_fkey FOREIGN KEY (transformation_id, action_item_id) REFERENCES action_item (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_action_link_key UNIQUE (meeting_id, action_item_id)
);
CREATE INDEX meeting_action_link_action_idx ON meeting_action_link (action_item_id);
CREATE TRIGGER meeting_action_link_meeting_editable BEFORE INSERT ON meeting_action_link FOR EACH ROW EXECUTE FUNCTION p4_meeting_child_editable();
SELECT p2_attach_append_only('meeting_action_link');
SELECT p2_attach_guards('meeting_action_link', true);
GRANT SELECT, INSERT ON meeting_action_link TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- meeting_minutes: the minutes of one meeting (REQ-S16-019 "Minutes"). Status draft -> approved -> published;
-- approved -> draft (returned for edits). Published minutes are immutable (REQ-S10-011): no column changes. Publication
-- needs a held meeting and, when the forum names required outputs, at least one of them (REQ-PB-061: a Value Review
-- meeting cannot be published without a benefit evidence or forecast entry).
CREATE TABLE meeting_minutes (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  meeting_id        uuid NOT NULL,
  body              text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published')),
  approved_at       timestamptz NULL,
  approved_by       uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  published_at      timestamptz NULL,
  published_by      uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_minutes_meeting_id_fkey FOREIGN KEY (transformation_id, meeting_id) REFERENCES meeting (transformation_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT meeting_minutes_meeting_key UNIQUE (meeting_id),
  CONSTRAINT meeting_minutes_approved_complete CHECK ((status IN ('approved', 'published')) = (approved_at IS NOT NULL)
                                                      AND (approved_at IS NULL) = (approved_by IS NULL)),
  CONSTRAINT meeting_minutes_published_complete CHECK ((status = 'published') = (published_at IS NOT NULL)
                                                       AND (published_at IS NULL) = (published_by IS NULL))
);
CREATE FUNCTION meeting_minutes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m record;
  required text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'meeting_minutes: new minutes start as a draft'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_starts_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'meeting_minutes %: published minutes are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_published_immutable';
  END IF;
  IF NEW.meeting_id IS DISTINCT FROM OLD.meeting_id THEN
    RAISE EXCEPTION 'meeting_minutes %: the meeting is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_identity';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['draft>approved', 'approved>draft', 'approved>published']) THEN
    RAISE EXCEPTION 'meeting_minutes %: % -> % is not a legal transition (ADR-0032)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_status_transition';
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'meeting_minutes %: approved minutes are edited only after returning them to draft', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_approved_frozen';
  END IF;
  IF NEW.status = 'published' THEN
    SELECT x.status, fo.publish_requires_any_output INTO m FROM meeting x JOIN forum fo ON fo.id = x.forum_id WHERE x.id = NEW.meeting_id;
    IF m.status <> 'held' THEN
      RAISE EXCEPTION 'meeting_minutes %: minutes are published for a held meeting', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_meeting_held';
    END IF;
    required := m.publish_requires_any_output;
    IF cardinality(required) > 0 AND NOT EXISTS (
         SELECT 1 FROM meeting_output o WHERE o.meeting_id = NEW.meeting_id AND o.output_kind = ANY (required)) THEN
      RAISE EXCEPTION 'meeting_minutes %: the forum requires at least one output of %', OLD.id, required
        USING ERRCODE = 'check_violation', CONSTRAINT = 'meeting_minutes_required_output';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_minutes_guard BEFORE INSERT OR UPDATE ON meeting_minutes FOR EACH ROW EXECUTE FUNCTION meeting_minutes_guard();
CREATE TRIGGER meeting_minutes_no_delete BEFORE DELETE OR TRUNCATE ON meeting_minutes FOR EACH STATEMENT EXECUTE FUNCTION p2_append_only();
SELECT p2_attach_guards('meeting_minutes', true);
GRANT SELECT, INSERT, UPDATE ON meeting_minutes TO mth_app;

-- -----------------------------------------------------------------------------------------------------------------
-- The five layers per transformation (REQ-PB-060). Same contract as p4_instantiate_transformation (0030): idempotent,
-- serialized by the transformation row lock, every created row audited ('user' from the API; 'system' on behalf of the
-- creator in the backfill). Copies never touch the template or another transformation.
CREATE FUNCTION p4_instantiate_forums(p_transformation_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
  rid uuid;
  creator uuid;
  a_type text := CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END;
  on_behalf uuid;
  created integer := 0;
  r record;
BEGIN
  SELECT x.id, x.organization_id, x.created_by INTO t FROM transformation x WHERE x.id = p_transformation_id FOR UPDATE;
  creator := coalesce(p_actor_user_id, t.created_by);
  on_behalf := CASE WHEN p_actor_user_id IS NULL THEN t.created_by END;
  FOR r IN SELECT * FROM forum_template ORDER BY ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM forum f WHERE f.transformation_id = t.id AND f.template_key = r.key) THEN
      rid := mth_uuid_v7();
      INSERT INTO forum (id, organization_id, transformation_id, template_key, ordinal, name_en, name_ar, cadence_label,
                         purpose, participants_label, outputs_label, chair_party_code, participant_parties, output_kinds,
                         publish_requires_any_output, executive_asks_only, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, r.key, r.ordinal, r.source_layer_en, r.layer_ar, r.source_cadence_en,
              r.source_purpose_en, r.source_participants_en, r.source_outputs_en, r.chair_party_code, r.participant_parties,
              r.output_kinds, r.publish_requires_any_output, r.executive_asks_only, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'forum.create', 'forum', rid, 1,
              p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION p4_instantiate_forums(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p4_instantiate_forums(uuid, uuid, text, text) TO mth_app;

-- p4_instantiate_transformation (0030) is redefined with one added line at its end, so the single P4 instantiation call
-- also creates the five forums. The rest of its body is byte-for-byte the 0030 text; its signature, grants and
-- idempotence are unchanged (CREATE OR REPLACE keeps the existing EXECUTE grant to mth_app).
CREATE OR REPLACE FUNCTION p4_instantiate_transformation(p_transformation_id uuid, p_actor_user_id uuid, p_request_id text, p_source text)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
  rid uuid;
  did uuid;
  creator uuid;
  a_type text := CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END;
  on_behalf uuid;
  created integer;
  k text;
  r record;
  c record;
BEGIN
  created := p3_instantiate_transformation(p_transformation_id, p_actor_user_id, p_request_id, p_source);
  SELECT x.id, x.organization_id, x.created_by INTO t FROM transformation x WHERE x.id = p_transformation_id FOR UPDATE;
  creator := coalesce(p_actor_user_id, t.created_by);
  on_behalf := CASE WHEN p_actor_user_id IS NULL THEN t.created_by END;

  FOREACH k IN ARRAY ARRAY['decision_rights', 'raci'] LOOP
    IF NOT EXISTS (SELECT 1 FROM governance_matrix g WHERE g.transformation_id = t.id AND g.kind = k) THEN
      rid := mth_uuid_v7();
      INSERT INTO governance_matrix (id, organization_id, transformation_id, kind, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, k, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'governance_matrix.create',
              'governance_matrix', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM decision_right_template ORDER BY ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM transformation_decision_right x WHERE x.transformation_id = t.id AND x.template_key = r.key) THEN
      rid := mth_uuid_v7();
      INSERT INTO transformation_decision_right (id, organization_id, transformation_id, template_key, ordinal, decision_en,
        decision_ar, recommend_label, approve_label, consult_label, inform_label, sla_label, recommend_parties,
        approve_party_code, consult_parties, inform_parties, sla_type, sla_working_days, escalation_chain, created_by, updated_by)
      VALUES (rid, t.organization_id, t.id, r.key, r.ordinal, r.source_decision_en, r.decision_ar, r.source_recommend_en,
              r.source_approve_en, r.source_consult_en, r.source_inform_en, r.source_sla_en, r.recommend_parties,
              r.approve_party_code, r.consult_parties, r.inform_parties, r.sla_type, r.sla_working_days, r.escalation_chain,
              creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_decision_right.create',
              'transformation_decision_right', rid, 1, p_request_id, p_source);
      created := created + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM raci_template_deliverable ORDER BY ordinal LOOP
    IF NOT EXISTS (SELECT 1 FROM transformation_raci_deliverable x WHERE x.transformation_id = t.id AND x.template_key = r.key) THEN
      did := mth_uuid_v7();
      INSERT INTO transformation_raci_deliverable (id, organization_id, transformation_id, template_key, ordinal, label_en,
                                                   label_ar, created_by, updated_by)
      VALUES (did, t.organization_id, t.id, r.key, r.ordinal, r.source_deliverable_en, r.deliverable_ar, creator, creator);
      INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                               record_type, record_id, new_version, request_id, source)
      VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_raci_deliverable.create',
              'transformation_raci_deliverable', did, 1, p_request_id, p_source);
      created := created + 1;
      FOR c IN SELECT cell.party_code, cell.value FROM raci_template_cell cell
               JOIN governance_party g ON g.code = cell.party_code
               WHERE cell.deliverable_key = r.key ORDER BY g.ordinal LOOP
        rid := mth_uuid_v7();
        INSERT INTO transformation_raci_assignment (id, organization_id, transformation_id, deliverable_id, party_code, value,
                                                    created_by, updated_by)
        VALUES (rid, t.organization_id, t.id, did, c.party_code, c.value, creator, creator);
        INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, on_behalf_of_user_id, action,
                                 record_type, record_id, new_version, request_id, source)
        VALUES (mth_uuid_v7(), t.organization_id, t.id, a_type, p_actor_user_id, on_behalf, 'transformation_raci_assignment.create',
                'transformation_raci_assignment', rid, 1, p_request_id, p_source);
        created := created + 1;
      END LOOP;
    END IF;
  END LOOP;
  -- 0044 (slice D): the five forum layers of B0093 (REQ-PB-060).
  created := created + p4_instantiate_forums(p_transformation_id, p_actor_user_id, p_request_id, p_source);
  RETURN created;
END $$;

-- Backfill: every existing transformation gets its five forums, audited as actor 'system' on behalf of its creator. On a
-- fresh database this selects no rows.
SELECT p4_instantiate_forums(x.id, NULL, NULL, 'migration') FROM transformation x ORDER BY x.created_at, x.id;
