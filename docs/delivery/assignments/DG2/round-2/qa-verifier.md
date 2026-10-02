# DG2 gate review — qa-verifier (round 2)

Task ID: `T-DG2-REV-QA-R2`. Independent QA verifier re-reviewing the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:089a2a2fbe3675019b0c5faeb1cf66fd4ea3f7235fae2c2b4ddb5aaef6c9be69` — verify `node tools/gates/candidate.mjs --stage DG2` (517 files). **manifest:** `docs/delivery/candidates/DG2/089a2a2fbe367501.manifest.json`. **source_commit** `eb8163e2`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor. Pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`). DG1 APPROVED; `validate --historical --stage DG1` must pass.

## Verify your round-1 findings are fixed on THIS candidate (you raised them)
Re-run your round-1 checks and confirm each is closed:
- **F-DG2-201 (High, REQ-PB-017):** a KPI definition can be **activated** (`POST …/kpi-definitions/{id}/activate`, and the Define-screen Activate affordance), and **G2 Direction now completes end-to-end through native workflows** (Diagnose→Define→Design to a G2 decision). Confirm the full journey in EN and AR.
- **F-DG2-202 (High, REQ-DLV-034):** the register records DG2 completion — the 32 DG2-final rows are IMPLEMENTED with evidence; `node tools/gates/validate.mjs --register DG2` PASS.
- **F-DG2-203 (Medium, REQ-PB-030):** the charter thesis renders the composed B0037 sentence and flags incomplete parts (not "None"/silent pass).
- **F-DG2-204 (Medium, REQ-PB-033):** the charter shows the **current** North Star / marks a superseded one; it never shows a superseded sentence as current.
- **F-DG2-205 (Medium, REQ-S04-005):** phase-sequence integrity — G2/G3 cannot be submitted/approved out of order; approval advances exactly one phase (no skip).
- **F-DG2-206 (Low, REQ-DLV-034):** your acceptance stack `e2e/support/qa-stack.sh` now sets `EVIDENCE_STORAGE_*`, so the serial P2 acceptance journey no longer skips tests (evidence uploads work). **Confirm your acceptance journey runs without the skips.**

Write `docs/delivery/reviews/DG2/round-2/qa-verifier.verifications.json` — one entry per finding `{finding_id, result: "PASS", status_after: "CLOSED_VERIFIED", note, evidence[]}` (PASS only if genuinely fixed; else FAIL).

## Execute (real output; missing tool/DB is BLOCKED)
1. Build + static: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` (161 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. Unit on Node 22 and 24: `pnpm test`.
3. Integration on a disposable PostgreSQL (unique port) **twice**: migrations 0001→0019; the DB guards + the 0019 evidence trigger fire; `contract.test.ts` green (161 ops routed, both pending lists empty).
4. e2e (pre-installed Chromium, `--workers=1`, unique port): the P1 + P2 journeys green in **chromium-en and chromium-ar**, including Define→G2 and Design→G3; axe no serious/critical; your acceptance journey (qa-stack.sh) runs without the F-206 skips.
5. Register & pipeline: `node tools/gates/validate.mjs --register DG2`, `--pipeline`, `--reconcile`.

## Requirements to check (record EXACTLY these — all 32)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

## Environmental residuals — NOT BLOCKED gate checks
Live-registry (D-057), live-CI (D-058), keycloak (D-049): offline/config surface PASS + note the residual; never a BLOCKED gate check.

## Record format (MANDATORY)
`docs/delivery/reviews/DG2/round-2/qa-verifier.json`: `assignment` = exactly `docs/delivery/assignments/DG2/round-2/qa-verifier.md` (bare path); `candidate_id` above; `reviewer_role: qa-verifier`; `round: 2`; `stage_id: DG2`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the 32 ids; `findings[]` only NEW ids (+ a `.findings.json` with full finding objects if any — each MUST have id `^F-DG2-[0-9]{3}$` (next free F-DG2-143), stage_id, requirement, severity, mandatory_violation, title, reproduction, expected, actual, evidence, reported_by, reported_in, owner, status:"OPEN", history:[{at,status:"OPEN",note}]; NO other keys); `verdict` PASS only if your six findings verify CLOSED, every requirement is verifiable with evidence, and no unresolved Critical/High/mandatory.
