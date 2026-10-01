# DG1 round 15: domain-reviewer narrative

**Verdict: PASS**, with no new findings.

- **Candidate:** `sha256:76d8b3049d22d414a4c036bd3dd1af6e0c3609baedb096e2d2ecf4180bf07846`, freeze commit `f27b5a6`.
- **Recompute:** the ID recomputes identically in the repository (HEAD `c7edc14`, which differs only by excluded freeze metadata) and in a full disposable clone.

## Round-15 repairs (both verified, CLOSED_VERIFIED in my sidecar)

### F-DG1-217: lint crash on `.d.ts`

`syntaxErrors()` now sends declaration files to a no-emit `createProgram` + `getSyntacticDiagnostics` path. Declaration files are still walked and scanned.

My on-disk probe planted `.d.ts`, `.d.mts` and `.d.cts` files in `modules/kpi`:
- deep type imports are reported;
- composition-root imports are reported;
- a syntax error gives a named `unparseable source` diagnostic;
- a clean file gives `[]`.

The probe passes 13/13 on Node 22 and on Node 24. The same probe against the round-14 testkit throws `Debug Failure` in all 12 plant cases, so it reproduces the original defect.

### F-DG1-136: integration hook budget

The integration project now sets `hookTimeout: 30_000`. A 12 s `afterAll` completes under the candidate config and times out at 10000 ms under the round-14 config. The change only affects tests.

## No regression

- **Change scope:** the 985d0fa→f27b5a6 diff touches only `vitest.config.ts` and the two test-only architecture files. There are no product, runtime, contract, data-model, i18n or source changes.
- **Test runs** (Node 22 and Node 24):
  - unit: 323/323;
  - architecture: 130/130;
  - integration: 200/200, including the G6 close refusal (422 invalid-transition), cross-scope 404/403, revocation, OIDC and cursor pagination.
- **Live shell** (ar and en): 0 failures, with the same check set as round 14.
  - `closed` is never offered, and the G6 product-gate hint is shown.
  - Branding is `provenance=provisional` (`#0078FF`) with a provisional wordmark.
  - Missing data shows Unknown, never 0 or green.
  - Arabic renders RTL and English renders LTR. I viewed the screenshots.
- **Static checks:** no CDN, OpenAPI lint, typecheck, lint and format all exit 0.
  - Every official/PMI/certified mention is a negation.
  - No DG0–DG7 appears in the product catalogues.
  - There are no float money types.
- **Register:** unchanged. All 12 DG1-final rows are IMPLEMENTED with no missing evidence. The 29 later-gate P1-increment rows are SPECIFIED with no evidence claimed.
- **Earlier closures:** F-DG1-001..011, 105, 131..135, 207, 209, 210 and 216 still hold. There is no open Critical/High/mandatory finding.

## Notes

- **Shared transition table:** `TRANSFORMATION_STATUS_TRANSITIONS` still lists `closed` as a target. The route-level refusal is what is enforced, and it was verified at runtime. This is unchanged from rounds 13 and 14 and is not a new finding.
- **pnpm store:** the read-only HOME pnpm store had to be copied to `$TMPDIR` for the offline install. This is a sandbox constraint, not a candidate defect.
- **No business approval:** this engineering review grants no G1–G6 business approval. Product G6 is not DG7.
