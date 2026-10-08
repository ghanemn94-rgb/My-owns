# Handback T-DG3-AN-P3: DG3 register update (transformation-analyst)

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Task:** T-DG3-AN-P3. Assignment `docs/delivery/assignments/DG3/T-DG3-AN-P3.md`, sha256 `f259cf42982b8801f6fe3901d067359809e1e15be6470335ef600c71d67399e8` (verified with `sha256sum` before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-AN-P3-transformation-analyst-20261008T040435Z-f879435e","session_id":"f879435e-9c12-4425-9b7d-9a26eda1f34e"}`
- **Working tree:** `/home/user/wt/dg3-an-p3`, branch `dg3/an-p3`. Base `HEAD` = `f779a7be368753344f65149bde5b4024eba906ee` ("DG3: wave-6 assignments …"). `git status` was clean apart from untracked top-level dotfiles that are not mine.
- **Time:** started `Thu Oct  8 04:04:43 UTC 2026`; the register was finished and verified at `04:10:59 UTC`; the handback was written right after.
- **Role boundary:** I approve nothing. G1–G6 business approvals that appear in tests are synthetic demo approvals, and product gate G6 is unrelated to DG7. This update does not review my own deliverables.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | The 32 rows with `final_gate` = DG3: `status` SPECIFIED → IMPLEMENTED; `evidence` filled with `;`-separated repository files; one sentence "DG3 analyst check (T-DG3-AN-P3, base f779a7b): …" appended to `notes`, keeping the existing notes. No other row or column changed. |
| `docs/delivery/handbacks/DG3/T-DG3-AN-P3-transformation-analyst.md` | This handback. |

**Not changed:** `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate` stay exactly as they were. A script comparing against `HEAD` confirmed this (§4). No later-gate row was touched.

I added **no** "P3 increment delivered" pointers to the work-split §8 rows. The assignment makes them optional, and leaving them out keeps the diff to the 32 rows. The orchestrator can request them separately.

## 2. How the evidence was chosen

For each row I opened the cited integration, unit and web test and read the assertions against the row's `acceptance` text. I didn't rely on test titles. Each row's evidence lists:

- the implementing module files;
- the migration, where the row needs one;
- the verifying tests;
- the governing ADR;
- the run logs of the latest full runs on this code:
  - `docs/delivery/handbacks/DG3/T-DG3-ARCH-04-evidence/integration.log`: `pnpm test:integration`, 55 files, **787 passed**, exit 0 (`integration-exit.txt` = 0). This run predates the FE-E merge. `git diff --stat a28f2d8 HEAD -- apps/api packages` is **empty**, so the API and package code it tested is identical to this tree.
  - `docs/delivery/handbacks/DG3/T-DG3-FE-E-evidence/test-c-utf8.log`: `pnpm test`, 79 files, **1517 passed**.
  - `docs/delivery/handbacks/DG3/T-DG3-FE-E-evidence/e2e-c-utf8.log`: Playwright, **128 passed**, exit 0 (`e2e-counts.txt`).

**I did not re-run** the unit, integration or e2e suites myself. The analyst sandbox has no database, and test runs aren't in my scope. Their results above are the implementers' recorded runs, cited from their evidence files, and not my own. The QA reviewer must re-run them on the frozen candidate.

## 3. Per row: acceptance clause → the test that asserts it

Test paths are relative to the module or test root, as follows:

- `IT/` = `apps/api/test/integration/`
- `SH/` = `packages/shared/src/`
- `MOD/` = `apps/api/src/modules/`
- `WEB/` = `apps/web/src/pages/`

| Row | Acceptance clause (binding) | Asserted by |
|---|---|---|
| REQ-PB-004 | End-to-End, G3 not approved: POST launch → 422 invalid-transition 'North Star, outcomes and target state not yet approved'; after G2+G3 the same call succeeds | `IT/portfolio/transitions.test.ts` "REQ-PB-004 (acceptance): …": exact type, code `initiative.direction_not_approved` and detail; still refused with only G2; 200 `launched` after G3. Pure rule: `MOD/portfolio/sequencing.test.ts`. UI: `WEB/portfolio/portfolio.test.tsx` "launch refused". |
| REQ-PB-006 | Submit with no outcome/KPI link → validation error naming 'Outcome before activity'; with a link → accepted | `IT/portfolio/transitions.test.ts` "REQ-PB-006": 422 `urn:mth:problem:validation`, detail "Outcome before activity: …", pointer `/outcomeContributions`; a contribution without a KPI is still refused; with a measurable contribution → 200 `submitted`. |
| REQ-PB-007 | Before G1, an initiative cannot leave Draft (422 invalid-transition); readiness lists the missing diagnostic dimensions | `IT/portfolio/transitions.test.ts` "REQ-PB-007/REQ-PB-022: before G1 → 422 invalid-transition …" (status stays `draft`, version 1) and "a draft launched before G1 reports G1 first". `IT/portfolio/readiness.test.ts`: `missingDiagnosticAreas` = all five B0012 areas. `WEB/readiness/readiness.test.tsx`. |
| REQ-PB-019 | G4 submission where an initiative has no owner is rejected, listing 'Owners' | `IT/gates/g4.test.ts` "422 gate_criteria_incomplete names 'Owners', …": `g4.owners` message `Owners: INI-nn <name>`, code `g4.owner_missing`. The eight criteria cover cards, business cases, Finance validation, prioritization, roadmap, owners, funding and capacity. `WEB/gates/g4.test.tsx`. |
| REQ-PB-022 | G1 approval without the three agreement confirmations is rejected; pre-G1, adding an initiative to the portfolio → 422 invalid-transition | `IT/portfolio/g1-agreements.test.ts`: 422 `gate.g1_agreements_required` with the three pointers, partial confirmations refused, and the 0025 deferred guard refuses at COMMIT. Pre-G1 submit → 422 invalid-transition `initiative.g1_not_approved` in `IT/portfolio/transitions.test.ts`. |
| REQ-PB-032 | Tree nodes for all five levels persist and link; a contribution without an outcome link is rejected | `IT/portfolio/links.test.ts` "outcome contributions (REQ-PB-032)": missing `outcomeId` → 400 `/outcomeId`; a KPI of another outcome → 422; the persisted contribution appears in `GET /outcome-hierarchy`. `IT/portfolio/readiness.test.ts`: North Star → outcome tree. `WEB/portfolio/portfolio.test.tsx` "outcome hierarchy: five levels". See observation O-1. |
| REQ-PB-040 | Attaching an initiative as G3 TOM evidence is rejected; an initiative links to one or more TOM gaps | `IT/portfolio/links.test.ts`: `it.each` over the TOM record types → 422 `initiative.not_tom_evidence` with the exact text; "accepts 1..n links to a TOM gap …"; "G3 completeness is identical with and without initiatives". Also `p3-exercises-be-b.ts`. |
| REQ-PB-045 | T05 persists all 14 source fields; Key deliverables outside 3-7 shows a warning | `IT/portfolio/initiatives.test.ts` "creates a draft with every T05 card field …" (warning `initiative.deliverable_count`, not a rejection). Links (gap, outcome, decisions) are in `IT/portfolio/links.test.ts`; deliverables (3-7 `countWarning`) and milestones in `IT/portfolio/roadmap.test.ts`. The field mapping is ADR-0021 §2. `WEB/portfolio/portfolio.test.tsx` "shows all 14 T05 fields … 3-7 deliverables warning (a warning, not a block)". |
| REQ-PB-046 | G4 submission containing an initiative with no gap link is rejected, naming that initiative | `IT/gates/g4.test.ts`: `g4.initiative_cards` message `Gap link missing: INI-nn <name>`. The outcome half is enforced at submit (`transitions.test.ts`). |
| REQ-PB-047 | T06 persists all criteria per initiative; Weighted score is read-only (calculated) | `IT/portfolio/prioritization.test.ts` "scores …": a `weightedScore` property in the body → 400 and nothing written; all five criteria scored and stored; the result is computed server-side. `WEB/prioritization/prioritization.test.tsx` (scorecard weighted score read-only). |
| REQ-PB-048 | 5,4,3,2,1 → 3.30 (decimal, exact); 6 rejected; missing → 'incomplete' | `SH/scoring.test.ts` "5,4,3,2,1 under 25/25/20/15/15 → 3.3000 stored, 3.30 displayed". `IT/portfolio/prioritization.test.ts`: score 6 → 400 at `/score`; stored 3.3000 / shown 3.30; missing → `incomplete`, `weightedScore` null. |
| REQ-PB-049 | 95%/105% rejected; risk/compliance 10% + strategic fit 15% accepted as v2 and used for rescoring; v1 scores keep v1; history names 'weight version 2' | `IT/portfolio/prioritization.test.ts`: "95% and 105% → 422 prioritization.weights_total"; "v2 with risk_compliance 10 and strategic fit 15 is accepted as version 2 …"; "the v2 set is used for rescoring; v1 results keep v1; a set is immutable (DB guard)"; "rankings and history" `causeLabels` = `weight version 2`. |
| REQ-PB-050 | Four waves seeded verbatim (e.g. '0-6 weeks', 'Sponsor + charter'); overlapping horizons accepted | `IT/portfolio/roadmap.test.ts` "a new transformation shows the four B0079 waves verbatim, bilingual" and "overlapping horizons and dates are accepted". `WEB/roadmap/roadmap.test.tsx`, `WEB/roadmap/fe-e.test.tsx`. |
| REQ-PB-051 | T08 persists all 7 columns; From accepts an initiative or 'External'; a cycle A->B->A is reported | `IT/dependencies/t08.test.ts`: "the seven T08 columns round-trip"; "From `external` with a label is accepted"; "A→B→A is reported the same way ('INI-01 → INI-02 → INI-01')". |
| REQ-PB-052 | The four source types are present and cannot be deleted; an unknown type value is rejected by the API | `IT/dependencies/t08.test.ts`: system types decision/tech/data/vendor (B0081) plus other (M0136) listed; DELETE → 422 `dependency_type.system_undeletable`; "an unknown or retired type is 422 dependency.unknown_type"; custom types can be added, relabelled and retired. |
| REQ-PB-053 | All ten sections persist; an investment line carries exactly one classification; SAR amounts are decimals | `IT/kpi/business-cases.test.ts`: "all ten sections persist and read back"; "two classes → 400 at /class"; amounts as decimal strings (`150000.2500`). |
| REQ-PB-054 | An initiative case links to one transformation case; editing it changes the roll-up without duplicating benefits | `IT/kpi/business-cases.test.ts` "an initiative case links to the one transformation case …" and "editing an initiative line changes the roll-up without duplication" (4 line rows, nothing copied; total 600000 → 650000.25). |
| REQ-PB-055 | G4 submission with a business case whose benefit formula is unvalidated → rejected, listing 'Finance validation' | `IT/gates/g4.test.ts` end-to-end test: the only error is `{pointer: /criteria/g4.finance_validation, code: g4.finance_validation_missing, message: "Finance validation"}`. FIN-only validation: `IT/kpi/business-cases.test.ts` and `IT/kpi/benefit-formulas.test.ts` (author → 403). |
| REQ-PB-056 | T09 persists all 6 columns; Confidence outside H/M/L rejected; a formula with an undefined variable rejected | `IT/kpi/benefit-formulas.test.ts`: "the six T09 columns persist"; "confidence outside H/M/L → 400 … the DB CHECK refuses it too"; "an undefined variable → 422 'Undefined variable: {name}'". `SH/formula/formula.test.ts`. |
| REQ-PB-057 | 0.10→0.12 × 100000 customers × ARPU 50 SAR = 100000 SAR exactly; cost example computes exactly | `SH/formula/formula.test.ts`: revenue example "→ exactly 100000 SAR per year"; cost example "200000 × (12.50 − 10.00) → exactly 500000.00 SAR". `IT/kpi/benefit-formulas.test.ts` "… exactly 100000 SAR per year; cost_reduction 500000" (examples seeded verbatim, marked illustrative). The values are synthetic fixtures. |
| REQ-PB-059 | Capacity demand above availability shows a conflict indicator; G4 lists initiatives without owners | `IT/portfolio/capacity.test.ts` "over-allocated with the decimal shortfall; Unknown without a capacity row …" (`capacity.over_allocated`). `MOD/portfolio/capacity.test.ts`. `IT/gates/g4.test.ts` (`Owners: INI-nn …`). `WEB/capacity/capacity.test.tsx`. |
| REQ-DLV-035 | Weighted-score unit tests pass (3.30); 95% rejected; dependency cycles reported; G4 approval flow end to end | `SH/scoring.test.ts` (3.30); `IT/portfolio/prioritization.test.ts` (95%); `IT/dependencies/t08.test.ts` (cycles); `IT/gates/g4.test.ts` "G4 end to end with distinct synthetic TL, FIN, SP and capacity-owner users" (submit, FIN validates and funds, commit, 403/403/409, SP approves → phase `transform`). See observation O-2. |
| REQ-S04-006 | G4 with an initiative lacking a funding decision or capacity commitment → rejected, naming it; non-approver or submitter → 403; superseded submission → 409 | `IT/gates/g4.test.ts`: `Funding decision missing: INI-nn <name>` and `Capacity commitment missing: INI-nn <name>`; FIN, capacity owner and AUD → 403 `gate.not_approver`; the submitter → 403 `gate.submitter_cannot_decide`; submission 1 after submission 2 → 409 `gate.submission_superseded`. |
| REQ-S05-005 | A line with two classes is rejected; the case total equals the sum of distinct lines, each counted once | `IT/kpi/business-cases.test.ts`: "two classes → 400 at /class"; "the total equals the distinct lines once" (compared with a direct SQL sum). `MOD/kpi/totals.test.ts`. |
| REQ-S08-007 | Monthly ARPU × annual population without conversion is rejected; 0.02 × 100000 × 50 SAR = 100000 SAR exactly | `SH/formula/formula.test.ts` "monthly ARPU × annual population → formula.period_mismatch" and the revenue example. `IT/kpi/benefit-formulas.test.ts` "changing arpu to period = month … → 422 formula.period_mismatch". |
| REQ-S09-001 | The documented conversion (score-1)/4×100 shows 3.30 as 57.5 with the conversion label; the 1-5 value stays the stored result | `SH/scoring.test.ts` "0–100 view of 3.30 → 57.5 with the conversion string and label". `IT/portfolio/prioritization.test.ts`: `display100` "57.5", `conversion` "(score-1)/4*100", `conversionLabel`, stored `weightedScore` "3.3000". `WEB/prioritization/prioritization.test.tsx`. |
| REQ-S09-003 | A selected initiative without a funding approval shows 'Selected - unfunded' and cannot be launched | `IT/portfolio/transitions.test.ts` "ranking never selects; select … shows 'Selected - unfunded'" and "'Selected - unfunded' cannot launch (also after a rejected/deferred or revoked funding decision)" → 422 `initiative.selected_unfunded`. `IT/portfolio/funding.test.ts` (deselect rule). |
| REQ-S09-004 | An initiative sequenced before its predecessor is flagged; overlapping demand above capacity shows a conflict indicator | `MOD/portfolio/schedule.test.ts` "schedule.before_predecessor" (earlier start or earlier wave). `IT/portfolio/roadmap.test.ts` (API read model shows `schedule.before_predecessor`). `IT/portfolio/capacity.test.ts` (`capacity.over_allocated` in the prioritization view). `IT/portfolio/prioritization.test.ts` "comparison view": axes, filters, ranked table. |
| REQ-S09-005 | An override without a reason is rejected; the history shows 'weight version 2' as the cause of a rank change | `IT/portfolio/prioritization.test.ts` "an override without a reason is rejected (missing/empty → 400 at /reason; blank/invisible → 422)" and the history `causeLabels` "weight version 2". `WEB/prioritization/prioritization.test.tsx`; `apps/web/e2e/p3-prioritization-roadmap.spec.ts`. |
| REQ-S09-006 | Moving a milestone on the timeline updates the table and board; conflicting concurrent edits show a conflict | `WEB/roadmap/roadmap.test.tsx` "moving a milestone … the timeline, table and board all show the new date from one refetch" and "a 409 … shows the conflict notice". `IT/portfolio/roadmap.test.ts` "one read model" and "stale 409 with currentVersion". e2e: `p3-prioritization-roadmap.spec.ts` "roadmap: … moving a milestone updates the timeline, table and board; a stale edit is a 409 conflict". |
| REQ-S09-008 | A->B->C->A is rejected naming the cycle; a predecessor finishing after the successor's needed-by date is flagged | `IT/dependencies/t08.test.ts` "A→B→C→A is 422 naming the cycle exactly" (`Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01`), plus concurrent API and DB race tests; "a predecessor finishing after the needed-by date is flagged". `MOD/portfolio/schedule.test.ts` "schedule.needed_by_conflict". |
| REQ-S16-016 | ERD and migrations contain all eight entities with PK, owner and status; an integration test creates and reads each through the API with authorization enforced | `docs/architecture/erd.md` §1c.5 (entity → table, PK, owner, status). `0020` (initiative, roadmap_wave, deliverable, milestone), `0017` + `0022` (dependency, extended), `0022` (capacity, resource_demand, funding_decision). Create + read + 403/404: `IT/portfolio/initiatives.test.ts`; `IT/portfolio/roadmap.test.ts` (wave, deliverable, milestone); `IT/dependencies/t08.test.ts`; `IT/portfolio/capacity.test.ts` (capacity, resource demand); `IT/portfolio/funding.test.ts` (FundingDecision GET and list, a stranger gets 404, TL/WL/TO/AUD get 403). |

## 4. Checks actually run (this task)

All of these ran in `/home/user/wt/dg3-an-p3` on Linux, under the analyst sandbox.

| Command | Result | Exit |
|---|---|---|
| `node tools/gates/validate.mjs --register DG3` (before the edit) | `FAIL register rules at DG3 (64 problems)`: exactly the 32 rows × (not IMPLEMENTED, no evidence) | 1 |
| `node tools/gates/validate.mjs --register DG3` (after) | `PASS register rules at DG3` | **0** |
| `node tools/gates/validate.mjs --register DG2` | `PASS register rules at DG2` | **0** |
| `node tools/gates/validate.mjs --historical --stage DG2` | `PASS gate DG2 (historical)` | **0** |
| CSV parse check (python `csv`, see below) | `rows(incl header) 413 columns 19 rows with wrong column count []`; `DG3 status Counter({'IMPLEMENTED': 32})`; `missing evidence files []` | **0** |
| Column-preservation check against `git show HEAD:docs/delivery/requirements.csv` | `columns changed: ['evidence', 'notes', 'status'] violations: [] rows changed: 32` (also checks that every new `notes` starts with the old `notes`) | **0** |
| Round-trip check before editing: `csv.writer(lineterminator='\n')` reproduces the original file byte for byte | `True` (so unchanged rows keep their exact quoting) | 0 |
| `git diff --stat` (before writing this handback) | `docs/delivery/requirements.csv \| 64 +++---`, `1 file changed, 32 insertions(+), 32 deletions(-)` | 0 |
| `git diff --stat a28f2d8 HEAD -- apps/api packages` | empty: no API or package change since the ARCH-04 integration run | 0 |

The update script lives outside the repository (run scratch). It asserts that each target row is DG3/SPECIFIED, that no evidence path is duplicated, and that every evidence path is an existing regular file (`os.path.isfile`). If any check fails, it writes nothing.

**Not run by me:** `pnpm test`, `pnpm test:integration` and Playwright e2e. The results in §2 are the implementers' recorded runs.

## 5. Gaps and observations (stated plainly)

**Real gaps (rows left SPECIFIED): none.** For all 32 rows I found implementing code and a test that asserts the acceptance clause.

These observations do not block IMPLEMENTED, but reviewers should check them:

- **O-1 (REQ-PB-032), test depth.** "Tree nodes for all five levels persist and link":
  - At API level, `readiness.test.ts` asserts the North Star → outcome levels directly, with empty KPIs and contributions.
  - `links.test.ts` asserts only that the persisted contribution's id appears in the `/outcome-hierarchy` JSON. The world it uses has an outcome KPI with a target, so the KPI and target levels are present.
  - No API test asserts the full nested shape (outcome → `kpis[].targetValue/targetDate` → `kpis[].contributions[]`) field by field. The web test (`portfolio.test.tsx`) asserts all five levels, but on a mocked response.

  If a reviewer reads the clause literally, adding a full-shape assertion to an integration test would close this. The orchestrator should decide whether that's a finding.
- **O-2 (REQ-DLV-035), e2e scope.**
  - The "G4 approval flow runs end to end" clause is asserted at API level (`gates/g4.test.ts`, distinct synthetic users through to phase `transform`).
  - None of the existing P3 browser e2e specs drives the G4 flow. FE-D's `apps/web/e2e/p3-journeys.spec.ts` (in progress, not in my tree) presumably will.
  - Once FE-D merges, the orchestrator may want to add that spec to this row's evidence. I couldn't cite it, because it doesn't exist in this tree.
- **O-3, run currency.** The integration run cited (ARCH-04) was taken before the FE-E merge. The API and packages are unchanged since then (empty diff), but BE-F's `g4.schedule_unknown` work (running alongside this task) will change `workflows/g4.*`. After BE-F merges, the QA re-run on the frozen candidate is the evidence that counts for REQ-PB-019, REQ-PB-046, REQ-PB-055, REQ-S04-006 and REQ-DLV-035.
- **O-4, notation.** In the appended notes I wrote arrows and multiplication signs in ASCII (`->`, `x`), while the cited tests use `→` and `×`. This is cosmetic only, and the cited test titles are still unambiguous.

## 6. Merge instructions

- One file in the register (`docs/delivery/requirements.csv`), plus this handback. No migrations, no code.
- **Conflicts:** none expected with FE-D (`apps/web/e2e/p3-journeys.spec.ts`) or BE-F (`g4.schedule_unknown`), since neither touches the register. If another task edits `requirements.csv` before this merges, re-run `node tools/gates/validate.mjs --register DG3` after resolving.
- After FE-D merges, consider adding `apps/web/e2e/p3-journeys.spec.ts` to the REQ-DLV-035 (and, where it asserts them, REQ-S04-006 / REQ-PB-019) evidence (O-2).
