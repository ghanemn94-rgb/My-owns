# Assignment T-DG6-DO-A2: P6 implementation, p6-work-split D-199 (DO-A2 scope below) (devops-engineer)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/do-a2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG6-ARCH-05 runs in the main checkout (slice D and the D-199 ADR amendments); T-DG6-BE-C, T-DG6-BE-F2 and T-DG6-DO-A2 run in their own worktrees (W5). Stay strictly inside your file ownership. DO-A2 alone changes package manifests and the lockfile.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your scope (D-199; read it verbatim, and T-DG6-DO-A's handback §0 and evidence):** upgrade the shipped packages with High advisories — `fastify` ≥ 5.12.2, `@fastify/static` ≥ 10.1.1 (a major upgrade: read its changelog and adapt the registration in `apps/api`), `kysely` ≥ 0.28.17, `zod` ≥ 4.6.6, `react-router` ≥ 7.18.0, `image-size` ≥ 2.0.3 through a pnpm override (verify that `pptxgenjs` still produces valid PPTX with images: the existing PPTX export tests must pass, and add one that embeds a PNG and a JPEG) — and the dev toolchain (`vitest` ≥ 3.2.6, `tinypool`, `vite`). Add `@aws-sdk/client-s3@3.1156.0` and `nodemailer@10.2.1`, exact-pinned (ADR-0001 `save-exact`), in the packages ADR-0054 names (D-197). Then `node licenses/generate-sbom.mjs` and `node deploy/scripts/dep-audit.mjs --refresh`, and show `node deploy/scripts/dep-audit.mjs` and `pnpm audit --audit-level high --prod` with no High or Critical on shipped packages. Read each upgraded package's release notes for breaking changes between the locked and the new version, and list what you checked.
- **Registry access:** the registry is reachable through the egress proxy (DO-A §0 explains the `noproxy` override). Fetching packages is allowed for this task only.
- **Ownership:** every `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`/overrides, `licenses/**`, `deploy/**` audit data, and the minimal code adaptations the upgrades require (each listed in the handback with its reason). No feature work.
- **Acceptance extra:** the full product e2e (`apps/web/e2e`, both locale settings) and the root and demo suites pass after the upgrade; report the counts.
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
- **Your harness ports are 23900–23949 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG6/T-DG6-DO-A2-devops-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-DO-A2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
