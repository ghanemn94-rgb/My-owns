# Assignment T-DG6-DO-Y2: DG6 round-1 repair: full-dataset export-start re-measurement (F-DG6-147, D-207) and configuration doc drift (devops-engineer)


## What to change (read first)

Read D-207 in `docs/delivery/decisions.md`, finding **F-DG6-147** in `docs/delivery/findings.json` with its sidecar under `docs/delivery/reviews/DG6/round-1/`, and the handbacks `docs/delivery/handbacks/DG6/T-DG6-BE-Y4-backend-workflow-engineer.md` and `T-DG6-BE-Y5-backend-workflow-engineer.md` (with their evidence folders).

1. **Re-measure (D-207, your item).** On this merged tree (BE-Y5's asynchronous live-export assembly is merged), measure **50 simultaneous export starts on the full load dataset** (the DO-G/DO-H dataset, from the shipped `deploy/load/generate.mjs`), with `EXPORT_RATE_LIMIT_PER_MINUTE` set high (for example 100000) so the rate limit does not decide the result. Reuse the existing drivers (`deploy/load/export-proof.mjs`, and BE-Y4's `export-start-measure.sh` / `export-burst.mjs` if part B still cannot form its pairs). Report p50/p95/max start latency, the count over 2 s, the time until every job reaches `succeeded`, the download check for requester-only access, the host load average during each run, and every non-zero exit. State plainly whether the acceptance text of the rows F-DG6-147 cites is met. Sandbox figures are provisional, not Mobily capacity.
2. **Load drivers.** Make the shipped load scripts set `EXPORT_RATE_LIMIT_PER_MINUTE` (and any other P6 rate-limit class that would otherwise decide a load result) to a high value by default, documented in `deploy/load/README` (or its existing doc), so a future run measures the product and not the limiter.
3. **Doc drift (BE-Y4 handback).** `docs/operations/configuration.md` still says the search, assistant and webhook rate-limit classes are "none yet" and that the Security page is "planned". Correct it to what the merged code ships (read the rate-limit wiring and the web routes; quote file paths). Fix any en/ar user-facing string that says the same, or list it for its owner.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 1).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/do-y2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG6-DO-Y2 and T-DG6-ARCH-12 run at the same time in their own worktrees. Touch only what your repair needs.
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
- **Your harness ports are 28500–28549 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over 2 hours on this host); the orchestrator runs it on the merged tree. Run the integration files your change touches, if any, inside `tests/qa/support/with-pg.sh`, and report their counts.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-DO-Y2-devops-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
