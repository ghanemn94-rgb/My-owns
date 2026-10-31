# T-DG6-DO-H handback: REQ-S20-030 idle-host re-measurement (devops-engineer)

- **Stage:** DG6 (P6), BUILDING. **Task:** T-DG6-DO-H. **Section:** `docs/architecture/p6-work-split.md` §H/G.10 (D-202 re-measurement).
- **Invocation:** `DG6-T-DG6-DO-H-devops-engineer-20261031T135135Z-44240bfa`, session `44240bfa-0829-4e42-8d28-b06c9eaef3ff`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-DO-H.md`. I checked its sha256 (`f6b140cf…1a66261d`) and it matches.
- **Tree:** worktree `/home/user/wt/dg6-do-h`, branch `dg6/do-h`, `HEAD` `879f84eafc093b0ab2999276329c186f7a4d5735`. The working tree was clean at the start.
- **Time:** started `date -u` 2026-10-31 13:51:50 UTC. Ended `date -u` Sat Oct 31 16:18:41 UTC 2026. That is about 2 h 30 min, past the ~2 h limit: I let the one integration run (§5.1) finish rather than hand back an unfinished required check (the assignment's "finish the current item").
- **Synthetic only.**
  - The load dataset, its users and every export are synthetic.
  - Nothing here grants any business, Finance or IT approval.
  - Product gates G1–G6 are not involved, and nothing here bears on DG7.
  - These are engineering measurements on one sandbox host (4 vCPU, a disposable PostgreSQL 16.15 cluster on the same host). They say nothing about Mobily production capacity or high availability.

## 0. Result in one paragraph

On an idle host (1-minute load average 0.58 / 0.75 / 0.92 before the three proofs, `nproc` 4), **no start took longer than 2 s in any of the three repetitions**. That covers all 198 starts, and the 150 simultaneous part-B starts among them:

- part B: p50 1,131 ms, p95 1,566 ms, max **1,578.571 ms** over all three repetitions;
- per repetition, part B max: 1,287.814 / 1,305.131 / 1,578.571 ms.

Results per export, in every repetition:

- every export returned 202 with a job id;
- progress was non-decreasing to 100, with status `succeeded`;
- the requester downloaded the file (200, byte count equal to `fileSizeBytes`);
- every other same-scope user and every AUD user got 404 for both the job and the download.

`export-proof.mjs` still **exits 1 in each repetition**. The cause is one assertion, the same in all three runs: `LOAD-T20 FAIL: no sameScopeOther user for this transformation`. That is the dataset gap BE-S and DO-G already reported. It is not a latency or access failure.

The earlier over-2 s figures were measured on a loaded host:

- DO-G proof 2: 24 of 50, at load average 11.8–19.1;
- BE-S: 48 of 50, at load average 10.7–15.

They are therefore consistent with host contention. This run does not reproduce them. The product change (assembling the snapshot in the worker) is the orchestrator's decision (D-202). This evidence does not call for it on an idle host. The latency does grow with concurrency: part B p50 is about 1.1 s, against about 85 ms for one requester's part A. The margin to 2 s is 0.42 s at the worst observed start.

## 1. Changed files (all new, all uncommitted)

No product code, test, contract, migration or `deploy/load/**` file is changed.

| File                                                                         | Purpose                                                                                                                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/delivery/handbacks/DG6/T-DG6-DO-H-devops-engineer.md`                  | This handback                                                                                                                                                        |
| `docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/driver.sh`                  | The exact driver: DO-G's `proof-idle-queue-driver.sh` repeated 3 times on fresh databases, with `uptime`/`nproc` before and after each proof                        |
| `…/T-DG6-DO-H-evidence/driver-output.txt`                                    | The driver's complete output (hashes, dataset counts, host load, proof stdout for each repetition)                                                                   |
| `…/T-DG6-DO-H-evidence/rep-{1,2,3}/export-proof.json`                        | `export-proof.mjs`'s own JSON reports (every export: start status, start ms, job id, percents, completion, download, other and AUD statuses)                          |
| `…/T-DG6-DO-H-evidence/summarize.mjs`, `summary.txt`                         | Read-only summary of the three reports: p50/p95/max per part, counts per assertion, and one line per export with its job id                                          |
| `…/T-DG6-DO-H-evidence/checks/*.log`, `validate-dg5-historical.txt`          | The acceptance checks (§5)                                                                                                                                           |

**Where the evidence is.** The assignment allows `deploy/load/runs/**` "or the folder the existing proofs use". The existing proofs (BE-S, DO-G) are in their handback evidence folders, so mine is in `docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/`. Nothing is written under `deploy/load/`. The orchestrator may copy the folder to `docs/delivery/test-evidence/DG6/load/` next to DO-G's `final/`, which is read-only for implementers (DO-G §1).

## 2. Method (workload and threshold unchanged, p6-plan R4)

Run as `QA_PG_PORT=27450 MTH_PORT_POOL=27451-27469 tests/qa/support/with-pg.sh bash docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/driver.sh`.

- Driver exit **0**. Wall time 569 s, from 13:55:07Z to 14:04:34Z.
- PostgreSQL 16.15, UTF8, C locale, port 27450 on the first attempt. Node v24.21.0.

**Identical to DO-G proof 2 and BE-S:**

- the dataset: profile `default`, the generator's default seed `20261027`;
- the generator copy: DO-F's `generate-rfc-uuid.patch` applied to a scratch copy, sha256 `6b2a9007e47b49640a497a356239cea1b79b5a0081a12c5e88dbf7f405bdff8a`, the same copy run-1, BE-S and DO-G used. The tree's `generate.mjs` (`7470ea74…`) still writes non-RFC ids, an open item;
- 100 sessions minted by `sessions.mjs`;
- the `search.reindex` job completed before any measurement;
- a freshly started API and worker (`MTH_ENV=load`, `NODE_ENV=production`, product default rate limits, no tuning);
- `deploy/load/export-proof.mjs` unchanged: sha256 `7865d9d3f1aa5d4063b72243ad52e795c485fcee78fe24c429663d5549ed154b`, `START_TARGET_MS = 2000`, poll 250 ms, timeout 900 s;
- part A: `LOAD-T01` (250 initiatives), 16 exports by one requester (xlsx and csv);
- part B: 50 csv `registers/raid` exports at once, one per transformation, by 50 distinct users.

**Measurement-side additions, which change no part of the workload:**

- Each repetition drops and recreates the database and regenerates the dataset, so each proof meets the same data and an empty export queue (`export_job before proof 0` and `pgboss queued/active reports.export jobs: 0` in each repetition).
- `uptime` and `nproc` are recorded before and after each proof.
- An idle gate runs after API readiness: the driver waits until the 1-minute load average is ≤ 1.0, for at most 600 s. It never waited: the load was already ≤ 1.0 each time (0 s).

**Binaries:**

- `apps/api/dist/main.js` `5aa6313a…`, the same as DO-G;
- `apps/worker/dist/main.js` `ace16e09…`. DO-G had `b9b263a2…`: the worker changed in later integrated merges;
- `packages/db/dist/cli.js` `30c51a6d…`;
- 113 migrations, the highest `0121`.

**Datasets** (each repetition, from `driver-output.txt`):

- generate exit 0, wall time 29.4 / 29.6 / 29.5 s;
- the marker shows 120 users, 50 transformations, 1,000 initiatives, 10,000 KPI actuals and 100,000 audit events;
- `LOAD-T01` holds 250 initiatives;
- 0 non-RFC initiative ids.

## 3. Host load (D-202)

| Point                | `uptime` load average (1 / 5 / 15 min) | `nproc` | Time (UTC) |
| -------------------- | -------------------------------------- | ------- | ---------- |
| driver start         | 0.19 / 0.90 / 1.27                     | 4       | 13:55:07   |
| rep 1 before proof   | 0.58 / 0.90 / 1.25                     | 4       | 13:56:01   |
| rep 1 after proof    | 0.31 / 0.72 / 1.14                     | 4       | 13:58:14   |
| rep 2 before proof   | 0.75 / 0.77 / 1.13                     | 4       | 13:59:10   |
| rep 2 after proof    | 1.02 / 0.91 / 1.13                     | 4       | 14:01:25   |
| rep 3 before proof   | 0.92 / 0.90 / 1.11                     | 4       | 14:02:21   |
| rep 3 after proof    | 0.56 / 0.76 / 1.03                     | 4       | 14:04:34   |

No other agent or test run was active (D-004). Before the run started I ran only `validate.mjs` and file reads. Nothing ran in parallel with the driver.

## 4. Behaviour per requirement row

**REQ-S20-030.** Acceptance: "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester". "Immediately" is read as within 2 s (ADR-0058 §7). "The full load dataset" is read per D-199 item 2.

| Repetition | Start, part A (16): p50 / p95 / max ms | Start, part B (50 at once): p50 / p95 / max ms | Starts > 2 s | 202 + job id | Non-decreasing to 100, `succeeded` | Requester 200 | Other same-scope 404/404 | AUD 404/404 | Proof exit |
| ---------- | -------------------------------------- | ---------------------------------------------- | ------------ | ------------ | ---------------------------------- | ------------- | ------------------------ | ----------- | ---------- |
| 1          | 89.111 / 251.142 / 251.142             | 1,087.965 / 1,285.831 / 1,287.814              | **0 of 66**  | 66/66        | 66/66                              | 66/66         | 65/65                    | 66/66       | 1 (T20)    |
| 2          | 78.08 / 253.986 / 253.986              | 1,107.996 / 1,293.923 / 1,305.131              | **0 of 66**  | 66/66        | 66/66                              | 66/66         | 65/65                    | 66/66       | 1 (T20)    |
| 3          | 80.54 / 235.944 / 235.944              | 1,266.561 / 1,572.297 / 1,578.571              | **0 of 66**  | 66/66        | 66/66                              | 66/66         | 65/65                    | 66/66       | 1 (T20)    |
| all 3, B   | —                                      | n=150: 1,130.569 / 1,565.853 / 1,578.571       | 0 of 150     |              |                                    |               |                          |             |            |

Percentiles are nearest-rank, as in `export-proof.mjs`.

- **Job ids.** Every one of the 198 job ids is in `summary.txt` (one line per export) and in `rep-N/export-proof.json`. Each repetition's database ended with `export_job succeeded 66`. The API and the worker logged 0 error-level lines.
- **The only failing assertion:** `LOAD-T20 … no sameScopeOther user for this transformation`. This is the known dataset gap (BE-S §8, DO-G §2.2): LOAD-T20 has no second non-AUD user. The access check for that export is still covered by the AUD user (404/404). This is why `export-proof.mjs` exits 1 in each repetition. Fixing it is the dataset owner's call, and I changed nothing.
- **Completion times** are reported only; there is no target for them.
  - Part A: p50 about 1.85 s, max 2.95 s.
  - Part B: p50 48.3–50.6 s, max 98.2–100.6 s. The worker drains the 50 jobs one after another, as before.
- **`EXPORT_MAX_BYTES`:** the largest file is 60,328 bytes. No reopen candidate comes from the cap.
- **Comparison with earlier runs** (same workload; different host load):

  | Run                       | Load average      | Part B starts > 2 s | Part B max   |
  | ------------------------- | ----------------- | ------------------- | ------------ |
  | DO-G proof 2              | 11.8 → 19.1       | 24 of 50            | 2,265 ms     |
  | BE-S                      | 10.7–15           | 48 of 50            | 3,262 ms     |
  | This run, reps 1–3 (idle) | 0.58–0.92 → ≤1.02 | 0 of 50 (each)      | 1,578.571 ms |

**Statement as D-202 asks.** No start exceeded 2 s on the idle host.

Two cautions:

- **Concurrency costs latency.** 50 simultaneous starts take about 1.1–1.6 s against about 0.1–0.25 s for one requester. On a loaded host of this size the 2 s target was missed. Whether a production host shares load in that way is for Mobily IT, and this single-host run says nothing about it.
- **Requirement status is not mine to set.** The row's status is the orchestrator's and reviewers' decision. I set nothing in the register.

## 5. Checks (each run sequentially, after the driver, on this tree)

Environment: Node 24.21.0, offline. The logs are in `docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/checks/`.

| #   | Command                                                                                         | Exit  | Wall    | Result                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------- | ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0   | `node tools/gates/validate.mjs --historical --stage DG5` (before work at 13:52Z, exit 0; again at 14:06Z)       | **0** | —       | `PASS gate DG5 (historical)` (`validate-dg5-historical.txt`)                                                                 |
| 1   | `pnpm -r typecheck`                                                                             | **0** | 237 s   | `typecheck.log`                                                                                                              |
| 2   | `pnpm -r build`                                                                                 | **0** | 175 s   | `build.log`                                                                                                                  |
| 3   | `pnpm lint`                                                                                     | **0** | 45 s    | `lint.log`                                                                                                                   |
| 4   | `pnpm openapi:lint`                                                                             | **0** | 1 s     | `openapi.log`                                                                                                                |
| 5   | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`      | **0** | 104 s   | "All matched files use Prettier code style!" (`prettier.log`)                                                                |
| 6   | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset)                        | **0** | 383 s   | unit-node 186 files / 2,801 tests passed; unit-web 120 / 2,015 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped (`test-unit-locale-unset.log`) |
| 7   | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`                                                         | **0** | 380 s   | identical counts: 2,801; 2,015; 259 + 2 skipped (`test-unit-c-utf8.log`)                                                     |
| 8   | `QA_PG_PORT=27450 MTH_PORT_POOL=27451-27499 tests/qa/support/with-pg.sh pnpm test:integration`  | see below | | see below                                                                                                         |

- **The 2 skipped tests** are the existing skips in `packages/shared/src/formula/fuzz.test.ts` ("111 tests | 2 skipped"). They are the same as in DO-G's logs, and this task did not add them.
- **Row 8, attempt 1** (`checks/test-integration-attempt1-killed-by-tool-limit.log`) was **stopped by my agent tool's 40-minute background-command limit**, not by a test result. When it was stopped, 1,039 tests had passed and 0 had failed. The log has no summary line, so attempt 1 proves nothing on its own. I restarted the run with a 2-hour limit (`checks/test-integration.log`); its result is in §5.1.

- **Prettier after the full check.** Row 5 ran before I wrote this handback. At 16:18Z I ran `npx prettier --write` and then `npx prettier --check --ignore-unknown` on this handback and every file in `T-DG6-DO-H-evidence/`: exit 0, "All matched files use Prettier code style!". The full tree is unchanged since then, apart from those files.

### 5.1 Integration result

**Exit 0.** `QA_PG_PORT=27450 MTH_PORT_POOL=27451-27499 tests/qa/support/with-pg.sh pnpm test:integration`, attempt 2 (`checks/test-integration.log`).

- Ran from 15:18:47Z to 16:18:27Z (wall 3,580 s), PostgreSQL on port 27450 (first attempt).
- `Test Files  406 passed (406)`.
- `Tests  4119 passed | 1 skipped | 2 todo (4122)`.
- The skip and the todos are existing marks: for example `audit-events.test.ts` and `presentation.test.ts` have "1 skipped", and the rate-limit test has an export "todo". This task added none.
- No test failed. The run had no retry and no rerun of a single file.
- The host was otherwise idle; nothing ran in parallel.

**Pinned counts:** none changed. This task touches no contract, catalogue, seed or test pin.

## 6. Pending operations, contracts, dependencies, user-facing texts

- **Operations routed:** none. This task has no `p6-pending-*.ts` list and no `p6-exercises-*.ts` file. The delta is empty.
- **Contract, schema, migration or dependency needs:** none. No migration was needed, and no dependency was added.
- **User-facing texts made untrue:** none. No en/ar string is touched or affected.

## 7. What remains, and notes for the orchestrator

1. **The D-202 decision.** On the idle host, 0 of 198 starts exceeded 2 s (part B max 1,578.571 ms over three repetitions). Whether to make the product change (assemble the snapshot in the worker) or close the finding candidate from DO-G §7 item 4 is the orchestrator's decision. I propose nothing beyond reporting the figures.
2. **D-202 is not in `docs/delivery/decisions.md`** on this branch: the highest entry is D-201. I followed the assignment's description of D-202. Please record it.
3. **Still open, and outside my ownership:**
   - The LOAD-T20 same-scope gap. Because of it, `export-proof.mjs` exits 1 even when every latency and access assertion holds.
   - The generator's non-RFC ids. These figures, like all of DG6's load figures, come from the patched scratch copy `6b2a9007…`.
4. **Evidence location:** please copy `T-DG6-DO-H-evidence/` (or its `rep-*`, `summary.txt` and `driver*`) under `docs/delivery/test-evidence/DG6/load/` if it should sit next to DO-G's `final/`.
5. **Merge:** documentation and evidence only. No migration, no ordering constraint, no expected conflict.

End: `date -u` → Sat Oct 31 16:18:41 UTC 2026.
