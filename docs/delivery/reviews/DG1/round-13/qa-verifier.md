# DG1 round 13: qa-verifier

**Verdict: PASS.** Candidate `sha256:00f1498cd5e9a166db501452f699a3270ffca82455593fe9c0ab84a83e01c80b` (freeze `08cbd12`, 391 files). The ID recomputes identically in a full disposable clone.

## Findings verified
- **F-DG1-134 (Low): CLOSED_VERIFIED.**
  - The module lint's `walk()` now collects every buildable JS/TS file.
  - **Independent probe:** it plants files into the *real* module directory and calls `moduleViolations()`. It passes 21/21 on Node 22 and Node 24, and flags 8 extensions × 4 rules.
  - **Negative control:** the same probe on the pre-fix testkit fails 14/21, which are exactly the non-ts cases.
  - **Real tree:** it has 0 non-ts files and zero violations.
  - **Scope:** the change is test-only.
- **F-DG1-216 (Low): CLOSED_VERIFIED.** D-055 now says the node:crypto route is closed by rule 5, and the assignment's grep finds nothing.
- **F-DG1-009, F-DG1-210 and F-DG1-214 still hold:**
  - F-DG1-009: no 57P01 and no admin terminations in 3 integration runs.
  - F-DG1-210: the BU-Lead journey passes in EN and AR, plus my independent spec.
  - F-DG1-214: unit-web 110/110 on Node 24.

## Checks
| Check | Result |
|---|---|
| Static checks: build, typecheck, lint, openapi:lint (33 ops), no-cdn, format, contrast | PASS |
| Unit | 320/320 on Node 22 and on Node 24 |
| Integration (real PostgreSQL 16.13) | 200/200 × 3 (Node 22 ×2, Node 24 ×1) |
| Migrations 0001–0008 | Applied |
| Audit trigger | Rejects UPDATE, DELETE and TRUNCATE |
| Contract | 9/9, including getBrandingTokens |
| e2e | 22/22 (EN+AR) on Node 22 and on Node 24 |
| axe | 0 violations |
| Acceptance suites | A12 14/14, A13 5/5, A14 5/5, A18 clean start PASS, A20 token propagation PASS |
| Validators: `--register DG1`, `--pipeline`, `--reconcile` | PASS |
| 12 DG1-final requirements | All IMPLEMENTED, with existing evidence |

## BLOCKED
- **Installer AC-1 (effect).** It needs registry access; the sandbox proxy refuses it (`ECONNREFUSED`). The installer is unchanged since round 12, and the committed 14/14 acceptance log stands. All isolation cases pass on the re-run (13/14).

## New findings
None.
