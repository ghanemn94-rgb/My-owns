# A26 — first defect-injection drill (orchestrator, DG1 / P1)

REQ-S20-026 (A26) requires the orchestrator to run the first defect-injection drill in P1, proving the test suites
catch real defects. Run on a disposable git worktree of the integrated DG1 candidate (`1ec0db4`), inside the
sandbox (`tools/deps/install-sandbox.sh run`). Full log: `a26-first-drill.log`.

| Step | Injected defect | Suite | Result |
|---|---|---|---|
| Baseline | none (clean candidate) | rules + transitions unit | 13 passed (exit 0) |
| Defect A — authorization | `grantApplies` org-boundary check neutralized (`if (grant.scopeId !== target.organizationId) return false;` → `if (false) …`) — a cross-organization authorization leak | `apps/api/src/modules/access/rules.test.ts` | **2 failed / 10 passed → DEFECT CAUGHT** |
| Defect B — state machine | `isAllowedTransition` returns `true` for any transition — invalid status transitions allowed | `apps/api/src/modules/transformations/transitions.test.ts` | **1 failed → DEFECT CAUGHT** |
| Post-revert | defects reverted | rules + transitions unit | 13 passed (exit 0) |

Both injected defects were caught by the matching unit suites; the suites pass clean before and after. This corroborates
qa-verifier's T-DG1-QA mutation testing (four product breaks across A12/A13/A14 each failed the matching acceptance
suite). A26 repeats at later gates (completes at DG7). The drill ran on a disposable worktree, so the candidate tree
was never modified.
