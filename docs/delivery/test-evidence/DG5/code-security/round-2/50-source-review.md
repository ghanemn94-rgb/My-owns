# DG5 corrected clean re-gate, round 2: code-security source review notes

- **Reviewer.** code-security-reviewer, session `2c88c5f6-2bf4-49bc-a7e0-8ed12883d003`, invocation task `T-DG5-RG2-SEC-R2`. The assignment file names the task `T-DG5-REV-SEC-R5`; it is the same assignment, sha256 `43602848…2c33`, which I verified.
- **Candidate.** `sha256:55a411ae9f4e87473478988f3d9909752a934a547ba40acc1479f2b2bc3a24ce` (2207 files), source `660f40c7d141b6fb73c145e0ee7a053ceb5905de`, freeze commit `7a02e7d` (`01-candidate-identity.log`).
- **Scope.**
  - The round-1 → round-2 delta `git diff 2fe8f85..660f40c`, read in full: BE-RG3 for F-DG5-100 and F-DG5-140, and the ADR-0046 amendment.
  - A fresh targeted pass over the P5 diff `git diff e70ac02..660f40c` (903 product files): the paths below, read in the full files.

I authored no implementation in the DG5 scope. I formed this verdict before reading any other reviewer's record for this round.

## The round-1 → round-2 delta

- **F-DG5-100.** The repair is correct and complete (see the verification sidecar, and evidence `46`, `46b`, `46c` and `46d`).
  - **Text sinks.** I traced every text sink of `docx.ts` (`scriptRuns`, through which `paragraphs`, `heading`, the table cells, header, footer and page-field runs all pass, plus the core properties) and of `pptx.ts` (the document properties and every `addText`, cell and colspan row). Every one goes through `xmlSafe`.
  - **The package check.** `assertWellFormedChars` runs on every OOXML package. A miss there is a `RenderError`, which `export-runner.ts:457-470` maps to the permanent `export.render_failed` and to `store.discard`.
  - **The character-reference regex** (`xml-chars.ts` INVALID_XML_REF). I checked it digit by digit against the XML 1.0 Char production:
    - hex `0-8`, `B`, `C`, `E`, `F`, `10-1F`, `D800-DFFF`, `FFFE` and `FFFF`;
    - decimal `0-8`, `11`, `12`, `14-31`, `55296-57343`, `65534` and `65535`.
  - **No false positive.** The regex cannot fire on escaped user text: `&#11;` typed by a user becomes `&amp;#11;` (probe 46b, harmless row).
- **F-DG5-140** (the qa reviewer's finding; not mine to close).
  - `DEFAULT_PRODUCT_NAMES` (`labels.ts`) replaces the worker's version-0 fallback `deps.productName ?? DEFAULTS.productName` (`export-runner.ts:379-381`). No caller passes the removed `productName` dependency (grep).
  - `labels.test.ts` and `branding.test.ts` pin the three texts as equal. No security effect.
- **The ADR-0046 amendment** states the implemented behaviour exactly.

## Fresh pass over the P5 diff: authorization and separation of duties

- **Commit-time authorization** (`47-commit-time-scan.log`). Each API file the P5 diff touches that registers a write route was flagged unless it names a commit-time helper. I traced every flag:
  - `automation/dry-run.ts` and `versions.ts`: `loadRuleForWrite` → `configurer` → `refreshPrincipal` (`rules.ts:108-113`, `135-158`), inside the write transaction.
  - `forms/bulk.ts`, `custom-values.ts` and `drafts.ts`: `requireRecordWrite` reloads the principal inside the transaction (`record-types.ts:100-112`).
  - `kpi/formula-preview.ts`: a stateless preview. It writes nothing (sweep: AUD 200, no table changed).
  - `methodology/routes.ts`, `reporting/exports/routes.ts` and `reporting/reports/routes.ts` delegate to files that reload the principal: `jobs.ts:346`, `snapshots.ts` `requireWriteAtCommit`, and the methodology modules.
  - `sustainment/handovers.ts` and `transformations/routes.ts`: P5 adds only in-transaction calls (`recordRequestExecution`, `runTransformationInitializers`) to DG3/DG2 writes that already have their commit-time check.
- **KPI restatements** (`kpi/restatements.ts`, `restatement-decisions.ts`).
  - Every write uses `openWrite(..., { atCommit: true })`, If-Match and one audit event. The decision refuses the requester (`selfDecision`) and technical admins (`technicalAdminRefusal`).
  - `kpi_restatement.approve` is held by business roles only (`0087`: SP, …).
- **Methodology migrations** (`methodology/migrations.ts:673-735`). The decision reloads the principal, needs If-Match, takes the transformation lock, and refuses the requester and the submitter. `methodology_migration.approve` is SP-only (`0064:24`); ADM_METHOD holds plan and execute, never approve.
- **Automation identity.**
  - **API and worker share one scope rule.** The API planner (`tasks/automation-actions.ts:98-132`) and the worker twin (`automation/actions/common.ts`) have the same scope order: `outside_rule_scope`, then the initiating user's readership.
  - **Recipients.** They are only active users whose live grant gives `transformation.read` on the target. The worker's SQL is the same rule as the API's `grantApplies`: a transformation grant, or an organization or business-unit grant whose role inherits downward. Reserved scope types (`initiative`, `workstream`, …) grant nothing in either.
  - **Admin rules** are confined to one organization the caller configures in (`rules.ts:245-266`).
  - **Platform starters** take the caller's organization for the configuration right (`rules.ts:144-153`, `lifecycle.ts:170`). Their dry-run plans only `starter_handler`, which plans no recipient, so a dry run cannot disclose another organization's users.
  - **Observation (not a defect).** Starter settings and the Studio configuration (`config_version` has no `organization_id`) are platform-wide by design (ADR-0043 §1/§8, ADR-0044 §1). A multi-organization deployment would share them. That is the documented model, not an authorization gap in the shipped single-organization deployment.
- **Day-90 evidence suggestions** (`launch/day-ninety.ts:150-300`). These are read-only selects scoped to the transformation, behind `transformation.read`, which is the same read rule as the source registers (`evidence/routes.ts` reads are `transformation.read`). Nothing leaks across scopes.
- **0096 Rule A.** The guard compares `to_jsonb(NEW) - {transformation_id, version, updated_at, updated_by}` with OLD, so exactly one transition is possible. The database probe in `45-p5-role-sweep.log` refuses T→T′, T→NULL, and NULL→T without the link.
- **Adopted steps** (`procedures/steps.ts:403-536`). The organization scope is tried first, then T. Each attempt reloads the principal (`refreshPrincipal`) and applies `requireAction` and the step-actor rule.
- **Demo isolation.**
  - `demoDevIssuerBindingAllowed` requires `AUTH_MODE=dev` and a non-production `NODE_ENV` (`guard.ts:125-130`), and `AUTH_MODE=dev` with `NODE_ENV=production` is refused at startup (`config/load.ts:197`).
  - Demo reset has three guards: the API (`admin/environment.ts`: `demo.reset`, commit-time, `environment.not_demo`, `not_configured`, If-Match, a lock); the worker (`handlers/demo.ts:96-99`: `MTH_ENV=demo` and the admin URL); and the database (`demo/reset.ts:78-87`: the demo marker).
  - `deployment_environment` is SELECT-only for `mth_app` (`0090:35`), so the app cannot flip production to demo.
- **Exports.**
  - **Create.** `export.create` is checked at request start and again at commit (`jobs.ts:344-352`). An Idempotency-Key replay re-checks readership and that the body is the same (`jobs.ts:262-266`).
  - **Download.** The file name is sanitized (`storage.ts:62-79`). The download sends `nosniff`, `private, no-store` and an attachment disposition (`routes.ts:84-91`). The sweep confirms 404 for anyone but the requester.

## Data integrity, injection, decimals

- **Decimals.** A float scan of the P5 diff (`Number(`, `parseFloat`, `toFixed` …) found only integers: rubric levels, cursor ranks, byte sizes and date parts (`methodology/scoring-defaults.ts:149`, `exports/jobs.ts:121`). Money, weights and scores are decimal.js.
- **Formula injection.** CSV and XLSX use the shared trigger set `= + - @ TAB CR` (`packages/reporting/src/injection.ts`). The forms CSV (`forms/export.ts:101-113`) has its own copy of the same six triggers, with decimals never prefixed. This is an observation only.
- **Automation conditions** (`automation/conditions.ts`). A fixed operator set (present, absent, eq, neq, in, gt/gte/lt/lte with decimal.js). No dynamic code and no user-supplied regex. The formula engine is the DG3 parser, unchanged in P5, and no `eval`, `new Function` or `vm` exists in product code.
- **The outbox** (`40-outbox-registry.log`). The 26 registered types and the 26 queue-map types match. `report_snapshot.issued` is written only when its schema is registered (`snapshots.ts:579-580`), so it never is today.
  - **Relay** (`relay.ts:52-125`). A failing row ends its round and is excluded after `maxPublishAttempts` (10). It delays later events by at most 10 polls and never stalls them.
- **0094.** It disables the two `gate_instance` guards for one backfill statement inside the migration transaction and re-enables them. The probe shows every trigger enabled after 0001→0097. I accept it as the one-off ADR-0039 C2 exception.
- **Studio invariants** (`0062`). The CHECK `methodology_element_fixed_sets` and the guard `methodology_element_identity_fixed` protect stable keys and fixed sets at the database; a published version is immutable there.

## Web

- **No unsafe rendering.** No `dangerouslySetInnerHTML`, `innerHTML` or `eval` was added.
- **URL sinks.** The only `src=` and `href=` built from data are the logo URL and the forms CSV link. The logo URL is the server constant `/api/v1/branding/logo` (`branding-port.ts:21`); the CSV link comes from `csvExportUrl` (`form-framework/api.ts:100`, ids only).
- **Lazy routes.** 171 lazy routes. The one eager page import is `LoginPage`, which predates P5 (DG1, `e70ac02`).

## Requirement-note disclosures (judged)

- **REQ-PB-093.** The exact 30/20/20/15/15 entry is a component test, not a browser journey. That is acceptable for this review: the API path is decimal and validated, and the residual is UI coverage.
- **REQ-S12-020 and REQ-S12-021.** Their DG6 re-run of A13 is a carry-forward of evidence, not a gap at DG5.
- **REQ-S18-003.** A22 at DG6. The DG5 parts (empty production initialization, seed-demo refused in production) are covered (`guard.ts`, `config/load.ts`; QA/A22 suites in the integration run).
