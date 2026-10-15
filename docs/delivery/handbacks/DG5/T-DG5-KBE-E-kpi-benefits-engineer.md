# Handback T-DG5-KBE-E (kpi-benefits-engineer): KPI prospective application, restatement create, reconciliation, submit, withdraw

- **Stage:** P5 / DG5 (BUILDING). **Section:** `docs/architecture/p5-work-split.md` §G.1. **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-E.md` (sha256 `fb737f89…ae8b44c4`, verified).
- **Invocation:** `DG5-T-DG5-KBE-E-kpi-benefits-engineer-20261015T165702Z-852c81ca` (session `852c81ca-f49e-422f-bff9-195c8b8cafde`).
- **Base:** `HEAD` `fedb63d153b30c5de86177573cc46efe7fbb03fc` on branch `dg5/kbe-e` (worktree `/home/user/wt/dg5-kbe-e`). The changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-15T17:01:32Z`; end `2026-10-15T18:57Z` (`date -u`, `T-DG5-KBE-E-evidence/end-time.txt`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** at the start (`PASS gate DG4 (historical)`), and again at the end (§4).
- **Two gate systems.** Deciding a restatement is a business approval inside the product (KBE-E2's `decideKpiRestatement`). Nothing in this task decides, approves or grants anything, and nothing reads or writes the engineering gates DG0–DG7. All test and exercise data is synthetic.

## 1. Files changed

| File | Kind | Purpose |
|---|---|---|
| `apps/api/src/modules/kpi/restatements.ts` | filled BE-A's stub | The six routes, plus create, get, list, the reconciliation read, submit and withdraw. Also exports the ADR-0047 §8 refusals (the decision ones included, for KBE-E2), `toKpiRestatement`, `periodsOf`, `lockKpiRestatements` and `restatementApprovers`. |
| `apps/api/src/modules/kpi/restatement-reconciliation.ts` | new | The before/after per selected period, scope and basis. It uses the DG4 KPI library (`@mth/shared/calc` `kpi/**`, unchanged) read-only. It serves as both the draft preview and the rows written at submit. |
| `apps/api/src/modules/kpi/restatement-reconciliation.test.ts` | new | Unit tests (4) of the row mapping: no number unless `ok`, canonical decimals, stored row = preview row. |
| `apps/worker/src/handlers/kpi.ts` | the prospective lines (§G.1) | `OPEN_PERIOD_ONLY_TRIGGERS` (the three non-actual triggers) and the period selection in `runCalculation`: those triggers evaluate the latest **open** period only. See §6 item 1. |
| `packages/shared/src/schemas/kpi-restatement.ts` | new | The zod mirrors: create body, `KpiRestatement`, page, period, reconciliation row and reconciliation. |
| `packages/shared/src/schemas/index.ts` | + barrel line | `export * from "./kpi-restatement.ts"`. |
| `apps/api/src/modules/platform/db-errors.ts` | + the `kpi_restatement.*` lines | `mapP5KpiRestatementError` and its one call line in `mapDatabaseGuardError` (insertions only). |
| `apps/api/src/modules/platform/db-errors-p5-restatements.test.ts` | new | Unit tests (5) of that mapping, with the ADR-0047 §8 codes and texts. |
| `apps/api/test/support/p5-pending-kbe-e.ts` | emptied | All 6 operations are routed. |
| `apps/api/test/integration/contract/p5-exercises-kbe-e.ts` | filled the stub | The 6 operations through the validating client, with every reachable declared refusal, and the 6 zod mirrors. |
| `apps/api/test/integration/kpi-restatements/fixtures.ts` | new | Quarterly periods (2072–2075, a frequency no other suite uses), quarterly KPIs, accepted actuals plus the worker's own recalculation, and request helpers. |
| `apps/api/test/integration/kpi-restatements/restatements.test.ts` | new | The literal §G.1 tests (9 tests; §3). |
| `apps/api/test/integration/contract/contract.test.ts` | **outside my listed files: pin + comment** | Media-type pin `[370, 369, 1]` → `[371, 370, 1]` (+1 JSON body: `createKpiRestatement`). This is the KBE-D/BE-L2 precedent; the orchestrator reconciles it (rule 14). |
| `apps/api/src/modules/kpi/kpi.test.ts` | **outside my listed files: pins** | The kpi module's registered-operation pin gains `KPI_P5_KBE_E_OPERATIONS` (6), and the write-permission set gains `kpi_restatement.request`. Without this, the module's own registration test fails, because the restatement routes register inside the kpi module through BE-A's stub. KBE-F (`formula-preview.ts`) will need the same kind of lines, so expect a union merge here. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-E-kpi-benefits-engineer.md`, `…/T-DG5-KBE-E-evidence/*` | new | This handback and its logs. |

No migration, no new dependency, no OpenAPI change, and no change to `packages/shared/src/formula/**` (rule 9) or to `@mth/shared/calc` `kpi/**`.

## 2. Behaviour delivered (REQ-S07-016, KBE-E's part)

**Acceptance text (binding):** "A07: a prospective target change leaves last quarter's RAG unchanged; a restatement of Q1 without authority is rejected; the Q1 report issued earlier is unchanged and a reissue creates version 2". Per p5-work-split §G.6, KBE-E owns the prospective rule, the restatement and the reconciliation. KBE-E2 owns the authority decision, the recalculation and the reissue offer, and FE-F and QA-B complete the row.

- **"a prospective target change leaves last quarter's RAG unchanged": delivered.** `version_activated`, `threshold_changed` and `trajectory_approved` now evaluate the KPI's latest open period of its frequency. With none open, a run evaluates nothing (status `completed`, `evaluation_count` 0). `actual_accepted` is unchanged. Test (a) (`restatements.test.ts` › "REQ-S07-016 (a) …") does this:
  - It approves a target change (v1 target 100 → v2 target 120) through a DG4 change request, decided by the synthetic BO.
  - It activates the change while Q2 is `scheduled` and Q1 is closed.
  - It asserts that the activation run writes 0 evaluations and that Q1's latest evaluation row (id, version, value, status, RAG, target) is deep-equal before and after. A trajectory approved after Q1 closed gets the same proof.
  - It asserts that Q2, once opened, is evaluated with v2 (`kpi_version_id` = v2, `final_target` 120).
- **"a restatement of Q1 without authority is rejected"** is KBE-E2's decision. KBE-E supplies its preconditions:
  - Creating, submitting or withdrawing needs `kpi_restatement.request`. AUD and outsiders get 403 and nothing is written.
  - The ADR-0047 §8 decision refusals (`no_authority`, `self_decision`, `not_submitted`, `note_required`) are exported from `restatements.ts` with their exact texts, for KBE-E2.
  - The database's `kpi_restatement_sod` is mapped to 403 `kpi_restatement.self_decision`.
- **Restatement (ADR-0047 §2):**
  - It is created as a draft with an approved version (active or superseded) of this KPI and 1–24 explicitly selected closed periods of the version's frequency.
  - An optional `changeRequestId` must be the approved change request that applied this version; otherwise 422 `validation.reference`.
  - At most one restatement per KPI can be in progress, checked under the `kpiRestatement` lock (730266) before any read the decision depends on.
- **Reconciliation retained:**
  - Submit computes the rows in its own transaction under the lock, inserts them while the restatement is still a draft (`kpi_restatement_reconciliation_at_submit`), and then sets `submitted` with `reconciliation_count`.
  - The reconciliation read for a draft computes the rows in a repeatable-read, read-only snapshot (`retained: false`). From submission on, it returns the stored rows (`retained: true`) and never recomputes them.
  - Unknown, stale, not-computable and `none` sides show **no number** and the difference exists only when both sides are `ok` (§6 item 3).
- **Decision tasks:** at submit, one `kpi_restatement_to_decide` work item (createWorkItemOnce, dedupe `kpi_restatement:<restatementId>:<userId>`) is created for each active holder of `kpi_restatement.approve` in the transformation except the requester. A withdrawal of a submitted restatement cancels them.
- **Withdraw:** only the requester can withdraw (403 `forbidden` otherwise, audited as a denial), and only a `draft` or `submitted` restatement; anything else gets 422 `kpi_restatement.not_withdrawable`.

## 3. The §G.1 literal tests and where they are

| §G.1 test | Where | Result |
|---|---|---|
| REQ-S07-016 (a) (see §2) | `restatements.test.ts` › "REQ-S07-016 (a) …" | PASS |
| Restating an open period → 422 `kpi_restatement.period_not_closed` | › "createKpiRestatement refusals" (pointer `/reportingPeriodIds/1`) | PASS |
| A draft version → 422 `kpi_restatement.version_not_approved` | same (also a version of another KPI) | PASS |
| 25 periods → 422 `kpi_restatement.too_many_periods` | same | PASS |
| A second restatement in progress → 409 `kpi_restatement.open_exists` | › "a second restatement in progress …" | PASS |
| Submitting a draft whose periods have no value → 422 `kpi_restatement.nothing_to_reconcile` | same, plus the partial case (§6 item 4) | PASS |
| The retained reconciliation equals the draft preview, and Unknown/stale rows carry no number | › "the retained reconciliation equals the draft preview …" (deep-equal rows), › "stale and unknown sides carry no number …", › "the reconciliation of a formula KPI" | PASS |
| Withdrawing a decided restatement → 422 `kpi_restatement.not_withdrawable` | › "withdrawing a decided restatement …" | PASS (with a **synthetic** decided fixture written directly with its audit event, because the decision route is KBE-E2's) |
| AUD 403 on every write; `If-Match` 428/409; one audit event per row; commit-time re-authorization | › "AUD 403 on every write …" (AUD 403 on create, submit and withdraw, with `authorization.denied` audited; 428/409 on submit and withdraw; exactly one `kpi_restatement.*` event per mutation; a grant revoked while the request waits gives 403 and nothing written, on create and on submit) | PASS |

Also included: periods required (422), duplicate ids, blank reason and unknown fields (400), an unknown period (422 `validation.reference`), and reads (cursor list newest first, 404 outside the transformation, 400 on a malformed id).

## 4. Checks actually run

These are the real exit codes; the logs are in `docs/delivery/handbacks/DG5/T-DG5-KBE-E-evidence/`. Node 24.21.0, offline. Harness ports are from 24300–24349 only.

**Environment note.** Three other W11 agents ran their suites on the same 4-CPU container. The load average was about 27–37 for the whole period from 17:50Z (`/proc/loadavg`), and that drives the timeouts below.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` (re-run after the last source edit) | **0** | all packages Done | `typecheck.log` |
| 1 | `pnpm -r build` | **0** | all packages Done | `build.log` |
| 1 | `pnpm lint` (`eslint . --max-warnings=0`) | **0** | clean | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (re-run at the end, with this handback: exit 0) | `prettier-pre.log`, `prettier-final.log` |
| 1 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **1 (FAIL)** | unit-node 1978/1979; unit-web 1425/1429; unit-formula-nocodegen 259 + 2 skipped by design. The 5 failures are all timeouts: `architecture.test.ts` › "every import respects dependsOn …" (`Test timed out in 30000ms`), and unit-web `app.test.tsx` › "bilingual shell …", `dispensations.test.tsx` (20 s timeouts) and `raid.test.tsx` en/ar (`findBy` gave up). | `unit-final-locale-unset.log` |
| 2 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **1 (FAIL)** | unit-node 1978/1979; unit-web 1418/1429; unit-formula-nocodegen 259 + 2 skipped. The same architecture-walk timeout, plus 11 unit-web timeouts or `findBy` misses in capacity, kpiUnit, percentKpi, prioritization, portfolio, raid, roadmap and fe-e. | `unit-final-c-utf8.log` |
| 2 | Isolated re-run: `vitest run --project unit-node apps/api/src/architecture.test.ts apps/api/src/modules/kpi/ apps/api/src/modules/platform/`, both locales | **1 (FAIL)** | 407/408 each. The only failure is again the architecture walk, `Test timed out in 30000ms` (it took 80 s and 53 s under load). | `isolated-unit-node-*.log` |
| 3 | `QA_PG_PORT=24310 MTH_PORT_POOL=24311-24349 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **248 files, 2398/2398** (started 17:50Z, finished 18:57Z under load). 2398 = 2389 (D-155) + 9 (`kpi-restatements/`); no pinned integration count changed. | `integration.log` |
| 3 | Targeted integration (same harness, port 24300): `kpi-restatements/` | **0** | 9/9 | `targeted-kpi-restatements.log` |
| 3 | Targeted integration: `contract/contract.test.ts` | **0** | 77/77 (after the media-type pin) | `targeted-contract.log` |
| 3 | Targeted integration: `kpi-p4/` + `workflows/` (the DG4 suites the worker change could affect) | **0** | 36 files, 224/224 | `targeted-kpi-p4-workflows.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (start and end) | **0** / **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4-start.log`, `validate-historical-DG4.log` |
| – | Unit tests of this task: `restatement-reconciliation.test.ts` (4), `db-errors-p5-restatements.test.ts` (5) | **0** | pass in both final runs | in the unit logs |

**Why I attribute the unit failures to load, and what is not proven.**

- No failing test is in a file this task changed, and this task changes no `apps/web` file.
- The failing unit-web set differs between the two runs (4 failures, then 11), and every failure is a timeout or a `findBy` wait.
- The architecture walk (ADR-0002 boundaries) is a 30 s-bounded AST scan of every module file. It **passed** at about 17:45–17:50Z in an isolated run (`architecture.test.ts`, `kpi.test.ts` and `advisory-locks.test.ts`: 3 files, 184/184), after my boundary fixes and under lower load. That run's console output was not saved to a file, which I disclose.
- In every final run, the same boundary check restricted to the kpi module (`kpi.test.ts` › "its declared boundary holds …") passes.
- Acceptance item 2 is **not met** in this environment. A re-run on a quiet machine is needed, and I could not provide one within the time limit.

**Disclosed intermediate failures (fixed):**

- The first unit run (`superseded-unit-run1-*.log`, started before the fixes) failed for three real reasons, all fixed:
  - the module-boundary scanner refused a computed-key assignment in `restatement-reconciliation.ts` (fixed with `Object.fromEntries`);
  - the lock number 730266 was spelled in two comments (the registry test forbids that);
  - the kpi module's registration and permission pins needed the new routes (§1).
- Targeted integration runs failed four times before passing. The causes were all in my tests, not the product: a version body missing the `dataQuality` members the contract requires; a draft version without `changeReason`; outsider writes that are 403, not 404, by the commit-time rule; and an `authorization.denied` query on the wrong record id. The contract test also failed once on the media-type pin before it was updated.

## 5. Operations routed (delta to `p5-pending-kbe-e.ts`)

`P5_PENDING_KBE_E`: 6 → **0**. Removed: `listKpiRestatements`, `createKpiRestatement`, `getKpiRestatement`, `getKpiRestatementReconciliation`, `submitKpiRestatement`, `withdrawKpiRestatement`. Each is exercised in `p5-exercises-kbe-e.ts` through `ctx.mirrored`, with:

- **create:** 201, 400, 403 (AUD; outsider, commit-time), 404 (unknown KPI), 409 and 422 (version, periods, period);
- **list:** 200, 400, 404;
- **get:** 200, 400, 404;
- **reconciliation:** 200 (draft and retained), 400, 404;
- **submit:** 200, 400, 403, 404, 409, 422 (`not_draft`, `nothing_to_reconcile`) and 428;
- **withdraw:** 200, 400, 403 (AUD; a non-requester), 404, 409, 422 and 428.

**Pinned-count deltas for the orchestrator:**

- The media-type triple goes from `[370, 369, 1]` to `[371, 370, 1]` (+1 JSON body: `createKpiRestatement`; submit and withdraw are bodiless, the other three are GETs). I applied this in `contract.test.ts` and disclose it in §1.
- The operation count is unchanged at 846, and the rate-limit floor is unchanged.

## 6. Contract, schema, decision and design points for the orchestrator

1. **Reopen candidate (ADR-0047 §1): implemented as the ADR proposes, pending your decision.**
   - I found no recorded orchestrator decision on it (D-141 to D-155 were searched). The assignment puts the lines in my scope and says "if it is declined, only `version_activated` changes".
   - I therefore implemented the ADR's proposal: all three non-actual triggers recalculate the latest open period only. It sits behind one exported constant, `OPEN_PERIOD_ONLY_TRIGGERS` in `apps/worker/src/handlers/kpi.ts`. If you decline, reduce that set to `["version_activated"]`; it is a one-line change, and test (a)'s trajectory sub-check would then be removed.
   - The DG4 KPI and workflow suites (`kpi-p4/**`, `workflows/**`: 36 files, 224 tests) pass with the change. The full integration suite passes too (2398/2398, §4).
   - Interpretation (ADR-0047 §1): "next period" means the first open period. A version activated while a period is open is applied to that open period.
2. **The 25-period refusal and the create body schema.** The contract's `KpiRestatementCreate.reportingPeriodIds` declares `minItems: 1, maxItems: 24`, but §G.1 requires 422 `kpi_restatement.too_many_periods` for 25 and ADR-0047 §8 requires 422 `periods_required` for none.
   - The zod mirror therefore admits 0–100 unique ids, and the API returns the two exact 422s. A request the API accepts always satisfies the contract (the validating client checks it).
   - **Proposal:** the architect relaxes the contract's bounds to `maxItems: 100` (no `minItems`) and names the two 422s in the description, so that the contract and the zod mirror match.
3. **"Unknown/stale rows carry no number" versus the database CHECK.** The ADR and the contract say a stale side carries no number, but `0085`'s `kpi_restatement_reconciliation_before`/`_after` require a value exactly when the status is `ok` or `stale`.
   - The API therefore stores the stale number, because the CHECK demands it, and never shows it: the API row has `value: null` unless the status is `ok`, and the difference is null unless both sides are `ok`.
   - This is tested at the API and at the stored row. If the architect prefers the database to hold NULL for stale, a forward migration that changes those two CHECKs to `IN ('ok')` would align it, and the API would need no change.
4. **A refusal code not in ADR-0047 §8.** Submitting a restatement where some, but not all, selected periods have a value would trip the database's `kpi_restatement_reconciled`. The API refuses first with 422 `kpi_restatement.nothing_to_reconcile` (the ADR's exact text) and `errors[0].pointer` `/periods/<index>`, which names the first period without a value.
   - The text says "None of the selected periods …", which is not exact for this case.
   - **Proposed code for the architect:** `kpi_restatement.period_without_value`, "Every selected period needs a value to restate; remove the periods that have none."
5. **Withdraw by a non-requester.** The contract says "(kpi_restatement.request; the requester)", and the ADR has no code for it. I used the generic 403 `forbidden`, "Only the requester of a restatement can withdraw it.", audited as a denial. A dedicated code can be added by the architect if wanted.
6. **Writes from outside the transformation get 403, not 404.** That is the platform's commit-time rule (`commitTimeDenial`, F-DG2-440), applied by `openWrite(…, { atCommit: true })` as in every DG4 kpi write.
7. **Formula KPIs in the "after" side.** When the restated KPI is a formula KPI, each input is bound to its source's latest stored evaluation of the same scope and period, on the input's own basis. A restatement changes one KPI; its sources keep their own evaluations.
   - The worker's run may instead compute a source in the same run. KBE-E2's restatement run should use the same binding, so that the applied values equal the retained "after" values.
   - `restatement-reconciliation.ts` ports `evaluateSlot`/`toEvaluationRow`'s value, rounding and RAG rules, because the API cannot import the worker (ADR-0002 rule 5). It does not port trend, variance or findings, which the reconciliation does not show.
8. **No dependency is needed.**

## 7. User-facing texts made untrue (F-DG4-160), and the work-item text

- **`apps/web/src/i18n/{en,ar}/changeRequestsP4.json` › `effectiveFromHint`** (owner: FE; not my file). The current text, "… A past date is a retrospective restatement, which is not supported." / "… التاريخ الماضي يعني إعادة بيان بأثر رجعي، وهذا غير مدعوم.", becomes untrue now that closed periods can be restated, through a separate record. Proposed replacement:
  - en: "Leave empty to apply from now on. A change request cannot take effect in the past; restate closed periods through a KPI restatement."
  - ar: "اتركه فارغًا ليسري من الآن. لا يسري طلب التغيير بأثر رجعي؛ أعد بيان الفترات المغلقة من خلال إعادة بيان مؤشر الأداء."
- **`change_request.retrospective_not_supported`** (API text in `packages/shared/src/schemas/change-control.ts`, and en/ar `problems.json`) becomes untrue as worded. ADR-0047 §3 assigns this change to **KBE-E2**, with the new English text "A change request takes effect from now on; restate closed periods through a KPI restatement.", and the en/ar keys go to the orchestrator (§5.3). I did not change it.
- **Made true, unchanged:** `kpi_actual__period_not_open` ("… a closed period is corrected through a restatement.") and `kpiP4.json` `closedNote` ("Closed (corrections need a restatement)").
- **New message key without a translation:** `kpi_restatement.to_decide` (params `kpiName`, `periodCount`) is the decision task's message. Its i18n text and the `PRODUCED` entry in `apps/web/src/pages/my-work/message-keys.test.ts` belong to the web owner (FE-F). Until then My Work shows its neutral fallback, never a raw key. Proposed texts:
  - en `kpi_restatement__to_decide`: "Decide the restatement of {{kpiName}} ({{periodCount}} periods)";
  - ar: "قرّر إعادة بيان {{kpiName}} (عدد الفترات: {{periodCount}})".
- **No `problems.json` keys exist yet for the `kpi_restatement.*` codes.** They go to the orchestrator's append-only merge or to FE-F. The ADR-0047 §8 English texts are the source; the Arabic texts are to be provided as provisional translations.
- The navigation entry `nav.p5.kpiRestatement` stays as it is: the screen is FE-F's, and the page does not exist yet, so a "planned" label on it is still true.

## 8. What remains

- **KBE-E2:** `decideKpiRestatement` (authority, self-decision, note), the `kpi_restatement.approved` event and the restatement run with its applied stamp, the reissue offers and `listKpiRestatementReissueOffers`, and the DG4 text change (§7). Its registration line goes in `kpi/restatements.ts`, and it can reuse `restatementRefusals`, `lockKpiRestatements`, `restatementApprovers`, `toKpiRestatement` and `periodsOf`.
- **FE-F:** `pages/kpi-restatement/**`, the i18n texts in §7, and the problem keys.
- **QA-B:** A07.
- **Orchestrator:**
  - decide the ADR-0047 §1 reopen (§6 item 1);
  - decide the contract and CHECK alignment points in §6 items 2–5;
  - merge the `kpi.test.ts` and `contract.test.ts` pins (§1, §5).
- **Not met here: acceptance item 2.** `pnpm test` exited 1 in both locale settings, with load-induced timeouts (§4). It needs a re-run on a quiet machine, for example in the orchestrator's merged-tree verification. No failing test is in a file this task changed.
- Every other §G.1 item is delivered; nothing in KBE-E's scope is left undone.
