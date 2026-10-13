# T-DG4-BE-R7 handback: the a08 G6 delivery fingerprint narrowed to the gate records (D-138)

- **Agent:** backend-workflow-engineer (project agent), stage DG4, task T-DG4-BE-R7.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-R7-backend-workflow-engineer-20261013T134634Z-22e92ba4","session_id":"22e92ba4-3e57-47c7-b759-56c92687c72e"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-R7.md` (sha256 `5dc25f13…cb55`, verified before starting).
- **Starting revision:** worktree `/home/user/wt/be-r7`, branch `dg4/be-r7`, `HEAD` `0e34307d754f2ed753b1a52d61f397039cbd2880`, no tracked modifications at the start.
- **Time:** `date -u` gave 2026-10-13 13:46:47 UTC at the start and 14:35:48 UTC before this handback was written, about 49 minutes.
- **Changes are uncommitted**, as the assignment asks.

**Path note for the orchestrator.** The assignment names this file `T-DG4-BE-R7-frontend-ux-engineer.md`, but the task was given to backend-workflow-engineer. The protocol's default would be `T-DG4-BE-R7-backend-workflow-engineer.md`. I wrote to the path the assignment names. Please rename it if the role suffix was a typo.

## 1. Changed files

- **`tests/qa/integration/a08-gate-controls.test.ts`** is the only file of the candidate I changed. Diff: `T-DG4-BE-R7-evidence/09-test-change.diff`.
  - `deliveryFingerprint()` now hashes only `DELIVERY_RECORDS`: `gates`, `stages.json`, `findings.json`, `reviews`, `decisions.md`, `requirements.csv`. That is the same set as T-DG4-BE-R3's `DELIVERY_RECORDS` in `apps/api/test/integration/workflows/g5-g6.test.ts` (D-112).
  - It follows the same missing-path rule: a missing entry is listed as `"<entry>": "missing"`, never skipped. The function still returns `Record<string, string>` keyed by path relative to `docs/delivery/`, so every existing assertion reads it unchanged.
  - Its doc comment now says why: these are the records a product G6 approval could be confused with (M0412, product G6 never implies DG7). Handbacks, assignments, candidates, runs, test evidence and progress notes are not gate state, and hashing them twice (342 MB) broke the 30 s limit on a cold cache, at a cost that grows every round.
  - The file header now says the suite asserts that a product G6 approval writes none of the engineering delivery records under `docs/delivery/`, instead of "nothing under docs/delivery/".
  - The import adds `existsSync`.
- **Evidence** (new, under `docs/delivery/handbacks/DG4/T-DG4-BE-R7-evidence/`). The `00-orchestrator-*` files were already there and I left them unchanged.
  - `measure-fingerprint.mjs`: a cost-measurement script with faithful copies of the old and new fingerprint.
  - `make-mutant.mjs`: builds the scratch non-vacuity mutant.
  - Logs `00-validate-dg3-start.log`, `01-cost-before.log`, `02-cost-after.log`, `03-a08-run{1,2,3}.log`, `04-non-vacuity.log`, `04-non-vacuity-full.log`, `05-typecheck.log`, `06-lint.log`, `07-prettier.log`, `08a-integration-full-KILLED-attempt1.log`, `08-integration-full.log`, `10-validate-dg3-end.log`.
  - `09-test-change.diff`.

**What did not change:**

- the test's name, which D-138 and the orchestrator's logs cite;
- its timeout (the 30 s default);
- the steps in its body;
- its assertions:
  - the fingerprint includes `stages.json`, `findings.json` and `requirements.csv`;
  - it includes at least one `gates/DGx.json`;
  - G6 decides 201 and the instance is `approved`;
  - no `DG[0-7]` appears in the decision body;
  - exactly one `gate.decided` event, consumed by `handleGateDecided`;
  - the fingerprint after equals the fingerprint before.

Nothing is skipped.

## 2. Behaviour delivered

- **D-138 repair (REQ-S04-008 test reliability, A08).** The G6 fingerprint reads 535 files and 9.96 MB instead of 4,954 files and 345 MB, and still covers every DG gate record a G6 approval could be confused with.
- **Product behaviour:** none. No product code, contract, schema or migration changed.

## 3. Cost before and after (item 3)

I measured with `node docs/delivery/handbacks/DG4/T-DG4-BE-R7-evidence/measure-fingerprint.mjs .` on this worktree, with a warm cache, two runs each. The script runs both forms and times one pass; the test runs two passes.

- **Before** (`01-cost-before.log`, `HEAD` `0e34307`):
  - old form: 4,954 files, 345,109,395 bytes (329.1 MiB), one pass 630 ms and 611 ms;
  - new form: 535 files, 9,960,497 bytes (9.5 MiB), one pass 22 ms.
- **After** (`02-cost-after.log`, measured while the integration suite ran):
  - old form: 4,965 files, 345.19 MB, 599 ms and 568 ms;
  - new form: 535 files, 9,960,497 bytes, 29 ms.
  - The log also prints the test's new function, which matches the script's "new" form.
- **The old form is unstable.** Its byte count changed between consecutive passes (345,109,395 → 345,109,723), and its file count grew from 4,954 to 4,965. Both changes come from this task's own logs, written under `handbacks/` while I measured. A log written there while the suite runs is the same kind of interference D-112 described for `runs/`. The narrowed form does not read `handbacks/`.
- **Cold-cache projection** (an inference from D-138's figure of about 16 MB/s, not a measurement):
  - new form: about 0.6 s per pass, about 1.2 s for the test's two passes;
  - old form: about 21.6 s per pass, about 43 s for two.
  - Like D-138, I did not reproduce a cold cache on demand.
- **Test duration.** The G6 test took 325, 233 and 203 ms in the three a08 runs, and 342 ms in the full suite. D-138 recorded 1.5 s warm and 37.6 s cold before the change.

## 4. Non-vacuity (item 4)

**Method** (`make-mutant.mjs`, log `04-non-vacuity.log`, full output `04-non-vacuity-full.log`). The script writes a temporary copy of the test, `tests/qa/integration/zz-a08-mutant-scratch.test.ts`, that differs in two ways only (its unified diff is in the log):

1. `DELIVERY` points at a scratch copy of the six records under `$TMPDIR`, so no real delivery record is touched.
2. A `mutate()` call sits between `handleGateDecided(...)` and the final `expect(deliveryFingerprint()).toEqual(before)`.

Each variant ran the whole file on its own disposable PostgreSQL (ports 26250–26299). I deleted the scratch test after the runs. `git diff --quiet` on the six real records then reported "real records untouched: yes".

| `MUTANT`                                    | Expected | Result                                                                                                          | Exit |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| `none` (control)                            | pass     | 31/31 passed                                                                                                    | 0    |
| `decisions` (append `x` to `decisions.md`)  | fail     | G6 test fails, `-"decisions.md": "9423994e…"` / `+"decisions.md": "f3f105eb…"`; 1 failed, 30 passed             | 1    |
| `gate` (append a space to `gates/DG3.json`) | fail     | G6 test fails, `-"gates/DG3.json": "c906db0e…"` / `+"gates/DG3.json": "a9098377…"`; 1 failed, 30 passed         | 1    |
| `findings-removed` (delete `findings.json`) | fail     | G6 test fails, `-"findings.json": "7e937f78…"` / `+"findings.json": "missing"`; 1 failed, 30 passed             | 1    |
| `handback` (write `handbacks/x.md`)         | pass     | 31/31 passed: out of scope by design (D-138), recorded so the narrowing is explicit, not a gap in the assertion | 0    |

In every failing variant, the failing test is exactly 'REQ-S04-008: a product G6 approval (API and its worker consumer) changes nothing under docs/delivery/'.

## 5. Checks run

**Environment:**

- Node 24.21.0, offline;
- worktree `/home/user/wt/be-r7` at `0e34307` plus this change;
- ports 26250–26299 only;
- no empty `.claude/.cc-writes` directories found before the tests.

**Results:**

1. `node tools/gates/validate.mjs --historical --stage DG3`, run at the start: **exit 0**, `PASS gate DG3 (historical)` (`00-validate-dg3-start.log`).
2. `pnpm -r typecheck`: **exit 0** (`05-typecheck.log`).
3. `pnpm lint`: **exit 0** (`06-lint.log`).
4. `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: **exit 0**, "All matched files use Prettier code style!" (`07-prettier.log`). I re-ran it after writing this handback; the result is in §6.
5. `QA_PG_PORT=26250 MTH_PORT_POOL=26251-26299 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a08-gate-controls.test.ts --reporter=verbose`, three times:
   - run 1: **exit 0**, 31/31, G6 test 325 ms;
   - run 2: **exit 0**, 31/31, G6 test 233 ms;
   - run 3: **exit 0**, 31/31, G6 test 203 ms.
   - Logs: `03-a08-run{1,2,3}.log`.
6. `QA_PG_PORT=26250 MTH_PORT_POOL=26251-26299 tests/qa/support/with-pg.sh pnpm test:integration`: **exit 0**. **Test Files 209 passed (209); Tests 1984 passed (1984)**; duration 1148 s; the a08 file took 11.7 s and its G6 test 342 ms. It started 14:15:40Z at a load of 0.00 and ended 14:34:52Z at 1.40 (`08-integration-full.log`).
   - **Disclosed: an earlier attempt was killed by me, not by a test.** I started it as a background command with a 10-minute limit, which was too short for the suite. It was stopped at about 14:05Z with no vitest exit code and no failure in its output.
   - Its partial log, labelled KILLED, is `08a-integration-full-KILLED-attempt1.log`. It counts as no result. The complete run above is the evidence.
7. `node tools/gates/validate.mjs --historical --stage DG3`, run at the end: **exit 0**, `PASS gate DG3 (historical)` (`10-validate-dg3-end.log`).
8. Mutant runs (§4): these exits are the expected ones, not failures of the candidate.
   - control: exit 0;
   - three mutants: exit 1, as intended;
   - `handback` variant: exit 0.

No other non-zero exit occurred.

## 6. Final format check

After writing this handback, I re-ran `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`. It exited **0** ("All matched files use Prettier code style!"), and the log is `07b-prettier-final.log` in the evidence folder.

## 7. Contract or schema needs

None. No OpenAPI, zod, migration or product change.

## 8. Known gaps and what remains

- **Nothing in this repair scope remains.** The orchestrator re-runs the pre-freeze chain and freezes round 10 (D-138).
- **The narrowing is a deliberate scope choice (D-138, D-112).** A product write to `handbacks/`, `assignments/`, `candidates/`, `runs/`, `test-evidence/` or `progress.md` would not be caught (shown by the `handback` mutant). Those paths are not gate state. Reviewers should judge D-138's reopen condition against the six listed records.
- **The test name** still says "changes nothing under docs/delivery/". I kept it for traceability to D-138 and the logs. The doc comment and the file header state the exact scope. Rename it only if the orchestrator wants that.

## 9. Merge instructions

Merge only `tests/qa/integration/a08-gate-controls.test.ts` and this task's handback and evidence files. There are no migrations and no ordering constraints. Untracked top-level dotfiles in the worktree (`.bashrc`, `.gitconfig`, `.idea`, …) were already there and are not part of this task.
