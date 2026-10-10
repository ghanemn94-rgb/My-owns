# Handback T-DG4-FE-R2: route-level code splitting (frontend-ux-engineer)

- **Stage:** DG4 (BUILDING). Task T-DG4-FE-R2 (D-111 repair scope). No requirement row is assigned by this assignment; it is a repair of the build's shape, so "behaviour delivered" is given against the repair scope's five items.
- **Invocation:** `DG4-T-DG4-FE-R2-frontend-ux-engineer-20261010T124226Z-fc509eb9`, session `fc509eb9-e01d-406b-8c05-17a60ce73e39`.
- **Base:** `48eba105a78c21096a34163ffaf619f3cf6e0132` (branch `dg4/fe-r2`), worktree `/home/user/wt/dg4-fe-r2`. Changes left **uncommitted**.
- **Time:** start `2026-10-10T12:42:39Z`, end `2026-10-10T14:29Z` (about 107 min; the last 7 were the low-load re-run and this write-up). End checks: `prettier --check` exit 0 (`prettier-check-final.log`), `validate --historical --stage DG3` exit 0 (`validate-dg3-historical-end.log`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → exit 0, `PASS gate DG3 (historical)` (`T-DG4-FE-R2-evidence/validate-dg3-historical-start.log`).
- **Gates:** no product gate G1–G6 was granted by me; the e2e journeys decide G1–G3 with SYNTHETIC demo users only, as before. Nothing here implies an engineering gate.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/app/router.tsx` | Every page component of the shell is now `lazyPage(() => import("<fixed file>").then((m) => m.<Export>))` (`React.lazy` + dynamic `import()`; 114 page bindings, same names, same route elements and props). `lazyPage` wraps each page in a `Suspense` with the ONE shared fallback; a failed chunk renders the load-failed state. `load()` (memoized, retried after a failure) resolves to the page component itself. `preloadRoute(pathname)` + `createAppRouter()` start the matched page's chunk at start-up, in parallel with GET /me. `LoginPage`, `Shell`, `RequireSession`, the `<Navigate>` redirects and the route tree stay eager and unchanged. |
| `apps/web/src/components/RouteFallback.tsx` (new) | The shared fallback: `RouteLoadingFallback` (a `role="status"`, `aria-live="polite"` translated label, the neutral spinner, no number, no chip/status colour, reserved `min-block-size: 60vh`) and `RouteLoadFailed` (translated `role="alert"` with a reload button). |
| `apps/web/src/i18n/en/common.json`, `apps/web/src/i18n/ar/common.json` | Append-only: `common.state.loadingPage`, `common.state.pageLoadFailed` (EN and AR). |
| `apps/web/src/app/p3-seams.test.tsx` | **The only adjusted existing test.** "each P3 path renders its page component from the fixed file and export" compared `element.type` with the page; the element type is now the lazy wrapper, so the test awaits `element.type.load()` and compares the resolved component with the page imported from its fixed file and export (the seam contract is kept, and now also proves the dynamic import's target). |
| `apps/web/src/components/RouteFallback.test.tsx` (new) | 8 unit tests (EN and AR): status role and label, no digits (Latin or Arabic-Indic) and no status class, reserved block size; load-failed alert and reload; `lazyPage` shows the fallback until the module resolves, then the page with its props; a rejected chunk shows the error, not a blank area. |
| `apps/web/e2e/p4-route-splitting.spec.ts` (new) | 2 e2e tests × 2 projects on the real stack: a not-yet-visited page is its own same-origin chunk (not fetched at sign-in; nothing fetched off-origin); while its chunk is held back the shared fallback shows (translated status, polite, no digit, no chip), the shell does not move (header, nav and main boxes equal before/after), then the page renders with its h1 and document title; an aborted chunk shows the translated error with a reload inside the shell, and the reload recovers. Screenshot + axe at each step. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R2-frontend-ux-engineer.md`, `…/T-DG4-FE-R2-evidence/**` | This handback and its logs. |

Not mine: the untracked `CLAUDE.local.md` and the dotfiles at the tree root were present before I started (sandbox placeholders); I did not touch them.

## 2. Behaviour delivered (repair scope items 1–5)

### Item 1 and 5: measurements, before and after

**Bundle** (`pnpm --filter @mth/web build`; full lists in `before-assets.tsv`, `after-assets.tsv`; build logs `before-build.log`, `pnpm-r-build.log`):

| | Before (base `48eba10`) | After (final) |
|---|---|---|
| Main chunk | `index-CyQjVRiM.js` **2,440,705 bytes** | `index--s1dgcNj.js` **1,138,999 bytes** (−53.3 %) |
| JS files in `dist/assets` | 6 (index + 5 vendor) | 126 (index + 5 vendor + 120 page and shared chunks) |
| Total JS bytes | 2,960,883 | 3,067,759 (+3.6 %, the chunk wrappers) |
| Vendor chunks | vendor-react 273,187; vendor-forms 111,342; vendor-tanstack 85,250; vendor-i18n 49,179; vendor 1,220 | identical sizes (configuration unchanged) |
| Largest page chunk | n/a | `InitiativePage` 60,946 bytes |
| CSS | `index-C4W1ZLo8.css` 29,317 | same file (unchanged) |

The ">500 kB" Vite warning remains for the main chunk because of the translations (item 3).

**Item 3, translations.** Of the remaining 1,138,999-byte main chunk, the i18n catalogues (all namespaces, both locales, loaded eagerly by `i18n/index.ts`) account for **≈ 899,040 bytes (≈ 79 %)**: EN 381,553 and AR 517,487 bytes of minified JSON, every namespace present in the chunk (`after-main-chunk-attribution.txt`; the source-map grouping at the top of that file is not reliable for JSON and is labelled so). **Not changed in this task.** Possible follow-up: load the inactive locale's catalogue on demand (≈ 380–520 kB less per load), and/or split namespaces per area.

**"Define → G2"** (`apps/web/e2e/p2-journeys.spec.ts`, chromium-en, `--workers=1`, fresh stack per run). It cannot run alone with `-g`: the file is `mode: "serial"` with a shared `tid` set by the first test, so a `-g "Define → G2"` run fails in < 1 s with `POST /api/v1/transformations//kpi-definitions -> 400` (three such attempts kept as `before-define-g2-grep-only-attempt{1,2,3}.log`, exit 1). "Alone" was therefore taken as **the p2-journeys file alone** (no other spec), reading the Define → G2 line of the list reporter.

| Run | Before (base) | After, first split (no start-up preload) | After, final (with preload) |
|---|---|---|---|
| 1 | 29.4 s ✓ (load 2.4) | 32.1 s ✘ timeout (load 8.1) | 32.0 s ✘ timeout (load 12.3) |
| 2 | 24.8 s ✓ (load 5.7) | 31.8 s ✘ timeout (load 12.0) | 32.9 s ✘ timeout (load 13.8) |
| 3 | 29.2 s ✓ (load 6.3) | 32.6 s ✘ timeout (load 8.6) | 31.4 s ✘ timeout (load 14.7) |
| Logs | `before-p2-journeys-en-run{1,2,3}.log` | `after-p2-journeys-en-run{1,2,3}.log` | `ab2-after2-p2-journeys-en-run{1,2,3}.log` |

**These columns are not comparable.** The machine (4 CPUs) went from load 2–6 during the baseline to 8–18 afterwards (other agents' runs), and every test of the file got slower, not only the split pages. To separate load from the change I ran **two interleaved A/B rounds** (before/after alternating on the same machine in the same window; "before" is the base router built from this tree), summarized in `ab-summary.txt`:

- **Define → G2 failed with the 30 s test timeout in all 12 A/B runs of BOTH arms** (before 32.6/32.4/31.9 and 31.9/32.8/32.2 s; after 32.2/32.6/32.0 and 32.0/32.9/31.4 s). Under this load the base fails exactly like the split build; the failures are load, not the change.
- Sum of the 8 tests that precede it (3 runs each): A/B 1, first split **without** preload: before 236.4 s, after 258.6 s (**+9.4 %**, consistent across tests). Cause found: the page chunk was requested only after RequireSession's GET /me answered (HTML → index → /me → chunk → data), one more serial round-trip per `page.goto`. Fixed with `preloadRoute` at start-up. A/B 2, final **with** preload: before 279.0 s, after 288.1 s (**+3.3 %**, within the ±15 % per-test run-to-run spread; three tests faster, five slower).

**Conclusion, stated plainly:** the main chunk is halved and the number of chunks is 126, but on this machine and under this load the split did **not** measurably shorten the e2e journeys, and did not bring Define → G2 under 30 s. The journeys' time is dominated by something other than the parse of the index chunk (most likely the API and PostgreSQL under CPU contention; and Chromium's code cache already amortizes the parse of a repeated large script within a context). I did not raise any timeout. The orchestrator should not count on this repair alone for D-111/D-112; see "what remains".

### Item 2: split by route

- Every page component imported by `router.tsx` (114 bindings over all `pages/**` files, including the `AreaPages` placeholders and Not Found) is `React.lazy` + `import()`. `LoginPage` stays eager: it is the sign-in (auth) entry and the session-identity redirects go through it.
- One shared fallback component (`RouteLoadingFallback`) is used by every page's `Suspense`. Each route element owns its own `Suspense` boundary (inside `lazyPage`), because `Shell.tsx` (which holds the `<Outlet>`) is not my file; a single boundary around the shell would have replaced the whole shell on the first load. The fallback sits in `<main>`, below the eager shell.
- Bilingual and accessible: `role="status"`, `aria-live="polite"`, translated label (`common.state.loadingPage`: "Loading the page…" / "جارٍ تحميل الصفحة…"); axe 0 serious/critical in both languages (e2e).
- No layout jump: the shell's header, navigation and main boxes are identical before and after the page replaces the fallback (asserted in e2e); the fallback reserves `min-block-size: 60vh`. A page whose chunk is already loaded renders without any fallback (memoized `load`, decided once per mount, so a mounted page never changes tree shape).
- Never mistakable for data: no number, no chip, no status colour; the spinner uses the neutral action token (`--mth-action-primary` on `--mth-border-control`), never green. Asserted in the unit and e2e tests.
- Vendor chunks unchanged (`vite.config.ts` untouched). No CDN, no remote loading: every chunk is under `/assets/` on the app origin (e2e: `trackRequests` foreign list empty, every script URL starts with the base URL).
- Additionally: a chunk that cannot be fetched (network, a deployment that replaced the hashes) shows `RouteLoadFailed` (translated alert + reload) instead of React Router's developer error screen. While it is shown, the document title stays the previous page's (the page's own `usePageTitle` never ran); noted as a Low polish item below.

### Item 4: behaviour identical

- Route tree unchanged: same paths, order, elements (by name), props, the index `<Navigate to="/my-work" replace />`, the planned-route, entry, sub-entry and placeholder routes, `*` → Not Found. `my-work.test.tsx` "registers the slice I and C routes and every planned P4 route" passes unchanged.
- Titles and focus: owned by each page (`usePageTitle`, `PageHeader`) and the shell (`main#main tabIndex=-1`, skip link); unchanged. e2e asserts the document title after a lazy load.
- `session-identity.test.tsx` **20 runs, 4 concurrent, alongside the full e2e suite and the A/B runs (load 11.3 → 15.3): 20/20 exit 0, 18/18 tests each** (`session-identity-20x.log`). Not modified.
- Unit tests adjusted: **only `p3-seams.test.tsx`** (described above). No other unit test renders a lazy page synchronously in a way that broke: the full web suite passed with no other change (first run after the split: 61 files, 1178 tests, before my new test file).

## 3. Checks run (exit codes are real; logs under `T-DG4-FE-R2-evidence/`)

| # | Command | Result |
|---|---|---|
| — | `node tools/gates/validate.mjs --historical --stage DG3` (start) | exit 0, `PASS gate DG3 (historical)` |
| 1 | `pnpm -r typecheck` | exit 0 (`pnpm-r-typecheck.log`) |
| 1 | `pnpm -r build` | exit 0 (`pnpm-r-build.log`) |
| 1 | `pnpm lint` | exit 0 (`pnpm-lint.log`) |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (`prettier-check.log`; re-run at the end, see §6) |
| 1 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | exit 0; unit-node + unit-web **144 files, 2727 passed**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped** (`pnpm-test-locale-unset.log`) |
| 2 | `LC_ALL=C.UTF-8 pnpm test` | exit 0; **144 files, 2727 passed**; **259 passed, 2 skipped** (`pnpm-test-c-utf8.log`). 2727 = D-114's 2719 + my 8. |
| 3 | `QA_PG_PORT=25930 MTH_PORT_POOL=25931-25949 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1**: 190 files (189 passed, 1 failed), **1831 passed, 1 failed (1832)**. The one failure is `apps/worker/test/integration/benefits-queue.test.ts` › "one queue item; a redelivery and a restarted worker write no second item" (a `waitFor` timeout in the worker), exactly D-114's recorded baseline (1831/1832, assigned to KBE-R4). Worker-only, no web code involved. No pinned count changed (`integration.log`). |
| 4 | `E2E_PG_PORT=25910 E2E_API_PORT=25911 MTH_PORT_POOL=25912-25929 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (both projects) | **exit 1**: 328 tests, **319 passed, 3 failed, 6 did not run** (53.0 min, load 5–18). All 3 failures are the 30 s test timeout: `p2-journeys.spec.ts:828` Define → G2 (chromium-en and chromium-ar) and `p4-gates-closure.spec.ts:566` "9. the auditor sees read-only views…" (chromium-en, 30.1 s). The 6 not run are the 3 serial p2 tests after Define → G2, in each project (`e2e-full.log`). |
| 4 | the same two spec files re-run once at low load (1.7–2.8), both projects, same harness | **exit 0, 42/42 passed**: Define → G2 23.4 s (en), 21.9 s (ar); gates-closure 9: 16.8 s (en), 15.1 s (ar) (`e2e-rerun-failed-specs-low-load.log`). |
| 4 | new spec alone, both projects | exit 0, **4/4 passed** (`e2e-p4-route-splitting-first-run.log`) |
| — | `session-identity.test.tsx` × 20 under parallel load | 20/20 exit 0 |
| — | before/after measurements and two A/B rounds | as in §2 (all logs kept; failures are disclosed above) |

Screenshots (both languages, the visible change): `T-DG4-FE-R2-evidence/screenshots/{en,ar}/fe-r2-01-route-loading.png` (the fallback inside the shell), `fe-r2-02-route-loaded.png` (the page after the chunk), `fe-r2-03-route-load-failed.png` (the chunk-failure state). I looked at them: the shell is unchanged, the fallback is one neutral status line, RTL mirrors correctly.

Disk: 19 GB free at start, 17 GB before the full runs (never under 3 GB).

## 4. Operations routed (delta to my pending list)

None. This is a frontend-only task; there is no `p4-pending-fe-r2.ts` and no `p4-exercises-*` change. `contract.test.ts` is unaffected (it runs in the integration suite).

## 5. Contract or schema needs

None.

## 6. Full-suite results, disclosures and what remains

**Acceptance status, honestly:**

- Acceptance 1 (typecheck, build, lint, prettier, openapi:lint): all exit 0.
- Acceptance 2 (`pnpm test`, both locale settings, both Vitest invocations): exit 0, 2727 + 259/2 skipped each.
- Acceptance 3 (integration): **not fully green.** 1831/1832, the single failure being the pre-existing `benefits-queue.test.ts` of D-114 (assigned to KBE-R4), not touched by this task.
- Acceptance 4 (product e2e, both projects, `--workers=1`): **not fully green in one run.** The full run under load 5–18 had 3 timeouts (Define → G2 en and ar; gates-closure 9 en) and 6 dependent tests not run. Re-run once at low load, those two files pass 42/42. The A/B rounds show that the base build (no splitting) times out on Define → G2 the same way under such load (12/12 runs in both arms), so I attribute the timeouts to machine load, not to the change. This is evidence, not proof. The orchestrator should re-run the full suite on a quiet machine before integrating. Axe: 0 serious or critical issues in every test that ran (`expectAccessible` fails a test otherwise; none of the 3 failures was an axe failure: all are `Test timeout of 30000ms exceeded`). The new spec `p4-route-splitting.spec.ts` passed 2/2 per project in the full run as well as alone.
- Acceptance 5 (`validate --historical --stage DG3`): exit 0 at the start and at the end.

**What remains / for the orchestrator:**

1. **D-111/D-112 are not solved by this repair.** The main chunk is −53 % and the split is in place, but the measured e2e times did not improve (A/B 2: +3.3 %, within noise), and Define → G2 still exceeds 30 s under load. Candidates, not done here: (a) load only the active locale's i18n catalogue (≈ 79 % of the remaining main chunk, item 3); (b) profile where the journey's time goes under load (API/PostgreSQL vs browser) before further front-end work; (c) split the Define → G2 journey into smaller serial tests (a test-design change, not a timeout raise).
2. Re-run the full e2e suite on a quiet machine (my full run was under heavy load from concurrent agents).
3. Low polish (not filed as a finding by me): while `RouteLoadFailed` is shown, the document title stays the previous page's.
4. `benefits-queue.test.ts` (integration) remains KBE-R4's.

**Merge instructions.** No migration, no contract change, no new dependency, `vite.config.ts` unchanged. Conflicts are possible only in `apps/web/src/app/router.tsx` (any task that adds a route must now add it as `const X = lazyPage(() => import("…").then((m) => m.X));` instead of a static import; a static page import in `router.tsx` still works but defeats the split for that page) and in the two `common.json` files (two keys appended at the end of `common.state`).
