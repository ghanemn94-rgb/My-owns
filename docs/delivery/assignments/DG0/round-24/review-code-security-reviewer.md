# DG0 assignment: code-security-reviewer (round 24)

Read `docs/delivery/assignments/DG0/round-24/review-common.md` first. Task ID: `T-DG0-REV-SEC-R24`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-040 change (this round's delta) — verify the closure binding is correct and complete.** Read `git diff 6438e20c076359ff5eda879f1e31ff6fbda0b57f..6db3b8388699b767032b4f92547ceb79edf74519 -- tools/gates/lib/rules.mjs`:
   - **checkClosure run-head binding (F-DG0-166/249):** confirm a CLOSED_VERIFIED `fix_revision` must be an ancestor of the **verifying run's `head_commit_at_start`** (which checkInvocation forces present + 40-hex + containing the manifest) AND the gate candidate, and that the round's self-declared `source_commit` is no longer used for the round-side check. Try your round-23 forge again (a superseded round with a non-existent `source_commit`, a genuine verifier run, and a `fix_revision` committed after that run started but present in the gate candidate): it must now be rejected as "not in the verifying run's starting history". Confirm no genuine closure regressed (every real closure's fix is an ancestor of its verifier's head on the complete history).
   - **Comments (F-DG0-014/167):** confirm the `commitPresent()` and `findManifest` header comments now describe the strict model (only `findManifest` tolerates a genuinely-absent commit, content-preservingly).
   - Confirm no *new* gap: the single surviving absence tolerance is `findManifest`'s (round 18), still requiring the manifest entries to hash to its `candidate_id`; the immutable-field lock (F-DG0-165) and the absent-fix/head rejections (F-DG0-164/246) still hold.
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-24/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
