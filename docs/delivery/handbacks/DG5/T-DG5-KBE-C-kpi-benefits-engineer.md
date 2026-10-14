# Handback T-DG5-KBE-C (kpi-benefits-engineer): report definitions, the document model, snapshots, issue, discard, reissue; the charter and registers assemblers

- **Stage:** P5 / DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §F.1.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-C-kpi-benefits-engineer-20261014T174750Z-4dec0af5","session_id":"4dec0af5-6eb8-4d27-abc8-9a8c45e2578f"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-C.md` (sha256 `b63a724e…5fe5`, verified at the start).
- **Base:** worktree `/home/user/wt/dg5-kbe-c`, branch `dg5/kbe-c`, `HEAD` `09b7428` (D-149). Changes are left **uncommitted** for the orchestrator.
- **Time:** start `2026-10-14T17:48:05Z` (`date -u`); end `2026-10-14T19:34:30Z` (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exit 0 at the start (`PASS gate DG4 (historical)`; `T-DG5-KBE-C-evidence/validate-dg4-historical-start.txt`) and at the end (§3).
- **Two gate systems.** Issuing a report snapshot freezes what the records said and approves nothing. A snapshot's `approvalState` is a recorded fact about its sources. Product gates G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7, and all test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/report.ts` (new) | The Zod `reportDocument` v1 (ADR-0045 §3): six value types, each with `validation` and `reason` (a value is null exactly when unknown/stale, n/a may be null, never with a reason); table columns hold one unit kind and one value basis, and a totalled column one currency; the `registers` parameters (six registers, each with its list route's filters); request schemas (`reportGenerate`, `reportSnapshotIssue`, `reportSnapshotReason` via `freeText`); the response mirrors of the 11 operations; the `report_snapshot.issued` v1 payload; `countReportValues` (§5 counts). |
| `packages/shared/src/schemas/index.ts` | Barrel line for `report.ts`. |
| `packages/shared/src/schemas/report.test.ts` (new) | Unit tests of the document rules (mixed bases and currencies, row width, cell kind, counts), the registers parameters and the reason text. |
| `apps/api/src/modules/reporting/reports/routes.ts` | Fills BE-A's stub: the 11 operations (`config.consumes` = `application/json` on the four bodies). |
| `apps/api/src/modules/reporting/reports/definitions.ts` (new) | The catalogue reads and the ADR-0045 §11 refusals with their exact English texts. |
| `apps/api/src/modules/reporting/reports/snapshots.ts` (new) | Read-only `REPEATABLE READ` assembly, then one write transaction; canonical JSON and SHA-256; generate, issue, discard, reissue under lock class `reportSnapshotIssue`; the `report_snapshot.issued` event (see §5 item 2); the presenters. |
| `apps/api/src/modules/reporting/reports/provisional.ts` (new) | The ADR-0045 §5 rules, one pure function per source kind. |
| `apps/api/src/modules/reporting/reports/assembler.ts` (new) | The `Assembler` interface, the registry (`charter` and `registers`; one line each for KBE-C2/KBE-D/KBE-D2), the value builders (Unknown/Stale drop the number), `citedEvidence`, `userNames` and `gateApprovalState`. |
| `apps/api/src/modules/reporting/reports/assemblers/charter.ts` (new) | The `charter` assembler, read through the DG2 charter service (`findCharter`, `charterView`). |
| `apps/api/src/modules/reporting/reports/assemblers/registers.ts` (new) | The `registers` assembler for raid, benefits, kpis, decisions, dependencies and actions. |
| `apps/api/src/modules/reporting/reports/provisional.test.ts` (new) | Unit tests of the rules, the builders, the approval-state helpers and the canonical hash (worked fixtures). |
| `apps/api/src/modules/platform/db-errors.ts` | The `report_snapshot.*` lines: `mapP5ReportError` and its one dispatcher line. |
| `apps/api/src/modules/platform/db-errors-p5-reports.test.ts` (new) | Unit tests of that mapping. |
| `apps/api/test/integration/reporting/report-snapshots.test.ts` (new) | Integration tests for REQ-S13-004 and REQ-S13-007, the refusals, AUD, If-Match, audit and commit-time re-authorization. |
| `apps/api/test/integration/reporting/registers-report.test.ts` (new) | Integration tests: every register equals its list route; REQ-S13-008; 5,001 rows. |
| `apps/api/test/support/p5-pending-kbe-c.ts` | Pending list emptied (11 → 0). |
| `apps/api/test/integration/contract/p5-exercises-kbe-c.ts` | The 11 operations exercised through the validating client, with their mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[349, 348, 1]` → `[353, 352, 1]`, plus a comment line (the BE-C/BE-H2 precedent; §4). |
| `apps/api/src/server.test.ts` | **Outside my file list; disclosed.** Its assertion "no report route until P5" became untrue when these routes shipped. It now pins exactly the 11 KBE-C routes. Tasks have edited this file before (D-146: BE-D, BE-H). The orchestrator may prefer to apply it at the merge. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-C-*` | This handback and its evidence logs. |

No migration was written; `0083` stays unused. No dependency was added. Nothing under `apps/web`, `tools/**`, `.claude/**`, `docs/source/**` or the delivery records was edited.

## 2. Behaviour delivered, per requirement row

### REQ-S13-004 (my part: definitions, snapshots, charter, registers)

Acceptance: *"A15: each of the ten outputs (charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard, handover) generates from the demo transformation and contains that transformation's ID and records"*. §F.1 test: *"`charter` and `registers` generate from a seeded transformation and contain its ID and records"*.

- `listReportDefinitions` returns the 12 seeded definitions in order.
- `getLiveReport` assembles now, stores nothing and returns `snapshotId: null`.
- `generateReportSnapshot` stores the assembly as a `generated` snapshot (201, `ETag "1"`, `Location`).
- `charter`: the charter fields, the current North Star, the top outcomes and the guardrails, read through the DG2 charter service. A field the charter lacks is Unknown (`value: null`, `reason: missing`).
- `registers`: one of six registers (`parameters.register`), with that register's list-route filters. The rows are exactly the list route's rows, in its order.
- Tests (`report-snapshots.test.ts`, `registers-report.test.ts`):
  - the charter snapshot contains `transformation.id`, the charter text, and the charter source row at version 1;
  - a RAID snapshot contains the transformation id and the RAID row (code and description);
  - each register equals its list route, all pages, for the same filters: RAID filtered to `type=risk` (cell by cell: code, description, status, probability), actions with `overdue=true`, decisions `status=open`, dependencies, KPI definitions and benefits.
- The other eight definitions answer 404 until KBE-C2, KBE-D and KBE-D2 register their assemblers (§5 item 4). The subject and period checks run first, so `report.period_required` is reachable now.

### REQ-S13-007 (snapshot, issue, reissue)

Acceptance: *"A07;A15: after a later KPI change, the issued snapshot still shows the old values and their versions"*. §F.1 test: *"after a later change to a KPI shown in a register, the issued snapshot still returns the old values with their `kpi_version` rows, and a reissue issued becomes `issueVersion` 2 while v1 is `superseded` with its content unchanged"*, plus the refusals listed there.

- **Retained per snapshot (M0254):**
  - `as_of` = the assembling transaction's `now()`;
  - the period and its copies;
  - one `report_snapshot_source` row per record, with `record_version` at the as-of instant, approval state and validation state;
  - `methodology_version_id` from the transformation's `methodology` pin, read through `ConfigResolver` (`createConfigResolver().pinnedVersion`), plus its `methodology_version` row;
  - `kpi_version` rows (the active version of each KPI shown);
  - `approval_state`;
  - the cited evidence with content revision and SHA-256;
  - `content_sha256` (canonical JSON: keys in code-point order, integers only).
- **Test** (`report-snapshots.test.ts` › REQ-S13-007):
  1. A KPI with active v1 is generated in a `kpis` register and issued (`issueVersion 1`).
  2. The KPI is renamed through the DG2 route. The issued snapshot keeps its content, its hash and the old name; its `versions` list keeps `kpi_version … v1`; its sources keep the KPI row at the old version. The live report shows the new name.
  3. A reissue is a new `generated` row in the same series. When it is issued it becomes `issueVersion 2`, v1 is `superseded` with `supersededById`, and v1's content is deep-equal to the original.
  4. Audit trail: v1 is `generate, issue, supersede`; the reissue is `reissue, issue`.
  5. Reissuing the superseded v1 → 422 `report_snapshot.not_issued`. Issuing an issued snapshot → 422 `report_snapshot.not_generated`.
  6. Two reissues of the current issue, issued concurrently → exactly one 200 (`issueVersion 3`) and one 409 `report_snapshot.series_changed`, with one issued row in the series.
- **Locking and concurrency:** issue, discard and reissue take lock class `reportSnapshotIssue` on `<definitionCode>:<transformationId>:<subjectId>:<period or ->`. A race that still reaches the 0080 guards maps to the same codes (`db-errors.ts`).

### REQ-S13-008 (my part: the rules; labels in the registers)

Acceptance: *"A10;A15: a pending benefit value is labelled provisional in the PDF pack"* (the PDF is BE-N's). §F.1 test: *"a pending benefit value in the benefits register has `validation: provisional` and is counted"*.

- `provisional.ts` implements rules 1–6. The source column each rule reads, per assembler:

| Assembler / column | Source column (DG2–DG4) | Rule |
|---|---|---|
| registers/benefits `pending` | `benefit_value_line.value_state = 'submitted'` (view over `benefit_measurement.status`) | 1 → provisional |
| registers/benefits `realized_validated`, `realized_sustained` | `benefit_value_line.value_state` `validated` / `sustained` | 1 → validated |
| registers/benefits `baseline` | `benefit.baseline_validation_status` | 3 |
| registers/benefits `planned_value` | `benefit.planned_value`; n/a when `value_class = 'non_financial'` and no `valuation_method_id` (as `valueSarOf`) | 5/6 |
| charter (all fields) | `charter.*`, `north_star`, `outcome`, `strategic_guardrail` | 5/6 |
| registers/raid, kpis, decisions, dependencies, actions | the row's own columns | 5/6 (probability of a non-risk is n/a) |
| (for KBE-C2/D2) formula versions, baselines with record version, KPI actuals | `formulaVersionState`, `baselineState`, `kpiActualState` (accepted vs not; stale by `dq_stale_after_days`) | 2, 3, 4 |

- **Test** (`registers-report.test.ts` › REQ-S13-008):
  - a submitted measurement of 1000 shows `{value: "1000.0000", currency: "SAR", valueBasis: "submitted", validation: "provisional"}`, equal to the list route's `realized.pending`;
  - `provisionalValueCount ≥ 2` (the amount and its count; "is counted") and the source row is `provisional`;
  - the CX benefit's money value is n/a (`null`, no reason), and a missing planned value is Unknown, never 0;
  - each money column holds one value basis, and there are no totals.

### REQ-S13-010 (my part: snapshot evidence)

Acceptance: *"A01;A12: an uploaded file stores a SHA-256 checksum and version 1; a second upload becomes version 2"* (the register and versions are BE-O's).

- `listReportSnapshotEvidence` returns what a snapshot cites (charter: `evidence_link` to the charter; benefits: `benefit_evidence`; decisions, dependencies, actions: `evidence_link`) with `contentRevision` and `contentSha256` as they were.
- Test: an uploaded file linked to the charter is cited with revision 1 and the `evidence_content.sha256`. The 0080 trigger also checks the revision and checksum match.

### §F.1 refusal and mutation tests (all literal, all pass)

- 5,001 rows → 422 `report.too_large` with the exact text. No snapshot and no audit row are written; the live report is refused the same way; a narrower filter fits.
- Issue by WL → 403. Issuing a non-generated snapshot → 422 `report_snapshot.not_generated`. Reissuing a superseded one → 422 `report_snapshot.not_issued`. Two concurrent issues → 200 + 409 `report_snapshot.series_changed`.
- AUD → 403 on generate, issue, discard and reissue, with nothing written. An outsider gets 404.
- If-Match: 428 / 409 on issue, discard and reissue. Generate is a create (version 1).
- One audit event per row written: `report_snapshot.generate|issue|supersede|discard|reissue`.
- Commit-time re-authorization: grants revoked while the request waits → 403 with nothing written, for generate and for issue (`afterIdentity`/`revokeAll`).
- The other refusals, each with its exact text: `report.subject_invalid`, `report.period_not_allowed`, `report.period_required`, `report.parameters_invalid` (unknown register, settings on the charter, malformed JSON in the live query).

## 3. Checks (real exit codes; logs in `T-DG5-KBE-C-evidence/`)

Environment: Node 24.21.0, offline, worktree `/home/user/wt/dg5-kbe-c` at `09b7428` plus my uncommitted changes. Harness ports: 23900 (PostgreSQL 16.13; it bound on attempt 1), pool 23901–23949. Empty `.claude/.cc-writes` folders inside source folders were removed before each test run. Four W7 tasks ran concurrently.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 17:48Z) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-start.txt` |
| 2 | `pnpm -r typecheck` (final tree) | 0 | — | `typecheck.txt` |
| 3 | `pnpm -r build` (final tree) | 0 | — | `build.txt` |
| 4 | `pnpm lint` (final tree) | 0 | — | `lint.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | 0 | "All matched files use Prettier code style!" in every batch | `prettier.txt` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.txt` |
| 7 | `env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test` (locale unset) | **1** | unit-node 105 files, **1885/1885**; unit-web **1384/1385** (1 failure, below); unit-formula-nocodegen 259 passed + 2 skipped by design | `unit-locale-unset.txt` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | identical: 1885/1885; 1384/1385; 259 + 2 skipped | `unit-locale-c-utf8.txt` |
| 9 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **226/226 files, 2202/2202 tests**, 1770.6 s (18:58Z–19:28Z) | `integration.txt` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-end.txt` |

**Rows 7 and 8: why `pnpm test` exits 1.** It is one unit-web failure, the same in both locales: `apps/web/src/i18n/glossary.test.ts` › "spells the Transformation term consistently (with shadda…)". The offender is `prioritization.weights.intro` in the Arabic catalogue.

- This is the defect D-149 records as merged at W6 ("the Arabic `prioritization.weights.intro` … writes the Transformation term without the shadda"). It is assigned to the W7 repair task T-DG5-FE-A2.
- `apps/web` is byte-identical to `HEAD` in this tree (`web-unchanged.txt`), and my change touches no web file. So the failure is not caused by this task, and I did not edit the FE-owned file.
- Every other unit test passes in both locales. Acceptance item 2 therefore holds for everything this task touches, but literally `pnpm test` exits 1 until FE-A2 merges. I report that as it is.

**Failures during development (disclosed, all fixed before the final runs):**

- **First full unit run:** two failures in unit-node, both caused by me.
  - `advisory-locks.test.ts`: the registry test forbids spelling a lock-class number outside the registry, and my comments in `snapshots.ts` and `db-errors.ts` contained it. The comments now name `ADVISORY_LOCK_CLASSES`.
  - `server.test.ts`: it pinned "no report route until P5", which my routes made untrue. It now pins the 11 routes (§1).
- **First targeted run of `report-snapshots.test.ts`:** one failure, a test bug. I used `limit=200` where the API caps the limit at 100.
- Every later run (targeted integration files 11/11 and 4/4, contract 73/73, unit 31/31, then the full runs above) passed.

**New tests by this task:** unit 31 (`provisional.test.ts` 22, `report.test.ts` 6, `db-errors-p5-reports.test.ts` 3); integration 15 (`report-snapshots.test.ts` 11, `registers-report.test.ts` 4); plus the KBE-C contract exercise inside the existing `contract.test.ts` "P5 KBE-C operations" test, which already counted (73 tests in that file, unchanged).


## 4. Operations routed (delta to `p5-pending-kbe-c.ts`) and pinned counts

- **Removed from `P5_PENDING_KBE_C` (11 → 0):** `listReportDefinitions`, `getLiveReport`, `generateReportSnapshot`, `listReportSnapshots`, `getReportSnapshot`, `listReportSnapshotSources`, `listReportSnapshotVersions`, `listReportSnapshotEvidence`, `issueReportSnapshot`, `discardReportSnapshot`, `reissueReportSnapshot`.
- Each is exercised in `p5-exercises-kbe-c.ts`, with its zod mirror, through the success and every reachable declared refusal.
- **Media-type pin:** +4 JSON bodies (generate, issue, discard, reissue): `[349, 348, 1]` → `[353, 352, 1]`, edited in `contract.test.ts` with a comment line. The orchestrator reconciles it with the other W7 deltas.
- **Rate-limit floor:** no change. **Operation count:** no change (the contract has 846 operations; these 11 already existed and were pending).

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **No dependency** was needed. **No migration** was needed (`0083` unused).
2. **`report_snapshot.issued` outbox event.** The v1 payload schema is `reportSnapshotIssuedV1` in `report.ts`. `snapshots.ts` writes the event in the issuing transaction (idempotency key `report_snapshot.issued:<id>`, `ON CONFLICT DO NOTHING`), but **only once `outboxPayloadSchema("report_snapshot.issued", 1)` is registered**.
   - Registering it means a line in `packages/shared/src/schemas/events.ts` `OUTBOX_EVENT_SCHEMAS` plus a worker queue in `QUEUES_FOR_EVENT`. Neither file is mine.
   - The relay throws `no queue for event type …` for an event without a queue, so writing it before its consumer exists would leave failing outbox rows.
   - **Request:** add both lines together with KBE-E's consumer (ADR-0047). No API change is needed then. Until then no event is written, and I state that plainly.
3. **The register list routes keep their query schemas and presenters module-private**, and `workflows` is outside reporting's module boundary.
   - So `registers.ts` restates each list route's table, predicates and order. The parameters reuse the shared `benefitListQuery`, `raidEntryType`, `raidStatus`, `decisionKind` and friends.
   - `registers-report.test.ts` compares every register with its route, so any drift fails a test.
   - Cleaner seam (optional): export the list queries from `raid/index.ts`, `benefits/index.ts` and `kpi/index.ts`. `workflows` would need a port, because reporting may not import it.
   - The benefits pending, validated and sustained sums restate `realizationFor`'s rule (`sumDecimals` over the same `benefit_value_line` states, `toColumnString(MONEY_COLUMN)`), and the test proves it equals the route's `realized.pending`.
4. **Definitions without an assembler answer 404** (after the subject and period checks) until KBE-C2, KBE-D and KBE-D2 add their lines to `assembler.ts`. ADR-0045 §11 has no code for this, and it is transitional within DG5.
5. **An unknown or foreign `reportingPeriodId`** on an output that needs a period answers 422 `report.period_required`, because ADR-0045 §11 has no "period not found" code. If the orchestrator prefers a dedicated code (e.g. `report.period_invalid`, "The reporting period does not exist in this organization."), it is a one-line change.
6. **KPI register target column:** targets of different KPIs have different units, so the target is a text cell (the decimal string, `authored: system`). The unit kind is shown in the column beside it, which keeps one column from mixing units as numbers.
7. **`registers` approval state** is `not_applicable` for all six registers, because none of their record types carries an approval state in the list routes. `charter` uses the G1 gate status (`gate_instance.status`; ADR-0045 §3 "the charter's approval state").
8. **i18n keys** (for FE-E's web catalogue, and for BE-M/BE-N's export label table), en and ar:
   - **Problem codes:** `report.subject_invalid`, `report.period_required`, `report.period_not_allowed`, `report.parameters_invalid`, `report.too_large`, `report_snapshot.not_generated`, `report_snapshot.not_issued`, `report_snapshot.series_changed` (the ADR-0045 §11 texts).
   - **Content label keys:**
     - `report.charter.{title, transformation_name, executive_sponsor, transformation_lead, case_for_change, in_scope, out_of_scope, baseline_date, target_horizon, target_horizon_unit, governance_forum, decision_rights, success_definition, thesis_change, thesis_outcomes, thesis_benefits, thesis_because, approval_state, north_star, top_outcomes, rank, outcome, status, guardrails, guardrail, category, statement}`
     - `report.registers.{filters, no_filters}`
     - `report.registers.<register>.{title, <column>}`: raid `code, type, description, impact, probability, owner, due_date, mitigation, status`; benefits `code, title, benefit_type, value_class, baseline, baseline_unit, target, planned_value, realized_validated, realized_sustained, pending, pending_count, owner, status, lifecycle_step, counting`; kpis `name, unit_kind, polarity, frequency, owner, status, active_version, target`; decisions `code, title, kind, owner, due_date, status, outcome, decided_at`; dependencies `code, description, from, to, dependency_type, needed_by, owner, impact, status`; actions `title, source_kind, owner, due_date, status, overdue`
     - `report.empty.no_records`
   - **Code-value prefixes** (`<prefix>.<value>`): `report.horizon_unit`, `report.approval_state`, `report.outcome_status`, `report.guardrail_category`, `report.raid_type`, `report.raid_level`, `report.raid_status`, `report.benefit_type`, `report.benefit_value_class`, `report.rag`, `report.benefit_step`, `report.benefit_counting`, `report.kpi_unit_kind`, `report.kpi_polarity`, `report.kpi_frequency`, `report.kpi_status`, `report.decision_kind`, `report.decision_status`, `report.dependency_type`, `report.dependency_status`, `report.action_source`, `report.action_status`, `report.yes_no`.

## 6. User-facing texts made untrue (F-DG4-160)

None. This task ships API only.

- The web reports screens (`transformations/:id/reports`, `…/:snapshotId`) still show the honest `nav.p5.notAvailableBody` placeholder ("…is being built. It is not available yet…"). That stays true until FE-E builds them.
- `nav.areas.reports.summary` ("Generated reports and their issued, unchangeable snapshots.") describes the area and is true.
- `apps/web` is unchanged (`T-DG5-KBE-C-evidence/web-unchanged.txt`).

## 7. What remains

- Nothing of §F.1 remains open beyond §5 item 2 (event registration, which needs the KBE-E consumer).
- The separable successor work is KBE-C2: the diagnostic, TOM, business-case, roadmap and gate-pack assemblers.
- **Merge notes.** Expect additive conflicts in:
  - `contract.test.ts` (the media-type pin: sum the W7 deltas);
  - `server.test.ts` (if another W7 task also edits it);
  - `packages/shared/src/schemas/index.ts` and `platform/db-errors.ts` (append-only blocks).
