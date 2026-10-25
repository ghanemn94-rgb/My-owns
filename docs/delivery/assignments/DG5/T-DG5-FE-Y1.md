# Assignment T-DG5-FE-Y1: DG5 round-3 repair (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 3 on candidate `sha256:fc93b239…` (D-174).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-y1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three repair tasks run at the same time (D-174): T-DG5-BE-Y1, T-DG5-BE-Y2 and T-DG5-FE-Y1, each in its own worktree, at the round-3 candidate's tree plus the round-3 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-144** (Medium; REQ-S15-009; reported by qa-verifier in `docs/delivery/reviews/DG5/round-3/qa-verifier.json`): The Diagnose screen (/transformations/<id>/diagnose) scrolls horizontally at page level at 390 px (433 px en, 394 px ar) and with 200 % text (830 px en, 731 px ar): the six workstream cards of the .workstreams grid share one auto track that grows to the widest card's min-content (794 px at 390 px), so every card runs off the viewport.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/tests/round-3/e2e/zz-qa-dg5r3-diagnose-reflow.spec.ts`, `docs/delivery/test-evidence/DG5/qa/round-3/05-e2e-probe-r3diag-cutf8.log`, `docs/delivery/test-evidence/DG5/qa/round-3/shots/probe-r3diag-cutf8/en/r3-diag-diagnose.json`, `docs/delivery/test-evidence/DG5/qa/round-3/shots/probe-r3diag-cutf8/ar/r3-diag-diagnose.json`, `docs/delivery/test-evidence/DG5/qa/round-3/shots/probe-r3diag-cutf8/en/r3-diag-diagnose-390.png`, `docs/delivery/test-evidence/DG5/qa/round-3/shots/probe-r3diag-cutf8/ar/r3-diag-diagnose-390.png`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-174** in `docs/delivery/decisions.md`. Read D-174 verbatim (and D-172, D-173 for the wave-X repairs it builds on); the scope below restates it.

## Binding scope

- **Decided (D-174): the Diagnose screen reflows at 390 px and with 200 % text.**
  - `/transformations/<id>/diagnose` scrolls horizontally at page level: 433 px (en) and 394 px (ar) at 390 px; 830 px (en) and 731 px (ar) with 200 % text.
    - The cause: `.workstreams` (`apps/web/src/styles/app.css`, 'Diagnose') is a grid with one `auto` track. The widest workstream card's min-content (the Customer workstream's findings register, 794 px) therefore sizes the track and every card.
    - The stylesheet already intends a wide register to scroll inside its card (`.page > *, .section > *, .workstream > * { min-inline-size: 0; }`). But the grid items themselves and the track are not constrained, and qa showed that `min-inline-size: 0` on the cards alone does not remove the overflow.
  - **The fix:**
    - the track no longer grows to its items' min-content (for example `grid-template-columns: minmax(0, 1fr)`), and the cards are shrinkable;
    - each wide register then scrolls inside its own focusable, named region (FE-X1's `TableScrollRegion`);
    - nothing else on the page changes, in en and ar.
  - **The same pattern elsewhere.** Check every other `display: grid` or flex container in `apps/web/src/styles/app.css` whose items can hold a register or a wide table, on any screen. Fix each one that can overflow in the same way, and list every container you checked in the handback, with the result.
  - **The regression test.** Use qa's reproduction (`docs/delivery/test-evidence/DG5/qa/tests/round-3/e2e/zz-qa-dg5r3-diagnose-reflow.spec.ts`; read it, do not import it). Add a product e2e assertion that opens the Diagnose screen on demo data (`e2e/support/with-demo-stack.sh`, as `roaming.user.tl`):
    - at 390 x 900, and at 1280 x 900 with the root font at 200 %;
    - in chromium-en and chromium-ar;
    - it asserts `document.documentElement.scrollWidth - innerWidth <= 1` and that every `article.workstream` fits the viewport.
    Extend `apps/web/e2e/p5-table-regions-axe.spec.ts` or `apps/web/e2e/p5-reflow-axe.spec.ts`, or add one spec, and record its failing output before the fix.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-174 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 4.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**`: `apps/web/src/styles/app.css` (the Diagnose rules and any other container you fix), the Diagnose page component only if markup must change, and the e2e spec you extend or add.
- **Concurrent owners:** T-DG5-BE-Y1 edits `packages/db/src/demo/**` and the demo tests; T-DG5-BE-Y2 edits `apps/api/src/architecture.test.ts` and `architecture.testkit.ts`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23100–23149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared with two other tasks. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
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
3. Your new or extended spec, `apps/web/e2e/p5-table-regions-axe.spec.ts` and `apps/web/e2e/p5-reflow-axe.spec.ts`, and `apps/web/e2e/p2-journeys.spec.ts` (the Diagnose journeys), pass on the real stack (demo data where the spec uses it), `--workers=1`, in chromium-en and chromium-ar, in both locale settings. Report the counts. Keep only your own specs' screenshots (D-162).
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-Y1-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-Y1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R6);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
