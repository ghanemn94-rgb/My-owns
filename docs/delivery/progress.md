# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **DG7 (P7 "Independent transfer and release") is BUILDING** (as of 2026-11-14, D-267). Done: W1–W12, repair rounds 1–4, A18 transfer drill (T-B11 D0–D11 PASS, harness 8/8), offline drill, A06 bundle replay, A17–A25 re-runs, A27 drill (K11 partial), container host half (build, bundle save/load, Compose `--pull never`, no-egress smoke 15/15, Keycloak e2e 4/4). Register: 390/412 IMPLEMENTED, 22 DG7 release blockers. **Next action:** register pass 3 after `release-notes.mjs --write` and the A26 drill, then CI fragments, freeze, protocol audit on the frozen candidate, round 1 (domain, code-security, qa), audit, A28 seal. Product gate G6 never implies DG7.
- **DG0 is APPROVED** (gate `docs/delivery/gates/DG0.json`, candidate `sha256:84130c62…`, 19/19 DG0-final requirements; 29 review rounds). Carried intact onto this branch.
- **DG1 is APPROVED** (gate `docs/delivery/gates/DG1.json`, candidate `sha256:6e0c0db1…` (395 files, source `642e6bfb`), 12/12 DG1-final requirements). Round-4 gate round: 3× PASS (domain, code-security, qa) + release-auditor PASS on the same candidate; all 14 DG1 findings CLOSED_VERIFIED by non-authors; zero unresolved Critical/High; zero unresolved mandatory. `validate.mjs --stage DG1`, `--historical --stage DG1` and `--pipeline` all exit 0.
- **This branch (`claude/mobily-transformation-platform-regate`) is the clean DG1 re-gate.** The first DG1 drive ran 16 review rounds and reached an all-PASS round-16 gate, but the first complete `validate.mjs --stage DG1` exposed record-integrity debt that predated the frozen gate schema: the round-2 code-security record used the pre-schema `checks_run` shape, and two records re-listed earlier-raised findings without a local `.findings.json`. Those are write-once committed, so they can only be corrected by a history rewrite — which, starting from round 2, cascades new SHAs through every round and breaks all closure anchors. Per the user's decision (D-056 path C), DG1 was re-gated on a **clean base** (`85e5bbd`, the last commit before any DG1 review evidence): the final, fully-remediated P1 product + ADRs/ERD/OpenAPI/register/decisions were carried here and DG1 was reviewed in **4 clean gate rounds** with conformant tooling. The re-gate found and fixed genuine bugs: F-DG1-140/141 (Medium mandatory — BU re-parent cycle-under-concurrency via migration 0009 DB guard + advisory lock, and destination-parent authz), F-DG1-142 (rate-limit cookie bypass → token-hash/IP keying), and Low docs/deps/flaky-test/typecheck-coverage items.
- **The full 16-round development narrative is preserved** on branch `claude/mobily-transformation-platform-kwcc4i` and tag `dg1-dev-history-d1cb245`, and in `decisions.md` (D-001…D-058) and `docs/delivery/findings.json` on that branch. Nothing is lost; the clean branch carries a conformant gate record for the final artifact.
- **DG2 is APPROVED** (gate `docs/delivery/gates/DG2.json`, candidate `sha256:ddaab3cc…` (564 files, source `805da3e2`), 32/32 DG2-final requirements). Gate round 17: 3× PASS (domain, code-security, qa) + release-auditor PASS (`T-DG2-AUDIT-R17`) on the same candidate. All 40 DG2 findings are CLOSED_VERIFIED by non-authors. Zero unresolved Critical/High, zero unresolved mandatory violations. `validate.mjs --stage DG2`, `--historical --stage DG2` and `--pipeline` all exit 0.
  - **17 review rounds.** Rounds 4-9 hardened text and media-type handling (D-063 to D-070). The round-10 audit was BLOCKED on three conditions (D-071): an undisclosed hook timeout, the connection-holding 413 (F-DG2-410), and F-DG2-206's ownership record. All three were resolved, and the auditor re-checked them in round 17. Its own F-DG2-410 reproduction no longer reproduces: app.close took 3 ms, against 64,911 ms in round 10.
  - **Rounds 11-13** fixed operational server defects (D-071 to D-073): connection hygiene, pool bounds, the three-phase upload, commit-time re-authorisation and graceful shutdown.
  - **Rounds 13-17** closed session and identity edge cases in the web client (D-074 to D-077). The D-077 2 s residual for non-navigation GETs was judged acceptable as declared.
  - **Auditor observation (non-blocking), an orchestrator error:** the D-067 summary in the round-9 to round-17 auditor assignments said the unreproduced setup failure was "later attributed to port collisions and fixed by F-DG2-310". The records say the opposite: F-DG2-310's EADDRINUSE mechanism does not explain the D-067 symptom, and the symptom simply never recurred (D-068). The records are accurate; only the assignment text was wrong. Future assignment templates must quote decisions from `decisions.md`, not paraphrase them from memory.
- **DG3 is APPROVED** (gate `docs/delivery/gates/DG3.json`, candidate `sha256:f55095db…`, 757 files, source `d3e6fe6`; 32/32 DG3-final requirements).
  - **Gate round 7:** 3× PASS (domain, code-security, qa), plus a release-auditor PASS (`T-DG3-AUDIT-R7`) on the same candidate.
  - **Findings:** all 5 DG3 findings are CLOSED_VERIFIED by non-owners: F-DG3-100, 120, 170, 180 and 280. There are 0 unresolved Critical/High findings and 0 mandatory violations.
  - **Validators:** `validate.mjs --stage DG3`, `--historical --stage DG3` and `--pipeline` all exit 0.
  - **7 review rounds** (D-078 to D-087):
    - **F-DG3-100** (Low; the formula engine's no-dynamic-code guard) needed five repairs, KBE-D to KBE-H. It closed against the reviewer's own final criterion. ADR-0024 §6 now claims only enumerated behaviour, with an honest residual.
    - **Incidents:**
      - D-082: worktrees created during reviews. Rule: no worktree or install activity while any review or audit run is active.
      - D-084: a container restart killed two reviews, which were re-run with the orphaned material kept for provenance.
    - **Auditor observations (non-blocking):**
      - the D-079 labelEn limitation and the F180b 390 px + 200% text grid state are carried to DG6 (REQ-S15-007/009);
      - the `session-identity.test.tsx` flake under load is acceptable as disclosed.
- **DG4 is APPROVED** (gate `docs/delivery/gates/DG4.json`, candidate `sha256:f38274cb…`, 1475 files, source `e70ac02`; 137/137 DG4-final requirements).
  - **Gate round 10:** 3× PASS (domain, code-security, qa), plus a release-auditor PASS (`T-DG4-AUDIT-R10`) on the same candidate.
  - **Findings:** 25 DG4 findings. 24 are CLOSED_VERIFIED by non-owners; F-DG4-148 (Low) is ACCEPTED_OBSERVATION, with the load envelope in `environment.md` limitation 6 (D-134). There are 0 unresolved Critical/High findings and 0 mandatory violations.
  - **Validators:** `validate.mjs --stage DG4`, `--historical --stage DG0` to `DG4`, `--pipeline` and `--reconcile` all exit 0.
  - **10 review rounds** (D-117 to D-140). Two history repairs were authorized by the user: D-136, restoring 33 deleted run files (write-once), and D-140, re-ordering the approval commit after the findings import.
  - **Open follow-up (D-140):** before the next gate audit, propose a decided fix for the auditor-sidecar ordering problem.
- **DG5 (P5 "Configuration automation and outputs") is APPROVED** (D-193) on branch `claude/mobily-transformation-platform-dg5-regate2`: gate `docs/delivery/gates/DG5.json`, candidate `sha256:55a411ae…` (2207 files, source `660f40c`), 78/78 DG5-final requirements. `validate --stage DG5`, `--historical --stage DG5` and `--pipeline` exit 0. DG6 carry-forward items and process lessons are listed in D-193.
- **DG6: FIXING after round 8** on `6cda8b33` (D-226): 460, 480 closed; new 520/541/560 (automation re-save, one defect), 540 (inbox), 561 (label copy, Low).
- **Next action:** BE-Z13 repair, then V12, then freeze round 9.
## DG2 scope (P2 — diagnose, define and design)

32 DG2-final requirements. Entity group (REQ-S16-013): DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome, StrategicGuardrail. Templates: T01 Current-State Diagnostic (REQ-PB-026, 6 pre-seeded dimensions, Confidence H/M/L), T02 Outcome & KPI Tree (REQ-PB-034, 7 cols, target-date required), T03 TOM Gap Matrix (REQ-PB-039, dimension required), T04 Design Decision Log (REQ-PB-043, D-01… IDs, Status defaults Open). Charter (REQ-PB-029, 14 fields, versioned, thesis + 5 scope sanity checks). TOM canvas 10 dimensions (REQ-PB-038/041/042), capability heatmap (REQ-PB-024), journey/process maps (REQ-PB-025). North Star single-current (REQ-PB-033), good-outcome test (REQ-PB-036), guardrails (REQ-PB-037). Six diagnostic workstreams (REQ-PB-023). Product gates G1/G2/G3 (REQ-PB-016/017/018, REQ-S04-003/004/005): missing/filename-only evidence blocks (REQ-S13-012), wrong/submitter approver → 403, superseded version → 409. Expanded role catalogue incl. read-only auditor (REQ-S10-001). E2E Diagnose→Design + P2 evidence (REQ-DLV-034). **G1–G6 are product/business gates and never imply an engineering DG approval.**

## DG1 scope (P1 — architecture and working foundation)

12 DG1-final requirements: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. The eight P1-active API modules (platform, audit, identity, access, organization, transformations, jobs, admin) are implemented and unit-tested; workflows/kpi/reporting are declared-but-reserved boundaries (D-047). Stack and conventions fixed by the P1 ADRs (`docs/architecture/adr/`).

## Unresolved blockers

None. DG0, DG1, DG2 and DG3 are APPROVED on this branch, and `--pipeline` exits 0. (The kwcc4i branch's `validate.mjs --stage DG1` reports the three documented historical write-once-record artifacts from D-056; this clean branch does not carry them.)

## D-191 (2026-10-25, delivery-orchestrator; recorded here because decisions.md is a frozen candidate file until the DG5 gate is decided, D-190)

**Corrected re-gate round 1 on candidate `ff3bc2c4`: domain, code-security and qa all PASS.** code-security raised **F-DG5-100** (Medium, not mandatory: DOCX and PPTX exports are not well-formed XML 1.0 when accepted user text holds a C0 control character, and the job still reports succeeded); qa raised **F-DG5-140** (Low: at branding version 0 the Arabic export header prints the English product name). domain raised none.
**Decision:** a Medium finding cannot be accepted, so both are repaired in **T-DG5-BE-RG3** (backend), recorded with `import-findings --fix` and the full merge commit, followed by a full merged-tree verification including e2e in both locale settings, a re-freeze, round 2 with all three reviewers, and the release audit per D-140 option 1. D-191 is copied into `decisions.md` only after the gate is decided.

## D-191 follow-up (2026-10-26): merged-tree verification of 7bb7d93

`docs/delivery/test-evidence/DG5/orchestrator-D-191/verify-rg3-7bb7d93/`: `--historical --stage DG4`, install, typecheck, build, lint, format, openapi lint, contrast, unit (locale unset and C.UTF-8) and integration exit 0; web e2e 470/470 with the locale unset and 470/470 with C.UTF-8; root 32/32; demo 10/10. DG5 is re-frozen for corrected re-gate round 2; from this freeze no candidate file changes until the gate is decided.

## D-192 (2026-10-26, delivery-orchestrator; recorded here because decisions.md is frozen in the candidate until the gate is decided)

**Corrected re-gate round 2 on candidate `55a411ae`: domain, code-security and qa all PASS; F-DG5-100 and F-DG5-140 CLOSED_VERIFIED by their reporters.** domain raised two new Low, non-mandatory presentation findings: **F-DG5-120** (Studio Elements table shows the five scoring-weight labels in Arabic on the English page) and **F-DG5-121** (scoring-defaults version page marks unchanged weights 'Changed' and shows the rubric diff as raw JSON).
**Decision (as D-183 and D-189):** every finding must be terminal before the gate. A fix would need a re-freeze, a full verification and a full round 3 (about 7–8 h); acceptance needs a short domain run and the auditor. So **round 3 runs on the same candidate `55a411ae`** with one task, **T-DG5-RG2-DOM-R3**: domain judges each finding and accepts it as an observation or keeps it open (then it is fixed). Both are carried to DG6 as fix items. The gate cites round 2's code-security and qa records and round 3's domain record. Then the release audit per D-140 option 1: verification run `T-DG5-RG2-AUDIT-V` (round 3), import, decision run `T-DG5-RG2-AUDIT-D` (round 4, same candidate). D-192 is copied into `decisions.md` only after the gate is decided.

## D-192 follow-up (2026-10-26): the first decision run BLOCKED on a findings.json mirror

`T-DG5-RG2-AUDIT-D` (round 4) BLOCKED on one record condition: `findings.json` had no `acceptance` object for F-DG5-120 and 121 (`import-findings.mjs` sets the status but not this mirror; for F-DG4-148 it was added by hand). The orchestrator added both objects in the F-DG4-148 shape; the `accepted_by` errors are gone from `validate --stage DG5`. A second decision run `T-DG5-RG2-AUDIT-D2` (round 5, same candidate) writes the gate.

## D-198 (2026-10-26): W3 stopped by a container restart

All four W3 runs (ARCH-03, BE-B, BE-E, FE-A) were stopped by a container restart. Their run folders are kept as `*-orphaned`; ARCH-03's partial work is the WIP commit `d206925` (its handback still had PENDING placeholders); BE-B, BE-E and FE-A had written their handbacks, but their final checks are unconfirmed, and their work is WIP-committed on their branches. Continuation runs T-DG6-{ARCH-03,BE-B,BE-E,FE-A}B review the WIP, finish and run every acceptance check. Recorded in `decisions.md` with the next merge.

## 2026-11-02: T-DG6-ARCH-11 run record incomplete (orchestrator note)

- **What happened:** `run-agent.sh` for `DG6-T-DG6-ARCH-11-solution-architect-20261101T230117Z-114368f1` exited **1** after the agent's own turn ended. The transcript's last records are `result: success` and `task_summary`.
- **Missing:** the runner's post-run steps did not complete. The run folder has no `meta.json`, and `transcript.jsonl` is not gzipped. The likely cause is the runner's post-run snapshot or git step failing while the orchestrator merged other branches into the same checkout (ARCH-11 ran in the main checkout). Not proven.
- **Kept as is:** the handback is complete, and the four document edits match it. They were committed as delivered (204260d3f), together with the run folder as found.
- **Consequence:** for this one documents-only run, this note stands in for the missing run metadata. Later documents-only tasks run in their own worktree, so that merges cannot overlap a run's post-processing.

## 2026-11-02: DG6 round-2 reviewers aborted by a container restart

The first launch of the three round-2 reviews (runs `DG6-T-DG6-REV-{DOM,CS,QA}-R2-*-20261102T0929*`/`T0930*`) ended at 09:43Z with exit 143 (SIGTERM, `no-result-line`), about 14 minutes in, when the session's container was restarted. No review record was written. Their run records are kept as written; the runner auto-committed their run records and one code-security repro file (kept as committed); the rest of their partial evidence was moved out of the tree (it is not review evidence). The three reviews are relaunched on the same candidate `cf40705b` with the same assignments.

## 2026-11-04: DG6 round-3 QA review aborted

The round-3 QA run `DG6-T-DG6-REV-QA-R3-qa-verifier-20261104T123608Z-01cb5eae` ended with exit 143 (SIGTERM, `no-result-line`) and wrote no review record. A container restart happened while it ran. Its run record is kept as written. The runner had already auto-committed its verifications file (F-DG6-144, 200 and 201 CLOSED_VERIFIED), so its evidence is kept in the tree and committed. The continuation run T-DG6-REV-QA-R3B finishes the review on the same candidate `aa219bd2` (`assignments/DG6/round-3/qa-verifier-continuation.md`). The domain review (FAIL: F-DG6-220 High, 221 Low, 222 Medium) and the code-security review (PASS; 180 and 181 CLOSED_VERIFIED) are complete.

## D-237 (2026-11-10, delivery-orchestrator; recorded here because decisions.md is frozen in the candidate until the gate is decided)

**DG6 round 12: domain, code-security and QA all PASS on candidate `c05864ba` (source `2495e036c4d933788044756ab3c41415e3873cf3`), with no new finding.** F-DG6-700 (domain) and F-DG6-740 (QA) are CLOSED_VERIFIED. All 52 DG6 findings are CLOSED_VERIFIED. None is ACCEPTED_OBSERVATION, so there is no auditor acceptance sidecar to import.

**Decision:** the release audit is therefore a single run, **T-DG6-AUDIT-R13** (round 13, same candidate). It writes its audit record and `docs/delivery/gates/DG6.json`. The two-part form of D-140 option 1 exists only to import the auditor's acceptance before the gate is written. The auditor may judge that a two-part audit is required; if so, the gate is BLOCKED and the audit is re-run in two parts.

D-237 is copied into `decisions.md` only after the gate is decided. Product gate G6 never implies DG7.

**Reopen if:** the audit BLOCKS.

## D-238 (2026-11-10): DG6 clean re-gate

The audit T-DG6-AUDIT-R13 BLOCKED (B1–B5). The user chose a clean re-gate. D-237 and D-238 are now recorded in `decisions.md` on branch `claude/mobily-transformation-platform-dg6-regate`, before its first freeze. **Next:** verify the carried tree (V16), then freeze round 1 and run three full reviews.

## D-238 follow-up (2026-11-10): round 1 of the clean re-gate frozen

- **Candidate:** `sha256:b506084b2c497c82d6e4de07789d35314bf1b3e3bb83f1dd6bf420a6c4510451` (2769 files, source `98feb869cd85671b3e95679e13bd255c421cb80d`).
- **Write-once:** the check reports 0 errors for DG6 and DG5. `validate --historical --stage DG5` and `--register DG6` both PASS.
- **No new verification run:** the product tree outside `docs/delivery` equals `4288d7c0b` byte for byte (`git diff` is empty). V15 (`test-evidence/DG6/orchestrator-final-4288d7c/`) verified that tree on all 15 steps, so it is not re-run.
- **The provenance tag** `dg6-dev-history-3dd8316ff` could not be pushed (HTTP 403). The old branch `claude/mobily-transformation-platform-dg5-regate2` at `3dd8316ff` is the reference.
- **Round 1:** full reviews by domain, code-security and qa (tasks `T-DG6-REV-*-RG-R1`). New finding ids are 900–959.

## 2026-11-10: DG6 clean re-gate round 2

- Round 1 on b506084b: domain PASS (F-DG6-900 Low), qa PASS, code-security FAIL (F-DG6-920 Medium). Imported.
- Repairs: T-DG6-BE-RG1 (80314f134; migration 0128, re-check over citations ∪ context) and T-DG6-FE-RG1 (ccd078e91; basis label, assistant withheld notices). Not recorded in decisions.md, to keep the candidate stable; recorded here and in the handbacks.
- V16 on ccd078e91: 15/15 exit 0 (integration 4360; e2e 556 + 556; root 288; demo 10). Evidence: test-evidence/DG6/orchestrator-final-ccd078e/.
- Round 2 frozen: candidate sha256:d62b187b… (2771 files, source 71ff750ed). Reviewers T-DG6-REV-{DOM,CS,QA}-RG-R2. Next: import round 2; fix with `import-findings --fix` if needed; else the release audit.

## 2026-11-11: DG6 clean re-gate round 3

- Round 2 on d62b187b: domain FAIL (F-DG6-960), code-security FAIL (F-DG6-970 Medium, F-DG6-971 Low), qa interrupted by a container restart (exit 143, no verdict record; sidecar F-DG6-980 imported). 960/970/980: one history-channel defect. F-DG6-900 and F-DG6-920 CLOSED_VERIFIED.
- Repair T-DG6-BE-RG2 (a0cf22bba; migration 0129). V17 on a0cf22bba: 15/15 exit 0 (integration 4366; e2e 556 + 556; root 288; demo 10).
- Round 3 frozen: candidate sha256:32e41b55… (2773 files, source f56f1b3d2). Reviewers T-DG6-REV-{DOM,CS,QA}-RG-R3.

## 2026-11-11: DG6 clean re-gate round 3 result, release audit round 4
- Round 3 on 32e41b55: domain PASS, code-security PASS, qa PASS (second attempt; the first was killed by a container restart). No new finding. F-DG6-960/970/971/980 CLOSED_VERIFIED.
- Orchestrator record fixes before the audit: `fix_revision` recorded for F-DG6-900 (ccd078e91…), 920 (80314f134…), 960/970/971/980 (a0cf22bba…); the verification block of 960/970/971/980 set to the code-security-reviewer round-3 sidecar (the one the validator selects among three same-round PASS verifications); `stages.json` round 2 no longer lists the qa record that the killed run never wrote (the B5 class of defect).
- State VERIFYING. Next: release audit T-DG6-AUDIT-RG-R4 (round 4, assignment `assignments/DG6/round-4/release-auditor.md`).

## 2026-11-11: F-DG6-990 repaired, V18 green, round 5 freeze
- T-DG6-BE-RG3 integrated at 60787d89f (migration 0130, served-seed text scan; D-239). V18 on 60787d8: 15/15 exit 0 (integration 4370, e2e 556+556, root 288, demo 10). Evidence `test-evidence/DG6/orchestrator-final-60787d8/`.
- Next: freeze round 5, full reviews by all three reviewers plus verification of F-DG6-990, then the release audit.

## 2026-11-11: round 5, F-DG6-911 (domain, Medium) — stages.json transition
- Domain round 5: FAIL on F-DG6-911: the DG6 history jumped VERIFYING -> REVIEWING at the round-5 freeze, with no FIXING entry for the round-4 audit BLOCK, so every `--historical` validator failed. F-DG6-990 verified CLOSED_VERIFIED by domain.
- Fixed in `stages.json` (meta-excluded; the candidate is unchanged): a FIXING entry inserted at 06:42:33Z (the audit record commit), with a note that it was recorded late. `--historical` DG1-DG5 re-run after the fix (exit codes in the commit).

## 2026-11-11: round 5 result, round 6 launched
- Round 5 on 5e819f7a: code-security PASS; domain FAIL (F-DG6-911); qa killed by a container restart (exit 143, no record) with sidecar finding F-DG6-951 (same defect). F-DG6-990 CLOSED_VERIFIED by domain and code-security.
- F-DG6-911/951 recorded FIXED_PENDING_VERIFICATION at e7cb240e7. Round 6 on the same candidate: domain and qa (T-DG6-REV-{DOM,QA}-RG-R6).

## 2026-11-12: round 7 PASS; F-DG6-952 accepted by the user; audit part 1

- Round 7 on the re-frozen candidate `10f71f24` (source `d8868b2a5`, D-240): domain, code-security and qa all PASS. F-DG6-911/951 CLOSED_VERIFIED by all three (fix `e7cb240e7` is now inside the candidate). findings.json verification blocks set to the code-security round-7 sidecar (the one the validator selects); F-DG6-990 `fix_revision` = `60787d89f`.
- **User decision (2026-11-12):** asked whether to accept F-DG6-952 (Low: out-of-order history timestamps in the approved DG0 and DG5 entries of `stages.json`) as an observation or fix it by rewriting approved history plus a new round, the user chose **accept as an observation**. Recorded here, not in `decisions.md`, because `decisions.md` is in the candidate and editing it would force another re-freeze; part 2 of the audit cites this entry.
- Next: release audit part 1 (round 8, T-DG6-AUDIT-RG-R8): concurrence on 952 only; import; then part 2 (round 9): full audit and gate decision.

## 2026-11-12: DG6 APPROVED

- Audit part 1 (round 8): PASS, F-DG6-952 ACCEPTED_OBSERVATION (qa-verifier, release-auditor), imported.
- Audit part 2 (round 9, T-DG6-AUDIT-RG-R9): PASS, `gates/DG6.json` decision APPROVED on candidate `10f71f24` (source `d8868b2a5`), blocking conditions none. `validate.mjs --stage DG6`: PASS.
- Next: DG7 (run `--historical --stage DG6` first, then plan).

## 2026-11-12: DG7 W3 — protocol audit; historic hits disclosed (D-249)

- DG6 approval capabilities (closing H10 by an added record): 48/48 DG6 requirements IMPLEMENTED and reviewed, covering integration and imports, connectors, identity and storage adapters, the optional assistant (off by default), security hardening, performance and async export, UX and accessibility hardening, and operational monitoring.
- User decision: the DO-I historic hits are disclosed, no gate is reopened (D-249).
- Next: W4 (T-DG7-ARCH-04, then T-DG7-BE-A); the A26 drill follows when disk allows.

## 2026-11-14: DG7 progress checkpoint refreshed (orchestrator note)

- This file lagged the real state from W4 to D-267 (the same defect the A27 drill found at the DG6 checkpoint, K11). The current checkpoint above is now current; it is updated at every step change from here.

## 2026-11-14: A26 drill K1-K3 (orchestrator)

- Branch `drill/dg7-a26` in a worktree outside the repository directory, base `3e0cec96275bfbb9f8daea15618d47547984d779`; one neutral-message commit `c3bbc780c` plants the defect; drill candidate `sha256:0df0d31b…c896` (not frozen).
- **Defect card SHA-256: `33eea29a15ab4c9fade0d99c7815e769b5cb1a22dccccc0a27b1825535df23b2`** (card kept outside the repository until K5).
- Next: K4, code-security-reviewer and qa-verifier with `--cwd` on the worktree.
