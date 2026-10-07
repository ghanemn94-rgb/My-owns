# Handback T-DG2-FE13 (frontend-ux-engineer): a session end clears session data wherever it happens, and no identity ever sees another's cache

- **Stage / task:** DG2 (FIXING), T-DG2-FE13.
  - **Finding:** F-DG2-500 (Medium, not mandatory). **Requirement:** REQ-S16-030.
- **Assignment:** `docs/delivery/assignments/DG2/round-15/T-DG2-FE13.md`, sha256 `bd4986e8f25d37d57f1038b7a2bd8287a35b185765e1dc3092bdff9ad7b9324d`. I verified it with `sha256sum` before starting.
- **Base:** `HEAD` `c44da6fa81590b5d51261afcf3536acfda47bb2e` on `claude/mobily-transformation-platform-regate`. Nothing is committed; the orchestrator integrates and records `import-findings --fix`.
- **Invocation:** `DG2-T-DG2-FE13-frontend-ux-engineer-20261007T121134Z-0f98e5c4` (session `0f98e5c4-0324-4ad1-9354-4593554c052c`).
- **Evidence directory:** `docs/delivery/handbacks/DG2/T-DG2-FE13-evidence/`. It holds logs, axe summaries and 2 cited screenshots.
- I am an engineering agent. Nothing here grants a business, Finance or IT approval. All test data is SYNTHETIC.

## 1. The fix (F-DG2-500)

### Root cause

- **Before:** the session-end *transition* lived in the API client (`endSession`, FE10). The *cache clearing* lived in `<RequireSession>`, through `claimSessionEnd()` plus `removeQueries()`, so it ran only while that component was mounted.
- **The sign-in page** is outside `<RequireSession>`. A 401 on its `/me` re-probe ended the session and cleared nothing.
- **Then** the next successful `/me` made the phase `active` again. The end was never claimed, and the next identity rendered the previous user's cached queries.

### 1. Clearing happens where the session ends (structural)

- `apps/web/src/api/client.ts`
  - `registerSessionReset(hook)` registers module-level reset hooks.
  - `endSession()` (a 401 `unauthenticated` while the phase is `active`) now does three things, in this order:
    1. it drops the CSRF token;
    2. it runs every registered hook **synchronously**, with reason `"ended"`;
    3. only then does it set the phase to `"ended"` and notify subscribers.
  - Clearing happens inside the request that observed the 401, before the error is thrown to any caller and before any component can render. It doesn't depend on any component or route. The sign-in page, `<RequireSession>`, a dialog, or nothing mounted at all: the result is the same.
  - `claimSessionEnd()` and its flag are removed. Nothing needs to "claim" an end any more.
- `apps/web/src/app/App.tsx`
  - `createQueryClient()` registers `resetSessionCache(queryClient, reason)` **when it creates the client**. That's the one place every app `QueryClient` comes from, in production and in tests (`renderApp`).
  - `resetSessionCache` does `cancelQueries` + `removeQueries` + `getMutationCache().clear()`.
  - For `"ended"` it removes **every** query, including the cached identity (`["me"]`).
- `apps/web/src/auth/session.tsx`: `<RequireSession>` now only navigates once to the session-ended sign-in page. It no longer clears anything itself.

### 2. Defence in depth on identity change

- `client.ts` `sessionIdentityKey(me)` is the organization id, the user id and the CSRF token.
  - The CSRF token stands in for the **session subject**. The API derives it from the session token (`apps/api/src/modules/identity/sessions.ts` `csrfTokenFor(sessionToken)`), so a different session always has a different token.
  - `/me` exposes no session id, and `packages/shared` and `apps/api` are outside my scope, so this was the only session-level discriminator available. Like the token itself, it is kept only in memory.
- `client.ts` `noteSessionIdentity(key)` remembers the last identity this document saw. If a new `/me` answer has a different key, it runs the hooks with reason `"identity-changed"`.
  - That removes every query **except** `["me"]`, whose new value is being stored right now.
- `queries.ts` `fetchMe()` calls `noteSessionIdentity` **before** it returns the answer. The answer is stored afterwards, so nothing can render under the new identity while the old identity's queries are still cached.
  - Every `/me` path goes through `fetchMe`: `<RequireSession>`, the sign-in page, refocus re-probes, and `LanguageSwitch`'s 409 re-read.
  - So every path is covered: dev sign-in, IdP sign-in in another tab, Back/Forward, refocus.
- `<RequireSession>` keys its subtree by **person** (`organizationId:userId`).
  - If a different person signs in, the shell and page are remounted, and no component state survives: a draft form, an open dialog, a typed filter.
  - A new session of the **same** person still purges and refetches every query, but keeps their own unsaved input. Example: they signed in again in another tab, which the existing 403 e2e test does.
  - Remounting on every session change would discard a user's own typing, plus FE11's "language not saved" notice, for no confidentiality gain. That's a judgement call; see §6.

### 3. Sign-out here (unchanged guarantees)

- `Shell.signOut` is unchanged: `markSignedOut()` (phase `unknown`, CSRF dropped), `cancelQueries`, `queryClient.clear()`, then one navigation.
- FE10's guarantees still hold, and the existing `session-end.test.tsx` (12 tests) and `session-end.spec.ts` (8 e2e) pass unchanged:
  - one landing on the sign-in page;
  - at most 2 `/me` (unit) or 3 (e2e) after the end;
  - no stale shell;
  - a 403 is never an end.

## 2. Sweep: every cache that can hold session data

| # | Cache | What it holds | On a session end (401 while active) | On an identity change (`/me` returns another user or session) | On sign-out here |
|---|---|---|---|---|---|
| 1 | React Query **query** cache (`QueryClient`) | Every server record: transformations, users (`users`, `users-all`), assignments, audit, P2 records, `["me"]` (identity, permission hints) | **All removed** synchronously in `endSession` via the registered hook (cancel + remove). Any page, including the sign-in page. | All removed **except** `["me"]`, before the new `/me` value is stored (`fetchMe` → `noteSessionIdentity`) | `queryClient.clear()` (unchanged) |
| 2 | React Query **mutation** cache | Variables of in-flight or finished mutations (submitted form values) | Cleared (`getMutationCache().clear()`) | Cleared | Cleared (`clear()`) |
| 3 | `client.ts` `csrfToken` (module singleton) | The session's CSRF token | Set to `null` in `endSession` | Replaced by the new `/me` value (`setCsrfToken`) | `null` (`markSignedOut`) |
| 4 | `client.ts` `sessionPhase` (module) | `unknown`, `active` or `ended` | `ended` (after the cache is cleared) | `active` | `unknown` |
| 5 | `client.ts` `lastIdentity` (module, new) | org, user and CSRF of the last `/me` | Kept, so a different next identity triggers the identity-change purge as well (a second, harmless purge) | Updated | Kept (same reasoning) |
| 6 | Component state: draft forms, dialogs, typed filters, pagination | Unsaved user input | `<RequireSession>` returns `null` while ended, which unmounts the whole signed-in tree | Remounted when the **person** changes (keyed subtree). The same person on a new session keeps their own input (§1.2). | The shell unmounts on navigation to `/login` |
| 7 | `localStorage` `mth.locale` (i18n) | The UI language choice (`ar`/`en`): the pre-sign-in hint | **Kept on purpose**: a UI preference, not session data, and it is what the sign-in page uses. After sign-in the new user's persisted `preferredLocale` wins (`<RequireSession>`, REQ-S15-007). | Same | Same |
| 8 | `localStorage` DataTable column visibility (one key per table id) | Which columns are shown | **Kept on purpose**: a per-browser display preference with no record data in it | Same | Same |
| 9 | `sessionStorage`, IndexedDB, Cache Storage, service worker | — | **Not used** (grep for `sessionStorage`, `indexedDB` and `caches.` in `apps/web/src`: no hits) | — | — |
| 10 | Other module-level singletons in `apps/web/src` | Module-level `let`/`Map`/`Set` (grep) are only constant sets (`STRUCTURAL`, `FREE_TEXT_KINDS`, `DEFAULT_SORT`) plus 1–5 above. There is no people or user cache outside React Query. | — | — | — |
| 11 | Session cookie | HttpOnly, server-owned; the browser code never sees it | Server-side (revocation or expiry) | Server-side | `POST /auth/logout` |

## 3. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/api/client.ts` | `registerSessionReset`; `endSession` clears through the hooks before announcing `ended`; `sessionIdentityKey`, `noteSessionIdentity`, `getLastSessionIdentity`; `claimSessionEnd` removed; `resetSessionStateForTests` also resets `lastIdentity` and the hooks. |
| `apps/web/src/api/queries.ts` | `fetchMe` checks the identity before the answer is stored. |
| `apps/web/src/app/App.tsx` | `resetSessionCache(queryClient, reason)`, registered in `createQueryClient()`. |
| `apps/web/src/auth/session.tsx` | `<RequireSession>` only navigates on an end; the signed-in subtree is keyed by person. |
| `apps/web/src/auth/session-identity.test.tsx` (new) | 18 tests (§4). |
| `apps/web/e2e/session-end.spec.ts` | +1 real-stack test (en and ar): the session ends while the sign-in page is shown, and B never sees A's record. |
| `docs/delivery/handbacks/DG2/T-DG2-FE13-*` | This handback, the logs, the axe summaries and 2 screenshots. |

- I did not touch `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- I changed no i18n strings.

## 4. Tests

### Unit and component tests: `apps/web/src/auth/session-identity.test.tsx` (18 tests; jsdom, the product's fixtures, SYNTHETIC)

**Each of the following runs in en (LTR) and ar (RTL):**

1. **W5:** A sees `TR-A-SECRET` on `/transformations`. A's session ends, and history goes Back to the earlier in-document `/login` entry. The sign-in page's `/me` gets a 401.
   - The phase is `ended`, no query holds data, `["me"]` holds no identity, and there are at most 2 `/me` requests.
   - B signs in with the development form. B's list request is **held**.
   - B's name renders and `TR-A-SECRET` is never in the DOM, including during the held window. After release, B's empty state shows.
2. **W5b (OIDC mode, dev sign-in 404):** the same, but B arrives through a `/me` re-probe (`invalidateQueries(me)`, as on window refocus). B never sees A's row.
3. **Identity change via a refocus `/me` with no 401 in this tab:** A types into the list search, then `/me` returns B (another user and session).
   - At B's first render and 100 ms later, A's row is absent (`[false, false]`).
   - The list query holds no data, the phase stays `active`, and A's typed draft is gone (subtree remounted).
4. **A new session of the same person:** the list query is removed and refetched, and the person's own typed draft is kept.
5. **The same identity re-probed:** exactly 1 `/me`, the cache and the page state are kept (no false purge).
6. **Sign-out here:** lands on `/login?signedOut=1`, the phase is `unknown`, no query holds data, and there is at most 1 `/me`. B then signs in and never sees A's row.
7. **A 403** (forbidden) on a GET and on a mutation: no reset hook runs, the phase stays `active`, `/transformations` and A's row stay, and the cached identity is kept.

**Plus 4 client-level tests with no React tree mounted:**

- a 401 `unauthenticated` while active runs the reset **once** and **before** the phase is announced (`reset:ended:phase=active`), and the client's cache is empty;
- a 401 with no session yet, a `silent401` logout and a 401 `auth.login_failed` clear nothing;
- `/me` with the same identity, a new session of the same user, then another user: 0, 1, then 2 `identity-changed` purges. Other queries are removed; `["me"]` holds the new value;
- `noteSessionIdentity`: the first identity of a document is not a change.

### The reviewer's probe

I copied `docs/delivery/test-evidence/DG2/code-security/round-14/probes/zz-sec-r14-web-probe.test.tsx` into `apps/web/src/auth/`, ran it against the fixed tree, and removed it again. It is not in the candidate.

- **Result:** 26/26 passed.
- **W5:** `phase after A's end on /login=ended; transformations queries cached=0; B sees A's row=false`.
- **W5b:** `B sees A's row=false`.
- **W4:** 4 requests in 2 s.
- **W6:** 1 request after 3 Back presses, and no shell.
- This was a development run whose output went to my terminal; no log was kept. The reviewer's W5/W5b are re-expressed in the product test above and run in the matrix.

### e2e, real stack, en and ar: `session-end.spec.ts` › "a session end on the sign-in page: the next user to sign in in the tab never sees the previous user's records"

- **User A** is `dev.office` (organization-wide Transformation Office). A creates `Synthetic A-only FE13 <LANG> <id>` in **Synthetic Finance**. The API first confirms that `dev.lead` cannot list it.
- **A signs in in the browser** through the sign-in page's wordmark link, which pushes an in-document `/login` entry. A opens Transformations and sees the record.
- **A's session ends elsewhere** (`POST /auth/logout` with the browser's cookie).
- **`history.go(-2)`** returns to `/login?returnTo=%2Ftransformations`. It's the same document, which the test asserts with a window marker. The sign-in page's `/me` notices the end.
- **A MutationObserver** records any moment the record's name is in `document.body`.
- **B** (`dev.lead`, Synthetic Retail only) signs in with the form in the same tab. B's list requests are held for 1.5 s with `page.route`, then the test waits 2.5 s.
- **Assertions:**
  - same document, observer hits `[]`, the record name count is 0;
  - B's name is shown and A's is not;
  - axe shows 0 serious or critical;
  - no page errors and no foreign requests.

### Negative controls: the new tests fail on `HEAD`

- **Unit:** `negative-control-HEAD-unit.log`. Disposable clone of `HEAD` `c44da6f` plus the final test file only. **14 failed / 4 passed (18)**, exit 1.
  - **Behavioural failures:**
    - W5 and W5b: `expected [ '["me"]', …(2) ] to deeply equal []`, meaning A's queries are still cached after the end on `/login`;
    - the identity change: `expected [ true, true ] to deeply equal [ false, false ]`, meaning **B sees A's row**;
    - the same-person new session: the stale query is not replaced.
  - **API absent on `HEAD`:** the 403 test and the 4 client tests fail with `registerSessionReset is not a function`. They are regression guards for the new API.
  - **Passing on `HEAD`, as expected:** "sign-out here" and "same identity re-probed", in en and ar, are regression guards. Sign-out already cleared on `HEAD`.
- **e2e:** `negative-control-HEAD-e2e.log`. Clone of `HEAD`, built, plus the new `session-end.spec.ts`, filtered with `-g` to the new test. **2 failed (chromium-en, chromium-ar)**, exit 1.
  - The observer recorded A's record in B's document: `+ Array [ "/transformations", … ]`. That is the defect on the real stack.

## 5. Checks actually run

- Every check ran in both locale settings, through one script in my run's `$TMPDIR` (`run-checks.sh`, not kept):
  - `env -u LANG -u LC_ALL` (log prefix `unset-`);
  - `env LANG=C.UTF-8 LC_ALL=C.UTF-8` (log prefix `cutf8-`).
- Each log starts with its exact command, Node version and start time, and ends with `# exit status: N`.
- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`, Node 22.22.2 at `/opt/node22/bin`.

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` (Node 24) | exit 0 | exit 0 |
| `pnpm -r build` (Node 24) | exit 0 | exit 0 |
| `pnpm lint` (Node 24) | exit 0 | exit 0 |
| `pnpm format:check` (Node 24) | **exit 2**, see below. Prettier: "All matched files use Prettier code style!" | **exit 2**, same |
| `npx prettier --check . --ignore-path .prettierignore --ignore-path .gitignore --ignore-path $TMPDIR/masked.ignore` | exit 0, "All matched files use Prettier code style!" | exit 0, same |
| `pnpm test`, Node 24.21.0 | 48 files, **866 passed**, exit 0 | 48 files, 866 passed, exit 0 |
| `pnpm test`, Node 22.22.2 | 48 files, **866 passed**, exit 0 | 48 files, 866 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0, "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e: `journeys` + `p2-journeys` + `p2-blank-text` + `session-end`, chromium-en + chromium-ar, `--workers=1` | **70 passed (5.1m)**, exit 0 | **70 passed (5.2m)**, exit 0 |
| axe: 8 summary files per mode (copied to `axe/<mode>/<lang>/`) | 266 scans, **0 violations of any impact**, so 0 serious and 0 critical. Includes `en/fe13-user-b-never-sees-a` and `ar/fe13-user-b-never-sees-a`. | same: 266 scans, 0 violations |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

- **Unit count:** 866 = FE12's 848 + my 18 new tests. 48 files = 47 + the new file.
- **e2e count:** 70 = 68 + my new test × 2 projects.

**e2e command** (repository root, Node 24; ports 24593/3593 for unset and 24594/3594 for C.UTF-8, all below 32768; pre-installed Chromium; `playwright install` was not run):

```
env <locale env> E2E_PG_PORT=2459x E2E_API_PORT=359x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> \
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts \
  apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/session-end.spec.ts --project=chromium-en --project=chromium-ar --workers=1
```

Log tails:

```
unset-e2e.log:   70 passed (5.1m)   # exit status: 0
cutf8-e2e.log:   70 passed (5.2m)   # exit status: 0
*-test-node{22,24}.log:   Test Files  48 passed (48) / Tests  866 passed (866)   # exit status: 0
*-contrast.log:  PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented   # exit status: 0
*-validate-DG1.log:  PASS gate DG1 (historical)   # exit status: 0
```

### Every non-zero exit, failed suite and warning

- **`pnpm format:check`, exit 2 in both modes** (`unset-format-check.log`, `cutf8-format-check.log`).
  - The only errors are 12 `EACCES` "Unable to read file" lines for paths this agent sandbox masks: `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`.
  - Prettier reports "All matched files use Prettier code style!".
  - The `--ignore-path` variant, which adds only those 12 paths, exits 0 in both modes.
  - None of the 12 are mine.
- **Negative-control logs, exit 1.** Expected: they show the defect on `HEAD` (§4).
- **All 4 unit logs** contain one `[FSTDEP022] FastifyWarning: … router options … deprecated`.
  - It comes from an API test's Fastify instance (`apps/api/**`, outside my scope) and is pre-existing (FE10–FE12 report it too).
  - It is the only line matching `Warning: |act\(|Cannot update a component|stderr \||Hook timed out`: there are **0 React warnings**, 0 `stderr |` blocks and 0 hook timeouts.
- **Build logs** contain Vite's "(!) Some chunks are larger than 500 kB" (one per build). This is pre-existing.
- **e2e logs** contain 3 `npm warn Unknown project config …` lines, from `npx` reading the pnpm `.npmrc` (pre-existing harness noise).
  - The only other "warning" match is a test title ("…the 3-5 top-outcomes warning").
  - There are 0 failed and 0 flaky tests.
- **Failed attempts during development** (not in the matrix):
  - **The first cache assertion** in my W5 test expected no `["me"]` entry at all. After the end, the sign-in page's own mounted `/me` observer re-creates an **empty** `["me"]` query (no data, no identity; it re-probes once, still within the 2-`/me` bound). The assertion now checks that no query **holds data** and that `["me"]` holds no identity.
  - **My first 403 test** awaited a rejecting `apiRequest` inside `act()`. This left React's act scope open and made every following test in the file time out. That was a test bug; the requests now run outside `act`.
  - Both were fixed in the test, not the product.
- **Harness directories:** the Claude Code harness created empty `.claude/.cc-writes` directories in `apps/web/` and in my evidence directory. I removed both with `rmdir`. Others in reviewers' evidence directories are not mine and I left them alone.

## 6. Visual evidence (2 cited screenshots, from the `unset` e2e run of the new test)

- `docs/delivery/handbacks/DG2/T-DG2-FE13-evidence/en-user-a-sees-record.png`: chromium-en, user A ("Synthetic Transformation Office").
  - The Transformations list shows **TR-0007 "Synthetic A-only FE13 EN …", Synthetic Finance SYN-FIN**, A's record, above Retail records.
- `docs/delivery/handbacks/DG2/T-DG2-FE13-evidence/ar-user-b-never-sees-a.png`: chromium-ar (RTL), user B ("Synthetic Transformation Lead") in the same tab after A's session ended on the sign-in page.
  - The list shows only **Synthetic Retail** rows (TR-0013 … TR-0002). There is no Finance record, and A's name isn't in the header.
  - The status chips keep their text labels ("مسودة – لم تُقدَّم").

## 7. Known gaps / judgement calls

- **"Session subject" is the CSRF token.** `/me` exposes no session id, and adding one needs `packages/shared` and `apps/api`, which are out of scope. The CSRF token is a deterministic function of the session token, so it is an exact session discriminator. If the API ever rotates the CSRF token within one session, the client would treat that as a session change: one extra purge and refetch, never a leak. A dedicated `/me` session id would be cleaner; that's a possible follow-up for the API owner.
- **Draft state on a new session of the same person is kept.** Queries are purged and refetched, but the subtree is remounted only when the **person** changes. If reviewers want drafts dropped on any session change too, the key in `session.tsx` becomes `sessionIdentityKey(me)` (one line). That would also drop FE11's "language not saved" notice in the existing 403 e2e scenario.
- **On a session end while the sign-in page is shown**, removing `["me"]` makes that page's mounted observer re-probe `/me` once more (a 401, no data). The total stays within FE10's bounds: ≤ 2 `/me` in unit tests and ≤ 3 in e2e, both asserted.
- **`localStorage` keeps the language choice and table column preferences** across identities on purpose (sweep #7, #8). They hold no record data.
- **The e2e test uses `history.go(-2)`** to return to the earlier in-document `/login` entry. That is equivalent to choosing it from the Back button's history list. Two `goBack()` calls would pass through `/my-work`, whose 401 would end the session under `<RequireSession>`, the path FE10 already covered.
- The reviewer's W5b in a real browser (an IdP sign-in in another tab) is not reproduced in e2e: the stack runs `AUTH_MODE=dev` and has no IdP. It is covered by the unit test (§4, test 2) and by the identity-change purge.

## 8. Merge instructions

- No migrations and no API or contract changes. Only `apps/web/**` is touched, plus this handback and its evidence.
- `claimSessionEnd` is removed from `apps/web/src/api/client.ts`. Nothing else in the repository imported it (grep).
- `registerSessionReset` hooks are module state. `resetSessionStateForTests()` (called by `renderApp`) clears them, so tests stay isolated.
