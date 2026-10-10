# Handback T-DG4-ARCH-R3 (solution-architect): P4 architecture repairs, round 3 (completed by the salvage run T-DG4-ARCH-R3B)

- **Stage:** DG4 (BUILDING), worktree `/home/user/wt/dg4-arch-r3`, branch `dg4/arch-r3`. Starting point: the orchestrator's unverified WIP commit `d74d75c` (the interrupted T-DG4-ARCH-R3 run's working tree), whose parent is the integrated base `983fdfa`. Every diff below is against `983fdfa` unless it says otherwise. The changes are **uncommitted** (on top of `d74d75c`), for the orchestrator to integrate.
- **Invocation (this run):** `DG4-T-DG4-ARCH-R3B-solution-architect-20261010T093937Z-88784cd7` (session `88784cd7-87ef-4e5b-9e9f-5717c156e6c5`). Before starting, I checked the assignment `docs/delivery/assignments/DG4/T-DG4-ARCH-R3B.md` with `sha256sum`: `f0141761e5186c0aeed52e3ce524bd1f4dff151650f105418cdfaab4ceecb2fc`, which matches the hash I was given.
- **Time (this run):** start `Sat Oct 10 09:39:49 UTC 2026`, end `Sat Oct 10 10:41:23 UTC 2026` (`date -u`; `evidence/start-time.txt`, `evidence/end-time.txt`). The 2-hour limit counts from this start.
- **Preceding gate:** before any edit I ran `node tools/gates/validate.mjs --historical --stage DG3`. It printed `PASS gate DG3 (historical)` and exited 0 (`evidence/validate-dg3-historical-start.log`). §3 has the re-run at the end.
- **Two gate systems.** This task writes no DG0–DG7 record other than this handback and its evidence. G1–G6, the G5 scale scope and the Modular waiver are business approvals inside the product. No document, test or script of this task grants one. Product G6 never implies DG7.
- **Ports and disk.** Integration used ports 23700–23749 only (`QA_PG_PORT=23700`, `MTH_PORT_POOL=23701-23749`; the log shows port 23700, attempt 1). `df -h .` showed 18–19 GB free before each full run (`evidence/disk-*.txt`).
- **Untracked files I did not create.** These were present before my first edit (`git status`): the top-level `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. They are character devices (the sandbox's `/dev/null` mounts). I left them untouched.
- **D-113 and D-114.**
  - The WIP handback said `decisions.md` has no D-113. That is true of this worktree (base `983fdfa`, newest entry D-112). D-113 was committed after the base, in the main tree (`d579891`, "W16 integrated"). I read it there verbatim. It records the gaps that items 1–3 repair (FE-D2's schedule read, FE-F's business units and waiver date) and decides nothing that changes these items.
  - D-114 is cited by this assignment (the orchestrator's answer on `Problem.params`). Neither this worktree's nor the main tree's `decisions.md` contains a D-114 row at the time of this run. I use the answer as the assignment states it (§2 item 2, ADR-0038 Q1).

## Salvage (D-103; the D-059/D-070 precedent)

I reviewed the WIP as if someone else wrote it: every ADR amendment against the code it describes, the contract diff against `983fdfa`, the test-support files, and the WIP handback line by line. I trusted none of its logs or claims; it contained no evidence folder, and every check in §3 was run by this run on the final tree. The killed run's transcript (`docs/delivery/test-evidence/DG4/arch-r3-orphaned/`) is not cited.

**Kept from the WIP (verified against the code, unchanged):**
- `docs/api/openapi.yaml` exactly as in `d74d75c`: 12 hunks, 4 replaced lines, 101 added lines (§5). I checked each referenced component (`InitiativeSchedule`, `AssessmentFormVersion`, `VersionNo` with `minimum: 1`, `AssessmentFormId`, `Code`, `Name`, `ActiveStatus`, `WorkItem.messageParams`) and the code each description cites (`schedule-network.ts` `Location` at line 250; `assertScaleScopeValid`'s active-unit rule in `gates.ts`; the 0051 triggers, which admit a `gate_decision_scale_scope` row only for an approved G5 decision; `financeClassOf`, `entersLine`, `lineInWindow` and `lineEligible`, whose overlap hold the existing value drill-down already applies).
- The three test-support changes (`p4-pending-arch-r3.ts`, `p4-pending.ts`, `p4-operations.ts`) and the `contract.test.ts` pin 649 → 652 with its comment.
- The amendments ADR-0031 S1, ADR-0033 V1, ADR-0035 R1, ADR-0032 G3 and ADR-0027 C4–C5, unchanged. For C4–C5 I checked: `kpi_formula_input` has no ordinal column and the worker reads it `ORDER BY id`; `ytdWindow` always includes the current period; `cumulativeValue` answers `kpi.cumulative_incomplete`; `rollUp` puts a previously reporting scope without a usable entry in `missingScopes` and answers `kpi.scope_missing`; `entries` filters out missing scopes; the `scope_missing` finding is pushed only when `basis === "period"`.
- Decisions of items 1–7 (no decision changed).

**Changed, and why:**
1. **ADR-0025 L1, the list of bilingual records was wrong.** It named 13 tables "with a `name_ar` column". A column scan of the migrations finds 11 tables with `name_ar`. `good_outcome_criterion` has `label_ar`, not `name_ar`, and `meeting_minutes` has no Arabic column. The list also missed the `label_en`/`label_ar` tables. L1 now defines the covered records as those with an English `name_en`, `source_name_en`, `label_en` or `source_label_en` column beside `name_ar` or `label_ar`, and lists exactly the 22 tables the scan finds (`evidence/bilingual-name-columns.txt`). A catalogue record that a param already names by code keeps the code.
2. **ADR-0025 L1, the list of other param kinds was incomplete.** It now also names `delayImpact` (user text), `periodLabel` (an ASCII period code) and `snapshotSha256` (a hash). Every param name in the scan is classified in `evidence/message-params-scan.txt`, and a check printed no unclassified name.
3. **ADR-0038 Q1, three fixes.**
   - It now states the D-114 reason why `params` needs no DG1 reopen (the WIP left it as an open question in its §7).
   - It names the zod mirror `packages/shared/src/schemas/problem.ts`, which the WIP's implementer list omitted. It is a non-strict `z.object`, so without the change it would strip `params`.
   - The web placeholder is written `{{date}}` (i18next), which the WIP ADR wrote as `{date}` while its handback wrote `{{date}}`.
4. **ADR-0025 L1** also notes that the web writes a placeholder as `{{<param>}}`.
5. **Handback corrections:**
   - **The `DASHBOARD_REFUSALS` location.** It is defined in `packages/shared/src/schemas/dashboards.ts`, not in `filters.ts` (row 186 and §6).
   - **"archived" unit.** `business_unit.status` is `active | inactive` (`ActiveStatus`), so there is no archived unit (§6 BE-R4 item 2).
   - **"Not in an ADR table before".** That claim for rows 187–190 now notes that the fifth key of the family, `dashboard.value.sum_investment`, was already in ADR-0037 A2.

**Added:**
- **ADR-0037 K2: ten rows** for two template-built key families that no ADR table listed. My whole-tree template-key scan found them (`evidence/template-keys-whole-tree.txt`):
  - `dashboard.portfolio.slip_<reason>`, with the four `SlipUnknownReason` values;
  - `dashboard.kpi.<rag>`, with the six `KpiRag` values.

  They are rows 197–206 here. Both families were shipped by KBE-G (`fcddf8b`), before ARCH-R2.
- A scan of the same code with the base ADRs (`983fdfa`), which shows that this task's ADR edits do not hide any hit (`evidence/codes-scan-output-base-adrs.txt` is byte-identical to `codes-scan-output.txt`).
- All evidence under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/`, and §3.

## 1. Changed files (against `983fdfa`)

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | Three new GETs (`getInitiativeSchedule`, `listScaleScopeBusinessUnits`, `getAssessmentFormVersion`); `Problem.params`; drill-down `valueClass` and three metrics; description lines. 649 → 652 operations. Every changed line is listed in §5 |
| `docs/architecture/adr/ADR-0031-p4-raid-actions-corrective-execution.md` | Amendment S1: `getInitiativeSchedule` (item 1) |
| `docs/architecture/adr/ADR-0038-p4-traceability-orphans-allocation-impact-modular.md` | Amendment Q1–Q2: `params.date` on the Modular waiver refusals, with the D-114 reason (item 2) |
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
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-solution-architect.md` | This handback |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/**` | Logs of every check, the code scans and their diff, the message-parameter scan, the bilingual-column scan, the contract diff, the ADR diff of this run against the WIP, and the code table |

**Not changed:**
- **No migration.** `0061` is not written, because no item needs a schema change:
  - items 1, 3 and 5 read existing tables (`initiative_schedule`; `business_unit` with `gate_decision_scale_scope` and `scale_transition`; `assessment_form_version`);
  - item 2 is a response member;
  - item 4 reads the rows the Finance dashboard already reads;
  - item 6 is a member of the `jsonb` column `message_params`, whose only CHECK is `jsonb_typeof = 'object'`;
  - item 7 is inside the `jsonb` column `kpi_evaluation.inputs`, whose only CHECK is `jsonb_typeof = 'object'`.
- **No ERD or data-dictionary change**, because no table, column or constraint changes.
- **No application source** under `apps/*/src` or `packages/*/src`. Every behaviour change is specified for the implementer tasks in §6.
- **No P1 ADR edited.** Item 2's `Problem.params` is decided in ADR-0038 Q1, not in ADR-0007 (D-114).

## 2. Decisions, item by item

### Item 1. `getInitiativeSchedule` (ADR-0031 amendment S1)

- **Decided: a read**, `GET /api/v1/initiatives/{initiativeId}/schedule`, on the existing path. It follows the `getAdoptionMetricLink`, `getInheritedRecord` and `getBenefitPlanValue` precedents.
- **Authorization:** `transformation.read` on the initiative's transformation, with 404 outside scope. That is the read gate that `schedule-network.ts` applies before the POST and PATCH.
- **200** `InitiativeSchedule`, which carries `version`, with `ETag`. A recorded row whose duration is null answers 200 with `durationWorkingDays: null`.
- **A missing row answers 404** (`urn:mth:problem:not-found`). That covers two cases:
  - the initiative is not readable;
  - the initiative has no `initiative_schedule` row.

  The panel calls this read only for an initiative it already shows, so for the panel a 404 means "no duration recorded", and it offers `createInitiativeSchedule`. This matches the PATCH's existing "404 when none is recorded". The version-0 read (ADR-0035 A2, ADR-0037 A1) is not used, because a schedule has no default row.
- **It also makes `createInitiativeSchedule`'s `Location` resolve.** The POST already answers `Location: /api/v1/initiatives/{id}/schedule` (`schedule-network.ts:250`), and no GET served that path before.
- **Rejected: a version on `ScheduleNode`.** It would change the existing `getScheduleNetwork` response, and the node lacks `note`.
- **Pending** in `p4-pending-arch-r3.ts`. BE-R4 routes it, and FE-R3 adopts it (§6).

### Item 2. A structured date on the Modular waiver refusals (ADR-0038 amendment Q1)

- **Decided: a top-level problem extension member `params`**, not an `errors[]` item.
  - **Shape:** an object of string, number, boolean or null values. That is exactly the shape the contract uses for the placeholder values of a translated text (`WorkItem.messageParams`, `InboxNotification.messageParams`). So the client fills `problems.<code>` from it exactly as it fills a work item's message.
  - **For the two codes:** `params = { date }` (`YYYY-MM-DD`), the same value that is in `detail`. For revoked it is `p4_business_date(revoked_at, timezone)`, for expired it is `expires_on` (both as `assertRecordedModularWaiverInForce` in `gates.ts` computes them today).
- **Why not `errors[]`:**
  - `FieldError` is closed (`pointer`, `code`, `message`; `additionalProperties: false`) and has no value member;
  - its pointer points into the request body, and the date is not in the body;
  - carrying the date in `message` would turn an English-text member into data.
- **Scope:**
  - `params` is sent only with codes whose ADR names it, and today exactly these two codes do;
  - status, `type`, `title`, `code` and `detail` are unchanged;
  - every other problem body keeps its exact bytes.
- **No DG1 reopen (D-114, stated in ADR-0038 Q1).** The DG1-approved `Problem` schema has no `additionalProperties: false`, so it already admits extension members. Declaring the optional `params` member changes no P1 response or validation.

### Item 3. Business units for the G5 scale scope (ADR-0035 amendment R1)

- **Cause (read from the code).** Two things:
  - `listBusinessUnits` (DG1, `organization/routes.ts`) returns only the units that the caller's `business_unit.read` grants reach (`scopeFilter` at level `business_unit`). FE-F observed that a Sponsor with a transformation-scoped grant could not list the organization's units.
  - `ScaleScope` and `ScaleTransition` name units by id only.
- **Decided: a scoped read**, `listScaleScopeBusinessUnits`, `GET /api/v1/transformations/{transformationId}/scale-scope/business-units` (`transformation.read`):
  - **Rows:** every **active** unit of the transformation's organization (exactly the set `assertScaleScopeValid` accepts), plus every unit of any status that a `gate_decision_scale_scope` or `scale_transition` row of this transformation names, so a past scope can always be labelled;
  - **Members:** `id`, `code`, `nameEn`, `nameAr`, `status` (`active | inactive`) and `selectable` (true iff active);
  - **Order and paging:** `code`, then `id`, cursor-paged.
- **Rejected:**
  - **A permission default** (an organization-level `business_unit.read` for the Sponsor). It changes the DG2-approved role catalogue for every Sponsor, and it reveals full unit records.
  - **A stated limitation.** The default approver could then name no unit other than the transformation's own, although §5 allows any active unit of the organization.
- **What it reveals:** the codes and names of the organization's active units, which is the set a G5 scope may name, plus the units already named in this transformation's scope. Nothing else.

### Item 4. Finance drill-down per value class (ADR-0037 amendment K1)

- **Decided: add them**, as the ADR-0037 §5 drill-down invariant asks.
  - **New optional `valueClass`** (`FinanceValueClass`: the five financial classes and `non_financial_valued`). It is allowed only with the seven value-state metrics. With any other metric it is refused with 422 `dashboard.value_class_not_applicable`.
  - **New metrics** `value.measured`, `value.rejected` and `value.sustained`.
- **Which lines a drill-down sums.** The Finance class line's own rule, so the sum equals the line by construction:
  - the benefit's `financeClassOf` is not null (counted and monetised);
  - with `valueClass`, the benefit's class equals it; without it, the class is one of the five financial classes (the existing `lineEligible` rule);
  - the line passes `lineInWindow`;
  - the line passes `entersLine`, the overlap hold-back of validated and sustained lines, which `lineEligible` already applies.
- **Hrefs:**
  - every class line drills, because the "whole state's figure" condition is removed;
  - the `gross` lines are unchanged;
  - **the `net` lines keep `null`, a stated limitation.** A net line is a difference (gross − implementation cost), not a sum of records. Both of its inputs drill: the `gross` line and `value.investment`.
- **Unchanged:**
  - every existing drill-down response without `valueClass`;
  - the headlines, because no headline uses the new metrics.
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
  - **Arabic rendering:** `{<param>}` (`{{<param>}}` in the web's i18next files) takes `<param>Ar` when it is a non-empty string, else `<param>`. So the EN and AR templates keep the same placeholder set, and the FE `message-keys.test.ts` rule "EN and AR placeholder sets match" still holds.
- **Covered:** records with an English name or label column (`name_en`, `source_name_en`, `label_en`, `source_label_en`) beside `name_ar` or `label_ar`. That is exactly 22 tables as of `0060` (`evidence/bilingual-name-columns.txt`), all listed in L1.
- **Not covered:**
  - single-language user text (titles, KPI names, form names, area names, the delay impact), which is passed as is;
  - codes, which the client labels from its code tables, including catalogue records that a param already names by code;
  - period labels, ids, hashes, dates and numbers.
- **Rejected:**
  - **Codes.** They are not what a reader recognises, and they would change today's English text.
  - **Render-time references.** They need one read per My Work item, and a renamed record would rewrite past tasks.
- **Every key it affects (enumerated by scan, `evidence/message-params-scan.txt`):** exactly one, `governance.task.minutes_to_approve`, which gains `forumAr`.
  - Every other param name of every producer is classified in that file as user text, a period label, a code, an id, a date, a number or a hash.
  - No migration writes `message_params`.
  - No notice passes a bilingual name.

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
- **C5: `windowValues`.** A scope that does enter a cumulative roll-up contributes its whole window. So each cumulative-basis entry gains `windowValues: [{reportingPeriodId, kpiActualId, valueNo}]`, in window order. The entered cumulative shape gains the same member, so a cumulative formula source also reaches every actual version.
  - It is written only when the value is known.
  - Period-basis shapes are unchanged.
  - An older row without the member shows its cumulative lineage as "not recorded".

### Item 8. Codes added since ARCH-R2

- **Method:**
  1. I re-ran the ARCH-R1/R2 script (`evidence/codes-scan.py`; `cmp` against ARCH-R1's copy exited 0) with the same DG3 literal list (`T-DG4-ARCH-R1-evidence/dg3-literals.txt`). I diffed its code lines against ARCH-R2's `codes-scan-output.txt` (`evidence/codes-diff-vs-arch-r2.txt`).
  2. I ran the same scan with the ADRs of the base `983fdfa` (`codes-scan-base-adrs.py`, which differs only in its ADR directory argument). Its output is byte-identical to (1), so this task's amendments hide no hit.
  3. I scanned for template-literal keys on lines added between ARCH-R2's base `a8bcf5d` and `983fdfa` (`evidence/template-keys-since-arch-r2.txt`: 0 lines).
  4. I ran a whole-tree scan of template-built dotted keys (`evidence/template-keys-whole-tree.txt`: 23 hits, each classified in the file).
- **Result:**
  - **The literal scan:** 335 code lines against ARCH-R2's 341.
    - **6 new hits**, all SQL column aliases, not codes: `m.initiative_id`, `m.portfolio_id`, `m.workstream_id`, `t.entry_phase`, `t.lead_user_id`, `t.sponsor_user_id`.
    - **12 hits are gone**, because ARCH-R2 put those codes into ADR tables.
  - **The template scan since ARCH-R2:** empty.
  - **So no code was added to the product since ARCH-R2.**
- **Rows 186–196** are the codes and keys of items 1–7. Rows 187–190 are four template-built rule keys (`dashboard.value.sum_<state>`), shipped by KBE-G but never in an ADR table.
- **Rows 197–206** are the two template-built key families the whole-tree scan found in no ADR table:
  - `dashboard.portfolio.slip_<reason>` (4 keys);
  - `dashboard.kpi.<rag>` (6 keys).

  Both were shipped by KBE-G before ARCH-R2. The scan's other template families are audit action names, validation codes already in ADR tables or produced by the generic platform mapping, a DG3 display-status family, and error pointers.
- **Coverage limit:** a code reached only through a variable that none of the scans and handbacks find is not covered. None is known.

## 3. Checks actually run

All ran in this worktree with Node 24, offline. Every ADR and contract edit was made before the first check ran, and no product, test, ADR or contract file changed afterwards. The logs and scan outputs were kept in `$TMPDIR` and copied to `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/` after the integration suite finished. The one repository file written while a suite ran is this handback, written during the integration run. The G6 test that hashes delivery files covers only `gates`, `stages.json`, `findings.json`, `reviews`, `decisions.md` and `requirements.csv` since BE-R3 (`DELIVERY_RECORDS` in `g5-g6.test.ts`), so it does not read handbacks.

| # | Command | Environment | Result (real exit code) | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` | before any edit | `PASS gate DG3 (historical)`, **exit 0** | `validate-dg3-historical-start.log` |
| 1 | `pnpm -r typecheck` | final tree | **exit 0** | `typecheck.log` |
| 2 | `pnpm -r build` | final tree | **exit 0** | `build.log` |
| 3 | `pnpm lint` | final tree | **exit 0** (`--max-warnings=0`) | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | final tree (the untracked sandbox character devices are in the list; `--ignore-unknown` skips them) | "All matched files use Prettier code style!", **exit 0** | `format.log` |
| 5 | `pnpm openapi:lint` | final tree | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations`, **exit 0** | `openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | locale unset | **exit 0**: unit-node + unit-web 140 files, **2659 passed**; unit-formula-nocodegen 3 files, **259 passed, 2 skipped** (261) | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | `C.UTF-8` | **exit 0**: the same counts, 140 files / 2659 passed; 3 files / 259 passed, 2 skipped | `unit-c-utf8.log` |
| 8a | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm test:integration` (first attempt) | disposable PostgreSQL 16.13 on port 23700 | **Stopped, no result.** I started it as a background command with a 10-minute limit by mistake, and the harness stopped it at that limit while it was still running. The log has no failed test (0 lines beginning `×`) and no summary. It is not counted as a pass | `integration-run1-stopped-at-10min.log` |
| 8b | the same command, re-run with a longer limit | disposable PostgreSQL 16.13, port 23700 (attempt 1), 60 migrations on a fresh database | **exit 0**: **187 files, 1780 passed** (1780), in 1152.9 s. This equals D-113's merged-tree count, as expected: this task adds no test | `integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` | at the end | `PASS gate DG3 (historical)`, **exit 0** | `validate-dg3-historical-end.log` |

**Scans** (part of items 6 and 8; each output file names its command):

| Scan | Result | Files |
|---|---|---|
| ARCH-R1/R2 code scan, re-run (`python3 -I codes-scan.py …/dg3-literals.txt`) | exit 0; 335 code lines; diff against ARCH-R2: 6 new SQL aliases, 12 gone (diff exit 1 = differences, listed) | `codes-scan.py`, `codes-scan-output.txt`, `codes-diff-vs-arch-r2.txt` |
| The same scan with the base ADRs of `983fdfa` | exit 0; byte-identical to the row above (`cmp` exit 0) | `codes-scan-base-adrs.py`, `codes-scan-output-base-adrs.txt` |
| Template-literal keys added since `a8bcf5d` | 0 lines | `template-keys-since-arch-r2.txt` |
| Template-built keys, whole tree | 23 hits, each classified | `template-keys-whole-tree.txt` |
| Message-parameter producers | 1 bilingual name (`forum`); every other param name classified, 0 unclassified | `message-params-scan.txt` |
| Bilingual name and label columns in the migrations | 22 tables | `bilingual-name-columns.py`, `bilingual-name-columns.txt` |
| Contract diff against `983fdfa` (`diff -U0`) | 12 hunks, 4 `-`, 101 `+` | `openapi-diff.txt` |
| This run's ADR edits against the WIP (`git diff d74d75c -- docs/architecture`) | 3 files | `adr-diff-vs-wip.txt` |

**Not run:** the e2e suite. It is not an acceptance check of this assignment, and this task changes no runtime behaviour. Migration `0061` was not written, so there is no probe output (acceptance 4 does not apply).

## 4. Extended code table (continues ARCH-R2's 164–185)

"server" texts are what the API sends, or will send once the named task builds it. "authored" texts are written here, because the server sends only the key. Arabic is for FE to write, and stays provisional until linguistically reviewed.

| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where (as built, or to build) |
|---|---|---|---|---|---|---|---|
| 186 | `dashboard.value_class_not_applicable` (at `/valueClass`) | 422 | ADR-0037 K1, K2 | **new** (item 4) | A value class narrows only a drill-down of benefit values by state. | server (to build) | shared schemas/dashboards.ts (`DASHBOARD_REFUSALS`); api reporting/dashboards/drilldown.ts (`dashboardRefusal`) |
| 187 | `dashboard.value.sum_planned` | rule key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | Planned value = the sum of the planned values in the period. | authored | api reporting/dashboards/drilldown.ts (`` `dashboard.value.sum_${state}` ``) |
| 188 | `dashboard.value.sum_forecast` | rule key | ADR-0037 K2 | accepted (as row 187) | Forecast value = the sum of the forecast values in the period. | authored | as row 187 |
| 189 | `dashboard.value.sum_submitted` | rule key | ADR-0037 K2 | accepted (as row 187) | Submitted value = the sum of the values submitted for Finance validation in the period. | authored | as row 187 |
| 190 | `dashboard.value.sum_validated` | rule key | ADR-0037 K2 | accepted (as row 187) | Validated value = the sum of the Finance-validated values in the period. | authored | as row 187 |
| 191 | `dashboard.value.sum_measured` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Measured value = the sum of the measured values in the period. | authored | as row 187 (to build) |
| 192 | `dashboard.value.sum_rejected` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Rejected value = the sum of the values Finance rejected in the period. | authored | as row 187 (to build) |
| 193 | `dashboard.value.sum_sustained` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Sustained value = the sum of the sustained values in the period. | authored | as row 187 (to build) |
| 194 | `gate.modular_waiver_revoked` (row 169), now with `params.date` | 422 + problem member | ADR-0038 Q1, Q2 | **changed**: `params` added (item 2); code and text unchanged | The waiver of the missing baseline and outcome links was revoked on {date}; supply them or record a new waiver, then resubmit G3. | server (`params` to build) | api workflows/gates.ts; platform/problem.ts; shared problem.ts and schemas/problem.ts |
| 195 | `gate.modular_waiver_expired` (row 170), now with `params.date` | 422 + problem member | ADR-0038 Q1, Q2 | **changed**: `params` added (item 2); code and text unchanged | The waiver of the missing baseline and outcome links expired on {date}; supply them or record a new waiver, then resubmit G3. | server (`params` to build) | as row 194 |
| 196 | `governance.task.minutes_to_approve` (row 183), params `forum`, `forumAr`, `meetingDate` | work-item message key | ADR-0025 L1; ADR-0032 G3 | **changed**: param `forumAr` added (item 6); text unchanged | Approve the minutes of the {forum} meeting of {meetingDate}. | authored | api governance/minutes.ts |
| 197 | `dashboard.portfolio.slip_approved_date_missing` | reason key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | Unknown: a milestone has no approved date, so its slip cannot be counted. | authored | api reporting/dashboards/areas.ts (`` `dashboard.portfolio.slip_${slip.reason}` ``) |
| 198 | `dashboard.portfolio.slip_forecast_date_missing` | reason key | ADR-0037 K2 | accepted (as row 197) | Unknown: a milestone has no forecast date, so its slip cannot be counted. | authored | as row 197 |
| 199 | `dashboard.portfolio.slip_calendar_not_configured` | reason key | ADR-0037 K2 | accepted (as row 197) | Unknown: no business calendar is configured, so working-day slip cannot be counted. | authored | as row 197 |
| 200 | `dashboard.portfolio.slip_range_too_long` | reason key | ADR-0037 K2 | accepted (as row 197) | Unknown: the slip spans more working days than can be counted. | authored | as row 197 |
| 201 | `dashboard.kpi.green` | rule key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | KPI status: the KPI's displayed status is green. | authored | api reporting/dashboards/drilldown.ts (`` `dashboard.kpi.${s.displayedRag}` ``) |
| 202 | `dashboard.kpi.amber` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: the KPI's displayed status is amber. | authored | as row 201 |
| 203 | `dashboard.kpi.red` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: the KPI's displayed status is red. | authored | as row 201 |
| 204 | `dashboard.kpi.unknown` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: Unknown. | authored | as row 201 |
| 205 | `dashboard.kpi.stale` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: Stale. | authored | as row 201 |
| 206 | `dashboard.kpi.not_computable` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: not computable. | authored | as row 201 |

**Items without a new code:**
- 1 (`getInitiativeSchedule`): the platform 404 `not_found`;
- 3 (`listScaleScopeBusinessUnits`): 404 `not_found` and the existing 400 cursor validation;
- 5 (`getAssessmentFormVersion`): 404 `not_found`;
- 7: the existing `kpi.scope_missing` and `kpi.cumulative_incomplete`.

The rows also live in their ADR amendments (ADR-0037 K2, ADR-0038 Q2, ADR-0025 L1, ADR-0032 G3). `evidence/codes-table.md` is a copy of this table.

## 5. Every contract line changed (`docs/api/openapi.yaml`; diff `evidence/openapi-diff.txt`, `diff -U0` against the `983fdfa` file)

This run made no change to `openapi.yaml` relative to the WIP (`git diff --quiet d74d75c -- docs/api/openapi.yaml apps` exited 0). `diff -U0` shows exactly 12 hunks, 4 `-` lines and 101 `+` lines.

**Removed or replaced lines: 4.** Each is replaced in place; no other existing line changes.

| # | Line before | After | Reason |
|---|---|---|---|
| 1 | `getDashboardDrilldown` summary "Drill-down of one headline number: … 422 dashboard.metric_subject_mismatch, dashboard.period_not_found, dashboard.owner_not_found." | "… of one headline number or Finance class line: … , dashboard.value_class_not_applicable (ADR-0037 amendment K1)." | item 4 |
| 2 | `KpiEvaluation.inputs` description (ARCH-R2) | the same text plus two sentences: object members carry no order (C4), and `windowValues[]` on the cumulative basis (C5). The type is unchanged | item 7 |
| 3 | `DashboardMetric.enum: [… finance.pending_validation]` | the same list plus `value.measured, value.rejected, value.sustained` | item 4 |
| 4 | `FinanceValueLine.drilldownHref: { type: [string, "null"] }` | the same type with a description (every class and gross line drills; null only on a net line) | item 4 |

**Added lines** (101 `+` lines: the 4 replacements and 97 new lines):

- **Info paragraph** "P4 repairs (T-DG4-ARCH-R3, 2026-10-10)": 8 lines including the blank line.
- **`getInitiativeSchedule`**: 16 lines, a `get:` inserted on the existing `/api/v1/initiatives/{initiativeId}/schedule` path, before `post:`.
- **`getAssessmentFormVersion`**: 19 lines, a new path `…/assessment-forms/{assessmentFormId}/versions/{versionNo}`, inserted before `…/publish`. It reuses the existing `VersionNo` parameter component (`minimum: 1`).
- **`listScaleScopeBusinessUnits`**: 20 lines, a new path `…/scale-scope/business-units`, inserted before `…/scale-transitions`.
- **`getDashboardDrilldown`**: one parameter line (`DrilldownValueClassQuery`).
- **Parameter component `DrilldownValueClassQuery`**: 6 lines.
- **`Problem.params`**: 4 lines (item 2).
- **Schemas `ScaleScopeBusinessUnit` and `ScaleScopeBusinessUnitPage`**: 19 lines.
- **Schema `FinanceValueClass`**: 4 lines.

(8 + 16 + 19 + 20 + 1 + 6 + 4 + 19 + 4 = 97.)

**Unchanged:**
- **Every P1–P3 path, and every other existing P4 operation.** The 12 hunks are exactly the places listed above.
- **The one P1 component touched is `Problem`.** It gains one optional property (item 2), and no existing property of it changes (D-114).

## 6. Exact implementer changes

### BE-R4 (backend-workflow-engineer)

1. **`getInitiativeSchedule`** (ADR-0031 S1), in `apps/api/src/modules/portfolio/schedule-network.ts`:
   - add `app.get(INITIATIVE_SCHEDULE, { config: read }, …)`. Apply the same initiative read gate as the POST and PATCH: look up the initiative (404 when absent), then `requireTransformationRead` (404 outside scope);
   - select the `initiative_schedule` row by `initiative_id`: none → `problems.notFound()`; else `sendVersioned(reply, 200, toInitiativeSchedule(row))`;
   - add `GET ${INITIATIVE_SCHEDULE}` to the returned route list;
   - exercise it in `apps/api/test/integration/contract/p4-exercises-be-e.ts`, both after the existing create (200, `ETag` = the create's version) and for an initiative without a row (404);
   - remove it from `P4_PENDING_ARCH_R3`.
2. **`listScaleScopeBusinessUnits`** (ADR-0035 R1), in `apps/api/src/modules/workflows/scale.ts`:
   - `transformation.read`, 404 outside scope;
   - rows of the transformation's `organization_id`: `status = 'active'` OR `id IN` (the `business_unit_id`s of `gate_decision_scale_scope` and of `scale_transition` rows of this transformation);
   - members `{id, code, nameEn: name_en, nameAr: name_ar, status, selectable: status === 'active'}`;
   - order by `code`, `id`, with the cursor pattern of `listBusinessUnits`;
   - **tests:**
     - a Sponsor with only a transformation grant sees every active unit of the organization, and no unit of another organization;
     - a unit set to `inactive` after an approved scope named it is listed with `selectable: false`;
     - an `inactive` unit that no scope names is not listed;
     - an outsider gets 404;
   - exercise it in `p4-exercises-be-k.ts`, and remove it from the pending list.
3. **`getAssessmentFormVersion`** (ADR-0033 V1), in `apps/api/src/modules/adoption/assessments.ts`:
   - `transformation.read`;
   - the form must be in the transformation, else 404;
   - select `assessment_form_version` by `(form_id, version_no)`, else 404;
   - answer 200 `AssessmentFormVersion`, with no `ETag`;
   - **tests:** version 1 after an update to version 2 returns the old questions; version 99 gives 404; a form of another transformation gives 404;
   - exercise it in `p4-exercises-be-h.ts`, and remove it from the pending list.
4. **`Problem.params`** (ADR-0038 Q1):
   - `packages/shared/src/problem.ts`: `ProblemDetails.params?`;
   - `packages/shared/src/schemas/problem.ts`: the zod mirror `problem` gains `params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()`;
   - `apps/api/src/modules/platform/problem.ts`: `HttpProblem` gains an optional `params`, and `toBody` emits it after `currentVersion`, only when it is defined;
   - `apps/api/src/modules/workflows/gates.ts`: `gateModularWaiverRevoked(date)` and `gateModularWaiverExpired(date)` pass `params: { date }`;
   - **tests:** both refusals carry `params.date` equal to the date in `detail`. Every existing problem assertion passes unchanged.
5. **`forumAr`** (ADR-0032 G3), in `apps/api/src/modules/governance/minutes.ts` `minutesTask`: select `name_ar` as well, and pass `forumAr: forum.name_ar`. The test asserts both names on a new item.

### kpi-benefits-engineer task

1. **Drill-down `valueClass` and the three metrics** (ADR-0037 K1):
   - `packages/shared/src/schemas/dashboards.ts`:
     - the `dashboardMetric` enum gains `value.measured`, `value.rejected` and `value.sustained`;
     - add a `financeValueClass` enum;
     - `DASHBOARD_REFUSALS` gains `dashboard.value_class_not_applicable` with the K2 text;
   - `apps/api/src/modules/reporting/dashboards/drilldown.ts`:
     - `valueClass` in `drilldownQuery`;
     - the refusal `dashboardRefusal("dashboard.value_class_not_applicable", "/valueClass")` when it is used with a non-value-state metric;
     - `VALUE_STATE_OF` and `SUBJECT_METRICS` gain the three metrics;
     - `valueDrill` selects lines by the K1 item 3 rule (`financeClassOf`, `lineInWindow`, `entersLine`), with the measured, rejected and sustained lines from `loadExtraStateLines`;
   - `finance.ts`:
     - every class line's `drilldownHref` = its state's metric plus `valueClass`;
     - remove the "whole" condition;
     - leave `gross` and `net` as they are;
   - `filters.ts`: `drilldownHref` gains an optional `valueClass`, so the href carries it;
   - **tests:**
     - the K1 item 4 invariant test, over every class line of a fixture with at least 2 classes, 2 currencies, an overlap-held benefit and a valued non-financial benefit;
     - the scope sweep (§6) over the new metrics.
2. **Lineage** (ADR-0027 C4–C5), in `apps/worker/src/handlers/kpi.ts`:
   - `windowValues` on cumulative roll-up entries and on the entered cumulative `inputs`, only when the value is known;
   - the C5 tests: two scopes, two periods; the missing-scope rule pinned; period-basis shapes unchanged.
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
   - **`apps/web/src/i18n/problems-slices-hijk.test.ts` asserts that no problem text keeps a placeholder** (`not.toMatch(/[{}]/)`, translated without parameters). That assertion must allow `{{date}}` for exactly these two codes, and render them with `params` in the test.
3. **Scale-scope editor and view** (`GateP4.tsx`, `p4api.ts`):
   - read `listScaleScopeBusinessUnits`;
   - offer the units with `selectable: true`;
   - label scope items and transitions by `code`, with `nameEn` or `nameAr` by locale;
   - stop reading `listBusinessUnits` there.
4. **Finance dashboard:**
   - every class line links its `drilldownHref`;
   - a `net` line shows "gross − implementation cost" with links to the gross line's drill-down and to `value.investment`, never as a drillable total;
   - EN/AR text for the problem key `dashboard__value_class_not_applicable` (row 186);
   - EN/AR text for the seven `dashboard.value.sum_<state>` rule keys (rows 187–193). `apps/web/src/i18n/en/dashboards.json` has only `sum_investment` today, so the other keys render "Rule not listed in this release.";
   - EN/AR text for the ten keys of rows 197–206.
   - **Row 186 is not caught by `problems-slices-hijk.test.ts`.** That test reads only rows that begin `| 4xx | \`code\``, and the amendment tables begin with the code (the format of every ARCH-R1/R2 amendment table). So it must be added by hand.
5. **Assessment record page:** read `getAssessmentFormVersion` for the record's `formVersionNo`, and label answers from it. A key that the version lacks shows the key with "Unknown question" (never blank).
6. **My Work** (`MyWorkPage.tsx` `renderMessage`):
   - in Arabic, a placeholder `{{p}}` takes `params[p + "Ar"]` when it is a non-empty string;
   - a `…Ar` member is never a placeholder of its own (ADR-0025 L1);
   - add a `message-keys.test.ts` case for `governance.task.minutes_to_approve`, with and without `forumAr`.
7. **KPI lineage display** (if any screen lists `sources`): sort by variable name, and show "not recorded" for a cumulative row without `windowValues` (ADR-0027 C4, C5).

## 7. Known gaps and not done

- **Nothing in this task changes runtime behaviour.**
  - The three new reads have no route until BE-R4 routes them; they are pending.
  - `params`, `forumAr`, `valueClass`, `windowValues` and the three metrics exist only in the contract and the ADRs until their tasks build them. Until then, a drill-down request with `valueClass` or a new metric is refused with 400 by today's strict query schema.
- **The net Finance lines stay without a drill-down** (ADR-0037 K1 item 5), a stated limitation with its reason.
- **The FE ADR-table guard test does not read amendment tables** (§6 FE-R3 item 4). I did not change it, because it is FE-owned. The orchestrator may want it extended to the amendment format.
- **D-114 is not yet a row in `decisions.md`** (header). ADR-0038 Q1 quotes the answer as this assignment gives it.
- **The data dictionary** is not edited for `kpi_evaluation.inputs` or `work_item.message_params`, because their catalogue facts (type, CHECK) do not change.
- **ADR text is not edited in place.** Every correction is a dated amendment appended to its ADR; "where this amendment and §x differ, this amendment wins". This run's corrections to the WIP amendments are edits inside those same uncommitted amendments (`evidence/adr-diff-vs-wip.txt`).

## 8. Merge instructions

- **No migration.** Apply nothing.
- **Conflicts to expect:**
  - `contract.test.ts`: only the operation-count pin (652) and its comment lines.
  - `p4-pending.ts` and `p4-operations.ts`: append-only lines.
  - `docs/api/openapi.yaml`: the hunks of §5. FE-F2, FE-G2 and QA-B do not own it (p4-plan §5.3).
- **Integrating on top of `d74d75c`:** this run's tree is the WIP commit plus uncommitted edits to three ADRs (ADR-0025, ADR-0037, ADR-0038), this handback, and the new evidence folder.
- **After the merge:** the P4 aggregate pending list gains 3 operations (`getInitiativeSchedule`, `listScaleScopeBusinessUnits`, `getAssessmentFormVersion`). All three must be routed before the DG4 candidate freezes.
- **Ordering:**
  - BE-R4 and the kpi-benefits task depend on these amendments;
  - FE-R3's items 1, 2, 3, 5 and 6 depend on BE-R4, and its item 4 on the kpi-benefits task.
