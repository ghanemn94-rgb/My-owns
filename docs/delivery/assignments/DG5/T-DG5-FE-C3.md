# Assignment T-DG5-FE-C3: P5 implementation, p5-work-split §B (this is a **repair task**, D-164: the separable second half of T-DG5-FE-C2; your screens are the remaining forms that host `components/form-framework/**`; the Added scope below is binding) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-c3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W19 tasks run at the same time (QA-B, QA-E, QA-F and FE-C3), each in its own worktree; no architecture task runs. W1–W18 are merged and verified (D-164). The QA tasks write only new files under tests/qa/** and root e2e/** (QA-B may also edit e2e/a03-modular-entry.spec.ts and e2e/a06-configuration-change.spec.ts, as its scope says); give your files names that start with your scenario id so they never collide. Stay strictly inside your file ownership. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §B (this is a **repair task**, D-164: the separable second half of T-DG5-FE-C2; your screens are the remaining forms that host `components/form-framework/**`; the Added scope below is binding). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Frontend rules:** every string in en and ar (RTL); accessible labels and keyboard use (axe clean, scroll regions focusable); Unknown/Stale never shown as zero or green; server errors shown by their code, with the en/ar text of every problem code your screens can receive (add missing keys to `problems.json` and check for duplicates). Register routes and navigation entries with appended lines only. When your screens ship a feature that a nav, landing or admin string calls "Planned" or "not available yet", correct that string and its chip in both languages (F-DG4-160).
- **e2e:** add Playwright coverage of each screen's main path and its main refusal, and run your own specs plus the specs of every page you touch (D-164: the full web e2e suite runs once on the merged tree in the orchestrator's verification).
- **Evidence size (D-162):** commit the screenshots of your own specs and of any failure you cite only. Never commit a full-suite screenshot or trace folder.
- **Load rule (D-164).** W18 showed that five concurrent full runs exhaust this 15 GB host: `tsc` was OOM-killed and Vitest forks were killed. Run:
  - `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time;
  - the `unit-web` Vitest project in both locales (`npx vitest run --project unit-web`), never in parallel with another heavy run;
  - your own and the touched pages' e2e specs.

  The full `pnpm test`, `pnpm test:integration` and the full web e2e suite are run once on the merged tree by the orchestrator. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-164; the separable second half of T-DG5-FE-C2, F-DG5-QA-A-2):** host the extension-field entry and display on the remaining record types that `listFormRecordTypes` marks as accepting custom fields. Use FE-C2's framework pieces (`useExtensionCreate`, `RecordExtensionTools`, `extensionToolsColumn`) and the same hosting lines as FE-C2's handback §1:
  - the eleven extension record types of ADR-0041 §1 with a web form or record view: evidence, baseline, value pool, resource plan, funding approval, change request, meeting record, corrective plan, lesson, BAU handover, control;
  - `charter`, `tom_canvas` and `business_case`;
  - the T01 fill (create) dialog;
  - T06: a create path if the scorecard has one; otherwise state why entry stays through Form tools after the score is saved.

  Report a table: record type → screen → done or not, with the reason for each "not".
- **Added scope 2:** unit tests for the T05 and T06 form-header question tags (REQ-PB-011), which FE-C2 left untested for want of fixtures.
- **Added scope 3 (only if the orchestrator's W18 verification lists it as failing):** `apps/web/src/pages/raid/raid.test.tsx` › "action register: source, follow-up date and overdue flag; edit sends If-Match". It failed intermittently in four W18 tasks under load.
  - Find the cause: a fixed fixture date against the real clock, or a wait.
  - Fix the test's determinism (inject the clock, or use an explicit wait), without weakening its assertions.
  - If the cause is in the product, fix the product and say so.
- **Ownership:**
  - the hosting lines and header lines on the pages above, named per file in the handback;
  - `components/form-framework/**` (additive only);
  - `apps/web/src/pages/raid/raid.test.tsx` for scope 3;
  - your own new e2e specs;
  - i18n keys, as appended lines.
- **Concurrent owners:** three QA tasks write only `tests/qa/**`, root `e2e/**` and their evidence folders.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23750–23799 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. `npx vitest run --project unit-web` passes with the locale unset and with `C.UTF-8` (D-164 load rule). Report the counts. The repository-wide `pnpm test` is not yours to run; report it as "not run, D-164".
3. Your own e2e specs, and the existing specs of every page you touch, pass in chromium-en and chromium-ar (`apps/web/e2e/support/with-stack.sh npx playwright test <paths> --workers=1`). `pnpm test:integration` and the full e2e suite are not yours to run (D-164); report them as "not run, D-164".
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-C3-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-C3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
