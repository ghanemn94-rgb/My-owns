\set VERBOSITY terse
\echo '-- fixture (owner): org, 2 users, BU, transformation; then p2_instantiate_transformation as the API would call it'
\i $TMPDIR/p/fixture.sql
SET ROLE mth_app;
BEGIN;
SELECT 'instantiate created ' || p2_instantiate_transformation('01920000-1000-7000-8000-000000000005','01920000-1000-7000-8000-000000000002','req-probe','api') || ' rows';
COMMIT;
SELECT 'instantiate again (idempotent) created ' || p2_instantiate_transformation('01920000-1000-7000-8000-000000000005','01920000-1000-7000-8000-000000000002','req-probe2','api') || ' rows';
\echo '-- P1: INSERT a value_pool WITH its audit event -> must COMMIT'
BEGIN;
INSERT INTO value_pool (id, organization_id, transformation_id, name, currency, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000001','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','Pool A','SAR','01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source) VALUES ('01920000-2000-7000-8000-0000000000a1','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','user','01920000-1000-7000-8000-000000000002','value_pool.create','value_pool','01920000-2000-7000-8000-000000000001',1,'api');
COMMIT;
SELECT 'value_pool rows: ' || count(*) || ', status ' || max(quantification_status) || ', upside ' || coalesce(max(upside_amount)::text,'NULL (unquantified, not zero)') FROM value_pool;
\echo '-- P2: INSERT a value_pool WITHOUT an audit event -> must FAIL at COMMIT (audit_required)'
BEGIN;
INSERT INTO value_pool (id, organization_id, transformation_id, name, currency, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000002','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','Pool B','SAR','01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
SELECT 'insert accepted inside the transaction (check deferred to COMMIT)';
COMMIT;
SELECT 'value_pool rows after failed commit: ' || count(*) FROM value_pool;
\echo '-- P3: UPDATE with version not stepping by 1 -> must FAIL (version_step)'
UPDATE value_pool SET name = 'Pool A2', version = version + 2 WHERE id = '01920000-2000-7000-8000-000000000001';
\echo '-- P3b: UPDATE keeping the same version -> must FAIL (version_step)'
UPDATE value_pool SET name = 'Pool A2' WHERE id = '01920000-2000-7000-8000-000000000001';
\echo '-- P4: UPDATE stepping by 1 but without audit event -> must FAIL at COMMIT'
UPDATE value_pool SET name = 'Pool A2', version = version + 1 WHERE id = '01920000-2000-7000-8000-000000000001';
\echo '-- P5: quantified value pool with a missing downside -> must FAIL (value_pool_quantification)'
BEGIN;
UPDATE value_pool SET quantification_status='quantified', upside_amount=1000000.50, version = version + 1 WHERE id = '01920000-2000-7000-8000-000000000001';
ROLLBACK;
\echo '-- P6: charter INSERT with audit event but WITHOUT a charter_version snapshot -> must FAIL at COMMIT'
BEGIN;
INSERT INTO charter (id, organization_id, transformation_id, transformation_name, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000010','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','Probe','01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source) VALUES ('01920000-2000-7000-8000-0000000000b1','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','user','01920000-1000-7000-8000-000000000002','charter.create','charter','01920000-2000-7000-8000-000000000010',1,'api');
COMMIT;
\echo '-- P7: charter INSERT with audit event AND charter_version 1 -> must COMMIT'
BEGIN;
INSERT INTO charter (id, organization_id, transformation_id, transformation_name, baseline_date, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000010','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','Probe','2026-01-31','01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
INSERT INTO charter_version (id, organization_id, transformation_id, charter_id, version_no, transformation_name, baseline_date, saved_by) VALUES ('01920000-2000-7000-8000-000000000011','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','01920000-2000-7000-8000-000000000010',1,'Probe','2026-01-31','01920000-1000-7000-8000-000000000002');
INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source) VALUES ('01920000-2000-7000-8000-0000000000b2','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','user','01920000-1000-7000-8000-000000000002','charter.create','charter','01920000-2000-7000-8000-000000000010',1,'api');
COMMIT;
SELECT 'charter versions: ' || count(*) FROM charter_version;
\echo '-- P8: UPDATE / DELETE on the history table charter_version -> must FAIL (append-only)'
UPDATE charter_version SET transformation_name = 'tampered' WHERE charter_id = '01920000-2000-7000-8000-000000000010';
DELETE FROM charter_version WHERE charter_id = '01920000-2000-7000-8000-000000000010';
\echo '-- P9: invalid baseline date -> must FAIL (date type)'
UPDATE charter SET baseline_date = '2026-02-30', version = version + 1 WHERE id = '01920000-2000-7000-8000-000000000010';
\echo '-- P10: T02 row without target date -> must FAIL (not-null)'
INSERT INTO outcome_kpi (id, organization_id, transformation_id, outcome_id, kpi_definition_id, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000020','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','01920000-2000-7000-8000-000000000021','01920000-2000-7000-8000-000000000022','01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
\echo '-- P11: T01 confidence outside H/M/L -> must FAIL (check)'
UPDATE diagnostic_item SET confidence = 'X', version = version + 1 WHERE transformation_id = '01920000-1000-7000-8000-000000000005' AND dimension_code = 'data';
\echo '-- P12: T03 gap without dimension -> must FAIL (not-null)'
INSERT INTO tom_gap (id, organization_id, transformation_id, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000030','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
\echo '-- P13: gate decision by the SUBMITTER -> must FAIL (gate_decision_not_submitter, maps to 403)'
BEGIN;
INSERT INTO gate_submission (id, organization_id, transformation_id, gate_instance_id, gate_code, submission_no, submitted_by, approver_role_code, snapshot, snapshot_sha256, created_by, updated_by)
  SELECT '01920000-2000-7000-8000-000000000040', organization_id, transformation_id, id, 'G1', 1, '01920000-1000-7000-8000-000000000002', 'SP', '{}'::jsonb, repeat('a',64), '01920000-1000-7000-8000-000000000002', '01920000-1000-7000-8000-000000000002' FROM gate_instance WHERE gate_code='G1';
INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, source) VALUES ('01920000-2000-7000-8000-0000000000c1','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','user','01920000-1000-7000-8000-000000000002','gate_submission.create','gate_submission','01920000-2000-7000-8000-000000000040',1,'api');
COMMIT;
BEGIN;
INSERT INTO decision (id, organization_id, transformation_id, kind, code, title, status, decided_by, decided_at, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000050','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','gate','GD-01','G1 decision','decided','01920000-1000-7000-8000-000000000002',now(),'01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
INSERT INTO gate_decision (id, organization_id, transformation_id, gate_submission_id, decision_id, gate_code, submission_no, outcome, rationale, decided_by, approver_basis, approver_role_code) VALUES ('01920000-2000-7000-8000-000000000051','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','01920000-2000-7000-8000-000000000040','01920000-2000-7000-8000-000000000050','G1',1,'approved','looks good','01920000-1000-7000-8000-000000000002','default_role','SP');
ROLLBACK;
\echo '-- P14: gate decision on a stale submission_no -> must FAIL (gate_decision_current_submission, maps to 409)'
BEGIN;
INSERT INTO decision (id, organization_id, transformation_id, kind, code, title, status, decided_by, decided_at, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000050','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','gate','GD-01','G1 decision','decided','01920000-1000-7000-8000-000000000003',now(),'01920000-1000-7000-8000-000000000003','01920000-1000-7000-8000-000000000003');
INSERT INTO gate_decision (id, organization_id, transformation_id, gate_submission_id, decision_id, gate_code, submission_no, outcome, rationale, decided_by, approver_basis, approver_role_code) VALUES ('01920000-2000-7000-8000-000000000051','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','01920000-2000-7000-8000-000000000040','01920000-2000-7000-8000-000000000050','G1',2,'approved','looks good','01920000-1000-7000-8000-000000000003','default_role','SP');
ROLLBACK;
\echo '-- P15: file_reference evidence marked verified -> must FAIL (evidence_filename_never_verified)'
INSERT INTO evidence (id, organization_id, transformation_id, kind, title, file_name, owner_user_id, review_status, accessibility_status, reviewed_by, reviewed_at, created_by, updated_by) VALUES ('01920000-2000-7000-8000-000000000060','01920000-1000-7000-8000-000000000001','01920000-1000-7000-8000-000000000005','file_reference','Deck','deck.pptx','01920000-1000-7000-8000-000000000002','verified','accessible','01920000-1000-7000-8000-000000000003',now(),'01920000-1000-7000-8000-000000000002','01920000-1000-7000-8000-000000000002');
\echo '-- P16: mth_app DELETE on a P2 business table -> must FAIL (no privilege)'
DELETE FROM value_pool;
\echo '-- P17: TRUNCATE gate_decision as owner -> must FAIL (append-only)'
RESET ROLE; SET ROLE mth_owner;
TRUNCATE gate_decision;
