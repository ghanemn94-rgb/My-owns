# ADR-0070: P7 schema, API and connector handover: the data-dictionary coverage rule against a migrated database, the ERD scope, the OpenAPI completeness report with no skip list, the connector handover list generated from the `environment.md` residual table, and the `docs/handover/{data,api}/` layout

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-04), 2026-11-12. Base `a5e67854ca2296d1385040f2786d46afe963e596` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice F of `docs/architecture/p7-plan.md`):** REQ-S19-005, REQ-S19-007, REQ-S17-004. Clean deployment and transfer (slice B) is ADR-0069.
- **Sources (quoted where a design point has one):**
  - Acceptance texts (binding):
    - REQ-S19-005: "A18: the data dictionary covers every table and column in the final schema; production initialization on a clean database succeeds". Its title: "Include the final database schema, migrations, data dictionary, ER diagram, validation rules, indexes and safe production initialization (handover item 3)". Its procedure: "The data dictionary is generated from the schema and reviewed". Its path: `docs/handover/data/`.
    - REQ-S19-007: "A17;A18: every endpoint and connector in the release is described and passes its contract test". Its path: `docs/handover/api/`. Its title names "authentication setup and connector contracts".
    - REQ-S17-004: "A17: contract tests pass against the local adapters; the integration status page shows 'not verified' for every enterprise connector without a recorded authenticated test". Its procedure: "the handover lists required endpoints and credentials".
  - p7-plan §1.2: the plan names `tools/release/dictionary-coverage.mjs` "against a migrated database", "the contract sweep on the DG7 candidate … no skip list", and `docs/handover/api/connectors.md` "matching that table" (`environment.md` l.81–110).
  - Playbook: no block concerns schema or API documentation. Nothing below is attributed to it.
- **Decisions applied:** D-243 Q15 (bootstrap re-proved, no new code: ADR-0069 §4 D4); D-243 Q13 (approved records are never rewritten: a coverage gap in a DG1–DG6 dictionary section is **added to**, never edited away); p7-plan §5.3 ("DO-H's dictionary-coverage gaps are fixed by the orchestrator or an ARCH repair, never by DO-H").
- **Builds on:** ADR-0003 (schema conventions), ADR-0007 (contract-first OpenAPI), the contract suite (`apps/api/test/integration/contract/contract.test.ts`: route coverage, "every operation is exercised", the pending lists), ADR-0055/0056 (connectors, local adapters, `verification`), `catalogue.test.ts` (the schema pinned against `information_schema`).
- **Two gate systems.** Coverage reports are engineering evidence. IT's acceptance of the handover is external. Nothing here reads or writes DG0–DG7.

## Context

1. **The dictionary is hand-assembled per stage.** `docs/architecture/data-dictionary.md` has a section per stage (P7 slice E was generated from a migrated database by T-DG7-ARCH-03's `gen-dictionary.ts`). Nothing checks that it covers every table and column. `catalogue.test.ts` compares `packages/db/src/schema.ts`, not the dictionary.
2. **The contract suite already fails** when an operation has no route, a route has no operation, or a routed operation is not exercised. The only exclusion is the pending lists (`p2-pending.ts`, which aggregates P2–P7), and the suite refuses a pending entry that is already exercised. Pending lists must be empty at every freeze. `NO_400_OPERATIONS` lists operations with no input that could produce a 400. It is a statement of fact, not a skip.
3. **Connectors.** Each P6 connector kind ships with a local adapter and contract tests (ADR-0055). `integrations/connectors.ts` l.615 reports `verification: "verified" | "not_verified"`. The P6 residual table in `environment.md` lists each live integration that was not exercised, and what IT supplies for it. No handover file collects the endpoints and credentials.

## Decision

### 1. The dictionary coverage rule (REQ-S19-005; DO-H `tools/release/dictionary-coverage.mjs`)

- **Input:** a database migrated with every shipped migration (`--database-url`, read-only queries), and the dictionary files `docs/architecture/data-dictionary.md` plus `docs/handover/data/pgboss.md` (§1.3).
- **The schema side** comes from the catalogue: every base table, partitioned table and view of schemas `public` and `pgboss`, and every column (`attnum > 0`, not dropped), with `format_type(atttypid, atttypmod)` and nullability.
- **The dictionary side** is parsed with fixed rules:
  - a table is documented by exactly one heading line `## <table>` (public) or `## pgboss.<table>`;
  - its columns are the rows of the first Markdown table after that heading whose header starts `| Column | Type |`;
  - a column is documented when its row's first cell equals the column name and its second cell equals the catalogue type. Where the table has a `Null` column (the generated sections), its value must match the catalogue's nullability. Older sections have `| Column | Type | Constraints |` without one (for example `schema_migration`), and for those the nullability is reported, not failed.
- **Pass** (exit 0) when:
  - every catalogue table is documented exactly once;
  - every column is documented with its type (and nullability where the section has a `Null` column);
  - **no** documented table or column is missing from the database (a stale entry fails too).
- **Fail** (exit 1) lists every gap. **BLOCKED** (exit 2/3) applies when the database cannot be reached or is not fully migrated (the tool checks `migrationStatus` first).
- **Reported, not gating:** for each table, the indexes, constraints and triggers that the catalogue has and the section does not name. REQ-S19-005's title names "validation rules, indexes", while its acceptance names tables and columns. The counts appear in the report and in `docs/handover/data/README.md`. A missing constraint or index name is a documentation gap that the orchestrator assigns, not a release blocker.
- **Gaps are repaired by adding sections,** in the orchestrator's or an ARCH repair's change, never by editing an approved section's content (D-243 Q13). Sections generated from the database (the T-DG7-ARCH-03 generator) are the preferred form.

#### 1.1 ERD scope

`docs/architecture/erd.md` is conceptual (§2: the §16 entity groups) and physical by stage (§1–§1ad, Mermaid). Its scope is **entities and relationships, not columns**. The coverage tool reports each public table that appears in no ERD section, as a count and a list, and this does not gate. An ERD section that names a table which does not exist **fails**, because the diagram would then be wrong. P7 slices B and F add no table, so their ERD section says so (§1ae).

#### 1.2 Production initialization

"Production initialization on a clean database succeeds" is proven by ADR-0069 §4 step D4 (`mth-db migrate` then `mth-db bootstrap` on a clean database; a second `bootstrap` refuses), and by `clean-start-local.sh` phase A. No new code is needed (D-243 Q15).

#### 1.3 `docs/handover/data/` (DO-H)

| File | Content |
| --- | --- |
| `README.md` | The index of handover item 3: where the migrations are (`packages/db/migrations/`, forward-only, ADR-0003), the dictionary and ERD (`docs/architecture/`), validation rules (CHECK constraints and triggers in the dictionary sections), indexes, production initialization (`mth-db bootstrap`, link to the deployment guide), the migration catalogue (ADR-0068), and the coverage figures copied from `coverage.json` |
| `pgboss.md` | The `pgboss` schema tables and columns, generated from the catalogue, with the note that the schema is owned by pg-boss (11.0.0, generated into `0006_pgboss_schema_v25.sql`) and changed only by its own migrations |
| `coverage.json` | The tool's output on the candidate: `schemaVersion` `mth-dictionary-coverage/1`, the migration level, the table and column counts, the gaps (empty on a pass), the reported-only counts, the SHA-256 of each dictionary file read |

### 2. The OpenAPI completeness report (REQ-S19-007; DO-H `tools/release/openapi-coverage.mjs`)

The report joins three facts and fails if any one is missing:

1. **Described.** Every operation in `docs/api/openapi.yaml` has an `operationId`, a `summary`, at least one tag that is declared under `tags`, and a response for each status it returns. Every `2xx` with a JSON body has a schema. `pnpm openapi:lint` must pass.
2. **Routed and exercised, with no skip list.** The report reads the contract suite's run (`vitest --reporter=json` of `apps/api/test/integration/contract/`) and requires all of these:
   - the tests "maps every governed Fastify route to an OpenAPI operation with the same method, and back" and "covers every operation with at least one success and every successful body with its zod mirror" passed;
   - every pending list (`p2-pending.ts` … `p7-pending.ts`, through the aggregate) is **empty**;
   - the source of the contract test files contains no `.skip`, `.todo` or `.only`;
   - the pinned count in `contract.test.ts` equals the number of operations in the document.

   `NO_400_OPERATIONS` is printed with its reason ("no input that can be invalid") and is not a skip.
3. **Response-validated.** `response-validation.test.ts` passed in the same run.

- **Output:** `docs/handover/api/openapi-coverage.json` (`mth-openapi-coverage/1`) with the contract version, the operation count, the routed and exercised counts (equal to the operation count on a pass), the pending lists (empty), and the SHA-256 of `openapi.yaml`.
- **The P7 count pin.** The final count is fixed by the orchestrator when the last P7 operation lands (p7-plan §5.3). At this revision it is **962** (951 after ARCH-02, 961 after ARCH-03, plus `getDeploymentStatus`).

### 3. Connector contracts and the endpoint and credential list (REQ-S17-004, REQ-S19-007; DO-H)

- **`docs/handover/api/connectors.md`** is **generated** by `tools/release/connector-handover.mjs`. Its sources, all read-only:
  - the integration rows of the `environment.md` table "P6 residuals: live integrations not exercised in this environment", with the columns "What is proven here", "Residual" and "What Mobily IT supplies";
  - the connector adapter kinds in `apps/api/src/modules/integrations/connectors.ts`;
  - the contract test file of each adapter;
  - the `.env.example` keys and the SecretRef names each integration needs.

  For each integration it lists:
  - the local adapter and its contract test file;
  - the endpoint IT supplies;
  - the credential IT supplies, by **name** (a `*_FILE` key or a SecretRef name, never a value);
  - the live status, "not verified" unless a recorded authenticated test exists. None exists here, so every enterprise connector reads "not verified".
- **Parity test (T-F6):** every integration row of the `environment.md` table appears in `connectors.md` and every `connectors.md` row has a source row. Every adapter kind in `connectors.ts` appears. The committed file equals a fresh generation. So the two documents cannot drift (p7-plan §1.4 last row).
- **"Not verified" in the product (REQ-S17-004):** the A17 re-run by QA-C proves that the integration status page shows "not verified" for every enterprise connector without a recorded authenticated test. No new code is planned. If the A17 re-run finds a connector that shows anything else, that is a finding against ADR-0055, not a slice F change.
- **`docs/handover/api/authentication.md`** (DO-H): the session cookie and CSRF rules (from the contract's description), OIDC client registration (redirect URI `<origin>/api/v1/auth/callback`, post-logout URI, scopes, the claims used), the origin rule of ADR-0069 §1, and service identities of jobs and connectors (ADR-0053). It links to `docs/operations/identity-saml-broker.md` and the deployment guide.
- **`docs/handover/api/README.md`** (DO-H): where the contract is, its version, the operation count and coverage figures from `openapi-coverage.json`, and links to `authentication.md` and `connectors.md`.

### 4. Layout

```text
docs/handover/
  data/   README.md, pgboss.md, coverage.json          (DO-H; generated parts regenerated by the tools)
  api/    README.md, authentication.md, connectors.md, openapi-coverage.json   (DO-H)
```

The dictionary, ERD and contract stay at `docs/architecture/` and `docs/api/`, which the release archive carries under `docs/` (ADR-0062 §2). The handover files link to them rather than copy them, so there is one source. DOC-B's index (`docs/handover/README.md`, ADR-0072) links both directories (DO-H requests the lines in its handback).

### 5. Schema and contract of this ADR

No migration, no table and no operation. The `docs/handover/**` files are generated or written by DO-H. The coverage tools are `node --test`-tested under `tools/release/tests/` (p7-work-split §2 rule 3).

### 6. Who builds it, and how it is tested

| Task | Builds | Tests (ids of `p7-work-split.md` §F.4) |
| --- | --- | --- |
| DO-H | `tools/release/{dictionary-coverage,openapi-coverage,connector-handover}.mjs` (+ tests), `docs/handover/{data,api}/**` | T-F1…T-F8 |
| orchestrator or an ARCH repair | the dictionary and ERD sections for any gap T-F1 finds on the merged tree | T-F1 re-run passes |
| QA-C | A17 re-run (local adapters, "not verified") and the A18 re-run that includes D4 | A17, A18 |

## Consequences

- Positive: each coverage claim in the handover is a tool result on the candidate, not prose. Gaps surface as lists.
- Positive: the connector handover is generated from the same table as the known limitations, so the two cannot disagree.
- Negative: older dictionary sections may lack columns added by later repairs. The first DO-H run may find gaps that need an orchestrator repair before the freeze.

## Residuals (honest)

1. **Indexes, constraints and triggers** are reported, not gated (§1).
2. **The ERD** is checked for wrong names, not for completeness (§1.1).
3. **"Passes its contract test" for connectors** means against the local adapters. No live corporate endpoint is exercised (the `environment.md` residuals).
4. **The dictionary is not regenerated wholesale.** Approved sections stay as they are, and gaps are added in new sections.

## Alternatives considered

1. **Regenerate the whole dictionary from the database.** Rejected: it would rewrite approved DG1–DG6 records and drop their hand-written purpose and lifecycle text (D-243 Q13). New gaps use the generator.
2. **Gate on indexes and constraints too.** Rejected for P7: the acceptance names tables and columns, and gating on more would turn a documentation polish into a release blocker. The counts are reported.
3. **Copy the dictionary and the contract into `docs/handover/`.** Rejected: two copies drift. The archive carries `docs/architecture/` and `docs/api/`.
4. **A hand-written connector list.** Rejected: it would drift from `environment.md`.

## Version evidence (M0314)

No new dependency. The tools use Node 24.21.0 built-ins and the lockfile's `yaml` 2.8.1 through `createRequire` (p7-work-split §2 rule 3, the `check-ci-needs.mjs` precedent). They read the database with the `pg` client already in the workspace, resolved the same way. vitest's built-in `json` reporter is part of the pinned vitest.
