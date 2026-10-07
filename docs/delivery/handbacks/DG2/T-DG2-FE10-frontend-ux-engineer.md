# Handback T-DG2-FE10 (frontend-ux-engineer): a session that ends while the app is open lands once on sign-in

- **Stage / task:** DG2 (FIXING), T-DG2-FE10. **Finding:** F-DG2-480 (High, non-mandatory, REQ-S16-030).
- **Assignment:** `docs/delivery/assignments/DG2/round-14/T-DG2-FE10.md` (sha256 `4fe83e79…eb5f1d`, verified).
- **Base:** `HEAD` `e3b00c01cdd04ce6ccb8f1503211c97cb79e2853` on `claude/mobily-transformation-platform-regate`. Nothing is committed; the orchestrator integrates.
- **Invocation:** `DG2-T-DG2-FE10-frontend-ux-engineer-20261007T074607Z-f81bc147` (session `f81bc147-4719-46b1-8456-03b92b634e5c`).
- **Evidence directory:** `docs/delivery/handbacks/DG2/T-DG2-FE10-evidence/`.
- I am an engineering agent. Nothing here grants any business, Finance or IT approval. All test data is SYNTHETIC.

## The fix (F-DG2-480)

**Cause (confirmed).** On HEAD:

1. `RequireSession` redirected to `/login?…&error=session_expired` on a 401 while the last successful `/me` was still cached.
2. `LoginPage` saw that same stale `me.data` and sent the user straight back.
3. Each mount re-probed `/me`.

**One rule for "the session has ended".** It lives in the API client (`apps/web/src/api/client.ts`) as module state, so a stale React Query cache can never contradict it. The session phase is one of:

| Phase | Meaning |
|---|---|
| `unknown` | No session confirmed in this tab yet, or signed out here on purpose |
| `active` | The last `GET /me` succeeded |
| `ended` | A request answered 401 `unauthenticated` while the phase was `active` |

How the rule plays out:

- **Any request can end the session.** That includes `GET /me` itself, a page query, a mutation or a dialog's upload. When one answers 401 with code `unauthenticated` (or a 401 with no problem body) while the phase is `active`:
  - the CSRF token is dropped;
  - the phase becomes `ended`, exactly once per session.
- **What is not a session end:**
  - a 403 (`forbidden`, `csrf`);
  - a 401 with another code (`auth.login_failed`);
  - any 401 when no session was active.
- **`RequireSession` reacts to `ended` only**, through `useSyncExternalStore`. It then:
  1. renders **nothing**, so the signed-in shell, stale name and navigation are never shown;
  2. **disables** its `/me` query, so nothing re-probes;
  3. in one effect, **clears** the cached identity and every session-scoped query (`cancelQueries` + `removeQueries`, once per session end through `claimSessionEnd()`);
  4. **navigates once** (guarded by a ref, so it is safe under StrictMode) to `/login?returnTo=<page>&error=session_expired`.

  A dialog that received the 401, such as the evidence upload, unmounts with the page, so it **closes**.
- **`LoginPage`** decides "already signed in" only from a **fresh** `/me`:
  - the query uses `refetchOnMount: "always"`;
  - the redirect happens only if `isSuccess`, not fetching, and `dataUpdatedAt ≥` the page's mount time.

  After a session end the cache is empty anyway. The page shows the localized `auth.errors.session_expired` banner (`role="alert"`) and the sign-in form.
- **Signing in again** works like this: `dev-login` → `/me` refetch → 200 → phase `active` → the user is sent to `returnTo`.
- **`/me` requests are bounded.** Per session end there are at most 2: the triggering request, if it was `/me`, plus the sign-in page's single fresh probe. There are no retries, because the default `shouldRetry` never retries a 4xx.
- **Signing out in this tab** is not a session end:
  - `markSignedOut()` sets the phase to `unknown`;
  - the logout request is `silent401` (a 401 there means "already signed out");
  - the cache is cleared, then the browser goes to `?signedOut=1` (or the OIDC end-session URL).

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/api/client.ts` | Session phase (`unknown`/`active`/`ended`), `isSessionEndedError` (401 `unauthenticated` only), `endSession` (once), `markSessionActive`, `markSignedOut`, `claimSessionEnd`, `subscribeSessionPhase`/`getSessionPhase`, `resetSessionStateForTests`. Replaces the old `onUnauthenticated` listener that re-probed `/me`. |
| `apps/web/src/api/queries.ts` | `fetchMe` is no longer `silent401` (a `/me` 401 while active is a session end) and marks the phase `active` on success. `useMeQuery` accepts `enabled` / `refetchOnMount`. |
| `apps/web/src/auth/session.tsx` | `RequireSession`: on `ended`, render nothing, disable `/me`, clear the cache once, navigate once with `error=session_expired`. A 401 with no session gives a plain `/login?returnTo=` with no message (unchanged). Adds `sessionEndedLoginPath`. |
| `apps/web/src/pages/LoginPage.tsx` | "Already signed in" only from a fresh `/me`, never from the cached identity. |
| `apps/web/src/app/Shell.tsx` | Sign-out: logout `silent401`, `markSignedOut()`, cancel and clear the cache, one navigation. |
| `apps/web/src/test/fixtures.tsx` | `renderApp` resets the client's session state (`resetSessionStateForTests`) instead of only the CSRF token. |
| `apps/web/src/auth/session-end.test.tsx` (new) | 12 unit tests, EN and AR (see Tests). |
| `apps/web/e2e/session-end.spec.ts` (new) | 4 real-stack journeys × chromium-en/ar (see Tests). |
| `apps/web/e2e/support/with-stack.sh` | `E2E_DEFAULT_RATE_LIMITS=1` leaves `AUTH_RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_MINUTE` unset, so the API runs with the product defaults (300 and 20 per minute). The default behaviour (raised limits) is unchanged. |

I did not touch `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**` or `docs/source/**`.

## Sweep: every place that reads the cached identity or reacts to 401/403

| Place | Before (HEAD) | Now |
|---|---|---|
| `api/client.ts` `apiRequest` | Any non-silent 401 notified listeners (any code). | Only 401 `unauthenticated` (or a body-less 401) while `active` ends the session, once. A 403 or any other status just throws `ApiError`. |
| `fetchMe` / `useMeQuery` | `silent401`; never marked a session. | A success sets `active`. A 401 while active ends the session; a 401 with no session is just "not signed in". |
| `RequireSession` | A 401 listener invalidated `/me`. On a `/me` 401 it rendered `<Navigate>` to sign-in, and the stale `me.data` stayed in the cache. | On `ended`: no shell, no `/me` probe, the cache is cleared once, one navigation. On mount after the user presses back while `ended`, it renders nothing and navigates once to sign-in again; the sign-in page stays put. A `/me` 5xx with no data shows `ErrorState`; with data it keeps the page (unchanged). |
| `LoginPage` | `if (me.data) Navigate(returnTo)` used the stale cache, which caused **the loop**. | Redirects only on a fresh `/me` success. The dev-login probe stays `silent401` and runs only when `/me` errored. |
| `DevLoginForm` | `invalidateQueries(me)` → navigate. | Same. The fresh `/me` sets `active`, then the user goes to `returnTo` (unit test plus e2e). |
| `Shell` sign-out | `clear()`, navigate; a 401 from logout notified listeners. | Logout `silent401`, `markSignedOut()`, cancel and clear, one navigation; shows "signed out" and never "session ended" (unit test). |
| `LanguageSwitch` (`PUT /me/preferences`) | A 401 notified listeners. | A 401 follows the session-end rule. A 409 re-reads `/me` and retries once (unchanged). A 403 shows the "not saved" notice and stays signed in (e2e test 4). |
| React Query defaults (`App.tsx`) | `retry: shouldRetry` (no retry for 4xx), `refetchOnWindowFocus: true`, mutations `retry: false`. | Unchanged. No retry storm is possible on 401 or 403. After a session end the `/me` query under `RequireSession` is disabled. On the sign-in page a window focus costs at most one `/me`. |
| Dialogs (evidence upload, link/remove, `ReasonDialog`, `RecordForm`/`useVersionedSave`, gate submissions) | A 401 surfaced in the dialog, then the loop began. | A 401 ends the session. The page and its dialog unmount, so the dialog **closes**, and the user lands once on sign-in. A 403 still shows the dialog's localized message (unchanged). |
| `TransformationCreatePage` (invalidates `/me` after create) | Re-probed `/me`. | Same; goes through `fetchMe`, so the session-end rule applies. |
| `QueryState` / `ErrorState` / `NoPermissionState` | A 401 page error could flash. | A 401 page never renders (the page unmounts). A 403 gives `NoPermissionState` (unchanged). |

## Tests

**Unit: `apps/web/src/auth/session-end.test.tsx`, 12 tests.** Each trigger runs in EN (LTR) and AR (RTL) against a scripted server whose session can end mid-test.

- **A 401 on navigation** (click an in-app link):
  - exactly 1 router landing on `/login`, with `returnTo` and `error=session_expired`;
  - the localized alert and the sign-in form are shown, and `dir` is correct;
  - the page stays on `/login` for 400 ms;
  - `/me` ≤ 2, and there is no sign-out button, user name or navigation;
  - the `/me` and list queries are removed from the cache;
  - signing in again returns the user to `/transformations`.
- **A 401 on a dialog mutation** (the evidence upload answers 401 at commit): the same landing, the dialog closes, and the upload is sent once.
- **Sign-out elsewhere noticed by the next `/me` probe** (a focus refetch), in OIDC mode: the same landing with the corporate sign-in link, `/me` ≤ 2, and no stale shell.
- **A 403 is not a session end:** the user stays on the page, signed in.
- **StrictMode** (as in production): still exactly one landing.
- **The sign-in page** decides only from a fresh `/me`:
  - with a stale cache and a dead session, it shows the form with no bounce;
  - a live session on `/login` goes on to `returnTo`;
  - signing out here shows "signed out" and never "session ended", with ≤ 1 `/me`.

**e2e on the real stack: `apps/web/e2e/session-end.spec.ts`, 4 tests × chromium-en/ar.** These are the reviewer's scenarios:

1. **Signed out in another tab, then an in-app link.**
   - The alert with the localized message and the sign-in form are visible within **1.5 s** (the assignment says about 1 s; the extra half second is headroom for a loaded machine).
   - The URL is sampled every 100 ms for 3 s and only ever shows `/login`.
   - `/me` ≤ 3, there is no sign-out button or navigation, and `dir` is correct.
   - axe finds 0 serious or critical issues.
   - Signing in again lands on `/transformations`; there are no 429s, no page errors and no foreign requests.
2. **The D-073 commit-time refusal.**
   - `dev.nobody` holds TL and the Upload dialog is open. `dev.admin` revokes the assignment.
   - The upload answers **401**, the dialog closes, and the user lands on sign-in with the message.
   - axe finds 0 serious or critical issues.
   - The item's `currentContentId` is still `null` (nothing stored), and there are no 429s.
3. **After a session end, the tab stays quiet.** It is left open 2 s more and `/me` stays ≤ 3. A **second browser context from the same IP signs in**, and no response anywhere is 429.
4. **A real 403 is not a session end.** A second sign-in in the same browser replaces the session cookie, so this tab's CSRF token is refused: `PUT /me/preferences` gets **403** `csrf`. The user stays on `/about`, signed in, with the "not saved" notice, and `/me` ≤ 1.

**Default rate limits.** The same spec ran with `E2E_DEFAULT_RATE_LIMITS=1` (product defaults: 300 general and 20 auth requests per minute per IP). It used **one project per fresh stack**, because the 20-per-minute auth bucket is per IP and a full EN+AR run makes more than 20 auth requests in a minute. All 4 tests passed in each run: no 429, and the second context signed in.

**Negative control (the new tests fail on HEAD).** I swapped in HEAD's `apps/web/src`, ran the tests, then restored my changes and rebuilt.

- **Unit** (`negative-control-HEAD.log`): **8 failed, 4 passed** of 12, exit 1.
  - All 8 trigger tests fail: navigation, dialog and sign-out elsewhere in EN and AR, the StrictMode test, and the stale-cache test.
  - The 4 that pass are the guard tests, which hold on HEAD too: 403 in EN and AR, signed-in `/login` redirect, and sign-out here.
- **e2e against a HEAD web build:**
  - `negative-control-HEAD-e2e.log`: test 1 failed in both EN and AR (the alert never appears). Serial mode then skipped the rest of the file.
  - So I ran tests 2 and 3 alone against HEAD, with raised and with default limits: `negative-control-HEAD-e2e-{1,2}-{raised,default}-limits.log`. **All 4 runs failed**, exit 1.

## Checks actually run

Each check ran in both locale settings: `env -u LANG -u LC_ALL` (log prefix `unset-`) and `env LANG=C.UTF-8 LC_ALL=C.UTF-8` (prefix `cutf8-`). Each log starts with its command line and ends with `# exit status: N`. Node 24.21.0 is `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is `/opt/node22/bin`.

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` (Node 24 / 22) | exit 0 / exit 0 | exit 0 / exit 0 |
| `pnpm -r build` (Node 24 / 22) | exit 0 / exit 0 | exit 0 / exit 0 |
| `pnpm lint` (Node 24 / 22) | exit 0 / exit 0 | exit 0 / exit 0 |
| `pnpm format:check` (Node 24 / 22) | **exit 2** / **exit 2** (see below) | **exit 2** / **exit 2** |
| `npx prettier --check . --ignore-path .gitignore --ignore-path .prettierignore --ignore-path .fe10-masked-ignore` (temporary root file listing the 12 masked paths, removed afterwards; Node 24) | exit 0, "All matched files use Prettier code style!" | exit 0, same |
| `pnpm test`, Node 24.21.0 | 45 files, **808 passed**, exit 0 | 45 files, 808 passed, exit 0 |
| `pnpm test`, Node 22.22.2 | 45 files, **808 passed**, exit 0 | 45 files, 808 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` (Node 24 / 22) | exit 0: "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e: P1 + P2 + `p2-blank-text` + `session-end`, chromium-en + chromium-ar, `--workers=1`, raised limits | **68 passed (4.6m)**, exit 0 | **68 passed (4.6m)**, exit 0 |
| `session-end.spec.ts` with product **default** limits, chromium-en / chromium-ar (one stack each) | 4 passed / 4 passed, exit 0 | 4 passed / 4 passed, exit 0 (chromium-ar on the second attempt; see below) |
| axe, all 16 summary files (`*-axe-summary*.json`: 2 runs × en/ar × 4 suites) | 0 violations of any impact (so 0 serious, 0 critical), including `session-end-in-app-link` and `session-end-upload-refused` | same |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

**e2e command** (from the repository root, Node 24):

```
env E2E_PG_PORT=2456x E2E_API_PORT=356x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> \
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts \
  apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/session-end.spec.ts --project=chromium-en --project=chromium-ar --workers=1
```

The default-limit runs used the same command with `E2E_DEFAULT_RATE_LIMITS=1`, `apps/web/e2e/session-end.spec.ts` only, and a single `--project`.

- The tests ran against the real API and a disposable PostgreSQL, using the pre-installed Chromium. `playwright install` was not run.
- Ports were 24561–24570 for PostgreSQL and 3561–3570 for the API, all below 32768.

Log tails:

```
unset-e2e.log:  68 passed (4.6m)  # exit status: 0
cutf8-e2e.log:  68 passed (4.6m)  # exit status: 0
unset-e2e-default-limits-chromium-en.log: 4 passed (20.1s)   unset-…-chromium-ar.log: 4 passed (19.7s)
cutf8-e2e-default-limits-chromium-en.log: 4 passed (19.8s)   cutf8-…-chromium-ar.log: 4 passed (19.7s)
  ✓ [chromium-ar] session-end.spec.ts:220 › after a session end, another browser context from the same IP can still sign in (no 429, product default limits)
*-test-node{22,24}.log:  Test Files 45 passed (45) / Tests 808 passed (808)
negative-control-HEAD.log: Tests 8 failed | 4 passed (12) / exit=1
```

**Every non-zero exit and every warning in the logs:**

- **`pnpm format:check`, exit 2 (all 4 runs).**
  - The only errors are EACCES on 12 sandbox-masked paths: `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`.
  - Each log has 0 `[warn]` lines and reports "All matched files use Prettier code style!".
  - The `--ignore-path` variant exits 0.
  - Before that, a first `format:check` flagged my two new test files. I ran Prettier on them and re-ran every check afterwards; the logs above are from after the reformat.
- **`cutf8-e2e-default-limits-chromium-ar-attempt1-invalid-port.log`, exit 3 (BLOCKED).** My own script computed an invalid PostgreSQL port (`245610`), and the harness refused it before starting anything: no cluster was created and no port was bound, so the API port 35610 was never used. I re-ran on 24569/3569 (`cutf8-e2e-default-limits-chromium-ar.log`): 4 passed, exit 0.
- **Negative-control logs, exit 1.** Expected: they show the defect on HEAD.
- **All 4 unit logs** contain one `[FSTDEP022] FastifyWarning: The router options for constraints property access is deprecated…`.
  - It comes from an API test's Fastify instance (`apps/api/**`, outside my scope) and is pre-existing.
  - There are no `stderr |` React blocks, no act() or "Cannot update a component" warnings, and no hook timeouts.
  - The F-DG2-430 React-warning guard is active for all unit-web tests, including the new file.
- **Build logs** contain Vite's "(!) Some chunks are larger than 500 kB" for `index-*.js`. This is pre-existing (already in FE8/FE9).
- **e2e logs:** the only "warning" matches are a test title ("…the 3-5 top-outcomes warning"). There are no page errors and no `---- api.log` failure tails.

## Visual evidence (2 cited screenshots)

- `docs/delivery/handbacks/DG2/T-DG2-FE10-evidence/en-session-end-in-app-link.png` shows EN (LTR) after "signed out in another tab → in-app link": the sign-in card, the alert "Your session ended. Please sign in again.", and the sign-in form. There is no shell.
- `docs/delivery/handbacks/DG2/T-DG2-FE10-evidence/ar-session-end-upload-refused.png` shows AR (RTL) after the commit-time upload refusal: «انتهت جلستك. يُرجى تسجيل الدخول مجددًا.» and the sign-in form. The dialog is closed and there is no shell.

## Known gaps / not done

- **Cross-tab notification is not implemented** (no `BroadcastChannel`). An ended session is detected on the tab's next request: a link, a window-focus `/me` refetch or a mutation. That is the behaviour the assignment asks for.
- **Idle and absolute expiry are not exercised separately end-to-end.** The server answers them with the same 401 `unauthenticated` as revocation and sign-out, which the client handles through the same rule (unit tests and e2e tests 1–3).
- **Default-limit e2e runs one project per stack.** A combined EN+AR run of this spec makes more than 20 auth requests in a minute (sign-ins plus the sign-in page's dev-login probe), which hits the product's own 20-per-minute per-IP auth bucket. The session end itself makes no auth requests, and in every run it caused no 429.
- **Pre-existing observation, outside F-DG2-480, not fixed.** When `PUT /me/preferences` is refused (403), the UI goes back to the persisted language. The notice "Language changed in this browser, but it could not be saved…" then appears in the *previous* language, so it contradicts itself.
  - It is identical on HEAD: I reproduced it with HEAD's web build (same e2e test 4, chromium-en).
  - For that reason test 4 accepts the notice in either language.
  - I suggest the orchestrator log it as a separate Low finding.

## Merge instructions

- No migrations and no API or contract changes. The patch only touches `apps/web/**`.
- `apps/web/dist` in the working tree was rebuilt from the fixed sources after the negative-control swaps (`vite build`, exit 0). A fresh `pnpm -r build` is recommended anyway before any e2e.
- No conflicts are expected. `fixtures.tsx` now imports `resetSessionStateForTests` instead of `setCsrfToken`; `setCsrfToken` is still exported for the other tests that use it.
- For the orchestrator's `import-findings --fix`: **F-DG2-480** is fixed by the single session-end rule (client phase → `RequireSession` clears the cache once and navigates once; `LoginPage` uses a fresh `/me` only). Its regression tests are `apps/web/src/auth/session-end.test.tsx` and `apps/web/e2e/session-end.spec.ts`.
