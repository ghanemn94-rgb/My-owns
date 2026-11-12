-- 0145 P7 slice E: the backup sets reported by the backup job (T-DG7-ARCH-03; ADR-0066 §6). Authored by
-- solution-architect. Runs as mth_owner inside one transaction opened by `mth-db migrate`. Forward-only: never edit once
-- merged. SQL floor: PostgreSQL 16.
--
-- REQ-S19-012 ("backup and restore procedures cover the database, evidence storage, audit, snapshots and job state";
-- acceptance "A19: a restore from backup recovers database, evidence and job state with documented checks and timings").
--   backup_set             one backup set the backup job produced (deploy/scripts/backup.sh, the `backup` Compose
--                          profile on the pinned postgres:18 image), or one that failed. Written ONLY through
--                          backup_set_record(jsonb), which the backup script calls as the owner role with psql after it
--                          has verified the set's manifest; mth_app may only read (listBackupSets). Append-only; the
--                          function writes the audit event (backup.recorded) in the same transaction.
-- The row is written after the dump, so a set never lists itself; restoring an older set restores the backup_set rows
-- as they were when it was taken (ADR-0066 Residual 2). The table holds checksums and counts only: no path to a
-- credential, no file content.
-- Nothing here reads or writes DG0-DG7. No code grants a business, Finance or IT approval.

CREATE TABLE backup_set (
  id                          uuid PRIMARY KEY,
  label                       text NOT NULL CHECK (label ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  status                      text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  manifest_schema_version     text NOT NULL CHECK (manifest_schema_version = 'mth-backup/1'),
  started_at                  timestamptz NOT NULL,
  finished_at                 timestamptz NOT NULL,
  migration_level             text NULL CHECK (migration_level IS NULL OR migration_level ~ '^[0-9]{4}_[a-z0-9_]+$'),
  server_major                integer NULL CHECK (server_major IS NULL OR server_major BETWEEN 16 AND 99),
  dump_format                 text NULL CHECK (dump_format IS NULL OR dump_format = 'custom'),
  dump_bytes                  bigint NULL CHECK (dump_bytes IS NULL OR dump_bytes > 0),
  dump_sha256                 text NULL CHECK (dump_sha256 IS NULL OR dump_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_backend            text NULL CHECK (evidence_backend IS NULL OR evidence_backend IN ('filesystem', 's3')),
  evidence_object_count       integer NULL CHECK (evidence_object_count IS NULL OR evidence_object_count >= 0),
  evidence_bytes              bigint NULL CHECK (evidence_bytes IS NULL OR evidence_bytes >= 0),
  attachment_manifest_sha256  text NULL CHECK (attachment_manifest_sha256 IS NULL
                                OR attachment_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  config_bundle_sha256        text NULL CHECK (config_bundle_sha256 IS NULL OR config_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256             text NULL CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'),
  failure_reason              text NULL CHECK (failure_reason IS NULL OR char_length(failure_reason) BETWEEN 1 AND 1000),
  operator_name               text NOT NULL CHECK (char_length(operator_name) BETWEEN 1 AND 200),
  recorded_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_set_label_key UNIQUE (label),
  CONSTRAINT backup_set_times CHECK (finished_at >= started_at),
  CONSTRAINT backup_set_succeeded_shape CHECK (status <> 'succeeded' OR (migration_level IS NOT NULL
    AND server_major IS NOT NULL AND dump_format IS NOT NULL AND dump_bytes IS NOT NULL AND dump_sha256 IS NOT NULL
    AND evidence_backend IS NOT NULL AND evidence_object_count IS NOT NULL AND evidence_bytes IS NOT NULL
    AND attachment_manifest_sha256 IS NOT NULL AND config_bundle_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL
    AND failure_reason IS NULL)),
  CONSTRAINT backup_set_failed_shape CHECK (status <> 'failed' OR failure_reason IS NOT NULL)
);
CREATE INDEX backup_set_finished_idx ON backup_set (finished_at DESC, id);
SELECT p2_attach_guards('backup_set', true);
SELECT p2_attach_append_only('backup_set');
GRANT SELECT ON backup_set TO mth_app;

-- The backup script's one write (ADR-0066 §6). Owner only: never granted to mth_app. The argument is the set's
-- summary (ADR-0066 §6: fields of backup-manifest.json plus that file's own SHA-256); unknown keys are refused.
CREATE FUNCTION backup_set_record(p jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  allowed text[] := ARRAY['id', 'label', 'status', 'manifestSchemaVersion', 'startedAt', 'finishedAt',
    'migrationLevel', 'serverMajor', 'dumpFormat', 'dumpBytes', 'dumpSha256', 'evidenceBackend',
    'evidenceObjectCount', 'evidenceBytes', 'attachmentManifestSha256', 'configBundleSha256', 'manifestSha256',
    'failureReason', 'operatorName'];
  extra text;
  new_id uuid := (p ->> 'id')::uuid;
BEGIN
  IF jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'backup_set_record: the argument is a JSON object' USING ERRCODE = 'check_violation';
  END IF;
  SELECT k INTO extra FROM jsonb_object_keys(p) AS k WHERE NOT k = ANY (allowed) LIMIT 1;
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'backup_set_record: unknown key %', extra USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO backup_set (id, label, status, manifest_schema_version, started_at, finished_at, migration_level,
    server_major, dump_format, dump_bytes, dump_sha256, evidence_backend, evidence_object_count, evidence_bytes,
    attachment_manifest_sha256, config_bundle_sha256, manifest_sha256, failure_reason, operator_name)
  VALUES (new_id, p ->> 'label', p ->> 'status', p ->> 'manifestSchemaVersion', (p ->> 'startedAt')::timestamptz,
    (p ->> 'finishedAt')::timestamptz, p ->> 'migrationLevel', (p ->> 'serverMajor')::integer, p ->> 'dumpFormat',
    (p ->> 'dumpBytes')::bigint, p ->> 'dumpSha256', p ->> 'evidenceBackend', (p ->> 'evidenceObjectCount')::integer,
    (p ->> 'evidenceBytes')::bigint, p ->> 'attachmentManifestSha256', p ->> 'configBundleSha256',
    p ->> 'manifestSha256', p ->> 'failureReason', p ->> 'operatorName');
  INSERT INTO audit_event (id, actor_type, action, record_type, record_id, source, changes)
  VALUES (mth_uuid_v7(), 'system', 'backup.recorded', 'backup_set', new_id, 'cli',
          jsonb_build_object('label', p ->> 'label', 'status', p ->> 'status', 'manifestSha256', p ->> 'manifestSha256'));
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION backup_set_record(jsonb) FROM PUBLIC;

INSERT INTO retention_table_class (table_name, retention_class_id, key_columns) VALUES
  ('backup_set', '01930000-0000-7000-8000-000000143006', '{id}');
