# Assignment T-DG6-BE-X2: P6 implementation, p6-work-split §B/A (pre-freeze repair of QA-A findings) (backend-workflow-engineer)


## The defects to repair (read first)

T-DG6-QA-A found three product defects. Read `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-A-authoring/handback.md` §5 and §6 for the exact requests, responses and its repair probe. Keep its failing tests; never edit them. Make them pass with product changes only.

1. **F-DG6-QA-A-1 (High, mandatory; REQ-S17-003): a correctly signed webhook is always refused.** `setConnectorSecretProviders` (`apps/api/src/modules/integrations/secret-refs.ts`) is never called from the composition root, so in the running product every webhook signing secret and every connector credential reference is unresolvable (`secret_unresolvable`). `apps/api/src/server.ts` (around line 581) builds the SecretProvider registry but never passes it on. Wire it on the composition line. Then add a test that runs through the real `buildServer` composition rather than an injected registry, so this class of gap cannot hide again. Check the worker composition for the same gap: connector runs resolve credentials there too.
2. **F-DG6-QA-A-2 (Medium; REQ-S12-019, ADR-0053 §2): a connector exception never links the KPIs it concerns.** `handleConnectorException` (`apps/worker/src/handlers/integrations.ts`) raises the exception without `kpiLinks`. Link the KPIs the failing run feeds: its import target and mapping, as ADR-0053 §2 and ADR-0055 define. Keep exactly one exception per failure (T-DG6-BE-K2S's test must stay green).
3. **F-DG6-QA-A-3 (Medium; REQ-S17-003 "webhooks are documented in OpenAPI"): the webhook body's item keys are not documented in `docs/api/openapi.yaml`.** ADR-0056 §7 also shows camelCase keys that the server refuses. Document the accepted body in OpenAPI on `receiveWebhook`. Do not edit the ADR: state in the handback the exact ADR-0056 §7 correction the architect must make.

Change no other behaviour. Run the API and worker integration projects, `tests/qa`, and `pnpm openapi:lint`, and report the results.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-x2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Runs alongside other P6 tasks on separate branches (at most four at a time). Touch only what the repairs need. T-DG6-BE-X1 is repairing the evidence-content 403 in openapi.yaml at the same time; keep your openapi.yaml edits to the webhook operation.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p6-work-split.md` §B/A (pre-freeze repair of QA-A findings). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p6-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0051 onward, and the DG1–DG5 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-193 to D-196 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p6-pending-*.ts` list. Exercise it in your `p6-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **Migrations (D-196):** if you need one, take the next id above the highest file in `packages/db/migrations/` on your branch and say so in the handback; the orchestrator renumbers at merge if needed. Never reuse a retired id.
- **e2e budgets are measured** (F-DG5-145/146/151 class): every new spec states a budget from a loaded measurement.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-195).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26600–26649 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-X2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-X2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
