# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **Active stage:** P0 / DG0, state **REVIEWING** (round 18 running). **F-DG0-145 (High) — the write-guard TOCTOU the user asked to fix — is CLOSED_VERIFIED** (D-030). Rounds 16-17 surfaced only Low findings and one classifier impediment; round 18 aims to close the gate.
- **Round-18 candidate:** `sha256:21efe44b6a4613a004b27282e66db59d42254903e5e2c6e2d0a8398a5e023cc5` (commit `450c756`). Sandboxed pre-freeze 11/11 PASS.
- **The fix (D-030, option 1 + option A):** the whole `claude` process runs in a bubblewrap process sandbox (`agent_sandbox.py`): read-only root, private `/tmp`+`/var/tmp`, read-only `HOME` except a private `~/.claude/projects`, **host-bind procfs, no PID namespace, own IPC namespace**, only `CAP_SETFCAP` + `no_new_privs`; role-scoped writable areas; review/gate/register writes staged and copied back for the role's own files only. In-sandbox symlink race: 0/336 redirected writes landed. Reviewers' nested bwrap works (a fresh `--proc` or a read-only `/proc/sys` submount would break it — the kernel's "fully visible procfs" rule), verified by real-agent probes.
- **Findings ledger:**
  - **CLOSED_VERIFIED:** F-DG0-145 (High), 146, 148 (`--unshare-ipc`).
  - **FIXED_PENDING_VERIFICATION (round 18 verifies):** F-DG0-150/238 (`finish()` O_EXCL write-once-collision crash, fixed D-032), F-DG0-151 (docstring, D-032), F-DG0-236/237 (D-029).
  - **ACCEPTED_OBSERVATION (auditor concurs at gate):** F-DG0-147 (copy-back accept not round-pinned; fail-closed).
  - **F-DG0-149 (Low, residual 7):** the file-tool `/proc/sys` write residual is **inherent** to option A (can't be fixed without breaking nested bwrap) → to be accepted as an observation. Round-17 code-security's re-assessment was stopped by the safety classifier; round-18's assignment asks for a **read-only** assessment (mount config + capabilities + `test -w` + the guard's `/proc` block), no sysctl write.
- **Repairs applied since round 15:** D-030 (process sandbox), D-031 (staging-seed copy-back + `--unshare-ipc`), D-032 (write-once-collision crash + docstring).
- **Round-16/17 interruptions (recorded honestly):** round-16 qa timed out; round-17 qa hit the account session limit (reset 15:30 UTC) before its record — both re-run. code-security's round-16 copy-back exit-73 was a concurrency false positive, fixed by D-031.
- **Next action:** on round-18 completion, commit each reviewer's evidence, import findings, and — if three PASS with 150/151/236/237 CLOSED and 147/149 accepted and no unresolved Critical/High or mandatory — run the release-auditor to record the DG0 gate decision.

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
| 15 | PASS | FAIL | PASS (Low: 236, 237) | 145 High (guard check-then-use: symlink swap between hook check and Write), 146 Low (sandbox stubs perturb working-tree candidate; fails closed) |

- **Open blocker: F-DG0-145 (High, mandatory).**
  - **The finding.** The file-tool write guard is check-then-use. An agent's shell can swap a symlink between the hook's check and the unsandboxed Write.
  - **The user chose option 1 (2026-09-29):** a kernel-enforced outer sandbox around the whole agent process.
  - **Its required experiment is refused by the session's auto-mode safety classifier.** A chat approval does not lift that. It needs a permission rule in the user's Claude Code settings, and the orchestrator does not retry or work around the refusal.
  - **Waiting for the user** either to add that rule or to choose option 2 (detection-based: post-run integrity checks, with the threat-model control re-scoped to "detected").
- **Done meanwhile (D-029):** F-DG0-146, 236 and 237 were fixed at `fe722c8`, pending verification. Sandbox stubs no longer perturb the working-tree candidate. The runner pre-creates the evidence and gate directories. The threat-model wording is exact.
- **Findings:** 77 closed and verified. F-DG0-145 (High) is open. F-DG0-146, 236 and 237 are fixed and pending verification.

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
