# DG0 assignment: code-security-reviewer (round 27)

Read `docs/delivery/assignments/DG0/round-27/review-common.md` first. Task ID: `T-DG0-REV-SEC-R27`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-043 change (this round's delta) — a COMMENT-ONLY change; verify no behaviour changed.** Read `git diff 7edacdc28dd745d8e155402de26416ef89f56faf..49b5ad790443409ec2248097727cd61fd34f42f4 -- tools/gates/lib/rules.mjs`:
   - **Comment consolidation (F-DG0-170):** confirm the diff touches only the `commitPresent()` header comment (now: "answers presence, states no policy", pointing to `findManifest`/`checkClosure`) and **no executable line**. Confirm the closure model is documented in exactly one place (`checkClosure`), which matches the code: three anchors (frozen round candidate, verifying run head, gate candidate), all unconditional. Grep every anchor/closure comment in `rules.mjs` and confirm none contradicts the code.
   - Re-confirm the standing closure controls still hold (they must, since behaviour is unchanged): a closure verified in an absent-`source_commit` round is rejected (F-DG0-169); a post-freeze fix by anchor 1, a forged-absent-round fix by anchor 2; absent/all-zero `fix_revision` or `head_commit_at_start` rejected; immutable-field lock (F-DG0-165); shallow refusal (F-DG0-160). The dry-run reports 0 in every history bucket and no closure error.
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-27/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
