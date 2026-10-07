# Assignment T-DG3-KBE-B: business cases: ten sections, single-class lines, totals and roll-up, baseline Finance validation (kpi-benefits-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (the runner's `--cwd`), on branch `dg3/kbe-b` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`, which already contains ARCH-01, BE-A and KBE-A. `node_modules` is installed and the packages are built. Work only in this tree: the sandbox makes every other tree read-only.
- **Concurrency (D-004):** up to three other implementers run at the same time in their own worktrees (BE-B, BE-C, BE-D). File ownership is disjoint by construction (`docs/architecture/p3-work-split.md`). Never edit a file outside your ownership list below. If you need one, describe the change in your handback, and the orchestrator applies it at integration.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start. Do the work in the order given under Scope. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is the floor. Run offline. Do not run `playwright install`. **Your harness ports are 23350–23399 only** (`QA_PG_PORT` and any listener). The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, the delivery records and `trading_agent/`.

## Binding design (read first)

- `docs/architecture/p3-work-split.md`:
  - §1 (frozen files);
  - §2 "Shared rules for every BE task" (rules 1–9), or §3 for KBE tasks;
  - **your section (§3 KBE-B)**;
  - §5 (contract-test seams);
  - §7 (the requirement → owner rows you own).
- ADR-0021 §10: the implementer rules, binding. ADR-0024 §1–§5 and §7 (the ten sections and the lighter initiative set, line classification with exactly one class and the value basis bound to it, the transformation case and initiative cases with a roll-up that counts each distinct line once, gross/cost/net shown separately, permissions, and Finance validation of the baseline with Stale on change).
- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: the module registry, the stubs you fill, the problem mapping in `platform/db-errors.ts`, `sequencing.ts`, the zod mirrors in `packages/shared/src/schemas/portfolio.ts`, and the contract-test wiring.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` §3: the public API of `scoring.ts` and `formula/`. Import it from **`@mth/shared/calc`** (ARCH-02 moved it there to keep the top-level `@mth/shared` dependency-free). Call it; never re-implement the arithmetic.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`: the confirmed interpretations, the ownership notes and the corrected `0024`.
- `docs/api/openapi.yaml` (frozen), the migrations `0020`–`0025` (frozen), and `packages/db/src/schema.ts` (frozen).

## Scope (in this order)

1. **Business cases (REQ-PB-053, REQ-PB-054).**
   - Implement `kpi/business-cases.ts` on `/api/v1/business-cases`.
   - **Transformation case:** exactly one active per transformation, with all ten B0085 sections typed per ADR-0024 §1.
   - **Initiative cases:** each links to exactly one transformation case and fills the lighter section set.
2. **Lines (REQ-PB-053, REQ-S05-005)** (`kpi/business-case-lines.ts`, `/business-cases/{id}/lines`).
   - Every line has exactly one class:
     - investment: capex | opex | internal FTE | vendor cost | opportunity cost;
     - benefit: revenue | cost reduction | cost avoidance | working capital | strategic/non-financial.
   - A line with two classes → 400. A class/value-basis mismatch → 422.
   - SAR amounts are decimals, and the currency is configurable.
   - One formula backs at most one line.
3. **Totals and roll-up** (`kpi/totals.ts`, + unit test).
   - The case total equals the sum of distinct lines, each counted once.
   - Editing an initiative case changes the transformation roll-up without duplicating benefits (by reference, not copy).
   - Gross benefits, implementation cost and net value are shown separately; the same cost is never subtracted twice.
   - Revenue uplift stays separate from margin, and avoided cost separate from cash savings.
   - Unknown is never 0. Group per currency.
4. **Finance validation of the baseline (REQ-PB-055 part).**
   - A FIN holder validates the case baseline. The author → 403.
   - The validation stores the baseline hash; a later baseline change shows **Stale**.
   - Formula-version validation is KBE-C's.
5. **Shared schemas:** `packages/shared/src/schemas/business-case.ts`. Register your routes in `kpi/routes.ts` and export from `kpi/index.ts`, registration and export lines only. KBE-C edits those two files after you, sequentially.
6. **Tests.** `test/integration/kpi/business-cases.test.ts`:
   - the ten sections persist;
   - two classes → 400;
   - a mismatch → 422;
   - editing an initiative case changes the roll-up without duplication;
   - the total = distinct lines once;
   - FIN baseline validation, author 403;
   - Stale after a baseline change;
   - AUD 403.

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
- Remove each operation from your `test/support/p3-pending-kbe-b.ts` in the same change that routes it. Exercise it through the validating client in `test/integration/contract/p3-exercises-kbe-b.ts`.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches DG0–DG7 records.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<a port in 23350–23399> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and your new tests. In `apps/api/test/integration/contract/contract.test.ts` you may change **only** the two pinned-count assertions (the media-type triple, currently `[90, 89, 1]`, and the rate-limit floor, currently `>= 167`) to the values your routing produces. Report old → new; the orchestrator reconciles them across tasks at integration.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-B-kpi-benefits-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-B-evidence/`. Include:
- the start and end `date -u`;
- the files changed;
- the behaviour per requirement, quoting the acceptance texts it satisfies;
- the checks with exit codes;
- the pinned-count changes;
- any change you need in a file you do not own;
- anything left undone.
