# Handback T-DG6-AN-Z1 (transformation-analyst): register rows after the DG6 round-1 and round-2 repairs (F-DG6-161, F-DG6-201)

- **Stage:** P6, gate DG6 (FIXING after review round 2). **Task:** T-DG6-AN-Z1.
- **Invocation:** run `DG6-T-DG6-AN-Z1-transformation-analyst-20261104T024228Z-4f0ec989`, session `4f0ec989-8db2-462b-9eaa-d23b2ae515bc`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-AN-Z1.md`. Before reading it I checked its sha256, `4259b30f4f820e3493348ff83a39281fc16f0dbebcae9289c90223d2dc8bd33e`, and it matched.
- **Base:** branch `dg6/an-z1` at `9ca69c3dab95791e02dfa8a7aa91650774b9a23b`. The tree was clean at the start.
- **State:** the changes are left **uncommitted** for the orchestrator.
- **Approvals:** none. This is register text only. No product gate (G1–G6) and no Finance or IT approval is granted or implied, and no DG0–DG7 result is recorded. No row's `status` changed.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | Updates the `notes` and `evidence` of 12 DG6 rows to the repaired candidate. No other column and no other row changed. |
| `docs/delivery/handbacks/DG6/T-DG6-AN-Z1-transformation-analyst.md` | This handback. |

**Method.**

- Each changed row gets one appended paragraph, `DG6 analyst check (T-DG6-AN-Z1, base 9ca69c3da, …)`. It cites the repair handback, the logs that show the shipped behaviour passing, and the round-2 verification sidecars.
- Some sentences in the earlier analyst checks stated a gap or design that a repair has since removed. Each of those sentences was rewritten in place to say "at that base" and to point to the new check, so no stale residual reads as current:
  - REQ-S12-019: the freshness-scan residual;
  - REQ-S16-030: the export class `it.todo` and the `admin/security.test.ts` webhook pin;
  - REQ-S20-029 and REQ-S20-030: "DO-F's patched copy … not the tree's generate.mjs";
  - REQ-DLV-038: "no single green run … exists".
- Evidence paths were only appended. None was removed.

## 2. Rows changed, per row: acceptance clause, the test that asserts it, the log that shows it passing

All 12 rows have `final_gate` DG6 and keep the status `IMPLEMENTED`. No DG7 row was touched.

Shorthand for logs that several rows cite:

- **ORCH:** the orchestrator's verification of the round-1 repairs, `docs/delivery/test-evidence/DG6/orchestrator-final-1b70b9a/`. On c5bad1517 every step exited 0 except integration (rc 1, one BE-X10 test defect). On 1b70b9acf the full integration passed (`rerun-1b70b9a/integration.log`: 413/413 files, 4,190 passed, rc 0).

| Row | Acceptance clause (quoted) | Repair(s) | Test that asserts it | Log that shows it passing |
|---|---|---|---|---|
| REQ-S12-019 | "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date" | BE-Y3 (F-DG6-100/140); ARCH-14 (ADR-0053 text, F-DG6-160) | `apps/worker/test/integration/operations-freshness.test.ts`; `apps/api/test/integration/operations/exception-last-known-value.test.ts`; `e2e/a17-failing-connector-exception.spec.ts` | BE-Y3 `03-after-fix-targeted.log` (30/30). ORCH `rerun-1b70b9a/integration.log` (11/11 and 8/8). ORCH `full-run-c5bad15/root.log` (a17, en and ar). Domain `probe-freshness.log`; qa `10b-probe-f140-f141-rerun.log` |
| REQ-S16-030 | "A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass" | BE-Y4 (F-DG6-141); BE-Y2 (F-DG6-120); BE-Z2/Z2B (F-DG6-181, D-209) | `apps/api/test/integration/security/rate-limits.test.ts` (clause line `PASS REQ-S16-030 rate limiting: 7 classes, 8 operations …`); `integrations/secret-namespace.test.ts`; `integrations/secret-binding.test.ts` | ORCH `rerun-1b70b9a/integration.log` (rate-limits 10/10, admin/security 8/8). Domain `int-api-p6.log`; qa `10b-probe-f140-f141-rerun.log`. BE-Z2 `z2b-20-integration-touched.log` (526 passed, secret-binding 8/8) |
| REQ-S20-029 | "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding" | DO-Y1 (F-DG6-101/142) | `deploy/scripts/tests/load-generate-ids.vitest.mjs`; the load driver and `report.mjs` | ORCH `full-run-c5bad15/unit-unset.log` (4/4). Domain `probe-uuid.log`, `mutant-load-ids-revert.log`. QA `14c-load-quiet/report.md` (quiet-host p95 on the shipped tree) and `14-load/report.md` (loaded host, disclosed) |
| REQ-S20-030 | "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester" | BE-Y4, BE-Y5 (D-207), BE-Y6 (0125), DO-Y2; ARCH-11..13 | `apps/api/test/integration/reporting/exports-assembly.test.ts`; `deploy/load/export-proof.mjs` | ORCH `rerun-1b70b9a/integration.log` (exports-assembly 18/18). DO-Y2 `03-summary.txt` (0 of 150 part-B starts over 2 s; 66/66 for each clause per repetition). QA `17-export-proof-idle-driver.log` (0 of 132). Domain `load-export-proof-1rep.log` |
| REQ-S10-002 | "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant" | BE-Y1 (F-DG6-121..123); BE-Z1 (F-DG6-180) | `apps/api/test/integration/access/sensitive-reach.test.ts`; `access/sensitive-reach-calculations.test.ts` | BE-Y1 `01-sensitive-reach-AFTER-fix.log` (10/10; 6 failing before the fix). ORCH `rerun-1b70b9a/integration.log`. CS `40-repro-sens-reach.log`. BE-Z1 `01-calc-test-after.log` (5/5; 2 failing before the fix) and `06-integration-touched.log` (387 passed) |
| REQ-S16-029 | "A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope" | BE-Y2 (F-DG6-120); BE-Z2/Z2B (F-DG6-181) | `tests/qa/integration/a22-p6-operability.test.ts` (post-suite log scan); `operations/service-identity-scope.test.ts`; `secret-namespace.test.ts`; `secret-binding.test.ts` | Domain `int-qa-part02.log` (a22 17/17, exit 0). ORCH `rerun-1b70b9a/integration.log` (service-identity-scope 10/10, log-redaction 2/2). BE-Y2 `10-it-secret-namespace.log`. BE-Z2 `z2b-20-integration-touched.log` |
| REQ-DLV-038 | "A12;A13;A14;A17;A21;A22;A23: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029" | all of the above, plus FE-Y1 and BE-Z1 (F-DG6-200) | the full suite set | ORCH README and the `.rc` files (c5bad1517: web e2e 546 passed in each locale, root 288 passed, demo 10 passed, unit in both locales; 1b70b9acf: integration 413/413) |
| REQ-S10-004 (sweep) | "A12: a user without access to transformation Y receives no Y records in search, export, evidence URL or AI retrieval; …" | BE-Y1, BE-Y5, BE-Z2 | `exports-assembly.test.ts` (access re-checked at assembly); `tests/qa/integration/a12-p6-scope-isolation.test.ts` | ORCH `rerun-1b70b9a/integration.log`. BE-Y5 `02-targeted-integration.log` (a12 file passing), `22-e2e-export-specs.log` (a12 e2e passed; a02 failed there on the wrong stack and passed in log 23) |
| REQ-S02-006 (sweep) | "A08;A12: each control test that bypasses the UI and calls the API with invalid or unauthorized input is rejected; …" | BE-Y3 (F-DG6-124/145) | `apps/api/test/integration/hardening/route-inventory.test.ts` ("the fingerprint ignores only the session's sliding idle expiry …") | ORCH `rerun-1b70b9a/integration.log` (route-inventory 10/10). QA `15-mutant-f145-route-inventory.log` |
| REQ-S16-027 (sweep) | "A12;A08: contract tests validate responses against the OpenAPI document; invalid input returns the uniform 400 body; an unauthorized call returns 403" | BE-Y3 (F-DG6-146); BE-Z2 (descriptions and field-error codes only) | route-inventory case 4 (`{"400":482}`); `registers.test.ts` | ORCH `rerun-1b70b9a/integration.log`. QA `04-integration-run2-A.log`. BE-Y3 `03-after-fix-targeted.log` |
| REQ-S17-001 (sweep) | "A17: a test connector run records last success, row counts, errors and retries, all visible in the UI" | FE-Y1 (F-DG6-102) | `apps/web/src/pages/integrations/integrations.test.tsx` (retry chain) | Domain `unit-web-integrations-loaded.log`, `unit-web-integrations-loaded-2.log`. The round-1 test fails in `mutant-integrations-round1-test.log` |
| REQ-S15-009 (sweep) | "A20: e2e tests at 360 px approve a gate item and submit a KPI actual in Arabic and English" | FE-Y1 (F-DG6-143) | `apps/web/e2e/p6-admin-screens.spec.ts` (360 px and 200 % text on Upload policy) | BE-Z2 `z2b-31-e2e-connector-email-webhook.log` (116 passed, 18 skipped). QA `08-probe-aud-reflow-unset.log`, `13b-mutant-f143-upload-policy-overflow.log` |

**Rows that say their final verification is the next review round.** The notes state where verification stands for each row:

- **REQ-S10-002:** F-DG6-180 is OPEN.
- **REQ-S16-029 and REQ-S16-030:** F-DG6-181 is OPEN.
- **REQ-S12-019:** F-DG6-160 is OPEN (ADR text only).
- **REQ-DLV-038:** F-DG6-144, F-DG6-161, F-DG6-200 and F-DG6-201 are OPEN.
- **REQ-S10-004 and REQ-S16-027:** both cite BE-Z2.

All of these rows also say that no full integration or e2e run of a tree with BE-Z1, ARCH-14 and BE-Z2 merged exists yet, so the binding re-run is the orchestrator's next freeze verification.

**Sweep.** I searched every register row for F-DG6-100..147, F-DG6-180, F-DG6-181, the repair task ids (BE-Y*, BE-Z*, DO-Y*, FE-Y1, ARCH-11..14) and D-206..D-209. No row named any of them at the base. So I also mapped each round-1 and round-2 finding's `requirement` in `findings.json` to its row. That added five more DG6 rows the repairs touched: REQ-S10-004, REQ-S02-006, REQ-S16-027, REQ-S17-001 and REQ-S15-009. BE-Y6's own row, REQ-S13-005, is `final_gate` DG5, so I left it unchanged.

## 3. Checks actually run (real exit codes)

Environment: the worktree `/home/user/wt/dg6-an-z1`, Node from the PATH, Python 3, offline. The base CSV was taken with `git show HEAD:docs/delivery/requirements.csv > $TMPDIR/base.csv`.

### Register validator

```text
### node tools/gates/validate.mjs --register DG6
PASS register rules at DG6
exit=0
### node tools/gates/validate.mjs --register DG5
PASS register rules at DG5
exit=0
### node tools/gates/validate.mjs --register DG4
PASS register rules at DG4
exit=0
```

The DG6 validator reported no failures, so there is nothing to list. Before my edit it also printed `PASS register rules at DG6`.

### CSV integrity, rows changed, evidence paths

`python3 $TMPDIR/verify.py $TMPDIR/base.csv`. The script parses the CSV and checks every row's column count. It re-serialises the parsed rows with the file's dialect (minimal quoting, `\n`) and compares the bytes. It then diffs every row against the base and checks every `evidence` path of each changed row with `os.path.isfile`.

```text
CSV integrity: rows 412 columns 19
rows with a different column count: []
re-serialises byte-identical (valid quoting): True
header unchanged: True | row count unchanged: True
CHANGED REQ-DLV-038 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S02-006 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S10-002 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S10-004 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S12-019 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S15-009 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S16-027 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S16-029 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S16-030 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S17-001 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S20-029 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
CHANGED REQ-S20-030 final_gate=DG6 status IMPLEMENTED -> IMPLEMENTED columns: ['evidence', 'notes']
changed rows: 12 | all DG6: True
evidence paths checked: 333, missing or not a regular file: 0
exit=0
```

### `git diff --stat`

See §6. It was run after this handback was written.

### What I read rather than ran

I did not re-run any product test. Every pass I cite comes from an existing log, and I opened each one I cite to confirm it:

- the orchestrator logs: `.rc` files, tallies, and the test lines for operations-freshness, exception-last-known-value, exports-assembly, secret-namespace, sensitive-reach, rate-limits, admin/security, route-inventory, service-identity-scope, log-redaction, load-generate-ids and the a17 e2e;
- `int-qa-part02.log` (a22 17/17, exit 0);
- `14c-load-quiet/report.md` and `14-load/report.md`;
- DO-Y2's `03-summary.txt`;
- the round-2 verification sidecars.

For the before-fix and after-fix logs of BE-Y1, BE-Y3, BE-Y4, BE-Z1 and BE-Z2, the counts I quote come from their handbacks.

## 4. Gaps and residuals (stated plainly)

1. **No evidence yet on the integrated tree for the round-2 repairs.** BE-Z1, ARCH-14 and BE-Z2/Z2B are merged at `9ca69c3da`. Their evidence is the implementers' touched-suite, unit, static and e2e runs. No full `pnpm test:integration` or e2e run of this tree exists. REQ-S10-002, REQ-S16-029, REQ-S16-030, REQ-S10-004, REQ-S16-027 and REQ-DLV-038 say so. The binding run is the orchestrator's next freeze verification. F-DG6-160, F-DG6-180, F-DG6-181 and F-DG6-200 close only through the next review round.
2. **REQ-S20-029 has no load report of record on the shipped design.**
   - DO-G's report (export start 108.5 ms) measured the synchronous export start that D-207 replaced.
   - The only measurement of the shipped tree is the qa-verifier's round-2 quiet-host run (one repetition): `14c-load-quiet/report.md`, with no miss. That run was review evidence, not a delivered report.
   - The loaded-host run (load 25–31) missed export start: p95 2,442.1 ms. The F-DG6-147 verification calls this outside the measuring condition, and no finding was raised. I disclose it in the row.
   - `getWorkstreamDashboard` is still not measured.
   - Whether DevOps should re-issue the report on the shipped tree is the orchestrator's call.
3. **REQ-S20-030:** `export-proof.mjs` still exits 1 on the LOAD-T20 dataset gap. It also does not assert ADR-0058 amendment T2's `snapshotId` checks. DO-Y2 checked those with its own script.
4. **REQ-S10-002:** BE-Y1's and BE-Z1's disclosed residuals remain, and are listed in the row:
   - the scenario list can embed a sensitive benefit's value rows;
   - the corrective-case, transition-decision and performance-area-link registers are not hidden;
   - list filtering runs after pagination;
   - the ADR-0051 §2 consequence for FIN users.
5. **REQ-S16-030:** there is still no XSS e2e.
6. **REQ-DLV-038:** F-DG6-144 (Low) is OPEN. Three journey tests time out on 30 s at review load.
7. **REQ-S17-001:** the earlier "partial" (no test asserts a succeeded run's row counts on screen) is unchanged.

The orchestrator should judge whether items 2 to 7 still support status `IMPLEMENTED`. I changed no status, because none of the new evidence shows a status change.

## 5. Merge instructions

- `docs/delivery/requirements.csv` changes only the `notes` and `evidence` columns of the 12 rows above. A concurrent edit to the same rows would conflict, and the D-004 note says I ran alone.
- No migration, no code, and no ordering constraint.

## 6. `git diff --stat`

```text
 docs/delivery/requirements.csv | 24 ++++++++++++------------
 1 file changed, 12 insertions(+), 12 deletions(-)
```

This handback is a new, untracked file, so `git diff --stat` does not list it. `git status --porcelain` shows ` M docs/delivery/requirements.csv` and `?? docs/delivery/handbacks/DG6/T-DG6-AN-Z1-transformation-analyst.md`, and nothing else. The output above is the real output, pasted after the run.
