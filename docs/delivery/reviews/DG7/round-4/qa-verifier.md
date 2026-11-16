# DG7 round 4: qa-verifier narrative (T-DG7-REV-QA-R4)

**Candidate:** `sha256:d91f7152950ed7119b412db0135836c53a3f01e95300af32c86db367f0712e59` (source `471072d6`, 3155 files, recomputed at the start and the end).
**Verdict:** FAIL. The cause is one new Medium finding in a delivery record, outside the candidate. The product passed every check I ran.

## Round-3 findings: all four verified closed

| Finding | How I verified it | Result |
|---|---|---|
| F-DG7-960 / F-DG7-920 | Fresh `protocol-audit.mjs --stage DG7` and `--all` on this tree: C3 = 7. The per-stage counts equal the orchestrator's r4 report. REQ-DLV-012 names all seven handbacks. The release notes and the marker say "seven … FE-C3 … DO-D8". known-limitations says 7. No stale "six" remains. Revert-to-fail: release-notes `--check` exits 1 with the round-3 register. | CLOSED_VERIFIED |
| F-DG7-921 | The register cites DO-D8B's T-B11 run, and the cited log shows the D9 line, job-check PASS and driver exit 0. I ran my own drill on this candidate with `--keep`. Its target `pg.log` shows postmaster 4261 shutting down and postmaster 5001 starting inside D9, and job-check reports PASS. | CLOSED_VERIFIED |
| F-DG7-940 | M0 passes 14/14. With M4 (the scoped `authorize()` removed), 3 export-scope tests fail; export.test.ts alone does not catch it. With an extra mutant M6 (the check removed from the get route), 7 tests fail. | CLOSED_VERIFIED |

## New finding

**F-DG7-970 (Medium, owner delivery-orchestrator, not mandatory).** The round-4 freeze commit `a76c2aed4` appended `REVIEWING` directly after the round-3 `REVIEWING` in DG7's `stages.json` history. The `FIXING` state of the round-3 repairs is missing. As a result:

- `validate.mjs --historical` fails for DG6 through DG1.
- `validate.mjs --reconcile` fails.
- `validate.mjs --stage DG7` fails.

Each reports "DG7 illegal transition REVIEWING -> REVIEWING". On the source commit (control), the same historical runs pass.

`stages.json` is meta-excluded, so the repair does not change the candidate id. It must still be repaired before the gate can validate.

## Runtime results on this candidate

| Area | Result |
|---|---|
| Unit | 3042 + 2199 + 259 passed (2 skipped by design). The stderr lines come from fixture warnings in passing tests; each is explained in QA-R4-03. |
| Integration | 475 files, 4696 passed, 8 skipped, 1 todo. All explained. |
| Tool suites | 66, 39, 29, 189, and 466 (2 skipped, both explained). |
| Product e2e | chromium-en 286 and chromium-ar 286 passed. The keyboard demo spec passed 2/2. |
| Root acceptance | 288 passed (the same 18 axe skips as before). Connection log was loopback-only. |
| Offline drill | 10/10. Arabic RTL and English LTR screens checked. |
| A18 | Drill D0–D11 PASS with a real restart. Harness 10/10. |
| A19 | R1–R9 PASS. |
| K11 re-drill | PASS. |

## Not run by me

I did not re-run the container half: the sandbox has no Docker daemon access. I judged its applicability from the evidence instead. The server surface has not changed since the host run.

Live registry, live CI, the real IdP and external systems are environmental residuals. Each is covered on its offline or config surface.

## Assignment discrepancies (disclosed)

- The assignment says `round: 7`. I used 4, because the validator requires the round field to equal the round directory.
- The DG5 round-4 qa-verifier record it says to mirror does not exist. I mirrored my DG7 round-3 record instead.
- Its owner list omits `delivery-orchestrator`. The findings schema allows that owner, and only the orchestrator can repair `stages.json`.
