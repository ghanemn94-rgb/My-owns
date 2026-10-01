# DG1 gate review — qa-verifier (round 4, clean re-gate)
Task ID: `T-DG1-REV-QA-R4`. Independent QA verifier. You may author tests under `tests/qa/**` and `e2e/**`, never product code.
## Candidate
- **candidate_id:** `sha256:6e0c0db1a8bea33cd81f05ea8c795d8ede4bfb7f380dfe146556cb4875a6f827` — verify `node tools/gates/candidate.mjs --stage DG1`. 395 files. **manifest:** `docs/delivery/candidates/DG1/6e0c0db1a8bea33c.manifest.json`. Node 24 at `/opt/nvm/versions/node/v24.21.0/bin`.
## Scope
The only change since round 3 is the F-DG1-147 e2e-typecheck tooling (new apps/web/tsconfig.e2e.json). Your prior findings (F-DG1-230/231/232) stay CLOSED_VERIFIED; no re-verification needed. Re-confirm **no regression** across the acceptance suites.
## Execute (real output; missing tool/DB = BLOCKED)
Build+static (incl. `pnpm -r typecheck` which now covers e2e); unit Node 22 and Node 24 (expect 326); integration on disposable PostgreSQL twice (migrations 0001-0009; bu-hierarchy-guard; contract incl. getBrandingTokens); e2e full journeys EN+AR `--workers=1` (no skips); acceptance A12/A13/A14/A18/A20; `node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile`.
## Environmental residuals — NOT BLOCKED gate checks
Live-registry install (AC-1, REQ-DLV-042)=D-057; live-CI (A24, REQ-DLV-025)=D-058. Record available offline/config evidence PASS + note the live effects as documented residuals; do NOT emit a BLOCKED check.
## Requirements (record EXACTLY all 12): `REQ-DLV-025`,`REQ-DLV-033`,`REQ-DLV-042`,`REQ-S15-002`,`REQ-S15-005`,`REQ-S15-006`,`REQ-S16-001`,`REQ-S16-002`,`REQ-S16-003`,`REQ-S16-004`,`REQ-S19-004`,`REQ-S19-006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-4/`.
## Record (MANDATORY)
`docs/delivery/reviews/DG1/round-4/qa-verifier.json`: `assignment`=exactly `docs/delivery/assignments/DG1/round-4/qa-verifier.md` (bare path); `candidate_id` above; `reviewer_role: qa-verifier`; `round: 4`; `stage_id: DG1`; `checks_run[]` each {id,environment,procedure,expected,actual,exit_status,result (PASS|FAIL|BLOCKED),evidence[]}; `requirements_checked[]` exactly the 12; `findings[]` only NEW (+ .findings.json if any); `verdict` PASS if every requirement is verifiable and no unresolved Critical/High/mandatory. No verifications sidecar needed (no findings assigned to you this round).
