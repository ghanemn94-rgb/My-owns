# Assignment T-DG3-BE-A: P3 backend foundation: portfolio module, G1 agreements, readiness, dispensations and the contract seams (backend-workflow-engineer)

## Stage and base

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING), on branch `claude/mobily-transformation-platform-regate`.
- **Base:** current `HEAD`, the main working tree `/home/user/My-owns`.
- **Concurrency (D-004):** you run **in parallel with KBE-A**, which works in a separate git worktree and owns `packages/shared/src/scoring.ts`, `packages/shared/src/formula/**`, the export lines in `packages/shared/src/index.ts` and one ESLint override block. Do not touch those files.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.

## Time

Your run has a hard limit of about 2 hours. Run `date -u` at the start.

1. Do the **"first change"** of the work split before anything else:
   - the module registry and route stubs;
   - the problem mapping;
   - the instantiation switch;
   - the zod mirrors;
   - the contract-test wiring of every `p3-exercises-<task>.ts`.
2. Then do G1 agreements with `0025`, readiness, hierarchy and dispensations.

If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Node 22.22.2 is the floor.
- Run offline; `node_modules` is present. Do not run `playwright install`.
- **Your harness ports:** 23100–23149 only (`QA_PG_PORT` and any listener). Other tasks use other ranges at the same time.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, delivery records and `trading_agent/`.

## Binding design (read first)

- **`docs/architecture/p3-work-split.md`:** §0, §1 (frozen files and the migration numbering), §2 "Shared rules for every BE task" and "BE-A", §5 (contract-test seams) and §6 (integration order). Your file ownership is exactly the "BE-A Owns" paragraph. Anything not listed there is frozen.
- **ADR-0021:**
  - §3: the transition table. BE-B implements it; you implement `sequencing.ts`, which it uses.
  - §4–§6: Modular entry, waivers and inherited approvals as `gate_dispensation`; the outcome hierarchy.
  - §8: the G1 agreement extension. Use the exact codes, pointers and detail text.
  - §9: readiness, with the B0012→T01 mapping.
  - §10: the rules every implementer follows.
- **ADR-0015** (gate engine, checks 1–4 and their precedence), **ADR-0007** (§5a/§5b statuses, 422 invalid-transition), **ADR-0016** (P2 guards).
- **The contract,** `docs/api/openapi.yaml`, is frozen. If you need a change, raise it in the handback and do not edit it.
- **The schema,** `packages/db/migrations/0020`–`0024`, is frozen. Your only migration is `0025_p3_g1_agreement_guard.sql`, plus its `schema.ts` and `catalogue.test.ts` lines.

## Scope (from the work split, BE-A)

1. **Module.**
   - Create `apps/api/src/modules/portfolio/` with `index.ts`. It registers every portfolio route file named in the work split for BE-B, BE-C, BE-D and BE-E. Create those files as typed stubs exporting `register…Routes(app, deps)` that register nothing yet, so the other tasks only fill them in.
   - Add the module to `apps/api/src/modules.ts` with `dependsOn` exactly as specified. `workflows` must **not** depend on `portfolio`. Instead, `workflows/g4.ts` (your stub; BE-E fills it) defines a `GateFactsProvider` interface that `server.ts` wires with the `portfolio` and `kpi` loaders.
   - Update `architecture.test.ts`/`architecture.testkit.ts` so the module-graph test passes and stays acyclic.
   - Stub `portfolio/funding.ts`'s `latestFundingState()` to return `unfunded` (BE-E replaces it).
2. **Problem mapping.** In `apps/api/src/modules/platform/db-errors.ts`, map the P3 constraint names to problems as listed in the work split:
   - `*_version_step` → 409;
   - `initiative_status_transition` → 422 invalid-transition;
   - `dependency_acyclic` → 422 `dependency.cycle`, with the cycle path from the database message in the body;
   - `scoring_weight_set_total` → 422 `prioritization.weights_total`;
   - the three `*_not_author`/`*_not_proposer`/`*_not_recorder` guards → 403;
   - CHECK/NOT NULL → 400/422 with pointers;
   - `*_audit_required` → 500.

   Unit-test every mapping.
3. **Instantiation.** `POST /transformations` calls `p3_instantiate_transformation()` instead of `p2_instantiate_transformation()`. This is the one-line switch in `transformations/routes.ts`. Prove with a test that a new transformation gets the four waves and weight set v1.
4. **Shared schemas.** Add zod mirrors of every P3 *portfolio-tag* schema in `packages/shared/src/schemas/portfolio.ts`, plus the export in `schemas/index.ts`. Use decimal strings for amounts, weights and scores, never `number`.
5. **Contract-test seams.**
   - Create `test/integration/contract/p3-exercises-<task>.ts` for BE-B, BE-C, BE-D, BE-E, KBE-B and KBE-C as stubs, plus your own `p3-exercises-be-a.ts` with real exercises. Wire all seven into `contract.test.ts`.
   - Update `malformed-input.ts` `wellFormed` for the new path parameters, plus `media-types.ts` and `platform-statuses.ts` as needed.
   - Remove your 6 operations from `test/support/p3-pending-be-a.ts` in the same change that routes them.
   - Update the pinned counts (the media-type triple and the rate-limit floor) to the values your routing produces, and report them.
6. **G1 agreements (REQ-PB-022), per ADR-0021 §8 exactly.**
   - Add `agreements` to `decideGate` for G1 `approved`, with three `true` confirmations.
   - Otherwise answer 422 `gate.g1_agreements_required` with the three pointers, or 422 `gate.agreements_not_applicable`. Nothing is written.
   - The checks run **after** ADR-0015 checks 1–4.
   - Insert the three `gate_decision_agreement` rows, and add `agreements` to the decision's audit diff.
   - **`0025_p3_g1_agreement_guard.sql`:** a deferred constraint trigger. An approved G1 `gate_decision` needs exactly three agreement rows at COMMIT. Prove it with a psql/pg test: an approved G1 decision without the rows fails at COMMIT.
   - Update every DG2 integration test and test helper under `apps/api/test/**` that approves G1 so it sends `agreements`.
   - Do **not** edit `apps/web/**`. The web G1 dialog and the product e2e that approves G1 through the UI are FE-A's. List the affected e2e tests in your handback.
7. **Readiness (REQ-PB-007).** Implement `GET /transformations/{id}/readiness` per ADR-0021 §9.
   - `missingDiagnosticAreas` lists `economics, customer, operations, capability, technology` for a fresh transformation.
   - Coverage uses the content half of `g1.diagnostic`.
   - `sequencing.blockers` uses the §3 codes and texts.
8. **Outcome hierarchy (REQ-PB-032).** Implement `GET /transformations/{id}/outcome-hierarchy` with five levels: North Star → strategic outcome → KPI → target → initiative contribution. Read only.
9. **Gate dispensations.** Implement create, decide, revoke and read per ADR-0021 §4–§5:
   - a waiver needs a reason, a scope, an approver and an expiry;
   - an inherited approval counts only when its evidence is VERIFIED and it is accepted by a person other than the recorder;
   - never create a `gate_decision`.
10. **`sequencing.ts`** (+ unit test). Write the pure functions BE-B's transitions call: G1 approved or dispensed; End-to-End vs Modular; G2+G3 approved or dispensed for launch, with the exact reason 'North Star, outcomes and target state not yet approved'. Export them with a typed result `{ ok } | { code, reasonEn }`.

## Rules (binding; reviewers check every one)

The work split §2 shared rules 1–9 and ADR-0021 §10 rules 1–11. In particular:

- Every mutation needs:
  - authorization re-checked at commit time (the BE18A pattern);
  - validation;
  - `If-Match` → 409/428;
  - an audit event;
  - a test for each, including read-only auditor (AUD) → 403 on every P3 mutation you route.
- No client or remote I/O inside a transaction.
- Use decimal strings; never use `Number()` for amounts.
- Free text goes through `freeText`/`hasText`/`hasInvalidCharacter`.
- `config.consumes` equals the contract's request media type.
- Every new operation declares the §5b statuses.
- Problem `code`s are i18n keys, and the English detail texts are exactly the ADR texts.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business approval or touches DG0–DG7 records.

## Acceptance (your self-check, with real output in the handback)

1. `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` all exit 0. `pnpm format:check` exits 0, or, if the sandbox makes untracked root stubs unreadable, show `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exiting 0.
2. `pnpm test` passes twice: once with `env -u LANG -u LC_ALL -u LC_CTYPE` and once with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<23100-23149> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts.
   - New tests are `readiness.test.ts`, `dispensations.test.ts` and `g1-agreements.test.ts`.
   - `g1-agreements.test.ts` covers: approve without agreements → 422 with the three pointers; partial → 422; with all three → 200 plus three rows; the agreements on G2 → 422 not-applicable; 403/403/409 keep their precedence; the `0025` guard fires at COMMIT.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.
5. Migrations `0001`→`0025` apply on a fresh DB.

## Evidence honesty

Report every command with its real exit code. Explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-BE-A-evidence/`. Include:

- the start and end `date -u`;
- the files changed;
- the behaviour per requirement;
- the checks with exit codes;
- the new pinned counts;
- the e2e tests FE-A must update for G1 agreements;
- any contract change request;
- anything left undone.
