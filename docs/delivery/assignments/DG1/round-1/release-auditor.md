# DG1 gate audit — release-auditor (round 1, clean re-gate)
Task ID: `T-DG1-AUDIT-R1`. Independent release auditor for the **DG1 gate**. Read the three specialist records first: `docs/delivery/reviews/DG1/round-1/{domain-reviewer,code-security-reviewer,qa-verifier}.json`.

## Candidate
- **candidate_id:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` (391 files) — verify `node tools/gates/candidate.mjs --stage DG1`.
- **manifest:** `docs/delivery/candidates/DG1/25c97340b6047e87.manifest.json`.

## Audit (your agent definition, points 1-7)
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** recomputed id equals the above. `node tools/gates/validate.mjs --historical --stage DG0` passes (DG0 is carried intact onto this branch).
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-1 run; spot-check each transcript. No reviewer implemented any DG1 requirement.
- **Findings:** every DG1 finding (if any were raised this round) is `CLOSED_VERIFIED` by the relevant reviewer on this candidate, or (Low, non-mandatory, fail-safe only) `ACCEPTED_OBSERVATION` with reviewer + your sidecar + `acceptance.accepted_by` + a gate `accepted_observations` entry. **No** DG1 finding `OPEN`/`FIXED_PENDING_VERIFICATION`; zero unresolved Critical/High; zero unresolved mandatory. (On this clean branch there were no pre-existing DG1 findings; the DG0 `ACCEPTED_OBSERVATION` set — F-DG0-147/149/015 — belongs to the previous gate.)
- **keycloak (D-049)** and **the REQ-DLV-042 online-registry install (D-057)** are disclosed environmental residuals, not fabricated or silently passed; confirm the code-security record handles REQ-DLV-042 via the offline suite + D-057 and records **no BLOCKED check**.
- **Requirements:** each of the **12** `final_gate=DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `node tools/gates/validate.mjs --register DG1` passes.
- **Decisions:** D-046..D-057 recorded with rationale.

## Round-1 specifics
- **Stage state** is set to **VERIFYING** before your run.
- **Node 24 target:** confirm QA's record shows unit green on both Node 22 and Node 24.
- **Process-sandbox (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256`.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.

Write `docs/delivery/reviews/DG1/round-1/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). Set `assignment` to exactly `docs/delivery/assignments/DG1/round-1/release-auditor.md` (bare path). APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/25c97340b6047e87.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, the gate is not approved — say so and do not edit anything to make it pass.
