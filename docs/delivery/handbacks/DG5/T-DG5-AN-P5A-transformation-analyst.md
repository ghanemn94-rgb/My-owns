# Handback T-DG5-AN-P5A (transformation-analyst): DG5 register update, half A

- **Stage:** P5 / DG5 (BUILDING). This is an engineering register update. It grants no business, Finance or IT approval, and product gate G6 implies nothing about DG7.
- **Invocation:** `DG5-T-DG5-AN-P5A-transformation-analyst-20261017T170051Z-01735704`, session `01735704-5f94-47cc-8ba9-3ba7b93855d8`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-AN-P5A.md`, sha256 `2c25ccecf36ec571fad2f3562ae4b30264b5c81148453c84e545401b6412687f` (checked).
- **Working tree and base:** `/home/user/wt/dg5-an-p5a`, branch `dg5/an-p5a`, `HEAD` = `f78afff972069b59b5df9ad0d200c967070d3e10` (D-167). The tree was clean apart from untracked sandbox dotfiles, which I did not touch.
- **Time:** started 2026-10-17T17:01:12Z. Finished at 17:15:14Z (`date -u`), well inside the limit. Every row was reached.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | My 36 rows only. 35 are set to IMPLEMENTED with evidence. All 36 get the "DG5 analyst check" sentence appended to `notes`. REQ-PB-090 stays SPECIFIED as a real gap (§4). |
| `docs/delivery/handbacks/DG5/T-DG5-AN-P5A-transformation-analyst.md` | This handback. |

Nothing else changed: no `docs/analysis/**` note, no other row, no held row and no later-gate row.

**Later-gate rows with a P5 increment.** I added **no** "P5 increment delivered" pointer. The assignment allows one only where a P5 handback or QA handback names that increment. I grepped every DG5 handback and every QA authoring handback for the 52 later-gate rows with a P5 increment. None names any of them by requirement ID; the only REQ-S20 IDs they mention are DG5 rows (S20-002, S20-006, S20-007, S20-015, S20-016). So the condition is not met for any row.

## 2. Preceding gate

```
$ node tools/gates/validate.mjs --historical --stage DG4
PASS gate DG4 (historical)
EXIT=0
```

## 3. Rows changed: acceptance clause → the test that asserts it

I opened every cited test and checked its assertions against the acceptance clause. The orchestrator's merged-tree runs used as evidence are as follows:

- **Integration:** `orchestrator-D-167/verify-w21-7305433/integration.log`: 3011 passed, 1 skipped, 3 failed. The three failures are REQ-S06-003 (held), REQ-S12-012 (held) and the A13 export-job kill test (D-QA-F2-3, the other half's row). None is my row.
- **e2e:** `orchestrator-D-166/verify-w20-c4f7fcf/e2e-root.log` and `e2e-root-demo.log`. W21's e2e is not recorded yet; it comes with W22's verification (D-167).
- **HEAD vs the verified commit:** `git diff --stat 7305433 HEAD` shows only verification logs, so the code is identical to the verified commit.

| Row | Acceptance clause (abridged) | Asserting test(s) | Coverage notes |
|---|---|---|---|
| REQ-PB-001 | B0004 verbatim on reader / About / report footer; scan of UI strings (en+ar) and report templates finds no official-PMI / certified claim | `reader-search-provenance.test.ts` (textEn = B0004); `feg.test.tsx`, `p5-reader-branding-demo.spec.ts` (reader, About); `a15-outputs-every-definition.test.ts` (B0004 in every format, en/ar); `text-scan/ui-strings.test.ts`, `text-scan/export-templates.test.ts` | QA-C D1 (B0004 missing from XLSX/CSV) was repaired by BE-N2 (D-164). The Arabic text still needs linguistic review. |
| REQ-PB-002 | B0158–B0162 elements return provenance=custom-extension; badge en/ar; none labelled PMI standard | `reader-search-provenance.test.ts` (50 rows); `feg.test.tsx`; `p5-reader-branding-demo.spec.ts` | The Studio badge shows a draft's override only after publication (D-164 i, a recorded limitation). |
| REQ-PB-011 | four questions verbatim (en) with ar; each template exactly one tag | `reader-search-provenance.test.ts`; `feg.test.tsx`; `extension-fields.test.tsx` (form headers) | The mapping is still the analyst default. |
| REQ-PB-077 | Realize shows the BRM alignment, no certified/official wording | `reader-search-provenance.test.ts` (`realizeNote`); `ui-strings.test.ts` | — |
| REQ-PB-086 | start 2026-10-01 → Days 31–60 tasks in Nov 2026; all B0134 actions | `a16-launch-plan.test.ts`; `e2e/a16-health-launch.spec.ts` (en and ar pass in D-166) | QA-D mutation M4 killed. |
| REQ-PB-087 | six questions verbatim; unanswered → incomplete | `a16-launch-plan.test.ts` (0/6, 5/6 refused, 6/6 completes); `fef.test.tsx` (screen, en/ar) | The Day-90 screen has a component test only, no root e2e. |
| REQ-PB-088 | North Star verbatim; production initialization has no demo records | `demo-roaming.test.ts`; `demo.test.ts` (REQ-S18-003 production path) | The demo labels belong to held row REQ-PB-089. |
| REQ-PB-091 | 25 questions verbatim; incomplete → no band; < 3 actions rejected | `a16-health-check.test.ts`; `e2e/a16-health-launch.spec.ts` | QA-D mutations M3 and M8b killed. |
| REQ-PB-092 | 21/16/10/9 → four B0152 band texts verbatim | `a16-health-check.test.ts`; `scoring.test.ts` | QA-D mutation M2 killed. |
| REQ-PB-093 | admin changes Feasibility rubric and weights 30/20/20/15/15 in the UI and publishes; new transformations get them; existing keep theirs; 95 % rejected | `scoring-defaults.test.ts`, `a06-configuration-change.test.ts`, `a07-historical-integrity.test.ts` (API); `p5-studio.spec.ts` (UI publish of scoring defaults); `studio.test.tsx` (UI entry of 30, decimal total) | **Partial in the browser:** the e2e changes one rubric descriptor only. The exact 30/20/20/15/15 entry in the UI is a component test, not an end-to-end run. Kept IMPLEMENTED because the integration tests cover the clause. |
| REQ-DLV-037 | A06/A07/A15/A16 pass on the DG5 candidate; exports inspected in both languages | a06 27/27, a07 12/12, a15 34/34, a16 30/30 in D-167; root e2e A06/A07/A15/A16 en+ar pass in D-166; `a15-outputs-every-definition.test.ts` (every format en/ar) | The run on the **frozen** candidate and A23 (independent reviews) are review-time checks, not yet done (the REQ-DLV-036 precedent). |
| REQ-S01-002 | name change → shell header en/ar and next report header, no code change; fresh install shows the default | `branding.test.ts` (version 0 default; "the next generated report carries the current branding", en/ar); `feg.test.tsx` and `p5-reader-branding-demo.spec.ts` (header) | QA-A tested the API part only. These implementer tests cover the shell-header and report-header clauses it left open. |
| REQ-S01-003 | coverage view links every seeded element; guided scenario runs input → … → sustainment on persisted records | `procedures/coverage.test.ts` (80 elements; unshipped → Planned); `a02-a21-complete-lifecycle.test.ts` (chain test) | The A01 suite itself is REQ-S20-001 (DG6). |
| REQ-S01-004 | A02 completes with exports, email and AI disabled; no completion condition needs an off-platform artefact | `a02-a21-complete-lifecycle.test.ts` (two A21 tests); `e2e/a21-no-ai-operation.spec.ts` (D-166 demo stack, en/ar) | QA-E O-3 (D-165): no adapters ship, so "disabled" is read as the shipped configuration. A real switch-off waits for the adapters (DG6). |
| REQ-S02-001 | report shows 2/6/6/16/10/5/6/3/1/25; deleting a template fails the check and blocks publish | `a06-configuration-change.test.ts`; `studio-review-publish.test.ts` (`source_incomplete`) | — |
| REQ-S02-004 | B0031 opens T01 register; T01 form links back | `playbook-blocks.test.ts`; `feg.test.tsx`; `p5-reader-branding-demo.spec.ts` | — |
| REQ-S03-007 | ADM sees 14 areas en/ar; WL no Administration; landing pages list §3 contents | `navigation/navigation.test.ts`; `p5-navigation.spec.ts` (en/ar); `p5-shell.spec.ts` | Uses D-163 option (a). FE-G's "partial" was closed by FE-G2. |
| REQ-S03-010 | "value pools" → Diagnose blocks; Launch on gate-review creates an instance | `reader-search-provenance.test.ts`; `p5-reader-branding-demo.spec.ts` | — |
| REQ-S04-011 | conditional G5 scoped to one region blocks another; no scope rejected | `workflows/gate-conditions.test.ts`; `gate-condition-escalation.test.ts` | Region = business unit. Under D-142 Q2 the switch is on for G5 in the shipped v1 and off for a new version. |
| REQ-S05-001 | T01 and T14: draft reopens, history, comment, attachment, export, recoverable conflict | `forms/form-framework.test.ts`; `forms/form-records.test.ts`; `p5-forms.spec.ts` | The BE-E2 bulk-edit gap was closed by BE-E3 (D-159 a). |
| REQ-S05-002 | T03 extension field publishes; deleting 'Gap' rejected | `form-schemas.test.ts`; `a06-configuration-change.test.ts`; `p5-forms.spec.ts` | — |
| REQ-S05-006 | twelve record types created/retrieved via API; extension badge en/ar | `form-schemas.test.ts` (badge exactly on twelve); `form-builder.test.tsx` (en/ar); `contract.test.ts` (every routed operation) | The twelve create/read operations are the DG2–DG4 ones. No single test creates all twelve in one place. |
| REQ-S06-001 | conditional + parallel step publishes and runs; missing trigger/completion rejected | `procedure-definitions.test.ts`; `procedure-instances.test.ts`; `a06-configuration-change.test.ts` | — |
| REQ-S06-002 | baseline-validation instance shows current step and assignee; completion creates a linked validated baseline | `procedure-instances.test.ts`; `a02-a21-complete-lifecycle.test.ts`; `p5-procedure-outputs.spec.ts` (FE-D4) | Assignee TL (0095). The UI output gap of D-166 was closed by FE-D4. QA-E2 mutations M1 and M2 killed. |
| REQ-S06-004 | in the UI: add T13 field, change a rule, change an approver; after publish, without deploy: field stored, rule refuses a previously accepted value, routed to the new approver | `e2e/a06-configuration-change.spec.ts` (en/ar pass in D-166); `a06-configuration-change.test.ts` | QA-A F-1 was repaired by BE-C3/C4, F-2 by FE-C2/C3. |
| REQ-S06-005 | 12 % → 0.12; decimal SAR; calculated field with unknown ref rejected | `form-schemas.test.ts`; `a06-configuration-change.test.ts`; `packages/shared/src/forms/*.test.ts` | — |
| REQ-S06-006 | relabel G3 ok; stable ID change, TOM dimension delete, ADM approver rejected | `studio-checks.test.ts`; `a06-configuration-change.test.ts` | QA-A mutations M3b and M5c killed. |
| REQ-S06-007 | publish without review rejected; edit published → 409; diff lists added field | `studio-review-publish.test.ts`; `a06-configuration-change.test.ts`; `studio-checks.test.ts` | — |
| REQ-S06-008 | existing transformation renders v1; migration preview lists the new required field and G2 re-approval; history unchanged | `methodology-migrations.test.ts`; `a06-configuration-change.test.ts`; `a07-historical-integrity.test.ts` | — |
| REQ-S06-009 | after rollback, records under the rolled-back version retrievable; audit shows the rollback | `studio-review-publish.test.ts`; `a07-historical-integrity.test.ts` | QA-B mutation M4 killed. |
| REQ-S06-010 | methodology admin publishes but 403 on funding approval; KPI owner updates actuals but not Studio | `studio-review-publish.test.ts`; `a06-configuration-change.test.ts`; `e2e/a04-kpi-update.spec.ts` (actuals, en/ar pass in D-166) | The actuals part comes from the A04 journey. QA-A did not re-test it. |
| REQ-S07-016 | prospective change leaves last quarter's RAG; restatement without authority rejected; issued Q1 report unchanged, reissue v2 | `a07-historical-integrity.test.ts`; `kpi-restatements/decisions.test.ts`; `e2e/a07-historical-integrity.spec.ts` | QA-B P-1 was repaired by KBE-D4 (D-166). QA-B mutation M6 killed. |
| REQ-S08-005 | revenue uplift preview shows SAR and 'Not computable' for missing ARPU | `kpi/formula-preview.test.ts`; `fef.test.tsx`; `p5-launch-health-kpi.spec.ts` | — |
| REQ-S08-019 | no discount rate → no NPV; 10 % fixture → expected NPV to 2 dp | `packages/shared/src/finance/metrics.test.ts` (−21.04 / −19.12); `benefits/financial-metrics.test.ts` | This is an extension; the playbook does not prescribe it. |
| REQ-S09-011 | executive pack's workstream section has the submitted text and current metrics, unedited | `reporting/owner-updates.test.ts` and `a02-a21-complete-lifecycle.test.ts` (metrics equal the DG4 workstream dashboard); `a15-snapshots-and-packs.test.ts` (PDF/DOCX/PPTX en/ar) | QA-C gap G1 is closed by the dashboard comparison. |

The full evidence lists are in each row's `evidence` column. They also cite the implementing modules and screens, the ADR-0039…0050 files under `docs/architecture/adr/`, the QA authoring handbacks and the orchestrator logs.

## 4. Rows NOT evidenced: real gap (orchestrator to repair)

**REQ-PB-090 (SOURCE, B0146/B0147/M0347): left SPECIFIED.**

- **Acceptance:** "A01: the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift'".
- **Actual:**
  - The demo chain is six nodes: `… -> Attach rate / activation -> Roaming attach rate -> Roaming revenue uplift`.
  - The outcome KPI is labelled with KBE-H's KPI definition name, "Roaming attach rate" (`packages/db/src/demo/data/kpis.ts`).
  - The benefit is labelled with its title, "Roaming revenue uplift" (`packages/db/src/demo/data/benefits.ts`).
- **Test:** `packages/db/test/integration/demo-roaming.test.ts` asserts only the first four B0147 labels verbatim and the last two against KBE-H's names. No test asserts the literal line in the traceability view, through the API or the screen.
- **Source of the gap:** BE-T's own handback marks it "partly met" (§5) and proposes a one-line fix in §6 item 1 (rename the KPI and benefit, and name the outcome KPI in the contribution). No decision from D-161 to D-167 takes up that item.
- **Repair needed:** apply the BE-T §6.1 fix, or record a decision accepting the six-node line, and add a test that asserts the literal string.

No other row lacks evidence. The partial-coverage points noted above (PB-093 browser path, PB-087 screen, S05-006 single test, S01-004 adapters, DLV-037 candidate run) do not leave a clause unproven at DG5.

## 5. Checks actually run (all in this tree, base `f78afff`)

**Register validator**

```
$ node tools/gates/validate.mjs --register DG5      EXIT=1
FAIL register rules at DG5 (86 problems)
  - requirements.csv REQ-PB-089: final gate DG5 requires IMPLEMENTED at DG5 (is SPECIFIED)
  - requirements.csv REQ-PB-089: IMPLEMENTED for DG5 without evidence
  - requirements.csv REQ-PB-090: final gate DG5 requires IMPLEMENTED at DG5 (is SPECIFIED)
  - requirements.csv REQ-PB-090: IMPLEMENTED for DG5 without evidence
  - requirements.csv REQ-S06-003: … (held)
  - requirements.csv REQ-S10-013 … REQ-S20-016: … (the other half's rows)
  - requirements.csv REQ-S21-001: final gate DG5 requires IMPLEMENTED at DG5 (is SPECIFIED)
  - requirements.csv REQ-S21-001: IMPLEMENTED for DG5 without evidence
$ node tools/gates/validate.mjs --register DG4      EXIT=0   PASS register rules at DG4
$ node tools/gates/validate.mjs --register DG3      EXIT=0   PASS register rules at DG3
$ node tools/gates/validate.mjs --register DG2      EXIT=0   PASS register rules at DG2
```

**Attribution of the DG5 failures** (script output, `[4]` below): 43 failing rows, 2 problems each (86 in total):

- 36 are the other half's DG5 rows;
- 6 are the held rows (REQ-PB-089, REQ-S06-003, REQ-S12-012, REQ-S18-001, REQ-S18-002, REQ-S21-001);
- 1 is mine: **REQ-PB-090**, the deliberate gap of §4.

None of my 35 IMPLEMENTED rows fails. DG5 can PASS only after half B, the held rows (AN-P5C) and the REQ-PB-090 repair.

**Integrity, scope and evidence script** (`python3 -I verify.py`, run from a scratch directory against `git show HEAD:docs/delivery/requirements.csv`), exit 0:

```
[1] CSV integrity: rows 412 (base 412 ) column counts {19} header unchanged True
    re-serialises byte-identical: True | strict parse: ok
[2] same req_id order: True
    rows changed: 36 | all mine: True | others changed: []
    columns changed outside status/evidence/notes: []
    notes where the existing text was not kept as prefix: []
    my rows by status: {'IMPLEMENTED': 35, 'SPECIFIED': 1} | SPECIFIED: ['REQ-PB-090']
    my rows with the DG5 analyst sentence: 36
    held rows untouched: True
[3] evidence paths checked: 397 missing: []
[4] validator DG5 failing rows: 43 | mine among them: ['REQ-PB-090'] | held among them: ['REQ-PB-089', 'REQ-S06-003', 'REQ-S12-012', 'REQ-S18-001', 'REQ-S18-002', 'REQ-S21-001']
    other-half DG5 rows: 36 | failing rows not in other half or held: ['REQ-PB-090']
```

The script compares `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate`, plus every other column except `status`, `evidence` and `notes`, and reports none changed. Every evidence entry is an existing regular file (`os.path.isfile`).

**`git diff --stat`** (before this handback was written):

```
 docs/delivery/requirements.csv | 72 +++++++++++++++++++++---------------------
 1 file changed, 36 insertions(+), 36 deletions(-)
```

After writing it, the only addition is this untracked handback file.

**Not run:** no product test suite. This task cites the orchestrator's merged-tree runs and does not re-run them. No e2e run exists yet for W21 (D-167); it comes with W22's verification.

## 6. Merge instructions

- The changes are uncommitted, as the assignment asks.
- Merge `requirements.csv` row by row with half B (T-DG5-AN-P5B). The halves touch disjoint rows, and this half touches no later-gate row, so no line conflicts.
- The held rows are unchanged, for AN-P5C.
- REQ-PB-090 needs the §4 repair, then a short analyst follow-up to set it IMPLEMENTED.
