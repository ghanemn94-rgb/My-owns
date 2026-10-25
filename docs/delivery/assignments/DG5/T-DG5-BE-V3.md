# Assignment T-DG5-BE-V3: DG5 round-1 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 on candidate `sha256:8e7d23a3…` (D-170).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-v3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four repair tasks run at the same time (D-170): T-DG5-BE-V1, T-DG5-BE-V2, T-DG5-BE-V3 and T-DG5-FE-V1, each in its own worktree, at the round-1 candidate's tree plus the round-1 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-120** (Medium; REQ-S18-002; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-1/domain-reviewer.json`): The seeded roaming demo transformation sits in the Transform phase with all six product gates G1-G6 never submitted or approved, contradicting the stage-gate logic the product itself enforces.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/domain/round-1/api-demo/demo-transformation.json`, `docs/delivery/test-evidence/DG5/domain/round-1/api-demo/demo-gates.json`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/en/d01-workspace.png`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/ar/d01-workspace.png`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/en/d06-gate-G1.png`, `docs/delivery/test-evidence/DG5/domain/round-1/shots-demo/ar/d06-gate-G1.png`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-170** in `docs/delivery/decisions.md`. Read D-170 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-170): the seeded roaming transformation carries the gate history its phase implies.** It is an `end_to_end` transformation in Transform, so G1 to G4 are approved and G5 and G6 are not submitted.
  - Today `packages/db/src/demo/data/roaming.ts` (about line 229, `current_phase: "transform"`, and lines 361-374) inserts the six `gate_instance` rows with no submission or decision.
  - **Seed G1 to G4 as the product records an approval**, through the same tables, guards and audit the product's own submit and decide paths write (`apps/api/src/modules/workflows/gates.ts`), with:
    - each gate's mandatory criteria complete with linked synthetic evidence, or covered by an exception exactly as the product allows one, so that each approved gate page reads coherently (no "2 of 6 mandatory outputs complete" next to "approved");
    - a submission by the demo role user who submits that gate in the product, and a decision by the gate's routed approver as a demo role user (`roaming.user.*`), with a dated synthetic rationale;
    - dates on the synthetic clock in phase order, before the Transform-phase records that depend on them;
    - the label of every demo G-approval: 'Synthetic demonstration - approves nothing real' (REQ-S21-001), shown wherever the product shows a demo gate decision, in en and ar.
  - **G5 and G6** stay not submitted. The workspace's 'Gate readiness: G5' stays as the product computes it.
  - **Keep** REQ-S18-002's coverage (ADR-0050 §5; the seeded pending approval in `roaming.user.bo`'s inbox), REQ-S18-001's deterministic reset (two resets give identical counts and checksums), the three B0147 chains (REQ-PB-090), and the guided walkthrough (REQ-S18-004, which starts with a NEW transformation).
  - **No real approval** is granted: every seeded decision is synthetic demo data in a demo-initialized database, refused in production as all demo seeding is.
  - **Tests:** an integration test on a seeded demo database reads the transformation's gates through the product's own operation (`GET /transformations/{id}/gates`, signed in as a demo role user): G1–G4 approved with their decisions and approvers, G5–G6 not submitted, every G1–G4 mandatory criterion complete or excepted, and the synthetic label on each decision. Update the demo dataset tests whose pinned counts or checksums change, and list each change.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-170 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `packages/db/src/demo/**` and the demo dataset tests (`packages/db/test/integration/demo*.test.ts`, `apps/api/test/integration/environment/demo-*.test.ts`), plus pinned demo counts in `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` only where a pin must change (list each one).
- **Concurrent owners:** T-DG5-BE-V1 edits `apps/api/src/modules/methodology/**`, `automation/lifecycle.ts`, `platform/db-errors.ts`, migration `0097` and `packages/db/src/schema.ts`; T-DG5-BE-V2 edits `apps/api/src/modules/procedures/**`; T-DG5-FE-V1 edits `apps/web/**` (if the synthetic label needs a web change on a gate page, write the need in your handback for the orchestrator instead of editing `apps/web`). Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23100–23149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. `packages/db/test/integration`, `apps/api/test/integration/environment`, your new test, and `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts.
4. The demo e2e specs pass on a demo stack, once, `--workers=1`: `E2E_PG_PORT=<port> E2E_API_PORT=<port> MTH_PORT_POOL=<rest> e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list` (set `E2E_SCREENSHOT_DIR` to a path under your evidence folder). Report the counts.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-V3-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-V3-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R4);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
