# DG1 round-16: release-auditor
Read `docs/delivery/assignments/DG1/round-16/review-common.md` first. Task ID: `T-DG1-AUDIT-R16`.
Specialist records: `docs/delivery/reviews/DG1/round-16/{domain-reviewer,code-security-reviewer,qa-verifier}.json`. Findings: `docs/delivery/findings.json` (`previous_gate: DG0`).

Audit from your agent definition, points 1-7:
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** `candidate.mjs --stage DG1` equal `sha256:56f3eb885c6cf3db406e280d232e48ebcefddad173107a744bb9b8ca74fc2b4c` (391 files). `validate.mjs --stage DG0 --historical` passes.
- **Independence & provenance:** each specialist's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-16 run; spot-check each transcript. No reviewer implemented the round-16 repair (F-DG1-137/218 was T-DG1-BE17 / backend-workflow-engineer).
- **Findings:** EVERY finding `CLOSED_VERIFIED` by the relevant reviewer on this candidate (or, Low non-mandatory fail-safe only, `ACCEPTED_OBSERVATION` with reviewer + your sidecar + `acceptance.accepted_by` + a gate `accepted_observations` entry). In particular **F-DG1-137** and **F-DG1-218** must be `CLOSED_VERIFIED` on candidate `56f3eb88…`. **No** DG1 finding `OPEN`/`FIXED_PENDING_VERIFICATION`; zero unresolved Critical/High; zero unresolved mandatory violations. The only `ACCEPTED_OBSERVATION` findings are the three DG0 ones (F-DG0-147/149/015, previous gate). The rounds 2-15 reopen→re-fix history (incl. the round-10 qa BLOCK) is expected.
- **keycloak (F-DG1-108/203):** node/postgres/playwright pinned by digest; CI resolves missing digests at runtime; keycloak (quay.io, denied here) is the disclosed test-only D-049 residual — not fabricated or silently passed.
- **Requirements:** each of the **12** `final_gate=DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `validate.mjs --register DG1` passes.
- **Decisions:** D-048..D-055 each resolved or recorded with a rationale.

## Round-16 specifics
- **Stage state** is set to **VERIFYING** before your run.
- **Node 24 target:** confirm QA's record shows unit green on **both** Node 22 and Node 24.
- **Module-lint declaration-file class (final state):** the declaration-file branch in `syntaxErrors()` follows TypeScript's own classification via the public `SourceFile.isDeclarationFile` (`isDeclarationFileName()` helper), covering `allowArbitraryExtensions` `*.d.<ext>.ts`; the hand-rolled `DECLARATION_FILE` regex is removed (0 references). No declaration-file name reaches `ts.transpileModule`; a violation/syntax error surfaces as a named diagnostic. Confirm code-security re-proved this.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process-sandbox (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256`.
- **Module-lint (full final state):** default-deny built-ins/process members; `crypto.setEngine` name-banned (rule 1) + node:crypto namespace route closed (rule 5); `walk()` scans all buildable module files (F-DG1-134); test allowances only for `.test.ts`/`.test.tsx` (F-DG1-135); declaration files scanned no-emit and classified by TS (F-DG1-217/137/218); member-audit on Node 22+24. Residuals (a) plain-object data-flow, (b) node:fs code-gen+import, (c) WebAssembly are recorded, rationalised decisions.

Write `docs/delivery/reviews/DG1/round-16/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/56f3eb885c6cf3db.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails, the gate is not approved — say so and don't edit anything to make it pass.
