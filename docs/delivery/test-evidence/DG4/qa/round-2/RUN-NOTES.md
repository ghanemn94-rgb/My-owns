# qa-verifier DG4 round 2 (re-run): run notes (T-DG4-REV-QA-R2B)

All evidence of this review is in this directory. The review record is `docs/delivery/reviews/DG4/round-2/qa-verifier.json`, with the narrative `qa-verifier.md` and the verifications sidecar `qa-verifier.verifications.json`. Nothing from `../../qa-r2-orphaned/` (the killed first run) is used or cited. Logs are tee'd with `$TMPDIR` paths replaced and ANSI colour codes kept; the summaries strip them.

| Prefix | What |
|---|---|
| `00-` | Candidate checks (start and end) and the offline install. |
| `01-` | Static checks (`scripts/run-static.sh`). |
| `02-` | `pnpm test` on Node 22 and 24, locale unset and C.UTF-8 (`scripts/run-unit.sh`). All four green on the first run. |
| `03-` | Integration on disposable PostgreSQL (`scripts/run-integration.sh`, chained by `scripts/run-chain.sh`): two full runs, `tests/qa` alone, the REQ-DLV-036 subset, my round-2 repair probes (`../tests/round-2/integration/dg4-qa-r2-repairs.test.ts`), my round-1 probes re-run on this candidate (round-2 copies), and the p4-pending lists. |
| `04-` | e2e on the real stack (`scripts/run-e2e.sh`): the two full runs (locale unset, C.UTF-8; run in parallel on separate stacks), their per-spec summaries (`scripts/summ-e2e.py`), and the solo re-runs of `p2-journeys.spec.ts` (run 1 in parallel under load: timeout again, kept with a TIMEOUT marker; run 2 at low load: 24/24 in each locale). |
| `05-` | `tools/gates/validate.mjs` (register, pipeline, historical DG3, DG2, DG1). |
| `06-` | Requirement trace of the 137 DG4 rows (`scripts/trace.py`). |
| `results/` | My sweep's recorded checks (`dg4-qa-r2-checks-<lang>.json`) for each full e2e run. |
