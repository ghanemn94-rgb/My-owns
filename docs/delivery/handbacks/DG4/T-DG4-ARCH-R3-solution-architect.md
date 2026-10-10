# Handback T-DG4-ARCH-R3 (solution-architect): P4 architecture repairs, round 3

- **Stage:** DG4 (BUILDING), worktree `/home/user/wt/dg4-arch-r3`, branch `dg4/arch-r3`, base `HEAD` `983fdfa`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-ARCH-R3-solution-architect-20261010T084217Z-9bd43f27` (session `9bd43f27-d0eb-4ef6-9a0c-a6cdc020ed45`). Before starting, I checked the assignment's sha256 `33c2bd85904e12d6266780526035edd5e11d38c5c42f028f456f8288ac545e82` with `sha256sum`, and it matched.
- **Time:** start `Sat Oct 10 08:42:28 UTC 2026`, end @@END@@ (`date -u`; `evidence/start-time.txt`, `end-time.txt`).
- **Preceding gate:** I ran `node tools/gates/validate.mjs --historical --stage DG3` first, before any edit. It printed `PASS gate DG3 (historical)` and exited 0. §3 has the re-run at the end.
- **Two gate systems.** This task reads and writes no DG0–DG7 record other than this handback and its evidence. G1–G6, the G5 scale scope and the Modular waiver are business approvals inside the product. No document, test or script of this task grants one. Product G6 never implies DG7.
- **Ports and disk.** Integration used ports 23700–23749 only. `df -h .` showed 19 GB free before each full run.
- **Untracked files I did not create.** These were present before my first edit (`git status`): the top-level `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md` (character devices, the sandbox's `/dev/null` mounts) and the four `docs/delivery/runs/DG4/*` run folders. I left them untouched.
- **Contradiction in the assignment (disclosed, not guessed around).** The assignment binds "every DG4 decision D-088 to D-113" and asks me to "read D-109 to D-113 verbatim". **`docs/delivery/decisions.md` at `983fdfa` has no D-113**: its newest entry is D-112, and `grep -c D-113` on the file prints 0 in both this worktree and the main tree. I read D-088 to D-112, and D-109 to D-112 verbatim. The only mentions of D-113 are in the W17 assignment files, which call it the W16 integration (FE-D2, FE-F, FE-G, QA-A). Nothing in my items depends on a D-113 text that I could not read. If D-113 decides something about these items, it should be checked against §2.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | Three new GETs (`getInitiativeSchedule`, `listScaleScopeBusinessUnits`, `getAssessmentFormVersion`); `Problem.params`; drill-down `valueClass` and three metrics; description lines. 649 → 652 operations. Every changed line is listed in §5 |
| `docs/architecture/adr/ADR-0031-p4-raid-actions-corrective-execution.md` | Amendment S1: `getInitiativeSchedule` (item 1) |
| `docs/architecture/adr/ADR-0038-p4-traceability-orphans-allocation-impact-modular.md` | Amendment Q1–Q2: `params.date` on the Modular waiver refusals (item 2) |
| `docs/architecture/adr/ADR-0035-p4-phases-g5-g6-exceptions-routing.md` | Amendment R1: `listScaleScopeBusinessUnits` (item 3) |
| `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md` | Amendment K1–K2: the value-class drill-down, three metrics, and the codes and keys (items 4, 8) |
| `docs/architecture/adr/ADR-0033-p4-adoption-stakeholders-interventions-assessments.md` | Amendment V1: `getAssessmentFormVersion` (item 5) |
| `docs/architecture/adr/ADR-0025-p4-calendar-time-jobs-work-items.md` | Amendment L1: the rule for record names in message parameters (item 6) |
| `docs/architecture/adr/ADR-0032-p4-forums-meetings-t16-escalation.md` | Amendment G3: `forumAr` on `governance.task.minutes_to_approve` (item 6) |
| `docs/architecture/adr/ADR-0027-p4-kpi-data-model-and-pipeline.md` | Amendment C4–C5: no member order in `sources`/`values`; the cumulative roll-up rule and `windowValues` (item 7) |
| `apps/api/test/support/p4-pending-arch-r3.ts` (new) | Pending list for the three new operations |
| `apps/api/test/support/p4-pending.ts` | Imports the new list, as ARCH-R2 did: one import line, one spread line, and the header comment's "R1 and R2" → "R1, R2 and R3" |
| `apps/api/test/support/p4-operations.ts` | The three operation ids added to the P4 set, with a comment line |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 649 → 652, with its comment line. The media-type pin is unchanged, because all three new operations are GETs with no request body |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/**` | Logs, the code scan and its diffs, the message-parameter scan, the contract diff and the code table |

**Not changed:**
- **No migration.** `0061` is not written, because no item needs a schema change. Items 1, 3 and 5 read existing tables (`initiative_schedule`, `business_unit` with `gate_decision_scale_scope`/`scale_transition`, `assessment_form_version`). Item 2 is a response member. Item 4 reads the rows the Finance dashboard already reads. Item 6 is a `jsonb` params member. Item 7 is inside the `jsonb` `kpi_evaluation.inputs`, whose only CHECK is `jsonb_typeof = 'object'`.
- **No ERD or data-dictionary change**, because no table, column or constraint changes.
- **No application source** under `apps/*/src` or `packages/*/src`. Every behaviour change is specified for the implementer tasks in §6.
- **No P1 ADR edited.** Item 2's `Problem.params` is decided in ADR-0038 Q1, not in ADR-0007 (a DG1-approved P1 ADR). See §2 item 2 and §7.

## 2. Decisions, item by item

### Item 1. `getInitiativeSchedule` (ADR-0031 amendment S1)

- **Decided: a read**, `GET /api/v1/initiatives/{initiativeId}/schedule`, on the existing path. It follows the `getAdoptionMetricLink`, `getInheritedRecord` and `getBenefitPlanValue` precedents.
- **Authorization:** `transformation.read` on the initiative's transformation, with 404 outside scope (the read gate of `portfolio/schedule-network.ts`).
- **200** `InitiativeSchedule`, which carries `version`, with `ETag`. A recorded row whose duration is null answers 200 with `durationWorkingDays: null`.
- **A missing row answers 404** (`not_found`). That covers two cases: the initiative is not readable, or it has no `initiative_schedule` row. The panel calls this read only for an initiative it already shows, so for the panel a 404 means "no duration recorded", and it offers `createInitiativeSchedule`. This matches the PATCH's existing "404 when none is recorded". The version-0 read (ARCH-R1) is not used, because a schedule has no default row.
- **It also makes `createInitiativeSchedule`'s `Location` resolve.** The POST already answers `Location: /api/v1/initiatives/{id}/schedule` (`schedule-network.ts:250`), and no GET served that path before.
- **Rejected: a version on `ScheduleNode`.** It would change the existing `getScheduleNetwork` response, and the node lacks `note`.
- **Pending** in `p4-pending-arch-r3.ts`. BE-R4 routes it, and FE-R3 adopts it (§6).

### Item 2. A structured date on the Modular waiver refusals (ADR-0038 amendment Q1)

- **Decided: a top-level problem extension member `params`**, not an `errors[]` item.
  - **Shape:** an object of string, number, boolean or null values. That is exactly the shape the contract uses for the placeholder values of a translated text (`WorkItem.messageParams`, `InboxNotification.messageParams`). So the client fills `problems.<code>` from it exactly as it fills a work item's message.
  - **For the two codes:** `params = { date }` (`YYYY-MM-DD`), the same value that is in `detail`. For revoked it is the revoke's business date; for expired it is `expires_on`.
- **Why not `errors[]`:**
  - `FieldError` is closed (`pointer`, `code`, `message`; `additionalProperties: false`) and has no value member;
  - its pointer points into the request body, and the date is not in the body;
  - carrying the date in `message` would turn an English-text member into data.
- **Scope:**
  - `params` is sent only with codes whose ADR names it, and today exactly these two codes do;
  - status, `type`, `title`, `code` and `detail` are unchanged;
  - every other problem body keeps its exact bytes.
- **Contract:** `Problem` gains the optional `params` property. This is an **additive change to a P1 component**: `Problem` has no `additionalProperties: false`, so every response that was valid before is valid after, and no P1–P3 response changes. I flag it in §7 so the orchestrator can confirm that it needs no DG1 reopen.

### Item 3. Business units for the G5 scale scope (ADR-0035 amendment R1)

- **Cause (read from the code).** `listBusinessUnits` (DG1, `organization/routes.ts`) returns only the units that the caller's `business_unit.read` grants reach (`scopeFilter` at level `business_unit`). FE-F observed that a Sponsor with a transformation-scoped grant could not list the organization's units. Also, `ScaleScope` and `ScaleTransition` name units by id only.
- **Decided: a scoped read**, `listScaleScopeBusinessUnits`, `GET /api/v1/transformations/{transformationId}/scale-scope/business-units` (`transformation.read`):
  - **Rows:** every **active** unit of the transformation's organization (exactly the set `assertScaleScopeValid` accepts), plus every unit, whatever its status, named by a `gate_decision_scale_scope` or `scale_transition` row of this transformation, so a past scope can always be labelled.
  - **Members:** `id`, `code`, `nameEn`, `nameAr`, `status` and `selectable` (true iff active).
  - **Order and paging:** `code`, then `id`, cursor-paged.
- **Rejected:**
  - **A permission default** (an organization-level `business_unit.read` for the Sponsor). It changes the DG2-approved role catalogue for every Sponsor, and it reveals full unit records.
  - **A stated limitation.** The default approver could then name no unit other than the transformation's own, although §5 allows any active unit of the organization.
- **What it reveals:** the codes and names of the organization's active units, which is the set a G5 scope may name, plus the units already named in this transformation's scope. Nothing else.

### Item 4. Finance drill-down per value class (ADR-0037 amendment K1)

- **Decided: add them**, as the ADR-0037 §5 drill-down invariant asks.
  - **New optional `valueClass`** (`FinanceValueClass`: the five financial classes and `non_financial_valued`). It is allowed only with the seven value-state metrics; with any other metric it is refused with 422 `dashboard.value_class_not_applicable`.
  - **New metrics** `value.measured`, `value.rejected` and `value.sustained`.
- **Which lines a drill-down sums.** The Finance class line's own rule, so the sum equals the line by construction:
  - the benefit's `financeClassOf` is not null (counted and monetised);
  - with `valueClass`, the benefit's class equals it; without it, the class is one of the five financial classes (the existing rule);
  - the line passes `lineInWindow`;
  - the line passes `entersLine` (the overlap hold-back of validated and sustained lines).
- **Hrefs:**
  - every class line drills, because the "whole state's figure" condition is removed;
  - the `gross` lines are unchanged;
  - **the `net` lines keep `null`, a stated limitation.** A net line is a difference (gross − implementation cost), not a sum of records. Both of its inputs drill: the `gross` line and `value.investment`.
- **Unchanged:** every existing drill-down response without `valueClass`, and the headlines (no headline uses the new metrics).
- **Invariant test:** assigned to the kpi-benefits task (§6).

### Item 5. Older assessment-form versions (ADR-0033 amendment V1)

- **Decided: a version read**, `getAssessmentFormVersion`, `GET …/assessment-forms/{assessmentFormId}/versions/{versionNo}` (`transformation.read`).
  - **200** `AssessmentFormVersion`, for any version, including an unpublished one and those of a retired form.
  - **No `ETag`:** the row is append-only, so there is nothing to send `If-Match` for.
  - **404** when the form is not readable or has no such version.
- **Rejected:**
  - **Questions embedded in the record.** It changes the existing `AssessmentRecord` response and copies each version into every record.
  - **A limitation.** The rows exist and are immutable, so the read is exact and cheap.

### Item 6. Localized names in message parameters (ADR-0025 amendment L1; ADR-0032 amendment G3)

- **Decided: both names.**
  - `<param>` stays the English name, under today's key, so stored rows and the English rendering are unchanged.
  - `<param>Ar` carries the Arabic name.
  - **Arabic rendering:** `{<param>}` takes `<param>Ar` when it is a non-empty string, else `<param>`. So the EN and AR templates keep the same placeholder set, and the FE `message-keys.test.ts` rule "EN and AR placeholder sets match" still holds.
- **Covered:** records with `name_en` and `name_ar` columns. The 13 tables are listed in L1, taken from the migrations.
- **Not covered:**
  - single-language user text (titles, KPI names, form names, area names), which is passed as is;
  - codes, which the client labels from its code tables;
  - ids, dates and numbers.
- **Rejected:**
  - **Codes.** They are not what a reader recognises, and they would change today's English text.
  - **Render-time references.** They need one read per My Work item, and a renamed record would rewrite past tasks.
- **Every key it affects (enumerated by scan, `evidence/message-params-scan.txt`):** exactly one, `governance.task.minutes_to_approve`, which gains `forumAr`. Every other producer passes user text, codes, ids, dates or numbers. No migration writes `message_params`. No notice passes a bilingual name.

### Item 7. Formula lineage wording (ADR-0027 amendments C4, C5)

- **C4: member order.**
  - The words "in `kpi_formula_input` order" are struck.
  - `sources` and `values` are objects whose member order is not part of the stored shape or of the contract. Consumers look a source up by variable name, and a screen that lists sources sorts them by variable name in code-point order.
  - Arrays (`entries`, `window`, `windowValues`) keep their stated order.
- **C5: the cumulative case, stated from the code.** A scope with earlier accepted values but no accepted actual for the current period:
  - its cumulative value is Unknown (`ytdWindow` always includes the current period, and `cumulativeValue` answers `kpi.cumulative_incomplete` when any window period lacks an accepted entry);
  - it enters the roll-up with no value;
  - it is expected (`previouslyReportingScopes`), so it is in `missingScopes`;
  - the roll-up is Unknown with `kpi.scope_missing`;
  - it gets no `entries` element;
  - no finding is written on the cumulative basis.

  So the KBE-R3 scenario ("contributes through its window without a current actual") **does not occur as built**. C5 makes this the rule, and assigns a test that pins it.
- **C5: `windowValues`.** A scope that does enter a cumulative roll-up contributes its whole window, so each cumulative-basis entry gains `windowValues: [{reportingPeriodId, kpiActualId, valueNo}]`, in window order. The entered cumulative shape gains the same member, so a cumulative formula source also reaches every actual version.
  - It is written only when the value is known.
  - Period-basis shapes are unchanged.
  - An older row without the member shows its cumulative lineage as "not recorded".

### Item 8. Codes added since ARCH-R2

- **Method:**
  - I re-ran the ARCH-R1/R2 script (`evidence/codes-scan.py`, byte-identical to ARCH-R1's: `cmp` printed nothing) with the same DG3 literal list, and diffed its code lines against ARCH-R2's output;
  - I ran a supplementary scan of template-literal keys added since ARCH-R2's base `a8bcf5d`;
  - I checked the backend handbacks merged since ARCH-R2 (BE-M3, BE-R3, KBE-R3, KBE-G2). Each states "no new code".
- **Result:**
  - **6 new hits**, all SQL column aliases, not codes: `m.initiative_id`, `m.portfolio_id`, `m.workstream_id`, `t.entry_phase`, `t.lead_user_id`, `t.sponsor_user_id`;
  - 12 hits are gone, namely the codes ARCH-R2 put into ADRs;
  - the template scan is empty.
- **So no code was added to the product since ARCH-R2.**
- **Rows 186–196** are the codes and keys of items 1–7. Rows 187–190 are four template-built rule keys (`dashboard.value.sum_<state>`), shipped by KBE-G but never in an ADR table, which I found while specifying item 4.
- **Coverage limit:** a code reached only through a variable that neither the scans nor the handbacks find is not covered. None is known.

## 3. Checks actually run

All in this worktree, Node 24, offline. Logs are in `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/`. They were kept in `$TMPDIR` until the integration suite finished, then copied. All ADR and contract edits were made before any suite ran.

@@CHECKS@@

## 4. Extended code table (continues ARCH-R2's 164–185)

"server" texts are what the API sends, or will send once the named task builds it. "authored" texts are written here, because the server sends only the key. Arabic is for FE to write, and stays provisional until linguistically reviewed.

| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where (as built, or to build) |
|---|---|---|---|---|---|---|---|
| 186 | `dashboard.value_class_not_applicable` (at `/valueClass`) | 422 | ADR-0037 K1, K2 | **new** (item 4) | A value class narrows only a drill-down of benefit values by state. | server (to build) | api reporting/dashboards/filters.ts (`DASHBOARD_REFUSALS`), drilldown.ts |
| 187 | `dashboard.value.sum_planned` | rule key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | Planned value = the sum of the planned values in the period. | authored | api reporting/dashboards/drilldown.ts (`` `dashboard.value.sum_${state}` ``) |
| 188 | `dashboard.value.sum_forecast` | rule key | ADR-0037 K2 | accepted (as row 187) | Forecast value = the sum of the forecast values in the period. | authored | as row 187 |
| 189 | `dashboard.value.sum_submitted` | rule key | ADR-0037 K2 | accepted (as row 187) | Submitted value = the sum of the values submitted for Finance validation in the period. | authored | as row 187 |
| 190 | `dashboard.value.sum_validated` | rule key | ADR-0037 K2 | accepted (as row 187) | Validated value = the sum of the Finance-validated values in the period. | authored | as row 187 |
| 191 | `dashboard.value.sum_measured` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Measured value = the sum of the measured values in the period. | authored | as row 187 (to build) |
| 192 | `dashboard.value.sum_rejected` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Rejected value = the sum of the values Finance rejected in the period. | authored | as row 187 (to build) |
| 193 | `dashboard.value.sum_sustained` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Sustained value = the sum of the sustained values in the period. | authored | as row 187 (to build) |
| 194 | `gate.modular_waiver_revoked` (row 169), now with `params.date` | 422 + problem member | ADR-0038 Q1, Q2 | **changed**: `params` added (item 2); code and text unchanged | The waiver of the missing baseline and outcome links was revoked on {date}; supply them or record a new waiver, then resubmit G3. | server (`params` to build) | api workflows/gates.ts; platform/problem.ts; shared problem.ts |
| 195 | `gate.modular_waiver_expired` (row 170), now with `params.date` | 422 + problem member | ADR-0038 Q1, Q2 | **changed**: `params` added (item 2); code and text unchanged | The waiver of the missing baseline and outcome links expired on {date}; supply them or record a new waiver, then resubmit G3. | server (`params` to build) | as row 194 |
| 196 | `governance.task.minutes_to_approve` (row 183), params `forum`, `forumAr`, `meetingDate` | work-item message key | ADR-0025 L1; ADR-0032 G3 | **changed**: param `forumAr` added (item 6); text unchanged | Approve the minutes of the {forum} meeting of {meetingDate}. | authored | api governance/minutes.ts |

**Items without a new code:**
- 1 (`getInitiativeSchedule`): the platform 404 `not_found`;
- 3 (`listScaleScopeBusinessUnits`): 404 `not_found` and the existing 400 cursor validation;
- 5 (`getAssessmentFormVersion`): 404 `not_found`;
- 7: the existing `kpi.scope_missing` and `kpi.cumulative_incomplete`.

The rows also live in their ADR amendments (ADR-0037 K2, ADR-0038 Q2, ADR-0025 L1, ADR-0032 G3). `evidence/codes-table.md` is a copy of this table, with the scan summary.

## 5. Every contract line changed (`docs/api/openapi.yaml`; diff `evidence/openapi-diff.txt`, `diff -U0` against the base file)

**Removed or replaced lines: 4.** Each is replaced in place; no other existing line changes.

| # | Line before | After | Reason |
|---|---|---|---|
| 1 | `getDashboardDrilldown` summary "Drill-down of one headline number: … 422 dashboard.metric_subject_mismatch, dashboard.period_not_found, dashboard.owner_not_found." | "… of one headline number or Finance class line: … , dashboard.value_class_not_applicable (ADR-0037 amendment K1)." | item 4 |
| 2 | `KpiEvaluation.inputs` description (ARCH-R2) | the same text plus two sentences: object members carry no order (C4), and `windowValues[]` on the cumulative basis (C5). The type is unchanged | item 7 |
| 3 | `DashboardMetric.enum: [… finance.pending_validation]` | the same list plus `value.measured, value.rejected, value.sustained` | item 4 |
| 4 | `FinanceValueLine.drilldownHref: { type: [string, "null"] }` | the same type with a description (every class and gross line drills; null only on a net line) | item 4 |

**Added lines** (101 `+` lines in the diff, counting the 4 replacements and the one blank line of the info paragraph):

- **Info paragraph** "P4 repairs (T-DG4-ARCH-R3, 2026-10-10)": 8 lines including the blank line.
- **`getInitiativeSchedule`**: 16 lines, a `get:` inserted on the existing `/api/v1/initiatives/{initiativeId}/schedule` path, before `post:`.
- **`getAssessmentFormVersion`**: 19 lines, a new path `…/assessment-forms/{assessmentFormId}/versions/{versionNo}`, inserted before `…/publish`. It reuses the existing `VersionNo` parameter component.
- **`listScaleScopeBusinessUnits`**: 20 lines, a new path `…/scale-scope/business-units`, inserted before `…/scale-transitions`.
- **`getDashboardDrilldown`**: one parameter line (`DrilldownValueClassQuery`).
- **Parameter component `DrilldownValueClassQuery`**: 6 lines.
- **`Problem.params`**: 4 lines (item 2).
- **Schemas `ScaleScopeBusinessUnit` and `ScaleScopeBusinessUnitPage`**: 19 lines.
- **Schema `FinanceValueClass`**: 4 lines.

**Unchanged:**
- **Every P1–P3 path, and every other existing P4 operation.** `diff -U0` shows exactly the 12 hunks listed in the evidence, and no other.
- **The one P1 component touched is `Problem`.** It gains one optional property (item 2), and no existing property of it changes.

**Lint:** `pnpm openapi:lint` prints `PASS … OpenAPI 3.1.1, 652 operations`.

## 6. Exact implementer changes

### BE-R4 (backend-workflow-engineer)

1. **`getInitiativeSchedule`** (ADR-0031 S1), in `apps/api/src/modules/portfolio/schedule-network.ts`:
   - add `app.get(INITIATIVE_SCHEDULE, { config: read }, …)`, with the same initiative read gate as the POST and PATCH (404 when the initiative is outside scope);
   - select the `initiative_schedule` row by `initiative_id`: none → `problems.notFound()`; else `sendVersioned(reply, 200, toInitiativeSchedule(row))`;
   - add `GET ${INITIATIVE_SCHEDULE}` to the returned route list;
   - exercise it in `apps/api/test/integration/contract/p4-exercises-be-e.ts`, both after the existing create (200, `ETag` = the create's version) and for an initiative without a row (404);
   - remove it from `P4_PENDING_ARCH_R3`.
2. **`listScaleScopeBusinessUnits`** (ADR-0035 R1), in `apps/api/src/modules/workflows/scale.ts`:
   - `transformation.read`, 404 outside scope;
   - rows of the transformation's `organization_id`: `status = 'active'` OR `id IN` (the `business_unit_id`s of `gate_decision_scale_scope` and of `scale_transition` rows of this transformation);
   - members `{id, code, nameEn: name_en, nameAr: name_ar, status, selectable: status === 'active'}`;
   - order by `code`, `id`, with the cursor pattern of `listBusinessUnits`;
   - **tests:** a Sponsor with only a transformation grant sees every active unit of the organization and no unit of another organization; an archived unit named by an approved scope is listed with `selectable: false`; an outsider gets 404;
   - exercise it in `p4-exercises-be-k.ts`, and remove it from the pending list.
3. **`getAssessmentFormVersion`** (ADR-0033 V1), in `apps/api/src/modules/adoption/assessments.ts`:
   - `transformation.read`; the form must be in the transformation (else 404); select `assessment_form_version` by `(form_id, version_no)` (else 404); 200 `AssessmentFormVersion`, with no `ETag`;
   - **tests:** version 1 after an update to version 2 returns the old questions; version 99 gives 404; a form of another transformation gives 404;
   - exercise it in `p4-exercises-be-h.ts`, and remove it from the pending list.
4. **`Problem.params`** (ADR-0038 Q1):
   - `packages/shared/src/problem.ts`: `ProblemDetails.params?`;
   - `apps/api/src/modules/platform/problem.ts`: `HttpProblem` gains an optional `params`, and `toBody` emits it after `currentVersion`, only when it is defined;
   - `apps/api/src/modules/workflows/gates.ts`: `gateModularWaiverRevoked(date)` and `gateModularWaiverExpired(date)` pass `params: { date }`;
   - **tests:** both refusals carry `params.date` equal to the date in `detail`. Every existing problem assertion passes unchanged.
5. **`forumAr`** (ADR-0032 G3), in `apps/api/src/modules/governance/minutes.ts` `minutesTask`: select `name_ar` as well, and pass `forumAr: forum.name_ar`. The test asserts both names on a new item.

### kpi-benefits-engineer task

1. **Drill-down `valueClass` and the three metrics** (ADR-0037 K1):
   - `packages/shared/src/schemas/dashboards.ts`: the `dashboardMetric` enum gains `value.measured`, `value.rejected` and `value.sustained`; add a `financeValueClass` enum;
   - `apps/api/src/modules/reporting/dashboards/drilldown.ts`:
     - `valueClass` in `drilldownQuery`;
     - the refusal when it is used with a non-value-state metric, with `dashboard.value_class_not_applicable` added to `DASHBOARD_REFUSALS` in `filters.ts`;
     - `VALUE_STATE_OF` and `SUBJECT_METRICS` gain the three metrics;
     - `valueDrill` selects lines by the K1 item 3 rule (`financeClassOf`, `lineInWindow`, `entersLine`), with the measured, rejected and sustained lines from `loadExtraStateLines`;
   - `finance.ts`: every class line's `drilldownHref` = its state's metric plus `valueClass`. Remove the "whole" condition; leave `gross` and `net` as they are;
   - **the K1 item 4 invariant test** over every class line of a fixture with ≥ 2 classes, 2 currencies, an overlap-held benefit and a valued non-financial benefit;
   - the scope sweep (§6) over the new metrics;
   - `drilldownHref` (`filters.ts`) gains an optional `valueClass`, so the href carries it.
2. **Lineage** (ADR-0027 C4–C5), in `apps/worker/src/handlers/kpi.ts`:
   - `windowValues` on cumulative roll-up entries and on the entered cumulative `inputs`, only when the value is known;
   - the C5 tests (two scopes, two periods; the missing-scope rule pinned; period-basis shapes unchanged).
   - No consumer may rely on the member order of `sources` or `values`.

### FE-R3 (frontend-ux-engineer)

1. **Schedule panel** (`apps/web/src/pages/actions/ScheduleNetworkPanel.tsx`):
   - read `getInitiativeSchedule` when the dialog opens: 200 → edit with `If-Match` = its `ETag`; 404 → create;
   - remove the "sends version 1 / learned version" fallback;
   - a 409 still re-reads and never overwrites.
2. **Modular waiver dates:**
   - pass `problem.params` to the translation of `problems.<code>`;
   - `gate__modular_waiver_revoked` and `gate__modular_waiver_expired` gain `{{date}}` in EN and AR, rendered as a localized business date;
   - with no `params`, the text is the one shown today;
   - **`apps/web/src/i18n/problems-slices-hijk.test.ts` asserts that no problem text keeps a placeholder such as `{date}`.** That assertion must allow `{{date}}` for exactly these two codes, and render them with `params` in the test.
3. **Scale-scope editor and view** (`GateP4.tsx`, `p4api.ts`):
   - read `listScaleScopeBusinessUnits`;
   - offer the units with `selectable: true`;
   - label scope items and transitions by `code` with `nameEn`/`nameAr` by locale;
   - stop reading `listBusinessUnits` there.
4. **Finance dashboard:**
   - every class line links its `drilldownHref`;
   - a `net` line shows "gross − implementation cost" with links to the gross line's drill-down and to `value.investment`, never as a drillable total;
   - EN/AR text for the seven `dashboard.value.sum_<state>` rule keys (rows 187–193) and for the problem key `dashboard__value_class_not_applicable` (row 186). **This key is not caught by `problems-slices-hijk.test.ts`.** That test reads only rows that begin `| 4xx | \`code\``, and the amendment tables begin with the code (the format of every ARCH-R1/R2 amendment table). So it must be added by hand.
5. **Assessment record page:** read `getAssessmentFormVersion` for the record's `formVersionNo`, and label answers from it. A key that the version lacks shows the key with "Unknown question" (never blank).
6. **My Work** (`MyWorkPage.tsx` `renderMessage`): in Arabic, a placeholder `{p}` takes `params[p + "Ar"]` when it is a non-empty string, and a `…Ar` member is never a placeholder of its own (ADR-0025 L1). Add a `message-keys.test.ts` case for `governance.task.minutes_to_approve` with and without `forumAr`.
7. **KPI lineage display** (if any screen lists `sources`): sort by variable name, and show "not recorded" for a cumulative row without `windowValues` (ADR-0027 C4, C5).

## 7. Known gaps and not done

- **Nothing in this task changes runtime behaviour.**
  - The three new reads have no route until BE-R4 routes them; they are pending.
  - `params`, `forumAr`, `valueClass` and `windowValues` exist only in the contract and the ADRs until their tasks build them.
- **`Problem.params` is an additive change to a P1 component** (ADR-0007's problem shape, approved at DG1).
  - It is optional, `Problem` already admits extension members, and no existing response changes.
  - I did not edit ADR-0007; the decision lives in ADR-0038 Q1.
  - **For the orchestrator:** please confirm that an additive optional member on a P1 schema needs no DG1 reopen. If it does, the alternative is the stated limitation that FE-F uses today: the waiver's date shown from the submission detail, not in the refusal.
- **The net Finance lines stay without a drill-down** (ADR-0037 K1 item 5), a stated limitation with its reason.
- **The FE ADR-table guard test does not read amendment tables** (§6 FE-R3 item 4). I did not change it, because it is FE-owned. The orchestrator may want it extended to the amendment format.
- **The data dictionary** is not edited for `kpi_evaluation.inputs`, because its catalogue facts (type, CHECK) do not change.
- **ADR text is not edited in place.** Every correction is a dated amendment appended to its ADR; "where this amendment and §x differ, this amendment wins".

## 8. Merge instructions

- **No migration.** Apply nothing.
- **Conflicts to expect:**
  - `contract.test.ts`: only the operation-count pin (652) and its comment lines.
  - `p4-pending.ts` and `p4-operations.ts`: append-only lines.
  - `docs/api/openapi.yaml`: the hunks of §5. FE-F2, FE-G2 and QA-B do not own it (p4-plan §5.3).
- **After the merge:** the P4 aggregate pending list gains 3 operations (`getInitiativeSchedule`, `listScaleScopeBusinessUnits`, `getAssessmentFormVersion`). All three must be routed before the DG4 candidate freezes.
- **Ordering:**
  - BE-R4 and the kpi-benefits task depend on these amendments;
  - FE-R3's items 1, 2, 3, 5 and 6 depend on BE-R4, and its item 4 on the kpi-benefits task.
