# DG7 round 7: qa-verifier narrative (T-DG7-REV-QA-R7)

- **Candidate:** `sha256:0d71d4456adaac949e2c9af4c975f4b9976a166872195f496d5aa75fe8ed2272` (source `7579382c`, 3158 files). I verified it in the tree and in a clone, at the start and at the end.
- **Verdict:** PASS. The structured record is `qa-verifier.json`.

## The round-6 disclosure findings

F-DG7-923, F-DG7-942 and F-DG7-972 are **CLOSED_VERIFIED** (`qa-verifier.verifications.json`).

ADR-0064 A5.6 requires three statements:
1. A scheduled job is explained only as A5.2 says, and it is listed in the report.
2. A handler's business writes in the window still fail D9, and that is not a data defect.
3. The recovery is to re-run the drill and never pause a schedule.

All three are present on these surfaces:
- `known-limitations.md`: a new section-6 row;
- `release-notes.md`: a new section in English and Arabic;
- `deployment.md`;
- both Arabic summaries.

They also carry A5.7 residuals 1, 3 and 4. The one gap is that the deployment Arabic summary omits only the pg-boss sentence, which the Arabic known-limitations summary carries.

The texts agree with the drill code. The second stage is read only, and the drill never writes `job_schedule`.

The generated texts reproduce with `--check`. Mutations of the new input file are caught: a dropped statement or an empty list gives exit 1, and an unknown key or a missing file gives exit 2.

The two new allow-list entries hash fragments of my own round-6 grep regex. They are in the history scope only, and neither is a credential.

## New finding

**F-DG7-973 (Low, not mandatory, not blocking; owner solution-architect).** ADR-0071 §5 still says the release-notes generator "reads nothing else" and lists seven sections. D-280 accepts the new checked-in disclosure input instead of adding a dated amendment. The behaviour is sound; only the ADR text is stale.

## Whole candidate

| Area | Result |
|---|---|
| Static | Pass. The build passed after an environment re-run (read-only vite cache); `deps:verify` needs the live registry. |
| Unit | 3042 + 2199 + 259 pass; 2 skips by design. |
| Integration | 475 files. 5 failures came from my node_modules shim, which gave two module identities for `RenderError`. With the links fixed, the 3 files re-ran 246/246 (`04c-shim-analysis.log`). |
| Tool suites | gates 66, agents 39, migration 29, deploy 204. |
| Release and licences | 469 pass, 2 explained skips. |
| Release tools | 12/12 `--check` and the scans pass. |
| e2e | en 286, ar 286 (1 demo-db skip each, run separately: 2/2). |
| Root acceptance | 288 pass, 18 "NOT SCANNED" axe routes; loopback only. |
| Offline drill | 10/10. Arabic screens are RTL, with the provisional wordmark and "not set" instead of zero. |
| A18 | Two real drills D0–D11 PASS (matched; no quarter hour in either window) and the harness 10/10. |
| A19 | PASS. |
| Register | 412 rows, all IMPLEMENTED. |
| Protocol audit | Equal to r7. |
| Secret scans | PASS. |

The container host run is the orchestrator's evidence (D-267). It still applies, since no image input changed. I did not re-run it.

No business, Finance or IT approval is granted or implied, and product gate G6 does not imply DG7.
