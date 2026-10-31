# Handback T-DG6-FE-X1B (continuation of T-DG6-FE-X1): pre-freeze repair of a failing web unit test

- **Role:** frontend-ux-engineer
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-X1B-frontend-ux-engineer-20261031T012543Z-99250540","session_id":"99250540-9296-4f94-966e-f78784b4e25f"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-X1B.md` (sha256 `d042936aafd5f9ad2d4a76a42c447c43e021834a2b00a277b57e95f311f2f985`, verified)
- **Stage:** P6 / DG6 (BUILDING). Scope: `p6-work-split.md` §E/F.12 and §J/C.13 (the FE-B screens' test), pre-freeze repair.
- **Starting revision:** branch `dg6/fe-x1`, `HEAD` `e6952399d` ("Merge branch 'claude/mobily-transformation-platform-dg5-regate2' into dg6/fe-x1"). The tree was clean at start. FE-X1's WIP commit is `00be23437`.
- **Time:** start `2026-10-31T01:26:18Z`, end: see §8.
- **Changes are left uncommitted** for the orchestrator.

## 1. Who wrote what

| Part | Author | Verdict in this run |
| --- | --- | --- |
| `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx`: the identity test's field assertion is scoped to the identity screen, and only the shell's global search field is allowed document-wide | **FE-X1** (commit `00be23437`) | Kept unchanged. I verified it independently (§3): root-cause reproduction plus two mutants. |
| `e2e/support/p6-axe-screens.ts`: `/my-work/drafts` added to `P6_AXE_ROUTES` | **FE-X1** (commit `00be23437`) | Kept unchanged. It is required by `apps/web/src/app/axe-scope.test.ts`: every P6 router path must be in the axe list, and FE-D2 registered `my-work/drafts` (`router.tsx:579`) after FE-F2 created the list. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-X1-evidence/**` | **FE-X1** | Kept as FE-X1's record. It is **not** cited as evidence for this handback, because every check below was re-run by me. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-X1B-evidence/**` and this handback | **FE-X1B (me)** | New. |
| Removed the empty directory `apps/web/.claude/.cc-writes` (and its then-empty parent `apps/web/.claude`) before the tests | FE-X1B | The assignment's Environment section requires this. It was untracked, so there is no git change. |

**I changed no product source.** The working-tree diff against `HEAD` is only the new handback and evidence files. The two code changes are FE-X1's, already in `HEAD` through `00be23437`.

## 2. Root cause

- `p6-admin-screens.test.tsx` "identity shows whether a client secret is configured, never a secret value" was written by T-DG6-FE-B (commit `71e013b96`, 2026-10-30 17:27Z). It ended with `expect(document.querySelector("input, textarea")).toBeNull()`, which checks the **whole document**.
- At that time the shell had no form field.
- T-DG6-FE-D (commit `480717236`, 17:53Z, slice H) mounted `<GlobalSearchBox />` in `apps/web/src/app/Shell.tsx:107`. Its `<input data-global-search>` is in the header of every page (REQ-S15-010 "global search").
- From then on the document-wide check found that input, on every run and in every locale. The assignment's guess (slice H touching the shared shell) is correct.
- Reproduced in this run (`root-cause-and-mutation.log`, case 1). The pre-FE-X1 assertion on the integrated tree fails with `expected <input id="_r_1_" …></input> to be null`, and the received element is `class="global-search__input" data-global-search="true" placeholder="Search records"`.

**Which side is wrong: the test.**

- The global search box on every page is a required feature (REQ-S15-010), so removing it from the identity page would be wrong.
- The intent of the assertion is that the Identity screen offers no field where a client secret could be typed or shown (REQ-S16-007; ADR-0054 §1: secrets are shown only as "configured"). That intent belongs to the screen, not to the shell.

**The assertion is not weakened. It is stricter than before:**

- **On the screen** (`[data-p6-screen="identity"]`, which must exist): no `input`, `textarea`, `select` or `[contenteditable]`. The old check covered only `input, textarea`.
- **Document-wide:** every field in the document must be the global search field (`data-global-search="true"`). So any other field added anywhere, including the shell, still fails the test.
- The positive checks are unchanged: "Configured (never shown)" and the issuer text are shown.

## 3. Behaviour delivered, per requirement row

### REQ-S16-007

> **Acceptance:** "A18;A12: e2e tests log in through the Keycloak test realm; a token from another realm is rejected"
>
> **Procedure:** "Login uses OIDC authorization code with PKCE; a Keycloak realm is shipped for tests; SAML is documented through a broker"

- This repair adds no new behaviour for the row. It restores a green unit test of the Administration > Identity screen named in the row's `screen_api` ("Login; Administration > Identity").
- That test checks that the screen shows whether a client secret is configured, never its value, and offers no field.
- The A18/A12 e2e acceptance belongs to BE-G/DO-B (owners `backend-workflow-engineer;devops-engineer`) and is not touched here.

**Proof that the repaired assertion still detects the defect class** (`root-cause-and-mutation.log`; each case runs only the identity test, with `-t`):

| Case | Change applied temporarily | Result |
| --- | --- | --- |
| 1 | Pre-FE-X1 test assertion on the integrated tree | FAIL (`EXIT=1`): the global search input. This is the reported defect. |
| 2 | Mutant A: `<input aria-label="mutant-a" />` inside the identity screen (`IdentityPage.tsx`) | FAIL (`EXIT=1`): `expected <input aria-label="mutant-a"></input> to be null` |
| 3 | Mutant B: `<textarea aria-label="mutant-b" />` added to the shell next to the search box (`Shell.tsx`) | FAIL (`EXIT=1`): the document-wide check, `expected false to be true` |
| 4 | Tree restored | PASS (`EXIT=0`): 1 passed, 32 skipped by the filter |

After case 4, `git diff --quiet HEAD -- apps` confirmed that the source tree was unchanged.

### REQ-S15-012

> **Acceptance:** "A20: an automated axe scan reports no serious or critical violations on key screens; the guided walkthrough can be completed by keyboard alone"

- FE-X1's addition of `/my-work/drafts` to `P6_AXE_ROUTES` keeps the axe scope complete.
- `axe-scope.test.ts` passes in both full runs (§4).
- I did **not** run the A20 Playwright axe spec (`e2e/a20-p6-axe.spec.ts`). It is not in this task's acceptance list, and its owner is QA-D. So whether `/my-work/drafts` is free of violations is **not verified** by this task.

## 4. Checks actually run

All commands ran in `/home/user/wt/dg6-fe-x1`, with Node 24.21.0, offline. Logs are in `docs/delivery/handbacks/DG6/T-DG6-FE-X1B-evidence/`, and each one ends with the real `exit=` line. Load averages before and after are in the `*.load` files.

| # | Command | Exit | Result / counts | Log |
| --- | --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (run first) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |
| 1 | `vitest run src/pages/admin/security/p6-admin-screens.test.tsx` (in `apps/web`), locale unset and `LC_ALL=LANG=C.UTF-8` | 0, 0 | 33/33 passed in each locale | in the session only (superseded by the full runs below) |
| 2 | Root-cause reproduction and mutation (§3) | 1, 1, 1, 0 (as expected) | see §3 | `root-cause-and-mutation.log` |
| 3 | `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| 4 | `pnpm -r build` | 0 | — | `build.log` |
| 5 | `pnpm lint` | 0 | — | `lint.log` |
| 6 | `pnpm openapi:lint` | 0 | — | `openapi-lint.log` |
| 7 | `env -u LC_CTYPE -u LANG -u LC_ALL pnpm test` (locale unset) | 0 | see below | `test-locale-unset.log` |
| 8 | `env -u LC_CTYPE LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | see below | `test-c-utf8.log` |
| 9 | `QA_PG_PORT=26950 MTH_PORT_POOL=26951-26999 tests/qa/support/with-pg.sh pnpm test:integration` | **none (stopped)** | **NOT COMPLETE.** Stopped by my tool's background time limit after about 49 min (01:46Z–02:35Z). There is no Vitest summary and no `exit=` line. Before the stop: 288 files passed and 4 files had 5 failed tests (§4.1). | `test-integration.log` (partial) |
| 9b | `QA_PG_PORT=26960 MTH_PORT_POOL=26961-26999 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration <the 4 failing files>` | 1 | Test Files 3 failed, 1 passed (4). Tests 3 failed, 145 passed (148). | `test-integration-failing-files.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | run last, after this handback was written | `prettier.log` |

**`pnpm test` counts** (both runs: every Vitest invocation passes, with identical counts):

| Vitest project | Files | Tests |
| --- | --- | --- |
| unit-node | 184 passed (184) | 2769 passed (2769) |
| unit-web | 120 passed (120) | 2013 passed (2013), including the repaired identity test |
| unit-formula-nocodegen | 3 passed (3) | 259 passed, 2 skipped (261) |

- The 2 skips are deliberate: `it.skipIf(NOCODEGEN)` at `packages/shared/src/formula/fuzz.test.ts:600` and `:833` in the no-codegen project. They are not failures.
- **Locale note:** the shell environment carries `LC_CTYPE=C.UTF-8`. The "locale unset" run therefore unsets `LC_CTYPE`, `LANG` and `LC_ALL` explicitly.

**Non-zero exits and failures:**

- Cases 1–3 of the mutation log are intended failures.
- Check 9 never finished. It is **not reported as passed**.
- Check 9b exits 1.

Explanation follows.

### 4.1 Integration: acceptance item 3 is NOT met (BLOCKED for this task)

**Timeline of check 9:**

- It started at 01:46Z on the integrated tree.
- It outlived my tool's 600 s foreground limit, so the tool moved it to the background.
- At 02:35Z the tool's 30-minute background cap stopped it, after 288 integration files had finished. The suite has roughly 360 integration test files.
- FE-X1's earlier log (`T-DG6-FE-X1-evidence/test-integration.log`) also has no summary line.
- A complete run takes longer than this harness allows. Re-running it did not fit in the remaining time budget, so I re-ran only the failing files (9b).

**Failures seen.** None of them is in a file this task owns or touched. I changed no product source (§1).

| Test | Full run | Alone (9b) | Classification and evidence | Likely owner |
| --- | --- | --- | --- | --- |
| `tests/qa/integration/a17-import-and-integration.test.ts` › "failing connector (REQ-S12-019, A17) … linked to the stale KPI; nothing in the KPI data changes" | × | × | **Deterministic.** The KPI link returns `freshness:"unknown","lastValue":null,"lastValueAt":null` for both the KDS and AUD readers, where the test expects Stale with `250.75` and `2026-01-31`. FE-X1's earlier run failed the same way. It persists after QA-A2 (`d47bd8210`, D-202 option a) was merged. | QA-A2 / BE-X2 (linked-KPI read) |
| `apps/api/test/integration/assistant/conversations.test.ts` › "the rate-limit class `assistant` and the log line … each post writes one log line without the prompt" | × | × | **Deterministic.** `expected [] to have a length of 1 but got +0` (no log line captured). This matches the open BE-X3 assignment: "assistant secret providers and connection log never wired". | BE-X3 |
| `apps/api/test/integration/admin/security.test.ts` › "getSecurityRateLimits › ADM_TECH and AUD read every class …" | × | × | **Deterministic.** The webhook class now lists `operationIds: ["receiveWebhook"]`, where the test pins `[]`. The product changed after the test (slice A webhooks, BE-N/BE-X2) and the pinned expectation was not updated. | BE-E / BE-N owner |
| `apps/api/test/integration/contract/response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)" and "every operation: an undeclared request media type is … 400 validation.content_type" (30 s timeout) | × | ✓ (113/113) | **Load-dependent:** passes alone, fails in the full run (one failure is a 30 s timeout). This is a determinism-under-load defect in the F-DG4-143..148 class. | BE-F / contract owner |

**For the orchestrator:**

- The three deterministic failures and the load-dependent contract failure are pre-existing on the integrated tree and outside this task's scope (D-004).
- They need assignment to their owners.
- A full `pnpm test:integration` has to be run where it can finish, for example a session with a longer background limit.

## 5. Operations routed (pending-list delta)

None. This repair routes no operation and changes no API. `apps/api/test/support/p6-pending-*.ts` and `p6-exercises-*.ts` are unchanged. The pinned counts in `contract.test.ts` are unchanged, so there is **no delta** to reconcile.

## 6. Contract, schema, migration or dependency needs

None. There is no new dependency, no migration (so no id was taken) and no OpenAPI or zod change.

## 7. User-facing texts

No user-facing string was added or changed, and the repair ships no feature, so no en/ar text was made untrue (F-DG4-160).

## 8. What remains

- **Acceptance item 3 (integration) is not met.** The full run could not complete within this harness (§4.1). Three integration tests fail deterministically and one file fails under load, all outside this task's scope. They are listed in §4.1 for their owners.
- The defect this task was assigned is fixed and verified, and acceptance items 1, 2 and 4 pass.
- The A20 axe spec for `/my-work/drafts` was not run here. It belongs to QA-D (§3).
- End time: 2026-10-31T02:39:33Z (73 min after the start).

## 9. Merge instructions

- Integrate the two new paths: this handback and `docs/delivery/handbacks/DG6/T-DG6-FE-X1B-evidence/`.
- The code fix is already on `dg6/fe-x1` in `00be23437`, so merging the branch carries it.
- No migration and no ordering constraint. I expect no conflict: the touched test file and `e2e/support/p6-axe-screens.ts` are owned by FE tasks only.
