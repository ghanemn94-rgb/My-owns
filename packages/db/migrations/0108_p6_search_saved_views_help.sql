-- 0108 P6 slices H and G: the global search index, its per-type index state, saved views with their history, the
-- contextual help catalogue (bilingual seed) and the load-dataset marker (T-DG6-ARCH-04; ADR-0057, ADR-0058). Authored
-- by solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit
-- once merged. SQL floor: PostgreSQL 16 (the 'english', 'arabic' and 'simple' text search configurations ship with
-- PostgreSQL and were verified on the pinned 16.13 server, ADR-0049 §3; probe S01 re-checks them here).
--
-- REQ-S15-010 ("Search returns only records the user may read; lists support saved views and chips"), REQ-S15-013
-- ("persist column choices in saved views"), REQ-S20-029 (the load dataset is "a generator separate from the demo
-- seed", D-195 Q9).
--   search_document      one DERIVED row per indexed record (12 record types, closed set). Written only by the search
--                        index job under its service identity (ADR-0053) from the audit-event feed (ADR-0057 §2); never
--                        written by a user request. Scope keys (organization_id, transformation_id) are copied from the
--                        immutable record columns; every permission and sensitivity decision is taken at QUERY time
--                        through ReadScope (ADR-0051 §1), never at index time. Holds titles, codes, statuses and a
--                        text summary only: no money, rate, KPI or FTE value is indexed. Version-stepped by
--                        p2_row_guard and NOT audited (a derived copy; the source record's own write is the audited
--                        event, the worker_heartbeat precedent of 0101). Deletable by the job (a removed record).
--   search_index_state   one row per indexed record type: the audit sequence the index has consumed, the last full
--                        reindex, the document count (NULL = Unknown, never 0) and the last error code. Seeded here.
--                        Version-stepped, not audited (telemetry of a derived index).
--   saved_view           a user's named list configuration (columns, filters, sort) for one of 12 lists (closed set),
--                        personal or shared within the owner's organization. Only the owner changes or deletes it;
--                        sharing needs saved_view.share at commit time (API). A view never grants data: the list it is
--                        applied to is filtered by ReadScope as before. Versioned and audited; trigger-written
--                        append-only history saved_view_event. 'deleted' is terminal.
--   help_topic           the contextual help catalogue (en, ar; the Arabic labelled provisional), seeded here.
--                        Read-only to mth_app (GRANT SELECT); a later correction is a new migration.
--   load_dataset_marker  at most one row, written once by the load-dataset generator (deploy/load/generate.mjs, DO-E)
--                        into an EMPTY database that carries no deployment_environment row; append-only. Its presence
--                        is what lets deploy/load/sessions.mjs mint load sessions (ADR-0058 §4). The demo seed never
--                        writes it, and the generator never writes demo or production markers.
-- Nothing here reads or writes DG0-DG7. Searching, saving a view or reading help approves nothing.

-- ------------------------------------------------------------------------------------------------ validation functions
CREATE FUNCTION p6_search_record_type_valid(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p IN ('transformation', 'initiative', 'kpi_definition', 'benefit', 'raid_entry', 'dependency', 'decision',
               'deliverable', 'evidence', 'business_case', 'lesson', 'change_request')
$$;

-- Columns: a JSON array of 1-50 distinct column keys (camelCase, 1-64 characters).
CREATE FUNCTION p6_saved_view_columns_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) BETWEEN 1 AND 50
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) e
                      WHERE jsonb_typeof(e) <> 'string' OR NOT (e #>> '{}') ~ '^[a-z][A-Za-z0-9]{0,63}$')
     AND (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(p) e) = jsonb_array_length(p)
$$;

-- Filters: a JSON object of at most 20 keys (camelCase); each value a string of 1-200 characters, or an array of 1-20
-- such strings. Values are always strings (a decimal or a date travels as text, ADR-0057 §5).
CREATE FUNCTION p6_saved_view_filters_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(p)) <= 20
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p) kv
        WHERE NOT kv.key ~ '^[a-z][A-Za-z0-9]{0,63}$'
           OR NOT (
             (jsonb_typeof(kv.value) = 'string' AND char_length(kv.value #>> '{}') BETWEEN 1 AND 200)
             OR (jsonb_typeof(kv.value) = 'array' AND jsonb_array_length(kv.value) BETWEEN 1 AND 20
                 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(kv.value) e
                                  WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') NOT BETWEEN 1 AND 200))))
$$;

-- Sort: a JSON array of 0-3 objects {"key": <camelCase>, "direction": "asc"|"desc"}, keys distinct.
CREATE FUNCTION p6_saved_view_sort_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) <= 3
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) e
                      WHERE jsonb_typeof(e) <> 'object'
                         OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2
                         OR jsonb_typeof(e -> 'key') <> 'string'
                         OR NOT (e ->> 'key') ~ '^[a-z][A-Za-z0-9]{0,63}$'
                         OR coalesce(e ->> 'direction', '') NOT IN ('asc', 'desc'))
     AND (SELECT count(DISTINCT e ->> 'key') FROM jsonb_array_elements(p) e) = jsonb_array_length(p)
$$;

-- ------------------------------------------------------------------------------------------------ search_document
CREATE TABLE search_document (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transformation_id uuid NOT NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_type       text NOT NULL CONSTRAINT search_document_record_type CHECK (p6_search_record_type_valid(record_type)),
  record_id         uuid NOT NULL,
  record_version    integer NOT NULL CHECK (record_version >= 1),
  code              text NULL CHECK (code IS NULL OR char_length(code) BETWEEN 1 AND 40),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  summary           text NULL CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 1000),
  record_status     text NULL CHECK (record_status IS NULL OR record_status ~ '^[a-z][a-z0-9_]{0,39}$'),
  is_archived       boolean NOT NULL DEFAULT false,
  source_audit_seq  bigint NOT NULL CHECK (source_audit_seq >= 0),
  search_en         tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig,
                      coalesce(code, '') || ' ' || title || ' ' || coalesce(summary, ''))) STORED,
  search_ar         tsvector GENERATED ALWAYS AS (to_tsvector('arabic'::regconfig,
                      coalesce(code, '') || ' ' || title || ' ' || coalesce(summary, ''))) STORED,
  search_simple     tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig,
                      coalesce(code, '') || ' ' || title || ' ' || coalesce(summary, ''))) STORED,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_document_record_key UNIQUE (record_type, record_id),
  CONSTRAINT search_document_transformation_self CHECK (record_type <> 'transformation' OR record_id = transformation_id)
);
CREATE INDEX search_document_en_idx ON search_document USING gin (search_en);
CREATE INDEX search_document_ar_idx ON search_document USING gin (search_ar);
CREATE INDEX search_document_simple_idx ON search_document USING gin (search_simple);
CREATE INDEX search_document_scope_idx ON search_document (organization_id, transformation_id, record_type);
SELECT p2_attach_guards('search_document', false);
GRANT SELECT, INSERT, UPDATE, DELETE ON search_document TO mth_app;

-- The record identity of a document never changes, and the document never goes backwards: its source audit sequence
-- and its record version never decrease (a replayed or reordered feed event cannot overwrite a newer document).
CREATE FUNCTION search_document_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.record_type IS DISTINCT FROM OLD.record_type OR NEW.record_id IS DISTINCT FROM OLD.record_id THEN
    RAISE EXCEPTION 'search_document: the indexed record never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'search_document_identity_fixed';
  END IF;
  IF NEW.source_audit_seq < OLD.source_audit_seq OR NEW.record_version < OLD.record_version THEN
    RAISE EXCEPTION 'search_document: a document never goes back to an older audit sequence or record version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'search_document_monotonic';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER search_document_guard BEFORE UPDATE ON search_document
  FOR EACH ROW EXECUTE FUNCTION search_document_guard();

-- ------------------------------------------------------------------------------------------------ search_index_state
CREATE TABLE search_index_state (
  id                        uuid PRIMARY KEY,
  record_type               text NOT NULL CONSTRAINT search_index_state_record_type CHECK (p6_search_record_type_valid(record_type)),
  status                    text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'reindexing', 'failed')),
  last_audit_seq            bigint NOT NULL DEFAULT 0 CHECK (last_audit_seq >= 0),
  last_incremental_at       timestamptz NULL,
  reindex_started_at        timestamptz NULL,
  reindex_finished_at       timestamptz NULL,
  documents_count           integer NULL CHECK (documents_count IS NULL OR documents_count >= 0),
  last_error_code           text NULL CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_.]{2,79}$'),
  last_error_at             timestamptz NULL,
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_index_state_record_type_key UNIQUE (record_type),
  CONSTRAINT search_index_state_reindexing_started CHECK (status <> 'reindexing' OR reindex_started_at IS NOT NULL),
  CONSTRAINT search_index_state_failed_coded CHECK ((status = 'failed') = (last_error_code IS NOT NULL)
                                                   AND (last_error_code IS NULL) = (last_error_at IS NULL)),
  CONSTRAINT search_index_state_finished_after CHECK (reindex_finished_at IS NULL OR reindex_started_at IS NULL
                                                      OR reindex_finished_at >= reindex_started_at)
);
SELECT p2_attach_guards('search_index_state', false);
GRANT SELECT, UPDATE ON search_index_state TO mth_app;

-- The consumed audit sequence never goes back, except to 0 at the start of a full reindex.
CREATE FUNCTION search_index_state_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.record_type IS DISTINCT FROM OLD.record_type THEN
    RAISE EXCEPTION 'search_index_state: the record type never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'search_index_state_identity_fixed';
  END IF;
  IF NEW.last_audit_seq < OLD.last_audit_seq AND NOT (NEW.last_audit_seq = 0 AND NEW.status = 'reindexing') THEN
    RAISE EXCEPTION 'search_index_state: the consumed audit sequence goes back only to 0 when a full reindex starts'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'search_index_state_monotonic';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER search_index_state_guard BEFORE UPDATE ON search_index_state
  FOR EACH ROW EXECUTE FUNCTION search_index_state_guard();

INSERT INTO search_index_state (id, record_type) VALUES
  ('01920006-0400-7000-8000-000000000001', 'transformation'),
  ('01920006-0400-7000-8000-000000000002', 'initiative'),
  ('01920006-0400-7000-8000-000000000003', 'kpi_definition'),
  ('01920006-0400-7000-8000-000000000004', 'benefit'),
  ('01920006-0400-7000-8000-000000000005', 'raid_entry'),
  ('01920006-0400-7000-8000-000000000006', 'dependency'),
  ('01920006-0400-7000-8000-000000000007', 'decision'),
  ('01920006-0400-7000-8000-000000000008', 'deliverable'),
  ('01920006-0400-7000-8000-000000000009', 'evidence'),
  ('01920006-0400-7000-8000-00000000000a', 'business_case'),
  ('01920006-0400-7000-8000-00000000000b', 'lesson'),
  ('01920006-0400-7000-8000-00000000000c', 'change_request');

-- ------------------------------------------------------------------------------------------------ saved_view
CREATE TABLE saved_view (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  list_key          text NOT NULL CHECK (list_key IN ('transformations', 'initiatives', 'strategic_guardrails', 'outcomes',
                      'diagnostic_items', 'diagnostic_findings', 'workstream_outputs', 'tom_gaps', 'capability_heatmap',
                      'journeys', 'journey_pain_points', 'search')),
  transformation_id uuid NULL REFERENCES transformation (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  visibility        text NOT NULL DEFAULT 'personal' CHECK (visibility IN ('personal', 'shared')),
  columns           jsonb NOT NULL CONSTRAINT saved_view_columns_valid CHECK (p6_saved_view_columns_valid(columns)),
  filters           jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT saved_view_filters_valid CHECK (p6_saved_view_filters_valid(filters)),
  sort              jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT saved_view_sort_valid CHECK (p6_saved_view_sort_valid(sort)),
  is_default        boolean NOT NULL DEFAULT false,
  shared_at         timestamptz NULL,
  shared_by         uuid NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  deleted_at        timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT saved_view_owner_is_creator CHECK (owner_user_id = created_by),
  CONSTRAINT saved_view_shared_shape CHECK ((visibility = 'shared') = (shared_at IS NOT NULL)
                                            AND (shared_at IS NULL) = (shared_by IS NULL)),
  CONSTRAINT saved_view_deleted_shape CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT saved_view_deleted_not_default CHECK (status = 'active' OR NOT is_default),
  CONSTRAINT saved_view_cross_transformation_lists CHECK (list_key NOT IN ('transformations') OR transformation_id IS NULL)
);
-- One active view per owner, list, transformation (or none) and case-insensitive name; one default per owner and list.
CREATE UNIQUE INDEX saved_view_name_key ON saved_view
  (owner_user_id, list_key, coalesce(transformation_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE status = 'active';
CREATE UNIQUE INDEX saved_view_one_default_key ON saved_view
  (owner_user_id, list_key, coalesce(transformation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'active' AND is_default;
CREATE INDEX saved_view_owner_idx ON saved_view (owner_user_id, list_key, updated_at DESC) WHERE status = 'active';
CREATE INDEX saved_view_shared_idx ON saved_view (organization_id, list_key) WHERE status = 'active' AND visibility = 'shared';
SELECT p2_attach_guards('saved_view', true);
GRANT SELECT, INSERT, UPDATE ON saved_view TO mth_app;

CREATE FUNCTION saved_view_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t_org uuid;
  u_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'saved_view: a view starts active'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_transition';
    END IF;
  ELSE
    IF OLD.status = 'deleted' THEN
      RAISE EXCEPTION 'saved_view: a deleted view never changes'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_final';
    END IF;
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.list_key IS DISTINCT FROM OLD.list_key
       OR NEW.transformation_id IS DISTINCT FROM OLD.transformation_id THEN
      RAISE EXCEPTION 'saved_view: owner, list and transformation never change'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_identity_fixed';
    END IF;
    IF NEW.updated_by IS DISTINCT FROM OLD.owner_user_id THEN
      RAISE EXCEPTION 'saved_view: only the owner changes a view'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_owner_only';
    END IF;
  END IF;
  SELECT organization_id INTO u_org FROM app_user WHERE id = NEW.owner_user_id;
  IF u_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'saved_view: the view belongs to its owner''s organization'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_organization_matches';
  END IF;
  IF NEW.transformation_id IS NOT NULL THEN
    SELECT organization_id INTO t_org FROM transformation WHERE id = NEW.transformation_id;
    IF t_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'saved_view: the transformation belongs to the view''s organization'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_organization_matches';
    END IF;
  END IF;
  IF NEW.shared_by IS NOT NULL AND NEW.shared_by IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'saved_view: only the owner shares a view'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'saved_view_owner_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saved_view_guard BEFORE INSERT OR UPDATE ON saved_view
  FOR EACH ROW EXECUTE FUNCTION saved_view_guard();

CREATE TABLE saved_view_event (
  id              uuid PRIMARY KEY,
  saved_view_id   uuid NOT NULL REFERENCES saved_view (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_version  integer NOT NULL CHECK (record_version >= 1),
  name            text NOT NULL,
  visibility      text NOT NULL,
  columns         jsonb NOT NULL,
  filters         jsonb NOT NULL,
  sort            jsonb NOT NULL,
  is_default      boolean NOT NULL,
  status          text NOT NULL,
  actor_user_id   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  occurred_at     timestamptz NOT NULL,
  CONSTRAINT saved_view_event_version_key UNIQUE (saved_view_id, record_version)
);
SELECT p2_attach_append_only('saved_view_event');
GRANT SELECT ON saved_view_event TO mth_app;

CREATE FUNCTION saved_view_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO saved_view_event (id, saved_view_id, record_version, name, visibility, columns, filters, sort, is_default,
    status, actor_user_id, occurred_at)
  VALUES (mth_uuid_v7(), NEW.id, NEW.version, NEW.name, NEW.visibility, NEW.columns, NEW.filters, NEW.sort,
    NEW.is_default, NEW.status, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION saved_view_history() FROM PUBLIC;
CREATE TRIGGER saved_view_history AFTER INSERT OR UPDATE ON saved_view
  FOR EACH ROW EXECUTE FUNCTION saved_view_history();

-- ------------------------------------------------------------------------------------------------ help_topic
CREATE TABLE help_topic (
  id                 uuid PRIMARY KEY,
  topic_key          text NOT NULL CONSTRAINT help_topic_topic_key UNIQUE CHECK (topic_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' AND char_length(topic_key) <= 80),
  screen_key         text NOT NULL CHECK (screen_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' AND char_length(screen_key) <= 80),
  ordinal            integer NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  title_en           text NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 120),
  title_ar           text NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 160),
  body_en            text NOT NULL CHECK (char_length(body_en) BETWEEN 1 AND 2000),
  body_ar            text NOT NULL CHECK (char_length(body_ar) BETWEEN 1 AND 2400),
  arabic_provisional boolean NOT NULL,
  source_refs        text[] NOT NULL CHECK (cardinality(source_refs) BETWEEN 1 AND 6
                       AND array_to_string(source_refs, ',') ~ '^(M0[0-9]{3}|B0[0-9]{3}|REQ-S[0-9]{2}-[0-9]{3})(,(M0[0-9]{3}|B0[0-9]{3}|REQ-S[0-9]{2}-[0-9]{3}))*$'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_topic_screen_ordinal_key UNIQUE (screen_key, ordinal)
);
GRANT SELECT ON help_topic TO mth_app;

-- The seed: product help for the P6 productivity features and the record states (REQ-S15-010, REQ-S15-011,
-- REQ-S15-013, REQ-S16-026). The English is the product text; the Arabic is a PROVISIONAL translation and says so
-- ("ترجمة مؤقتة"), pending Mobily review. No text quotes the playbook; source_refs name the requirement and the
-- master-prompt block each topic explains.
INSERT INTO help_topic (id, topic_key, screen_key, ordinal, title_en, title_ar, body_en, body_ar, arabic_provisional, source_refs) VALUES
  ('01920006-0410-7000-8000-000000000001', 'search.global', 'search', 1,
   'Searching records',
   'البحث في السجلات (ترجمة مؤقتة)',
   'Search looks through the titles, codes and descriptions of transformations, initiatives, KPIs, benefits, RAID entries, dependencies, decisions, deliverables, evidence, business cases, lessons and change requests. You only see records you are allowed to open. Results can be a short time behind the latest change; the page says so when the index is behind.',
   'يبحث البحث في عناوين ورموز وأوصاف التحولات والمبادرات ومؤشرات الأداء والمنافع وسجل المخاطر والاعتماديات والقرارات والمخرجات والأدلة ودراسات الجدوى والدروس وطلبات التغيير. لا تظهر لك إلا السجلات المسموح لك بفتحها. قد تتأخر النتائج قليلاً عن آخر تغيير، وتوضح الصفحة ذلك عند تأخر الفهرس. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010', 'M0303']),
  ('01920006-0410-7000-8000-000000000002', 'lists.saved_views', 'lists', 1,
   'Saved views',
   'طرق العرض المحفوظة (ترجمة مؤقتة)',
   'A saved view keeps the columns, filters and sort order of a list under a name. Your views are personal unless you share them; a shared view is visible to colleagues in your organization, but it never shows anyone a record they cannot already see.',
   'تحفظ طريقة العرض المحفوظة أعمدة القائمة وعوامل التصفية وترتيب الفرز تحت اسم. تبقى طرق العرض خاصة بك ما لم تشاركها؛ وتظهر طريقة العرض المشتركة لزملائك في مؤسستك، لكنها لا تُظهر لأي شخص سجلاً لا يستطيع رؤيته أصلاً. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010', 'REQ-S15-013', 'M0304']),
  ('01920006-0410-7000-8000-000000000003', 'lists.filter_chips', 'lists', 2,
   'Filters and chips',
   'عوامل التصفية والشرائح (ترجمة مؤقتة)',
   'Each active filter is shown as a chip above the list. Remove a chip to remove that filter. Filtering, sorting and paging are done by the server, so the counts and pages cover every matching record.',
   'يظهر كل عامل تصفية نشط كشريحة أعلى القائمة. أزل الشريحة لإزالة عامل التصفية. تتم التصفية والفرز والتقسيم إلى صفحات على الخادم، لذلك تشمل الأعداد والصفحات كل السجلات المطابقة. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-013', 'M0304']),
  ('01920006-0410-7000-8000-000000000004', 'lists.bulk_edit', 'lists', 3,
   'Bulk updates',
   'التحديثات المجمعة (ترجمة مؤقتة)',
   'A bulk update applies the same change to the records you select. Each record goes through the same checks as a single edit. If someone else changed one of the records since you loaded the list, that record is reported as a conflict and nothing is saved; reload it, review the change and apply your update again.',
   'يطبق التحديث المجمع التغيير نفسه على السجلات التي تختارها. يمر كل سجل بالفحوصات نفسها التي يمر بها التعديل الفردي. إذا غيّر شخص آخر أحد السجلات منذ تحميل القائمة، يُبلَّغ عن ذلك السجل كتعارض ولا يُحفظ شيء؛ أعد تحميله وراجع التغيير ثم طبّق تحديثك مرة أخرى. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010', 'REQ-S16-026']),
  ('01920006-0410-7000-8000-000000000005', 'lists.inline_edit', 'lists', 4,
   'Editing in the list',
   'التعديل داخل القائمة (ترجمة مؤقتة)',
   'Some columns can be edited directly in the list. Each change is saved as a normal edit of that record, with the same checks, and is refused if the record changed since you loaded it.',
   'يمكن تعديل بعض الأعمدة مباشرة داخل القائمة. يُحفظ كل تغيير كتعديل عادي لذلك السجل، بالفحوصات نفسها، ويُرفض إذا تغيّر السجل منذ تحميله. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010']),
  ('01920006-0410-7000-8000-000000000006', 'records.drafts', 'records', 1,
   'Drafts',
   'المسودات (ترجمة مؤقتة)',
   'A form you have started is kept on the server as your draft, so it survives a reload or a closed browser. A draft is labelled ''Draft - not submitted''. Only you can see it, and it is never counted in approved figures until you submit it.',
   'يُحفظ النموذج الذي بدأته على الخادم كمسودة خاصة بك، فيبقى بعد إعادة تحميل الصفحة أو إغلاق المتصفح. تحمل المسودة التسمية ''مسودة - لم تُقدَّم''. لا يراها غيرك، ولا تُحتسب أبداً في الأرقام المعتمدة حتى تقدّمها. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010', 'REQ-S15-011']),
  ('01920006-0410-7000-8000-000000000007', 'records.compare_reapply', 'records', 2,
   'Conflicts: compare and reapply',
   'التعارضات: المقارنة وإعادة التطبيق (ترجمة مؤقتة)',
   'If someone saved the same record after you opened it, your save is refused instead of overwriting their change. The screen then compares your changes with theirs, field by field. Reapply keeps their change and saves only the fields you changed, after you choose what to keep where you both changed the same field.',
   'إذا حفظ شخص آخر السجل نفسه بعد فتحك له، يُرفض حفظك بدلاً من الكتابة فوق تغييره. تعرض الشاشة بعد ذلك مقارنة بين تغييراتك وتغييراته حقلاً بحقل. تحافظ إعادة التطبيق على تغييره وتحفظ الحقول التي غيّرتها أنت فقط، بعد أن تختار ما تريد الإبقاء عليه حيث غيّر كلاكما الحقل نفسه. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S16-026', 'M0329']),
  ('01920006-0410-7000-8000-000000000008', 'records.version_compare', 'records', 3,
   'Comparing versions',
   'مقارنة الإصدارات (ترجمة مؤقتة)',
   'Version history lists who changed a record and when. Compare shows which fields differ between two versions. Values are shown to people who can edit the record or read the audit trail; other readers see which fields changed.',
   'يعرض سجل الإصدارات من غيّر السجل ومتى. تعرض المقارنة الحقول المختلفة بين إصدارين. تظهر القيم لمن يستطيع تعديل السجل أو قراءة سجل التدقيق؛ ويرى القراء الآخرون أسماء الحقول التي تغيّرت. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010']),
  ('01920006-0410-7000-8000-000000000009', 'records.states', 'records', 4,
   'What the record states mean',
   'معنى حالات السجل (ترجمة مؤقتة)',
   'Every record shows its state. Stale means the data is older than its refresh rule; Unknown means no value is available. Neither is shown as zero or as green. A conflict means someone else saved first; no access means you are not allowed to see the record.',
   'يعرض كل سجل حالته. تعني "قديمة" أن البيانات أقدم من قاعدة تحديثها، وتعني "غير معروفة" أنه لا تتوفر قيمة. لا تظهر أي منهما كصفر أو باللون الأخضر. ويعني التعارض أن شخصاً آخر حفظ أولاً، ويعني عدم الوصول أنه غير مسموح لك برؤية السجل. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-011', 'M0303']),
  ('01920006-0410-7000-8000-00000000000a', 'navigation.breadcrumbs', 'navigation', 1,
   'Where am I?',
   'أين أنا؟ (ترجمة مؤقتة)',
   'The breadcrumb trail above the page title shows the area, the transformation and the record you are in. Select any part of it to go back to that level.',
   'يعرض مسار التنقل أعلى عنوان الصفحة المجال والتحول والسجل الذي أنت فيه. اختر أي جزء منه للعودة إلى ذلك المستوى. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S15-010', 'M0303']),
  ('01920006-0410-7000-8000-00000000000b', 'reports.exports_async', 'reports', 1,
   'Long exports',
   'عمليات التصدير الطويلة (ترجمة مؤقتة)',
   'Large exports run in the background. You get a job straight away and can watch its progress. When it finishes you are notified, and only you can download the file.',
   'تعمل عمليات التصدير الكبيرة في الخلفية. تحصل على مهمة فوراً ويمكنك متابعة تقدمها. عند انتهائها يصلك إشعار، ولا يمكن لغيرك تنزيل الملف. (ترجمة مؤقتة)',
   true, ARRAY['REQ-S20-030', 'M0398']);

-- ------------------------------------------------------------------------------------------------ load_dataset_marker
CREATE TABLE load_dataset_marker (
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  dataset_code       text NOT NULL CHECK (dataset_code = 'mth_load_v1'),
  generator_version  text NOT NULL CHECK (generator_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  random_seed        bigint NOT NULL CHECK (random_seed >= 0),
  transformations    integer NOT NULL CHECK (transformations >= 1),
  initiatives        integer NOT NULL CHECK (initiatives >= 0),
  kpi_actuals        integer NOT NULL CHECK (kpi_actuals >= 0),
  audit_events       integer NOT NULL CHECK (audit_events >= 0),
  users              integer NOT NULL CHECK (users >= 1),
  generated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT p2_attach_append_only('load_dataset_marker');
GRANT SELECT ON load_dataset_marker TO mth_app;

-- The marker is written into an empty database only: no deployment_environment row (never a production or demo
-- database, ADR-0050 §1), no transformation and no user yet.
CREATE FUNCTION load_dataset_marker_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM deployment_environment) OR EXISTS (SELECT 1 FROM transformation)
     OR EXISTS (SELECT 1 FROM app_user) THEN
    RAISE EXCEPTION 'load_dataset_marker: the load dataset is generated only into an empty database without a production or demo marker'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'load_dataset_marker_empty_database';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER load_dataset_marker_guard BEFORE INSERT ON load_dataset_marker
  FOR EACH ROW EXECUTE FUNCTION load_dataset_marker_guard();
