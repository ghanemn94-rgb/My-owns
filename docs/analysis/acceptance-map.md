# Acceptance map: A01–A28

Produced by transformation-analyst (task T-DG0-AN-03). Source: master prompt §20 (M0368–M0399) and §21 (M0401–M0411).

For each acceptance scenario, this map lists:
- the executable-test requirement (`REQ-S20-###`);
- the requirements whose `acceptance` column cites the scenario, which the test proves;
- the test level;
- the stage in which the executable test is first delivered;
- the gate at which it must pass.

Test levels follow M0399: unit for formulas and state rules, integration for persistence, authorization and jobs, end-to-end for business journeys, visual for both languages and report outputs, and ops drill for deployment, recovery and delivery-process scenarios.

**Scope note.** The "proves" lists cover `REQ-PB-###` (AN-01) and the requirements created in AN-03 (`REQ-DLV`, `REQ-S14`…`REQ-S21`). Requirements in areas S01–S13 are created in parallel by AN-02. Their acceptance links appear in the merged `docs/delivery/requirements.csv` and must be added to this map when AN-04 merges the parts.

**Regression rule.** Once a scenario's test first passes at its gate, every later gate re-runs it (M0066, M0413). The P7 evidence covers A01–A27 on the DG7 candidate (M0410), and A28 is the post-approval sealing check (M0411).

| ID | Scenario | Executable test req | Test level | First delivered | Must pass at | Requirements proved (PB + AN-03 areas) |
|---|---|---|---|---|---|---|
| A01 | Source coverage | REQ-S20-001 | e2e | P2 | DG6 | REQ-PB-001..003, REQ-PB-006..008, REQ-PB-010..011, REQ-PB-014, REQ-PB-023..054, REQ-PB-056, REQ-PB-059..062, REQ-PB-065, REQ-PB-067, REQ-PB-070, REQ-PB-073, REQ-PB-077..080, REQ-PB-088..090; REQ-DLV-001, REQ-DLV-020, REQ-DLV-032, REQ-DLV-038..039; REQ-S16-013, REQ-S16-015..016; REQ-S18-001..002 |
| A02 | Complete lifecycle | REQ-S20-002 | e2e | P2 | DG5 | REQ-PB-004, REQ-PB-007, REQ-PB-014, REQ-PB-022; REQ-S18-002, REQ-S18-004; REQ-S21-004 |
| A03 | Modular entry | REQ-S20-003 | integration;e2e | P2 | DG4 | REQ-PB-003, REQ-PB-005; REQ-DLV-034 |
| A04 | KPI propagation | REQ-S20-004 | integration;e2e | P2 | DG4 | REQ-PB-062..063, REQ-PB-074, REQ-PB-085; REQ-DLV-036; REQ-S16-014 |
| A05 | Calculation correctness | REQ-S20-005 | unit | P2 | DG4 | REQ-PB-027, REQ-PB-048, REQ-PB-057, REQ-PB-063; REQ-DLV-035; REQ-S15-008, REQ-S15-014; REQ-S16-025 |
| A06 | Configuration change | REQ-S20-006 | e2e | P5 | DG5 | REQ-PB-049; REQ-DLV-037; REQ-S16-010, REQ-S16-022; REQ-S19-008; REQ-S21-004 |
| A07 | Historical integrity | REQ-S20-007 | integration | P4 | DG5 | REQ-DLV-037; REQ-S14-003; REQ-S16-023, REQ-S16-032 |
| A08 | Gate controls | REQ-S20-008 | integration | P2 | DG4 | REQ-PB-004, REQ-PB-015..022, REQ-PB-037, REQ-PB-046, REQ-PB-055; REQ-DLV-034..035; REQ-S16-012, REQ-S16-023, REQ-S16-027; REQ-S17-008 |
| A09 | Decision escalation | REQ-S20-009 | integration | P4 | DG4 | REQ-PB-064, REQ-PB-066, REQ-PB-068, REQ-PB-081..082; REQ-DLV-036; REQ-S15-008; REQ-S16-018..019 |
| A10 | Benefit integrity | REQ-S20-010 | unit;integration | P3 | DG4 | REQ-PB-013, REQ-PB-054..055, REQ-PB-058, REQ-PB-074..076; REQ-DLV-036; REQ-S16-017; REQ-S17-008 |
| A11 | Adoption and sustainment | REQ-S20-011 | integration;e2e | P4 | DG4 | REQ-PB-009, REQ-PB-020..021, REQ-PB-069, REQ-PB-071..074, REQ-PB-083..085; REQ-DLV-036; REQ-S16-020..021 |
| A12 | Permissions | REQ-S20-012 | integration | P1 | DG6 | REQ-PB-012..013; REQ-DLV-038; REQ-S15-010; REQ-S16-003, REQ-S16-006..007, REQ-S16-011, REQ-S16-027..030, REQ-S16-032; REQ-S17-006..007, REQ-S17-011; REQ-S19-006 |
| A13 | Durable automation | REQ-S20-013 | integration;ops drill | P1 | DG6 | REQ-DLV-038; REQ-S16-001, REQ-S16-005, REQ-S16-022; REQ-S17-006; REQ-S20-029..030 |
| A14 | Concurrent editing | REQ-S20-014 | integration;e2e | P1 | DG6 | REQ-DLV-033, REQ-DLV-038; REQ-S15-010..011; REQ-S16-026 |
| A15 | Reporting | REQ-S20-015 | integration;visual | P4 | DG5 | REQ-PB-089; REQ-DLV-037; REQ-S15-007; REQ-S20-030 |
| A16 | Health and launch | REQ-S20-016 | unit;e2e | P5 | DG5 | REQ-PB-086..087, REQ-PB-091..092; REQ-DLV-037; REQ-S14-001..004; REQ-S16-021 |
| A17 | Import and integration | REQ-S20-017 | integration | P6 | DG6 | REQ-DLV-038; REQ-S17-001..005; REQ-S19-007 |
| A18 | Independent deployment | REQ-S20-018 | ops drill | P1 | DG7 | REQ-DLV-039; REQ-S15-005; REQ-S16-004, REQ-S16-006..009, REQ-S16-031; REQ-S17-009; REQ-S18-003; REQ-S19-001..005, REQ-S19-007..011, REQ-S19-013..019; REQ-S21-003..004 |
| A19 | Backup and recovery | REQ-S20-019 | ops drill | P6 | DG7 | REQ-DLV-039; REQ-S16-004, REQ-S16-024; REQ-S19-012..013 |
| A20 | UX and branding | REQ-S20-020 | e2e;visual | P1 | DG6 | REQ-DLV-033; REQ-S15-001..007, REQ-S15-009, REQ-S15-011..014; REQ-S16-002 |
| A21 | No-AI operation | REQ-S20-021 | e2e | P5 | DG6 | REQ-DLV-038; REQ-S17-005, REQ-S17-009..010; REQ-S19-018 |
| A22 | Operational readiness | REQ-S20-022 | integration;ops drill | P5 | DG6 | REQ-DLV-003, REQ-DLV-038; REQ-S16-001, REQ-S16-024, REQ-S16-029, REQ-S16-033; REQ-S18-001, REQ-S18-003; REQ-S19-010..011; REQ-S20-029; REQ-S21-001 |
| A23 | Real independent stage reviews | REQ-S20-023 | unit (validator);ops (gate audit) | P0 (validator unit tests); gate evidence from DG0 | DG7 | REQ-DLV-001..002, REQ-DLV-004..014, REQ-DLV-021, REQ-DLV-026, REQ-DLV-028, REQ-DLV-031..039; REQ-S20-031; REQ-S21-002, REQ-S21-004 |
| A24 | Enforced advancement | REQ-S20-024 | unit (validator);CI | P0 | DG0 | REQ-DLV-007, REQ-DLV-013, REQ-DLV-015..017, REQ-DLV-019..020, REQ-DLV-023..026, REQ-DLV-032, REQ-DLV-040 |
| A25 | Candidate integrity | REQ-S20-025 | unit (validator) | P0 | DG0 | REQ-DLV-022; REQ-S21-002 |
| A26 | Repair and re-review | REQ-S20-026 | ops drill | P1 (first controlled defect-injection drill) | DG7 | REQ-DLV-008, REQ-DLV-012, REQ-DLV-014, REQ-DLV-017..018; REQ-S20-031 |
| A27 | Reliable resumption | REQ-S20-027 | unit (validator);ops drill | P0 (validator --reconcile, progress.md); drill in P7 | DG7 | REQ-DLV-003, REQ-DLV-011, REQ-DLV-019, REQ-DLV-024, REQ-DLV-027..030, REQ-DLV-039 |
| A28 | Final package integrity | REQ-S20-028 | ops (sealing check) | P7 | DG7 | REQ-DLV-002, REQ-DLV-020..021, REQ-DLV-031, REQ-DLV-039, REQ-DLV-041; REQ-S16-033; REQ-S19-001, REQ-S19-015; REQ-S21-001, REQ-S21-003 |

## Pass conditions (verbatim from M0370–M0397)

- **A01 Source coverage:** Six phases, six gates, T01–T16, charter, TOM canvas, business case, launch plan, health check and example mapped to working features
- **A02 Complete lifecycle:** Authorized users complete the guided end-to-end scenario using only native application workflows
- **A03 Modular entry:** Existing transformation enters at Design with inherited evidence; missing baseline/outcome links are flagged and cannot silently pass gates
- **A04 KPI propagation:** Submit a period actual; validate and accept it; linked dashboards/RAG/calculations update once; benefit needing Finance review remains pending
- **A05 Calculation correctness:** Automated tests cover higher/lower/band measures, stale/missing values, zero denominator, percentage points, periods and currency/decimal precision
- **A06 Configuration change:** Admin adds a field, changes a form rule and updates a workflow using the UI; a new published version works without application-code changes
- **A07 Historical integrity:** Target/formula changes show impact and reapproval; previous period reports and approved snapshots remain intact
- **A08 Gate controls:** Missing evidence blocks submission; unauthorized approval and stale-version approval are rejected by the API
- **A09 Decision escalation:** A working-day SLA expiration produces the correct escalation and linked executive ask without duplicate actions
- **A10 Benefit integrity:** A shared benefit rolls up once; 110% allocation is rejected; unvalidated or forecast value cannot appear as validated actual
- **A11 Adoption and sustainment:** Poor adoption triggers intervention; delivery completion alone does not close value realization; accepted handover creates recurring BAU tasks
- **A12 Permissions:** Cross-transformation unauthorized reads/writes, exports, search results, evidence URLs and AI retrieval are denied
- **A13 Durable automation:** Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable
- **A14 Concurrent editing:** Conflicting updates show a recoverable conflict rather than silently overwriting accepted changes
- **A15 Reporting:** Executive pack and relevant PDF/DOCX/XLSX/PPTX outputs contain current selected data, correct provenance and readable Arabic/English layout
- **A16 Health and launch:** All 25 questions and four source score bands work; incomplete assessments are labeled; launch tasks are generated from the chosen start date
- **A17 Import and integration:** Invalid rows are isolated, duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error
- **A18 Independent deployment:** Clean environment starts successfully, restored records/files/configuration work and workflows run without the original builder or mandatory public SaaS
- **A19 Backup and recovery:** Restore drill recovers database, evidence, audit, snapshots and job state with documented checks and timings
- **A20 UX and branding:** Arabic RTL/English LTR, keyboard flows and mobile review work; changing the primary brand token updates screens and output templates
- **A21 No-AI operation:** Core lifecycle, approvals, calculations and reports still work with AI and external notification channels disabled
- **A22 Operational readiness:** Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated
- **A23 Real independent stage reviews:** Each DG gate includes separate actual domain, code/security and QA review evidence plus an independent release audit; implementers cannot approve their own work
- **A24 Enforced advancement:** Gate validator rejects missing reviewers, failed checks, unresolved blocking findings and incomplete requirements; the pipeline cannot advance a failed gate
- **A25 Candidate integrity:** A source/test/configuration change invalidates mismatched approval; review metadata does not recursively invalidate its own candidate
- **A26 Repair and re-review:** Introduce a known defect in a controlled test branch; independent reviewers identify it, the implementer fixes it, and independent rechecks/regression tests prove closure
- **A27 Reliable resumption:** Resume from a checkpoint; reconstruct current stage/tasks/evidence, reject stale reviews and continue without inventing approvals or requiring routine user confirmation
- **A28 Final package integrity:** After the DG7 candidate review, seal the handover with all eight gate records, agent definitions, requirement coverage and findings; verify package integrity and keep these records distinct from product gates G1–G6. This post-approval sealing check must pass before delivery is declared complete

## Placement rationale

- **A03, A04, A05, A08, A09, A10 and A11 at DG4.** These capabilities complete with the P4 KPI/benefit engines, gates G1–G6 and adoption/BAU (M0407).
- **A02, A06, A07, A15 and A16 at DG5.**
  - A02: the guided walkthrough, including report generation, is a P5 output (M0349, M0408).
  - A06 and A07: the Studio and version migration are P5 outputs.
  - A15: report and export formats are P5 outputs.
  - A16: the launch plan and health check are P5 outputs.
- **A01, A12, A13, A14, A17, A20, A21 and A22 at DG6.** The P6 evidence requires the "applicable A01–A22 checks", authorization boundary tests, concurrency and failure recovery, and the lifecycle with AI disabled (M0409). A01 needs every mapped feature working, which includes P5 outputs.
- **A18 and A19 at DG7.** The clean-environment transfer and the restore drill are P7 outputs (M0410).
- **A24 and A25 at DG0.** The validator rejection rules and candidate hashing are P0 outputs (M0403). Executable tests already exist in `tools/gates/tests/validator.test.mjs` and are re-run at every later gate.
- **A23, A26 and A27 at DG7.** They can only complete once every gate DG0–DG7 has the evidence.
- **A28 at DG7.** It is a post-approval sealing check, not a prerequisite for DG7 approval (M0411).
