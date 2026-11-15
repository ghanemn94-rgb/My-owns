# DG7 round 1: qa-verifier narrative (T-DG7-REV-QA-R1)

- **Candidate:** `sha256:df8225e537de3575c059fa05ef16d1d87530e3c36854c8dfc8c4ec9e2439f944` (source `a60a962dd9205c21df19de63b73a8bcf51866702`, 3148 files). I verified it on a disposable clone at the start and at the end of the review.
- **Invocation:** `DG7-T-DG7-REV-QA-R1-qa-verifier-20261115T073800Z-09c7ac0c`.
- **Verdict: FAIL**, with 3 new Medium findings and 1 new Low finding. None is Critical or High, and none is a mandatory violation.
- Nothing here grants or implies a business, Finance, IT or production approval. Product gate G6 does not imply DG7. All data used is synthetic.

## What passes on this candidate (re-run in this round)

| Area | Result |
| --- | --- |
| Build and static checks | build, typecheck, lint, OpenAPI lint (965 operations), check-no-cdn and prettier all exit 0. `deps:verify` needs the live registry (residual D-057). |
| Unit | unit-web 2179/2179; nocodegen 259 passed + 2 skipped by design; unit-node 3035/3036. The 2 failing files are a path my sparse clone left out and a 50-spawn timing test under load; both pass on re-run (12/12). |
| Integration (474 files) | 4686 passed. 8 skipped: 7 A18 tests BLOCKED without inputs (run separately, 10/10) and 1 runIf branch. 1 todo carried from DG6. |
| Product e2e (en LTR / ar RTL) | 570 passed. The 2 demo-only keyboard-walkthrough tests pass 2/2 on the demo stack. |
| Root acceptance e2e A03–A22 | 288 passed, plus 18 axe "NOT SCANNED" skips by design (same 9 routes as DG6). Connection log: loopback only. |
| Offline drill (A02 ×3 + A21 ×2, en and ar) | 10/10 inside `bwrap --unshare-net`. 0 connections outside loopback. |
| A18 | Archive built from `a60a962` (`--candidate df8225e5`), `--verify` 7/7. Layout: `source/`, `infra/`, `docs/`, `demo-data/`. The harness ran the drill on that archive: 10/10, drill exit 0, D0–D11 PASS, reconciliations matched, origin moved, origin scan PASS, synthetic IdP. |
| A19 | `restore-drill.sh` R1–R9 PASS (backup 6.7 s, restore 12.8 s). The harness passes 13/13 in the integration run. |
| A27 (my re-drill at the freeze commit) | Reconcile flags a stale record. The next action in progress.md equals the action taken (the round-1 reviews). This closes K11's "continues from progress.md" for the current checkpoint. |
| Release tools | Payload and history secret scans, claims scan, check-handover, service list, role matrix, migration catalogue, known limitations (against the pre-freeze report), connectors, automation jobs and SBOM: all PASS. |
| Register | Built snapshot equals `requirements.csv` (sha256, 412 rows, every field). The release-notes blocker section equals the 18 non-IMPLEMENTED rows. The six Q19 rows sit in the later-clauses section. |
| Validators | `--historical` DG6…DG0 PASS. `--pipeline` PASS. Gate tool tests 66/66 (A23/A24/A25 tests included). Seal rehearsal tests T-M1–T-M13 pass. |
| Container half (D-267) | Judged from the orchestrator's evidence, not re-run (no Docker access here). It ran on tree `bf907c2d5`, whose server, worker, database, Dockerfile and Compose files equal the candidate's. Only the FE-B2 SPA screen and a comment in the Keycloak helper differ. |

## Why FAIL

1. **F-DG7-953 (Medium, owner delivery-orchestrator).** The freeze commit `8f79401` added D-271 to `docs/delivery/decisions.md`, which is a candidate file. From the freeze on, the tree hashes to `a3feb4ef…`, not `df8225e5`:
   - every round-1 record is reported "STALE for current content";
   - current-mode `validate --stage DG7` cannot match the gate candidate.

   I reproduced this in a disposable clone: a record on the right candidate shows STALE, and restoring `decisions.md` to its `a60a962` bytes makes it current. The repair is to move D-271 out of `decisions.md`, as D-190 to D-192 and D-237 did, or to re-freeze.
2. **F-DG7-954 (Medium, owner backend-workflow-engineer).** I applied the A26 drill's defect (business-unit PATCH lowered to `business_unit.read`) to a copy of the candidate:
   - every test that calls that route still passes;
   - the contract test's 2 failures occur with and without the defect (an artefact of my copy).

   The drill's K6 regression tests were never merged. So the release has no test for this mutation's authorization, even though the product code is correct.
3. **F-DG7-956 (Medium, owner devops-engineer).** `tools/release/tests` fails 4 tests on the frozen tree, and CI runs this suite in full.
   - `check-handover.test.mjs` pins the DO-I protocol-audit report.
   - `known-limitations.md` was regenerated from the pre-freeze report after the orchestrator's last green suite run.
   - Proof: as frozen, 46/50; with `known-limitations.md` regenerated from the pinned report, 50/50.
4. **F-DG7-955 (Low, owner delivery-orchestrator).** progress.md "Unresolved blockers" still reads "None. DG0, DG1, DG2 and DG3 are APPROVED".

Also unmet as frozen. These are disclosed, not new findings, and not counted as met:

- `validate --register DG7` fails on the 18 SPECIFIED DG7 rows. Flipping them changes `requirements.csv`, which is in the candidate.
- The DG7 protocol-audit hits re-run here (C2 27, C3 5, C5 1) mean REQ-DLV-008 (first clause), -011, -012 and -024 are literally unmet. D-270 discloses them, and the release-auditor decides.
- The post-gate clauses (A23 for DG7, the gate update, the seal and the final report) are not yet showable.

## Observations (no finding)

- **REQ-S19-008.** The acceptance is met (A06 replay 28/28; an unknown schema version gets 422). `automation_rule` is not carried under ADR-0065 Amendment 1; the release-auditor judges the title (D-268).
- **`/readyz`.** Storage now gates readiness and the worker is reported only (D-243 Q6). The contract change is additive and decided, with no reopen entry (REQ-S21-002).
- **A19 script demo.** It has 0 evidence objects and 0 jobs; the harness covers both.
- **Test harness noise.** `automation-version-at-occurrence.test.ts` logs one error-level "job run record failed" at teardown, by design. `a13-child-ready-race.test.ts` is load-sensitive at the default 5 s timeout.

## Deviations from the assignment

- **Round number.** The assignment asks for `round: 7`; the validator requires the directory round, so the record says 1.
- **Template record.** The named template `reviews/DG5/round-3/qa-verifier.json` does not exist; I mirrored DG5 round-2 and DG6 round-1.
- **Finding owners.** Two findings name the delivery-orchestrator as owner (schema-valid; precedent F-DG6-911), because the defective records are orchestrator-only.
- **C.UTF-8 runs.** I did not repeat the e2e and unit suites with `LANG=C.UTF-8` (time). Both runs were in the unset-locale setting, and both Playwright locale projects ran.
- **Quarantined logs.** A stopped validator loop wrote `--reconcile` and `--stage DG7` logs at a HEAD that contains another reviewer's record. I moved them out of my evidence unread.
