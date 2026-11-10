# Handback: T-DG6-ARCH-03 — P6 architecture, slices B + A (solution-architect)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-03-solution-architect-20261026T195829Z-ae183e2e","session_id":"ae183e2e-9ae9-448a-ab10-f498d379f8fe"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-03.md`, sha256 `5bc98c11f18a4a7fd7728d0b91f7645b74da1a5f29dfc13e59cc23719ed4beab` (verified with `sha256sum` at the start).
- **Base:** branch `claude/mobily-transformation-platform-dg5-regate2`, `HEAD` `1c061ab8b9dae8ae5fce31dd261299024d014f56`. Nothing committed (the orchestrator commits).
- **Start:** `date -u` → `Mon Oct 26 19:58:41 UTC 2026`. **End:** see §8.
- **Continuation (T-DG6-ARCH-03B, D-198).** The first run was stopped by a container restart; the orchestrator salvaged its work as WIP commit `d206925`. This handback was completed in place by the continuation run `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-03B-solution-architect-20261026T213321Z-ab5648ce","session_id":"ab5648ce-d655-4c92-a67a-d4fbfb00f74a"}`, assignment `docs/delivery/assignments/DG6/T-DG6-ARCH-03B.md` (sha256 `4e097c83f9c50e8ccdec722d9c0fdcb42992cd256a70dee87b86d61e4cd38df1`, verified with `sha256sum`), at `HEAD` `80e1a024e8310a567f23489faec851704fecf634`. Continuation start: `date -u` → `Mon Oct 26 21:44:12 UTC 2026`. Every acceptance check was re-run by the continuation; its logs carry the prefix `03b-` in the evidence folder. Text changed by the continuation is marked **[03B]**. The continuation reviewed the first run's work and re-ran every check. It changed exactly two repository files besides this handback, both to repair the one failure the full integration suite found (§4.4): `apps/api/src/modules/evidence/register.ts` (one entry) and ADR-0055 §6 (one amendment paragraph). It changed no migration and no contract. It raised one new point (§5 item 7) and withdrew one incorrect claim of the first run (§5 item 6).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. No business, Finance or IT approval was granted. Confirming an external change, committing an import or executing an outbound write is not a G1–G6 approval. Product G6 never implies DG7.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` (Node 24.21.0), run first, before any write: `PASS gate DG5 (historical)`, exit 0 (`T-DG6-ARCH-03-evidence/00-start-validate-dg5.log`, which also records `date -u` and `HEAD`). It was run again at the end (§8).

**[03B]** The continuation ran it before any write. Its first invocation piped the output through `tail`, so the `EXIT=0` it printed was `tail`'s exit code, not the validator's. I therefore re-ran it with the validator's own exit code captured, still before any write: `PASS gate DG5 (historical)`, `EXIT=0` at `HEAD` `80e1a02` (`03b-00-start-validate-dg5.log`, 21:54:43 UTC).

## 2. Deliverables

### 2.1 ADRs (deliverable 1)

| File | Content |
|---|---|
| `docs/architecture/adr/ADR-0055-p6-connector-framework-runs-outbound-writes-external-change.md` | §1 connectors and append-only configuration versions: fields, credentials as `SecretRef`s only, adapter kinds, 8 database invariants with probe ids, creation with the connector service identity, status machine, the derived verification status. §2 IntegrationRun: fields, state machine, invariants, the run in two short transactions with the remote call between them, bounded retries with backoff, exactly-once keys, derived last success, Unknown counts. §3 the local test adapter (healthy, failing, stopped; `confirm: never`; the per-key effect counter) and the `http_pull` slot. §4 graceful degradation and 6 actionable error codes with their "why" and "what to do" texts. §5 guarded outbound writes: state machine, replay and 409 by payload hash, dispatch outside the transaction, no manual confirmation. §6 the deliverable external-change confirmation: 6 invariants, routes, the connector confirmation path. §7 the S16-022 entity group (7 entities: table, key, owner, status, producing mutation, read). §8 locks. §9 authorization (7 codes, role defaults, AUD, technical admins, SoD) and 16 refusal codes with English texts. §10 decimal and Unknown. |
| `docs/architecture/adr/ADR-0056-p6-controlled-imports-staging-validation-lineage-webhooks.md` | §1 the `ImportTargetRegistry` port. §2 the staging batch: fields, state machine, 7 invariants. §3 CSV and XLSX parsing with 7 limits and their refusals, cells as text, formula cells refused as row errors (D-195 Q11). §4 validation with the DG4 `submitKpiActual` rules and the pinned form schema. §5 duplicate keys (the DG4 slot) within the batch and against committed data, immutability, 18 row-reason codes with English texts. §6 commit of valid rows only through the target, commit-time re-authorization, re-validation, lineage, the A17 8/1/1 fixture. §7 signed webhooks: the v1 HMAC scheme, one 401 for every authentication failure, replay and idempotency, rotation with a ≤ 7-day grace. §8 locks. §9 templates, authorization, 16 refusal codes with English texts. §10 decimal and Unknown. |

Every claim is enumerated (tables, columns, constraint and trigger names, codes, texts, roles, files). Sources quoted: M0080, M0239, M0328, M0329, M0334, M0335, M0386, and the seven acceptance texts in scope. Playbook blocks cited only where they bear on the design: B0070 (the traceability chain through "Deliverable"), B0049/B0050 (Template 2's KPI "Owner"), B0121 ("Measure … Evidence / actuals"). The ADRs say plainly that the playbook names no connector, import, webhook or downstream-write control.

**No new dependency.** The XLSX reader is specified as an in-house subset on `node:zlib` (ADR-0056 §3, Alternatives 3); HMAC uses `node:crypto`. Nothing needs a registry pin.

### 2.2 Migrations, schema types, permissions, locks (deliverable 2)

| File | Purpose |
|---|---|
| `packages/db/migrations/0104_p6_connectors_runs_outbound_writes.sql` | 3 validation functions; `connector` (+ `connector_change`), `connector_config_version` (append-only), `integration_run` (+ `integration_run_event`), `outbound_write` (+ `outbound_write_event`); the FK `service_identity_connector_fkey` announced by `0101`; the deferred FK to the current configuration. |
| `packages/db/migrations/0105_p6_imports_lineage_webhooks.sql` | `webhook_endpoint` (+ `webhook_endpoint_change`), `webhook_receipt` (append-only), `import_batch` (+ `import_batch_event`), `import_row` (column-level UPDATE of the commit status only; never deleted), `import_row_commit` (append-only lineage); 2 validation functions; the FK `integration_run_import_batch_fkey`. |
| `packages/db/migrations/0106_p6_deliverable_external_change.sql` | `deliverable_external_change` (+ `deliverable_external_change_event`): the flag and its separate confirmation with provenance; additive on DG3. |
| `packages/db/migrations/0107_p6_integrations_permissions.sql` | 11 permission codes and 26 role links; no approval code. |
| `packages/db/src/schema.ts` | 16 table interfaces, `Database` block, row types and `SCHEMA_COLUMNS` entries, **generated from the migrated catalogue** (`gen-dictionary.ts` → `schema-types.ts.txt`). |
| `packages/db/test/integration/catalogue.test.ts` | New test "0104-0106: the P6 slice B/A guards are attached" (49 triggers); 6 tables added to the mutable-table pin; 16 privilege pins. |
| `packages/db/src/seed.test.ts` | "0107 seed equals the P6 part of permissions.ts (slices B and A)" (3 tests); the free-id example of the numbering test 0104 → 0108. |
| `packages/shared/src/permissions.ts` | `P6_INTEGRATIONS_PERMISSIONS`, `P6_INTEGRATIONS_ROLE_PERMISSIONS`, added to `P6_PERMISSIONS` and to the roles TL, BO, WL, TO, KDS, TD, AUD, ADM_TECH. |
| `apps/api/src/modules/platform/advisory-locks.ts`, `.test.ts` | `connectorRun` 730310, `importCommit` 730311, `webhookReceipt` 730312, `outboundWrite` 730313, `deliverableConfirmation` 730314; 730315–730317 reserved; the pin (44 → 49 classes). |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 rows 730310–730317 and the P6 block sentence. |

Migration ids: `0104`–`0107` directly above the shipped `0103` (D-196); no gap, no retired id. Hashes: `migration-sha256.txt`.

### 2.3 ERD and data dictionary (deliverable 4)

- `docs/architecture/erd.md` §1v (diagram, the polymorphic-lineage note, the entity register) and the §2.12 corrections: FormSchemaVersion's physical table is `methodology_version` rows with `key = 'forms'` pinned by `transformation_config_pin` kind `form_schema` (no `form_schema_version` table exists); Notification's is `inbox_notification` (no `notification` table exists); Job also names `job_schedule`/`job_run`; IntegrationRun points at `0104`.
- `docs/architecture/data-dictionary.md` "P6 tables, slices B and A (migrations 0104–0107, DG6)": 16 table sections generated from the catalogue of a freshly migrated database (`gen-dictionary.ts`, output `dictionary-section.md`), the added constraints and the function list. The generator was re-run on the final migrations and produced a byte-identical section.

### 2.4 Contract (deliverable 5)

- `docs/api/openapi.yaml`: `info.version` stays `1.5.0-p6` (set by ARCH-01). 2 new tags (`integrations`, `imports`), **34 operations** appended with 7 path parameters and 54 schemas:
  - connectors (9): `listConnectors`, `createConnector`, `getConnector`, `putConnector`, `enableConnector`, `disableConnector`, `testConnector`, `getConnectorMappings`, `putConnectorMappings`;
  - runs (4): `listIntegrationRuns`, `runConnector`, `getIntegrationRun`, `retryIntegrationRun`;
  - imports and templates (8): `listImports`, `createImport`, `getImport`, `listImportRows`, `commitImport`, `cancelImport`, `listImportTemplates`, `downloadImportTemplate`;
  - webhooks (6): `listWebhookEndpoints`, `createWebhookEndpoint`, `getWebhookEndpoint`, `rotateWebhookSecret`, `disableWebhookEndpoint`, `receiveWebhook`;
  - outbound writes (4): `listOutboundWrites`, `executeOutboundWrite`, `getOutboundWrite`, `confirmOutboundWrite`;
  - deliverable confirmation (3): `getDeliverableConfirmation`, `putDeliverableExternalChange`, `confirmDeliverableExternalChange`.
- ADR-0007 §5b statuses: every operation declares 400 and 429; every session operation 401 and 403; every `IfMatch`/`IfMatchOrZero` operation 409 and 428; 404 on every path with an id; 422 where a business rule can refuse; `createImport` also 413 and 415, `receiveWebhook` 401, 409 and 413 as problem+json. Request media types: `application/json` everywhere except `createImport` (`text/csv` and the XLSX media type, = its future `config.consumes`). ETag on every GET of a versioned record and every mutation response (`ETagOrZero` for the never-flagged confirmation). Cursor pagination on the 6 record lists (`listImportTemplates` returns the fixed template set, unpaged).
- `receiveWebhook` is `security: []` (session-less, CSRF-exempt; the signature scheme is in its summary and its three header parameters).
- **Changes to existing text:** the response-only `PermissionCode` enum gains the 11 `0107` codes (additive, as ARCH-01/02 did). `diff` against the pre-task file removes **0 lines** and adds 1,582. The final file is byte-identical to the output of `openapi-p6-arch03.py` run on the pre-task file (checked with `cmp` on a regenerated copy).
- `pnpm openapi:lint` → `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 910 operations`, exit 0 (`openapi-lint.log`).
- **Pending seams:** `apps/api/test/support/p6-pending-arch-03.ts` (slice aggregate), `p6-pending-be-l.ts` (9), `p6-pending-be-l2.ts` (4), `p6-pending-be-m2.ts` (8), `p6-pending-be-n.ts` (6), `p6-pending-be-n2.ts` (4), `p6-pending-be-o.ts` (3); one import line in `p6-pending.ts`; `p6-operations.ts` +34 ids (keeps the P2-scoped AUD sweeps on their scope).
- **`contract.test.ts` pins changed (only as the pattern requires):** the operation count **876 → 910**; the pinned set of public operations gains `receiveWebhook` (the "CSRF-exempt webhook route" pin p6-plan §3 row 12 and §5.3 announced). The media-type pins do not change now (pending operations are excluded); BE-M2 reports the `text/csv`/XLSX request types when it routes `createImport`.

### 2.5 Permissions matrix and work split (deliverable 6)

- `docs/analysis/permissions-matrix.md` §26: 11 codes, per-entity rights for all 14 roles, AUD read-only, system writers, technical admins, SoD, and the "ADM" interpretation raised in §5.
- `docs/architecture/p6-work-split.md` §B/A (13 subsections), appended after §J/C; §1–§2 unchanged:
  - what the architect delivered;
  - BE-L, BE-L2, BE-M, KBE-A, BE-M2, BE-N, BE-N2, BE-O, each with exact files, operations, consumed contracts and tests; the exact `db-errors.ts` mappings for every B/A constraint (in BE-L);
  - the FE-A/FE-C items;
  - migrations left and their order;
  - the integration order, including the sequential editing order of `integrations/routes.ts` and `server.ts`;
  - requirement → owner;
  - 9 points the implementers must know.

## 3. Requirements in scope

| Requirement | Architect delivered | Remaining owner(s) |
|---|---|---|
| REQ-S01-005 | `0106`, `0107`; ADR-0055 §6; probe DX01–DX14 | BE-O, BE-N2 (connector confirmation), FE-C; QA-A |
| REQ-S16-022 | `0104` (`integration_run`); ADR-0055 §7; ERD §1v and the §2.12 corrections | BE-L2, BE-O (entity-group test) |
| REQ-S17-001 | `0104`, `0107`; ADR-0055 §1–§3; probes CN, IR | BE-L, BE-L2, FE-C; QA-A |
| REQ-S17-005 | ADR-0055 §4 (error codes and texts, fallbacks) | BE-L2, BE-O, FE-C; QA-A |
| REQ-S17-006 | `0104`, `0107`; ADR-0055 §5; probe OW | BE-N2; QA-C |
| REQ-S17-002 | `0105`, `0107`; ADR-0056 §2–§6; probe IM | BE-M, KBE-A, BE-M2, FE-C; QA-A |
| REQ-S17-003 | `0105`; ADR-0056 §3, §7, §9; probe WH; contract `receiveWebhook`, templates | BE-M, BE-M2, BE-N, FE-C; QA-A |

No requirement is complete yet: every row needs its implementer work. This is an architecture task.

## 4. Checks actually run (Node 24.21.0; PostgreSQL 16.13 disposable clusters on ports 23701–23749)

### 4.1 Migration apply and guard probe

`QA_PG_PORT=23701 MTH_PORT_POOL=23702-23709 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/probe.ts` → **110/110 PASS, exit 0** (`probe-output.txt`).

- G00: 0104–0107 present directly above 0103; nothing above 0107.
- G01: fresh database, 0001 → 0107 applied (99 files).
- G02–G05: 0001–0097 applied; then a synthetic transformation instantiated by the DG3 function, a KPI, 2 deliverables, 3 evidence items (verified note, filename-only link, unreviewed note) and 9 KPI actual values; then 0098–0107 applied on top (10 files). The deliverable rows are byte-identical before and after (md5 of their JSON); no B/A row exists; the three announced foreign keys exist.
- **Guards fire:**
  - missing audit fails at COMMIT: CN02, IR05, OW11, DX07, IM23 (and the deferred FK to the current configuration, CN03);
  - a non-stepping version fails: CN12 (the shared `p2_row_guard`, attached to all 6 mutable tables);
  - UPDATE/DELETE on history and append-only records fails: CN10, CN14, CN15, IR15, DX14, WH10, IM21, IM22, IM27;
  - every database claim of the ADRs holds: the state machines (CN04, IR04, IR07, OW06, OW10, DX01, DX09, IM20, WH13), exactly-once keys (IR02, IR03, IR10, OW03, WH07, IM26), retry chain (IR08), counts and reconciliation (IR11–IR13, IM10, IM17), credential references and secret-free settings (CN06, CN07, WH02), the service-identity binding (IR18, CN16), the outbound action rule and confirmation shape (OW01, OW04, OW07, OW08), the external-change evidence and connector rules (DX04–DX06, DX08, DX11–DX13), the webhook window and rotation (WH04, WH05, WH08, WH09, WH12), the pinned form schema and source shapes (IM01–IM03, IM24), in-batch duplicates and row immutability (IM06–IM09, IM12–IM16), the 8/1/1 commit with lineage (IM05, IM11, IM18, IM19), and the permission seeds (PM01–PM05).

**Disclosed earlier run:** `probe-output-run1-before-0105-message-edit.txt` (also 110/110, exit 0) ran before I changed one RAISE message in `0105` ("timestamp window" → "time window"), because `seed.test.ts` forbids the word `timestamp` outside comments. The constraint names were unchanged; the final run above is on the final migration text.

**[03B] Re-run by the continuation.** First, `sha256sum packages/db/migrations/010[4-7]*.sql` gave exactly the four hashes in `migration-sha256.txt`, so the migrations are unchanged since the probe above. Then `QA_PG_PORT=23711 MTH_PORT_POOL=23712-23719 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/probe.ts` → **110/110 PASS, exit 0** (`03b-probe-output.txt`). The same groups ran: G00–G05 (the fresh-database apply of 0001 → 0107, and 0098–0107 applied over a 0001–0097 database with data) and every guard listed above.

### 4.2 Static checks

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `format.log` ("All matched files use Prettier code style!") |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` (910 operations) |

**[03B]** The continuation re-ran all five on the final tree. Every one exited 0: `03b-typecheck.log`, `03b-build.log`, `03b-lint.log`, `03b-format.log` ("All matched files use Prettier code style!") and `03b-openapi-lint.log` (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 910 operations`). Each log ends with the command's own `EXIT=` line.

### 4.3 Unit tests

**[03B]** Run by the continuation on the final tree (`HEAD` `80e1a02` plus no source change), Node 24.21.0:

| Command | Locale | Result | Exit | Log |
|---|---|---|---|---|
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | unset | unit-node 153 files / 2401 tests passed; unit-web 94 files / 1746 tests passed; unit-formula-nocodegen 3 files / 259 passed, 2 skipped | 0 | `03b-unit-locale-unset.log` (21:55:55 → 22:08:57 UTC) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | `C.UTF-8` | identical counts: 153/2401, 94/1746, 3/259 + 2 skipped | 0 | `03b-unit-c-utf8.log` (22:08:57 → 22:22:24 UTC) |

The 2 skipped tests are in `packages/shared/src/formula/fuzz.test.ts`, which was not changed here.

**Disclosure of the first run's unit logs.** `unit-locale-unset.log` (first run) holds a complete run with the same counts and `EXIT=0`. `unit-c-utf8.log` (first run) is **truncated** at 263 lines, with no summary and no exit line: the container restart stopped it mid-run. It is kept only for provenance and is not evidence of a pass. The `03b-` logs above are the evidence.

### 4.4 Integration tests

- **Targeted run 1** (`QA_PG_PORT=23721 … catalogue, migrate, contract, identity, aud-write-deny`): **exit 1, 282 passed, 1 failed** (`integration-targeted-run1.log`). The failure: ADR-0007 §5b derivation `receiveWebhook 403`. I had declared a `webhookSignature` security scheme on the operation, so the derivation (which treats only `security: []` as public) expected the CSRF 403. Fix: `security: []` and the scheme removed (net: the contract equals the generator's output, §2.4).
- **Targeted run 2** (`QA_PG_PORT=23731 …`, same files): **exit 1, 282 passed, 1 failed** (`integration-targeted-run2.log`): the pinned set of public operations lacked `receiveWebhook`. Fix: the pin gains it (§2.4).
- **Disclosure:** before run 1, a first attempt was started with a shell `&` and was killed when its shell exited; its log was empty (no test ran). I deleted that empty file and ran the suite properly as run 1.
- **Full suite [03B]:** `QA_PG_PORT=23721 MTH_PORT_POOL=23722-23749 tests/qa/support/with-pg.sh pnpm test:integration` (fresh database, 99 migrations applied), 22:22:34 → 23:18:52 UTC, duration 3362.75 s → **exit 1: 322 files (321 passed, 1 failed); 3115 tests (3113 passed, 1 failed, 1 skipped)** (`03b-integration-full.log`).
  - **The failure** was in this slice's scope: `apps/api/test/integration/evidence/evidence-register.test.ts` › "every table that references an evidence item is a link source or a stated exclusion (catalogue)" → `expected [ 'deliverable_external_change' ] to deeply equal []`. `0106` adds the foreign key `deliverable_external_change_evidence_fkey` to `evidence`, and the first run had not registered the table with the DG5 evidence register (REQ-S13-010).
  - **Repair:** I added `deliverable_external_change` to `EVIDENCE_LINK_SOURCES` in `apps/api/src/modules/evidence/register.ts` (record type `deliverable`, id `deliverable_id`, active iff `confirmation_status = 'confirmed'`) and amended ADR-0055 §6 to match. I did not add an exclusion: a confirmation by reviewed evidence is a link of the deliverable to that evidence.
  - **Re-verification after the repair:** `QA_PG_PORT=23741 MTH_PORT_POOL=23742-23749 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/evidence/ packages/db/test/integration/catalogue.test.ts apps/api/test/integration/contract/contract.test.ts` → **3 files, 142 tests passed, exit 0** (`03b-integration-targeted-after-fix.log`). The evidence unit tests (`vitest run --project unit-node apps/api/src/modules/evidence`) gave 1 file, 13 tests, exit 0 (`03b-unit-evidence-after-fix.log`). `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build` and the full Prettier check each exited 0 after the repair (`03b-*-after-fix.log`).
  - **Not run:** the full integration suite was **not** re-run after the one-entry repair. A full run takes about 56 minutes, which would exceed the 2-hour limit. Every other file in that run passed, and the repair only adds one entry to a constant read by the evidence register, so I expect the full suite to pass, but that is not demonstrated. **The orchestrator should run the full suite after merge** (Merge instructions).
  - **Pinned counts:** the operation count 876 → 910 and the public-operation pin (+`receiveWebhook`) from §2.4 hold (contract.test.ts passed). No other pinned count changed.
  - **First run's partial log:** `integration-full-run1.log` (673 lines, started 20:48:20 UTC per `integration-full-run1.start`) has no summary and no exit line, because the container restart stopped it. It is provenance only.

## 5. Raised to the orchestrator (decisions needed; nothing decided by me)

1. **"import:KDS,ADM" (REQ-S17-002/003).** I gave `import.*` to KDS only: the technical administrators hold no business-record write (REQ-S10-003; the matrix's "technical support only"), and a commit submits KPI actuals. ADM_TECH gets connector and webhook configuration. If the business wants another importer role, a later seed adds it.
2. **Task splits and order (p6-plan §5.1):** BE-L → BE-L/BE-L2; BE-N → BE-N/BE-N2; and BE-M → BE-M (engine, no routes) → KBE-A → BE-M2 (routes), because the import routes cannot stage or commit without the KPI target. +3 runs. The pending lists already follow the split; BE-L2, BE-M2 and BE-N2 append to their parent's existing exercise seam file.
3. **`outbound_write.execute` default holder:** TD only (REQ-S17-006 "explicitly granted role only"); implied by no other code. Confirm or name another role.
4. **A confirmed external change is final.** If the verified evidence behind it is later rejected or archived, the confirmation does not revert (ADR-0055 §6). A revocation path would be a new operation and state; I did not add one. Decide whether it is needed for DG6.
5. **Shared-file merges with the W3 worktrees (BE-B, BE-E, FE-A):** I changed `contract.test.ts` (count and public pin), `p6-pending.ts` (one import line), `p6-operations.ts`, `identity.test.ts` (TO's pinned list +4 codes), `catalogue.test.ts`, `seed.test.ts`, `permissions.ts`, `schema.ts`, `advisory-locks.ts`. Expect small textual conflicts if a W3 task touched the same pins; keep both sides.
6. **[03B] Withdrawn.** The first run reported that `data-dictionary.md` contains the ARCH-02 section "P6 functions (0101, 0102)" twice. That is not true. `grep -n "P6 functions"` finds it once (line 13021), both at the base `1c061ab` and now, and its bullets are not repeated. There is nothing to fix.
7. **[03B] Path placement differs from the assignment's area names.** The assignment names the areas `imports` and `outbound-writes`, and REQ-S17-002/003 name `/api/v1/imports` and `/api/v1/webhooks`. The contract places 6 import operations under `/api/v1/transformations/{transformationId}/imports…` and 4 outbound-write operations under `/api/v1/transformations/{transformationId}/outbound-writes…`. Templates (`/api/v1/import-templates`), the webhook receiver (`/api/v1/webhooks/{endpointKey}`) and the admin areas follow the names exactly.
   - **Why:** this matches the transformation-scoped resources of DG2–DG5. Every import and every outbound write belongs to one transformation, so `ReadScope` and the DG2 non-disclosure 404 come from the path parameter, as they do for KPI actuals.
   - **Also:** the deliverable confirmation adds the path `/api/v1/deliverables/{deliverableId}/external-change` (`putDeliverableExternalChange`, flag or withdraw) beside `/confirmation` (get, post).
   - Neither ADR states the placement explicitly. I did not change it. The contract is not yet gate-approved, and no implementer of this slice has started. Decide whether to keep it (my recommendation) or flatten it; flattening is a contract and pending-list change before BE-M2 and BE-N2 start.

## 6. DG1–DG5 artifacts changed, and why (D-195: additive changes)

| Artifact | Change | Why |
|---|---|---|
| `docs/api/openapi.yaml` | 2 tags, 34 appended operations, 7 parameters, 54 schemas, `PermissionCode` +11 values | Deliverable 5; the enum addition is response-only and additive (needed for `getMe`). 0 lines removed. |
| `scripts/openapi-lint.mjs` (DG1) | `receiveWebhook` added to `PUBLIC_UNSAFE` beside `devLogin`, with its reason in a comment | The lint rule requires session + CSRF on every unsafe method; the webhook receiver is the planned session-less, signature-authenticated exception (p6-plan §3 row 12, ADR-0056 §7). Without it `pnpm openapi:lint` fails. |
| `apps/api/test/integration/contract/contract.test.ts` | count 876 → 910; public set + `receiveWebhook` | The P3–P6 pending precedent; p6-plan §5.3. |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list + `connector.read`, `external_change.flag`, `import.read`, `outbound_write.read` | The `0107` role defaults. |
| `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts`, `packages/shared/src/permissions.ts`, `advisory-locks.ts` (+ test), ADR-0016 §6 | as §2.2 | Mirror `0104`–`0107`; registry rule. |
| `apps/api/test/support/p6-pending.ts`, `p6-operations.ts` | one import; +34 ids | The pending seam. |
| `apps/api/src/modules/evidence/register.ts` (DG5, REQ-S13-010) **[03B]** | `EVIDENCE_LINK_SOURCES` + `deliverable_external_change` (one entry) | `0106` references `evidence`; the DG5 catalogue rule requires every referencing table to be a link source or a stated exclusion (§4.4). Additive under D-195: until BE-O writes a confirmation, no row exists, so the register's output is as at DG5. |
| `docs/architecture/adr/ADR-0055-…md` §6 **[03B]** | dated amendment paragraph "Evidence register" | States the entry above. |
| `docs/architecture/erd.md` | §1v appended; §2.12 rows FormSchemaVersion, Job, Notification, IntegrationRun corrected | The rows named tables that do not exist (`form_schema_version`, `notification`); REQ-S16-022 needs the ERD to name the real tables. Documentation only. |
| `docs/architecture/data-dictionary.md`, `docs/analysis/permissions-matrix.md`, `docs/architecture/p6-work-split.md` | appended B/A sections | Deliverables 4 and 6. |

No DG1–DG5 behaviour changes: no existing table, column, constraint, trigger, route or user-facing text changes. With no B/A row, every response is as at DG5 (probe G04).

Untracked dot-files at the repository top level (`.bashrc`, `.gitconfig`, `.idea`, `CLAUDE.local.md`, …) appeared in `git status` at the start; I did not create them and left them untouched.

## 7. What the implementers of this slice must know

In `p6-work-split.md` §B/A.13 and §2. The main points: credentials are references resolved outside transactions; no remote I/O inside a transaction; imports go through the DG4 submission path and never accept a value; cells are text and decimals stay strings; Unknown is null and never 0 or green; an outbound write is done only on a confirmed response and an external change is confirmed only by verified evidence or a confirmed connector result; one 401 for every webhook authentication failure; exactly-once keys and locks everywhere; nothing is ever called "live".

**[03B]** Further points:
- **BE-O:** `deliverable_external_change` is already an evidence-register link source. Do not add it again, and keep the DG5 catalogue test green.
- **BE-M2 and BE-N2:** the import and outbound-write routes are transformation-scoped paths (§5 item 7) unless the orchestrator decides otherwise before you start.
- **Every implementer of this slice:** a full integration run takes about 56 minutes on this host (322 files). Plan targeted runs during work and one full run per handback.

## 8. End

**[03B]**

- **End of the first run:** never reached. The container restart stopped it, and no end `date -u` exists for it.
- **End validation:** `node tools/gates/validate.mjs --historical --stage DG5` at the end of the continuation gave `PASS gate DG5 (historical)`, `EXIT=0`, at `HEAD` `80e1a02`, 23:28:58 UTC (`03b-end-validate-dg5.log`).
- **Continuation end:** `date -u` → `Mon Oct 26 23:30:07 UTC 2026`. Start was 21:44:12 UTC, so it took about 1 h 46 min.
- **Commits:** nothing committed (the orchestrator commits).
- **Files changed by the continuation** (uncommitted on top of `80e1a02`):
  - `apps/api/src/modules/evidence/register.ts`;
  - `docs/architecture/adr/ADR-0055-p6-connector-framework-runs-outbound-writes-external-change.md`;
  - `docs/architecture/p6-work-split.md` (one row in §B/A.0);
  - this handback;
  - new `03b-*` logs in `T-DG6-ARCH-03-evidence/`.
- **Remaining for a continuation or the orchestrator:**
  1. One full `pnpm test:integration` run after the repair (§4.4: not run for time).
  2. The decisions in §5, items 1–5 and 7.

No requirement in scope is complete. Every row still needs its implementer work (§3).

### Merge instructions

- Apply as one change. The migrations are `0104`, `0105`, `0106`, `0107`, forward-only, applied on top of `0103` (probe G03).
- Expect the shared-file conflicts of §5 item 5; keep both sides' lines.
- After merge: `pnpm test`, `pnpm test:integration` (full), `pnpm openapi:lint`, `node tools/gates/validate.mjs --historical --stage DG5`.
- Evidence: `docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/` (probe script and outputs including the disclosed earlier run, dictionary/type generator and outputs, contract generator, check logs).
