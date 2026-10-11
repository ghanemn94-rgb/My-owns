# DG4 round 3: qa-verifier narrative (T-DG4-REV-QA-R3)

**Verdict: PASS. No new findings.** Candidate `sha256:890faa12…` (1459 files, source `925f0bc`), confirmed at the start and the end in the repository and in three complete disposable clones. This is an engineering review. It grants no product gate (G1–G6) and no business, Finance or IT approval. Product G6 never implies DG7. All data used is synthetic.

## The round-2 repairs, as acceptance behaviour

- **F-DG4-122.** The value gap renders as "100 %" on T10, the Executive Overview and the Finance dashboard, in chromium-en and chromium-ar, never as "SAR 1.00" or "1.00 ر.س.".
  - The product's `p4-value-headlines.spec.ts` test 1 shows this, and so does my own auditor-side R3 check.
  - My R3 check runs at 1280 px, at 390 px and at 200 % text, with axe clean.
- **F-DG4-123.** On T10, the Executive Overview, the Finance dashboard and the workspace header:
  - the value headlines are on the profit-and-cash basis (90) and labelled with it;
  - top line (300) and non-cash (45) sit beside them, labelled, and are never summed (435 nowhere).
  - Test 2 asserts `headlineBasis` (no skip) and ran and passed in both projects in every full run.
- **My integration probes** (`tests/round-3/integration/dg4-qa-r3-headlines.test.ts`, 6/6, twice) go beyond the candidate's own test:
  1. The Finance gross line now drills, and its drill-down sums exactly to 95. In my round-2 probe it had no link.
  2. A non-trivial gap (0.666667) ignores a fully validated top line, and the RAG follows the exact ratio.
  3. Outsiders get 404 on the header, the dashboards and the drill-downs: a user with no grant, a user of another organization, and the Benefit Owner of another transformation.
  4. Malformed narrowing is refused: `valueClass=gross` or an unknown class gives 400; a class on the gap gives 422.
  5. A missing amount shows Unknown on the headline, the gap, Finance gross and the header, never 0 or green.
  6. The Q1 filter changes all three bases.
- **The changed tests** still assert their clauses literally:
  - the two KBE-R6 re-baselines in `tests/qa`;
  - the FE-R5 page-size step in `p4-dashboards` 4b.

## Full review

| Area | Result |
|---|---|
| Static checks (7) | All exit 0 |
| `pnpm test` | Green on Node 22 and 24, locale unset and C.UTF-8 |
| Integration | 1960/1960, twice: 61 migrations, 652 operations, every pending list empty |
| `tests/qa` alone | 172/172 |
| REQ-DLV-036 | 85/85 in integration, plus the A04 and A08/A09 e2e in both projects |
| My sweep | 513 checks per language, 0 failed: AUD read-only on 59 P4 routes, axe 0 serious or critical, 390 px and 200 % as AUD and as the lead |
| Validators | All PASS |
| 137-row trace | Clean |

## What went wrong in my own runs (all disclosed in `RUN-NOTES.md`)

1. **Integration run 2 was stopped and re-run.** I launched the chain without a background timeout, so its 30-minute limit stopped run 2. I re-ran it in full.
2. **Two locale-unset e2e runs overlapped in one clone.** I believed attempt 1 was dead: the sandbox hides other tasks' processes, and the log is buffered. It was not dead, so the two runs overlapped. That caused:
   - one ENOENT in attempt 1;
   - my spec missing in attempt 2's Arabic half.
3. **One remaining product-side non-pass: a load timeout.** P2 "Define → G2" hit its 30 s limit under load in every full run. It is a DG2 journey, cited by no DG4 row. It passed 24/24 when run alone in each locale setting. D-111, D-112 and D-115 record this behaviour.

## Observation (not a finding)

In a currency with only revenue-uplift or avoided-cost benefits, the Finance gross line is a known zero beside a not-applicable profit-and-cash headline. KBE-R6 handback §5.3 discloses this design choice. It is an exact empty sum, not missing data, and it is the domain reviewer's call.
