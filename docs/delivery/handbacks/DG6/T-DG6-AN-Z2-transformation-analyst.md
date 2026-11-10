# Handback T-DG6-AN-Z2 (transformation-analyst): register rows after the round-3 repairs (F-DG6-260)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-AN-Z2-transformation-analyst-20261104T204654Z-5ce5c138","session_id":"5ce5c138-2192-4380-8baf-53c7783fb439"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-AN-Z2.md`, sha256 `f1e312e3c90b2b5d395fab17618aa5d597e2729ee6d079e2309dd8298324dc01` (verified with `sha256sum`; it matches the value given).
- **Base:** branch `dg6/an-z2`, `HEAD` `1dd5ebed9f9bf8c57a57825e0bbedea54278da4f`, clean working tree at the start. BE-Z4 was merged at `458402f81` and FE-Z2 at `dfad98851`.
- **Changes:** uncommitted, as the assignment asks.
- **Approvals:** none. This check grants no business, Finance or IT approval (G1–G6), and it implies no DG result. All the data it cites is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | `notes` and `evidence` of 13 DG6 rows (listed below). No status changed. No other column changed. |
| `docs/delivery/handbacks/DG6/T-DG6-AN-Z2-transformation-analyst.md` | This handback. |

No `docs/analysis/**` note was needed.

## 2. Method

**Stale clauses.** Where an earlier analyst check stated something the candidate no longer bears out (a suite failing or absent, a finding still OPEN, a run still to come), I removed or annotated that clause with a bracketed `[T-DG6-AN-Z2: …]` pointer. I did not delete it silently.

**New paragraph.** Each row named by the assignment gets a new paragraph headed `DG6 analyst check (T-DG6-AN-Z2, base 1dd5ebed9, …)`. It describes:

- the shipped behaviour;
- the test that asserts it;
- the log that shows it passing;
- the residuals.

**Evidence I read myself.** I opened every log cited below and confirmed that it shows the pass I claim. I did not rely on the handback summaries.

| Run | What it shows |
|---|---|
| Orchestrator final verification of `8b22cc095` (the product tree of round-3 candidate aa219bd2): `docs/delivery/test-evidence/DG6/orchestrator-final-8b22cc0/` | `summary.txt` and `e2e/summary.txt`: all steps exit 0.<br>`08-integration.log`: 416/416 files, 4212 passed, 1 skipped, 1 todo.<br>`e2e/root.log`: 288 passed and 18 skipped. All 18 skips are `a20-p6-axe` routes.<br>`e2e/demo.log`: 10 passed. |
| QA round 3: `docs/delivery/test-evidence/DG6/qa/round-3/` | `04c-tests-qa-alone.log`: 45/45 files, 437 tests, EXIT 0.<br>`05-e2e-root-unset.log`: 288 passed, EXIT 0. |
| BE-Z4 and BE-Z3 evidence | Logs listed per row in §3. |
| FE-Z2 evidence | Logs listed per row in §3.<br>I also viewed the screenshot `screenshots/ar/a17-exception-data-owner.png`. It shows «آخر خطأ: لم يستجب نظام المصدر.». |

**Merged tree.** The tree with BE-Z4 and FE-Z2 merged has no full integration or e2e run yet. Every row whose claims rest on BE-Z4 or FE-Z2 says so: the binding re-run is the orchestrator's freeze verification of the next candidate, and the final verification is the next review round.

## 3. Rows changed: clause, test, passing log

### REQ-S20-001 (F-DG6-260)

**Clause (A01):** "Six phases, six gates, T01–T16, charter, TOM canvas, business case, launch plan, health check and example mapped to working features."

**Tests:**
- `tests/qa/integration/a01-p6-source-coverage.test.ts` (11)
- `a01-one-source-of-truth-scorecard.test.ts` (2)
- `coverage.test.ts` (4)
- `source-coverage.test.ts` (8)

**Logs:**
- `orchestrator-final-8b22cc0/08-integration.log`: lines 2548, 2706, 2665 and 2489, all ✓.
- `qa/round-3/04c-tests-qa-alone.log`: lines 221 and 239.

**Correction:** the stale clause "QA-E's A01 run … not yet in this tree" is superseded. No residual.

### REQ-S20-012 (F-DG6-260)

**Clause (A12):** "Cross-transformation unauthorized … AI retrieval are denied."

**Tests:**
- `e2e/a12-p6-scope-isolation.spec.ts` A12-1 to A12-6, including A12-5 (assistant)
- `a12-p6-scope-isolation.test.ts` (26)
- `a12-cross-scope.test.ts` (14)

**Logs:**
- `orchestrator-final-8b22cc0/e2e/root.log`: A12-5 at lines 144 and 307.
- `qa/round-3/05-e2e-root-unset.log`: tests 9–14 and 162–167.
- `08-integration.log`: lines 186 and 2555.

**Correction:** the "partial: A12-5 still fails" clause is superseded. The launcher repair is BE-X5. No residual.

### REQ-S20-017 (F-DG6-260; FE-Z2 changed the A17 spec)

**Clause (A17):** "Invalid rows are isolated, duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error."

**Tests:**
- `a17-import-and-integration.test.ts` (10)
- `a17-s01-005-external-change.test.ts` (4)
- `e2e/a17-failing-connector-exception.spec.ts`
- five `e2e/a17-import-and-integration.spec.ts` tests

**Logs:**
- `08-integration.log`
- `04c`
- `e2e/root.log`
- `05-e2e-root-unset.log`, tests 21–26 and 174–179

**FE-Z2's new assertion:** in `a17-failing-connector-exception.spec.ts`, "Last error" is the catalogue text in the page language. It passes in en and ar in `T-DG6-FE-Z2-evidence/31-e2e-touched-product-specs.log` (54 passed, 0 failed, exit 0).

**Correction:** the "QA-A2-F1 unrepaired" clause is superseded. That defect was repaired by BE-X4 and BE-Y3, and F-DG6-100 and F-DG6-140 are CLOSED_VERIFIED. No residual.

### REQ-S20-022 (F-DG6-260; FE-Z2 changed `OperationsPages.tsx`)

**Clause (A22):** "Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated."

**Tests:**
- `a22-p6-operability.test.ts` (17)
- `a22-operational-readiness.test.ts` (8)
- `e2e/a22-p6-operability.spec.ts`
- `e2e/a22-operations-jobs.spec.ts`
- `p6-admin-screens.test.tsx` (44, FE-Z2)

**Logs:**
- `08-integration.log`: lines 461 and 830.
- `04c`
- `e2e/root.log`: lines 293 and 456.
- `05-e2e-root-unset.log`: tests 152, 153, 305 and 306.
- FE-Z2 `20-pnpm-test-locale-unset.log` and `21-pnpm-test-c-utf8.log`: exit 0.

**Correction:** the "QA-E's A22 extension not yet in this tree" clause is superseded. No residual.

### REQ-S10-002 (F-DG6-220, BE-Z4; BE-Z3)

**Clause (A12):** "a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant."

**Tests:**
- `apps/api/test/integration/access/sensitive-reach-registers.test.ts` (5; BE-Z4)
- `sensitive-reach-scenarios.test.ts` (7; BE-Z3)
- `sensitive-reach`, `-calculations`, `sensitive-reads`, `sensitivity`, `read-scope-parity`

**Logs:**
- BE-Z4 `int-registers-before-fix.log`: 4 failed, 1 passed.
- BE-Z4 `int-registers-run1.log`: 5/5.
- BE-Z4 `int-related.log`: 95 files, 906 tests, exit 0.
- BE-Z4 `int-final-touched.log`: 7 files, 81 tests, exit 0.
- BE-Z3 `new-test-before.log` and `new-test-after.log`.
- `08-integration.log`: lines 819, 1129, 1151, 1179, 2660 and 2731.

**Corrections:**
- Residual (1) on scenarios is removed as resolved by BE-Z3. The round-3 domain reviewer judged that rule correct and complete.
- Residual (2) on corrective cases, transition decisions and area links is removed as resolved by BE-Z4.
- "F-DG6-180 stays OPEN" is corrected: code-security closed it in round 3 (CLOSED_VERIFIED).

**Residuals still disclosed:**
- (a) As BE-Z4's handback says, other records still show a restricted case's id or code, but none of its values:
  - action-register rows show `correctiveCaseId` and the case code;
  - meeting actions and controls show `correctiveCaseId`;
  - controls also show `transitionDecisionId`.
- (b) Lists still filter after pagination. This now also covers the three new lists.
- (c) The FIN finance-validation rule is unchanged.

F-DG6-220 stays OPEN until a reviewer verifies it.

### REQ-S15-011 (F-DG6-222, FE-Z2)

**Clause (A14;A20):** "component tests render each of the six states; …" The finding concerns the error state.

**Tests:**
- `integrations.test.tsx` (23)
- `p6-admin-screens.test.tsx` (44)
- `assistant.test.tsx` (26)
- `apps/web/e2e/p6-secret-ref-unbound.spec.ts` (en and ar, real API)

**Logs:**
- FE-Z2 `20-` and `21-pnpm-test-*.log`: exit 0.
- FE-Z2 `30-e2e-secret-ref-run1.log`: 4 passed.
- FE-Z2 `31-e2e-touched-product-specs.log`: 54 passed.
- Screenshots: en and ar connector.

**Residual:** the three Arabic texts are provisional and await a Mobily language review.

### REQ-S15-007 (F-DG6-221, FE-Z2)

**Clause (A20;A15):** "… a validation error returned by the API is shown in the selected language …"

**Tests:**
- `p6-admin-screens.test.tsx` (`exceptionErrorText`, en and ar)
- the new "Last error" assertion in `e2e/a17-failing-connector-exception.spec.ts`

**Logs:**
- FE-Z2 logs 20, 21 and 31.
- The ar screenshot, which I viewed.

**Residual (real gap):** `problems-all.test.ts` reads field-error codes from string literals only. It missed the three SecretRef codes because the API emits them through constants. FE-Z2 suggested a fix but did not make it, so a future code emitted the same way would not be caught. Clause 3 is unchanged and still partly covered, as the earlier check says.

### REQ-DLV-038 (F-DG6-260 and F-DG6-261 are filed on this row; FE-Z2 repaired F-DG6-261)

**Clause:** "the applicable A01-A22 executable tests pass on the DG6 candidate …"

**Evidence:** the orchestrator's final verification of `8b22cc095` (`summary.txt` and `e2e/summary.txt`, all exit 0) is the first single green run of the A01–A22 set, e2e included, on one tree. Not part of it, as before: the Keycloak spec and the A18 clean-start check.

**F-DG6-261:**
- The failure: `07c-e2e-demo-cutf8.log`.
- The repair (`e2e/a02-demo-users-walkthrough.spec.ts` step 10):
  - The step is scoped to `form[data-form='generate-report']` with a strict locator.
  - The snapshot filter is renamed "Filter by output".
- FE-Z2 `32-probe-output-label-late-definitions.log`: the definitions held back 0, 4 and 8 s, en and ar, exit 0.
- FE-Z2 `40b-e2e-a02-repeat5-isolated.log`: 10/10, exit 0.
- FE-Z2 `40a`: 1 failure, which FE-Z2 attributes to its own parallel Playwright run. Cited as disclosed.

The AN-Z1 sentence "No full integration or e2e run … exists yet" is annotated as done.

### Same-class drift fixed by the sweep (no round-3 finding named them)

**REQ-S10-004, REQ-S16-027, REQ-S16-029, REQ-S16-030.** Each carried the same stale AN-Z1 sentence, "No full integration or e2e run of a tree with BE-Z1, ARCH-14 and BE-Z2 merged exists yet". I annotated it: `8b22cc095` holds those merges and passed every step (`summary.txt` and `e2e/summary.txt`).

**REQ-S16-029 and REQ-S16-030.** "F-DG6-181 stays OPEN …" is annotated. It is CLOSED_VERIFIED by code-security in round 3 (`code-security-reviewer.verifications.json`).

**REQ-S16-029 also.** "QA-E's A22 extension … not yet in this tree" is annotated. `a22-p6-operability.test.ts` (17, including the post-suite log scan and its negative control) passes in `08-integration.log` line 461 and in `04c`.

**REQ-S17-007.** "The A12-5 e2e has not been re-run on the integrated tree since the BE-X5 merge" is annotated. A12-5 passes in en and ar in the final `e2e/root.log` and in QA's `05-e2e-root-unset.log`.

### Rows citing the a02 walkthrough's step 10

None in DG6 before this check. REQ-S18-004, REQ-S20-002 and others cite `a02-demo-users-walkthrough.spec.ts` only as evidence, not its step 10, and they are DG5 rows. I left them unchanged so the DG5 register stays as approved. `apps/web/e2e/p6-walkthrough-keyboard.spec.ts` (REQ-S15-012) performs a "step 10", but it selects `#report-definition` by id, so the label rename does not affect it. No other DG6 row named F-DG6-220/221/222/260/261, BE-Z4 or FE-Z2 before this check.

## 4. Checks actually run (real output)

```
$ node tools/gates/validate.mjs --register DG6
PASS register rules at DG6
exit=0
$ node tools/gates/validate.mjs --register DG5
PASS register rules at DG5
exit=0
$ node tools/gates/validate.mjs --register DG4
PASS register rules at DG4
exit=0
$ CSV integrity
rows 412 columns 19 bad-width rows [] roundtrip-identical True unique ids True
$ rows that differ from base HEAD 1dd5ebed9
REQ-DLV-038 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S10-002 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S10-004 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S15-007 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S15-011 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S16-027 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S16-029 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S16-030 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S17-007 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-001 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-012 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-017 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-022 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
changed rows 13 non-DG6 []
$ evidence paths of changed rows exist as regular files
checked 372 paths, missing 0
$ git diff --stat
 docs/delivery/requirements.csv | 26 +++++++++++++-------------
 1 file changed, 13 insertions(+), 13 deletions(-)
```

**Notes on these checks:**
- `validate.mjs --register DG6` lists no failures.
- The same three validator commands also passed, with exit 0, on the untouched base before I edited.
- The CSV is rewritten with Python's `csv` module (minimal quoting, LF line endings). Re-serialising the base without changes gave byte-identical output, so the only differences are the 13 rows above.
- `git diff --stat` was taken before this handback was written. The handback is the only other new file.

## 5. Known gaps (real, not hidden)

1. **No full run of the merged tree.** BE-Z4 and FE-Z2 are evidenced only by their own targeted runs. Every row that relies on them says the binding re-run is the next candidate's freeze verification and the final verification is the next review round.
2. **Open findings.** F-DG6-220, F-DG6-221, F-DG6-222, F-DG6-260 and F-DG6-261 stay OPEN until reviewers verify them. I close nothing.
3. **REQ-S10-002 residual (a).** A restricted case's id or code still appears on action-register rows, meeting actions and controls, without its values. Whether that counts as a disclosure is for the reviewers.
4. **REQ-S15-007.** The `problems-all.test.ts` literal-only gap remains, and clause 3 (the literal `KPI-001` / `12.5%` Arabic export) is still only partly covered by tests.
5. **DG5 rows left unchanged.** REQ-S18-004 and REQ-S20-002 cite the a02 spec as DG5 evidence. They belong to the approved DG5 register, so I did not touch them.
6. **Other stale prose may remain.** This sweep used a fixed phrase list over DG6 rows; other wording in other DG6 rows was not checked.

## 6. Merge instructions

Take `docs/delivery/requirements.csv` and this handback as they are. There are no migrations, no ordering constraints, and no other files.
