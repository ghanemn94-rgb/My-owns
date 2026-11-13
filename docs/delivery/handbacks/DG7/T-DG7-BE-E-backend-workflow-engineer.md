# Handback T-DG7-BE-E: evidence bytes (backend-workflow-engineer)

- **Stage:** P7 / DG7 (BUILDING). Task: p7-work-split §C.3 (ADR-0064 §5, §6 step 3; ADR-0066 §1, §4; D-248 O1).
- **Invocation:** `DG7-T-DG7-BE-E-backend-workflow-engineer-20261113T011626Z-29f241ee`, session `29f241ee-f7a2-4852-a405-9d8e05a70b58`.
- **Base:** `d465ee282aad4927a170239aed86e526504e8396` (`git status` was clean except this run's own run directory).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-E.md`, sha256 `665c1f8a2a876f808196c2c467b618e0b098113e2b8da57efda36d2a87dfa486` (verified).
- **Time:** start `2026-11-13T01:16:35Z` (`date -u`); end recorded in §3.
- **Migrations:** none. **API endpoints added:** none (the copy is CLI-only, p7-work-split §C.11).
- Nothing here grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes a DG0–DG7 record.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/transfer/attachments.ts` (new) | The byte copy through the `EvidenceStore` port: `readForExport(store, entry)` and `evidenceStoreObjectSource(store)`, `copyIn(store, dir, manifest)`, `verify(store, manifest) → AttachmentMismatch[]`, `listObjectRows(db)` and `copyOut(store, dir, rows, exportId)` (D-248 O1), plus the `mth-attachment-verify/1` report format |
| `apps/api/src/cli/transfer-attachments.ts` (new) | The operator CLI: `copy-in --from <dir>`, `verify --from <dir> --out <json>`, `copy-out --to <dir> --out <attachments.json> [--export-id <uuid>]`. Exit codes follow §2 rule 4 |
| `apps/api/test/integration/transfer/attachments.test.ts` (new) | T-C16 for both adapters (filesystem; S3 through `test/support/fake-s3.ts`), each built as an `EvidenceStoreFixture` of the P6 contract kit. Also the CLI exit codes and the copy-out row listing on a real PostgreSQL scratch database |
| `docs/delivery/handbacks/DG7/T-DG7-BE-E-backend-workflow-engineer.md` | this handback |
| `docs/delivery/handbacks/DG7/T-DG7-BE-E-evidence/*.log` | check logs (§3) |

`apps/api/test/support/p7-pending*.ts`: no entry belongs to BE-E (no operation is assigned to §C.3), so nothing was removed.

## 2. Behaviour per requirement

**REQ-S19-014, "matching attachment checksums" (T-C16):**

- `copyIn` writes every `attachments.json` entry under its **same object name** through the target's port (either adapter). It then reads every entry back and compares size and SHA-256 (`verify`).
- Before writing anything it checks:
  - every package file (`attachments/<sha256>`) against its entry: missing, size or SHA-256;
  - every target name. A name that already holds **other** bytes refuses the whole copy, and nothing is written. A name that already holds the same bytes is left as it is, so a re-run is idempotent.
- `verify` checks every entry and returns one mismatch per missing object, differing size or differing SHA-256. Nothing is skipped: the test removes one object, flips one byte in another and lengthens a third, and all three are reported in order.

**REQ-S19-016, "links" and "evidence checksums" (T-C16):**

- Objects keep their object name, so `evidence_content.storage_key` and `export_job.storage_key` still resolve after the move.
- Size and SHA-256 are equal on the target. Tested on both adapters, including two entries that share the same bytes under different names.

**D-248 O1, `copy-out` (ADR-0066 §1):**

- `listObjectRows(db)` reads every row of the plan's `storage_key` columns in one `REPEATABLE READ, READ ONLY` transaction. Today those columns are `evidence_content` and `export_job`, and the test pins that.
- `copyOut` reads each object through the port and checks it against its row's SHA-256 and size. It writes `<dir>/attachments/<sha256>` once per distinct SHA-256 (atomic write, then re-read) and returns the `mth-attachment-manifest/1` text, which BE-C's `parseAttachmentManifest` accepts.
- A missing or mismatching object is reported, and the CLI then writes **no** `attachments.json` and exits 1.
- Tested: copy-out then copy-in into a second store round-trips on both adapters. The CLI path was run against a real migrated scratch database as `mth_app`.

**ADR-0064 §5, export reads through the port:**

- `readForExport` returns the object's bytes, or `null` when it is missing.
- `evidenceStoreObjectSource(store)` is the `ObjectSource` that `exportPackage` takes. Given the API's `SelectingEvidenceStore`, it reads from the store that each row's `storage_driver` names, so S3-held evidence is read too. Wiring it into the worker is open: see Q1.

**Report format for BE-D (D-254 item 1, BE-D Q6).** `verify --out <file>` writes canonical JSON with one final newline:

```json
{"schemaVersion":"mth-attachment-verify/1","attachmentManifestSha256":"<hex>","checked":<n>,"result":"matched|mismatched","mismatches":[{"parentTable","objectName","problem":"missing|size_mismatch|sha256_mismatch","expectedSize","actualSize|null","expectedSha256","actualSha256|null"}]}
```

- Each `mismatches[]` entry has exactly the fields and order of `packages/db/src/transfer/reconcile.ts` `AttachmentMismatch`, so `reconcile-migration` can pass it straight to `buildReport(tables, report.checked, report.mismatches)`.
- `attachmentManifestSha256` lets the reader check that the report belongs to the package being reconciled.
- Sizes are decimal strings.

**How BE-D's tools use it:**

- `tools/migration/import.mjs` already spawns `apps/api/src/cli/transfer-attachments.ts copy-in --from <dir>` (source condition), or `apps/api/dist/cli/transfer-attachments.js` (built; `tsconfig.build.json` includes `src/cli`).
- Now that the file exists, a package with attachments no longer stops at exit 3 BLOCKED. Run directly: `node --conditions=@mth/source apps/api/src/cli/transfer-attachments.ts copy-in|verify|…` exits 0 and 2 as expected (§3).
- For ADR-0064 §6 step 8, BE-D can run `verify --from <dir> --out <file>` after the copy and read the file as above. I did not edit BE-D's files.

**CLI input checks:**

- `attachments.json` must be valid strict UTF-8, canonical and `mth-attachment-manifest/1`.
- When `<dir>/manifest.json` exists (a migration package), the attachments manifest's SHA-256 and count must equal its `attachmentManifest` record (`checksum mismatch for attachments.json`). A backup set has no `manifest.json`, and the check is skipped.

## 3. Checks run

Environment for all checks:

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, run as root inside the sandbox.
- PostgreSQL: a disposable cluster from `tests/qa/support/with-pg.sh`.

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 1 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/transfer/attachments.test.ts` | see below | `attachments-integration.log` |
| 2 | `node --conditions=@mth/source apps/api/src/cli/transfer-attachments.ts copy-in --from <synthetic pkg>`, `verify …`, and no arguments | 0, 0, 2 | standalone process; output quoted below |
| 3 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 4 | `pnpm lint` | 0 | `lint.log` |
| 5 | `pnpm openapi:lint` | 0 | `openapi-lint.log` ("PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations") |
| 6 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `validate-historical-DG6.log` ("PASS gate DG6 (historical)") |
| 7 | `pnpm test` | see below | `pnpm-test.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see below | `prettier.log` |
| 9 | contract test | see below | see below |

Check 1: the first run failed 1 of 15 tests. That was a test defect: the s3-driver case reused a package whose `manifest.json` I had deliberately made invalid, so it got exit 2 before the driver check. I fixed the test to use a clean package. The re-run passed 15 of 15 and exited 0. The final results after formatting are below.

Check 2, standalone output:

```text
transfer-attachments copy-in: copied 1 objects, 0 already present; 1 entries verified      (exit 0)
transfer-attachments verify: matched: 1 objects                                             (exit 0)
BLOCKED: usage: transfer-attachments copy-in --from <dir> | verify --from <dir> --out <json> | copy-out --to <dir> --out <attachments.json> [--export-id <uuid>]   (exit 2)
```

Final results, all logs in `docs/delivery/handbacks/DG7/T-DG7-BE-E-evidence/`:

- **Check 1, T-C16, final run after formatting:** 1 file, 15 of 15 tests pass, exit 0.
  - 6 cases per adapter, filesystem and the S3 fake.
  - 2 CLI cases.
  - 1 PostgreSQL scratch-database case.
- **Check 7, `pnpm test`:** exit 0.
  - unit-node: 201 files, 2965 tests passed.
  - unit-web: 127 files, 2133 tests passed.
  - unit-formula-nocodegen: 3 files, 259 tests passed, 2 skipped.
  - unit-node includes `apps/api/src/architecture.test.ts` (ADR-0002 module boundaries), which covers the new module file.
- **Check 8, prettier over every tracked and untracked file:** "All matched files use Prettier code style!", exit 0. Re-run after this handback was finalised: see the last line of `prettier.log`.
- **Check 9, contract test:** `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts`: 1 file, 110 of 110 tests pass, exit 0 (`contract-integration.log`). I did not edit the contract; no operation was added.
- **Not run:** the whole integration project (`pnpm test:integration`). I touched only the new file, plus the contract test as required. BE-D's round-trip test is unchanged.
- **End time:** `2026-11-13T01:37:40Z` (`date -u`), about 21 minutes after the start.

## 4. Known gaps / not done

1. **The CLI cannot target an S3 store (exit 3, BLOCKED).** The module functions work with both adapters (tested). The CLI builds its store from `EVIDENCE_STORAGE_DRIVER` and `EVIDENCE_STORAGE_PATH`, and `s3` exits 3. An S3 store's endpoint and credential references live in the target's `storage_setting`, which is empty before an import, and they arrive with provider `unbound` (ADR-0064 §4). A CLI S3 path needs new operator inputs (endpoint, bucket, prefix and SecretRefs given on the command line or in the environment) that no ADR defines. See Q2. This carries D-253 item 1.
2. **No audit event and no in-app authorization.** `copy-in`, `verify` and `copy-out` write no database row. They are IT operator steps outside the HTTP surface, so the only control is OS-level access to the package and the store.
   - `copy-in` runs before `import-migration`'s empty-target check, so an audit row written there would make the target non-empty.
   - The import's `migration.imported` event records the attachment-manifest SHA-256 (ADR-0064 §6 step 9). That event belongs to BE-D and is not built yet.
   - No route or permission exists. No mutation goes through the API, so there is no optimistic-concurrency case.
3. **Deviation from ADR-0064 §6 step 3** ("objects already written … are overwritten on the next attempt"). An object that already holds the **same** bytes is left alone, which gives the same result. One holding **other** bytes refuses the copy instead of overwriting it, so evidence in a non-empty target store is never destroyed. Please confirm (Q3).
4. **CLI texts are mine.** C.5 gives no lines for `transfer-attachments`. Q4 lists them for exact texts.
5. **Not done, outside my files:**
   - `tools/migration/import.mjs` does not yet run `verify` after the load, and `reconcile.ts` still reports `attachments_checked = 0` (BE-D's files; BE-D's load is not built, D-254).
   - C.9 step 5 ("BE-E switches BE-D's round-trip test to the real step") cannot be done: that test has no load step yet (BE-D Q1).
   - The worker export still reads only the filesystem root (Q1).
6. **Retention archive sets** (ADR-0066 §1) are not part of `copy-out`. No `storage_key` column names them, and ADR-0066 has DO-F copy them from `retention_run.archive_set_key`.
7. **Scale is unproven.** `copyIn` and `copyOut` hold one object in memory at a time (bounded by the 25 MiB upload limit; the column CHECK allows 1 GiB). `verify` hashes while streaming.
8. **Protocol deviation:** I ran the `--historical` validator for DG6 at the end, not before implementing (exit 0; check 6).

## 5. Open questions

- **Q1 (orchestrator / architect): S3-held evidence in the worker export (D-253 item 1).** `apps/worker` does not depend on `apps/api`, so the job cannot import `evidenceStoreObjectSource`.
  - Options: (a) move the object-source adapter into a package both apps can use (the S3 adapter's SDK would then move too); (b) the worker constructs its own S3 adapter; (c) S3-held evidence is exported only by a CLI path running in the API image.
  - Today the worker refuses an S3 row by name (BE-C's `filesystemObjectSource`), so nothing is skipped silently.
- **Q2: a CLI S3 target for `copy-in`, `verify` and `copy-out`.** Which inputs should the operator give? For example `--s3-endpoint`, `--s3-region`, `--s3-bucket`, `--s3-prefix`, and SecretRefs resolved through the `env`/`file` providers under a storage binding. DO-F's backup of an S3 installation and DO-D's drill depend on this if the drill uses S3.
- **Q3:** confirm "refuse on other bytes, never overwrite" (gap 3).
- **Q4: exact CLI texts.** The lines below are mine; please confirm them or give exact texts:
  - `transfer-attachments copy-in: copied <w> objects, <p> already present; <n> entries verified`
  - `BLOCKED: transfer-attachments copy-in: refused: <n> package attachment files are missing or differ from attachments.json; nothing was written`
  - `… <n> target objects already hold other bytes under their names; nothing was written (the target is not empty)`
  - `transfer-attachments copy-in: mismatch: <m> of <n> objects differ after the copy` (exit 1)
  - `transfer-attachments verify: matched: <n> objects` / `transfer-attachments verify: mismatch: <m> of <n> objects differ`
  - `transfer-attachments copy-out: copied <n> objects (<d> distinct files, <b> bytes)` / `transfer-attachments copy-out: failed: <m> of <n> objects are missing or differ from their rows; attachments.json was not written`
  - One indented line per problem: `<problem> <objectName> (<parentTable>): expected <size> bytes, found <size|none>`.
- **Q5:** should `copy-out`'s `exportId` default to a fresh UUIDv7, as it does now, or should DO-F pass the backup set id with `--export-id`?

## Merge instructions

- No migration and no renumbering.
- No shared file was edited, so no conflict is expected.
- After merge, BE-D's `import.mjs` finds the CLI on its existing path. Nothing else needs to be run.
