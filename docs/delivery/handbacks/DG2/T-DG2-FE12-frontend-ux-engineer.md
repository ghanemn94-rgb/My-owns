# Handback T-DG2-FE12 (frontend-ux-engineer): translate at render time everywhere, and keep the header readable

- **Stage / task:** DG2 (FIXING), T-DG2-FE12. **Requirement:** REQ-S15-007 (persistent bilingual language switch; Arabic RTL / English LTR for every user-facing string). No finding ID (the gaps come from the FE11 handback's "Sweep" and "Known gaps").
- **Assignment:** `docs/delivery/assignments/DG2/round-14/T-DG2-FE12.md`, sha256 `7a0f4a59820a47b638414ae563c859f277e101bea757eb274605f0b8cda0ad97` (verified with `sha256sum` before starting).
- **Base:** `HEAD` `b91e2bc` on `claude/mobily-transformation-platform-regate` (includes FE10 `8cb3bb8` and FE11 `59d38ad`). Nothing is committed; the orchestrator integrates.
- **Invocation:** `DG2-T-DG2-FE12-frontend-ux-engineer-20261007T090714Z-42b79785` (session `42b79785-0510-4d66-a071-b0e0e578299f`).
- **Evidence directory:** `docs/delivery/handbacks/DG2/T-DG2-FE12-evidence/` (logs, plus 2 cited screenshots).
- I am an engineering agent. Nothing here grants a business, Finance or IT approval. All test data is SYNTHETIC.

## 1. Translate at render time

**Rule applied everywhere:** component state holds a key, a code or the values (a role code, a field-error code, `{ step, code }`, the error object), never the result of `t(...)`, `errorMessage(...)` or `fieldErrorMessage(...)`. The text is produced during render, so a language switch while a message is visible re-renders it in the new language and direction. This is how `LanguageSwitch` has worked since FE11. A small helper, `fieldErrorMessages(t, codes)` in `lib/problem.ts`, translates a map of field-error codes at render. `REQUIRED_CODE` (`"validation.required"`) is added next to `BLANK_CODE` in `components/Form.tsx`. The keys produced are the same as before: `fieldErrorMessage(t, "validation.required")` is `t("problems.validation__required")`.

### Sweep list: every place in `apps/web/src/**` that held translated text in state (all fixed)

How I swept:
- grep for every `set…(` call whose argument contains `t(`, `errorMessage(` or `fieldErrorMessage(`;
- every `useState<string…>`, `useState<Record<string, string>>`, `useState<string[]>` and every object-typed `useState`, each read;
- every `next[…] = / ??= fieldErrorMessage(…)` map that is later put in state.

After the fix, the same greps find no setter that receives translated text.

| # | Place | State before → after | What the user sees |
|---|---|---|---|
| 1 | `pages/team/TeamPage.tsx` `TeamBody` `done` (named in the assignment) | `t("team.assign.done", {role})` → the **role code**; the text is rendered as `t("team.assign.done", { role: roleName(t, done) })` | "Role assigned: …" success notice (`role="status"`) |
| 2 | `pages/LoginPage.tsx` `DevLoginForm` `error` (named) | `t("auth.dev.invalidUsername")` or `errorMessage(t, err)` → `failure: { invalidUsername: true } \| { error } \| null` | Inline sign-in error (`role="alert"`, linked by `aria-describedby`) |
| 3 | `pages/design/JourneysSection.tsx` `StepsEditor` `error` (named, ~l.528) | `"Step N: <message>"` string → `{ step, code }` | Form-level "Step N: …" alert |
| 4 | same `StepsEditor` `fieldErrors` (found by the sweep) | translated map → **codes** keyed `<step key>/<field>` | Per-step field errors |
| 5 | `components/ReasonDialog.tsx` `fieldError` | `fieldErrorMessage(t, code)` → code | Reason field error (archive, revoke, remove) |
| 6 | `components/RowActions.tsx` `NoteDecisionDialog` `errors` | `t("problems.validation__required")` / `fieldErrorMessage` map → codes | Choice / extra / note errors (e.g. Finance validation) |
| 7 | `components/RecordForm.tsx` `useRecordForm` `errors` and `unmapped` | translated map and list → codes; the hook still **returns** translated `errors`/`unmapped`, computed each render, so no consumer changed | Field errors and the form-level error list of every record dialog / inline record form |
| 8 | `pages/gates/GateDetailPage.tsx` `SubmitDialog` `fieldError` | `fieldErrorMessage` → code | Submission note error |
| 9 | `pages/gates/GateDetailPage.tsx` `DecideDialog` `errors` | translated map → codes | Outcome / rationale / comments errors |
| 10 | `pages/define/DefinePage.tsx` `NorthStarForm` `error` | `fieldErrorMessage` → code | Statement error |
| 11 | `pages/evidence/EvidencePage.tsx` `UploadDialog` `localError` | `t("problems.validation__required")` / `t("problems.evidence__too_large")` → `REQUIRED_CODE` / `"evidence.too_large"` | File field error |
| 12 | `pages/evidence/EvidencePage.tsx` `LinkDialog` `localError` | translated map → codes | Record type / record errors |

**Checked and already render-time (no change):**
- every `serverError` / `error` / `bannerError` / `statusError` state, which holds the error **object** and is rendered with `errorMessage(t, …)`;
- the react-hook-form forms (Organizations, Users, Assignments, Transformation create/edit), which store `{ message: fe.code }` and translate with `fieldErrorMessage(t, …)` when rendering;
- `States.tsx`;
- `LanguageSwitch` (FE11).

Other string state holds IDs, cursors, user input, the selected role or locale, never text.

## 2. Header layout: the notice is a banner below the header

- **`components/LanguageSwitch.tsx`.**
  - The switch no longer renders the notice. It reports the refused language through `onRefusedChange`: `null` when a new switch starts, the target after a refused save. FE11 behaviour (a) is unchanged: the chosen language stays, nothing reverts.
  - The new `LanguageNotSavedNotice` renders **the same single live region**: class `language-switch__live`, `aria-live="polite" aria-atomic="true"`, `lang` = the displayed language, no `role`, in the DOM all the time while signed in and visually hidden while empty. The notice is inserted into it, so it is announced once.
  - The notice is now a full-width `banner banner--warning` with the warning icon (a non-colour cue). Its text is FE11's: `notSaved`, or `notSavedReverted`; the key logic is unchanged and no i18n strings were changed.
- **`app/Shell.tsx`.** The Shell owns the refused-language state (`useLanguageNotSaved`) and renders the notice **between `<header>` and `.app-body`**, so it is never in the header row.
- **`styles/app.css`.**
  - `.app-notice > .banner` has square corners and wraps inside its own box. The old 0.8rem header-notice rule is removed.
  - **At ≤ 30rem (320 px)** the header itself overflowed horizontally, with or without the notice. It does so on HEAD too: the toggle, wordmark, badge, language button and "Sign out" are wider than 320 px. The no-horizontal-scroll check needed this fixed:
    - tighter header gaps and padding;
    - the "Sign out" label is visually hidden (the button keeps its accessible name "Sign out" / «تسجيل الخروج» and its icon);
    - the wordmark may wrap its name and the "Provisional" badge inside its own box. The badge always stays visible.
  - **At ≤ 900px** the open navigation menu is positioned from the top of `.app-body` instead of a fixed `3.5rem`, so it opens below the header and any banner instead of over them. Before, at 320 px, a taller header or the notice would have been covered.

## 3. Tests

All new component tests run under `<StrictMode>`, in **both directions** (EN→AR and AR→EN), with the message **visible while the language changes**. After the switch the **same DOM element** must show exactly the other language's text and no longer the previous language's, and `<html lang dir>` must follow. Before switching, the tests assert that `<html>` is still in the starting language. Translators are built at module load, because `createI18n()` also applies its locale to `<html>`; building one mid-test would have hidden whether the app did it.

| File | Tests | What they cover |
|---|---|---|
| `apps/web/src/pages/render-time-language.test.tsx` (new) | **28** (14 cases × 2 directions) | Sign-in invalid user name (switched with the **real** sign-in page switch) and refused sign-in (server 403); journey steps field error, and the form-level "Step 1: …" alert (prefix **and** message; a legacy non-UUID step key); Finance validation note "required" and choice "required" (`RowActions`); archive reason "too short" (`ReasonDialog`); record form client field error, plus server field error **and** the form-level (unmapped) list (`RecordForm`); gate submission note and gate decision rationale; North Star statement; evidence upload "required"; evidence link record type **and** record "required". |
| `apps/web/src/pages/team/team.test.tsx` (+2) | 2 (EN→AR, AR→EN) | Assign a role, then switch language with the **real header switch** (save succeeds) while "Role assigned…" is visible: the same `role="status"` element shows the new language, `<html lang dir>` follow, and there is no not-saved notice. |
| `apps/web/src/components/LanguageSwitch.test.tsx` (+2) | 2 (en, ar) | The live region is the header's next sibling and sits before `.app-body`; it is empty until a refused save, and then the notice (a `banner banner--warning` with an `aria-hidden` icon) is inside it and **not inside the header**. There is still exactly one `.language-switch__live`. FE11's 8 tests pass unchanged (same class, `data-testid`, parent live region, texts). |
| `apps/web/e2e/session-end.spec.ts` test 4 (tightened) | real stack, chromium-en (EN→AR) and chromium-ar (AR→EN) | After the real 403 `csrf`, at **320, 768 and 1280 px**: the notice is not inside the header; the header height and the wordmark's width and height are unchanged compared with the same page, language and width with the notice region removed from the layout (±0.5 px); the wordmark's content fits (`scrollWidth ≤ clientWidth`); the notice's top is at or below the header's bottom and the wordmark's bottom; **no horizontal scroll** (`scrollWidth ≤ clientWidth` of `<html>`, with and without the notice); axe at each width (0 serious or critical); a screenshot at each width. At 320 and 768 px the small-screen menu opens **below** the header and the notice. All FE11 assertions are kept. |

## 4. Negative controls: the new tests fail on HEAD

The swaps used `git show HEAD:<file> > <file>` for the 14 changed **source** files (tests kept), because `.git` is read-only in this sandbox. My versions were then restored from a tar taken beforehand. `tar --compare` reported the restore identical, and `apps/web/dist` was rebuilt from the fixed sources before the check matrix.

| Control | Log | Result |
|---|---|---|
| Unit: HEAD sources + the new tests (`render-time-language`, `team`, `LanguageSwitch`) | `negative-control-HEAD-unit.log` | **32 failed, 16 passed**, exit 1. Every new test fails; the 16 that pass are the earlier tests in those files. The failures show the defect directly: after the switch the field **hint** is in the new language but the **error** is still in the old one, e.g. `expected 'Up to 25 MB. هذا الحقل مطلوب.' to contain 'This field is required.'`, `expected ' الخطوة 1: صيغة هذه القيمة غير صحيحة.' to contain 'Step 1: This value has the wrong form…'`, `expected ' ليست لديك صلاحية لهذا الإجراء.' to contain 'You do not have permission for this a…'`. The two placement tests fail because the live region's previous sibling is a header button, not the header. |
| e2e test 4 against a web build of HEAD's sources | `negative-control-HEAD-e2e-layout.log` | **2 failed** (chromium-en, chromium-ar), exit 1: `en 320px` / `ar 320px`, `noticeInHeader` expected `false`, received `true`. |
| The same, with only the structural `noticeInHeader` assertion removed (geometry only) | `negative-control-HEAD-e2e-layout-geometry-only.log` | **2 failed**, exit 1: `en 320px header height` grows by **284.4 px** and `ar 320px header height` by **356.4 px** when the notice is in the header. This is the wrap and squeeze, measured on the real stack. |

## 5. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/lib/problem.ts` | New `fieldErrorMessages(t, codes)`: translates a map of field-error codes when rendering. |
| `apps/web/src/components/Form.tsx` | New `REQUIRED_CODE = "validation.required"`. |
| `apps/web/src/components/ReasonDialog.tsx` | Field error stored as a code. |
| `apps/web/src/components/RowActions.tsx` | `NoteDecisionDialog` errors stored as codes. |
| `apps/web/src/components/RecordForm.tsx` | `errors`/`unmapped` stored as codes; the hook returns texts translated on each render (no consumer change). |
| `apps/web/src/pages/LoginPage.tsx` | The dev sign-in error is stored as its cause and translated when rendering. |
| `apps/web/src/pages/team/TeamPage.tsx` | The success notice is stored as the role code. |
| `apps/web/src/pages/design/JourneysSection.tsx` | Steps editor: field errors as codes, the form-level error as `{ step, code }`. |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | Submission note and decision errors stored as codes. |
| `apps/web/src/pages/define/DefinePage.tsx` | North Star error stored as a code. |
| `apps/web/src/pages/evidence/EvidencePage.tsx` | Upload and link dialog errors stored as codes. |
| `apps/web/src/components/LanguageSwitch.tsx` | The switch reports a refused save through `onRefusedChange`; the new `LanguageNotSavedNotice` renders the single polite live region as a warning banner. |
| `apps/web/src/app/Shell.tsx` | Owns the refused-language state and renders the notice between the header and the app body; the sign-out label is wrapped (`app-header__label`) so it can be visually hidden at 320 px. |
| `apps/web/src/styles/app.css` | Banner style for the notice; the ≤ 30rem header rules; the ≤ 900px menu is positioned from the app body; the old 0.8rem header-notice rule is removed. |
| `apps/web/src/pages/render-time-language.test.tsx` (new) | 28 component tests (see §3). |
| `apps/web/src/pages/team/team.test.tsx` | +2 tests: the Team success notice. |
| `apps/web/src/components/LanguageSwitch.test.tsx` | +2 tests: the notice is placed below the header. |
| `apps/web/e2e/session-end.spec.ts` | Test 4: layout check at 320, 768 and 1280 px, axe and a screenshot at each width, and the small-screen menu position. |
| `docs/delivery/handbacks/DG2/T-DG2-FE12-frontend-ux-engineer.md`, `…/T-DG2-FE12-evidence/**` | This handback, the logs, the axe summaries and 2 screenshots. |

I did not touch `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records. No i18n strings were changed.

## 6. Checks actually run

Every check ran in both locale settings, through one script in my run's `$TMPDIR` (`run-checks.sh`, not kept; it ran each command below and wrote its log):
- `env -u LANG -u LC_ALL` (log prefix `unset-`);
- `env LANG=C.UTF-8 LC_ALL=C.UTF-8` (log prefix `cutf8-`).

The two modes ran one after the other. Each log starts with its exact command and Node version and ends with `# exit status: N`. Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`, Node 22.22.2 at `/opt/node22/bin`. All logs are in `docs/delivery/handbacks/DG2/T-DG2-FE12-evidence/`.

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` (Node 24) | exit 0 | exit 0 |
| `pnpm -r build` (Node 24) | exit 0 | exit 0 |
| `pnpm lint` (Node 24) | exit 0 | exit 0 |
| `pnpm format:check` (Node 24) | **exit 2**, see below. Prettier itself says "All matched files use Prettier code style!" | **exit 2**, same |
| `npx prettier --check . --ignore-path .prettierignore --ignore-path .gitignore --ignore-path $TMPDIR/masked.ignore` | exit 0, "All matched files use Prettier code style!" | exit 0, same |
| `pnpm test`, Node 24.21.0 | 47 files, **848 passed**, exit 0 | 47 files, 848 passed, exit 0 |
| `pnpm test`, Node 22.22.2 | 47 files, **848 passed**, exit 0 | 47 files, 848 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0, "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e: `journeys` + `p2-journeys` + `p2-blank-text` + `session-end`, chromium-en + chromium-ar, `--workers=1` | **68 passed (4.7m)**, exit 0 | **68 passed (4.7m)**, exit 0 |
| axe: all 16 summary files (2 modes × en/ar × 4 suites; copied to `axe/<mode>/<lang>/`) | 264 scans, **0 violations of any impact**, so 0 serious and 0 critical. This includes the 8 new `language-not-saved-{320,768,1280}` scans. | same: 264 scans, 0 violations |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

848 = FE11's 816 + my 32 new unit tests: 28 in the new file, 2 in Team, 2 in LanguageSwitch. 47 files = 46 + the new file.

**e2e command** (repository root, Node 24; ports 24581/3581 for unset and 24582/3582 for C.UTF-8, all below 32768; pre-installed Chromium; `playwright install` was not run):

```
env <locale env> E2E_PG_PORT=2458x E2E_API_PORT=358x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> \
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts \
  apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/session-end.spec.ts --project=chromium-en --project=chromium-ar --workers=1
```

Log tails:

```
unset-e2e.log:  ✓ 34 [chromium-en] › apps/web/e2e/session-end.spec.ts:299:1 › a 403 is not a session end: a refused change keeps the user signed in where they are
unset-e2e.log:  ✓ 68 [chromium-ar] › apps/web/e2e/session-end.spec.ts:299:1 › a 403 is not a session end: …
unset-e2e.log:  68 passed (4.7m)   # exit status: 0
cutf8-e2e.log:  68 passed (4.7m)   # exit status: 0
*-test-node{22,24}.log:  Test Files 47 passed (47) / Tests 848 passed (848)   # exit status: 0
  ✓ |unit-web| src/pages/render-time-language.test.tsx (28 tests)
  ✓ |unit-web| src/pages/team/team.test.tsx (10 tests)
  ✓ |unit-web| src/components/LanguageSwitch.test.tsx (10 tests)
*-validate-DG1.log:  PASS gate DG1 (historical)   # exit status: 0
```

### Every non-zero exit, failed suite and warning

- **`pnpm format:check`, exit 2 in both modes** (`unset-format-check.log`, `cutf8-format-check.log`).
  - The only errors are 12 `EACCES` "Unable to read file" lines for paths that this agent sandbox masks (unreadable mounts, not repository content): `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`.
  - Prettier reports "All matched files use Prettier code style!" and 0 `[warn]`.
  - As the assignment allows, the `--ignore-path` variant, which adds only those 12 paths to `.prettierignore` + `.gitignore`, exits 0 in both modes.
  - None of the 12 are mine. `CLAUDE.local.md` is an untracked, unreadable file at the repository root that I did not create.
- **Before the matrix, development runs only:** one pre-matrix `pnpm format:check` flagged 2 of my files (`RecordForm.tsx`, `render-time-language.test.tsx`). I formatted them with `prettier --write` before the matrix; the matrix logs above are all after that.
- **Negative-control logs, exit 1.** Expected: they show the defect on HEAD (§4).
- **All 4 unit logs** contain one `[FSTDEP022] FastifyWarning: … router options … deprecated`.
  - It comes from an API test's Fastify instance (`apps/api/**`, outside my scope) and is pre-existing (FE10 and FE11 report it too).
  - It is the only line matching `Warning: |act\(|Cannot update a component`: there are **0 React warnings**, 0 `stderr |` blocks and 0 hook timeouts.
- **Build logs** contain Vite's "(!) Some chunks are larger than 500 kB" (one per build). This is pre-existing (FE8–FE11).
- **e2e logs** contain 3 `npm warn Unknown project config "strict-peer-dependencies" | "auto-install-peers" | "link-workspace-packages"` lines, from `npx` reading the pnpm `.npmrc`. This is pre-existing harness noise. The only other "warning" match is a test title ("…the 3-5 top-outcomes warning"). There are 0 failed and 0 flaky tests.
- **Failed attempts during development** (not in the matrix), each fixed in the test, not the product:
  - The evidence-link test's label regex `^Record` also matched "Record type" in English (fixed by anchoring the label).
  - The Team test's scripted `GET /me` always returned the old preference, so a `/me` refetch after a **successful** save looked like another tab changing it. FE11's rule then re-applied it correctly. I made the scripted `/me` stateful.
  - Building translators inside a test reset `<html lang>`, because `createI18n()` applies its locale. They are now built before rendering or at module load.
  - The first e2e layout reference was measured in the previous language. The product name's length differs between languages, so the wordmark width differed by 107 px. The reference is now the same page, language and width with the notice region taken out of the layout.
  - The 320 px horizontal-scroll check failed on the pre-existing header overflow (61 px AR, 145 px EN). I fixed the header (§2).
- **Harness directories.** The Claude Code harness created empty `.claude/.cc-writes` directories in my shell's working directories:
  - `apps/web/`, `apps/web/src/`, and twice in the evidence directory.
  - They are untracked and empty, and not test output. I removed them with `rmdir`.

## Visual evidence (2 cited screenshots, from the `unset` e2e run, test 4 after the real 403)

- `docs/delivery/handbacks/DG2/T-DG2-FE12-evidence/en-to-ar-320-language-not-saved.png`: chromium-en after switching **EN→AR** with the save refused, at **320 px**.
  - The page is Arabic RTL. The header is one row: menu, the wordmark «منصة موبايلي للتحوّل» with its «مؤقت» badge wrapping inside its own box, «English», and the icon-only sign-out.
  - **Below** it is the full-width warning banner with FE11's Arabic `notSaved` text. There is no horizontal scroll.
- `docs/delivery/handbacks/DG2/T-DG2-FE12-evidence/ar-to-en-1280-language-not-saved.png`: chromium-ar after switching **AR→EN** with the save refused, at **1280 px**.
  - The header is one row, and the wordmark "Mobily Transformation Hub" and its "Provisional" badge are not squeezed.
  - The English notice is a single line in the banner below the header.
  - The wordmark looks underlined only because Playwright's mouse is still where it clicked the menu toggle at 768 px, which at 1280 px is over the wordmark (`:hover` style).

The other FE12 screenshots (the original 1280 px shot and 320/768/1280 px, en and ar, in both modes) stayed in `$TMPDIR` and were not kept, to respect the two-screenshot limit. Besides the two cited ones, I viewed only the 320 px pair and one 1280 px shot from my development run.

## Known gaps / not done

- **At 320 px the English wordmark wraps to three short lines** ("Mobily / Transformation / Hub" above the badge). It wraps the same way with or without the notice. The header is taller at that width (about 74 px AR, 93 px EN, compared with 56 px), which is why the small-screen menu is now positioned from the app body. A designer may prefer a shorter product name or a smaller wordmark on phones.
- **At ≤ 480 px "Sign out" is icon-only.** The accessible name is unchanged, and the e2e tests still find it by its exact name. Sighted users without the icon's meaning lose the visible word on very small screens.
- **The small-screen menu now scrolls with the page** instead of being fixed under the header. The toggle is in the non-sticky header, so the menu always opens where the user is looking (at the top). I did not add an e2e test of a long menu on a short screen.
- **The notice still has no dismiss button**, and it stays until the next switch or a reload (FE11 behaviour, unchanged as required).
- **The e2e "same header with and without the notice" reference** hides the notice region with an inline `display: none` inside the page to measure the counterfactual. It is a test-only measurement; the page is restored immediately afterwards.

## Merge instructions

- No migrations and no API or contract changes. Only `apps/web/**` is touched, plus this handback and its evidence.
- `apps/web/dist` in the working tree was rebuilt from the fixed sources (the matrix's `pnpm -r build`). A fresh `pnpm -r build` is still recommended before any e2e run.
- No conflicts expected:
  - Any code that called `<LanguageSwitch signedIn />` and expected it to render the notice must render `<LanguageNotSavedNotice refused={…} />` and pass `onRefusedChange`. The Shell is the only signed-in caller, and it is updated.
  - `useRecordForm`'s returned `errors`/`unmapped` keep their shape (translated strings).
