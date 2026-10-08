# Assignment T-DG3-FE-C: business cases and the T09 benefit-formula builder (frontend-ux-engineer)

## Stage and context

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-c` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`. That HEAD contains:
  - ARCH-01/02/03;
  - BE-A, BE-B, BE-C, BE-D;
  - KBE-A, KBE-B, KBE-C;
  - FE-A0 (the web seams and the G1 agreements step).

  Every P3 API except BE-E's capacity, funding and G4 operations is live in this tree. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** three other implementers run at the same time in their own worktrees: BE-E (`apps/api/**`), FE-A (portfolio, readiness, dispensations, G4) and FE-B (prioritization, roadmap, dependencies, capacity). You touch only the files listed under "Own" below.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start and at the end. Build the screens in the order given. If you pass about 100 minutes, finish the current screen, make the tree typecheck and lint, and write the handback listing what remains.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports:** 23600–23649 only, for `QA_PG_PORT`, the API and web ports of `apps/web/e2e/support/with-stack.sh`, and any listener.
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
- **`docs/architecture/p3-work-split.md`:** §4 (FE shared rules and **your section, FE-C**) and §9.
- **ADRs:** ADR-0009; ADR-0024 (§1 the ten sections, §2 single-class lines, §3 the roll-up, §5 Finance validation and Stale, §6 the formula engine, the variable kinds, fraction vs percentage points, the confirmed engine details including the display-suffix rule, the two examples).
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

- `apps/web/src/pages/business-cases/**`, `pages/benefit-formulas/**`. Your API hooks go in `pages/<feature>/api.ts`.
- `i18n/{en,ar}/{businessCases,benefitFormulas}.json`.
- Your tests, and `apps/web/e2e/p3-business-cases.spec.ts`.

Your handback and evidence under `docs/delivery/handbacks/DG3/`.

**Never touch:**
- `apps/api/**`, `apps/worker/**`, `packages/**`;
- the rest of `docs/**`;
- `apps/web/src/app/**`, `apps/web/src/api/**`, `apps/web/src/i18n/index.ts`;
- other tasks' page folders and namespaces;
- any `package.json` dependency.

If you need a seam change, describe it in the handback.

## Scope (in this order)

1. **Business cases** (`BusinessCasesPage`, `BusinessCasePage`) (REQ-PB-053/054, REQ-S05-005).
   - The transformation case with all **ten source sections**. Initiative cases are lighter and link to it.
   - **Lines with exactly one class.** The investment classes are capex, opex, internal FTE, vendor cost and opportunity cost. The benefit classes are revenue, cost reduction, cost avoidance, working capital and strategic/non-financial.
   - Amounts are SAR decimals, and the currency is configurable.
   - **Totals.** Gross benefits, implementation cost and net value are shown separately; net is Unknown without both sides. The roll-up counts each distinct line once.
2. **Finance validation of the baseline** (REQ-PB-055). It is a business approval held by FIN; the author can't validate. The state shows Validated, Rejected or **Stale** after a baseline edit, never green when stale.
3. **Benefit formulas** (`BenefitFormulasPage`, `BenefitFormulaPage`) (REQ-PB-056/057, REQ-S08-007).
   - **The T09 register's six columns,** with Confidence H/M/L.
   - **The formula builder.** It uses `@mth/shared/calc` `validateFormula` and `evaluateFormula` for a live parse, type check and preview while typing, with the error position and the translated message. An undefined variable or a period mismatch shows before saving.
   - **Typed variables** have a kind, a unit, a currency and a period. A fraction is entered as a percent and stored as a fraction. A fraction_delta shows **percentage points**, with the suffix from `displayNumber` translated by i18next.
   - **The two B0087 examples,** marked "Illustrative calculation, synthetic values". Instantiate them, and show their previews: **100000 SAR** and **500000 SAR** per year.
   - Versions, preview calculations with their lineage, and **Finance validation of each version** (business approval, never the author).

## Acceptance (your self-check, with real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts and your new web tests, with stubbed API responses, covering EN and AR.
3. **Your e2e spec,** `apps/web/e2e/p3-business-cases.spec.ts`, passes on the real stack (`apps/web/e2e/support/with-stack.sh`, your ports, `--workers=1`):
   - in **chromium-en and chromium-ar**;
   - once with the locale unset and once with `C.UTF-8`;
   - including an AUD read-only pass and an axe check of each new screen with 0 serious or critical issues.

   Save EN and AR screenshots of each screen as `apps/web/e2e/screenshots/{en,ar}/p3-business-*.png`. Flows that need BE-E (capacity, funding, G4) are tested with stubbed responses in unit tests here. Their live e2e comes in the next wave; list them in the handback.
4. The existing product e2e still passes in both projects: `journeys.spec.ts`, `p2-journeys.spec.ts`, `session-end.spec.ts`, `p2-blank-text.spec.ts`.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed test or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-C-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-C-evidence/`. Include:
- the files changed;
- the screens and the requirement each one satisfies, quoting the acceptance texts;
- the checks with exit codes, including the e2e counts per project and setting;
- any seam or contract mismatch you hit;
- anything left undone.
