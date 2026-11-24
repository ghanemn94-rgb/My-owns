# DG7 round 3: qa-verifier narrative (T-DG7-REV-QA-RG3)

Candidate `sha256:cf1fb7d59a04e2f0d18a7773eca4e10893b72f3119a70d0e74796c8a8437a541` (3160 files), source commit `3e8f5bce2b76320613bb25751675d02c1f89d185`. The JSON record `qa-verifier.json` is authoritative. This file summarises it.

**Verdict: FAIL.** Two new Medium findings in the A19 Compose backup and restore procedure. Medium findings must be repaired before the gate (D-192). Nothing is Critical or High, and no mandatory requirement is violated.

## Verifications (as the reporter)

| Finding | Result | Why |
| --- | --- | --- |
| F-DG7-1022 | PASS, CLOSED_VERIFIED | Every old-branch id in the register is qualified where it is cited, and the release notes cite none. REQ-DLV-011/012/014/018 now name conditions this branch's gate can show. The seven C3 handbacks match my protocol audit. |
| F-DG7-1051 | PASS, CLOSED_VERIFIED | The Compose half has now been run and recorded. rg3 failed at C3, a real defect that DO-D13 repaired. rg3b passed C0–C11 on a tree whose product files equal this candidate's. I judged the logs; I did not re-run the drill (no Docker daemon). |
| F-DG7-1052 | PASS, CLOSED_VERIFIED | The ADR-0063 Amendment 2 and ADR-0066 Amendment 1 texts match the code. |
| F-DG7-1053 | PASS, CLOSED_VERIFIED | A symlinked root is judged by its target and the messages are accurate (extended probe). T-E13a–d pass. |

## New findings

- **F-DG7-1081 (Medium, devops-engineer).** The split-phase (Compose) backup writes `config.files: []` and prints `cat: …/config.sha: No such file or directory`. The listing is kept in the database phase's per-process `$WORK`. My independent test reproduces it container-free. The same line is in the orchestrator's rg3b PASS log, unexplained.
- **F-DG7-1082 (Medium, devops-engineer).** A Compose restore that follows the guide leaves the restored evidence root-owned with 0700/0600 modes, which the API (uid 10001, `cap_drop: ALL`) cannot read. The drill hides this with an undocumented `chown -R` (C9). It also restored zero evidence objects, so neither the `DAC_READ_SEARCH` copy-out nor the ownership was exercised. DO-D12 disclosed it only in its handback (gap 2, Q3, unanswered). This is inferred from code and from the drill author's own statement; it was not observed in a container.
- **F-DG7-1083 (Low, solution-architect).** ADR-0066 was not amended for DO-D13 (`DAC_READ_SEARCH`, `DATABASE_URL_FILE`, the `/mth/deploy` mounts), and DO-D13's least-privilege question Q2 has no answer. Not blocking on its own.

## Everything else on this candidate

- Validators: historical DG6…DG0, pipeline and register pass.
- Build and static checks pass.
- Unit tests pass in both locales. The only failure was the load-sensitive A13 QA harness test, which passes alone.
- Integration: 4696 tests pass.
- e2e in English (LTR) and Arabic (RTL): product 572 passed (2 demo-only skips, which pass on the demo stack), root acceptance 288 passed (18 axe routes skipped by design) with a loopback-only connection log, demo 10/10, offline drill 10/10.
- A18 on one archive: verify 7/7, drill D0–D11 and harness 10/10.
- A19 container-free drill: R1–R9 pass.
- A06 bundle replay, A26 regression and the A27 re-drill (K9–K13 and stale review) pass.
- Dictionary and production initialisation pass.
- Secret scans pass. The new history allow-list entry is sound; it cites a non-existent D-285, which I record as an observation.
- Protocol audit: the same 279 hits as the orchestrator's report.

## Run disclosures

The first background launches hit the 30-minute limit. Everything was re-run in full, and the partial logs are kept as `*-killed.log`. Host load was high, the shared disk filled up briefly, and the domain reviewer's run was auto-committed during this run; I opened none of its files.

Nothing here is a business, Finance or IT approval. Product gate G6 does not imply DG7.
