# DG7 round 3: qa-verifier narrative

- **Candidate:** `sha256:60dd90b6c5a7af3b502f02be68e6b601fd11e90fcbc0a48166cbc389453a80e9` (3154 files).
- **Source:** commit `8323dac`.
- **Verified:** at the start (HEAD `9c69cd11`, the freeze commit) and at the end (HEAD `93679b227`, other reviewers' run commits only).
- **Run:** session `4c79dba1-b7f7-4e94-9c7c-823c8271051c`, task T-DG7-REV-QA-R3.

## Verdict: FAIL

The verdict rests on one open finding, F-DG7-960 (a disclosure count). The product runs everything I executed without a failure.

## Round-2 findings

| Finding | Result | Basis |
| --- | --- | --- |
| F-DG7-915 / 961 | CLOSED_VERIFIED | `release-notes --check` exits 0 on the frozen bytes. The cited register SHA-256 equals the CSV's. The old notes and a one-byte register change both exit 1. |
| F-DG7-935 | CLOSED_VERIFIED | Exactly the 18 D-274 rows changed: status, evidence and notes only, with history kept and the marker present. 412/412 IMPLEMENTED. `--register DG7` PASS. No missing evidence path. |
| F-DG7-960 | **OPEN (FAIL)** | `known-limitations.md` now counts 7 DG7 C3 hits, matching my audit re-run. The release notes and the REQ-DLV-012 notes still say "six". The 7th hit, `T-DG7-DO-D8-devops-engineer.md` (no merge instructions; a round-2 repair task), is disclosed by name nowhere and is covered by neither D-270 nor D-274. The finding's expected result is that the disclosure covers every handback in the frozen candidate, so it is not met. The repair is documentation only: name the hit in REQ-DLV-012 and regenerate the release notes, or extend the user's disclosure decision. |
| F-DG7-962 | CLOSED_VERIFIED | Both orders pass 252/252. The reverted guard file fails 9 tests (`migration.export_in_progress`). |
| F-DG7-963 | CLOSED_VERIFIED | `transfer-drill.test.mjs` passes 55/55. Two revert-to-fail mutations fail. A real A18 drill with a forced cleanup failure prints PASS, exits 0 and writes one WARNING line. |

## What ran on this candidate

| Area | Result |
| --- | --- |
| Static | build, typecheck, lint, openapi-lint, no-cdn and prettier all exit 0. `deps:verify` is blocked only by the missing registry (D-057). |
| Unit | 3042, 2199 and 259 passed (2 by-design skips in the no-codegen project). |
| Integration | 474 files, 4692 passed, 8 explained skips, 1 carried todo. |
| Tool suites | release 464/466 (2 explained skips), deploy 189, gates 66, agents 39, migration 29. |
| Product e2e | en 286 and ar 286 (each skips the demo-only keyboard spec, which passes 2/2 on the demo stack). |
| Root acceptance A03–A22 | 288 passed and the same 18 axe NOT SCANNED skips as before; connection log loopback only. |
| Offline drill | 10/10. |
| A18 | archive from the frozen commit passes `--verify`; harness 10/10; D0–D11 PASS. |
| A19 | restore drill R1–R9 PASS, plus the 13-test integration harness. |
| A26 | the defect patch is caught by the regression test (4 failures). |
| A27 | K11 re-drill against the candidate's own `progress.md` passes. |
| Validators | historical DG0–DG6, register DG7 and reconcile all PASS. |
| Evidence | the secret scan of my evidence passes. |

## Disclosures judged

- **Q19 extension (D-274):** I accept it as faithful for the 23 marked rows, except the REQ-DLV-012 undercount (F-DG7-960).
- **D-270:** accepted, except the undisclosed DO-D8 hit.
- **A27 K11:** re-drilled, PASS.
- **ADR-0065 Amendment 1:** disclosed. I leave the literal reading of REQ-S19-008's title to the auditor.
- **D-267 host evidence:** judged applicable to this candidate's server and image surface. Since then only the SPA, drill scripts and tests changed, and the SPA is covered by my non-container e2e. The container half itself was not re-run by me.

## Deviations

1. The assignment says `round: 7`. The record lives in `round-3`, and the validator requires the round to match the directory, so I used 3.
2. Attempt 1 of my order probe failed because of my own symlinked `node_modules`. The logs are kept and the cause is explained.
3. The first `deps:verify` attempt hung on the registry. I re-ran it offline; this is disclosed in its log.

No G1–G6 business approval, no Finance, IT or production approval, and no DG7 approval is granted or implied by this record. Demo data is synthetic.
