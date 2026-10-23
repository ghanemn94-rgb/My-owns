# Assignment T-DG5-BE-X1: DG5 round-1 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 2 on candidate `sha256:c4f70a80…` (D-172).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-x1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three repair tasks run at the same time (D-172): T-DG5-BE-X1, T-DG5-BE-X2 and T-DG5-FE-X1, each in its own worktree, at the round-2 candidate's tree plus the round-2 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-122** (Medium; REQ-PB-019; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-2/domain-reviewer.json`): G4 readiness reports Roadmap, Owners, Funding, Capacity (and Prioritization, Business cases) as Complete over an empty approved portfolio once 'Initiative cards' is covered by an exception; the demo G4 approval rests on this.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/gate-G4-live.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/funding-decisions.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/resource-demands.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/capacity-plan.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/initiatives.json`, `docs/delivery/test-evidence/DG5/domain/round-2/demo/api-g4/milestones-01995000-0000-7000-8000-000000000021.json`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-172** in `docs/delivery/decisions.md`. Read D-172 verbatim (and D-170, D-171 for the round-1 repairs it builds on); the scope below restates it.

## Binding scope

- **Decided (D-172): a G4 criterion whose subject set is the approved portfolio fails closed when that set is empty.**
  - Today `apps/api/src/modules/workflows/g4.ts` evaluates each criterion "for every initiative in the approved portfolio". The approved portfolio is `PortfolioGateFacts.initiatives`, the initiatives with status selected, funded or launched (`apps/api/src/modules/portfolio/gate-facts.ts`). These criteria are affected:
    - `g4.roadmap`, `g4.owners`, `g4.funding` and `g4.capacity`;
    - `g4.prioritization`;
    - the per-initiative parts of `g4.business_cases` and `g4.finance_validation`.
    So an empty portfolio makes them complete vacuously. Only `g4.initiative_cards` refuses an empty portfolio (`g4.portfolio_empty`), and an accepted exception on it then turns the others green with no evidence.
  - **The rule.** When the loaded portfolio is an empty array, each of those criteria is incomplete:
    - it carries one missing item with a code that names the cause, for example `g4.portfolio_empty_<criterion>` or one shared `g4.no_approved_initiative`, with the message 'No initiative in the approved portfolio';
    - the transformation-level parts of `g4.business_cases` and `g4.finance_validation` keep their own checks (a transformation case and its validation), and the criterion is complete only if both the transformation-level part and a non-empty per-initiative part hold;
    - `undefined` (facts not loaded) keeps today's NOT_LOADED behaviour.
  - **Live and frozen.** The same evaluators feed the live readiness and the frozen submission snapshot, so both read the same. Confirm it in a test: the frozen criteria of a submission made on an empty portfolio record these criteria as incomplete.
  - **Exceptions keep their meaning.** An exception covers one criterion. With the portfolio empty, a G4 submission needs an accepted exception per incomplete criterion, exactly as the product already requires for any incomplete mandatory criterion. Do not change the exception rules.
  - **The web text.** Add the en and ar labels of the new missing-item code(s) to `apps/web/src/i18n/{en,ar}/gates.json`, next to `g4__portfolio_empty`, so the gate page names the cause. The translation guard tests must pass.
  - **Tests:**
    - the domain reviewer's reproduction as a product integration test: a transformation whose approved portfolio is empty, with an accepted exception on `g4.initiative_cards`, reads roadmap, owners, funding, capacity, prioritization and the per-initiative case parts as incomplete, live and in a frozen submission;
    - unit tests of each evaluator on an empty portfolio;
    - the existing DG3 and DG4 G4 tests stay green; list any whose expectation changes, and why.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-172 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/api/src/modules/workflows/g4.ts` (and `criteria.ts` only if needed), their unit tests, `apps/api/test/integration/workflows/**` and `apps/api/test/integration/portfolio/**` tests of G4 readiness, and the new missing-item label entries in `apps/web/src/i18n/{en,ar}/gates.json` only.
- **Concurrent owners:** T-DG5-BE-X2 edits `packages/db/src/demo/**` and the demo tests. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23000–23049 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. The Vitest projects your change reaches pass with the locale unset and with `C.UTF-8`, one at a time: `unit-node` for `apps/api/src/modules/workflows`, and `unit-web` for the i18n guard tests. Report the counts.
3. These pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`:
   - `apps/api/test/integration/workflows`;
   - `apps/api/test/integration/portfolio`;
   - `apps/api/test/integration/contract/contract.test.ts` (note the path);
   - `tests/qa/integration/a08-*` and `tests/qa/integration/a09-*`;
   - your new tests.
   Report the counts and the failing-before output of the reproduction.
4. The G4 e2e journeys pass on the real stack, once, `--workers=1`, in chromium-en and chromium-ar: `apps/web/e2e/p3-journeys.spec.ts` and `apps/web/e2e/p4-gates-closure.spec.ts`, through `apps/web/e2e/support/with-stack.sh`.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-X1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-X1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R5);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
