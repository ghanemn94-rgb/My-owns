# DG1 round 16: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:56f3eb885c6cf3db406e280d232e48ebcefddad173107a744bb9b8ca74fc2b4c` (base `13418b8`, freeze `aa7d9a8`, 391 files). The ID was recomputed in the repo and in a disposable clone.

## Findings verified
| Finding | Raised by | Result |
|---|---|---|
| F-DG1-218 (Low) | qa-verifier (r15) | CLOSED_VERIFIED |
| F-DG1-137 (Low) | code-security-reviewer (r15) | CLOSED_VERIFIED (same root cause) |

How I verified them:
- **Independent probe.** `docs/delivery/test-evidence/DG1/qa/tests/round-16/qa-r16-declaration-file-probe.test.ts` covers a 125-name matrix, 112 of which `walk()` collects. The candidate's `isDeclarationFileName()` agrees with TypeScript's public `SourceFile.isDeclarationFile` and with the runtime-internal `ts.isDeclarationFileName` for every name. No collected name throws, and a syntax error always yields a named `unparseable source` diagnostic. Result: 246/246 on Node 22.22.2 and on Node 24.21.0.
- **Mutation control.** I restored the round-15 regex in the clone only. That reddens the 2 new self-checks and 11 probe cases with the original `Debug Failure. Output generation failed`, so the tests do discriminate.
- **Scope.** The change is test-only: `architecture.testkit.ts` and `architecture.test.ts`. `vitest.config.ts` is untouched, and the testkit is excluded from the runtime build.

## Regression checks (all re-run, real output)
- **Static checks:** build, typecheck, lint, OpenAPI (33 ops), no-CDN, Prettier and contrast are all clean.
- **Unit:** 325/325 on Node 22 and Node 24, with architecture 132/132 and unit-web 110/110. F-DG1-214 holds.
- **Integration:** 200/200 in 4 runs on disposable PostgreSQL 16.13 (Node 22 ×2, Node 24, Node 22 under CPU contention). There were 0 57P01 errors and 0 "Hook timed out", so F-DG1-009 and F-DG1-136 hold. Migrations 0001–0008 apply, `audit_event` is append-only (UPDATE, DELETE and TRUNCATE are rejected), and the contract test covers `getBrandingTokens`.
- **e2e:** 22/22 EN+AR on both runtimes, and the F-DG1-210 BU-Lead journey is green. Axe reported no violations. I inspected the AR screenshot visually (RTL, Unknown state, provisional wordmark).
- **Acceptance:** A12 14/14, A13 5/5 and A14 5/5 in every run; A18 clean start PASS; A20 green in EN and AR.
- **Validator and register:** `--register DG1`, `--pipeline` and `--reconcile` all PASS. All 12 requirements are IMPLEMENTED with final_gate DG1, and none of their evidence is missing.
- F-DG1-217's own self-checks remain green.

## Observations (not findings)
- Under Node 24, the Playwright list reporter prints shifted spec line numbers (for example `journeys.spec.ts:482` for a 443-line file). Round 15 shows the identical pattern, and the clone was clean with an unchanged candidate ID. It is a tooling location artifact with no product impact.

## BLOCKED (not claimed as passed)
- **REQ-DLV-042:** a live re-run of the installer's registry fetch. The reviewer sandbox has no registry network (D-025). The requirement rests on the unchanged orchestrator acceptance log (14 PASS, 0 FAIL) and `bash -n`.

## Independence
- I authored no implementation in scope, and I did not read any other round-16 reviewer record.
- A runner auto-commit of the domain-reviewer run moved HEAD to `925a48b` during my run. I saw only its directory names, and the candidate ID was unchanged.
- The disposable clone was removed (`50-cleanup.log`).
