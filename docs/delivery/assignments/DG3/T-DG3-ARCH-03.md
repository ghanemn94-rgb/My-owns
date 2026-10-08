# Assignment T-DG3-ARCH-03: P3 architecture follow-ups from wave 2 (solution-architect)

## Stage and base

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg3/arch-03`, at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`. That HEAD already contains ARCH-01/02, wave 1 (BE-A, KBE-A) and wave 2 (BE-B, BE-C, BE-D, KBE-B), merged and verified. Work only in this tree.
- **Concurrency (D-004):** two implementers run alongside you in their own worktrees.
  - **KBE-C** owns:
    - `apps/api/src/modules/kpi/**` (its benefit-formula, formula-version, calculation and p3-gate-facts files, plus registration and export lines);
    - `kpi.test.ts` pins;
    - `packages/shared/src/schemas/benefit-formula.ts`, with **its own** export line in `schemas/index.ts`.
  - **FE-A0** owns `apps/web/**`.

  Do not edit their files. You will both add one export line to `packages/shared/src/schemas/index.ts`; that is expected, and the orchestrator merges the two lines.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** aim for about 45–60 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline. **Your harness ports are 23750–23799 only.** The write guard applies. If your shell leaves empty `.claude/.cc-writes` directories inside source folders, remove them before you run the unit suite. They are harness artifacts, not project files.

## Inputs

Read §6–§7 of each wave-2 handback in `docs/delivery/handbacks/DG3/`:

- `T-DG3-BE-B-backend-workflow-engineer.md` §7;
- `T-DG3-BE-C-backend-workflow-engineer.md` §7;
- `T-DG3-BE-D-backend-workflow-engineer.md` §6–§7;
- `T-DG3-KBE-B-kpi-benefits-engineer.md` §6–§7.

The orchestrator already integrated two one-line items. Read them, but do not redo them:

- `@mth/shared/calc` was added to `SHARED_ALLOWED` in `apps/api/src/architecture.testkit.ts`;
- `workflows.test.ts` allows `GET /api/v1/dependency-types` as `authenticated`.

## Scope (in this order)

### 1. Contract: `getPrioritization` (BE-D §6.2)

- Add the `funding` query parameter (enum `not_applicable | unfunded | funded | revoked`) and the `"422": BusinessRule` response (`prioritization.portfolio_too_large`) to `getPrioritization` in `docs/api/openapi.yaml`.
- Keep every other path byte-stable. `pnpm openapi:lint` must pass.
- Then exercise both through HTTP in `apps/api/test/integration/contract/p3-exercises-be-d.ts`: a `funding=` filter request, and a 422 above 500 initiatives if it's feasible within the seam's limits. If it isn't, use a direct call and say why.

### 2. Advisory-lock registry (collision)

- **The collision:** BE-D (`portfolio/scores.ts`, prioritization writes) and BE-C (`workflows/dependency-types.ts`, type-code creation) both use lock class **730222** for different resources.
- Give dependency-type creation its own class, e.g. **730223**, exported as a named constant.
- Record one registry of every advisory-lock class in the ADRs: 730219 BU hierarchy, 730220 outcome, 730221 dependency graph, 730222 prioritization, 730223 dependency type. Pick one home, ADR-0016 or ADR-0023, and point to it from the other.
- Add a unit test asserting that the class constants are distinct.

### 3. Shared prioritization schemas (BE-D §6.4)

- Move BE-D's prioritization zod mirrors out of its route files into a new `packages/shared/src/schemas/prioritization.ts`, so FE-B can import them from `@mth/shared/schemas`. The mirrors include `weightSet`, `initiativeScore`, `scoreResult`, `rankingEntry` and `rankingOverride`.
- Add your export line to `schemas/index.ts`.
- Update BE-D's route files and `p3-exercises-be-d.ts` to import from there. Use decimal strings, never `number`, for weights and scores.

### 4. One cycle-problem class (BE-C §7.4)

- Export `DependencyCycleProblem` from the platform module's public interface (`platform/index.ts`).
- Make `workflows/t08-dependencies.ts` use it, including the `name`s, and delete the duplicate `T08CycleProblem`.
- The 422 body must stay byte-identical. Prove it with the existing T08 tests.

### 5. Business-approval delegation: one consistent rule

- **Today the rule differs by action:**
  - selection (`portfolio.select`, BE-B) allows one-hop delegation;
  - dispensation decisions (BE-A) refuse it with 422 `dispensation.on_behalf_not_supported`;
  - ranking-override and weight-set decisions (BE-D) refuse it with 422 `prioritization.on_behalf_not_supported`;
  - gate decisions (ADR-0015) allow it.
- **Decide one rule for all P3 business approvals and record it** in ADR-0021 §6:
  - selection;
  - funding (BE-E will implement it);
  - weight-set approval;
  - override decisions;
  - dispensations.
- Make the minimal code change so every P3 action follows it, and test the change. If the rule is "refused", selection changes, which BE-B estimated at three lines in `selections.ts`. If it is "allowed", the other tasks' 422s become the ADR-0015 delegation path, and you implement it.

### 6. ADR alignment (record what was built and decide the open points)

- **ADR-0021 §2:** the `archived_*` columns on `initiative` don't exist (BE-B §7.3). State the actual rule: no DELETE, `cancelled` is the terminal retirement, and cancelled or completed initiatives and their links are read-only.
- **ADR-0022:** record BE-D's design choices (§7):
  - the new problem codes and their English texts;
  - "ranked but now incomplete keeps `ranked`";
  - scoring a draft is allowed;
  - the prioritization lock.
- **ADR-0023:**
  - `GET /dependency-types` is `authenticated`: a global catalogue read with no 403 in the contract.
  - `varianceDays` is in calendar days. REQ-S09-007's working-day slip waits for the business calendar of a later stage (BE-C §7.2); state that, and don't relabel the field.
  - The `T08ScheduleFlagsProvider` decoration seam (BE-C §7.5): confirm it, or switch to explicit injection.
- **ADR-0024:** record KBE-B's interpretations and texts (§7):
  - the roll-up set counts for the transformation case's "≥ 1 line";
  - net is Unknown without both sides;
  - the baseline author is `created_by`;
  - `rejected` stays `rejected`.
- Update `docs/architecture/p3-work-split.md` §9 with the decisions above. Also record that **BE-E consolidates the three initiative presenters**: BE-B's `presentInitiatives` (`repository.ts`), and the local ones in BE-C's `roadmap.ts` and BE-D's view. The single presenter is BE-B's.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`.
3. `QA_PG_PORT=<23750-23799> MTH_PORT_POOL=<the rest of your range> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-ARCH-03-solution-architect.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-ARCH-03-evidence/`. Include:

- each decision and where it now lives;
- the files changed;
- the checks with exit codes;
- what BE-E and FE-B must know.
