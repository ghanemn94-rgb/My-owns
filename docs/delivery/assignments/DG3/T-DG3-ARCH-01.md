# Assignment T-DG3-ARCH-01: P3 architecture: portfolio and roadmap entity group, T05–T09, business case, scoring and formula foundations, G4 and sequencing rules (solution-architect)

## Stage and base

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING), on branch `claude/mobily-transformation-platform-regate`.
- **Base:** current `HEAD`.
- **Preceding gate:** DG2 is APPROVED (`docs/delivery/gates/DG2.json`, candidate `sha256:ddaab3cc…`, source `805da3e2`). Before anything else, run `node tools/gates/validate.mjs --historical --stage DG2` and report the result. It must exit 0.

## P3 is additive to DG2

- New migrations, new resources, new OpenAPI paths.
- Do not break a DG2-approved contract or behaviour.
- **Two DG2 extensions are required by P3 requirements and are allowed:**
  - the G1 approval agreement confirmations (REQ-PB-022);
  - the transformation readiness view (REQ-PB-007).

  Specify each as a documented, backward-compatible extension where possible. State exactly what changes for existing G1 clients.
- If any other P3 need forces a change to a DG2 artifact, record it in the handback as a reopen candidate instead of making it silently.

## Running order and time

- **You run first and alone.** The P3 implementers start after you and build on your foundation: backend-workflow-engineer, kpi-benefits-engineer and frontend-ux-engineer.
- **Your run has a hard limit of about 2 hours.** Run `date -u` at the start. Deliver in the numbered order below, and finish each deliverable before starting the next.
- If you pass about 100 minutes, finish the current file, then write the handback. List exactly what remains so that a continuation task can finish it. Never leave a half-written file.
- Deliverables 1–3 (ADRs, migrations with the schema types, and the probe) are the critical path.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Node 22.22.2 is the floor.
- Run offline; `node_modules` is present. Do not run `playwright install`.
- The write guard forbids editing:
  - `tools/gates/**`, `tools/agents/**`, `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `docs/delivery/stages.json`, `docs/delivery/findings.json`;
  - `trading_agent/`.

## Inputs (read these first)

- **Register:** `docs/delivery/requirements.csv`, the 32 rows with `final_gate` = DG3. Each row's `acceptance` text is binding; reviewers test it literally.
- **Playbook:** `docs/source/playbook.md`. Read these blocks before designing:
  - B0009, B0011, B0012 (sequencing principles);
  - B0021, B0023 (gates G1–G6);
  - B0032 (Gate 1 rule);
  - B0047, B0048 (outcome hierarchy);
  - B0059 (the TOM is not a project list);
  - B0070–B0072 (traceability chain; T05);
  - B0074–B0077 (T06 and the risk/compliance weighting);
  - B0078–B0079 (T07);
  - B0080–B0081 (T08);
  - B0083–B0085 (business case, ten sections);
  - B0086–B0088 (T09; no double counting);
  - B0139 (Finance validation).
- **Master prompt:** `docs/source/master-prompt-v2.0.md`:
  - lines ~157–158: End-to-End vs Modular entry. Modular entry captures inherited approvals and never fabricates them;
  - line ~194: the G4 row;
  - lines ~212–216: T05–T09;
  - §8, lines ~263–284: benefits, the safe formula builder, the two seeded examples, no double counting;
  - §9, lines ~284–300: scoring, weights, rankings vs selection vs funding, the waves, timeline/table/board, cycles and schedule conflicts;
  - line ~500: the S16 entity group;
  - line 615: the P3 row.
- **Existing foundation, which you must reuse rather than duplicate:**
  - ADR-0001…0020, especially:
    - ADR-0007: API conventions, §5b status rule, 422 invalid-transition;
    - ADR-0015: the decision and product-gate engine for G1–G6. G4 is already seeded in `0011_p2_methodology_catalogue.sql`;
    - ADR-0016: P2 registers and guards;
    - ADR-0019: decimal and unquantified;
    - ADR-0020: the role catalogue.
  - `docs/architecture/erd.md`, `data-dictionary.md`, `p2-work-split.md`.
  - `docs/api/openapi.yaml`.
  - `packages/db/migrations/0001`–`0019`. Note the canonical `dependency` table in `0017` ("P3 adds initiative endpoints and cycle checks") and the P2 guard functions in `0010`.
  - `packages/db/src/schema.ts`.
  - `packages/shared/src/{permissions.ts,value.ts,schemas/**}`.
  - `apps/api/src/modules/{workflows,kpi,transformations,methodology,access,platform}`.
  - `docs/analysis/permissions-matrix.md`.

## Requirements in scope (32 rows, final gate DG3)

Design for each acceptance criterion below. Wording in quotes is what reviewers will look for.

- **Entity group (REQ-S16-016):**
  - Initiative, Deliverable, Milestone, RoadmapWave, Dependency, ResourceDemand, Capacity and FundingDecision.
  - Each has a primary key, an owner and a status where applicable.
  - An integration test must be able to create and read each one through the API with authorization enforced.
- **Sequencing rules** (all transitions answer 422 `invalid-transition` per ADR-0007, with a reason):
  - **REQ-PB-004:** in an End-to-End transformation with G3 not approved, `POST /initiatives/{id}/launch` returns 422 with the reason 'North Star, outcomes and target state not yet approved'. After G2 and G3 approval the same call succeeds.
  - **REQ-PB-006:** submitting an initiative for prioritization with no outcome/KPI link returns a validation error naming 'Outcome before activity'.
  - **REQ-PB-007:** before G1 approval an initiative cannot leave Draft (422). `GET /transformations/{id}/readiness` lists the missing diagnostic dimensions: economics, customer, operations, capability and technology. Map these to the T01 dimensions and document the mapping.
  - **REQ-PB-022:** a G1 approval without the three leadership agreement confirmations (problem, baseline, material value pools) is rejected. Before G1, adding an initiative to the portfolio returns 422.
  - **REQ-S09-003:** an initiative that is selected but has no funding approval shows 'Selected - unfunded' and cannot be launched.
  - **Modular entry** (master prompt l.158): define how inherited approvals are captured as evidence and never fabricated as a product-gate approval.
- **Outcome hierarchy and traceability:**
  - **REQ-PB-032:** five levels: North Star → strategic outcome → KPI → target → initiative contribution. An initiative contribution without an outcome link is rejected.
  - **REQ-PB-040:** the TOM stays distinct from the portfolio. Attaching an initiative as G3 TOM evidence is rejected. An initiative links to one or more TOM gaps (T03).
  - **REQ-PB-046:** every initiative is traced to a gap and an outcome. A G4 submission containing an initiative with no gap link is rejected, naming that initiative.
- **T05 Initiative Card** (REQ-PB-045): all 14 source fields (B0072). Key deliverables outside 3–7 shows a **warning**, not a rejection.
- **T06 Prioritization Scorecard:**
  - **REQ-PB-047:** all criteria persist per initiative. The weighted score is read-only (calculated).
  - **REQ-PB-048:**
    - Default weights are 25/25/20/15/15 on a 1–5 scale.
    - Scores 5,4,3,2,1 give exactly **3.30** (decimal, never float).
    - A score of 6 is rejected.
    - A missing score shows 'incomplete', never a number.
  - **REQ-PB-049:**
    - Weights are adjustable per transformation, and a total of 95% or 105% is rejected.
    - A risk/compliance criterion at 10%, with strategic fit reduced to 15%, is accepted as **weight-set version 2**, and rescoring uses it.
    - Scores computed under version 1 keep their version-1 reference.
    - Weight sets are versioned and immutable once used.
  - **REQ-S09-001:** the 0–100 view uses the documented, labelled conversion `(score-1)/4×100`, so 3.30 shows 57.5. The 1–5 value stays the stored result.
  - **REQ-S09-005:** ranking history explains every change: score change, weight version (e.g. 'weight version 2') and override. An override without a reason is rejected.
  - **REQ-S09-003:** proposed ranking, approved portfolio selection and funding approval are three separate things.
  - **REQ-S09-004:** value/feasibility comparison, filters, ranked tables, dependency-aware sequencing (an initiative sequenced before its predecessor is flagged) and capacity conflict indicators.
- **T07 Wave Roadmap:**
  - **REQ-PB-050:** the four source waves are seeded verbatim (B0079; e.g. '0-6 weeks', 'Sponsor + charter') in EN and AR. Overlapping horizons are accepted (planning horizons, not deadlines).
  - **REQ-S09-006:** the timeline, the initiative table and the work board read the same data. Moving a milestone updates all three. Conflicting concurrent edits show a conflict (409 via If-Match).
  - **Milestones:** approved vs forecast dates.
  - **Deliverables:** acceptance status.
- **T08 Dependency Map:**
  - **REQ-PB-051:** all 7 columns persist. From accepts an initiative or 'External'.
  - **REQ-PB-052:** the types Decision, Tech, Data and Vendor are system rows that cannot be deleted, plus admin-configurable types. An unknown type is rejected by the API.
  - **REQ-S09-008 / REQ-PB-051:**
    - A→B→C→A is **rejected naming the cycle**, and A→B→A is reported the same way.
    - The cycle check must be race-free under concurrent inserts. Use the DG1 F-DG1-140 pattern: a transaction-scoped advisory lock plus a database guard.
    - A predecessor finishing after the successor's needed-by date is **flagged** (warning, not rejection).
- **Business case:**
  - **REQ-PB-053:** the ten source sections (B0085) persist. Every investment line carries exactly one classification: capex | opex | internal FTE | vendor cost | opportunity cost. SAR amounts are decimals.
  - **REQ-S05-005:**
    - Benefit lines carry exactly one class: revenue | cost reduction | cost avoidance | working capital | strategic/non-financial.
    - A line with two classes is rejected.
    - The case total equals the sum of distinct lines, each counted once.
  - **REQ-PB-054:** a transformation-level case with lighter initiative cases. Each initiative case links to exactly one transformation case. Editing an initiative case changes the transformation roll-up without duplicating benefits.
  - **REQ-PB-055:** Finance validation of the baseline and benefit logic comes before G4. A G4 submission with a business case whose benefit formula is unvalidated is rejected, listing 'Finance validation'.
  - **Master prompt §8:**
    - Show gross benefits, implementation cost and net value separately.
    - Never subtract the same cost at both initiative and transformation level.
    - Keep revenue uplift separate from margin, and avoided cost separate from cash savings.
- **T09 Benefit Formula and the formula foundation:**
  - **REQ-PB-056:**
    - All 6 columns persist.
    - Confidence outside H/M/L is rejected.
    - A formula that references an undefined variable is rejected.
  - **REQ-PB-057:**
    - Both source examples are seeded.
    - Attach rate 0.10→0.12 with 100000 customers and ARPU 50 SAR gives **100000 SAR** exactly.
    - Volume × Δ unit cost computes exactly.
  - **REQ-S08-007:**
    - Attach rate is stored as a fraction; 10%→12% is 0.02, or 2 percentage points.
    - Monthly ARPU combined with an annual population without a conversion is **rejected**.
    - 0.02 × 100000 × 50 SAR = 100000 SAR exactly.
  - **Master prompt l.271:**
    - A **restricted expression language** with typed variables (unit, currency, period).
    - **Never** `eval`, `new Function`, `vm` or any dynamic code path.
    - Versioned formulas.
    - Calculation lineage: inputs, formula version, assumptions, period.
  - Prefer a hand-written parser over a new dependency. If you propose a dependency, justify it and pin it in the ADR; the orchestrator decides.
- **Owners and capacity (REQ-PB-059):**
  - Role-based capacity (FTE, decimal) per period, and resource demand per initiative, role and period.
  - Demand above availability shows a conflict indicator.
  - G4 lists the initiatives without owners.
- **Gate G4:**
  - **REQ-PB-019:** the evidence is initiative cards, business cases, roadmap, owners and capacity. A G4 submission where an initiative has no owner is rejected, listing 'Owners'.
  - **REQ-S04-006:**
    - An initiative without a funding decision or a capacity commitment is rejected, naming it.
    - A decision by a user who is not the configured approver, or by the submitter, returns **403**.
    - A decision on a superseded submission version returns **409**.
  - Reuse the ADR-0015 engine. Define the `g4.*` criteria and which initiatives are in G4 scope.
- **REQ-DLV-035:** P3 outputs and evidence: weighted-score unit tests (5,4,3,2,1 → 3.30), weights totalling 95% rejected, cycles reported, and a G4 flow that runs end to end.

## Deliverables, in this order

### 1. ADRs

Write new ADRs starting at `docs/architecture/adr/ADR-0021-*`, in the existing Context / Decision / Alternatives / Consequences / Verification format. Cover at minimum:

- **(a) Portfolio and initiative model.**
  - The S16-016 entities.
  - The initiative lifecycle state machine: draft, submitted for prioritization, proposed ranking, selected, funded, launched, and any terminal states. For every transition give its preconditions, each with its exact 422 reason text from the acceptance criteria.
  - The End-to-End vs Modular rules.
  - The links: to T03 gaps (1..n), to outcomes and KPIs (contributions), and to T05 fields.
  - The TOM/portfolio separation.
- **(b) Prioritization.**
  - Criteria and weight sets: versioned, immutable once used, per transformation, with v1 seeded at the source defaults.
  - Exact decimal arithmetic, and the rounding rule for display vs storage.
  - 'Incomplete' semantics.
  - The 0–100 conversion label.
  - Ranking snapshots and history with causes.
  - Overrides with a reason.
  - Proposed ranking vs selection vs funding.
- **(c) Roadmap and dependency graph.**
  - Waves seeded per transformation, verbatim and bilingual.
  - Milestones (approved vs forecast) and deliverables (acceptance).
  - One data source for timeline, table and board.
  - Cycle detection: the algorithm, race-freedom, and the 422 body that names the cycle path.
  - Schedule-conflict flags.
  - The defined scheduling logic. No cosmetic critical path; if critical path is out of P3 scope, say so explicitly.
  - Configurable dependency types.
- **(d) Resource capacity and funding.**
  - Capacity and demand by role and period, in decimal FTE.
  - The conflict rule.
  - Funding decisions as recorded human business approvals (FIN/SP). The product records a person's decision; nothing auto-approves.
- **(e) Business case.**
  - The ten sections.
  - Transformation case vs initiative cases.
  - Line classification: exactly one class.
  - The roll-up algorithm that counts each distinct line once.
  - Gross, cost and net shown separately.
  - SAR decimals and a configurable currency.
- **(f) Formula foundation (T09).**
  - The grammar (EBNF).
  - The typed variable model: unit, currency, period and fraction vs percent vs percentage point.
  - Unit and period alignment rules, with the exact rejection of monthly × annual.
  - Evaluation with decimal.js only, and division-by-zero handling.
  - Versioning, lineage, and the Finance validation state that blocks G4.
  - The two seeded examples, marked as illustrative.
  - State which package hosts the engine so web and API share it, for example `packages/shared` or a new `packages/calc`.
- **(g) Product gate G4 and the G1 extension.**
  - The `g4.*` criteria and their missing-item texts ('Owners', 'Finance validation', the initiative names).
  - The 403/409 contracts, reused.
  - The G1 agreement confirmations: the shape of the decision body, and how they are stored and audited.
  - The readiness view.
  - Restate that G1–G6 are business approvals inside the product, never engineering DG0–DG7.

### 2. Migrations and schema types

- **Migrations:** `packages/db/migrations/0020_*` onward, forward-only. Apply the existing P2 guard pattern from `0010` to every new mutable table:
  - row guard;
  - `version` stepping by 1;
  - deferred audit-coverage constraint;
  - append-only history tables;
  - `timestamptz`;
  - `numeric` for money, FTE, weights and scores;
  - CHECK constraints for the closed sets.
- **Seeds:**
  - T06 v1 default weights;
  - the four waves (instantiated per transformation, including a backfill for existing transformations);
  - the four system dependency types (undeletable);
  - the two T09 examples;
  - G4 criteria, where the catalogue needs them;
  - new permissions and role defaults.
- **Schema types:** update `packages/db/src/schema.ts` (Kysely) and `packages/shared/src/permissions.ts`, so `pnpm -r typecheck` and the existing catalogue and seed tests stay green.

### 3. Probe (real output, in the handback)

Use a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, unique `QA_PG_PORT` below 32768).

1. Apply `0001`→`00NN` to an empty DB, and also over a DB populated by `0001`–`0019`.
2. Prove that the guards fire on the new tables:
   - an insert without its audit event fails at COMMIT;
   - a version that does not step by 1 fails;
   - an UPDATE or DELETE on a history table fails;
   - a cycle-closing dependency insert is refused by the database guard.

### 4. ERD and data dictionary

Extend `docs/architecture/erd.md` and `data-dictionary.md` with every P3 table, matching the migrations exactly.

### 5. API contract

Extend `docs/api/openapi.yaml` (OpenAPI 3.1) with the P3 paths, including at least:

- `/api/v1/initiatives` with its submit, select and launch transitions;
- `/transformations/{id}/prioritization`, its weight-sets, the ranking history and overrides;
- `/transformations/{id}/waves`, milestones and deliverables;
- `/api/v1/dependencies`;
- `/api/v1/capacity` and resource demands;
- `/api/v1/funding-decisions`;
- `/api/v1/business-cases` and `/business-cases/{id}/lines`;
- `/api/v1/benefit-formulas`, with validate/preview and Finance validation;
- `/transformations/{id}/readiness`;
- the G4 submission and decision paths, which reuse the gate paths;
- the G1 decision extension.

Rules for the contract:

- Keep every P1 and P2 path byte-stable apart from the documented G1 extension.
- Every operation declares the statuses the ADR-0007 §5b rule test requires: 400/401/403/404/409/422/428/429 as applicable.
- Each request media type equals what the route will declare in `config.consumes`. The default is JSON.
- Use RFC 9457 problem+json, `If-Match`/ETag, and cursor pagination.
- `pnpm openapi:lint` must pass, and the existing contract tests must stay green.

### 6. Permissions and work split

- **`docs/analysis/permissions-matrix.md`:** add the P3 entity rights for TL, WL, BO, FIN, SP, TO, KDS, ADM and the read-only auditor (every write → 403).
- **`docs/architecture/p3-work-split.md`:** follow `p2-work-split.md`'s structure. Size each task to finish in **about 60–75 minutes** of agent time, so split a role into two tasks (e.g. BE-A/BE-B, FE-A/FE-B) where needed. For each task give:
  - exact file ownership, with no file owned by two tasks;
  - the contracts it consumes;
  - the frozen files;
  - the integration order;
  - which `apps/api/src/modules/*` owns each resource;
  - a requirement → owner table for all 32 rows;
  - the P3 increments of later-gate rows. List them only, and scope P3 to what the 32 rows need.

## Lessons from DG2 that P3 must build in from the start

The P3 ADRs and work split must state these as rules for implementers.

1. **Free text** uses the shared `freeText`/`hasText`/`hasInvalidCharacter` rules (visible content, no NUL, no lone surrogates). Truncation goes through `truncateText`.
2. **Strict UTF-8 JSON and query parsing** (BE13) applies to every new route. No route-local parser.
3. **`config.consumes`** on every new route equals its operation's declared `requestBody.content`. The contract media-type test enforces this.
4. **Every mutation needs** a server-side authorization check, re-authorised at commit time (the BE18A pattern), plus:
   - validation;
   - optimistic concurrency (If-Match → 409/428);
   - an audit event;
   - a test for each.
5. **No remote or client I/O inside a database transaction** (BE17/BE18A).
6. **Money, rates, weights, scores and FTE** are decimal only. Unknown or Stale is never shown as 0 or green.
7. **Every user-facing string** is bilingual: Arabic RTL and English LTR, translated at render time.
8. **Web forms** follow the RecordForm and hand-written-form blank rules, with one form-level alert in one live region and axe-clean error banners. Session-bound actions use `apps/web/src/auth/sessionBound.ts`; the ESLint rule forbids raw `navigate` and direct `setQueryData`.
9. **Harness ports** stay below 32768. Verification runs in both locale settings: unset and `C.UTF-8`.
10. **Unit tests** are deterministic, with explicit timeouts.

## Constraints

- No public CDNs or builder-hosted runtime dependencies. No secrets in the repository.
- Pin exact versions and re-verify licences for any dependency the orchestrator approves.
- `#0078FF` stays a provisional brand token, with no official Mobily logo or colour.
- Never call the product an official PMI standard or a certified product.
- Product gates G1–G6 stay separate from engineering DG0–DG7.
- Do not modify `trading_agent/`.

## Acceptance (your self-check; reviewers verify independently)

1. These commands all pass:
   - `pnpm install --frozen-lockfile`
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm format:check`
   - `pnpm openapi:lint`
2. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.
3. Migrations `0001`→`00NN` apply on a fresh DB and over a P2-populated DB, and the guard probe fires as specified.
4. The existing unit tests (`pnpm test`, the unit-node and unit-web projects) still pass in both locale settings. The integration tests that touch the schema, contract and catalogue (`pnpm test:integration` with a disposable PostgreSQL) must also stay green (`QA_PG_PORT=<unique port below 32768> tests/qa/support/with-pg.sh pnpm test:integration`); report how many ran.
5. The ERD and data dictionary contain every S16-016 entity plus T05–T09, business case, weight sets, ranking history and the G4/G1 extensions. The OpenAPI covers every P3 path. The work split is conflict-free and covers all 32 rows.

## Evidence honesty

Report every command with its real exit code. If any command exits non-zero, show the output and explain it. Never report a check as passed that did not run. A missing tool makes the check BLOCKED.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-ARCH-01-solution-architect.md`. Put command logs under `docs/delivery/handbacks/DG3/T-DG3-ARCH-01-evidence/`. The handback contains:

- the `date -u` at the start and at the end;
- the `validate --historical --stage DG2` result;
- the migration-apply and guard-probe output;
- the typecheck, build, lint, format, openapi-lint and unit output;
- the list of deliverables, plus anything left for a continuation;
- any dependency request;
- every DG2 artifact you changed, and why;
- the P3 work-split summary.
