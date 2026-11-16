# Handback T-DG7-AN-P7F (transformation-analyst): D-243 Q19 extended to the 18 DG7 rows (F-DG7-935, D-274)

- Stage: DG7 (P7), state FIXING after round 2. Branch `claude/mobily-transformation-platform-dg6-regate`, base `7c819f08c` (`git rev-parse HEAD` at start; the tree was clean apart from this run's own run directory).
- Assignment: `docs/delivery/assignments/DG7/T-DG7-AN-P7F.md`, sha256 `5b751bbd…2d112` (matches the hash I was given).
- Invocation: run `DG7-T-DG7-AN-P7F-transformation-analyst-20261115T203429Z-4a33704e`, session `4a33704e-4acd-4e72-83df-947bbe40e875`.
- Time: start `2026-11-15T20:34:39Z`, end `2026-11-15T20:57:28Z` (about 23 minutes).
- This pass records engineering delivery states only. It grants no DG7 approval and no G1–G6 business, Finance or IT approval. Under D-274, if a reviewer or the release-auditor rejects the Q19 extension, the gate is BLOCKED.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | The 18 assigned rows: `status` SPECIFIED → IMPLEMENTED; `evidence` gets the run logs cited in the notes, existing entries kept; `notes` gets one "DG7 analyst pass 6" paragraph that ends with a single `completes-after-gate:` clause. No other row changed: the diff touches 18 lines, one per assigned id (§3, check 3). |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7F-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7F-evidence/*.log` | Logs of the checks in §3. |

How the notes were edited:
- Earlier passes' notes are kept verbatim, with one exception. In REQ-DLV-039, the pass-4 marker text `completes-after-gate: 'all eight gate reports are included'` was reworded to `Pass-4 later clause (restated in the pass-6 marker below): 'all eight gate reports are included'`. The reason: `laterClauseOf` reads the **first** marker, so each row must carry exactly one, at the end. That clause is restated in the pass-6 marker.
- No `apps/api/test/support/p7-pending*.ts` entry belongs to this task. It implements no operation.

## 2. Behaviour per requirement

The pass-6 paragraph follows the same pattern in every row:
- D-243 Q19 as extended by D-274, superseding D-266 (d);
- the evidence that ran, with its paths;
- any disclosed deviation, stated plainly before the marker and never as met;
- the no-approval sentence;
- `completes-after-gate:` naming exactly what only the DG7 gate round, audit or A28 seal completes.

Where evidence comes from the round-2 QA review run, it is described as **on candidate ca38b65e**, not as on the final DG7 candidate.

| Row | Evidence that ran (summary) | Disclosed deviation | `completes-after-gate:` |
| --- | --- | --- | --- |
| REQ-DLV-005 | validator suite incl. the A23 authored-scope test, 66/66, exit 0 (QA r2 `03-nodetest-tools_gates_tests.log`); DG0–DG6 gate records | none | `validate.mjs --stage DG7` with the DG7 round's reviews and audit |
| REQ-DLV-008 | QA r2 protocol audit DG7 C4 PASS (and pre-freeze C4 PASS) | **Not met as written**: "each assignment names a base revision and permitted files" (C2 hits T-DG7-BE-A26, REV-A26-CS/-QA/-V; 49 of 75 assignments without a declared path list); D-270, auditor judges; D-249 H6/H7 stand | auditor's ownership check and decision on the D-270 hits; C4 on the frozen candidate |
| REQ-DLV-011 | QA r2 and pre-freeze audits, DG7 C2 27 hits of 75 | **Not met**: 27 assignments lack elements (24 only task/requirement ids; the A26 drill ones several); D-270 C2; D-249 H3/H4 stand | auditor's decision on the D-270 C2 hits; C2 on the frozen candidate |
| REQ-DLV-012 | QA r2 audit: DG7 C6 PASS, C3 6 hits | **Not met**: six handbacks each lack one section: D-270's five plus T-DG7-FE-C3 (no merge instructions; F-DG7-960, after D-270); D-270 C3; D-249 H5/H9 stand | auditor's decision on the six C3 hits and its progress.md reading; C3/C6 on the frozen candidate |
| REQ-DLV-014 | C9 PASS; `--pipeline` PASS (DG7 REVIEWING), exit 0; round-1 findings verified closed by non-owners (D-274) | none (F-DG6-952 stays an accepted observation) | DG7 history to VERIFYING/APPROVED with the round-2 findings fixed and verified, by `--stage DG7` |
| REQ-DLV-018 | QA r2 audit DG7 C7 PASS over 6 DG7 findings, 0 failed fix verifications | none (D-249 H11 stands for DG3) | C7 (or the auditor's reading) over later DG7 rounds up to the gate |
| REQ-DLV-024 | stage DG6 `--historical` log PASS; this pass's own `--historical` before editing (exit 0) | **Not met for DG7**: DG6 historical log (18:27:48Z) is after the first DG7 implementation run (15:02:13Z); D-270 C5; D-249 H8 stands | auditor's decision on the D-270 C5 hit |
| REQ-DLV-028 | QA r2 audit DG7 C6 PASS (gate update not applicable before the gate); F-DG7-955 verified closed | none for DG7 (historic DG6 C6 hit under D-249 H10) | the DG7 gate update in progress.md, six elements, candidate id = gates/DG7.json |
| REQ-DLV-030 | A27 drill K10, K12, K13 PASS (`a27/drill-report.md`, logs) | **Not met**: "work continues from progress.md" is PARTIAL (A27 K11); no K11 re-drill; QA r2 `06-a27-resume.log` is not a re-drill | passing K11 re-drill or the auditor's decision on the K11 partial |
| REQ-DLV-031 | T-M12 "filled SYNTHETIC report passes V18" in the pre-freeze r2 release-tool suite (exit 0); statement in progress.md gate updates and the template | none | final delivery report at sealing, verified by V18 |
| REQ-DLV-039 | A01–A22, A18 both halves, offline demo, A26 drill, pre-freeze r2 checks all exit 0; QA r2 e2e on ca38b65e (root 288 passed, exit 0; web 557 passed / 3 failed, the 3 passing in a rerun of 50) | A27 K11 partial; D-270 C2/C3/C5 hits, listed as disclosed, not met | A23 for DG7, the auditor's decisions on those disclosures, and seal V6/V7 "all eight gate reports are included" |
| REQ-DLV-040 | A24 pipeline test passes (66/66); `--pipeline` PASS (DG7 REVIEWING); C9 PASS | none | `--pipeline` after DG7 APPROVED |
| REQ-S02-005 | T-I11, T-I13 fixture half in the pre-freeze r2 suite (exit 0); T-I12 (QA-D); this pass's `--register DG7` and laterClauseOf logs | none | T-I13/T-I10 on the frozen register; orchestrator's release-notes `--write/--check` after this pass |
| REQ-S19-015 | check-handover exit 0 and T-H1–T-H5 in pre-freeze r2 | none (F-DG7-915/961, stale release notes, are the orchestrator's under D-274) | T-I10 at the freeze; A28 archive listing and register byte check at the seal |
| REQ-S20-031 | test-level index DG0–DG6; pre-freeze r2 unit and integration exit 0; QA r2 e2e/visual in en and ar, keyboard walkthrough 2/2 | stated, not hidden: QA r2 full unit run had 1 load failure (A13 READY test, 3/3 on rerun); QA r2 integration had 10 failures (F-DG7-962, BE-R7) | DG7 section of the test-level index after the final round |
| REQ-S21-002 | QA r2 e2e in chromium-en and chromium-ar with audit; D-250 O2 records the only change to an approved contract | none | the DG7 gate's reviewed en/ar end-to-end run, and the auditor's check of reopen records |
| REQ-S21-003 | payload and history secret scans exit 0 (pre-freeze r2); release-notes secret scan; 412/412 IMPLEMENTED with 23 markers | none further (every unmet clause is disclosed in its row) | auditor's check that the regenerated release notes list every disclosure and later clause; T-I10/T-I13 on the frozen register |
| REQ-S21-004 | A02, A06, A18 evidence; QA r2 root e2e and the A23 validator tests | none | A23 on the DG7 candidate |

## 3. Checks run (container, Node 24.21.0, `MTH_PNPM_OFFLINE=1`; logs in `T-DG7-AN-P7F-evidence/`)

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` (before the register edit) | `PASS gate DG6 (historical)`, exit 0 | `01-validate-historical-DG6-before.log` |
| 2 | `node tools/gates/validate.mjs --register DG7` (first attempt after the edit) | FAIL, exit 1, 1 problem: a cited evidence file (`04-laterclauses.log`) did not exist yet. It was created by check 4, then check 3 was re-run | overwritten by check 3 (stated here) |
| 3 | `node tools/gates/validate.mjs --register DG7` | `PASS register rules at DG7`, exit 0 | `03-register-DG7-after.log` |
| 4 | T-I13 parser: `laterClauseOf`, `MARKER`, `Q19_ROWS` from `tools/release/release-notes.mjs` and `parseRegister` from `apps/api/scripts/register-snapshot.mjs`, run over the register. Script in scratch; its source is not in the repository; what it checks is printed in the log | exit 0. 23 marked rows (the 6 Q19 rows ∪ the 18, with REQ-DLV-039 in both); each has exactly one marker, is IMPLEMENTED, has a non-empty clause and is in the expected set; status counts `{"IMPLEMENTED":412}`; DG7-final rows 54, none below IMPLEMENTED | `04-laterclauses.log` |
| 5 | `node --test tools/release/tests/release-notes.test.mjs` (T-I11 on the tree's register, T-I13 fixture half) | 9/9, exit 0 | `05-release-notes-tests.log` |
| 6 | `node tools/release/release-notes.mjs … --out $TMPDIR/w/release-notes.md --write` (scratch output only) | exit 0: "0 unfinished item(s), 23 later clause(s)" | `06-release-notes-scratch.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (ran before this handback existed); `npx prettier --check` on this handback and `requirements.csv` afterwards: clean; re-run at the end: see check 16 | `11-prettier.log` |
| 8 | `pnpm lint` | exit 0 | `12-lint.log` |
| 9 | `pnpm openapi:lint` | exit 0 | `13-openapi-lint.log` |
| 10 | `pnpm -r typecheck` | exit 0 | `14-typecheck.log` |
| 11 | `pnpm test` | **exit 1, a sandbox refusal, not a test result**: Vitest could not write `node_modules/.vite-temp` (EROFS; the analyst's sandbox makes `node_modules` read-only). No test ran | `15-pnpm-test.log` |
| 11b | The same three projects as `pnpm test`, each via `npx vitest run --configLoader runner --project <p>` (no temp config file) | unit-node 3041 passed, 1 failed; unit-web 2199/2199; unit-formula-nocodegen 259 passed, 2 skipped; exit 1. The one failure is EROFS again: `a20-p6-token-contrast.test.ts` writes `test-results/qa-a20/` | `15b-pnpm-test-projects-configloader-runner.log` |
| 11c | That test alone, with `QA_EVIDENCE_DIR=$TMPDIR/qa-a20` | 4/4, exit 0 | `15c-a20-contrast-rerun-scratch-evidence.log` |
| 12 | `node --test tools/release/tests/check-handover.test.mjs tools/release/tests/release-notes.test.mjs` | 60/60, exit 0 | `16-release-tool-handover-tests.log` |
| 13 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/release apps/api/test/integration/contract` | attempt 1: exit 1, EROFS on `node_modules/.vite-temp`, no test ran | `20a-integration-attempt1-EROFS.log` |
| 13b | the same with `--configLoader runner` (disposable PostgreSQL 16.15, 135 migrations) | 5 files, 244 tests passed, exit 0. Covers the register and About endpoints that read the tree's register, and the contract and response-validation suites | `20-integration-release-contract.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG6` (after the edit) | `PASS gate DG6 (historical)`, exit 0 | `17-validate-historical-DG6-after.log` |
| 15 | Diff scope: `git diff -U0 docs/delivery/requirements.csv` | exactly the 18 assigned ids changed, one line each | (command output in this session; see §1) |
| 16 | Final full prettier check and `--register DG7` after this handback | prettier exit 0, register PASS exit 0 | `18-final-checks.log` |

About `pnpm test` (checks 11 and 11b): in this sandbox the literal command exits 1, for an environment reason only. The analyst's sandbox does not let me make it exit 0: writes to `node_modules/` and `test-results/` are refused. With those two writes moved out of the way (11b, 11c), every unit test passes. I report the literal check as **not passed (BLOCKED by the sandbox)**. It should be re-run in a writable checkout (the orchestrator's pre-freeze run). No test can be affected by this pass's change except those that read the register; checks 5, 12 and 13b cover them.

## 4. Known gaps

- **Release notes and known-limitations are now stale against the register.** Their regeneration is the orchestrator's job under D-274 (F-DG7-915, F-DG7-961; my write scope excludes `docs/handover/`). The scratch run in log 06 shows what they will show: 0 unfinished items and 23 later clauses. Until the orchestrator runs `release-notes.mjs --write` and `--check`, a `--check` on the repository file fails. The regenerated notes must also show the six DG7 C3 hits, not five.
- **The disclosures are not decisions.** REQ-DLV-008, -011, -012, -024, -030 and -039 are IMPLEMENTED under D-274 with deviations that are disclosed, not met. The release-auditor judges them, and each row says so. A rejection BLOCKS the gate (D-274).
- **Cited evidence comes from round 2 on candidate ca38b65e and from pre-freeze r2.** Round 3 will be on a new candidate (this pass, BE-R7, DO-D8 and the orchestrator's regenerations change candidate files). The markers name the frozen-candidate runs that are still due.
- The REQ-DLV-012 note relies on QA's reading that FE-C3 lacks merge instructions (`14-protocol-c3-fe-c3.log`). I did not re-run the protocol audit; that rerun is the orchestrator's (D-274).

## 5. Open questions

1. REQ-DLV-012: should the sixth C3 hit (FE-C3, after D-270) be covered by D-270's disclosure, or does it need its own user decision? D-270 names five. I recorded it as disclosed and pointed to F-DG7-960. The release-auditor or the user decides.
2. REQ-DLV-008's notes previously said, per p7-work-split §J.1, that "a hit of C4 in DG7 is a DG7 finding, not a disclosure". C4 passes. The unmet clause comes from the C2 assignment hits, so I treated it under D-270 like REQ-DLV-011. Please confirm this reading.

## Merge instructions

Merge only `docs/delivery/requirements.csv` and this handback with its evidence. No migration, no code, nothing to order. Then, before the round-3 freeze, the orchestrator runs:
- `release-notes.mjs --write` and `--check`;
- the known-limitations regeneration;
- the protocol-audit rerun (D-274).

Expect a conflict only if another task edits the same 18 register lines.
