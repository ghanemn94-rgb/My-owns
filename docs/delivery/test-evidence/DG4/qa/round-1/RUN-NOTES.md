# qa-verifier DG4 round 1: run notes (T-DG4-REV-QA-R1)

The evidence of this review is in this directory. The review record is `docs/delivery/reviews/DG4/round-1/qa-verifier.json`, and its narrative is `qa-verifier.md`. Logs are tee'd with `$TMPDIR` paths replaced and ANSI colour codes kept; the summaries strip them.

| Prefix | What |
|---|---|
| `00-` | Candidate checks (start, transcribed; end, captured) and the offline install. |
| `01-` | Static checks (`scripts/run-static.sh`). |
| `02-` | `pnpm test` (`scripts/run-unit.sh`, `scripts/run-unit-one.sh`). `run1` logs that are not green are kept and explained in the record. |
| `03-` | Integration on disposable PostgreSQL (`scripts/run-integration.sh`): two full runs, `tests/qa` alone, the REQ-DLV-036 subset, my probes (`../tests/round-1/integration/`), and the p4-pending lists. |
| `04-` | e2e on the real stack (`scripts/run-e2e.sh`): the full runs (locale unset, C.UTF-8), the solo re-run, per-spec summaries (`scripts/summ-e2e.py`), and the analysis of the journeys admin failure (F-DG4-141). |
| `05-` | `tools/gates/validate.mjs` (register, pipeline, historical DG3, DG2 and DG1). |
| `06-` | Requirement trace for the 137 DG4 rows (`scripts/trace.py`). |
| `results/` | My spec's check files (`dg4-qa-r1-checks-<lang>.json`) per e2e run, and the failure screenshot and error context of the journeys admin failure. |

## My e2e spec revisions

The file keeps only revision 3 (sha256 `ed7c3c42…`). Revisions 1 (`2c28fcda…`, the locale-unset run) and 2 (`328332d1…`, the C.UTF-8 run) differ only in the `open()` helper, as its header comments describe:
- revision 2 accepts the product's no-permission state as a valid render, and bounds `networkidle`;
- revision 3 also bounds `goto` and `textContent`.

The sha256 of the spec used in each run is in that log's first line.
