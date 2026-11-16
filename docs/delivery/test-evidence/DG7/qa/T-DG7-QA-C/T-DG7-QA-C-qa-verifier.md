# Handback T-DG7-QA-C (qa-verifier): A17–A22 re-run, fresh T-B11 plus the A18 harness, the A19 drill with timings, A02

- **Stage:** P7 / DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` at start = `85f6ebe9fb6b7136bd3cbb1670400be449b8dfc8`. `git status` at start: clean apart from two run directories under `docs/delivery/runs/DG7/` (this run and the concurrent ARCH-R6 run).
- **HEAD moved during the run.** At 13:43 UTC the concurrent ARCH-R6 run's auto-commit made `3386b90921b7ff7cb54096419aeaa4eec125ce7b`. Apart from my own files, it changed only `docs/architecture/adr/ADR-0069-*.md`, `docs/architecture/p7-work-split.md` and ARCH-R6's handback and run files. No product code changed between the two commits (`git diff --name-only 85f6ebe9f 3386b9092`). See finding F-DG7-qa-C-3.
- **Candidate:** none frozen; the stage is BUILDING. `node tools/gates/candidate.mjs --stage DG7` at start printed `sha256:ab6b4a106968a1d46dcc6737b05ea2e6204a87db56d2963763ec16aeeb4a673f` (working tree, 3138 files), for traceability only. This is **not a review of a frozen candidate**, and nothing here is a gate verdict.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-QA-C-qa-verifier-20261114T131344Z-23c9a774","session_id":"23c9a774-b77e-4db8-9e72-378a072216f0"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-QA-C.md`, sha256 `e8c9dccab66a6103d57ef6065d6b402debc2a4949c017ddd710e31eadd223b4f` (verified).
- **Time:** started 13:17:58 UTC; end recorded in §4.
- **Authorship:** this task edited only acceptance tests under `tests/qa/**` and wrote evidence under `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/`. It edited no product code.
- **Everything is SYNTHETIC:** demo data, drill IdP users, generated secrets and origins. Nothing here approves anything: no G1–G6, Finance or IT approval, and no DG gate.

> **Contradictions in the assignment (protocol: stated, not guessed).**
>
> 1. **Handback path.** The assignment asks for `docs/delivery/handbacks/DG7/T-DG7-QA-C-qa-verifier.md`, with logs in `…/T-DG7-QA-C-evidence/`. The qa-verifier write scope (`tools/agents/write-scopes.json`) allows only `tests/qa/**`, `e2e/**`, `docs/delivery/reviews/*/round-*/qa-verifier.*` and `docs/delivery/test-evidence/*/qa/**`, the same refusal QA-B recorded. The handback and every log are therefore in `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/`. The orchestrator may copy them, as D-265 did for QA-B.
> 2. **The "Environment" paragraph lists `test-evidence/**` as forbidden**, but the task places the evidence under `test-evidence/DG7/qa/T-DG7-QA-C/`. I followed the task and the write scope, which allows `test-evidence/*/qa/**`.
> 3. **The "Deliverables" paragraph is the implementer template.** It covers `p7-pending` removal and the per-mutation authorization, validation, concurrency and audit tests. QA-C owns no pending entry and added no mutation, so that template does not apply. `apps/api/test/support/p7-pending*.ts` is also outside the qa-verifier write scope.
> 4. **"Work in the repository root"** conflicts with the agent rule to execute code in a disposable copy. I followed the assignment (disk) and, as QA-B did, ran in the root. Every drill and database is disposable: `with-pg.sh` clusters, `$TMPDIR` work trees, all removed. The only writes to the tree are the files in §1.

## 1. Files changed

| File | Change | Purpose |
| --- | --- | --- |
| `tests/qa/integration/a19-backup-restore-drill.test.ts` | 2 fixes (QA harness defects reported by DO-F, Q1) | (a) `fingerprint().migrationLevel` is now the ADR-0066 §2 form `<id>_<name>`, recomputed independently from `schema_migration`'s newest row. Before, it was the integer `max(id)`, which can never equal the manifest's string. (b) `fingerprint()` of an **empty** database (the 3 refusal tests) returns the empty fingerprint instead of throwing `relation "public.report_snapshot" does not exist`. No assertion was removed or weakened. |
| `tests/qa/integration/a22-operational-readiness.test.ts` | stale P6 expectation updated | ADR-0067 §4 ships the `retention.archive` schedule **disabled** (migration 0147). For a disabled schedule the test now asserts `nextRunAt: null` with `nextRunUnknownReason: "disabled"` (Unknown, never a time) and `openFailures` 0. Enabled schedules keep every P6 assertion. |
| `tests/qa/integration/a22-p6-operability.test.ts` | stale P6 expectation updated | ADR-0069 §2 adds `storage` (gating) and `worker` (reported only, never gating) to `/readyz`. The test asserts `database`, `migrations` and `storage` `ok`, and `worker` is one of `alive\|stale\|unknown` (the spec runs a real worker; the run saw `alive`). |
| `tests/qa/integration/a18-transfer-drill.test.ts` | reliability fix (F-DG7-qa-C-2) | The drill now runs through an **async** `spawn` in `beforeAll` (timeout unchanged at 2 400 s), not through `spawnSync` in the first test. `spawnSync` blocked the Vitest worker's event loop for the whole 338 s drill, so Vitest reported `[vitest-worker]: Timeout calling "onTaskUpdate"` and exited **1** with all 8 tests passing. The assertions are unchanged. A missing input or file still **fails** every drill test and never skips it. `spawnSync` import removed. |
| `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/**` | new | Driver, logs and drill outputs (§3), and this handback. |

**Attribution note.** The ARCH-R6 auto-commit `3386b9092` swept the a19 and both a22 edits, plus my evidence up to 13:43, into its commit. The a18 edit and later evidence are uncommitted at handback. All four test edits are QA-C's, not ARCH-R6's (F-DG7-qa-C-3).

## 2. Behaviour verified, per requirement

All results are on the merged tree (`85f6ebe9f`, then `3386b9092`; no product difference). Each line is a test that **ran**.

- **A17, REQ-S17-004 (import and integration, contract tests against local adapters; external change):** `a17-import-and-integration` 10/10, `a17-s01-005-external-change` 4/4.
- **A18, REQ-S20-018, REQ-S19-017, REQ-S01-001, REQ-S01-006, REQ-S19-009, REQ-S19-010, REQ-S19-002, REQ-S21-004 (agent half per D-243 Q1):**
  - **Fresh T-B11 (run 2)** on an archive built from `85f6ebe9f`. The demo export was 335 tables, manifest sha256 `0ab68550…39ed5e`, with seed-demo periods relative to 2026-11-14. Archive `mth-transformation-hub-0.1.0-c589659d94aa.tar.gz`, 14 474 108 bytes, sha256 `e1536479f3d3fd49ce0dd8d3cfd2427324847c95601309407b5ad5ef634b40e4`.
    - Result: D0–D11 each PASS, exit 0. Drill 325.2 s; driver exit 0 for T-B11 in 338 s.
    - D0, the build from the archive with the offline store: 222.2 s (`build` 193 s; `check-no-cdn` and `scan-assets` PASS).
    - D1 15.9, D2 3.0, D3 0.5, D4 9.9, D5 15.0, D6 4.7, D7 4.2, D8 36.1, D9 11.8, D10 1.0, D11 0 s.
    - `reconcile-d5.json` `matched`, `reconcile-d6.json` `matched`, `reconcile-d9.json` `matched after use` (289 tables unchanged, 45 with allowed differences, 216 audit events added since the import).
    - Report `result: PASS`, sha256 `a97c8933…48fa69c`. Origin moved to `http://127.0.0.1:25302`; 2 evidence files equal; restart verified. D10 origin scan: 1837 columns of 337 tables, 0 failing hits.
    - The IdP is labelled "synthetic drill IdP (not a corporate IdP)".
  - **A18 harness (run 3)**, independent of the drill's own verdict, after the async-spawn fix. Fresh archive from `3386b9092` (sha256 `1a6f5056831662e816b58de5d6ef69cbd1a8704bca600a16ed6df16b33149488`); the harness ran the drill itself.
    - Result: **8/8, Vitest exit 0**. Drill 283.4 s, exit 0; D0–D11 PASS; D5/D6 `matched`, D9 `matched after use`; report sha256 `3d1f7c28…08d53c`.
    - What it asserts: clean start ready with storage `ok` and the worker `unknown` (never `alive`); a missing evidence directory gives 503; configuration only from `.env.example` keys citing the guide (D3); every reconciliation equal; the origin stored only in `audit_event` (D10); no builder-hosted or public service in the log.
  - **A18 harness (run 2)** on run 2's archive: all 8 tests passed, but Vitest **exit 1** from the RPC timeout (F-DG7-qa-C-2). Kept as evidence; superseded by run 3.
- **A19, REQ-S20-019, REQ-S19-012 (backup and restore with documented checks and timings):**
  - **Harness, run 4:** 13/13, exit 0, after the two fixes in §1.
    - Timings (s): `backup.total` 3.55 (dump 0.65, config 0.22, verify 1.14, evidence 1.06, snapshot 0.19); `restore.total` 6.40; `check.timeToReady` about 0.26.
    - Run 5 repeated it: 13/13.
  - **DO-F's drill** (`deploy/scripts/restore-drill.sh`), run independently: **exit 0**, R1–R9 PASS. Backup 4.606 s, restore 8.029 s, restore-and-ready 7.6 s.
    - R2 level `0152_p7_transfer_recheck_lineage_basis`; R3 356 tables, 0 differences; R4 audit 928/928; R5 snapshot digest equal; R6 job state equal.
    - Reports: `a19-drill/drill-report.json`, `a19-drill/restore-report.json`.
  - These are drill timings on synthetic data, **not** RPO/RTO, which stay "to agree with Mobily IT". The drill's demo has 0 evidence objects and 0 pg-boss jobs (DO-F gap 2); the harness covers evidence (2 objects) and a queued job.
- **A20, REQ-S15-003 and REQ-S15-014:**
  - Integration: `a20-p6-register-1000` 4/4 and `a20-s15-014-no-infra-terms` 6/6.
  - The token-contrast unit test (`tests/qa/unit/a20-p6-token-contrast.test.ts`) passes in the unit-node rerun; table in `a20-contrast/contrast-pairs.txt`.
- **A21:** `a21-p6-adapters-disabled` 10/10.
- **A22, REQ-S20-022 and REQ-S12-022:** `a22-operational-readiness` 8/8 and `a22-p6-operability` 17/17, after the two stale expectations were updated to ADR-0067 §4 and ADR-0069 §2.
- **A02, REQ-S01-001 and REQ-S21-004 (guided scenario on a persisted database, native workflows only):** `a02-a21-complete-lifecycle` 13/13 and `a02-a08-drafts-before-g2-scale-after-g5` 1/1, exit 0, on a disposable PostgreSQL 16.15 (UTF8, C).
- **Offline drill (DO-E, REQ-S19-018 "the lifecycle e2e suite passes with egress blocked" and REQ-S01-006 "runs key workflows with outbound public internet disabled", agent half):**
  - **PASS, exit 0** (§3 #13b): 10/10 spec runs (A02 and A21 e2e specs, English LTR and Arabic RTL projects) inside one `bwrap --unshare-net` namespace.
  - The probe proved isolation, and the product's connection log shows 0 connections outside loopback.
  - This is the container-free half. The Compose no-egress run is the orchestrator's (BLOCKED here, below).

## 3. Checks run (real exit codes)

Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, disposable PostgreSQL 16.15 (UTF8, C) from `tests/qa/support/with-pg.sh`. Locale unset unless the row says otherwise. Every log is in `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/`.

Sandbox constraint: `node_modules/` and `test-results/` are read-only for this agent. Vitest therefore runs with `--configLoader runner`, and the A20 contrast table goes to `QA_EVIDENCE_DIR`. This is the same as QA-B (D-265).

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `with-pg.sh npx vitest run --project integration <A17, A19–A22: 8 files>` | 1 | Startup error EROFS `node_modules/.vite-temp`. **BLOCKED (sandbox)**; not a product result. | `a17-a22-run1.log` |
| 2 | the same with `--configLoader runner` (concurrent with the drill runs) | **1** | 66/72 pass. **6 fail:** A19 ×4 (QA harness defects, DO-F Q1), A22 ×2 (stale P6 expectations). Analysed in §1; F-DG7-qa-C-1. | `a17-a22-run2.log` |
| 3 | the same after the fixes | **1** | 71/72. A19 backup test failed on **my own fix** (`ORDER BY id` bound to the text alias, so `0099` sorted above `0152`). Fixed. | `a17-a22-run3.log` |
| 4 | `with-pg.sh npx vitest run --configLoader runner --project integration a19-backup-restore-drill.test.ts` | **0** | 13/13 with `A19-TIMINGS` | `a19-run4.log` |
| 5 | `with-pg.sh npx vitest run --configLoader runner --project integration <8 A17–A22 files> apps/api/test/integration/contract/contract.test.ts` | **0** | 9 files, **183/183** (contract 111) | `a17-a22-run5-with-contract.log` |
| 6 | as #5 without the contract test, `LC_ALL=C.UTF-8` | **0** | 8 files, **72/72** | `a17-a22-run6-c-utf8.log` |
| 7 | `with-pg.sh npx vitest run --configLoader runner --project integration a02-a21-complete-lifecycle.test.ts a02-a08-drafts-before-g2-scale-after-g5.test.ts` | **0** | 14/14 | `a02-run.log` |
| 8 | `with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/qac-a19-drill"'` | **0** | `restore-drill: … PASS; backup 4.606 s, restore 8.029 s, R9 PASS` | `a19-drill/` |
| 9 | T-B11 + A18 driver **run 0** | — | **Not a result.** Aborted by me because its vitest step lacked `--configLoader runner`. My `pkill` could not reach it (each shell call runs in its own sandbox), so it **kept running** and wrote into the same `transfer/` directory and scratch as run 1. | `t-b11-a18-run0-aborted.log` |
| 10 | T-B11 + A18 driver **run 1** | 1 | **Not a result:** mixed with run 0 (every step recorded twice in `steps.ndjson`, so `transfer-drill: FAIL: ;`). Run 0's cleanup then deleted the archive, so the A18 step failed with "input missing". Kept quarantined. | `t-b11-a18-run1-mixed.log`, `transfer-run0-run1-mixed/` |
| 11 | `QAC_RUN=run2 QA_PG_PORT=25460 with-pg.sh bash t-b11-a18-driver.sh` (own scratch and output; reuse refused) | T-B11 **0**; A18 **1** | T-B11 D0–D11 PASS (§2). A18: 8/8 pass, Vitest exit 1 from `Timeout calling "onTaskUpdate"` (F-DG7-qa-C-2) | `t-b11-a18-run2.log`, `transfer-run2/` |
| 12 | `QAC_RUN=run3 QAC_SKIP_TB11=1 QA_PG_PORT=25470 with-pg.sh bash t-b11-a18-driver.sh` (after the async fix) | **0** | A18 8/8, drill 283.4 s exit 0 | `a18-run3.log`, `a18-out-run3/` |
| 13 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers deploy/scripts/offline-drill.sh --out …/offline-run1` (offline drill, run 1) | 1 | 0/10 spec runs. **Every failure** is `EROFS … open 'test-results/qa-…/<lang>/….png'`, the specs' screenshot write into the read-only `test-results/`. **BLOCKED (sandbox)**, not a product result. The connection log still PASSed: 191 lines, loopback 191, outside 0. | `offline-drill-run1.log`, `offline-run1/` |
| 13b | the same with `QA_EVIDENCE_DIR=…/offline-run2-screens` (the specs' own override; run 2) | **0** | **PASS in 236.7 s: 10/10 spec runs** (demo group 194.2 s: a02-demo-labels, a02-demo-users-walkthrough, a02-guided-walkthrough, a21-no-ai-operation; plain group 42.3 s: a21-p6-degradation), each in `chromium-en` and `chromium-ar`. Probe `1.1.1.1:443 ENETUNREACH`, DNS `EAI_AGAIN`, `isolated: true`. Connection log 307 lines, loopback 307, socket 0, **outside 0**. Report sha256 `3240ed37…72061b`. EN and AR screenshots in `offline-run2-screens/{en,ar}/`. | `offline-drill-run2.log`, `offline-run2/`, `offline-run2-screens/` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)`. **Order:** run after the test edits, not first. | `validate-dg6.log` |
| 15 | `pnpm -r typecheck` | **0** | | `typecheck.log` |
| 16 | `pnpm lint` | **0** | | `lint.log` |
| 17 | `pnpm openapi:lint` | **0** | `OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| 18 | `pnpm test` as defined | **1** | EROFS `node_modules/.vite-temp`. **BLOCKED (sandbox).** D-265 records the orchestrator's plain `pnpm test` exit 0. | `pnpm-test-asis.log` |
| 19 | `pnpm test`'s three projects with `--configLoader runner` | **1** | unit-node 3021/3022: the A20 contrast test hit EROFS writing `test-results/` (sandbox). unit-web 2175/2175. unit-formula-nocodegen 259 passed and 2 skipped. | `pnpm-test-runner.log` |
| 20 | `QA_EVIDENCE_DIR=…/a20-contrast npx vitest run --configLoader runner --project unit-node` | **0** | **205 files, 3022/3022** | `unit-node-rerun.log` |
| 21 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | | `prettier.log` |
| 22 | `node tools/release/secret-scan.mjs --path docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C` | **0** | `secret-scan: PASS` over the whole evidence directory, re-run at the end (file count in the log) | `secret-scan.log` |

**BLOCKED, not run (no Docker daemon, D-243 Q1):** the orchestrator host halves, which are Compose up with `--pull never --wait`, image save/remove/load, the no-egress Compose run and the Keycloak e2e (REQ-S16-008, REQ-S19-018 image half, REQ-S19-010 Compose half). `/usr/bin/docker` exists, but there is no daemon. These remain the orchestrator's (D-265: still pending).

## 4. Known gaps and not done

- **End time:** about 14:12 UTC (about 54 minutes; within the 60–75 minute budget).
- **BLOCKED (no Docker daemon, D-243 Q1):**
  - Compose up on a clean host;
  - image save/load without a registry;
  - the no-egress Compose run;
  - the Keycloak e2e.

  These are the orchestrator's host halves. I did not run or judge them.
- **Not one run end to end.** T-B11 and the A18 harness passed on **different** fresh archives, because the harness needed a fix in between:
  - T-B11 run 2: the archive from `85f6ebe9f`; the A18 harness on it gave 8/8 tests but Vitest exit 1.
  - A18 run 3: a new archive from `3386b9092`, whose drill exited 0 and passed every assertion.

  The product code is identical between the two commits. A single T-B11 → A18 pair on one archive, both exit 0, was **not** done.
- **Order:** `validate.mjs --historical --stage DG6` ran after my test edits, not first.
- **`pnpm test` exactly as defined** is BLOCKED in this sandbox (EROFS). The equivalent with `--configLoader runner` and `QA_EVIDENCE_DIR` passes (#19, #20). D-265 records the orchestrator's plain run, exit 0.
- **The A19 drill measures synthetic demo timings only.** `restore-drill.sh` itself restores 0 evidence objects; the harness covers evidence. RPO/RTO are not set (external: Mobily IT).
- **Fixed but not independently re-reviewed:** the test fixes in §1 are this task's own edits. Another qa-verifier or reviewer should confirm that they only align the tests to ADR-0066 §2, ADR-0067 §4 and ADR-0069 §2 and do not weaken them. The a18 edit is uncommitted at handback.
- **Evidence size:** 16 MB, mostly offline-drill screenshots (EN and AR) and drill logs. `secret-scan` PASS over the directory (`secret-scan.log`).
- **No review record written.** This is a pre-freeze QA task with no review round assigned, so no `reviews/DG7/round-N/qa-verifier.json` exists, and nothing here is a DG7 verdict.

## 5. Open questions and findings (proposed IDs; the orchestrator allocates)

| Proposed ID | Severity | Mandatory violation | Requirement | Summary |
| --- | --- | --- | --- | --- |
| F-DG7-qa-C-1 | Medium | false | REQ-S20-019, REQ-S20-022, REQ-S12-022 | **Three acceptance-test files failed on the merged tree before this task, unnoticed through W8–W11.** <br>• A19 harness: 4 tests, reported by DO-F Q1 on 2026-11-13 and never routed. <br>• `a22-operational-readiness`: `retention.archive` ships disabled (BE-G 0147). <br>• `a22-p6-operability`: `/readyz` gained `storage`/`worker` (BE-B). <br>Repro: run #2. Expected: the A17–A22 integration files pass after each integrated wave. Actual: 6 failures. The orchestrator's per-wave checks (`pnpm test`) do not include the `integration` project. Each cause is a stale or wrong **test** expectation, not a product defect; the product matches ADR-0066 §2, ADR-0067 §4 and ADR-0069 §2. Fixed test-side here and re-verified (#4, #5). **Process question:** should the integration project run at each wave integration? |
| F-DG7-qa-C-2 | Medium | false | REQ-S20-018 | **The A18 harness exits 1 with all tests passing when the drill runs longer than Vitest's worker RPC timeout.** `spawnSync` blocks the worker. Repro: run #11 (drill 338 s): 8/8 pass, `Timeout calling "onTaskUpdate"`, exit 1. DO-D7's 260 s run happened to stay under it. Fixed test-side (async spawn in `beforeAll`), re-verified in run #12 (exit 0). |
| F-DG7-qa-C-3 | Medium | false | REQ-DLV (traceability of agent output) | **A concurrent agent run's auto-commit swept another running agent's uncommitted files into its commit.** `3386b9092` "T-DG7-ARCH-R6 output" contains QA-C's `tests/qa` edits (a19, a22 ×2) and partial QA-C evidence. Expected: `run-agent.sh` commits only the finishing run's own changes. Actual: the whole working tree. Attribution of those files in git history is wrong, and a reviewer reading `3386b9092` would credit ARCH-R6. W12 runs agents concurrently (`tools/agents/**` is outside my scope; the orchestrator decides). |

**Observations (no finding):**
- The archive is not byte-reproducible between runs at the same candidate (run 0/1 `a995cef1…`, run 2 `e1536479…`). The demo export is seeded per run and date (ADR-0064 A4.6), so this is expected. The candidate id inside (`c589659d94aa…`) was equal.
- My own process errors (runs 0 and 1, and the `ORDER BY` alias bug in run 3) are disclosed above. None of their output is used as a result.

**Open questions:**
- **Q1 (orchestrator):** copy this handback to `docs/delivery/handbacks/DG7/T-DG7-QA-C-qa-verifier.md` (write guard; see the note at the top).
- **Q2 (orchestrator):** commit the uncommitted a18 edit with QA-C's attribution, and decide F-DG7-qa-C-3.
- **Q3 (seal inputs, §L.1):**
  - `A18` → `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/transfer-run2/transfer-drill-report.json` (T-B11) and `…/a18-out-run3/transfer-drill-report.json` (harness), plus the offline drill report `…/offline-run2/offline-drill-report.json`;
  - `A19` → `…/a19-drill/drill-report.json` together with `a19-run4.log` (`A19-TIMINGS`).
