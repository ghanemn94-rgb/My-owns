# Handback T-DG2-AN-P2: DG2 register update (transformation-analyst)

- **Stage:** DG2 (FIXING), repair round 2. **Finding repaired:** F-DG2-202 (High, REQ-DLV-034). The register did not record DG2 completion.
- **Invocation:** run `DG2-T-DG2-AN-P2-transformation-analyst-20261002T105230Z-fb7d3cd0`, session `fb7d3cd0-bda3-451c-bcf5-00dbf728cbfc`.
- **Base:** `HEAD` = `96f736c39c8c83d33b1f6164d9a5a0442ed7c4f9`. The assignment file hash was verified: `a77546b2…df95`.
- **Working tree note:** while I ran, the shared tree had uncommitted edits under `apps/api/src/modules/kpi/**` and `apps/api/test/integration/contract/kpi-exercises.ts`. These come from the concurrent T-DG2-KBE2 run, not from me. I did not touch them, and I did not cite them as evidence. Every evidence pointer refers to a file committed at `96f736c`.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | 32 rows with `final_gate = DG2` changed. In each one, `status` went from SPECIFIED to IMPLEMENTED, `evidence` lists the real P2 files (`;`-separated, all existing), and `notes` gets a "DG2 analyst check (T-DG2-AN-P2, base 96f736c): …" sentence appended. The existing notes are kept. No other column or row changed: `git diff` shows exactly 32 lines removed and 32 added. |
| `docs/delivery/handbacks/DG2/T-DG2-AN-P2-transformation-analyst.md` | This handback. |

## 2. Rows changed (all 32 → IMPLEMENTED)

These rows changed: REQ-PB-003, 012, 016, 017, 018, 023, 024, 025, 026, 027, 028, 029, 030, 031, 033, 034, 035, 036, 037, 038, 039, 041, 042, 043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012 and REQ-S16-013.

The evidence for each row comes from five kinds of source:

- **Implementing code.** P2 migrations 0010–0018 and the `apps/api/src/modules/{transformations,workflows,kpi,evidence,methodology,access}` files, mapped per `docs/architecture/p2-work-split.md` §7.
- **Screens.** `apps/web/src/pages/{diagnose,define,design,decisions,gates,evidence,team,transformations}`.
- **Verifying tests.** These include:
  - `registers.test.ts`, `gates.test.ts`, `evidence.test.ts`, `kpi/kpi-resources.test.ts`, the contract suite, `aud-write-deny.test.ts` and `kpi-aud-write-deny.test.ts`;
  - the unit tests `workflows.test.ts`, `good-outcome.test.ts` and `kpi/rules.test.ts`;
  - the web tests `p2.test.tsx`, `team.test.tsx` and `modeGuidance.test.tsx`;
  - the e2e spec `apps/web/e2e/p2-journeys.spec.ts`.
- **Design records.** ADR-0015…0020, `docs/api/openapi.yaml` and `docs/architecture/erd.md`.
- **Run logs and records.** The P2 implementer handbacks, the qa round-1 integration log (`414 passed`), the orchestrator round-4 e2e log (`38 passed`) and, for REQ-DLV-034, the round-1 review records.

Before writing, I checked each cited test name against the acceptance clause it supports. The script also refuses any evidence path that does not exist.

## 3. Checks actually run

The environment was the sandboxed agent shell: Node from PATH, offline, repository at `96f736c` plus my register edit.

```
$ node tools/gates/validate.mjs --register DG2
PASS register rules at DG2
exit=0

$ node tools/gates/validate.mjs --historical --stage DG1
PASS gate DG1 (historical)
exit=0

$ node -e '<RFC-4180 parse of docs/delivery/requirements.csv>'
rows 412 cols 19 bad 0 {"DG5:SPECIFIED":78,"DG2:IMPLEMENTED":32,"DG3:SPECIFIED":32,"DG4:SPECIFIED":137,"DG0:IMPLEMENTED":19,"DG7:SPECIFIED":54,"DG1:IMPLEMENTED":12,"DG6:SPECIFIED":48}
```

The CSV parses with no unterminated quote, and every row has 19 columns. The DG0 and DG1 rows did not change.

I did **not** re-run the application test suites. The register cites the logs from the existing round-1 and orchestrator runs.

## 4. Known gaps: real gaps the register cannot fix

The register now marks all 32 rows IMPLEMENTED because the behaviour each one specifies exists in code and tests. Six open round-1 findings still affect some of these rows. The row notes name each one explicitly, and none of them can be closed in the register. **Reviewers should verify these rows on the repaired candidate, not on the register alone.**

- **F-DG2-201 (High, OPEN), affecting REQ-PB-017, REQ-S04-004 and REQ-DLV-034.**
  - At base `96f736c` no native path sets a KPI definition to `active`, so G2 can never be submitted or approved.
  - The G2 checklist, the trajectory criterion and the 403/409 decision rules are implemented. The rules are the shared `decideGate` path, proven on G1.
  - However, completing G2 and then G3 through native workflows is **not demonstrable at this base**. The e2e spec walks the Diagnose, Define and Design screens and approves G1 only.
  - These three rows depend on T-DG2-KBE2 routing `activateKpiDefinition`. **If that repair is not merged and verified, REQ-S04-004 and REQ-DLV-034 should be reverted to SPECIFIED.**
- **F-DG2-205 (Medium, OPEN), affecting REQ-S04-005.** The gate sequence is not enforced: G3 can be approved before G2. The fix is assigned to T-DG2-BE3.
- **F-DG2-203 (Medium, OPEN), affecting REQ-PB-030.** The composed thesis sentence does not follow the B0037 structure, and an incomplete thesis is not flagged. The fix is assigned to T-DG2-BE3.
- **F-DG2-204 (Medium, OPEN), affecting REQ-PB-033.** Field 5 of the charter can show a superseded North Star. The fix is assigned to T-DG2-BE3.
- **F-DG2-140 (High, OPEN), affecting REQ-S13-012.** The separation-of-duties check on evidence verification can be bypassed. The fix is assigned to T-DG2-BE3.
- **F-DG2-141 (High) and F-DG2-142 (Medium), both OPEN, affecting REQ-S10-001.** F-DG2-141 is a separation-of-duties gap on trajectory approval (assigned to T-DG2-KBE2). F-DG2-142 is an authorization gap on evidence-link removal (assigned to T-DG2-BE3).

There are three further limits:

- **REQ-S04-004 acceptance names the KPI.** The `g2.target_trajectory` criterion reports a pointer to the T02 row (`/outcomeKpis/{id}`), not the KPI name. That is close to the acceptance wording but not exact.
- **REQ-DLV-034's e2e clause.** No e2e test completes G2 or G3. The round-1 QA journey probe (`docs/delivery/test-evidence/DG2/qa/tests/dg2-qa-journey.test.ts`) is the candidate test for that clause once F-DG2-201 is fixed.
- **Cited evidence goes stale after the repairs.** When BE3 and KBE2 land, files such as `charter.ts`, `workshops.ts`, `evidence/routes.ts`, `kpi/*` and a migration 0019+ will change. The register paths still resolve, but the round-2 reviewers should re-check them.

## 5. Merge instructions

- There are no migrations and no code to merge. Copy back only `docs/delivery/requirements.csv`.
- The change does not overlap the BE3 and KBE2 file sets, so no conflicts are expected.
- Merge the register into the **same** candidate as the BE3 and KBE2 repairs, so that IMPLEMENTED status and the fixes are reviewed together.
- I do not approve anything and I did not review my own deliverable. Closing F-DG2-202 is for a non-author reviewer to verify.
