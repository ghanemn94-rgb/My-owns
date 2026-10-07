# Assignment T-DG3-BE-B: initiatives, links, lifecycle transitions and portfolio selection (backend-workflow-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (the runner's `--cwd`), on branch `dg3/be-b` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`, which already contains ARCH-01, BE-A and KBE-A. `node_modules` is installed and the packages are built. Work only in this tree: the sandbox makes every other tree read-only.
- **Concurrency (D-004):** up to three other implementers run at the same time in their own worktrees (BE-C, BE-D, KBE-B). File ownership is disjoint by construction (`docs/architecture/p3-work-split.md`). Never edit a file outside your ownership list below. If you need one, describe the change in your handback, and the orchestrator applies it at integration.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start. Do the work in the order given under Scope. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is the floor. Run offline. Do not run `playwright install`. **Your harness ports are 23200–23249 only** (`QA_PG_PORT` and any listener). The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, the delivery records and `trading_agent/`.

## Binding design (read first)

- `docs/architecture/p3-work-split.md`:
  - §1 (frozen files);
  - §2 "Shared rules for every BE task" (rules 1–9), or §3 for KBE tasks;
  - **your section (§2 BE-B)**;
  - §5 (contract-test seams);
  - §7 (the requirement → owner rows you own).
- ADR-0021 §10: the implementer rules, binding. ADR-0021 §2 (T05 fields and links, the TOM/portfolio separation and its 422 text), §3 (the lifecycle table: every transition, its permission and its preconditions **in order**, with the exact 422 codes and texts), §4–§6, and §7's G4 scope (status `selected`/`funded`/`launched`).
- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: the module registry, the stubs you fill, the problem mapping in `platform/db-errors.ts`, `sequencing.ts`, the zod mirrors in `packages/shared/src/schemas/portfolio.ts`, and the contract-test wiring.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` §3: the public API of `scoring.ts` and `formula/`. Import it from **`@mth/shared/calc`** (ARCH-02 moved it there to keep the top-level `@mth/shared` dependency-free). Call it; never re-implement the arithmetic.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`: the confirmed interpretations, the ownership notes and the corrected `0024`.
- `docs/api/openapi.yaml` (frozen), the migrations `0020`–`0025` (frozen), and `packages/db/src/schema.ts` (frozen).

## Scope (in this order)

1. **Initiatives (T05, REQ-PB-045).** `/api/v1/initiatives`: create, read, list and PATCH.
   - All 14 T05 fields per the ADR-0021 §2 storage map.
   - `INI-nn` codes come from `record_code_counter`.
   - `warnings[]` on the representation: `initiative.deliverable_count` (outside 3–7), `initiative.no_gap_link` and `initiative.no_owner`. These are warnings, never rejections.
   - `planned_end >= planned_start`.
   - Archive, never delete.
2. **Links.**
   - **Gap links (REQ-PB-040, REQ-PB-046).** `/initiatives/{id}/gap-links` accepts 1..n links to `tom_gap` or `diagnostic_finding`. Any other TOM record type is **422** `initiative.not_tom_evidence` with the exact ADR text.
   - **Outcome contributions (REQ-PB-032).** `outcome-contributions` require an outcome (a missing `outcomeId` → 400). The KPI must belong to that outcome; the DB trigger maps to a problem.
   - **Decision links.** `decision-links` point to canonical `decision` rows.
   - **G3 test.** Add a unit or integration test asserting that G3 completeness is identical with and without initiatives and gap links.
3. **Transitions** (`portfolio/transitions.ts`, using BE-A's `sequencingState()`): submit, withdraw, select, deselect, launch and cancel, exactly per the ADR-0021 §3 table.
   - Use the exact codes and texts:
     - 'Case for change not yet approved (G1)…';
     - 'Outcome before activity…' (answered as `validation` with pointer `/outcomeContributions`);
     - 'North Star, outcomes and target state not yet approved';
     - 'Selected - unfunded: a funding approval is required before launch';
     - 'Only a funded initiative can be launched'.
   - Precondition order matters: launch checks direction before funding.
   - End-to-End vs Modular: a waiver, or an accepted inherited approval, satisfies the gate precondition per ADR-0021 §5.
   - Launch reads `latestFundingState()` from `portfolio/funding.ts`. **You own that function (ARCH-02 ownership note):** replace BE-A's stub with a read-only query over `funding_decision` (the latest row per initiative decides; `approved` → funded; `revoked`/`rejected`/`deferred` per ADR-0023 §7). Touch nothing else in that file; BE-E adds the funding routes later. In your tests, reach a funded initiative with a test-only fixture that inserts a canonical `decision` (kind `executive`) and a `funding_decision` row **with their audit events** in one transaction, and say so in the handback.
4. **Selection (REQ-S09-003).**
   - `/initiatives/{id}/select` and `deselect` require a rationale and are business approvals (`portfolio.select`). Each writes a `portfolio_selection` row.
   - Ranking never selects.
   - The representation shows the label **'Selected - unfunded'** whenever the initiative is selected without a current approved funding decision.
5. **Tests.**
   - `test/integration/portfolio/initiatives.test.ts`, `links.test.ts`, `transitions.test.ts`;
   - every transition, success and every 422 with its exact text;
   - End-to-End launch → 422, then 200 after G2+G3 approval (REQ-PB-004 acceptance, literally);
   - submit before G1 → 422 (REQ-PB-007/REQ-PB-022);
   - submit without an outcome/KPI link → the 'Outcome before activity' validation error, and accepted once a link exists (REQ-PB-006);
   - AUD 403 on every mutation;
   - create and read of Initiative through the API with authorization (REQ-S16-016).

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
- Remove each operation from your `test/support/p3-pending-be-b.ts` in the same change that routes it. Exercise it through the validating client in `test/integration/contract/p3-exercises-be-b.ts`.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches DG0–DG7 records.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<a port in 23200–23249> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and your new tests. In `apps/api/test/integration/contract/contract.test.ts` you may change **only** the two pinned-count assertions (the media-type triple, currently `[90, 89, 1]`, and the rate-limit floor, currently `>= 167`) to the values your routing produces. Report old → new; the orchestrator reconciles them across tasks at integration.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-B-backend-workflow-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-B-evidence/`. Include:
- the start and end `date -u`;
- the files changed;
- the behaviour per requirement, quoting the acceptance texts it satisfies;
- the checks with exit codes;
- the pinned-count changes;
- any change you need in a file you do not own;
- anything left undone.
