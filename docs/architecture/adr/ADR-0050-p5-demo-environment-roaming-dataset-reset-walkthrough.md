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
  - (d) every **report and export** generated in a demo database carries the illustrative label in its header and on every page, slide or sheet (a CSV: its first row). Report generation reads `GET /environment`'s source at generation time through reporting's `ReportEnvironmentPort`, the `synthetic` slice of `EnvironmentReadPort`. The report snapshot records `synthetic: true` in its content, and the renderers print the label from that recorded member (REQ-PB-089 "every demo record and exported demo report shows the illustrative label in en and ar"). _Corrected 2026-10-17 (T-DG5-ARCH-R1, amendment D4): this sentence named `EnvironmentReadPort` as the reader and "every page or sheet" as the placement._
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

_Amended 2026-10-18 (T-DG5-ARCH-R4, amendment D7): the transformation is created in Diagnose and advanced to Transform by the synthetic G1–G4 approvals; G5 and G6 are not submitted._

_Amended 2026-10-18 (T-DG5-ARCH-R5, amendment D11): G4 rests on a real approved portfolio of INI-01..03 (ranking snapshot 1, three selections, three funding decisions DEC-02..DEC-04, initiative cases BC-02..BC-04, three resourcing roles with 18 capacity rows and 18 committed demands, six approved milestones), with no gate exception; the three initiatives are launched after G4._

_Amended 2026-10-19 (T-DG5-ARCH-R6, amendment D16): each of INI-01..03 also carries three key deliverables, linked to a capability change that is linked to the chain's outcome KPI (2 new capabilities, 9 deliverables, 12 trace links). Each B0147 line above still has exactly five nodes; each initiative now also reaches its KPI through deliverable → capability change → KPI (M0097), beside the line (D17)._

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

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-163, D-165, D-166): §2–§3 and §7, the demo access administrator, the business-unit grants, the dev-mode binding and the export labels

Sources: D-163 (F-DG5-qa-c-2), D-165 (QA-E D-QA-E-1, and the dev-mode demo sign-in), D-166 (the accepted demo access administrator), and the handbacks of T-DG5-BE-T3 (§3.1, §3.2) and T-DG5-BE-N2 (§1, §6.1). Nothing above is removed, except the one §2 (d) sentence corrected in place. Where this amendment and §2, §3 or §7 differ, this amendment wins. No migration: these are dataset rows (`packages/db/src/demo/**`).

### D1. The demo access administrator `roaming.user.adm_access` (T-DG5-BE-T3; D-165 D-QA-E-1, D-166)

- **Why it exists.** ADR-0020 §5 lets only `access.assign` grant the approver roles SP, BO and FIN on a transformation (D-166). The demo database has no other access administrator, because `mth-db bootstrap` refuses a demo database (§3).
- **What it is.** The dataset seeds one more user, `roaming.user.adm_access` (`packages/db/src/demo/data/roaming.ts:110`, `DEMO_ACCESS_ADMIN`). It has an `app_user` row, a demo IdP identity and fixed ids, and holds **ADM_ACCESS at the demo business unit**.
  - ADM_ACCESS is a `technical_admin` role. It holds no business-record permission and no approval permission. Its self-grant is refused (422 `access.self_grant`).
- **Lists.** It is **not** in `DEMO_USERS`, which stays the eight role users. It is in `DEMO_SIGN_IN_USERS` (`roaming.ts:118`), the nine users who can sign in.
- **Determinism.** Every new row has a fixed id and the synthetic clock, so the reset-twice and seed-twice checks of §4 still compare equal, run against run. The dataset's checksum and counts changed once with this addition. The "after" values measured by BE-T3 (handback §3.1) are 417 seeded records in any non-dev mode, and 426 with the dev binding (D3).

### D2. The business-unit grants: TL, TO and ADM_ACCESS only (T-DG5-BE-T3; D-165 D-QA-E-1)

`DEMO_BUSINESS_UNIT_GRANTS` (`roaming.ts:132`) are the least-privilege set that acts on a **new** transformation of the demo business unit. A business-unit grant reaches a new transformation only as `access/rules.ts` `grantApplies` allows:

| Grant at the demo business unit | What it gives on a new transformation |
|---|---|
| TL | `transformation.create`; the creator then holds TL on the new transformation (the DG1 creator carry-over, F-DG1-106) |
| TO | `transformation.create`; TO inherits downward, so it holds TO on every transformation of the unit |
| ADM_ACCESS (`roaming.user.adm_access`) | `access.assign` is structural, so it assigns SP, BO and FIN natively (`POST /role-assignments`) |

**Why the other roles get none.**
- SP, BO, FIN, KDS, WL and CM do not inherit downward. A business-unit grant of one of them applies only to business-unit-level targets, never to a transformation of the unit, so it would reach nothing.
- On a new transformation, the TL team-assigns WL, KDS and CM (`team.assign`). The access administrator assigns SP, BO and FIN. The team view refuses an approver role.
- The eight transformation-scope grants on the seeded roaming transformation are unchanged, and there is no organization-scope grant.

Requirement row: REQ-S18-004 (A02: "all twelve walkthrough steps with the demo role users"). Tests: `apps/api/test/integration/environment/demo-users-new-transformation.test.ts` and `packages/db/test/integration/demo-roaming.test.ts`.

### D3. §3: the dev-mode binding to the dev issuer (D-165; T-DG5-BE-T3)

§3 binds the demo users to the demo IdP, which only a demo deployment has. No browser could therefore sign them in on the `AUTH_MODE=dev` e2e stack.

- **What the binding adds.** `mth-db seed-demo` and `mth-db reset-demo` add one `user_identity (DEV_ISSUER, roaming.user.<role>)` per `DEMO_SIGN_IN_USERS` entry: nine rows, registered and audited, with fixed ids and deterministic. `POST /auth/dev-login` can then choose these users.
- **When it applies.** Only when the rule `demoDevIssuerBindingAllowed` holds (`packages/db/src/demo/guard.ts:125`): `AUTH_MODE === "dev"` **and** `NODE_ENV !== "production"`. The CLI (`packages/db/src/cli.ts:53`) applies the same rule as `seed-dev`, and passes the result to the seed and the reset as `devIssuerBinding`.
- **Refused elsewhere.** In production mode (`NODE_ENV=production`, even with `AUTH_MODE=dev`), and in every other auth mode (for example `AUTH_MODE=oidc`), no dev identity is created.
- **What does not change.** There is no secret and no password. The nine demo IdP identities are unchanged. The production initialization path (§3, REQ-S18-003) is untouched.
- **Test.** `packages/db/test/integration/demo-dev-binding.test.ts` runs the real CLI in three modes, plus the pure rule.
- **In-app reset (T-DG5-BE-T4, W21; merged, D-167).** _Brought to the built state 2026-10-17 (T-DG5-ARCH-R2): at `6f8ce12` the worker did not pass `devIssuerBinding`._ As merged, the worker's in-app reset keeps the dev binding under the same rule as the CLI:
  - `demoResetSettingsFromEnv` sets `devIssuerBinding` from `demoDevIssuerBindingAllowed({NODE_ENV, AUTH_MODE})` (`apps/worker/src/handlers/demo.ts:61–68`; the rule imported from `@mth/db`, `demo.ts:17–20`, exported at `packages/db/src/index.ts:60`, defined at `packages/db/src/demo/guard.ts:125–130`);
  - `handleDemoReset` passes `devIssuerBinding: s.devIssuerBinding === true` to `resetDemo` (`demo.ts:110`), so absent means false and nothing is bound;
  - a reset from the Environment screen in an `AUTH_MODE=dev`, non-production stack therefore re-creates the nine dev identities, and in every other mode none (`demo.ts:9–13`, header).
  - Tests: `apps/worker/src/handlers/demo.test.ts:15–35` (the setting is true with `AUTH_MODE=dev` and `NODE_ENV` `development` or `test`, and false without `AUTH_MODE=dev`, including `AUTH_MODE=oidc`); `apps/worker/test/integration/demo-reset-dev-binding.test.ts` (on a real PostgreSQL, `handleDemoReset` acknowledges the request and passes the binding to a recording stand-in of `resetDemo`: true in a dev-mode stack, false otherwise).

**§7 reading.** The walkthrough's steps are performed by the demo role users and, for the approver roles on the new transformation, after `roaming.user.adm_access` assigns them. The guide still writes nothing.

Requirement rows: REQ-S18-004 (the browser path) and REQ-S18-003.

### D4. §2 (d): the export labels as implemented (D-163; T-DG5-BE-N2)

The §2 (d) sentence is corrected in place (marked "Corrected 2026-10-17"). As built:

- **Reader.** Report generation reads the environment through reporting's **`ReportEnvironmentPort`** (ADR-0045 amendment O2). It wraps the same `readDeploymentEnvironment` source with the same rule as `EnvironmentReadPort`, because ADR-0002 keeps `reporting` from importing `admin`.
- **Recording.** A snapshot assembled in a demo database records `synthetic: true` in its hashed content (ADR-0045 amendment O1).
- **Rendering.** The renderers print "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي" from that recorded member only (ADR-0046 amendment E2):
  - PDF and DOCX: in the header and on every page;
  - PPTX: on every slide;
  - XLSX: as the first row of every sheet;
  - CSV: as the first row.
- **Production.** A production snapshot has no member and no label.
- **Unchanged.** §2 (a)–(c), the banner, the record badge and the synthetic approval label (`apps/web/src/components/demo-label/**`), are unchanged.

Requirement rows: REQ-PB-089 and REQ-S18-001.

Every approval in the demo is synthetic and approves nothing real. Product gates G1–G6 are business approvals inside the product. Product gate G6 never implies the engineering gate DG7, and nothing here touches DG0–DG7.

## Amendment (2026-10-17, T-DG5-ARCH-R3; D-167, D-168): §4 and §5, the B0147 chain names and the seeded pending approval

Sources: D-167 (QA-E2 O-1), D-168 (W22 integrated, with the analysts' gap REQ-PB-090 decided), and the handbacks of T-DG5-BE-T6 (§1, §2, §7) and T-DG5-BE-T5 (§2.3, continued as T-DG5-BE-T5B). Nothing above is removed or corrected. §4's chain lines and §5's "a pending approval" already state the intent, and this amendment records how the merged dataset meets them at `b463552`. No migration: these are dataset rows (`packages/db/src/demo/**`).

### D5. §4: the roaming chains read exactly as B0147 writes them (T-DG5-BE-T6; D-168; REQ-PB-090)

- **The gap (D-168, analysts' gap 1).** The demo chain had six nodes, and its KPI and benefit names were not B0147's, so the traceability view did not show the acceptance line literally.
- **What D-168 decided.** The three chain KPIs and benefits take B0147's names, and each contribution names its outcome KPI. As a result chain 1 reads exactly:

  'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift' (REQ-PB-090; B0146–B0147, `docs/source/playbook.md:696`).

- **As merged** (`packages/db/src/demo/data/**`, all synthetic):
  - **The KPI names** are "Attach rate / activation", "Complaint rate" and "Cost/MB, margin" (`kpis.ts:311`, `:356`, `:394`). Their descriptions keep the roaming wording.
  - **The benefit titles** are "Revenue uplift", "CX + care cost" and "Margin improvement" (`benefits.ts:109`, `:188`, `:224`). `business-cases.ts` uses the same names, and no number changed.
  - **Each contribution names its outcome KPI** (`roaming-chains.ts:56`, `outcome_kpi_id`). So the `initiative_kpi` edge ends at the outcome KPI, and each line has exactly five nodes: diagnostic item → TOM gap → initiative → KPI → benefit (ADR-0038 §1).
  - **The seed fails loudly** if a chain KPI's name or a chain benefit's title is not B0147's column (`roaming-chains.ts:34–37`).
- **The test that asserts the literal line.** `apps/api/test/integration/environment/demo-traceability-chains.test.ts`:
  - It seeds the real demo dataset into a scratch database, runs the real API (`MTH_ENV=demo`), and reads `getTraceability` as the demo TL: the whole graph, and each chain downstream from its diagnosed issue.
  - The expected lines are written out from the B0147 table (`:67–69`; chain 1 at `:67`), never derived from the dataset.
  - Each chain test (`:136–166`) asserts the five record types, the five labels, and `path.map((n) => n.label).join(" -> ")` equal to the literal line (`:155`). It also asserts that no `initiative_kpi` edge from the initiative ends at an outcome.
  - Negative cases: a demo user without a read right gets no chain text (`:169`), and an anonymous request gets 401 (`:176`).
  - Also: `packages/db/test/integration/demo-roaming.test.ts`, the `REQ-PB-090` block. BE-T6's control with `outcome_kpi_id` set back to `null` failed all three chain cases (T-DG5-BE-T6 handback §2). D-168 records 74/74 for BE-T6's tests.
- **Determinism.** Seed-twice and reset-twice still give identical counts and checksums (`demo-roaming.test.ts` and `demo.test.ts` passed; T-DG5-BE-T6 handback §2).
- **A demo wording point, not a defect (D-168).** Each chain's outcome statement still carries the B0147 KPI text (`packages/db/src/demo/data/roaming.ts:676`, `statement: c.kpi`), and the comment above it (`:672`) is no longer accurate (_corrected 2026-10-18, D10_). So in the whole graph an outcome and its outcome KPI share one label. The outcome is not on the line, so the acceptance is met. D-168 records this for the review. This amendment changes nothing about it.

### D6. §5: the seeded pending approval reaches a demo role user (T-DG5-BE-T5; D-167 QA-E2 O-1; REQ-S18-002)

- **The gap.** Before W22, §5's "a pending approval" was met only by a submitted gate or a queued Finance validation (`packages/db/src/demo/coverage.ts:235–239` counts any of the three). No `GET /approvals` inbox lists those, so no demo role user had a pending approval to act on.
- **As merged** (`packages/db/src/demo/data/roaming-states.ts`, all synthetic):
  - `DEMO_PENDING_APPROVAL` (`:264–274` (_corrected 2026-10-18, D10_)) describes the request. The Transformation Lead asks for the T04 design decision D-01 to be decided through the T11 row "Target-state design", whose Approve party is BO.
  - `seedPendingApproval` (`:285–350`) runs in module `roaming.states` (`:353`, called at `:360`) (_corrected 2026-10-18, D10_). Every row goes through `ctx.insert`:
    - a role mapping of party BO to `roaming.user.bo` on the roaming transformation (`:288–295` (_corrected 2026-10-18, D10_));
    - the `approval` row (`:297–317` (_corrected 2026-10-18, D10_)): `decision_request`, pending, round 1, assignee `roaming.user.bo`, `sod_policy` `requester_excluded`. Its SLA is `working_days` with `due_date` null and `due_unknown_reason` `calendar_not_configured` (`:313–315` (_corrected 2026-10-18, D10_)), because the demo organization has no business calendar. The due date therefore shows Unknown, never a guessed date;
    - the `approval_decision` work item for that user (`:322–336`) and its inbox notification (`:337–349`) (_corrected 2026-10-18, D10_).
  - The new ids are fixed (`roaming-ids.ts:59–61`: `roleMapping` 0x057, `workItem` 0x058, `inboxNotification` 0x059), so seed and reset stay deterministic.
- **Tests.** `apps/api/test/integration/environment/demo-pending-approval.test.ts` (`describe` at `:54`):
  - `:55`: the rules name BO;
  - `:82`: `roaming.user.bo` lists it in `GET /approvals?role=assignee&status=pending`, reads it, and has its task and notification;
  - `:110`: no other demo role user lists it as assignee, and the TL lists it as requester;
  - `:118`: the TL as requester is refused (SoD), a stale version is refused, and the BO decides it in a scratch copy.
- **It approves nothing real.** The approval is a synthetic demo request that nobody has decided. Deciding it approves nothing real (M0412).

Every approval in the demo is synthetic and approves nothing real. Product gates G1–G6 are business approvals inside the product. Product gate G6 never implies the engineering gate DG7, and nothing here touches DG0–DG7. The playbook is a practical synthesis inspired by PMI, Brightline and BRM, not an official PMI standard.

## Amendment (2026-10-18, T-DG5-ARCH-R4; D-170, F-DG5-120): §4 and §5, the demo transformation's gate history, and corrected line references

Sources: D-170 (F-DG5-120, decided), the T-DG5-BE-V3 handback (§2, §6 and §8) and the T-DG5-FE-V1B handback §2, checked against the merged tree (`9c96ee3`). Nothing above is removed. Where this amendment and §4 or §5 differ, this amendment wins. No migration, contract or schema change: these are dataset rows (`packages/db/src/demo/data/**`, all synthetic). File references are in that directory unless named otherwise.

### D7. §4: the transformation is created in Diagnose and advanced to Transform by the synthetic G1–G4 approvals (T-DG5-BE-V3)

- **The gap (F-DG5-120).** The transformation was inserted directly in `transform`, with the six gate instances `draft` and never submitted, so the demo showed Transform-phase progress with G1–G6 never submitted (M0348).
- **The phase.** The transformation is created in **Diagnose** (`roaming.ts:230`, `current_phase: "diagnose"`). The new module `roaming.gates` (`roaming-gates.ts:761–769`, order 550: after the chains and the KBE-H case and formulas, before `roaming.states` at 600; registered in `index.ts:10`, `:18`) records the gate history as the product records it (the tables, guards and action names of `apps/api/src/modules/workflows/gates.ts` `submitGate`/`decideGate` and `transformations/phase.ts`). Each approved gate advances the phase by exactly one step (`transformation.phase_advance`, `roaming-gates.ts:709`), so the transformation ends in **Transform** after four advances. The seed throws if a gate is not an unconfigured draft routed to SP or the transformation is not in that gate's phase (`roaming-gates.ts:489–515`). _Corrected 2026-10-18 (T-DG5-ARCH-R5, amendment D12): `roaming.gates` also calls `seedApprovedPortfolio` just before G4 is submitted and `launchApprovedPortfolio` after the G4 approval (`roaming-gates.ts:727–735`); the line references of this amendment are corrected in D15._
- **G1–G3: complete on seeded evidence** (`seedGateEvidence`, `roaming-gates.ts:231`ff., every row dated before its gate). G1: a measured baseline, one verified evidence note (created by TL, reviewed by KDS), the six T01 rows completed, a confirmed `root_cause` finding and a quantified value pool. G2: the B0037 thesis and the B0051 good-outcome inputs (`roaming.ts`), the three T02 trajectories approved by SP, one active strategic guardrail. G3: a capability gap and an active future-state journey. _Amended 2026-10-19 (T-DG5-ARCH-R6, amendment D18): G3's evidence is unchanged; the dataset now holds 3 capabilities, G3's plus two recorded in Mobilize after G3 (D16)._
- **G4: complete except two accepted exceptions** (`DEMO_GATE_EXCEPTIONS`, `roaming-gates.ts:136–167`; `seedGateExceptions`, `:442`ff.). The business case's baseline section is validated by the demo Finance user (`validate_baseline`, `roaming-gates.ts:423–434`). The criteria `g4.initiative_cards` (portfolio empty) and `g4.prioritization` (no ranking snapshot) are each covered by a gate exception requested by TL (`pending`), then accepted by SP, the gate's approver and never the requester (the DB CHECK). Each carries a reason, a scope, a compensating action owned by TL, and an expiry of the synthetic clock + 730 days (`EXCEPTION_EXPIRES_DAYS`, `:169`; `expires_on`, `:457`), which is **2028-08-31**. After that date the live G4 page reads those two criteria as missing again, as the product does for any expired exception (BE-V3 handback §8 item 1). _Superseded 2026-10-18 by amendment D12 (T-DG5-ARCH-R5; D-172): untrue since T-DG5-BE-X2. G4 is complete on a real approved portfolio of INI-01..03 and the demo has no gate exception._
- **Submission and decision, per gate** (`seedGateApproval`, `roaming-gates.ts:489`ff.; dates `DEMO_GATE_HISTORY`, `:67`): a `gate_submission` by `roaming.user.tl`, routed to role SP with no named user, with its frozen snapshot and criterion rows (`:592–634`); the canonical `decision` row `GD-01`…`GD-04` (`:649–658`) and the `gate_decision` (approved, by `roaming.user.sp`, never the submitter; `:664–674`); G1's three B0032 agreements; then the submission decided, the gate approved and the phase advanced (`:695–709`). G1 is decided on 22 May, G2 on 30 May, G3 on 2 June and G4 on 10 June 2026, before the Transform-phase records that depend on G4.
- **G5 and G6 are not submitted.** They stay `draft` with no submission; their readiness is computed by the product.
- **The synthetic label on each decision.** Every rationale starts with "Synthetic demonstration - approves nothing real / عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي." (`finance.ts:30`, `roaming-gates.ts:48–50`, `:642`). The exception reasons carry the same label (`roaming-gates.ts:150`, `:161`). _Moot since 2026-10-18 (amendment D12): there are no exception rows._ `SyntheticApprovalLabel` also shows the label on every gate page in a demo database (§2, unchanged).
- **The phase steps.** Each Define…Transform phase step names the approved gate decision that enabled its phase (`enabled_by_gate_decision_id`, `roaming-states.ts:48`), as the `gates.decided` consumer does. Diagnose and Realize steps name none.
- **What the seed does not emit** (stated so it is not claimed):
  - **no outbox events.** `gate.submitted` and `gate.decided` are not written, because their consumers would create approver tasks and phase-step rows from the real clock (`roaming-gates.ts:23–25`). Their effect on the phase steps is seeded directly;
  - **no automation request execution.** The `REQUEST_STARTERS.gateEvidenceMissing` request execution that `submitGate` records is not seeded (BE-V3 handback §8 item 4);
  - **audit attribution.** As for every demo-seeded row, the audit events carry the seed's actor (system, source `cli`); the acting demo user is on the rows (`submitted_by`, `decided_by`, `requested_by`).
- **§4 "rows are inserted in a fixed order, with one audit event each"** now also covers updates: the seed's updates (for example the gate moves and the phase advances) take the P2 version step and write one audit event each with the product's action name (`change`, `roaming-gates.ts:180–213`).
- **Determinism.** The new rows have fixed ids (`roaming-ids.ts:63–72`, blocks `0x060`–`0x069`) and synthetic-clock dates. The record counts and the checksum differ from those of round 1, and stay identical across seed, reset and reset (BE-V3 handback §3). The dataset version stays `1.0.0` (`packages/db/src/demo/guard.ts:17`).
- **Not an approval.** Every seeded G-decision and exception is a synthetic demonstration decision by a demo role user on demo data, and approves nothing real (M0412). Seeding stays refused in production (`demo/guard.ts`, §3). _Corrected 2026-10-18 (amendment D12): there is no seeded exception; the seeded selections, funding decisions, Finance validations and milestone approvals are synthetic demonstration decisions too._
- **Test.** `apps/api/test/integration/environment/demo-gate-history.test.ts` runs the real seed and the real API (`MTH_ENV=demo`): G1–G4 approved by SP and submitted by TL, each rationale carries the label in English and Arabic, only `g4.initiative_cards` and `g4.prioritization` are excepted, G5 and G6 have no submission (`:60`; the gate statuses at `:164`), and four `transformation.phase_advance` events lead from Diagnose to Transform (`:167`). _Superseded 2026-10-18 by amendment D12 (T-DG5-ARCH-R5): the test now asserts that no criterion of G1–G4 is incomplete and that no gate exception exists, and a new test asserts the approved portfolio (`demo-gate-history.test.ts:174`)._

### D8. §5: G1–G6

"G1–G6: a gate instance each" stays true. G1–G4 now also carry approved decisions, and G5–G6 none (D7).

### D9. The gate readiness line on the demo's approved G4 (T-DG5-FE-V1B)

No ADR or data-dictionary statement says what the gate readiness line shows, so none is made untrue. For the demo: the line on the gate page and the gates list now names the mandatory outputs covered by an accepted exception, using the server's `covering` value only (`apps/web/src/pages/gates/GatesPage.tsx:97–125`; `GateDetailPage.tsx:102`, `:242`; keys `gates.readinessCovered` and `gates.readinessCoveredPartly`, `apps/web/src/i18n/en/gates.json:40–41` and `ar/gates.json:40–41`). With both G4 gaps covered, it reads "6 of 8 mandatory outputs complete; the other 2 are covered by accepted exceptions". FE-V1B did not render it on the demo stack (its tree did not hold BE-V3's seed), so that reading is the code's expected output, still to be checked on the merged tree (FE-V1B handback §5). _Superseded for the demo 2026-10-18 by amendment D13 (T-DG5-ARCH-R5): the demo's G4 has no covering exception, so the line takes the plain variant._

### D10. Line references corrected (the shifts BE-V3 reported, and the ones it did not list)

The new lines in `roaming.ts` and `roaming-states.ts` moved the references of D5 and D6. They are corrected in place above. Each corrected reference is marked "corrected 2026-10-18".

| Reference (at `b463552`) | As merged (`9c96ee3`) | Listed by BE-V3 |
|---|---|---|
| `roaming.ts:669` (`statement: c.kpi`) | `roaming.ts:676` | yes |
| `roaming.ts:665` (the comment above it) | `roaming.ts:672` | yes |
| `roaming-states.ts:259–269` (`DEMO_PENDING_APPROVAL`) | `:264–274` | no |
| `roaming-states.ts:280–345` (`seedPendingApproval`) | `:285–350` | yes |
| `roaming-states.ts:283–290` (the role mapping) | `:288–295` | no |
| `roaming-states.ts:292–312` (the `approval` row) | `:297–317` | no |
| `roaming-states.ts:308–310` (the SLA and Unknown due date) | `:313–315` | no |
| `roaming-states.ts:317–331` (the work item) | `:322–336` | no |
| `roaming-states.ts:332–344` (the notification) | `:337–349` | no |
| `roaming-states.ts:348` (module `roaming.states`) | `:353` | yes |
| `roaming-states.ts:355` (the call) | `:360` | yes |

`roaming.ts:110`, `:118`, `:132` (D1, D2) and `roaming-ids.ts:59–61` (D6) are unchanged.

Requirement rows: REQ-S18-002 and M0348 (and REQ-S21-001 for the labels). Product gates G1–G6 are business approvals inside the product; the demo's G1–G4 decisions are synthetic and approve nothing real. Product gate G6 never implies the engineering gate DG7, and nothing here touches DG0–DG7.

## Amendment (2026-10-18, T-DG5-ARCH-R5; D-172, F-DG5-120): §4, §5, D7 and D9, the demo's G4 on a real approved portfolio

Sources: D-172 (F-DG5-120 remaining part, decided) and the T-DG5-BE-X2 handback §2, §6 and §8, checked against the merged tree (`c184328`, which holds BE-X1 and BE-X2). Nothing above is removed: the statements this amendment replaces are marked in place ("Superseded" or "Corrected 2026-10-18"). Where this amendment and §4, §5, D7 or D9 differ, this amendment wins. No migration, contract or schema change: these are dataset rows (`packages/db/src/demo/data/**`, all synthetic) in existing tables. File references are in that directory unless named otherwise.

### D11. §4: the approved portfolio behind G4 (T-DG5-BE-X2)

The dataset now records G4's approved portfolio **as the product records it**, on the synthetic clock, between the G3 approval (2026-06-02) and the G4 submission (2026-06-08). The new file is `roaming-portfolio.ts`: `seedApprovedPortfolio` at `:429`, `launchApprovedPortfolio` at `:678` (_corrected 2026-10-19, D19_). Each step is written by the demo role user who holds the product permission, through the same tables and database guards, with one audit event per write:

| Step (UTC) | Who | Rows written or updated | Evidence (`roaming-portfolio.ts`; _lines corrected 2026-10-19, D19_) |
|---|---|---|---|
| 06-03 06:00: the two capability changes INI-02 and INI-03 deliver, permission `tom.edit` (_added 2026-10-19, D16_) | TL | `capability` ×2 (`capability.create`) | `:353–369` |
| 06-03 06:10: three key deliverables per initiative, permission `initiative.edit` (_added 2026-10-19, D16_) | TL | `deliverable` ×9, owner WL, `pending` (`deliverable.create`) | `:370–395` |
| 06-03 06:20: the trace links, permission `traceability.link`, no allocation share (_added 2026-10-19, D16_) | TL | `trace_link` ×9 `deliverable_capability` and ×3 `capability_kpi` (`trace_link.create`) | `:396–422` |
| 06-03 07:00: INI-01..03 submitted for prioritization (`draft → submitted`) | TL | `initiative` (`initiative.submit`) | `:438` |
| 06-03 09:00: score results under weight set v1, **ranking snapshot 1** and its entries; `submitted → ranked` | TL | `initiative_score_result` ×3, `ranking_snapshot` ×1, `ranking_entry` ×3; `initiative.rank` | `:440–489` |
| 06-04 07:00: selection from snapshot 1 (`ranked → selected`) | SP | `portfolio_selection` ×3 (action `selected`); `initiative.select` | `:491–506` |
| 06-05 09:30: Finance validation of the baselines of BC-02..BC-04 (the validator is never the author) | FIN | `business_case` (`business_case.validate_baseline`) | `:508`ff. |
| 06-05 11:00: an approved funding decision per initiative, amount = the initiative case's existing cash investment line (`selected → funded`) | FIN | `decision` DEC-02..DEC-04 (kind `executive`) and `funding_decision` ×3 (outcome approved, approver role FIN); `initiative.fund` | `:534–573` |
| 06-05 13:00: resourcing roles, capacity Jul–Dec 2026, planned demand | TL (roles, capacity), WL (demand) | `resource_role` ×3, `capacity` ×18, `resource_demand` ×18 | `:576`ff. |
| 06-05 14:00: two milestones per initiative | TL | `milestone` ×6 | `:617`ff. |
| 06-06 08:00: the demand committed (`planned → committed`) | BO | `resource_demand` (`resource_demand.commit`) ×18 | `:637–651` |
| 06-06 09:00: the milestone dates approved, with a reason | TL | `milestone` (`milestone.approve_date`) ×6 | `:654–674` |
| 07-03 08:00, after G4 is approved: launch (`funded → launched`) | TL | `initiative` (`initiative.launch`) | `:678–682` |

- **Initiative business cases.** `business-cases.ts` adds BC-02, BC-03 and BC-04 (`DEMO_INITIATIVE_CASES`, `:280`; inserted at `:559–560`). Each is an ADR-0024 §1 lighter-set case, level `initiative`, under BC-01 and linked to one B0147 initiative. The author is TL and the validator is FIN. Each B0147 chain's benefit line and its cash investment line move to that chain's initiative case (`caseIdOfLine`, `:337`, used at `:590`). The internal-team line stays on BC-01.
- **The initiative cards.** Each card now has `scope_in` (`roaming.ts:734`), so the T05 card that G4 reads is complete (name, objective, scope in).
- **Ranking.** INI-03 ranks 1st, INI-01 2nd and INI-02 3rd (`roaming-portfolio.ts:137`, `:177`, `:226` (_corrected 2026-10-19, D19_)). The weighted scores are literal decimal strings, recomputed in the test with `@mth/shared/calc` (BE-X2 handback §2).
- **Schedule and capacity** (BE-X2 handback §2). The milestones fall inside each initiative's planned window. INI-03's last milestone (2026-09-28, `roaming-portfolio.ts:230` (_corrected 2026-10-19, D19_)) is before DEP-01's needed-by date (2026-10-01), so G4 lists no `g4.schedule_conflict` and no `g4.schedule_unknown`. Committed demand never exceeds the capacity of its role and month, and no cell is Unknown.
- **Totals unchanged.** BC-01's totals read its own lines plus those of its active initiative cases. The same lines with the same amounts give the same figures, asserted through `GET /business-cases/{BC-01}/totals` (`apps/api/test/integration/environment/demo-gate-history.test.ts:328–343`): revenue uplift 7,128,000; avoided cost 1,584,000; margin uplift 1,920,000; cash cost 3,660,000 (3 lines); non-cash cost 1,170,000 SAR (1 line). BE-X2 reports that no acceptance-pinned value changed (handback §5).
- **Determinism.** The new rows have fixed ids (`roaming-ids.ts:78–86`, blocks `0x070`–`0x078`; the funding decisions' canonical `decision` rows use numbers 7–9 of the `decision` block, `roaming-portfolio.ts:289` (_corrected 2026-10-19, D19_); _added 2026-10-19, D16:_ the key deliverables, their capability changes and trace links use blocks `0x079` `deliverable`, `0x07a` `deliverableCapability` and `0x07b` `deliverableTraceLink`, `roaming-ids.ts:87–94`, through the id helpers at `roaming-portfolio.ts:294–301`) and synthetic-clock dates. Block `0x069` (`gateException`) is unused and kept, so no block number is reused (`roaming-ids.ts:72–73`). The record counts and the checksum change by design, and stay identical across seed, reset and reset. The dataset version stays `1.0.0` (`packages/db/src/demo/guard.ts:17`).

### D12. D7 corrected: G4 rests on a real approved portfolio, with no exception

Each D7 statement that BE-X2 lists as untrue (handback §6) is replaced as follows:

| D7 statement | Now | Evidence |
|---|---|---|
| "G4: complete except two accepted exceptions … expiry … 2028-08-31" | **G4 is complete on the approved portfolio INI-01..03, with no gate exception.** `DEMO_GATE_EXCEPTIONS`, `seedGateExceptions` and `EXCEPTION_EXPIRES_DAYS` are removed. All eight snapshot criteria are `complete` with `missing: []` (`roaming-gates.ts:485–490`), and every `gate_submission_criterion` row is `complete` with `gate_exception_id: null` (`:516–533`). The G4 snapshot member is read from the seeded records, the way `g4.ts buildG4Snapshot` builds it (`g4SnapshotOf`, `roaming-gates.ts:627–709`). It names INI-01..03 (status `funded` at submission), ranking snapshot 1, the active weight set, BC-01 then BC-02..BC-04, the formula versions, three funding decision ids and the committed demand ids. The seed throws unless G4 is submitted on exactly that portfolio (`:687–688`). | `roaming-gates.ts:14–18` (header) |
| The `roaming.gates` module order (`roaming-gates.ts:761–769`) | `roaming.gates` (order 550) runs the G1–G3 approvals, calls `seedApprovedPortfolio` just before G4 is submitted, then approves G4, then calls `launchApprovedPortfolio` (`roaming-gates.ts:723–736`, the calls at `:731` and `:734`). | — |
| "The exception reasons carry the same label" | Moot: there are no exception rows. The new seeded selections, funding decisions and Finance validations carry the same synthetic label in their rationale or note (`roaming-portfolio.ts:59`, used e.g. at `:499` (_corrected 2026-10-19, D19_)). | — |
| "Every seeded G-decision and exception is a synthetic demonstration decision" | Every seeded G-decision, selection, funding decision, Finance validation and milestone approval is a synthetic demonstration decision by a demo role user on demo data, and approves nothing real (M0412). Seeding stays refused in production (`demo/guard.ts`). | `roaming-portfolio.ts:45–47` (_corrected 2026-10-19, D19_) |
| The test "only `g4.initiative_cards` and `g4.prioritization` are excepted" | `demo-gate-history.test.ts` now asserts that no criterion of G1–G4 is incomplete and that no gate exception exists on any of them (`:93–100`). The new test at `:174` asserts the real portfolio. G4 live: 8 of 8 mandatory criteria `complete` with `missing: []`, and no gate exception in the transformation (`:184–200`). G4 frozen: every criterion `complete` with no `gateExceptionId`, and the snapshot names INI-01..03 (`:202–215`). It also checks the ranking, selection, funding, milestones, schedule, capacity, initiative cases, the totals and GD-04. G5 and G6 have no submission (`:157–163`; the gate statuses at `:166`), and the phase history test is at `:430` (_corrected 2026-10-19, D19_). | — |
| The G4 submission note and the GD-04 rationale (D7 "Submission and decision") | Rewritten to match the records. The G4 note reads "Mobilization: initiative cards, ranking and selection, business cases, Finance validation, funding, roadmap, owners, capacity (synthetic demonstration)." GD-04 reads "The portfolio is executable and value-backed: INI-01, INI-02 and INI-03 are ranked, selected and funded, each with a Finance-validated initiative business case, owners, approved milestones and committed capacity within the plan; Finance validated the transformation case baseline and the three formulas. Proceed to Transform." Each keeps the bilingual synthetic label, and the rationale contains no "exception" (test `:346–348`). | `roaming-gates.ts:106–120` |

G1–G3, their evidence and dates, G5 and G6 (not submitted), the phase advances, the phase steps and the "What the seed does not emit" statements of D7 are unchanged. The fail-closed G4 rule of ADR-0035 amendment E1–E5 does not affect the demo, whose approved portfolio is not empty. BE-X2 states that its test asserts the portfolio directly and does not depend on that rule (handback §2).

### D13. D9 for the demo: the readiness line

The demo's G4 has no covering exception, so the readiness line takes the plain variant: `readinessText` returns `gates.readiness` when `covered === 0` (`apps/web/src/pages/gates/GatesPage.tsx:120–121`; "{{complete}} of {{total}} mandatory outputs complete", `apps/web/src/i18n/en/gates.json:39`). By the live API reading above (8 of 8 complete), the expected text is "8 of 8 mandatory outputs complete". The D9 reading "6 of 8 mandatory outputs complete; the other 2 are covered by accepted exceptions" is untrue for the demo. The covered variants (`gates.readinessCovered`, `gates.readinessCoveredPartly`) are unchanged and stay true for gates that do carry exceptions. BE-X2 did not render the G4 page (handback §8 item 5), so the rendered text is the code's expected output and is not yet checked on screen.

### D14. §5 and the observations BE-X2 discloses (stated so they are not claimed)

- **§5 coverage is unchanged.** The conditions are the same. BE-X2's demo e2e run reports `coverage complete` on the demo stack (`docs/delivery/handbacks/DG5/T-DG5-BE-X2-evidence/30-e2e-demo.log`, line 95). The seeded pending approval, the three B0147 chains and the walkthrough are unchanged (BE-X2 handback §2, "Kept unchanged").
- **The seed emits no outbox events for the new records.** `roaming-portfolio.ts` writes no outbox row, as D7 already states for the gates. No `ranking`, `funding` or `launch` consumer runs from the real clock. Each row still has its audit event.
- **The selection's audit action differs from the API's.** The seed writes the `portfolio_selection` row through `ctx.insert`, whose audit action is `portfolio_selection.create` (`packages/db/src/demo/seed.ts:158`). The API writes `portfolio_selection.select` (`apps/api/src/modules/portfolio/selections.ts:117`). The initiative's status step uses the product's verb `initiative.select` in both (`roaming-portfolio.ts:505` (_corrected 2026-10-19, D19_); `selections.ts:133`; `seedUpdate` names the action `<table>.<verb>`, `kpis.ts:165`).
- **INI-01 carries a `schedule.before_predecessor` warning.** INI-01 starts on its planned start (2026-07-03) before INI-03's finish (2026-09-28), against DEP-01 (`roaming-portfolio.ts:229–230` (_corrected 2026-10-19, D19_); the flag is defined at `apps/api/src/modules/portfolio/schedule.ts:7`, `:20`). It is a roadmap warning that G4 does not list. The needed-by date is met, so there is no needed-by conflict. BE-X2 reports that the warning was present before its change (handback §8 item 3).
- **G5 readiness was not re-checked on the demo stack.** The three funding decisions add three decided executive decisions (DEC-02..DEC-04) to the T16 decision log, and the initiatives are now launched. G5's live readiness text may therefore differ from the round-1 reading. G5 and G6 stay not submitted (asserted), and no test pins their readiness (BE-X2 handback §8 item 1).
- **No organization-level "portfolio" is seeded.** `GET /organizations/{o}/portfolios` is the P4 grouping of transformations (`portfolio/structure.ts`), not the G4 approved selection, and G4 does not read it (BE-X2 handback §8 item 2).

### D15. Line references in D7 corrected (as merged, `c184328`)

BE-X2's change moved most `roaming-gates.ts` references of D7. The references to removed code have no new location.

| D7 reference (at `9c96ee3`) | As merged (`c184328`) |
|---|---|
| `DEMO_GATE_EXCEPTIONS`, `roaming-gates.ts:136–167`; `seedGateExceptions`, `:442`ff.; `EXCEPTION_EXPIRES_DAYS`, `:169`; `expires_on`, `:457`; exception reasons `:150`, `:161` | removed (D12) |
| `validate_baseline`, `roaming-gates.ts:423–434` | `:381–403` |
| `seedGateApproval`, `:489`ff. | `:414`ff. |
| the gate checks that throw, `:489–515` | `:429–439` |
| `DEMO_GATE_HISTORY`, `:67` | `:69` |
| the frozen snapshot and criterion rows, `:592–634` | `:470–533` |
| the canonical `decision` GD-01…GD-04, `:649–658` | `:554–567` |
| the `gate_decision`, `:664–674` | `:569–584` |
| the submission decided, the gate approved, the phase advanced, `:695–709` | `:600–617` |
| `transformation.phase_advance`, `:709` | `:614` |
| module `roaming.gates`, `:761–769` | `:723–736` |
| the label, `roaming-gates.ts:48–50`, `:642` | `:50–52`, `:547` |
| `change`, `:180–213` | `:145–179` |
| the outbox comment, `:23–25` | `:24–26` |
| `seedGateEvidence`, `:231`ff. | `:196`ff. |
| `roaming-ids.ts:63–72` (blocks `0x060`–`0x069`) | `:62–73`; new blocks `0x070`–`0x078` at `:78–86` |
| `demo-gate-history.test.ts` `:60`, `:164`, `:167` | `:157–163` (G5/G6), `:166` (gate statuses), `:352` (phase history) |

`roaming.ts:230`, `index.ts:10`, `:18`, `roaming-states.ts:48`, `finance.ts:30` and `guard.ts:17` are unchanged.

Requirement rows: REQ-S18-002 and M0348 (REQ-PB-019 for G4). Product gates G1–G6 are business approvals inside the product. The demo's G1–G4 decisions, selections, funding decisions, Finance validations and milestone approvals are synthetic and approve nothing real. Product gate G6 never implies the engineering gate DG7, and nothing here touches DG0–DG7.

## Amendment (2026-10-19, T-DG5-ARCH-R6; D-174, F-DG5-123): §4, D7, D11, D12 and D14, the key deliverables of the approved portfolio, and corrected line references

Sources: D-174 (F-DG5-123, decided) and the T-DG5-BE-Y1 handback §2 and §5, checked against the merged tree (`c0f6208`, which holds BE-Y1, BE-Y2 and FE-Y1). Nothing above is removed: the statements this amendment changes are marked in place ("added 2026-10-19", "corrected 2026-10-19" or "Amended 2026-10-19"). Where this amendment and §4, D7, D11, D12 or D14 differ, this amendment wins. No migration, contract or schema change: these are dataset rows (`packages/db/src/demo/data/**`, all synthetic) in existing tables. File references are in that directory unless named otherwise.

### D16. D11: the key deliverables, their capability changes and their trace links (T-DG5-BE-Y1)

- **The gap (F-DG5-123).** BE-X2 took INI-01..03 to `launched` with no `deliverable` row. The portfolio then reported `initiative.deliverable_count` (fewer than 3 or more than 7; `apps/api/src/modules/portfolio/repository.ts:176`) on each of them, next to an approved G4. The orphan report listed each launched initiative as "initiative → deliverable" missing (`apps/api/src/modules/reporting/traceability.ts:385`).
- **Why capabilities and links too.** Under the same orphan rules an active deliverable without a `deliverable_capability` link is an orphan (`traceability.ts:388`), and so is a capability without an incoming `deliverable_capability` link or an outgoing `capability_kpi` link (`:391–392`). So each deliverable is linked to a capability change, and each capability to its chain's outcome KPI.
- **As merged** (`seedKeyDeliverables`, `roaming-portfolio.ts:350–423`, called first in `seedApprovedPortfolio` at `:435`). The rows are written on 2026-06-03 in Mobilize (`DEMO_PORTFOLIO_TIMES`, `:63–66`), after the G3 approval (06-02) and before INI-01..03 are submitted for prioritization (06-03 07:00), so the cards are still drafts. The three steps are the rows added at the top of the D11 table:

| Step (UTC) | Who, permission | Rows | Facts | Evidence (`roaming-portfolio.ts`) |
|---|---|---|---|---|
| 06-03 06:00 | TL, `tom.edit` (the capability heatmap register, `apps/api/src/modules/transformations/registers.ts:509`) | `capability` ×2 | "Proactive roaming service assurance (synthetic)" for INI-02 (`journeys_processes`, level 2 → 4, `build`) and "Partner cost and usage analytics (synthetic)" for INI-03 (`partners_sourcing`, level 1 → 3, `partner`). Each is owned by WL, status `active`, on the initiative's chain TOM gap. INI-01 delivers G3's existing "Digital roaming activation (synthetic)" (`roaming-gates.ts:355`), so no capability is added for it. | data `:206–214`, `:256–264`; insert `:353–369` |
| 06-03 06:10 | TL, `initiative.edit` (`deliverables.ts createDeliverable`, `apps/api/src/modules/portfolio/deliverables.ts:113`) | `deliverable` ×9 | Three per initiative, ordinals 1–3, inside T05's 3–7 (B0072; ADR-0021 §2); the seed throws outside 3–7 (`:371–372`). Owner WL, `acceptance_status` `pending`, status `active`; none is submitted or accepted. The title is `<en> (synthetic) / <ar> (اصطناعي)`, and the description names the initiative's B0147 line and repeats the synthetic label in Arabic (`:384–387`). Each due date is one of the initiative's approved milestone dates: INI-01 09-30, 11-30, 11-30; INI-02 10-15, 12-15, 12-15; INI-03 09-15, 09-28, 09-28 (data `:149–165`, `:189–205`, `:239–255`). The seed throws if a due date is after the last milestone or not after the synthetic clock (`:377–378`). | `:370–395` |
| 06-03 06:20 | TL, `traceability.link` (`traceability.ts createTraceLink`, `apps/api/src/modules/reporting/traceability.ts:625`) | `trace_link` ×12 | 9 `deliverable_capability` (each deliverable → its initiative's capability; `:396–411`) and 3 `capability_kpi` (each capability → its chain's outcome KPI; `:412–422`). Each carries a contribution statement marked synthetic, status `active`, and **no allocation share**, so no value is attributed and the totals are unchanged. | `:396–422` |

- **The permissions.** The demo TL's role holds all three: `tom.edit` (`packages/db/migrations/0018_p2_access_instantiation.sql:62`), `initiative.edit` (`0024_p3_gates_access_instantiation.sql:81`) and `traceability.link` (`0057_p4_dashboards_traceability_permissions.sql:18`).
- **One audit event per write.** Each row goes through `ctx.insert`, which writes exactly one audit event `<table>.create` (`packages/db/src/demo/seed.ts:157–158`) and registers the row in `demo_seed_record` (`seed.ts:172`). As D7 states for every demo-seeded row, the audit event carries the seed's actor (system, source `cli`), and the acting demo user is on the row (`created_by` TL, through `stamps`). The F-DG5-123 regression test asserts exactly one `deliverable.create` event per deliverable (`apps/api/test/integration/environment/demo-gate-history.test.ts:411–412`).
- **Determinism.** Fixed ids in three new blocks, `0x079` `deliverable`, `0x07a` `deliverableCapability` and `0x07b` `deliverableTraceLink` (`roaming-ids.ts:87–94`; the D11 "Determinism" bullet is extended). No existing block or id is reused: INI-01's capability is G3's `capability` id (`roaming-portfolio.ts:297`). The record counts and the checksum change by design: `capability` +2, `deliverable` +9, `trace_link` +12, and `demo_seed_record` and `audit_event` +23 each (BE-Y1 handback §2, side effect 4). Seed, reset and reset still give identical counts and checksums (BE-Y1 handback §2, "What stays unchanged"). The dataset version stays `1.0.0` (`packages/db/src/demo/guard.ts:17`).
- **The test.** `demo-gate-history.test.ts:357`, "F-DG5-123: the launched portfolio INI-01..03 carries 3-7 key deliverables: no count warning, no orphan", runs the real seed and the real API (`MTH_ENV=demo`) as the demo TL. It reads only product operations, and asserts for each of INI-01..03: launched, no `initiative.deliverable_count` warning, 3–7 active deliverables, ordinals 1..n, created by TL and owned by WL, `pending`, en and ar titles with the synthetic marks, and one audit event each (`:357–427`).
- **Not seeded, stated so it is not claimed.** No deliverable acceptance (`deliverable.accept` is the owner's later business decision), no outbox row (as D14), and no allocation share on any new link.

### D17. §4: the three chains, the M0097 chain beside them, and the orphan report

- **The B0147 lines are unchanged.** Each still reads as one line of exactly five nodes: diagnostic item → TOM gap → initiative → KPI → benefit (D5). The new edges are of other kinds (`initiative_deliverable`, from `deliverable.initiative_id`; `deliverable_capability`; `capability_kpi`), and `demo-traceability-chains.test.ts` and `demo-roaming.test.ts` are unchanged by BE-Y1 and pass in its runs (BE-Y1 handback §2, §3 check 11).
- **What is new (§4 was incomplete).** Each initiative now also reaches its chain's outcome KPI through deliverable → capability change → KPI, the longer chain of M0097 ("Diagnosed issue → target-state gap → initiative → deliverable → capability change → KPI movement → benefit."). This is beside each B0147 line, not on it.
- **The orphan report on the demo holds one entry.** It is the fourth diagnosed issue, "Fragmented roaming propositions and an inconsistent digital activation journey" (Downstream link missing: diagnosed issue → target-state gap), which is not a B0147 line. BE-Y1 discloses this (handback §2, side effect 1): the report had 2 entries in round 2 and 5 in round 3. G3's capability, previously listed as "Both links missing", is now linked both ways. The test asserts that no initiative, deliverable or capability is an orphan and that no launched initiative is listed (`demo-gate-history.test.ts:420–427`). It does not pin the number of diagnostic-finding entries, so "one entry" rests on BE-Y1's disclosure.
- **The graph** gains 11 nodes (9 deliverables, 2 capabilities) and 21 edges (9 `initiative_deliverable`, 9 `deliverable_capability`, 3 `capability_kpi`), far below the 2000-node cap of `getTraceability` (ADR-0038) (BE-Y1 handback §2, side effect 2).

### D18. D7: G3's evidence is unchanged; the dataset holds 3 capabilities

D7's "G3: a capability gap and an active future-state journey" stays true for G3's evidence. The G3 capability is still seeded by `roaming.gates` (`roaming-gates.ts:353–356`), dated before G3. The dataset now holds 3 capabilities: G3's, plus the two recorded in Mobilize on 2026-06-03 (D16), after G3. The capability heatmap and the TOM report therefore list 3 capabilities instead of 1 (BE-Y1 handback §2, side effect 3). G4's criteria, evaluator and snapshot read no deliverable or capability. G4 stays approved with 8 of 8 mandatory criteria complete, and the totals are unchanged (`demo-gate-history.test.ts:174`; BE-Y1 handback §2).

### D19. Line references corrected (as merged, `c0f6208`)

BE-Y1 added about 210 lines to `roaming-portfolio.ts` (`git diff --stat 24a803d c0f6208`: +211), and 78 lines to `demo-gate-history.test.ts`, all after line 351. The references below are corrected in place in D11, D12 and D14, each marked "corrected 2026-10-19". Each new value was read from the merged file.

| Where | Reference (at `24a803d`) | As merged (`c0f6208`) | Listed by BE-Y1 |
|---|---|---|---|
| D11 intro | `seedApprovedPortfolio` `:221` | `:429` | yes |
| D11 intro | `launchApprovedPortfolio` `:467` | `:678` | yes |
| D11 table | submit `:227` | `:438` | yes |
| D11 table | ranking `:229–278` | `:440–489` | yes |
| D11 table | selection `:280–295` | `:491–506` | yes |
| D11 table | Finance validation `:297`ff. | `:508`ff. | yes |
| D11 table | funding `:323–362` | `:534–573` | yes |
| D11 table | roles, capacity, demand `:365`ff. | `:576`ff. | yes |
| D11 table | milestones `:406`ff. | `:617`ff. | yes |
| D11 table | commit `:426–440` | `:637–651` | yes |
| D11 table | approve dates `:443–463` | `:654–674` | yes |
| D11 table | launch `:467–471` | `:678–682` | yes |
| D11 Ranking | `rank` of INI-01, INI-02, INI-03: `:105`, `:125`, `:145` | `:137`, `:177`, `:226` (not one uniform shift: each initiative's data grew) | yes |
| D11 Schedule | INI-03's last milestone `:149` | `:230` | yes |
| D11 Determinism | `fundingCanonicalDecision` `:179` | `:289` | yes |
| D12 table | `LABEL` `:53`, used at `:288` | `:59`, `:499` | yes |
| D12 table | the synthetic-decision header `:39–41` | `:45–47` | yes |
| D12 table | the phase history test `demo-gate-history.test.ts:352` | `:430` | no |
| D14 | the `initiative.select` step `:294` | `:505` | no |
| D14 | DEP-01 and INI-03's last milestone `:148–149` | `:229–230` | no |

Unchanged and still true: `roaming-ids.ts:78–86` (blocks `0x070`–`0x078`) and `:72–73`; the `demo-gate-history.test.ts` references before line 352 (`:93–100`, `:157–163`, `:166`, `:174`, `:184–200`, `:202–215`, `:328–343`, `:346–348`); `business-cases.ts`, `roaming.ts`, `roaming-gates.ts`, `seed.ts` and `kpis.ts`, which BE-Y1 did not change. D15's column "As merged (`c184328`)" records that tree and is left as it was; its `:352` (phase history) is now `:430`.

### D20. What this amendment does not change

- **No ADR or data-dictionary statement names BE-Y2's or FE-Y1's changes.** ADR-0002 says its rules are "enforced by an architecture test" and describes no mechanism (no budget, no `ts.transpileModule`), so no enforcement text is added. No ADR describes the Diagnose workstream layout, the 409 conflict banner's layout or reflow; ADR-0041's conflict behaviour ("theirs vs yours", re-apply) is unchanged.
- **G4, the totals and the gate history** are unchanged (D18). The coverage conditions of §5 read no deliverable or capability.

Requirement rows: REQ-S18-002 and M0348 (M0097 for the chain; B0072 for T05's key deliverables). Product gates G1–G6 are business approvals inside the product; the demo's decisions are synthetic and approve nothing real, and no deliverable is accepted. Product gate G6 never implies the engineering gate DG7, and nothing here touches DG0–DG7.
