# DG2 gate review — code-security-reviewer (round 2)

Task ID: `T-DG2-REV-SEC-R2`. Independent code & security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:089a2a2fbe3675019b0c5faeb1cf66fd4ea3f7235fae2c2b4ddb5aaef6c9be69` — verify `node tools/gates/candidate.mjs --stage DG2` (517 files). Complete clone. **manifest:** `docs/delivery/candidates/DG2/089a2a2fbe367501.manifest.json`. **source_commit** `eb8163e2`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor. DG1 is APPROVED; `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-1 findings are fixed on THIS candidate — adversarially (you raised them)
Re-run your round-1 repros and confirm each is closed:
- **F-DG2-140 (High, REQ-S13-012):** evidence verification SoD. Migration `0019_evidence_review_separation.sql` adds `evidence.content_authored_by` + trigger `evidence_review_separation`; a reviewer who is the creator, the author of the current note/URL text, OR the uploader of the current content revision is refused (403) — in the API and the DB. Re-run `docs/delivery/test-evidence/DG2/code-security/round-1/probes/zz-sec-r1-probe.test.ts` (SEC-1.note + SEC-1.file + the owner-edit variant) and confirm 403 now; confirm the DB-bypass is also closed.
- **F-DG2-141 (High, REQ-S10-001):** trajectory-approval SoD — an approver who set/last-changed any part of the current trajectory is refused 403 `kpi.target_author_cannot_approve` (audited), in addition to the creator rule. Re-run the repro.
- **F-DG2-142 (Medium, REQ-S10-001):** evidence-link removal now applies the record-level edit check that link creation requires (403 without edit rights on the target record). Re-run the repro.

Write `docs/delivery/reviews/DG2/round-2/code-security-reviewer.verifications.json` — one entry per finding `{finding_id, result: "PASS", status_after: "CLOSED_VERIFIED", note, evidence[]}` (PASS only if genuinely fixed on this candidate; else FAIL and explain, and it stays open).

## Re-review (no regression) + checks
Re-inspect the P2 authz/data-integrity/concurrency surface for regressions from the repairs (evidence routes, kpi activate, phase/gate sequencing, the 0019 migration + guards). Run (real output; missing tool/DB is BLOCKED): `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` (Node 22 and 24), the integration suite on a disposable PostgreSQL (unique port) **twice** incl. `contract.test.ts` (161 ops routed) and migrations 0001→0019, the AUD-403 sweep (now incl. `activateKpiDefinition`), `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`. Evidence under `docs/delivery/test-evidence/DG2/code-security/round-2/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Live-registry (REQ-DLV-042 AC-1, D-057), live-CI (REQ-DLV-025 A24, D-058), keycloak (D-049): offline/config surface PASS + note the residual. A BLOCKED check fails the gate round.

## Record format (MANDATORY)
`docs/delivery/reviews/DG2/round-2/code-security-reviewer.json`: `assignment` = exactly `docs/delivery/assignments/DG2/round-2/code-security-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: code-security-reviewer`; `round: 2`; `stage_id: DG2`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the ids above; `findings[]` only NEW ids (+ a `.findings.json` with the full finding objects if any — each MUST have id matching `^F-DG2-[0-9]{3}$` (next free is F-DG2-143), stage_id, requirement, severity, mandatory_violation, title, reproduction, expected, actual, evidence, reported_by, reported_in, owner, status:"OPEN", history:[{at,status:"OPEN",note}]; NO other keys); `verdict` PASS only if your three findings verify CLOSED, requirements complete, and no unresolved Critical/High/mandatory.
