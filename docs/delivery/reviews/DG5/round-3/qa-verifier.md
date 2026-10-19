# DG5 round 3: qa-verifier review (T-DG5-REV-QA-R3B, re-run)

**Verdict: PASS.**
- Candidate: `sha256:fc93b239904677e598a3155695747f4c4b71c9ec7a9471a2d6748c41c0e757fd` (2187 files, source `bbd6294`).
- I verified it on a complete disposable clone (`e661a6c`) and on the main checkout, at the start and at the end of the review.
- Files: the record is `qa-verifier.json`, the round-2 finding verifications are in `qa-verifier.verifications.json`, and the new findings are in `qa-verifier.findings.json`.
- Evidence is in `docs/delivery/test-evidence/DG5/qa/round-3/`, and my probes are in `docs/delivery/test-evidence/DG5/qa/tests/round-3/`.
- I did not use the orphaned first run's material.

## My round-2 findings

| Finding | Result | How it was verified |
|---|---|---|
| F-DG5-142 (non-focusable scroll regions on non-P5 screens) | CLOSED_VERIFIED | See below. |
| F-DG5-143 (p5-forms T01 order-dependent) | CLOSED_VERIFIED | See below. |

**F-DG5-142.**
- My round-2 reproduction, re-run unchanged, is now clean: 0 axe issues and 0 bare regions on all 12 screens, in en and ar, in both locale settings.
- A new probe covered 38 DG2–DG4 screens at 390 px, at 1366 px and with 200 % text. It found 0 serious or critical axe violations, and every scrolling region is focusable and named.
- Real Tab presses reach every region on the finding's four screens, and the arrow keys scroll it, in RTL as well.
- FE-X1's spec passes on the demo stack and on the production stack.

**F-DG5-143.**
- The diff changes only the locator; the assertions are unchanged.
- The UUID premise still holds: in 400 of 500 trials, the first item by id was not the first created.
- `--repeat-each=10` results, with T01 at 20/20 in every run:
  - locale unset: 60/60;
  - C.UTF-8, first run: 59/60, the one failure being a Chromium renderer crash in T14 under memory pressure;
  - C.UTF-8, second run: 60/60.

## Runs

| Check | Result |
|---|---|
| Static checks | All exit 0. openapi:lint reports 846 operations. |
| Unit tests | 2340 / 1711 / 259 + 2 skipped, clean in every Node/locale combination. The Node 22 boundary test timed out at 30 s in 4 of 6 runs under load: F-DG5-145, Low. |
| Integration | 318 files, 3056 passed + 1 skipped, twice. The first run 2 was stopped by my tool's 2 h task limit with no failure, and was replaced. All p5-pending lists are empty. |
| `tests/qa` alone | 336/336. |
| Product e2e, C.UTF-8 | 444/444. |
| Product e2e, locale unset | All 444 pass across the runs. Load timeouts in half A were re-run and are disclosed in QA-R3-05. |
| Root e2e | 30/30 in each of three runs. |
| Demo e2e | 12/12 in each of two runs. |
| Validators | All PASS. |
| REQ-DLV-037 counts | A06 27, A07 12, A15 34, A16 30. |
| Export samples | 26 samples inspected in en and ar. |

## New findings

**F-DG5-144** (Medium, not mandatory, REQ-S15-009; final gate DG6, so not blocking DG5).
- The Diagnose screen scrolls horizontally at page level at 390 px (433 px in en, 394 px in ar) and with 200 % text.
- Cause: the `.workstreams` grid has a single auto track, and it grows to the widest card's min-content.
- It is not a regression: that CSS is unchanged since DG2. It should be repaired before DG6.

**F-DG5-145** (Low): a test-reliability issue in the ADR-0002 boundary test's budget. The precedent is F-DG2-143.

## Judgements and disclosures

- **D-173 observations (h)–(k):** all accepted, with the reasons in QA-R3-16 and the verifications sidecar.
- **The orchestrator's 60 s budget for p4-gates-closure test 9:** accepted.
- **My round-1 probe's demo-banner check** missed the banner on one screen of 31 in three runs, a different screen each time.
  - The screenshot at that moment really lacks the banner. My round-2 note said otherwise, and I correct it here.
  - Cause: ADR-0050 §1's fail-safe. No synthetic label is shown until `GET /environment` confirms the database is synthetic.
  - Accepted: the label appears once the environment loads, as `a02-demo-labels` asserts.
- **Probe revisions:** my round-3 probe had two revisions, both disclosed with their logs kept.
  - A closed `<details>` artefact.
  - A single 250 ms read that came before Chromium's animated keyboard scroll had started.
- **Keyboard misses:** the remaining misses of the `el.focus()` keyboard path occur only under heavy load. At load 1.5 there were 0 misses.
