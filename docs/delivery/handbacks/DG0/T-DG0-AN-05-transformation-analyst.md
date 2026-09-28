# Handback T-DG0-AN-05: transformation-analyst

- **Stage:** P0 / DG0 (FIXING).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG0-T-DG0-AN-05-transformation-analyst-20260928T125344Z-bc9a9eb7","session_id":"bc9a9eb7-addc-45d8-93d2-426c3e419546"}`
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-05.md`.
- **Starting revision: NOT VERIFIED.** Every Bash call in this session failed because the permission classifier returned no verdict (an infrastructure outage). So I could not run `git rev-parse HEAD`, `git status` or `sha256sum` on the assignment. I did the work with the Read/Edit tools only.

**Status: the edits are complete, but the required checks are BLOCKED** (section 3). The orchestrator must run the merge and the register validation before treating this task as done.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/parts/req-pb.csv` | Splits REQ-PB-049 (DG3) and adds REQ-PB-093 (DG5). REQ-PB-020 gets the G5 approver and an acceptance case. The notes of every SOURCE row are rewritten into "Playbook (B…) / Master-prompt additions / Interpretations". Existing lines keep CRLF; the new REQ-PB-093 line was added through the Edit tool and may end in LF (the merge reads mixed endings). |
| `docs/analysis/parts/req-s01-s13.csv` | REQ-S04-003..006 gain invalid-approval acceptance. REQ-S04-007 gets the G5 approver. REQ-S09-005 gets a dependency note. REQ-S12-020 and REQ-S12-021 move from P4;P5;P6/DG6 to P4;P5/DG5. |
| `docs/analysis/parts/req-dlv-s14-s21.csv` | Replaces the directory evidence entries of REQ-DLV-026 and REQ-DLV-032 with regular files (addendum). |
| `docs/analysis/parts/mp-coverage-s01-s13.csv` | M0176 now lists REQ-PB-093. The M0175 rationale mentions the split. |
| `docs/analysis/source-coverage.csv` | B0077 now lists REQ-PB-049 and REQ-PB-093. |
| `docs/analysis/permissions-matrix.md` | SP has Rv on the TOM row. Adds the T11 "Go-live / scale" row. Updates the BO gate-decision cell and rule 7. Adds a role-mapping assumption and a revision note. |
| `docs/analysis/glossary.md` | Fixes Journey and Modular mode, and nine further terms, with a revision table. |
| `docs/analysis/stage-plan.md` | Regenerated DG3/DG5/DG6 lists and counts. Adds "executable acceptance tests" bullets per stage (P1–P7), the "Executable acceptance-test ownership" table and the "§21 evidence recheck" table. |
| `docs/analysis/acceptance-map.md` | Updated proves lists for A05, A06 and A07. A07 is first delivered in P3. Adds the AN-05 note on authorship, pointing to the stage plan. |
| `docs/analysis/field-inventory.md` | T06 heading and weight row reference REQ-PB-049/093. The 100% rule is relabelled as master prompt M0176. |
| `docs/analysis/user-journeys.md` | J2.5: adds the initiative-level T11 go-live step 5a and the G5 approver. J2.4 step 4 names the weight-set versions. Two stale IDs corrected (REQ-S05-004 → REQ-PB-042; REQ-S13-013 → REQ-S13-012). |
| `docs/analysis/README.md` | Counts updated. Adds the AN-05 repair section. |
| `docs/delivery/requirements.csv`, `docs/analysis/master-prompt-coverage.csv` | **Not regenerated.** The merge could not run (section 3). |

## 2. Behaviour delivered, per finding

### F-DG0-001 (REQ-PB-049)
- **REQ-PB-049 now completes at P3 / DG3.** It covers:
  - per-transformation weight sets, with a risk/compliance criterion;
  - the 100% total check (acceptance: 95% or 105% rejected);
  - immutable weight-set versions referenced by every score;
  - acceptance naming REQ-S09-005's "weight version 2". It cites A01, A05 and A07.
- **New REQ-PB-093, P5 / DG5.** Cites B0077 and M0176. It covers administrator-configured default weights and rubrics in Playbook Studio: draft and publish, the 100% check on defaults, new transformations inherit the default, and existing ones stay pinned. It cites A06 and A07.
- Updated to match: the coverage rows (B0077, M0176), stage-plan lists and counts, the acceptance map, the field inventory and the README.

**§21 recheck of M0403–M0410.** The full table is in `stage-plan.md`, "§21 evidence recheck". Besides F-DG0-001 it found two mismatches, both fixed:
1. **DG2 "missing evidence/invalid approval blocked" (M0405).** No DG2-final row proved that invalid approvals are rejected: REQ-S10-016/017 and REQ-PB-015 are DG4, and REQ-PB-022 is DG3. REQ-S04-003/004/005 (DG2) now require that a gate decision by a non-approver or by the submitter returns 403, and a decision on a superseded version returns 409. I added the same to REQ-S04-006 (DG3) for the DG3 "executable approval flow". The general framework rows stay at DG4, and a note says so.
2. **DG5 "durable rule retries" (M0408).** REQ-S12-020 (durable jobs, bounded retries) and REQ-S12-021 (no duplicate side effects) were DG6, although REQ-S12-002 (DG5) and the clause depend on them. Both are now P4;P5 / DG5, and P6 re-runs A13.

The DG0, DG1, DG4, DG6 and DG7 clauses matched and needed no change.

### F-DG0-002 (G5 approver)
- **Choice:** G5 is approved by SP by default, configurable to BO per T11 "Go-live / scale".
- **Justification from the playbook:**
  - B0023 gives each gate's question and evidence, but no approver.
  - B0018 gives the Sponsor "approves major trade-offs".
  - B0099 names the Business owner as approver of "Go-live / scale".

  This mirrors the existing treatment of G3 in REQ-PB-018 ("Target-state design").
- **Transformation level vs initiative level:** I also documented that G5 is the transformation-level gate. T11 go-live/scale decisions on individual initiatives are separate records that feed G5's decision-log evidence, and neither one approves the other.
- **Where it is now consistent:**
  - REQ-PB-020: permissions, plus an acceptance case (with BO configured, SP gets 403 and BO succeeds);
  - REQ-PB-015 and REQ-PB-018 notes;
  - REQ-S04-007: permissions and note;
  - the permissions matrix: new T11 "Go-live / scale" row (Recommend: initiative owner; Approve: BO; Consult: Risk via TO / Tech via TD; Inform: SteerCo as CM), the gate-decision BO cell, rule 7, and SP Rv on the TOM row (RACI C);
  - user journeys J2.5 and the role summary.

### F-DG0-003 (SOURCE notes)
- **All 93 PB rows checked.**
  - 90 rows now use the explicit form "Playbook (B…): … Master-prompt additions (§/M…): … Interpretations: …".
  - PB-042, PB-058 and PB-069 already separated their content (the reviewer's model rows). I kept them.
- **The rows the finding cited:**
  - PB-085 now names the §12 M0227 addition.
  - PB-055 labels the "before G4" hard block as an interpretation.
  - PB-088 names the §18 M0348 production-without-demo addition.
- **Other corrections:** several rows had called master-prompt content an "interpretation". For example, PB-048's formula and missing-means-incomplete rule come from M0176, which is now stated.

### F-DG0-005 (glossary)
- **Journey:** now الرحلة (رحلة العميل أو رحلة العمل).
- **Modular mode:** now النمط الجزئي المرن (الدخول عند المرحلة المناسبة).
- **Re-scan of the whole glossary:** nine more terms changed. They were narrower than the English, or ambiguous: Business Owner, Champion, Define, Mobilize, Scope sanity check, Attach rate, Sprint, SLA and Recovery plan.
- The revision table in `glossary.md` gives each term's reason.
- The terms remain proposals, pending review by a Mobily Arabic-language owner.

### F-DG0-203 (A-test ownership)
- **`stage-plan.md`:**
  - a rule stating that each scenario test is authored test-first before freeze, in its first-delivered stage, by qa-verifier, with the implementers' unit and integration tests joining the suite;
  - per-stage bullets P1–P7 naming the scenarios, authors and must-pass gates;
  - a 28-row ownership table.
- **P6 now "extends and re-runs"** the suites. Only A17, and the first A19 drill, originate there.
- **`acceptance-map.md` is aligned:** A07 is first delivered in P3, because of REQ-PB-049 and REQ-S09-005 at DG3, and the authorship note points to the table.
- **Consistency rule:** no scenario is first authored after its must-pass gate. I checked this by hand against the table, not with a script.

### Addendum (directory evidence)
- **REQ-DLV-026:** `docs/delivery/runs/DG0` replaced by `tools/gates/tests/validator.test.mjs`. The row keeps `run-agent.sh`, `agents.md` and `rules.mjs`.
- **REQ-DLV-032:**
  - `.claude/agents` became the ten `.claude/agents/<name>.md` files;
  - the `agent-load` directories and `runs/DG0` became `docs/delivery/agents.md` plus `tools/agents/run-agent.sh`.
- **File existence: not verified with a command.** Every replacement path is already cited as evidence by rows that passed validation in AN-04 (REQ-DLV-004 and REQ-DLV-006), except `tools/gates/tests/validator.test.mjs`, which REQ-DLV-013/016 cite.

## 3. Checks actually run

| Check | Result |
|---|---|
| `python3 tools/source/merge_register.py` | **BLOCKED.** Bash was unavailable: the classifier gave no verdict, and the tool refused to run. |
| `node tools/gates/validate.mjs --register DG0` | **BLOCKED**, same reason. |
| `git rev-parse HEAD` / `git status` / the assignment SHA-256 | **BLOCKED**, same reason. |
| Manual review of CSV syntax | Done by reading. I checked quoting and the 19-column count of every new or changed row (PB-049, PB-093, PB-020, S04-003..007, S09-005, S12-020/021, DLV-026/032). I found and fixed one error: a comma I had introduced into the unquoted M0175 rationale in `mp-coverage-s01-s13.csv`. This is not a substitute for running the merge. |

One side note: I made a mistaken Write attempt to `docs/scratch-unused.txt`. The write guard **blocked** it, and no file was created.

## 4. Known gaps / not done

1. **The merge and the register validation have not run.**
   - `docs/delivery/requirements.csv` and `master-prompt-coverage.csv` still reflect AN-04.
   - The expected merge output is 411 requirements (PB 93) and 423 master-prompt coverage rows.
   - The expected final-gate counts are DG0 19, DG1 11, DG2 32, DG3 32, DG4 137, DG5 78, DG6 48, DG7 54.
   - The counts in `README.md` and `stage-plan.md` were computed by hand from these changes and must be confirmed against the merged register.
2. **Ref-additions: resolved.** I read the ref-additions files. `ref-additions-an02.csv` adds only M0176 to REQ-PB-049, which is already in its `source_ref`, and `ref-additions-an03.csv` doesn't touch PB-049. REQ-PB-093 therefore cites exactly B0077 and M0176, and both coverage rows list it.
3. **Moving REQ-S12-020/021 to DG5 is my reading of "durable rule retries".** A reviewer may prefer a split instead.
4. **The Arabic terms are still unreviewed proposals.**
5. **Not committed.** The orchestrator commits.

## 5. Merge instructions

Run the following in order:

1. `python3 tools/source/merge_register.py`
2. `node tools/gates/validate.mjs --register DG0`

If the merge reports a cell-count problem, the likely places are the edited rows listed in section 3. There are no migrations and no code. None of the edited files are in the orchestrator's parallel scope (`tools/**`, `requirements-spec.md`).
