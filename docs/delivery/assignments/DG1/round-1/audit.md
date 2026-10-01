# DG1 assignment: release-auditor (round 1)

Read `docs/delivery/assignments/DG1/round-1/review-common.md` first. Task ID: `T-DG1-AUDIT-R1`.

The three specialist records are:
- `docs/delivery/reviews/DG1/round-1/domain-reviewer.json`
- `docs/delivery/reviews/DG1/round-1/code-security-reviewer.json`
- `docs/delivery/reviews/DG1/round-1/qa-verifier.json`

Findings history: `docs/delivery/findings.json` (maintained by the orchestrator from reviewer sidecars). `previous_gate: DG0`.

Perform the audit from your agent definition, points 1–7. In particular:
- **Confirm a COMPLETE clone** (`git rev-parse --is-shallow-repository` = `false`); if shallow, BLOCKED.
- **Candidate identity:** `node tools/gates/candidate.mjs --stage DG1` and `--diff` equal `sha256:7fcc4943694dc9d7...` (source `85e5bbd6...`). `node tools/gates/validate.mjs --stage DG0 --historical` still passes (the DG0 baseline is intact).
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful run of the named role in `docs/delivery/runs/DG1/<run_id>/meta.json`, from a sandboxed run; spot-check each `transcript.jsonl.gz` to confirm real inspection of the candidate. No reviewer implemented the scope they reviewed (implementers are solution-architect, backend-workflow-engineer, frontend-ux-engineer, devops-engineer, transformation-analyst, delivery-orchestrator).
- **Requirements:** each of the **12** `final_gate = DG1` requirements is in QA's `requirements_checked` **and** in the domain or code-security reviewer's; `node tools/gates/validate.mjs --register DG1` passes (all 12 IMPLEMENTED with existing evidence).
- **Findings:** no unresolved Critical/High findings and no unresolved mandatory violations; no finding left `OPEN` or `FIXED_PENDING_VERIFICATION`. A Low, non-mandatory, fail-safe observation may be accepted only with the relevant reviewer's sidecar **and** yours (`status_after: ACCEPTED_OBSERVATION`, with rationale + owner), listed in the gate's `accepted_observations`.
- **Open items:** confirm D-047 (REQ-S16-003 scope) and the contract items (BE 400/403-vs-422; FE `/auth/options`) and DevOps flags are either resolved or accepted by the relevant reviewer with a recorded rationale — not silently ignored.

Write your audit record `docs/delivery/reviews/DG1/round-1/release-auditor.json`, then the gate record `docs/delivery/gates/DG1.json`, **with Write/Edit only**. Decision APPROVED **only** if every condition holds; otherwise BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/7fcc4943694dc9d7.manifest.json`.
- `requirements.final_gate_ids`: the 12 (`REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`).
- `tests`: the key executed checks with existing evidence paths.

## Round-1 audit specifics
- **Stage state** is set to **VERIFYING** before your run; the three specialist records are in `docs/delivery/reviews/DG1/round-1/` and `findings.json` is imported from them.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox evidence (D-030–D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256` and shows a confined process (read-only root, host-bound procfs, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, landlock `per_run_domain: true`), only its own areas, empty `discarded`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
