# Assignment T-DG3-BE-G: pre-freeze test depth and any FE-D backend defects (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING), the last implementation step before the candidate freezes.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/be-g`, at the integrated `HEAD`, which contains every P3 task through wave 6 (FE-D, BE-F, AN-P3). `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** FE-F (`apps/web/src/pages/gates/**` and a new e2e spec) and the transformation-analyst (`docs/delivery/requirements.csv`) run alongside you.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 30–45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - **Your harness ports are 23100–23149 only.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## Scope

1. **REQ-PB-032, test depth** (AN-P3 handback §5 O-1).
   - **The gap.** The acceptance reads "tree nodes for all five levels persist and link; an initiative contribution without an outcome link is rejected". Today no API test asserts the full nested shape of `GET /transformations/{id}/outcome-hierarchy`.
   - **The test.** Add an integration test that builds one world, with synthetic data, containing:
     - the North Star;
     - one outcome;
     - one outcome KPI with a target value and a target date;
     - one initiative contribution to that KPI;
     - one contribution with no KPI.
   - **What it asserts,** field by field:
     - North Star → `outcomes[]` → `kpis[]`, with `targetValue` as a decimal string and `targetDate`;
     - `kpis[].contributions[]`, and the outcome-level contributions without a KPI;
     - that an unset target is null (Unknown), never 0;
     - that a contribution without an outcome is rejected (400 at `/outcomeId`).
   - Put it with BE-A's hierarchy tests or in a new file under `apps/api/test/integration/portfolio/`.
2. **Backend defects FE-D reported** (`docs/delivery/handbacks/DG3/T-DG3-FE-D-frontend-ux-engineer.md` §5). FE-D reproduced **no** backend defect. Its §5 item 1, the G4 refusal shape, is handled on the web side by FE-F, keeping the DG2-approved server shape (ADR-0021 §7). Its §5 item 2 is an observation about the seeded roles, not a defect. So this item needs no change unless you find a real defect while doing item 1.
   - For each one: reproduce it, fix it minimally, and add a test that fails before the fix and passes after.
   - If FE-D reported none, say so and do nothing for this item.
   - A contract change needs the solution-architect. Stop and describe it in the handback rather than editing the contract.

## Rules (binding)

The work split §2 shared rules and ADR-0021 §10 apply.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes in both locale settings.
3. `QA_PG_PORT=<23100-23149> MTH_PORT_POOL=<the rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-G-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-G-evidence/`.
