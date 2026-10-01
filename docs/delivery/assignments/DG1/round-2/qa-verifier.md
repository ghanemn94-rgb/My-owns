# DG1 gate review — qa-verifier (round 2, clean re-gate)
Task ID: `T-DG1-REV-QA-R2`. Independent QA verifier re-reviewing the **repaired** DG1 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d` — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone; 394 files.
- **manifest:** `docs/delivery/candidates/DG1/e6979e12111aeb14.manifest.json`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Verify these round-1 findings are fixed on THIS candidate (you raised them)
- **F-DG1-230 (Low):** the three P1 views (actor_display, business_unit_closure, scope_node) are documented in the data dictionary and ERD. **F-DG1-231 (Low):** the register rows REQ-DLV-033 and REQ-S19-004 no longer cite dev-history candidate `991d3241` evidence or make IMPLEMENTED conditional — they cite stable files verified on this candidate (migrations 0001-0009, the integration suite), and the carried round-2 logs are gone.
Write `docs/delivery/reviews/DG1/round-2/qa-verifier.verifications.json` with an entry per finding `{finding_id, result, status_after: CLOSED_VERIFIED, note, evidence[]}`.

## Execute (real output; a missing tool/DB is BLOCKED)
1. Build + static: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. Unit on Node 22 and Node 24: `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (expect 326; unit-web green incl. the now-deterministic transformations test, F-DG1-144).
3. Integration on a disposable PostgreSQL (unique port) **twice** — deterministic, no 57P01, no "Hook timed out"; migrations 0001-0009; audit trigger rejects UPDATE/DELETE; the new `bu-hierarchy-guard.test.ts` passes; contract matches OpenAPI incl. getBrandingTokens.
4. e2e (pre-installed Chromium, `--workers=1`, unique PG port): full journeys EN+AR green.
5. Acceptance suites A12/A13/A14/A18/A20.
6. Register & pipeline: `node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass.

## Environmental residuals — do NOT record as BLOCKED gate checks
The live-registry install effect (AC-1, REQ-DLV-042) is residual **D-057**; the live GitHub-Actions CI run (A24, REQ-DLV-025) is residual **D-058**. Record the available offline/config evidence as PASS and note the live effects as these documented residuals. Do not emit a `BLOCKED` check for them (a BLOCKED check fails the gate round). If you genuinely cannot verify a requirement's available surface, that is a FAIL to raise, not a BLOCKED gate check for a documented residual.

## Requirements to check (record EXACTLY these — all 12)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-2/`.

## Record format (MANDATORY)
`docs/delivery/reviews/DG1/round-2/qa-verifier.json`: `assignment` = exactly `docs/delivery/assignments/DG1/round-2/qa-verifier.md` (bare path); `candidate_id` above; `reviewer_role: qa-verifier`; `round: 2`; `stage_id: DG1`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the 12 ids; `findings[]` only NEW ones (+ `.findings.json` if any); `verdict` PASS only if the two findings verify, every requirement is verifiable with existing evidence, and no unresolved Critical/High/mandatory remains.
