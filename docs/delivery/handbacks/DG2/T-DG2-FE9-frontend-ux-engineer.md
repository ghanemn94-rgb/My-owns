# Handback T-DG2-FE9: state updaters stay pure (frontend-ux-engineer)

- **Stage:** DG2 (FIXING). **Finding:** F-DG2-430 (Low, non-mandatory; REQ-PB-012).
- **Assignment:** `docs/delivery/assignments/DG2/round-12/T-DG2-FE9.md` (sha256 `72c1cfcc…dc68e3`, verified).
- **Invocation:** run `DG2-T-DG2-FE9-frontend-ux-engineer-20261007T035235Z-a8404d76`, session `a8404d76-c1c9-4af1-966c-a42166910265`.
- **Base:** I started on `be51ad7`. At 03:52:46Z, during start-up, the orchestrator committed `2cb64c2`, which changes only `docs/delivery/findings.json`. `git diff --quiet be51ad7 2cb64c2 -- apps` reports no difference. The check logs show `HEAD 2cb64c2 + working tree`, and the negative-control logs show `be51ad7`. `RecordForm.tsx` is the same in both commits.
- **Not committed:** the orchestrator integrates the change.
- **Evidence:** `docs/delivery/handbacks/DG2/T-DG2-FE9-evidence/`, logs only, as the assignment requires.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/components/RecordForm.tsx` | **The fix.** `set` is now a pure updater: `setValues((v) => ({ ...v, [name]: value }))`. `onValuesChange` is called from a `useEffect` on `values`, after the change is committed. A ref holding the last reported `values` object ensures it fires once per new values object, never for the initial values on mount, and not again on a StrictMode effect re-run or a new callback identity. The prop's doc comment says when it fires. |
| `apps/web/src/pages/design/JourneysSection.tsx` | Sweep: the "Add step" updater generated `crypto.randomUUID()` inside the `setSteps` updater. The key is now generated in the click handler, before the updater. |
| `apps/web/test/react-warning-guard.ts` (new) | The guard. It wraps `console.error` once, forwards every call unchanged, and records only messages matching the React patterns listed in §3. |
| `apps/web/test/setup.ts` | Installs the guard. `afterEach` fails the test that printed a matching warning, and `afterAll` catches one printed after the last test of a file. |
| `apps/web/src/test/react-warning-guard.test.tsx` (new) | Guard self-test (4 tests); details in §3. |
| `apps/web/src/test/fixtures.tsx` | `renderApp(..., { strict: true })` wraps the app in `<StrictMode>`, as `src/main.tsx` does in production. It is opt-in; the default is unchanged. |
| `apps/web/src/pages/team/team.test.tsx` | The `render` helper accepts `{ strict }`. Adds the component test "Team assign dialog: accountability preview follows the selected role (F-DG2-430)" in EN and AR. |
| `apps/web/e2e/p2-journeys.spec.ts` | On the real stack, the Team journey (chromium-en and chromium-ar) now switches Role to KDS and back to WL. It checks that the preview follows each time, takes a new screenshot `p2-17d1-team-assign-preview-kds`, then continues exactly as before. |

## 2. Behaviour delivered

- **F-DG2-430 / REQ-PB-012.** No state updater in `RecordForm` calls back into a parent any more. The Team assign dialog's role-accountability preview updates as it did before:
  - it starts on the role whose card opened the dialog;
  - it follows every Role change;
  - it disappears when no role is selected, so a stale preview is never shown;
  - it stays put while other fields are edited.

  Unit tests confirm this in EN and AR under StrictMode, and e2e confirms it in chromium-en and chromium-ar against the production build.
- **One semantic widening.** `onValuesChange` now also fires after a 409-conflict reapply or discard replaces the values. Before, it fired only for user edits, so a preview could go stale after a conflict resolution.
  - The only consumer is the Team assign dialog. It is create-only (`record={null}`) and can never reach a conflict, so its behaviour is identical.
- **Visual check.** No visible UI change was intended. I viewed the new e2e screenshots `en/p2-17d1-team-assign-preview-kds.png` and `ar/p2-17d1-team-assign-preview-kds.png` (in `$TMPDIR/shots-unset`). Each shows the dialog with Role = KDS/Data Steward and the KDS accountability in the preview banner: EN LTR, and AR RTL with Arabic labels.
  - Per the assignment ("Keep evidence to logs only"), they were not copied into the repository. My role rules ask for screenshots in the repository, so this conflicts with the assignment; I followed the assignment. Any e2e run regenerates them.

### Sweep of `apps/web/src/**` (production code, test files excluded)

I searched for every functional state updater (`set<X>((…) =>` / `set<X>(x =>`), and also checked `useReducer`, `setQueryData`/`setQueriesData`, `useSyncExternalStore` and `flushSync`. Each updater below was read in full.

| Location | Updater | Result |
|---|---|---|
| `components/RecordForm.tsx:199` (old) | `setValues` calling `props.onValuesChange` (a parent `setState`) | **Impure; fixed** (F-DG2-430) |
| `pages/design/JourneysSection.tsx:750` (old) | `setSteps` calling `crypto.randomUUID()` | **Impure** (non-deterministic: a StrictMode re-run produces a different key). No callback, I/O or ref write, but it was hoisted out anyway. **Fixed.** |
| `components/RecordForm.tsx:195` | `setFocusRequest((n) => n + 1)` | pure |
| `components/Form.tsx:94` | `setRequest((n) => n + 1)` | pure |
| `components/DataTable.tsx:139, 223, 225, 227` | `setOpen` toggle; `setStack` push, pop and reset | pure |
| `components/RegisterTable.tsx:93` | `setSort` (`setPage(0)` is called next to it, outside the updater) | pure |
| `app/Shell.tsx:60` | `setNavOpen` toggle | pure |
| `pages/design/JourneysSection.tsx:541, 543, 736` | `setSteps` map, move and filter (the move copies the array before `splice`) | pure |
| `LanguageSwitch.tsx:31` | `setQueryData(keys.me, (old) => …)` | pure; the other `setQueryData` calls pass values, not updaters |

There are no `useReducer`, `useSyncExternalStore` or `flushSync` uses.

## 3. Tests

- **Guard scope** (`apps/web/test/react-warning-guard.ts`). It fails a test only for these `console.error` messages, after Node `util.format` (React passes printf-style `%s` arguments):
  - `Cannot update a component (`…`) while rendering a different component`
  - `Cannot update during an existing state transition`
  - `not wrapped in act(`
  - `The current testing environment is not configured to support act(`
  - `A component suspended inside an `act` scope, but the `act` call was not awaited`

  Every other `console.error` is passed through to the real console unchanged and never fails a test. The guard does not mock or silence `console.error`, so tests that spy on it still work.
- **Hook order.** The `afterEach` in `setup.ts` is registered before any test-file hook, and Vitest runs `afterEach` hooks in reverse order, so the guard runs after each file's `cleanup()`. Unmount warnings are therefore caught as well. Unit-web does not enable `globals`, so Testing Library registers no auto-cleanup of its own.
- **Guard self-test** (`src/test/react-warning-guard.test.tsx`). It produces React's real warning from a minimal pre-fix component pair while `console.error` is silenced by a spy, so the warning text never reaches the unit log. It then checks that:
  - the guard's matcher recognises the warning;
  - `assertNoReactWarnings` throws when such a warning is recorded, and is clear afterwards;
  - act() warnings are recognised;
  - four ordinary error-path messages are ignored.
- **Preview component test, EN and AR, StrictMode.** The dialog opens from the Workstream Lead card with the WL preview and its text. The test then selects KDS (text checked), TD, none (no preview), WL again, and edits Reason (still WL). It also checks the page direction (ltr or rtl) and that no non-GET request is sent. EN uses B0018/M0187 text; AR uses the Arabic accountability text and the label `مسؤولية الدور المختار`.
- **Negative controls.** `RecordForm.tsx` was replaced with the pre-fix version from git (`git show HEAD:…`) while the new guard and tests were kept. The fix was then restored, and `git diff --stat` confirmed the fixed file was back. All runs used Node 24.21.0.
  - `negative-control-old-recordform.log`: `vitest run --project unit-web apps/web/src/pages/team` failed with **Tests 1 failed | 7 passed**, exit 1. The pre-existing test "shows a 403 from the server in words; nothing is assigned" failed with: `React warning printed to console.error during this test (F-DG2-430 guard …): 1 warning(s). First: Cannot update a component (`AssignDialog`) while rendering a different component (`RecordDialog`)…`.
  - `negative-control-old-recordform-preview-en.log` and `…-preview-ar.log`: each new preview test, run alone (`-t "preview follows the selected role.*<loc>:"`), **fails** with the same guard error, exit 1.

    React prints this warning only once per component pair per module, so in the full-file run only the first test to hit it fails. That is why each locale was also run alone.

## 4. Checks actually run

Each check was run in both locale settings: `env -u LANG -u LC_ALL` (log prefix `unset-`) and `env LANG=C.UTF-8 LC_ALL=C.UTF-8` (prefix `cutf8-`). Node 24.21.0 was used unless noted. Each log starts with its exact command line and ends with `# exit status: N`.

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` | exit 0 | exit 0 |
| `pnpm -r build` | exit 0 | exit 0 |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | exit 0 |
| `pnpm format:check` | **exit 2** | **exit 2** |
| `prettier --check .` with `--ignore-path .gitignore --ignore-path .prettierignore` plus a temporary root file listing the 12 masked paths (removed afterwards) | exit 0, "All matched files use Prettier code style!" | exit 0, same |
| `pnpm test` on Node 22.22.2 (`/opt/node22/bin`) | 43 files, **790 passed**, exit 0 | 43 files, 790 passed, exit 0 |
| `pnpm test` on Node 24.21.0 | 43 files, **790 passed**, exit 0 | 43 files, 790 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0: "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e (command below) | **60 passed (3.8m)**, exit 0 | **60 passed (3.8m)**, exit 0 |
| Axe (all 12 summary files: 2 runs × en/ar × 3 suites; `axe-summary.log`) | 0 violations of any impact (so 0 serious, 0 critical) | same |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

Details for some rows:

- **`pnpm format:check` exit 2.** All of the failures are 12 sandbox-masked paths Prettier cannot read (EACCES): `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`. The run reports 0 `[warn]` lines and "All matched files use Prettier code style!". The two runs list the same masked paths.
- **Log names.** Unit logs are `*-test-node22.log` and `*-test-node24.log`; contrast logs are `*-contrast.log`; e2e logs are `*-e2e.log`.
- **e2e command.** `env E2E_PG_PORT=2455x E2E_API_PORT=355x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1`
  - Ports were 24551/3551 for unset and 24552/3552 for C.UTF-8, all below 32768.
  - It ran against the real API and a disposable PostgreSQL, using the pre-installed Chromium. `playwright install` was not run.

**`Cannot update a component` grep.** I ran `grep -c "Cannot update a component"` over every evidence log. It returns 0 for all eight unit logs and every other check log. The only matches (3 each) are in the three negative-control logs, which are expected to show it.

**Every non-zero exit, warning or stderr line in the logs, explained:**

- **`format:check` exit 2 (both modes).** Caused by the sandbox-masked dotfiles above, not by formatting. The `--ignore-path` variant exits 0.
- **Unit logs (all four).** Each has one `[FSTDEP022] FastifyWarning: The router options for constraints property access is deprecated…`. It comes from an API unit test's Fastify instance (unit-node, `apps/api/**`, outside my scope) and is unrelated to React. There are no `stderr |` blocks, no act() warnings and no hook timeouts.
- **Build logs.** Vite's "(!) Some chunks are larger than 500 kB" for `index-*.js` (519 kB). It is already in the earlier FE8 build log, `T-DG2-FE8-evidence/unset-build.log`, and is not introduced here.
- **e2e logs.** Three `npm warn Unknown project config "auto-install-peers" / "link-workspace-packages" / "strict-peer-dependencies"` lines come from `npx` reading the pnpm `.npmrc`. They are harmless. The other lines matched by `warn` are test titles ("…top-outcomes warning").
- **Contrast logs.** The "fails" lines are the 3 documented prohibited pairs (for example `brand.primary` on `surface.page`, 3.84:1), which the checker expects. Overall result: PASS.
- **Negative-control logs.** Exit 1 is intended; that failure is the point of the control.
- **Flakes and retries.** None: no test failed or retried in any run.

## 5. Known gaps / not done

- Screenshots are not committed (assignment: logs only). This conflicts with my role rule; see §2.
- The sweep covered state updaters as the assignment defines them, plus reducers and query-cache updaters. It is a code read, not a lint rule; no ESLint rule enforces updater purity. The guard catches the cross-component case at test time only on paths the tests exercise.
- I cannot close F-DG2-430. A non-author reviewer must verify it.

## 6. Merge instructions

- No migrations, no API or contract changes, no dependency changes.
- Expect conflicts only where tests are appended: the end of `apps/web/src/pages/team/team.test.tsx`, the end of `apps/web/test/setup.ts`, and the Team journey block in `apps/web/e2e/p2-journeys.spec.ts`.
- The new guard applies to every unit-web test. A test added later that prints a React setState-in-render or act() warning will fail by design.
