# Handback T-DG4-FE-R9B: frontend-ux-engineer (DG4 round-5 repair, test determinism)

- **Stage / gate:** P4, DG4 (FIXING after review round 5).
- **Findings:** F-DG4-106 (code-security) and F-DG4-145 (qa), one defect, Low, test-only, per D-129.
- **Invocation:** `DG4-T-DG4-FE-R9B-frontend-ux-engineer-20261012T085209Z-7e410a31`, session `7e410a31-7fda-48fa-9136-49718bec243b`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R9B.md`, sha256 `74bc1208…10a42`. I verified this hash at the start.
- **Start:** HEAD `41b586c` (WIP salvaged from the killed R9 run) on branch `dg4/fe-r9`. Its parent is `c6ffe3f`.
- **Time:** started `date -u` 2026-10-12 08:52:24 UTC; ended 10:15:10 UTC (about 83 min).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` returned `PASS gate DG3 (historical)` with exit 0 (`T-DG4-FE-R9B-evidence/validate-DG3.log`).
- **Evidence:** every log under `T-DG4-FE-R9B-evidence/` was produced by **this** run. I did not reuse anything from the orphaned R9 transcript.

## 1. Changed files

All changes are tests in `apps/web/src/auth/`. **No product file changed.** `apps/web/src/api/client.ts`, `SESSION_RECHECK_MS = 2_000` and the D-077 behaviour are untouched (`git diff c6ffe3f --stat` lists only these three `*.test.tsx` files).

| File | State | Purpose |
|---|---|---|
| `apps/web/src/auth/session-bound.test.tsx` | WIP from `41b586c`, reviewed and **kept as is** | The file controls `Date.now` (it is the clock `api/client.ts` measures the window with), so the 2 s window is crossed only where a test says so. Y1c gets stricter, order-aware assertions. A new deterministic variant crosses the window at a chosen request. |
| `apps/web/src/auth/session-identity.test.tsx` | WIP from `41b586c`, reviewed and **kept as is** | "a 403 is never a session end" scripts its 403 by URL (`/api/v1/organizations`). It no longer uses "the next two fetch calls", which a window-triggered `/me` could have taken. |
| `apps/web/src/auth/session-generation.test.tsx` | **New in this run, uncommitted** | X6 "the same identity: a refocus…; nothing when all is fresh" holds `Date.now` still from the start. "All fresh" therefore no longer depends on wall-clock time against the 15 s page staleTime. The later "+20 s" step moves the same spy. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R9B-frontend-ux-engineer.md`, `…/T-DG4-FE-R9B-evidence/*.log` | new | This handback and its logs. |

**Git state.** `session-bound` and `session-identity` changes are in the orchestrator's WIP commit `41b586c`. The `session-generation` change is **uncommitted**, as asked. sha256 after the change:

| File | sha256 |
|---|---|
| `session-bound.test.tsx` | `bf91cc63…73d9b2` |
| `session-identity.test.tsx` | `996210ea…07e2ab` |
| `session-generation.test.tsx` | `595b412a…3ec832` |

**Untracked files I did not create.** The untracked top-level files (`.bashrc`, `.bash_profile`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) were already in the worktree or come from the environment. I did not create them, and they are not part of this change.

**Housekeeping before the tests.**
- I removed the empty `.claude/.cc-writes` directories in `apps/web/src/.claude/` and `apps/web/.claude/`, as the assignment asks.
- Every scratch spec copy (`apps/web/src/auth/zz-r9b-*.test.tsx`) was deleted after its run. `ls apps/web/src/auth/zz-*` now finds none.

## 2. Review of the salvaged WIP (`41b586c`)

I reviewed it critically. Each point was confirmed by a run, not by reading alone.

1. **Controlled clock in `session-bound.test.tsx`.**
   - `installClock()` in `beforeEach` spies `Date.now` with a value that moves only through `advanceClock`.
   - `vi.restoreAllMocks()` in `afterEach` removes it.
   - `api/client.ts` measures the window with `Date.now()` only (lines 292, 297, 379, 443), so the clock is the one the window uses. Real timers keep running for Testing Library, React and the spec's `wait()`.
   - `advanceClock` is now cumulative. Before, each call replaced the spy with "real now + ms". The four callers (N1 +5 s, N2 +16 s, bounded +3 s, writes +3 s) each call it once per test, so their meaning is unchanged. All of them pass, under load too (§4).
   - `lastMeAt` (module state) is reset by `resetSessionStateForTests()` in `renderApp`, so no test inherits the previous test's clock.
   - **Kept.**
2. **Y1c's new assertions.** They hold against the real request order, which this run logged: `POST | GET /me | GET /me | GET /transformations/<id> | GET …/summary | GET …/audit | GET /decisions…` (`T-DG4-FE-R9B-evidence/07-probe-loaded.log`). **Kept.**
3. **The new variant "Y1c (the 2 s window passes during the page load)".**
   - It crosses the window at the moment the detail GET is sent, through a non-holding `hold` predicate that only advances the clock.
   - Before the crossing it asserts exactly 2 `/me`. After it, it asserts exactly one `/me`, sent **first**, before more than one page GET.
   - This is D-129's "at most one revalidation per page `GET` sent after the 2 s window", made deterministic. A product that stopped revalidating after the window would fail `isMe(after[0])`.
   - **Kept.**
4. **`session-identity.test.tsx`.**
   - Before, two `mockImplementationOnce(forbidden)` answered "the next two fetch calls". Under load, the GET could be sent more than 2 s after the last `/me`. Its revalidation `/me` would then be the next fetch call and take the first 403.
   - Answering by URL keeps the assertion, `[403, 403]` with nothing reset, and makes it independent of time. The `POST` goes to the same path with no query, so `String(input)` is exactly `/api/v1/organizations` for both.
   - **Kept.**
5. **Not in the WIP and added in this run:** the X6 test in `session-generation.test.tsx`. See §3, item 2.

## 3. Behaviour delivered

**Requirement row REQ-S16-030.** Its acceptance text, quoted: *"Security middleware applies the controls; dependency audits run in CI; secrets are read through a provider interface"*. This repair does not change the product's security controls. It makes the unit test of the session controls (F-DG2-530/570/580, D-077) deterministic, so the required `pnpm test` check is reliable.

### Item 1: Y1c, deterministic in both locales

**Before** (`c6ffe3f`, lines 270–281). It runs on real timers:

```ts
      // Bounded: the create's own permission refresh (F-DG1-210) and the navigation's identity confirmation (F-DG2-570).
      const afterPost = s.requests.slice(s.requests.findIndex((r) => r.method === "POST"));
      expect(afterPost.filter(isMe)).toHaveLength(2);
```

**After** (`session-bound.test.tsx`, Y1c). `Date.now` is controlled for the whole file:

```ts
      const generation = getSessionGeneration();
      …
      expect(getSessionGeneration()).toBe(generation); // one identity throughout: nothing reset
      expect(document.querySelector(".user-box__name")?.textContent?.trim()).toBe("Synthetic User A");
      const afterPost = s.requests.slice(s.requests.findIndex((r) => r.method === "POST"));
      const sent = summary(afterPost);
      expect(sent[1]).toBe("GET /api/v1/me");                 // the create's own permission refresh (F-DG1-210)
      expect(afterPost.filter(isMe)).toHaveLength(2);        // + the navigation's identity confirmation (F-DG2-570), nothing more
      const firstPage = afterPost.findIndex((r) => r.method === "GET" && !isMe(r));
      expect(sent[firstPage]).toBe(`GET /api/v1/transformations/${NEW_TR_ID}`);
      expect(afterPost.slice(firstPage).filter(isMe)).toEqual([]); // no revalidation: the window did not pass
```

**After**, the new variant "Y1c (the 2 s window passes during the page load): one revalidation, sent first, for the GETs after the window". The clock moves `SESSION_RECHECK_MS + 1` exactly when the detail GET is sent:

```ts
      expect(getSessionGeneration()).toBe(generation);
      expect(document.querySelector(".user-box__name")?.textContent?.trim()).toBe("Synthetic User A");
      expect(crossedAt).toBeGreaterThan(postAt);
      expect(before.filter(isMe)).toHaveLength(2);                    // inside the window: as in Y1c
      expect(after.filter((r) => !isMe(r)).length).toBeGreaterThan(1); // page GETs were sent after the window
      expect(isMe(after[0]!)).toBe(true);                             // revalidated FIRST
      expect(after.filter(isMe)).toHaveLength(1);                     // ONCE for all of them
```

**What D-129 requires, and where it is covered:**

| Requirement | Where |
|---|---|
| Nothing from user A's action lands under user B | Y1 (unchanged; it runs in the same file and passes 20/20 under load). Y1c also pins one identity (generation unchanged, A's header). |
| At most one identity confirmation per navigation, plus the create's own permission refresh | Y1c: exactly 2, in the stated order. |
| At most one revalidation per page `GET` sent after the 2 s window | The new variant: exactly 1, sent first. |

**What did not change:**
- No assertion is weakened. The exact count of 2 stays, and order assertions are added.
- No test is skipped.
- No timeout is raised. The file has no explicit timeout, and `apps/web/vitest.config.ts` keeps `testTimeout: 20_000`.

### Item 2: the same pattern elsewhere

**Search.** I searched every `apps/web/src/**/*.test.ts*` for request counts and timing: `toHaveBeenCalledTimes`, `requests….length` / `.toHaveLength` on requests, `filter(isMe)`, `mockImplementationOnce` / `mockResolvedValueOnce`, `toHaveBeenNthCalledWith`, positional `requests[n]` / `sent[n]` / `.at(n)`, `SESSION_RECHECK_MS`, `Date.now`, `useFakeTimers`. 37 files matched.

**What can be affected.** A window-triggered recheck adds only a `GET /me` before a page GET. Writes neither trigger nor wait for it. The test `/me` answers a constant identity, including a constant `csrfToken: "c".repeat(43)` in `test/fixtures.tsx`, so it never resets or refetches. So only assertions that count or order `/me`, assert "nothing sent", or script answers by call order can depend on the window.

Every site I checked:

| File › test (line) | What it asserts | Window-dependent? | Action |
|---|---|---|---|
| `session-bound` › Y1c (en/ar) | exactly 2 `/me` after the POST | **Yes** (the finding) | Fixed (controlled clock and order assertions; a new deterministic window variant) |
| `session-bound` › "bounded: one GET /me per navigation…" | 0 `/me` for a refetch "inside the window", then 1 after `advanceClock(3000)` | **Yes**, the same defect: the "inside the window" step depended on real elapsed time | Fixed by the same file-wide clock (WIP). It passes 20/20 under load. |
| `session-bound` › N1, N2, N0, "writes neither wait for nor trigger…", Y2…, `bindToSession` units | `/me` first, count 1 per navigation; PATCH first | Moves the clock explicitly; a navigation `/me` is window-independent | Now on the controlled clock; no further change |
| `session-identity` › "a 403 is never a session end" (L304) | `[403, 403]` from two `mockImplementationOnce` | **Yes**: a revalidation `/me` could take the first scripted 403 | Fixed (WIP): answered by URL |
| `session-identity` › W5 (L145, `meCount ≤ 2`) | `/me` after a session end on `/login` | No: the session is ended or `/login` is not a page under `RequireSession`, and there is slack | None |
| `session-identity` › "same person new session" (L237, `mockImplementationOnce`) | the next fetch is the `/me` refetch | No: `invalidateQueries(keys.me)` sends only `/me`, a session probe, which never triggers the recheck | None |
| `session-identity` › "same identity re-probed" (L260, `meCount = 1`) | one `/me` after `invalidateQueries(me)` | No: no page GET follows a same-identity `/me` | None |
| `session-identity` › sign-out (L276, `≤ 1`) | `/me` after sign-out | No: phase `unknown`, so no recheck | None |
| `session-end` › L133, L168, L182, L222, L244, L280 (`expectSessionEndedLanding` / `meCount ≤ 2` / `≤ 1`) | `/me` bounds around a session end | No: the recheck runs only while the phase is `active`, writes do not trigger it, and a navigation `/me` is the confirmation itself | None |
| `session-generation` › X6 "after B signs in elsewhere, a refocus…" (L403) | slice equals `["GET /api/v1/me"]`, 1 `/me` | No: `Date.now` is held still (`mockReturnValue`) before the counted step | None |
| `session-generation` › X6 "the same identity: … nothing when all is fresh" (L424) | `requests.slice(from)` equals `[]` after a refocus, with **real** time against the 15 s page staleTime | **Yes**, a wall-clock window (15 s, not the 2 s one). Unlikely within the 20 s test timeout, but the same class of defect | **Fixed in this run**: clock held still from the start; the "+20 s" step moves the same spy |
| `session-generation` › X6 "refocus whose /me finds the session ended" (L464) | `/me` first, no page GET | No: clock held still | None |
| `session-generation` › "language save retried after a 409" (L372) | `/me ≥ 2`, PUT = 1 | No: a lower bound; writes do not trigger the recheck | None |
| `LanguageSwitch` L94, `team` L432, `my-work` L96, `g5-g6` L713, `plan-values` L225, `p2-blank-forms` (10 sites) | counts of PUT/POST/PATCH | No: writes never trigger or wait for the recheck | None |
| `ScheduleNetworkPanel` L157, `plan-values` L159, `buFilter` L110/149/167 | counts of a specific non-`/me` GET | No: a recheck adds only `/me` and never repeats a page GET (same identity, no reset) | None |
| `lib.test.ts` L137–146 (`requests[0]`) | headers of the one request of a direct `apiRequest` | No: no app rendered, so no check runner is registered and no recheck happens | None |
| The other matches (`toHaveLength` on DOM nodes or alerts in `RecordForm.alerts`, `p2`, `dashboards`, `gates/*`, `benefits`, `kpi`, `portfolio`, `team`, `raci`, `dependencies`, `prioritization`, `dispensations`, `capacity`, `raid`, `traceability`, `roadmap`, `approvals`, `meetings`, `inherited-approval`, `n4Value`, `valueHeadlines`, `percentKpi`, `app.test`, `auditChanges`) | DOM or text counts, not requests | No | None |

### Item 3: determinism under load

See §4. Every run is reported there.

### Item 4: e2e

**Not run, and not needed.** This is a unit-test-only change: only `*.test.tsx` files changed, nothing outside them. The orchestrator's integrated pre-freeze run covers the product e2e suite.

## 4. Checks run (real exit codes)

**Environment for every check:**

| Setting | Value |
|---|---|
| Node | 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline |
| Variables | `TZ=UTC`, `CI=1` for Vitest |
| Machine | 4 cores |
| Free disk | 19 GB before each full run (`df -h .`); the 3 GB threshold was never approached |

**Load.**
- **Setup:** 12 busy loops, 3 pinned to each core, started through `$TMPDIR/bin/busy.sh` (`timeout <N> taskset -c <cpu> sh -c 'while :; do :; done'`). The loops end themselves.
- **Stopping:** each loop was stopped by PID (`kill $pids`) at the end of its script. I never used `pkill -f` or `pgrep -f`.
- **Measured:** the load average (from `/proc/loadavg`) is recorded in each log line.

| # | Check | Command | Load average (1 min) | Result | Exit | Log |
|---|---|---|---|---|---|---|
| R1 | **Reproduction BEFORE**: code-security's probe (sha256 `ebc53171…`) appended to the **original** spec (`git show c6ffe3f:…`, scratch copy) | `npx vitest run --project unit-web <copy> -t SEC-DG4-R5`, hold = detail GET (default), `…/summary`, `…/audit` | idle | **Default hold FAILS**: `/me after POST = 3`, "expected … to have a length of 2 but got 3". Holding summary or audit gives 2 and passes. In this tree the page GETs follow the detail answer, so the default hold is the one that crosses the window. | 1, 0, 0 | `01-before-probe.log` |
| R2 | **Reproduction BEFORE**: qa's contention reproduction, original Y1c | vitest pinned `taskset -c 0` with 3 busy loops on CPU 0, `-t Y1c`, 2 runs | 0.7–2.1 (system-wide; CPU 0 saturated) | **FAILS 2/2**: Y1c (en) "expected … length of 2 but got 3" (5430 ms, 4537 ms) | 1, 1 | `04-before-contention.log` |
| A1 | Probe appended to the **changed** spec (scratch copy) | the same 5 holds: detail (default), summary, audit, decisions, `/me` | idle | **Passes 5/5**, `/me after POST = 2` each | 0 ×5 | `02-after-probe.log` |
| A2 | The changed specs once (session-bound, session-identity, session-generation) | `npx vitest run --project unit-web <3 files>` | idle | 3 files, **80/80** passed | 0 | `03-changed-specs-unloaded.log` |
| A3 | Changed Y1c under qa's contention | as R2 on the changed spec, 2 runs | 3.1–3.8 (CPU 0 saturated) | **6/6 pass**, 2/2 runs (Y1c en: 5035 ms, 5205 ms, slower than the 2 s window and still green) | 0, 0 | `05-after-contention.log` |
| A4 | **The changed tests 20 times, machine loaded** | 20 × `npx vitest run --project unit-web <3 files>`, 12 busy loops | **10.62 → 15.93** (runs 3–20: 14.07–15.93) | **20/20 pass**, 80/80 tests each, about 43 s per run | 0 ×20 | `06-loaded-20x.log` |
| A5 | **code-security's probe appended to the changed spec, loaded** (scratch copy, deleted afterwards) | 3 × default hold (detail GET) + 3 × `Y1C_HOLD='GET .*/summary'` | 12.58–13.65 | **6/6 pass**, `/me after POST = 2`, probe tests 4.8–5.3 s | 0 ×6 | `07-probe-loaded.log` |
| A6 | **Full `pnpm test`, loaded, run 1, locale unset** (`LANG`, `LC_ALL`, `LC_CTYPE` unset) | `pnpm test` | 13.46 at start, 15.78 at end | unit-node + unit-web: 152 files, **2917/2917**; unit-formula-nocodegen: 3 files, **259 passed, 2 skipped (261)** | 0 | `08-pnpm-test-loaded-run1.log` |
| A7 | **Full `pnpm test`, loaded, run 2, `LC_ALL=C.UTF-8`** | `LC_ALL=C.UTF-8 pnpm test` | 15.78 at start, 15.57 at end | 2917/2917; 259 passed, 2 skipped | 0 | `08-pnpm-test-loaded-run2.log` |
| A8 | **Full `pnpm test`, loaded, run 3, locale unset** | `pnpm test` | 15.57 at start, 15.22 at end | 2917/2917; 259 passed, 2 skipped | 0 | `08-pnpm-test-loaded-run3.log` |
| C1 | `pnpm -r typecheck` | as named | ~15 (it ran during A6) | passed | 0 | `10-typecheck.log` |
| C2 | `pnpm lint` | as named | ~15 (during A6) | passed | 0 | `11-lint.log` |
| C3 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | as named | ~15 (during A6) | "All matched files use Prettier code style!" | 0 | `12-prettier.log` |
| C4 | `pnpm openapi:lint` | as named | ~15 (during A6) | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations" | 0 | `13-openapi-lint.log` |
| C5 | `pnpm -r build` | as named | ~11 (decaying after the loops stopped) | passed | 0 | `14-build.log` |
| C6 | Integration | `QA_PG_PORT=26200 MTH_PORT_POOL=26201-26249 TZ=UTC CI=1 tests/qa/support/with-pg.sh pnpm test:integration` | no load loops | 208 files, **1975/1975** passed (1116 s); the same count the round-5 reviewers reported; no pinned count changed | 0 | `15-integration.log` |
| V1 | `node tools/gates/validate.mjs --historical --stage DG3` | as named | idle | `PASS gate DG3 (historical)` | 0 | `validate-DG3.log` |

**Disclosures:**

- **No failed, flaky or timed-out test in any "after" run.** The only non-zero exits are the deliberate "before" reproductions R1 (default hold) and R2 (2 runs).
- **The 2 skipped tests** in `unit-formula-nocodegen` are pre-existing `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts` (lines 600, 833). qa's round-5 log shows the same "259 passed | 2 skipped". They are not skips introduced by this change.
- **Searching the full logs for "failed" / "FAIL "** matches only the names of passing tests, for example "a failed read (404) …". Each of those lines starts with ✓. Searching for ` × ` matches test names that contain the multiplication sign.
- **Locale coverage of `pnpm test`.** Locale unset and `C.UTF-8` are both covered by the loaded runs A6–A8 (unset twice, `C.UTF-8` once). I ran no separate unloaded full `pnpm test`.
- **Static checks ran under load.** C1–C4 ran while A6 was running, so A6 was under 12 busy loops **plus** those checks. That makes the load at least as heavy as stated, never lighter.
- **Node 22.** The assignment names Node 24 only, so I did not run Node 22. It is not claimed.

## 5. Operations routed (pending-list delta)

None. No API operation was added or routed, and no `apps/api/test/support/p4-pending-*.ts` or `p4-exercises-*.ts` file changed. `contract.test.ts` stays green: it is part of unit-node in A6–A8.

## 6. Contract or schema needs for the orchestrator

None. `docs/api/openapi.yaml` and the zod mirrors are unchanged.

## 7. What remains

- Nothing in scope. Items 1–4 are done.
- **Closing the findings.** F-DG4-106 and F-DG4-145 can be closed only by their reviewers, through round-6 verifications. I do not close my own findings.
- **Merging.**
  - Integrate the uncommitted `session-generation.test.tsx` change together with WIP `41b586c`.
  - There are no migrations and no ordering constraints.
  - I expect no conflicts outside `apps/web/src/auth/*.test.tsx`.
- **Approvals.** No product gate G1–G6 or delivery gate DG approval was granted or implied. All test data is synthetic.
