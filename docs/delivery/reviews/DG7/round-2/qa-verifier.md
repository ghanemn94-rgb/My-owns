# DG7 round 2: qa-verifier narrative (T-DG7-REV-QA-RG2)

- **Candidate:** `sha256:33266ccd9ce4ec4475de745ebacfaafbd2f25870f8be966086f4a74578b7259c` (3158 files), source `152db5b51155282b28e82472629d07b8d87feb2a`.
  - The candidate recomputes the same at the start and the end of the review, and the manifest diff is empty.
- **Invocation:** `DG7-T-DG7-REV-QA-RG2-qa-verifier-20261117T144530Z-0fbf419f` (session `0fbf419f-65ca-4b15-a5be-2ce686fed295`).
- **Verdict: FAIL.**
  - The cause is one new Medium finding, F-DG7-1051. D-192 says a Medium finding must be repaired before the gate.
  - Nothing is Critical, High or mandatory.
  - The full product regression is green.
- **What this is not.**
  - This is an engineering review only. It grants and implies no G1–G6 business approval and no Finance, IT or production approval.
  - Product gate G6 does not imply DG7.
  - All data used is synthetic.

## How it was run

- **Clones.** Everything ran in disposable `git clone --shared` sparse clones at `152db5b51` (`$TMPDIR/rv`, `$TMPDIR/rv2`, and `k11`/`k10b` for A27). All of them were removed at the end.
- **Databases and browser.** Disposable PostgreSQL 16.15 clusters, Chromium from `/opt/pw-browsers`, Node 24.21.0.
- **Ports.** 32510–32599. The drills' own ports run inside their private network namespaces.
- **Scripts.** The drivers are in `docs/delivery/test-evidence/DG7/qa/round-2/scripts/`.
  - `run.sh` records each step's log and exit status.
  - `setup.sh` and `seqA` to `seqF` run the sequences.
  - The other scripts are the drills and probes: `a18-driver.sh`, `a27-k11.sh`, `a27-k10b.sh`, `dictionary.sh`, `records_check.py` and `backup-root-probe.sh`.

## Results

| Area | Result |
| --- | --- |
| Build, typecheck, lint, OpenAPI lint (965 ops), no-CDN, prettier | all exit 0 |
| Unit, Node 24, locale unset and C.UTF-8 | 3036 + 2199 + 259 pass in each. One file needs a handback file that the sparse clone omits; it passes 6/6 in the main repository. |
| Integration (full) | 475/475 files, 4696 passed. The 8 skips and 1 todo are explained. Two new teardown-race error lines are explained (QA-RG2-06). |
| QA acceptance integration, C.UTF-8 | 49/49 files, 489 passed |
| e2e product, en and ar | 572 passed. The 2 demo-only skips pass 2/2 on the demo stack. |
| e2e root acceptance, en and ar | 288 passed. The 18 skips are the by-design axe NOT SCANNED routes. The connection log is loopback only. |
| e2e demo (A02) | 10/10 |
| A18, one archive of 33266ccd | verify 7/7; drill D0–D11 PASS; harness 10/10 |
| Offline drill | 10/10 spec runs; 0 connections outside loopback |
| A19, container-free | R1–R9 PASS (backup 3.7 s, restore 7.9 s); harness 13/13; T-E1..T-E12 13/13 |
| A19, Compose half | **never run anywhere** (F-DG7-1051) |
| A06 replay | 28/28 |
| Production init and dictionary | 135 migrations; a second bootstrap is refused; 365 tables and 5776 columns documented |
| Secret scans | payload and history PASS; the S3 probe behaves as SC-13 states |
| Handover tools | claims, check-handover (8 by-design warnings), known-limitations and release-notes `--check` all PASS |
| Protocol audit | 279 hits, identical to the orchestrator's rg2 report |
| A27 re-drill, A26 regression | PASS; A26 regression 7/7 |
| Tool tests | validator 60/60, sandbox 6/6, release tools 471 + 6 sparse-clone T-H4 failures (51/51 in the main repository), deploy 125/125, transfer drill 70/70 |

## Verifications (sidecar)

- **F-DG7-1021: CLOSED_VERIFIED.** ADR-0071 Amendment 1 matches `release-notes.mjs` on every input, option, section, exit code and test name.
- **F-DG7-1022: REOPENED** (Low, not blocking on its own).
  - The repair is only the D-282 note in `decisions.md`.
  - The register (25 rows) and the release notes are unchanged.
  - The REQ-DLV-014 later clause still promises old-branch findings "shown by validate.mjs --stage DG7", which D-282 itself says cannot be shown.

## New findings

- **F-DG7-1051 (Medium, devops-engineer, REQ-S19-012).** The Compose half of A19 has never been run in any DG7 evidence.
  - That half is the `backup` profile on `postgres:18`, the three-step sequence in `backup-restore.md` §3.2, and a restore into a second project.
  - DO-F handed it to the orchestrator as BLOCKED.
  - DO-D11 found by reading that the sequence could not work as written. It changed the sequence and asked for the orchestrator's run. No run followed.
  - The guide still says the Compose half "runs on the orchestrator's host and is recorded there".
  - The release notes list no blocker, although p7-plan R1 says "an unrun half is a disclosed release blocker, never a pass".
  - Repair: run it on the host, or disclose it honestly.
- **F-DG7-1052 (Low, solution-architect, REQ-S16-031).** Neither ADR was amended for the DO-D11 repairs, and DO-D11's questions Q1 and Q2 are unanswered.
  - ADR-0063 §1.2 still states the old S3 i18n-key exemption and does not mention the 64-hex trade-off.
  - ADR-0066 §4 lacks the `ownerOnly` check and the other permission rules.
- **F-DG7-1053 (Low, devops-engineer, REQ-S19-012).** `backup.sh` refuses a symlink to an owner-only directory.
  - The message wrongly says the root "is writable by group or others".
  - Cause: `find -perm` tests the link's own mode.

## Disclosures

- **Assignment format.**
  - The assignment asks for `round: 7`. The validator requires round 2.
  - It says 18 Q19 rows; I count 23.
- **Reviewer independence.**
  - Other reviewers' runs were auto-committed during this run. I opened none of their round-2 files.
  - The A27 stale-review drill was pinned to `1c119c031`.
- **Run problems.** These are listed in check QA-RG2-32:
  - a first integration launch that died with its sandbox and was relaunched;
  - `deps:verify` timed out at 120 s;
  - sparse-clone artefacts;
  - high host load.
- **Round 1.** I missed F-DG7-1051 in round 1, when the same gap already existed.
