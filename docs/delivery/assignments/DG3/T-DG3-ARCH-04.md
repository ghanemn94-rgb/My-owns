# Assignment T-DG3-ARCH-04: P3 ADR conformance follow-ups from wave 4 (solution-architect)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg3/arch-04`, at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`. That HEAD has every P3 implementation task merged and verified: all 270 contract operations are routed, and FE-A/B/C are in (wave 4, merged and verified). Work only in this tree.
- **Concurrency (D-004):** FE-E runs alongside you in its own worktree and owns `apps/web/**` additions (funding, capacity, deliverable/milestone/wave UI, audit labels). Don't touch `apps/web/**`.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - **Your harness ports are 23700–23749 only.**
  - The write guard applies.
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run the tests. They are harness artifacts.

## Why

Two places where the implementation departs from your own ADRs. Reviewers compare the code against the ADRs, so each one must match.

## Scope

### 1. The rounding record on the lineage row (ADR-0024 §6 item 11)

**The problem.** The ADR says KBE-C stores the engine's full `rounding` object in the `benefit_calculation` lineage as it is. The code stores only `rounded boolean` on the row, and the full object only in the row's audit event (`docs/delivery/handbacks/DG3/T-DG3-KBE-C-kpi-benefits-engineer.md` §6 item 2).

**Make the row hold it:**

1. **Migration.** Add `packages/db/migrations/0027_p3_calculation_rounding.sql`, forward-only.
   - Add a `rounding jsonb` column to `benefit_calculation`, with a `jsonb_typeof = 'object'` CHECK. It is NULL only for rows written before this migration; say so in the migration comment.
   - The table is append-only, so add the column without a backfill. Decide whether a backfill from the audit events is safe and needed for existing rows, and explain the decision. A fresh database has none.
   - Update `packages/db/src/schema.ts` and `catalogue.test.ts`.
2. **Contract.** Add `rounding` to the `BenefitCalculation` schema in `docs/api/openapi.yaml` as an additive property, and to the shared zod mirror (`packages/shared/src/schemas/benefit-formula.ts`).
3. **Code.** Make `apps/api/src/modules/kpi/calculations.ts` write the object and return it.
4. **Test.** An integration test asserts that the row and the response carry `{column, scale, mode, precision, exact, stored, rounded, inexactIntermediate}` for the revenue example.
5. **Gates.** `pnpm openapi:lint` and the contract test must pass. Report any pinned-count change; adding a property should change none.

### 2. ADR-0021 §7, the G4 refusal shape (BE-E handback §7 item 6)

**The problem.** The ADR says `errors[]` has "one entry per missing item". The engine (DG2-approved `submitGate`) emits one entry per incomplete criterion and joins that criterion's messages, which keeps G1–G3 byte-stable. The per-item list with pointers is in the gate view's `criteria[].missing`.

**Decide, record the decision in ADR-0021 §7, and make the code and ADR agree.** Either:

- **(a)** align the ADR text with the implemented shape, stating where the per-item list lives and that every label still appears literally in the 422; or
- **(b)** change G4 (only G4) to one entry per missing item, keep G1–G3 byte-stable, and test both.

Prefer (a) unless you find a requirement that needs (b).

### 3. Record every other wave-4 interpretation that reviewers will meet

- **BE-E §7** goes in ADR-0023 §6/§7 and ADR-0021 §7:
  - the deselect rule (deselecting voids funding; re-selection needs a new decision);
  - its new codes and texts;
  - commit authority through `capacity.commit`;
  - Unknown capacity counts as a G4 conflict;
  - `g4.initiative_card_incomplete`;
  - the G4 roadmap reading.
- **The FE-A, FE-B and FE-C handbacks** (`docs/delivery/handbacks/DG3/T-DG3-FE-{A,B,C}-frontend-ux-engineer.md`): record any contract or seam mismatch they report, and fix the contract if one is genuinely wrong. In particular:
  - FE-B §4.2: there is no shared zod mirror for `RoadmapWave`, `RoadmapView`, `T08Dependency`, `DependencyType`, `ResourceRole`, `CapacityPlan(Cell)` or `ResourceDemand`. Add them to `@mth/shared/schemas`, so the API seams and the web can use one definition. Do not change web files; the web keeps its read-only views until a later task switches.
  - FE-A §5.3: the unpaged list endpoints refuse `limit`. Confirm that this is the contract's intent, and record it.
- **`docs/architecture/p3-work-split.md` §9:** add the wave-4 amendments, namely BE-E's out-of-ownership edits to `gates.ts`, `workflows.test.ts` and `repository.ts`.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, these all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`.
3. `QA_PG_PORT=<23700-23749> MTH_PORT_POOL=<the rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Migrations `0001`→`0027` apply on a fresh database. Report the counts.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-ARCH-04-solution-architect.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-ARCH-04-evidence/`. Include:

- each decision and where it now lives;
- the files changed;
- the checks with exit codes.
