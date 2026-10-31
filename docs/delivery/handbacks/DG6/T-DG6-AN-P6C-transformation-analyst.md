# Handback T-DG6-AN-P6C (transformation-analyst): DG6 register update, the last 5 rows

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). This is an engineering record only. It grants and implies no business, Finance or IT approval. Product gate G6 does not imply DG7.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-AN-P6C-transformation-analyst-20261031T162325Z-e290b26b","session_id":"e290b26b-ff00-449b-a862-1318e3aa84ef"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-AN-P6C.md`, sha256 `39948c7d4acd8b93607c9174ee66e2c287303925d6b585aee2371980d0b043da`. I checked it with `sha256sum` and it matches.
- **Tree:** worktree `/home/user/wt/dg6-an-p6c`, branch `dg6/an-p6c`, base `HEAD` `350db3f20f43b8af46dce22e9b6fa64d4314e6ec`. The tree was clean at the start. **My changes are uncommitted.**

## 0. Preceding gate, and the base the evidence rests on

- `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. I ran it before any write.
- **Every repair is in DO-H's base.** `git merge-base --is-ancestor` shows that the merges of BE-X4 (`fefe2c229`), BE-X5 (`10d249e6a`), QA-F (`464d91ab7`), QA-G (`d0d0140ee`), FE-X3 (`701397032`), BE-X6 (`0626914b3`) and QA-E (`8c0228d06`) are all ancestors of `879f84eaf`. That is DO-H's base.
- **DO-H's product tree equals this base.** `git diff 879f84eaf HEAD --name-only | grep -v '^docs/delivery/'` prints nothing (grep exit 1). Between DO-H's base and this base only delivery records changed.
- **So DO-H's full integration run applies to this tree.** The run is `checks/test-integration.log`, exit 0, `Test Files 406 passed (406)`, `Tests 4119 passed | 1 skipped | 2 todo`. I checked that it contains every cited integration file and that each one is green:
  - `a17-import-and-integration` 10;
  - `exception-last-known-value` 8;
  - `a20-s15-014-no-infra-terms` 6;
  - `assistant/conversations` 21;
  - `assistant/retrieval` 8;
  - `a12-p6-scope-isolation` 26;
  - `a22-p6-operability` 17;
  - `a01-p6-source-coverage` 11.
- **The unit runs are green too.** DO-H's unit run has `explanation.test.tsx` 18, `assistant.test.tsx` 24 and `a20-s15-014-term-list` 26, all passing.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | My 5 rows only, SPECIFIED → IMPLEMENTED. Each row gets an evidence list and one appended `DG6 analyst check (T-DG6-AN-P6C, base 350db3f20)` note. The existing notes are kept as a prefix. |
| `docs/delivery/handbacks/DG6/T-DG6-AN-P6C-transformation-analyst.md` | This handback. |

- Nothing under `docs/analysis/**` changed.
- **Later-gate rows with a P6 increment (final gate DG7) are unchanged.** The only-my-rows check in §3 proves it.
- The scripts (`update.py`, `verify.py`, and the base copy `base.csv` from `git show HEAD:docs/delivery/requirements.csv`) are in the session scratchpad, not in the repository.

## 2. Rows changed: the acceptance clause and the test that asserts it

I confirmed each cited test's result in the repair task's own logs (not only its handback text), and again in DO-H's merged-tree run where the test is an integration or unit test.

### REQ-S12-019 → IMPLEMENTED (repaired by BE-X4)

- **Acceptance:** "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date".
- **The repair:** `apps/api/src/modules/operations/exceptions.ts` `linkedKpiStatus` now reads the KPI's latest open or closed period whose panel evaluation has a value. Before, it read only the newest period.
- **Tests that assert it, with the log results:**
  - **BE-X4's new integration file.** `apps/api/test/integration/operations/exception-last-known-value.test.ts`, `vitest-new-test.log`: **8 passed**. The test opens a later period and checks Stale, `250.75` and `2026-01-31`. **Control:** against the pre-fix code, 3 of its tests fail (`vitest-new-test-against-prefix-code.log`).
  - **The unedited QA A17 file.** `tests/qa/integration/a17-import-and-integration.test.ts`, `vitest-a17-qa-file.log`: **10 passed**. That includes "failing connector (REQ-S12-019, A17): one exception, the KPI shows Stale with its last value and date …".
  - **The unedited A17 e2e.** `e2e/a17-failing-connector-exception.spec.ts`, `e2e-a17-failing-connector.log`: **2 passed** (chromium-en and chromium-ar).
  - **The A22 clause (one exception and its alert).** `tests/qa/integration/a22-p6-operability.test.ts`: 17/17 in QA-EB's run and in DO-H's run.
- **Caveats, stated in the row's note:**
  - The A17 e2e has not been re-run on the integrated tree since BE-X4 merged. QA-G's full e2e runs predate the merge. **The binding re-run is the orchestrator's freeze verification.**
  - BE-X4 §5 residual, outside this acceptance: the worker's freshness scan still reads only the newest period.

### REQ-S15-014 → IMPLEMENTED (clause 2 tested by QA-F)

- **Acceptance:** "A05;A20: the weighted score and benefit realized value show plain-language explanations in en and ar; non-admin screens show no stack traces or infrastructure terms".
- **Clause 1:** `apps/web/src/components/explanation/explanation.test.tsx` (FE-F, on KBE-B's `packages/shared/src/explain/*`). It ran 18/18 in DO-H's unit run.
- **Clause 2, the QA-F rendered-screen scan.** `e2e/a20-s15-014-term-scan.spec.ts` scans 21 non-admin routes × 3 states (normal, forced 500, network failure) × en/ar against the ADR-0061 §8 list (`e2e/support/s15-014-terms.ts`).
  - Result: `e2e-term-scan-en-ar-final.log`, **126 passed**, exit 0.
  - 0 term hits, and axe found 0 serious or critical issues.
  - The per-state results are in `e2e/term-scan-chromium-{en,ar}.json`.
- **Clause 2, the server side.** `tests/qa/integration/a20-s15-014-no-infra-terms.test.ts`: **6/6** in QA-F's log and in DO-H's run. Real SQL faults and database-unreachable faults reach the client as a Problem with no §8 term.
- **Clause 2, the term list.** `tests/qa/unit/a20-s15-014-term-list.test.ts`: **26/26** in QA-F's log and in DO-H's run.
- **Mutations:** QA-F's mutations M-API-1/2b, M-WEB-1/2, M-ENV-1/2 and M-UNIT-1 are all killed.
- **Caveats, stated in the row's note:**
  - Six routes are scanned in their not-found or not-demo state, not populated.
  - The forced 500 uses browser interception.
  - The e2e ran at `b8f613829`, before FE-X3's web changes. **The binding re-run is the freeze verification.**

### REQ-S17-007 → IMPLEMENTED (repaired by BE-X5)

- **Acceptance:** "A12: with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions". Row text: "offer … respecting permissions". Permissions: "use: signed-in users when enabled".
- **The repair:**
  - `listAssistantConversations`, which needs `assistant.use`, now returns `assistantEnabled`.
  - `useAssistantAvailability` reads that field, no longer the admin-only `GET /admin/assistant`.
- **Tests that assert it, with the log results:**
  - **The unedited e2e.** `e2e/a12-p6-scope-isolation.spec.ts`, `T-DG6-BE-X5-evidence/e2e-a12.log`: **12 passed**.
    - That includes **A12-5** in chromium-en (6.0 s) and chromium-ar (8.9 s): "asked about Y it shows no Y text; asked about X it cites X".
    - The log also shows `GET /api/v1/admin/assistant` → 403 for `dev.nobody`, while the assistant conversations list returns 200.
  - **The API side.** `apps/api/test/integration/assistant/conversations.test.ts` (4 new tests: no setting value leaks, agreement with create, AUD 403, anonymous 401) together with `contract.test.ts`: **126/126** (`it-assistant-focused.log`).
  - **Retrieval scoping and citations with id and version (unchanged).** `assistant/retrieval.test.ts` and QA-B's `a12-p6-scope-isolation.test.ts` pass in DO-H's run.
  - **The web slot.** `assistant.test.tsx`: 24/24 in DO-H's unit run.
- **Caveats, stated in the row's note:**
  - A12-5 has not been re-run on the integrated tree since BE-X5 merged. **The binding re-run is the freeze verification.**
  - Recording `assistantEnabled` in ADR-0059 §9/§10 is the architect's job (BE-X5 §6). I did not check whether it has been done.
  - Closing F-DG6-QA-B-2 is a reviewer's action.

### REQ-S20-030 → IMPLEMENTED (re-measured on an idle host by DO-H)

- **Acceptance:** "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester". "Immediately" means within 2 s (ADR-0058 §7).
- **DO-H's idle-host re-measurement, from `summary.txt` and `rep-{1,2,3}/export-proof.json`:**
  - Three repetitions, at a 1-minute load average of 0.58–0.92 on 4 vCPU.
  - **0 of 198 starts over 2 s.** For the part B starts (50 simultaneous per repetition, 150 in all), p95 was 1,566 ms and max 1,578.571 ms.
  - Per repetition, 66/66 of each:
    - 202 with a job id;
    - progress non-decreasing to 100, status succeeded;
    - requester download 200.
  - Other same-scope users: 65/65 got 404/404. AUD: 66/66 got 404/404.
- **D-202** attributes the earlier misses to host load: no product change and no reopen.
- **Caveats, stated in the row's note:**
  - `export-proof.mjs` exits 1 in each repetition on `LOAD-T20 FAIL: no sameScopeOther user`. That is a dataset gap, not a latency or access failure. For that export, refusal is still shown for the AUD user.
  - The run used DO-F's patched generator copy.
  - The figures come from one sandbox host and say nothing about production capacity.

### REQ-DLV-038 → IMPLEMENTED (delivered outputs; the candidate run is still to come)

- **Acceptance:** "A12;A13;A14;A17;A21;A22;A23: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029".
- **The evidence run is QA-EB's** (`T-DG6-QA-E-authoring/handback.md` §3, `dlv038/*`, on `60535e99`):
  - integration `tests/qa` 430/431;
  - unit 35/35;
  - dev-stack e2e 147 passed and 10 failed;
  - demo-stack e2e 12/12;
  - A18 clean start PASS (without the install step);
  - `tests/qa/unit/dlv038-s20-029-load-report.test.ts` 6/6 against DO-G's `final/report.md`.
- **That run was red:** P-1, P-2, Q-1, Q-2, and the missing webhook secret in QA-EB's harness.
- **The repairs after it, each cited by its handback:**
  - BE-X4 fixed P-1.
  - BE-X5 fixed P-2.
  - QA-F added the REQ-S15-014 term scan.
  - QA-G fixed Q-1 and Q-2. Its full root e2e, in both default and reverse order, then left only P-1 and P-2 failing.
  - FE-X3 fixed the 12 web e2e regressions of the orchestrator's pre-freeze run.
  - BE-X6 fixed the order-dependent starter-rule threshold.
- **The pre-repair run** is `docs/delivery/test-evidence/DG6/orchestrator-prefreeze-1726c96/`: integration=1 (3 seams, fixed in `887a55b4e`), e2e-unset=1 (12 failed).
- **After all repairs:** DO-H's full integration run on the same product tree passed **406/406 files**.
- **The note says so explicitly:** no single green run of the whole A01–A22 set, e2e included, exists on one tree yet. **The binding re-run is the orchestrator's freeze verification on the DG6 candidate (D-193 rule).** A23's independent reviews happen at review time. This follows the REQ-DLV-036 and REQ-DLV-037 precedent.

## 3. Checks actually run (real exit codes)

Environment: this worktree, Node from `PATH`, offline sandbox.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` |
| 2 | `node tools/gates/validate.mjs --register DG6` (before my write) | not captured (piped through `tail`) | `FAIL register rules at DG6 (8 problems)`: the 5 rows SPECIFIED, and 3 of them without evidence. That is the expected starting state. |
| 3 | `python3 <scratchpad>/update.py` | 0 | `updated 5 rows: REQ-DLV-038, REQ-S12-019, REQ-S15-014, REQ-S17-007, REQ-S20-030`. Before writing, it asserts a byte-identical round-trip of the base CSV, `final_gate == DG6` and base status SPECIFIED. |
| 4 | `python3 <scratchpad>/verify.py` | 0 | output below |
| 5 | `node tools/gates/validate.mjs --register DG6` | **0** | `PASS register rules at DG6` |
| 6 | `node tools/gates/validate.mjs --register DG4` | **0** | `PASS register rules at DG4` |
| 7 | `node tools/gates/validate.mjs --register DG3` | **0** | `PASS register rules at DG3` |
| 8 | `node tools/gates/validate.mjs --register DG2` | **0** | `PASS register rules at DG2` |
| 9 | `git diff --stat` | 0 | `docs/delivery/requirements.csv \| 10 +++++-----`, 1 file changed. This handback is the only other (new, untracked) file. |

`verify.py` output (CSV integrity, only my rows, every evidence path exists):

```
[integrity] rows=412 header_cols=19 distinct_widths=[19]
[integrity] strict parse OK; QUOTE_MINIMAL round-trip byte-identical: True; CR present: False; ends with newline: True
[integrity] duplicate req_ids: 0; header unchanged: True
[only-mine] same row set and order: True
[only-mine] rows that differ from base: ['REQ-DLV-038', 'REQ-S12-019', 'REQ-S15-014', 'REQ-S17-007', 'REQ-S20-030']
  REQ-DLV-038: columns changed=['status', 'evidence', 'notes']; status SPECIFIED -> IMPLEMENTED; final_gate=DG6; old notes kept as prefix=True
  REQ-S12-019: columns changed=['status', 'evidence', 'notes']; status SPECIFIED -> IMPLEMENTED; final_gate=DG6; old notes kept as prefix=True
  REQ-S15-014: columns changed=['status', 'evidence', 'notes']; status SPECIFIED -> IMPLEMENTED; final_gate=DG6; old notes kept as prefix=True
  REQ-S17-007: columns changed=['status', 'evidence', 'notes']; status SPECIFIED -> IMPLEMENTED; final_gate=DG6; old notes kept as prefix=True
  REQ-S20-030: columns changed=['status', 'evidence', 'notes']; status SPECIFIED -> IMPLEMENTED; final_gate=DG6; old notes kept as prefix=True
[evidence] REQ-DLV-038: 27 paths, 27 regular files, missing=[]
[evidence] REQ-S12-019: 13 paths, 13 regular files, missing=[]
[evidence] REQ-S15-014: 18 paths, 18 regular files, missing=[]
[evidence] REQ-S17-007: 15 paths, 15 regular files, missing=[]
[evidence] REQ-S20-030: 14 paths, 14 regular files, missing=[]
[evidence] total=87 missing=0
RESULT: PASS
```

Log checks I ran myself, by `grep` and `tail` of the cited logs:

- BE-X4: `vitest-new-test.log` "Tests 8 passed (8)"; `vitest-a17-qa-file.log` "Tests 10 passed (10)" with the failing-connector test ✓; `e2e-a17-failing-connector.log` "2 passed (51.2s)".
- BE-X5: `e2e-a12.log` A12-5 ✓ in en and ar, "12 passed (1.5m)"; `it-assistant-focused.log` "Tests 126 passed (126)".
- QA-F: `e2e-term-scan-en-ar-final.log` "126 passed (14.8m)", `exit=0`; the integration log 6 passed; the unit log 26 passed.
- DO-H: `summary.txt` "starts over 2000 ms: 0 of 66" in each repetition; `checks/test-integration.log` 406/406 files.
- QA-G: `e2e-full-default.log` "4 failed, 158 passed". The 4 are P-1 and P-2, which BE-X4 and BE-X5 repaired later.

## 4. Real gaps and rows I could not fully evidence

All five rows are IMPLEMENTED. None is left as an unevidenced gap. These limits are real, and each is stated in its row's note:

1. **No single green A01–A22 run exists on one tree, e2e included (REQ-DLV-038).**
   - The e2e files that failed in QA-EB's run because of P-1 and P-2 have passed since only in the repair tasks' own trees: BE-X4 (A17) and BE-X5 (A12).
   - QA-F's term scan ran before FE-X3.
   - The orchestrator's freeze verification on the candidate is the binding run. **If any of these specs fails there, that is a finding against the row, not a flake.**
2. **`e2e/identity/keycloak-login.spec.ts` is BLOCKED.** There is no Keycloak or container runtime in the sandbox. That spec's own row, REQ-S16-007, is already IMPLEMENTED and is not mine.
3. **The A18 clean start ran without `pnpm install`**, so the install step is NOT RUN (QA-EB §3).
4. **REQ-S20-030:** `export-proof.mjs` still exits 1 on the LOAD-T20 dataset gap, and the generator patch is still not in the tree.
5. **REQ-S15-014:** six routes are scanned only in their unpopulated state.

## 5. Assignment discrepancies

None that blocked the work. The assignment says QA-E is "except" from the merged set (D-193 to D-202). `git log` shows `dg6/qa-e` merged (`8c0228d06`), and D-202 says every task is merged. I relied on the merged tree as it is.

## 6. Merge instructions

- Take `docs/delivery/requirements.csv` and this handback. There are no other files and no ordering constraints.
- A conflict is possible only if another task edits these five rows.
