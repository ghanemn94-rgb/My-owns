# Assignment T-DG4-FE-R11: DG4 round-9 audit finding repair (F-DG4-160)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after the round-9 audit).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r11`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** you run alone. Read D-137 first; it decides this repair. Your files: `apps/web/src/i18n/**` and the web tests that pin the strings you change (`apps/web/src/**/*.test.tsx`, `apps/web/e2e/**`). Nothing else.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** about 45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090, D-117 and D-131 to D-137 in `docs/delivery/decisions.md`. Read them verbatim.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: finding F-DG4-160 (Low, user-facing text), per D-137

- **The finding is binding.** Read it in `docs/delivery/reviews/DG4/round-9/release-auditor.findings.json` (reproduction, expected, actual), its evidence `docs/delivery/test-evidence/DG4/audit/round-9/12-new-finding-stale-g6-hint.log`, and D-137.
- **The product behaviour is not changed.** Only user-facing text and the tests that pin it change. No test is skipped and no assertion is weakened.

1. **F-DG4-160.** `transformations.form.statusHint` (EN and AR, `apps/web/src/i18n/{en,ar}/transformations.json:88`) tells the user that the G6 (Sustain) approval 'is available in a later release'. DG4 delivers G6 and governed closure (route `transformations/:id/closure`, `ClosurePage`).
   - Reword it in EN and AR. Keep the explanation of the offered transitions. Say that a transformation is closed from its Closure page, once the G6 (Sustain) business approval and the closure conditions are met. Match the closure page's own wording (`closureP4.json`) and the glossary.
   - Arabic: Modern Standard Arabic, consistent with the existing AR strings for G6, closure and the Closure page. Keep the existing provisional-Arabic labelling convention where it applies.
   - Update `apps/web/src/pages/transformations/transformations.test.tsx` (around lines 315–321 and 350) so it pins the corrected sentence in **both** EN and AR.
2. **The same defect class: sweep every other 'later release' string.** These also say a feature is not yet available:
   - `gates.json` `notEnabledBody`;
   - `transformations.json` `laterStage`;
   - `nav.json` `plannedBody` and `portfolioPlanned`;
   - `admin.json` `plannedSections`;
   - in both EN and AR, plus anything a case-insensitive search for 'later release', 'later stage', 'not available yet', 'coming soon', 'إصدار لاحق' and 'غير متاح بعد' finds in `apps/web/src`.

   For each one, find where it renders and under what condition, and decide against the DG4 build (the DG4 rows of `docs/delivery/requirements.csv` and the router). If the string can be shown for a feature DG4 delivers, correct it the same way and pin it in a test. If it is true (the feature is genuinely later, for example a DG5/DG6 scope, or the string is unreachable for delivered features), leave it and give the reason. List every string in the handback with its decision and evidence (file:line of the render site and the condition).
3. **Bilingual check:** render the edit page in EN (LTR) and AR (RTL) through the unit test or the e2e, and show the new hint in both.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26200–26249 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The integration suite is not required: the change is web text only and touches no API, contract or schema. Say so if that holds; if it does not, run it (`QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`) and report the counts.
4. The product e2e specs that cover the transformation edit page and any screen whose string you change (real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) pass in chromium-en and chromium-ar, with axe reporting 0 serious or critical issues. Report the counts per spec. Name the specs you ran and why they are the right ones.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R11-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R11-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the sweep table of item 2;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
