# DG1 gate review — qa-verifier (round 3, clean re-gate)
Task ID: `T-DG1-REV-QA-R3`. Independent QA verifier re-reviewing candidate after the F-DG1-232 e2e-determinism fix. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:18e150714d29fa67aeaf28e817bb500d2db6191c88cde3ea680b3a64c8056f5b` — verify `node tools/gates/candidate.mjs --stage DG1`. 394 files. **manifest:** `docs/delivery/candidates/DG1/18e150714d29fa67.manifest.json`. Node 24 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Verify this finding is fixed on THIS candidate (you raised it)
- **F-DG1-232 (Low):** the e2e "shell: navigation, language persistence and My Work" journey is now deterministic after `page.reload()` — it waits for the shell to remount and the document to hold focus (nothing focused) before pressing Tab, so the skip-link focus assertion no longer races, and the serial spec no longer skips the remaining journeys. The assertion is strengthened (Tab->skip link, Enter->main#main). **Re-run the shell journey many times** (e.g. `--repeat-each=20 --workers=1`, both locales, and once under CPU load) and confirm 0 flakes. Write `docs/delivery/reviews/DG1/round-3/qa-verifier.verifications.json` with `{finding_id: F-DG1-232, result: PASS, status_after: CLOSED_VERIFIED, note, evidence[]}`. Your round-2 findings (230/231) stay CLOSED_VERIFIED.

## Execute (real output; missing tool/DB = BLOCKED)
Build+static; unit Node 22 and Node 24 (expect 326); integration on disposable PostgreSQL twice (migrations 0001-0009; bu-hierarchy-guard.test.ts; contract incl. getBrandingTokens); **e2e full journeys EN+AR `--workers=1`** (no skips — prove the F-DG1-232 fix); acceptance A12/A13/A14/A18/A20; `node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile`.

## Environmental residuals — NOT BLOCKED gate checks
Live-registry install (AC-1, REQ-DLV-042) = D-057; live-CI (A24, REQ-DLV-025) = D-058. Record available offline/config evidence PASS + note the live effects as documented residuals; do NOT emit a BLOCKED check.

## Requirements (record EXACTLY all 12): `REQ-DLV-025`,`REQ-DLV-033`,`REQ-DLV-042`,`REQ-S15-002`,`REQ-S15-005`,`REQ-S15-006`,`REQ-S16-001`,`REQ-S16-002`,`REQ-S16-003`,`REQ-S16-004`,`REQ-S19-004`,`REQ-S19-006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-3/`.

## Record (MANDATORY)
`docs/delivery/reviews/DG1/round-3/qa-verifier.json`: `assignment` = exactly `docs/delivery/assignments/DG1/round-3/qa-verifier.md` (bare path); `candidate_id` above; `reviewer_role: qa-verifier`; `round: 3`; `stage_id: DG1`; `checks_run[]` each {id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}; `requirements_checked[]` exactly the 12; `findings[]` only NEW ones (+ .findings.json if any); `verdict` PASS only if F-DG1-232 verifies, every requirement is verifiable, and no unresolved Critical/High/mandatory.
