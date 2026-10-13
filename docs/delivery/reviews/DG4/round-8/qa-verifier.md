# DG4 round 8: qa-verifier narrative (T-DG4-REV-QA-R8)

**Verdict: PASS.** Candidate `sha256:8014e5ceffe1f374388ff00e59775458601e0a66be40e5dfe32a10c8cd2d3804` (source `8553323`, 1475 files). No new finding.

## What this confirmation round checked (D-134)

1. **Identity.** I checked the candidate on a complete, non-shallow clone and on the working tree, at the start and at the end of the review. HEAD `78fe975` is the freeze commit on top of `8553323`.
2. **Scope.** `git diff dab4562..8553323` has 0 files outside `docs/delivery/`, so the product is byte-identical to round 7's `baa6ff4d`. `requirements.csv` is unchanged.
3. **F-DG4-148 inside the envelope.** I ran `pnpm test` 8 times: Node 22 and 24, locale unset and C.UTF-8, in 2 series. The 1-min load was sampled every 15 s.
   - The load stayed at 0.68–6.01, with no sample above 8.
   - All 8 runs exited 0 (1589 + 1347 + 259 tests each, plus 2 skips by design).
   - Both failure classes had wide margins: `architecture.test.ts` took 10–13 s against its 30 s limit, and the first render of the raid action register took 1.1–1.9 s against the 5 s wait.
4. **Static checks:** 7/7 exit 0. **Validator:** 5/5 PASS. **Register:** 137/137 rows IMPLEMENTED, with 0 missing evidence paths.

## Judgement on D-133, D-134 and `environment.md` limitation 6

- **D-133 and D-134** agree with the round-7 records and with the user's decision.
- **The envelope is accurate in substance.** Every recorded failure happened at a load of 12.4 or more. Every run at a load of 9 or less passed: in round 6, round 7 and this round. The threshold of 8 is conservative.
- **The envelope is sufficient.** It is measurable, it is recorded, and it states what to do with a failure above it.
- **Observations only, not findings.** None of these has a behavioural effect:
  - The "pre-freeze 1.4–2.3" figure comes from load points at the e2e start and end in rounds 3–7, not from samples taken during `pnpm test`.
  - The "13–16" band was 12.4–17.7 during the failing run.
  - The text leaves implicit that a failure inside the envelope is a genuine failure.

## Disclosures

- **React warnings.** Every unit log has 14 React "same key" warnings, in passing tests. They come from test fixtures that reuse ids, and they are identical in rounds 6 and 7.
- **Aborted first launch.** My first launch of the series ran no test, because of a script argument bug. The series was then relaunched.
- **Carried forward, not re-run.** Integration, `tests/qa`, REQ-DLV-036, e2e and the probes (axe, 390 px, 200 %, AUD) were not re-run this round. Their round-7 results on identical code are cited with every non-pass explained (QA-R8-07, QA-R8-08).

## F-DG4-148

My verifications sidecar records PASS → `ACCEPTED_OBSERVATION`. It takes effect only with the release-auditor's concurrence.

Product gates G1–G6 are not touched. Product G6 never implies DG7.
