# DG5 round 1 (corrected clean re-gate): qa-verifier requirement → evidence matrix (T-DG5-RG2-QA-R1)

Candidate `sha256:ff3bc2c42889d232a84658da7ff850117a8c0c1ba1de6b4c8e32bcc30dae1008` (2203 files), source `2fe8f853e54ef7ab7b88527f11633c0c3542edd6`, freeze `f816fb2`.
Every run below is mine, in this review, on a disposable complete clone of this candidate (`$TMPDIR/rv`, and its copy `$TMPDIR/rv-e2e` for the stacks and probes). Short names:

- **INT1 / INT2**: `04-integration-run1.log`, `04-integration-run2.log` (full integration suite, each 320 files, 3084 passed + 1 skipped by design, EXIT 0).
- **QA**: `04b-integration-tests-qa-only.log` (tests/qa/integration alone, 31 files, 336/336) and `04c-unit-tests-qa-only.log` (tests/qa/unit, 22/22).
- **UNIT**: `02-unit-node{22,24}-{unset,C}.log` (`pnpm test`, Node 22 and 24, both locale settings).
- **E2E-P**: `05-e2e-product-unset.log` (+ `05-e2e-product-unset-rerun-failed-specs.log`) and `05-e2e-product-cutf8.log` (all apps/web/e2e specs, chromium-en and chromium-ar).
- **E2E-R**: `05-e2e-root-{unset,cutf8}.log` (a03, a04, a06, a07, a08-a09, a13, a15, a16, a20, a22 on with-stack.sh): 30/30 each.
- **E2E-D**: `05-e2e-demo-{unset,cutf8}.log` (a02-*, a21 on with-demo-stack.sh): 12/12 unset; 12/12 + my 8 demo probes in C.UTF-8.
- **P-AUD**: `08-probe-aud-p5-{unset,cutf8}.log` (my AUD read-only / axe / 390 px / 200 % probe, 42 P5 screens × 2 projects, 84/84 each).
- **P-PB093**: `07-probe-pb093-{en,ar}-{unset,cutf8}.log` (my Studio UI probe, 1/1 each).
- **P-DEMO**: `10-probe-demo-unset.log` and `05-e2e-demo-cutf8.log` (my demo probes D1-D4, 8/8 each).
- **P-EXEC**: `06-probe-exec-pack.log` (my executive-pack provisional probe, 3/3).
- **INSPECT**: `11-inspect-samples.log` (my inspection of the 62 PDF/DOCX/XLSX/PPTX samples the A15 matrix dumped in QA).

Judgement of each register `notes` disclosure is in the last column. "Implementer test" means a test outside tests/qa that the register cites; I checked that it passed in INT1 and INT2 (or UNIT / E2E-P) and, where named, read its assertion.

| Requirement | Acceptance clause tested | My evidence | Disclosure in `notes`: my judgement |
|---|---|---|---|
| REQ-PB-001 | B0004 verbatim on reader/About/report footer; no official/certified claim in UI strings (en, ar) or report templates | INT1/INT2 reader-search-provenance (15), ui-strings (8), export-templates (23); E2E-P p5-reader-branding-demo 8/8; QA a15-outputs-every-definition (B0004 in every file); INSPECT 62/62 B0004 in the file's language, 0 claims | Arabic rendering awaits linguistic review: acceptable (honest, no claim of verified Arabic). |
| REQ-PB-002 | B0158-B0162 elements = custom_extension; badge en/ar; none labelled PMI standard | INT1/INT2 reader-search-provenance; E2E-P p5-reader-branding-demo, p5-studio-routes | Studio badge reflects the published profiles only (D-164 i): acceptable recorded limitation. |
| REQ-PB-011 | four questions verbatim (en) + ar; exactly one tag per template | INT1/INT2 reader-search-provenance; E2E-P p5-reader-branding-demo, p5-extension-fields | Template→question mapping is the analyst default: acceptable (the source gives no mapping). |
| REQ-PB-077 | Realize note 'aligns with PMI BRM logic'; no certified/official wording | INT1/INT2 reader-search-provenance, ui-strings; E2E-P p5-reader-branding-demo | none. |
| REQ-PB-086 | start 2026-10-01 → Days 31-60 tasks in 2026-11-01..30; all B0134 actions | QA a16-launch-plan 11/11; E2E-R a16-health-launch (UI, en/ar) | none. |
| REQ-PB-087 | six questions verbatim; unanswered → incomplete | QA a16-launch-plan; **P-DEMO D3** (the Day-90 SCREEN: six B0136-B0141 texts verbatim in en, the API's textAr in ar, status open, 0/6 answered) | "screen only in a component test": closed by my D3 on the real demo stack. |
| REQ-PB-088 | North Star text; production init has no demo records | INT1/INT2 demo-roaming (69), demo (9); QA a22-operational-readiness | none. |
| REQ-PB-089 | every demo record and exported demo report shows the illustrative label en/ar | QA a15-demo-transformation-outputs 7/7; E2E-D a02-demo-labels 3/3 per project; P-DEMO D4 | none (the "merged-tree verification still to come" note is superseded by my runs on the frozen candidate). |
| REQ-PB-090 | the traceability VIEW shows chain 1 | INT1/INT2 demo-traceability-chains (API); **P-DEMO D1** (rendered view rooted at Low activation: the five labels in chain order, columns finding → gap → initiative → [deliverable, capability] → outcome KPI → benefit) | "API, not a rendered screen": closed by D1. Observation: the view shows the platform's intermediate deliverable/capability nodes between the initiative and the KPI; the five B0147 labels are shown in order. |
| REQ-PB-091 | 25 questions verbatim; incomplete → no band; < 3 actions rejected | QA a16-health-check 13/13; E2E-R a16-health-launch | none. |
| REQ-PB-092 | 21/16/10/9 → four band texts verbatim | QA a16-health-check; UNIT scoring.test.ts | none. |
| REQ-PB-093 | UI: Feasibility rubric + 30/20/20/15/15 published without code change; new transformation starts with it; existing keeps; 95 % rejected | QA a06 (2), a07 (1); **P-PB093** en/ar × unset/C.UTF-8: in the Studio UI the 95 % draft is refused at publish with 'Default weights must total exactly 100% over 2 to 6 criteria.' and stays a draft; 30/20/20/15/15 + new Feasibility texts published in the UI; a transformation created afterwards shows weight set v1 30/20/20/15/15 'Studio default' on its prioritization screen and the new rubric; the existing one keeps 25/25/20/15/15, its pin and rubric | "exact UI path not driven": closed by P-PB093. |
| REQ-DLV-037 | A06, A07, A15, A16 executable tests pass on this candidate; samples inspected in both languages | QA: a06 27/27, a07 12/12, a15 34/34 (7+5+7+15), a16 30/30 (13+11+6) (`04d-dlv037-counts.txt`); E2E-R a06, a07, a15, a16 in en/ar, both settings; INSPECT 62 files (PDF 12+12, DOCX 8+8, XLSX 6+6, PPTX 5+5) | done this round. A23 (independent reviews) is this review round itself. |
| REQ-S01-002 | name change → shell header en/ar and next report header without code change; fresh install 'Mobily Transformation Hub' | INT1/INT2 branding (24); QA a06 branding; E2E-P p5-reader-branding-demo, p5-navigation | **F-DG5-140 (Low)**: at version 0 the Arabic export header prints the English name, while ADR-0049 §8 defines version 0 as "Mobily Transformation Hub" / "منصة موبايلي للتحوّل" and the Arabic shell shows the Arabic name. The literal acceptance holds. |
| REQ-S01-003 | coverage view links every element; scenario input→…→sustainment on persisted records | INT1/INT2 procedures/coverage (4); QA a02-a21-complete-lifecycle | none. |
| REQ-S01-004 | A02 completes with exports, e-mail, AI disabled; no completion condition references an upload/deck/e-mail | QA a02-a21-complete-lifecycle; E2E-D a21 | "disabled = shipped configuration" (no AI/notification adapter in P5, D-142 Q11, D-165): environmental residual, accepted per the assignment. |
| REQ-S02-001 | counts 2/6/6/16/10/5/6/3/1/25; deleting a template fails the check and blocks publish | QA a06 (2); INT1/INT2 source-coverage (8), studio-review-publish | none. |
| REQ-S02-004 | B0031 → T01 register; T01 → B0031 | INT1/INT2 playbook-blocks (8); E2E-P p5-reader-branding-demo | none. |
| REQ-S03-007 | ADM sees 14 areas en/ar; WL no Administration; landing contents | INT1/INT2 navigation (8); E2E-P p5-navigation 4/4, p5-shell 24/24, journeys | none. |
| REQ-S03-010 | 'value pools' → Diagnose blocks; Launch creates an instance | INT1/INT2 reader-search-provenance; E2E-P p5-reader-branding-demo | none. |
| REQ-S04-011 | conditional G5 for one region blocks another; no scope rejected | INT1/INT2 gate-conditions (5); E2E-P p5-procedures-automation | none (seeded on for G5 in v1, off for a new version, D-142 Q2). |
| REQ-S05-001 | T01/T14: draft reopens, history, comment, attachment, export rows, recoverable 409 | INT1/INT2 form-framework (16), form-records (18); E2E-P p5-forms 6/6 | none. |
| REQ-S05-002 | T03 extension field publishes; deleting 'Gap' rejected | QA a06; INT1/INT2 form-schemas (17); E2E-P p5-forms | none. |
| REQ-S05-006 | twelve record types created and retrieved via API; badge en/ar | INT1/INT2 form-schemas, contract (83, every operation with a success); `14-s05-006-twelve-types.txt` (each of the 12 types has a create and a read operation); UNIT form-builder/extension-hosts-twelve | "no single test creates all twelve": acceptable; the contract test exercises each create and read with a success. |
| REQ-S06-001 | conditional + parallel step publishes and runs; missing trigger/completion rejected | QA a06 procedures (3); INT1/INT2 procedure-definitions | none. |
| REQ-S06-002 | baseline-validation instance shows step and assignee; completion creates a linked validated baseline | QA a02-a21; E2E-P p5-procedure-outputs 2/2 | none. |
| REQ-S06-003 | ten procedures exist and each can be launched and completed in A02 | QA a02-a21 (both REQ-S06-003 tests pass in QA, INT1, INT2) | the "BE-T5B's own runs" note is superseded by my runs. |
| REQ-S06-004 | T13 field, rule change, approver route in the UI; after publish a new record stores the field, the rule refuses a value it accepted, routing to the new approver | E2E-R a06 (2 tests per project, both settings); QA a06 | none. |
| REQ-S06-005 | 12 % → 0.12; decimal SAR; calculated field with unknown ref rejected | QA a06; INT1/INT2 form-schemas; UNIT field-types/validate/calculated | none. |
| REQ-S06-006 | relabel G3 ok; stable ID change, TOM deletion, ADM approver rejected | QA a06; INT1/INT2 studio-checks | none. |
| REQ-S06-007 | publish without review rejected; published version 409; diff lists the field | QA a06; INT1/INT2 studio-review-publish, studio-checks; E2E-R a06 (diff on screen) | none. |
| REQ-S06-008 | v1 forms kept after v2; preview lists new required field and G2 re-approval; history unchanged | QA a06, a07; INT1/INT2 methodology-migrations | none. |
| REQ-S06-009 | records under the rolled-back version retrievable; audit shows rollback | QA a07; E2E-R a06 afterAll rollback | none. |
| REQ-S06-010 | ADM_METHOD publishes but 403 on a funding reallocation; KPI owner updates actuals but not Studio | QA a06; E2E-R a04 | KPI-owner part via A04 e2e: run and passed here. |
| REQ-S07-016 | prospective change keeps last quarter's RAG; restatement without authority rejected; issued Q1 report unchanged, reissue v2 | QA a07 (read: asserts RAG, evaluation id and target 100 unchanged; refusals; reissue v2); E2E-R a07 | none. |
| REQ-S08-005 | revenue uplift preview: SAR unit, 'Not computable' for missing ARPU | INT1/INT2 formula-preview (8); E2E-P p5-launch-health-kpi | none. |
| REQ-S08-019 | no rate → NPV not shown; 10 % → expected NPV to 2 dp | UNIT metrics.test.ts; INT1/INT2 financial-metrics (12); `13-npv-oracle.log` (my independent oracle: −21.04 / −19.12) | none. |
| REQ-S09-011 | executive pack workstream section has the update text and current metrics | QA a15-snapshots-and-packs, a02-a21; INT1/INT2 owner-updates (7) | none. |
| REQ-S10-013 | linked decision change before cut-off changes presentation; issued pack stays the snapshot | QA a15-snapshots-and-packs | none. |
| REQ-S10-015 | sequential: step 2 not notified before step 1; parallel: both at once | INT1/INT2 approval-routes (9); QA a06 | none. |
| REQ-S12-001 | each execution recorded with rule version, trigger, outcome | QA a13-durable-automation, a13-starters-run | the starter-9 note is superseded (a13-dependency-slip-rule-b passes in QA/INT1/INT2). |
| REQ-S12-002 | dry run creates no tasks; failed execution in queue, retry without duplicates | QA a13-durable-automation, a06 dry run; E2E-R a13 (UI) | none. |
| REQ-S12-003 | rule creating records outside scope fails with authorization error in the failure queue | INT1/INT2 automation-failures (9) | no QA suite (A12 is later): acceptable, the implementer test passes. |
| REQ-S12-004 | one set of checklists and role tasks; retry no duplicates; plan dated from start | QA a13-starter-jobs, a16-launch-plan; INT1/INT2 worker starters | "unchanged on retry, not an exact count" (QA-D): acceptable; worker starters.test.ts asserts one set. |
| REQ-S12-012 | 5-day slip notifies each owner once; forecasts per logic | QA a13-dependency-slip-rule-b | none. |
| REQ-S12-015 | cut-off creates one draft agenda with open asks; not published without review | QA a13-starter-jobs, a15-snapshots-and-packs | none. |
| REQ-S12-018 | formula change lists affected benefits, creates a review task | QA a07, a06 | none. |
| REQ-S12-020 | killed worker mid-job completes once; after retry limit → failure queue | QA a13-durable-automation (SIGKILL, read), a13-jobs-rerun | production retry policy not exercised end to end: acceptable (bounded QA policy, same code path). |
| REQ-S12-021 | replay ×3 → one reminder, one action, one approval task | QA a13-durable-automation | none. |
| REQ-S12-022 | jobs screen: last success, next run; non-admin 403 | QA a22-operational-readiness; E2E-R a22 | none. |
| REQ-S12-025 | quiet-hours reminder in next digest; urgent immediately | INT1/INT2 notification-delivery (11) | no QA suite: acceptable, the implementer test passes. |
| REQ-S12-026 | 'approve gate' action rejected; all preparation and reminder rules run | QA a13-durable-automation, a13-starters-run, a13-dependency-slip-rule-b; INT1/INT2 worker starters, starters-be-j | starters 4, 13, 15 by implementer tests only: acceptable. |
| REQ-S13-004 | ten outputs generate from the demo transformation with its ID and records | QA a15-demo-transformation-outputs | none. |
| REQ-S13-005 | T15 XLSX has exactly the filtered RAID rows; PPTX gate pack has the criteria | QA a15-selected-records-and-injection; E2E-R a15 | none. |
| REQ-S13-006 | '=HYPERLINK(' exports as text; system SUM remains a formula | QA a15-selected-records-and-injection, a15-demo-transformation-outputs | none. |
| REQ-S13-007 | issued snapshot keeps old values and versions after a KPI change | QA a15-snapshots-and-packs, a07 | none. |
| REQ-S13-008 | pending benefit value labelled provisional in the PDF pack | QA a15-demo-transformation-outputs (register PDF); **P-EXEC** (generated EXECUTIVE PACK on the demo data, period 2026-08: SAR 99,000 submitted value, `validation: provisional`, printed next to 'Provisional' (en) / 'مؤقت' (ar)) | "executive pack not staged": closed by P-EXEC. |
| REQ-S13-009 | Arabic PDF RTL, readable numbers and identifiers | QA a15-outputs-every-definition; INSPECT (every Arabic file RTL, every English file LTR) | none. |
| REQ-S13-010 | upload: SHA-256 + version 1; second upload version 2 | INT1/INT2 evidence-register (9) | no QA suite: acceptable. |
| REQ-S14-001 | 17 Yes → 17 and '16-20'; method shown as an assumption | QA a16-health-check; E2E-R a16 | none. |
| REQ-S14-002 | 24 answers → 'Incomplete (24/25)', band null | QA a16-health-check; E2E-R a16 | none. |
| REQ-S14-003 | N/A without new bands rejected; existing assessments keep scheme and band | QA a16-health-check, a07 | pin migration to v2 not exercised: acceptable, not in the acceptance text. |
| REQ-S14-004 | +7 days moves unstarted tasks only; 'blocked by' predecessor | QA a16-launch-plan (read); E2E-P p5-launch-health-kpi 6/6 | "blocked by on screen" is in p5-launch-health-kpi: run and passed here. |
| REQ-S15-004 | brand.primary changes navigation colour and new PDF header colour without redeploy | E2E-P p5-navigation; INT1/INT2 branding (header band colour) | colours stay provisional: correct. |
| REQ-S16-010 | custom value violating schema rejected; typed core columns and FKs | QA a06 | none. |
| REQ-S16-012 | entity group created and read via API with authorization | INT1/INT2 methodology/entity-group (3) | no QA suite: acceptable. |
| REQ-S16-015 | entity group created and read via API with authorization | INT1/INT2 procedures/entity-group (5) | no QA suite: acceptable. |
| REQ-S16-021 | entity group created and read via API with authorization | QA a16-s16-021-entities 6/6; INT1/INT2 s16-021-group | none. |
| REQ-S18-001 | reset twice → identical counts and checksums; every demo screen/record/export shows the label en/ar | QA a22-operational-readiness; E2E-D a02-demo-labels; **P-DEMO D4** (the banner on 29 P5 screens of the demo database, en/ar, both settings) | none (the 8c68a47 note is superseded). |
| REQ-S18-002 | seed coverage of every listed condition | INT1/INT2 demo-roaming; QA a02-a21; INT1/INT2 demo-pending-approval | none. |
| REQ-S18-003 | production init: zero demo records/users; demo seed exits with an error in production mode | QA a22-operational-readiness; INT1/INT2 demo, bootstrap | none. |
| REQ-S18-004 | e2e: twelve walkthrough steps with the demo role users | E2E-D a02-demo-users-walkthrough (en/ar, both settings) | none. |
| REQ-S20-002 | A02 complete lifecycle natively | QA a02-a21; E2E-D a02-* | none. |
| REQ-S20-006 | A06 configuration change | QA a06 27/27; E2E-R a06 | none. |
| REQ-S20-007 | A07 historical integrity | QA a07 12/12; E2E-R a07 | none. |
| REQ-S20-015 | A15 reporting | QA a15 34/34; E2E-R a15; INSPECT | none. |
| REQ-S20-016 | A16 health and launch | QA a16 30/30; E2E-R a16 | none. |
| REQ-S21-001 | no DG0-DG7 in UI strings/export templates; demo G-approvals show the synthetic label | QA a22-s21-001-text-scan 7 tests; E2E-D a02-demo-labels (six gate pages, Finance queue); **P-DEMO D2** (the seeded pending approval opened from BO's My Work shows 'Synthetic demonstration - approves nothing real' / its ar text); INSPECT (0 files name DG0-DG7) | "label on an inbox-opened approval not asserted": closed by D2. The gate-submission snapshot note naming DG0-DG7 is API data no screen or export renders: acceptable. |
