# DG6 round 5: qa-verifier narrative (T-DG6-REV-QA-R5)

I reviewed candidate `sha256:832e5c823462ad72859017506cde6a54087ddff15d926a2916bf32ce79d14988` (2740 files), source `d7b21bad306f6aacf10eaea5848d5449dbc4043e`. I recomputed it on a full clone and in the repository at HEAD `518b0c9f`, the freeze commit, which adds only delivery metadata. Evidence: `docs/delivery/test-evidence/DG6/qa/round-5/`. Probes: `docs/delivery/test-evidence/DG6/qa/tests/round-5/`. All of it ran in disposable clones and disposable PostgreSQL clusters.

## Verdict: FAIL

The verdict rests on one new finding:

- **F-DG6-380 (High, mandatory).** When several jobs of one queue fail on their last attempt at the same time, some of the failures are lost. A share of them never reach the failure queue.
  - **Cause.** The exception recurrence writes `greatest(now(), ${current.last_occurred_at}::timestamptz)`. That value is the stored timestamp passed back as a millisecond JavaScript Date. When two raises overlap, the one that commits second can move `last_occurred_at` backwards by a fraction of a millisecond. The 0101 guard then rejects the update, and that rolls back the whole `captureJobFailure` transaction: the `operational_failure` row, the occurrence and the `job.failed` event.
  - **Size.** 9 of 10 bursts lose captures at the default concurrency of 4, and 10 of 10 at 8.
  - **Control.** A scratch change to the column reference captures every failure, which isolates the cause.
  - **Impact.** It breaks A13's "failed jobs remain recoverable" (REQ-S20-013).
  - **Age.** It predates BE-Z6: the raise path has not changed since round 4. I found it while probing the D-214 BE-Z6 question.

## My open finding

**F-DG6-320 is CLOSED_VERIFIED.**
- The probe now asserts rather than records.
- It raises a real `kpi.stale` exception through the production worker's `kpi.freshness_scan`.
- `kpi.stale` and `operations.heartbeat_missed` show their catalogue text in English (LTR) and Arabic (RTL), never the raw code.
- Four mutants of the fix all fail `problems-all.test.ts`.

## Open questions (D-214)

**BE-Z5 residuals.** All five are acceptable under ADR-0051:
- 71 GET operations can't be filled from the demo data. Only four of them name benefits, and those are either guarded per path parameter or return ids only (`getBenefitGroup`).
- The search index isn't exercised by the sweep. Search is filtered by the read scope, which A12 proves.
- Stored rows from before the fix: there is no released data.
- Benefit ids in the frozen G6 snapshot: ids are not content.
- Counts kept as truthful verdicts: these follow the D-195 Q3 totals rule.

**BE-Z6 rule.** It is sound:
- No system update is lost.
- Human-vs-human conflicts stay 409, also when the two act concurrently.
- A stale human write over a newer human one is 409, and the row is unchanged.
- A recurrence attributed to a user is treated conservatively (409).
- Malformed If-Match values give 400; a far-ahead version gives 409.

**a22-p6-operability.** It passed 16 of 16 executions in both languages and both locale settings.

## Disclosed non-zero exits (each explained in the record)

- **Load-only artifacts:**
  - unit timeouts in `architecture.test.ts`, `server.test.ts` and `branding-layout`;
  - one `findBy` in `traceability.test.tsx`;
  - Vitest's "Timeout calling onTaskUpdate";
  - `response-validation.test.ts` timeouts.

  Every one of them passes when re-run.
- **Command time limits:** one unit run and one integration half were stopped by them, then re-run.
- **My own side effects, then fixed:**
  - Deleted handbacks in the clone broke `dlv038-s20-029-load-report`.
  - A shared `test-results/` between two Playwright runs caused one ENOENT in `p4-adoption-bau`, which passes on re-run.
  - My exception probe's precondition failed in two runs.
- **Disk:** the shared disk reached 419 MB free. I removed only stale trace artifacts mid-run, and no test failed after that.

## Not claimed

- The load figures are provisional, from one shared 4-vCPU host. They are not Mobily capacity.
- Keycloak, the live registry and CI, and external systems are environmental residuals, verified on the offline surface only.
- All data is synthetic. Nothing here is a G1–G6 business approval, and product G6 never implies DG7.
