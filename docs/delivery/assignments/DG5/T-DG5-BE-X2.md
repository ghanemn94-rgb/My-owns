# Assignment T-DG5-BE-X2: DG5 round-1 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 2 on candidate `sha256:c4f70a80…` (D-172).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-x2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three repair tasks run at the same time (D-172): T-DG5-BE-X1, T-DG5-BE-X2 and T-DG5-FE-X1, each in its own worktree, at the round-2 candidate's tree plus the round-2 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-120** (Medium; REQ-S18-002; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-1/domain-reviewer.json`): The seeded roaming demo transformation sits in the Transform phase with all six product gates G1-G6 never submitted or approved, contradicting the stage-gate logic the product itself enforces.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/domain/round-1/api-demo/demo-transformation.json`, `docs/delivery/test-evidence/DG5/domain/round-1/api-demo/demo-gates.json`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/en/d01-workspace.png`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/ar/d01-workspace.png`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/en/d06-gate-G1.png`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/ar/d06-gate-G1.png`.
- **F-DG5-122** (Medium; REQ-PB-019; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-2/domain-reviewer.json`): G4 readiness reports Roadmap, Owners, Funding, Capacity (and Prioritization, Business cases) as Complete over an empty approved portfolio once 'Initiative cards' is covered by an exception; the demo G4 approval rests on this.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/gate-G4-live.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/funding-decisions.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/resource-demands.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/capacity-plan.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/initiatives.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/milestones-01995000-0000-7000-8000-000000000021.json`.

- **Read also** the domain reviewer's round-2 verification of F-DG5-120 (`docs/delivery/reviews/DG5/round-2/domain-reviewer.verifications.json`) and its evidence under `docs/delivery/test-evidence/DG5/domain/round-2/demo/`: they list exactly which G4 facts the demo lacks.
- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-172** in `docs/delivery/decisions.md`. Read D-172 verbatim (and D-170, D-171 for the round-1 repairs it builds on); the scope below restates it.

## Binding scope

- **Decided (D-172): the demo's approved G4 rests on a real approved portfolio, with no exception.** This is F-DG5-120's remaining part. F-DG5-122 is listed because T-DG5-BE-X1 makes the G4 evaluator fail closed on an empty portfolio; your seed must therefore satisfy every G4 criterion on real records. Do not edit the evaluator.
  - Today `packages/db/src/demo/data/roaming-gates.ts` approves G4 with two accepted exceptions (`g4.initiative_cards`, `g4.prioritization`). The three illustrative initiatives INI-01..03 (B0147) stay `draft`, and the database holds no portfolio, ranking snapshot, funding decision, approved milestone, resource demand or capacity.
  - **Seed the approved portfolio, as the product records it, before the G4 submission on the synthetic clock.** For INI-01..03:
    - complete initiative cards, with gap and outcome/KPI links (they exist; check them);
    - a portfolio submission, ranking and selection under the transformation's scoring weights, with a ranking snapshot, so the initiatives are selected or funded;
    - a funding decision for each, as the product's funding path records it;
    - approved roadmap milestones with dates in phase order, and no schedule conflict;
    - owners;
    - committed resource demand within an active capacity plan, with no capacity conflict;
    - an initiative-level business case per initiative with its Finance validation, by demo role users as the product requires (the Finance user validates; never the author).
  - **Keep the totals.** Where initiative-level cases or lines would change a figure the demo already shows (the transformation business case, the benefit totals, the KBE-H numbers), split the existing figures across the initiatives so every total the demo shows stays identical. If a total must change, change the pinned test and list it, with the reason.
  - **Remove the two G4 exceptions.** G4's live and frozen readiness then read 8 of 8 complete, under the fail-closed evaluator of T-DG5-BE-X1 (`T-DG5-BE-X1`'s rule: an empty portfolio is incomplete). Your test must not depend on X1's code: assert directly that the approved portfolio holds INI-01..03 and that each per-initiative fact the evaluator reads is present.
  - **The decision rationale.** GD-04, 'The portfolio is executable and value-backed', becomes true to the records. Keep the synthetic label, and keep the dates in phase order.
  - **Keep, unchanged:**
    - the G1–G3 history;
    - G5 and G6 not submitted;
    - REQ-S18-002's coverage (ADR-0050 §5), including the seeded pending approval;
    - the deterministic reset (two resets give identical counts and checksums);
    - the three B0147 chains (REQ-PB-090);
    - the 12-step guided walkthrough (REQ-S18-004, which starts with a NEW transformation).
  - **Tests:**
    - extend `apps/api/test/integration/environment/demo-gate-history.test.ts`. Through the product's own operations, signed in as a demo role user, assert that G4 is approved with every criterion complete and no exception; that the approved portfolio is INI-01..03; and that funding, milestones, demand, owners and the validated cases exist;
    - update the demo dataset tests whose pins change, and list each change.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-172 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `packages/db/src/demo/**`, the demo dataset tests (`packages/db/test/integration/demo*.test.ts`, `apps/api/test/integration/environment/demo-*.test.ts`), and pinned demo values in `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` only where a pin must change (list each one).
- **Concurrent owners:** T-DG5-BE-X1 edits `apps/api/src/modules/workflows/**`, its tests and two i18n label entries. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23050–23099 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared with three other tasks. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **Tests:** deterministic under load (F-DG4-143 to F-DG4-148); never read whole delivery folders (D-138); never stop processes with `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. The Vitest unit projects your change reaches pass with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. These pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`:
   - `packages/db/test/integration`;
   - `apps/api/test/integration/environment`;
   - `apps/api/test/integration/reporting/table-totals-demo.test.ts`;
   - `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts`.
   Report the counts.
4. The demo e2e specs pass on a demo stack, once, `--workers=1`: `E2E_PG_PORT=<port> E2E_API_PORT=<port> MTH_PORT_POOL=<rest> e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list`, with `QA_EVIDENCE_DIR` and `E2E_SCREENSHOT_DIR` under your evidence folder. Report the counts.
5. **The time limit.** This task is large. If you pass about 100 minutes, stop at a consistent seed (every test green), and write the handback listing exactly what remains, in order. A continuation will finish it.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-X2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-X2-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R5);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
