# DG1 round-3 QA evidence (qa-verifier, T-DG1-REV-QA-R3)

Candidate sha256:f0baa87d0163560fc05119a310c73ed365564833697c74bfa3a1c7f8795595a8, source commit 520417922c46d465a19433440bb41faf2bef319a.
HEAD was the freeze commit 4f486b962b0bee2c3a6cabf65696b678be712a34. Its diff from 5204179 contains only candidate-excluded metadata (assignments, manifest, stages.json). `candidate.mjs --stage DG1` recomputes the same ID in the repository and in the clone, and `--diff` reports matches=true.
All execution ran in a disposable full clone under $TMPDIR, removed after the run. No product file was modified.
Each log starts with its cwd/environment and command, and ends with `exit=<status>`. All data is SYNTHETIC (dev seed).

| File | Check | Result |
|---|---|---|
| 01-install.log | pnpm install --frozen-lockfile --offline (store = scratch copy of the read-only local store); lockfile unchanged | PASS |
| 02..07 | typecheck, build, lint, openapi:lint (33 ops), check:no-cdn, contrast (50 pairs AA; 3 documented prohibited pairs) | PASS |
| 08-unit.log | pnpm test: 21 files, 235/235 | PASS |
| 09/10-integration-run{1,2}.log | pnpm test:integration on two FRESH PostgreSQL 16.13 clusters (port 5472): 8 migrations applied, 18 files, 197/197 each; no Unhandled/57P01 | PASS |
| 11-e2e.log | full e2e (e2e/** + apps/web/e2e/**), chromium-en + chromium-ar, --workers=1, PG port 5473: 22 passed, 0 failed, 0 skipped | PASS (F-DG1-208) |
| 12-derived-audit-localized.log | independent spec ../tests/dg1-r3-derived-audit-localized.spec.ts (hard assertions), EN+AR | PASS (F-DG1-005/008) + probe |
| 12a-...-firstattempt.log | first attempt of the same spec. It failed only on my over-strict "no UUID anywhere" assertion: the source-assignment id is a technical identifier. The spec was then scoped, see the README notes. Kept for transparency. | (superseded) |
| 13-schema-probe.log | ../tests/dg1-r2-schema-probe.sh unchanged: 8 migrations; 0007/0008 columns and constraints; audit_event trigger rejects owner UPDATE/DELETE; mth_app has no privilege | PASS |
| 14-r2-spec-regression.log | round-2 spec ../tests/dg1-r2-web-repairs.spec.ts UNCHANGED (its round-2 soft failures now pass) | PASS |
| 15-a18-clean-start.log | A18 clean start, real frozen offline install, commit 5204179 | PASS |
| 16-a20-token-propagation.log | A20 token change propagates to the rendered CSS (copy only; restored) | PASS |
| 17-validate-*.log | validate.mjs --register / --pipeline / --reconcile DG1 | PASS |
| 18-req-evidence.log | 12 DG1 rows IMPLEMENTED; every evidence file exists; F-DG1-209 rows printed | PASS |
| 19-stale-session-probe.log | ../tests/dg1-r3-stale-session-probe.spec.ts: the post-create view is not refreshed after 61 s plus a focus signal | FAIL -> F-DG1-210 |
| screenshots/journeys/{ar,en} | journeys 01..17 + axe-summary.json (0 violations, 14 pages per language) | |
| screenshots/derived-audit | F-DG1-008 localized row (EN/AR); post-create page before reload (no audit trail, no Edit) | |
| screenshots/e2e, web-repairs-r2spec | A20 shell + round-2 spec screenshots | |

Notes:
- A12/A13/A14 run inside the integration project (tests/qa/integration: a12 14 tests, a13 5, a14 5), green in both runs. A18: 15. A20: 11 (bilingual shell + tokens, EN/AR) and 16.
- The derived-assignment row shows "Carried over from assignment: None -> <uuid>" (AR: LTR-isolated). This is a technical identifier with no catalogue label, which the F-DG1-005 standard allows. It is not marked "untranslated". Every other part of the row is localized.
