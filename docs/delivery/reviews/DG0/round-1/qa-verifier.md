# DG0 round 1: qa-verifier narrative

- **Task:** T-DG0-REV-QA-R1.
- **Invocation:** `DG0-T-DG0-REV-QA-R1-qa-verifier-20260928T123232Z`, session `a0c0e915-55fd-410c-a91c-c7da445a8c76`.
- **Candidate:** `sha256:dea5e75a8c5fe118a9390b8768afb73cf08429d7ed4bdbde37054701eab660af`, source commit `26642c7`. HEAD is `4f493c3`, which is one metadata-only commit later; I recomputed the candidate ID and it is identical.
- **Verdict: FAIL.** One Medium mandatory gap (F-DG0-201) and two Low observations (F-DG0-202, F-DG0-203).

Independence: I authored nothing in scope. I formed this verdict before any other round-1 record existed for me to read, and I didn't open the domain-reviewer files that appeared during the round. I executed code only in the disposable worktree `/tmp/review-dg0-qa` or in temp-dir fixtures. That worktree is removed at the end of the review.

## 1. Assigned commands (all run, all exit 0)

| # | Command | Result |
|---|---|---|
| 01 | `tools/source/check_extraction.sh` | PASS: docx sha256 matches; 165 B blocks and 423 M blocks |
| 02 | `node --test tools/gates/tests/*.test.mjs` | 15/15 pass |
| 03 | `node --test tools/agents/tests/*.test.mjs` | 8/8 pass |
| 04 | `validate.mjs --register DG0` | PASS |
| 05 | `validate.mjs --pipeline` | PASS (DG0 REVIEWING active) |
| 06 | `validate.mjs --reconcile` | Working tree matches the frozen candidate; round-1 records missing or STALE (expected at that time) |
| 07 | `candidate.mjs --stage DG0` | `sha256:dea5e75a…` (70 files) |

Logs: `docs/delivery/test-evidence/DG0/qa/01…07-*.log`.

## 2. Independent A24/A25 negative tests

The test file is `docs/delivery/test-evidence/DG0/qa/tests/dg0-gate-negative.test.mjs` and the log is `10-qa-negative-tests.log`. It uses only `node:test` and is ready for promotion to `tests/qa/dg0/`. It has its own disposable-git fixture builder and is run with `QA_REPO_ROOT` pointing at the candidate's tooling.

29 tests: 27 pass and 2 fail. The two failures are genuine product findings, not test defects.

**Passing:**
- **Missing reviewer:** a missing record file, the qa slot filled with the domain record, a missing audit.
- **Authorship:** the auditor listed as an author.
- **Shared invocation:** a reviewer and the auditor sharing one invocation; one session behind two run IDs; an errored run.
- **FAIL and BLOCKED:** a FAIL check; a BLOCKED verdict; a BLOCKED gate test; missing gate test evidence.
- **Unresolved findings:** an unresolved OPEN High; a High filed as an accepted observation; CLOSED_VERIFIED without verification; a dangling finding reference.
- **Incomplete requirements:** a BLOCKED DG0 row; a row with empty or missing evidence; a `final_gate_ids` mismatch; a row unchecked by domain or security; a PLANNED row.
- **Anchors:** non-existent B9999 and M0424; malformed B12; a SOURCE row with only M blocks; a REQ-PB id on a USER row.
- **Coverage matrices:** a missing M block; a mapping to a requirement that doesn't cite the block; an unknown requirement or block; a duplicate row; a row without rationale; a bad disposition.
- **Changes after freeze:** an added or deleted file; a committed change through the CLI (exit 1).
- **Tampered manifests:** a *self-consistent* forged manifest (entries, ID, gate, stages and reviews all rewritten) is still caught by recompute; a stage or commit mismatch is caught.
- **Metadata:** writes to every excluded metadata area leave the candidate ID unchanged, in both the working tree and HEAD; a stage spec cannot re-include metadata.

**Failing:**
- **QA-N27 (F-DG0-201).** A review can cite *any* successful run of the same role, for example the DG0 LOAD-check run. That run was made for a different task and assignment, and it ran before the freeze. The validator accepts it. Real LOAD runs exist for all four review roles, so the provenance check does not prove that a review invocation took place.
- **QA-N28 (F-DG0-202).** The evidence value `NO-SUCH-EVIDENCE.md` passes, because only entries containing `/` are existence-checked.

Run 1 of the suite had fixture-data errors in my own test (findings-schema `minLength`). I fixed them in the test, and the logged run is the final one.

## 3. Register integrity

Independent script: `tests/register-integrity.mjs`. Log: `11-register-integrity.log`.

**Register: 0 errors.**
- 410 rows, and every row has 19 columns.
- No row is VERIFIED. SPECIFIED 391, IMPLEMENTED 19.
- By class: SOURCE 92, USER 188, ENGINEERING 130.
- By area: PB 92, DLV 41, S01–S21 277.
- By final gate: DG0 19, DG1 11, DG2 32, DG3 31, DG4 137, DG5 76, DG6 50, DG7 54.
- Every A01–A28 scenario is referenced.
- No row's last increment falls after its final gate.

**Coverage matrices.**
- Source coverage has exactly B0001–B0165: 129 REQUIREMENT, 29 CONTEXT, 7 NON-REQUIREMENT.
- Master-prompt coverage has exactly M0001–M0423: 367 REQUIREMENT, 49 CONTEXT, 7 NON-REQUIREMENT.
- Both directions are consistent, with 0 reverse gaps. That means every block anchor a requirement cites is listed against that requirement in the matrix.

**DG0 evidence opened and read.** The 19 DG0 rows are 17 REQ-DLV rows plus REQ-S20-024 and REQ-S20-025.
- The ten agent files have valid frontmatter and a guard hook.
- The runner passes `--agent`, `--model`, a unique `--session-id` and `--settings`, and captures meta, result and transcript.
- I also opened the guard and scopes; the rules, candidate hashing, schemas and importer (the importer merged my sidecar correctly in the disposable worktree); the CI workflow; decisions D-001…D-009; environment, protocol, spec and CLAUDE.md; and the analysis documents.

Each evidence file implements its row, except for the two validator gaps above.

Note: several DG0 evidence entries point at delivery metadata outside the candidate (`stages.json`, `findings.json`, `progress.md`, `runs/`, `test-evidence/`). I accept this, because those are the records the requirements are about.

## 4. Agent setup (§0.1/§0.2)

**Recorded evidence.** Script: `tests/agent-load-evidence.mjs`. Log: `13-agent-load-evidence.log`.
- 10 LOAD runs, each with its own distinct session ID. In each run, the meta, transcript and result session IDs match.
- The init record lists all ten project agents, and the init model is `claude-opus-5-5`. Haiku appears only as the auxiliary model disclosed in `agents.md`.
- Every agent reported its own role.
- The guard blocked the write to `docs/source/LOAD-PROBE-<role>.txt` in 10 of 10 runs. No probe file exists, and the in-scope probe files are present.
- The `agents.md` table matches the raw data.

**Live check.** Log: `12-live-guard-probe.log`. My own Write to `docs/source/QA-PROBE.txt` was BLOCKED. So was a `../` traversal from my allowed evidence directory, which the guard resolved to `docs/source/QA-PROBE2.txt`. Nothing was created.

## 5. Feasibility

Script: `tests/acceptance-feasibility.mjs`. Log: `14-acceptance-feasibility.log`. Result: 0 errors.

- Each of A01–A28 has a REQ-S20 test row whose `final_gate` equals the map's "must pass at" gate.
- Each has a concrete test level, and a first-delivered stage no later than that gate.
- Each "proved" list equals the set of register rows citing the scenario.
- No scenario is untestable.

The stage plan names scenarios only through ranges, and assigns test authorship only in P6. That is later than the DG4/DG5 gates at which A02–A16 must pass (F-DG0-203, Low).

## Findings

| ID | Severity | Mandatory | Owner | Summary |
|---|---|---|---|---|
| F-DG0-201 | Medium | yes | delivery-orchestrator | The invocation reference isn't bound to the review's task/assignment or the freeze time. An unrelated same-role run (for example, LOAD) satisfies provenance. |
| F-DG0-202 | Low | no | delivery-orchestrator | Evidence entries without `/` aren't existence-checked. I'd accept this as an observation. |
| F-DG0-203 | Low | no | transformation-analyst | The stage plan's A-test authorship timing (P6) conflicts with the DG4/DG5 must-pass gates. I'd accept this as an observation. |

**Re-verification needed for F-DG0-201:** QA-N27 must pass. The existing suites and QA-N01…N26 must still pass.
