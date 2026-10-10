# Assignment T-DG4-FE-R2: route-level code splitting of the web app, measured before and after (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R4, T-DG4-KBE-R4, T-DG4-QA-C and T-DG4-FE-R2 run in their own worktrees; none owns your files. Everything through W17 (ARCH-R3, FE-F2, FE-G2, QA-B) is merged (D-090 to D-114).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It gives your file ownership and what to prove. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope (this assignment replaces a work-split section; D-111)

**The problem.**
- The web app ships one `index` chunk with no route-level code splitting: `apps/web/src/app/router.tsx` has no `lazy`.
- Every FE task has grown it. At W14 it was 1,787,510 bytes, and it is larger now. Every page load and every new browser context parses all of it.
- Under machine load, the long e2e journeys approach the 30 s test limit. "Define → G2" takes 19.5 s with no load and 26–32 s under load (D-111, D-112).

**Do this:**
1. **Measure first, on your base, and keep the logs:**
   - the size of every file in `apps/web/dist/assets/` after `pnpm --filter @mth/web build`;
   - the time of "Define → G2" in `apps/web/e2e/p2-journeys.spec.ts`, alone, chromium-en, three runs.
2. **Split by route.** Load every page component of `router.tsx` with `React.lazy` and dynamic `import()`. Use one shared `Suspense` fallback that is:
   - bilingual and accessible (`role="status"`, a translated label);
   - free of layout jumps;
   - never mistakable for data (no 0 and no green while loading).
   Keep the shell, auth and error boundaries eager. The vendor chunks stay as configured. No CDN and no remote loading: every chunk is served by the app itself.
3. **Translations:** if the i18n resources are a large share of the main chunk, report their size. Do **not** change how i18n loads in this task; note it as a possible follow-up.
4. **Keep behaviour identical:**
   - every route, guard, redirect, title and focus behaviour;
   - the planned-route tests;
   - `session-identity.test.tsx` (FE-R1's race fix depends on the redirect timing; re-run it 20× under parallel load and keep the log).
   Adjust a unit test only if it renders a lazy page synchronously, and then only to await it. List each such test.
5. **Measure again,** exactly as in step 1. Report:
   - the main chunk before and after;
   - the number of chunks;
   - the three "Define → G2" times before and after.
   No timeout is raised anywhere.

**File ownership:** `apps/web/src/app/router.tsx` (FE-A's file, assigned to you for this repair), one new fallback component under `apps/web/src/components/`, its EN/AR keys (append-only), and the tests that must await a lazy page.

- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 25900–25949 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in both Vitest invocations. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. The product e2e suite (`apps/web/e2e`, real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) passes in chromium-en and chromium-ar, including your new specs, with axe reporting 0 serious or critical issues. Report the counts per spec.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
