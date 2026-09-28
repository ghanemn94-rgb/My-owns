# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **Active stage:** P0 / DG0, state **REVIEWING** (round 15 in progress). **Blocked on a user decision for F-DG0-145; see below.**
- **Round-15 candidate:** `sha256:b7f60ed34dd77f93ca454edb545da1cee8e9cd7cdb649b5ad3895c454abddb5e` (commit `7fab49c`)

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
| 12 | (orphaned: stub false positive; run PASS) | FAIL | FAIL (run exit 1; does not bind) | 5: 140 Critical (runner imports planted modules), 229 Medium, 230/231/232 Low |
| 13 | PASS | FAIL | FAIL (Low only) | 5: 141 High (sandbox wrapper cloned into agent-writable `$TMPDIR`), 012/142/233/234 Low; 231 reopened |
| 14 | PASS | FAIL | PASS (Low) | 3: 143/144 Medium (guard fail-open via /proc; shared $TMPDIR, demonstrated by an unintended cross-agent incident), 235 Low |
| 15 | PASS | FAIL | (running) | 145 High (guard check-then-use: symlink swap between hook check and Write), 146 Low (sandbox stubs perturb working-tree candidate; fails closed) |

- **Open blocker: F-DG0-145 (High, mandatory).**
  - **The finding.** The file-tool write guard is a PreToolUse check, and Claude Code's Write tool runs unsandboxed. An agent's own sandboxed shell can swap a symlink between the check and the write. Code-security showed this live once in 11 attempts, and 236 of 600 times offline.
  - **Planned fix: run the whole agent process inside an outer bubblewrap.** Its writable areas would be the role's scope, the run's private `TMPDIR` and the CLI's session store, so the kernel refuses forbidden writes whichever tool makes them.
  - **Experiment 1.** The CLI and its Write tool work under such a sandbox with a read-only home. Bash needs the environment's process cgroup to be writable.
  - **Experiment 2 (the follow-up) was refused by the session's auto-mode classifier**, as credential-related. It is not retried in any form.
  - **Options for the user:**
    1. Allow that experiment, so the outer-sandbox fix can be built and tested.
    2. Choose a detection-based alternative: post-run integrity checks of protected paths, and re-scoping F-DG0-145's control in the threat model from "prevented" to "detected". The reviewers would then judge it against the revised model.
    3. Another approach.
- **Also pending:**
  - F-DG0-146 (Low; fails closed).
  - The QA round-15 result.
  - An orchestrator-observed latent issue: a sandbox stub at `test-evidence/<stage>/audit` could block a reviewer's first `mkdir` in a new stage. Fix: the runner pre-creates the four evidence directories.
- **Findings:** 77 closed and verified after round 15's code-security and domain verifications. F-DG0-145 and 146 are open, and F-DG0-235 awaits QA.

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
