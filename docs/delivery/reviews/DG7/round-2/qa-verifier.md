# DG7 round 2: qa-verifier narrative (T-DG7-REV-QA-R2)

**Verdict: FAIL.** Candidate `sha256:ca38b65ecaa23f49b4e5755f503c88e74c3a5bd502862fd28cc5ddbbd1fe13c5`, source `f22c97b5`, 3153 files. I verified it at the start and at the end, in the repository and in a disposable clone. HEAD was the freeze commit `abc7254f`, which changes no manifest entry.

This narrative only adds to the JSON record (`qa-verifier.json`), which is authoritative. It reports no business, Finance, IT or production approval. Product G6 does not imply DG7.

## Round-1 findings (all six verified closed on this candidate)

| Finding | How I verified it | Result |
|---|---|---|
| F-DG7-913 Retention screens | Routes and unit tests (20/20); product T-E25 in en and ar; my own real-stack spec in en and ar (409 through the screen and re-apply; 403/428/409/400 on the server; retain-only 422); guides and register | CLOSED_VERIFIED |
| F-DG7-914 connectors.md | grep for the placeholders (none); SAML guide exists; `connector-handover --check` exits 0 | CLOSED_VERIFIED |
| F-DG7-953 freeze changed a candidate file | The freeze commit touches no manifest entry; reconcile reports "matches" | CLOSED_VERIFIED |
| F-DG7-954 A26 regression tests | Revert-to-fail: the A26 defect and the `requireAction`-only mutant each fail 4/15; the control passes 15/15; the label-only mutant is equivalent | CLOSED_VERIFIED |
| F-DG7-955 progress.md | Section marked historical and points to the current list | CLOSED_VERIFIED |
| F-DG7-956 check-handover tests | 51/51 on the candidate. Reverting the test fails the original 4. A hand-damaged block fails. A missing report fails loudly | CLOSED_VERIFIED |

## New findings

| ID | Severity | Summary |
|---|---|---|
| F-DG7-960 | Low | The FE-C3 repair handback has no merge instructions. The protocol audit at the round-2 freeze reports 6 DG7 C3 hits; the handover discloses 5. |
| F-DG7-961 | Medium | `docs/handover/release-notes.md` is stale. It cites register SHA-256 `e4805087…` in en and ar, but the shipped CSV is `fc8ece8b…`, and the REQ-S19-015 notes are old. `release-notes --check` exits 1, and nothing in the suite checks the real tree. |
| F-DG7-962 | Medium | The integration suite is order-dependent: all files share one database. `p7-transfer-guards.test.ts` commits queued exports and an import without a reconciliation. Run before the contract suites, it makes them fail (422 export_in_progress, 500 from listMigrationImports). The two-order probe: guard first fails 4, contract first passes 132/132. |
| F-DG7-963 | Low | `transfer-drill.sh` can exit 1 after its PASS line. The outer `rm -rf` runs under `set -e` while PostgreSQL is still being killed. A18 run 1 failed this way; run 2 passed 10/10. |

## What ran, in one line each

- **Static:** build, lint, openapi, no-cdn and format all exit 0. Typecheck exits 0 on re-run; the first run was OOM-killed (exit 137). deps:verify needs the live registry, so it is not a result here (D-057).
- **Unit:** 3041/3042 (one A13 timeout under load; 3/3 on re-run), 2199/2199, and 259 + 2 skipped.
- **Integration:** 474 files, 10 tests failed:
  - 9 tests are F-DG7-962;
  - a08 and a17 are load timeouts, and both pass on re-run;
  - skips and the todo are explained.
- **Tool suites:**
  - release suite: 463/466, all environmental; T-A5 passes with a writable store;
  - deploy scripts: 181/181 with PostgreSQL;
  - gates 66, agents 39, migration 29.
- **Validators:** `--historical` DG6 to DG0 and the pipeline pass. `--register DG7` fails on the 18 SPECIFIED rows (disclosed).
- **Product e2e:**
  - full run: 557 passed;
  - 3 failures in the OOM window (2 Chromium crashes, 1 navigation timeout); 50/50 on re-run;
  - demo-only walkthrough: 2/2 on the demo stack.
- **Root acceptance e2e:** 288 passed and 18 skipped (axe NOT SCANNED, by design). The connection log shows loopback only.
- **Offline drill:** 10/10 inside `bwrap --unshare-net`. The probe confirms there is no route and no resolver.
- **A18:** I built the archive from the frozen commit, and `--verify` passes. The harness passes 10/10 (run 2); run 1 hit F-DG7-963.
- **A19:** R1–R9 PASS (backup 3.6 s, restore 7.3 s).
- **Container half (D-267):** BLOCKED here, because there is no Docker daemon access. The host evidence applies to the server and images. The web bundle has changed since then, by 13 files (the Retention screens).

## Environment incidents (disclosed, none taken as a result)

- **Shared scratch disk full (ENOSPC) at 14:33Z.** I stopped my runs, excluded the DG3–DG5 handbacks from my clone (no test reads them) and restarted.
- **Two kernel OOM kills.** One was the first typecheck, which I re-ran. Two e2e Chromium crashes fall in the same window.
- **A background task hit its 2-hour limit** during root e2e attempt 1, after 148 passes and no failure. I re-ran it in full.
- **The first static task ran in parallel** with its restarted copy for a while.
- **deps:verify did not finish.** I made it finish by appending offline settings to the disposable clone's `.npmrc`, then restored the file and re-verified the candidate.

## Notes for the orchestrator

- **Assignment contradiction.** The assignment says `round: 7`. The validator requires the record's `round` to equal the directory (`round-2`), and round 1's record used 1, so I recorded `round: 2`. The "round: 7" line appears to be a template carry-over from DG6 round 7.
- **Another reviewer's evidence in the audit scan.** My protocol-audit run scanned the live tree. Its C5 evidence list may include another reviewer's in-progress round-2 log. I used only the counts and the hits I cite, and I did not read the other reviewers' records.
