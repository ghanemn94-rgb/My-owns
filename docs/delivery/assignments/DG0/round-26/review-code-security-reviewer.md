# DG0 assignment: code-security-reviewer (round 26)

Read `docs/delivery/assignments/DG0/round-26/review-common.md` first. Task ID: `T-DG0-REV-SEC-R26`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-042 change (this round's delta) — verify anchor 1 is now unconditional.** Read `git diff 2386a0fbd0795f3f09ec2802112e84fae2d616f9..7edacdc28dd745d8e155402de26416ef89f56faf -- tools/gates/lib/rules.mjs`:
   - **checkClosure unconditional anchor 1 (F-DG0-169):** confirm a closure verified in a round whose frozen `source_commit` does **not** resolve is now REJECTED ("must be verified against a retained candidate"), not skipped — so your round-25 case (a candidate-scope fix committed after an absent-`source_commit` round's freeze) no longer closes. Confirm the three anchors (frozen round candidate, verifying run head, gate candidate) are all enforced with no metadata-tolerance skip, and that the header comment states the guarantee accurately.
   - Confirm no genuine closure regressed: every real closure has a present round `source_commit` (the census showed 0/114 skip anchor 1; round 18's closures were re-verified in retained rounds), so the dry-run reports no "frozen candidate ... is not present" error.
   - Confirm no *new* gap: the single surviving absence tolerance is `findManifest`'s (round 18's manifest), still requiring its entries to hash to its `candidate_id` — and it can no longer let a closure be *verified* in that round; the immutable-field lock (F-DG0-165), the absent-fix/head rejections (F-DG0-164/246) and the run-head binding (F-DG0-166/249/168) still hold.
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-26/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
