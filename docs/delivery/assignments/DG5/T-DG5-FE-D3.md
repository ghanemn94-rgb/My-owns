# Assignment T-DG5-FE-D3: P5 implementation, p5-work-split §D (this is a **repair task**, D-164 and D-165: your screens are the automation builder, the snapshot page banner, the twelve FE-C3 hosts' tests and the failure queue; the Added scope below is binding) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-d3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W20 tasks run at the same time (BE-C4, BE-T3, KBE-D4 and FE-D3), each in its own worktree; no architecture task runs. W1–W19 are merged and verified (D-165). The failing QA tests named in your Added scope were written by independent QA authoring tasks: make them pass by fixing the product, never by editing them (you may not edit tests/qa/** or root e2e/**). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §D (this is a **repair task**, D-164 and D-165: your screens are the automation builder, the snapshot page banner, the twelve FE-C3 hosts' tests and the failure queue; the Added scope below is binding). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Frontend rules:** every string in en and ar (RTL); accessible labels and keyboard use (axe clean, scroll regions focusable); Unknown/Stale never shown as zero or green; server errors shown by their code, with the en/ar text of every problem code your screens can receive (add missing keys to `problems.json` and check for duplicates). Register routes and navigation entries with appended lines only. When your screens ship a feature that a nav, landing or admin string calls "Planned" or "not available yet", correct that string and its chip in both languages (F-DG4-160).
- **e2e:** add Playwright coverage of each screen's main path and its main refusal; run your own specs and those of the pages you touch.
- **Evidence size (D-162):** commit the screenshots of your own specs and of any failure you cite only. Never commit a full-suite screenshot or trace folder.
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-164 d; BE-C3 handback §5.2): the dry-run builder pre-fills a valid sample.**
  - `apps/web/src/pages/automation/RulePage.tsx` (~460–465) builds the sample from `conditionFields` only. The server refuses that sample for outbox-schema events such as `gate.submitted` (422 `automation.dry_run_sample_invalid`).
  - Use the trigger's `samplePayload`, which BE-C4 adds to `AutomationTrigger` in this wave (optional object; its `transformationId` is the placeholder `00000000-0000-7000-8000-000000000000`). Replace `transformationId` with the transformation the builder has selected, when it has one.
  - Fall back to today's template when `samplePayload` is absent.
  - Keep the hint `workflowsP5.dryRun.payloadHint` true in en and ar.
  - **Tests:** a unit test with a stubbed catalogue; an e2e in en and ar where the pre-filled `gate.submitted` sample gives a successful dry run, if the stack has a transformation to select.
- **Added scope 2 (D-165; QA-B P-2, Medium, accessibility AA): contrast of the banner link.**
  - On a superseded snapshot page (en), the link "Open the current issue" (`<a class="link">` inside `.banner--info`) has 4.22:1 (`#006de9` on `#e8f1fc`), below 4.5:1. In ar the same page passed axe.
  - Find why the colours differ by language, fix the token or style so every banner link reaches 4.5:1 in both languages, and keep `pnpm --filter @mth/design-tokens run check:contrast` at exit 0. Add the pair to the contrast check if it is a token pair.
  - `e2e/a07-historical-integrity.spec.ts` must pass unchanged in both projects.
- **Added scope 3 (D-165; FE-C3 handback §9.3):** the twelve new extension-field hosts that FE-C3 typechecked but did not test get one unit test each. Each test asserts that the extension input renders in the create form and the record view, and that saving sends the custom-fields write with `If-Match`.
- **Added scope 4 (D-165; QA-F P-4, Low):** in the automation failure queue at 1280 px, the Status and Actions columns are reachable only by horizontal scrolling. Keep them visible: a sticky actions column or a narrower layout. Keep the region focusable.
- **Added scope 5 (D-165): `apps/web/e2e/p5-launch-health-kpi.spec.ts` waits for the rows.**
  - In the W19 verification it failed once in chromium-en at `expect(await window2.count()).toBeGreaterThan(0)` (line 68). The count runs right after `[data-start-date]` appears, without waiting for the task rows to render. It passed alone 6/6.
  - Wait for the first row (`await expect(window2.first()).toBeVisible()`) before counting. Keep every assertion. Check the same pattern elsewhere in the spec.
- **Ownership:** `apps/web/src/pages/automation/**`, the snapshot page and banner styles (`pages/reports/**`, the banner CSS), `packages/design-tokens/**` (only if the fix is a token), the test files of the twelve hosts, `apps/web/e2e/p5-launch-health-kpi.spec.ts`, your own e2e specs, and i18n keys as appended lines.
- **Concurrent owners:** BE-C4 and KBE-D4 edit `apps/api/**` and `packages/db/**`; the two analysts edit `docs/delivery/requirements.csv`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23950–23999 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. The Vitest projects your change reaches pass with the locale unset and with `C.UTF-8`, run one at a time (D-164 load rule). Report the commands and counts. The repository-wide `pnpm test` is not yours to run; report it as "not run, D-164".
3. The integration directories and files your change reaches, including the QA files named in your Added scope, pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts and any pinned-count change. `pnpm test:integration` and the full e2e suite are not yours to run (D-164).
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-D3-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-D3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
