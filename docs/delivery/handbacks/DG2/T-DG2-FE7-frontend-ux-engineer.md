# Handback T-DG2-FE7 (frontend-ux-engineer): F-DG2-220, flaky web unit waits

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`
- **Base:** `HEAD` = `9b4ded0a2397daae7a72549e1363fd7f5f869faf` (T-DG2-BE8 integrated). Working tree clean before I started, apart from untracked sandbox-masked dotfiles.
- **Assignment:** `docs/delivery/assignments/DG2/round-5/T-DG2-FE7.md` (sha256 `4ea95106…32591`)
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-FE7-frontend-ux-engineer-20261006T081027Z-f94a167b","session_id":"f94a167b-023c-4d13-b414-dd7fe8e9381c"}`
- **Evidence:** logs only, under `docs/delivery/handbacks/DG2/T-DG2-FE7-evidence/`
- **Scope:** test harness and unit tests only. No product code and no user-facing screens changed, so no screenshots are needed.
- **Approvals:** none. This work grants no business, Finance or IT approval, and no G1–G6 or DG gate.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/test/setup.ts` (new) | Unit-web setup file. Calls `configure({ asyncUtilTimeout: 5000 })` so `findBy*` and `waitFor` wait up to 5000 ms instead of Testing Library's 1000 ms default. Exports `UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS`. The comment cites F-DG2-220. |
| `apps/web/vitest.config.ts` | Wires the setup file in with `setupFiles: ["./test/setup.ts"]` and sets `testTimeout: 20_000` for the unit-web project. That is 4x the async-utility timeout, so a test can make several waits in a row, and a wait that never resolves still fails with Testing Library's own message. The comment cites F-DG2-220. |
| `apps/web/src/test/harness-config.test.ts` (new) | Guard test: the active `asyncUtilTimeout` is the raised value (at least 5000 ms), and the project `testTimeout` is at least 2x it. |
| `apps/web/src/pages/p2-blank-forms.test.tsx` | Makes page loads cheaper (see §2). The assertions are unchanged and there are still 48 tests. |

Nothing under `packages/shared/**`, `apps/api/**`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records was touched.

## 2. Behaviour delivered (F-DG2-220, REQ-DLV-034)

**The cause.** Unit-web tests render the whole app (router, GET /me, the page's queries) against a scripted API, then wait for a control with Testing Library's default 1000 ms timeout. Under full-suite parallel load the Diagnose page sometimes took longer than that to load. The round-4 failure was "Unable to find role=button and name 'Archive: Synthetic handling time'".

**Fix 1: a project-wide timeout.**
- `asyncUtilTimeout` is now 5000 ms for every unit-web test file, set through `setupFiles`.
- The per-test timeout is 20 000 ms, above the wait timeout, so a stuck wait still fails clearly.
- Explicit per-call `{ timeout }` options and per-test timeouts still take precedence. The ones in `transformations.test.tsx` are 5 s, `ME_REFRESH_TIMEOUT_MS + 1 s`, 20 s and 30 s, all at or above the new values.

**Fix 2: cheaper page loads in `p2-blank-forms.test.tsx`.**
- **New `rowOf(text)` helper.** It waits for the page once, using a cheap text query for the table row showing the record. Role and name queries are then scoped to that row with `within(row)`. Before, a screen-wide `findByRole(..., { name })` re-computed the accessible name of every button on the large Diagnose and Design pages on every poll.
- **Diagnose (Finance validation and archive).** `open()` now awaits the row once and returns it, and `openValidation(row)` / `openArchive(row)` query only inside that row.
- **Design (journey step editor).** It waits for the journey's row. "Edit steps" is then looked up only inside `#journey-detail`.
- **Translations.** Assertion helpers now use one cached translation-only i18n instance per locale (`tr`), instead of building a new i18next instance on every `blankMessage()` call. The app under test still gets a fresh i18n instance per render.

**Effect.** On Node 24, run alone on this machine:

| | Before | After |
|---|---|---|
| Whole file, "tests" time | 17.29 s | 8.88 s |
| Diagnose tests, each | about 530–610 ms | about 180–215 ms |
| Design tests, each | about 640–740 ms | about 240–360 ms |

In the full-suite verbose runs below, the file's slowest test is 451 ms. The round-4 QA run measured 2121 ms.

**Guard.** `harness-config.test.ts` fails if someone removes the setup file or lowers either timeout.

**Negative check.** I ran a throwaway probe, deleted afterwards and not part of the candidate. A `findByRole` that never resolves fails at **5017 ms** with `TestingLibraryElementError: Unable to find role="button" and name "never rendered"`, not with a bare test timeout. Log: `07-negative-probe-never-resolving-wait.log`.

## 3. Sweep

**`findBy*` / `waitFor` usage** (`01-sweep-findby-waitfor.log`). Six unit-web files use them:

| File | `findBy*` | `waitFor` |
|---|---|---|
| `app.test.tsx` | 17 | 8 |
| `p2.test.tsx` | 91 | 24 |
| `team.test.tsx` | 14 | 6 |
| `modeGuidance.test.tsx` | 8 | 2 |
| `transformations.test.tsx` | 20 | 10 |
| `p2-blank-forms.test.tsx` | 19 | 15 |

- Every call that relied on the 1000 ms default during a page load is now covered by the 5000 ms setting. It is project-wide, so no per-file edit is needed.
- No unit-web file uses fake timers, which could interact with `waitFor`.

**Slow tests** (`02-verbose-node24.raw.log`, `02-verbose-node22.raw.log`, analysed in `03-slow-tests.log`):

| Node | Tests over 1500 ms | Detail |
|---|---|---|
| 24 | 0 | Slowest is `apps/api/src/architecture.test.ts` "every import respects dependsOn…" at 1392 ms. |
| 22 | 1 | The same architecture test, at 1560 ms. |

- That test has an explicit timeout, `AST_TEST_TIMEOUT_MS = 30_000` (`apps/api/src/architecture.testkit.ts:116`, F-DG2-143), so it is 19.2x below its timeout.
- The script prints "3.2x" for it because it assumes the project default; the hand annotation in the log corrects this.
- No unit test over 1.5 s depends on a default timeout, and none is within 2x of its timeout.
- The slowest unit-web test on either runtime is 647 ms, against 20 000 ms.

## 4. Checks actually run

Environment: offline sandbox, 4 cores, pnpm 10.33.0. Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) unless stated, Node 22.22.2 (`/opt/node22/bin`).

| Command | Env | Result | Log |
|---|---|---|---|
| `pnpm test` ×10 | Node 24 | **10/10 exit 0**, each `Test Files 33 passed (33)`, `Tests 638 passed (638)`, 22.2–23.5 s | `04-repeat-node24.log` |
| `pnpm test` ×5 | Node 22 | **5/5 exit 0**, each `33 passed (33)`, `638 passed (638)`, 24.8–25.9 s | `05-repeat-node22.log` |
| `pnpm test` ×3 under CPU load (2 `node -e 'for(;;){}'` busy loops on 4 cores during each run) | Node 24 | **3/3 exit 0**, each `33 passed`, `638 passed`, 31.2–32.0 s. 1-minute loadavg 3.48→4.21, 4.04→5.54, 5.26→6.05 | `06-repeat-under-cpu-load-node24.log` |
| `pnpm test --reporter=verbose` | Node 24 and Node 22 | exit 0 on both, 638/638 | `02-verbose-node{24,22}.raw.log` |
| `pnpm -r typecheck` | Node 24 | exit 0 | `10-typecheck.log` |
| `pnpm -r build` | Node 24 | exit 0 (`apps/web build: ✓ built in 3.12s`) | `14-build.log` |
| `pnpm lint` | Node 24 | exit 0 (`eslint . --max-warnings=0`, no output) | `11-lint.log` |
| `pnpm format:check` | Node 24 | exit 2, see note 1 | `12-format-check.log` |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <the 12 masked files>` | Node 24 | **exit 0**, "All matched files use Prettier code style!" | `13-format-check-ignore-path.log` |
| `node tools/gates/validate.mjs --historical --stage DG1` | Node 24 | **exit 0**, `PASS gate DG1 (historical)` | `15-validate-historical-DG1.log` |

Note 1: `pnpm format:check` fails only because it cannot read 12 sandbox-masked untracked files. All are EACCES errors: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. There are zero `[warn]` lines, and the run still prints "All matched files use Prettier code style!".

The unit total is 638, against 616 in round 4. The difference is the tests added by T-DG2-BE8, already in `HEAD`, plus the 2 new harness tests. In all **18** repeated `pnpm test` runs (10 + 5 + 3) there were no failures and no `*.failure.log` files were written.

## 5. Known gaps / not done

- **Load method.** The 3 load runs used a CPU-burner loop (2 busy processes on 4 cores), not a parallel `pnpm -r build` in a second clone. The assignment allows either.
- **Load runs were Node 24 only.** The assignment did not ask for a particular runtime for them.
- **Measurement noise.** The before and after durations come from one machine. The improvement is large (about 2x for the file), but individual test times vary from run to run.
- **Not repaired here.** `architecture.test.ts` (1.4–1.6 s) is in `apps/api/**`, which I may not edit. It already has a 30 s explicit timeout and needs no change.

## 6. Merge instructions

- No migrations and no dependency changes. `@testing-library/react` already exports `configure` and `getConfig`.
- It's a plain merge. The only edited test file is `apps/web/src/pages/p2-blank-forms.test.tsx`. If another branch edits that file's Diagnose or Design `open` helpers, keep the `rowOf()` and `within(row)` pattern.
- Any new unit-web test inherits the 5000 ms async-utility timeout and the 20 000 ms test timeout automatically.
