# DG0 assignment: code-security-reviewer (round 18)

Read `docs/delivery/assignments/DG0/round-18/review-common.md` first. Task ID: `T-DG0-REV-SEC-R18`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of:
- `tools/gates/**` (validator, candidate hashing, schema subset validator, CSV parser, findings import, CLIs, schemas, tests);
- `tools/agents/**` (runner, **process sandbox** `agent_sandbox.py`, write guard and scopes, per-role settings, tests);
- `tools/source/**` (docx extraction, master-prompt split, register merge, reproducibility check);
- `.github/workflows/delivery-gates.yml`;
- `.claude/agents/*.md` (frontmatter validity; tool and hook configuration).

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema-subset gaps, wrong glob semantics, exclusions that hide deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance checks that can be satisfied with fabricated run records, findings statuses that escape the terminal-state rule, register checks that can be dodged, pipeline advancement loopholes, exit codes.
2. **Write-guard bypasses.** Symlinks inside allowed directories pointing at protected files, `..` segments, case or Unicode tricks, worktree paths, other write-capable tools (for example `NotebookEdit`, `MultiEdit`), fail-open paths in the hook command, and a missing `git` binary. Also the policy question: what does the guard not cover (Bash)? Is that disclosed?
3. **Runner and process sandbox (D-030).** Ways for an agent process to write outside its role's scope despite the process sandbox (file tools or shell; symlinks; staging copy-back; capabilities; namespaces; mounts); whether the copy-back can be abused to plant or replace another role's files; whether `sandbox.json` evidence can misstate the confinement. **Assess threat-model residuals 7 and 8 explicitly** (D-030, chosen by the user): the process sandbox binds the host procfs read-write and creates no PID/IPC namespace, so (7) a file tool could write a uid-0-writable `/proc/sys` entry (directly or via a symlink race), and (8) the agent shares the host PID/IPC namespaces. Judge whether each stays within the disclosed residual (availability / host-tunable, not repository or gate integrity) or is larger than stated; propose a narrower mitigation if you have one. Shell injection via arguments or assignment content; the permission mode (must not weaken controls); session-ID uniqueness; model pinning; evidence integrity (meta/result/transcript); exit-code propagation.
4. **CSV and JSON parsing robustness.** Malformed input causing silent acceptance.
5. **CI workflow.** Least privilege (`permissions`), `fetch-depth` for historical checks, pinned actions, no secret exposure, and whether a failed gate actually fails the job.
6. **Secrets or personal data** committed anywhere in the candidate. The repository must contain no credentials.
7. Candidate hash definition correctness (decision D-005), including determinism and platform independence (path sorting, line endings).

Run the existing tests (`node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`) and **write your own reproduction attempts** for suspected bypasses in a disposable copy (`git clone <repo> "$TMPDIR/dg0-sec"`, or a temp dir). Save the reproduction scripts and outputs under `docs/delivery/test-evidence/DG0/code-security/`. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

Requirements you verify: the `REQ-DLV-*` rows about the gate validator, candidate identity, write guard/scopes, runner/invocation evidence and CI enforcement (the rows with `final_gate` DG0 in the DLV area that concern these). List exactly those you checked.
