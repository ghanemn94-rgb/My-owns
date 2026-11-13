# Handback T-DG7-DOC-C: automation operations guide and role matrix (backend-workflow-engineer)

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `bd2daeffe394d7d839003bdc9e62962155280406` (verified with `git rev-parse HEAD` at start; the tree was clean apart from this run's own run directory).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DOC-C.md`, sha256 `71afea8d55c1d3d712aad3acb70d0027db7b2ad78fc96ec45a6f88b9d88b4164` (verified).
- **Invocation reference:** run `DG7-T-DG7-DOC-C-backend-workflow-engineer-20261113T045910Z-22f409d3`, session `22f409d3-9a3b-4353-b661-d841c6aa8635`.
- **Time:** start 04:59:19 UTC, end about 05:21 UTC (`date -u`).
- **Scope (p7-work-split §H.1, DOC-C):** the role matrix generator and matrix (T-H3), and the automation operations guide with its Arabic summary (T-H6).
- **Not in scope:**
  - no migration, API operation, permission or mutation was added or changed;
  - the `apps/api/test/support/p7-pending*.ts` files hold no DOC-C entry (checked with `grep`), so none was removed;
  - nothing here grants or records a business, Finance or IT approval;
  - product gates G1–G6 and engineering gates DG0–DG7 are kept separate in every text.

## 1. Files changed

All files are new. No existing file was modified.

| File | Purpose |
| --- | --- |
| `tools/release/role-matrix.mjs` | Generator (ADR-0072 §4). It imports `packages/shared/src/permissions.ts` using Node 24 type stripping and reads the EN/AR role names and permission descriptions from the seed migrations' `INSERT INTO role` and `INSERT INTO permission` rows. Modes: `--check`, `--write`, `--stdout` and `--root`. Exits 0 on PASS, 1 when the file differs, 2 when BLOCKED. |
| `docs/handover/role-matrix.md` | Generated output: 14 roles and 193 permissions in 5 category tables, `✓` cells, the §H.3 header and the provisional marker in EN and AR. |
| `tools/release/automation-jobs.mjs` | Generator for the guide's job table (ADR-0072 §6). It imports the worker registry in a child `node --conditions=@mth/source` process and reads `job_schedule` rows from the migrations. It writes the `<!-- generated:automation-jobs … -->` block. Exits 0, 1 or 2, and 3 when the workspace is not installed. **Not listed in H.1; see §4 item 1.** |
| `docs/handover/automation-operations.md` | The automation operations guide (EN), in nine sections with explicit anchors. Section 2 is the generated table of all 50 registered jobs. |
| `docs/handover/automation-operations.ar-summary.md` | Arabic summary (provisional, RTL `<div>`). It uses the §H.3 texts verbatim and covers purpose, prerequisites, order of steps and external dependencies (ADR-0072 §2.2). |
| `tools/release/tests/role-matrix.test.mjs` | T-H3, 9 tests. |
| `tools/release/tests/automation-guide.test.mjs` | T-H6, 9 tests. |
| `docs/delivery/handbacks/DG7/T-DG7-DOC-C-evidence/*.log` | Logs of every check in §3. |
| this handback | — |

**Index lines requested from DOC-B** (§2 rule 10) for `docs/handover/README.md`:

- `role-matrix.md` ("Role matrix" item of REQ-S19-015);
- `automation-operations.md` ("Automation guide" item);
- `automation-operations.ar-summary.md` (its Arabic summary).

## 2. Behaviour delivered, per requirement

### REQ-S19-015, "Role matrix" item: T-H3

- **Single source.** `role-matrix.mjs` generates `role-matrix.md` from `permissions.ts` (`PERMISSIONS`, `ROLES`, `PERMISSION_CATEGORIES`, `ROLE_KINDS`). That is the object `seed.test.ts` pins to the seed migrations.
- **Labels.** `permissions.ts` has no names or descriptions, so the EN and AR labels come from the seeded rows: what an installation's database holds.
- **Exit 2 (BLOCKED) cases.** A permission or role without a seeded label. A seeded label with no code entry. A category or kind mismatch with the seed. A migration that `UPDATE`s a role or permission row. The matrix never shows a guessed label.
- **Output.** Deterministic: roles and permissions are sorted by code, and there is no timestamp. Columns are the 14 roles.
- **`--check`.** Regenerates the matrix in memory and exits 1 on any byte difference.
- **The separation-of-duties sentence is computed, not asserted.** "No technical-administration role holds one by default" is printed only when that is true of the data. Otherwise the holders are listed.
- **Tests (T-H3).**
  - `--check` exits 0 on the tree.
  - In a fixture copy, adding a permission (with a seeded label and an AUD grant) makes `--check` exit 1. After `--write` it exits 0 again, and the new row has exactly one `✓`.
  - Removing a role grant exits 1.
  - An unlabelled permission exits 2.
  - A usage error and a missing `permissions.ts` exit 2.
  - The output is deterministic and sorted, with no timestamp.
  - Every cell equals `ROLES[role].permissions.includes(code)` across all 193 × 14 cells.
  - Labels equal the 0005 seed rows.
  - The §H.3 header and the EN and AR markers are present, and no claim words appear.

### REQ-S19-015, "Automation guide" item: T-H6

**The job table is generated from the worker's own registry:**

- `DOMAIN_HANDLERS` (45 domain jobs; the owning domain is the handler file that exports the queue);
- the 5 platform registrations in `worker.ts`: `transformation.created`, `maintenance.purge_expired`, `job_schedule.updated`, `automation.failure_retry` and `jobs.run_now`. Each is marked captured (`work(`) or not captured (`boss.work(`).

**Columns of the table:**

- the service identity and its declared permissions (`JOB_SERVICE_IDENTITIES`);
- the default schedule (the migrations' `job_schedule` rows, including enabled/disabled, plus `PURGE_CRON`) and the events consumed (`QUEUES_FOR_EVENT`);
- the retry policy (`DOMAIN_QUEUES`/`RETRY_POLICY`, and the purge's own policy);
- what happens after the last attempt fails;
- recovery (`retryAutomationFailure`/`dismissAutomationFailure`, and `runJobNow` for scheduled jobs).

**The generator refuses (exit 2):**

- a registered queue with no identity;
- a queue registered twice;
- a `job_schedule` row for an unregistered queue;
- a migration that changes a schedule's cron, enabled, timezone or queue.

**The guide covers:**

- how jobs run;
- the table;
- schedules and "run now";
- the failure queue (including the two platform jobs that reach only `ops.failed`, and the shipped behaviour of service-identity failures from ADR-0053 §1);
- operational exceptions and alerts;
- how to read the heartbeat (alive ≤ 90 s, stale, unknown; never shown green);
- the retention job `retention.archive` (ships disabled, every class "retain", the enabling order with a dry run first, what can never be archived, the known limitations including BE-G gap 2 on a stuck `running` run);
- the transfer export job `transfer.export` (requested only, identity with no permission code, S3 evidence not exported);
- sources.

**Tests (T-H6):**

- `--check` exits 0.
- The table's queue set equals `DOMAIN_HANDLERS`, imported directly in a child process independently of the tool, plus the 5 platform queues pinned in the test. No queue is listed twice.
- The pinned platform set equals the identifiers that `worker.ts` registers.
- A guide copy missing `retention.archive` fails `--check` with exit 1. A guide copy with a bogus `not.registered` row fails `--check` with exit 1, and the set comparison names the bogus row.
- `--write` restores a damaged copy byte for byte. A guide without its markers exits 2.
- A root without an installed workspace exits 3, never 0.
- Every seeded schedule's cron and state appear in its row. `retention.archive` shows `**disabled**` and `retention.read`. `transfer.export` has no schedule and no permission.
- The anchors and key operations are present, and no claim words appear.
- In the AR summary: the RTL wrapper, the EN and AR provisional lines directly under the first heading, the §H.3 summary header, the acceptance text, the "not verified" text, and the four §2.2 sections.

## 3. Checks actually run

Environment for every check:

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) and `MTH_PNPM_OFFLINE=1`, in the run sandbox;
- working tree at base `bd2daeffe` plus the files in §1;
- logs in `docs/delivery/handbacks/DG7/T-DG7-DOC-C-evidence/`.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `node --test tools/release/tests/role-matrix.test.mjs tools/release/tests/automation-guide.test.mjs` | **exit 0**, 18/18 pass | `h-tests.log` |
| 2 | The same, with `LANG`, `LC_ALL` and `LC_CTYPE` unset | **exit 0**, 18/18 | `h-tests-locale-unset.log` |
| 3 | The same, with `LC_ALL=C.UTF-8 LANG=C.UTF-8` | **exit 0**, 18/18 | `h-tests-c-utf8.log` |
| 4 | The H.4 command: `node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs tools/release/tests/automation-guide.test.mjs` | **exit 0**, but it ran only my 18 tests. `check-handover.test.mjs` does not exist yet (DOC-B, W9), and Node 24.21.0 silently skipped the missing path. T-H1, T-H2, T-H4, T-H5, T-H7, T-H8 and T-H9 did not run, and are not claimed. | `h4-full-command.log` |
| 5 | `node tools/release/role-matrix.mjs --check` and `node tools/release/automation-jobs.mjs --check` | exit 0 for each (run inside the tests above and by hand) | `h-tests.log` |
| 6 | `node tools/release/claims-scan.mjs --root docs/handover` | **exit 0**, "PASS (7 files; …negated 2; allowed 0)" | `claims-scan-handover.log` |
| 7 | `node tools/release/claims-scan.mjs` (default groups) | **exit 0**, "PASS (856 files …)" | `claims-scan-default.log` |
| 8 | `node tools/release/secret-scan.mjs --path docs/handover --path <the 4 new tool and test files>` | **exit 0**, "PASS (path; 11 files; allowed 0)" | `secret-scan-paths.log` |
| 9 | `node tools/release/secret-scan.mjs --scope payload` | **exit 0**, "PASS (payload; 3035 files …)" | `secret-scan-payload.log` |
| 10 | `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| 11 | `pnpm lint` | **exit 0** (`eslint . --max-warnings=0`; `tools/release/**` is outside eslint's scope, D-249 Q5) | `lint.log` |
| 12 | `pnpm openapi:lint` | **exit 0**, "OpenAPI 3.1.1, 965 operations" (unchanged) | `openapi-lint.log` |
| 13 | `pnpm test` | **exit 0**: unit-node 202 files and 2992 tests; unit-web 127 files and 2133 tests; formula-nocodegen 3 files with 259 passed and 2 skipped | `pnpm-test.log` |
| 14 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` (disposable PostgreSQL) | **exit 0**, 111/111 | `contract-test-with-pg.log` |
| 15 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**, "All matched files use Prettier code style!" (`docs/` and `tools/` are in `.prettierignore`) | `prettier.log` |
| 16 | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0**, "PASS gate DG6 (historical)" | `validate-historical-DG6.log` |

No integration test was touched, because there is no product code change. The contract test (row 14) was run as the assignment asks. Live CI was not run (D-058). The `release` job of `deploy/ci/ci.yml` installs the workspace and then runs `node --test tools/release/tests/*.test.mjs`, so both new test files would run there.

## 4. Known gaps / not done, and deviations

1. **New file outside the H.1 list: `tools/release/automation-jobs.mjs`.**
   - ADR-0072 §1 and §6 say the job table is "generated", but H.1 names no generator for it.
   - I added this file rather than hand-maintaining 50 rows that T-H6 would only check by name.
   - It is new (no shared file was edited) and inside `tools/release/`.
   - The orchestrator should accept it or move it. If it is rejected, the block can be frozen as text and T-H6's name-set test still holds on its own.
2. **Tension with p7-work-split §2 rule 3 ("nothing else from node_modules").**
   - The two generators themselves use only Node built-ins.
   - But T-H6 and `automation-jobs.mjs` necessarily import the worker's own modules, which pull in `kysely`, `pg-boss` and `zod`. They do this in a child process with `--conditions=@mth/source`.
   - Without an installed workspace the tool exits 3 (BLOCKED, rule 4) and T-H6 fails. Neither ever passes in that case.
   - `role-matrix.mjs` imports only `permissions.ts`, which has no imports, as ADR-0072 §4 states.
3. **Role and permission labels come from the seed migrations, not `permissions.ts`.**
   - ADR-0072 §4 says the generator "imports permissions.ts" and outputs EN and AR names and descriptions, but those texts exist only in the seed SQL.
   - The generator therefore joins the two sources and refuses any gap or relabel.
4. **Column order.** The 14 role columns and the role table are sorted by code (`ADM_ACCESS` … `WL`), following ADR-0072 §4 "sorted by code". They are not in the 0005 seed order.
5. **H.4 command.** Only T-H3 and T-H6 ran. The command exits 0 today only because Node skipped the missing `check-handover.test.mjs`. Once DOC-B adds that file, the command must be re-run at the freeze.
6. **Protocol deviation.** The assignment and CLAUDE.md ask for the `--historical` validator run before implementing. I ran it once, at the end (exit 0, row 16), and not before implementing. Disclosed like BE-B's (D-254).
7. **Guide statements that come from earlier handbacks and ADRs, not from tests run here.** Reviewers should judge them against the code:
   - service-identity failures are still retried before they reach the failure queue (ADR-0053 §1 "Shipped status");
   - a stuck `running` retention run has no API to end it (BE-G gap 2);
   - S3-held evidence makes an export fail (BE-C);
   - a missed schedule slot is "not guaranteed to be replayed" (pg-boss behaviour, deliberately worded cautiously).
8. **All Arabic is provisional.** No `arabic-review.json` entry was added.
9. **Unrendered markup.** The `{#anchor}` ids in the guide are explicit-anchor markup that some Markdown renderers do not honour (the same convention that ADR-0072 §3 sets for the deployment guide).

## 5. Merge instructions and open questions

**Merge instructions:**

- No migration and no ordering constraint.
- New files only, so no conflict is expected.
- DOC-B (W9) adds the three index lines in §1, and its `check-handover.mjs` should treat `role-matrix.md` and the generated automation block as generated content.
- **After any later change**, run the two generators and commit the result. Otherwise `--check` and T-H3/T-H6 fail. The triggers are:
  - a permission, role or grant in `permissions.ts` and its seed migration: run `node tools/release/role-matrix.mjs --write`;
  - a worker queue, handler, identity, retry policy or `job_schedule` seed: run `node tools/release/automation-jobs.mjs --write`.

**Open questions for the orchestrator:**

- **Q1:** accept `tools/release/automation-jobs.mjs` as a DOC-C file (§4 item 1)?
- **Q2:** accept that T-H6 needs an installed workspace, with exit 3 and a failing test without one (§4 item 2)?
- **Q3:** should DOC-B's `check-handover.mjs` call `role-matrix.mjs --check` and `automation-jobs.mjs --check`, so that T-H1 also fails when a generated part is stale?
