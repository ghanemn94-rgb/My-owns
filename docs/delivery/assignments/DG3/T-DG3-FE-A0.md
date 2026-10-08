# Assignment T-DG3-FE-A0: P3 frontend seams and the G1 agreements step (frontend-ux-engineer)

## Stage and context

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-a0` at the integrated `HEAD`: ARCH-01/02, wave 1 (BE-A, KBE-A) and wave 2 (BE-B, BE-C, BE-D, KBE-B), merged and verified. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** two other implementers run in parallel in their own worktrees: ARCH-03 (contract, ADRs, `packages/**` and `apps/api/**` follow-ups) and KBE-C (`apps/api/src/modules/kpi/**`, `packages/shared/src/schemas/benefit-formula.ts`). You touch only `apps/web/**` and your handback.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Why this task exists.** FE-A, FE-B and FE-C build the P3 screens in parallel next, in separate worktrees. They must never edit the same file. This task creates every shared seam they need first, so that each later task only fills in its own files. It also restores the one DG2 web flow that P3 changed: G1 approval now needs the three leadership confirmations (REQ-PB-022, ADR-0021 §8), so the gate decision dialog must send them.
- **Time:** aim for about 30–45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports:** 23500–23549 only. Use them for `QA_PG_PORT`, the API and web ports of `apps/web/e2e/support/with-stack.sh`, and any listener.
- The write guard applies.

## Binding design (read first)

- **`docs/architecture/p3-work-split.md`:** §4 (FE shared rules, and the FE-A/FE-B/FE-C ownership) and §9.
- **ADR-0009** (frontend) and **ADR-0021 §8** (the G1 `agreements` contract, its 422 codes and the exact detail text).
- **`docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md` §9:** the e2e test that approves G1 through the UI.
- **The DG2 web rules, binding:**
  - RecordForm and the hand-written-form blank rules: one form-level alert, in one live region, with axe-clean banners;
  - session-bound actions through `apps/web/src/auth/sessionBound.ts` (ESLint forbids raw `navigate` and direct `setQueryData`);
  - render-time translation;
  - AR-RTL and EN-LTR;
  - Unknown/Stale never shown as 0 or green;
  - AUD sees read-only views;
  - "business approval" labels, never DG0–DG7;
  - `#0078FF` stays provisional.

## Scope (in this order)

### 1. G1 agreements step (REQ-PB-022)

In the existing gate decision dialog (`apps/web/src/pages/gates/**`):

- When the gate is **G1** and the outcome is **approve**, show three required confirmations: problem, baseline, material value pools.
  - Each is a labelled checkbox, bilingual, with the B0032 wording made clear.
  - Approval sends `agreements: {problem: true, baseline: true, materialValuePools: true}`.
  - Approval is impossible until all three are ticked.
- For any other gate or outcome, send no `agreements`.
- Show the server's 422 `gate.g1_agreements_required` (with its pointers) and `gate.agreements_not_applicable` as the dialog's one form-level alert, translated.
- Add the i18n keys to `i18n/{en,ar}/gates.json`.
- **Tests:**
  - unit tests in EN and AR;
  - update `apps/web/e2e/p2-journeys.spec.ts`, test "Gates: the approver's decision — 409 when the submission was superseded, then approval with a rationale", so the G1 approval ticks the three confirmations;
  - check every other product e2e test for a G1 approval through the UI.

### 2. Router and nav seams

**Routes.** In `app/router.tsx`, add every P3 route, each importing a page component from a **fixed path and export name**:

| Path (under the `/` shell) | Component file | Export | Owner that fills it |
|---|---|---|---|
| `transformations/:id/portfolio` | `pages/portfolio/PortfolioPage.tsx` | `PortfolioPage` | FE-A |
| `transformations/:id/initiatives/:initiativeId` | `pages/portfolio/InitiativePage.tsx` | `InitiativePage` | FE-A |
| `transformations/:id/readiness` | `pages/readiness/ReadinessPage.tsx` | `ReadinessPage` | FE-A |
| `transformations/:id/dispensations` | `pages/dispensations/DispensationsPage.tsx` | `DispensationsPage` | FE-A |
| `transformations/:id/prioritization` | `pages/prioritization/PrioritizationPage.tsx` | `PrioritizationPage` | FE-B |
| `transformations/:id/roadmap` | `pages/roadmap/RoadmapPage.tsx` | `RoadmapPage` | FE-B |
| `transformations/:id/dependencies` | `pages/dependencies/DependenciesPage.tsx` | `DependenciesPage` | FE-B |
| `transformations/:id/capacity` | `pages/capacity/CapacityPage.tsx` | `CapacityPage` | FE-B |
| `transformations/:id/business-cases` | `pages/business-cases/BusinessCasesPage.tsx` | `BusinessCasesPage` | FE-C |
| `transformations/:id/business-cases/:businessCaseId` | `pages/business-cases/BusinessCasePage.tsx` | `BusinessCasePage` | FE-C |
| `transformations/:id/benefit-formulas` | `pages/benefit-formulas/BenefitFormulasPage.tsx` | `BenefitFormulasPage` | FE-C |
| `transformations/:id/benefit-formulas/:formulaId` | `pages/benefit-formulas/BenefitFormulaPage.tsx` | `BenefitFormulaPage` | FE-C |

**Stub pages.** Create each page file as a **minimal stub**: a bilingual page title from the page's own namespace, plus an honest "being built in this stage" state from `components/States.tsx`. The owning task replaces the stub. Do not build the screens.

**Navigation.**

- Add the workspace tabs for these pages to the transformation workspace.
- Update the nav areas `initiatives` ("Initiatives and Roadmaps") and `benefits` ("Benefits and Finance") from `planned` to `partial`, with `workspaceTab` entries the way `strategy`/`tom`/`governance` work today. Extend the `workspaceTab` union as needed.
- Keep the existing tests green and update the nav/app tests that pin these values.

### 3. i18n seams

1. Create `i18n/{en,ar}/{portfolio,readiness,dispensations,prioritization,roadmap,dependencies,capacity,businessCases,benefitFormulas}.json`. Each holds only the keys your stubs and tabs use, with identical key sets in EN and AR (`i18n.test.ts`).
2. Register all nine namespaces in `i18n/index.ts`.
3. Each later task owns its own namespace files and adds its keys there. `gates.json` stays FE-A's after you. `glossary.test.ts` rules apply.

### 4. API seams

- In `api/types.ts`, add the P3 portfolio response types from BE-A's zod mirrors (`@mth/shared/schemas` `portfolio.ts`).
- In `api/queries.ts`, add the query-key factory for P3. It must include `["roadmap", transformationId]`, the one cache entry the roadmap timeline, table and board share (ADR-0023 §3).
- **FE-B and FE-C will not edit `api/**`.** They put their hooks in `pages/<feature>/api.ts` and use `api/client.ts` read-only. So `client.ts` must export everything they need: the request helper with If-Match/ETag, the problem parsing and the session-bound mutation helper. If it already does, say so in the handback and change nothing. If it doesn't, add the missing exports now.

## Do not touch

- `apps/api/**`, `apps/worker/**`, `packages/**`.
- `docs/**`, except your handback and its evidence.
- Any `package.json` dependency.

## Acceptance (your self-check, with real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`.
3. The product e2e passes in **chromium-en and chromium-ar** on the real stack (`apps/web/e2e/support/with-stack.sh`, your ports, `--workers=1`). Run it twice, once per locale setting:
   - `p2-journeys.spec.ts` in full, including the updated G1 approval;
   - `journeys.spec.ts`;
   - `session-end.spec.ts`;
   - `p2-blank-text.spec.ts`.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed test or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-A0-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-A0-evidence/`. Include:

- the files changed;
- the seam table, with exact paths, exports, namespaces and query keys;
- what `client.ts` exports for FE-B and FE-C;
- the checks with exit codes, including the e2e counts per project and setting.
