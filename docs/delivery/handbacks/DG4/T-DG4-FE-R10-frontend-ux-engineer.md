# Handback T-DG4-FE-R10 (frontend-ux-engineer): DG4 round-6 finding repairs F-DG4-146, F-DG4-147, F-DG4-148

- **Stage / gate:** DG4 (FIXING after review round 6). Task T-DG4-FE-R10, per D-131.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-R10-frontend-ux-engineer-20261012T165509Z-2c64858d","session_id":"2c64858d-962c-4b30-961b-d1f7f562371c"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R10.md`, sha256 `afa5f4a1…cbdbcf` (verified).
- **Start revision:** worktree `/home/user/wt/dg4-fe-r10`, branch `dg4/fe-r10`, HEAD `8e2375c`. Clean apart from untracked sandbox dotfiles at the top level (`.bashrc`, `.idea`, …), which are not mine and are untouched.
- **Time:** `date -u` at the start was 16:55:20 UTC. The end time is recorded in "What remains" below.
- **Node:** v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. The machine has 4 CPUs.
- **Changes are uncommitted** for the orchestrator to integrate. No product code was changed.
- **Gates:** no product gate G1–G6 or engineering gate is granted or implied. All data is synthetic.

## Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0. It ran at the start and again at the end; see the checks table.

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/auth/session-wait.test.tsx` (new) | **F-DG4-146.** Holds the `/me` answer and asserts that no page `GET` is sent until it is answered (W1, W2, en/ar), and pins each of `apiRequest`'s two waits separately at client level (W3, W4). |
| `apps/web/e2e/session-end.spec.ts` | **F-DG4-147.** 'a 403 is not a session end' now waits for the app's boot `GET /me` response (200), and for the signed-in shell that answer renders, before the re-login. |
| `apps/web/test/setup.ts` | **F-DG4-148.** A `beforeAll` warm-up imports every non-test module under `src/pages` (a superset of the 81 that `router.tsx` loads lazily) once per file, before its tests, with its own hook budget (`UNIT_WEB_PAGE_WARMUP_TIMEOUT_MS` = 60 s). `MTH_UNIT_WEB_WARMUP_REPORT=1` prints each file's warm-up time. |
| `apps/web/src/test/harness-config.test.ts` | **F-DG4-148 guard.** Every `import("../pages/…")` in `router.tsx` must be in the warmed set, no test module may be warmed, and the async-utility wait must stay 5000 ms. |
| `package.json` (root `test` script only) | **F-DG4-148.** unit-node, unit-web and unit-formula-nocodegen now run as three separate Vitest invocations. Every invocation runs even if an earlier one fails, and the script exits 1 if any of them failed: `s=0; vitest run --project unit-node \|\| s=1; vitest run --project unit-web \|\| s=1; vitest run --project unit-formula-nocodegen \|\| s=1; exit $s`. |

## Behaviour delivered, per finding and requirement row

The requirement rows the findings cite are engineering rows that gate later. Their acceptance texts, quoted below, are not completed by this task; the task closes the test-quality findings raised against them.
- **REQ-S16-030** (F-DG4-146, F-DG4-147). Acceptance: "A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass". Final gate DG6.
- **REQ-S16-008** (F-DG4-148). Acceptance: "A18: docker compose up on a clean host reaches ready health checks; the docs state the HA limitation". Final gate DG7.

### F-DG4-146: the held-`/me` unit test (D-131: "a unit test holds the /me answer and asserts that no page GET is sent until it is answered. It must fail on a mutant that drops the wait.")

`apps/web/src/auth/session-wait.test.tsx` has 6 tests:

- **W1 and W2, in en and ar.** These are adapted from qa's round-6 probe `qa-r6-session-wait.test.tsx` (credited in the file header).
  - **W1:** a navigation after B signed in elsewhere. While `/me` is held, no page `GET` is sent, nothing of B's renders, and the header still shows A. Once `/me` answers, B's header and B's list appear, A's record is gone, and `/me` was sent first.
  - **W2:** a refetch past `SESSION_RECHECK_MS`. While the revalidation `/me` is held, the refetch is not sent. Afterwards exactly one `/me` was sent, and it was first.
  - W1 also asserts the document `dir` (rtl/ltr).
- **W3 and W4 (client level, new).**
  - **W3:** a `GET` waits for a `GET /me` probe in flight (`asIdentityProbe`), with no identity check pending.
  - **W4:** a `GET` waits for a pending identity check (`revalidateSessionIdentity`), with no probe in flight, and starts no second check.
  - Each one pins one of the two `await`s in `apiRequest`. The page-level W1/W2 cannot tell them apart, because the app's `/me` is always both.

**Mutation check.** The script is `evidence/scripts/mutants-146.sh`. It mutates `apps/web/src/api/client.ts` in place and always restores it, checked by SHA-256 `67f5702b…0371f` (logged in every mutant log). `git diff` on `client.ts` is empty afterwards.

| Run | Result | Log |
|---|---|---|
| Candidate, new file | 6/6 pass, exit 0 | `01-candidate-new-test.log` |
| **M4** (qa's mutant: both waits replaced by `void probesIdle;`), new file | **6/6 fail**, exit 1 | `02-M4-new-test.log` |
| **M4a** (only `if (pendingCheck) await pendingCheck;` removed) | **W4 fails** (1/6), exit 1 | `02-M4a-new-test.log` |
| **M4b** (only `if (probesIdle) await probesIdle;` removed) | **W3 fails** (1/6), exit 1 | `02-M4b-new-test.log` |
| **M4, full unit-web** | 1 failed file / 68 passed; **6 failed / 1340 passed**, exit 1 | `04-M4-unit-web-full-with-new-test.log` |

**Reproduction "before".** The full unit-web run under M4 shows that the 68 pre-existing files (1340 tests) still pass with the wait dropped, which is qa's finding. The only failures are the 6 new tests.
- **Disclosure:** `03-M4-unit-web-full-without-new-test.log` was meant to run the same without the new file via `--exclude`. Vitest's CLI `--exclude` did not override the project's include, so the new file ran there too. Its result equals log 04, and the log is kept unchanged.

### F-DG4-147: the boot `/me` wait in 'a 403 is not a session end' (D-131: "the spec waits for the app's boot GET /me response before the re-login, so it tests D-073 deterministically")

**The change.**
1. `page.waitForResponse(GET /api/v1/me)` is registered before `page.goto("/about")`, and its status is asserted 200.
2. The test then waits for the signed-in shell's sign-out button, which renders from the same answer that stores the CSRF token.
3. Only then does the re-login run.

The rest of the test, including `watched.me - meAt <= 1`, is unchanged.

**Deterministic reproduction.** A scratch probe, `evidence/scratch/zz-scratch-147-{old,fixed}.spec.ts.txt`, was in the tree only while it ran and has been removed. It is the HEAD test body and the fixed body, each with one inserted line: `page.route` forwards the next `GET /me` (the boot `/me` of `/about`) 1.5 s late. That forces the order in qa's trace (goto returns, re-login, then the boot `/me`).

| Run | Load | Result | Log |
|---|---|---|---|
| **Probe: old vs fixed, `--repeat-each=3`, chromium-en and chromium-ar** | normal | **old: 6/6 fail with `Expected: 403 / Received: 200`** (qa's failure exactly); **fixed: 6/6 pass**. Exit 1, because the old variant fails as intended. | `12-147-delayed-boot-me-probe.log` |
| Old spec (HEAD), test ×10 per project | 1-min load 12.1–22.2 (samples `11-load-samples.log`) | 20/20 passed, exit 0. The race did **not** reproduce from load alone in this run; that is why the probe above exists. | `11-147-before-fix-load.log` |
| Old spec, ×10 per project | **invalid as a load run**: about 2.5–4.5. The busy loops had died when the previous shell call ended. | 20/20 passed. Kept and labelled. | `10-147-before-fix-LOWLOAD-loops-not-running.log` |
| **Fixed spec, test ×10 per project (`--repeat-each=10`, `--workers=1`), chromium-en and chromium-ar** | **1-min load 11.2–16.6, 13.9–16.6 after the first minute** (25 samples, `13-load-samples.log`) | **20/20 passed**, exit 0 | `13-147-after-fix-load.log` |

### F-DG4-148: `pnpm test` reproducible at load 13–16 (D-131: "made reproducible under contention without weakening any test")

**Cause, measured.**
- **unit-web.** `router.tsx` loads every page with `import()` on first use (D-111). In unit-web, the first render of a page in a file therefore transforms and evaluates the page's module graph inside the first test's 5 s `findBy*` wait. With the new warm-up report, a file's module load of all page modules takes:
  - at normal load: median 373 ms, max 2042 ms (`30-pnpm-test-normal-unset.log`);
  - at load 13–16: median 1289 ms, **max 6913 ms** (`40-run1-unset.log`).
  - At load 13–16 that one-off cost alone is above the 5 s wait, which matches qa's "first render in its file" pattern.
- **architecture.test.ts.** Alone, its longest test ('every import respects dependsOn…') takes 4.9 s (`21-arch-alone-noload.log`). In the old single invocation, unit-node shared the CPU with unit-web's jsdom workers. The baseline run at load 10–19 (`20-148-before-pnpm-test-load.log`) failed exactly as qa reported:
  - `architecture.test.ts > … every import respects dependsOn … Test timed out in 30000ms`;
  - 1 failed / 2922 passed, exit 1;
  - `unit-formula-nocodegen` **did not run**, because of `&&`.

**Remedies.** These are two of D-131's listed candidates. Neither weakens a test:
1. **Warm the lazily loaded page modules in the unit-web setup.**
   - It only fills the worker's module cache with the same files. It does **not** call `lazyPage.load()`, so every render still goes through `React.lazy`, Suspense and the shared fallback exactly as before.
   - The 5 s assertion wait and the 20 s test timeout are unchanged, and the harness test asserts the 5 s value.
   - The warm-up has its own 60 s hook budget, about 8.7× the measured maximum of 6.9 s under load 13–16. A module that really fails to load still fails the file with a hook error.
   - Cost at normal load: unit-web took 159.9 s versus about 170 s for the unchanged-harness runs at similar load (logs 03/04), so no measurable slowdown.
2. **Split the root `test` script into three invocations.**
   - unit-node no longer runs alongside unit-web, so `architecture.test.ts` does not compete with jsdom workers. Under load its longest test took 21.3 s (`40-run1-unset.log`), within its unchanged 30 s timeout.
   - Each invocation runs regardless of an earlier failure, so no-codegen is never skipped. The script still exits 1 on any failure.
   - Not raised: no timeout of any test. `AST_TEST_TIMEOUT_MS` is in `apps/api` and outside my scope; it is unchanged.

**Results.**

| Run | Locale | 1-min load (min / median / max of 15 s samples) | Exit | unit-node | unit-web | no-codegen | Log |
|---|---|---|---|---|---|---|---|
| Baseline before the change (old harness) | unset | 10.0 / – / 19.0 | **1** | 1 failed / 1577 + unit-web 1346, in 1 invocation (2922 passed) | (same invocation) | **not run** | `20-148-before-pnpm-test-load.log`, `20-load-samples.log` |
| Normal load, after | unset | about 4 | 0 | 84 files, 1577 | 69 files, 1347 | 259 + 2 skipped | `30-pnpm-test-normal-unset.log` |
| **Loaded run 1** (11 busy loops) | unset | 7.06 / **14.75** / 16.13 (n=42) | **0** | 84 files, 1577 | 69 files, 1347 | 259 + 2 skipped | `40-run1-unset.log`, `40-run1-load-samples.log` |
| **Loaded run 2** (11 busy loops) | C.UTF-8 | 12.87 / **15.24** / 16.05 (n=43) | **0** | 84 files, 1577 | 69 files, 1347 | 259 + 2 skipped | `40-run2-C.UTF-8.log`, `40-run2-load-samples.log` |
| **Loaded run 3** (11 busy loops) | unset | 12.46 / **15.12** / 15.82 (n=43) | **0** | 84 files, 1577 | 69 files, 1347 | 259 + 2 skipped | `40-run3-unset.log`, `40-run3-load-samples.log` |
| **Loaded run 4** (11 busy loops) | C.UTF-8 | 12.86 / **15.62** / 16.32 (n=43) | **0** | 84 files, 1577 | 69 files, 1347 | 259 + 2 skipped | `40-run4-C.UTF-8.log`, `40-run4-load-samples.log` |
| **Loaded run 5** (11 busy loops) | unset | 12.86 / **15.43** / 16.01 (n=43) | **0** | 84 files, 1577 | 69 files, 1347 | 259 + 2 skipped | `40-run5-unset.log`, `40-run5-load-samples.log` |

**All five loaded runs exit 0, with 0 failed tests and every invocation run.** Per-run maximum warm-up: 6913, 6677, 6426, 6835 and 7198 ms. architecture.test.ts's longest test: 21299, 20614, 20440, 21283 and 21745 ms, against its 30 000 ms timeout. In each run the minimum is the end of the ramp; the first sample of run 1 (7.06) was taken too early, and its other 41 samples are between 13.0 and 16.1.

The 2 skipped tests in no-codegen are pre-existing and unchanged. Load was generated by `evidence/scripts/load.sh`: N busy loops, each bounded by `timeout`, stopped by PID with `load-stop.sh` after every run. N was 12 or 13 for the F-DG4-147 runs and 11 for the F-DG4-148 runs. Samples were taken with `sample.sh` every 15 s; the first sample of a run is taken after a 45–60 s ramp, so the minimum includes the end of the ramp-up. `pkill`/`pgrep -f` were never used. `df -h .` reported 17 GB free before every full run (`40-summary.txt`).

## Checks actually run

Logs are under `docs/delivery/handbacks/DG4/T-DG4-FE-R10-evidence/`.

| Check | Command / environment | Exit | Result |
|---|---|---|---|
| Preceding gate | `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | **0**, 0 | `PASS gate DG3 (historical)` (`53-validate-dg3.log`) |
| Typecheck | `pnpm -r typecheck` | **0** | all packages Done (`50-typecheck.log`) |
| Lint | `pnpm lint` (`eslint . --max-warnings=0`) | **0** | (`51-lint.log`) |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (`52-prettier.log`) |
| `pnpm test`, normal load, locale unset | `TZ=UTC CI=1 pnpm test` | **0** | unit-node 84 files / 1577; unit-web 69 / 1347; no-codegen 3 / 259 + 2 skipped (`30-…`) |
| `pnpm test`, C.UTF-8 | loaded runs 2 and 4 (`LANG=LC_ALL=C.UTF-8`) | **0**, **0** | same counts. **Not run separately at normal load.** |
| `pnpm test` ×5 at load 13–16 | `40-run1…5`, see the table above | **0** ×5 | same counts in every run |
| F-DG4-146 mutants | `mutants-146.sh M4/M4a/M4b` | 1/1/1 (expected) | killed: 6/6, W4, W3 |
| F-DG4-147 probe | delayed boot `/me`, old vs fixed, both projects ×3 | 1 (expected: the old variant fails) | old 0/6, fixed 6/6 |
| F-DG4-147 ×10 under load | `with-stack.sh npx playwright test session-end.spec.ts --grep "a 403 is not a session end" --repeat-each=10 --workers=1`, ports 26201/26202, pool 26203–26249 | **0** | 20/20 (en 10, ar 10) |
| `pnpm -r build` | – | **NOT RUN** | out of time; see "What remains" |
| `pnpm openapi:lint` | – | **NOT RUN** | out of time; no API or contract file changed |
| `with-pg.sh pnpm test:integration` | – | **NOT RUN** | out of time; no API file changed |
| Full product e2e (item 4; both projects, axe) | – | **NOT RUN** | out of time |

Non-zero exits, all disclosed:
- the mutant runs and the old-variant probe, which are expected to fail;
- the baseline log 20, which reproduces F-DG4-148;
- log 03, which was not effective (`--exclude`), as explained above.

No test failed, flaked or timed out in any run of the changed candidate.

## Operations routed / pending list

None. This task routes no API operation, and no `apps/api/test/support/p4-pending-*.ts` list changes (delta: none).

## Contract or schema needs (for the orchestrator)

- None for the contract or schema.
- **Residual risk:** `apps/api/src/architecture.test.ts` (API scope, not mine) took 21.3 s of its 30 s budget under load 13–16 in its own invocation. That is a margin of about 1.4×. If the review machine's load rises well above 16, it may need its own remedy, for example narrowing its AST work or a measured budget. The owner would be solution-architect or backend.
- **Note:** the comment in `vitest.config.ts` ("`pnpm test` runs it after unit-node and unit-web") is still true. That file is not in my scope.

## What remains

The end time from `date -u` was 18:49:04 UTC, about 114 minutes after the start. Under the 100-minute rule I finished item 3 (all five loaded runs), made the tree typecheck, lint and prettier-clean, and stopped. **Not done:**
1. **Item 4 / acceptance 4:** the full product e2e suite (`apps/web/e2e`, `with-stack.sh`, `--workers=1`) at normal load in chromium-en and chromium-ar, with the axe counts. Only the changed test was run (20/20 under load, plus the probe).
   - This is the separable second half (D-059/D-070). It needs one full run on this candidate.
2. **Acceptance 1, partly:** `pnpm -r build` and `pnpm openapi:lint` were not run.
   - No product source, API or OpenAPI file changed. The web build's inputs changed only in test-only files: `test/setup.ts` and `*.test.tsx`, which are not in the bundle, and the e2e spec.
   - They still have to be run.
3. **Acceptance 3:** `pnpm test:integration` was not run. No integration test, API file or pinned count changed.
4. **Acceptance 2, partly:** `pnpm test` with C.UTF-8 ran only under load (runs 2 and 4, both exit 0), not additionally at normal load.

Merge notes: there are no migrations. Expected conflicts are none: BE-R6 owns `apps/worker`, and I touched only `apps/web/**` and the root `package.json` `test` script. Leave `session-wait.test.tsx` untracked-to-added.
