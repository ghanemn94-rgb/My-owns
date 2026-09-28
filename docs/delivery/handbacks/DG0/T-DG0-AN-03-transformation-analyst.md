# Handback T-DG0-AN-03: transformation-analyst

- **Stage:** P0 / DG0 (BUILDING)
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG0-T-DG0-AN-03-transformation-analyst-20260928T120258Z","session_id":"244a3602-9d9a-421c-9acb-fe40061299f3"}`
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-03.md`. The SHA-256 was verified as `49b151e2…73c788` and matches the one given.
- **Starting revision:** HEAD `df28e87ac6c8bfac00f19c777eb89c023d535d6a`. `git diff --stat ab80507..HEAD` touches only `docs/delivery/assignments/DG0/T-DG0-AN-0{2,3}.md`, as the assignment allows.
- **Working tree at start:** the only uncommitted changes were to those two assignment files, plus the untracked run directories.

## 1. Changed files

All files are new, and all are inside the permitted outputs.

| File | Purpose |
|---|---|
| `docs/analysis/parts/req-dlv-s14-s21.csv` | 161 register rows: REQ-DLV-001..041, REQ-S14-001..004, REQ-S15-001..014, REQ-S16-001..033, REQ-S17-001..011, REQ-S18-001..004, REQ-S19-001..019, REQ-S20-001..031, REQ-S21-001..004. |
| `docs/analysis/parts/mp-coverage-p0-s14-s21.csv` | Exactly 242 coverage rows (M0001–M0074 and M0256–M0423): 211 REQUIREMENT, 24 CONTEXT, 7 NON-REQUIREMENT. |
| `docs/analysis/parts/ref-additions-an03.csv` | M anchors to append to 7 REQ-PB rows whose content §14/§18 restate (details in section 2). |
| `docs/analysis/acceptance-map.md` | For each of A01–A28: the executable-test requirement, the requirements it proves, the test level, the stage where the test is first delivered, and the gate where it must pass. It also includes the verbatim pass conditions and the placement rationale. |
| `docs/analysis/stage-plan.md` | For each of P0–P7: owners (§21), outputs, evidence, dependencies, ID ranges completing at the gate and partial increments, and the parallelization and serialization plan (≤4 workers; migrations, contract, shared configuration and seed each have a single owner). |
| `docs/delivery/handbacks/DG0/T-DG0-AN-03-transformation-analyst.md` | This handback. |

The part files were produced by a deterministic generator kept in my session scratchpad (`gen.py`, `gen_md.py`, `selfcheck.py`), not in the repository, because I may not write `tools/`. If the orchestrator wants the generator preserved, it has to be placed in `tools/source/`.

## 2. Behaviour delivered, per requirement area

**DLV (§0 plus the §21 stage rows). 41 rows, all ENGINEERING.**
- **17 IMPLEMENTED at final gate DG0.** Each names evidence files that exist:
  - DLV-001 (edition and source decision);
  - DLV-002 (DG vs G separation);
  - DLV-003 (environment record);
  - DLV-004 (the ten agent definitions and load verification);
  - DLV-006 (runner and real invocations);
  - DLV-007 (write guard);
  - DLV-013 (review record schema and provenance);
  - DLV-015 (gate state machine);
  - DLV-016 (gate pass conditions in the validator);
  - DLV-017 (findings register);
  - DLV-019 (delivery records);
  - DLV-022 (candidate hash);
  - DLV-023 (validator and CI job);
  - DLV-026 (invocation evidence);
  - DLV-029 (checkpoint and reconcile).
  - Also IMPLEMENTED at DG0: REQ-S20-024 (A24) and REQ-S20-025 (A25). Their executable tests already exist in `tools/gates/tests/validator.test.mjs`.
- **Two rows with final gate DG0 are deliberately SPECIFIED, not IMPLEMENTED.** Their artefacts don't exist yet (see Known gaps).
  - DLV-020: the register and both coverage matrices.
  - DLV-032: the full P0 output set, including AN-02's user journeys.
- **Recurring protocol obligations** (increments P0–P7, final gate DG7): DLV-005, -008, -009, -010, -011, -012, -014, -018, -021, -024, -027, -028, -030, -031, -039, -040.
- **§21 stage-table rows** map to DLV-032 (P0, DG0), DLV-033 (P1, DG1), DLV-034 (P2, DG2), DLV-035 (P3, DG3), DLV-036 (P4, DG4), DLV-037 (P5, DG5), DLV-038 (P6, DG6) and DLV-039 (P7, DG7).
- **DLV-025:** product CI jobs `needs: delivery-gates`. Increment P1, final gate DG1.
- **DLV-041:** A28 sealing (M0411). Final gate DG7.

**§14. 4 USER rows.**
- **S14-001/002/003:** Yes=1/No=0 scoring, incomplete-if-unanswered, and a separately versioned scoring scheme. All are labelled `implementation-assumption (D-010)`.
- **S14-004:** editable launch tasks with owners, dependencies and rescheduling from the start date. Labelled `extension`.
- **Source content goes to REQ-PB rows through ref-additions:**
  - PB-086 gets M0257–M0261.
  - PB-087 gets M0261 (the Day-90 test).
  - PB-091 gets M0262–M0288 (the 25 questions, top three actions and reassessments).
  - PB-092 gets M0288 (the bands).

**§15. 14 USER rows.**
- S15-002 holds all seven tokens with their values, labelled provisional (D-011).
- Separate rows cover:
  - contrast validation and the semantic status tokens (S15-003);
  - Branding Settings, where a token change updates screens and templates (S15-004);
  - bundled fonts with no CDN (S15-005);
  - the provisional wordmark (S15-006);
  - RTL/LTR (S15-007);
  - timezone, currency and the time model (S15-008);
  - responsive layouts, productivity features, states, accessibility and tables (S15-009..013);
  - plain-language calculation explanations (S15-014).

**§16. 33 ENGINEERING rows.**
- Architecture baseline: S16-001..010.
- One row per entity group, listing every named entity: S16-011..022, citing M0317–M0328.
- Data rules:
  - integrity and deletion protection (S16-023);
  - retention (S16-024);
  - decimal arithmetic (S16-025);
  - optimistic concurrency (S16-026).
- API, exports and search scoping, and service identity: S16-027..029.
- Security controls, secrets and TLS, append-only audit, and no compliance claims: S16-030..033.

**§17. 11 rows.**
- **Connectors and imports:** S17-001..006, ENGINEERING.
- **Assistant:** S17-007..010 are USER and S17-011 (untrusted document instructions) is ENGINEERING.
  - AI is disabled by default.
  - The assistant cannot approve, certify or invent anything.
  - Core workflows run without AI.

**§18. 4 USER rows.**
- S18-001: resettable demo environment.
- S18-002: seed coverage list.
- S18-003: empty production initialization.
- S18-004: the 12-step guided walkthrough.
- The roaming example content goes to PB-088/089/090 through ref-additions (M0339, M0341–M0347).

**§19. 19 USER/ENGINEERING rows.**
- One row per handover item 1–12, plus the archive, exportability, the transfer drill, the offline runtime and the no-builder-dependency rule.
- Items 3 and 4 are split as the assignment asks:
  - an ERD and migrations row at DG1 (S19-004) and the final package at DG7 (S19-005);
  - an OpenAPI row at DG1 (S19-006) and the final package at DG7 (S19-007).

**§20. 31 rows.**
- S20-001..028 are the executable tests for A01–A28. Each carries the scenario name and the verbatim pass condition.
- **Final gates:**
  - DG4: A03, A04, A05, A08, A09, A10, A11.
  - DG5: A02, A06, A07, A15, A16.
  - DG6: A01, A12, A13, A14, A17, A20, A21, A22.
  - DG7: A18, A19, A23, A26, A27, A28.
  - DG0: A24, A25.
- S20-029 holds the performance targets, labelled "provisional engineering targets, not verified Mobily capacity requirements".
- S20-030 covers asynchronous exports and S20-031 the test levels.

**§21. 4 rows.**
- S21-001: product labelling, so that G6 does not imply DG7 and a demo approval approves nothing real.
- S21-002: integrated increments and reopening earlier gates.
- S21-003: full scope, release blockers and no credentials.
- S21-004: the completion standard.

**CONTEXT and NON-REQUIREMENT blocks.**
- CONTEXT covers section and subsection headings, table header rows and lead-in sentences. M0417 (the references heading) and M0418 (verify installed versions, covered by DLV-004 and S16-009) are also CONTEXT.
- NON-REQUIREMENT covers M0001 (title), M0002 (version stamp) and M0419–M0423 (the reference list).

**Other notes.**
- No SOURCE rows were created and no playbook content was invented.
- Nothing describes the playbook or the product as an official PMI standard.

## 3. Checks actually run

All checks ran on Node v22.22.2 and Python 3.11 in the build container.

**Self-check.** `python3 <scratchpad>/selfcheck.py`, run from the repository root:
```
1. coverage rows: 242 | exact expected set: True | duplicates: 0
   REQUIREMENT rows referencing unknown/non-citing reqs: none
   dispositions: {'NON-REQUIREMENT': 7, 'REQUIREMENT': 211, 'CONTEXT': 24}
   reverse consistency (req cites block in my range but block row omits req): none
   my rows citing blocks outside my range: none
2. A01-A28 referenced by my rows: 28 missing: none
3. IMPLEMENTED rows: 17 | evidence paths checked: 72 | missing: none
   empty mandatory cells: none | multi-line fields: 0
4. rows: 161
   by area: {'DLV': 41, 'S14': 4, 'S15': 14, 'S16': 33, 'S17': 11, 'S18': 4, 'S19': 19, 'S20': 31, 'S21': 4}
   by class: {'ENGINEERING': 107, 'USER': 54}
   by final_gate: {'DG0': 19, 'DG1': 11, 'DG2': 2, 'DG3': 2, 'DG4': 17, 'DG5': 19, 'DG6': 40, 'DG7': 51}
   by status: {'IMPLEMENTED': 17, 'SPECIFIED': 144}
   ref additions: {'REQ-PB-086': 5, 'REQ-PB-087': 1, 'REQ-PB-091': 27, 'REQ-PB-092': 1, 'REQ-PB-088': 7, 'REQ-PB-089': 1, 'REQ-PB-090': 1}
```
The first self-check run found M0045 marked CONTEXT while REQ-DLV-016 cited it. I fixed it (M0045 is now REQUIREMENT) and re-ran; the output above is from the second run.

**Dry merge and register validation.** This ran in a disposable copy (`git archive HEAD` into the scratchpad, plus all current part files, including AN-02's `req-s01-s13.csv`, `mp-coverage-s01-s13.csv` and `ref-additions-an02.csv`, plus `docs/delivery/runs`). It did not write to the repository.

Commands: `python3 tools/source/merge_register.py` and `node tools/gates/validate.mjs --register DG0`.
```
merged 421 requirements {'PB': 92, 'DLV': 41, 'S01': 6, ... 'S13': 13, 'S14': 4, 'S15': 14, 'S16': 33, 'S17': 11, 'S18': 4, 'S19': 19, 'S20': 31, 'S21': 4}; 423 master-prompt coverage rows
merge_exit=0
validate_exit=1
FAIL register rules at DG0 (4 problems)
  - requirements.csv REQ-DLV-020: final gate DG0 requires IMPLEMENTED at DG0 (is SPECIFIED)
  - requirements.csv REQ-DLV-020: IMPLEMENTED for DG0 without evidence
  - requirements.csv REQ-DLV-032: final gate DG0 requires IMPLEMENTED at DG0 (is SPECIFIED)
  - requirements.csv REQ-DLV-032: IMPLEMENTED for DG0 without evidence
```
- There are no ID or block collisions with AN-02.
- The four failures are the intended, honest SPECIFIED status of DLV-020 and DLV-032 (see gap 1).

**Test suites.** Run in the same disposable copy to back the IMPLEMENTED claims:
- `node --test tools/gates/tests/*.test.mjs`: tests 15, pass 15, fail 0, exit 0.
- `node --test tools/agents/tests/*.test.mjs`: tests 8, pass 8, fail 0.

## 4. Known gaps / not done

1. **REQ-DLV-020 and REQ-DLV-032 must be switched to IMPLEMENTED before the DG0 register check can pass.** Until then, `validate.mjs --register DG0` fails on these two rows.
   - DLV-020 depends on `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv`, which AN-04 produces. After the merge, set `status=IMPLEMENTED` and `evidence=docs/delivery/requirements.csv;docs/analysis/source-coverage.csv;docs/analysis/master-prompt-coverage.csv;tools/source/merge_register.py`.
   - DLV-032 also depends on AN-02's user-journey output. Set its evidence to the paths in its `notes`, plus the journeys file AN-02 names.
   - I didn't mark either one IMPLEMENTED, because the evidence doesn't exist yet.
2. **The acceptance map and the stage plan cover only REQ-PB and the AN-03 areas.** S01–S13 IDs (AN-02) are not in the "proves" lists or the per-stage ID ranges. Both documents say so. AN-04, or a follow-up analyst task, must add the S01–S13 IDs after merging.
3. **Interpretations I made, labelled in the rows:**
   - WCAG 4.5:1 and 3:1 thresholds for "adequate contrast" (S15-003).
   - Retention periods are placeholders to agree with IT (S16-024).
   - The placement of each A01–A22 at its product gate follows my reading of §21. A01 is at DG6 because it needs P5 outputs; A02 is at DG5 because report generation arrives in P5.
   - A26 is first delivered in P1 (the first controlled defect drill on product code).
   - Reviewers should challenge these placements if they disagree.
4. **A23 and A27** have validator-level tests from P0 but stay SPECIFIED with final gate DG7. They can only complete once all eight gates have evidence.
5. **The AN-02 and AN-03 runs shared one working tree** rather than separate worktrees. The part files are disjoint and the dry merge shows no conflict. The orchestrator may still want to record this against REQ-DLV-008.
6. **`docs/delivery/progress.md` shows as modified in `git status`.** That wasn't me; it was outside my scope.

## 5. Merge instructions

- Run `python3 tools/source/merge_register.py` from the repository root. It picks up `req-*.csv`, `mp-coverage-*.csv` and `ref-additions-*.csv`. No ordering constraints apply, and no conflicts are expected (verified in the dry merge).
- After merging, apply gap 1, then run `node tools/gates/validate.mjs --register DG0`. With gap 1 fixed, the dry run suggests it will pass, assuming AN-02's parts don't change.
- There are no migrations and no code changes.
