# DG0 assignment: code-security-reviewer (round 23)

Read `docs/delivery/assignments/DG0/round-23/review-common.md` first. Task ID: `T-DG0-REV-SEC-R23`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-039 changes (this round's delta) — verify the strict validator is correct and complete.** Read `git diff 480cd3ff2b1048439bafebf0bf40151a11d84ea7..6438e20c076359ff5eda879f1e31ff6fbda0b57f -- tools/gates/lib/rules.mjs`:
   - **checkClosure/checkInvocation (F-DG0-164/246):** confirm there is no remaining path that closes a finding with an absent/all-zero/typo'd `fix_revision`, or binds a run with a missing/`unknown`/absent `head_commit_at_start`, whatever the round's `source_commit` metadata says. Try to forge a superseded round (a schema-valid manifest with correct `candidate_id` over its entries + a non-existent `source_commit`, and a stages review-round entry) and confirm it can no longer excuse an absent fix or head. Confirm the only surviving absence tolerance is `findManifest`'s (round 18), and that it still requires the manifest entries to hash to its `candidate_id`.
   - **collectRaisedFindings (F-DG0-165):** confirm a later-round findings sidecar cannot change a finding's `IMMUTABLE_FINDING_FIELDS`; try downgrading `severity`/`mandatory_violation` in a later round.
   - Re-examine whether removing the tolerance created any *new* gap (e.g. a legitimate superseded-round closure that now wrongly fails on the complete history — it should not, since every closure is re-verified against a retained candidate).
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-23/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
