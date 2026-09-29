# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **Active stage:** P0 / DG0, state **FIXING** (round 18 reviewed; round 19 not yet frozen). **F-DG0-145 (High) — the write-guard TOCTOU the user asked to fix — is CLOSED_VERIFIED** (D-030).
- **Round-18 outcome:** domain **PASS**; code-security **FAIL** — new **F-DG0-152 (High, mandatory)**: cross-run isolation break (a run could write into a concurrent run via `/proc/<peer-pid>/root|cwd` and signal it, because the sandbox shares the host PID namespace + binds rw host `/proc`); plus **F-DG0-153 (Low)** doc wording; F-DG0-150/151 **CLOSED_VERIFIED**, F-DG0-147 re-accepted, F-DG0-149 re-assessed read-only (stays OPEN, residual-7 observation). QA **hit the account session limit again** (resets 21:10 UTC) after writing its sidecars (verified 236/237 PASS, raised **F-DG0-239** Low doc) but **before** its verdict record → not bindable; 236/237 stay pending and are re-verified in round 19.
- **F-DG0-152 fixed in code (D-033):** each run enters its own scope-only **Landlock** domain (`landlock_exec.py`, after `setpriv`, before `claude` execs; `handled_access_fs=0`, `handled_access_net=0`, `scoped=SIGNAL|ABSTRACT_UNIX_SOCKET`, ABI 7). Sibling domains can't ptrace each other → cross-run `/proc/<peer>/root|cwd` and signals refused; own areas + nested bwrap still work; fail-closed if Landlock is unavailable. Committed `5647a29` (pre-rewrite SHA); tested (process-sandbox 10/10 incl. a positive-control cross-run test; validator 47/47; full suite green). Matches the reviewer's own round-18 spike. F-DG0-153 (threat-model row 1) and F-DG0-239 (agents.md) doc wording also fixed.
- **🔴 GATE BLOCKER — write-once history poisoning (round 17):** `checkWriteOnce` (rules.mjs:678, in the gate path) fails with 6 errors: commit `0947a8b` (round-17 outcome, ancestor of HEAD) **deleted** the round-17 QA sidecars that its own auto-commit (`e9a00fd`) had committed. The write-once invariant permits **no** delete/modify events under `reviews/DG0/**` ever, so DG0 **cannot pass its gate** until this is corrected. The correct fix is a git history rewrite (filter-branch over `0947a8b^..HEAD`) that **un-deletes** those two files (restoring evidence, losing nothing) + a force-push. **The auto-mode safety classifier denies this as "Git Destructive."** It needs a user permission rule (as with the earlier bwrap decision) or a user decision on how to proceed. Root cause hardened regardless: `import-findings.mjs` now **skips** an interrupted run's record-less verifications instead of throwing, so no one is ever forced to delete committed review evidence again (that throw is what drove the round-17 mishap).
- **Findings ledger (after round-18 import):** CLOSED_VERIFIED: F-DG0-145 (High), 146, 148, 150, 151. FIXED_PENDING_VERIFICATION: F-DG0-236/237 (re-verify round 19). ACCEPTED_OBSERVATION: F-DG0-147. OPEN: **F-DG0-152 (High — fixed in code `5647a29`, not yet marked FIXED pending the write-once rewrite so `fix_revision` lands on a stable SHA)**, F-DG0-153 + F-DG0-239 (Low, fixed in code), F-DG0-149 (Low residual-7 observation).
- **Repairs since round 15:** D-030 (process sandbox), D-031 (staging-seed copy-back + `--unshare-ipc`), D-032 (write-once-collision crash + docstring), D-033 (per-run Landlock domain, F-DG0-152).
- **Next action (blocked on the user):** resolve the write-once history poisoning (git rewrite permission or an alternative the user chooses). Then: mark F-DG0-152/153/239 FIXED at the post-rewrite D-033 SHA, freeze the round-19 candidate (includes D-033), run the three round-19 reviews + release audit → DG0 gate decision.

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
