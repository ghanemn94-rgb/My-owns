# ADR-0050: The demonstration environment: isolation in a separately initialized database, the synthetic flag and labels, production refusal and the empty production initialization, the International Roaming dataset and its three traceability chains, deterministic seed and reset (record counts and checksums), the seed-coverage check, and the guided walkthrough

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-06), 2026-10-14.
- **Requirements (slice J of `docs/architecture/p5-plan.md`):** REQ-PB-088, REQ-PB-089, REQ-PB-090, REQ-S18-001, REQ-S18-002, REQ-S18-003, REQ-S18-004.
- **Sources (quoted where a design point has one):**
  - B0143 "Example — International Roaming Transformation"; B0144 "Illustrative example only. Replace assumptions with validated company data."; B0145, the seven elements, e.g. "North Star | Make international roaming effortless, trusted and economically accretive."; B0146–B0147, the three chains, e.g. "Low activation | Proposition + journey | Pass redesign + digital activation | Attach rate / activation | Revenue uplift".
  - M0090 "Demonstration data must be explicitly marked and isolated from production."; M0339 "Create a separate, resettable demonstration environment … Clearly mark every example and added number as synthetic, not Mobily actual performance."; M0340–M0347 (the preserved example); M0348 "Seed enough coherent records to exercise every phase, gate and numbered template, all ten TOM dimensions, all six dashboard areas, the 25-question assessment, pending approvals, missing evidence, a stale KPI, an overdue decision, a shared benefit, an adoption gap and a BAU handover. Link the examples rather than creating unrelated sample cards. Keep an empty production initialization path that excludes demo records and demo credentials."; M0349 "Include a guided walkthrough: create transformation → diagnose and agree baseline → … → continue performance monitoring."; M0412 "a demo Sponsor approval does not approve a real Mobily transformation."
- **Decisions applied:** D-141, D-142 (**Q7** "A separately initialized demo database selected by configuration; the `seed-demo`/`reset-demo` CLI is refused when `MTH_ENV=production`. Any compose-profile change is requested from devops through the orchestrator, additively."; **R7** "a deterministic demo seed"; R1), D-143–D-148; D-088 §2, F-DG3-100.
- **Builds on:** ADR-0003, ADR-0004, ADR-0005 (dev login refused in production), ADR-0008 (worker and job kit), ADR-0011 (packaging), ADR-0016 (lock registry), every P2–P5 engine the dataset seeds, ADR-0045/ADR-0046 (reports and exports, which carry the label), ADR-0049 §9 (the navigation areas the walkthrough points to).
- **Physical model:** `0090_p5_demo_environment_walkthrough.sql`, `0091_p5_reader_branding_demo_permissions.sql`. The guard probe (`docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/probe-output.txt`) tests this ADR's database claims in groups G04, S06, S07, EN01–EN08, DM01–DM13, WK01 and AO01.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Every approval in the demo database (G1–G6 decisions, Finance validations, executive decisions) is **synthetic and approves nothing real**; no agent, seed or job grants a real business, Finance or IT approval.

## Context

1. `packages/db/src/cli.ts` has `migrate`, `status`, `bootstrap` (the secure first administrator, ADR-0005) and `seed-dev` (synthetic dev-login users, refused with `NODE_ENV=production` or `AUTH_MODE != dev`). There is no demo command and no environment marker.
2. `admin/environment.ts` is a BE-A stub. `source_element` `roaming_example.international_roaming` (`0064`) has `feature_status = 'planned'`.
3. Audit events and P2 history tables are append-only even for the owner (`0003`, `0010`: UPDATE, DELETE and TRUNCATE raise), so a demo reset cannot empty a database in place without disabling those protections.

## Decision

### 1. Isolation (REQ-S18-001, REQ-S18-003; D-142 Q7)

- **A demo environment is its own database**, initialized only by `mth-db seed-demo` and used only by a deployment whose configuration names it. Production never shares it. A new configuration key `MTH_ENV` (`production` | `demo` | `development` | `test`; default `production` when `NODE_ENV=production`, else the `NODE_ENV` value) states the deployment's environment (BE-S, `packages/config`). A demo deployment sets `MTH_ENV=demo` explicitly.
- **`deployment_environment`** (`0090`): at most one row (`singleton` PK), written once by the initializing command (the owner) and append-only (UPDATE, DELETE and TRUNCATE raise even for the owner). So a production database never becomes a demo database, and the reverse.
  - `bootstrap` writes `environment_kind = 'production'`, `initialized_via = 'bootstrap'`.
  - `seed-demo` writes `'demo'`, `'seed_demo'`, `dataset_code = 'international_roaming'`, `dataset_version` and `synthetic_clock_at` (`deployment_environment_kind_via`, `deployment_environment_demo_dataset`).
- **No row** (a database migrated before P5, or never initialized through P5) is reported as `production`. This is fail-safe: no synthetic label appears on data that might be real, and demo seeding into a non-empty database without a demo marker is refused (§3). The migration itself writes no row, no demo record and no branding (probe G04).
- **Packaging.** The compose profile `demo` (a demo database service, the demo deployment's `DATABASE_URL`, `MTH_ENV=demo`, the demo IdP issuer and, for the in-app reset only, `MTH_DEMO_ADMIN_DATABASE_URL`) is a devops change. It is requested through the orchestrator (D-142 Q7) and is additive. P5 implements and tests the commands against disposable clusters.

### 2. The synthetic flag and the labels (REQ-S18-001, REQ-PB-089, REQ-S21-001)

- **The flag is the environment.** Every record in a demo database is synthetic, including those that demo users add during the walkthrough ("every example and added number", M0339), because a demo database never holds production data (§1). `GET /environment` (session) returns `{kind, synthetic, datasetCode, datasetVersion}`, with `synthetic = (kind = 'demo')`.
- **Each seeded record is also registered** in `demo_seed_record` `(record_type, record_id, fixture_key)`. The trigger `demo_seed_record_demo_only` accepts it only in a demo database, and `demo_seed_record_ref` only for an existing row of a table with a uuid `id`. It is append-only. The coverage check (§5) and the checksum (§4) read it, and in a production database it is empty by construction.
- **Labels (en and ar, render-time i18n):**
  - (a) the web shell shows a persistent banner on **every screen** while `synthetic`: "Illustrative example — synthetic. Not Mobily actual performance." / "مثال توضيحي — بيانات اصطناعية. ليست أداء موبايلي الفعلي.";
  - (b) every record view and form header shows the badge "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي" (`components/demo-label/**`, FE-G);
  - (c) every **product-gate decision, approval and Finance validation** shown in a demo database carries "Synthetic demonstration - approves nothing real" / "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي" (REQ-S21-001, M0412);
  - (d) every **report and export** generated in a demo database carries the illustrative label in its header and on every page or sheet: the layout reads `GET /environment`'s source through an `EnvironmentReadPort` at generation time, and the report snapshot records `synthetic: true` in its content (REQ-PB-089 "every demo record and exported demo report shows the illustrative label in en and ar").
- The B0144 sentence "Illustrative example only. Replace assumptions with validated company data." is shown verbatim on the roaming transformation's overview.

### 3. Production refusal and the empty production initialization (REQ-S18-003, REQ-PB-088)

**`mth-db seed-demo`** exits with code **3** and changes nothing when any of these holds:
- (a) `MTH_ENV=production`;
- (b) the database's marker is `production`;
- (c) the database has no marker and is not empty: it has at least one `transformation` or at least one `app_user`;
- (d) the database already has a demo marker. A seeded demo database is re-seeded only through `reset-demo`.

It prints `mth-db seed-demo: refused: <reason>`, where the reason is one of:
- `MTH_ENV is production`;
- `this database was initialized for production`;
- `this database is not empty`;
- `this database is already a demo database; use reset-demo`.

**`mth-db bootstrap`** refuses (exit 3) on a database with a demo marker. Otherwise it writes the production marker if absent, then creates only the reference data the migrations already hold and the secure administrator bootstrap (ADR-0005). It creates no demo record and no demo user, and stores no demo credential.

**Demo users** are `app_user` rows of the dataset, registered as `roaming.user.<role>`. Their identities name the demo IdP issuer configured only in a demo deployment. No password or secret is in the repository.

REQ-S18-003's query: after production initialization, `SELECT count(*) FROM demo_seed_record` = 0 and no `app_user` is registered there (probe EN07). REQ-PB-088's "the production initialization contains no demo records" is the same query.

### 4. The dataset, its determinism, the counts and the checksum (REQ-PB-088, REQ-PB-090, REQ-S18-001; D-142 R7)

**Dataset `international_roaming` 1.0.0** (`packages/db/src/demo/data/**`, BE-T and KBE-H; all numbers synthetic):
- one roaming transformation (end-to-end mode) carrying the seven B0145 elements **verbatim**:
  - the case for change: "Roaming has value leakage from low adoption, fragmented propositions, inconsistent digital activation and avoidable CX friction.";
  - the North Star, exactly "Make international roaming effortless, trusted and economically accretive." (REQ-PB-088's acceptance);
  - the outcomes, the TOM focus, the initiatives, the governance and the benefits, each split into its records;
- the **three B0147 chains** as linked records in the DG4 traceability model:
  - Low activation → Proposition + journey → Pass redesign + digital activation → Attach rate / activation → Revenue uplift;
  - High complaints → Journey + service assurance → Proactive comms + QoS monitoring → Complaint rate → CX + care cost;
  - Partner cost pressure → Partner model + analytics → Partner optimization → Cost/MB, margin → Margin improvement.

  Each chain runs diagnostic item → TOM gap → initiative → KPI → benefit, and the DG4 traceability view shows each one as one line (REQ-PB-090's acceptance names the first).

**Determinism (S18-001 "running the reset twice yields identical record counts and checksums"):**
- every seeded id is a fixed literal UUID in the namespace `01995000-…`;
- every seeded timestamp and date is derived from the **synthetic clock** `2026-09-01T06:00:00Z` (09:00 Asia/Riyadh), stored in `deployment_environment.synthetic_clock_at`;
- nothing seeded reads `now()`, `random()` or `gen_random_uuid()`;
- rows are inserted in a fixed order, with one audit event each (fixed ids, `source = 'cli'`).

**Record counts:** `{<table>: count(*)}` for every base table of schema `public` except `demo_dataset_run`, ordered by name.

**Checksum:** SHA-256 over the lines `<table>\t<record_id>\t<row>`, one per registered `demo_seed_record` row, sorted by `(record_type, record_id)`, and then a line per `demo_seed_record` row. `<row>` is `to_jsonb(row)` minus every column whose default is `now()`, `CURRENT_TIMESTAMP`, `CURRENT_DATE` or `transaction_timestamp()` (read from `information_schema.columns` at run time), serialized by PostgreSQL's `jsonb` text output, which is deterministic for equal values.

Both are computed by `packages/db/src/demo/checksum.ts` (BE-S) in the seeding transaction and stored in `demo_dataset_run` (§6).

### 5. The seed-coverage check (REQ-S18-002)

`packages/db/src/demo/coverage.ts` (BE-S framework; conditions completed by BE-T) runs one count query per condition, over persisted rows of the roaming transformation:
- T01–T16: at least one record of each template's table, from `methodology_element_profile`/`source_element.feature_ref`;
- G1–G6: a gate instance each;
- the six phases;
- the ten TOM dimensions: a canvas cell each;
- the six dashboard areas: data for each `t10_area_definition` area;
- one submitted 25-question health assessment;
- a stale KPI;
- an overdue decision;
- a shared benefit: one benefit allocated to at least two initiatives;
- an adoption gap;
- a BAU handover;
- missing evidence: a mandatory evidence item with none attached;
- a pending approval.

"Stale" and "overdue" are relative to the synthetic clock, and stay so in real time because their due dates are in the past.

The result `{condition: count}` and `coverage_complete` are stored in each dataset run. The integration test `packages/db/src/demo/coverage.test.ts` seeds a disposable demo database and asserts every count ≥ 1 (REQ-S18-002's seed-coverage test). Every condition is a linked record of the one transformation: there are no unrelated sample cards (M0348).

### 6. Seed and reset (REQ-S18-001)

- **`mth-db seed-demo`** (owner URL; refusals §3), in one transaction:
  1. write the demo marker;
  2. insert the dataset with its audit events;
  3. register every record;
  4. move `source_element` `roaming_example.international_roaming` to `working`. This is done by BE-T's migration `0093` (the p5-work-split §A rule A-7), which updates that one row only;
  5. compute counts, checksum and coverage;
  6. insert `demo_dataset_run` run 1 (`run_kind = 'seed'`, `requested_via = 'cli'`).

  It prints the counts and the checksum.
- **`mth-db reset-demo`** (needs `MTH_ENV=demo` and `MTH_DEMO_ADMIN_DATABASE_URL`, a role with CREATEDB that owns the demo database; otherwise exit 3):
  1. take the **session** advisory lock 730271 (key `demo`) on the maintenance database `postgres`;
  2. check that the target database's marker is `demo`;
  3. `DROP DATABASE … WITH (FORCE)`, `CREATE DATABASE … OWNER mth_owner ENCODING 'UTF8'`;
  4. `migrate`, then the seed transaction, with `run_kind = 'reset'`.

  Re-creating the database is the reset: the append-only protections of `0003`/`0010` are never disabled, and two resets give identical counts and checksums (§4). The previous demo database's audit trail goes with it: a demo reset discards synthetic data by design. The reset itself is recorded in the new database's run 1 and in the operations log.
- **In-app reset** (`requestDemoReset`, `POST /admin/environment/demo-resets`, `demo.reset`, `If-Match` = the latest run number). Refused with 409 `environment.not_demo` unless the marker is `demo`. It enqueues the job `demo.reset`, singleton key `demo`, and answers 202. The worker of a demo deployment acknowledges the job, then runs the same reset with `requested_via = 'api'` and `requested_by` = the requester's fixed demo user id. That id is re-created by the seed; `demo_dataset_run.requested_by` deliberately has no foreign key. A worker without `MTH_DEMO_ADMIN_DATABASE_URL` fails the job with `demo_reset.not_configured`, and the API reports that state in `getDemoEnvironmentStatus.resetConfigured`. If the worker stops mid-reset, the CLI is the recovery path. The job is acknowledged before the drop, so it is never retried into a second drop.
- **`demo_dataset_run`** (append-only): numbered from 1 (`demo_dataset_run_step`); only in a demo database, for its own dataset version and clock (`demo_dataset_run_demo_only`); an API request is always a reset with a requester (`demo_dataset_run_api_reset`, `demo_dataset_run_requester`).

### 7. The guided walkthrough (REQ-S18-004)

**Entity `walkthrough_step`** (catalogue; `0090`, 12 rows, M0349 verbatim titles, provisional Arabic): `code`, `ordinal`, `title_en`, `title_ar`, `area_code` (an ADR-0049 §9 area) and `completion_rule`.

`getDemoWalkthrough` (`GET /demo/walkthrough?transformationId=`; session; 409 `environment.not_demo` outside a demo database) returns the twelve steps for the transformation the demo user created in step 1. Each step has its area, the web route to perform it and `completed`, which is evaluated **from persisted records** of that transformation:

| # | Step (M0349) | completion_rule: done when the transformation has … |
|---|---|---|
| 1 | create transformation | `transformation_created`: the transformation exists and was created in this demo database (not a seeded record) |
| 2 | diagnose and agree baseline | `baseline_agreed`: a baseline in the DG2 agreed state |
| 3 | define outcomes/KPIs | `outcomes_kpis_defined`: an outcome with a linked KPI definition |
| 4 | design TOM | `tom_designed`: a target-state canvas cell and a TOM gap |
| 5 | prioritize initiatives and approve mobilization | `mobilization_approved`: a scored initiative and an approved G4 decision (synthetic) |
| 6 | update delivery/adoption | `delivery_adoption_updated`: an owner update and an adoption measurement |
| 7 | submit KPI actual | `kpi_actual_submitted`: a submitted KPI actual |
| 8 | validate benefit | `benefit_validated`: a Finance-validated benefit measurement (synthetic) |
| 9 | resolve executive decision | `executive_decision_resolved`: a resolved executive decision |
| 10 | generate report | `report_generated`: a generated report snapshot |
| 11 | accept BAU handover | `bau_handover_accepted`: an accepted BAU handover |
| 12 | continue performance monitoring | `performance_monitoring_continued`: a KPI actual or control check dated after the handover's acceptance |

Each step is performed with the native workflows by the demo role users (SP, TL, BO, FIN, TO …). The guide only explains and links; it writes nothing. QA-E's A02 e2e performs all twelve and verifies the resulting records (REQ-S18-004's acceptance). Every approval in it is synthetic and labelled so (§2).

### 8. Authorization (permissions matrix §23)

| Operation group | Permission | Role defaults (`0091`) |
|---|---|---|
| `GET /environment`, `GET /demo/walkthrough` | session | every signed-in user (the walkthrough answers only in a demo database) |
| `GET /admin/environment` (status, counts, checksum, coverage), `POST /admin/environment/demo-resets` | `demo.reset` | ADM_TECH |
| `seed-demo`, `reset-demo`, `bootstrap` | operator credentials (owner or admin URL), not an application permission | IT / devops |

AUD gets 403 on the reset (it does not hold `demo.reset`). `demo.reset` is a `configure` code and never a business approval. The reset request re-checks its permission at commit, needs `If-Match` (428/409), writes an audit event in the current database before the job runs, and does no remote I/O inside the transaction.

### 9. Refusal codes and texts (exact)

| Status / exit | Code | English text (exact) |
|---|---|---|
| 409 | `environment.not_demo` | This is available only in the demo environment. |
| 409 | `demo_reset.in_progress` | A demo reset is already running. |
| 409 | `demo_reset.not_configured` | Demo reset is not configured for this deployment. |
| CLI exit 3 | — | `mth-db seed-demo: refused: <reason>` with the four reasons of §3; `mth-db reset-demo: refused: <reason>` (`MTH_ENV is not demo`, `MTH_DEMO_ADMIN_DATABASE_URL is not set`, `the target database is not a demo database`); `mth-db bootstrap: refused: this database is a demo database` |

### 10. Locks and jobs

- **730271** `demoReset`, one class-wide key `demo`: a **session** lock on the maintenance database of the demo cluster, held by the CLI or the worker for the whole reset. Seeding into a fresh database takes it too.
- 730272 is reserved for this block.
- Job `demo.reset` (on-demand, singleton key `demo`, no schedule).

## Alternatives considered

- **A per-row `is_synthetic` column on every business table.** This would change about 150 DG1–DG4 tables (a reopen of approved schemas) for a flag that is constant per database. Rejected for the environment-level flag plus the fixture registry.
- **Resetting in place** (TRUNCATE after `ALTER TABLE … DISABLE TRIGGER` on the audit and history tables). It would add a code path that switches off the append-only protections. Rejected for drop and re-create.
- **One shared database with a demo organization.** M0339 and REQ-S18-001 require "never shares a database with production". Rejected.
- **Random ids and `now()` in the seed with a checksum over "business columns" chosen by hand.** Hand-chosen columns drift as tables grow. Rejected for fixed ids, the synthetic clock and a rule computed from the catalogue.

## Consequences

- `packages/db/src/cli.ts` gains `seed-demo` and `reset-demo`, and `bootstrap` gains the marker line. These are additive to the DG1 commands; `seed-dev` is unchanged.
- `packages/config` gains `MTH_ENV` and `MTH_DEMO_ADMIN_DATABASE_URL` (BE-S), and the compose `demo` profile is requested from devops.
- The dataset must keep pace with later schema changes: the coverage test fails when a condition loses its record.
- A reset discards everything that demo users added, by design.

## Verification

- Probe: G04, S06–S07, EN01–EN08, DM01–DM13, WK01, AO01 (the slice J part of 96/96).
- BE-S tests: the CLI refusals (§3, exit 3 and no change); seed then reset twice on a disposable cluster gives identical counts and checksums; the production path then the REQ-S18-003 query gives 0 and 0; the API reset in a production database gives 409 `environment.not_demo`; AUD gets 403; `If-Match` gives 428/409.
- BE-T and KBE-H tests: the North Star equals B0145 verbatim; the three chains render in the traceability view; `coverage.test.ts` passes every condition.
- FE-G: the banner, badges and approval labels in en and ar; QA-E: A02 with the twelve steps.
