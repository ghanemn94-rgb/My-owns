# Assignment T-DG3-BE-C: roadmap waves, deliverables, milestones, the roadmap read model and T08 dependencies (backend-workflow-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (the runner's `--cwd`), on branch `dg3/be-c` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`, which already contains ARCH-01, BE-A and KBE-A. `node_modules` is installed and the packages are built. Work only in this tree: the sandbox makes every other tree read-only.
- **Concurrency (D-004):** up to three other implementers run at the same time in their own worktrees (BE-B, BE-D, KBE-B). File ownership is disjoint by construction (`docs/architecture/p3-work-split.md`). Never edit a file outside your ownership list below. If you need one, describe the change in your handback, and the orchestrator applies it at integration.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start. Do the work in the order given under Scope. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is the floor. Run offline. Do not run `playwright install`. **Your harness ports are 23250–23299 only** (`QA_PG_PORT` and any listener). The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, the delivery records and `trading_agent/`.

## Binding design (read first)

- `docs/architecture/p3-work-split.md`:
  - §1 (frozen files);
  - §2 "Shared rules for every BE task" (rules 1–9), or §3 for KBE tasks;
  - **your section (§2 BE-C)**;
  - §5 (contract-test seams);
  - §7 (the requirement → owner rows you own).
- ADR-0021 §10: the implementer rules, binding. ADR-0023 §1–§5 (waves, milestones and deliverables, one read model, T08 on the canonical `dependency`, configurable types, cycle detection with the advisory lock and the exact 422 body, schedule flags, critical path out of scope).
- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: the module registry, the stubs you fill, the problem mapping in `platform/db-errors.ts`, `sequencing.ts`, the zod mirrors in `packages/shared/src/schemas/portfolio.ts`, and the contract-test wiring.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` §3: the public API of `scoring.ts` and `formula/`. Import it from **`@mth/shared/calc`** (ARCH-02 moved it there to keep the top-level `@mth/shared` dependency-free). Call it; never re-implement the arithmetic.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`: the confirmed interpretations, the ownership notes and the corrected `0024`.
- `docs/api/openapi.yaml` (frozen), the migrations `0020`–`0025` (frozen), and `packages/db/src/schema.ts` (frozen).

## Scope (in this order)

1. **Waves (REQ-PB-050).**
   - `waves`: read and edit only the editable columns. The verbatim source columns are immutable (DB trigger). Teams may add non-source waves.
   - Overlap is accepted.
   - Test that a new transformation shows the four waves verbatim: 'Wave 0 — Mobilize', '0-6 weeks', 'Sponsor + charter', …
2. **Deliverables and milestones.**
   - **Deliverables:** submit and acceptance. The accepter is never the submitter; acceptance needs `deliverable.accept` plus record-level ownership.
   - **Milestones:** `approved_date` is set only by `approve-date` (`roadmap.approve`, re-approval needs a reason). `forecast_date` is editable. Variance is computed, never stored.
3. **Roadmap read model (REQ-S09-006).**
   - `GET /transformations/{id}/roadmap` returns waves, initiatives, milestones, deliverables, initiative-to-initiative dependencies and `flags[]`, with versions, from one query set.
   - `PATCH /milestones/{id}` with a stale `If-Match` → 409 with `currentVersion`.
4. **`portfolio/schedule.ts`** (+ unit test). Write pure functions for `schedule.needed_by_conflict`, `schedule.before_predecessor` and `schedule.unknown`, exactly per ADR-0023 §5. Unknown is never "no conflict".
5. **T08 (REQ-PB-051, REQ-PB-052, REQ-S09-008).** `workflows/t08-dependencies.ts` on `/api/v1/dependencies`, plus `/dependency-types` in `workflows/dependency-types.ts`. You may add their route-registration lines in `apps/api/src/modules/workflows/index.ts` (registration lines only; ARCH-02 ownership note).
   - **The seven columns:** From = an initiative or `external` with a label.
   - **Types:** an unknown or retired type → 422 `dependency.unknown_type`. DELETE on a system type → 422 `dependency_type.system_undeletable`.
   - **Cycle check:** take `pg_advisory_xact_lock(730221, hashtext(transformation_id))` (export `DEPENDENCY_GRAPH_LOCK_CLASS = 730221`), then run the friendly BFS check, then write. The 422 body is exactly ADR-0023 §5: `code: dependency.cycle`, the detail 'Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01', the pointer `/toInitiativeId`, and the `cycle[]` extension.
   - **The DG2 projection rule** in `workflows/design-registers.ts` (only that rule): non-DG2 type codes are shown as `other` on the DG2 paths, and a DG2 PATCH that changes the kinds of a row with initiative endpoints → 422 `dependency.managed_by_t08`. The DG2 paths and responses otherwise stay byte-stable, and every existing DG2 test passes unchanged.
6. **Tests.** `test/integration/portfolio/roadmap.test.ts` and `test/integration/dependencies/t08.test.ts`:
   - A→B→C→A and A→B→A rejected, naming the cycle;
   - **two connections inserting A→B and B→A concurrently: exactly one commits**;
   - external From accepted;
   - unknown type → 422;
   - system type DELETE → 422;
   - a predecessor finishing after the needed-by date → flagged;
   - a stale milestone move → 409;
   - AUD 403;
   - create and read of Deliverable, Milestone, RoadmapWave and Dependency through the API with authorization (REQ-S16-016).

## Rules (binding; reviewers check every one)

Every mutation needs all of the following, each with a test:
- authorization re-checked at commit time (the BE18A pattern);
- validation;
- `If-Match` → 409/428 (creates are version 1);
- an audit event;
- a read-only auditor (AUD) gets **403** on every P3 mutation you route.

Also:
- No client or remote I/O inside a database transaction (BE17/BE18A).
- Amounts, weights, scores and FTE are decimal strings on the wire and `numeric` in SQL. Never use `Number()` on them.
- Unknown/Stale is never 0 or green.
- Free text goes through `freeText`/`hasText`/`hasInvalidCharacter`, and truncation only through `truncateText`.
- Strict UTF-8 parsing (BE13) applies. No route-local parser.
- `config.consumes` equals the contract's request media type (`application/json`).
- Every operation declares its §5b statuses.
- Problem `code`s are i18n keys, and the English `detail` texts are exactly the ADR texts.
- Remove each operation from your `test/support/p3-pending-be-c.ts` in the same change that routes it. Exercise it through the validating client in `test/integration/contract/p3-exercises-be-c.ts`.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches DG0–DG7 records.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<a port in 23250–23299> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and your new tests. In `apps/api/test/integration/contract/contract.test.ts` you may change **only** the two pinned-count assertions (the media-type triple, currently `[90, 89, 1]`, and the rate-limit floor, currently `>= 167`) to the values your routing produces. Report old → new; the orchestrator reconciles them across tasks at integration.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-C-backend-workflow-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-C-evidence/`. Include:
- the start and end `date -u`;
- the files changed;
- the behaviour per requirement, quoting the acceptance texts it satisfies;
- the checks with exit codes;
- the pinned-count changes;
- any change you need in a file you do not own;
- anything left undone.
