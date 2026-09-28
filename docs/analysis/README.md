# Analysis artefacts: index

Maintained by transformation-analyst. Last integration: T-DG0-AN-05 (stage P0 / DG0, round-1 repairs). All counts below come from the merged `docs/delivery/requirements.csv` and the two coverage matrices at the time of writing. The register is authoritative; re-run the merge and `node tools/gates/validate.mjs --register DG0` after any part-file change.

The playbook is a practical synthesis *inspired by* PMI, Brightline and BRM, with custom extensions. Neither the playbook nor this product is an official PMI standard or a certified product. `#0078FF` is a provisional brand token.

## Artefacts

| Artefact | Purpose | Producer |
|---|---|---|
| `docs/delivery/requirements.csv` | The requirement register (412 rows). Generated only by `tools/source/merge_register.py` from `parts/req-*.csv` and `parts/ref-additions-*.csv`. | AN-01..AN-04 (merge AN-04) |
| `docs/analysis/source-coverage.csv` | One disposition per playbook block B0001–B0165 (165 rows). | AN-01 |
| `docs/analysis/master-prompt-coverage.csv` | One disposition per master-prompt block M0001–M0423 (423 rows). Generated from `parts/mp-coverage-*.csv`. | AN-02, AN-03 (merge AN-04) |
| `docs/analysis/parts/` | The editable sources of the register and master-prompt coverage: `req-pb.csv`, `req-s01-s13.csv`, `req-dlv-s14-s21.csv`, `mp-coverage-s01-s13.csv`, `mp-coverage-p0-s14-s21.csv`, `ref-additions-an02.csv`, `ref-additions-an03.csv`, `ref-additions-an08.csv`. | AN-01..AN-04; AN-08 |
| `docs/analysis/glossary.md` | Domain glossary, English and Arabic. The Arabic terms are proposals pending native-speaker review. | AN-01 |
| `docs/analysis/field-inventory.md` | Fields of every template (T01–T16, charter, TOM canvas, business case, launch plan, health check, roaming example) and first-class record, with the source column names kept verbatim. | AN-01 |
| `docs/analysis/user-journeys.md` | Journeys J1–J8 per role. | AN-02 (ID references updated by AN-04) |
| `docs/analysis/permissions-matrix.md` | Role × record × action matrix, scope rules, separation of duties. | AN-02 (ID references updated by AN-04) |
| `docs/analysis/acceptance-map.md` | A01–A28: executable-test row, requirements proved, test level, first delivery, gate, and the gate ordering of scenario suites. | AN-03 (proves lists regenerated for all areas by AN-04) |
| `docs/analysis/stage-plan.md` | P0–P7: owners, outputs, evidence, dependencies, and the IDs completing or partially delivered per stage. | AN-03 (ID lists regenerated for all areas by AN-04) |
| `docs/analysis/tools/check_counts.py` | Consistency check: recomputes the counts in this README and the stage-plan ID lists from the register; exits 1 on any mismatch. `--write` regenerates the stage-plan lists. | AN-06 (promoted into the repository by AN-07) |
| `docs/analysis/tools/check_pb_provenance.py` | Consistency check for REQ-PB notes: every master-prompt anchor or section named in the notes is cited in `source_ref`; the Interpretations clause cites no master-prompt text (such items are labelled additions); every master-prompt anchor in a REQ-PB `source_ref` maps back to that row in `master-prompt-coverage.csv`. From AN-09: R5 flags an Interpretations clause that shares a phrase or most of its content words with a cited master-prompt block (hand-reviewed false positives are listed with rationale in `REVIEWED_R5` and re-flag if the text changes); R6 requires 'Master-prompt additions: none' rows to account for every cited anchor; R7 checks that a `§n` label matches its anchors' section. Exits 1 on any problem. | AN-08, AN-09 |
| `docs/analysis/tools/check_test_refs.py` | Consistency check for the register's test and file references: quoted test titles in acceptance equal the declared test titles; a named self-test quotes its title; evidence files and named files exist. Exits 1 on any problem. From AN-10 (F-DG0-009) the declared titles are derived from the test files themselves (`test(...)` in `tools/gates/tests/*.test.mjs` and `tools/agents/tests/*.test.mjs`, and `def test_...` methods in `tools/agents/tests/test_*.py`), not from a hand-maintained list. T4 checks the derivation (every test file yields titles, every JavaScript `test(` call has a literal title, no duplicate titles), and T5 is a built-in negative control that must flag a fabricated citation. A title may contain an in-word apostrophe (reviewer's). | AN-08, AN-09, AN-10 |
| `docs/analysis/tools/check_acceptance_map.py` | Consistency check for `acceptance-map.md`, both ways: each scenario's "Requirements proved" list equals the register rows whose `acceptance` column cites the scenario as a whole-word token (the rule `check_counts.py` uses), minus the scenario's own `REQ-S20-###` test row. The "Gate ordering" line equals those rows whose `final_gate` is later than the scenario's gate, with matching annotations. A built-in negative control must detect a synthetic citing row and a removed ID. `--map FILE` checks another copy. Exits 1 and prints every mismatch. | AN-14 (F-DG0-235) |

## Register counts

### By class

| Class | Rows |
|---|---|
| SOURCE | 93 |
| USER | 188 |
| ENGINEERING | 131 |
| Total | 412 |

Every SOURCE row cites at least one playbook block. USER and ENGINEERING rows cite master-prompt blocks. Master-prompt details that the playbook lacks are labelled `implementation-assumption` or `extension` in `notes`. An example is the Yes=1/No=0 health-check scoring (REQ-S14-001, D-010).

### By final gate

| Final gate | DG0 | DG1 | DG2 | DG3 | DG4 | DG5 | DG6 | DG7 | Total |
|---|---|---|---|---|---|---|---|---|---|
| Rows | 19 | 12 | 32 | 32 | 137 | 78 | 48 | 54 | 412 |

### Class × final gate

| Class | DG0 | DG1 | DG2 | DG3 | DG4 | DG5 | DG6 | DG7 |
|---|---|---|---|---|---|---|---|---|
| SOURCE | 0 | 0 | 24 | 21 | 36 | 12 | 0 | 0 |
| USER | 0 | 3 | 6 | 7 | 76 | 55 | 19 | 22 |
| ENGINEERING | 19 | 9 | 2 | 4 | 25 | 11 | 29 | 32 |

### By area

| Area | SOURCE | USER | ENGINEERING | Total | DG0 | DG1 | DG2 | DG3 | DG4 | DG5 | DG6 | DG7 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PB | 93 | 0 | 0 | 93 |  |  | 24 | 21 | 36 | 12 |  |  |
| DLV | 0 | 0 | 42 | 42 | 17 | 3 | 1 | 1 | 1 | 1 | 1 | 17 |
| S01 | 0 | 5 | 1 | 6 |  |  |  |  |  | 3 | 1 | 2 |
| S02 | 0 | 3 | 2 | 5 |  |  |  |  |  | 2 | 1 | 2 |
| S03 | 0 | 11 | 0 | 11 |  |  |  |  | 9 | 2 |  |  |
| S04 | 0 | 14 | 0 | 14 |  |  | 3 | 1 | 9 | 1 |  |  |
| S05 | 0 | 5 | 0 | 5 |  |  | 1 | 1 |  | 3 |  |  |
| S06 | 0 | 9 | 1 | 10 |  |  |  |  |  | 10 |  |  |
| S07 | 0 | 11 | 6 | 17 |  |  |  |  | 16 | 1 |  |  |
| S08 | 0 | 14 | 4 | 18 |  |  |  | 1 | 15 | 2 |  |  |
| S09 | 0 | 8 | 2 | 10 |  |  |  | 6 | 3 | 1 |  |  |
| S10 | 0 | 18 | 1 | 19 |  |  | 1 |  | 14 | 2 | 2 |  |
| S11 | 0 | 8 | 0 | 8 |  |  |  |  | 8 |  |  |  |
| S12 | 0 | 18 | 4 | 22 |  |  |  |  | 7 | 12 | 3 |  |
| S13 | 0 | 10 | 3 | 13 |  |  | 1 |  | 3 | 7 | 2 |  |
| S14 | 0 | 4 | 0 | 4 |  |  |  |  |  | 4 |  |  |
| S15 | 0 | 14 | 0 | 14 |  | 3 |  |  | 1 | 1 | 9 |  |
| S16 | 0 | 0 | 32 | 32 |  | 4 | 1 | 1 | 8 | 4 | 9 | 5 |
| S17 | 0 | 4 | 7 | 11 |  |  |  |  |  |  | 10 | 1 |
| S18 | 0 | 4 | 0 | 4 |  |  |  |  |  | 4 |  |  |
| S19 | 0 | 17 | 2 | 19 |  | 2 |  |  |  |  |  | 17 |
| S20 | 0 | 9 | 22 | 31 | 2 |  |  |  | 7 | 5 | 10 | 7 |
| S21 | 0 | 2 | 2 | 4 |  |  |  |  |  | 1 |  | 3 |

### By status

| Status | Rows |
|---|---|
| IMPLEMENTED | 19 |
| SPECIFIED | 393 |

`VERIFIED` is never written to the register. Verification is derived by the validator from PASS review records.

## Coverage dispositions

| Matrix | Blocks | REQUIREMENT | CONTEXT | NON-REQUIREMENT |
|---|---|---|---|---|
| Playbook (source-coverage.csv) | 165 | 129 | 29 | 7 |
| Master prompt (master-prompt-coverage.csv) | 423 | 367 | 49 | 7 |

## Acceptance scenario coverage

All 28 scenarios are referenced. "Rows citing" counts the register rows whose `acceptance` column names the scenario, including the scenario's own test row.

| ID | Scenario | Test row | Must pass at | Rows citing |
|---|---|---|---|---|
| A01 | Source coverage | REQ-S20-001 | DG6 | 83 |
| A02 | Complete lifecycle | REQ-S20-002 | DG5 | 27 |
| A03 | Modular entry | REQ-S20-003 | DG4 | 5 |
| A04 | KPI propagation | REQ-S20-004 | DG4 | 18 |
| A05 | Calculation correctness | REQ-S20-005 | DG4 | 31 |
| A06 | Configuration change | REQ-S20-006 | DG5 | 23 |
| A07 | Historical integrity | REQ-S20-007 | DG5 | 21 |
| A08 | Gate controls | REQ-S20-008 | DG4 | 41 |
| A09 | Decision escalation | REQ-S20-009 | DG4 | 16 |
| A10 | Benefit integrity | REQ-S20-010 | DG4 | 28 |
| A11 | Adoption and sustainment | REQ-S20-011 | DG4 | 29 |
| A12 | Permissions | REQ-S20-012 | DG6 | 40 |
| A13 | Durable automation | REQ-S20-013 | DG6 | 28 |
| A14 | Concurrent editing | REQ-S20-014 | DG6 | 9 |
| A15 | Reporting | REQ-S20-015 | DG5 | 14 |
| A16 | Health and launch | REQ-S20-016 | DG5 | 12 |
| A17 | Import and integration | REQ-S20-017 | DG6 | 11 |
| A18 | Independent deployment | REQ-S20-018 | DG7 | 33 |
| A19 | Backup and recovery | REQ-S20-019 | DG7 | 6 |
| A20 | UX and branding | REQ-S20-020 | DG6 | 20 |
| A21 | No-AI operation | REQ-S20-021 | DG6 | 8 |
| A22 | Operational readiness | REQ-S20-022 | DG6 | 15 |
| A23 | Real independent stage reviews | REQ-S20-023 | DG7 | 30 |
| A24 | Enforced advancement | REQ-S20-024 | DG0 | 16 |
| A25 | Candidate integrity | REQ-S20-025 | DG0 | 3 |
| A26 | Repair and re-review | REQ-S20-026 | DG7 | 7 |
| A27 | Reliable resumption | REQ-S20-027 | DG7 | 10 |
| A28 | Final package integrity | REQ-S20-028 | DG7 | 14 |

## AN-04 consistency pass

### Consolidated (deleted) IDs

IDs are not renumbered, so the gaps remain. Each keeper row carries the union of the `source_ref` anchors and acceptance conditions, plus a note naming the former ID. Coverage rows were remapped to the keeper.

| Deleted ID | Consolidated into | Reason |
|---|---|---|
| REQ-S16-028 | REQ-S10-004 | Same capability: authorization scopes for exports and search indexes (M0330) are a subset of the server-side permission enforcement for records, files, APIs, exports, search and AI retrieval (M0188). |
| REQ-S02-002 | REQ-DLV-020 | Same capability: the requirements traceability register (M0084-M0087) is the register maintained under §0.5 (M0058). The S02 row sat at DG7 while the same register must be complete at DG0. |
| REQ-S09-002 | REQ-PB-049 | Same capability: configurable, versioned rubrics and weights (M0176). REQ-PB-049 already specified versioned weight sets. (AN-05: the Studio/admin part is now REQ-PB-093.) |
| REQ-S12-008 | REQ-S04-012 | Same behaviour: block gate submission while mandatory evidence is missing (M0228 starter automation, M0125 rule). |
| REQ-S12-007 | REQ-PB-085 | Same behaviour: a KPI or benefit off track creates or updates one corrective-action case (M0227; B0121, B0093). |
| REQ-S12-013 | REQ-PB-082 | Same behaviour: a blocker Red across the configured cycles requires one executive ask (M0233; B0131). REQ-PB-082 already cited M0233 and the no-duplicate rule. |
| REQ-S12-017 | REQ-PB-083 | Same behaviour: accepted BAU handover transfers ownership and activates recurring reviews (M0237). REQ-PB-083 already cited M0237. |
| REQ-S02-007 | REQ-S18-001 | Same capability: demo data marked synthetic and isolated from production (M0090, M0339). The production-initialization clause is covered by REQ-S18-003. |
| REQ-S05-004 | REQ-PB-042 | Same capability: the 90-120-minute TOM canvas workshop with conversion of unresolved items (B0063, M0147). Agenda and action conversion are labelled as master-prompt additions in the notes. |
| REQ-S11-003 | REQ-PB-069 | Same capability: adoption tracked as an outcome against trajectory, with one intervention created when there is a gap (B0105, M0216). |
| REQ-S08-012 | REQ-PB-058 | Same capability: double-counting prevention, where a shared benefit rolls up once (B0088, M0173). The canonical-register mechanism is labelled as master prompt §8. |

### Gate and increment corrections

Rule applied: a requirement needed by the verbatim pass condition of a scenario, or by a dependent row, must not complete after that scenario's or dependent's gate. Partial earlier increments are allowed and are listed in `stage-plan.md`.

| ID | Before (increments / gate) | After | Reason |
|---|---|---|---|
| REQ-S12-009 | P2;P5 / DG5 | P2;P3;P4 / DG4 | Routing the evidence snapshot to approvers is needed by A08 (DG4) and every product gate. |
| REQ-S12-010 | P2;P5 / DG5 | P2;P3;P4 / DG4 | Enabling the authorized next phase is needed by REQ-S03-004 and the gate controls at DG4. |
| REQ-S12-011 | P4;P5 / DG5 | P4 / DG4 | A09 (DG4) is a working-day SLA escalation. |
| REQ-S12-014 | P4;P5 / DG5 | P4 / DG4 | A10 (DG4) and the P4 Finance-validation evidence need the Finance queue. |
| REQ-S12-016 | P4;P5 / DG5 | P4 / DG4 | A11 (DG4): poor adoption triggers an intervention. |
| REQ-S18-003 | P5;P7 / DG7 | P5 / DG5 | A22 (DG6) and REQ-PB-088 (DG5) need production/demo separation. The P7 package re-verifies it under A18/A28. |

Starter-automation configurability in the rule builder stays at DG5 under REQ-S12-001 and REQ-S12-002. REQ-S12-001 now names every consolidated starter automation.

### Semantic resolutions (recorded in `notes`)

- **REQ-S07-007 vs REQ-PB-063.** Trajectory-based RAG, which never uses task completion, governs KPIs and the T10 Outcomes area. The other T10 areas keep the playbook's area-specific logic: validated benefit gap, milestone plus outcome risk, decision date or critical path, and adoption curve. The playbook wins for SOURCE content.
- **REQ-S10-012 vs REQ-PB-081.** The executive-ask fields map onto the verbatim T16 columns, for example Required date → Decision date.
- **REQ-PB-091 vs REQ-S14-001/002.** The incomplete-assessment rule and Yes=1/No=0 scoring are implementation assumptions (D-010), specified in the S14 rows.
- **Class review (AN-02 gap 1).** No S01–S13 row was reclassified as SOURCE. Every S row that shares a master-prompt block with a REQ-PB row now names the related SOURCE rows in `notes`. Where an S row's playbook-grounded substance duplicated a REQ-PB row, it was consolidated into that SOURCE row instead (see above), with the master-prompt additions labelled.

## AN-05 round-1 repairs

| Finding | Change |
|---|---|
| F-DG0-001 | REQ-PB-049 was split. It keeps the per-transformation weights, the 100% check and weight-set versions, with P3 / DG3. The new REQ-PB-093 covers admin default weights and rubrics in Playbook Studio, with P5 / DG5. A §21 recheck of M0403–M0410 also moved REQ-S12-020/021 to DG5 and added invalid-approval acceptance to REQ-S04-003..006. See `stage-plan.md`, "§21 evidence recheck". |
| F-DG0-002 | The G5 approver is SP by default, configurable to BO per T11 "Go-live / scale" (REQ-PB-020, REQ-S04-007). The permissions matrix gains a T11 "Go-live / scale" row, SP has Rv on the TOM row, and rule 7 is clarified. |
| F-DG0-003 | The notes of every SOURCE row now separate the playbook content from master-prompt additions and interpretations. The "no interpretation beyond the cited blocks" boilerplate was removed from every row. |
| F-DG0-005 | Glossary: Journey and Modular mode fixed, plus nine other terms (see the revision table in `glossary.md`). |
| F-DG0-203 | `stage-plan.md` gains a per-scenario ownership table and per-stage "executable acceptance tests" bullets; `acceptance-map.md` is aligned with it, and A07 is now first delivered in P3. |

Also fixed: two stale IDs in `user-journeys.md`. REQ-DLV-026 and REQ-DLV-032 now cite regular files instead of directories.

## AN-07 stage-plan list regeneration

The P0–P6 "increment in Pn that complete later" lists in `stage-plan.md` left out the 16 recurring DG7 protocol rows (REQ-DLV-005, -008..012, -014, -018, -021, -024, -027, -028, -030, -031, -039, -040), so they did not equal the register. They are now generated from the register by `docs/analysis/tools/check_counts.py --write` and include those rows. The "Recurring obligations" bullet now names REQ-DLV-039, which it had omitted. No register row changed; the counts above were confirmed by the script.

## AN-08 round-2 register repairs

| Finding | Repair |
|---|---|
| F-DG0-006 | REQ-PB-068: the M0212 publication block is now a master-prompt addition, not an interpretation. REQ-PB-088: M0348 is cited in `source_ref` and the M0348 coverage row lists REQ-PB-088. A scan of all 93 REQ-PB rows (`tools/check_pb_provenance.py`) found further label/`source_ref` mismatches of the same kind (counts in the AN-08 handback): anchors named in the notes but not cited (added through `parts/ref-additions-an08.csv`, 59 anchor citations over 46 rows, each mirrored in the coverage rows), section-only citations (now anchored), and master-prompt content filed under Interpretations (REQ-PB-003, -007, -031, -063, -082 relabelled as additions; REQ-PB-006, -008, -011, -035, -036, -061, -073 no longer cite the master prompt for an analyst reading). No requirement's scope, class, increments or gate changed. |
| F-DG0-207 | REQ-DLV-013 and REQ-DLV-026 cite 'A24 / F-DG0-102: fabricated or incomplete provenance is rejected'. The re-check (`tools/check_test_refs.py`) also corrected partial or unquoted test references in REQ-DLV-005, -007, -016, -017, -022, -023, -032 and -040. All 19 quoted titles now equal declared test titles. |

## AN-09 round-3 register repairs

| Finding | Repair |
|---|---|
| F-DG0-008 | REQ-PB-091 (M0288: top three actions required, reassessments tracked), REQ-PB-050 (M0135 linked initiatives, dates and milestones; M0178 overlapping planning horizons) and REQ-PB-078 (M0150 canonical dependency record) now list that content under 'Master-prompt additions' with anchors; their Interpretations keep only readings neither source states. `check_pb_provenance.py` gained R5 (phrase overlap with cited blocks), R6 and R7. The whole-register re-check also relabelled REQ-PB-003 (M0095 entry phase), -072 (M0216 attendance is not adoption), -087 (M0261 Day-90 test as a scheduled task) and -093 (M0176 seeded weights), and made eleven 'additions: none' rows name the cited block they merely restate (REQ-PB-002, -030, -032, -034, -040, -041, -045, -047, -070, -080, -092). Ten R5 flags were reviewed as false positives. Only `notes` changed. No scope, class, increment, gate or `source_ref` changed. |
| F-DG0-209 (register part) | REQ-DLV-022 now states the `mth-candidate-v2` line `<sha256>  <git mode>  <path>`, the historical `mth-candidate-v1` use, and the per-freeze write-once manifest `docs/delivery/candidates/<DGx>/<id-prefix>.manifest.json`. Checked against `tools/gates/lib/*.mjs`, `run-agent.sh`, `guard-write.mjs` and D-016..D-021: REQ-DLV-006 (D-019 resume), -007 (D-020 guard hardening), -013 (D-016/D-021 provenance and output binding), -016 (sidecar-only observation acceptance), -017 (sidecar closure, import-findings), -021 (write-once records) and -026 (run outputs, reviewer auto-commit) were updated, with the new tests cited. No register row referred to the removed `docs/delivery/candidates/DG0.manifest.json`. |

## AN-13 round-13 register repairs (D-027)

| Finding | Repair |
|---|---|
| F-DG0-142 | New ENGINEERING requirement REQ-DLV-042 (P1 / DG1, SPECIFIED): dependency installation, an orchestrator step because agent shells have no network, runs inside bubblewrap with registry-only network, a read-only root, only the target tree and package store writable, lifecycle scripts off unless allow-listed, and a committed lockfile. Grounded in M0012, M0314, M0331 and M0404; the bubblewrap mechanism is labelled as implementation decision D-027. The four coverage rows list it. |
| F-DG0-141 | REQ-DLV-023 now describes `sandbox-run.sh` doing the clone, checkout and command inside bubblewrap on a private tmpfs with the git directory bound read-only (no clone into `$TMPDIR`), and cites the F-DG0-141 sandbox test. |
| F-DG0-012, F-DG0-234 | REQ-DLV-007: the configuration scan reports added, changed and removed entries and fails closed; cites the F-DG0-012/F-DG0-234 runner test. |
| F-DG0-233 | REQ-DLV-013: `meta.cwd` must equal the transcript's CLI init `cwd` and the replayed prompt's working directory; cites the F-DG0-233 validator test. |

## AN-14 round-14 repairs (D-028)

| Finding | Repair |
|---|---|
| F-DG0-235 | `acceptance-map.md` lists REQ-DLV-042 under A18, A23 and A24, and in the A24 "Gate ordering" line (DG1). The new `tools/check_acceptance_map.py` enforces the map's rule in both directions, so this drift now fails `prefreeze.sh`. It fails on the pre-fix map (4 mismatches, exactly the ones QA reported) and passes after the fix. |
| F-DG0-143, F-DG0-144 | REQ-DLV-007 now states the D-028 controls and cites the three new guard tests and the three new settings tests: only the run's private `MTH_RUN_TMP` is file-tool scratch, the guard fails closed on unresolvable paths and on `/proc`, `/sys` and `/dev`, and each reviewer writes only its own review files and evidence directory. REQ-DLV-006: private `TMPDIR` per run (`TMPDIR`/`MTH_RUN_TMP`, removed at the end), stage argument of `agent_settings.py`, and the F-DG0-144 runner test. REQ-DLV-008 (SPECIFIED) records the isolation of concurrent agents in scratch, records and evidence. REQ-DLV-023 no longer says agents share `$TMPDIR`. |
