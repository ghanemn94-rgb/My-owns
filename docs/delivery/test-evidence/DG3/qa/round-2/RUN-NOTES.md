# qa-verifier DG3 round 2: run notes (every non-zero exit disclosed)

Everything ran in one disposable clone, `$TMPDIR/review-dg3` @ f49ca160, candidate sha256:58ef3f47… (754 files). The clone and all test scratch are removed at the end of the run. My spec is `docs/delivery/test-evidence/DG3/qa/tests/round-2/e2e/dg3-qa-r2.spec.ts` (sha256 4a313bab…). It ran as `e2e/dg3-qa-r2.spec.ts` inside the clone, with an identical sha256, and was never added to the candidate tree.

## What changed from the round-1 spec, and why

The spec is a copy of `round-1/e2e/dg3-qa-r1.spec.ts`. The round-1 tests A0–A10, U1, U2 and Z are unchanged, apart from three renames: the header comment, the results file name (`dg3-qa-r2-checks-*`) and the transformation name ("R2"). Three tests were added for the repair:

- **IA1** (API, F-DG3-120 repair) covers:
  - two synthetic **Modular** transformations, which together show every annotation state (null, pending_verification, accepted with counts true, accepted with counts false, rejected, revoked);
  - the selection rule: counting first, then newest pending, then newest;
  - the negatives: End-to-End refused 422; G4 refused 400;
  - the gate status staying draft, with no submission and no gate decision/submission audit event;
  - AUD reading the same annotation, with every write 403;
  - revoke without If-Match → 428.
- **U3** (UI): the Gates list and the gate view in the project's language, as TL and as AUD. It checks the badge state, the text, the neutral chip class, the source line, the link, axe, dir/lang, and that AUD sends no writes.
- **F180** (layout probe, the LAST test of the serial file): every badge must lie inside its gate card or field. It **fails on the candidate** (finding F-DG3-180), in both projects and both locale settings. It is kept outside `checks`/Z on purpose, so its failure is its own test and never masks or skips another one.

## Non-zero exits

1. **Full e2e, both locale settings** (`04-e2e-unset.log`, `04-e2e-cutf8.log`): EXIT 1 in each, 204 passed and 2 failed.
   - The 2 failures are `F180 layout probe` in chromium-en and in chromium-ar. The assertion that fails is `expect(out.filter((x) => !x.inside)).toEqual([])`.
   - chromium-en: 7 of 7 badges lie outside their box. For example, the M1 G3 list badge spans x 946–1449 in a card of 933–1239, on the 1280 px viewport.
   - chromium-ar: 4 of 7 lie outside their box. See `results/e2e-*-f180-layout-*.json`.
   - Cause: `.status-chip { white-space: nowrap }` (apps/web/src/styles/app.css:803) applied to the long badge text. This is a product defect, reported as F-DG3-180.
   - Every other test passed: the 172 product + A20 tests (the same set and count as in round 1), and my 32 other tests (Z included: 163 recorded checks per project, 0 failed).
2. **trials/04-trial-1..4.log**: development iterations of MY spec (locale unset, both projects).
   - trial 1, EXIT 1: my audit probe used `limit=200`, and the API's maximum is 100, so it got 400 (my test).
   - trial 2, EXIT 1: my audit filter also counted the six `gate_instance.create` events written when a transformation is created (my regex, which was too broad). It now excludes `gate_instance.create` and requires exactly 6 of them.
   - trial 3: EXIT 0, 32/32.
   - trial 4, EXIT 1: the new F180 probe failed (the product defect). It was then the 15th test of the serial file, so Z "did not run" (2 did not run). I moved F180 after Z, so a failure never skips anything.
3. **01b-lint-negative-probe.log**, EXIT 1 by design: a throwaway file in the clone's `packages/shared/src/formula/` used 9 forbidden forms (createRequire from node:module, child_process, a `Function` alias, `globalThis["Function"]`, `Reflect.construct`, `.constructor` read, `{constructor}` destructuring, template-literal `["constructor"]`, `createRequire()()`). ESLint refused every line (14 errors). The file was deleted, and `git status` in the clone was clean afterwards.

## Notable lines in passing logs

- **Integration logs:** `BE18 Q7 … idp_unavailable` is stdout of the passing test commit-time-auth.test.ts Q7, which simulates a never-answering IdP on purpose. The `BE17 R6*/R8` lines are stdout of passing request-io/connection-hygiene tests, with `errors: []`.
- **Unit logs:** every line matching "error"/"fail" is the name of a passing (✓) test.
- **Build:** Vite's advisory "Some chunks are larger than 500 kB" (apps/web), not an error.
- **Contrast:** the three "fails" lines are the documented prohibited pairs, asserted to fail by design.

## Locale

`locale -a` shows C, C.utf8 and POSIX. The two binding settings are unset and C.UTF-8, and both ran for unit and e2e. Unlike round 1, no ar_SA unit run was made, because that locale is not installed and glibc would only fall back to C.
