# Handback T-DG3-BE-G: pre-freeze test depth (REQ-PB-032) and FE-D backend defects (backend-workflow-engineer)

- **Stage:** P3 / DG3 (BUILDING), the last implementation step before the candidate freezes.
- **Invocation:** `DG3-T-DG3-BE-G-backend-workflow-engineer-20261008T052655Z-ece72f06` (session `ece72f06-9355-46b7-8f4b-a9804d3334a2`).
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-G.md`. Its sha256 `5bb57ed6…fed32` matched before I started.
- **Base:** branch `dg3/be-g`, worktree `/home/user/wt/dg3-be-g`, `HEAD` `af78f8b` ("DG3: pre-freeze assignments …"). The tracked tree was clean at the start.
- **Time:** started `2026-10-08T05:27:05Z`, checks finished `05:41:51Z`.
- **Approvals:** this work grants no business, Finance or IT approval. It has nothing to do with any DG0–DG7 or G1–G6 outcome. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/test/integration/portfolio/hierarchy.test.ts` (new) | Integration test of the full nested shape of `GET /transformations/{id}/outcome-hierarchy` (REQ-PB-032), run against a real PostgreSQL. |
| `docs/delivery/handbacks/DG3/T-DG3-BE-G-backend-workflow-engineer.md` (new) | This handback. |
| `docs/delivery/handbacks/DG3/T-DG3-BE-G-evidence/*.log` (new) | Command logs. The absolute worktree and tmpdir paths are replaced with `<worktree>` and `<tmpdir>`. |

No product source, contract (`docs/api/openapi.yaml`, `packages/shared`), migration or dependency changed.

- **Migrations added:** none.
- **API endpoints added:** none.

## 2. Behaviour delivered

### REQ-PB-032: test depth (AN-P3 handback §5 O-1)

The new file builds one synthetic world through the public API, as the TL of a P2 world:

- a North Star (`PUT …/north-star`);
- one outcome;
- two KPI definitions;
- two T02 outcome-KPI rows on that outcome:
  - one with `targetValue "1250.5"` and `targetDate 2027-12-31`;
  - one with no target value and `targetDate 2028-06-30`;
- one initiative;
- two contributions from that initiative:
  - one to the first KPI;
  - one with only an outcome and no KPI.

It runs three tests.

**1. "returns all five levels, linked, field by field"**

- **Contract:** the body passes the strict shared zod mirror `outcomeHierarchy.parse`, so it has no extra and no missing fields.
- **North Star:** `id`, `statement`, `status: "current"` and `transformationId`.
- **Outcomes:** exactly one entry, with the right `id`, `statement` and `transformationId`.
- **KPIs:** `kpis[]` is in ordinal order, `[outcomeKpiId, unsetKpiId]`, and each entry has the right `kpiDefinitionId`.
  - **Target value:** `targetValue` is a `string` that matches a decimal pattern. It is exactly `"1250.500000"`, the `numeric(24,6)` value as stored, with no float rounding.
  - **Target date:** `targetDate` is `"2027-12-31"`.
- **Unset target:** `targetValue` is `null`, so it shows as Unknown and never as `0`. Its `targetDate` is `"2028-06-30"`, and its `contributions` is `[]`.
- **`kpis[].contributions[]`:** exactly the contribution to that KPI, with the right `id`, `initiativeId`, `transformationId`, `outcomeId`, `outcomeKpiId`, statement, `status: "active"`, `removedAt: null` and `version: 1`.
- **Outcome-level `contributions[]`:** exactly the contribution without a KPI, with `outcomeKpiId: null`.
- **No duplicates:** no contribution appears twice anywhere in the tree.
- **Agrees with T02:** the target value and date match the T02 row from `GET …/outcome-kpis/{id}`.

**2. "refuses a contribution without an outcome (400 at /outcomeId) and the tree is unchanged"**

Three request bodies each return 400 with an error at `/outcomeId`:

- the outcome is missing;
- a KPI is given but no outcome;
- `outcomeId: null`.

Afterwards the initiative still has only the two contribution rows in the database, and the hierarchy response is deep-equal to the one from before the requests.

**3. "is readable by AUD … not by another organization or an unscoped user"**

- **AUD:** gets 200 and the same tree as the TL.
- **Refused callers:** the TO of org B and a user with no role both get `404 not_found`. This is the read-denial shape from `requireRead` in `apps/api/src/modules/access/policy.ts`, which doesn't reveal that the record exists. Neither response contains the outcome or the North Star text.
- **Why 404 for both:** I first expected a 403 for the user with no role. The real stack answers 404, which is consistent with `requireRead`, so I corrected the test. That isn't a defect.

**The test catches regressions.** I made two temporary changes to `apps/api/src/modules/portfolio/hierarchy.ts`, ran the file against each one, and then restored the source (`git diff --exit-code apps packages` was clean afterwards). Each change made the test fail:

- An unset target reported as `"0"` (`?? "0"`): fails with `expected '0' to be null` (`10-mutant-unset-target-as-zero.log`, exit 1).
- A no-KPI contribution also placed under each KPI: fails with `expected [ {…} ] to deeply equal []` (`11-mutant-no-kpi-under-kpi.log`, exit 1).

The existing coverage in `readiness.test.ts` (an empty tree, then a North Star and one outcome) and in `links.test.ts` (the contribution validation rules) is unchanged.

### FE-D backend defects (scope item 2)

FE-D's handback §5 reports **no reproduced backend defect**, so I made no change for this item:

- **§5 item 1 (the G4 refusal message shape):** FE-F handles it on the web side and keeps the DG2-approved server shape (ADR-0021 §7). I didn't touch it.
- **§5 item 2 (the roles seeded for the author-cannot-validate rule):** an observation about the seeded roles, not a defect.

While working on item 1 I found no real defect. I also checked `targetDate: String(k.target_date).slice(0, 10)`:

- `outcome_kpi.target_date` is `date NOT NULL` (migration `0014`);
- the `pg` DATE parser returns the raw string (`packages/db/src/pool.ts:11`);
- so that line is correct, and the new test confirms the exact date strings.

No contract change is needed.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, in the worktree. Before the test runs I removed any empty `.claude/.cc-writes` directories under `apps`, `packages` and `tests`. Disposable PostgreSQL 16.13 (`tests/qa/support/with-pg.sh`) on port 23100, pool 23101–23149.

| # | Command | Exit | Result (log under `T-DG3-BE-G-evidence/`) |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG2` (at the start) | 0 | `PASS gate DG2 (historical)` (`01-validate-dg2-historical.log`) |
| 2 | `pnpm -r typecheck` | 0 | `02-typecheck.log` |
| 3 | `pnpm -r build` | 0 | `03-build.log` |
| 4 | `pnpm lint` | 0 | `04-lint.log` |
| 5 | `pnpm openapi:lint` | 0 | `05-openapi-lint.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `06-prettier.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 80 files, **1523 tests passed** (`07-test-locale-unset.log`) |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 80 files, **1523 tests passed** (`08-test-c-utf8.log`) |
| 9 | `QA_PG_PORT=23100 MTH_PORT_POOL=23101-23149 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **56 files, 791 tests passed**: BE-F reported 788, plus the 3 new tests. PostgreSQL listened on 23100 on the first attempt. `hierarchy.test.ts (3 tests)` ✓. No failures and no hook timeouts (`09-test-integration.log`) |
| 10 | Mutation 1 (unset target as `"0"`), file run only | 1 (expected) | The new test fails, so it catches the regression (`10-mutant-unset-target-as-zero.log`). |
| 11 | Mutation 2 (no-KPI contribution under each KPI), file run only | 1 (expected) | The new test fails (`11-mutant-no-kpi-under-kpi.log`). |
| 12 | `node tools/gates/validate.mjs --historical --stage DG2` (at the end) | 0 | `PASS gate DG2 (historical)` (`12-validate-dg2-end.log`) |

**Non-zero exits and log matches, disclosed:**

- **Mutation runs 10 and 11:** exit 1 by design. The source was restored after each one.
- **Two of my earlier runs (not logged):**
  - The first run of the new file used a wrong vitest invocation (`--config vitest.integration.config.ts` under `apps/api`). It exited 1 with "Could not resolve config" before any test ran. I re-ran it with `pnpm vitest run --project integration <file>`, which exited 0.
  - One run had a wrong expectation of 403 for the user with no role. I corrected it to 404 (see §2).
- **Log scan:** searching for `hook timed out|Unhandled|ERR_` matches two lines in `09-test-integration.log`. Both are diagnostic stdout from passing tests that exercise those paths on purpose:
  - `FST_ERR_BAD_URL` in `connection-hygiene.test.ts`;
  - `"unhandled error","code":"ECONNRESET"` in the `request-io.test.ts` F-DG2-412 no-over-match case.

  Neither is a failure.

## 4. Known gaps / not done

- **No product change:** none was needed. FE-D reported no backend defect, and I found none.
- **Uncovered branch:** the test doesn't cover the hierarchy branch for "a contribution whose KPI row is archived falls back under its outcome". The assignment didn't ask for it. A follow-up can add it.

## 5. Merge instructions

- New files only, with no migrations and no dependency changes. No conflict is expected with FE-F (`apps/web/src/pages/gates/**`, e2e) or the analyst (`requirements.csv`).
- After merging, run `pnpm test:integration` with `with-pg.sh`. Expect 791 tests, or more if other wave-7 tasks add some.
