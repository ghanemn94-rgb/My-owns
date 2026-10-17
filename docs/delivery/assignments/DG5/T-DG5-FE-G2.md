# Assignment T-DG5-FE-G2: P5 implementation, p5-work-split §A and §I (this is a **repair task**, D-163: your screens are the shell navigation, the Studio's element editor and badge, the navigation token and the snapshot page; the Added scope below is binding) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-g2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W18 tasks run at the same time (BE-N2, KBE-D3, BE-C3, FE-C2, FE-G2), each in its own worktree; no architecture task runs. W1–W17 are merged (D-163). The failing QA tests named in your Added scope were written by the independent QA authoring tasks: make them pass by fixing the product, never by editing them. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §A and §I (this is a **repair task**, D-163: your screens are the shell navigation, the Studio's element editor and badge, the navigation token and the snapshot page; the Added scope below is binding). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Frontend rules:** every string in en and ar (RTL); accessible labels and keyboard use (axe clean, scroll regions focusable); Unknown/Stale never shown as zero or green; server errors shown by their code, with the en/ar text of every problem code your screens can receive (add missing keys to `problems.json` and check for duplicates). Register routes and navigation entries with appended lines only. When your screens ship a feature that a nav, landing or admin string calls "Planned" or "not available yet", correct that string and its chip in both languages (F-DG4-160).
- **e2e:** add Playwright coverage of each screen's main path and its main refusal. Run the full web e2e suite (`apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1`) with your ports, and report its counts.
- **Evidence size (D-162):** commit the screenshots of your own specs and of any failure you cite only. Never commit a full-suite screenshot or trace folder.
- **Added scope 1 (D-163, FE-G handback §6.1, option (a)): the shell takes its areas from `GET /me/navigation` (REQ-S03-007, ADR-0049 §9).**
  - Re-apply FE-G's reverted switch: `visibleAreaIds(useMyNavigation().data)` filters `NAV_AREAS` in `Shell.tsx`, plus its unit test. FE-G handback §6.1 describes it; `app/me-navigation.ts` may need restoring.
  - While the call is pending, show no area list (never all areas). On an error, show the error state.
  - **Update the two DG1 journey pins** in `apps/web/e2e/journeys.spec.ts`:
    - the Transformation Office (`dev.office`) sees 14 areas, including Administration (line 206–208);
    - the technical administrator (`dev.admin`, ADM_ACCESS + ADM_TECH, no `transformation.read`) sees My Work, Playbook and Administration (line 415), and the administration journey still reaches its screens.
    - Update the comments to say why (D-163).
  - **New e2e, in en and ar (the literal acceptance):** "an ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration".
    - Create synthetic users through the access API (as the existing e2e helpers do).
    - One user holds the union of the role defaults (ADR-0049 §9, last paragraph) and sees all 14 areas.
    - One user is a Workstream Lead (role `WL`) and sees no Administration.
  - Run the full web e2e suite. Any other spec that relied on `dev.admin` seeing business areas is yours to adjust, with the reason.
- **Added scope 2 (D-163; REQ-S15-004): the navigation colour follows `brand.primary`.**
  - The acceptance: "changing brand.primary in Branding Settings changes the navigation colour…".
  - Today `nav.background` resolves to `brand.deep`.
  - **Rule (decided by D-163):** derive the navigation background from `brand.primary`:
    - Use `brand.primary` itself when white navigation text reaches at least 4.5:1 against it (WCAG 2.1 relative luminance). Otherwise darken it deterministically (lightness steps in a stated colour space) until it does.
    - Implement the derivation once in `packages/design-tokens`, with unit tests for the default `#0078FF`, a light colour (`#FFD700`) and `#003B73`.
    - Keep `pnpm --filter @mth/design-tokens run check:contrast` exiting 0 and report its output.
    - The tokens stay marked provisional, and no text claims official Mobily colours.
  - **e2e:** change `brand.primary` in Branding Settings and assert that the navigation background changes (computed style), then restore the setting so later specs see the default.
- **Added scope 3 (D-163; F-DG5-QA-A-3): sequential and parallel approval routes in the Studio.**
  - `pages/studio/ElementsSection.tsx:38` lets an `approver_route` edit only a single `approverRoleCode`, and line 110 deletes `approverRoleCodes`.
  - Add an editor for the ordered `approverRoleCodes` list and the `mode` (`sequential` | `parallel`), as the element's schema and ADR-0044 define them. Server refusals (for example an ADM role as approver) are shown by their code.
  - Unit tests, and an e2e in en and ar that configures a two-step sequential route in a draft and sees it in the preview.
- **Added scope 4 (D-163; REQ-PB-002):** the provenance badge ("custom extension (playbook v1.0)") on the Studio's element views, using FE-G's `ProvenanceBadge`, in en and ar, with a unit test. No element is labelled a PMI standard.
- **Added scope 5 (D-163; QA-C O1, Low):** on the snapshot page in Arabic, the SHA-256 checksum overflows its card, and the source-records table shows raw codes (`register`, `raid_entry`).
  - Wrap or truncate the checksum as an LTR run, with the full value available.
  - Show translated record-type labels in en and ar.
- **Ownership:**
  - `app/Shell.tsx`, `app/me-navigation.ts`, `app/nav.ts` (filter only);
  - `pages/studio/**`, the snapshot page under `pages/reports/**`;
  - the navigation token derivation in `packages/design-tokens/**`;
  - `apps/web/e2e/journeys.spec.ts` (the two pins);
  - new e2e specs of your own;
  - i18n keys, with appended lines.
- **Concurrent owners, do not edit:**
  - FE-C2 edits `components/form-framework/**` and the T02–T16 form pages.
  - Do not edit root `e2e/**` or `tests/qa/**`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24000–24049 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-G2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-G2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
