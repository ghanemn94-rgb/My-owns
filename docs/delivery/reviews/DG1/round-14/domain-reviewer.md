# DG1 round 14: domain-reviewer narrative

- **Candidate:** `sha256:dd747fe1df62d876a74101caa826542b90d3eb36cedb1de14f299b0b6de8c559`, freeze commit `985d0fa`.
  - The repo HEAD is `6a3e3b2`. It adds only candidate-excluded metadata.
  - The candidate ID recomputes identically in the repo and in a full disposable clone.
- **Verdict:** PASS. There are no new findings.
- **F-DG1-135:** verified as CLOSED_VERIFIED in `domain-reviewer.verifications.json`.

## What changed
Only test code changed:

- `architecture.testkit.ts`: `TEST_FILE` is now `/\.test\.tsx?$/`, and its comments were updated.
- `architecture.test.ts`: has F-DG1-135 self-checks.

Every product, runtime, contract, migration, build-config, ADR, OpenAPI, i18n and source path is identical to round 13.

## F-DG1-135 verification
- **Classification matches the build.** `TEST_FILE` now equals the `tsconfig.build.json` exclusion (`.test.ts`, `.test.tsx`).
- **Probe on disk.** I planted these files in `modules/kpi`: `zz-dom14.test.{mts,js,cts,mjs,cjs,jsx}`. Each imports vitest and `../../modules.ts`.
  - All six are now flagged with both violations, on Node 22 and on Node 24.
  - A `.test.ts` twin with the same content is not flagged.
- **Pre-fix control.** Run against the round-13 testkit, the same probe misses all six. That reproduces the original gap.
- **Real tree unchanged:**
  - The 7 real module test files are all `.test.ts`.
  - The 13 modules have zero violations.
  - The architecture suite passes 128/128.
- **Remaining `.test.tsx` case (observation only).** A `.test.tsx` file keeps the test allowance, but vitest collects only `.test.ts`. It is excluded from the build and never ships, and the finding's own "expected" calls that case harmless.

## No regression
- **Unit tests:** 321/321 on Node 22 and on Node 24.
- **Integration tests:** 200/200 in four runs against throwaway PostgreSQL 16.
  - Covered: the G6 closure refused with 422 invalid-transition, the scoped-access 404/403 rules, revocation, OIDC/identity, and cursor binding and pagination.
  - One Node 24 PostgreSQL log line, "FATAL: the database system is starting up", comes from the script's own readiness poll. It is not a product error.
- **Live shell:** 108/108 checks pass on Node 24, the same check set as round 13. I looked at the screenshots myself:
  - Arabic renders RTL and English renders LTR.
  - The closed status is never offered, and the G6 hint is shown.
  - Missing data shows Unknown chips, never zero or green.
  - The wordmark is provisional and the tokens have `provenance=provisional`.
- **Static checks:** no-cdn, openapi:lint, typecheck, lint and format:check all pass.
- **Invariants:**
  - Every "official", "certified" and "PMI" mention in the catalogues is a negation.
  - DG0–DG7 appear nowhere in the product catalogues. G6 is labelled as a product gate.
  - DG1 has no money columns and no float money.

## Register
- The register is unchanged.
- The 8 assigned rows and all 12 DG1-final rows are IMPLEMENTED, and none is missing evidence.
- The 29 later-gate P1-increment rows are SPECIFIED and claim no evidence.
- The round-12/13 closures all hold.
- There is no open Critical, High or mandatory finding.

## Process notes, recorded for honesty
- **Probe bug.** The first run of my probe failed one case because I iterated `API_MODULES` as an array. I fixed the probe, and the recorded outputs come from the fixed version.
- **Empty grep section.** In one combined static-check run the grep section came out empty for a reason I could not identify. I re-ran it on its own (`09b-static-greps.out.txt`), and that file supersedes it. The pnpm results in that run are valid.
