# DG7 round 1: qa-verifier narrative (T-DG7-REV-QA-RG1)

- **Candidate:** `sha256:9822d8fe947b572d30a24e1f59798587edd610a0c8b8f81a21eaceeb3233a744` (3158 files), source `ddf42ccd2630f3d62f6aaf360ff401bbc2bde025`. The candidate recomputes identically at the start and the end; the manifest diff is empty.
- **Invocation:** `DG7-T-DG7-REV-QA-RG1-qa-verifier-20261117T091006Z-4ade8556` (session `4ade8556-b1f9-4804-90ba-445eba82f5fd`).
- **Verdict: PASS.**
  - Two new findings, both Low and non-mandatory (F-DG7-1021, F-DG7-1022).
  - Nothing Critical, High or mandatory is open in my view.
- **What this is not.** This is an engineering review only. It grants and implies no G1–G6 business approval and no Finance, IT or production approval. Product gate G6 does not imply DG7. All data used is synthetic.

## How it was run

- **Clones.** Everything ran in disposable `git clone --shared` sparse clones at `ddf42ccd2` (`$TMPDIR/rv`, `$TMPDIR/rv2`). The sparse checkout leaves out `docs/delivery/{runs,handbacks,test-evidence}`, which are outside the candidate. All clones were removed at the end.
- **Databases and browser.** Disposable PostgreSQL 16.15 clusters, Chromium from `/opt/pw-browsers`, Node 24.21.0 (Node 22.22.0 for one unit pass).
- **Ports.** All in my range, 32510–32599.
- **Scripts.** The drivers are in `docs/delivery/test-evidence/DG7/qa/round-1/scripts/`.
  - `run.sh` records every step's log and exit code.
  - `seqA.sh` and `seqA2.sh`: build, static checks, unit tests.
  - `seqC.sh` and `seqC2.sh`: e2e.
  - `seqE.sh`: tool tests and A19.
  - `a18-driver.sh`, `a27-k11.sh`, `a27-k10b.sh`, `dictionary.sh`, `records_check.py`.

## Results

| Area | Result |
| --- | --- |
| Build, typecheck, lint, OpenAPI lint (965 ops), no-CDN, prettier | all exit 0 |
| Unit (Node 24 unset, Node 24 C.UTF-8, Node 22) | 3036 + 2199 + 259 tests pass in each run (2 by-design skips). One file needs delivery records the sparse clone omits; in the main repo it passes 6/6. |
| Integration (full) | 475/475 files, 4696 passed. 8 skipped and 1 todo, all explained. |
| QA acceptance integration, C.UTF-8 | 49/49 files, 489 passed |
| e2e product, en and ar | 572 passed. 2 demo-only skips, which pass 2/2 on the demo stack. |
| e2e root acceptance, en and ar | 284 passed. 2 failed on the spec's own BLOCKED (no `MTH_PORT_POOL`); re-run with it, 4/4. Connection log loopback only. |
| e2e demo (A02) | 10/10 |
| A18, one candidate archive | archive verify 7/7, four role directories; drill D0–D11 PASS; harness 10/10 |
| Offline drill (egress blocked) | 10/10 spec runs; 0 connections outside loopback |
| A19 | drill R1–R9 PASS (backup 6.8 s, restore 13.7 s); harness 13/13; T-E1..T-E9 9/9 |
| A06 replay | 28/28 in both locales |
| Production init and data dictionary | migrate and bootstrap work; a second bootstrap is refused; 365 tables and 5776 columns documented |
| Secret scans | payload and history PASS. With an empty allow-list there are 219 hits, all synthetic or quoted. No entry is stale. |
| Handover tools | claims, check-handover, known-limitations and release-notes `--check` all PASS. 8 provisional-line warnings on Arabic sections are noted. |
| Protocol audit | identical to the orchestrator's rg1 report (279 hits) |
| A27 re-drill | progress.md at `e44dcd90e` names the action actually taken next. A stale review is flagged. No approval appears without a gate record. |
| A26 | defect, card hash, fix and closure confirmed from git; the regression passes 7/7 on the candidate |
| Container half (D-267) | judged, not re-run. The container files are unchanged since the host run, and the Docker context check passes on the candidate. |

## Judgements the assignment asked for

- **D-249/D-270 (protocol hits).** For the stages with hits, the acceptance texts of REQ-DLV-008, 009, 011, 012, 018 and 024 are **not met as written**. The records are write-once and cannot be corrected. They are disclosed accurately (my audit equals the shipped table), and the user decided to disclose rather than reopen. Whether they block the release is the release-auditor's decision (D-270). I raised no new finding for them.
- **D-274 (Q19 extension).** 23 rows carry the marker. Each later clause is a post-gate artefact or an auditor decision. They are listed in the release notes, and none is presented as met. A28 is not claimed.
- **A27 K11.** My re-drill on this branch shows that work continues from progress.md.
- **ADR-0065 Amendment 1.** REQ-S19-008's acceptance text is met. Automation rules are excluded, which is a disclosed limit of the title only.
- **D-267.** Accepted as orchestrator evidence, with the residual that the image was not rebuilt from 9822d8fe.
- **D-269.** It records how pre-freeze integration was handled. I did not rely on it: my own full runs above stand on their own.
- **D-278.** In my A18 runs the recheck matched, so the schedule rule did not apply.
- **D-280.** The release-notes disclosure section is correct, but the ADR-0071 text drift remains (F-DG7-1021).
- **D-281.** The product equals `1612f85fc` except the allow-list and two regenerated handover blocks. The history scan and the allow-list are sound.

## Findings

- **F-DG7-1021 (Low, solution-architect).** ADR-0071 §5.1 and §5.2 do not mention the release-notes generator's extra input, `release-notes-disclosures.json`, or the section it writes. This is the old F-DG7-973, raised afresh.
- **F-DG7-1022 (Low, transformation-analyst).**
  - The handover release notes and 25 register rows cite F-DG7 ids that are not in this branch's `findings.json`, and nothing qualifies them as references to the old branch.
  - The REQ-DLV-014 later clause names old-branch findings that `validate --stage DG7` on this branch cannot show.

## Disclosures

- **Assignment format.** The assignment asks for `round: 7` and names a DG5 round-7 template that does not exist. This is round 1, which the validator requires, so the record uses round 1 and mirrors the DG6 round-7 QA record.
- **Reviewer independence.** Two other reviewers' runs were auto-committed during my run. My K10b drill's reconcile output therefore shows one other reviewer's verdict word. I read no other reviewer's record.
- **Run problems.** The other run problems are in check QA-RG1-26: an aborted full clone, a timed-out validator attempt, the registry-bound `deps:verify`, and my two batch errors, which were corrected and re-run.
