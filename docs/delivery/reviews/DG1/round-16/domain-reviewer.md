# DG1 round 16: domain-reviewer

- **Verdict:** PASS
- **Candidate:** `sha256:56f3eb885c6cf3db406e280d232e48ebcefddad173107a744bb9b8ca74fc2b4c` (391 files). It recomputes identically in the repository at aa7d9a8 and in a full disposable clone at 13418b8.
- **Task:** T-DG1-REV-DOM-R16.
- **Run:** `DG1-T-DG1-REV-DOM-R16-domain-reviewer-20261001T181001Z-c1704dc0`.

## F-DG1-137 / F-DG1-218: verified, CLOSED_VERIFIED (sidecar)

- **What changed:** `syntaxErrors()` now classifies declaration files with `isDeclarationFileName()`, which reads the public `SourceFile.isDeclarationFile`. It agrees with TypeScript 6.0.2's internal `ts.isDeclarationFileName` on 22 names, with 0 mismatches. No declaration-file name reaches `ts.transpileModule` any more.
- **No coverage gap:** my on-disk probe planted `.d.css.ts`, `.d.json.ts`, `.d.ts.ts` and `.d.html.ts` files, plus the classic forms, in `modules/kpi`. All of them are still scanned:
  - deep type imports and composition-root imports are reported;
  - syntax errors produce named `unparseable source` diagnostics;
  - clean files produce `[]`.
  
  The probe passes 30/30 on Node 22 and on Node 24.
- **Negative control:** the same probe against the round-15 testkit fails exactly the 16 arbitrary-extension cases with `Debug Failure`.

## No regression

The repair is test-only: `architecture.testkit.ts` and `architecture.test.ts`. There is no product, API, data, i18n or config change, and `vitest.config.ts` is untouched.

| Suite | Result (Node 22 and Node 24) |
|---|---|
| Unit | 325/325 |
| Architecture | 132/132 |
| Integration | 200/200 on a throwaway PostgreSQL 16, with no leftover databases |

The live AR/EN stack passes 108/108 checks:
- The G6 close is refused with 422 and nothing is written.
- Scoped access returns 404 and 403 as expected.
- Cursor pagination works over all six sorts, and tampered cursors get a 400.
- Identity cookie handling works.
- Branding tokens are provisional, with no official Mobily or PMI claim.
- Arabic renders RTL and English LTR.
- Missing data shows Unknown, never 0 or green.
- There is no CDN request.

I looked at the screenshots `ar-02-edit-no-closed.png` and `en-03-detail-audit.png`.

The register is unchanged. The 8 assigned rows and all 12 DG1-final rows are IMPLEMENTED with no missing evidence. The 29 non-final P1-increment rows stay SPECIFIED, so nothing is over-claimed. The prior domain closures hold.

## Findings

None new. There is no open Critical, High or mandatory finding.

## Independence

I authored none of the DG1 implementation. I read no other reviewer's round-16 record before forming my verdict.
