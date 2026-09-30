# DG0 round 20: code-security-reviewer narrative

**Candidate:** `sha256:ef3ec3f2…8ddaf`, commit `a23c4d4`. The candidate ID was recomputed in the working tree and in a fresh clone; HEAD `ce6d9b6` changes metadata only.
**Verdict:** PASS.

## Scope reviewed
The D-036 change set (`0a65201..a23c4d4`) touches four in-scope files: `rules.mjs`, `validator.test.mjs`, `.claude/settings.json` and `threat-model.md`. Everything else in scope (`tools/agents`, `tools/source`, the CI workflow, `.claude/agents`) is byte-identical to the round-19 candidate, which I reviewed in full in round 19.

## Verifications
- **F-DG0-155: CLOSED_VERIFIED.** In current mode, a gate whose `source_commit` does not exist is now rejected. The D-035 tolerance applies only to non-gate rounds in effect, because the gate round's manifest must carry the gate's `source_commit`. Pruned rounds 1–12 are still tolerated.
- **F-DG0-156: CLOSED_VERIFIED.** The only allow rule left is `Bash(bwrap:*)`.
- **F-DG0-154: CLOSED_VERIFIED.** Residual 7 now states its real host-global scope and withdraws the claim that `/proc/sys` is read-only for the agent's shell.
- **F-DG0-149: ACCEPTED_OBSERVATION.** This needs the release-auditor's concurrence. The accepted residual is limited to host availability and kernel tunables:
  - Only the uid-0 DAC-writable subset of `/proc/sys` is reachable.
  - A file tool can reach it only by racing a symlink past the guard's `/proc` refusal.
  - It is inherent to option A.
  - I still recommend a spike that runs the `claude` process at a non-zero uid.

## New finding
- **F-DG0-157 (Low, not mandatory; I accept it as an observation).** Two stale sentences remain after D-036:
  - The `agent_sandbox.py:149-151` comment still says the shell's `/proc/sys` is read-only.
  - A `/proc/<peer>/sys` parenthetical in residual 7 still credits D-033 with a narrowing it does not provide.

## Method note
I did no `/proc/sys` or other `/proc` probing this round. Residual 7 was assessed from the code, the bwrap arguments and the documents only.

## Process note (not a candidate finding)
Two files committed at `a23c4d4` point at round-19 evidence that is not committed at HEAD: `findings.json` and the round-19 review records. That evidence (`docs/delivery/test-evidence/DG0/*/round-19/`) exists only as untracked files in the working tree. The orchestrator should commit it before the gate. The validator's evidence-existence rules would reject it in a fresh clone.
