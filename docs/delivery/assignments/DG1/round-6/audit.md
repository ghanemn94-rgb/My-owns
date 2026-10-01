# DG1 round-6: release-auditor
Read `docs/delivery/assignments/DG1/round-6/review-common.md` first. Task ID: `T-DG1-AUDIT-R6`.
Specialist records: `docs/delivery/reviews/DG1/round-6/{domain-reviewer,code-security-reviewer,qa-verifier}.json`. Findings: `docs/delivery/findings.json` (`previous_gate: DG0`).

Audit from your agent definition, points 1-7:
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** `candidate.mjs --stage DG1` (and `--diff` if available) equal `sha256:a7b46fbc29db6bb855495593e43f2e859305dea9d6c403fe86f73619d9fb210d`. `validate.mjs --stage DG0 --historical` passes.
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-6 run; spot-check each transcript. No reviewer implemented the round-6 repairs (F-DG1-125 was T-DG1-BE7 / backend-workflow-engineer; F-DG1-126 the delivery-orchestrator).
- **Findings:** EVERY finding `CLOSED_VERIFIED` by the relevant reviewer on this candidate (or, Low non-mandatory fail-safe only, `ACCEPTED_OBSERVATION` with reviewer + your sidecar, rationale + owner, in `accepted_observations`). In particular **F-DG1-125** and **F-DG1-126** must be `CLOSED_VERIFIED` on candidate `a7b46fbc…`. **No** finding `OPEN`/`FIXED_PENDING_VERIFICATION`; zero unresolved Critical/High; zero unresolved mandatory violations. The rounds 2-5 reopen→re-fix history is expected.
- **keycloak (F-DG1-108/203):** node/postgres/playwright pinned by digest; CI resolves missing digests at runtime; keycloak (quay.io, denied here) is the disclosed test-only D-049 residual — not fabricated or silently passed.
- **Requirements:** each of the **12** `final_gate=DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `validate.mjs --register DG1` passes.
- **Decisions:** D-048/D-049/D-050/D-051/**D-052** each resolved or recorded with a rationale.

## Round-6 specifics
- **Stage state** is set to **VERIFYING** before your run.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256` (read-only root, host-bound procfs, `unshare:["ipc"]`, only CAP_SETFCAP, no_new_privs, landlock per-run, own areas, empty discarded).

Write `docs/delivery/reviews/DG1/round-6/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/a7b46fbc29db6bb8.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
