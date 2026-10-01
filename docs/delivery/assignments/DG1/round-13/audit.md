# DG1 round-13: release-auditor
Read `docs/delivery/assignments/DG1/round-13/review-common.md` first. Task ID: `T-DG1-AUDIT-R13`.
Specialist records: `docs/delivery/reviews/DG1/round-13/{domain-reviewer,code-security-reviewer,qa-verifier}.json`. Findings: `docs/delivery/findings.json` (`previous_gate: DG0`).

Audit from your agent definition, points 1-7:
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** `candidate.mjs --stage DG1` equal `sha256:00f1498cd5e9a166db501452f699a3270ffca82455593fe9c0ab84a83e01c80b` (391 files). `validate.mjs --stage DG0 --historical` passes.
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-13 run; spot-check each transcript. No reviewer implemented the round-13 repairs (F-DG1-134 was T-DG1-BE14 / backend-workflow-engineer; F-DG1-216 the delivery-orchestrator).
- **Findings:** EVERY finding `CLOSED_VERIFIED` by the relevant reviewer on this candidate (or, Low non-mandatory fail-safe only, `ACCEPTED_OBSERVATION` with reviewer + your sidecar + `acceptance.accepted_by` + a gate `accepted_observations` entry). In particular **F-DG1-134 and F-DG1-216** must be `CLOSED_VERIFIED` on candidate `00f1498c…`. **No** DG1 finding `OPEN`/`FIXED_PENDING_VERIFICATION`; zero unresolved Critical/High; zero unresolved mandatory violations. The only `ACCEPTED_OBSERVATION` findings are the three DG0 ones (F-DG0-147/149/015, previous gate). The rounds 2-12 reopen→re-fix history (incl. the round-10 qa BLOCK) is expected.
- **keycloak (F-DG1-108/203):** node/postgres/playwright pinned by digest; CI resolves missing digests at runtime; keycloak (quay.io, denied here) is the disclosed test-only D-049 residual — not fabricated or silently passed.
- **Requirements:** each of the **12** `final_gate=DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `validate.mjs --register DG1` passes.
- **Decisions:** D-048..D-055 each resolved or recorded with a rationale.

## Round-13 specifics
- **Stage state** is set to **VERIFYING** before your run.
- **Node 24 target:** confirm QA's record shows unit green on **both** Node 22 and Node 24 (a Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`).
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256`.
- **Module-lint:** default-deny built-ins/process members; `crypto.setEngine` name-banned (rule 1) + node:crypto namespace route closed (rule 5); `walk()` scans all buildable module files (rule-5/F-DG1-134); member-audit on Node 22+24. Residuals (a) plain-object data-flow, (b) node:fs code-gen+import, (c) WebAssembly are recorded, rationalised decisions.

Write `docs/delivery/reviews/DG1/round-13/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/00f1498cd5e9a166.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
