# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

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
- **Next action:** DG4 (P4). Run `node tools/gates/validate.mjs --historical --stage DG3` (exit 0) before any DG4 implementation, then plan DG4 from the master prompt and the register (`final_gate` = DG4), architecture first, as for DG3 (D-078).

## DG2 scope (P2 — diagnose, define and design)

32 DG2-final requirements. Entity group (REQ-S16-013): DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome, StrategicGuardrail. Templates: T01 Current-State Diagnostic (REQ-PB-026, 6 pre-seeded dimensions, Confidence H/M/L), T02 Outcome & KPI Tree (REQ-PB-034, 7 cols, target-date required), T03 TOM Gap Matrix (REQ-PB-039, dimension required), T04 Design Decision Log (REQ-PB-043, D-01… IDs, Status defaults Open). Charter (REQ-PB-029, 14 fields, versioned, thesis + 5 scope sanity checks). TOM canvas 10 dimensions (REQ-PB-038/041/042), capability heatmap (REQ-PB-024), journey/process maps (REQ-PB-025). North Star single-current (REQ-PB-033), good-outcome test (REQ-PB-036), guardrails (REQ-PB-037). Six diagnostic workstreams (REQ-PB-023). Product gates G1/G2/G3 (REQ-PB-016/017/018, REQ-S04-003/004/005): missing/filename-only evidence blocks (REQ-S13-012), wrong/submitter approver → 403, superseded version → 409. Expanded role catalogue incl. read-only auditor (REQ-S10-001). E2E Diagnose→Design + P2 evidence (REQ-DLV-034). **G1–G6 are product/business gates and never imply an engineering DG approval.**

## DG1 scope (P1 — architecture and working foundation)

12 DG1-final requirements: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. The eight P1-active API modules (platform, audit, identity, access, organization, transformations, jobs, admin) are implemented and unit-tested; workflows/kpi/reporting are declared-but-reserved boundaries (D-047). Stack and conventions fixed by the P1 ADRs (`docs/architecture/adr/`).

## Unresolved blockers

None. DG0, DG1, DG2 and DG3 are APPROVED on this branch, and `--pipeline` exits 0. (The kwcc4i branch's `validate.mjs --stage DG1` reports the three documented historical write-once-record artifacts from D-056; this clean branch does not carry them.)
