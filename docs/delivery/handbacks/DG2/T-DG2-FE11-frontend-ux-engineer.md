# Handback T-DG2-FE11 (frontend-ux-engineer): the language-not-saved notice speaks the language the user chose

- **Stage / task:** DG2 (FIXING), T-DG2-FE11. **Requirement:** REQ-S15-007 (persistent bilingual language switch). No finding ID (the gap came from FE10's handback).
- **Assignment:** `docs/delivery/assignments/DG2/round-14/T-DG2-FE11.md`, sha256 `05ef8677…4a95bf9` (verified with `sha256sum`).
- **Base:** `HEAD` `668532e` on `claude/mobily-transformation-platform-regate`, which includes FE10 `8cb3bb8`. Nothing is committed; the orchestrator integrates.
- **Invocation:** `DG2-T-DG2-FE11-frontend-ux-engineer-20261007T083101Z-e02de1ef` (session `e02de1ef-30c4-49b7-baa0-0b271b4cb9ff`).
- **Evidence directory:** `docs/delivery/handbacks/DG2/T-DG2-FE11-evidence/`.
- I am an engineering agent. Nothing here grants a business, Finance or IT approval. All test data is SYNTHETIC.

## Decision: behaviour (a)

When the save is refused, the page **keeps the language the user chose in this browser** and does not revert. The notice appears **in that language**.

**Why (a) and not (b):**

- **The user can read it.** Someone who switches EN→AR may read only Arabic. Under (b) they would see the page snap back to English with an English notice they cannot read. Under (a) the notice is in the language they just asked for.
- **Nothing surprising happens.** The click does what the user asked. Only the profile save failed, and the notice says exactly that.
- **It removes the actual defect instead of hiding it.** The revert was never a design decision. It was an accident (see Root cause). That accident also briefly flipped back a **successful** switch (`ar → en → ar`) while the PUT was in flight. Fixing it addresses both.
- **The server preference still wins where REQ-S15-007 needs it.**
  - It is applied when it is first known (on sign-in or reload).
  - It is applied whenever it **changes** (for example, another tab saves a new preference).
  - The notice says this: "…Your saved language returns the next time you open the app." That is accurate: on a reload, `RequireSession` re-applies the persisted preference.

## Root cause

`RequireSession` (`apps/web/src/auth/session.tsx`) applied the persisted preference in `useEffect(…, [preferred, i18n])`.

- react-i18next 17 returns a **new `i18n` wrapper object on every language change**. I checked `useTranslation.js`: `createI18nWrapper` runs when `wrapperLangRef.current !== lang`.
- So every switch re-ran the effect, and the effect re-applied the unchanged old preference straight away. I traced this in a unit test: a `changeLanguage` spy shows `ar` from `LanguageSwitch.onClick`, then `en` from `session.tsx:64`.
- On a refused save, nothing switched it back again. The page stayed in the old language, and the notice string had been produced by `t()` before or around that flip, so it came out in whichever language was current.

## The fix

| File | Change |
|---|---|
| `apps/web/src/auth/session.tsx` | The preference effect applies `preferred` only when it is first known or when its **value** changes (an `appliedPreferred` ref), never just because the displayed language changed. Also stops the in-flight flicker on successful saves. |
| `apps/web/src/components/LanguageSwitch.tsx` | Stores the **refused target locale** instead of a translated string, so the notice is rendered from its key at render time and can never be frozen in an earlier language. While signed in, a **polite, atomic live region** (`aria-live="polite" aria-atomic="true"`, `lang` = displayed language) is always in the DOM, and the notice is inserted into it, so it is announced once. It has no `role="status"`, so it never competes with a page's own status message (the sign-in page and the Team page query `findByRole("status")`). If the persisted preference is re-applied while the notice is showing (another tab), the notice switches to `notSavedReverted`, in the language now shown. With only two locales this is a contrived path, but it keeps the text truthful. |
| `apps/web/src/i18n/{en,ar}/common.json` | `notSaved` now says the change is for this browser for now and that the saved language returns next time. New key `notSavedReverted`. Key parity is kept (the i18n parity test passes). |
| `apps/web/src/styles/app.css` | `.language-switch__live:empty` is visually hidden (it stays in the accessibility tree), so the empty region adds no gap to the header row. |
| `apps/web/src/components/LanguageSwitch.test.tsx` (new) | 8 component tests (see Tests). |
| `apps/web/e2e/session-end.spec.ts` | FE10 test 4 is tightened. It asserts the exact notice text in the chosen language, `html[lang]`/`[dir]`, exactly one polite atomic live region with the right `lang`, axe, a screenshot, and that a second later nothing has flipped back (the sign-out button is in the chosen language). The now-unused `escape` import is removed. |

I did not touch `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Sweep: other notices shown in another language after a failed preference or profile save

| Place | Result |
|---|---|
| `LanguageSwitch` "not saved" notice | **The defect; fixed** (above). |
| `PUT /api/v1/me/preferences` callers | Only `LanguageSwitch`. No other client code saves the user's own preferences or profile (I grepped `"/api/v1/me`). |
| Admin → Users edit (`UsersPage`, `PATCH /users/:id`, may be the admin's own record, includes `preferredLocale`) | Errors go through `errorMessage(t, vs.error)`, `fieldErrorMessage(t, code)` and `RootError` → `fieldErrorMessage(t, …)`. All are **translated at render time** from codes, so they always follow the page language. A successful self-edit of `preferredLocale` is picked up on the next `/me` refetch, which the new rule treats as a value change and applies. **No defect.** |
| Admin → Users create | `serverError` is stored as the error object and rendered through `errorMessage(t, …)` at render time. **No defect.** |
| `RequireSession` preference effect | The cause; fixed. Also fixes the brief flip back during a **successful** save. |
| Related, but not after a preference or profile save (not changed, listed for completeness) | Three places store an already-translated string in state, so the text stays in the old language if the user switches language while it is visible: `TeamPage` `done` ("Role assigned…", success toast), `LoginPage` `error` (`auth.dev.invalidUsername`), and `JourneysSection` `error` (line ~528). None of them follows a preference or profile save, so they are outside this task. Suggested as a Low polish item: store the key or code and translate at render, as `LanguageSwitch` now does. |

## Tests

**Component: `apps/web/src/components/LanguageSwitch.test.tsx`, 8 tests, all under `<StrictMode>`.**

- **Refused save, 4 cases:**
  - EN→AR with 403 `csrf`
  - AR→EN with 403 `csrf`
  - EN→AR with 403 `forbidden`
  - AR→EN with 503
- **Each refused case asserts:**
  - the notice text is exactly the **chosen** language's `notSaved`, and not the previous language's;
  - `i18n.language`, `html[lang]` and `html[dir]` are the chosen language;
  - the notice sits in exactly one `aria-live="polite" aria-atomic="true"` region whose `lang` is the chosen language, and there is exactly one notice;
  - after 300 ms the language-change log is exactly `[to]` (no flip back), and the notice is unchanged;
  - the switch now offers the previous language;
  - exactly one PUT was sent, `localStorage` holds the chosen language, and the cached profile still holds the old preference.
- Switching back, also refused, gives a fresh notice in the language now shown, and only one notice.
- A **successful** save never flips back while the PUT is in flight: the change log is exactly `["ar"]`.
- If the persisted preference changes later and is re-applied, the notice says `notSavedReverted` in that language, with `lang="en"`.
- The signed-out sign-in page has no live region.

**e2e:** FE10 test 4 is tightened (see the table above). It runs on the real stack: a real 403 `csrf` from the API, in both chromium-en (EN→AR) and chromium-ar (AR→EN).

**Negative controls: the new assertions fail on HEAD.**

| Control | Log | Result |
|---|---|---|
| Unit, HEAD's 5 source files (`LanguageSwitch.tsx`, `session.tsx`, both `common.json`, `app.css`) with the new test file | `negative-control-HEAD-unit.log` | **7 failed, 1 passed**, exit 1. 6 fail because HEAD renders no `language-not-saved` notice element (structural). The success-flicker test fails on behaviour: `expected [ 'ar', 'en', 'ar' ] to deeply equal [ 'ar' ]`. The passing test is the sign-in-page guard. |
| Unit, FE11 sources but HEAD's `session.tsx` (isolates the behaviour) | `negative-control-HEAD-session-only-unit.log` | **7 failed, 1 passed**, exit 1. Example: `expected 'Your language change could not be sav…' to be 'تغيّرت اللغة في هذا المتصفح مؤقتًا…'`. The page reverted to English, and the flicker test again shows `['ar','en','ar']`. |
| e2e test 4 against a web build of HEAD's 5 source files | `negative-control-HEAD-e2e-test4.log` | **2 failed** (chromium-en and chromium-ar), exit 1: the exact-language notice element is not found. |
| e2e test 4 against a web build with only HEAD's `session.tsx` | `negative-control-HEAD-session-only-e2e-test4.log` | **2 failed**, exit 1. chromium-en received the English `notSavedReverted` where Arabic `notSaved` was expected. chromium-ar received the Arabic text where English was expected. This is the real revert on the real stack. |

The swaps used `git show HEAD:<file> > <file>`; `git checkout` is unavailable because `.git` is read-only in this sandbox. Each swap was restored from a tar of my files. `apps/web/dist` was rebuilt from the fixed sources afterwards (`vite build`, exit 0), and `git diff --stat` confirmed the restore.

## Checks actually run

Every check ran in both locale settings: `env -u LANG -u LC_ALL` (prefix `unset-`) and `env LANG=C.UTF-8 LC_ALL=C.UTF-8` (prefix `cutf8-`). Each log starts with its command and the Node version and ends with `# exit status: N`. Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is at `/opt/node22/bin`.

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` (Node 24) | exit 0 | exit 0 |
| `pnpm -r build` (Node 24) | exit 0 | exit 0 |
| `pnpm lint` (Node 24) | exit 0 (after the fix below) | exit 0 (after the fix below) |
| `pnpm format:check` (Node 24) | exit 0, "All matched files use Prettier code style!", 0 `[warn]`, 0 EACCES | same |
| `pnpm test`, Node 24.21.0 | 46 files, **816 passed**, exit 0 | 46 files, 816 passed, exit 0 |
| `pnpm test`, Node 22.22.2 | 46 files, **816 passed**, exit 0 | 46 files, 816 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0, "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e: `journeys` + `p2-journeys` + `p2-blank-text` + `session-end`, chromium-en + chromium-ar, `--workers=1` | **68 passed (4.7m)**, exit 0 | **68 passed (4.7m)**, exit 0 |
| axe, all 16 summary files (`axe/<mode>/<lang>/axe-summary*.json`: 2 runs × en/ar × 4 suites) | **0 violations of any impact**, so 0 serious and 0 critical. This includes the new `en/language-not-saved` and `ar/language-not-saved`. | same |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

The test count went from 808 (FE10) to 816 because of the 8 new component tests.

**e2e command** (repository root, Node 24; ports 24581/3581 for unset and 24582/3582 for C.UTF-8, all below 32768; pre-installed Chromium; `playwright install` not run):

```
env <locale env> E2E_PG_PORT=2458x E2E_API_PORT=358x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> \
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts \
  apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/session-end.spec.ts --project=chromium-en --project=chromium-ar --workers=1
```

Log tails:

```
unset-e2e.log:  ✓ 34 [chromium-en] › session-end.spec.ts:253:1 › a 403 is not a session end: a refused change keeps the user signed in where they are (2.6s)
unset-e2e.log:  ✓ 68 [chromium-ar] › session-end.spec.ts:253:1 › a 403 is not a session end: … (2.6s)
unset-e2e.log:  68 passed (4.7m)   # exit status: 0
cutf8-e2e.log:  68 passed (4.7m)   # exit status: 0
*-test-node{22,24}.log:  Test Files 46 passed (46) / Tests 816 passed (816)  # exit status: 0
```

**Every non-zero exit, failed suite and warning:**

- **`pnpm lint`, exit 1, first attempt** (`unset-lint-attempt1-unused-import.log`, `cutf8-lint-attempt1-unused-import.log`). Cause: `'escape' is defined but never used` in `session-end.spec.ts`, left over from my tightening of test 4. I removed the import and **re-ran every check in both modes**. All results above are from that re-run.
- **Negative-control logs, exit 1.** Expected: they show the defect on HEAD.
- **All 4 unit logs** contain one `[FSTDEP022] FastifyWarning: … router options … deprecated`.
  - It comes from an API test's Fastify instance (`apps/api/**`, outside my scope) and is pre-existing (FE10 reports the same).
  - There are no `stderr |` React blocks, no `act(` or "Cannot update a component" warnings, and no hook timeouts. The F-DG2-430 React-warning guard covers the new test file too.
- **Build logs** contain Vite's "(!) Some chunks are larger than 500 kB". This is pre-existing (FE8–FE10).
- **e2e logs** contain 3 `npm warn Unknown project config "strict-peer-dependencies" | "auto-install-peers" | "link-workspace-packages"` lines. They come from `npx` reading the pnpm `.npmrc`; this is pre-existing harness noise. The only other "warning" match is a test title ("…the 3-5 top-outcomes warning"). There are 0 page errors and 0 `---- api.log` failure tails.
- During development, a stray `cat` in one of my shell commands waited on stdin and was moved to the background; I killed it. A safety check refused one `rm` that used an unguarded variable, so I re-ran it with `"${EV:?}"`. Neither affected any check result.

## Visual evidence (2 cited screenshots, from the `unset` e2e run, test 4 after the real 403)

- `docs/delivery/handbacks/DG2/T-DG2-FE11-evidence/en-to-ar-language-not-saved.png`: chromium-en after switching **EN→AR** with the save refused. The page is Arabic RTL. The notice in the header reads «تغيّرت اللغة في هذا المتصفح مؤقتًا، لكن تعذّر حفظها في ملفك الشخصي. ستعود لغتك المحفوظة عند فتح التطبيق مرة أخرى.» The switch offers "English" and the user is still signed in on «حول هذا المنتج».
- `docs/delivery/handbacks/DG2/T-DG2-FE11-evidence/ar-to-en-language-not-saved.png`: chromium-ar after switching **AR→EN** with the save refused. The page is English LTR with the English notice. The switch offers «العربية» and the user is still signed in on "About this product".

## Known gaps / not done

- **The notice is long for the header.** At 1280 px it wraps to two lines and squeezes the wordmark (visible in both screenshots). It stays readable and axe is clean, but a designer may want it shorter or moved to a banner below the header. I did not change the layout.
- **The live region is polite and has no dismiss button.** The notice stays until the next switch or a reload, as before.
- **The persisted preference wins on reload.** That is by design under (a) and REQ-S15-007, and the notice says so. The `localStorage` hint keeps the chosen language until `/me` arrives, so after a reload the page can briefly show the chosen language before the persisted one is applied. That pre-sign-in hint behaviour is unchanged from HEAD.
- **I did not change the three "translated string stored in state" places listed in the sweep.** They are outside a failed preference or profile save; I suggest a Low polish item.
- **The e2e negative control against HEAD's full sources fails on a missing element** (HEAD renders no `data-testid` notice), not on the language. The behavioural proof on the real stack is the session-only control, which shows the revert and the wrong-language text directly.

## Merge instructions

- No migrations and no API or contract changes. Only `apps/web/**` is touched, plus this handback and its evidence.
- `apps/web/dist` in the working tree was rebuilt from the fixed sources after the negative controls. A fresh `pnpm -r build` is still recommended before any e2e run.
- No conflicts expected. Any test that looked for the language notice by `role="status"` must use `data-testid="language-not-saved"` (or the `.language-switch__live` region) instead. FE10's test 4 is the only such test, and it is updated.
