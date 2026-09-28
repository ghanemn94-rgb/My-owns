# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **Active stage:** P0 / DG0, state **REVIEWING**. The round-12 findings are repaired; round 13 is next.
- **Round-12 candidate:** `sha256:21f142b863c445f69e437385c4118a93fcb84117a9b774fc1a3e659ee047b21c` (commit `7f09967`)

**Review history**

| Round | domain | code-security | QA | New findings |
|---|---|---|---|---|
| 1 | FAIL | BLOCKED (classifier outage) | FAIL | 17 (2 High) |
| 2 | PASS | FAIL | FAIL | 11 (1 High) |
| 3 | PASS | FAIL | PASS | 7 (1 High) |
| 4 | PASS | FAIL | PASS | 7 Low; 115 reopened |
| 5 | FAIL | (orphaned: runner bug) | (orphaned) | 1 |
| 6 | FAIL | FAIL | FAIL | 5 (bytecode in candidate; 115 back-dating residual) |
| 7 | PASS | FAIL | PASS | 4 (132 High: empty-transcript bypass). D-022 prompt-binding defect found by the orchestrator |
| 8 | PASS | PASS | PASS | 1 Low (path with space) |
| 9 | PASS | FAIL | PASS | 2 (134 Medium: worktree guard bypass) |
| 10 | PASS | FAIL | PASS | 3 (135/136 Medium: guard fail-open, user settings) |
| 11 | PASS | FAIL | FAIL | 6 (137 High, 226: shell bypasses of the guard). Led to the §0.4 root-cause response: D-025 (OS Bash sandbox) and `threat-model.md` |
| 12 | (orphaned: stub false positive; run PASS) | FAIL | FAIL (run exit 1, account session limit; does not bind) | 5: 140 Critical (runner imports planted modules), 229 Medium (pre-freeze imports planted bytecode), 230/231/232 Low |

- **Findings:** 64 closed and verified, 5 open (F-DG0-140, 229, 230, 231, 232).
  - The round-12 QA closures of F-DG0-226, 227 and 228 come from a run that ended in error. The validator rejects them (`checkInvocation`: "did not complete successfully"), so QA re-verifies them in round 13.
- **Round-12 repairs (D-026):**
  - The orchestrator never executes agent-writable code outside a sandbox. The runner's Python helpers run as `python3 -I -B` from `/`.
  - The pre-freeze runs candidate code only through `tools/gates/sandbox-run.sh`.
  - The validator binds the sandbox deny list to the run's own directory.
  - Docs now say `$TMPDIR` rather than `/tmp`.
  - The config scan ignores the sandbox's zero-length stubs.
  - CI installs bubblewrap. The CI step is unverified until a hosted run reports.
- **Next:**
  1. Mark the fixes: `import-findings.mjs --fix` for F-DG0-140, 229, 230 and 231.
  2. The analyst task T-DG0-ANA-R12 for F-DG0-232 (register rows citing D-025/D-026 controls).
  3. Run the pre-freeze and freeze round 13.
  4. Run the three reviews: domain (full review), code-security (verifies 140), and QA (verifies 226–232).
  5. If all PASS: VERIFYING, then the release audit, then APPROVE DG0.
  6. Then P1: the architecture assignment `docs/delivery/assignments/DG1/T-DG1-ARCH-01.md`.

## Done in P0 so far

- Located the authoritative source (a session upload), committed it, and made the extraction reproducible: `tools/source/check_extraction.sh` passes.
- Saved the master prompt v2.0 verbatim and split it into 423 anchored blocks.
- Wrote the ten project agent definitions. The invocation mechanism was verified; see `docs/delivery/agents.md` and decision D-003.
- Built the role write guard and its tests (8/8 pass).
- Built the gate tooling: schemas, candidate hashing, validator (`--stage`, `--historical`, `--pipeline`, `--register`, `--reconcile`) and self-tests (15/15 pass).
- Added the CI workflow `.github/workflows/delivery-gates.yml`.
- Wrote delivery records: environment, protocol, register spec, decisions, stages, findings.

## In flight

| Task | Agent | Status |
|---|---|---|
| T-DG0-AN-01: playbook → REQ-PB (92 rows), source coverage (165/165), glossary, field inventory | transformation-analyst | **done** (handback committed) |
| T-DG0-LOAD: load and guard check of all ten agents | all ten | **done**: 10/10 loaded, 10/10 out-of-scope writes blocked |
| T-DG0-AN-02: master prompt §1–§13 | transformation-analyst | running |
| T-DG0-AN-03: preamble, §0 and §14–§21 | transformation-analyst | running |
| P1 stack discovery (read-only, not a delivery task) | built-in research workflow agents | running |

**Deviation, recorded honestly:** during this step, 2 delivery agents and 4 read-only research agents ran concurrently, which is above the §0.2 default of 4 active workers. The research agents write nothing to the repository. No resource contention was observed on the 4 vCPU / 15 GiB host.

## Next actions

1. **AN-02:** master prompt §1–§11 → requirements, coverage, permissions matrix, user journeys.
2. **AN-03:** preamble, §0 and §12–§21 → requirements, coverage, acceptance map, stage plan.
3. **AN-04:** merge the parts into `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv`, then run `validate.mjs --register DG0`.
4. Freeze the DG0 candidate, then run the three independent reviews (domain, code-security, QA) followed by the release audit.

## Unresolved blockers

None yet.
