# DG4 round 4: code-security review (T-DG4-REV-SEC-R4)

- Candidate `sha256:5ff36f6e…` (1469 files)
- Source `ccc37c9`, freeze `afba46f`
- Session `6c1ad065`
- **Verdict: PASS.** No new findings.

## My round-3 finding

**F-DG4-105: CLOSED_VERIFIED.**

- **Probe GC rev 2 (my round-3 reproduction, re-run unchanged):** 2/2. Its REPRO test failed in round 3.
  - The USD profit-and-cash headline is n/a, and so is the USD Finance gross line.
  - Both hrefs now carry `currency=USD`.
  - Both drill to `{not_applicable, USD, no_profit_and_cash_benefit}` with no item.
- **New probe GX:** 151/151.
  - **Hrefs:** all 58 value headline and Finance line hrefs name their currency.
  - **Sums:** per-currency decimal sums equal every figure. No item appears in another currency, and every n/a figure drills to no item.
  - **No `currency`:** a two-currency scope gives `multiple_currencies`.
  - **Input handling:**
    - lower or mixed case, the wrong length, digits, a space, a comma, a non-ASCII character, a NUL and a repeated parameter all give 400;
    - the unknown but well-formed code `XYZ` gives 200, n/a, with no item;
    - all 8 non-value metrics give 422 `dashboard.currency_not_applicable`;
    - a cursor is refused if `currency` differs.
  - **Scope:** 117 TL1 cases (metric × currency × valueClass) behave as follows:
    - they equal AUD's T1 response;
    - a T2 or T1+T2 filter gives 404;
    - nothing of T2 leaks.
    - ADM-only and the outsider are refused. A T2 `subjectId` gives 422.
    - The control shows that a leak would be detected.
- **Residuals, not raised:**
  - `value.investment` answers a known zero for a currency with no line, as the contract documents; only a hand-written URL reaches it.
  - The USD gross line stays a known 0 beside the n/a headline. That is KBE-R6's design choice (a), the domain reviewer's call.

## Round-3 repairs, reviewed as code

- **Required members (probe RM4, 2/2):** `valueBasis`, `currency` and `kpiUnit` are required.
  - Deleting any of them, or sending a malformed `kpiUnit`, is rejected by ajv and by zod (10 mutations).
  - `contract.test.ts` passes 45/45 in both runs.
- **Outcome filter (probe OS, 3/3):** the filter (`status <> 'archived'`) runs over the readable scope's ids only.
  - TL1 sees no T2 outcome on the dashboards, the overview, My Work or the outcome drill-downs.
  - The archived outcome is hidden.
- **Web formatters (probe KU, 8/8):** hostile `kpiUnit.label` strings render as inert text in en and ar, in every state.
  - The scaling follows the kind, and a label never changes it.
  - Arithmetic is exact decimal: NaN, Infinity and junk give Unknown.
- **Repair diff:** no regression. It adds no write, no transaction, no migration and no tooling or dependency change.

## Checks

- **Static checks:** typecheck, build, lint, openapi (652 operations), no-cdn and format all PASS.
- **Unit:** 2885 + 259/2 skips on Node 22. The 2 skips are the explained NOCODEGEN ESLint cases.
- **Node 24, disclosed:** the harness run hit **one timeout**, `architecture.test.ts` "every import respects dependsOn".
  - It failed at 30 s at load average ~14-16. The test normally takes 17-26 s.
  - No assertion failed.
  - The spec alone passed 138/138, and a full re-run passed 2885/2885 + 259/2.
- **Integration:** 1975/1975 twice:
  - Node 22 with LANG unset (SQL_ASCII);
  - Node 24 with C.UTF-8 (UTF8).
  - 61 migrations each time.
- **Validators:** `validate --historical` DG3, DG2 and DG1 and `--pipeline` all PASS.
  - They ran in the tree, which had moved to e1c5184 because the domain reviewer's run auto-committed. I did not open those records.
  - They also ran at the freeze commit in my clone.
- **Earlier probes, re-run unchanged:** counts identical to round 3.

  | Probe | Result |
  |---|---|
  | Sweep | 766 |
  | IDOR | 204 |
  | Body IDOR | 2 |
  | Slice-B ids | 1 |
  | DS | 163 |
  | RM | 2 |
  | Approvals | 6 |
  | SoD denials | 4 |
  | Finance | 10 |
  | Gate commit-time | 6 |

- **Other checks:**
  - The commit-time scan residuals are identical to round 3, and the repair touches none of them.
  - The module graph has 0 cycles, and raid does not import governance.
  - The worker imports no API code.
  - All 43 p4-pending lists are empty.
  - The environmental residuals (D-057, D-058, D-049) pass on their offline/config surface.
