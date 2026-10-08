# Handback T-DG3-ARCH-03: P3 architecture follow-ups from wave 2 (solution-architect)

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING). Engineering work only. No product gate (G1–G6) and no engineering gate (DG0–DG7) was approved or touched.
- **Invocation:** `DG3-T-DG3-ARCH-03-solution-architect-20261008T000320Z-a5c591a3`, session `a5c591a3-5131-4c9c-bae0-025be4d23488`.
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-ARCH-03.md`, sha256 `5b8991b7…f355772` (verified).
- **Worktree:** `/home/user/wt/dg3-arch-03`, branch `dg3/arch-03`, base `6e5a0fb0dccf42851a1f82a5e7aa8624406cd7fc`. Nothing is committed; the orchestrator integrates.
- **Time:** started `2026-10-08T00:03:30Z` and ended `00:32:24Z`, about 30 minutes. `final.log` holds the end `date -u`, the final prettier check over all files (this handback included; exit 0) and the final DG2 historical validation (exit 0).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, **exit 0**, at the start and again at the end (`validate-dg2-historical.log`).

All six scope items are done. The two items the orchestrator had already integrated (`@mth/shared/calc` in `SHARED_ALLOWED`, and `GET /api/v1/dependency-types` as `authenticated` in `workflows.test.ts`) were read and not redone.

## 1. Decisions and where they now live

| # | Decision | Home |
|---|---|---|
| 1 | `getPrioritization` declares the `funding` query (`not_applicable \| unfunded \| funded \| revoked`) and `"422": BusinessRule` (`prioritization.portfolio_too_large`). No other path changed. | `docs/api/openapi.yaml`; ADR-0022 §7 |
| 2 | **Advisory-lock registry.** 730219 BU hierarchy, 730220 outcome tree, 730221 dependency graph, 730222 prioritization, **730223 dependency type** (was 730222, so the collision is fixed). The numbers live only in `platform/advisory-locks.ts`. | **ADR-0016 §6** (the home); pointers from ADR-0022 §8 and ADR-0023 §5/§8 |
| 3 | The prioritization zod mirrors moved to `@mth/shared/schemas` (`prioritization.ts`). Weights, weighted scores, axes and the 0–100 view are decimal strings. A single criterion score stays the contract's `integer` 1–5. | ADR-0022 §8; work-split §9 item 10 |
| 4 | One cycle-problem class: `DependencyCycleProblem` (and `CycleNode`) are on `platform/index.ts`, and `T08CycleProblem` is deleted. The 422 body is byte-identical. | ADR-0023 §8 |
| 5 | **Delegation: one rule for the P3 business approvals: decided in person, `onBehalfOfUserId` refused.** Selection changes from one-hop delegation to 422 `selection.on_behalf_not_supported`; BE-E implements `funding.on_behalf_not_supported`; the override and dispensation refusals stay as built. Record-owner decisions (design decision, `gate_decision` incl. G4, deliverable acceptance) keep the ADR-0015 path. Delegation for these approvals arrives with REQ-S10-010 (P4, DG4). | **ADR-0021 §6** (table, rationale and P4 path); ADR-0021 §5 points to it |
| 6a | ADR-0021 §2 as built: no `archived_*` on `initiative`, no DELETE, `cancelled` is the terminal retirement. The T05 card and BE-B's links on a cancelled or completed initiative answer 422 `initiative.read_only`. | ADR-0021 §2 |
| 6b | ADR-0022 as built: BE-D's codes and exact English texts; "ranked but now incomplete keeps `ranked`"; scoring a draft is allowed; the prioritization lock. | ADR-0022 §8 |
| 6c | ADR-0023: `GET /dependency-types` is `authenticated` (a global catalogue with no 403). `varianceDays` stays in calendar days and is not relabelled; REQ-S09-007's working-day slip waits for the business calendar. **The T08 flags seam is switched to explicit injection** (like `gateFacts`). | ADR-0023 §2, §8 |
| 6d | ADR-0024 as built: the roll-up set counts for the transformation case's "≥ 1 line"; net is Unknown without both sides; the baseline author is `created_by`; `rejected` stays `rejected`; KBE-B's codes and texts. | ADR-0024 §9 |
| 6e | **BE-E consolidates the three initiative presenters** onto BE-B's `presentInitiatives` (`repository.ts`). | work-split §9 item 13 |

Why the delegation rule is "refused" (the full text is in ADR-0021 §6):

- In P3, selection, funding, weight-set approval and override decisions are granted by permission, not to one named person. Any other holder can decide in their own name, so delegation adds no capability.
- Dispensations already required the approver in person (T-DG3-ARCH-02).
- The delegation feature with effective dates, loop rejection and "B on behalf of A" is REQ-S10-010, with final gate DG4. Allowing delegation early would create five separate SoD paths.
- Only selection changes.

Why the seam was switched rather than confirmed:

- Explicit injection is the pattern the composition root already uses for `gateFacts`.
- It removes the hidden dependency on Fastify encapsulation and registration order, and the `hasDecorator` "first wins" branch.
- It stays fail-closed: unwired gives `schedule.unknown`.

## 2. Changed files

**New**

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/advisory-locks.ts` | `ADVISORY_LOCK_CLASSES`: the single source of the five lock classes. |
| `apps/api/src/modules/platform/advisory-locks.test.ts` | Unit test: the classes are distinct int4 values; every migration `*_lock_class CONSTANT` equals its entry; no module source outside the registry spells a class number. |
| `apps/api/src/modules/workflows/t08-cycle-problem.test.ts` | Unit test: `JSON.stringify` of the platform class's 422 body equals that of a frozen copy of the deleted `T08CycleProblem`, with and without `instance` and with an empty name. |
| `packages/shared/src/schemas/prioritization.ts` | The prioritization mirrors moved from BE-D's routes: `criterionCode`, `WeightSet*`, `ScoreResult`, `InitiativeScore*`, `RANKING_CAUSES`, `RankingEntry`, `RankingSnapshot*`, `RankingChange`, `rankingHistoryPage`, `RankingOverride*`, `ApprovalDecision`, `PrioritizationItem`/`View` and `prioritizationQuery`, plus their types. |

**Modified (code)**

| File | Change |
|---|---|
| `packages/shared/src/schemas/index.ts` | One export line, `export * from "./prioritization.ts";`. **KBE-C adds its own line too; the orchestrator merges both.** |
| `apps/api/src/modules/platform/index.ts` | Exports `DependencyCycleProblem`, `CycleNode`, `ADVISORY_LOCK_CLASSES` and `AdvisoryLockClassName`. |
| `apps/api/src/modules/organization/repository.ts` | `HIERARCHY_LOCK_CLASS` is taken from the registry (value unchanged, 730219). |
| `apps/api/src/modules/workflows/dependency-types.ts` | `DEPENDENCY_TYPE_LOCK_CLASS` is now registry `dependencyType`, **730223**. |
| `apps/api/src/modules/workflows/t08-dependencies.ts` | `DEPENDENCY_GRAPH_LOCK_CLASS` comes from the registry. `T08CycleProblem` is deleted in favour of `DependencyCycleProblem`, and `CycleNode` is the platform node with a required `name`. The Fastify `declare module` augmentation is removed; `registerT08DependencyRoutes(app, db, scheduleFlags?)` takes the provider explicitly. |
| `apps/api/src/modules/workflows/index.ts` | `registerWorkflowsModule` options gain `t08ScheduleFlags`, passed to the T08 routes. |
| `apps/api/src/modules/portfolio/roadmap.ts` | The `app.decorate("t08ScheduleFlags", …)` call is removed, and the comments are updated. |
| `apps/api/src/modules/portfolio/index.ts` | Exports `t08ScheduleFlags`. |
| `apps/api/src/server.ts` | **One line:** `registerWorkflowsModule(app, deps, { gateFacts, t08ScheduleFlags })`, plus the import. |
| `apps/api/src/modules/portfolio/scores.ts` | Local mirrors removed; imports from `@mth/shared/schemas`; `PRIORITIZATION_LOCK_CLASS` comes from the registry (730222). |
| `apps/api/src/modules/portfolio/prioritization.ts` | Local `WeightSet*`, `PrioritizationItem`/`View` and the query mirrors removed; imports from `@mth/shared/schemas`. |
| `apps/api/src/modules/portfolio/rankings.ts` | Local ranking mirrors removed; imports from `@mth/shared/schemas`. |
| `apps/api/src/modules/portfolio/overrides.ts` | Local override and `ApprovalDecision` mirrors removed; imports from `@mth/shared/schemas`. |
| `apps/api/src/modules/portfolio/selections.ts` | Delegation (`assertDelegation`, 403 `selection.not_delegated`) is replaced by `refuseOnBehalf`, which answers 422 `selection.on_behalf_not_supported` at `/onBehalfOfUserId` before any write. The `access` import is dropped. |

**Modified (tests)**

| File | Change |
|---|---|
| `apps/api/test/integration/contract/p3-exercises-be-d.ts` | Mirrors now come from `@mth/shared/schemas`. Adds the `insertInitiatives` bulk fixture and three exercises: `?funding=not_applicable` (200, 2 items), `?funding=funded` (200, 0 items), `?funding=approved` (400), and then **422 `prioritization.portfolio_too_large` over HTTP** at 501 eligible initiatives, with the exact detail text. |
| `apps/api/test/integration/dependencies/t08.test.ts` | The commit-time-authorisation test held lock `730222` as a literal. It now uses `DEPENDENCY_TYPE_LOCK_CLASS`, which is required after the class change (see §3, first focused run). |
| `apps/api/test/integration/portfolio/transitions.test.ts` | New test: select (by a delegate under an **active delegation**) and deselect with `onBehalfOfUserId` give 422 with the exact body; status, version, `portfolio_selection` rows and audit are unchanged; the same delegate selecting in their own name gives 200. |
| `apps/api/test/integration/portfolio/prioritization.test.ts` | Override decision with `onBehalfOfUserId` → 422 `prioritization.on_behalf_not_supported` at `/onBehalfOfUserId`. Nothing is written: the If-Match 1 approval after it succeeds. |
| `apps/api/test/integration/portfolio/dispensations.test.ts` | Dispensation decision with `onBehalfOfUserId` → 422 `dispensation.on_behalf_not_supported`. Nothing is written: the version-1 acceptance after it succeeds. |

**Modified (contract and docs)**

| File | Change |
|---|---|
| `docs/api/openapi.yaml` | `getPrioritization` only: the `funding` parameter, `"422"`, and one summary sentence. |
| `docs/architecture/adr/ADR-0016-…md` | New §6, the advisory-lock registry. |
| `docs/architecture/adr/ADR-0021-…md` | §2 retirement rule as built, plus the read-only open point; §5 points to §6; §6 the delegation rule. |
| `docs/architecture/adr/ADR-0022-…md` | §7 contract note; new §8 with BE-D's choices. |
| `docs/architecture/adr/ADR-0023-…md` | §2 calendar days; §5 lock pointer; new §8 decisions. |
| `docs/architecture/adr/ADR-0024-…md` | New §9 with KBE-B's interpretations and texts. |
| `docs/architecture/p3-work-split.md` | §9 "Amendments after wave 2", items 7–15. |

Not touched: `apps/api/src/modules/kpi/**`, `kpi.test.ts`, `packages/shared/src/schemas/benefit-formula.ts` (KBE-C), `apps/web/**` (FE-A0), `contract.test.ts` pins, migrations, `tools/**`, `.claude/**`, `docs/source/**`, reviews and gate records.

## 3. Checks run (Node v24.21.0, pnpm via `/opt/nvm/versions/node/v24.21.0/bin`, offline; logs in `T-DG3-ARCH-03-evidence/`)

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start) | 0 | `PASS gate DG2 (historical)` | (console, 00:03Z) |
| `pnpm -r typecheck` | **0** | clean | `typecheck.log` |
| `pnpm -r build` | **0** | clean | `build.log` |
| `pnpm lint` | **0** | `eslint . --max-warnings=0` clean | `lint.log` |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 270 operations` | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.log` |
| `pnpm test` with LANG, LC_ALL, LC_CTYPE and LANGUAGE unset, **run 1** | **1** | 1 failed / 1164 passed | `unit-locale-unset.run1-failed.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, **run 1** | **1** | 1 failed / 1164 passed | `unit-c-utf8.run1-failed.log` |
| `pnpm test`, locale unset (after fix) | **0** | 59 files, **1165 passed** | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (after fix) | **0** | 59 files, **1165 passed** | `unit-c-utf8.log` |
| `QA_PG_PORT=23760 MTH_PORT_POOL=23761-23799 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | 49 files, **748 passed**, PostgreSQL on 23760 at attempt 1 | `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG2` (end) | **0** | `PASS gate DG2 (historical)` | `validate-dg2-historical.log` |

**Disclosed non-zero exits:**

- **Unit run 1, both locales (exit 1).** The failing test was `architecture.test.ts` › "every import respects dependsOn…", with the message `modules/platform/advisory-locks.test.ts: computed member with a non-literal key (line 48)`. My new test indexed `ADVISORY_LOCK_CLASSES[entry]`, which the ADR-0002 lint bans in module files, tests included. I fixed it by mapping the migration constant names directly to the registry values, and both locales then passed. The run-1 logs are kept.
- **Focused integration run before the full suite (exit 1, not kept as a file).** It ran `transitions`, `prioritization`, `dispensations`, `dependencies` and `contract` on port 23750: 86 passed and 1 failed. The failure was `t08.test.ts` › "commit-time authorisation: a configure grant revoked while the write waits…", with "the request never waited on the held lock". The test held the hard-coded old class 730222, while the API now locks 730223, so it shows the class change is real. I switched the test to `DEPENDENCY_TYPE_LOCK_CLASS`, and a re-run of `dependencies` gave 19/19, exit 0. The full suite above includes it. The focused runs wrote to `$TMPDIR`, so only this description remains.
- **`integration.log` contains `BE17 db-econnreset: {"status":500,… "unhandled error","code":"ECONNRESET"}`.** It is the expected stdout of the passing test `request-io.test.ts` › "no over-match: a database-side ECONNRESET … is a 500 with an error log", which provokes that 500 on purpose. There were no hook timeouts and no port retries.

**Pinned counts:** `contract.test.ts` is unchanged, and no operation or JSON-body count changed. The new 422 response and query parameter sit on an existing operation.

**Test count deltas (from this task):** +5 unit tests (3 in `advisory-locks.test.ts`, 2 in `t08-cycle-problem.test.ts`). +1 integration test (the selection on-behalf test). New assertions were added inside 3 existing integration tests: the override and dispensation refusals, and the BE-D contract exercise (`funding=` filter and 422).

**Byte-identity of the cycle 422:** proven by `t08-cycle-problem.test.ts`, which compares exact JSON strings, and by the existing T08 HTTP test `cycles (REQ-S09-008…)` › "A→B→C→A is 422 naming the cycle exactly", which passes in the full run. That HTTP test uses `toMatchObject`, which is why I added the exact-string unit test.

## 4. Known gaps / not done

- **Open point (recorded, not built):** `assertEditable` (cancelled or completed → 422 `initiative.read_only`) covers the T05 card and BE-B's links only. Scores (BE-D), deliverables and milestones (BE-C) on a closed initiative are not refused. The effect is limited, because a closed initiative is out of rankings, the view, G4 scope and capacity. This is ADR-0021 §2 and work-split §9 item 14, for BE-E (its resource demand) and a repair round or the integrator (the BE-C and BE-D files). I did not change them, to stay minimal.
- `selections.ts` still threads `onBehalfOf` into `writeSelection` (the `on_behalf_of_user_id` column and the audit context). After the refusal it is always `undefined`. I left it so P4 (REQ-S10-010) can re-enable delegation without a schema change.
- BE-D's local initiative presenter in `prioritization.ts` returns `displayStatus` `"Selected - unfunded"` or the raw status. The contract and BE-B's presenter return the i18n key (`initiative.status.selected_unfunded`). BE-E's presenter consolidation (item 13) fixes this; I did not touch the presenters.
- REQ-S09-007's working-day slip is not implemented. As ADR-0023 §8 decides, it waits for the business calendar (final gate DG4).
- `on_behalf_of_user_id` on `portfolio_selection` and `funding_decision` stays in the schema, always NULL in P3.

## 5. What BE-E must know

1. **Funding delegation:** refuse `FundingDecisionCreate.onBehalfOfUserId` with 422 `urn:mth:problem:validation`, code `funding.on_behalf_not_supported`, `errors[0].pointer` `/onBehalfOfUserId`, detail "A funding decision is decided by the approver in person; deciding on someone's behalf is not available.". Nothing may be written. Run the check after `If-Match` and before SoD and business preconditions (ADR-0021 §6). Write `on_behalf_of_user_id` as NULL.
2. **Presenters:** BE-B's `presentInitiatives` (`portfolio/repository.ts`) is the only initiative presenter. Replace the local copies in `roadmap.ts` and in `prioritization.ts` (`presentInitiative`), and wire `flags[]` there once.
3. **`server.ts`:** the `registerWorkflowsModule(...)` line now passes `{ gateFacts, t08ScheduleFlags }`. Your `kpi:` wiring line in `gateFacts`, a few lines above, is untouched, so expect a clean merge or a trivial one.
4. **Flags in the view:** still `DEFAULT_FLAG_SOURCES` in `prioritization.ts` (unchanged).
5. **A new advisory lock** takes **730224**: add it to `ADVISORY_LOCK_CLASSES` and to the ADR-0016 §6 table. `advisory-locks.test.ts` fails if a module spells the number or a migration constant disagrees.
6. **Resource-demand writes on a cancelled or completed initiative:** use `assertEditable` (work-split §9 item 14).

## 6. What FE-B must know

1. **Import the prioritization schemas from `@mth/shared/schemas`:** `weightSet`, `weightSetCreate`, `weightSetList`, `initiativeScore`, `initiativeScoreCreate`, `initiativeScoreUpdate`, `initiativeScoreSheet`, `scoreResult`, `rankingEntry`, `rankingSnapshot`, `rankingSnapshotView`, `rankingSnapshotPage`, `rankingChange`, `rankingHistoryPage`, `rankingOverride`, `rankingOverrideCreate`, `rankingOverridePage`, `approvalDecision`, `prioritizationItem`, `prioritizationView`, `prioritizationQuery`, `criterionCode` and `RANKING_CAUSES`, plus their types. Do not define copies. Use `@mth/shared/calc` for any arithmetic.
2. **The view's `funding` filter** is declared in the contract. A portfolio above 500 eligible initiatives answers 422 `prioritization.portfolio_too_large`: show it as an error state, not as an empty table.
3. **i18n keys** to translate from `code` are in ADR-0022 §8 (BE-D's codes and texts), plus `selection.on_behalf_not_supported`. Arabic is provisional.
4. **Delegation:** the P3 approval UIs offer no "on behalf of" control (ADR-0021 §6).

## 7. Merge instructions

- No migration, no dependency change, no lockfile change.
- Expected conflict: `packages/shared/src/schemas/index.ts`, where KBE-C and I each add one export line. Keep both.
- `apps/api/src/server.ts`: one changed line plus the import. BE-E and KBE-C may touch nearby lines.
- After merging, run `pnpm -r typecheck` and `pnpm test`, then the integration suite. `contract.test.ts` pins are unaffected by this task.
- Don't commit the sandbox-masked root dotfiles (`.bashrc`, `.gitmodules`, `CLAUDE.local.md`, …) or any `.claude/.cc-writes/` directory. I removed one under `apps/api/.claude/` before the unit runs.
