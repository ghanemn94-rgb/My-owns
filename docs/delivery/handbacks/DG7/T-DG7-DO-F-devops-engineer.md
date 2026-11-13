# Handback T-DG7-DO-F (devops-engineer): backup, restore and the A19 drill

- **Stage and base:**
  - Stage DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
  - Base `HEAD` `7f39f4c1a7845aceddefa96e3ab1cb8d39f624f5`. The working tree was clean apart from this run's runner directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-F.md` (sha256 `8103a37c74b46994689a04183eac59f4e411607bc3811ca2e89e11bca7ebd2a3`), p7-work-split §E.2.
- **Invocation:** run `DG7-T-DG7-DO-F-devops-engineer-20261113T041940Z-ac5a9ce0`, session `ac5a9ce0-99e9-487d-9735-98d23817b755`.
- **Time:** started `2026-11-13T04:19:50Z`; checks finished `04:58Z` (`date -u`), about 39 minutes.
- **Environment facts:**
  - Node 24.21.0; PostgreSQL 16.15 (the `with-pg.sh` disposable clusters; `pg_dump`, `pg_restore` and `psql` 16).
  - `MTH_PNPM_OFFLINE=1`.
  - **No Docker daemon** (D-243 Q1), so the Compose half was not run.
  - `shellcheck` is not installed.
  - Disk: about 3.8 GB free. Temporary trees were made under `$TMPDIR` and deleted.
- **Nature of the work:** a backup set, a restore and a drill report are engineering artefacts. None of them is a business, Finance or IT approval, and none touches DG0–DG7. All test data is synthetic. A local drill is not proof of high-availability production readiness.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/backup.sh` (new) | ADR-0066 §1–§4, §6. Snapshot-consistent counts and digests through `pg_export_snapshot()`, then `pg_dump -Fc --snapshot` in the same snapshot. Evidence `copy-out` through BE-E's CLI **with `--export-id <set id>`** (Q5: yes). Retention archive sets; `config/` with secret values removed; checks; manifest `mth-backup/1`, written last; `backup_set_record()` for succeeded **and** failed sets. Phases `all`, `database` and `finish` for the Node-less `postgres:18` image. |
| `deploy/scripts/restore.sh` (new) | ADR-0066 §7–§8. Package checks (schema version, every file SHA-256, no unlisted file, optional `--manifest-sha256`), same major, fresh target only, `pg_restore --exit-on-error --single-transaction --no-owner --role=mth_owner`, `copy-in`, retention sets, R1–R8, `restore-report.json`. It sources `backup.sh` for the shared SQL (counts, digests, facts), so backup and restore compute them identically. |
| `deploy/scripts/restore-drill.sh` (new) | ADR-0066 §9, container-free half. Demo (migrate and seed-demo) → `backup.sh` → fresh database and empty evidence root → `restore.sh` → R9 (ADR-0050 demo checksum) → `drill-report.json` with timings. |
| `deploy/scripts/tests/backup-restore.test.mjs` (new) | T-E1…T-E9 (`node --test`, under `with-pg.sh`). |
| `docs/handover/backup-restore.md` (new) | Scope, schedule example, the Compose three-step sequence, set layout, restore steps, checks table R1–R9, measured drill timings, RPO/RTO "to agree with Mobily IT", secrets by name, cross-major note, limits, Arabic summary (provisional). |
| `deploy/compose/compose.yaml` | The `backup` service under `profiles: ["backup"]` on the **same pinned** `postgres:18@sha256:5a5a84b1…` (no new image; `images.lock.json` unchanged), plus one header line. |
| `tools/release/service-list.mjs` | One `SERVICE_ROLES` line for `backup`, the seam named in p7-work-split §A.2 ("the task that adds a Compose service also adds one line"). **The role text is mine**, because ADR-0066 gives none (Q2). |
| `deploy/service-list.json` | Regenerated with `node tools/release/service-list.mjs`. |
| `tools/release/tests/service-list.test.mjs` | **Outside my listed files (declared).** The T-A6 fixture used `backup` as its example of a service with no role. Once `backup` has a role, that fixture fails. I renamed the fixture service to `synthetic-unlisted`. The test's intent is unchanged. DO-A or the orchestrator should confirm (Q3). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-F-evidence/*` | Logs and reports (§3). |

No migration was added, so the migration catalogue does not need regenerating (DO-G). No API operation was added, and no `p7-pending*.ts` entry belongs to DO-F (grep: none).

## 2. Behaviour per requirement

**REQ-S19-012 and REQ-S20-019 (A19), container-free half:**

| Scope | What restores it | Test |
| --- | --- | --- |
| Database | `pg_dump -Fc` of the whole database, pgboss included. Restored in one transaction. | R2 (`migrationLevel` plus `mth-db status: up to date`), R3 (all 355 base tables recounted in one snapshot and diffed against `table-counts.tsv`); T-E7 |
| Evidence | `transfer-attachments copy-out --export-id <set id>` after the dump, then `copy-in` and `verify` on the target. | R7; T-E4 (every set file); QA "every file downloads from the restored installation with its SHA-256" ✓ |
| Audit | `audit_event` count and `max(seq)` | R4 |
| Snapshots | SHA-256 over every row of the six ADR-0067 §3 tables, ordered by `ROW(pk)::text COLLATE "C"` | R5 |
| Job state | pg-boss jobs by state, `job_schedule` digest (all columns), `job_run` count | R6; T-E7 (a queued synthetic job is still `created`) |
| Configuration (M0360) | `config/` without secret values | T-E3 (canaries absent; keys and `*_FILE` kept) |

**Documented checks and timings:** `restore-report.json` holds each check with `expected`, `actual` and `result`, plus the seconds of every step. `drill-report.json` adds R9. The guide documents R1–R9 and the measured timings.

**Deliberate behaviours:**

- **Unaudited write path?** No. The only mutation is `backup_set_record()`, which is insert-only and owner-only, validates its input and writes its audit event in the same transaction. The scripts always pass exactly 19 keys (T-E9).
  - Authorization and validation are proven by QA's test, which passes: `mth_app` is refused with 42501, and an unknown key is refused.
  - Optimistic concurrency does not apply: there is no update path.
  - Backups and restores run outside the API (§E.10).
- **Table data restore order.** `pg_restore` loads table data in **table-creation (TOC OID) order**. Some CHECK constraints call functions that read other tables (for example `forum.participant_parties` → `p4_parties_known()` → `governance_party`), and pg_dump orders data by name. The first restore failed exactly there, and the reorder fixes it.
- **Connection URL normalization.** `+` in a URL query is rewritten to `%20`. libpq reads `options=-c+role%3D…` literally; Node's `URLSearchParams` writes it that way.
- **psql variables.** They are fed on stdin, because psql never interpolates `:'var'` in `-c`.
- **Phases for Compose.** `--phase database` runs in the `backup` service (`MTH_TRANSFER_ATTACHMENTS=none`). The copy-out runs in the app image with `--export-id`. Then `--phase finish`. `--phase all` refuses `none` with exit 2.
- **S3.** `EVIDENCE_STORAGE_DRIVER=s3` → exit 3 BLOCKED, the same as BE-E's CLI.

## 3. Checks run (real exit codes; logs in `docs/delivery/handbacks/DG7/T-DG7-DO-F-evidence/`)

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs` | **exit 0**, 9/9 pass (T-E1…T-E9), 17.1 s | `backup-restore-node-test.log` |
| 2 | `tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/a19-drill"'` | **exit 0**, R1–R9 PASS; backup 2.200 s, restore 5.928 s (restore.sh 5.635), R9 0.712 s, total with seed 14.783 s | `restore-drill.log`, `drill-report.json` (sha256 `f32d4f8e…f9703`), `restore-report.json` (`48b1fe51…54ef4`), `backup-manifest.json` (`6081a22b…34f1a`) |
| 3 | `tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a19-backup-restore-drill.test.ts` (QA-A's harness, unmodified) | **exit 1**: 9 passed, **4 failed**, all on QA harness defects (§5 Q1). For each of the three refusal tests, the script's exit 2 and the exact §E.5 line were asserted **and passed** before the failing line. | `a19-qa-harness.log` (first run with an older script: `a19-qa-harness.run1.log`) |
| 4 | The same harness as a **temporary patched copy** `tests/qa/integration/a19-zz-dof-diagnostic-tmp.test.ts` (2 patches, diff in `a19-qa-harness.diagnostic-patch.diff`; the copy was **deleted** after the run) | **exit 0**, 13/13. Diagnostic only: it is not QA's test. | `a19-qa-harness.diagnostic-patched.log` |
| 5 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 6 | `pnpm lint` | exit 0 | `lint.log` |
| 7 | `pnpm openapi:lint` | exit 0 (965 operations) | `openapi-lint.log` |
| 8 | `pnpm test` | exit 0: 2992 + 2133 + 259 (2 skipped, pre-existing) | `pnpm-test.log` |
| 9 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, 111/111 | `contract-integration.log` |
| 10 | `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | **exit 1**: 317/320 pass, plus 2 that report in subtests; 1 fail, **T-A5 build-from-archive**. pnpm `EROFS` on a symlink into `/root/.local/share/pnpm/store` (HOME is read-only in this sandbox). This is environmental and not caused by this change. `service-list.test.mjs` passes 6/6. | `release-node-tests.log` |
| 11 | `node tools/release/service-list.mjs --check` | exit 0 | (console) |
| 12 | `node deploy/scripts/pin-images.mjs --check` | exit 0: "4 images pinned by digest and referenced consistently". My first header comment said "postgres:18" without a digest and failed this check; it was reworded. | (console) |
| 13 | `node tools/release/secret-scan.mjs --scope payload` | exit 0, PASS. My first comment wording tripped S2 and was reworded. | (console) |
| 14 | `node tools/release/claims-scan.mjs` | PASS (853 files) | (console) |
| 15 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0, "PASS gate DG6 (historical)". Run at the end, not before implementation: protocol deviation. | `validate-historical-DG6.log` |
| 16 | `bash -n` on the three scripts | exit 0 | – |
| 17 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (re-run after this handback was written) | `prettier.log` |

**Not run:**

- **shellcheck:** BLOCKED, not installed.
- **The Compose half:** BLOCKED, no Docker daemon (D-243 Q1; the orchestrator's). That covers the `backup` profile run, the app-image copy-out path `/app/apps/api/dist/cli/transfer-attachments.js`, `--readyz-url` over HTTP, and PostgreSQL 18.
- **`scan-assets`:** BLOCKED, needs `pnpm -r build`. Not in my acceptance list.

## 4. Known gaps

1. **Compose half not run** (see above). In particular, the in-image CLI path and the `postgres:18` tools (`find -printf`, `du -b`, `stat -c`, all GNU coreutils in Debian) are not proven here.
2. **The drill's demo has 0 evidence objects and 0 pg-boss jobs.** Evidence bytes, a queued job and a retention set are exercised by T-E7 (synthetic retention set and job) and by QA's harness (3 evidence rows, 2 objects, 1 job). They are not exercised by `restore-drill.sh` itself.
3. **R8 without `--readyz-url` is an offline equivalent of the `/readyz` rule:** UTF8, `mth-db status` up to date, and the evidence root readable and writable. The report says `readinessMode: offline-equivalent`. QA's harness separately starts the API on the restored database and gets `/readyz` 200, `storage: ok` and worker `unknown`.
4. **Secret redaction in `config/` is a bash key and URL rule**, not the ADR-0063 secret-scan classifier. Removed values:
   - keys matching `PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE|CREDENTIAL|API_KEY|ACCESS_KEY|SESSION_KEY|_KEY$`, except `*_FILE`;
   - URL userinfo credentials;
   - PEM private keys.
5. **S3 evidence:** BLOCKED (exit 3), inherited from BE-E gap 1 and Q2.
6. **The restore copies retention sets with `cp`** and verifies them against the set (R7). It does not use the port, so it is filesystem only.
7. **`restore.sh` needs Node** (`copy-in`, `verify`, `mth-db status`), so it does not run inside the `postgres:18` image. The guide's restore is a host with Node and the PostgreSQL client tools. A Compose restore sequence (phases, like the backup) is not built.
8. **Cross-major refusal is tested by editing the manifest** (T-E5). No real PostgreSQL 18 set exists here.
9. **RPO and RTO are not set.** They are placeholders "to agree with Mobily IT". Timings are measured on the synthetic demo only.

## 5. Open questions

- **Q1 (QA-A / QA-C): two defects in `tests/qa/integration/a19-backup-restore-drill.test.ts`.**
  - (a) `expect(m.migrationLevel).toBe(before.migrationLevel)` compares the manifest's ADR-0066 §2 `<id>_<name>` (`0148_p7_retention_job`, also required by QA's own `backupManifestProblems` and by the 0145 CHECK) with `max(id)` of `schema_migration`, which is the integer `148`.
  - (b) `fingerprint()` on an **empty** target throws `relation "public.report_snapshot" does not exist`. So the three refusal tests fail after the script's exit 2 and the exact line have already passed.
  - The diagnostic diff is in `a19-qa-harness.diagnostic-patch.diff`. I did not edit QA's file.
- **Q2 (architect or orchestrator): confirm the `backup` role text.** It reads "One-shot database phase of a backup set, run by IT (backup profile, off by default; ADR-0066)." ADR-0062 §6 calls its role texts "verbatim", and ADR-0066 gives none.
- **Q3 (DO-A or orchestrator): confirm the fixture rename** in `tools/release/tests/service-list.test.mjs` (`backup` → `synthetic-unlisted`).
- **Q4 (BE-E Q5): answered.** DO-F passes the backup set id (`mth_uuid_v7()`, also `backup_set.id`) with `--export-id`. `attachments.json` then names its set.
- **Q5 (DOC-B): index line request (§2 rule 10).** "`docs/handover/backup-restore.md`: backup sets, restore into a fresh installation, checks R1–R9, measured drill timings; RPO/RTO to agree with Mobily IT."
- **Q6 (orchestrator, Compose drill):** please confirm the app-image CLI path `/app/apps/api/dist/cli/transfer-attachments.js` and the three-step sequence of guide §3.2 on the host. Then run `restore.sh --readyz-url` against the second project.

## Merge instructions

- **No migration.** No contract change. No lockfile or image change.
- **Expected conflicts:**
  - `deploy/compose/compose.yaml`, with DO-D's `compose.transfer.yaml` seam: a separate file, so none expected.
  - `tools/release/service-list.mjs` and `deploy/service-list.json`: regenerate after any other Compose change with `node tools/release/service-list.mjs`.
- **CI (owner of the wave).** Optional job fragment to add the new test:

  ```yaml
  - name: backup/restore (T-E1…T-E9)
    run: tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs
  ```

  It needs the PostgreSQL server binaries that `with-pg.sh` uses.
