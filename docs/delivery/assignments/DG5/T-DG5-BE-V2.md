# Assignment T-DG5-BE-V2: DG5 round-1 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 on candidate `sha256:8e7d23a3…` (D-170).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-v2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four repair tasks run at the same time (D-170): T-DG5-BE-V1, T-DG5-BE-V2, T-DG5-BE-V3 and T-DG5-FE-V1, each in its own worktree, at the round-1 candidate's tree plus the round-1 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-101** (Medium, mandatory violation; REQ-S06-002; reported by code-security-reviewer in `docs/delivery/reviews/DG5/round-1/code-security-reviewer.json`): Procedure outputs: an organization-scope intake's capture_intake step accepts, and its steps then adopt, a transformation the acting person cannot read (write on an unreadable record; D-166 Rule A amplifies it).
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/code-security/round-1/repro/intake-foreign-transformation.test.ts`, `docs/delivery/test-evidence/DG5/code-security/round-1/repro/intake-foreign-transformation.log`, `apps/api/src/modules/procedures/outputs/kit.ts`, `apps/api/src/modules/procedures/outputs/transformations.ts`, `apps/api/src/modules/procedures/steps.ts`, `packages/db/migrations/0096_p5_intake_adopts_transformation.sql`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-170** in `docs/delivery/decisions.md`. Read D-170 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-170): a step's output must be a record the acting person may read.**
  - Today `apps/api/src/modules/procedures/outputs/kit.ts:87-99` (`inScope`) checks only the organization for an organization-scope instance with no earlier output, and `kit.ts:104-118` (`producedHere`) only the creation time and that no other instance took the record. `steps.ts:1327` calls the adapter after authorizing the actor on the instance's scope only.
  - **The rule, in the adapter kit, for every output adapter (not only transformations):** before anything is linked, the acting principal must hold the read permission of the named record's type in that record's own scope (for a transformation: `transformation.read` on that transformation, through the same resolver the record's GET uses). Otherwise the completion is refused exactly like an unknown record: `422 procedure_step.output_record_invalid`, with no detail that discloses the record's existence. Nothing is linked and, for an intake, nothing is adopted (D-166 Rule A only follows a valid link).
  - **Commit time.** The check runs inside the completing transaction, after the locks the step already takes (re-checked at commit time, shared rule §2).
  - **Audit.** A refused completion writes the same `authorization.denied` or problem audit the step path writes for an unknown record today (keep the existing behaviour; do not add a new event type).
  - **Tests:** the reviewer's `intake-foreign-transformation.test.ts` as a product integration test (422, no link, no adopted step, TL2 still cannot read the intake); the positive path (TL1 names a transformation it can read, it is linked and adopted, as `intake-adoption.test.ts` shows); the same refusal for at least one other output adapter (a record type other than a transformation that the actor cannot read).

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-170 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/api/src/modules/procedures/**` (the output adapter kit, the adapters and the step completion path), and the tests under `apps/api/test/integration/procedures/**` that your change needs.
- **Concurrent owners:** T-DG5-BE-V1 edits `apps/api/src/modules/methodology/**`, `automation/lifecycle.ts`, `platform/db-errors.ts`, migration `0097` and `packages/db/src/schema.ts`; T-DG5-BE-V3 edits `packages/db/src/demo/**` and the demo tests; T-DG5-FE-V1 edits `apps/web/**`. Do not edit their files.

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
3. `apps/api/test/integration/procedures`, `apps/api/test/integration/contract.test.ts`, `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` and your new tests pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts, and the failing-before output of the reproduction.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-V2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-V2-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R4);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
