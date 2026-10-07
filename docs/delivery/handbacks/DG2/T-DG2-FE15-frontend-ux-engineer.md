# Handback T-DG2-FE15 (frontend-ux-engineer): the header, the data and every effect belong to one identity

- **Stage:** P2 / DG2 (FIXING).
- **Findings:** F-DG2-530 (completion), F-DG2-580 and F-DG2-570. All three are Low and not mandatory (REQ-S16-030).
- **Invocation:** `DG2-T-DG2-FE15-frontend-ux-engineer-20261007T172608Z-5017710f`, session `5017710f-5a3c-4664-a8e9-9b06f1d1d144`.
- **Base:** `HEAD` `2485d52`, branch `claude/mobily-transformation-platform-regate`. At start the working tree held only the sandbox-masked dotfiles (untracked) and my run directory, with no tracked changes.
- **Assignment:** `docs/delivery/assignments/DG2/round-17/T-DG2-FE15.md` (sha256 `20722f9d…e337`, verified).
- **Nothing committed.** I close no finding.
- **Data:** every user, record and session in the tests, probes and e2e runs is SYNTHETIC.
- **Out-of-scope paths not touched:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews, gate records.
- **Shared file outside `apps/web`:** one, the root `eslint.config.js` (the new lint rule, §1.4). It isn't on the assignment's do-not-edit list.

## 1. The fix

### 1.1 One mechanism: a session-bound action (`apps/web/src/auth/sessionBound.ts`, new)

- **`useSessionBoundAction()` → `begin()`.**
  - It's called at the start of every user action.
  - It captures the API client's session generation (FE14), which moves on every session end, sign-out here and identity change.
  - It returns an `action` with:
    - **`action.navigate(to, options)`**: navigates, router state included, only while the generation is unchanged. Otherwise it does nothing and returns `false`.
    - **`action.setQueryData(key, updater)`**: the same rule for the query cache.
    - **`action.stale(err?)`**: true when the generation moved, or when `err` is FE14's `SessionChangedError`. Every handler checks `if (action.stale()) return;` after each `await`, and `if (action.stale(e)) return;` in its catch, before any other render effect (banner, notice, closing a dialog, conflict panel).
    - **`action.run(effect)`**: runs a single effect only while current.
- **`beginSessionGuard()`** is a router-free form with `current`, `stale` and `run` only. It's for forms and dialogs that never navigate or write the cache (`RecordForm`, `RowActions`, `ReasonDialog`, the KPI activation dialog). Some tests render those without a router.
- **`useSessionNavigate()`** is for a navigation in a plain click handler (Cancel), bound at the click.
- **`useP2Refresh()`** (`api/queries.ts`) now resolves to whether the generation it began under is still current. Every P2 success continuation reads `if (!(await refresh())) return;` before it closes its dialog or calls `onDone`. That's 32 sites (§2).
- **`useVersionedSave`** begins the action itself and checks it after each await. It passes the action to `onSaved(updated, action)`, so the organisation, business-unit and user edit pages write the cache through `action.setQueryData`.
- **The session transitions are the only raw navigations.** Each one navigates *because* the generation moved, and carries a justified `eslint-disable-next-line` comment:
  - the session-end redirect (`auth/session.tsx`);
  - signing out here (`app/Shell.tsx`, after `markSignedOut()`);
  - signing in (`pages/LoginPage.tsx`).

**The reported paths (Y1 / R16-06).**

- `TransformationCreatePage.onSubmit` now runs:
  1. `begin()`;
  2. POST, then invalidate, then `stale()`;
  3. the GET `/me` permission refresh (F-DG1-210), then `stale()`;
  4. `action.navigate(...)`.
- When that `/me` returns B, the generation moves. Nothing navigates, no router state is written, and B's freshly remounted create page shows an empty form.
- **The created state is also bound to its creator.** `CreatedNavigationState.created.createdBy = {organizationId, userId}`. `TransformationDetailPage` renders `CreatedNotVisible` only when that matches `useMe()`.
- The browser keeps router state in its history entry. So without this check, Back/Forward or a reload could still show A's code and name to B after an identity change. Tested in §3.

### 1.2 F-DG2-570: the identity is confirmed before page data is fetched (`api/client.ts`, `auth/session.tsx`, `app/App.tsx`)

The session cookie is HttpOnly and the CSRF token isn't in a cookie (checked in `apps/api/src/modules/identity/routes.ts:100-113`). So the client can't see a sign-in in another tab without asking the server. Two rules apply:

1. **Every in-app navigation to another path confirms GET `/me` first.**
   - `<RequireSession>` calls `revalidateSessionIdentity()` from a **layout** effect on `location.pathname`. Layout effects run before the new page's queries subscribe (passive effects).
   - It is not called on the first render, because `/me` is being fetched right then.
2. **Any other page GET confirms `/me` first when the last `/me` is older than `SESSION_RECHECK_MS` (2 s).** Examples: a filter, a page of results, a refetch after a write.

How the confirmation works:

- **It goes through the app's query cache.** `registerSessionCheck` is wired in `createQueryClient` as `queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0 })`. So the header and the permissions follow the same answer.
- **Page GETs wait.**
  - `apiRequest` makes every GET wait while a check, or any other `/me` (`asIdentityProbe` wraps `fetchMe`), is in flight.
  - A GET whose generation moved while it waited is **never sent**. It throws `SessionChangedError`. The reset has already removed the previous identity's queries, and B's subtree fetches its own.
- **Writes are unchanged.** They neither trigger nor wait for the check. They go out at once with the CSRF token of the identity the user acted as. That preserves the FE11/FE13 behaviour that a 403 `csrf` is never a session end, and the language "not saved" notice still appears.
- **Bounded.**
  - One `/me` per in-app navigation, shared by the page's whole burst of requests and joined with a `/me` already in flight.
  - Otherwise at most one per 2 s while requests are being made, and none while idle.
  - Every `/me` restarts the window: refocus, session gate, permission refresh, recheck.
  - `markSessionActive()` also restarts it.
- **Refocus and reconnect are unchanged.** FE14's `revalidateSessionFirst` still applies.

### 1.3 Kept guarantees (FE10/FE13/FE14)

All the earlier suites pass unchanged in EN and AR:

- `session-end.test.tsx`
- `session-identity.test.tsx`
- `session-generation.test.tsx`
- `LanguageSwitch.test.tsx`
- e2e `session-end.spec.ts`, in both projects and both locale modes

The specific guarantees:

- **One navigation on a session end.** The only navigation in that path is the session transition.
- **Bounded `/me`.**
  - The e2e session-end assertions (`≤ 3` after an end, `≤ 1` in the 403 test) pass.
  - The new unit test pins one `/me` per navigation and none inside the window.
  - In Y1c, the create sends exactly 2 `/me` after the POST: the permission refresh and the navigation's confirmation.
- **No stale shell.** `RequireSession`'s `ended` branch is unchanged.
- **A 403 is never an end.** Writes bypass the check, and the e2e 403/CSRF test passes.
- **`returnTo` is safe.** Untouched.
- **Same person, new session keeps its drafts.** FE14's test passes. The generation moves, so bound effects of the in-flight action are dropped. The person's draft and form stay, and the next save goes out under the new session.
- **A same-identity write still updates and navigates.** Sanity tests cover the edit, the organisation and user creates, the create (Y1c) and the creator-without-read case.

### 1.4 Enforcement: a lint rule plus a test

- **The lint rule.** `eslint.config.js` gives `apps/web/src/**`, excluding tests, `src/test/**` and `auth/sessionBound.ts`, these rules:
  - `no-restricted-imports` for `useNavigate` and `redirect` from `react-router`;
  - `no-restricted-syntax` for `*.setQueryData(` / `*.setQueriesData(` / `*.navigate(` on any object other than `action`. The `parseFloat` ban is kept in the same rule.
- **The test.** `auth/session-bound.test.tsx` "the convention" does four things:
  - scans every non-test source file in `apps/web/src`;
  - checks that `useNavigate` appears only in `sessionBound.ts` and the three transitions, each with its justification comment;
  - checks that there's no raw cache write or navigate;
  - runs ESLint itself on a page that does a raw `setQueryData`, a raw `router.navigate` and a `useNavigate` import after an `await`, and asserts all three rule hits. It also asserts that the same code written through `action` passes.
- **Scope of the guarantee.** The rule enforces the global effects (router, query cache) structurally. Component-local effects after an await rely on the convention plus the identity-keyed subtree: another person's subtree is a new one, so React drops those updates. Every current site is listed in §2.

## 2. Sweep (grep on the final tree)

**Every `navigate(` / `setQueryData(` / `setQueriesData(` outside tests** (`grep -rn "navigate(\|setQueryData\b\|setQueriesData" apps/web/src`):

| Site | Now |
|---|---|
| `pages/transformations/TransformationCreatePage.tsx:215` | `action.navigate` after `stale()` checks (:199, :206); Cancel `:397` through `useSessionNavigate` |
| `pages/transformations/TransformationEditPage.tsx:123`, `:137` | `action.navigate` (no-change and saved paths); Cancel `:329` through `useSessionNavigate` |
| `pages/transformations/TransformationEditPage.tsx:134`, `:145` | `action.setQueryData` (save; 409 conflict re-load), then `stale()` before `setConflict` |
| `pages/transformations/TransformationDetailPage.tsx:163` | `action.setQueryData` (archive); `action.run(setArchiving)`; created-state bound to its creator (`createdState`, :54-66) |
| `pages/admin/OrganizationsPage.tsx:162` | `action.navigate` after `stale()` (org create) |
| `pages/admin/OrganizationsPage.tsx:259`, `:580` | `action.setQueryData` in `onSaved(updated, action)` (org / business-unit edit) |
| `pages/admin/UsersPage.tsx:297` | `action.navigate` after `stale()` (user create) |
| `pages/admin/UsersPage.tsx:391` | `action.setQueryData` in `onSaved` (user edit) |
| `components/LanguageSwitch.tsx:63` | `action.setQueryData` (preferences PUT). The former raw `setQueryData(keys.me, fresh)` after the 409 is gone: `/me` is re-read through `queryClient.fetchQuery`, so the query stores its own answer whichever identity it brings. |
| `auth/session.tsx:70` | raw navigate. **Transition** (session-end redirect), justified disable comment |
| `app/Shell.tsx:56` | raw navigate. **Transition** (sign-out here; `markSignedOut()` first), justified |
| `pages/LoginPage.tsx:137` | raw navigate. **Transition** (sign-in to `returnTo`), justified |
| `auth/sessionBound.ts:80`, `:85` | the wrappers themselves |

There is no `setQueriesData`, `ensureQueryData`, `router.navigate` or `redirect` in app code.

**Every handler that awaits more than once, or runs an effect after an await:**

- **Bound with `begin()`:**
  - `TransformationCreatePage.onSubmit` (:184);
  - `TransformationEditPage.save` (:119);
  - `TransformationDetailPage` `archive` (:155);
  - `OrganizationsPage` `CreateOrganization.onSubmit` (:154) and `CreateBusinessUnit.onSubmit` (:472);
  - `UsersPage` `CreateUser.onSubmit` (:289);
  - `AssignmentsPage` `revoke` (:211) and `GrantForm.onSubmit` (:435);
  - `useVersionedSave.send` (:45), covering the org, business-unit and user edits (:277/:599/:410);
  - `LanguageSwitch` `onClick`/`persist` (:75/:54).
- **Bound with `beginSessionGuard()`:**
  - `RecordForm.send` (:284), covering every P2 `RecordDialog`/`InlineRecordForm` save;
  - `RowActions` archive `onConfirm` (:40) and `NoteDecisionDialog.submit` (:112);
  - `ReasonDialog.submit` (:42);
  - `DefinePage` `ActivateKpiDialog.activate` (:1027).
- **`if (!(await refresh())) return;` before the continuation (32 sites):**
  - TeamPage:397;
  - WorkshopsSection:166/385/397;
  - DesignPage:190/474/681;
  - JourneysSection:235/449/587;
  - GateDetailPage:204/215/252;
  - CharterPage:101/300;
  - DefinePage:176/382/792/986/1193;
  - DecisionsPage:304/323;
  - EvidencePage:295/313/389/527/665;
  - DiagnosePage:269/556/575/757/1020.
- **Remaining `await refresh()` / `await onDone()` without a check: terminal, with no effect after them.**
  - WorkshopsSection:201/205;
  - JourneysSection:601;
  - GateDetailPage:459/466/562/574;
  - DefinePage:1042;
  - EvidencePage:394;
  - RowActions:50/142;
  - DefinePage:1036 is followed by `stale()`.
- **P2 catches that return on `isSessionChangedError`.**
  - Sites: WorkshopsSection:203, JourneysSection:590, GateDetailPage:461/564, DefinePage:179/184, EvidencePage:392/530.
  - In those try blocks the only await that can fail is `api.send` or `api.get`. Either one throws `SessionChangedError` when the generation moved, so the check is equivalent to `action.stale(e)`.
  - `refresh()` never throws.
- **Transitions (raw by design):**
  - `Shell.signOut` (:38): logout POST, then `markSignedOut`, then navigate;
  - `LoginPage` `DevLoginForm.onSubmit` (:125);
  - `RequireSession`'s session-end effect.
- **No navigate or cache write:** `App.revalidateSessionFirst`. It runs `/me` first, then refetches page queries; unchanged.

## 3. Tests (new: `apps/web/src/auth/session-bound.test.tsx`, 34 tests, EN and AR)

| Test | What it shows |
|---|---|
| **Y1** (reviewer) | A's POST is answered 201 under A's generation; the create's own GET `/me` returns B. B isn't navigated: the path stays `/transformations/new` and the router state is `null`. B never sees `TR-A-NEW-SECRET` or `A-CREATED-SECRET-NAME` (text, inputs, `created-not-visible`), and there's no alert, no console error and no DOM moment with A's header over A's record. |
| **Y1c** (reviewer) | One identity: the create still lands on the record with "created as a draft", and sends exactly 2 `/me` after the POST. A second variant covers a creator who can't read the record: still "created, but you cannot open it" with the 201's code. |
| History | A router-state entry carrying A's created record, opened under B: `no-permission`, never A's code or name. |
| Edit / organisation create / user create | The identity changes **between the handler's awaits**: during its own post-write invalidation, `/me` answers B. B isn't navigated and never sees A's new name. |
| Sanity | The organisation and user creates under one identity navigate to the new record. An edit with a same-identity `/me` between its awaits keeps the generation, updates the cache and navigates. |
| **N0** (the reviewer's Y5) | No time passes and there's no focus event: the next page sends `/me` first, and B's header sits above B's list. |
| **N1** | 5 s later, A's own record: `/me` first (exactly one), then B's header with `no-permission`. A's header is never over B's answer. |
| **N2** | 16 s later, the list: `/me` first, then B's header with B's list. |
| Bounded | One `/me` per navigation, shared by a burst of more than one page GET; 0 for a non-navigation refetch inside the window; 1 after it; same identity, nothing reset. |
| Writes | After the window, a save goes out first (no `/me` before it) with A's own CSRF token. |
| Helper | `bindToSession`/`beginSessionGuard` act while current and do nothing after another identity. A same-identity re-probe keeps them current. |
| Convention | Source scan plus the ESLint rule itself (§1.4). |

**Negative control** (`negative-control-HEAD-unit.log`, exit 1):

- **Setup.**
  - A disposable clone of `HEAD` `2485d52` (HEAD's product code).
  - Only three files copied in: the new test file, `sessionBound.ts` (unused by HEAD's pages, needed only to load the file) and the reviewer's probe.
- **Result: 24 failed, 14 passed.**
  - **Failed:** the reviewer's Y1, plus 23 of my tests:
    - in EN and AR: Y1, history, edit, organisation, user, N0, N1, N2 and bounded;
    - the three convention tests.
  - **Passed on `HEAD`, as they should:** the sanity cases, Y1c, writes, the helper tests and the reviewer's Y1c/Y4/Y5 (Y5 is an observation that always passes).
  - On `HEAD`, the reviewer's Y5 logs `header A=true; B's row=true`.

**Reviewer's probe on the fix** (`zz-sec-r16-web-probe.test.tsx`, sha256 `f0d72881`, unchanged): **4/4 passed** on Node 24 (LANG unset) and Node 22 (C.UTF-8).

- Y1: `path /transformations/new; header B=true; B sees A's code=false; B sees A's name=false`.
- Y5: `requests on navigation = ["GET /api/v1/me", …]; header A=false; B's row=true`.
- Logs: `reviewer-probe-r16-on-fix-node24-unset.log`, `reviewer-probe-r16-on-fix-node22-cutf8.log`.

**Real stack (built SPA + API + PostgreSQL, `e2e/support/qa-stack.sh`, Node 24):**

| Run | Specs / probe | LANG unset | LANG=C.UTF-8 |
|---|---|---|---|
| qa's R16 spec, copied unchanged to `e2e/fe15-run-dg2-qa-r16.spec.ts` and removed after | sha256 `408a6a14`; **R16-06 (F-580)** plus R16-01…05, chromium-en and chromium-ar | **12 passed** (7.9m), exit 0 | **12 passed** (8.0m), exit 0 |
| Domain probe `r16-identity-nav.mjs`, unchanged, run from a temporary `rv/` | sha256 `ace1063d`; **F-570**: tab-2 sign-out/sign-in, tab-1 refocus about 4.4 s after `/me`, then N1 and N2, EN and AR | **5 pass / 0 fail**, exit 0 | **5 pass / 0 fail**, exit 0 |

- **The domain probe's actual values** (EN and AR, both modes):
  - N1: `header='Synthetic User Without Roles' … pageStates=["no-permission"] meRequests=1`.
  - N2: `header='Synthetic User Without Roles' listHasASecret=false meRequests=2`.
  - On the round-16 candidate this probe was 1 pass / 4 fail, with `meRequests=0`.
- **Logs:** `qa-r16-spec-{unset,cutf8}.log`, `domain-r16-identity-nav-on-fix-{unset,cutf8}.log`.

**Cited screenshots (two):**

- `docs/delivery/handbacks/DG2/T-DG2-FE15-evidence/en-r16-06-after-delivery-header-b-no-a-record.png`: R16-06 after A's 201 was delivered. B's header ("Synthetic Transformation Lead") above B's empty create form; nothing of A's record. Source: the qa spec run, LANG unset.
- `docs/delivery/handbacks/DG2/T-DG2-FE15-evidence/ar-f570-N2-list-header-b-data-b.png`: F-570 N2 in Arabic (RTL), with the persistent language switch visible. B's header ("Synthetic User Without Roles") above B's own list: "لا يوجد تحوّل مرئي لك" ("no transformation is visible to you") and no create button. The file name comes from the domain probe's own label, renamed on copy.

## 4. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/auth/sessionBound.ts` (new) | The session-bound action and guard, `useSessionNavigate`, and the convention documented |
| `apps/web/src/auth/session-bound.test.tsx` (new) | The 34 tests of §3 |
| `apps/web/src/api/client.ts` | Identity recheck before page GETs (`SESSION_RECHECK_MS`, `registerSessionCheck`, `revalidateSessionIdentity`, `asIdentityProbe`, `sessionProbe`); `markSessionActive` restarts the window |
| `apps/web/src/api/queries.ts` | `fetchMe` as an identity probe; `useP2Refresh` resolves to "still current" |
| `apps/web/src/app/App.tsx` | Wires the recheck to the query cache (`fetchQuery` of `/me`) |
| `apps/web/src/auth/session.tsx` | `/me` confirmation on every in-app navigation (layout effect); transition disable comment |
| `apps/web/src/app/Shell.tsx`, `apps/web/src/pages/LoginPage.tsx` | Transition disable comments only |
| `apps/web/src/components/useVersionedSave.ts` | Begins the action; checks after awaits; `onSaved(updated, action)` |
| `apps/web/src/components/RecordForm.tsx`, `RowActions.tsx`, `ReasonDialog.tsx` | `beginSessionGuard` checks; callback types widened to `unknown` |
| `apps/web/src/components/LanguageSwitch.tsx` | Bound action; `/me` through `fetchQuery` |
| `apps/web/src/pages/transformations/TransformationCreatePage.tsx`, `TransformationEditPage.tsx`, `TransformationDetailPage.tsx` | Bound actions; created state bound to its creator |
| `apps/web/src/pages/admin/OrganizationsPage.tsx`, `UsersPage.tsx`, `AssignmentsPage.tsx` | Bound actions |
| `apps/web/src/pages/{team,design,define,decisions,evidence,diagnose,gates}/*.tsx` | `if (!(await refresh())) return;` (32 sites); KPI activation guard; callback prop types widened |
| `eslint.config.js` | The convention rule (§1.4) |
| `docs/delivery/handbacks/DG2/T-DG2-FE15-evidence/**` | Logs, axe tallies and the two screenshots |

## 5. Checks actually run (both locale modes)

- **Script.** All checks ran through one script in my run's `$TMPDIR` (`run-checks.sh`, not kept), first with `env -u LANG -u LC_ALL -u LC_CTYPE` ("unset"), then with `LANG=C.UTF-8` (LC_ALL unset).
- **Logs.** `docs/delivery/handbacks/DG2/T-DG2-FE15-evidence/{unset,cutf8}/NN-*.log`. Each starts with its command, locale mode, Node version and start time, and ends with `# exit status: N`.
- **Run times.** Unset ran 18:01–18:09Z and C.UTF-8 ran 18:09–18:17Z. Nothing else ran alongside them.

| Check | unset | C.UTF-8 |
|---|---|---|
| `pnpm -r typecheck` (Node 24) | exit 0 | exit 0 |
| `pnpm -r build` (Node 24) | exit 0 | exit 0 |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | exit 0 |
| `pnpm format:check` | **exit 2**: only `EACCES` on the 12 sandbox-masked dotfiles (§6); "All matched files use Prettier code style!" | **exit 2**: same |
| `npx prettier --check . --ignore-path .prettierignore --ignore-path .gitignore --ignore-path $TMPDIR/masked.ignore` | exit 0 | exit 0 |
| `pnpm test`, Node 24.21.0 | 50 files, **926 passed**, exit 0 | 50 files, 926 passed, exit 0 |
| `pnpm test`, Node 22.22.2 | 50 files, **926 passed**, exit 0 | 50 files, 926 passed, exit 0 |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0: "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" | same |
| Web e2e: `journeys` + `p2-journeys` + `p2-blank-text` + `session-end`, chromium-en and chromium-ar, `--workers=1` | **70 passed (4.8m)**, exit 0 | **70 passed (4.8m)**, exit 0 |
| axe, from the e2e run's 8 axe summaries | 266 page checks, **0 violations of any impact** (0 serious, 0 critical); `11-axe-tally.log` | same |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 | same |

- **e2e command** (repository root, Node 24; ports 24631/3631 and 24632/3632; pre-installed Chromium; `playwright install` was not run):

  ```
  env <locale env> E2E_PG_PORT=2463x E2E_API_PORT=363x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> \
    apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts \
    apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/session-end.spec.ts --project=chromium-en --project=chromium-ar --workers=1 --reporter=list
  ```

- `session-end.spec.ts` is green in EN and AR in both modes. Its `/me` bounds (`≤ 3`, `≤ 1`) and its 403/CSRF test pass.
- The web unit suite went from 892 tests (FE14) to 926 (+34 new). Before the matrix I also ran the unit-web project on its own: 21 files, 390 passed.

## 6. Every non-zero exit, failed suite and warning

- **`pnpm format:check` exited 2 in both modes.**
  - The only errors are `EACCES: permission denied` for the sandbox-masked `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. There is no other `[error]` line (grep count 0).
  - The `--ignore-path` variant exits 0.
- **Negative-control log, exit 1.** Expected: it shows the defects on `HEAD` (§3).
- **Discarded early runs** (no log kept, superseded):
  - **Prior unit-web runs.** My first unit-web run after the client change had 1 failure. `session-identity.test.tsx` "a 401 … runs the reset once" sets phase "active" without a `/me`, so the new recheck sent its own `/me` first. Fixed by making `markSessionActive()` restart the window (it means "a `/me` just succeeded"). A later run had 20 failures: `RecordForm` is rendered without a router in `RecordForm.alerts.test.tsx` and `render-time-language.test.tsx`, which led to `beginSessionGuard()`. Two runs of my new file failed on test bugs: the header assertion matched A's name as the record owner, and `import.meta.url` isn't a `file:` URL under jsdom.
  - **First negative control.** It couldn't load the new file on `HEAD` (no `sessionBound.ts`), which is why the helper is copied in.
  - **First qa-spec attempt (exit 1).** Playwright also matched qa's evidence copy under `docs/…/e2e/`, whose relative import doesn't resolve. That's why the spec is copied under a unique name and filtered.
- **Warnings in the logs (pre-existing, not from this change):**
  - **Build:** Vite's "Some chunks are larger than 500 kB" notice for `apps/web`. It is also in qa's round-16 `02-build.log`.
  - **Unit (Node 22 and 24):** one `[FSTDEP022] FastifyWarning` from an `apps/api` test.
  - **e2e:** 3 `npm warn Unknown project config …` lines, from `npx` reading the pnpm `.npmrc`.
- **No React warnings, act warnings or hook timeouts.** There are no "Warning:", "Cannot update a component", `act(` or "Hook timed out" lines in any unit or e2e log, and the unit-web React warning guard (F-DG2-430) is active. 0 failed and 0 flaky tests.
- **Harness directories.** Empty `.claude/.cc-writes` directories appeared in `apps/web/`, `apps/web/src/`, `apps/web/src/pages/` and my two evidence log directories. I removed them with `rmdir`.

## 7. Known gaps / residuals

- **The 2 s recheck window (F-570, residual).**
  - Navigations are covered with no window at all (N0).
  - The window affects only a page GET that is **not** a navigation: a filter, a page of results, a refetch after the user's own write. If it's sent less than 2 s after the last `/me`, and less than 2 s after another tab signed someone else in, it is fetched under the new cookie while the previous header is still shown.
  - That ends at the next navigation, the next GET after the window, or a refocus. The server stays authoritative throughout.
  - Closing it entirely would mean a `/me` before every GET burst. I judged that not bounded enough.
- **The convention for component-local state.**
  - The lint rule enforces global effects. Component-local `setState` after an await follows the documented convention.
  - Every current site is listed in §2. A new handler that forgets `stale()` would only affect the person's own subtree.
- **Same person, new session.** The generation moves, so a dialog whose save succeeded but whose refresh crossed the re-sign-in stays open. The record is saved, and a repeat save meets If-Match (409) or the create's idempotency key.
- **Not run:** the reviewer's round-14 and round-15 probes. Their guarantees are covered by the FE13/FE14 suites, which pass.

## 8. Merge instructions

- No migrations, no API or OpenAPI change, no new dependency.
- Apply on `2485d52`. The touched files are all in `apps/web/src/**` plus the root `eslint.config.js`.
- The new lint rule fails any future raw `navigate` or `setQueryData` in app code. New code uses `useSessionBoundAction()` / `beginSessionGuard()`.
- I close no finding. F-DG2-530, F-DG2-570 and F-DG2-580 need a non-author's verification: code-security for 530, domain for 570 and qa for 580.
- Nothing here is a business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing here implies any engineering gate DG0–DG7.
