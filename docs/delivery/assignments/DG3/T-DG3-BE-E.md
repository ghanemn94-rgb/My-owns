# Assignment T-DG3-BE-E: capacity, resource demand, funding decisions, the G4 evaluators and snapshot, enabling G4 (0026), and the wave-2 wiring follow-ups (backend-workflow-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (the runner's `--cwd`), on branch `dg3/be-e` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`, which already contains ARCH-01/02/03, BE-A–BE-D, KBE-A–KBE-C and FE-A0, merged and verified. `node_modules` is installed and the packages are built. Work only in this tree: the sandbox makes every other tree read-only.
- **Concurrency (D-004):** three frontend implementers run at the same time in their own worktrees (FE-A, FE-B and FE-C, which touch only `apps/web/**`). File ownership is disjoint by construction (`docs/architecture/p3-work-split.md`). Never edit a file outside your ownership list below. If you need one, describe the change in your handback, and the orchestrator applies it at integration.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Housekeeping:** if your shell leaves empty `.claude/.cc-writes` directories inside source folders, remove them before you run the tests. They are harness artifacts.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start. Do the work in the order given under Scope. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is the floor. Run offline. Do not run `playwright install`. **Your harness ports are 23450–23499 only** (`QA_PG_PORT` and any listener). The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, the delivery records and `trading_agent/`.

## Binding design (read first)

- `docs/architecture/p3-work-split.md`:
  - §1 (frozen files);
  - §2 "Shared rules for every BE task" (rules 1–9), or §3 for KBE tasks;
  - **your section (§2 BE-E and §9)**;
  - §5 (contract-test seams);
  - §7 (the requirement → owner rows you own).
- ADR-0021 §10: the implementer rules, binding. ADR-0021 §3 (funding transitions), §6 (business approvals are recorded human decisions) and **§7 in full** (G4 scope, the eight `g4.*` criteria with their exact missing-item codes and English labels, the 422 `gate_criteria_incomplete` body, the reused 403/403/409 decision contracts, the snapshot contents, phase advance to `transform`); ADR-0023 §6 (capacity, demand, the conflict rule, Unknown capacity) and §7 (selection and funding decisions on the canonical `decision` row of kind `executive`); ADR-0015 (the gate engine you plug into).
- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: the module registry, the stubs you fill, the problem mapping in `platform/db-errors.ts`, `sequencing.ts`, the zod mirrors in `packages/shared/src/schemas/portfolio.ts`, and the contract-test wiring.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` §3: the public API of `scoring.ts` and `formula/`. Import it from **`@mth/shared/calc`** (ARCH-02 moved it there to keep the top-level `@mth/shared` dependency-free). Call it; never re-implement the arithmetic.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`: the confirmed interpretations, the ownership notes and the corrected `0024`.
- `docs/api/openapi.yaml` (frozen), the migrations `0020`–`0025` (frozen), and `packages/db/src/schema.ts` (frozen).

## Scope (in this order)

1. **Capacity and demand (REQ-PB-059, REQ-S09-004).**
   - Implement `portfolio/capacity.ts` and `portfolio/resource-demands.ts`: `resource-roles`, `/capacity`, `capacity-plan`, `/resource-demands` (+ commit, release).
   - FTE is a decimal string.
   - **The conflict rule, exactly per ADR-0023 §6:**
     - `demand > available` → `capacity.over_allocated`, with the decimal shortfall;
     - no capacity row → `capacity.unknown`, which is never "no conflict".
   - Committing a demand is the G4 capacity commitment. It is a resourcing commitment, not a business approval.
2. **Funding (REQ-S09-003, REQ-S04-006).**
   - In `portfolio/funding.ts`, add `POST /api/v1/funding-decisions`.
     - It creates the canonical `decision` row (kind `executive`) and the `funding_decision` row in one transaction, with their audit events.
     - `funding.approve` is a business approval held by FIN and SP.
     - An approved decision moves `selected → funded`. A revoked one returns a funded, not-launched initiative to `selected`.
     - An initiative that isn't selected → 422 `funding.not_selected`.
   - **Do not rewrite BE-B's `latestFundingState()`.** Fix the stale header comment in `funding.ts`.
   - **Delegation (ADR-0021 §6, ARCH-03):** refuse `onBehalfOfUserId` with 422 `urn:mth:problem:validation`, code `funding.on_behalf_not_supported`, pointer `/onBehalfOfUserId`, and the exact ADR detail text. Check it after `If-Match` and before separation of duties and the business preconditions. Nothing is written, and `on_behalf_of_user_id` is always NULL.
   - **Decide the deselect rule** BE-B raised in its handback §7 item 4: does deselecting void funding, or does re-selection re-mirror to `funded`? Implement it, test it and state it in the handback.
3. **G4 (REQ-PB-019, REQ-PB-046, REQ-PB-055, REQ-S04-006, REQ-DLV-035).**
   - In `workflows/g4.ts`, write the eight `g4.*` evaluators and the G4 snapshot builder exactly per ADR-0021 §7. Register them in `workflows/criteria.ts` `EVALUATORS`.
   - `portfolio/gate-facts.ts` provides the portfolio half of the facts. **Wire the `kpi` half in `apps/api/src/server.ts`** with `kpi: loadKpiP3GateFacts` from `kpi/index.ts` (one line; KBE-C has merged).
   - **`packages/db/migrations/0026_p3_enable_g4.sql`:** `UPDATE gate_definition SET submission_enabled = true … WHERE code = 'G4'`, plus its `catalogue.test.ts` line.
   - Change the DG2 assertion in `test/integration/gates.test.ts` that G4 is not submittable so it covers G5/G6 only.
   - The missing-item labels must appear **literally** in the 422 response: 'Owners', 'Finance validation', and the initiative's code and name.
4. **Wave-2 wiring follow-ups (work split §9; these files are named for you).**
   - **(a)** In BE-D's `portfolio/prioritization.ts`, replace only the two lines of `DEFAULT_FLAG_SOURCES` with the real sources: BE-C's `schedule.ts` and your capacity rule.
   - **(b)** In BE-B's `presentInitiatives` (`portfolio/repository.ts`), add the one call that fills `flags[]` from the same sources.
   - **(c)** In `apps/api/src/modules/platform/db-errors.ts`, add `["initiative_contribution_kpi_matches_outcome", "/outcomeKpiId"]` to `P3_CHECK_POINTERS`, with its unit test (BE-B §7 item 1).
   - **(d) One initiative presenter (work split §9 item 13).** BE-B's `presentInitiatives` (`portfolio/repository.ts`) is the only presenter. Replace the local copies in BE-C's `roadmap.ts` and in BE-D's `prioritization.ts` (`presentInitiative`) with it.
     - The contract's `displayStatus` is the i18n key (`initiative.status.selected_unfunded`), never English text.
     - Prove the roadmap and prioritization contract exercises still pass.
   - **(e) Closed initiatives are read-only (work split §9 item 14, ADR-0021 §2).** Apply `assertEditable` (cancelled or completed → 422 `initiative.read_only`) in these places, minimal lines only, each with a test:
     - your resource-demand writes;
     - BE-D's score writes (`scores.ts`);
     - BE-C's deliverable and milestone writes (`deliverables.ts`, `milestones.ts`).
   - **(f) Advisory locks.** If you need one, take class **730224** and register it in `platform/advisory-locks.ts` and the ADR-0016 §6 table. Never write the number literally anywhere else.
5. **Tests.**
   - `test/integration/portfolio/capacity.test.ts` and `funding.test.ts`.
   - `test/integration/gates/g4.test.ts` must cover:
     - G4 submit → 422 listing 'Owners', 'Finance validation', the initiative without a gap link (by name), a missing funding decision and a missing capacity commitment;
     - decide → 403 not approver, 403 submitter, 409 superseded;
     - approved G4 → phase `transform`;
     - **G4 end to end with distinct synthetic TL, FIN and SP users:** TL submits; FIN validates the case baseline and the formula versions and records the funding; the capacity owner commits demand; SP approves.
   - AUD → 403 on every mutation.
   - Create and read of ResourceDemand, Capacity and FundingDecision through the API with authorization (REQ-S16-016).

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
- Remove each operation from your `test/support/p3-pending-be-e.ts` in the same change that routes it. Exercise it through the validating client in `test/integration/contract/p3-exercises-be-e.ts`.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches DG0–DG7 records.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<a port in 23450–23499> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and your new tests. In `apps/api/test/integration/contract/contract.test.ts` you may change **only** the two pinned-count assertions (the media-type triple, currently `[141, 140, 1]`, and the rate-limit floor, currently `>= 253`) to the values your routing produces. Report old → new; the orchestrator reconciles them across tasks at integration.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-E-backend-workflow-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-E-evidence/`. Include:
- the start and end `date -u`;
- the files changed;
- the behaviour per requirement, quoting the acceptance texts it satisfies;
- the checks with exit codes;
- the pinned-count changes;
- any change you need in a file you do not own;
- anything left undone.
