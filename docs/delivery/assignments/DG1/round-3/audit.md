# DG1 round-3: release-auditor

Read `docs/delivery/assignments/DG1/round-3/review-common.md` first. Task ID: `T-DG1-AUDIT-R3`.

Specialist records: `docs/delivery/reviews/DG1/round-3/{domain-reviewer,code-security-reviewer,qa-verifier}.json`. Findings: `docs/delivery/findings.json` (`previous_gate: DG0`).

Audit from your agent definition, points 1-7. In particular:
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** `node tools/gates/candidate.mjs --stage DG1` and `--diff` equal `sha256:f0baa87d0163560fc05119a310c73ed365564833697c74bfa3a1c7f8795595a8` (source `5204179`). `node tools/gates/validate.mjs --stage DG0 --historical` still passes.
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-3 run of the named role in `docs/delivery/runs/DG1/<run_id>/meta.json`; spot-check each `transcript.jsonl.gz`. No reviewer implemented the round-3 repairs.
- **Findings:** every finding is `CLOSED_VERIFIED` by the relevant reviewer on this candidate, OR, for a Low non-mandatory fail-safe observation only, `ACCEPTED_OBSERVATION` (reviewer sidecar + yours, rationale + owner, listed in `accepted_observations`). **No** finding left `OPEN` or `FIXED_PENDING_VERIFICATION`; **zero** unresolved Critical/High and zero unresolved mandatory violations. Note the round-2 history (findings reopened and re-fixed) is expected.
- **The keycloak image pin (F-DG1-108/203):** confirm it is handled honestly — node/postgres/playwright pinned by digest, the CI images job resolves missing digests at runtime, and keycloak (quay.io, denied in this environment) is a disclosed, test-only, environment-bound residual (D-049), not a fabricated or silently-passed check. If a reviewer accepted it as an observation, confirm the rationale; otherwise confirm it does not leave a Critical/High/mandatory open.
- **Requirements:** each of the **12** `final_gate = DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `node tools/gates/validate.mjs --register DG1` passes.
- **Decisions:** D-048 (modules built), D-049 (image pinning), D-050 (REQ-S16-004 increment), D-051 (installer repo-read-only redesign) are each resolved or recorded with a rationale, not silently ignored.

## Round-3 audit specifics
- **Stage state** is set to **VERIFYING** before your run.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox evidence (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256` and shows a confined process (read-only root, host-bound procfs, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, landlock per-run), only its own areas, empty `discarded`.

Write `docs/delivery/reviews/DG1/round-3/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). Decision APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/f0baa87d0163560f.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
