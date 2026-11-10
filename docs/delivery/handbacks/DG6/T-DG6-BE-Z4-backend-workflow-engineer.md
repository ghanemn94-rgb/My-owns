# Handback T-DG6-BE-Z4 (backend-workflow-engineer): F-DG6-220, a sensitive benefit's corrective case, transition decision and performance-area link

- **Stage:** DG6 (P6), FIXING after review round 3. **Branch:** `dg6/be-z4`.
- **Base:** `HEAD` `d91ddd95c198b9b641599dd3714bfe0fbf7c481e`. The changes are left **uncommitted** for the orchestrator.
- **Invocation:** `DG6-T-DG6-BE-Z4-backend-workflow-engineer-20261104T182147Z-83c89cb7` (session `83c89cb7-2d4c-4f7d-8100-07537f954cd7`).
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-BE-Z4.md` (sha256 `b8a48531…714b46`, verified).
- **Time:** started `2026-11-04T18:22:04Z`, ended about `19:28Z` (about 66 minutes, within the 2-hour limit).
- **Gates:** marking a record sensitive or granting access is an access decision. Nothing here grants a business, Finance or IT approval (G1–G6), and nothing implies any DG0–DG7 result. All test data is synthetic.

## Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**.

- Run once at the start, before any edit.
- Run again at the end: `T-DG6-BE-Z4-evidence/validate-historical-DG5.log`.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts` | Adds four parameters to `SENSITIVE_REACH_PARAMS`: `correctiveCaseId` → `corrective_case`, `transitionDecisionId` → `transition_decision`, `performanceAreaLinkId` → `performance_area_link`, `benefitEnablerId` → `benefit_enabler`. Every route naming one now answers 404 before its handler (reads and writes) when the row belongs to a sensitive benefit the caller is not admitted to. Header comment updated. |
| `apps/api/src/modules/raid/corrective-cases.ts` | `GET /corrective-actions`: `withoutRestricted` over `corrective_case`. The case of a restricted benefit is absent (filtered after pagination, no count). |
| `apps/api/src/modules/sustainment/transition-decisions.ts` | `GET /transition-decisions`: `withoutRestricted` over `transition_decision`. `POST /transition-decisions` naming a restricted benefit answers the same 422 `validation.reference` as an unknown id, so it discloses neither existence, validated value nor a live decision. |
| `apps/api/src/modules/sustainment/performance-areas.ts` | `GET /performance-areas/{a}/links`: `withoutRestricted` over `performance_area_link` (KPI links have no sensitive owner and stay listed). `POST …/links` naming a restricted benefit answers the 422 `validation.reference` of an unknown id. |
| `apps/api/src/modules/tasks/deep-links.ts` | New `deepLinkChild` and `restrictedLinkChildren`: a link path naming `/corrective-actions/{id}` or `/transition-decisions/{id}` resolves to that child, and the child is checked with `restrictedRecordRefs`. `readableTargets` uses this, so the inbox redaction and `GET /links/{token}` (the one 403 `deep_link.forbidden`) cover these links. |
| `apps/api/src/modules/tasks/index.ts` | Exports `restrictedLinkChildren`. |
| `apps/api/src/modules/tasks/routes.ts` | `GET /me/work-items` and `GET /work-items/{id}`: an item about a restricted case or decision keeps its ids, link, status and version. Its text becomes `inbox.restricted`, with `{}` params and `periodLabel` null. |
| `apps/api/src/modules/reporting/my-work.ts` | `GET /me/work`: same redaction for the work items in sections and upcoming deadlines (`code` null). |
| `docs/api/openapi.yaml` | Summaries only, for 9 operations: `listCorrectiveCases`, `getCorrectiveCase`, `listTransitionDecisions`, `getTransitionDecision`, `listPerformanceAreaLinks`, `listMyWorkItems`, `getWorkItem`, `listMyInbox` and `getMyWork`. They now state the absent row, the 404 and the `inbox.restricted` redaction. No schema, path or status-code change. |
| `apps/api/test/integration/access/sensitive-reach-registers.test.ts` (new) | Product integration test that ports the domain reviewer's probe and widens it (see below). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z4-evidence/*` | Logs of every check below. |

There are **no migrations**. No new operation, route or dependency was added.

## Behaviour delivered

### REQ-S10-002

Acceptance text (quoted): *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*.

This applies the ADR-0051 §2 clause, as amended on 2026-11-04, to the benefit children named in F-DG6-220. For a caller who gets 404 on the sensitive benefit (no grant, not a named party, no `sensitive_record.grant`), such as TL, AUD or a second BO:

- **Lists omit the row, with no count leak.** This covers `GET /corrective-actions` (with and without filters), `GET /transition-decisions` (including `?benefitId=` for the sensitive benefit, which returns `[]`) and `GET /performance-areas/{a}/links`. The filter runs after pagination, as in the overlap list and the ADR amendment, so no total is returned. A plain benefit's rows are still listed.
- **Routes naming a restricted row answer 404** before the handler:
  - Corrective case: `GET`/`PATCH /corrective-actions/{c}`, `POST …/close`, `GET`/`POST …/actions`, `GET …/signals`.
  - Transition decision: `GET`/`PATCH /transition-decisions/{d}`, `POST …/submit`.
  - `POST /performance-areas/{a}/links/{l}/remove`.
  - `POST /benefit-enablers/{e}/remove`. This is the one other `benefitChild` type with its own path parameter that was not yet enforced.
  - The other `benefitChild` types (`benefit_allocation`, `benefit_lifecycle_event`, `benefit_enabler` lists) are reached only under `/benefits/{benefitId}/…`, and `readBenefitRow` already answers 404 there.
- **Creates naming the restricted benefit** (transition decision, area link) answer the 422 `validation.reference` of an unknown id. An admitted caller gets the business rule instead (for example 409 `performance_area_link.exists`), which the test asserts.
- **Inbox, work items, My Work and deep links.**
  - A notification or work item linking to a restricted case or decision is redacted to `inbox.restricted` / `{}`. Its ids and link are kept, which is the ADR-0051 §3 inbox rule.
  - `GET /links/{token}` for such a notification answers the single 403 `deep_link.forbidden`.
  - Text returns on the next request after a grant.
- **Search:** not affected. `search_document` does not index `corrective_case`, `transition_decision` or `performance_area_link` (`SEARCH_RECORD_TYPES`).
- **Dashboards:** they list no rows of these types. Status-model returns only aggregates, which ADR-0051 §8 leaves the same for every reader.
- **Exports:** were already refused by `restrictedAmong` over assembly sources (BE-Y1), as the finding records. Unchanged.
- **Audit routes:** were already redacted (BE-Y1). Unchanged.
- **Positive case:** the TO (`sensitive_record.grant`) and BO (the owner, a named party) list and read everything. BO2 and TL with an explicit grant see the rows and texts again on the next request. AUD still does not.
- **Worker:** the worker's automated reads and writes do not go through HTTP, so the route guard and the list filters do not apply to them. `apps/worker/test/integration/raid-corrective.test.ts` (benefit-variance case opening) and `day-ninety-tasks.test.ts` pass (in the related batch below).

## Tests: probe port, fails before and passes after

`apps/api/test/integration/access/sensitive-reach-registers.test.ts` has 5 tests:

1. **Negative read** (TL, AUD, BO2):
   - The benefit returns 404.
   - The case, the decision and the link are absent from every cursor page (`limit=1`), and the plain benefit's rows are still present.
   - The case item, signals and actions, and the decision item, answer 404. The plain items answer 200.
2. **Negative write** (BO2 holds `corrective_action.manage`, `action.edit`, `transition_decision.propose` and `performance_area.manage`):
   - 7 writes naming a child return 404: case PATCH, close and action create; decision PATCH and submit; link remove; enabler remove.
   - Decision and link creates naming the benefit return 422 `validation.reference`. The owner gets 409 instead.
   - Row versions and statuses are unchanged, and the count of audit events other than `authorization.denied` is unchanged.
3. **Negative inbox:** BO2's work items (list and item), inbox notifications and My Work items about the case and the decision say `inbox.restricted`. Both deep links answer 403 `deep_link.forbidden` for BO2 and 200 for the TO.
4. **Positive:** the TO and BO see everything, and the case body carries `benefitId` and the title.
5. **Positive after grant:** BO2 and TL are admitted after a grant, the texts are restored, and AUD is still excluded.

The test was run against the unfixed source as well as the fixed one:

| Run | Command | Result | Log |
|---|---|---|---|
| **Before the fix** (source reversed with `git apply -R` of the saved patch, then re-applied) | `QA_PG_PORT=28901 MTH_PORT_POOL=28900-28949 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/access/sensitive-reach-registers.test.ts` | **exit 1**, 4 failed / 1 passed. The positive TO/BO test passes, as expected. Failures: TL lists the case; BO2's PATCH of the case returned 200 and changed it; the inbox text was not redacted; AUD lists the case. | `int-registers-before-fix.log` |
| **After the fix** | same command | **exit 0**, 5/5 passed | `int-registers-run1.log` |

## Checks run (real exit codes)

All logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-Z4-evidence/`.

| Check | Command | Result |
|---|---|---|
| Historical DG5 validator | `node tools/gates/validate.mjs --historical --stage DG5` | exit 0, `PASS gate DG5 (historical)` (`validate-historical-DG5.log`) |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`prettier.log`) |
| OpenAPI | `pnpm openapi:lint` | exit 0, `PASS … OpenAPI 3.1.1, 932 operations` (`openapi-lint.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | exit 0. unit-node 190 files / 2899 tests; unit-web 120 / 2020; unit-formula-nocodegen 3 files, 259 passed + 2 skipped (`unit-locale-unset.log`) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0, same counts (`unit-c-utf8.log`) |
| Related integration | `QA_PG_PORT=28910 MTH_PORT_POOL=28900-28949 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <files>` | exit 0, **95 files / 906 tests passed** in 695.8 s (`int-related.log`; file list in `int-related-files.txt`) |
| Final touched-file rerun | same harness, port 28920: the new test, `tasks/` and `reporting/my-work.test.ts` | exit 0, 7 files / 81 tests (`int-final-touched.log`) |

The related integration batch covered:

- **api:** `integration/access/` (all 8 files, including the new one, `sensitive-reach*`, `sensitive-reads*`, `sensitivity` and `read-scope-parity`), `p6-guard-mapping`, `raid/` (corrective cases and rules), `sustainment/` (transition decisions ×3, performance areas, handovers, status-model, controls, closure and others), `benefits/` (all), `search/` (all), `tasks/` (inbox, deep links, work items, fan-out, delivery), `reporting/` (all, including my-work, exports and dashboards) and `contract/contract.test.ts`.
- **worker:** `raid-corrective` and `day-ninety-tasks`.
- **QA:** `a11-value-closure`, `a11-bau-sustain`, `a12-p6-scope-isolation` and `a20-p6-register-1000`.

**Non-zero exits, all disclosed:**

1. `int-registers-before-fix.log` exits 1 by design: it is the run against the unfixed source.
2. The first two runs of the new test failed in the test's own setup, and were overwritten by later runs in `int-registers-run1.log`:
   - The first try bumped `inbox_notification` without a version step (ADR-0003 trigger).
   - The second try bumped it without an audit event (ADR-0004 trigger).
   - The setup now releases a held notification with a version step and its audit event, as the delivery job does.
   A third run failed 2 tests because the test read the My Work response with the wrong shape (`items` instead of `sections[].items`). That was fixed in the test only.
3. An invocation from `apps/api` failed at startup (the Vitest projects path is relative to the repository root), so the tests were run from the root.
4. The first full unit run (`unit-locale-unset-run1-boundary-fail.log`) had 2 failures. The ADR-0002 boundary walker rejects `array[i]` as a "computed member with a non-literal key". This hit `my-work.ts`, `deep-links.ts` and `routes.ts`, and was fixed by using `.at(i)` as the existing inbox code does. Both suites then passed (145/145), and the full unit runs above are after that fix.
5. The related integration batch ran before the `.at(i)` change, which has no behavioural effect. The touched files were rerun afterwards (`int-final-touched.log`, exit 0).
6. A first attempt to start the integration batch with a shell `&` was killed when its shell call returned, and produced no log. It was rerun as a tracked background job.
7. A `git checkout -- apps/api/src`, attempted to produce the before-fix state, was refused: the worktree's git index is read-only in this sandbox. It changed nothing, and `git apply -R` / `git apply` was used instead. The final `git status` shows exactly the files listed above.

## Operations routed (pending-list delta)

None. No operation was added or removed, and `apps/api/test/support/p6-pending-*.ts` is unchanged. `contract.test.ts` passes in the related batch.

## Contract, schema and dependency needs

- **OpenAPI:** summary text only (listed above). No schema change, no zod mirror change, no new status code. The 404 and 422 responses were already declared on these operations.
- **No migration.** **No new dependency.**

## User-facing texts

- The `inbox.restricted` key already exists in en and ar (`apps/web/src/i18n`, rendered by the generic `renderMessage` in the inbox, `MyWorkPage` and `MyWorkSections`). Work items and My Work now use it for this case too, so no new string is needed.
- I found no en/ar string that this change makes untrue.

## For the orchestrator, analyst or architect (not done, outside my write scope or my section)

1. **Register row REQ-S10-002.** The domain reviewer asks that the row describe the repaired state. In the current `notes`, residual (2) (the "domain question" on corrective cases, transition decisions and area links) is now resolved by this change. Residual (1) on scenarios was already stale since BE-Z3. `requirements.csv` belongs to the analyst, so I did not edit it.
2. **ADR-0051 amendment, "Effects on reads".** It could name the new reach parameters, the child-link inbox and work-item redaction (`restrictedLinkChildren`), and the "a create naming a restricted benefit is 422 `validation.reference`" rule. The ADR belongs to the architect, so I did not edit it.
3. **Identifiers still shown elsewhere.** Some other records show the restricted case's identifiers, but none of its values:
   - Action-register rows linked to a restricted case show `correctiveCaseId` and the case `code` as their source (`raid/actions.ts`).
   - Meeting actions and controls show `correctiveCaseId`; controls also show `transitionDecisionId`.
   The ADR rule hides rows that carry the benefit's values, and these rows are the action, meeting action or control, so I left them alone. If a reviewer judges the bare id or code to be a disclosure, the fix is to null the reference through `restrictedRecordRefs`.

## What remains

Nothing in the assigned scope. The full `pnpm test:integration` was not run, as the assignment says; the orchestrator runs it on the merged tree.
