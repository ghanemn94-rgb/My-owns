# Handback: T-DG6-DO-FB, continuation of T-DG6-DO-F (the workload harness and the first load run) (devops-engineer)

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING.
  - This handback decides nothing about the DG6 engineering gate.
  - Product gates G1–G6 are untouched. Nothing here grants a business, Finance or IT approval.
  - The load dataset and its users are synthetic.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-DO-FB.md` (sha256 `b58cfa27…27f3e1`, verified). Scope: `docs/architecture/p6-work-split.md` §H/G.8, ADR-0058 §1, §3, §5, §6, §10.
- **Invocation:** `DG6-T-DG6-DO-FB-devops-engineer-20261030T123737Z-e3d16ef8`, session `e3d16ef8-ccb3-4aeb-b3a1-ca97f36a5978`.
- **Working tree:** `/home/user/wt/dg6-do-f`.
  - `HEAD` is `cd61366a5`: DO-F's WIP commit `b3c0843` merged with the integrated branch at `4edfe8faa`.
  - The checked-out branch is named `dg6/do-f`, not `dg6/do-fb` as the assignment says. I created no branch.
  - My changes are **uncommitted**.
- **Time:** started `2026-10-30T12:42:12Z`, finished `2026-10-30T14:24:42Z` (`date -u`).
- **Evidence:** `docs/delivery/handbacks/DG6/T-DG6-DO-FB-evidence/`.

## 0. Who wrote what

| Part | Author |
| --- | --- |
| `deploy/load/workload.mjs`, `deploy/load/report.mjs`, `deploy/load/harness.node-test.mjs` | **DO-F** (commit `b3c0843`). Unchanged by me. |
| Run-1 (3 repetitions), its draft report, the EXPLAIN pass, the generator patch proposal: `docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/**`, `generate-rfc-uuid.patch`, `smoke-diagnosis-invalid-uuid.txt` | **DO-F**. Unchanged by me. The measurements stay as measured (p6-plan R4). |
| `docs/delivery/handbacks/DG6/T-DG6-DO-F-devops-engineer.md` | **DO-F**. I left it as the record of the killed run, placeholders included. **This handback supersedes its §3 rows 2–9, its `__CHECK_NOTES__` and its §8 `__REMAINS_CHECKS__`.** |
| DO-F's check logs in `T-DG6-DO-F-evidence/` (`typecheck.log`, `build.log`, `lint.log`, `prettier.log`, `openapi-lint.log`, `test-unit-locale-unset.log`, `checks-summary.txt`) | **DO-F**. They ran on the old base `9ca454f`, and the last one was cut off by the restart. They are **superseded**: no claim here rests on them. |
| My review of DO-F's work (§2), all the checks on the merged tree (§3), and this handback with its evidence folder | **DO-FB** (me) |

## 1. Changed files (mine, uncommitted)

| File | Purpose |
| --- | --- |
| `docs/delivery/handbacks/DG6/T-DG6-DO-FB-devops-engineer.md` (new) | This handback |
| `docs/delivery/handbacks/DG6/T-DG6-DO-FB-evidence/node24/*` (new) | The acceptance check logs on Node 24.21.0 and their `checks-summary.txt` |
| `docs/delivery/handbacks/DG6/T-DG6-DO-FB-evidence/node22/*` (new) | My first, superseded chain on Node 22.22.0 (see §3), kept for disclosure |
| `docs/delivery/handbacks/DG6/T-DG6-DO-FB-evidence/{checks24a,checks24b}.sh.txt` (new) | The exact check scripts |
| `docs/delivery/handbacks/DG6/T-DG6-DO-FB-evidence/run-1-{p95-recompute,reproduction}.txt` (new) | My independent verification of run-1 |

I changed no code, test, migration, contract or i18n file.

## 2. Critical review of DO-F's work, and the behaviour delivered

**REQ-S20-029.** Acceptance: "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding".

§H/G.8's part of this row is delivered. The row as a whole is **not complete**: BE-S (fixes) and DO-G (the final run on the frozen tree) follow (§H/G.13).

### What I verified (kept as correct)

1. **The harness matches ADR-0058 §3 and §6** (`workload.mjs`, read in full):
   - 100 concurrent users, each on its own minted session;
   - the five classes with shares 50/15/8/25/2 and exactly the §3 operation ids;
   - deterministic per-user mulberry32, and a think time of 1000–3000 ms in whole milliseconds;
   - the update partition: each initiative goes to exactly one editor, and the run had 0 × 409;
   - timing from just before `fetch` to the end of the body, in integer microseconds;
   - warm-up excluded by request start time;
   - 409 counted separately; any other non-success (including 429 and network failure) is an error;
   - no retry while measuring;
   - it refuses a database without the load marker;
   - setup reads the database in a `READ ONLY` transaction, and no credentials go into `setup.json`.
2. **The report method matches §6 and §10** (`report.mjs`):
   - nearest rank computed in integer arithmetic, `rank = floor((p·n+99)/100)` = ⌈p·n/100⌉;
   - the class result is the highest p95 of the three repetitions;
   - "not measured" is `null`, never 0 or a pass;
   - the §5 infrastructure statement is measured at capture.
3. **The figures, checked independently** (`run-1-p95-recompute.txt`). I recomputed every class p95 per repetition from the raw `samples.csv.gz` with `awk`, not with `report.mjs`. All 15 values equal the report. Sample counts:
   - steady state: 26,393, 26,424 and 26,297;
   - error rows: 0 in each repetition;
   - the sha256 of all three sample files and of `report.md`, `summary.json` and `infrastructure.json` equal DO-F's handback.
4. **The disclosed post-run edits are what was disclosed** (`run-1-reproduction.txt`).
   - Reversing `workload-changes-after-run.diff` and `report-changes-after-run.diff` on the current files gives exactly the hashes the driver recorded at the run (`c138c217…`, `35bb1dc7…`).
   - The current `report.mjs` regenerates `report.md` (`1d10a57a…`) and `summary.json` (`ea55b9de…`) **byte for byte** from the unchanged samples.
   - So nothing was re-tuned after the run.
5. **`node --test deploy/load/harness.node-test.mjs`** passes (§3).

### Run-1 result (DO-F's measurement, unchanged)

Highest p95 over 3 repetitions, steady state 10 min each after a 2 min warm-up, 100 users, seed 20261027:

| Class (target) | Highest p95 | Result |
| --- | --- | --- |
| Ordinary read (2 s) | 745.8 ms | within target |
| Ordinary update (2 s) | 1,007.4 ms | within target |
| Search (2 s) | 748.2 ms | within target |
| Key dashboard (4 s) | 1,191.2 ms | within target |
| Export start (2 s) | 2,688.1 ms | **MISS** |

- **Finding candidate:** export start, p95 2,688.1 ms against 2 s. Medium, non-mandatory (ADR-0058 §1, D-195 Q9). The orchestrator allocates the id.
- **Not measured:** `getWorkstreamDashboard`, because the `default` dataset has no workstreams.
- These are sandbox engineering measurements on an oversubscribed single host (1-minute load average 15.5–21.0 on 4 CPUs). They are not Mobily production capacity, and a single host is not high availability.

### What I found wrong or incomplete, and what I did

- **DO-F's handback was unfinished.** Its placeholders were not filled, and its check logs came from an old base, one of them truncated. I ran every check on the merged tree (§3).
- **I found no defect in DO-F's code or figures**, so I made no code change.
- The open points DO-F raised still stand and need decisions. They are restated in §5.

**REQ-S20-030** is not this task's. The export proof belongs to BE-S and the final run to DO-G.

## 3. Checks actually run (merged tree `cd61366a5`, plus my uncommitted evidence files)

**Environment:**

- Host: 4 vCPU, 16 GB RAM, kernel 6.18.44-fc-v185. The 1-minute load average was 5–15 during the checks, because other agents shared the host.
- Toolchain: pnpm 10.33.0, offline.
- Integration cluster: `with-pg.sh` on port 25670, pool 25671–25699. The single-file re-run used port 25651, pool 25652–25669. Both are inside my 25650–25699 range.

**Node version (disclosed).** My first check chain ran on the shell's default `node`, which is **v22.22.0** (`/opt/node22/bin`, first on `PATH`). That is inside the `engines` range `>=22.18.0 <25`, but it is not the Node 24.21.0 the assignment names.

- When I noticed, I stopped that chain after its locale-unset unit run, by truncating its script so it ended at the next line.
- I then re-ran every check with `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`.
- **The acceptance results below are the Node 24.21.0 runs** (`node24/`). The Node 22 logs stay in `node22/` as supplementary evidence. Every Node 22 check exited 0, with the same unit counts.
- Scripts: `checks24a.sh.txt`, `checks24b.sh.txt`, `node22/checks-node22.sh.txt`.

| # | Command (Node 24.21.0 unless stated) | Exit | Wall | Result / counts | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | 185 s | `PASS gate DG5 (historical)`. It also passed on Node 22, exit 0, 89 s (`node22/validate-dg5-historical.txt`). | `node24/validate-dg5-historical-standalone.txt` |
| 2 | `pnpm -r typecheck` | **0** | 252 s | All packages | `node24/typecheck.log` |
| 3 | `pnpm -r build` | **0** | 145 s | All packages | `node24/build.log` |
| 4 | `pnpm lint` | **0** | 39 s | — | `node24/lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | 233 s | "All matched files use Prettier code style!" (run at 14:10Z; after my last edits to this handback I re-checked it alone with `npx prettier --check`, exit 0) | `node24/prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | 1 s | — | `node24/openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE -u LC_MESSAGES pnpm test` | **0** | 493 s | unit-node 176 files / 2,722 tests passed; unit-web 99 / 1,789 passed; unit-formula-nocodegen 3 files, 259 passed and 2 skipped (261) | `node24/test-unit-locale-unset.log` |
| 8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | 966 s | The same counts: 176 / 2,722; 99 / 1,789; 3 / 259 passed and 2 skipped | `node24/test-unit-c-utf8.log` |
| 9 | `QA_PG_PORT=25670 MTH_PORT_POOL=25671-25699 tests/qa/support/with-pg.sh pnpm test:integration` | **NOT COMPLETED** | >56 min | **Not finished within my time limit.** At the snapshot (14:24:14Z, 55.6 min in), 161 test files had passed and 2 had failures, out of the 378 files that match the include globs (`ls` count), with 3 failed tests. Classification is below. The background task's 90-minute limit ends this run at about 14:32Z, so it will not reach a summary line. **Acceptance item 3 is therefore not met by this task.** | `node24/test-integration.log`, `node24/test-integration-snapshot.txt` |
| 9b | The same harness on port 25651 with only `apps/api/test/integration/contract/response-validation.test.ts` | **0** | 241 s | 110/110 passed: both full-run failures of this file passed alone | `node24/rerun-response-validation.log` |
| 9a | The same harness on port 25651 with only `apps/api/test/integration/assistant/conversations.test.ts` | **1** | 61 s | 16 passed, **1 failed**, deterministic (below) | `node24/rerun-assistant-conversations.log` |
| 10 | `node --test deploy/load/harness.node-test.mjs` | **0** | <1 s | 7/7 pass | `node24/harness-node-test.log` |
| 11 | Run-1 re-verification (§2 items 3–4): `awk` recomputation, reverse patches, `report.mjs report` on a scratch copy | 0 | — | 15/15 p95 equal; report and summary byte-identical | `run-1-p95-recompute.txt`, `run-1-reproduction.txt` |

**The 2 skipped unit tests** are by design. They are `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts` (lines 600 and 833), inside the no-codegen project.

**Integration failure (disclosed; not in this task's scope; for the orchestrator).** The failing test is `apps/api/test/integration/assistant/conversations.test.ts` › "the rate-limit class `assistant` and the log line … over the per-minute budget a post is 429 with Retry-After; each post writes one log line without the prompt".

- **Symptom:** the first assistant log line has `replyKind: "answer", dataItems: 1`, where the test expects `"no_sources", 0` (line 670).
  - The assertions before it passed: the two 201s, the 429 with `Retry-After`, the read 200, and exactly two log lines.
  - The prompt-canary assertion after it (line 677) did not run.
- **It is deterministic.** It failed in the full run and again alone (9a).
- **It is not caused by DO-F's or my work.**
  - `git diff --name-only 4edfe8faa HEAD` lists only DO-F's evidence files and the three standalone scripts `deploy/load/{workload,report,harness.node-test}.mjs`.
  - Nothing in `apps/`, `packages/`, `tests/` or the Vitest configuration imports those scripts (grep finds no reference).
  - So the integrated branch `4edfe8faa` carries this failure itself.
- **Likely cause.** The assistant's data access now finds a source for "Synthetic … 0" in the shared scratch database. That looks like a merge seam between the assistant tasks (BE-T/BE-U) and another merged slice; the last commits on the file are `4b936d3de` (BE-T) and `6a3445959` (BE-U).
- **I did not touch it.** The assistant module and its tests are outside my ownership.

**Two more failures in the full run: under load, not reproduced alone.** Both are in `apps/api/test/integration/contract/response-validation.test.ts`:

- "… > P5 BE-J operations (p5-exercises-be-j.ts)": 2,087 ms in the full run.
- "… > every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written": 30,003 ms in the full run, which is the 30 s test timeout.

On their own (9b) both passed, in 856 ms and within the file's 241 s. The full run went at a 1-minute load average of about 14 on 4 CPUs.

- The timeout is a determinism-under-load defect of that test (the F-DG4-143–148 class), not a product failure.
- The assertion detail for the BE-J failure prints only in the summary at the end of the run, which never came. **Its cause is therefore not established.** I classify it only as "not reproduced alone".
- The owner is the contract test's, not this task's.

- **Pinned counts:** I changed none. DO-F and I touched no contract, catalogue or seed pin.

## 4. Operations routed (pending-list delta)

None. This task has no pending list and no exercises file. Nothing changes in the operation count, the media types, the rate-limit floor or the CSRF-exempt routes.

## 5. For the orchestrator: contract, schema, dependency and ownership needs

All of these carry over from DO-F §5, and I re-checked each on the merged tree.

1. **The generator's ids are not RFC UUIDs.**
   - `deploy/load/generate.mjs` is still sha256 `7470ea74…` on the merged tree, so the defect remains.
   - The fix is DO-E's file, or the orchestrator's: DO-F's patch `T-DG6-DO-F-evidence/generate-rfc-uuid.patch` (sha256 `67a5a817…f1b72`).
   - Run-1 used a patched scratch copy. DO-G needs the decision before the final run.
2. **The evidence path is protected.** §H/G.8 names `docs/delivery/test-evidence/DG6/load/run-1/`, but it is read-only for implementers.
   - Re-confirmed: `mkdir docs/delivery/test-evidence/DG6/load` gives "Read-only file system".
   - Run-1 stays in `docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1/`. Please copy it to the named path.
3. **No workstreams in the `default` dataset**, so `getWorkstreamDashboard` cannot be measured. Either the generator adds workstreams or the ADR-0058 §3 mix drops the operation. Please decide before DO-G.
4. **`harness.node-test.mjs` runs outside Vitest.** No Vitest project includes `deploy/`, so it runs with `node --test` (§3). Converting it, or adding an include, is your call.
5. **The `deploy/load/README.md` usage** for `workload.mjs` and `report.mjs` is DO-E's file and is not written yet. The usage is in the script headers and in `T-DG6-DO-F-evidence/load/run-1/driver.sh`.
6. **Contract observation.** `listTransformations` declares the query parameter `sort` twice in `docs/api/openapi.yaml`: the DG2 enum and the ADR-0057 §5 enum.
7. **Needs:** no migration, no dependency, no new problem code.
8. **New, found by my checks: the integration suite is red on the integrated branch.** The assistant rate-limit log test fails deterministically (§3, "Integration failure"). It is for the owner of `apps/api/test/integration/assistant/**` and `modules/assistant/**`, which is not this task. Two `response-validation.test.ts` failures under load also need that test's owner (§3, 9b).

## 6. User-facing texts

None changed, and none became untrue. This task ships no UI string.

## 7. Merge instructions

- I made no code change. DO-F's three `deploy/load/` files are already in `b3c0843`.
- My additions are this handback and its evidence folder, which conflict with nothing.
- The run-1 reproduction steps are in DO-F's handback §7.

## 8. What remains

- **REQ-S20-029 stays open** for:
  - BE-S: the export-start fixes named by run-1's EXPLAIN digest, and the generator decision in §5 item 1;
  - DO-G: the final run on the frozen tree.
- **Orchestrator decisions:** §5 items 1–4.
- **Acceptance item 3 (`pnpm test:integration`) is not met by this task.**
  - The full Node 24 run did not finish within my about-2-hour limit: 161 + 2 of 378 files at the snapshot.
  - It had found 1 deterministic failure (assistant, outside my scope) and 2 failures under load (contract test).
  - Remaining: a full integration run on a less loaded host, after the assistant test is fixed by its owner. Nothing in this task's own files needs it; the run is the acceptance evidence.
- Acceptance items 1, 2 and 4 are met on Node 24.21.0 (§3 rows 1–8).
- DO-F's handback keeps its placeholders. This file supersedes them (§0).
