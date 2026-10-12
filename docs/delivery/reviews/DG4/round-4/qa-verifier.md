# qa-verifier: DG4 review round 4 (T-DG4-REV-QA-R4)

**Candidate** `sha256:5ff36f6e74af1853096e057ba6deee19df8ae44f9f06a7f3d2e184d1160e0f98` (1469 files, source `ccc37c9`, freeze commit `afba46f`). **Verdict: PASS**, with two new, non-blocking findings:

| Finding | Severity | What |
|---|---|---|
| F-DG4-143 | Medium | A not_applicable Value RAG line is shown as "Unknown". |
| F-DG4-144 | Low | The business-unit filter's "too_many" note advises a remedy that cannot work. |

Product gates G1–G6 are business approvals inside the product. Nothing here decides one, and none of them relates to DG0–DG7. All test data is synthetic.

## What I ran

All of it ran in disposable copies of `afba46f` under `$TMPDIR`, which are now removed. The index and every non-pass are explained in `docs/delivery/test-evidence/DG4/qa/round-4/RUN-NOTES.md`.

| Area | Result |
|---|---|
| Candidate | Same ID and 1469 files at the start and the end, on a complete clone and on the working tree |
| Static | typecheck, build, lint, openapi:lint (652 operations), no-cdn, format, contrast: all exit 0 |
| Unit | Node 22 and 24 × locale unset and C.UTF-8: 2885/2885, plus 259 passed and 2 skips (by design) |
| Integration (×2) | 208 files / 1975 tests each, 61 migrations, contract included; all 47 p4-pending lists empty at runtime |
| `tests/qa` alone | 172/172 |
| REQ-DLV-036 | 85/85 in integration: A04 8+4, A09 17, A10 16, A11 12+11+17. The e2e A04 and A08/A09 specs pass in both projects. |
| e2e | All 30 spec files, both projects, both locale settings; failures re-run alone (below) |
| Validators | register DG4, pipeline, historical DG3/DG2/DG1: PASS |
| Trace | 137/137 rows with evidence tests in this round's logs; no failure left unresolved |

### e2e: what failed in the full runs, and why

The full runs ran at a load average of 13–16, because the three reviews ran at once.

- **30 s test timeouts:** p2 'Define → G2' (a DG2 journey), p4-adoption-bau 6 and p4-benefits 8. All three pass alone.
- **p4-dashboards 3 in ar** failed in both full runs. By the time the ar half runs, the suite has created more than 50 transformations in SYN_RETAIL. With that many, the product's documented 50-transformation block on the business-unit chip sends no request, so the test waits in vain. It passes alone. My BU-limit probe reproduces the mechanism, and that is how I found F-DG4-144.
- **p4-dashboards 4b in ar** failed in the C.UTF-8 solo run. My own R4 world had added USD rows earlier in the same stack, which pushed the SAR net line to page 2 of the paginated gross/net table. This is test-data volume: the spec passes alone (14/14).
- **The C.UTF-8 full run was stopped** by my shell's 2-hour background limit at test 365 of 368. Its tail (all of `e2e/`, my sweep included) was re-run alone.

## The round-3 repairs, as acceptance behaviour on the integrated stack (EN and AR)

- **F-DG4-126:** the Value RAG is Red for margin 70 validated beside 300 of unvalidated revenue uplift (API probe Q1). Each basis and currency has its own line, never summed. An unknown line makes the RAG unknown, never green (Q2). On screen there are four lines with the right statuses, and each red line reads '100 %'.
- **F-DG4-127:** the Portfolio value is on the profit-and-cash basis: 70 on screen (never 370), and 90 in KBE-R7's test. The column and a chip label the basis. n/a and Unknown show with their reasons, and the ranking is right. Decimals and the transformation's currency are kept: SAR 35.25 from 50 % of 70.5, and a USD benefit is never added (Q5).
- **F-DG4-105:** more than 30 value hrefs on T10, the Overview, Finance and the header each name their currency, and drill to exactly that currency's figure and records (Q3). The negatives behave as specified: 400, 422 `dashboard.currency_not_applicable`, multiple_currencies, a cursor bound to its currency, and no figure without a grant (Q4). On screen, the USD and SAR drill dialogs show their currency and only their own records.
- **F-DG4-125 and D-124:** p4-percentage-kpi and p4-kpi-unit pass in both projects in both full runs: '12 %', '12 % of users', '1.5' (never '150 %'), and the gap '100 %'. An outcome created through the API is listed in T10 Outcomes, Unknown without an actual (my check, and KBE-R8's test).
- **Re-baselined tests:** each KBE-R7 and KBE-R8 change follows ADR-0037 N4/N5 and still asserts its clause; KBE-R7's drill invariant is now stricter. No QA acceptance file changed.

## New findings

**F-DG4-143 (Medium, frontend-ux-engineer; REQ-S13-003).** When a basis has nothing due, the API sends its gap line correctly: status `not_applicable`, reason `dashboard.value.nothing_planned`. But `ValueRagLines` (`apps/web/src/pages/dashboards/ui.tsx`) turns every null gap ratio into an `unknown` value. The screen therefore reads "Non-cash SAR · Value gap: Unknown — Not applicable: nothing is planned to date — Not applicable", which breaks the zero / unknown / n/a distinction (ADR-0037 N4 item 4, M0244). It is never shown as 0 or green, and the area RAG is right. No web test covers an n/a line.

**F-DG4-144 (Low, frontend-ux-engineer; REQ-S13-002).** With more than 50 readable transformations in a unit, the note tells the user to "narrow the filter by phase or status". `useOrgQuery` decides the block from the unit's list alone, so phase 'realize' plus status 'closed' (which match nothing) leave the block in place and send no request. The block itself is the documented limit. Only the advice is wrong.

I consider neither finding blocking. Neither is Critical, High or mandatory. Every requirement I checked has evidence, and every failure in the logs I cite is explained above and in the run notes.
