# Handback T-DG4-AN-P4A (transformation-analyst): DG4 register update, half A (71 rows → IMPLEMENTED)

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-AN-P4A-transformation-analyst-20261010T154158Z-fbaf7d4b","session_id":"fbaf7d4b-5cac-49c3-bdae-4b9696710c52"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-AN-P4A.md`. Its SHA-256 `40e83811…26df1b63` was verified before starting.
- **Tree:** worktree `/home/user/wt/dg4-an-p4a`, branch `dg4/an-p4a`, base `HEAD = e3acab1145482e3b611dfaaad35b44b04cd18e1f`. Its code is identical to the merged and verified tree `dca6b64` (D-115): `git diff dca6b64 HEAD` touches only assignments, `decisions.md`, `progress.md` and the W18 orchestrator logs.
- **Time:** started 2026-10-10 15:42:10 UTC (`date -u`); end time is in §6.
- **Nature:** register bookkeeping only. No product code, test, ADR, review, gate record or source was touched. No business, Finance or IT approval was granted. Product gates G1–G6 named below are in-product approvals of synthetic test data, and none of them implies anything about DG4 or DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | My 71 DG4 rows: `status` SPECIFIED → IMPLEMENTED, `evidence` filled (638 existing repository paths, `;`-separated), and one "DG4 analyst check (T-DG4-AN-P4A, base e3acab1): …" sentence appended to `notes`, keeping the existing notes. No other column and no other row changed. |
| `docs/delivery/handbacks/DG4/T-DG4-AN-P4A-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG4/T-DG4-AN-P4A-evidence/` | Validator logs, `verify-rows.py` with its output `verify-rows.log`, and `rows.py` (the exact per-row evidence and note text that was applied). |

No `docs/analysis/**` file was needed.

## 2. How the evidence was chosen

For each row I followed this method:
1. I took the owner and proof location from the requirement → owner tables of `docs/architecture/p4-work-split.md` (I+C.7, A.7, B.7, E.7, D.7, FG.10, H.8, JK.9) and from the repair decisions D-109 to D-115.
2. I took the acceptance-suite mapping from the three QA authoring handbacks (QA-A: A04/A05/A10; QA-B: A08/A09 plus the partials; QA-C: A11/A03 plus the REQ-DLV-036 run).
3. **Before citing a test, I opened it and checked that its assertions match the acceptance clause literally** (`describe`/`it` titles and their `expect` lines). The per-row section below names the assertion.

Each evidence list contains:
- the implementing modules (`apps/api/src/modules/**`, `apps/worker/src/handlers/**`, `packages/shared/src/**`, `apps/web/src/pages/**`);
- the verifying API, worker, unit, web and e2e tests, and the acceptance suites (`tests/qa/**`, root `e2e/a0*`);
- the governing ADR (0025–0038);
- the relevant QA handback;
- the merged-tree run log `docs/delivery/test-evidence/DG4/orchestrator/w18-merged-dca6b64/integration.log`. That run passed 1919/1919 and includes every `tests/qa/integration/a*` suite and every worker test. Where relevant I also cite `e2e-unset.log` (web e2e 328/328, chromium-en and chromium-ar) and `unit-unset.log`.

**Later-gate rows with a P4 increment:** none was changed. I added no "P4 increment delivered" pointers; the assignment made them optional.

## 3. Checks run (real exit codes)

Environment: the sandboxed worktree, Node from PATH, offline. I re-ran no product tests. Test results cited in the register come from the orchestrator's merged-tree run (`dca6b64`) and the QA handback logs, which are named per row.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --register DG4` | **1** | `FAIL register rules at DG4 (132 problems)`: exactly 2 problems on each of 66 rows ("requires IMPLEMENTED … (is SPECIFIED)" and "IMPLEMENTED for DG4 without evidence"). **All 66 are the other half's rows (T-DG4-AN-P4B). None of my 71 rows appears**, and there is no non-row problem. Expected to PASS only once both halves are merged. Log: `T-DG4-AN-P4A-evidence/validate-register-DG4.log`. |
| 2 | `node tools/gates/validate.mjs --register DG3` | 0 | `PASS register rules at DG3` |
| 3 | `node tools/gates/validate.mjs --register DG2` | 0 | `PASS register rules at DG2` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` |
| 5 | `python3 -I docs/delivery/handbacks/DG4/T-DG4-AN-P4A-evidence/verify-rows.py` (compares with `git show HEAD:docs/delivery/requirements.csv`) | 0 | see the output below |
| 6 | `git diff --stat` | 0 | `docs/delivery/requirements.csv | 142 +++---, 1 file changed, 71 insertions(+), 71 deletions(-)` (the handback and its evidence are new, untracked files) |

Output of check 5 (`verify-rows.log`):

```
mine: 71
header unchanged: True | columns: 19
rows base/new: 412 412 | every row has 19 fields: True
re-serialises byte-identically (valid quoting, LF): True
same ids in same order: True
changed rows: 71 | all mine: True | mine unchanged: []
changes outside status/evidence/notes: []
old notes kept as prefix: True
all mine IMPLEMENTED, final_gate DG4: True
evidence paths: 638 | missing files: []
DG4 statuses: {'IMPLEMENTED': 71, 'SPECIFIED': 66}
exit=0
```

`req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate` are unchanged on every row; the script checks this.

## 4. Known gaps, partial coverage and disclosures

**No row was left SPECIFIED.** I found behaviour and a test for every acceptance clause of my 71 rows. The partial points below are written into each row's `notes`; none of them is hidden.

| Row | What is only partly proven | Kind |
|---|---|---|
| REQ-PB-010 | No test re-reads the "scorecard" (the T10 Portfolio area, D-106 (d)) after a rename. `one-source-of-truth.test.ts` asserts roadmap, traceability view, benefits register and exactly one DB row. `portfolio/dashboard-facts.ts` reads `initiative.name` live from that single row. | **Test-coverage gap** (behaviour verified by code reading only). Recommend a one-assertion addition to `reporting/dashboards.test.ts` or the A01 suite. |
| REQ-S03-004 | The A02 clause "a Design-phase draft can be saved before G2" has no DG4 test. It is proven implicitly by the DG2 `registers.test.ts`, which creates T03 gaps and T04 design decisions (201) in a world whose G2 is never approved; that test does not pin G2's state. QA-B's assignment excluded this clause. | **Test-coverage gap** (implicit proof). Recommend an explicit assertion (G2 Draft, then a Design-phase record saved). |
| REQ-PB-066 | The server clock cannot be set, so the "raised Thursday" case runs through the calendar API on the same engine (and in `working-days.test.ts`). The real approval checks the weekend and holiday skip from today's date. | Disclosed (D-114, QA-B) |
| REQ-PB-065, REQ-S04-014, REQ-S07-015 | Proven by API integration tests and stubbed web tests only, not on the real-stack e2e. | Disclosed (D-114) |
| REQ-S04-013 | Expiry is driven through the product's `setGateExceptionClock` seam. | Disclosed (QA-B) |
| REQ-S04-010 | Draft → Approved is refused with 409 `gate.submission_superseded`, not 422. The test pins "a refusal". | Disclosed (QA-B observation; for the domain reviewer) |
| REQ-S07-005 | The negative-baseline flag is asserted at unit level only. Zero denominator and Not comparable are also asserted through the API. | Disclosed |
| REQ-S07-007 | A threshold change recomputes the current period only (ADR-0027 §8, ADR-0028 §5). | Disclosed (QA-A observation 3) |
| REQ-S07-002 | In the API suite, adverse is asserted as amber or red; it is pinned at unit level. | Disclosed |
| REQ-S07-010 | The row's own example (1/10, 9/10) cannot tell weighting from averaging, so QA added 1/10 and 80/90. | Disclosed |
| REQ-DLV-036 | The A04/A09/A10/A11 suites passed 81/81 in QA-C's run and in the merged-tree run at `dca6b64` (code identical to this base). The run on the **frozen DG4 candidate** has not happened yet; it is a review-time check. | Disclosed. IMPLEMENTED means the deliverables and suites exist and pass on the integrated tree, not that the candidate was verified. |

Not done: I re-ran no test suite myself. Every test result cited is from the orchestrator or QA logs named in the evidence. The register rows point to those logs.

## 5. Merge instructions

- Merge `docs/delivery/requirements.csv` **row by row** with T-DG4-AN-P4B's half. My diff touches only my 71 rows (status, evidence, notes), and the file keeps LF endings and minimal quoting. The other half's 66 rows are byte-identical to `HEAD`, so a row-level merge has no overlap.
- After merging both halves, re-run `node tools/gates/validate.mjs --register DG4`. It should then PASS, because its only failures here are the 66 rows of the other half.
- No migrations, no code, no dependencies.
- Changes are **uncommitted**, as instructed.

## 6. End time

Finished 2026-10-10 15:51:17 UTC (`date -u`).

## 7. Per row: acceptance clause and the test that asserts it

### REQ-PB-005 (SOURCE): Support Modular entry at a chosen phase or as a standalone TOM, business case or benefits register and flag missing links to outcomes and benefits

- **Acceptance clause:** A03: a transformation entering at Design with no baseline and no outcome links shows both as missing and G3 submission is rejected by the API until they are supplied or an authorized waiver exists
- **Asserted by:** A03 is asserted by a03-modular-entry.test.ts: at Design with no baseline and no outcome link both are flagged blocking, G3 submission is 422 gate.modular_links_missing listing both with nothing written, and it is accepted once both are supplied or an accepted, unexpired waiver exists (the D-110 waiver cases, including revoked and expired); e2e/a03-modular-entry.spec.ts shows the same refusal in chromium-en and chromium-ar.
- **Test files cited:** `apps/api/test/integration/reporting/modular.test.ts`, `apps/api/test/integration/workflows/modular-precondition.test.ts`, `apps/api/test/integration/workflows/modular-waiver.test.ts`, `tests/qa/integration/a03-modular-entry.test.ts`, `e2e/a03-modular-entry.spec.ts`, `apps/web/e2e/p4-traceability.spec.ts`

### REQ-PB-008 (SOURCE): Apply 'Operating model before execution': decision rights, ownership and cross-functional ways of working are explicit before execution

- **Acceptance clause:** A01: readiness for Transform shows 'not ready' when T11 or charter decision rights are empty and 'ready' once they are completed
- **Asserted by:** governance/raci-matrices.test.ts 'REQ-PB-008: Transform readiness' asserts not_ready while the charter decision rights or T11 are empty and ready once they are completed, with the pure checks in readiness-transform.test.ts.
- **Test files cited:** `apps/api/src/modules/portfolio/readiness-transform.test.ts`, `apps/api/test/integration/governance/raci-matrices.test.ts`

### REQ-PB-009 (SOURCE): Apply 'Benefits before closure': an initiative is complete only when value is realized and sustained, not when delivered

- **Acceptance clause:** A11: an initiative with delivery=Complete and no validated benefit cannot be closed (API 422 invalid-transition); UI shows 'Delivered — value validation pending'
- **Asserted by:** A11 is asserted by a11-value-closure.test.ts: the label is exactly 'Delivered — value validation pending' and closing an initiative with delivery Complete and no validated benefit is 422 invalid-transition with nothing written; also closure.test.ts and status-model.test.ts, and closure.test.tsx for the UI label.
- **Test files cited:** `apps/web/src/pages/closure/closure.test.tsx`, `apps/api/test/integration/sustainment/status-model.test.ts`, `apps/api/test/integration/sustainment/closure.test.ts`, `tests/qa/integration/a11-value-closure.test.ts`, `apps/web/e2e/p4-gates-closure.spec.ts`

### REQ-PB-010 (SOURCE): Apply 'One source of truth': keep the charter, roadmap, initiative portfolio and benefits register linked as canonical records

- **Acceptance clause:** A01: renaming an initiative changes it in roadmap, scorecard and benefits register views in one update; no duplicate initiative rows exist in the database
- **Asserted by:** one-source-of-truth.test.ts asserts that one PATCH of an initiative's name shows at once in the roadmap, the traceability view and the benefits register (initiatives[]), and that the database holds exactly one initiative row. Partial: the 'scorecard' read (the T10 Portfolio area, D-106 (d)) is not re-read after the rename by any test; portfolio/dashboard-facts.ts reads initiative.name live from the same single row, so this is a test-coverage gap rather than a behaviour gap.
- **Test files cited:** `apps/api/test/integration/reporting/one-source-of-truth.test.ts`

### REQ-PB-013 (SOURCE): Restrict Finance / Value Office validation of baseline, benefit logic and value realization to the Finance role

- **Acceptance clause:** A10;A12: a Business Owner calling the validate endpoint receives 403; a Finance user succeeds and the audit event records validator identity
- **Asserted by:** A10/A12 are asserted by a10-benefit-integrity.test.ts 'REQ-S08-015, REQ-PB-013': a BO and the auditor get 403 on the Finance decision with the total unchanged, a FIN user succeeds, and the audit event carries the FIN user as actor; also finance-validation.test.ts 'only Finance decides, and the audit names the validator' and the baseline half.
- **Test files cited:** `apps/api/test/integration/benefits/finance-validation.test.ts`, `tests/qa/integration/a10-benefit-integrity.test.ts`

### REQ-PB-014 (SOURCE): Model the six phases with name, purpose, key outputs and phase objective

- **Acceptance clause:** A01;A02: API returns exactly six phases in order with names and purposes matching B0021; each phase page shows its objective text
- **Asserted by:** workflows/phases.test.ts 'the phase catalogue (REQ-PB-014)' asserts that GET /phases returns exactly six phases in order with names, purposes and key outputs equal to B0021 and objectives equal to the phase blocks, and the workspace shows the current phase's objective; phases.test.tsx and p4-change-phases.spec.ts render it in en and ar.
- **Test files cited:** `apps/web/src/pages/phases/phases.test.tsx`, `apps/api/test/integration/workflows/phases.test.ts`, `apps/web/e2e/p4-change-phases.spec.ts`

### REQ-PB-015 (SOURCE): Model the six stage gates G1-G6 as explicit approval records with decision question and evidence required

- **Acceptance clause:** A08: submission with missing mandatory evidence is rejected; approval by a non-approver returns 403; approval of a stale submission version is rejected
- **Asserted by:** A08 is asserted by a08-gate-controls.test.ts: a submission with missing mandatory evidence is 422 with no submission written, a non-approver (BO, WL, TL, AUD) gets 403, and a stale submission number or stale If-Match is 409; g5-g6.test.ts proves the same for G5/G6, and e2e/a08-a09-gates-decisions.spec.ts shows the missing items on the gate page in en and ar.
- **Test files cited:** `apps/api/test/integration/workflows/g5-g6.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `e2e/a08-a09-gates-decisions.spec.ts`

### REQ-PB-020 (SOURCE): G5 Scale: require performance evidence, adoption, risk closure and decision log as gate evidence

- **Acceptance clause:** A08;A11: G5 submission with an open High-impact risk and no disposition is rejected listing 'Risk closure'; with the G5 approver configured to BO per T11 'Go-live / scale', an SP approval returns 403 and a BO approval succeeds
- **Asserted by:** A08/A11 are asserted by a08-gate-controls.test.ts: G5 with an open High-impact risk and no disposition is refused listing 'Risk closure', and with the G5 approver configured to BO an SP approval is 403 while a BO approval succeeds and records the scale scope; g5-g6.test.ts and risk-dispositions.test.ts at API level; a11-bau-sustain.test.ts reaches and decides G5 natively.
- **Test files cited:** `apps/api/test/integration/workflows/g5-g6.test.ts`, `apps/api/test/integration/workflows/risk-dispositions.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`

### REQ-PB-021 (SOURCE): G6 Sustain: require benefits evidence, ownership transfer, controls and continuous improvement backlog as gate evidence

- **Acceptance clause:** A08;A11: G6 submission without an accepted BAU handover is rejected listing 'Ownership transfer'
- **Asserted by:** A08/A11 are asserted by a08-gate-controls.test.ts and a11-bau-sustain.test.ts 'G6 without an accepted BAU handover is refused, listing Ownership transfer' (422 gate_criteria_incomplete); p4-gates-closure.spec.ts shows the item missing on the G6 page.
- **Test files cited:** `apps/api/test/integration/workflows/g5-g6.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`, `apps/web/e2e/p4-gates-closure.spec.ts`

### REQ-PB-044 (SOURCE): Maintain the traceability chain from diagnosed issue to benefit with a view and orphan report

- **Acceptance clause:** A01: an initiative without a TOM gap appears in the orphan report; clicking a node opens the linked record
- **Asserted by:** orphans.test.ts asserts that an initiative without a TOM gap link is listed with the expected 'tom_gap → initiative' step; traceability.test.ts 'every node opens its record' asserts that every node's href answers 200 with that record; p4-traceability.spec.ts clicks an orphan's node through to its record in en and ar.
- **Test files cited:** `apps/web/src/pages/traceability/traceability.test.tsx`, `apps/api/test/integration/reporting/orphans.test.ts`, `apps/api/test/integration/reporting/traceability.test.ts`, `apps/web/e2e/p4-traceability.spec.ts`

### REQ-PB-058 (SOURCE): Prevent double counting: each benefit has a unique owner, baseline, formula and financial-statement or non-financial KPI link

- **Acceptance clause:** A10: a benefit with two owners is rejected; a 10 million SAR benefit shared by two initiatives appears once (10 million SAR) in the portfolio total
- **Asserted by:** A10 is asserted by a10-benefit-integrity.test.ts: a benefit with two owners is 400 with no row written; a 10 million SAR benefit allocated 50/50 to two initiatives appears once (planned 10000000, count 1) in the totals and on the Finance dashboard; two records in a shared-benefit group count once. Backed by register.test.ts, totals.test.ts and groups.test.ts.
- **Test files cited:** `apps/api/test/integration/benefits/register.test.ts`, `apps/api/test/integration/benefits/totals.test.ts`, `apps/api/test/integration/benefits/groups.test.ts`, `tests/qa/integration/a10-benefit-integrity.test.ts`

### REQ-PB-060 (SOURCE): Seed the five transformation operating system layers with cadence, purpose, participants and outputs

- **Acceptance clause:** A01: the five layers are seeded with cadence text verbatim; a forum meeting series generates meetings on the configured recurrence
- **Asserted by:** forums.test.ts asserts that a new transformation lists the five B0093 layers in order with the cadence and every source text verbatim; meeting-series.test.ts asserts that a weekly series creates one meeting per week to the horizon and that a re-run creates none; the worker meeting-series.test.ts runs the scheduled generation.
- **Test files cited:** `apps/api/test/integration/governance/forums.test.ts`, `apps/api/test/integration/governance/meeting-series.test.ts`, `apps/worker/test/integration/meeting-series.test.ts`

### REQ-PB-061 (SOURCE): Produce each forum's source outputs as native meeting records

- **Acceptance clause:** A01: a Value Review meeting cannot be published without a benefit evidence or forecast entry; decisions recorded appear in T16
- **Asserted by:** minutes.test.ts asserts that Value Review minutes without a benefit evidence or forecast output are 422 meeting_minutes.required_output_missing with nothing written, and publish with a forecast output; agenda.test.ts asserts that a complete brief publishes into a T16 ask and that the Outcome recorded in the meeting appears in T16.
- **Test files cited:** `apps/api/test/integration/governance/minutes.test.ts`, `apps/api/test/integration/governance/agenda.test.ts`, `apps/api/test/integration/governance/meeting-outputs.test.ts`

### REQ-PB-062 (SOURCE): Implement Template 10 Executive Transformation Dashboard with its six source areas

- **Acceptance clause:** A01;A04: all six areas render in en and ar from persisted data; each headline drills to contributing records
- **Asserted by:** dashboards.test.ts 'REQ-PB-062' asserts that all six areas render in Template 10 order from persisted data with the seeded en and ar labels, and that each headline's drilldownHref answers 200 with its contributing records; p4-dashboards.spec.ts renders the six areas in chromium-en and chromium-ar.
- **Test files cited:** `apps/web/src/pages/dashboards/dashboards.test.tsx`, `apps/api/test/integration/reporting/dashboards.test.ts`, `apps/web/e2e/p4-dashboards.spec.ts`

### REQ-PB-063 (SOURCE): Apply the area-specific T10 RAG logic

- **Acceptance clause:** A04;A05: an outcome whose tasks are 100% complete but KPI is below trajectory is Red/Amber, not Green; a KPI with no actual shows Unknown
- **Asserted by:** dashboards.test.ts 'REQ-PB-063' asserts that an outcome whose linked initiative has every milestone achieved and its deliverable accepted, but whose KPI is below trajectory, is red/amber (rule dashboard.rag.outcomes.trajectory), and that a KPI with no actual is unknown with a null value (never 0); the area rules are unit-tested in areas.test.ts.
- **Test files cited:** `apps/api/src/modules/reporting/dashboards/areas.test.ts`, `apps/api/test/integration/reporting/dashboards.test.ts`, `apps/api/test/integration/reporting/rag-policy.test.ts`

### REQ-PB-064 (SOURCE): Show a Decisions area Red when an executive decision is overdue

- **Acceptance clause:** A09: with one open T16 decision due yesterday (Asia/Riyadh), Decisions area is Red and lists it; after the decision is recorded it no longer counts
- **Asserted by:** A09 is asserted by a09-decision-escalation.test.ts 'REQ-PB-064, REQ-PB-081': an open T16 decision due yesterday (Asia/Riyadh) makes the Decisions area Red and is listed, and once its Outcome is recorded it no longer counts (dashboard and overview); also dashboards.test.ts 'REQ-PB-064'.
- **Test files cited:** `apps/api/src/modules/reporting/dashboards/areas.test.ts`, `apps/api/test/integration/reporting/dashboards.test.ts`, `tests/qa/integration/a09-decision-escalation.test.ts`

### REQ-PB-065 (SOURCE): Implement Template 11 Decision Rights Matrix with the four seeded source rows

- **Acceptance clause:** A01: four rows seeded verbatim; a change request of type Business scope change routes approval to the Sponsor
- **Asserted by:** decision-rights.test.ts asserts that the four T11 rows are seeded verbatim from B0099 (template and per transformation) and that business_scope_change routes to the SP-mapped person; change-requests.test.ts 'REQ-PB-065 routing' asserts that a business_scope change request is routed to the Sponsor, who alone applies it. Partial (D-114): routing is proven by these API integration tests and stubbed web tests only, not on the real-stack e2e.
- **Test files cited:** `apps/api/test/integration/governance/decision-rights.test.ts`, `apps/api/test/integration/workflows/change-requests.test.ts`

### REQ-PB-066 (SOURCE): Compute T11 SLAs by type: working days, next forum or release plan

- **Acceptance clause:** A09: a Business scope change raised Thursday gets a due date 5 working days later skipping the configured weekend days and holidays
- **Asserted by:** A09 is asserted by a09-decision-escalation.test.ts (5 working days from a Thursday skip the configured weekend; a holiday is skipped) and decision-rights.test.ts 'REQ-PB-066'. Partial (D-114, QA-B): the server clock cannot be set, so the 'raised Thursday' case runs through the calendar API on the same engine and in working-days.test.ts, while a real Business scope change approval checks the weekend and holiday skip from today's date.
- **Test files cited:** `packages/shared/src/time/working-days.test.ts`, `apps/api/test/integration/governance/decision-rights.test.ts`, `tests/qa/integration/a09-decision-escalation.test.ts`

### REQ-PB-067 (SOURCE): Implement Template 12 RACI with the six seeded deliverables and R/A/C/I values including A/R

- **Acceptance clause:** A01: seeded RACI matches B0101 exactly; a cell value 'X' is rejected; 'A/R' is accepted
- **Asserted by:** raci-matrices.test.ts 'REQ-PB-067: T12 seeded from B0101; cell values' asserts that the seeded RACI equals B0101, a cell value 'X' is refused and 'A/R' is accepted.
- **Test files cited:** `apps/api/test/integration/governance/raci-matrices.test.ts`

### REQ-PB-068 (SOURCE): Enforce the governance rule: escalate decisions, not status

- **Acceptance clause:** A09: publishing an agenda item missing 'Impact of delay' is rejected by the API
- **Asserted by:** A09 is asserted by a09-decision-escalation.test.ts 'REQ-PB-068, REQ-S10-012' and agenda.test.ts: publishing an executive-ask agenda item missing 'Impact of delay' is 422 agenda_item.executive_ask_incomplete at /brief/impactOfDelay with nothing written.
- **Test files cited:** `apps/web/src/pages/meetings/governance.test.tsx`, `apps/api/test/integration/governance/agenda.test.ts`, `tests/qa/integration/a09-decision-escalation.test.ts`

### REQ-PB-069 (SOURCE): Manage adoption as an outcome with measurable leading indicators, separate from delivery

- **Acceptance clause:** A11: an initiative with delivery Complete and adoption below trajectory shows adoption at risk and triggers an intervention; an adoption actual below trajectory creates exactly one intervention
- **Asserted by:** A11 is asserted by a11-adoption.test.ts: a below-trajectory adoption actual creates exactly one owned intervention (a redelivery and a second evaluation add none, and an on-trajectory actual creates none); the initiative with delivery Complete shows adoption at_risk; the owner sees the intervention in My Work.
- **Test files cited:** `apps/api/test/integration/adoption/indicators.test.ts`, `apps/api/test/integration/sustainment/status-model.test.ts`, `apps/worker/test/integration/adoption-below-trajectory.test.ts`, `tests/qa/integration/a11-adoption.test.ts`

### REQ-PB-070 (SOURCE): Implement Template 13 Stakeholder & Adoption Plan as a native register

- **Acceptance clause:** A01: T13 persists all 7 columns; stance 'Hostile' is rejected; Intervention accepts the four source values
- **Asserted by:** stakeholder-groups.test.ts 'T13 rows (REQ-PB-070, REQ-S11-001)' asserts that all seven T13 columns persist, stance 'Hostile' is 400 and the four intervention values are accepted (any other is 400); p4-adoption-bau.spec.ts adds a group in the UI and checks the API refusal of a stance outside the list.
- **Test files cited:** `apps/web/src/pages/adoption/adoption.test.tsx`, `apps/api/test/integration/adoption/stakeholder-groups.test.ts`, `apps/web/e2e/p4-adoption-bau.spec.ts`

### REQ-PB-071 (SOURCE): Seed the seven leading adoption indicators

- **Acceptance clause:** A11: all seven indicators are available by name; an actual below trajectory creates a corrective intervention
- **Asserted by:** A11 is asserted by a11-adoption.test.ts: GET /adoption-indicator-templates lists exactly the seven B0109-B0115 indicators by name, in order; a below-trajectory actual creates a corrective intervention and an on-trajectory one creates none.
- **Test files cited:** `apps/api/test/integration/adoption/indicators.test.ts`, `apps/worker/test/integration/adoption-below-trajectory.test.ts`, `tests/qa/integration/a11-adoption.test.ts`

### REQ-PB-072 (SOURCE): Track training completion and observed proficiency separately

- **Acceptance clause:** A11: 100% training completion with no proficiency observations shows proficiency Unknown, not adopted
- **Asserted by:** A11 is asserted by a11-adoption.test.ts and indicators.test.ts: with 100% training completion and no proficiency observation, proficiency is unknown with value null (never 0) and not adopted.
- **Test files cited:** `packages/shared/src/adoption/measures.test.ts`, `apps/api/test/integration/adoption/indicators.test.ts`, `tests/qa/integration/a11-adoption.test.ts`

### REQ-PB-073 (SOURCE): Apply the people-centered principle: record impacted-team involvement in design and champion constraints

- **Acceptance clause:** A01;A11: a champion's constraint links to a T04 decision and is visible on that decision
- **Asserted by:** A01/A11 are asserted by a11-adoption.test.ts and champion-constraints.test.ts: a champion's constraint links to a T04 decision and is listed on that decision (and not on another), and a non-champion gets 403; p4-adoption-bau.spec.ts shows it on the decision page.
- **Test files cited:** `apps/api/test/integration/adoption/champion-constraints.test.ts`, `apps/api/test/integration/adoption/stakeholder-groups.test.ts`, `tests/qa/integration/a11-adoption.test.ts`, `apps/web/e2e/p4-adoption-bau.spec.ts`

### REQ-PB-074 (SOURCE): Implement the six-step benefits lifecycle Identify, Plan, Enable, Measure, Correct, Sustain

- **Acceptance clause:** A04;A10;A11: a benefit cannot enter Measure without the Plan outputs; Sustain requires a BAU owner and control cadence
- **Asserted by:** A04/A10/A11 are asserted by a11-value-closure.test.ts 'REQ-PB-074': without the Plan outputs a benefit cannot move towards Measure (422 benefit.plan_outputs_missing), and Sustain without a BAU owner and control cadence is 422 benefit.sustain_outputs_missing, still 422 with the owner only and 200 with both; also lifecycle.test.ts.
- **Test files cited:** `apps/api/src/modules/benefits/register-rules.test.ts`, `apps/api/test/integration/benefits/lifecycle.test.ts`, `tests/qa/integration/a11-value-closure.test.ts`

### REQ-PB-075 (SOURCE): Implement Template 14 Benefits Register as a native register

- **Acceptance clause:** A10: T14 persists all 10 columns; realized value awaiting Finance validation is labelled pending and excluded from validated totals
- **Asserted by:** A10 is asserted by a04-a05-a10-partials.test.ts (the T14 row carries all ten columns, API and DB) and a10-benefit-integrity.test.ts 'REQ-PB-075, REQ-S08-016' (a submitted 250000.10 is labelled submitted/pending and the validated total stays 0 until Finance approves); also register.test.ts 'listBenefits: the T14 register'.
- **Test files cited:** `apps/web/src/pages/benefits/benefits.test.tsx`, `apps/api/test/integration/benefits/register.test.ts`, `tests/qa/integration/a10-benefit-integrity.test.ts`, `tests/qa/integration/a04-a05-a10-partials.test.ts`

### REQ-PB-076 (SOURCE): Allow non-financial benefits with Value (SAR) n/a and Realized expressed as KPI actual

- **Acceptance clause:** A10: a CX benefit saved with Value n/a is excluded from SAR totals and not counted as zero
- **Asserted by:** A10 is asserted by a10-benefit-integrity.test.ts 'REQ-PB-076': a CX benefit with Value n/a leaves every SAR figure byte-identical, increments nonFinancialCount and adds no SAR line (never counted as zero); also totals.test.ts and register.test.ts.
- **Test files cited:** `apps/api/test/integration/benefits/totals.test.ts`, `apps/api/test/integration/benefits/register.test.ts`, `tests/qa/integration/a10-benefit-integrity.test.ts`

### REQ-PB-078 (SOURCE): Integrate RAID and decisions so dependencies and decisions are single canonical records

- **Acceptance clause:** A01: editing a dependency's owner in T08 changes the same RAID entry; there is no second copy
- **Asserted by:** dependency-entries.test.ts 'A01: editing a dependency's owner in T08 changes the same RAID entry; there is no second copy' asserts one canonical row; register.test.ts asserts that the integrated RAID and decision log reads the canonical rows.
- **Test files cited:** `apps/api/test/integration/raid/dependency-entries.test.ts`, `apps/api/test/integration/raid/register.test.ts`

### REQ-PB-079 (SOURCE): Implement Template 15 RAID as a native register

- **Acceptance clause:** A01: T15 persists all 9 columns; Type outside Risk/Assumption/Issue/Dependency is rejected
- **Asserted by:** register.test.ts 'T15 RAID register: the nine columns and the Type rule' asserts that all nine T15 columns persist and that a Type outside Risk/Assumption/Issue/Dependency is 400 raid.type_invalid at /type; unit raid.test.ts.
- **Test files cited:** `apps/api/src/modules/raid/raid.test.ts`, `apps/web/src/pages/raid/raid.test.tsx`, `apps/api/test/integration/raid/register.test.ts`

### REQ-PB-080 (SOURCE): Set T15 Probability to n/a for Assumption, Issue and Dependency entries

- **Acceptance clause:** A01: an Issue with Probability H is rejected; a Risk without Probability is rejected
- **Asserted by:** register.test.ts 'T15 Probability (REQ-PB-080)' asserts that an Issue with Probability H is 422 and a Risk without Probability is 422; dependency-entries.test.ts asserts that a Dependency entry has no Probability.
- **Test files cited:** `apps/api/src/modules/raid/raid.test.ts`, `apps/api/test/integration/raid/register.test.ts`, `apps/api/test/integration/raid/dependency-entries.test.ts`

### REQ-PB-081 (SOURCE): Implement Template 16 Executive Decision Log as a native register

- **Acceptance clause:** A09: T16 persists all 9 columns; a decision with Outcome recorded is closed and leaves the overdue list
- **Asserted by:** A09 is asserted by a09-decision-escalation.test.ts: T16 persists all nine columns, and a decision whose Outcome is recorded is closed and leaves the overdue list; executive-decisions.test.ts at API level; e2e/a08-a09-gates-decisions.spec.ts renders the nine columns in en and ar.
- **Test files cited:** `apps/api/test/integration/governance/executive-decisions.test.ts`, `tests/qa/integration/a09-decision-escalation.test.ts`, `e2e/a08-a09-gates-decisions.spec.ts`

### REQ-PB-082 (SOURCE): Apply the escalation principle: a blocker red for multiple cycles requires a named decision, owner and deadline

- **Acceptance clause:** A09;A13: a blocker Red in 2 consecutive cycles (N=2) produces exactly one open T16 ask; re-running the job creates no duplicate
- **Asserted by:** A09/A13 are asserted by a09-decision-escalation.test.ts 'N = 2' and the worker blocker-escalation.test.ts: a blocker red in two consecutive cycles produces exactly one open T16 ask with a decision, owner and deadline, and re-running the consumer or the scan creates no duplicate.
- **Test files cited:** `apps/worker/test/integration/blocker-escalation.test.ts`, `apps/api/test/integration/governance/blocker-status.test.ts`, `tests/qa/integration/a09-decision-escalation.test.ts`

### REQ-PB-083 (SOURCE): Hand over to BAU with ownership transfer, controls and control cadence

- **Acceptance clause:** A11;A13: accepting a handover creates recurring BAU review tasks for the BAU owner exactly once
- **Asserted by:** A11/A13 are asserted by a11-bau-sustain.test.ts: the receiving owner's acceptance creates exactly one review and one My Work task for the BAU owner, a repeated accept is 422, the scans add nothing, and the scan at the review's window schedules the following review once; also handovers.test.ts and sustainment-scans.test.ts.
- **Test files cited:** `apps/api/test/integration/sustainment/handovers.test.ts`, `apps/worker/test/integration/sustainment-scans.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`, `apps/web/e2e/p4-adoption-bau.spec.ts`

### REQ-PB-084 (SOURCE): Maintain a continuous-improvement backlog

- **Acceptance clause:** A11: CI backlog items remain visible after transformation closure; G6 lists the backlog
- **Asserted by:** A11 is asserted by a11-bau-sustain.test.ts: G6 lists the continuous-improvement backlog and the G6 snapshot carries the item, and after closure the CI item is still listed and readable; also improvement.test.ts.
- **Test files cited:** `apps/web/src/pages/bau/sustain.test.tsx`, `apps/api/test/integration/sustainment/improvement.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`

### REQ-PB-085 (SOURCE): Create a recovery plan / corrective action when a benefit or KPI is off track

- **Acceptance clause:** A04;A11;A13: a benefit below plan creates one corrective action; repeated evaluation does not duplicate it; a KPI deviation persisting two cycles under a two-cycle rule creates one case and the third cycle updates it
- **Asserted by:** A04/A11/A13 are asserted by a11-value-closure.test.ts: two below-plan validated values and a redelivery leave exactly one open case for the benefit, and under a two-cycle rule real red actuals give no case in cycle 1, one case in cycle 2 and the same case updated in cycle 3; also the worker raid-corrective.test.ts.
- **Test files cited:** `apps/worker/test/integration/raid-corrective.test.ts`, `apps/api/test/integration/raid/corrective-cases.test.ts`, `tests/qa/integration/a11-value-closure.test.ts`

### REQ-DLV-036 (ENGINEERING): Deliver the P4 outputs and evidence: full KPI/benefit engines, T10-T16, forums/decisions/RACI/RAID, adoption, corrective actions, core scheduled jobs, BAU handover, continuous improvement and G5-G6

- **Acceptance clause:** A04;A09;A10;A11;A23: the A04, A09, A10 and A11 executable tests pass on the DG4 candidate
- **Asserted by:** the A04, A09, A10 and A11 executable suites exist, passed 81/81 together in QA-C's REQ-DLV-036 run (dlv-036-a04-a09-a10-a11.log, exit 0), and passed in the merged-tree integration run at dca6b64 (1919/1919, code identical to this base). The run on the frozen DG4 candidate itself is a review-time check that has not happened yet.
- **Test files cited:** `tests/qa/integration/a04-kpi-propagation.test.ts`, `tests/qa/integration/a09-decision-escalation.test.ts`, `tests/qa/integration/a10-benefit-integrity.test.ts`, `tests/qa/integration/a11-adoption.test.ts`, `tests/qa/integration/a11-value-closure.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`

### REQ-S03-001 (USER): Support multiple transformations, business units, portfolios, workstreams, initiatives and ongoing business performance areas

- **Acceptance clause:** A02;A12: two transformations in different business units are listed separately; a user scoped to one business unit cannot list the other's transformations
- **Asserted by:** A02/A12 are asserted by bu-scope.test.ts 'REQ-S03-001': two transformations in different business units are listed separately, each in its own business unit, and a user scoped to one business unit cannot list or read the other's transformation, portfolio rows or workstreams (404); structure.test.ts covers portfolios and workstreams.
- **Test files cited:** `apps/api/test/integration/reporting/bu-scope.test.ts`, `apps/api/test/integration/portfolio/structure.test.ts`, `apps/web/e2e/p4-traceability.spec.ts`

### REQ-S03-002 (USER): Let performance areas and BAU ownership continue indefinitely while transformations remain time-bounded

- **Acceptance clause:** A11: after a transformation is closed its linked performance area still generates scheduled review tasks and accepts KPI actuals
- **Asserted by:** A11 is asserted by a11-bau-sustain.test.ts: after the transformation is closed, its performance area's next review task is created on time for the BAU owner and the area's KPI still accepts an actual; also performance-areas.test.ts 'areas outlive their transformation' and sustainment-scans.test.ts.
- **Test files cited:** `apps/api/test/integration/sustainment/performance-areas.test.ts`, `apps/worker/test/integration/sustainment-scans.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`

### REQ-S03-003 (USER): Keep initiative delivery, business adoption, validated value and transformation closure as separate statuses

- **Acceptance clause:** A11: setting delivery to Complete leaves adoption, validated value and closure unchanged; the API rejects a closure request while validated value is pending unless a transition decision exists
- **Asserted by:** A11 is asserted by a11-value-closure.test.ts: setting delivery to Complete leaves adoption, value and closure exactly as they were; closing while validated value is pending is 422 invalid-transition; with an approved transition decision the closure is accepted.
- **Test files cited:** `apps/api/test/integration/sustainment/status-model.test.ts`, `apps/api/test/integration/sustainment/closure.test.ts`, `tests/qa/integration/a11-value-closure.test.ts`, `apps/web/e2e/p4-gates-closure.spec.ts`

### REQ-S03-004 (USER): Guide End-to-End progression through the six phases, allowing drafts at any time but enforcing required gate approvals before authorized execution or scaling

- **Acceptance clause:** A02;A08: a Design-phase draft can be saved before G2; a scale transition before G5 approval returns 422 invalid-transition naming G5; after approval it succeeds
- **Asserted by:** A08 is asserted by a08-gate-controls.test.ts: a scale transition before G5 approval is 422 invalid-transition gate.g5_not_approved naming G5, and after approval scaling inside the scope succeeds; also scale.test.ts. The A02 'Design-phase draft can be saved before G2' clause is not asserted by a DG4 test: it is proven implicitly by the DG2 registers.test.ts, which creates T03 gaps and T04 design decisions (201) in a world whose G2 is never approved.
- **Test files cited:** `apps/api/test/integration/workflows/scale.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `apps/api/test/integration/registers.test.ts`, `apps/web/e2e/p4-change-phases.spec.ts`

### REQ-S03-005 (USER): In Modular entry, record inherited evidence, baseline and prior approvals as labelled inherited records and never fabricate approvals

- **Acceptance clause:** A03: entering at Design with an inherited G2 approval document shows G2 as 'inherited' (not Approved); a missing baseline and outcome link are flagged and G3 submission is rejected until supplied or waived
- **Asserted by:** A03 is asserted by a03-modular-entry.test.ts: entering at Design, G2 is labelled 'inherited' (never Approved) with no gate decision, the prior approval is listed as a labelled inherited record, and a fabricated prior_approval is 422; the missing baseline and outcome link are flagged and G3 is refused until supplied or waived. e2e/a03-modular-entry.spec.ts shows this in en and ar.
- **Test files cited:** `apps/api/test/integration/reporting/modular.test.ts`, `apps/api/test/integration/workflows/modular-precondition.test.ts`, `tests/qa/integration/a03-modular-entry.test.ts`, `e2e/a03-modular-entry.spec.ts`

### REQ-S03-006 (USER): Support many-to-many traceability links with explicit contribution and allocation rules, clickable nodes and downstream impact

- **Acceptance clause:** A01;A10: one initiative links to two gaps and two KPIs; an allocation link set totalling 110% is rejected; changing a KPI target lists the linked benefits and dashboards as affected
- **Asserted by:** traceability.test.ts asserts that one initiative links to two gaps and two KPIs (four edges); a10-benefit-integrity.test.ts and allocation.test.ts assert that an allocation link set of 110% is 422 trace_link.allocation_exceeds_total and 100% is accepted; impact.test.ts asserts that a KPI target change lists the linked benefits and the Outcomes/Value dashboards as affected.
- **Test files cited:** `apps/api/test/integration/reporting/traceability.test.ts`, `apps/api/test/integration/reporting/allocation.test.ts`, `apps/api/test/integration/reporting/impact.test.ts`, `tests/qa/integration/a10-benefit-integrity.test.ts`

### REQ-S03-008 (USER): Provide My Work with assigned actions, drafts, reviews, approvals, missing updates and upcoming deadlines

- **Acceptance clause:** A02;A12: a KPI owner with a due actual sees it under Missing updates with a link that opens the KPI period entry; another user's items never appear
- **Asserted by:** my-work.test.ts 'REQ-S03-008' asserts that a KPI owner with a due actual sees the kpi_update_due item under Missing updates with the period-entry link, and that another user's items never appear; p4-dashboards.spec.ts renders the sections in en and ar.
- **Test files cited:** `apps/api/test/integration/reporting/my-work.test.ts`, `apps/web/e2e/p4-dashboards.spec.ts`

### REQ-S03-009 (USER): Provide Executive Overview with outcomes, value, critical initiatives, adoption, blockers and decisions

- **Acceptance clause:** A04: after an accepted KPI actual the overview's outcome tile shows the new actual once and its drill-down lists the source record
- **Asserted by:** A04 is asserted by a04-kpi-propagation.test.ts (real worker): after an accepted KPI actual, the overview's Outcomes area shows the new actual on exactly one item and the outcomes.kpi_status drill-down lists that kpi_actual; also dashboards.test.ts 'REQ-S03-009'.
- **Test files cited:** `apps/api/test/integration/reporting/dashboards.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts`, `apps/web/e2e/p4-dashboards.spec.ts`

### REQ-S03-011 (USER): Show a transformation workspace header with phase, gate readiness, North Star, owners, outcome health, benefits, key decisions and next required actions, with contextual navigation that never requires re-entering the transformation ID

- **Acceptance clause:** A02: from the workspace header one click opens the transformation's RAID filtered to it; the header shows the eight elements with Unknown where data is missing
- **Asserted by:** workspace-header.test.ts asserts that the eight elements are present, each Unknown where data is missing; p4-dashboards.spec.ts test 1 clicks the header's RAID link once and lands on /transformations/{id}/raid filtered to that transformation, in chromium-en and chromium-ar.
- **Test files cited:** `apps/web/src/pages/dashboards/dashboards.test.tsx`, `apps/api/test/integration/reporting/workspace-header.test.ts`, `apps/web/e2e/p4-dashboards.spec.ts`

### REQ-S04-001 (USER): Give every phase guided inputs, procedural steps, required evidence, named owners, completion rules, outputs and a review queue

- **Acceptance clause:** A02: each of the six phases shows steps, required evidence, owners and a review queue; a step with an unmet completion rule cannot be marked complete via the API
- **Asserted by:** phases.test.ts 'guided phase steps (REQ-S04-001)' asserts that each of the six phases shows steps with required evidence (en and ar), owners (Unknown when unassigned) and a review queue, and that a step with an unmet completion rule cannot be put in review or accepted (422 phase_step.completion_rule_unmet, also not through SQL).
- **Test files cited:** `apps/web/src/pages/phases/phases.test.tsx`, `apps/api/test/integration/workflows/phases.test.ts`, `apps/web/e2e/p4-change-phases.spec.ts`

### REQ-S04-002 (USER): Make gates explicit approval records tied to a versioned, immutable evidence snapshot, never inferred from task completion

- **Acceptance clause:** A07;A08: completing every phase task leaves the gate Draft; editing a record after submission does not change the snapshot content shown to approvers
- **Asserted by:** A07/A08 are asserted by a08-gate-controls.test.ts 'snapshot and task independence': completing every Diagnose phase task leaves G1 Draft with no submission, and editing a record after submission does not change the snapshot shown to approvers; also phases.test.ts and g5-g6.test.ts.
- **Test files cited:** `apps/api/test/integration/workflows/phases.test.ts`, `apps/api/test/integration/workflows/g5-g6.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`

### REQ-S04-007 (USER): Run the Transform phase procedure and G5 Scale decision recording the approved scale scope

- **Acceptance clause:** A02;A08: G5 submission with an open material risk lacking resolution or approved disposition is rejected; an approval records the scale scope and later scaling outside it is blocked
- **Asserted by:** A02/A08 are asserted by a08-gate-controls.test.ts: G5 with an open High-impact risk without resolution or approved disposition is refused listing 'Risk closure' (an approved disposition resolves it); a BO approval records the scale scope; scaling outside the scope is 422 scale.outside_approved_scope and inside it is 201.
- **Test files cited:** `apps/api/test/integration/workflows/scale.test.ts`, `apps/api/test/integration/workflows/risk-dispositions.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `apps/web/e2e/p4-gates-closure.spec.ts`

### REQ-S04-008 (USER): Run the Realize phase procedure and G6 Sustain decision

- **Acceptance clause:** A02;A11: G6 submission without an accepted BAU handover is rejected; product G6 approval changes no engineering DG record
- **Asserted by:** A02/A11 are asserted by a08-gate-controls.test.ts: G6 without an accepted BAU handover is refused listing 'Ownership transfer', and a product G6 approval (API and its worker consumer) changes nothing under docs/delivery/ (fingerprinted); a11-bau-sustain.test.ts approves G6 natively with no DG record named.
- **Test files cited:** `apps/api/test/integration/workflows/g5-g6.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `tests/qa/integration/a11-bau-sustain.test.ts`

### REQ-S04-009 (USER): Show on every gate submission, per criterion: criterion, required evidence, completeness, reviewer, finding, open condition, risk, decision and rationale

- **Acceptance clause:** A08: a gate decision without rationale is rejected by the API; each criterion row persists all nine fields
- **Asserted by:** A08 is asserted by a08-gate-controls.test.ts: a criterion review persists all nine fields (API and DB), and a gate decision without rationale is refused (400 at /rationale) with nothing written; also gate-reviews.test.ts.
- **Test files cited:** `apps/web/src/pages/gates/g5-g6.test.tsx`, `apps/api/test/integration/workflows/gate-reviews.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`

### REQ-S04-010 (USER): Support gate statuses Draft, Submitted, Under Review, Changes Requested, Approved, Rejected and Deferred with enforced transitions

- **Acceptance clause:** A08: all seven statuses exist; a direct Draft -> Approved transition is rejected; each transition writes an audit event
- **Asserted by:** A08 is asserted by a08-gate-controls.test.ts: the seven statuses exist, a direct Draft -> Approved is refused, and every transition (Draft -> Submitted -> Under Review -> Changes Requested -> ... -> Approved) writes an audit event. QA-B notes that the refusal is 409 gate.submission_superseded rather than 422; the test pins a refusal with the matching problem type.
- **Test files cited:** `apps/api/test/integration/workflows/gate-reviews.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`

### REQ-S04-012 (USER): Block gate submission when mandatory evidence is missing unless a specifically authorized exception is recorded

- **Acceptance clause:** A08: the gate page lists missing items; submission with one missing mandatory item returns 422 listing it; with a valid exception it succeeds and the snapshot records the exception
- **Asserted by:** A08 is asserted by a08-gate-controls.test.ts: the gate lists the missing items (canSubmit false); with one missing mandatory item the 422 lists exactly that item; with a valid exception the submission succeeds and its snapshot records the exception. e2e/a08-a09-gates-decisions.spec.ts shows the page in en and ar.
- **Test files cited:** `apps/api/test/integration/workflows/gate-exceptions.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`, `e2e/a08-a09-gates-decisions.spec.ts`

### REQ-S04-013 (USER): Require waivers to record reason, scope, approver, expiry and compensating action

- **Acceptance clause:** A08: a waiver without expiry or compensating action is rejected; after expiry the covered evidence item is again reported missing
- **Asserted by:** A08 is asserted by a08-gate-controls.test.ts: a waiver without an expiry or a compensating action is refused with nothing written, and after expiry the covered item is reported missing again and blocks submission. The expiry uses the product's setGateExceptionClock seam, because the server clock cannot be set through the API.
- **Test files cited:** `apps/api/test/integration/workflows/gate-exceptions.test.ts`, `apps/worker/test/integration/gates.test.ts`, `tests/qa/integration/a08-gate-controls.test.ts`

### REQ-S04-014 (USER): Trigger impact assessment and reapproval for material changes to approved scope, baseline, target, TOM, cost or benefit logic while preserving the original approval and snapshot

- **Acceptance clause:** A07: changing an approved G4 benefit formula creates a change request; the prior G4 approval and snapshot are still retrievable unchanged
- **Asserted by:** change-requests.test.ts 'REQ-S04-014' asserts that a new version of an approved G4 benefit formula creates exactly one benefit_logic change request routed to Finance, and that the G4 decision and snapshot rows stay byte-identical before and after. Partial (D-114): proven by API integration tests and stubbed web tests (change-requests.test.tsx) only, not on the real-stack e2e.
- **Test files cited:** `apps/web/src/pages/change-requests/change-requests.test.tsx`, `apps/api/test/integration/workflows/change-requests.test.ts`, `apps/api/test/integration/workflows/impact.test.ts`

### REQ-S07-001 (USER): Provide a KPI dictionary with name, description, business purpose, owner, steward, unit, frequency, polarity, numerator/denominator, calculation, baseline and baseline date, target and target date, phased trajectory, source, aggregation rule, data-quality rule, reporting period, approval policy and leading/lagging classification

- **Acceptance clause:** A05: a KPI definition persists all listed fields; one without polarity, unit or aggregation rule is rejected
- **Asserted by:** versions.test.ts 'REQ-S07-001' asserts that a complete active version reads back every listed dictionary field; a create without polarity or unit is 400; a version without an aggregation rule stays draft and its activation is 422 kpi_version.aggregation_rule_required.
- **Test files cited:** `apps/api/test/integration/kpi-p4/versions.test.ts`

### REQ-S07-002 (ENGINEERING): Support higher-is-better, lower-is-better, acceptable-band and binary milestone measures

- **Acceptance clause:** A05: unit tests: higher-better 80 vs expected 90 is adverse; lower-better 80 vs 90 is favourable; band 5-10 with 12 is outside; binary milestone not achieved by due date is adverse
- **Asserted by:** A05 unit tests (a05-calc-units.test.ts and packages/shared/src/kpi/a05.test.ts) assert higher-better 80 vs 90 adverse, lower-better 80 vs 90 favourable, band 5-10 with 12 outside, and a binary milestone not achieved by its due date adverse; the API suite a05-calculation-correctness.test.ts repeats them (adverse asserted as amber or red).
- **Test files cited:** `packages/shared/src/kpi/measures.test.ts`, `packages/shared/src/kpi/a05.test.ts`, `tests/qa/unit/a05-calc-units.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`

### REQ-S07-003 (USER): Store actuals by KPI, scope and reporting period

- **Acceptance clause:** A05;A17: a second actual for the same KPI, scope and period is stored as a new version, not a duplicate row
- **Asserted by:** actuals.test.ts 'REQ-S07-003' asserts that a second actual for the same KPI, scope and period is value version 2 of the same row, never a duplicate row.
- **Test files cited:** `apps/api/test/integration/kpi-p4/actuals.test.ts`

### REQ-S07-004 (ENGINEERING): Distinguish period from cumulative values and percentage changes from percentage-point changes

- **Acceptance clause:** A05: a rise from 0.10 to 0.12 is shown as +2.0 pp and +20%; cumulative YTD equals the sum of period flows for a flow KPI
- **Asserted by:** A05 is asserted by a05-calc-units.test.ts (+2.0 pp and +20%; YTD 10.1+20.2+30.3 = 60.6) and a05-calculation-correctness.test.ts (0.10 -> 0.12 labelled pp with variance 0.02 and ratio 0.2; the cumulative evaluation equals the sum of the period flows).
- **Test files cited:** `packages/shared/src/kpi/change.test.ts`, `tests/qa/unit/a05-calc-units.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`

### REQ-S07-005 (ENGINEERING): Handle missing values, zero denominators, negative baselines and incomparable periods explicitly

- **Acceptance clause:** A05: a zero denominator returns 'Not computable' (no division error, not 0); a percentage change from a negative baseline is flagged; comparing a 4-week to a 5-week period is flagged 'Not comparable'
- **Asserted by:** A05 is asserted by a05-calculation-correctness.test.ts (a zero denominator gives a null result with formula.division_by_zero, never 0) and a05-calc-units.test.ts (Not computable, negative baseline flagged, 4 vs 5 weeks not comparable); status.test.ts 'comparability' covers Not comparable through the API. The negative-baseline flag is asserted at unit level only.
- **Test files cited:** `tests/qa/unit/a05-calc-units.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`, `apps/api/test/integration/kpi-p4/status.test.ts`, `apps/api/test/integration/kpi-p4/periods.test.ts`

### REQ-S07-006 (ENGINEERING): Show Unknown or Stale for missing or stale data, never green or zero

- **Acceptance clause:** A05: a KPI with no actual for the current period renders Unknown (grey, labelled) and contributes no zero to aggregates
- **Asserted by:** A05 is asserted by a05-calculation-correctness.test.ts: a KPI with no actual for the period renders Unknown (labelled), never 0 or green, and a roll-up with a scope that reported before but is missing now is Unknown, not a sum with 0; kpi.test.tsx asserts grey, labelled Unknown in the UI.
- **Test files cited:** `apps/web/src/pages/kpi/kpi.test.tsx`, `apps/api/test/integration/kpi-p4/status.test.ts`, `apps/api/test/integration/kpi-p4/pipeline.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts`

### REQ-S07-007 (USER): Compute RAG from the approved expected trajectory with configurable thresholds and never from project task completion

- **Acceptance clause:** A04;A05: with all tasks complete and actual below the red threshold the KPI is Red; changing the threshold version recomputes RAG
- **Asserted by:** A04/A05 are asserted by a04-a05-a10-partials.test.ts (with every Diagnose phase task and every action complete, an actual below the red threshold is Red) and a05-calculation-correctness.test.ts (a new threshold version produces exactly one threshold_changed run and recomputes RAG). As designed (ADR-0027 §8, ADR-0028 §5), a threshold change recomputes the current period only (QA-A observation 3).
- **Test files cited:** `apps/api/test/integration/kpi-p4/thresholds.test.ts`, `apps/api/test/integration/kpi-p4/pipeline.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`, `tests/qa/integration/a04-a05-a10-partials.test.ts`

### REQ-S07-008 (USER): Always show actual, expected-to-date, final target, variance, trend, data freshness and the rule explanation alongside RAG

- **Acceptance clause:** A04;A20: the KPI panel shows all seven elements in en and ar; the explanation names the threshold used
- **Asserted by:** status.test.ts 'the KPI panel (REQ-S07-008)' asserts the seven elements and an explanation naming the threshold version; kpi.test.tsx and p4-kpi.spec.ts (chromium-en and chromium-ar) render the seven elements with the explanation.
- **Test files cited:** `apps/web/src/pages/kpi/kpi.test.tsx`, `apps/api/test/integration/kpi-p4/status.test.ts`, `apps/web/e2e/p4-kpi.spec.ts`

### REQ-S07-009 (USER): Allow manual RAG override only by an authorized user with reason, evidence, expiry and audit, preserving the calculated status

- **Acceptance clause:** A05;A12: an override without evidence or expiry is rejected; an unauthorized user gets 403; after expiry the calculated RAG displays
- **Asserted by:** overrides.test.ts asserts that an override without reason, evidence or expiry is 422 with nothing written, an unauthorized user (KDS, AUD, ADM-only) gets 403, the calculated RAG is preserved, and after expiry the override is no longer in force; status.test.ts asserts that the calculated RAG displays again.
- **Test files cited:** `apps/api/test/integration/kpi-p4/overrides.test.ts`, `apps/api/test/integration/kpi-p4/status.test.ts`

### REQ-S07-010 (ENGINEERING): Define aggregations explicitly: sum eligible flows, last value for stocks, weighted ratios where appropriate or an approved custom formula; never average percentages or mix units by default; preserve currency and period

- **Acceptance clause:** A05: two BU ratios 1/10 and 9/10 roll up to 0.50 (weighted), not the mean of percentages; summing SAR with USD without conversion is rejected
- **Asserted by:** A05 is asserted by a05-calculation-correctness.test.ts: 1/10 and 9/10 roll up to 0.5, and a discriminating 1/10 and 80/90 rolls up to 0.81 (weighted, not the 0.494 mean, because the row's own example cannot tell the two apart); an actual in USD on a SAR KPI and SAR + USD in a formula are 422.
- **Test files cited:** `packages/shared/src/kpi/aggregate.test.ts`, `tests/qa/unit/a05-calc-units.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`, `apps/api/test/integration/kpi-p4/pipeline.test.ts`

### REQ-S07-011 (ENGINEERING): Reject circular references and invalid units in formula dependencies

- **Acceptance clause:** A05: KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected
- **Asserted by:** A05 is asserted by a05-calculation-correctness.test.ts and formulas.test.ts: with KPI A = B + 1 active, B = A * 2 is 422 kpi_formula.circular; SAR + count is 422.
- **Test files cited:** `apps/api/test/integration/kpi-p4/formulas.test.ts`, `tests/qa/integration/a05-calculation-correctness.test.ts`

### REQ-S07-012 (USER): Route KPI submissions through configurable draft/review/accept or direct-accept routes

- **Acceptance clause:** A04: with review configured, a submitted actual is not used in calculations until accepted; with direct-accept it is used immediately
- **Asserted by:** A04 is asserted by a04-kpi-propagation.test.ts (real worker): on the review route a submitted actual creates no run and the status stays Unknown until accepted, then exactly one run; on the direct-accept route the actual is used at once (the first two A04 cases).
- **Test files cited:** `apps/api/test/integration/kpi-p4/actuals.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts`

### REQ-S07-013 (USER): On an accepted actual run server-side validation, recalculation of dependent metrics and benefits, dashboard refresh, deviation evaluation and an audit event

- **Acceptance clause:** A04;A13: accepting one actual produces exactly one calculation run and one audit event; linked dashboards show the new value once
- **Asserted by:** A04/A13 are asserted by a04-kpi-propagation.test.ts (real API, worker and PostgreSQL): one accept gives exactly one completed calculation run and one audit event, still 1/1 after the outbox and queues drain, and the linked dashboards show the new value once.
- **Test files cited:** `apps/worker/test/integration/kpi-recalculate.test.ts`, `apps/api/test/integration/kpi-p4/pipeline.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts`

### REQ-S07-014 (USER): Keep new benefit values pending, not validated realized value, when Finance validation is required

- **Acceptance clause:** A04;A10: after an accepted KPI actual, the linked benefit shows a pending amount and the validated total is unchanged
- **Asserted by:** A04/A10 are asserted by a04-kpi-propagation.test.ts 'REQ-S07-014': after an accepted KPI actual, the linked benefit's submitted series is 100000 SAR while validated stays 0 and the transformation's validated total is unchanged; also benefits-queue.test.ts.
- **Test files cited:** `apps/worker/test/integration/benefits-queue.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts`

### REQ-S07-015 (USER): Handle changes to a KPI definition, baseline or target through a versioned change request with reason, impact preview and list of affected outcomes, benefits, gates, reports and formulas

- **Acceptance clause:** A07: changing a target shows the affected benefit and G2 approval in the preview; the old version remains retrievable
- **Asserted by:** change-requests.test.ts 'REQ-S07-015' asserts that a KPI target change's preview lists the bound benefit and the approved G2 decision, a direct activation is 422, and after approval v2 is active while v1 stays readable (superseded). Partial (D-114): proven by API integration tests and stubbed web tests only, not on the real-stack e2e.
- **Test files cited:** `apps/web/src/pages/change-requests/change-requests.test.tsx`, `apps/api/test/integration/workflows/change-requests.test.ts`, `apps/api/test/integration/workflows/impact.test.ts`

### REQ-S07-017 (USER): Make the routine KPI update quick: open KPI, select period, enter or import actual and evidence, submit; then show which downstream views changed and whether review is pending

- **Acceptance clause:** A04;A20: a keyboard-only user completes an update in four steps; the confirmation lists affected dashboards and 'Finance review pending' where applicable
- **Asserted by:** A04/A20 are asserted by e2e/a04-kpi-update.spec.ts (chromium-en and chromium-ar, real stack): a keyboard-only user completes the update in exactly four steps, axe finds 0 serious or critical issues, and the confirmation lists a dashboard item and 'Finance review pending'; the API side is in a04-kpi-propagation.test.ts.
- **Test files cited:** `apps/web/src/pages/kpi/kpi.test.tsx`, `apps/api/test/integration/kpi-p4/actuals.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts`, `e2e/a04-kpi-update.spec.ts`

