# Assignment T-DG6-FE-Z3: DG6 round-4 repair: catalogue texts for exception and field-error codes, and the connector target display (F-DG6-320, F-DG6-301, F-DG6-281, Low) (frontend-ux-engineer)


## What to change (read first)

Read the findings verbatim in `docs/delivery/reviews/DG6/round-4/qa-verifier.findings.json` (F-DG6-320), `docs/delivery/reviews/DG6/round-4/code-security-reviewer.findings.json` (F-DG6-301) and `docs/delivery/reviews/DG6/round-4/domain-reviewer.findings.json` (F-DG6-281), with their probes under `docs/delivery/test-evidence/DG6/{qa,code-security,domain}/round-4/`.

1. **F-DG6-320 (Low, REQ-S15-007).** On the operational exception page, "Last error" shows the raw code for `kpi.stale` (worker, `apps/worker/src/handlers/operations.ts`) and `operations.heartbeat_missed` (API, `apps/api/src/modules/operations/heartbeat.ts`), in both languages, because neither has a catalogue text. Add true en and ar texts for both, and for any other exception code the product raises.
2. **F-DG6-301 (Low, REQ-S15-007).** `validation.commit_on_behalf_of`, `validation.credential_refs` and `validation.unknown_version` (field-error codes inside `problems.validation([...])`) have no en/ar text.  Add them.
3. **The class, for items 1 and 2:** extend `apps/web/src/i18n/problems-all.test.ts` so it also collects codes inside `problems.validation([...])` arrays and every operational-exception `errorCode` the API and worker raise (including codes held in constants), and fails when any of them lacks an en or ar text. Show that it fails before your texts are added.
4. **F-DG6-281 (Low, REQ-S17-001).** The connector edit screen (`apps/web/src/pages/integrations/ConnectorFormPage.tsx`) shows "Choose…" in the required "Target transformation" select when the stored target is a transformation the administrator cannot read. Show that a target is set (for example "A transformation you cannot view" with its code or id, in both languages), keep it selectable, and keep the stored value on save. Do not widen what the administrator can read. Add a web unit test and an e2e check with a measured budget, in both locales.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 4).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/fe-z3`, at the integrated `HEAD`.
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
- **Your harness ports are 28950–28999 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full product e2e is **not** required here (it takes about 1.6 h per locale); the orchestrator runs it on the merged tree. Run every spec your change touches (at least the connector, operations and a02 demo specs) in `chromium-en` and `chromium-ar`, and report the counts. Use `apps/web/e2e/support/with-stack.sh` for the product specs and `e2e/support/with-demo-stack.sh` for a02.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-FE-Z3-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-FE-Z3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
