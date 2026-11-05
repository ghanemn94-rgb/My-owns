# Assignment T-DG6-BE-Z6: DG6 pre-freeze repair: acknowledging a recurring operational exception conflicts with the heartbeat watch (backend-workflow-engineer)


## What to change (read first)

Found by the orchestrator's final verification of `31d5ccea4` (`docs/delivery/test-evidence/DG6/orchestrator-final-31d5cce/`, step `root`): `e2e/a22-p6-operability.spec.ts` failed once in `chromium-en` (13.7 s): after the administrator clicked Acknowledge, the exception stayed `open`. The same spec then passed 6 of 6 alone (3 en, 3 ar, about 60 s each). It is not a flake to ignore; the cause is a race in the product:

- The API heartbeat watch (`apps/api/src/modules/operations/heartbeat.ts`, every 60 s) calls `raiseOperationalException` again on an open or acknowledged `heartbeat_missed` exception once its `last_occurred_at` is more than `RECUR_MIN_GAP_SECONDS` (30 s) old. That recurrence bumps the exception's `version`.
- `acknowledge`/`resolve` (`apps/api/src/modules/operations/exceptions.ts` around line 532) require `expectedVersion`, so an administrator who loaded the page before a tick gets 409. On the root stack no worker runs, so the exception was already open and recurring, which made the race likely.
- Confirm this reading first (a deterministic integration test: load, recur, acknowledge with the loaded version). If the evidence shows a different cause, fix that and say so.

1. **Product.** An occurrence update by the system must not make a human's acknowledge or resolve of the same exception fail. Choose and justify one design: for example, keep occurrence fields out of the optimistic-concurrency version (a separate occurrence counter), or let acknowledge/resolve accept a version that differs only by system occurrence updates. A real human-vs-human conflict must still be 409. The audit trail must still record each occurrence and the human action with its prior and new version. Apply the same rule to every raiser that recurs (connectors, stale data, automation), not only the heartbeat watch.
2. **The web** (if this file is outside your p6-work-split section, list the change in your handback for the frontend owner). If acknowledge or resolve does get a 409, the exception page must show the localized conflict message (en and ar) and the current state, not stay silent.
3. **Tests.** An integration test that fails before the fix (recurrence between load and acknowledge), a human-vs-human 409 control, and the web behaviour on 409. Make `a22-p6-operability.spec.ts` deterministic under that race without weakening any assertion; show it passing repeatedly (for example `--repeat-each=5`, both locales) on the root stack (`apps/web/e2e/support/with-stack.sh`).

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 4, pre-freeze).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-z6`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** no other task runs at the same time. Touch only what your repair needs.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your scope:** the findings named above. The p6-work-split section that owns each touched file still applies.
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
- **Your harness ports are 30100–30149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over an hour on this host); the orchestrator runs it on the merged tree. Run every integration file your change touches inside `tests/qa/support/with-pg.sh`, and report the counts. At least: every `operations` suite (exceptions, heartbeat), the connector, stale-data and automation exception suites, and the worker `operations` handler suites.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-Z6-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z6-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
