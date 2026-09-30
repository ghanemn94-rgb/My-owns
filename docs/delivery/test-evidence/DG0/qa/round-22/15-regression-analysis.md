# Round-22 regression analysis of earlier QA fixture suites (qa-verifier)

Log: `14-regression-r9-r18-r20.log` (QA_REPO_ROOT = complete --no-local clone @ 7cf94db; candidate 09072ce5).

- `dg0-gate-negative-r9.test.mjs` run RAW: 81 failures. This is expected. The raw round-9 fixture predates the D-030/D-031
  run-meta fields (settings/process-sandbox hashes). Round 20 introduced an adapter for this reason; the adapted run is QA20-G1.
- `dg0-gate-negative-r18.test.mjs`: 7/7 pass (QA18-S2 = the F-DG0-238 shape; QA18-S4 unchanged characterisation: fail-closed, exit 1).
- `dg0-gate-negative-r20.test.mjs` (adapted r9 inside QA20-G1): 87 pass / 7 fail.
  - QA7-N77, QA7-N83, QA8-F223, QA9-C01: the known fixture/environment set, identical in round 21.
  - QA5-N57: the by-design superseded-round manifest tolerance (D-035/D-036); the same surface as new finding F-DG0-246.
  - QA5-N52, QA5-N53: their regexes expect the pre-D-038 message "started from ffffffffff, which does not contain …".
    The same shapes are now REJECTED with the D-038 messages ("not a 40-hex commit id" / "absent from this repository,
    but its review round is retained"). See `10-r21-suite-rerun.log` (QA21-C4/C5, all four roles REJECTED) and
    `13-qa22-new-cases.log` (QA22-N3/N4). This is stale expected wording in my own test, not a product regression.
  - QA20-S1/S2/S3: still rejected. The assertion regex expects the D-036 wording; since D-037 the message is
    "is not a commit object in this repository (absent|tree|blob)". Round 21's QA21-C9a-d assert the current wording and pass.
- Conclusion: no product regression. The r9/r20 wording expectations are stale test code (qa-owned evidence). They will be
  refreshed when the orchestrator promotes the suites to tests/qa/.
