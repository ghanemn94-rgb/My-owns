# DG1 gate review — code-security-reviewer (round 3, clean re-gate)
Task ID: `T-DG1-REV-SEC-R3`. Independent code & security reviewer re-reviewing candidate after the round-2 F-DG1-232 e2e-determinism fix (test-only). You did not implement any DG1 requirement.

## Candidate
- **candidate_id:** `sha256:18e150714d29fa67aeaf28e817bb500d2db6191c88cde3ea680b3a64c8056f5b` — verify `node tools/gates/candidate.mjs --stage DG1`. 394 files. **manifest:** `docs/delivery/candidates/DG1/18e150714d29fa67.manifest.json`. Node 24 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Scope
The only change since round 2 is a **test-only** e2e determinism fix (apps/web/e2e/journeys.spec.ts, F-DG1-232). Your round-2 findings (F-DG1-140/141/142/143/144/145/146) stay CLOSED_VERIFIED; no re-verification needed. Re-confirm **no regression** in correctness/architecture/authorization/data-integrity/concurrency/injection/security (the BU hierarchy guard + migration 0009, destination authz, and rate-limit keying from round 2 are unchanged).

## Checks (real output; missing tool/DB = BLOCKED) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, the integration suite on a disposable PostgreSQL (unique port) twice (incl. bu-hierarchy-guard.test.ts + migration 0009), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh`, `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --historical --stage DG0`. ci.yml copies byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-3/`.

## Environmental residuals — NOT BLOCKED gate checks
Live-registry install (AC-1, REQ-DLV-042) = D-057; live-CI (A24, REQ-DLV-025) = D-058. Record the offline install-sandbox suite (13/14) + CI config checks PASS and note the live effects as documented residuals; do NOT emit a BLOCKED check.

## Requirements (record EXACTLY): `REQ-DLV-025`,`REQ-DLV-033`,`REQ-DLV-042`,`REQ-S16-001`,`REQ-S16-003`,`REQ-S16-004`,`REQ-S19-004`,`REQ-S19-006`.

## Record (MANDATORY)
`docs/delivery/reviews/DG1/round-3/code-security-reviewer.json`: `assignment` = exactly `docs/delivery/assignments/DG1/round-3/code-security-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: code-security-reviewer`; `round: 3`; `stage_id: DG1`; `checks_run[]` each {id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}; `requirements_checked[]` exactly those ids; `findings[]` only NEW ones (+ .findings.json if any); `verdict` PASS only if no regression and no unresolved Critical/High/mandatory. No verifications sidecar needed.
