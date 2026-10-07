# Handback T-DG2-FE14 (frontend-ux-engineer): nothing fetched or written under one identity lands after the tab moves to another

- **Stage:** P2 / DG2 (FIXING).
- **Finding:** F-DG2-530 (Low, not mandatory, REQ-S16-030), plus the related observation X6 (SEC-R15-19).
- **Invocation:** `DG2-T-DG2-FE14-frontend-ux-engineer-20261007T142650Z-4a472ab4`, session `4a472ab4-d7df-4dda-b10c-6194ff7c7e89`.
- **Base:** `HEAD` `7905e8b`, branch `claude/mobily-transformation-platform-regate`. At start the working tree held only the sandbox-masked dotfiles (untracked) and no tracked changes.
- **Assignment:** `docs/delivery/assignments/DG2/round-16/T-DG2-FE14.md` (sha256 `30ffbb95…f2fc`, verified).
- **Nothing committed.** The orchestrator integrates the change and records `import-findings --fix`. I close no finding.
- **Data:** every user, record and session in tests and e2e is SYNTHETIC.
- **Out-of-scope paths not touched:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews, gate records.

## 1. The fix

### 1.1 Session generation in the API client (`apps/web/src/api/client.ts`)

- **The counter.**
  - Module state `sessionGeneration` moves **before the reset hooks run** on:
    - every session end (`endSession`, a 401 `unauthenticated` while active);
    - every sign-out here (`markSignedOut`);
    - every identity change (`noteSessionIdentity` with another user **or** another session, as FE13 defines it).
  - A same-identity re-probe does not move it.
- **What `apiRequest` does with it.**
  - It records the generation when the request is **sent**.
  - When the answer arrives under a later generation, it throws the new typed **`SessionChangedError`** and never returns the data. This covers:
    - a success (2xx);
    - an HTTP failure, a 401 included;
    - a network failure;
    - a body-read failure.
  - It logs nothing: there is no `console.*` call anywhere in this path.
- **One chokepoint covers everything.**
  - `apiRequest` holds the app's only `fetch(` call (grep: `api/client.ts:278`). `api.get`, `api.send` and `fetchMe` all go through it.
  - So no caller can receive, cache, navigate on or render an answer that belongs to a previous identity. This holds for every `setQueryData` path at once, with no per-page cache guard.
- **Side effect: a stale 401 can't end a live session.** A **401 for a request sent under the previous identity** no longer ends the session of the identity that replaced it. `endSession` is not reached. This closes a latent variant of the same race. Test: "a 401 for a request sent under the previous identity never ends…".
- `shouldRetry` never retries a `SessionChangedError`.

### 1.2 Callers treat it as silent: no banner, no navigation

- **Display components.**
  - `ErrorState` renders nothing for it.
  - `QueryState` shows Loading and probes the query again **once per such failure**, bounded by `errorUpdatedAt`. Its refetch is sent under the current generation. It never shows a Stale banner for it.
  - `RequireSession` does the same for GET `/me`.
- **Every catch that stores or shows an error** returns early on `isSessionChangedError`. Where needed, it first clears the busy state, so a kept draft (same person, new session) stays usable. Line numbers are in §2.
- **Conflict re-loads.**
  - The 409 path re-loads the latest record with a GET (TransformationEditPage, useVersionedSave, RecordForm, DefinePage).
  - If that GET answers `SessionChangedError`, it returns silently. It doesn't open a conflict panel with "latest: none".
- **`useVersionedSave`** returns `outcome: "session-changed"`. Callers act only on `"saved"`, `"error"` and `"conflict"`, so nothing is shown.
- **`LanguageSwitch`.**
  - On a 409, the retry re-reads `/me`. If that `/me` is another identity or session, A's language choice is **not** written for B: there is no second PUT.
  - This is the one place where a write would otherwise have been *issued* (not just answered) across the identity change.

### 1.3 X6: `/me` first on refocus and reconnect (`apps/web/src/app/App.tsx`)

- **TanStack's own triggers are off.** `QUERY_DEFAULTS` (exported for tests) sets `refetchOnWindowFocus: false` and `refetchOnReconnect: false`.
- **`revalidateSessionFirst(queryClient)` replaces them.** `<AppProviders>` subscribes it to `focusManager` and `onlineManager` (unsubscribed on unmount). It works in three steps:
  1. **Nothing happens unless something is due.** "Due" means `/me` or an active page query is stale by TanStack's own rule: an enabled observer's `staleTime`, with `isStaleByTime`. An observer's cached `isStale` result is only recomputed on its next update, so it isn't used.
  2. **`/me` is refetched first**, with `refetchQueries(..., { cancelRefetch: false })`. That joins a `/me` already in flight and never restarts it. If `/me` returns another identity, FE13's reset and the generation move happen inside `fetchMe`, before anything renders.
  3. **Page data comes last.** Only if the phase is still `active` and `/me` really answered (`dataUpdateCount` advanced) are the due page queries refetched. On a network or 5xx failure of `/me`, or on a session end, no page data is fetched.
- **Bounded.**
  - Concurrent focus or reconnect events share one run (a `WeakMap` per client), so there is at most **one `/me` per event burst**.
  - If nothing is stale, no request is sent at all.
  - Test: three focus events plus a reconnect send exactly one `/me`, and it goes first. A refocus with all queries fresh sends 0 requests.

### 1.4 FE10/FE13 guarantees kept

All the existing suites still pass: `session-end.test.tsx`, `session-identity.test.tsx` (EN and AR) and the e2e `session-end.spec.ts`. My tests also check:

- **One navigation on a session end.** X3b: A's late answer causes no second navigation. The ended-on-refocus test checks the single `/login?…&error=session_expired`.
- **Bounded `/me`.** See §1.3.
- **No stale shell.** `RequireSession` is unchanged for `ended`.
- **A 403 is never an end.** The reviewer's X7 passes, and so do the existing 403 tests.
- **`returnTo` is safe.** `safeReturnTo` is untouched.
- **Same person, new session.** Drafts are kept and queries are purged. The new test also shows that the dropped in-flight save leaves no banner and doesn't navigate. The form is usable again, and the next save goes out with the **new** CSRF token.

## 2. Sweep (grep, final tree)

**`setQueryData` paths.** Every one receives data only from `api.send`, `api.get` or `fetchMe`, so only through `apiRequest`'s generation check:

| Path | Data source | Covered by |
|---|---|---|
| `pages/transformations/TransformationEditPage.tsx:130` (save) | `api.send` PATCH | client check; test X3 (en/ar), the same-person test, the sanity test |
| `pages/transformations/TransformationEditPage.tsx:141` (409 conflict re-load) | `api.get` | client check plus silent catch `:143` |
| `pages/transformations/TransformationDetailPage.tsx:143` (archive) | `api.send` POST archive | client check; ReasonDialog silent `:57`; archive test (en/ar) |
| `pages/admin/OrganizationsPage.tsx:256` (org edit, `onSaved`) | `useVersionedSave` → `api.send` | client check; useVersionedSave `:53/:59`; organization test (en/ar) |
| `pages/admin/OrganizationsPage.tsx:574` (business-unit edit, `onSaved`) | `useVersionedSave` → `api.send` | the same mechanism as `:256` |
| `pages/admin/UsersPage.tsx:388` (user edit, `onSaved`) | `useVersionedSave` → `api.send` | client check; user test (en/ar) |
| `components/LanguageSwitch.tsx:57` (preferences) | `api.send` PUT | client check |
| `components/LanguageSwitch.tsx:61` (409 → fresh `/me`) | `fetchMe` (the current identity, by construction) | identity guard `:63`; language test (en/ar) |

- **Other APIs:** no `setQueriesData`, `ensureQueryData`, `fetchQuery`, `XMLHttpRequest`, `EventSource` or `WebSocket` exists in `apps/web/src` outside tests.
- **Silent catches added** (`isSessionChangedError` early return):
  - **Components:**
    - `ReasonDialog.tsx:57` (clears busy);
    - `RowActions.tsx:132`;
    - `RecordForm.tsx:322` and `:339`;
    - `useVersionedSave.ts:53` and `:59`;
    - `LanguageSwitch.tsx:79`;
    - `States.tsx:38` and `:193`.
  - **Session gate:** `auth/session.tsx:72`.
  - **Pages:**
    - `OrganizationsPage.tsx:161` and `:478`;
    - `UsersPage.tsx:296`;
    - `AssignmentsPage.tsx:438`;
    - `TransformationEditPage.tsx:136` and `:143`;
    - `TransformationCreatePage.tsx:203`;
    - `LoginPage.tsx:139` (clears busy);
    - `WorkshopsSection.tsx:203`;
    - `JourneysSection.tsx:590`;
    - `GateDetailPage.tsx:461` and `:564`;
    - `DefinePage.tsx:178`, `:183` and `:1037`;
    - `EvidencePage.tsx:392` and `:530`.
- **Catches that rethrow into a silent catch:**
  - `RowActions.tsx:42` (archive) and `AssignmentsPage.tsx:217` (revoke) rethrow into `ReasonDialog`.
  - The archive handler `TransformationDetailPage.tsx:147` does the same.
- **Success navigations after an `await`:**
  - `TransformationEditPage.tsx:119/133`, `TransformationCreatePage.tsx:201`, `OrganizationsPage.tsx:159`, `UsersPage.tsx:294` and `LoginPage.tsx:136`.
  - Each runs only after its `api.send` or `apiRequest` resolved, which a stale answer never does.

## 3. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/api/client.ts` | `SessionChangedError` and `isSessionChangedError`; the session generation (moves on end, sign-out and identity change, before the reset hooks); `apiRequest` checks it on every outcome; an old 401 never ends a new session; `getSessionGeneration` (tests and diagnostics) |
| `apps/web/src/api/queries.ts` | `shouldRetry`: never retry `SessionChangedError` |
| `apps/web/src/app/App.tsx` | `QUERY_DEFAULTS` (TanStack focus and reconnect refetch off); `revalidateSessionFirst` and `subscribeSessionFirstRefetch` (`/me` first, bounded); wired in `<AppProviders>` |
| `apps/web/src/auth/session.tsx` | `/me` that lost the generation race: Loading and one re-probe, never an error page |
| `apps/web/src/components/States.tsx` | `ErrorState` silent; `QueryState` shows Loading, re-probes once and shows no Stale banner for `SessionChangedError` |
| `apps/web/src/components/useVersionedSave.ts` | `outcome: "session-changed"`; silent conflict re-load |
| `apps/web/src/components/LanguageSwitch.tsx` | silent; the 409 retry is never written for another identity or session |
| `apps/web/src/components/ReasonDialog.tsx`, `RecordForm.tsx`, `RowActions.tsx` | silent catches |
| `apps/web/src/pages/**` (12 files, §2) | silent catches |
| `apps/web/src/auth/session-generation.test.tsx` (new, 569 lines, sha256 `2e2cbcb88f48d74c…`) | 26 tests (§4) |
| `docs/delivery/handbacks/DG2/T-DG2-FE14-evidence/**` | logs, axe summaries, two screenshots |
| this file | handback |

- Diff size: 21 tracked files changed, +216/−34, plus the new test file.
- No migration, no API change, no new dependency.

## 4. Tests

### 4.1 New tests

`apps/web/src/auth/session-generation.test.tsx`: unit-web, jsdom, scripted API, SYNTHETIC users A and B, each with another user id **and** another CSRF token (session). The first ten run once in EN and once in AR:

- **X3 (the reviewer's scenario).**
  - A's PATCH is in flight; B's `/me` arrives; then the PATCH answers 200.
  - Checks: the cache has no record; A-PATCHED-SECRET is not on screen; B is not navigated (the path stays `/edit`).
  - After B's own GET answers 404, nothing of A's is shown. `console.error` is never called.
- **X3b.** The same after a session **end** here and B's sign-in.
  - The cache stays empty right after the late answer, not only after B's `/me`. **That half fails on `HEAD`.**
  - There is one navigation only.
- **Archive in flight across an identity change.** A's archived record never lands in B's cache or screen, and no dialog reappears.
- **Organization save in flight** (B's GET is held, so the cache is what B sees). A's change is never shown or stored, and there is no "Saved." banner.
- **User save in flight.** The same checks as the organization test.
- **Same person, new session.** The in-flight save is dropped silently. The draft is kept, no `role=alert` appears, there is no navigation and Save is enabled again. Saving again lands, with the new session's CSRF token.
- **Language save after a 409** with B signed in meanwhile: there is no second PUT.
- **Sanity.** An in-flight write that finishes under the **same** identity, with a same-identity `/me` re-probe in between, still sets the cache and navigates to the detail page. **It passes on `HEAD` too, as intended.**
- **X6: the header and the data agree.**
  - B signs in elsewhere, and the tab refocuses within `/me`'s 60 s staleTime, with page queries 20 s old (production defaults).
  - While `/me` is held, the only request sent is `GET /api/v1/me`, and no page query goes out with the new cookie.
  - After it answers, the header shows B with B's rows. Neither A's name nor A's row is shown. There is exactly one `/me`.
- **Refocus bounds.**
  - All fresh: 0 requests.
  - Stale: 3 focus events plus a reconnect send **one** `/me`, it goes first, and then the page queries follow.
- **Refocus whose `/me` finds the session ended.** The tab navigates once to `/login?…error=session_expired`, and no transformation request is sent.

Client unit tests (run once):

- An answer after an identity change is a `SessionChangedError`, with no `console.error`.
- An answer after a session end, and one after a sign-out here, are `SessionChangedError`s. A request answered before the end still returns data.
- An old request's 401 doesn't end B: the phase stays `active`, and the only reset was `identity-changed`.
- An old request's network failure is a `SessionChangedError`, not a `NetworkError`.

### 4.2 Negative control on `HEAD`

Log: `negative-control-HEAD-unit.log`.

- **Setup.** The 21 changed source files were replaced by `git show HEAD:<file>` and the new test file was kept. The reviewer's probe was copied in temporarily, then removed.
- **Result:** **25 failed, 7 passed**, exit 1.
- **What passed:** the two sanity tests (expected) and the reviewer's X2, X3b, X4, X6 (an observation) and X7, which already passed on `HEAD`.
- **What failed:** every other new test, and the reviewer's X3, with real assertions:
  - `expected 'A-PATCHED-SECRET' to be undefined`;
  - `'A-ARCHIVED-SECRET'`;
  - the org and user inputs still holding A's value;
  - `expected [ 'GET /api/v1/transformations' ] to deeply equal [ 'GET /api/v1/me' ]`;
  - `promise resolved … instead of rejecting`.
- **Missing exports.** The client tests also fail on `HEAD` because `SessionChangedError` and `getSessionGeneration` don't exist there.
- **Language guard.** I removed only that guard and re-ran: the language test failed in EN and AR (2 failed). Then I restored the guard.

### 4.3 The reviewer's probe on the fix

Log: `reviewer-probe-on-fix.log` (probe copied in temporarily, then removed). Result: **6/6 passed**, exit 0.

- **X3:** `header B=true; cache[...].name=undefined; B sees A-PATCHED-SECRET=false`, and after B's 404 `B still sees …=false`.
- **X6:** the first request on refocus is `GET /api/v1/me`; `header A=false; B's row shown=true; A's row shown=false`.
  - The probe itself forces `refetchOnWindowFocus: true`, so TanStack's own trigger runs too and some page GETs are duplicated. Production defaults turn that trigger off (my X6 test).

## 5. Checks actually run

- **Script.** All checks ran through one script in my run's `$TMPDIR` (`run-checks.sh`, not kept), in two locale modes:
  - `env -u LANG -u LC_ALL`, logs prefixed `unset-`;
  - `env LANG=C.UTF-8 LC_ALL=C.UTF-8`, logs prefixed `cutf8-`.
- **Logs.** Each starts with its exact command, the locale mode, the Node version and the start time, and ends with `# exit status: N`.
- **Node.** 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 is at `/opt/node22/bin`.
- **Run times.** The final run was the unset mode from 15:0x UTC (e2e started 15:03:28Z), then C.UTF-8 (e2e started 15:11:10Z). Nothing else ran alongside it (see §6).

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` (Node 24) | exit 0 | exit 0 |
| `pnpm -r build` (Node 24) | exit 0 | exit 0 |
| `pnpm lint` (Node 24) | exit 0 | exit 0 |
| `pnpm format:check` (Node 24) | exit 0 | exit 0 |
| `npx prettier --check . --ignore-path .prettierignore --ignore-path .gitignore --ignore-path $TMPDIR/masked.ignore` | exit 0 | exit 0 |
| `pnpm test`, Node 24.21.0 | 49 files, **892 passed**, exit 0 | 49 files, 892 passed, exit 0 |
| `pnpm test`, Node 22.22.2 | 49 files, **892 passed**, exit 0 | 49 files, 892 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0: "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e: `journeys` + `p2-journeys` + `p2-blank-text` + `session-end`, chromium-en and chromium-ar, `--workers=1` | **70 passed (4.8m)**, exit 0 | **70 passed (4.9m)**, exit 0 |
| axe: 8 summary files per mode (`axe/<mode>/<lang>/`) | 266 scans, **0 violations of any impact** (so 0 serious and 0 critical) | 266 scans, 0 violations |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

- **Unit count:** 892 = FE13's 866 + my 26. 49 files = 48 + 1.
- **e2e command** (repository root, Node 24; ports 24611/3611 and 24612/3612; pre-installed Chromium; `playwright install` was not run):

```
env <locale env> E2E_PG_PORT=2461x E2E_API_PORT=361x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> \
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts \
  apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/session-end.spec.ts --project=chromium-en --project=chromium-ar --workers=1
```

- **Screenshots** (the only two cited). Both come from this run's C.UTF-8 e2e (`session-end.spec.ts`, FE13's "B never sees A" journey on the real stack, with the FE14 build):
  - `docs/delivery/handbacks/DG2/T-DG2-FE14-evidence/en-user-b-never-sees-a.png`
  - `docs/delivery/handbacks/DG2/T-DG2-FE14-evidence/ar-user-b-never-sees-a.png` (RTL, persistent language switch visible)
  - **FE14 adds no new visible UI.** Its effect is that nothing appears (no late record, no banner, no navigation), and the unit tests above assert that.

## 6. Every non-zero exit, failed suite and warning

- **Earlier check runs, discarded: e2e exit 1 in both modes.**
  - **First run.** It started while I was still editing source. I tried to stop it with `pkill`, but each sandboxed command runs in its own PID namespace, so `ps` and `pkill` couldn't see it. Its C.UTF-8 half kept running.
  - **Second run.** It overlapped the first run's leftover. Two Playwright processes then shared `test-results/`, and the failures were trace-artifact errors: `ENOENT … test-results/.playwright-artifacts-*/traces/…`, with 1 failed, 3 or 6 did not run. Neither failure was a product assertion.
  - **Third run.** I deleted all those logs and re-ran the whole matrix once. It overlapped the second run only during its own typecheck, build, lint and format steps. Its e2e ran alone and is the run reported above.
- **Negative-control log, exit 1.** Expected: it shows the defect on `HEAD` (§4.2).
- **All 4 unit logs** contain one `[FSTDEP022] FastifyWarning: … router options … deprecated`.
  - It comes from an API test (`apps/api/**`, outside my scope) and is pre-existing: FE10–FE13 report it too.
  - It is the only line matching `Warning: |act\(|Cannot update a component|stderr \||Hook timed out`, so there are **0 React warnings**, 0 `stderr |` blocks and 0 hook timeouts.
  - Other "warning" matches are test titles ("…with no React warning", `react-warning-guard.test.tsx`).
- **Build logs:** Vite's "(!) Some chunks are larger than 500 kB" (pre-existing).
- **e2e logs:** 3 `npm warn Unknown project config …` lines, from `npx` reading the pnpm `.npmrc` (pre-existing). The only other match is a test title ("the 3-5 top-outcomes warning"). There are 0 failed and 0 flaky tests.
- **`pnpm format:check` exited 0 in both modes this time.** FE13 saw exit 2 from `EACCES` on sandbox-masked dotfiles; this run saw none. The `--ignore-path` variant also exits 0.
- **Failed attempts during development** (fixed in the test, not the product):
  - **X6 tests:** at first they used `setDefaultOptions` without the production `refetchOnWindowFocus: false`. They now use `QUERY_DEFAULTS`.
  - **Staleness check:** my first version used the observer's cached `isStale`, which stayed `false` after time passed. It now uses `isStaleByTime`, as TanStack does.
  - **Organization test:** it initially passed on `HEAD`, because B's GET landed after A's write. B's GET is now held, as in the reviewer's X3.
  - **Lost test file:** a scripting slip truncated the new test file once, and I rewrote it in full.
- **Harness directories:** empty `.claude/.cc-writes` directories appeared in `apps/`, `apps/web/`, `apps/web/src/` and my evidence directory. I removed them with `rmdir`.

## 7. Known gaps and notes

- **The "silent" rule is applied at each catch** that stores an error (§2), plus the shared display components. A future catch that shows a raw error would also have to check `isSessionChangedError`.
  - The data guarantee doesn't depend on this, because the client never returns stale data.
  - Only the "no banner" polish does: a missed catch would show the generic "unexpected" message in the same-person-new-session case. In the other-person case, the old tree unmounts anyway.
- **A write the server already committed under A is not undone.** Server-side authorization is unchanged. The client only refuses to hand A's answer to the new identity.
  - Same person: if they save again, the stale version yields the normal 409 conflict flow.
- **Shorter refetch on focus with nothing stale.** If `/me` alone is stale (over 60 s) and no page query is, a refocus refetches `/me` only. That matches the previous behaviour.
- **No product approval is implied.** Product gates G1–G6 are not touched, and DG2 is not passed by this handback.

## 8. Merge instructions

- Apply the working-tree changes on `7905e8b`. There is no migration, no API or OpenAPI change and no dependency change.
- **Possible conflict:** another branch that edits the listed catch blocks or the `createQueryClient` defaults.
- **For test authors:** a test that relies on TanStack's own `refetchOnWindowFocus` must now drive `revalidateSessionFirst`, or toggle `focusManager` on a client that `<AppProviders>` mounted.
