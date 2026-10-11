# DG4 round 3: code-security review (T-DG4-REV-SEC-R3)

- Candidate `sha256:890faa12…` (1459 files)
- Source `925f0bc`, freeze `c94b2a2`
- Session `46add6c8`
- **Verdict: PASS.** One new finding, Medium and not mandatory, which I do not consider blocking.

## My round-2 finding

**F-DG4-104: CLOSED_VERIFIED.**

- At the freeze commit, in a complete disposable clone, all four validators print PASS and exit 0:
  - `validate.mjs --historical --stage DG3`, `DG2` and `DG1`;
  - `--pipeline`.
- The DG4 history is REVIEWING → FIXING → REVIEWING → FIXING → REVIEWING, with legal steps and timestamps in order.
- `546fb4e` only inserts the round-1 FIXING entry, dated at the D-117 commit. No earlier state or timestamp changed.
- The gate tooling is unchanged since DG3.
- Residual, not raised: `ba57107` corrected the free-text note of that entry, from "07:10Z" to the true commit time "07:05Z (commit 546fb4e)".

## Checks: all run, all PASS

- **Static checks:** typecheck, build, lint, openapi (652 operations), no-cdn and format.
- **Unit:** 2819/2819 + 259 with 2 skips, on Node 22 and on Node 24. Both skips are `skipIf(NOCODEGEN)` ESLint cases, the same as rounds 1 and 2.
- **Integration:** 1960/1960 twice:
  - Node 22 with LANG unset (SQL_ASCII cluster);
  - Node 24 with LANG=C.UTF-8 (UTF8 cluster).
  - Migrations 0001–0061 applied each time. contract 45/45, media-types 21/21.
- **Prior probes, re-run unchanged:**

  | Probe | Result |
  |---|---|
  | Sweep | 766 |
  | Path IDOR | 204 |
  | Body IDOR | 2 |
  | Approvals (SoD, delegation loop, races) | 6 |
  | Finance SoD denials | 4 |
  | Finance integrity | 10 |
  | Gate commit-time | 6 |
  | Slice-B ids | 1 |

  The counts are identical to round 2, with no leak and no missing denial.
- **New probes:**
  - **DS:** the drill-down scope sweep after the `asBuilt` removal, every value metric × `valueClass` × filter; 163/163. TL1 sees only T1. T2 is 404. A foreign `subjectId` gets the uniform 422. ADM and the outsider see nothing.
  - **RM:** the three ARCH-R5 members are enforced as required by ajv and zod; 2/2.
  - **FP:** `formatPercent` and the headline components with hostile strings; 13/13.
- **Other checks:**
  - The commit-time scanner's residual set is identical to round 2's, and the repair touches none of those files.
  - The module graph has no cycle, and raid does not import governance.
  - The worker imports no API code.
  - All 41 p4-pending lists are empty.
  - Decimals are used throughout.
  - The environmental residuals (D-057, D-058, D-049) pass on their offline/config surface.

Disclosed:
- The first DS run used `limit=200`, above the maximum, and got 400 on every call. That was a probe error; revision 2 fixed it.
- The domain reviewer's run auto-committed `eae9978` during my run. The harness's tree-level validators therefore ran at `eae9978`. I re-ran them at `c94b2a2`.

## New finding

**F-DG4-105 (Medium, not mandatory, owner kpi-benefits-engineer).**

The case is a scope with a SAR profit-and-cash benefit and a USD benefit that is revenue uplift only.

What happens:
- The USD profit-and-cash headline is `not_applicable`, as designed.
- Its drill-down returns value **SAR 70** with the SAR record.
- The USD Finance gross line (a known 0) carries the same href.

Why: `valueDrill` takes its currencies from the eligible profit-and-cash benefits only, and the href carries no currency.

What it contradicts:
- KBE-R6's handback §5.3(a): "n/a … with no item";
- the n/a → no-item rule of the repair's own test, which does not cover this case.

Reproduction: probe GC revision 2, whose REPRO test fails by design.

Impact: no scope leak and no wrong stored amount; the strict per-currency sum, USD = 0, still holds.

Observation for the domain reviewer: the gross line stays a known 0 beside the n/a headline. KBE-R6 disclosed this as design choice (a).
