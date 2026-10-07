# Assignment T-DG3-BE-D: prioritization: weight sets, scores, rankings with causes and overrides (backend-workflow-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (the runner's `--cwd`), on branch `dg3/be-d` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`, which already contains ARCH-01, BE-A and KBE-A. `node_modules` is installed and the packages are built. Work only in this tree: the sandbox makes every other tree read-only.
- **Concurrency (D-004):** up to three other implementers run at the same time in their own worktrees (BE-B, BE-C, KBE-B). File ownership is disjoint by construction (`docs/architecture/p3-work-split.md`). Never edit a file outside your ownership list below. If you need one, describe the change in your handback, and the orchestrator applies it at integration.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start. Do the work in the order given under Scope. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is the floor. Run offline. Do not run `playwright install`. **Your harness ports are 23300–23349 only** (`QA_PG_PORT` and any listener). The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, the delivery records and `trading_agent/`.

## Binding design (read first)

- `docs/architecture/p3-work-split.md`:
  - §1 (frozen files);
  - §2 "Shared rules for every BE task" (rules 1–9), or §3 for KBE tasks;
  - **your section (§2 BE-D)**;
  - §5 (contract-test seams);
  - §7 (the requirement → owner rows you own).
- ADR-0021 §10: the implementer rules, binding. ADR-0022 in full (weight sets, versioned and immutable once used; scores 1–5; the read-only weighted score; incomplete; the 0–100 view and its label; snapshots and history with causes; overrides; ranking ≠ selection ≠ funding; the comparison and ranked table).
- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: the module registry, the stubs you fill, the problem mapping in `platform/db-errors.ts`, `sequencing.ts`, the zod mirrors in `packages/shared/src/schemas/portfolio.ts`, and the contract-test wiring.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` §3: the public API of `scoring.ts` and `formula/`. Import it from **`@mth/shared/calc`** (ARCH-02 moved it there to keep the top-level `@mth/shared` dependency-free). Call it; never re-implement the arithmetic.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`: the confirmed interpretations, the ownership notes and the corrected `0024`.
- `docs/api/openapi.yaml` (frozen), the migrations `0020`–`0025` (frozen), and `packages/db/src/schema.ts` (frozen).

## Scope (in this order)

1. **Weight sets (REQ-PB-049).** `PUT /transformations/{id}/prioritization/weight-sets` and its approval.
   - Validation uses `@mth/shared` `scoring.ts`: a total of 95% or 105% → 422 `prioritization.weights_total` and **nothing is written**.
   - v2 with `risk_compliance` 10 and strategic fit 15 is accepted as version 2, and is approved by a person other than the proposer (SP, `prioritization.approve`). Activation appends results under v2 for every submitted initiative.
   - v1 results keep their v1 reference forever.
   - A set is immutable once used (DB guard).
2. **Scores (REQ-PB-047, REQ-PB-048).**
   - Score 1–5 per criterion: 6, 0 or 2.5 → 400.
   - The weighted score is never accepted as input (strict objects → 400). It is computed only through `scoring.ts` and appended to `initiative_score_result` with its cause.
   - 5,4,3,2,1 under v1 → `3.3000` stored, `3.30` shown, and `display100` `57.5` with the conversion label (REQ-S09-001).
   - A missing score → `incomplete` with `weightedScore` null, never a number.
3. **Rankings (REQ-S09-005).** `POST …/prioritization/rankings` creates the snapshot exactly per ADR-0022 §4:
   - the deterministic tie-break;
   - the causes `new`, `score`, `weight`, `override`, `relative` and `removed`;
   - submitted → ranked for complete initiatives, each with its audit event.
   - `GET …/rankings/history` returns `causeLabels`, including **'weight version 2'**.
4. **Overrides (REQ-S09-005).**
   - Propose, approve, reject and revoke.
   - A reason is required: missing or empty → 400 at `/reason`; whitespace or invisible-only → 422 `prioritization.override_reason_required`.
   - The approver is never the proposer.
5. **Comparison (REQ-S09-004).** `GET /transformations/{id}/prioritization` returns the value and feasibility axes as documented, rank, selection, funding, wave, sequencing flags and capacity flags. BE-C writes `schedule.ts` and BE-E writes the capacity rule in parallel or later, so take both as injected functions (for example `deps.scheduleFlags` and `deps.capacityFlags`) that default to returning `[]`. BE-E wires them after integration. Never import `schedule.ts` or `capacity.ts` directly in this task. Filters: `status`, `waveId`, `completeness`, `funding`, `flag`. More than 500 initiatives → 422 `prioritization.portfolio_too_large`.
6. **Tests.** `test/integration/portfolio/prioritization.test.ts`, literally per the acceptance texts:
   - score 6 → 400;
   - 95%/105% → 422 with nothing written;
   - the v2 risk/compliance set accepted and used for rescoring;
   - v1 results keep v1;
   - the history shows 'weight version 2' as the cause of a rank change;
   - an override without a reason is rejected;
   - the proposer cannot approve;
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
- Remove each operation from your `test/support/p3-pending-be-d.ts` in the same change that routes it. Exercise it through the validating client in `test/integration/contract/p3-exercises-be-d.ts`.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches DG0–DG7 records.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<a port in 23300–23349> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and your new tests. In `apps/api/test/integration/contract/contract.test.ts` you may change **only** the two pinned-count assertions (the media-type triple, currently `[90, 89, 1]`, and the rate-limit floor, currently `>= 167`) to the values your routing produces. Report old → new; the orchestrator reconciles them across tasks at integration.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-D-backend-workflow-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-D-evidence/`. Include:
- the start and end `date -u`;
- the files changed;
- the behaviour per requirement, quoting the acceptance texts it satisfies;
- the checks with exit codes;
- the pinned-count changes;
- any change you need in a file you do not own;
- anything left undone.
