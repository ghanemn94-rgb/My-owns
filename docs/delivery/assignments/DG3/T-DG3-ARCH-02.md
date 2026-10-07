# Assignment T-DG3-ARCH-02: P3 architecture follow-ups from wave 1 (solution-architect)

## Stage and base

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Base:** the main working tree `/home/user/My-owns`, at the integrated `HEAD`. It already contains ARCH-01, BE-A (`8e50098`) and KBE-A (merged in `333e1fe`).
- **You run alone.** Wave 2 (BE-B, BE-C, BE-D, KBE-B) starts after you, so your decisions here are the ones they build on.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** this is a small task. Aim for about 30–40 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline. **Your harness ports are 23700–23749 only.** The write guard applies.

## Inputs

- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: §5 (files outside its ownership), §6 (problems in the frozen inputs) and §8.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md`: §3 (public API) and §6 (interpretations to confirm).
- ADR-0002 (the `@mth/shared` public surface), ADR-0021, ADR-0022, ADR-0024, `docs/architecture/p3-work-split.md`.

## Scope (in this order)

### 1. Keep the top-level `@mth/shared` dependency-free (ADR-0002)

`packages/shared/src/index.ts` says the top-level surface is "Dependency-free constants and types". KBE-A followed ADR-0024 and exported `scoring.ts` and `formula/` from it, which pulls decimal.js into every consumer of the top-level entry.

1. Add a subpath export **`@mth/shared/calc`**, built the same way as `./schemas`:
   - the `exports` entry in `packages/shared/package.json` with the `@mth/source`, `types` and `default` conditions;
   - a barrel `packages/shared/src/calc.ts` that re-exports `./scoring.ts` and `./formula/index.ts`.
2. Remove the two export lines from `src/index.ts`.
3. Make sure the build emits `dist/calc.*`, and that `apps/api`, `apps/web` (Vite) and vitest resolve the subpath with the `@mth/source` condition, exactly like `@mth/shared/schemas`.
4. Update ADR-0024 §6 and the work split to say `@mth/shared/calc`. Add a sentence to ADR-0002, or an ADR-0024 note, recording the subpath.
5. No dependency change and no lockfile change.

### 2. Fix the audit shape in `0024` at its source (BE-A finding 6.1)

`p3_instantiate_transformation()` in `0024` writes the `scoring_weight_set.create` audit event with `changes = {"weights": {…}}`. That is not the `{field: {from, to}}` AuditEvent shape.

1. `0024` has not been released or gated. Following the DG2 ARCH-01B precedent, correct the function body **and** the backfill path in `0024` in place, so a fresh or upgraded database never contains a malformed row.
2. Keep `0025`'s `CREATE OR REPLACE` byte-consistent with the corrected body. If it becomes redundant, leave a comment saying so; do not remove the function from `0025`. BE-A's integration tests depend on `0025` applying cleanly.
3. **Sweep every `audit_event` insert in `0020`–`0025`,** including the seeds, waves, weight set and examples. Prove that each one writes the contract AuditEvent shape:
   - apply `0001`→`0025` on a fresh database, and over a P2-populated one;
   - validate every resulting `audit_event.changes` against the contract's AuditEvent `changes` schema. A small script is fine; keep it as evidence.

### 3. Align ADR-0021 §5 with the contract (BE-A observation 6.2)

The contract has `POST …/gate-dispensations/{dispensationId}/decision` with `AcceptanceDecision {result: accepted|rejected}`, and BE-A implemented that. Change the ADR's `…/accept` wording to the contract.

Also record BE-A's design choice: delegated dispensation decisions are refused with 422 `dispensation.on_behalf_not_supported`. Either confirm it or state a different rule. If you change the rule, it is a follow-up for a backend task; say so explicitly.

### 4. Confirm KBE-A's interpretations in the ADRs

Make the ADRs authoritative for what reviewers will see. For each of KBE-A handback §6 items 1–13, either confirm it into ADR-0022 or ADR-0024, or state a different rule. If you choose a different rule, list the code change that KBE-A's successor (KBE-C) must make. The items are:

1. weight > 0;
2. the extra machine codes;
3. scores as integers;
4. the limit codes as `formula.syntax` with `params.reason`;
5. `formula.invalid_variable`;
6. how depth is counted;
7. what counts as a character;
8. function arity;
9. the extra type-rule details;
10. the English texts;
11. the exactness record;
12. 500000 vs 500000.00;
13. the Arabic "pp" suffix.

### 5. Record the ownership changes in `p3-work-split.md`

- **BE-A's §5 files are accepted as BE-A's:** `packages/shared/src/schemas/gate.ts`, `workflows/index.ts`, `workflows/workflows.test.ts`, `server.test.ts`, `registers.test.ts`, `transformations.test.ts`.
- **BE-C** may add its T08 and dependency-type route registration lines in `apps/api/src/modules/workflows/index.ts`, registration lines only.
- **BE-B** implements `latestFundingState()` in `portfolio/funding.ts`, a read-only query over `funding_decision`. BE-E later adds the funding routes to the same file. The edits are sequential, because BE-E lands after BE-B.
- **BE-E** wires the `kpi` half of `GateFactsProvider` in `server.ts` (one line, after KBE-C). It also wires the schedule flags (BE-C) and the capacity flags (BE-E) into BE-D's prioritization view (only the lines that inject them).
- **The pinned contract counts** are now `[90, 89, 1]` and `>= 167`, and each later task reports its own values.

## Acceptance (your self-check, with real output in the handback)

1. These all exit 0: `pnpm install --frozen-lockfile --offline`, `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`.
2. `pnpm test` passes with the locale unset and with `C.UTF-8`.
3. `QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh pnpm test:integration` passes, plus the audit-shape sweep on a fresh database and on a P2-populated one.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-evidence/`. Include:

- each decision taken, citing the file and section it now lives in;
- the files changed;
- the checks with exit codes;
- the new import path for wave 2.
