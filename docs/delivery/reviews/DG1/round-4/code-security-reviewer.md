# DG1 round 4: code-security-reviewer narrative

- **Task:** T-DG1-REV-SEC-R4
- **Candidate:** `sha256:6e0c0db1a8bea33cd81f05ea8c795d8ede4bfb7f380dfe146556cb4875a6f827` (395 files, source_commit `642e6bf`)
- **Verdict:** **PASS**
- **New findings:** none

## Candidate identity
The candidate ID was recomputed on the main working tree and on a disposable clone at `642e6bf`; both match.

HEAD moved from `91936e6` to `b476223` during the run, because the runner auto-committed the domain-reviewer's run evidence. Both commits after `642e6bf` touch only delivery metadata. I did not open the other reviewer's record.

Since the round-3 candidate (`4f312cc`), the manifest adds `apps/web/tsconfig.e2e.json`, changes `apps/web/package.json` and removes nothing.

## F-DG1-147: verified, CLOSED_VERIFIED
**What changed.** `apps/web/tsconfig.e2e.json` extends the strict `tsconfig.base.json` and adds the DOM lib and node types. It includes `e2e/**/*.ts` and `../../playwright.config.ts`. The apps/web `typecheck` script now runs `tsc -p tsconfig.json && tsc -p tsconfig.e2e.json`. The root `typecheck` script is `pnpm -r typecheck`, and `ci.yml:64` runs `pnpm typecheck`, so CI covers the e2e files.

**Fail-then-pass test** (`f147-fail-then-pass.log`):

| Injected error | Result with error | Result after revert |
|---|---|---|
| Wrong-type assignment in the spec | exit 2 under both `--filter @mth/web` and `-r` | exit 0 |
| Wrong-type assignment in `playwright.config.ts` | exit 2 | exit 0 |
| Call to the non-existent `Locator.notARealMethod()` | exit 2 (TS2339) | exit 0 |

The third case proves that Playwright's types really resolve and are not `any`.

The change does not relax `strict` and does not touch the build. It contains no secrets and no CDN references.

## No regression
Apart from the two tooling files, nothing under `apps/` or `packages/` changed. The round-2 fixes are byte-identical to round 3:
- the BU hierarchy guard and migration 0009
- destination authorization
- rate-limit keying

All required checks ran on Node 22 in a disposable clone, plus unit tests on Node 24:

| Check | Result |
|---|---|
| Typecheck | Pass |
| Build | Pass |
| Lint | Pass |
| OpenAPI lint | Pass |
| No-CDN scan | Pass |
| Format check | Pass |
| Unit tests | 326/326 on Node 22 and on Node 24 |
| Integration tests (two runs, each on a fresh PostgreSQL 16.13 cluster) | 209/209 both times |
| Gate and agent tests | 105/105 |
| Deploy script tests | 59/59 |
| SBOM check | OK |
| DG0 historical validation | PASS |
| `ci.yml` copies | All three byte-identical (`8b5b1106…`) |

## Environmental residuals (not BLOCKED checks)
- **D-057:** the install sandbox passes 13 of 14 checks offline. The only failure is `AC-1 (effect)`, which needs a live package registry.
- **D-058:** the live GitHub Actions run cannot be reproduced. The CI configuration and the delivery-gate scripts were checked and pass.

## Observation (non-blocking; not a finding)
The qa-owned root `e2e/a20-bilingual-shell.spec.ts` is still in no typecheck project. F-DG1-147 covered only `apps/web/e2e/**` and `playwright.config.ts`, and the assignment scoped the root suite out.

I type-checked it ad hoc under the same settings and it passes (exit 0), so this is a coverage gap with no current defect. I did not raise a finding because:
- it is a single acceptance spec;
- the CI e2e job executes it;
- qa-verifier owns it.

**Recommendation:** when qa next promotes tests, add `../../e2e/**/*.ts` to `tsconfig.e2e.json` or add a root e2e tsconfig. If `e2e/**` grows, this should become a tracked finding.
