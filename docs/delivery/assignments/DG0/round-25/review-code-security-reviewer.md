# DG0 assignment: code-security-reviewer (round 25)

Read `docs/delivery/assignments/DG0/round-25/review-common.md` first. Task ID: `T-DG0-REV-SEC-R25`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-041 change (this round's delta) — verify the three-anchor closure is correct and complete.** Read `git diff 6db3b8388699b767032b4f92547ceb79edf74519..2386a0fbd0795f3f09ec2802112e84fae2d616f9 -- tools/gates/lib/rules.mjs`:
   - **checkClosure three anchors (F-DG0-168):** confirm a CLOSED_VERIFIED `fix_revision` must be an ancestor of ALL of: (1) the verifying round's frozen `source_commit` when it resolves, (2) the verifying run's `head_commit_at_start`, and (3) the gate candidate — each check enforced, none replacing another. Re-run your round-24 case: a genuine round with a candidate-scope fix committed **after the freeze but before the verifier ran** must be rejected by anchor 1 ("not in the verified round candidate"). Re-run the round-23 forge (a superseded round with a non-existent `source_commit`, a genuine verifier run, a fix committed after the run started): it must be rejected by anchor 2 ("not in the verifying run's starting history"). Confirm no genuine closure regressed (every real closure's fix passes all three anchors on the complete history).
   - **Comment:** confirm the `commitPresent()` header comment now describes the three-anchor model.
   - Confirm no *new* gap: the single surviving absence tolerance is `findManifest`'s (round 18), still requiring the manifest entries to hash to its `candidate_id`; the immutable-field lock (F-DG0-165), the absent-fix/head rejections (F-DG0-164/246) and the run-head binding (F-DG0-166/249) still hold.
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-25/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
