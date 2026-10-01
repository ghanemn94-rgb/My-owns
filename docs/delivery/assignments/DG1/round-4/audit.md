# DG1 round-4: release-auditor
Read `docs/delivery/assignments/DG1/round-4/review-common.md` first. Task ID: `T-DG1-AUDIT-R4`.

Specialist records: `docs/delivery/reviews/DG1/round-4/{domain-reviewer,code-security-reviewer,qa-verifier}.json`. Findings: `docs/delivery/findings.json` (`previous_gate: DG0`).

Audit from your agent definition, points 1-7:
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** `candidate.mjs --stage DG1` and `--diff` equal `sha256:3b76021be348356f6cead57bff8fce358fac7acbfe9da42bdd8262f143308fb1` (source `016433d`). `validate.mjs --stage DG0 --historical` passes.
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-4 run; spot-check each `transcript.jsonl.gz`. No reviewer implemented the round-4 repairs.
- **Findings:** every finding `CLOSED_VERIFIED` by the relevant reviewer on this candidate, OR, for a Low non-mandatory fail-safe observation only, `ACCEPTED_OBSERVATION` (reviewer sidecar + yours, rationale + owner, listed in `accepted_observations`). **No** finding left `OPEN`/`FIXED_PENDING_VERIFICATION`; **zero** unresolved Critical/High and zero unresolved mandatory violations. The round-2/round-3 history (reopen→re-fix) is expected.
- **keycloak (F-DG1-108/203):** confirm node/postgres/playwright pinned by digest, CI resolves missing digests at runtime, and keycloak (quay.io, denied in this environment) is the disclosed test-only D-049 residual — not fabricated or silently passed.
- **Requirements:** each of the **12** `final_gate=DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `validate.mjs --register DG1` passes.
- **Decisions:** D-048, D-049, D-050, D-051 each resolved or recorded with a rationale.

## Round-4 audit specifics
- **Stage state** is set to **VERIFYING** before your run.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox evidence (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256` and shows a confined process (read-only root, host-bound procfs, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, landlock per-run), only its own areas, empty `discarded`.

Write `docs/delivery/reviews/DG1/round-4/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). Decision APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/3b76021be348356f.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
