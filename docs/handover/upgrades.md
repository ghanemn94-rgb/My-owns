# Upgrades: dry run, maintenance window and rollback by restore

- **Audience:** Mobily IT operators of the Mobily Transformation Hub.
- **Design:** ADR-0068 (`docs/architecture/adr/ADR-0068-p7-upgrades-migration-dry-run-irreversible-catalogue-maintenance-window-rollback-by-restore.md`). Backup and restore: ADR-0066 and `docs/handover/backup-restore.md`.
- **Requirement:** REQ-S19-013.
- **Approvals.** An upgrade of a Mobily installation is an IT change that Mobily IT authorizes outside this platform. Nothing in this guide, in a dry-run report or in the catalogue approves an upgrade. The product's business gates (G1–G6) have nothing to do with upgrades.
- **Scope of the evidence.** The procedure below was exercised by an automated test on a local disposable PostgreSQL cluster (see "What was tested"). A local test is not proof of high-availability production readiness. Run times on production volumes are unknown until the dry run measures them on a restored copy of production.

## 1. Principles

1. **Migrations are forward-only.** There is no down migration (ADR-0003). `mth-db migrate` applies each pending file in id order, one transaction per file. It refuses an applied file whose content changed, an applied file this release does not ship, and a pending file whose id is not above the highest applied id.
2. **The supported rollback of any upgrade is a restore.** You restore the pre-upgrade backup set into a fresh database and storage (ADR-0066 §7), then run the previous release. This holds for every migration, including the additive ones: the previous release is not promised to run on a newer schema.
3. **Every upgrade is a maintenance window.** No online (zero-downtime) upgrade is supported.
4. **Cross-major PostgreSQL is a separate procedure** (D-243 Q14). Dump with the newer client, restore into the new major, then run the restore checks. Never combine it with an application upgrade in one window.

## 2. The dry run: `mth-db migrate --dry-run`

The dry run applies the pending migrations of the new release to a **throw-away copy of a restored copy**, then reports what changed. It never runs the migrations on the database you point it at.

**Target.** Point it at a restored copy of the installation you plan to upgrade, never at the live database.

**What it needs:**

| Setting | Meaning |
| --- | --- |
| `DATABASE_OWNER_URL` (or `_FILE`) | The owner role (`mth_owner`) on the **restored copy**. |
| `DRY_RUN_ADMIN_DATABASE_URL` (or `DRY_RUN_ADMIN_DATABASE_URL_FILE`) | A role with `CREATEDB` on the copy's cluster that can create databases owned by `mth_owner`. Provide it at run time. Never store it in the repository. |
| Disk | Room for one more copy of the database (the throw-away copy). |
| Sessions | No other session may be connected to the restored copy: `CREATE DATABASE … TEMPLATE` refuses a template that has one. |

**Command** (from the release's source tree, or in the application image with `mth db migrate --dry-run …`):

```sh
mth-db migrate --dry-run --report dry-run-report.json \
  [--catalogue docs/handover/migration-catalogue.json] \
  [--i-confirm-this-is-a-restored-copy]
```

- `--report FILE` writes the JSON report (`mth-migrate-dry-run/1`). The command prints its SHA-256.
- `--catalogue FILE` is the migration catalogue of the release (section 4). From the source tree the command finds `docs/handover/migration-catalogue.json` on its own. The application image ships no `docs/`, so pass the file from the release archive there. Without a catalogue, or when the catalogue names another version of a file, the class of that migration is reported as `unknown`, never as `additive`.
- `--i-confirm-this-is-a-restored-copy`: a restored copy of production keeps its production marker. The dry run refuses a production-marked database without this flag. A database with no `deployment_environment` row counts as production too, which is how the product itself treats it.

**What it does:**

1. It reads the copy's migration status, with the same refusals as `migrate`. If the copy is refused, nothing is created.
2. It captures the copy's catalogue snapshot and the exact row count of every table.
3. It creates `<copy>_dryrun_<utc>` from the copy (`CREATE DATABASE … TEMPLATE … OWNER mth_owner`).
4. It applies the pending migrations there with the real migration runner and times each file.
5. It captures the snapshot and row counts again and diffs them.
6. It **always** drops the throw-away database, also after a failing migration. It then checks that the copy's `schema_migration` is unchanged.

**The catalogue snapshot** covers the `public` and `pgboss` schemas. It includes:

- tables and views;
- columns, with their type, nullability and default;
- constraints and indexes;
- triggers, with their definition, enabled state and deferrability;
- functions, with their signature, security mode, result and a SHA-256 of the body;
- the table, column and function privileges of `mth_app`;
- `schema_migration`.

**The report** gives:

- the source level and the target level;
- every pending migration with its catalogue class, status (`applied`, `failed`, `not_attempted`), seconds and, for a failed file, the PostgreSQL error;
- the diff per category (`added`, `removed`, `changed`);
- the tables whose row count changed, as decimal strings (`null` = absent or unreadable, never 0);
- whether the throw-away database was dropped, and whether the source is unchanged.

**Exit codes and lines** (p7-work-split E.5):

| Exit | Line |
| --- | --- |
| 0 | `mth-db migrate --dry-run: <n> pending migration(s) applied to a throw-away copy in <s> s; the source is unchanged` |
| 1 | `mth-db migrate --dry-run: <name> failed: <error>; <k> not attempted; the source is unchanged` |
| 2 | `mth-db migrate --dry-run: refused: this database is marked production; run it on a restored copy and pass --i-confirm-this-is-a-restored-copy` |
| 2 | `mth-db migrate --dry-run: refused: <reason>`: for example, an applied file changed, the copy has other sessions, or `DRY_RUN_ADMIN_DATABASE_URL` is not set |

Exit 1 is also used when the throw-away database cannot be dropped. The line then names it, so you can drop it by hand.

## 3. The maintenance window

1. **Before the window.**
   1. Take a backup set of production (ADR-0066; `docs/handover/backup-restore.md`).
   2. Restore it into a staging database.
   3. Run `mth-db migrate --dry-run` on the restored copy.
   4. Read the report, and the catalogue row of every pending migration (section 4). Pay particular attention to the irreversible ones.
   5. Mobily IT approves the change outside the platform.
2. **Open the window.**
   1. Announce it.
   2. Stop the API and the worker: `docker compose stop api worker`.
   3. Wait until the worker has stopped. Its heartbeat goes stale, and pg-boss keeps queued jobs in the database.
3. **Take the pre-upgrade backup set** with the services stopped, so the set is quiet. Record its label and its manifest SHA-256.
4. **Upgrade.**
   1. Load the new images (the ADR-0062 image bundle).
   2. Run the `migrate` service.
   3. Start `api` and `worker`.
   4. Check `/readyz` and run the smoke test (`deploy/scripts/smoke.mjs`, Compose profile `smoke`).
5. **Rollback by restore** (when step 4 or the smoke test fails).
   1. Stop the services.
   2. Restore the pre-upgrade set into a **fresh** database and storage. A restore never overwrites (ADR-0066 §7).
   3. Point the stack at the restored database and storage.
   4. Start the **previous** images and check `/readyz`.

   Data written between step 3 and the rollback is lost. With the services stopped there is none.
6. **Close the window.** Record the timing of each step.

## 4. The migration catalogue

`docs/handover/migration-catalogue.json` (`mth-migration-catalogue/1`) has one entry for every file `0001`–last in `packages/db/migrations/`. Each entry gives the `id`, `name`, `sha256`, `stage`, `class`, `irreversible`, `reasons` and `recovery`. The file and the table below are generated by `node tools/release/migration-catalogue.mjs`. `node tools/release/migration-catalogue.mjs --check` fails when either differs from a fresh generation. The test `tools/release/tests/migration-catalogue.test.mjs` also checks it.

**Classes** (ADR-0068 §3):

- **`additive`** creates or adds only: tables, columns, indexes, functions, triggers, grants and seed `INSERT … VALUES`.
- **`data_rewrite`** changes existing rows, or replaces an object that an earlier file created. Rows are changed by `UPDATE`, `DELETE`, `INSERT … SELECT`, a function called for each existing row (`SELECT f(…) FROM t`), or a data-changing statement in a `DO` block. Replacements are `CREATE OR REPLACE FUNCTION`, `VIEW` or `TRIGGER`.
- **`destructive`** drops or renames: `DROP …` (including `DROP CONSTRAINT`, `DROP NOT NULL`), `TRUNCATE`, `ALTER … TYPE`, `RENAME` and `REVOKE`. A `REVOKE` on an object the same file creates is hardening and does not count.

**Irreversible** means `data_rewrite` or `destructive`. Its recovery is the restore of the pre-upgrade backup set and the previous release.

**How the scanner works.** The scanner is heuristic (ADR-0068 Residual 1), and it errs towards "irreversible":

- It strips comments, string literals and function bodies, so trigger code that contains `UPDATE` does not count.
- It scans `DO` blocks, because their code runs during the migration.
- It does not classify a top-level `SELECT f(…)` without `FROM`. For example, `p2_attach_guards('t')` stays additive.
- `tools/release/migration-catalogue.overrides.json` may raise a class or add a recovery note. Each override needs a reason of at least 20 characters, and an override never lowers a class. This release has no override.

A reviewer should read the `data_rewrite` rows.

<!-- migration-catalogue:begin (generated by tools/release/migration-catalogue.mjs; do not edit) -->

132 migrations: 73 additive, 38 data_rewrite, 21 destructive.

| Id | Migration | Stage | Class | Why (scanner and overrides) | Recovery |
| --- | --- | --- | --- | --- | --- |
| 0001 | `0001_identity_access.sql` | p1 | destructive | REVOKE on schema public | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0007 | `0007_oidc_login_browser_binding.sql` | p1 | data_rewrite | DELETE FROM oidc_login_state | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0011 | `0011_p2_methodology_catalogue.sql` | p2 | data_rewrite | INSERT … SELECT into methodology_version | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0018 | `0018_p2_access_instantiation.sql` | p2 | data_rewrite | backfill: p2_instantiate_transformation(…) for each row of transformation | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0020 | `0020_p3_portfolio_roadmap.sql` | p3 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0022 | `0022_p3_dependency_capacity_funding.sql` | p3 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0024 | `0024_p3_gates_access_instantiation.sql` | p3 | data_rewrite | backfill: p3_instantiate_transformation(…) for each row of transformation | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0025 | `0025_p3_g1_agreement_guard.sql` | p3 | data_rewrite | replaces function p3_instantiate_transformation | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0026 | `0026_p3_enable_g4.sql` | p3 | data_rewrite | UPDATE gate_definition | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0028 | `0028_p4_calendar_jobs_work_items.sql` | p4 | data_rewrite | backfill: p4_ensure_default_calendar(…) for each row of organization; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0030 | `0030_p4_decision_rights_raci.sql` | p4 | data_rewrite | INSERT … SELECT into raci_template_cell; backfill: p4_instantiate_transformation(…) for each row of transformation | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0036 | `0036_p4_kpi_permissions_backfill.sql` | p4 | data_rewrite | DO block: UPDATE target_trajectory; DO block: INSERT … SELECT into target_trajectory | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0037 | `0037_p4_benefit_register.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0041 | `0041_p4_raid_actions_corrective.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0044 | `0044_p4_forums_meetings.sql` | p4 | data_rewrite | replaces function p4_instantiate_transformation; backfill: p4_instantiate_forums(…) for each row of transformation | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0047 | `0047_p4_adoption.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0048 | `0048_p4_sustainment.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0050 | `0050_p4_sustainment_schedules.sql` | p4 | data_rewrite | INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0051 | `0051_p4_phases_gates_g5_g6_exceptions.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0052 | `0052_p4_change_control.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0054 | `0054_p4_gate_exception_expiry_schedule.sql` | p4 | data_rewrite | INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0055 | `0055_p4_traceability_modular_structure.sql` | p4 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0059 | `0059_p4_enable_g5_g6.sql` | p4 | data_rewrite | UPDATE gate_definition | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0060 | `0060_p4_governance_schedules_weekly_cadence.sql` | p4 | destructive | INSERT … SELECT into audit_event; DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0061 | `0061_p4_finance_validation_correction_step.sql` | p4 | data_rewrite | replaces function finance_validation_guard | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0063 | `0063_p5_pins_methodology_migrations.sql` | p5 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0065 | `0065_p5_scoring_defaults_instantiation.sql` | p5 | destructive | DROP CONSTRAINT; replaces function p3_instantiate_transformation | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0068 | `0068_p5_form_schemas_framework.sql` | p5 | destructive | DROP CONSTRAINT; replaces function methodology_element_guard | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0069 | `0069_p5_procedures.sql` | p5 | data_rewrite | INSERT … SELECT into procedure_step_definition | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0070 | `0070_p5_forms_procedures_permissions_coverage.sql` | p5 | data_rewrite | INSERT … SELECT into methodology_coverage_link | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0071 | `0071_p5_choice_multiple_values.sql` | p5 | data_rewrite | replaces function form_custom_value_guard | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0072 | `0072_p5_procedure_step_approval_type.sql` | p5 | data_rewrite | replaces function procedure_instance_guard | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0074 | `0074_p5_automation_engine.sql` | p5 | data_rewrite | INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0075 | `0075_p5_starters_routes_policies.sql` | p5 | data_rewrite | INSERT … SELECT into audit_event; INSERT … SELECT into automation_rule; INSERT … SELECT into automation_rule_version; UPDATE work_item_kind | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0080 | `0080_p5_reports_snapshots_updates.sql` | p5 | data_rewrite | INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0085 | `0085_p5_kpi_restatements_financial_metrics.sql` | p5 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0086 | `0086_p5_launch_plans_health_checks.sql` | p5 | destructive | DROP CONSTRAINT; replaces function methodology_element_guard; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0088 | `0088_p5_launch_health_source_working.sql` | p5 | data_rewrite | DO block: UPDATE source_element | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0093 | `0093_p5_roaming_example_source_working.sql` | p5 | data_rewrite | DO block: UPDATE source_element | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0094 | `0094_p5_gate_approver_configured.sql` | p5 | data_rewrite | UPDATE gate_instance | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0095 | `0095_p5_procedures_v2_baseline_assignee.sql` | p5 | data_rewrite | INSERT … SELECT into procedure_definition; INSERT … SELECT into procedure_step_definition; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0096 | `0096_p5_intake_adopts_transformation.sql` | p5 | destructive | DROP TRIGGER | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0097 | `0097_p5_config_review_contributors.sql` | p5 | data_rewrite | INSERT … SELECT into methodology_version_contributor; INSERT … SELECT into automation_rule_version_contributor; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0114 | `0114_p6_job_service_identities.sql` | p6 | data_rewrite | INSERT … SELECT into service_identity; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0115 | `0115_p6_search_index_jobs.sql` | p6 | data_rewrite | INSERT … SELECT into audit_event; INSERT … SELECT into service_identity | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0116 | `0116_p6_connector_run_jobs.sql` | p6 | data_rewrite | INSERT … SELECT into audit_event; INSERT … SELECT into service_identity | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0117 | `0117_p6_operations_triggers_freshness.sql` | p6 | data_rewrite | replaces function automation_rule_version_guard; UPDATE automation_rule; INSERT … SELECT into audit_event; UPDATE automation_rule_version; INSERT … SELECT into service_identity | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0120 | `0120_p6_audit_required_index_use.sql` | p6 | data_rewrite | replaces function p2_audit_required | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0121 | `0121_p6_notification_fanout_jobs.sql` | p6 | data_rewrite | INSERT … SELECT into audit_event; INSERT … SELECT into service_identity | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0122 | `0122_p6_automation_rule_enablement.sql` | p6 | data_rewrite | INSERT … SELECT into automation_rule_enablement | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0123 | `0123_p6_automation_rule_enablement_disable.sql` | p6 | destructive | DROP CONSTRAINT; INSERT … SELECT into automation_rule_enablement; replaces function automation_rule_enablement_record | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0124 | `0124_p6_export_live_selection_pending.sql` | p6 | destructive | DROP NOT NULL; DROP CONSTRAINT; replaces function export_job_guard | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0125 | `0125_p6_export_assembly_attempts.sql` | p6 | data_rewrite | replaces function export_job_guard | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0129 | `0129_p6_assistant_context_insert_rule.sql` | p6 | destructive | replaces function p6_assistant_context_records_valid; DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0130 | `0130_p6_seeded_text_business_terms.sql` | p6 | data_rewrite | WITH … data-changing statement; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0143 | `0143_p7_retention_classes.sql` | p7 | data_rewrite | INSERT … SELECT into retention_table_class | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0147 | `0147_p7_transfer_export_job.sql` | p7 | data_rewrite | INSERT … SELECT into service_identity; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0148 | `0148_p7_retention_job.sql` | p7 | data_rewrite | INSERT … SELECT into service_identity; INSERT … SELECT into audit_event | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |
| 0149 | `0149_p7_transfer_import_load.sql` | p7 | destructive | DROP CONSTRAINT | Irreversible: restore the pre-upgrade backup set (ADR-0066 §7) into a fresh database and storage, and run the previous release. |

Additive (73): 0002, 0003, 0004, 0005, 0006, 0008, 0009, 0010, 0012, 0013, 0014, 0015, 0016, 0017, 0019, 0021, 0023, 0027, 0029, 0031, 0032, 0033, 0034, 0035, 0038, 0039, 0040, 0042, 0043, 0045, 0046, 0049, 0053, 0056, 0057, 0058, 0062, 0064, 0076, 0081, 0082, 0087, 0089, 0090, 0091, 0092, 0098, 0099, 0100, 0101, 0102, 0103, 0104, 0105, 0106, 0107, 0108, 0109, 0110, 0111, 0112, 0113, 0118, 0119, 0126, 0127, 0128, 0133, 0134, 0135, 0144, 0145, 0146. Recovery for each: Forward-only like every migration: the supported rollback is the restore of the pre-upgrade backup set (ADR-0066 §7) and the previous release.

<!-- migration-catalogue:end -->

## 5. What was tested

The integration test `packages/db/test/integration/dry-run.test.ts` covers T-E30…T-E33 and the ADR-0068 §5 proof. It runs on a disposable local PostgreSQL cluster (`tests/qa/support/with-pg.sh`). It does the following:

1. Builds a database at the DG6 level (`0001`–`0130`) with the real runner.
2. Backs it up with `pg_dump --format=custom` and restores it into a fresh database with `pg_restore --no-owner --role=mth_owner --single-transaction`. ADR-0066's `backup.sh` and `restore.sh` were not merged when the test was written.
3. Runs the dry run: the report lists exactly the P7 files after `0130`, and the diff shows the P7 tables (`retention_class`, `backup_set`, …) and their grants. The copy stays at `0130`, and the throw-away database is gone.
4. Runs a failing migration: the file and the PostgreSQL error are named, and the rest are not attempted.
5. Tries a production-marked copy without the flag: the dry run refuses it.
6. Runs the real `migrate` on the restored copy. Its schema snapshot equals that of a freshly migrated database.

**Measured on 2026-11-13.** The setup was one local disposable PostgreSQL 16.15 cluster. The workload was a database migrated to the DG6 level that holds only the migrations' seed rows: no business data and no demo data.

| Step | Result |
| --- | --- |
| Build the DG6-level database (122 migrations) | 2.9 s |
| `pg_dump --format=custom` | 3,285,935 bytes, 0.4 s |
| `pg_restore` into a fresh database | 3.6 s |
| `mth-db migrate --dry-run` (9 pending P7 migrations) | 1.7 s reported, 2.2 s wall, exit 0 |
| Real `mth-db migrate` on the copy | 0.75 s wall; then `mth-db status`: up to date (131 applied) |

These are local measurements on a small database, not production estimates. The handback of T-DG7-DO-G has the commands and the logs.

**Observed at this revision.** A plain `pg_restore` of such a dump fails. The CHECK constraint `forum_template_participant_parties_check` calls `p4_parties_known()`, which reads `governance_party`. `pg_dump` orders table data by name, so `forum_template` is loaded first and the CHECK fails. The test therefore restores with `pg_restore --use-list` and loads `governance_party`'s data first. The backup and restore scripts of ADR-0066 must handle this; it is reported to the orchestrator in the T-DG7-DO-G handback.

## 6. Arabic summary (provisional, D-243 Q7)

> **ملخص (مسودة، تحتاج إلى مراجعة لغوية مؤهلة):** الترحيلات تسير في اتجاه واحد فقط، ولا يوجد ترحيل عكسي. الطريقة المعتمدة للتراجع عن أي ترقية هي استعادة مجموعة النسخ الاحتياطي التي أُخذت قبل الترقية إلى قاعدة بيانات ومخزن جديدين، ثم تشغيل الإصدار السابق. قبل نافذة الصيانة: خذ نسخة احتياطية من بيئة الإنتاج، واستعدها في بيئة تجريبية، وشغّل الأمر `mth-db migrate --dry-run` على النسخة المستعادة، واقرأ التقرير وصفوف فهرس الترحيلات للترحيلات المعلّقة، وخاصة غير القابلة للعكس (`data_rewrite` و`destructive`). توافق تقنية المعلومات في موبايلي على التغيير خارج المنصة؛ ولا يعني التقرير أو هذا الدليل أي موافقة. في النافذة: أوقف خدمتي `api` و`worker`، وخذ نسخة احتياطية هادئة، ثم حمّل الصور الجديدة وشغّل خدمة `migrate` وتحقق من `/readyz` واختبار الدخان. عند الفشل: استعد النسخة المأخوذة قبل الترقية وشغّل الصور السابقة. ترقية الإصدار الرئيسي لـ PostgreSQL إجراء منفصل لا يُدمج مع ترقية التطبيق.
