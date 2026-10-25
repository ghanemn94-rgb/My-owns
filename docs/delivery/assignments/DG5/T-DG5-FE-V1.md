# Assignment T-DG5-FE-V1: DG5 round-1 repair (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 on candidate `sha256:8e7d23a3…` (D-170).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-v1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four repair tasks run at the same time (D-170): T-DG5-BE-V1, T-DG5-BE-V2, T-DG5-BE-V3 and T-DG5-FE-V1, each in its own worktree, at the round-1 candidate's tree plus the round-1 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-140** (Medium; REQ-PB-093; reported by qa-verifier in `docs/delivery/reviews/DG5/round-1/qa-verifier.json`): The Studio 'T06 scoring defaults' screen (/admin/studio/scoring-defaults) does not reflow: page-level horizontal scroll at 390 px (en, 49 px) and with 200 % text (en 130 px, ar 16 px), because the rubric <fieldset>s keep the browser default min-inline-size: min-content.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-unset/en/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-unset/ar/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-cutf8/en/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-cutf8/ar/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-unset/en/r1c-390-_admin_studio_scoring_defaults.png`, `docs/delivery/test-evidence/DG5/qa/round-1/05-e2e-probe-demo-unset.log`.
- **F-DG5-141** (Medium; REQ-S02-001; reported by qa-verifier in `docs/delivery/reviews/DG5/round-1/qa-verifier.json`): The Source coverage screen (/admin/source-coverage) has a serious axe violation at 390 px in en and ar: 'scrollable-region-focusable' on the coverage table's .table-wrap, which is not keyboard-focusable (no tabIndex/role/label, unlike 51 other table wraps).
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-unset/en/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-unset/ar/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-cutf8/en/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-cutf8/ar/reflow-results.json`, `docs/delivery/test-evidence/DG5/qa/round-1/shots/probe-demo-unset/en/r1c-390-_admin_source_coverage.png`, `docs/delivery/test-evidence/DG5/qa/round-1/05-e2e-probe-demo-unset.log`.
- **F-DG5-121** (Low; REQ-DLV-037; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-1/domain-reviewer.json`): The serial p2-journeys 'Define -> G2' journey needs 25-37 s against its 30 s limit, so it times out under review load and hides the AUD journey after it.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/domain/round-1/e2e-p2-journeys-cutf8.log`, `docs/delivery/test-evidence/DG5/domain/round-1/e2e-p2-journeys-cutf8-run2.log`, `docs/delivery/test-evidence/DG5/domain/round-1/e2e-p2-journeys-cutf8-run3.log`, `docs/delivery/test-evidence/DG5/domain/round-1/e2e-p2-journeys-cutf8-run4-timeout60s.log`, `docs/delivery/test-evidence/DG5/domain/round-1/e2e-p2-journeys-run4-load.log`, `docs/delivery/test-evidence/DG5/domain/round-1/p2-journeys-run2-failure/error-context-en.md`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-170** in `docs/delivery/decisions.md`. Read D-170 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-170):**
  - **F-DG5-140, the scoring defaults screen reflows** (`/admin/studio/scoring-defaults`). At 390 px and with 200 % text, in en and ar, there is no page-level horizontal scroll. The rubric fieldsets must not keep the browser default `min-inline-size: min-content`, and wide rubric tables scroll inside their own focusable, named `.table-wrap`, as on the other screens. Use the shared styles, not a page-specific hack, if the same fieldset pattern is used elsewhere.
  - **F-DG5-141, the source coverage table is keyboard-reachable** (`/admin/source-coverage`). Its scrollable `.table-wrap` is focusable and named (`tabIndex=0`, `role="region"` and a localized accessible name), like the other 51 table wraps. Axe reports no serious or critical violation at 390 px, 1366 px and with 200 % text, in en and ar. Check every other P5 screen's scrollable regions for the same pattern and fix them in the shared component if it is shared.
  - **The regression spec.** Add one P5 reflow and axe spec under `apps/web/e2e/`. It visits every P5 screen of the 31 the QA probe listed (`docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/` is the probe; read it, do not import it) at 390 px and with 200 % text, in chromium-en and chromium-ar. It asserts no page-level horizontal scroll and no serious or critical axe violation, and it names each failing screen.
  - **F-DG5-121, the p2-journeys budget** (`apps/web/e2e/p2-journeys.spec.ts`). The serial journeys whose unloaded duration leaves less than half of the 30 s default as headroom ('Define -> G2 …' at 25–28 s unloaded and 37 s under load; check the others in the file) get an explicit `test.setTimeout(…)`, as the P5 journeys do, sized from the measured durations with at least 2× headroom. Do not change what they assert. This is a test-reliability repair, not a product change.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-170 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**` (the scoring-defaults and source-coverage screens, the shared table-wrap and form styles they use, the new e2e spec, and `apps/web/e2e/p2-journeys.spec.ts`).
- **Concurrent owners:** T-DG5-BE-V1, BE-V2 and BE-V3 edit `apps/api/**`, `packages/db/**` and migration `0097`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23150–23199 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. The `unit-web` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. Your new spec and `apps/web/e2e/p2-journeys.spec.ts`, `apps/web/e2e/p5-*.spec.ts` pass on the real stack, once, `--workers=1`, in chromium-en and chromium-ar: `E2E_PG_PORT=<port> E2E_API_PORT=<port> MTH_PORT_POOL=<rest> apps/web/e2e/support/with-stack.sh npx playwright test <paths> --workers=1`. Keep only your own specs' screenshots (D-162). Report the counts and the durations of the p2 journeys.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-V1-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-V1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R4);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
