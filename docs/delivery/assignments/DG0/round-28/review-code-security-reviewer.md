# DG0 assignment: code-security-reviewer (round 28)

Read `docs/delivery/assignments/DG0/round-28/review-common.md` first. Task ID: `T-DG0-REV-SEC-R28`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-044 change (this round's delta) — verify the commit-object requirement.** Read `git diff 49b5ad790443409ec2248097727cd61fd34f42f4..331407e9b6711abbc01f7ee0456e4fa92ff65cda -- tools/gates/lib/rules.mjs`:
   - **Commit-object checks (F-DG0-250):** confirm `checkClosure` rejects a `fix_revision` that is not a commit object (`objectType != "commit"`, e.g. an annotated tag that peels to the fix), and `checkInvocation` rejects a `head_commit_at_start` that is not a commit object. Try forging each with a tag object id (`git tag -a`, then `git rev-parse <tag>`): both must be rejected. Confirm the gate `source_commit` still has its own commit-object rule (D-037/F-DG0-241), so every commit-id field the gate depends on requires a commit object.
   - Re-confirm the standing controls still hold (three unconditional closure anchors, absent/all-zero/malformed rejections, immutable-field lock, shallow refusal). The dry-run reports 0 in every history bucket and no closure/object-type error on genuine records.
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-28/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
