# DG1 round 12: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:619d74ffa4e668933960fc14aa5d8c4c31850a2772972bceb647561be2efdfac`, freeze commit `987ae02`. The ID recomputes identically in a full disposable clone. HEAD later moved to `163d0ca`, but only through a runner auto-commit of the domain-reviewer records, and the ID did not change.

## What changed
The round-11 → round-12 manifest diff covers only `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. This is a test-side lint, so no product runtime source changed.

## Findings verified
- **F-DG1-132: CLOSED_VERIFIED.** Rule 5 (`node:crypto` by named imports only) flags every namespace/default binding.
  - The candidate self-check (E1–E5, N1–N10 and the controls) is green on Node 22.22.2 and on Node 24.21.0.
  - My independent probe (`test-evidence/DG1/qa/tests/dg1-r12-rule5-probe.test.ts`) passes 41/41 on both runtimes:
    - **21 binding forms are flagged**, including some not in the implementer's table: the string-literal `"default"` specifier, `export { default }`, `import c, * as d`, template-literal `import()`, `.then`, import attributes and a multi-line import.
    - **The enumeration routes are flagged at the import:** the round-11 routes E1–E4 and X2, plus the new X3 and X4.
    - **Named imports cannot reach `setEngine`:** a runtime BFS over the 69 named exports finds no path to `setEngine` or to the module object.
    - **The real module tree is named-only:** 41 files, of which 5 import crypto, all through named imports.
- **F-DG1-133: CLOSED_VERIFIED.** The testkit header no longer says "not closable statically". It no longer cites `identity/routes.ts` / `access/rules.ts`. Residual (a) is now plain-object/third-party data flow, accepted by choice, and the plain-object idiom stays allowed.

## Regressions re-confirmed
- **F-DG1-214 holds:** unit tests pass 315/315 on Node 22 and Node 24, with unit-web at 110/110 on both and 0 AbortSignal errors.
- **F-DG1-009 holds:** integration passes 200/200 on 3 runs (2 on Node 22, 1 on Node 24), with 0 `57P01` errors and 0 terminated connections.
- **F-DG1-210 holds:** e2e passes 22/22 on Node 22 and on Node 24, including the BU-Lead journey in EN and AR. The QA-authored no-reload spec passes 2/2.
- **Database:** the contract suite passes 9/9, including getBrandingTokens. Migrations 0001–0008 apply. The audit trigger rejects UPDATE, DELETE and TRUNCATE.
- **Acceptance:** A12, A13, A14, A18 and A20 all PASS.
- **Static checks:** build, typecheck, lint, OpenAPI (33 operations), no-CDN, Prettier and contrast are all green.
- **Validators:** `--register DG1`, `--pipeline` and `--reconcile` all PASS.
- **Requirements:** all 12 DG1-final requirements are IMPLEMENTED, with 0 missing evidence files.

## BLOCKED
- **REQ-DLV-042 AC-1 (effect):** my re-run of the installer suite gives 13/14. The failing case needs registry network (`ERR_PNPM_META_FETCH_FAIL`), and the reviewer sandbox has none. `tools/deps` and the recorded 14/14 log are unchanged since round 11.

## New finding
- **F-DG1-216 (Low, non-mandatory, docs-only; proposed ID):** D-055 in `docs/delivery/decisions.md` still says that reaching `setEngine` "by namespace enumeration is residual (a)". Rule 5 now closes that route, so the decision record contradicts the lint it documents. The fix is a one-line correction, or the finding can be accepted as an observation. It does not block DG1.

All code ran in disposable clones under `$TMPDIR`, which I removed afterwards (`50-cleanup.log`). Evidence is in `docs/delivery/test-evidence/DG1/qa/round-12/`.
