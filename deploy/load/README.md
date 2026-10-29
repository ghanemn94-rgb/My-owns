# The synthetic load dataset and the load sessions (`deploy/load/`)

ADR-0058 §2, §4 and §8 (REQ-S20-029 "a documented realistic load dataset"). Owner: devops-engineer (T-DG6-DO-E). The
workload harness and the report (`workload.mjs`, `report.mjs`) are T-DG6-DO-F; the full-scale export proof
(`export-proof.mjs`) is T-DG6-BE-S.

> **Synthetic and not production.** Everything here is generated test data: every organization, user and record name
> starts with `LOAD ` (English) or `تجريبي ` (Arabic), e-mails use the reserved `example.invalid` domain, and nothing is
> copied from the demo seed or from real data. A load database grants no real business, Finance or IT approval. Figures
> measured on it are **engineering measurements on the stated sandbox host**, never Mobily production capacity. Final
> production scale, availability and recovery objectives must be agreed with Mobily IT (REQ-S20-029 notes). A load
> stack on one host, Compose or not, is **not** a high-availability deployment.

## Files

| File                      | What it does                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `generate.mjs`            | Writes the dataset `mth_load_v1` into a migrated, **empty** database (owner role), in one transaction               |
| `sessions.mjs`            | Mints one session per load virtual user through the API's own `createSession`, into a file under `$TMPDIR`          |
| `generate.test.mjs`       | Determinism and guard tests (Vitest `integration` project, via `packages/db/test/integration/load-dataset.test.ts`) |
| `../compose/compose.yaml` | The `load` profile (`load-generate`, `load-sessions`), off by default                                               |

No new dependency: both scripts use Node built-ins and `pg`, resolved from `@mth/db`'s own dependency.

## The dataset (`generate.mjs`)

```bash
DATABASE_OWNER_URL=postgres://… node deploy/load/generate.mjs [--profile default|register-1000|smoke] [--seed N]
```

| Entity             | `default` (M0398 sizes)                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organization       | 1 (`LOAD-ORG`)                                                                                                                                                          |
| business units     | 6                                                                                                                                                                       |
| users              | 120: 100 virtual users (30 TL, 20 BO, 20 WL, 15 KDS, 10 FIN, 5 AUD, each on 1–5 transformations) + 20 named owners and approvers (1 access administrator, 19 sponsors)  |
| transformations    | 50, `LOAD-T01` … `LOAD-T50`, phases spread over the six phases                                                                                                          |
| initiatives        | 1,000: `LOAD-T01` holds 250, the other 750 are spread 15–16 per transformation                                                                                          |
| KPI definitions    | 500 (10 per transformation), each with one active version                                                                                                               |
| reporting periods  | 20 monthly periods (organization level, open)                                                                                                                           |
| KPI-period actuals | 10,000 (20 × 500), each with its value row; about 60 % accepted, 30 % submitted, 10 % rejected; decimal values                                                          |
| benefits           | 400                                                                                                                                                                     |
| RAID entries       | 1,500 (risks, assumptions, issues)                                                                                                                                      |
| dependencies       | 500 (between initiatives of one transformation, always acyclic)                                                                                                         |
| decisions          | 500 (executive)                                                                                                                                                         |
| deliverables       | 1,000 (one per initiative)                                                                                                                                              |
| evidence notes     | 1,000 (notes only, no file bytes)                                                                                                                                       |
| audit events       | exactly 100,000 (the events of the writes above, the migrations' own events, and version steps of initiatives, KPI definitions and benefits until the count is reached) |

Benefits, RAID entries, dependencies, decisions and evidence notes are spread over the transformations in proportion to
their initiatives.

- **`register-1000`** is `default` plus one transformation `LOAD-R1K` with 1,000 initiatives, for the REQ-S15-013
  "register with 1,000 initiatives" check only. It holds 105,000 audit events. The M0398 run uses `default`, and the
  report states which profile each figure comes from.
- **`smoke`** is a small profile for the determinism test. It is never a load-run profile.

**How it writes.** It writes the `load_dataset_marker` row first, with the exact counts. Migration `0108` accepts that
row only in an empty database with no production or demo marker, so a production or demo database never receives load
data, and a second run into a load database is refused (exit 3; nothing changes). Every row is written as `mth_owner`
with every trigger enabled, each with its audit event in the same transaction. Transformations go through the
product's own `p4_instantiate_transformation` (which runs the P3 and P2 structure), plus the forms pin that the API's
initializer writes. KPI actuals pass the same guards as the API's: open period, active version, value shape, and a
review row for each decision. No trigger is disabled, and `session_replication_role` is never changed.

**Determinism.** Ids are UUIDs derived by md5 from (dataset, seed, kind, ordinal). Every choice comes from a 32-bit
mulberry32 PRNG seeded with `--seed` (default `20261027`, recorded in the marker). Every timestamp the generator writes
comes from the synthetic clock `2026-09-01T06:00Z`. The rows that `p4_instantiate_transformation` creates keep that
function's own generated ids and times, because that is the product path, unchanged. `datasetRowHashes` hashes the
generator's own rows, its own audit events, the per-action audit counts and the marker. Two runs with one seed give
identical hashes: the test checks this for `smoke`, and the handback evidence records two full `default` runs.

**Search index.** In the same transaction, the generator requests the `search.reindex` job exactly as the API's
`runJobNow` does: the internal outbox event `job.run_requested` plus its `job_schedule.run_now` audit event. A worker
started with `MTH_ENV=load` dispatches the job after the commit. Check the result with `getSearchIndexStatus`, or with
`SELECT record_type, status FROM search_index_state`, before you measure search.

## The sessions (`sessions.mjs`)

```bash
NODE_ENV=production MTH_ENV=load AUTH_MODE=oidc APP_BASE_URL=https://… DATABASE_URL=postgres://mth_app… \
OIDC_ISSUER_URL=https://… OIDC_CLIENT_ID=… OIDC_CLIENT_SECRET=… \
  node deploy/load/sessions.mjs [--duration-minutes 60] [--out "$TMPDIR/mth-load-sessions.json"]
```

- **Configuration.** It reads the same configuration as the API under test (`loadConfig("api")`), so the cookie name
  follows `APP_BASE_URL` exactly as the API's does (`__Host-mth_session` on https).
- **When it runs.** Only when `MTH_ENV=load`, and the database holds the load marker and no `deployment_environment`
  row. Anything else is refused with exit 3 before any write. `MTH_ENV=load` on a non-production build, or with
  `AUTH_MODE=dev`, is a configuration error (exit 78).
- **Who gets a session.** One per load virtual user: the users of the `urn:mth:load-harness` identity issuer holding a
  TL, BO, WL, KDS, FIN or AUD transformation assignment, so 100 in `default`. Each is created with the API's own
  `createSession` (the same token, token hash and CSRF hash), with `auth_mode = 'oidc'` and
  `idp_issuer = 'urn:mth:load-harness'`, so every load session is identifiable as synthetic.
- **Expiry.** The run's duration plus one hour, rounded up to whole hours.
- **No new access path.** No route is added and no login path is changed.
- **The output file holds bearer credentials** of synthetic users of a disposable database. It is written mode 0600,
  only inside `$TMPDIR` (any other `--out` is refused), and never to stdout. Delete it after the run, and never commit
  it.
- **Which modules it loads.** The built modules (`dist/`) when present, as in the mth-app image; otherwise the
  TypeScript sources through Node's type stripping. `MTH_LOAD_MODULES=source` forces the sources.

## `MTH_ENV=load` (packages/config)

- `MTH_ENV=load` needs `NODE_ENV=production` and `AUTH_MODE=oidc`, so a load run measures the production code path and
  the dev login stays refused.
- The two start-up refusals (texts exact, ADR-0058 §4) are in `@mth/config`:
  - `loadDatasetStartupRefusal` returns the refusal text, or null.
  - `assertLoadDatasetEnvironment` reads `load_dataset_marker` and throws a `ConfigError`. The texts are:
    - with `MTH_ENV=load` and no marker: "MTH_ENV=load needs a database generated by deploy/load/generate.mjs."
    - with `MTH_ENV=production` or `demo` and a marker: "This database holds the synthetic load dataset and cannot run
      as production or demo."
  - **The call in `apps/api/src/main.ts` and `apps/worker/src/main.ts` is not wired by this task.** Those files are
    outside its ownership. The two-file patch is in the T-DG6-DO-E handback evidence (`startup-refusal-wiring.patch`),
    for the orchestrator.
- `mth-db bootstrap` and `mth-db seed-demo` refuse a database that holds the marker, with exit 3 and "This database
  holds the synthetic load dataset; it cannot be bootstrapped or seeded as a demo." Nothing changes.

## With Compose (profile `load`, off by default)

Run it as its own Compose project, so it gets its own empty volume, and never against a production or demo stack.
Secrets come from `deploy/scripts/init-secrets.sh`, as for the default stack.

```bash
docker compose -p mth-load -f deploy/compose/compose.yaml up -d --wait db migrate
docker compose -p mth-load -f deploy/compose/compose.yaml --profile load run --rm load-generate   # MTH_LOAD_PROFILE=default
MTH_ENV=load docker compose -p mth-load -f deploy/compose/compose.yaml up -d --wait api worker
MTH_LOAD_OUT_DIR="$TMPDIR/mth-load" docker compose -p mth-load -f deploy/compose/compose.yaml --profile load \
  run --rm load-sessions                                                                          # MTH_LOAD_DURATION_MINUTES=60
```

The API and the worker read `MTH_ENV` from the environment, with `production` as the default, which equals the
`NODE_ENV=production` default. The default stack's behaviour is unchanged. The `load-*` services mount `deploy/load`
read-only at `/app/deploy/load` in the mth-app image.

## Measured here

These are T-DG6-DO-E's runs on 2026-10-29: the sandbox host (4 vCPU Intel Xeon @ 2.80GHz, 16 GB, kernel
6.18.44-fc-v185, Node 24.21.0, PostgreSQL 16.15, a disposable cluster on the same host). Other jobs shared the host, so
treat the times as indicative. Logs are in `docs/delivery/handbacks/DG6/T-DG6-DO-E-evidence/generate/`.

| Run                             | Wall time | Rows written before COMMIT | Result                                                                     |
| ------------------------------- | --------- | -------------------------- | -------------------------------------------------------------------------- |
| `default`, database 1           | 337.9 s   | 32.6 s                     | exit 0; marker counts = stored counts; 100,000 audit events; 154 MB        |
| `default`, database 2           | 419.3 s   | 41.9 s                     | exit 0; all 22 row hashes identical to database 1                          |
| `default` into database 2 again | —         | —                          | exit 3, refused by `load_dataset_marker_empty_database`; nothing changed   |
| `register-1000`, database 3     | 880.0 s   | 63.4 s                     | exit 0; `LOAD-R1K` 1,000 initiatives, `LOAD-T01` 250; 105,000 audit events |

**Where the time goes: the COMMIT.** About 90 % of each run is spent at the COMMIT, in the deferred
`*_audit_required` checks. Profiled: `p2_audit_required` ran 99,333 times for 605.9 s, about 6.1 ms each. Its lookup
compares `audit_event.record_type` (text) with `TG_TABLE_NAME` (type `name`), so PostgreSQL uses only `record_id` from
`audit_event_record_idx` and walks the whole index on every check (`EXPLAIN`: `Index Cond: (record_id = …)`,
`Filter: (record_type = 'initiative'::name …)`). The cost grows with the size of the audit trail, and every audited API
write pays it too. This is raised in the DO-E handback as a finding candidate for BE-S (a corrective migration
comparing `TG_TABLE_NAME::text`). It is not changed here. These are generation times only, not load-test results: the
workload and the p95 figures are T-DG6-DO-F's.
