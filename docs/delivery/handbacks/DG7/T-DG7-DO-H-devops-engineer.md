# Handback T-DG7-DO-H (devops-engineer): coverage tools and `docs/handover/{data,api}/`

- **Stage:** DG7 (P7 "Independent transfer and release"), task §F.1 of `docs/architecture/p7-work-split.md` (ADR-0070).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-H-devops-engineer-20261113T075457Z-8d2cd769","session_id":"8d2cd769-b447-49d6-affe-5d6dd356c485"}`
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-H.md`, sha256 `b0de8e60bb5ed90d6d3b4eb8fa1dfe97f6804e5c6088ae22d89add31e1f04b33` (verified).
- **Base:** `a17aa3dd8326c8c5ea0dd211a058629a8d58aeb3` on `claude/mobily-transformation-platform-dg6-regate`. Before writing, the tree was clean apart from the runner's own `docs/delivery/runs/DG7/…` directory.
- **Time:** started 07:55:06 UTC, finished 08:32:33 UTC (from `date -u`).
- **Environment:** Node 24.21.0; offline; uid 0 in the agent sandbox; PostgreSQL 16.15 (`/usr/lib/postgresql/16/bin`), disposable clusters through `tests/qa/support/with-pg.sh` and `pg-port.sh` (port 24351, attempt 1); no Docker daemon (D-243 Q1, not needed by this task). About 3.7 GB of disk was free. No extra checkout was made, and the cluster directories were removed by their harnesses.
- **Engineering evidence only.** Nothing here grants or implies a G1–G6 business approval, DG7, or Mobily IT's acceptance of the handover.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `tools/release/dictionary-coverage.mjs` (new) | ADR-0070 §1/§1.1. Compares a migrated database's catalogue (`public` and `pgboss`: tables, partitioned tables and views, columns with `format_type()` and nullability) with the dictionary headings and column tables, and the physical ERD names. Reports unnamed indexes, constraints and triggers without failing on them. `--write-pgboss` renders `pgboss.md`. Exit 0/1/2/3. |
| `tools/release/openapi-coverage.mjs` (new) | ADR-0070 §2. Joins "described" (from `openapi.yaml`), "routed and exercised" (the two required tests, pending lists, count pin, no skip) and "response-validated" (from the vitest JSON). Unproven counts are `null` (Unknown), never 0. Exit 0/1/2/3. |
| `tools/release/connector-handover.mjs` (new) | ADR-0070 §3. `--write`/`--check`. Generates `connectors.md` from the `environment.md` residual table, `CONNECTOR_ADAPTER_KINDS` and `.env.example`. It checks parity both ways and that every named file and key exists. Exit 0/1/2. |
| `tools/release/tests/dictionary-coverage.test.mjs` (new) | T-F1, T-F2, T-F3 on a disposable cluster (pg-port.sh policy; `TEST_DATABASE_ADMIN_URL` reused when set), plus the pgboss rendering round trip. |
| `tools/release/tests/openapi-coverage.test.mjs` (new) | T-F4 on a fixture document, sources, pending lists and vitest JSON. |
| `tools/release/tests/connector-handover.test.mjs` (new) | T-F6 (parity, adapter kinds, `--check` against a fresh generation, drift in a fixture root) and T-F7 ("Not verified", no claim words, secret scan of `docs/handover/api/`). |
| `docs/handover/data/README.md` (new) | Index of handover item 3, with the coverage figures copied from `coverage.json`. |
| `docs/handover/data/pgboss.md` (new, generated) | The `pgboss` tables and columns from the catalogue (5 tables). |
| `docs/handover/data/coverage.json` (new, generated) | `mth-dictionary-coverage/1` on the merged tree: **FAIL, 176 gaps** (§4). |
| `docs/handover/api/README.md` (new) | Contract location and version, coverage figures from `openapi-coverage.json`, links. |
| `docs/handover/api/authentication.md` (new) | OIDC client registration (redirect and post-logout URIs, scopes, claims), first sign-in rules, session cookie and CSRF, the origin rule (ADR-0069 §1), service identities (ADR-0053 §1), SecretRefs. |
| `docs/handover/api/connectors.md` (new, generated) | The 8 integrations (adapter, contract tests, endpoint and credential names, "Not verified"), the verbatim IT-supplies column, and the 3 adapter kinds. |
| `docs/handover/api/openapi-coverage.json` (new, generated) | `mth-openapi-coverage/1` on the merged tree: **FAIL**, with 22 "described" gaps (§4). Routed = exercised = pin = 965, 0 pending, 0 skipped. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-H-evidence/*` | Logs (listed in §3). |

`apps/api/test/support/p7-pending*.ts`: there was nothing to remove. Every P7 pending list was already empty at the base (`p7-pending-be-{b,c,d,f,g,h}.ts` are `[]`). §F.1 declares no operation and no migration, so I took no migration id.

## 2. Behaviour per requirement

- **REQ-S19-005** (dictionary covers every table and column; ERD; validation rules and indexes):
  - The tool implements the ADR-0070 §1 rules. T-F1, T-F2 and T-F3 pass.
  - T-F8, the real run on the merged tree, ran and **FAILs with 176 gaps**. So the clause "the data dictionary covers every table and column in the final schema" is **not met yet**. The gaps are for the orchestrator or an ARCH repair (p7-plan §5.3). I did not edit `data-dictionary.md` or `erd.md`.
  - Reported-only figures: 395 indexes, 4099 constraints and 47 triggers not named, and 9 public tables in no ERD section.
  - "Production initialization" belongs to DO-D and QA-C (ADR-0069 D4) and is not claimed here.
- **REQ-S19-007** (every endpoint described and passes its contract test; authentication setup and connector contracts):
  - The contract suite ran on the merged tree: 3 files, 231 tests, all passed, exit 0. The routed and exercised counts both equal 965, the count pin equals 965 operations, every pending list is empty, and no `.skip`, `.todo` or `.only` appears in the contract sources. `response-validation.test.ts` passed (119 tests).
  - The **"described" half fails** (T-F5 FAIL): 21 operations have no `summary`, and `getBrandingTokens` has the tag `admin`, which is not declared under `tags`. The fixes are in `docs/api/openapi.yaml`, which is frozen for DO-H.
  - `authentication.md` and `connectors.md` are delivered, and T-F6 passes.
- **REQ-S17-004** (handover lists endpoints and credentials; "not verified"):
  - `connectors.md` lists, for each of the 8 integration rows, the endpoint IT supplies and the credentials by name (`*_FILE` keys and SecretRef fields such as `accessKeyRef`, `secretKeyRef`, `usernameRef`, `passwordRef`, `credentialRef` and `bearer`). Every row reads "Not verified", with the F.3 sentences in English and Arabic (the Arabic is provisional).
  - T-F7 passes, and the ADR-0063 secret scan of `docs/handover/api/` passes.
  - The in-product A17 re-run belongs to QA-C and is not claimed here.

## 3. Checks run (real exit codes)

| Check | Command | Result |
| --- | --- | --- |
| T-F1, T-F2, T-F3 (+ pgboss round trip, usage) | `node --test tools/release/tests/dictionary-coverage.test.mjs` | **exit 0**: 13/13 pass (the test's own disposable cluster, pg-port.sh) |
| T-F4 | `node --test tools/release/tests/openapi-coverage.test.mjs` | **exit 0**: 13/13 pass |
| T-F6, T-F7 | `node --test tools/release/tests/connector-handover.test.mjs` | **exit 0**: 12/12 pass |
| The three suites together, final tree | as above, one command (`check-do-h-suites-final.log`) | **exit 0**: 38 tests, 38 pass, 0 skipped |
| T-F8 (real run, merged tree) | `tests/qa/support/with-pg.sh bash <script>` (roles, database, `mth-db migrate`, then `node tools/release/dictionary-coverage.mjs --database-url … --out docs/handover/data/coverage.json`) | migrate **exit 0** (131 applied, 2.68 s); coverage **exit 1: FAIL, 176 gaps** (364 tables, 5761 columns, 2 schemas) |
| Contract suite (input of T-F5) | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract --reporter=json --reporter=dot --outputFile.json=<file>` | **exit 0**: 3 files, 231 tests passed, 225 s of test time (3m48s wall) |
| T-F5 (real run) | `node tools/release/openapi-coverage.mjs --vitest-json <file> --out docs/handover/api/openapi-coverage.json` | **exit 1: FAIL**, 22 "described" reasons. Pending 0, skipped 0, pin 965 = 965 operations, routed 965, exercised 965 |
| T-F6 on the committed file | `node tools/release/connector-handover.mjs --check` | **exit 0** |
| T-F7 secret scan | `node tools/release/secret-scan.mjs --path docs/handover/api` | **exit 0** (`secret-scan: PASS`) |
| Typecheck | `pnpm -r typecheck` | **exit 0** (246 s) |
| Lint | `pnpm lint` | **exit 0** (42 s; `tools/**` is outside ESLint's scope by config) |
| OpenAPI lint | `pnpm openapi:lint` | **exit 0** (1 s) |
| Unit tests | `pnpm test` | **exit 0** (342 s) |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (82 s; `docs/` and `tools/` are in `.prettierignore`) |
| Historical validator | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0** (106 s) |
| All release and licence tests | `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | **exit 1**: 410 tests, 406 pass, **1 fail**, 2 skipped. The failure is T-A5 (`build-from-archive.test.mjs`, DO-A's): `pnpm install` exit 226, `EROFS: read-only file system, symlink … /root/.local/share/pnpm/store…`. The host pnpm store is read-only in this agent sandbox, the same environmental cause DO-A recorded (T-DG7-DO-A handback l.102, l.124). It is not caused by this task's files, and it is **not** reported as a pass. Skipped: T-A11 (`BLOCKED: no assembled runtime tree`) and T-A3 (bsdtar not installed). All DO-H suites in this run passed (ok 37–40, 45). |
| Integration tests touched | none | DO-H touched no integration test. The contract test ran (above). |

Evidence files (`docs/delivery/handbacks/DG7/T-DG7-DO-H-evidence/`):

- `dictionary-coverage-real-run.log` and `dictionary-coverage-real-output.txt`: T-F8. `with-pg.sh` creates `mth_owner`/`mth_app` and a UTF8/C database owned by `mth_owner`, then runs `mth-db migrate` as `mth_owner` (exit 0, 131 migrations in 2.68 s; 4.05 s on the first run), then `--write-pgboss` (exit 0), then coverage (exit 1).
- `contract-suite-run.log` and `contract-vitest.json` (sha256 `384bfa65…38d8bf3d5`): the contract suite. 3m48s wall time, exit 0.
- `openapi-coverage-real-output.txt`: T-F5, exit 1.
- `check-*.log` and `checks-summary.txt`: the acceptance checks.

Checksums of the committed outputs (sha256):

- `coverage.json`: `36ad0913428a43a831cc7a2a05e273c6da698fa11a09f65cc38fc73e5df970a8`
- `pgboss.md`: `095da4c0cdcfc69fd1d24087e58ffbeb99720770c3c9e53eb108692a2864bac9`
- `openapi-coverage.json`: `63b972c559c9a64bc9a424e1be1afb9ae2c5901c01551b93079c2cc37f3ffaa6`
- `connectors.md`: `692fa5fa14d3de71dcc262ad80122139d269546286cf07b6e908016c9bb713b7`
- `openapi.yaml`, as recorded in the report: `7d7e490d877226a676400e13141fb6a54511d86731bbee1a7751eabc8e1c2148`

## 4. Known gaps / not done

1. **T-F8 FAIL: 176 dictionary gaps for the orchestrator or an ARCH repair.** The full list is in `coverage.json` under `gaps`. Breakdown:
   - **128 missing columns.** Some come from older P1 sections that put several columns in one row ("version, stamps", "name_en / name_ar"): `app_user`, `business_unit`, `delegation`, `organization`, `permission`, `role`, `scoped_assignment`, `transformation`. The others are columns added by later migrations to tables documented earlier: `action_item`, `decision`, `my_work_draft`, `inbox_notification`, `initiative`, `export_job`, `evidence_content` and others. The two views `approval_decision_record` and `traceability_edge` document their columns as a bullet list, not a `| Column | Type |` table.
   - **11 stale entries.** 10 are those combined rows. The 11th is the heading `## \`procedures\` v2 (0095)`, whose first word is not a table.
   - **29 type mismatches.** 28 are alias spellings only: `timestamptz` against `timestamp with time zone`, and `char(n)` against `character(n)`. One is real: `export_job.snapshot_id` is documented `NOT NULL`, but the database column is nullable (migration 0124 changed it).
   - **4 duplicate headings:** `delegation`, `kpi_definition`, `methodology_version`, `transformation_config_pin`. Later stages re-documented these tables under a second `##` heading.
   - **3 missing views:** `actor_display`, `business_unit_closure`, `scope_node`. They are documented under `###` headings in "Views (read models)", but the rule requires `##`.
   - **1 ERD name:** `P2_record` in §1b.6 is a placeholder, not a table.
2. **T-F5 FAIL: 22 "described" gaps in `docs/api/openapi.yaml`** (frozen for DO-H). These operations have no `summary`:
   - `getOrganization`, `getBusinessUnit`, `updateBusinessUnit`, `getUser`, `getRoleAssignment`, `getTransformation`, `getStrategicGuardrail`
   - `getOutcome`, `getKpiDefinition`, `getBaseline`, `getOutcomeKpi`, `getValuePool`, `getDiagnosticItem`, `getDiagnosticFinding`
   - `getWorkstreamOutput`, `getTomGap`, `getCapabilityHeatmapEntry`, `getJourney`, `getDependency`, `getActionItem`, `getTomWorkshop`

   Also, `getBrandingTokens` uses the tag `admin`, which is not declared under `tags`. After the fix: re-run the contract suite, then `openapi-coverage.mjs`, then copy the figures into `docs/handover/api/README.md`.
3. **T-F5 and T-F8 belong to the freeze.** Any later migration or operation means re-running both tools and regenerating `coverage.json`, `pgboss.md` and `openapi-coverage.json`, and updating the two READMEs' figure tables, which I copied by hand.
4. **When PostgreSQL is missing, the T-F1–F3 suite is skipped with a `BLOCKED:` reason** (exit 0 from `node --test`), unless `MTH_REQUIRE_PG=1`. CI should set `MTH_REQUIRE_PG=1` so that a missing database cannot pass silently. That change goes in a CI fragment for the wave's CI owner. I did not edit the CI files.
5. **No CI job was added** for the three tools (p7-work-split §2 rule 9: CI files are not mine to edit).
6. **The connector mapping in `connector-handover.mjs` is hand-maintained** (adapter, test files, endpoint and credential names per row). The generator fails if a row has no mapping, a mapping has no row, a named file or `.env.example` key is missing, or an adapter kind is not covered. It cannot check that a credential *name* is the one the code uses. I checked that by reading `admin/storage.ts`, `admin/notification-channels.ts`, `assistant/settings.ts` and `integrations/adapters/http-pull.ts`.

## 5. Merge instructions and open questions

- **No migration, no operation, no product code.** The merge order doesn't matter, except that `connectors.md` must be regenerated (`node tools/release/connector-handover.mjs --write`) whenever the `environment.md` residual table changes. Otherwise `--check` fails, and that is intended.
- **Index lines requested from DOC-B** for `docs/handover/README.md` (p7-work-split §2 rule 10):
  - `- [Database schema, migrations and data dictionary](data/README.md): handover item 3 (REQ-S19-005); coverage report data/coverage.json.`
  - `- [API contract, authentication and connectors](api/README.md): REQ-S19-007, REQ-S17-004; coverage report api/openapi-coverage.json.`
- **Open questions for the orchestrator or architect:**
  1. **Duplicate headings against D-243 Q13.** ADR-0070 §1 requires exactly one `##` heading per table, and Q13 says gaps are closed by *adding* sections. A table that already has two approved headings (4 cases), or that needs new columns documented, cannot satisfy both rules without changing an approved section. Possible ways out: let the tool merge the column tables of repeated headings, or allow a repair heading form (for example `### <table> (columns added by NNNN)`), which the tool would then have to accept. This needs an ARCH decision. I did not loosen the rule.
  2. **Type aliases.** Should `timestamptz` ≡ `timestamp with time zone` and `char(n)` ≡ `character(n)` count as equal? ADR-0070 §1 says "equals the catalogue type", so the tool is strict, and that produces 28 of the 176 gaps.
  3. **Views under `###`.** Should the tool accept `### <view>` sections inside "Views (read models)", or should the repair add `##` sections?
  4. **Partitions.** Partitions of partitioned tables (`pgboss.job`'s children, for example) are excluded and covered by their parent. Please confirm that this reading of "every base table" is intended.
