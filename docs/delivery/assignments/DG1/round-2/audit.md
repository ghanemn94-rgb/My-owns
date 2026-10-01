# DG1 round-2: release-auditor

Read `docs/delivery/assignments/DG1/round-2/review-common.md` first. Task ID: `T-DG1-AUDIT-R2`.

The three round-2 specialist records are:
- `docs/delivery/reviews/DG1/round-2/domain-reviewer.json`
- `docs/delivery/reviews/DG1/round-2/code-security-reviewer.json`
- `docs/delivery/reviews/DG1/round-2/qa-verifier.json`

Findings history: `docs/delivery/findings.json` (orchestrator-maintained from reviewer sidecars). `previous_gate: DG0`.

Perform the audit from your agent definition, points 1–7. In particular:
- **Complete clone** (`git rev-parse --is-shallow-repository` = `false`); if shallow, BLOCKED.
- **Candidate identity:** `node tools/gates/candidate.mjs --stage DG1` and `--diff` equal `sha256:991d32417f16984e47da7bb0767bd2e432e2d88b9fb066513dd7fa1761fea8fc` (source `f32c705…`). `node tools/gates/validate.mjs --stage DG0 --historical` still passes (DG0 baseline intact).
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-2 run of the named role in `docs/delivery/runs/DG1/<run_id>/meta.json`; spot-check each `transcript.jsonl.gz`. No reviewer implemented the scope they reviewed (round-2 implementers: solution-architect, backend-workflow-engineer, frontend-ux-engineer, devops-engineer, transformation-analyst, delivery-orchestrator).
- **Findings:** all 25 round-1 findings were `FIXED_PENDING_VERIFICATION`; confirm each is now `CLOSED_VERIFIED` by the relevant reviewer's sidecar on this candidate, OR, for a Low non-mandatory fail-safe observation only, `ACCEPTED_OBSERVATION` with the reviewer's sidecar **and** yours (rationale + owner), listed in the gate's `accepted_observations`. **No** finding left `OPEN` or `FIXED_PENDING_VERIFICATION`; **zero** unresolved Critical/High and zero unresolved mandatory violations. Any new round-2 finding is handled the same way.
- **Requirements:** each of the **12** `final_gate = DG1` requirements is in QA's `requirements_checked` **and** in the domain or code-security reviewer's; `node tools/gates/validate.mjs --register DG1` passes (all 12 IMPLEMENTED with existing evidence).
- **Open decisions:** confirm D-048 (modules built), D-049 (image pinning; keycloak BLOCKED is a documented, test-only, environment-bound residual — not a fabricated or silently-passed check), D-050 (REQ-S16-004 increment) are each either resolved or recorded with a rationale and not silently ignored.

## Round-2 audit specifics
- **Stage state** is set to **VERIFYING** before your run; the three specialist records are in `docs/delivery/reviews/DG1/round-2/` and `findings.json` is updated from them.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox evidence (D-030–D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256` and shows a confined process (read-only root, host-bound procfs, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, landlock per-run), only its own areas, empty `discarded`.

Write `docs/delivery/reviews/DG1/round-2/release-auditor.json`, then the gate record `docs/delivery/gates/DG1.json`, **with Write/Edit only**. Decision APPROVED **only** if every condition holds; otherwise BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/991d32417f16984e.manifest.json`.
- `requirements.final_gate_ids`: the 12 (`REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`).
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
