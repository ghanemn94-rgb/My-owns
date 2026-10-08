# DG3 gate audit: release-auditor (round 7)

Task ID: `T-DG3-AUDIT-R7`. You are the independent release auditor. Read the three round-7 specialist records first. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

## Candidate

- **candidate_id:** `sha256:f55095dbec364594d25a624261512239854f233d3ee0b5c8ecc210d1602bf6e0` (757 files). Verify it with `node tools/gates/candidate.mjs --stage DG3`.
- **manifest:** `docs/delivery/candidates/DG3/f55095dbec364594.manifest.json`.
- **source_commit:** `d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81`.
- **Stage state** is set to **VERIFYING** before your run.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. Never run `git worktree add` on this repository (D-082).

## Audit

1. **Clone and identity.**
   - Use a complete clone; if the clone is incomplete, the audit is BLOCKED.
   - The candidate identity equals the one above.
   - `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` pass.
2. **Independence and provenance.**
   - Each round-7 specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-7 run.
   - Each of those runs has `exit_code` 0 and an **empty** `external_config_changed` in its `meta.json`.
   - Each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033).
   - No reviewer implemented any DG3 requirement.
3. **Verdicts.** All three round-7 specialist verdicts are PASS, on this same candidate.
4. **Findings.** Five DG3 findings were raised. EVERY one must be `CLOSED_VERIFIED` by a non-owner, with its `fix_revision` an ancestor of this candidate. Check each verifying run's provenance: exit 0, an empty `external_config_changed`, and a matching sandbox.
   - **F-DG3-100** (Low, REQ-PB-056, owner kpi-benefits-engineer). The formula engine's no-dynamic-code guard.
     - **History.** Its verification failed in rounds 2, 3 (rerun), 4 and 5. It was repaired five times: KBE-D `4175262`, KBE-E `de06138`, KBE-F `0fb892c`, KBE-G `10472b4` and KBE-H `53ac073` (`fix_revision` is `53ac073`).
     - **Closure.** It was closed in **round 6** by code-security, on candidate `7049d793`, against the reviewer's own final closure criterion, and re-confirmed in round 7 ('every probe verdict byte-identical').
     - **Judge:** that the round-6 closure is sound, that ADR-0024 §6 now makes no claim the code does not guarantee, and that the stated residual is honest.
   - **F-DG3-120** (Low, REQ-PB-004, owner solution-architect). Closed in **round 2** by the domain reviewer, in run `DG3-T-DG3-REV-DOM-R2-domain-reviewer-20261008T091016Z-478aac6a`. The fix is ARCH-05 `ea8e2de`.
     - That run finished before the D-082 worktree incident, so confirm its `external_config_changed` is empty.
     - Later domain records confirm the closure still holds.
   - **F-DG3-170** (Medium, owner frontend-ux-engineer). Closed in **round 3** by the domain reviewer. The fix is FE-G `6b30768`.
   - **F-DG3-180** (Medium, the same defect raised by qa). Closed in **round 3** by the qa **rerun**, run `…R3B-…-7b0434bc` (D-084). The fix is FE-G `6b30768`.
   - **F-DG3-280** (Low, REQ-PB-056, owner kpi-benefits-engineer). Raised by code-security in round 6, and closed in **round 7** by code-security. The fix is KBE-I `1cd89e6`.
   - No DG3 finding is OPEN or FIXED_PENDING_VERIFICATION. There are zero unresolved Critical/High findings and zero unresolved mandatory violations.
5. **Process incidents.** Judge whether each was handled acceptably. If you believe one was not, record BLOCKED with the reason.
   - **D-082:** repair worktrees were created during the round-2 code-security and qa runs, so those runs report `external_config_changed`. Their evidence was committed by the orchestrator, unchanged: `9e28775` and `1af3e75`. Verify three things:
     - every listed entry lies under the new worktrees, and every tracked one equals the committed content;
     - **no closure and no gate verdict relies on either run**;
     - the corrective rule held: no run from round 3 to round 7 reports a configuration change.
   - **D-084:** a container restart killed the first round-3 code-security and qa runs. Their material is kept for provenance under `test-evidence/DG3/{code-security,qa}-r3-orphaned/`, and both were re-run from `round-3/*-rerun.md`.
   - **The discarded round-5 freeze:** a first freeze attempt (`dad583d3`) omitted D-085. It was discarded uncommitted before any review; see the `stages.json` history.
6. **Environmental residuals, not BLOCKED.**
   - No round-7 specialist recorded a BLOCKED check.
   - Live registry (REQ-DLV-042 AC-1, D-057), live CI (REQ-DLV-025 A24, D-058) and Keycloak (D-049) are documented residuals, with their available surface verified.
7. **Requirements.**
   - Each of the 32 `final_gate=DG3` requirements is in qa's `requirements_checked`, AND in domain's or code-security's.
   - `node tools/gates/validate.mjs --register DG3` passes.
8. **Decisions.** D-078 to D-087 are recorded with rationale. Quote them; do not paraphrase. Check in particular:
   - D-078: the DG3 plan, and the D-067 correction carried from the DG2 audit;
   - D-079: the build in worktree waves, the orchestrator's integration edits, and the disclosed limitations. Judge whether each limitation is acceptable as disclosed;
   - D-080: the Low findings were repaired rather than accepted as observations;
   - D-081: the §9 renumbering, the only orchestrator edit in round 2;
   - D-082: the incident above;
   - D-083: KBE-E's root `package.json` `test` script change, accepted as a scope extension, and the flaky `unit-web` test it disclosed;
   - D-084 to D-087: the rounds 3–6 results and repairs. Judge whether the repeated `session-identity.test.tsx` flake under load (disclosed in D-084) is acceptable as disclosed. It is not a finding unless a specialist raised one.
9. **Evidence honesty (DG2 round-10 audit condition 1).** Every round-7 specialist record, and the round-2 domain record that F-DG3-120's closure relies on, discloses and explains each non-zero exit, failed suite or hook timeout in the logs it cites. Grep the cited logs yourself, at least every round-7 log.
10. **Product vs engineering gates.** Product gates G1–G6 are business approvals. Nothing in the candidate grants a real business, Finance or IT approval, or ties G1–G6 to DG0–DG7. G4 approvals in the evidence are synthetic demo decisions.

## Your own evidence cannot exist yet

`validate.mjs --stage DG3` reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**, and list those errors. Any other error means BLOCKED.

## Records

Write `docs/delivery/reviews/DG3/round-7/release-auditor.json`, then `docs/delivery/gates/DG3.json`, using Write/Edit only. Mirror `docs/delivery/gates/DG2.json` key for key.

- `assignment` = exactly `docs/delivery/assignments/DG3/round-7/release-auditor.md` (bare path).
- `decision`: APPROVED only if every condition above holds; otherwise BLOCKED, with `blocking_conditions`.
- `manifest_path`: `docs/delivery/candidates/DG3/f55095dbec364594.manifest.json`.
- `previous_gate`: DG2.
- `requirements.final_gate_ids`: `REQ-PB-004, REQ-PB-006, REQ-PB-007, REQ-PB-019, REQ-PB-022, REQ-PB-032, REQ-PB-040, REQ-PB-045, REQ-PB-046, REQ-PB-047, REQ-PB-048, REQ-PB-049, REQ-PB-050, REQ-PB-051, REQ-PB-052, REQ-PB-053, REQ-PB-054, REQ-PB-055, REQ-PB-056, REQ-PB-057, REQ-PB-059, REQ-DLV-035, REQ-S04-006, REQ-S05-005, REQ-S08-007, REQ-S09-001, REQ-S09-003, REQ-S09-004, REQ-S09-005, REQ-S09-006, REQ-S09-008, REQ-S16-016`.

Finally, run `node tools/gates/validate.mjs --stage DG3` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, do not approve.
