# Handback T-DG3-ARCH-02: P3 architecture follow-ups from wave 1 (solution-architect)

- **Stage:** P3 / DG3 (BUILDING). **Task:** T-DG3-ARCH-02.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-ARCH-02-solution-architect-20261007T224448Z-e5acb053","session_id":"e5acb053-9a5b-4625-97c3-599701b909b1"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-ARCH-02.md`. I checked its sha256 at the start: `4d30f5df…0eca`, as given.
- **Base:** the main working tree, `HEAD` = `12d83b27215eacef8772603b7b9c3f0fdc1eb00b`. I committed nothing.
- **Time:** start `Wed Oct  7 22:45:00 UTC 2026`, end `Wed Oct  7 23:01:45 UTC 2026` (`final.log`). That is about 17 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0, both at the start and at the end (`T-DG3-ARCH-02-evidence/validate-historical-DG2.log`).
- This is engineering work only. It grants no product gate G1–G6 and no business, Finance or IT approval, and it does not touch the DG0–DG7 records. All database rows in the probes are synthetic.

All five scope items are done. No dependency and no lockfile changed, and the contract (`docs/api/openapi.yaml`) did not change.

## 1. New import path for wave 2

```ts
import { weightedScore, validateWeightSet, display100, scoreResultView /* … */ } from "@mth/shared/calc"; // T06
import { validateFormula, evaluateFormula, formatFormulaValue, displayNumber /* … */ } from "@mth/shared/calc"; // T09
```

The top-level `@mth/shared` no longer exports `scoring.ts` or `formula/`. It holds only constants, permissions and problem types, with no package imports. `@mth/shared/schemas` is unchanged.

Nothing in the tree imported the calculation symbols from the top level, so no consumer had to change. I checked with grep, and typecheck and the tests pass.

## 2. Decisions taken, and where each one now lives

| # | Decision | Lives in |
|---|---|---|
| 1 | `@mth/shared/calc` subpath: an `exports["./calc"]` entry (`@mth/source` → `src/calc.ts`, `types` → `dist/calc.d.ts`, `default` → `dist/calc.js`) and the barrel `src/calc.ts`. The top level stays dependency-free. A new subpath needs an ADR note. | ADR-0002 "`@mth/shared` entry points" and the packages table; ADR-0024 §6 "Package" and "Import path", plus Alternative 5; ADR-0022 header and §2a; `packages/shared/README.md`; work split §1, §2 BE-D, §3, §4, §9.3 |
| 2 | `0024` corrected in place, in both the function body and the backfill path, because the backfill calls the same function. `scoring_weight_set.create` now writes `{"weights": {"from": null, "to": {…}}}`. `0025`'s `CREATE OR REPLACE` is byte-identical to it and kept, with a comment saying it is redundant. | `0024` header comment of `p3_instantiate_transformation`; `0025` comment; work split §1 and §9.4 |
| 3 | Dispensation route: `POST …/gate-dispensations/{dispensationId}/decision` with `AcceptanceDecision {result: accepted\|rejected}`, as in the contract. The ADR's `…/accept` is corrected. | ADR-0021 §5, "Routes" |
| 4 | **Confirmed:** a delegated dispensation decision (`onBehalfOfUserId`) is refused with 422 `dispensation.on_behalf_not_supported`, pointer `/onBehalfOfUserId`. The waived gate's approver decides in person. ADR-0015 delegation applies to `gate_decision` only. **No backend follow-up.** | ADR-0021 §5, "No delegated dispensation decisions" |
| 5 | KBE-A §6 items 1–3 (weight > 0, the extra machine codes, scores as integers) are **confirmed**, and the 400/422/500 status boundary for BE-D is added. | ADR-0022 §2a |
| 6 | KBE-A §6 items 4–13 are **confirmed**: limit codes, `formula.invalid_variable`, depth, code points, arity, type-rule details, English texts, exactness record, 500000 vs 500000.00, display suffixes. The 400/422 boundary for KBE-C is added. | ADR-0024 §6, "Engine details confirmed" |
| 7 | Ownership changes: BE-A's §5 files are accepted as its own. BE-C adds registration lines to `workflows/index.ts`. BE-B owns `latestFundingState()`, and BE-E later adds the funding routes. BE-E adds the `kpi` wiring line in `server.ts` and the flag-injection lines in the prioritization view. | work split §2 (BE-B, BE-C, BE-E "Also owns/edits") and §9.1–§9.2 |
| 8 | The pinned contract counts are now `[90, 89, 1]` and `>= 167`, and each later task reports its own values. | work split §5 and §9.5 |

**KBE-A items 1–13: did I change any rule?** No. Every item is confirmed as KBE-A implemented it, so **KBE-C (and BE-D) have no code change to make** in `scoring.ts` or `formula/`. The only additions are rules the handback left to the API tasks:

- **BE-D (ADR-0022 §2a):** the schema check runs first (400). Every `validateWeightSet` problem on a schema-valid body is 422 with the problem's `code`, `detail` and `pointer`. A `ScoringInputError` thrown on stored rows is 500 and is logged.
- **KBE-C (ADR-0024 §6):** whatever the contract schema refuses is 400. A body the schema admits but the engine refuses is 422 with the first error's `code` and `message`. Store the lineage `rounding` object as it is.
- **FE-C (ADR-0024 §6, item 13):** render the pp and % suffix through i18next from `displayNumber`'s suffix code. The Arabic defaults stay provisional.

One correction to an input: the KBE-A assignment said a weight is "≥ 0". The ADR and the DB say > 0, and KBE-A followed the ADR, which was correct. ADR-0022 §2a now states this explicitly.

**Residual risk from BE-A 6.1 (legacy rows):** none remain. Because `0024` itself is corrected, no database, fresh or upgraded, can hold a malformed row, so the audit read path needs no tolerance for them. One consequence: any database that applied the *earlier* `0024` (only scratch or dev databases, since it was never released or gated) will hit the migrator's checksum-drift refusal and must be rebuilt. This is recorded in work split §9.4.

## 3. Changed files

| File | Purpose |
|---|---|
| `packages/shared/package.json` | `exports["./calc"]` with the three conditions; no dependency change |
| `packages/shared/src/calc.ts` (new) | Barrel: `export * from "./scoring.ts"` and `"./formula/index.ts"` |
| `packages/shared/src/index.ts` | Removes the two calculation export lines; the header names both subpaths |
| `packages/shared/README.md` | Documents the `calc` subpath and the dependency-free top level. It is outside the paths the assignment names, but it is the package's own description of ADR-0002 |
| `packages/db/migrations/0024_p3_gates_access_instantiation.sql` | The weight-set audit `changes` in contract shape; header comment |
| `packages/db/migrations/0025_p3_g1_agreement_guard.sql` | Comment only: the function is redundant and byte-identical to 0024's. The body is unchanged |
| `docs/architecture/adr/ADR-0002-modular-monolith-boundaries.md` | Entry-point rule and packages table |
| `docs/architecture/adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md` | §5: route aligned to the contract; the delegation rule confirmed |
| `docs/architecture/adr/ADR-0022-p3-prioritization-scoring-ranking.md` | §2a: KBE-A items 1–3 and the status boundary; import path |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` | §6: subpath, the full ESLint rule list, items 4–13, the status boundary, the 500000 note in the example table, and Alternative 5 |
| `docs/architecture/p3-work-split.md` | Ownership amendments (§1, §2, §3, §4, §5) and the new §9 |
| `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-*` | This handback and its evidence |

I left the shared `dist/` artefacts untracked, as before, since they are build output.

## 4. Audit-shape sweep (scope item 2)

- **Static inventory** (`audit-insert-inventory.txt`). Migrations `0020`–`0025` contain exactly four `INSERT INTO audit_event` statements: the wave insert and the weight-set insert, in `0024` and again in `0025`. The seeds in `0020`–`0024` write **no** audit rows: dependency types, benefit-formula examples, G4 criteria and role grants.
- **Wave events** write `changes` NULL, which the contract allows (`oneOf: […, null]`). The weight-set event was the only one that carried a diff.
- **Dynamic sweep:** `audit-shape-sweep.ts`, with output in `audit-shape-sweep.log`. It compiles the contract's own `AuditEvent.properties.changes` schema from `openapi.yaml` with Ajv 2020 and validates every `audit_event.changes` in two databases:
  - **Fresh:** applies `0001`→`0025`, then runs `p3_instantiate_transformation` as a user (the API path). All 28 rows are valid, and `scoring_weight_set.create` is `{"weights":{"from":null,"to":{…}}}`.
  - **P2-populated:** applies `0001`→`0019`, creates two synthetic transformations with their P2 starter rows (46 rows), then applies `0020`→`0025` on top. The 0024 backfill audits 10 rows (5 per transformation) as `migration/system`. All 56 rows are valid.
  - It prints `SWEEP PASS` and exits 0.
- **Controls:**
  - The validator rejects the pre-fix shape and accepts the fixed shape (negative and positive controls in the same log).
  - `audit-shape-sweep-control-prefix.log` re-runs the sweep with `HEAD`'s unfixed `0024` and without `0025`. It **fails as intended**, with 1 invalid row on the fresh database and 2 on the P2-populated one, and exits 1. So the passing sweep is measuring something real.
- **Byte consistency:** I extracted the `p3_instantiate_transformation` function from `0024` and `0025`, normalised `CREATE OR REPLACE` to `CREATE`, and diffed them. They are `IDENTICAL` (64 lines).

## 5. `@mth/shared/calc` resolution (scope item 1.3)

- **`calc-resolution-probe.mjs`** (output in `calc-resolution-probe.log`), 11 PASS:
  - Node resolves `@mth/shared/calc` to `dist/calc.js` by default and to `src/calc.ts` with `--conditions=@mth/source`.
  - The **built** top-level entry imports no package (4 files). The calc entry reaches only `decimal.js` (9 files).
  - The top level exports none of the 11 calculation symbols probed, and the subpath exports all of them.
  - Smoke results: 3.3000, and 100000.
  - **Vite**, using `apps/web/vite.config.ts`, resolves `@mth/shared/calc` to `src/calc.ts`, just as it resolves `@mth/shared/schemas`.
- **`calc-vitest-tsc-probe.log`:** a temporary test in `apps/api/src` and `apps/web/src` (its text is kept as `zz-calc-probe.test.ts.txt`). It asserts that `@mth/shared/calc` is the *same module instance* as `packages/shared/src/calc.ts`, which proves the `@mth/source` condition. `tsc` passed in both apps (exit 0), and vitest passed in `unit-node` and `unit-web` (2/2, exit 0). I deleted both files afterwards, and the log shows they are gone.
- **`pnpm -r build`** emits `packages/shared/dist/calc.{js,d.ts}` and their maps.

## 6. Checks run (Node 24.21.0, pnpm 10.33.0, offline, PostgreSQL 16.13, ports 23700–23749)

All logs are in `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-evidence/`.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start and end) | `PASS gate DG2 (historical)`, exit 0 | `validate-historical-DG2.log` |
| `pnpm install --frozen-lockfile --offline` | exit 0 | `install.log` |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm -r build` | exit 0 | `build.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0, "OpenAPI 3.1.1, 270 operations" | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (run after this handback was written, and again after this edit) | `prettier-ls-files.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0; 55 files, 1123/1123 tests | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0; 55 files, 1123/1123 tests | `unit-c-utf8.log` |
| `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0; 42 files, 638/638 tests; "applied 25 migrations to a fresh database" | `integration.log` |
| `QA_PG_PORT=23704 … with-pg.sh node --conditions=@mth/source …/audit-shape-sweep.ts` | exit 0, `SWEEP PASS` (fresh database and P2-populated database) | `audit-shape-sweep.log` |
| The same, with pre-fix `0024` and no `0025` (control) | **exit 1, as intended**: `SWEEP FAIL (4)` | `audit-shape-sweep-control-prefix.log` |
| `node …/calc-resolution-probe.mjs` | exit 0, `PROBE PASS` | `calc-resolution-probe.log` |
| Temporary tsc and vitest probe in api and web | each exit 0 | `calc-vitest-tsc-probe.log` |

**Disclosed non-zero exits:** only the deliberate control run (exit 1, as intended).

**Log scan of `integration.log`:**
- The only matches for "unhandled", "timeout" or "failed to" come from passing tests that print expected output: the BE17 ECONNRESET probe and the 408 requestTimeout probes.
- No suite failed, and no hook timed out.
- The unit logs contain the existing `FastifyWarning [FSTDEP022]`, which is unrelated to this change.

**Unit test count:** it went from 1106 (KBE-A) to 1123. That increase came from BE-A's tests, which were merged in `333e1fe`. I added no permanent tests.

## 7. Known gaps, and merge notes

- **No gaps in scope.** I added no permanent automated test for the subpath split, because the assignment named no test file for me. The probes above are evidence only. If the orchestrator wants a guard, a qa-verifier or KBE-C test can assert `!("validateFormula" in await import("@mth/shared"))`.
- **Merge:** no migrations to add. Rebuild any scratch or dev database that applied the earlier `0024` (checksum drift). Wave 2 imports the calculation code from `@mth/shared/calc`.
- Don't commit the sandbox-masked root dotfiles (`.bashrc`, `.gitmodules`, `.idea`, `CLAUDE.local.md` and the rest). They are `/dev/null` character devices.

## 8. Final checks

All three results are in `final.log`:

- **Prettier** (all tracked and untracked files): exit 0.
- **DG2 historical validation** at the end of the run: `PASS gate DG2 (historical)`, exit 0.
- **`date -u`** at the end: `Wed Oct  7 23:01:45 UTC 2026`.
