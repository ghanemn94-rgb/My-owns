# Handback T-DG6-AN-Z3 (transformation-analyst): register rows after the round-4 repairs (BE-Z5, FE-Z3)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-AN-Z3-transformation-analyst-20261105T094638Z-b710dfc5","session_id":"b710dfc5-b84d-4706-8fa5-ec26414a74ba"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-AN-Z3.md`. I checked it with `sha256sum` and got `434d2cc1a7d525762b59f8084069f6fd990f7f6c71b8be9c666fe9998e667459`, which matches the value given.
- **Base:** branch `dg6/an-z3`, `HEAD` `3496b8e115f642f4b82a0911ff64227b8adc2ab0`. The working tree was clean at the start. BE-Z5 was merged at `920fe4029` and FE-Z3 at `131cbc226`.
- **Changes:** uncommitted, as the assignment asks.
- **Approvals:** none. This check grants no business, Finance or IT approval (G1–G6) and implies no DG result. All the data it cites is synthetic.

## 0. Defects in the assignment text (reported, not guessed)

The assignment file has two damaged headings:
- "## What to c## What to change";
- a truncated line, "ification (real output in the handback)", where the heading of the verification section should be.

The intended content is clear from context: the change list, then the required checks. I executed both as written. The wording "any row whose notes cite the escalation, executive asks, traceability, …" names no gate. Its sweep sentence and "Do not change later-gate rows" point to DG6 rows only, and I applied it to DG6 rows only (see §3.4).

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | `notes` and `evidence` of 10 DG6 rows (§3). No status changed, and no other column changed. |
| `docs/delivery/handbacks/DG6/T-DG6-AN-Z3-transformation-analyst.md` | This handback. |

No `docs/analysis/**` note was needed.

## 2. Method

**Paragraph format.** Each row a round-4 repair touched gets a new paragraph, "DG6 analyst check (T-DG6-AN-Z3, base 3496b8e11, …)". The paragraph gives:
- the shipped behaviour;
- the test that asserts it;
- the log that shows it passing;
- the residuals.

**Stale clauses.** I annotated stale clauses with a bracketed `[T-DG6-AN-Z3: …]` pointer and did not delete them, following AN-Z2's convention.

**Evidence I read myself.** I opened each log cited below and confirmed the result I claim from its own summary lines. The handback summaries alone were not enough.

| Evidence | What it shows |
|---|---|
| BE-Z5 `01-new-tests-BEFORE-fix.log` | "Test Files 4 failed (4) / Tests 6 failed \| 3 passed \| 5 skipped (14)", exit 1 (the intended red) |
| BE-Z5 `02-touched-suites.log` | 64 files passed, 566 passed and 1 skipped, exit 0 |
| BE-Z5 `03-new-and-key-suites-final.log` | 10 files, 63 passed, exit 0. Also the line "[BE-Z5 sweep] 418 requests per reader; 71 operations not fillable", and ✓ on all four new files, sensitive-reach, sensitive-reach-registers, report-snapshots, traceability, blocker-escalation and raid-corrective |
| BE-Z5 `20-…locale-unset.log`, `21-…C.UTF-8.log` | unit-node 2899, unit-web 2039, formula 259 passed and 2 skipped, exit 0 |
| FE-Z3 `01-problems-all-before-texts.log` | 3 failed, 7 passed. The failing cases are "every code", "field-error … (F-DG6-301)" and "'Last error' … (F-DG6-320)" |
| FE-Z3 `02-i18n-after-texts.log` | 6 files, 62 passed. problems-all.test.ts: 10 tests ✓ |
| FE-Z3 `03-connector-form-unit.log` | 10 passed, including the 6 "a target the administrator cannot view" tests (en and ar) |
| FE-Z3 `04-connector-form-unit-without-fix.log` | 2 failed: "shows the stored target as set …", en and ar |
| FE-Z3 `10-e2e-connector-target-run1.log` | 2 passed, EXIT=0 |
| FE-Z3 `11-e2e-touched-product-specs.log` | 44 passed, EXIT=0, with a17-failing-connector-exception and a22-p6-operability ✓ in en and ar |
| FE-Z3 `30-…`, `31-…` | unit-node 2899, unit-web 2050, formula 259 passed and 2 skipped, EXIT=0 |
| `orchestrator-final-04fcf43/summary.txt` and the logs | every step 0; integration 417 files, 4217 passed, 1 skipped, 1 todo; e2e 550 passed and 2 skipped in each locale; root 288 passed and 18 skipped; demo 10 passed |

**Screenshots.** I viewed FE-Z3's `shots/ar/a22-p6-exception-resolved.png`. Its "آخر خطأ" reads «لم يُرسل العامل في الخلفية أي نبضة حديثة، لذا قد لا تكون المهام المجدولة قيد التشغيل.», and the code `operations.heartbeat_missed` appears separately under «رمز الخطأ». I also viewed `shots/en/p6-connector-target-unlisted.png`. Its select reads "A transformation you cannot view · 01a1aaed-…", with the hint above it.

**Code at HEAD.** I spot-checked that the shipped code is present:
- `benefitCaseAskTitle` in `apps/worker/src/handlers/escalations.ts`;
- the neutral G6 text in `workflows/g6.ts:59`;
- `reporting/reports/restricted.ts`;
- `trace_link` and `traceLinkId` in `sensitive-reach.ts`;
- the 5 new keys in `ar/problems.json`;
- `data-stored-target` in `ConnectorFormPage.tsx`.

**Tree identity.** `git diff --name-only 04fcf43 654e39d` changes only files under `docs/delivery/`. So the verified 04fcf43f3 is the product tree of round-4 candidate 4b84bf20 (source 654e39d).

**Finding statuses.** I took them from `findings.json` and the round-4 and round-3 `*.verifications.json`:
- F-DG6-220, 221 and 222: CLOSED_VERIFIED by the domain reviewer in round 4.
- F-DG6-260 and 261: CLOSED_VERIFIED by QA in round 4.
- F-DG6-160: CLOSED_VERIFIED by the domain reviewer in round 3.
- F-DG6-280, 281, 300, 301 and 320: OPEN.

## 3. Rows changed: clause, test, passing log

### 3.1 REQ-S10-002 (BE-Z5: F-DG6-300 and F-DG6-280)

**Clause (A12):** "a sensitive benefit is hidden from a workstream member without the grant".

**Tests:**
- `apps/api/test/integration/access/sensitive-reach-derived.test.ts` (5: traceability, missing links, G6 readiness, live report and snapshots, export refusal)
- `sensitive-reach-escalation.test.ts` (4: consumer title, blocker-status and ask-link refusal as an unknown id, one ask titled by the case code that TL, AUD and SP never read with the title)
- `sensitive-reach-impact.test.ts` (3)
- the sweep `sensitive-reach-sweep.test.ts` (2: 375 of 446 GET operations, 418 requests per reader, negative for TL and AUD, positive for the admitted TL)

**Logs:**
- BE-Z5 `01` (fails before the fix)
- `03` (10 files, 63 passed)
- `02` (64 files, 566 passed)
- `20` and `21` (exit 0)

**Residuals written into the row** (from BE-Z5 handback §10):
1. 71 GET operations cannot be filled and are not swept. Only three of them are benefit-derived, and those are guarded per path parameter with their own tests.
2. `searchRecords` is swept, but the indexer is not run, so the index is empty there.
3. Asks and cases stored before the fix keep the benefit's title. No data is rewritten, and any migration is the orchestrator's decision.
4. Ids and codes remain: G6 snapshot benefit ids, and the case code on action-register rows, which is now also the ask's title.
5. Counts are kept so that verdicts stay truthful: the G6 placeholder, `hiddenItemCount`, `itemCount`, report totals and `benefit_missing`.

**Also disclosed in the row:**
- There is no "includes restricted records" label on report totals. `ReportDocument` has no such member, and that optional contract change was not made.
- `listBlockerStatuses` filters after pagination.
- The 64-file run predates two final edits. Its other 54 files were not re-run.

**Annotated:**
- "F-DG6-220 stays OPEN" (now CLOSED_VERIFIED, round 4)
- the stale "no full run" sentence (done in `orchestrator-final-04fcf43`)

### 3.2 REQ-S15-007 (FE-Z3: F-DG6-320 and F-DG6-301)

**Clause (A20;A15):** "a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language".

**Tests:**
- the extended `apps/web/src/i18n/problems-all.test.ts`, which collects field-error codes inside `problems.validation(...)` and every operational-exception `errorCode`, and checks en/ar completeness, no generic fallback, and a non-empty "Last error" through `exceptionErrorText`
- `integrations.test.tsx` "says why an automatic commit needs an on-behalf-of user, in the reader's language"

**Logs:**
- FE-Z3 `01` (3 of 10 fail without the texts)
- `02` (62 passed)
- `03`
- `30` and `31` (exit 0)
- `11` (44 passed)
- the ar screenshot, which I viewed

**Residuals written into the row:**
- The AN-Z2 constants residual is **narrowed, not closed**. The field-error case reads only literal `code:` values inside `problems.validation(...)` calls under `apps/api/src/modules`, so a code passed through a constant is still missed. I confirmed this in `apiFieldErrorCodes`.
- The 16 Arabic texts are provisional.
- No e2e asserts the heartbeat "Last error" text, because the spec is QA-owned.
- `smtp.*` codes still show raw in the "Error code" columns of the notification-channel screens.
- Clause 3 is unchanged and still partly covered.

**Annotated:**
- "F-DG6-221 stays OPEN" (CLOSED_VERIFIED, round 4)
- the "no full run" sentence

### 3.3 REQ-S17-001 (FE-Z3: F-DG6-281)

**Clause (A17):** "a test connector run records … all visible in the UI". The finding concerns the stored target the row's connector records.

**Tests:**
- `integrations.test.tsx` "connector form: a target the administrator cannot view" (en and ar)
- the new `apps/web/e2e/p6-connector-target-unlisted.spec.ts` (real API, en and ar)

**Logs:**
- FE-Z3 `03` (10 passed)
- `04` (the 2 "shown as set" tests fail without the fix)
- `10` (2 passed)
- `11` (44 passed)
- the en screenshot, which I viewed

**Residuals:**
- The label shows the id, not the code. Showing the code would need an API change that discloses it.
- The Arabic texts are provisional.
- The earlier "partial" (no test asserts a succeeded run's row counts on screen) is unchanged.

### 3.4 Sweep of the other DG6 rows

**Keyword rows.** Rows whose notes cite the escalation, executive asks, traceability, missing links, G6 readiness or the register reports: **no DG6 row besides REQ-S10-002 does.** The keyword search matched only DG4 and DG5 rows, plus DG7 rows on unrelated "blocker" or "traceab" wording:
- DG4: REQ-PB-005, 010, 044, 064, 065, 066, 068, 081, 082; REQ-S03-006, S03-009, S07-015, S10-012, S10-019, S12-011, S20-009
- DG5: REQ-PB-090, S04-011, S06-001, S06-003, S06-004, S12-025, S18-004
- DG7: REQ-DLV-018, 028, 031, 039; REQ-S21-003

I left all of them unchanged so the approved DG4 and DG5 registers stay as approved, and the assignment forbids changing DG7 rows. I checked REQ-PB-082, REQ-S20-009, REQ-PB-044, REQ-S03-006 and REQ-PB-005 for any claim that an ask, report or graph carries a benefit's title. None makes such a claim, so BE-Z5 makes none of their statements untrue.

**Rows naming a round-4 finding or repair task.** Before this check, no DG6 row did. I added FE-Z3 paragraphs to the two rows whose exception kinds F-DG6-320 names:

**REQ-S12-019 (stale data, `kpi.stale`).**
- **Clause (A17;A22):** "a failing test connector produces one exception and the KPI shows Stale …". It is unchanged by the repair.
- **Test:** `problems-all.test.ts` (exception codes).
- **Logs:** FE-Z3 `01`, `02`, `30`, `31`, and `11` (the a17 e2e, en and ar).
- **Residuals:**
  - No e2e shows a `kpi.stale` "Last error", because the a17 exception carries a connector code.
  - The Arabic text is provisional.
- **Annotated:** "F-DG6-160 … OPEN" (CLOSED_VERIFIED in round 3).

**REQ-S20-022 (missed heartbeat).**
- **Clause (A22):** "error alerts, admin job visibility …".
- **Tests:** `problems-all.test.ts`, `e2e/a22-p6-operability.spec.ts`, `e2e/a22-operations-jobs.spec.ts`.
- **Logs:** FE-Z3 `01`, `02`, `30`, `31`, `11`, and the ar screenshot, which I viewed.
- **Residuals:**
  - The spec does not assert the text.
  - The Arabic text is provisional.
- **Annotated:** the "no full run" sentence.

**Same-class drift.** These rows got bracketed annotations only, with no new behaviour claims:

| Row | Annotations |
|---|---|
| REQ-DLV-038 | "F-DG6-220 … 261 stay OPEN" (all CLOSED_VERIFIED in round 4); the "no full run" sentence; a short paragraph stating that no round-4 finding is filed on this row and that the merged tree has no full run yet |
| REQ-S15-011 | "F-DG6-222 stays OPEN"; the "no full run" sentence |
| REQ-S20-001 | the "no full run" sentence |
| REQ-S20-012 | the "no full run" sentence |
| REQ-S20-017 | "F-DG6-221 stays OPEN"; the "no full run" sentence |

The annotation of each "no full run" sentence cites `orchestrator-final-04fcf43` (`summary.txt` all exit 0, and the counts in §2). That run's three files were added to these rows' evidence, together with the verification sidecar that closed the finding.

**Merged tree.** Every new paragraph says plainly that the tree with BE-Z5 and FE-Z3 merged has no full integration or e2e run yet. The binding re-run is the orchestrator's final verification of the merged tree, and the final verification is review round 5. F-DG6-280, 281, 300, 301 and 320 are stated to stay OPEN.

## 4. Checks actually run (real output)

The three validators were first run on the untouched base, before any edit. All gave PASS with exit 0, and `--historical --stage DG5` gave `PASS gate DG5 (historical)` with exit 0. After the edit:

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
$ CSV integrity / changed rows / evidence paths   (python3 "$TMPDIR/an/check.py")
rows 412 columns 19 bad-width rows [] roundtrip-identical True unique ids True
same id set True
REQ-DLV-038 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S10-002 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S12-019 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S15-007 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S15-011 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S17-001 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-001 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-012 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-017 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
REQ-S20-022 final_gate DG6 status IMPLEMENTED -> IMPLEMENTED fields ['evidence', 'notes']
changed rows 10 non-DG6 []
checked 368 paths, missing 0
exit=0
$ git diff --stat
 docs/delivery/requirements.csv | 20 ++++++++++----------
 1 file changed, 10 insertions(+), 10 deletions(-)
```

**Notes on these checks:**
- **Validator failures:** `validate.mjs --register DG6` lists none.
- **How the CSV was written:** with Python's `csv` module (minimal quoting, LF line endings). Before editing, I confirmed that re-serialising the base without changes gives byte-identical output.
- **Base for the diff:** the changed-rows comparison is against `git show HEAD:docs/delivery/requirements.csv`.
- **Evidence paths:** each `evidence` path of the 10 changed rows (368 in total) exists as a regular file.
- **`git diff --stat`:** taken before this handback was written. The handback is the only other new file, and it is untracked.

## 5. Known gaps (real, not hidden)

1. **No full run of the merged tree.** BE-Z5 and FE-Z3 are evidenced only by their own targeted runs. Two of those runs carry caveats:
   - BE-Z5's 64-file run predates two final edits, and 54 of those files were not re-run.
   - The full `pnpm test:integration` was not run by BE-Z5.

   The binding evidence is the orchestrator's verification of the merged tree, then round 5. I did not mark anything IMPLEMENTED on that basis. All 10 rows were already IMPLEMENTED, and none changed status.
2. **Open findings.** F-DG6-280, 281, 300, 301 and 320 stay OPEN. I close nothing.
3. **REQ-S10-002 residuals (1)–(5) stand** (§3.1). In particular:
   - the sweep does not cover 71 operations;
   - search is not exercised with an indexed corpus;
   - pre-fix stored rows keep the title;
   - report totals have no restricted-records label.
4. **REQ-S15-007.**
   - Field-error codes passed through constants are still not collected by the catalogue test.
   - No e2e asserts the heartbeat or `kpi.stale` "Last error" text.
   - `smtp.*` codes show raw on the notification-channel screens.
   - Clause 3 (the literal `KPI-001` / `12.5%` Arabic export) is still only partly covered.
5. **Earlier-gate rows unchanged** (§3.4). I found no statement in them made untrue, but I only checked five of them in detail.
6. **Other stale prose may remain.** I swept for a fixed set of phrases: round-4 finding and task IDs, "stays OPEN", "OPEN until", "no full integration or e2e run yet", and the assignment's keywords. Other stale wording in other DG6 rows was not checked.

## 6. Merge instructions

Take `docs/delivery/requirements.csv` and this handback as they are. There are no migrations, no ordering constraints and no other files.
