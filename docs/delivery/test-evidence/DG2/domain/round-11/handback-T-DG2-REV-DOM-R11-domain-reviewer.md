# Handback — T-DG2-REV-DOM-R11 (domain-reviewer, DG2 round 11)

**Location.** The assignment's handback path, `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R11-domain-reviewer.md`, is outside the domain-reviewer write scope; the write guard refused it. This copy sits in my evidence directory, as in round 10. The orchestrator may move it.

**Verdict: PASS. No new findings** (F-DG2-420..429 unused). I had no open finding to verify, so I wrote no verifications sidecar.

## 1. Changed files

Review records and evidence only. No implementation was touched.
- `docs/delivery/reviews/DG2/round-11/domain-reviewer.json` is the review record. It validates against `review.schema.json`.
- `docs/delivery/reviews/DG2/round-11/domain-reviewer.md` is the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-11/**` holds the logs, probes, `env.txt`, the stack harness and 10 cited screenshots.

## 2. Behaviour verified, per requirement

All 26 assigned requirements pass. The record maps each one to its checks: DOM-R11-06, 07 and 11–14.

D-071 / BE16 doesn't change any domain behaviour:
- **Normal upload:** it still uploads and downloads byte-identical, keeps its Arabic file name, and stays keep-alive.
- **Oversized upload:** it gets the localized 413 `evidence.too_large`, the connection closes at once, and nothing is stored.
- **Product gates:** they still advance strictly G1→G2→G3, and only G1–G6 exist.

## 3. Checks actually run

All ran in a disposable clone at 309aff2c, on Node 22.22.2 and 24.21.0:

| Check | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 on both |
| `pnpm -r build` | exit 0 on both |
| `pnpm lint` | exit 0 on both |
| `pnpm test` | 771/771 on both, exit 0 |
| `check:contrast` | PASS on both |
| Stack run 1 (disposable PG16 :55021 + API :3921): API probes | 208 PASS, 0 FAIL |
| Stack run 2 (fresh stack): Chromium UI probes | 66 PASS, 0 FAIL, plus the observational B0009 probe |

The candidate ID was recomputed before and after the runs, and it matches. DG1 historical validation passes.

Every warning or non-zero line in the evidence is explained in each check's `actual`:
- the pre-build bin WARN lines from the install;
- the Vite chunk-size advisory in the build;
- the prohibited contrast pairs (negative controls);
- the FSTDEP022 deprecation notice in the unit tests;
- the intended SQL_ASCII probe, which exits 1 by design.

## 4. Known gaps

The environmental residuals (live registry D-057, live CI D-058, Keycloak D-049) were checked only on their offline/config surface. They are not gate checks.

## 5. Merge instructions

None. The runner copies back the round-11 domain-reviewer files.
