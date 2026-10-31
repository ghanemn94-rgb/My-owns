# Handback T-DG6-BE-X7 (backend-workflow-engineer): register pagination loses a row

- **Stage:** P6 / DG6 (BUILDING). **Branch:** `dg6/be-x7`. **Base:** `83726f23a` (integrated HEAD; `git status` clean at start).
- **invocation_reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-X7-backend-workflow-engineer-20261031T175120Z-a853642e","session_id":"a853642e-1a93-4a51-b2cb-4a1a41bfe9d1"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-X7.md` (sha256 `38047335…87906`, verified).
- **Time:** start `2026-10-31T17:51:34Z` (`date -u`); end `2026-10-31T19:34Z` (`date -u`, §8). About 103 minutes, inside the ~2 h limit.
- **Changes are uncommitted**, as the assignment asks. No migration. No new endpoint. No dependency. Nothing approves anything: product gates G1–G6 are business approvals, and nothing here touches DG0–DG7.

## 0. Assignment gap (stated, not guessed)

The assignment names "`docs/architecture/p6-work-split.md` pre-freeze repair: register pagination loses a row" as my section. **No section with that title exists in `p6-work-split.md`** (711 lines; `grep -i "pre-freeze\|loses a row\|BE-X7"` finds nothing). I worked from the assignment text itself, the §2 shared rules, and the two sections it names: §H/G.5 (BE-R) and §D.5 (BE-V), with their ADRs (ADR-0007 §4/§4a, ADR-0057 §5). The file ownership I used is in §1 below. Some of those files lie outside BE-R's and BE-V's named lines (see §1 and §7).

## 1. Root cause and changed files

**Root cause.** With `sort` absent, `listInitiatives` keeps its DG5 order, `updated_at desc, id desc`. Its cursor carried `r.updated_at.toISOString()`. Node's `pg` driver returns `timestamptz` as a JS `Date`, which has **millisecond** precision, but PostgreSQL stores **microseconds**. So when the last row on a page sat at `…:00.123456`, the cursor said `…:00.123`, and the next page's predicate `updated_at < '…:00.123'` skipped every row in `[.123000, .123456)` with a smaller microsecond. Whether that happened depended on how fast the rows were written: fast sequential inserts often share a millisecond. That's why A20 lost exactly one row (999/1,000) under parallel load and passed alone. The order itself was already total (`id` breaks exact ties). The fault was that the cursor predicate didn't compare the same value as the `ORDER BY`. BE-R had found this case and marked it `it.fails` ("DG5 defect, raised"). This repair removes that mark.

The same defect (cursor = `Date.toISOString()` over a microsecond `timestamptz` column) existed in 16 more `(timestamp, id)` lists. I fixed them all the same way, because the assignment asks that "every list's cursor order is total".

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/platform/cursor.ts` | New helpers `cursorInstant(column)`, which reads the key as UTC ISO-8601 with 6 fractional digits via `to_char(... 'US')`. `cursorInstantText`/`cursorInstantValue` check the cursor's instant: 6 digits, or 3 digits from a pre-repair cursor; must be a real instant; else 400 `validation.cursor`. It is compared as `::timestamptz`. `cursorUuidText` checks the row id (else 400). |
| `apps/api/src/modules/platform/index.ts` | Exports the four helpers. |
| `apps/api/src/modules/portfolio/initiatives.ts` | **The A20 defect.** The sort-absent path selects `cursor_at` (microseconds), compares `updated_at` against it as `timestamptz`, and strips it before the presenter. Order (`updated_at desc, id desc`), items and filter hash are unchanged. |
| `apps/api/src/modules/workflows/t08-dependencies.ts` | `listDependencies` (updated_at): same fix. |
| `apps/api/src/modules/kpi/business-cases.ts`, `kpi/benefit-formulas.ts` | created_at lists: same fix. |
| `apps/api/src/modules/kpi/calculations.ts` | computed_at list: same fix. |
| `apps/api/src/modules/portfolio/selections.ts`, `portfolio/funding.ts` | decided_at lists: same fix. |
| `apps/api/src/modules/portfolio/resource-demands.ts`, `portfolio/overrides.ts`, `portfolio/dispensations.ts` | created_at lists: same fix. |
| `apps/api/src/modules/procedures/instances.ts` | launched_at list: microsecond key; checked cursor values. |
| `apps/api/src/modules/forms/drafts.ts` | The two draft lists (updated_at): microsecond key; checked cursor values. |
| `apps/api/src/modules/integrations/runs.ts`, `integrations/outbound.ts`, `integrations/imports/commit.ts` | The repository list functions also return `cursor_at`. Their predicates already cast text to `timestamptz`; only the key lost precision. |
| `apps/api/src/modules/integrations/routes.ts` | Runs, imports and outbound lists: key `cursor_at`; cursor values checked (400, never a cast error). |
| `apps/api/src/modules/operations/exceptions.ts`, `operations/routes.ts` | `listOperationalExceptions` (last_occurred_at): same; the now-unused `iso` import removed. |
| `apps/api/test/integration/platform/cursor-microsecond-ties.test.ts` | **New deterministic test.** 240 initiatives and 240 T08 dependencies, all inside **one millisecond**: 84 rows share exactly the same instant, and the rest repeat across 40 one-microsecond-apart instants. Initiatives (sort absent at limits 1, 7, 25, 100; `sort=updatedAt` and `-updatedAt` at limit 7) and dependencies (limits 1, 7, 50) must return every row once, in the database's own order. The cursor carries 6 digits; a pre-repair millisecond cursor gets 200; six malformed instants or ids get 400 at `/query/cursor`. |
| `apps/api/src/modules/platform/cursor.test.ts` | Unit tests of `cursorInstantText`/`cursorUuidText`, accepting and refusing values. |
| `apps/api/test/integration/portfolio/initiatives-filters.test.ts` (BE-R's test) | The `it.fails` defect test is now a normal `it`, and it also checks length and exact DB order. The DG5 golden still compares items, order and hash byte for byte; its expected `nextCursor` now carries the microsecond read from PostgreSQL (documented in the test). The default-limit golden is updated the same way. |

**Lists I checked and left unchanged** (their cursor order was already total, with the cursor compared on the same value as the `ORDER BY`):
- **BE-V** (`keysetPage`/`memoryPage`, 15 lists): every SORT ends in a unique key (`id`, or `snapshot_id` unique per restatement, or `block_ref`, the PK). Every key is NOT NULL, or the same `coalesce` appears in both the `ORDER BY` and the predicate (milestones). Timestamps travel as Postgres text. `approval-routes` (`memoryPage`) sorts and compares in JS on `routeKey`, which is unique within a version.
- **BE-R:** the `sort=` paths of `listInitiatives`, `listTransformations` and the 9 register lists already carry microseconds (`to_char … US`) and break ties on `id`.
- **Others:** `listWebhookEndpoints` orders and compares on `date_trunc('milliseconds', created_at), id`, which is consistent with its millisecond cursor. `reporting/modular.ts` sorts and compares the same millisecond string, plus `id`, in memory. The `*_key`/`*_us` lists (jobs, automation, finance validation, dependency slips, corrective cases, tasks, approvals) already carry microseconds.

## 2. Behaviour delivered, per requirement

**REQ-S15-013.** Acceptance (verbatim): *"A20: on a register with 1,000 initiatives, sorting, filtering, paging and hiding a column all work, and the API returns paginated results"*.
- **API half, delivered:** paging the 1,000-initiative register now returns every initiative exactly once, whatever the write timing. The QA test `tests/qa/integration/a20-p6-register-1000.test.ts` (unedited) passes, in the targeted run and in the full run (§3). BE-R's 1,000-row test and the new tie test pass. The tie test fails deterministically against the old cursor (84, 89, 108 and 180 of 240 rows at limits 1, 7, 25, 100; evidence `ties-test-against-old-cursor.log`).
- **Not in scope here:** the UI half (hiding a column, the screen). This repair did not change it.

**Behaviour change for the orchestrator (ADR-0057 §5 "absent = today's result and order"):** items, order and filter hash with absent parameters are byte-identical to DG5. Only the **opaque** `nextCursor` string differs: it now encodes `updated_at` with 6 fractional digits. The contract describes the cursor as opaque (`docs/api/openapi.yaml`, Cursor parameter: "Opaque cursor from a previous page's `nextCursor`"), so this isn't a contract change. A cursor issued before the repair is still accepted. A malformed instant or id in a correctly hashed cursor is now a 400 `validation.cursor` on the repaired lists; before, it reached `new Date()`/SQL casts.

## 3. Checks actually run

Environment: Node 24.21.0, offline. Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`, on harness ports 27500–27549. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-X7-evidence/`.

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` (before implementation) | 0 | `PASS gate DG5 (historical)` | (console; rerun at end, `validate-dg5.log`) |
| `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| `pnpm lint` | 0 | | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| `pnpm openapi:lint` | 0 | | `openapi-lint.log` |
| `pnpm test`, locale unset | 0 | unit-node 186 files / 2,803 tests passed; unit-web 120 / 2,015 passed; unit-formula-nocodegen 3 files / 259 passed, 2 skipped | `test-locale-unset.log` |
| `LC_ALL=C.UTF-8 LANG=C.UTF-8 pnpm test` | 0 | the same three invocations, the same counts: unit-node 186 / 2,803; unit-web 120 / 2,015; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `test-c-utf8.log` |
| `pnpm -r build` (run after the full integration run, because A22 spawns the built worker) | 0 | all packages built | `build.log` |
| Targeted: `QA_PG_PORT=27500 MTH_PORT_POOL=27501-27549 tests/qa/support/with-pg.sh npx vitest run --project integration` over the new test, `portfolio/`, the A20 QA test, `dependencies/`, `kpi/`, `integrations/`, `operations/`, `procedures/`, `forms/`, `hardening/`, `contract/`, `raid/dependency-entries` | 1 | 89 files passed, 1,037 tests passed. **1 file failed:** the new tie test, whose `beforeAll` hit a syntax error in **my fixture SQL** (`timestamptz $1`), so its 12 tests were skipped. Fixed to `$1::timestamptz` | `targeted-integration.log` |
| The new tie test alone, after the fixture fix | 0 | 12/12 | `ties-test.log` |
| The new tie test against the old millisecond cursor (temporarily restored in `initiatives.ts`, then put back; `grep` confirms the fix is in place) | 1 (expected) | 5 failed (the 4 sort-absent walks and the microsecond-cursor check); 7 passed | `ties-test-against-old-cursor.log` |
| Full: `QA_PG_PORT=27500 MTH_PORT_POOL=27501-27549 tests/qa/support/with-pg.sh pnpm test:integration` (locale unset) | 0 | **407 files passed (407); 4,131 tests passed, 1 skipped, 2 todo (4,134).** Duration 4,222 s: slower than the orchestrator's 3,284 s because the unit suites shared the host for the first ~35 min. No failure, retry or timeout. A20 `a20-p6-register-1000.test.ts` 4/4, `initiatives-filters.test.ts` 21/21, `cursor-microsecond-ties.test.ts` 12/12 | `integration-full.log` |

**Pinned counts:** no change. No operation, media type, rate-limit class or CSRF-exempt route was added or removed.

## 4. Operations routed (pending-list delta)

None. This repair routes no operation, so there is no `p6-pending-be-x7.ts` or `p6-exercises-be-x7.ts`. `contract.test.ts` is green in the targeted run.

## 5. Contract, schema or dependency needs

- **Contract:** none (the cursor is opaque).
- **Migration:** none.
- **Dependency:** none.
- **For the architect/orchestrator:** ADR-0057 §5's "byte-identical" rule now holds for items, order and hash, but not for the opaque cursor's bytes. That is the decision this repair takes, because the DG5 cursor lost rows. If an ADR note is wanted, the text is: "the sort-absent cursor carries `updated_at` to the microsecond (T-DG6-BE-X7)". I don't own ADR files, so I didn't edit them.

## 6. User-facing texts

None made untrue. No en/ar string describes the cursor or this defect.

## 7. What remains, and merge notes

- **Ownership:** 17 of the changed files are DG3–P6 modules outside BE-R's and BE-V's named lines (§1). Each edit is mechanical and local to that file's list query: one added `cursor_at` select, the predicate's cast, and the cursor key. If another task edits those list functions at merge, expect small textual conflicts. Resolve them by keeping both.
- **Deterministic tie coverage:** the new test covers `listInitiatives` (the A20 list) and `listDependencies`. The other 15 repaired lists share the same three-line pattern and helper, but are covered only by their existing tests, not by a dedicated tie test. A broader tie test across them would be a follow-up if the reviewers want one.
- **Webhook endpoints** keep their consistent millisecond keyset (`date_trunc`). It is total and lossless. It could move to microseconds later for uniformity, but isn't required.

## 8. Final results

- **Acceptance 1:** `pnpm -r typecheck` 0, `pnpm -r build` 0, `pnpm lint` 0, prettier check 0, `pnpm openapi:lint` 0.
- **Acceptance 2:** `pnpm test` with the locale unset exits 0, and with `C.UTF-8` exits 0. In each run, every Vitest invocation passed (counts in §3).
- **Acceptance 3:** the full `pnpm test:integration` exits 0: 407/407 files; 4,131 passed, 1 skipped, 2 todo. Compared with the orchestrator's run at `043de1e` (406 files; 4,117 passed, 2 failed, 1 skipped, 2 todo), the delta is +1 file and +12 tests (the new tie test), and the 2 A20 failures now pass. No pinned count changed.
- **Acceptance 4:** `node tools/gates/validate.mjs --historical --stage DG5` exits 0 (`PASS gate DG5 (historical)`), at the start and again at the end (`validate-dg5.log`).
- **Disclosed non-zero exits:** (a) the targeted run, exit 1, caused by my own fixture syntax error, fixed and rerun green; (b) the deliberate run of the new test against the old cursor, exit 1, which is the expected proof. No other check exited non-zero.
- **End:** `date -u` = `Sat Oct 31 19:34:43 UTC 2026`.
