# Handback T-DG5-BE-X1 (backend-workflow-engineer): F-DG5-122, G4 over an empty approved portfolio

- **Stage:** DG5 (FIXING after review round 2; D-172). **Task:** T-DG5-BE-X1. **Finding:** F-DG5-122 (Medium, REQ-PB-019).
- **Invocation:** `DG5-T-DG5-BE-X1-backend-workflow-engineer-20261018T151748Z-07568822` (session `07568822-0865-45ae-86ab-94814e40559c`).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-X1.md`. Its sha256 `28f32f8b…3a613b73` was verified before starting.
- **Working tree:** `/home/user/wt/dg5-be-x1`, branch `dg5/be-x1`, starting `HEAD` `017c27c7e3e6b953f600b2b119d51d2599571925`.
- **Time:** started `2026-10-18T15:18:10Z`; ended `2026-10-18T16:37:32Z` (about 80 minutes).
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, both at the start (`T-DG5-BE-X1-evidence/validate-dg4-start.log`) and at the end (`validate-dg4-end.log`).

Product gates G1–G6 are business approvals inside the product. Nothing in this task grants or implies any business, Finance or IT approval, and nothing touches the engineering gates DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/g4.ts` | The fix. The seven criteria over the approved portfolio fail closed on an empty portfolio, with the missing item `g4.no_approved_initiative`. |
| `apps/api/src/modules/workflows/g4.test.ts` | Five new unit tests (`describe "an empty approved portfolio (F-DG5-122, D-172)"`, line 189). |
| `apps/api/test/integration/workflows/g4-empty-portfolio.test.ts` | **New.** The domain reviewer's reproduction as a product integration test, live and frozen (2 tests). |
| `apps/web/src/i18n/en/gates.json` | `missingItems.g4__no_approved_initiative`: "No initiative in the approved portfolio" (line 121, next to `g4__portfolio_empty`). |
| `apps/web/src/i18n/ar/gates.json` | `missingItems.g4__no_approved_initiative`: "لا توجد مبادرة في المحفظة المعتمدة" (line 121). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-X1-*` | This handback and its logs. |

- No migration was added, and no API endpoint was added or changed.
- `criteria.ts` is unchanged: it already feeds the same `G4_EVALUATORS` to the live view and to the submission.
- The untracked `.zshrc`, `CLAUDE.local.md` and dot-files at the tree root were already there and are not mine.

## 2. F-DG5-122: cause, fix and regression test

### Cause

`apps/api/src/modules/workflows/g4.ts` evaluated each of these criteria "for every initiative in the approved portfolio" (`PortfolioGateFacts.initiatives`, the initiatives with status selected, funded or launched):

- `g4.roadmap`, `g4.owners`, `g4.funding`, `g4.capacity` and `g4.prioritization`;
- the per-initiative parts of `g4.business_cases` and `g4.finance_validation`.

Over an empty array, each of those loops produced no missing item, so each criterion was **Complete vacuously**. Only `g4.initiative_cards` refused an empty portfolio (`g4.portfolio_empty`). Once that one criterion was covered by an accepted exception, the others read green with no evidence, both live and in the frozen submission (the same evaluators feed both: `criteria.ts` `EVALUATORS`, `gates.ts` submit).

### Fix (D-172)

| Where | What |
|---|---|
| `g4.ts:247-259` | `NO_APPROVED_INITIATIVE()` returns `{ code: "g4.no_approved_initiative", message: "No initiative in the approved portfolio", pointer: "/initiatives" }`. `emptyPortfolio(scope)` returns that one item for a loaded, empty portfolio, and `[]` otherwise. |
| `g4.ts:300-301` | `g4.business_cases`: the transformation-level checks are unchanged (`g4.business_case_missing` and its sections); the empty-portfolio item is added after them. |
| `g4.ts:341-342` | `g4.finance_validation`: the transformation case's baseline and its formula versions are still checked; the empty-portfolio item is added after them. |
| `g4.ts:354-366` | `g4.prioritization`: with no current ranking, both `g4.prioritization_missing` and the empty-portfolio item; with a current ranking over no initiative, the empty-portfolio item. |
| `g4.ts:378` | `g4.roadmap`: starts from the empty-portfolio item. Schedule conflicts and unknowns are still listed. |
| `g4.ts:397-403` | `g4.owners`. |
| `g4.ts:412-418` | `g4.funding`. |
| `g4.ts:428` | `g4.capacity`: starts from the empty-portfolio item. Capacity conflicts, including Unknown, are still listed. |
| `g4.ts:8-9` | The header comment states the rule. |

What did not change:

- **`undefined` (facts not loaded)** keeps the existing NOT_LOADED item of each criterion and never adds the empty-portfolio item (unit test).
- **`g4.initiative_cards`** keeps `g4.portfolio_empty` ('Initiative cards').
- **The exception rules** in `gate-exceptions.ts` and `gates.ts` are untouched. An exception covers one criterion. With the portfolio empty, a G4 submission now needs an accepted exception per incomplete criterion, as for any incomplete mandatory criterion (integration test 2).
- **One shared code** (`g4.no_approved_initiative`) is used rather than one code per criterion. The criterion key already says which criterion it is (pointer `/criteria/<key>` in a 422, and the row on the gate page), and the code names the cause.

### Regression test: the reviewer's reproduction

`apps/api/test/integration/workflows/g4-empty-portfolio.test.ts`:

**Test 1 (line 169): the live readiness.** The setup:

- a gate world at `mobilize`, with G1–G3 staged approved by audited fixtures and one draft initiative, so the approved portfolio is empty (asserted);
- a complete transformation-level business case, with an investment line and a benefit line backed by a T09 formula, written by the TL;
- its baseline and the formula version validated by FIN, never the author;
- an accepted exception on `g4.initiative_cards` only (TL requests, the Sponsor accepts).

It asserts the following:

- `g4.initiative_cards` still reads `g4.portfolio_empty`;
- `g4.business_cases`, `g4.finance_validation`, `g4.roadmap`, `g4.owners`, `g4.funding` and `g4.capacity` each carry exactly `[g4.no_approved_initiative]`. The transformation-level parts hold, so the per-initiative part alone makes them incomplete;
- `g4.prioritization` contains it;
- **the final assertion:** all seven read `incomplete`, `canSubmit` is false, and the submission is refused with 422 `gate_criteria_incomplete`, with errors at exactly those seven `/criteria/<key>` pointers.

**Test 2 (line 196): the frozen submission.** It covers each incomplete criterion with its own accepted exception: exactly Initiative cards plus the seven. The submission is then 201, and these all record the seven criteria as `incomplete`, each with its own exception id:

- the snapshot `criteria[]`, whose `missing` contains `g4.no_approved_initiative`;
- the `gate_submission_criterion` rows;
- the submission's criteria table (`GET …/gates/G4/submissions/{n}/criteria`).

The snapshot's `g4.initiatives`, `fundingDecisionIds` and `committedDemandIds` are `[]`.

**Failing before the fix:** the final test file was run on the unfixed `g4.ts` (`git show HEAD:…/g4.ts`, restored afterwards), with exit 1 and 2 of 2 failed (`T-DG5-BE-X1-evidence/repro-failing-before.log`):

```
× … the live G4 reads every portfolio criterion incomplete, naming the cause
  → expected [ 'g4.business_cases', [] ] to deeply equal [ 'g4.business_cases', [ { …(3) } ] ]
× … a submission on an empty portfolio needs one accepted exception per incomplete criterion and freezes them incomplete
  → expected [ 'g4.initiative_cards', …(1) ] to deeply equal [ 'g4.business_cases', …(7) ]
     Received: [ "g4.initiative_cards", "g4.prioritization" ]
```

The second failure is the demo's situation exactly. On the unfixed code only Initiative cards and Prioritization are incomplete, and Business cases, Finance validation, Roadmap, Owners, Funding and Capacity read complete over no initiative.

**Passing after the fix:** 2 of 2, inside the integration run of §3 (433/433).

**Unit tests:** `g4.test.ts:189`, five tests.

- Roadmap, owners, funding and capacity carry exactly the one item.
- Prioritization, both with a ranking over no initiative and with no ranking.
- Business cases and Finance validation:
  - a complete, validated transformation part is not enough;
  - a missing transformation case is reported beside the empty item;
  - an initiative case of an out-of-portfolio initiative does not count.
- Initiative cards keeps `g4.portfolio_empty`, and conflicts are still listed beside the cause.
- Every criterion is incomplete on an empty portfolio. With facts not loaded, the NOT_LOADED item stays and the empty item never appears.

On the unfixed `g4.ts` these five fail and the five existing tests pass (`unit-g4-failing-before.log`: 5 failed, 5 passed, exit 1). After the fix, 10 of 10 pass.

## 3. Checks (each run once, one at a time; D-164)

Environment: Node 24.21.0, offline. Ports: 23000 (PostgreSQL), 23001–23049 (pool), 23010/23020 (e2e PostgreSQL and API). Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-X1-evidence/`.

| Check | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-start.log` |
| `pnpm -r typecheck` (1st) | **2** | TS2375 in my new unit test (`initiatives: undefined` under `exactOptionalPropertyTypes`). I fixed the test with a rest destructuring; the product code was not affected. | `typecheck-attempt1-exit2.log` |
| `pnpm -r typecheck` (after the fix) | 0 | all packages | `typecheck.log` |
| `pnpm -r build` | 0 | all packages | `build.log` |
| `pnpm lint` | 0 | | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| `npx vitest run --project unit-node apps/api/src/modules/workflows`, locale unset | 0 | 3 files, **26/26** | `unit-node-workflows-unset.log` |
| the same with `LANG=LC_ALL=C.UTF-8` | 0 | 3 files, **26/26** | `unit-node-workflows-C.UTF-8.log` |
| `npx vitest run --project unit-web apps/web/src/i18n apps/web/src/pages/gates`, locale unset | 0 | 9 files, **133/133**: the i18n guard tests (`i18n.test.ts`, `glossary.test.ts`, `problems-*.test.ts`) and the gate page tests | `unit-web-i18n-gates-unset.log` |
| the same with `C.UTF-8` | 0 | 9 files, **133/133** | `unit-web-i18n-gates-C.UTF-8.log` |
| `QA_PG_PORT=23000 MTH_PORT_POOL=23001-23049 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/workflows apps/api/test/integration/portfolio apps/api/test/integration/contract/contract.test.ts tests/qa/integration/a08-* tests/qa/integration/a09-*` (the new test is under `workflows/`) | 0 | 40 files, **433/433** | `integration.log` |
| the same harness, `apps/api/test/integration/gates` (the path filter matches the DG3 G4 suite `gates/g4.test.ts` and the DG2 `gates.test.ts`) | 0 | 2 files, **17/17** | `integration-gates.log` |
| the same harness, `apps/api/test/integration/environment/demo-gate-history.test.ts` (BE-X2's file; run to disclose) | **1** | 1 failed, 1 passed: **expected, see §4** | `demo-gate-history-expected-fail.log` |
| e2e run 1: `E2E_PG_PORT=23010 E2E_API_PORT=23020 MTH_PORT_POOL=23021-23049 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p3-journeys.spec.ts apps/web/e2e/p4-gates-closure.spec.ts --workers=1 --project=chromium-en --project=chromium-ar --reporter=line` | killed | **Incomplete.** My own 10-minute background limit, which was too short, stopped it at test 39 of 54. Before that, `p4-gates-closure.spec.ts` test 9 [chromium-en] failed on the 30 s test timeout (see below). | `e2e-g4-journeys-run1-killed-by-timeout.log` |
| e2e run 2: the same command, with a 2 h limit | **1** | **52 passed, 2 failed** (12.9 min). Every G4 journey passes in en and ar: p3 6a (refusal naming 'Owners' and 'Finance validation'), 6b, 6c (approval, phase Transform), and the rest of p3 and p4. The 2 failures are `p4-gates-closure.spec.ts` test 9 in [chromium-en] and [chromium-ar]: `Test timeout of 30000ms exceeded` at `await audUi.close()` (line 702), after the test's last screenshot. | `e2e-g4-journeys.log` |
| e2e diagnosis: `p4-gates-closure.spec.ts` alone, `--reporter=list` (with durations), on the fixed build | **1** | 17 passed, 1 failed: test 9 failed in en at **30.2 s**; in ar it passed at **29.5 s**. Load average 7.8 to 11.3. | `e2e-p4-alone.log` |
| e2e baseline: the same spec on the **unfixed** tree (`g4.ts` and both `gates.json` restored from `HEAD`, rebuilt, and then my fix restored and rebuilt, `pnpm -r build` exit 0) | **1** | 17 passed, 1 failed: **the same test 9 in en, at 30.2 s**; in ar it passed at 26.1 s. | `e2e-p4-alone-baseline-unfixed.log` |
| `pnpm -r build` (final, after restoring the fix) | 0 | the dist contains `g4.no_approved_initiative` | `build.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-end.log` |

**The e2e failure (disclosed):** the G4 journeys pass, so acceptance item 4 holds for G4. The full command still exited 1, and that is the result I report. The one failing test, `p4-gates-closure.spec.ts` "9. the auditor sees read-only views; 390 px wide and 200 % text …", is **not caused by this change**:

- **It does not reach G4.** It opens only the G5, G6 and Modular G3 pages, and their evaluators are untouched.
- **It fails identically on the unfixed tree.** On the baseline build it took 30.2 s in en, the same as on the fixed build.
- **It is a timing budget.** It runs about 26–30 s against Playwright's default 30 s and carries no `test.setTimeout`. Every step completes, and the timeout lands on the final `context.close()`. The machine was shared with the other wave-X tasks, at load average 8–11.
- **Its history:** D-171's merged-tree product e2e (442/442 in both locale settings) passed it. The spec's last change (`260e6c8`, FE-V1B) added a readiness-line assertion to an earlier test, not to test 9.

The spec is outside my ownership, so I did not edit it. **For the orchestrator:** give it an explicit `test.setTimeout` with at least 2× its measured duration (the F-DG5-121 precedent), or confirm it on the merged-tree verification at normal load. The Playwright screenshots and traces were in my run's scratch and were removed; the logs keep the paths.

**Not run, per D-164:** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They run once on the merged tree in the orchestrator's verification.

## 4. Existing tests whose expectation changes

- **DG3 and DG4 G4 tests: none changed.** `gates/g4.test.ts` (DG3, 17/17 with its sibling file) and `workflows/gate-exceptions.test.ts`, `gate-commit-time.test.ts`, `gate-events.test.ts`, `portfolio/readiness.test.ts`, a08 and a09 all pass unchanged. Two notes:
  - `gates/g4.test.ts:423`, the empty-portfolio case, asserts only the `g4.initiative_cards` item, which is unchanged.
  - Every other G4 test runs on a non-empty portfolio.
- **The existing unit test** `g4.test.ts` "an empty portfolio, …" asserts only `g4.initiative_cards` on an empty portfolio, and is unchanged and passing.
- **`apps/api/test/integration/environment/demo-gate-history.test.ts` (owned by T-DG5-BE-X2; not edited):** it fails on this tree alone, as D-172 predicts. On the current demo data, the demo's live G4 now reads `g4.business_cases` (the first failing key) and the other portfolio criteria incomplete:
  ```
  AssertionError: G4 g4.business_cases: incomplete [{"code":"g4.no_approved_initiative","message":"No initiative in the approved portfolio","pointer":"/initiatives"}]
  ```
  - Its pinned expectation, that the G4 incomplete set is `["g4.initiative_cards","g4.prioritization"]`, is the vacuous reading F-DG5-122 removes.
  - BE-X2's repair (a real approved portfolio INI-01..03, with the two exceptions removed) is what makes it true again.
  - **Merge order:** integrate BE-X2 with this task, and run this file on the merged tree.
- **Demo-based e2e and QA specs**, if any read the demo G4 live (the four demo specs, `p5-reflow-axe` on demo data), may read more criteria incomplete on this tree alone, for the same reason. I did not run them: they are outside my reach list, and they depend on BE-X2.

## 5. Contract, schema and dependency needs

**None.**

- `Warning.code` is a free string in `docs/api/openapi.yaml` and in the zod mirrors, and no enumeration of G4 missing-item codes exists there (checked with grep).
- No new operation, no new response shape, no migration and no dependency.

## 6. ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R5)

- **ADR-0021 §7, "G4 scope" (line 159):** "An empty scope makes `g4.initiative_cards` incomplete (`g4.portfolio_empty`)." This is now incomplete. An empty scope also makes `g4.business_cases`, `g4.finance_validation`, `g4.prioritization`, `g4.roadmap`, `g4.owners`, `g4.funding` and `g4.capacity` incomplete, each with the missing item `g4.no_approved_initiative` 'No initiative in the approved portfolio' (pointer `/initiatives`). Not loaded stays NOT_LOADED.
- **ADR-0021 §7, the criteria table (lines 166–172):** each "every in-scope initiative …" rule now also requires at least one in-scope initiative, and the "Missing items" column lacks `g4.no_approved_initiative` for those seven rows.
  - `g4.business_cases` and `g4.finance_validation`: complete only if the transformation-level part **and** a non-empty per-initiative part hold.
  - `g4.prioritization`: with no ranking, both items are listed.
- **ADR-0035 §4 (exceptions):** unchanged in rule. It may want a sentence saying that on an empty portfolio an exception on 'Initiative cards' covers that criterion only, so a submission needs one per incomplete criterion. D-172 assigns this amendment ("G4 readiness on an empty portfolio") to ARCH-R5.
- **ADR-0050 (demo gate history):** its statement that the demo G4 rests on two exceptions over an empty portfolio is BE-X2's subject. This task makes the old two-exception G4 read eight incomplete criteria (see §4).
- **The data dictionary and ERD:** no table or column changed. If the dictionary lists the G4 missing-item codes, add `g4.no_approved_initiative`. I found no such list (grep of `docs/` for `g4.portfolio_empty` hits only ADR-0021).

## 7. User-facing texts

- **New:** `gates.missingItems.g4__no_approved_initiative`, in en ("No initiative in the approved portfolio") and ar ("لا توجد مبادرة في المحفظة المعتمدة"). The gate page renders it through the existing `m.code` → `missingItems.<code with __>` lookup (`GateDetailPage.tsx:366, 591, 995`), so the page names the cause in both languages.
- **Made untrue by this fix:** on the current demo data alone, the seeded demo G4 readiness ('6 of 8 mandatory outputs complete; the other 2 are covered by accepted exceptions') and GD-04 ('The portfolio is executable and value-backed'). Those texts are seeded and computed in `packages/db/src/demo/**`, which BE-X2 owns, and their repair is BE-X2's (D-172). I did not edit them.
- **The product's own strings** ('An exception lets one mandatory criterion be submitted incomplete', the readiness and covered-note lines) stay true. They are now more accurate, because an exception on Initiative cards no longer turns other criteria green.

## 8. What remains

- **Nothing in my scope.** F-DG5-122's fix, the regression test (failing before, passing after), the unit tests, the en and ar labels and every listed check are done. The only exit codes other than 0 are disclosed in §3 and §4.
- **For the orchestrator or other tasks:**
  - **(a) The demo test.** `environment/demo-gate-history.test.ts` and any demo spec reading the live G4 need BE-X2's demo portfolio (§4).
  - **(b) The e2e budget.** The `p4-gates-closure` test 9 budget fails with and without this change (§3). It needs an owner (FE) or confirmation at normal load.
  - **(c) The ADRs.** ARCH-R5 amends ADR-0021 §7 (and ADR-0035 §4 if it wishes) per §6.
  - **(d) Round 3.** The domain reviewer re-verifies F-DG5-122. I did not close it, as an author never does.
- **Not run, per D-164:** `pnpm test`, `pnpm test:integration` and the full e2e suite.

## 9. Merge instructions

- No migration and no ordering constraint within the API.
- Merge together with T-DG5-BE-X2. Until BE-X2's demo portfolio is in, `environment/demo-gate-history.test.ts` and any demo spec that reads the live G4 will fail on this tree (§4).
- **Expected conflicts:** none in code. `apps/web/src/i18n/{en,ar}/gates.json` gains one line each, at line 121. T-DG5-FE-X1 may touch other keys of these files, so check the merge there.
