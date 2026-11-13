# Handover item 3: database schema, migrations and data dictionary

This folder is the entry point for Mobily IT to the hub's database. It links to the single source of each artefact and does not copy it (ADR-0070 §4).

## Where things are

| What | Where | Notes |
| --- | --- | --- |
| Migrations | `packages/db/migrations/` | Forward-only SQL files `NNNN_name.sql`, applied in order by `mth-db migrate` (ADR-0003). The runner refuses a changed applied file, a database newer than the code, and a pending file whose id is not above the highest applied one. |
| Data dictionary | `docs/architecture/data-dictionary.md` | One section per table, added stage by stage. Approved sections are never rewritten: a gap is closed by adding a section (D-243 Q13). |
| Queue schema (`pgboss.*`) | [`pgboss.md`](pgboss.md) | Generated from the catalogue. Owned by pg-boss 11.0.0. |
| ER diagram | `docs/architecture/erd.md` | Physical model by stage (§1–§1af) and the conceptual model (§2). Its scope is entities and relationships, not columns. |
| Validation rules | the dictionary sections | CHECK constraints are in each section's "Column constraints" column and its constraint list. Trigger guards are listed per table and in the "functions" sections. |
| Indexes | the dictionary sections | Listed per table where the section names them. The coverage report below counts the ones a section does not name. |
| Production initialization | `mth-db migrate`, then `mth-db bootstrap` | See `docs/operations/clean-start.md`. A second `bootstrap` refuses (ADR-0069 §4 D4). |
| Migration catalogue | `docs/handover/migration-catalogue.json`, `docs/handover/upgrades.md` | Each migration classified additive, data rewrite or destructive, with its recovery path (ADR-0068). |

## Coverage of the dictionary (from `coverage.json`)

`coverage.json` is the output of `tools/release/dictionary-coverage.mjs` on a disposable database migrated with every shipped migration (ADR-0070 §1):

```sh
node tools/release/dictionary-coverage.mjs --database-url <url> --out docs/handover/data/coverage.json
```

The figures below were copied from `coverage.json` as committed with this file. They were measured on PostgreSQL 16.15, with 131 migrations applied, up to `0148_p7_retention_job.sql`. The report is engineering evidence and states no IT acceptance.

| Measure | Value |
| --- | --- |
| Result | **FAIL: 176 gaps** (listed in `coverage.json` under `gaps`) |
| Tables and views checked (schemas `public` and `pgboss`) | 364 |
| Columns checked | 5761 |
| Indexes not named in their section (reported only) | 395 |
| Constraints not named in their section (reported only) | 4099 |
| Triggers not named in their section (reported only) | 47 |
| Columns in sections without a `Null` column (nullability reported, not compared) | 121 |
| Public tables in no ERD section (reported only) | 9 |

The gaps are closed by the orchestrator or an ARCH repair, by adding dictionary sections (p7-plan §5.3). Until `coverage.json` reads `"result": "PASS"`, this handover item is **not complete**: REQ-S19-005 requires "the data dictionary covers every table and column in the final schema".
