# Assignment T-DG3-FE-B: prioritization, roadmap (timeline, table and board), dependencies and capacity (frontend-ux-engineer)

## Stage and context

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-b` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`. That HEAD contains:
  - ARCH-01/02/03;
  - BE-A, BE-B, BE-C, BE-D;
  - KBE-A, KBE-B, KBE-C;
  - FE-A0 (the web seams and the G1 agreements step).

  Every P3 API except BE-E's capacity, funding and G4 operations is live in this tree. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** three other implementers run at the same time in their own worktrees: BE-E (`apps/api/**`), FE-A (portfolio, readiness, dispensations, G4) and FE-C (business cases, benefit formulas). You touch only the files listed under "Own" below.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start and at the end. Build the screens in the order given. If you pass about 100 minutes, finish the current screen, make the tree typecheck and lint, and write the handback listing what remains.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports:** 23550–23599 only, for `QA_PG_PORT`, the API and web ports of `apps/web/e2e/support/with-stack.sh`, and any listener.
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
- **`docs/architecture/p3-work-split.md`:** §4 (FE shared rules and **your section, FE-B**) and §9.
- **ADRs:** ADR-0009; ADR-0022 (weight sets, scores, 'incomplete', the 0–100 view and its label, rankings and cause labels, overrides, the comparison view); ADR-0023 (§1 waves verbatim, §2 milestones and deliverables, §3 one read model for timeline, table and board, §4 T08, §5 the cycle message and schedule flags, §6 capacity and the conflict rule).
- **The contract,** `docs/api/openapi.yaml`, and the zod mirrors in `@mth/shared/schemas`. Since ARCH-03, these include **all prioritization schemas** (`weightSet*`, `initiativeScore*`, `scoreResult`, `rankingEntry`, `rankingSnapshot*`, `rankingChange`, `rankingHistoryPage`, `rankingOverride*`, `approvalDecision`, `prioritizationItem`/`View`/`Query`, `criterionCode`, `RANKING_CAUSES`). Import them; never define copies. A portfolio above 500 eligible initiatives is a 422 error state, not an empty table. The approval UIs offer no "on behalf of" control (ADR-0021 §6). Read `docs/delivery/handbacks/DG3/T-DG3-ARCH-03-solution-architect.md` §6. The arithmetic and formula engine are in `@mth/shared/calc`. Never re-implement them.
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

- `apps/web/src/pages/prioritization/**`, `pages/roadmap/**`, `pages/dependencies/**`, `pages/capacity/**`. Your API hooks go in `pages/<feature>/api.ts`.
- `i18n/{en,ar}/{prioritization,roadmap,dependencies,capacity}.json`.
- Your tests, and `apps/web/e2e/p3-prioritization-roadmap.spec.ts`.

Your handback and evidence under `docs/delivery/handbacks/DG3/`.

**Never touch:**
- `apps/api/**`, `apps/worker/**`, `packages/**`;
- the rest of `docs/**`;
- `apps/web/src/app/**`, `apps/web/src/api/**`, `apps/web/src/i18n/index.ts`;
- other tasks' page folders and namespaces;
- any `package.json` dependency.

If you need a seam change, describe it in the handback.

## Scope (in this order)

1. **Prioritization** (`PrioritizationPage`).
   - **Scorecard per initiative.** The 1–5 inputs reject 6. The weighted score is read-only, and a missing score shows **'incomplete'**, never a number (REQ-PB-047/048).
   - **Weight sets.** Propose with a live 100% check, so 95% or 105% shows the error. Approve and withdraw are business approvals; the approver is never the proposer. Version history (REQ-PB-049).
   - **Ranked table** with filters, and the **value/feasibility chart** (accessible, with a table alternative) (REQ-S09-004).
   - **The 0–100 view.** A toggle showing 57.5 for 3.30, with the conversion label (REQ-S09-001).
   - **Ranking snapshots and history.** Translated cause labels, including **'weight version 2'** (REQ-S09-005).
   - **Overrides.** A reason is required (REQ-S09-005). Propose, decide and revoke; decide and revoke are business approvals.
2. **Roadmap** (`RoadmapPage`) (REQ-PB-050, REQ-S09-006).
   - The four source waves show verbatim, in EN and in provisional AR. Overlapping horizons display.
   - **The timeline, the initiative table and the work board all read the single `["roadmap", id]` cache entry.** Moving a milestone (`PATCH` forecast with `If-Match`) updates all three, through one invalidation via `sessionBound`.
   - A 409 shows the conflict banner.
   - Approve-date, with a reason on re-approval, and deliverable acceptance.
   - Schedule flags. Unknown is shown as Unknown.
   - No critical-path highlighting (ADR-0023 §5).
3. **Dependencies** (`DependenciesPage`) (REQ-PB-051/052, REQ-S09-008).
   - The seven T08 columns. From can be an initiative or External.
   - Types: the system types are undeletable, and an admin can configure the others.
   - **A cycle shows the translated message with the path**, e.g. INI-01 → INI-02 → INI-03 → INI-01.
   - The needed-by conflict flag.
4. **Capacity** (`CapacityPage`) (REQ-PB-059, REQ-S09-004). A role × month grid of decimal FTE, with the conflict indicator and its shortfall, and Unknown capacity shown as Unknown. Demand commit and release.
   - BE-E ships this API in parallel. Test it with stubbed responses now. Its live e2e is the next wave.

## Acceptance (your self-check, with real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts and your new web tests, with stubbed API responses, covering EN and AR.
3. **Your e2e spec,** `apps/web/e2e/p3-prioritization-roadmap.spec.ts`, passes on the real stack (`apps/web/e2e/support/with-stack.sh`, your ports, `--workers=1`):
   - in **chromium-en and chromium-ar**;
   - once with the locale unset and once with `C.UTF-8`;
   - including an AUD read-only pass and an axe check of each new screen with 0 serious or critical issues.

   Save EN and AR screenshots of each screen as `apps/web/e2e/screenshots/{en,ar}/p3-prioritization-*.png`. Flows that need BE-E (capacity, funding, G4) are tested with stubbed responses in unit tests here. Their live e2e comes in the next wave; list them in the handback.
4. The existing product e2e still passes in both projects: `journeys.spec.ts`, `p2-journeys.spec.ts`, `session-end.spec.ts`, `p2-blank-text.spec.ts`.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed test or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-B-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-B-evidence/`. Include:
- the files changed;
- the screens and the requirement each one satisfies, quoting the acceptance texts;
- the checks with exit codes, including the e2e counts per project and setting;
- any seam or contract mismatch you hit;
- anything left undone.
