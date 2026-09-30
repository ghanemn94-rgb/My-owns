# DG0 assignment: code-security-reviewer (round 29)

Read `docs/delivery/assignments/DG0/round-29/review-common.md` first. Task ID: `T-DG0-REV-SEC-R29`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-045 change (this round's delta — you raised F-DG0-171) — verify the completed commit-object class.** Read `git diff 331407e9b6711abbc01f7ee0456e4fa92ff65cda..1e4c0226fc50dc6cc928ce4f16cbf7507afed1ac -- tools/gates/lib/rules.mjs`:
   - **Round source_commit object check (F-DG0-171, your finding; F-DG0-251, qa's — the same residual):** confirm `checkReviewRounds` now computes `objectType(r.source_commit)` and rejects it when the object is **present but not a commit** (a tag/tree/blob), so an annotated-tag object id in `review_rounds[].source_commit` — closure anchor 1, and the source `findManifest` recomputes from, all of which `commitPresent`/`isAncestor`/`manifestFromRef` PEEL — is rejected. Forge a tag-object round `source_commit` in a disposable clone (`git tag -a`, then `git rev-parse <tag>`) and confirm rejection. Confirm the **absent** case stays tolerated (`objectType` returns `null` → the check does not fire → the D-035 content-preserving path governs round 18). This is the fourth and last commit-id field; with the gate `source_commit` (D-037), `fix_revision` and `head_commit_at_start` (D-044) already type-checked, **every** commit-id field the gate depends on now requires a commit object. This is the fix your round-28 F-DG0-171 verification said you would re-verify as CLOSED_VERIFIED; verify F-DG0-171 (reproduce, then show fixed).
   - Re-confirm the standing controls still hold (three unconditional closure anchors, absent/all-zero/malformed rejections, immutable-field lock, shallow refusal). The dry-run reports 0 in every history bucket and no closure/object-type error on genuine records; the census confirms all 27 present round source_commits, all fix_revisions and all present run heads are commit objects.
   Reproduce in a disposable `--no-local` clone; save under `docs/delivery/test-evidence/DG0/code-security/round-29/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (agent shell writes host-global `/proc/sys` directly) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
