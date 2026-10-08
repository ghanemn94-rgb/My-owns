# Assignment T-DG3-FE-A: portfolio, initiative card, readiness, dispensations, outcome hierarchy and the G4 view (frontend-ux-engineer)

## Stage and context

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-a` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`. That HEAD contains:
  - ARCH-01/02/03;
  - BE-A, BE-B, BE-C, BE-D;
  - KBE-A, KBE-B, KBE-C;
  - FE-A0 (the web seams and the G1 agreements step).

  Every P3 API except BE-E's capacity, funding and G4 operations is live in this tree. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** three other implementers run at the same time in their own worktrees: BE-E (`apps/api/**`), FE-B (prioritization, roadmap, dependencies, capacity) and FE-C (business cases, benefit formulas). You touch only the files listed under "Own" below.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start and at the end. Build the screens in the order given. If you pass about 100 minutes, finish the current screen, make the tree typecheck and lint, and write the handback listing what remains.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports:** 23500–23549 only, for `QA_PG_PORT`, the API and web ports of `apps/web/e2e/support/with-stack.sh`, and any listener.
- The write guard applies.
- If your shell leaves empty `.claude/.cc-writes` directories inside source folders, remove them before you run the tests. They are harness artifacts.

## Binding design (read first)

- **`docs/delivery/handbacks/DG3/T-DG3-FE-A0-frontend-ux-engineer.md`:** the seam table: your page files and their exports, your i18n namespaces, the query keys, and what `api/client.ts` exports for you. **Replace the stub page files you own; never rename them or change their exports.**
- **FE-A0 seams (its handback §3–§5):**
  - Page files and exports are fixed.
  - The namespaces are camelCase where they have two words: `businessCases`, `benefitFormulas`. Remove the `stub.*` keys when you replace a stub.
  - The query keys are `p3Keys` in `api/queries.ts`, including the single `["roadmap", tid]` entry.
  - After a mutation, call `useP3Refresh(tid)`: `if (!(await refresh())) return;`.
  - Use `apiRequest`, `ApiError` and `useVersionedSave` as they are. Translate problem messages with `errorMessage` and `fieldErrorMessage(s)` from `lib/problem.ts`.
  - **Import the session-bound helpers directly from `apps/web/src/auth/sessionBound.ts`, not through `api/client.ts`.** FE-A removes the re-export that created the `client.ts` ↔ `sessionBound.ts` import cycle.
- **`docs/architecture/p3-work-split.md`:** §4 (FE shared rules and **your section, FE-A**) and §9.
- **ADRs:** ADR-0009; ADR-0021 (§2 the T05 fields and links, §3 transitions and their exact 422 texts, §5 dispensations, §6 business approvals, §7 the G4 criteria and labels, §8 G1, §9 readiness).
- **The contract,** `docs/api/openapi.yaml`, and the zod mirrors in `@mth/shared/schemas`. The approval UIs offer no "on behalf of" control (ADR-0021 §6, ARCH-03). The arithmetic and formula engine are in `@mth/shared/calc`. Never re-implement them.
- **The DG2 web rules, binding.** Reviewers test every one:
  - **Bilingual.** AR-RTL and EN-LTR for every string, through i18next in your own namespaces, translated at render time. Problem `code`s are translated in the UI. The English server `detail` is never shown raw to an Arabic user.
  - **Forms.** RecordForm and the hand-written-form blank rules: one form-level alert in one live region, inline field errors with pointers, axe-clean banners.
  - **Navigation and cache.** Session-bound actions go through `apps/web/src/auth/sessionBound.ts`. ESLint forbids raw `navigate` and direct `setQueryData`.
  - **Decimals.** Amounts, scores, weights and FTE are decimal strings, formatted with `formatDecimal` (`@mth/shared/schemas`) and `@mth/shared/calc`. Never use `Number()` or `parseFloat` on them. A chart may convert a decimal to a pixel coordinate with `new Decimal(x).toNumber()` only for drawing; its labels show the decimal string.
  - **Unknown and Stale.** They are shown as Unknown or Stale, never as 0 or green.
  - **Read-only auditor.** AUD sees read-only views with no enabled write control. The server still answers 403; the UI only reflects it.
  - **Labels.** Every selection, funding, weight-set, override, dispensation and G4 action is labelled "business approval". Never mention DG0–DG7. `#0078FF` stays provisional, with no official Mobily logo or colour.
  - **Conflicts.** `If-Match` on every edit. A 409 shows the standard conflict banner and reloads.

## Own (write)

- `apps/web/src/pages/portfolio/**`, `pages/readiness/**`, `pages/dispensations/**`.
- `apps/web/src/api/**`.
- `apps/web/src/lib/auditChanges.ts` and its test, and the audit keys in `i18n/{en,ar}/transformations.json`.
- The G4 additions in `pages/gates/**`.
- `i18n/{en,ar}/{portfolio,readiness,dispensations}.json`, and your keys in `i18n/{en,ar}/gates.json`.
- Your tests, and `apps/web/e2e/p3-portfolio.spec.ts`.

Your handback and evidence under `docs/delivery/handbacks/DG3/`.

**Never touch:**
- `apps/api/**`, `apps/worker/**`, `packages/**`;
- the rest of `docs/**`;
- `apps/web/src/app/**` and `apps/web/src/i18n/index.ts` (the seams are complete);
- other tasks' page folders and namespaces;
- any `package.json` dependency.

If you need a seam change, describe it in the handback.

## Scope (in this order)

1. **Portfolio** (`PortfolioPage`). The initiative list shows:
   - code, name, wave, owners;
   - **three separate columns: Proposed rank, Selection and Funding**. Funding shows Funded, **'Selected - unfunded'** or — (REQ-S09-003);
   - warnings: deliverable count, no gap link, no owner.

   A create form makes a draft, which is allowed at any time. Filters cover status and wave.
2. **Initiative card** (`InitiativePage`). It holds:
   - **all 14 T05 fields** (REQ-PB-045), with the **3–7 deliverables warning** (a warning, not a block);
   - **gap links** to T03 gaps or diagnostic findings. Any other TOM record shows the translated 'A project portfolio is not a Target Operating Model…' message (REQ-PB-040);
   - **outcome contributions.** An outcome is required, the KPI is optional, and both have the right labels (REQ-PB-032);
   - **decision links**;
   - **transitions:** submit, withdraw, select, deselect, launch, cancel. Each has its reason or rationale dialog. Select and deselect carry "business approval" labels. Every 422 is shown translated as the dialog's one alert:
     - 'Case for change not yet approved (G1)…';
     - 'Outcome before activity…' (REQ-PB-006);
     - 'North Star, outcomes and target state not yet approved' (REQ-PB-004);
     - 'Selected - unfunded: a funding approval is required before launch'.
   - links to its milestones and deliverables on the roadmap.
3. **Outcome hierarchy.** A read-only five-level tree from `GET …/outcome-hierarchy`: North Star → outcome → KPI → target → initiative contribution. Unknown targets show as Unknown (REQ-PB-032). Put it as a section or tab of the portfolio page.
4. **Readiness** (`ReadinessPage`) (REQ-PB-007). It shows:
   - `missingDiagnosticAreas`, with labels for economics, customer, operations, capability and technology;
   - the G1–G4 status, with inherited approvals shown as "pending verification" until they count;
   - the sequencing blockers, translated.
5. **Dispensations** (`DispensationsPage`). Waivers need a reason, a scope and an expiry. Inherited approvals need an approving body, a date and evidence; until the evidence is verified they show as unverified.
   - Accept, reject and revoke are business approvals. The recorder can never decide.
   - A delegated decision gets the translated 422 (or follows ARCH-03's delegation rule; read its handback).
0. **Seam clean-up, first.** You own `api/**`.
   - Remove the `sessionBound` re-export from `api/client.ts`, so the `client.ts` ↔ `auth/sessionBound.ts` import cycle disappears. Update any importer to use `auth/sessionBound.ts` directly.
   - Translate the **P3 audit events** on the transformation audit trail (`lib/auditChanges.ts`, the audit keys in `i18n/{en,ar}/transformations.json`; FE-A0 started this). Cover every P3 record type and action that can appear there: initiative, links, selection, funding decision, weight set, score, ranking, override, wave, deliverable, milestone, dependency, dependency type, capacity, resource demand, business case and line, benefit formula, version and calculation, dispensation, and gate agreement. `journeys.spec.ts` fails on any untranslated field or action.

   These two files are yours for this task.
6. **G4 view** (`pages/gates/**`). The eight `g4.*` criteria with their missing items, labelled exactly as the server returns them ('Owners', 'Finance validation', initiative names). A refused submission shows the 422 list, and the decision 403/409 messages are translated.
   - BE-E ships the evaluators in parallel. Test this view with stubbed responses now. Its live e2e is the next wave.

## Acceptance (your self-check, with real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts and your new web tests, with stubbed API responses, covering EN and AR.
3. **Your e2e spec,** `apps/web/e2e/p3-portfolio.spec.ts`, passes on the real stack (`apps/web/e2e/support/with-stack.sh`, your ports, `--workers=1`):
   - in **chromium-en and chromium-ar**;
   - once with the locale unset and once with `C.UTF-8`;
   - including an AUD read-only pass and an axe check of each new screen with 0 serious or critical issues.

   Save EN and AR screenshots of each screen as `apps/web/e2e/screenshots/{en,ar}/p3-portfolio-*.png`. Flows that need BE-E (capacity, funding, G4) are tested with stubbed responses in unit tests here. Their live e2e comes in the next wave; list them in the handback.
4. The existing product e2e still passes in both projects: `journeys.spec.ts`, `p2-journeys.spec.ts`, `session-end.spec.ts`, `p2-blank-text.spec.ts`.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed test or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-A-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-A-evidence/`. Include:
- the files changed;
- the screens and the requirement each one satisfies, quoting the acceptance texts;
- the checks with exit codes, including the e2e counts per project and setting;
- any seam or contract mismatch you hit;
- anything left undone.
