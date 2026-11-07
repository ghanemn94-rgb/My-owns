# Handback T-DG6-BE-Z9 (backend-workflow-engineer): report aggregate sections carry the restricted label (F-DG6-400)

- **Stage:** DG6 (FIXING after review round 6). Branch `dg6/be-z9`, base `HEAD` `30f9f5ab2a894c4282a4fdee4bff54ad4e9b503b`; tree clean at start.
- **Invocation:** run `DG6-T-DG6-BE-Z9-backend-workflow-engineer-20261107T151742Z-69287e7b`, session `69287e7b-2e62-4341-a837-bbf3d285b936`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z9.md` (sha256 `64d6174c…afad7`, verified).
- **Time:** start `2026-11-07T15:20:59Z`, end `2026-11-07T16:18:46Z` (about 58 minutes).
- **Changes:** left **uncommitted** for the orchestrator.

## 0. Contradiction in the assignment (protocol: "say so, do not guess")

The assignment names its handback `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md`, with evidence under `T-DG6-BE-Z8-evidence/`. That file and directory already exist: they belong to the earlier task T-DG6-BE-Z8. Overwriting them would destroy another task's evidence. This handback is therefore at `T-DG6-BE-Z9-backend-workflow-engineer.md`, with evidence under `T-DG6-BE-Z9-evidence/`. Please move it if the Z8 path was really intended.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → exit 0, `PASS gate DG5 (historical)`:
- at the start: `T-DG6-BE-Z9-evidence/validate-dg5.log`;
- at the end: `T-DG6-BE-Z9-evidence/validate-dg5-end.log`.

## 2. Cause and fix

**Cause.** `documentForReader` (`reports/restricted.ts`) decided a section's `includesRestrictedRecords` only from the section's own rows, items and sources. The executive pack's `metrics_<subject>` and the executive dashboard's `area_*` sections reference only their subject, yet their value headlines are computed over the dashboard facts, which include the sensitive benefit.

**Fix (decided from the records the aggregate includes).**
1. **Assemblers declare the records.** An assembler now returns `aggregates: AggregateRef[]`, the records each aggregate section's figures include beyond its own references (`assembler.ts`). These are not sources: they are never shown, never omit anything, and are not read by the D-199 export refusal.
2. **Live reports** pass them to `documentForReader`. A section's flag uses its rows, items and sources plus these records. The rule is otherwise unchanged:
   - `true` when the reader is not admitted to at least one sensitive record;
   - `false` when the reader is admitted to all of them;
   - absent when none is sensitive, and then the document is the same object byte for byte.
3. **Stored snapshots** keep them in a new append-only table, `report_snapshot_aggregate`. It is written only by the snapshot's creating transaction (`report_snapshot_child_guard`). The content and its `contentSha256` are unchanged; the test asserts both.
4. **Snapshots stored before 0126** (`report_snapshot.aggregates_recorded = false`) are labelled conservatively. Their aggregate sections are judged against every record of the relevant types marked sensitive in their transformation (`legacyAggregates`). The flag column is immutable after insert.
5. **One shared rule with the dashboards.** The records come from the same facts `dashboardRestriction` uses, via `factsValueRecords` and `allocatedBenefitRecords` in `dashboards/restricted.ts`. A report section is therefore labelled for exactly the readers the transformation dashboard labels.

### Sweep: every report section type (12 assemblers)

| Definition | Section(s) | Aggregate over records it does not name? | Result |
|---|---|---|---|
| `executive_pack` | `metrics_<subject>` (kind `metrics`) | **Yes.** Value headlines over the facts' benefits, value lines and business-case investment. | **Fixed** (the finding) |
| `executive_pack` | `update_<subject>` (fields) | No: verbatim update text. | Unchanged; asserted to carry no member |
| `executive_dashboard` | `area_value` (metrics) | **Yes**, as above. | **Fixed** (the finding) |
| `executive_dashboard` | `area_outcomes`, `area_portfolio`, `area_dependencies`, `area_decisions`, `area_people_adoption` | No. RAG plus counts over outcomes, initiatives, dependencies, decisions and adoption indicators. None is a sensitive type or a child of one (`engine.ts computeAreas`). | Unchanged; asserted absent |
| `executive_dashboard` | `items_portfolio` (table) | **Yes, newly found.** Each initiative row's planned value is Σ(allocated benefits' planned amount × share). With a share of 1 it equals the benefit's amount, but the row names only the initiative. | **Fixed**, from the benefits allocated to the listed initiatives |
| `executive_dashboard` | other `items_*` tables | No: rows reference their records (BE-Z7B). | Unchanged |
| `gate_pack` | `criteria` (table) | **Yes, newly found.** `unverified_evidence_count` counts evidence items (possibly sensitive) that the criterion row does not name. | **Fixed**, from the counted evidence ids |
| `gate_pack` | `gate`, `evidence` | No: `evidence` rows reference the evidence items (BE-Z7B). | Unchanged |
| `registers` | benefit totals tables and other registers | No: totals are over rows that reference the records (BE-Z7B). | Unchanged |
| `business_cases` | `cases`, `case_sections`, `lines`, `totals`, per-case line totals | No: rows and sources reference the case or its lines (a `SENSITIVE_CHILD_SOURCES` child). | Unchanged |
| `diagnostic` | issues, baselines, value pools (with totals) | No: no sensitive type. | Unchanged |
| `charter`, `tom`, `roadmap`, `handover`, `meeting_pack`, `meeting_minutes` | all | No value aggregate over a sensitive type. Counts are of their own agenda, attendees and evidence rows, and those rows reference evidence (BE-Z7B). | Unchanged |

## 3. Files changed

| File | Purpose |
|---|---|
| `packages/db/migrations/0126_p6_report_snapshot_aggregate.sql` (new) | Adds the table `report_snapshot_aggregate`: child guard, append-only, row guards, INSERT/SELECT for `mth_app`. Adds `report_snapshot.aggregates_recorded` (false for existing rows, default true) and its immutability trigger. |
| `packages/db/src/schema.ts` | Kysely types and `SCHEMA_COLUMNS` for the new table and column. |
| `packages/db/test/integration/catalogue.test.ts` | Trigger list (new `report_snapshot` trigger; a new 0126 case for the table) and the grants map. |
| `apps/api/src/modules/reporting/reports/assembler.ts` | Adds `AggregateRef` and the optional `AssembledOutput.aggregates`. |
| `apps/api/src/modules/reporting/dashboards/restricted.ts` | Adds `factsValueRecords`, `VALUE_AREA` and `allocatedBenefitRecords`. |
| `apps/api/src/modules/reporting/reports/assemblers/executive-pack.ts` | Declares each `metrics_<subject>`'s records (the workstream's narrowed facts for a workstream). |
| `apps/api/src/modules/reporting/reports/assemblers/executive-dashboard.ts` | Declares `area_value` (value records) and `items_portfolio` (allocated benefits). |
| `apps/api/src/modules/reporting/reports/assemblers/gate-pack.ts` | Declares `criteria` (counted unverified evidence ids; UUID-checked). |
| `apps/api/src/modules/reporting/reports/restricted.ts` | `documentForReader(…, aggregates)`; `snapshotAggregates` (table or legacy rule); `snapshotForReader` loads them. |
| `apps/api/src/modules/reporting/reports/routes.ts` | Live route passes `a.output.aggregates`. |
| `apps/api/src/modules/reporting/reports/snapshots.ts` | `insertSnapshot` writes `report_snapshot_aggregate` rows: deduplicated, batched, in the creating transaction. Covers generate, reissue and the export assembly watch (`insertGeneratedSnapshot`). |
| `packages/shared/src/schemas/report.ts` | Doc comment of the read-time member corrected. No schema change. |
| `apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts` | 9 new tests: the ported domain probe, plus legacy, guard and gate-pack cases. |
| `apps/web/src/pages/reports/restricted-labels.test.tsx` | Metrics-section label, en and ar (stubbed). |
| `apps/web/e2e/p6-report-aggregate-label.spec.ts` (new) | The domain screen probe, ported to the real stack, en and ar. |

## 4. Behaviour delivered: REQ-S10-002

**Acceptance text (quoted):** "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant". Read with ADR-0051 §2 / D-195 Q3: "When a reader is not admitted to at least one sensitive record whose value the aggregate includes, the response carries includesRestrictedRecords: true and the screen shows the label."

**Live and stored `executive_pack`.**
- `metrics_transformation` and `metrics_ws_77` are `true` for TL and AUD (not admitted) and `false` for the TO.
- The metrics fields are identical for every reader.
- The benefit is never mentioned (no record id, no title).
- `update_*` sections carry no member.

**Live and stored `executive_dashboard`.**
- `area_value` and `items_portfolio` are `true` for TL and AUD and `false` for the TO.
- The rows and figures are identical, and nothing is omitted.
- The other `area_*` sections carry no member.

**Storage and guards.**
- Stored content never holds the member, and its hash recomputes to `content_sha256`.
- The aggregate rows are written for exactly the aggregate sections.
- `report_snapshot_aggregate` refuses UPDATE and DELETE, and refuses an INSERT outside the creating transaction.
- `aggregates_recorded` cannot be changed.

**Legacy snapshot.** A snapshot with `aggregates_recorded = false` (simulated by the superuser with the triggers bypassed) is labelled `true` for TL and AUD and `false` for the TO.

**Gate pack.** `criteria` is `true` for TL and AUD and `false` for the TO once a counted unverified evidence item is marked sensitive, and absent before. The rows and counts are identical.

**Screen (real stack, en LTR and ar RTL).**
- The TL sees "Includes restricted records" / "يشمل سجلات مقيدة" under the executive pack snapshot's "Current metrics" and under the executive dashboard snapshot's Value area. The update and Outcomes sections are unlabelled and the benefit's title is not shown.
- The TO sees no label.
- axe reports 0 serious or critical issues.
- Screenshots: `T-DG6-BE-Z9-evidence/screenshots/{en,ar}/bez9-tl-executive-pack.png`, `bez9-tl-executive-dashboard.png` and `bez9-to-executive-pack.png`.

**Unchanged.** Every figure is the same for every reader. The D-199 export refusal is unchanged: it still reads only `report_snapshot_source`.

## 5. Checks run (Node 24.21.0, PostgreSQL 16.15 disposable clusters, ports 31050–31099)

| Command | Exit | Result / log |
|---|---|---|
| `validate.mjs --historical --stage DG5` (start, end) | 0, 0 | `validate-dg5.log`, `validate-dg5-end.log` |
| **Before fix**: `with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts` (first test version, unchanged source) | 1 | 6 failed, 8 passed. The new tests fail on "expected undefined to be false" and "relation report_snapshot_aggregate does not exist". `before-fix-api.log` |
| **Before fix, final tests**: same file, with HEAD's 8 API source files restored temporarily (new migration and schema kept; the fixed files were then put back and their sha256 checked: 8/8 OK) | 1 | 7 failed (every behaviour test), 10 passed (the 8 BE-Z7B tests plus the 2 database-guard tests, which depend only on the migration). `before-fix-api-final-tests.log` |
| **Before fix, screen**: `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-report-aggregate-label.spec.ts --workers=1` (pre-fix API build) | 1 | Fails in en and ar on "TL executive-pack: metrics_transformation is labelled: element(s) not found". `before-fix-e2e.log` |
| After fix: the same API file | 0 | 17/17 passed. `after-fix-api.log` |
| After fix: the same screen spec | 0 | 2/2 passed (en 10.7 s, ar 8.7 s). `after-fix-e2e.log` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| `pnpm test`, locale unset | 0 | Three Vitest invocations: 190 files / 2899 tests; 122 / 2064; 3 files / 259 passed + 2 skipped. `unit-locale-unset.log` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | The same counts. `unit-c-utf8.log` |
| Integration: 82 files (list in `integration-files.txt`) | 0 | 820 passed, 1 skipped. `integration.log` |
| `with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts apps/web/e2e/p6-report-aggregate-label.spec.ts --workers=1` (final build) | 0 | 6/6 passed in chromium-en and chromium-ar. `e2e-a22-a13-bez9.log` |

The 82 integration files are:
- the worker's `job-runs`, `worker-attempt`, `automation-failure-queue` and `restart`;
- the API's `automation-failures`, `automation-engine` and `jobs/job-operations`;
- all of `operations/`, which includes the BE-Z6 race test `exception-recurrence-race` and `concurrent-exception-recurrence`;
- every `access/sensitive-reach*` file and `sensitive-reads`;
- all of `reporting/`, plus `integrity-sweep`, `contract.test.ts`, `presentation`, `kpi-restatements/decisions` and `evidence-register`;
- all of `packages/db/test/integration`, including `catalogue`;
- `tests/qa/integration/a15-*` and `a07`.

**Disclosed non-zero exits.**
1. **First `pnpm test` run** (locale unset; `unit-locale-unset-run1-boundary-fail.log`): exit 1, 2 failed. `apps/api/src/architecture.test.ts` and `reporting.test.ts` rejected "computed member with a non-literal key (line 144)" in `restricted.ts` (my `LEGACY_AGGREGATE_SECTIONS[...]` lookup). I replaced it with a `Map`. Both tests then passed (145/145), and both locales were re-run in full (the rows above).
   - The C.UTF-8 log of that first round (`unit-c-utf8-run1-before-boundary-fix.log`) is kept for completeness, superseded by the re-run.
2. **Two startup errors, from my own invocations, not from tests.**
   - Running Vitest from `apps/api` failed to resolve the workspace config. I re-ran from the repository root.
   - `--project web` doesn't exist. The web test ran with `apps/web`'s config (`unit-web`), 10/10.
   - Two tool errors with no check behind them: the superuser connection first used the owner role, which may not set `session_replication_role` (2 tests failed; switched to the cluster admin URL), and the `tail` call in the static-check command.
3. **Skips (pre-existing conditional skips, not caused by this change).**
   - `presentation.test.ts`: 1 skipped (`it.runIf(!hasMeetingPackAssembler)`).
   - `formula/fuzz.test.ts`: 2 skipped (`skipIf(NOCODEGEN)`).

**e2e budget.** The new spec sets 120 s. The loaded measurement was 13.1 s (chromium-en), taken while the full `pnpm test` and the 82-file integration run were using the machine. That is stated in the spec header.

## 6. Operations routed

None. No endpoint was added or changed, so the pending list is unchanged (delta: none), and `contract.test.ts` passed in the integration run.

## 7. Contract, schema and dependency needs (for the orchestrator)

1. **Migration 0126** `0126_p6_report_snapshot_aggregate.sql`: the next id above 0125 on this branch. Renumber at merge if needed. It is forward-only, the only existing-row change is `aggregates_recorded = false` on old snapshots, and no backfill job is needed.
2. **OpenAPI description text only** (`docs/api/openapi.yaml` line ≈27170, the `ReportDocument.sections` description). It still says the member is present when "a section that references a marked-sensitive record (a row, an item or a source)". It should add: "…or whose aggregate figures include one (executive pack metrics, executive dashboard value area and portfolio items, gate pack unverified-evidence counts)". No schema change; I left it to the contract owner. The zod mirror comment is already corrected.
3. **Architecture documents** (solution-architect):
   - The data dictionary needs entries for `report_snapshot_aggregate` and `report_snapshot.aggregates_recorded` (generated from the catalogue), plus the ERD.
   - ADR-0051 §2's 2026-11-06 sentence ("Absent when the section references no marked-sensitive record") and its table row "every section of ReportDocument … references a marked-sensitive record through a row, an item or a source" now understate the rule. They need correcting, as the finding suggests.
   - ADR-0045 §3 should list the new snapshot child table.
4. **No new dependency.**

## 8. User-facing texts

No en/ar string became untrue. The label key `access.includesRestrictedRecords` and the report screen are unchanged: the screen already renders the label for every section kind. The texts made untrue are the developer and contract texts in §7 items 2–3. I corrected the ones in my files (the `restricted.ts` header, the zod comment) and listed the rest for their owners.

## 9. What remains

1. **Exports (pre-existing, outside this finding's fix).** The rendered export files (worker renderers) carry no "Includes restricted records" label for any section, including the BE-Z7B table totals, because the member is read-time only. The finding mentions this by code reading. Whether an export of a pack whose aggregates include a restricted value should carry the label is a design decision for the orchestrator or architect: D-195 Q3 says aggregates are visible to every reader. Refusing the export is not right under ADR-0051's export rule, because the selection does not include the record itself.
2. **The legacy fallback is a deliberate superset.** For a snapshot stored before 0126, every benefit or business case marked sensitive in the transformation counts, so it may label a section whose aggregate did not include that record. It never under-labels.
3. **Verification.** This finding needs verification by the domain reviewer.

Nothing here grants a business, Finance or IT approval. Product gates G1–G6 are untouched, and no DG0–DG7 result is implied. All test data is synthetic.
