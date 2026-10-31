# Assignment T-DG6-BE-X3B (continuation of T-DG6-BE-X3): P6 implementation, p6-work-split §D and §J/C (pre-freeze repair: composition gaps) (backend-workflow-engineer)


## Continuation (read first)

T-DG6-BE-X3 was killed by a container restart (exit 143) before it wrote a handback. Its partial tree is committed on branch `dg6/be-x3` ("WIP partial tree"), and your worktree is that branch, brought up to date with the integrated branch. Review the partial work critically: keep what is right, finish what is missing, fix what is wrong. Then run every check in the acceptance section, and write the handback `T-DG6-BE-X3B-backend-workflow-engineer.md`. Say which parts BE-X3 wrote and which you wrote.

## The defects to repair (read first)

The same class of gap as F-DG6-QA-A-1 (a module setter never called from the composition root):

1. **`setAssistantSecretProviders`** (`apps/api/src/modules/assistant/provider.ts`) is never called from `apps/api/src/server.ts`, so an IT model endpoint credential reference cannot resolve in the running product. Reported in `docs/delivery/handbacks/DG6/T-DG6-BE-X2-backend-workflow-engineer.md` §5. Wire it on the composition line, as BE-X2 did for connectors.
2. **QA-D-1 (Medium, REQ-S17-009):** `installConnectionLog` (ADR-0059 §12: "one call each in `apps/api/src/server.ts` and `apps/worker/src/main.ts`") is called nowhere, so `MTH_CONNECTION_LOG` produces no log. Wire both calls.
3. **QA-D-2 (Low, REQ-S17-009):** for an outbound TCP attempt that never connects, the log writes `host`, `address` and `port` as null. Log the requested host and port ("with what is known").

Read `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-D-authoring/handback.md` §5 for the reproductions. Add tests that go through the real composition (`buildServer`, and the worker main), not an injected registry, so the gap cannot hide again. Also grep every `set*Provider*`, `set*Port`, `install*` and `register*` setter under `apps/*/src/modules` and `apps/worker/src`. List each one with the composition call that wires it, or fix it if nothing does. Change no other behaviour.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-x3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Runs alongside other DG6 repair tasks on separate branches. Touch only what the repair needs.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p6-work-split.md` §D and §J/C (pre-freeze repair: composition gaps). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
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
- **Your harness ports are 26900–26949 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG6/T-DG6-BE-X3B-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-X3B-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
