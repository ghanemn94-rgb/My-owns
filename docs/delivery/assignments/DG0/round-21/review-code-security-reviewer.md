# DG0 assignment: code-security-reviewer (round 21)

Read `docs/delivery/assignments/DG0/round-21/review-common.md` first. Task ID: `T-DG0-REV-SEC-R21`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of:
- `tools/gates/**` (validator, candidate hashing, schema subset validator, CSV parser, findings import, CLIs, schemas, tests);
- `tools/agents/**` (runner, **process sandbox** `agent_sandbox.py`, `landlock_exec.py`, write guard and scopes, per-role settings, tests);
- `tools/source/**` (docx extraction, master-prompt split, register merge, reproducibility check);
- `.github/workflows/delivery-gates.yml`;
- `.claude/agents/*.md` (frontmatter validity; tool and hook configuration).

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema-subset gaps, wrong glob semantics, exclusions that hide deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance checks satisfiable with fabricated run records, findings statuses that escape the terminal-state rule, register checks that can be dodged, pipeline advancement loopholes, exit codes.
2. **The D-037 changes specifically (this round's delta).** Read `git diff a23c4d411cd4185e56a3f12cf7c1973f7964440b..9e3c27ffe65787f2d510ae5dabf26d271aaae46f -- tools/gates/lib/rules.mjs` and assess whether the new tolerances **weaken** any integrity guarantee:
   - `commitPresent()` in `checkClosure`/`checkInvocation`: confirm a **present** `fix_revision`/`source_commit`/`head_commit_at_start` that fails its ancestry/containment check is still an error, and only a **genuinely absent** commit is tolerated. Try to exploit it: can an attacker make a bad fix pass by pointing `fix_revision` at a non-existent SHA? (It must still be caught by the schema `^[0-9a-f]{40}$` rule and by the fact that a real fix must exist somewhere; a fabricated closure with an absent commit has no verifying sidecar/run and is caught elsewhere — verify this reasoning end to end.)
   - `objectType()` in `checkCandidate`: confirm a gate `source_commit` that is an off-branch commit or an annotated tag is rejected in both modes, and a legitimate on-branch commit passes.
   - `collectVerifications`/`collectRaisedFindings` record-less handling: confirm a sidecar whose `<role>.json` record **exists** but is unlisted is still an error, that a record-less **verifications** sidecar can never close a finding, and that a finding raised only by a record-less findings sidecar cannot inject an unsupported closure into `findings.json`.
   Reproduce your attempts in a disposable clone and save scripts/outputs under `docs/delivery/test-evidence/DG0/code-security/round-21/`.
3. **Write-guard bypasses.** Symlinks inside allowed directories pointing at protected files, `..` segments, case/Unicode tricks, worktree paths, other write-capable tools, fail-open paths, a missing `git` binary. What does the guard not cover (Bash)? Is it disclosed?
4. **Runner and process sandbox (D-030 to D-033).** Ways for an agent process to write outside its role's scope despite the process sandbox (file tools or shell; symlinks; staging copy-back; capabilities; namespaces; mounts). **Assess threat-model residuals 7 and 8 explicitly**, including the D-037 wording of residual 7 (host-global `/proc/sys`, no cross-run amplification distinct from the own-process write; F-DG0-157) — judge whether it is accurate and within the disclosed residual or larger than stated. Verify the per-run Landlock domain (`landlock_exec.py`) and that `sandbox.json` cannot misstate the confinement.
5. **CSV and JSON parsing robustness.** Malformed input causing silent acceptance.
6. **CI workflow.** Least privilege (`permissions`), `fetch-depth` for historical checks, pinned actions, no secret exposure, a failed gate actually failing the job.
7. **Secrets or personal data** committed anywhere in the candidate. The repository must contain no credentials. Confirm `.claude/settings.json` auto-allows only `Bash(bwrap:*)` (no git rewrite rules).
8. **Candidate hash definition** correctness (D-005): determinism, platform independence (path sorting, line endings).

Run the existing tests (`node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`) and **write your own reproduction attempts** for suspected bypasses in a disposable copy. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Requirements to check (record exactly these in `requirements_checked`)
This is the gate round, so you carry the full DG0-final delivery coverage. Check **all 19** DG0-final requirements against the code/config that implements them and confirm each is completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001`, `REQ-DLV-002`, `REQ-DLV-003`, `REQ-DLV-004`, `REQ-DLV-006`, `REQ-DLV-007`, `REQ-DLV-013`, `REQ-DLV-015`, `REQ-DLV-016`, `REQ-DLV-017`, `REQ-DLV-019`, `REQ-DLV-020`, `REQ-DLV-022`, `REQ-DLV-023`, `REQ-DLV-026`, `REQ-DLV-029`, `REQ-DLV-032`, `REQ-S20-024`, `REQ-S20-025`.
List every one you checked. (The validator requires every DG0-final row to be checked by domain **or** code-security, and by qa; qa checks all 19 as well.)
