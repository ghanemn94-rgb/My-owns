# Handback T-DG5-AN-P5C (transformation-analyst): the last 8 DG5-final rows

- **Stage:** P5 / DG5 (BUILDING).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-AN-P5C.md`. Its sha256 `c610678b…d06b` matched the value I was given.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-AN-P5C-transformation-analyst-20261017T184134Z-30603ecb","session_id":"30603ecb-1c27-4a7d-abbe-682642edb7ce"}`.
- **Base:** branch `dg5/an-p5c`, `HEAD` = `b4635521e9054deef117ce8f650c65f2ecfc37d7` (D-168). The tree was clean apart from untracked sandbox mount points (`.bashrc`, `.mcp.json`, …), which are not mine.
- **Time:** started `2026-10-17T18:41:49Z`, finished `2026-10-17T18:50:09Z` (`date -u` after the final `--register DG5` re-run). That is well inside the limit, and every row was reached.
- **Two gate systems:** nothing here grants a business, Finance or IT approval. Product gates G1–G6 and engineering gates DG0–DG7 stay separate.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited **0**.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | My 8 rows only. Each row's `status` is now IMPLEMENTED, its `evidence` is filled in (for REQ-S12-026, 3 paths are added to the existing ones), and one "DG5 analyst check (T-DG5-AN-P5C, base b463552): …" sentence is added to `notes`. The existing notes are kept. |
| `docs/delivery/handbacks/DG5/T-DG5-AN-P5C-transformation-analyst.md` | This handback. |

I wrote no `docs/analysis/**` note and changed no other row. The changes are **uncommitted**.

## 2. Rows, acceptance clauses and the tests that assert them

I opened every test cited below and checked its assertions against the acceptance clause.

| Row | Acceptance clause | Test that asserts it | Disclosed |
|---|---|---|---|
| REQ-PB-089 | A01;A15: every demo record and exported demo report shows the illustrative label in en and ar | **Exports:** `tests/qa/integration/a15-demo-transformation-outputs.test.ts`, describe "REQ-PB-089". It asserts that every snapshot records `synthetic`, and that every format of every demo output (54 files) prints the label in en and ar. It passes in D-167 and in BE-T5B batch 1, so the QA-C gap D2 is closed. **Records on screen:** `e2e/a02-demo-labels.spec.ts` runs on a real demo stack in en and ar. It asserts the badge in record headers, in the edit-form header and in a create-dialog header, and the label in a DOCX the worker generates. Result 6/6 (`FE-D5-evidence/e2e-a02-demo-labels-B.log`). `FormHeaders.test.tsx` covers every shared dialog and form header. | These runs are the W22 tasks' own (D-164). The merged-tree run of `8c68a47` is still pending. |
| REQ-PB-090 | A01: the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift' | `apps/api/test/integration/environment/demo-traceability-chains.test.ts` (BE-T6, D-168 (1)). It seeds the real demo dataset, signs in the demo TL and calls `getTraceability`, the operation the web view calls (`useTraceGraph` in `apps/web/src/pages/traceability/api.ts`). It asserts the literal line and the other two B0147 lines, both downstream from the issue and in the whole graph. Result 74/74 (`BE-T6-evidence/first-try.log`). The control with `outcome_kpi_id = null` fails all three chains. | The test checks the API response the view renders. No e2e checks the rendered screen. BE-T6's wording point (`roaming.ts` ~667: an outcome statement repeats its outcome KPI's text, outside the line) is left for the review. |
| REQ-S06-003 | A01;A06: the ten procedures exist after initialization and each can be launched and completed in the A02 scenario | `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` covers all three parts: "the ten procedures exist as published definitions after initialization" (it checks that `missing` is empty), "each … can be launched", and "drives every instance … every one ends completed" (10 results, none other than `completed`). Result 13/13 in `BE-T5-evidence/integration-batch1-scope-B.log`, after the Rule A repair (D-167/D-168). That closes D-QA-E-2, the D-167 failure. `adopted-step-authorization.test.ts` pins the Rule A refusals. | Only BE-T5B's own run so far. The merged-tree run is pending. |
| REQ-S12-012 | A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic | `tests/qa/integration/a13-dependency-slip-rule-b.test.ts` runs through the public API. It asserts: one critical 5-day slip; the affected initiatives and their owners; Rule B (dependents with no slack move by 5 days, directly and transitively; a dependent with slack does not move; one with no date stays Unknown); one `dependency_slip` work item and one reminder per distinct affected owner, and nothing for the predecessor's owner. Result 8/8, **unchanged**, in BE-T5B batch 1, because `dependency.slipped` v1 is now registered (D-QA-F2-1 closed). `dependency-slip-relay.test.ts` shows the real relay publishing on the first attempt and starter 9 succeeding once. | Only the interrupted BE-T5 run executed the relay negative control. The merged-tree run is pending. |
| REQ-S12-026 | A08;A13: saving a rule with action 'approve gate' is rejected; all automatic preparation and reminder rules run | **Refusal:** A13D in `a13-durable-automation.test.ts` gets 422 `automation_rule.human_only_action` (M3 killed). **"All … run":** all 16 starters now run. 1–3, 5–8, 10–12, 14 (scheduled triggers) and 16 run in `a13-starters-run`. 4 and 13 run in worker `starters.test.ts`. 15 and 14's request trigger run in `starters-be-j`. 9 runs in `dependency-slip-relay` and `a13-dependency-slip-rule-b`. This closes the AN-P5B gap. | Starters 4, 13, 15 and 14's request trigger run only in the implementers' integration tests (real engine), not in a QA suite (QA-F2 `STARTERS_ELSEWHERE`). |
| REQ-S18-001 | A22;A01: running the reset twice yields identical record counts and checksums; every demo screen, record and export shows the synthetic label in en and ar | **Reset:** `tests/qa/integration/a22-operational-readiness.test.ts` (A22I) uses the built CLI: it seeds, resets twice, and asserts identical counts and a checksum equal to the seed's. Result 8/8 in D-167 and in BE-T5B batch 5. `packages/db/test/integration/demo.test.ts` checks the same through the CLI. **Labels:** `e2e/a02-demo-labels.spec.ts` asserts the banner on every visited screen and the badge in record, form and dialog headers (D-QA-E2-1 closed by FE-D5B), plus the export label, in en and ar (6/6). The production negatives are in `fed5-demo-form-badge` and `p5-reader-branding-demo` (FE-D5B, 80/80). | W22 runs only. The merged-tree run is pending. |
| REQ-S18-002 | A01;A02: a seed-coverage test finds at least one record for each of T01–T16, G1–G6, … pending approval | `packages/db/test/integration/demo-roaming.test.ts`, "REQ-S18-002: the seed-coverage check". Every ADR-0050 §5 condition (each listed item) is ≥ 1, with `coverage_complete`. `a02-a21-complete-lifecycle` checks the same through `GET /admin/environment`. `demo-pending-approval.test.ts` (4/4) shows the seeded pending approval in `roaming.user.bo`'s inbox, where it can be read and decided, which closes QA-E2 O-1. | The merged-tree run is pending. |
| REQ-S21-001 | A28;A22: a text scan of UI strings and export templates finds no DG0-DG7 references; demo G-approvals display 'Synthetic demonstration - approves nothing real' | **Scan:** `tests/qa/unit/a22-s21-001-text-scan.test.ts` (A22U, an independent scanner) finds 0 hits in the en/ar catalogues, the web string and JSX text, and the export templates (M6 killed). It passes in the D-167 unit run (`unit-unset.log` line 74). **Label:** `e2e/a02-demo-labels.spec.ts` asserts the exact en and ar text on all six G-gate pages and on the Finance queue (M5 killed, 6/6). | The gate-snapshot note that names DG0–DG7 is API data that no screen or export renders (QA-F P-3, accepted in D-167). No e2e opens an approval from the inbox and checks its label. |

**Clauses left to a later gate:** none. Every row has `final_gate` DG5, and each DG5 acceptance is met by the tests above.

## 3. Checks actually run (base `b463552`, this worktree)

| Command | Exit | Output |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` |
| `node tools/gates/validate.mjs --register DG5` | 0 | `PASS register rules at DG5` |
| `node tools/gates/validate.mjs --register DG4` | 0 | `PASS register rules at DG4` |
| `node tools/gates/validate.mjs --register DG3` | 0 | `PASS register rules at DG3` |
| `node tools/gates/validate.mjs --register DG2` | 0 | `PASS register rules at DG2` |
| `python3 $TMPDIR/check.py` (CSV integrity, my rows only, evidence exists) | 0 | Output below |
| a `git ls-files` script over all 93 distinct evidence paths | 0 | `distinct paths 93 untracked: []` |
| `git diff --stat` | 0 | `docs/delivery/requirements.csv | 16 ++++++++--------`, 1 file (before this handback was added) |

```
[1] CSV parses: 412 data rows, 19 columns, rows with other column count: [], re-serialization identical: True
[2] same req_id set as HEAD: True, same order: True
[3] rows differing from HEAD (b463552): ['REQ-PB-089', 'REQ-PB-090', 'REQ-S06-003', 'REQ-S12-012', 'REQ-S12-026', 'REQ-S18-001', 'REQ-S18-002', 'REQ-S21-001']; only mine: True
    REQ-PB-089: changed columns ['status', 'evidence', 'notes']; protected columns changed: []; old notes kept as prefix: True
    (the same line for each of the other seven rows)
[4] evidence paths:
    REQ-PB-089 18, REQ-PB-090 12, REQ-S06-003 15, REQ-S12-012 15, REQ-S12-026 14, REQ-S18-001 29, REQ-S18-002 15, REQ-S21-001 14 (all IMPLEMENTED, final_gate DG5)
    total 132 paths, missing or not a regular file: []
```

**Not run by me.** I ran no product tests. The pass counts I cite come from the logs named above (the W22 `-B` logs, BE-T6's logs and the D-167 run), which I read.

## 4. Gaps and caveats

- **No row left SPECIFIED, so no real gap.** REQ-PB-090 is evidenced by BE-T6's literal-line test (D-168 (1)). REQ-S12-026 is evidenced now that D-QA-F2-1 is closed.
- **Main caveat: the merged-tree run hasn't happened yet.** For REQ-S06-003, REQ-S12-012, REQ-S12-026's starter 9, REQ-PB-089 and REQ-S18-001's form/dialog badge, and REQ-S18-002's pending approval, the passing runs are the W22 tasks' own runs on their branches (D-164 scope). The orchestrator's merged-tree verification of `8c68a47` is not in the tree yet. The D-167 merged-tree log still shows the pre-W22 failures for REQ-S06-003 and REQ-S12-012, so I did not cite that log for those two rows. **If the final verification fails in one of these areas, the matching row must go back to SPECIFIED** (the D-168 trigger).
- **Partial coverage, disclosed in `notes`:**
  - REQ-PB-090: checked at the API level, not by a screen e2e.
  - REQ-S12-026: starters 4, 13, 15 and 14's request trigger are not run by a QA suite.
  - REQ-S21-001: the inbox-opened approval label has no e2e, and the gate-snapshot note is API-only (P-3).
  - REQ-S12-012: the relay negative control has not been re-run.

## 5. Merge instructions

- Only `docs/delivery/requirements.csv` (8 rows) and this handback change. There are no migrations.
- No conflicts are expected: AN-P5A and AN-P5B's rows are untouched, and ARCH-R3 writes only `docs/architecture/**`.
