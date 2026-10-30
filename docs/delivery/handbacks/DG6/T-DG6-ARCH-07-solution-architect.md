# Handback T-DG6-ARCH-07: P6 architecture, pre-freeze ADR corrections (solution-architect)

- **Stage:** P6, gate DG6 (BUILDING). Branch `claude/mobily-transformation-platform-dg5-regate2`, main checkout.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-07-solution-architect-20261030T230238Z-fe72ff52","session_id":"fe72ff52-d18f-45d8-abeb-57157fa4eb1a"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-07.md`, sha256 `695b48b8a670ad5ca7404753375df8b44d950b2fb5c7eb1dfb4bdf4308926988`. I checked it with `sha256sum` before starting, and it matched.
- **Base:** `HEAD` = `135dd5451bf5dcbd3178b04e47e87c152b53b00c` at the start and at the end. **Every change is uncommitted**, as the assignment asks.
- **Time (`date -u`):**
  - start: `Fri Oct 30 23:02:51 UTC 2026`;
  - end: §6.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` with **exit 0**. It ran first, before any write. A second run captured the exit code on its own, because the first run went through `| tail`. A third run at 23:21, after all edits, also exited 0.
- **Engineering only.** Nothing here grants, records or implies a G1–G6 business approval, a Finance validation or an IT approval. Product G6 never implies DG7.
- **Scope.** I changed documents only. No product code, test, delivery record, `openapi.yaml` or `tools/**` file was edited. Harness ports were not used, because no server or database was started.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0056-…webhooks.md` | §7 webhook body: the snake_case example and the item-key rule (BE-X2 §2). §3 row `import.csv_malformed`. §5 the three added row reasons, listed after the pinned table. §9 the XLSX "Column labels" worksheet, the template writers, and the three added refusal codes listed after the pinned table. |
| `docs/architecture/adr/ADR-0055-…external-change.md` | §2: the API run watch executes runs, and the worker only schedules and consumes (BE-L2); the shipped error-code mapping; the `connector.run_failed` fan-out and `kpiLinks` (BE-X2 §5); auto-commit for connector runs stated as **not shipped**. §5 the payload secret refusal (BE-N2). §7 the AUD `getJobOperation` 403 (BE-O). §9 `connector.adapter_unavailable`, after the pinned table. Consequences: `0116`. |
| `docs/architecture/adr/ADR-0053-…heartbeat.md` | §1: `0114` and the later identity migrations; "never retried" stated as **not shipped**. §2: the connector raiser is the worker consumer; `kpiLinks`; D-197 item 3 recorded; the readable-links rule (BE-X2 §4 option (b) declined). §3: `0117`, the event payload, the two-consumer fan-out (BE-K2S). §6: heartbeat `unknown` (BE-K) and the alert sweep (BE-K2). |
| `docs/architecture/adr/ADR-0054-…channels.md` | §2: the remote-`finalise` ordering (BE-H2), `AbortIncompleteMultipartUpload` (BE-H), export files stay on the filesystem (BE-H2B). §3: the shipped email content (BE-I), the producer scope and `0121` (BE-I2). §4: `storage.secret_ref_invalid` on the channel PUT (BE-I). |
| `docs/architecture/adr/ADR-0059-…guardrails.md` | §4 the 20-item cap (BE-U). §6 the 404 for a withheld suggestion (BE-U). §10 `assistant.test_adapter_shape`, after the pinned table (BE-T). |
| `docs/architecture/adr/ADR-0057-…help.md` | §2 builders in the worker, `0115`, and `sensitive_access = 'none'` (BE-P). §7 and the §10 table: comparison values need `audit.read` only (D-199 item 6; BE-Q2). §10 `validation.transformation_not_allowed`, after the pinned table (BE-Q). |
| `docs/architecture/adr/ADR-0051-…deep-links.md` | §1 and §2: BE-B2 (not BE-B) owns the export `ReadScope` line and the aggregate inventory (BE-B [BB]). §2 `export.includes_restricted_records`, after the pinned table (D-199). §4: D-196 item 1 Option A recorded as decided; the 403 is declared (BE-X1); the metadata GET is 404 and the download 403 (BE-C). |
| `docs/architecture/adr/ADR-0052-…sweeps.md` | §1 BE-D's rule shipped as `0118`. §7 BE-V shipped. §8 the `AuditRouteAccess` port (D-197 item 5; BE-A). §9 `evidence.finalized` (D-199; BE-F2). |
| `docs/architecture/adr/ADR-0007-api-conventions.md` | §4a: the 17 lists are paginated by BE-V, and the pin holds the 21 bounded names (BE-V). |
| `docs/architecture/adr/ADR-0021-…g4.md` | §11 item 6 marked superseded by BE-V (BE-V). |
| `docs/architecture/adr/ADR-0058-…export.md` | §6: BE-S shipped `0120`, a query fix with no new index. |
| `docs/architecture/adr/ADR-0061-…explanations.md` | §1.3 the audit diff field `design_source_sha256` (BE-W). §8 the E2 source and the E4/E5 notes (FE-F, KBE-B), as a note below the pinned table. Consequences: `0119`. |
| `docs/architecture/p6-work-split.md` | §2 rule 18: the table of shipped implementer migrations 0114–0121, with the renumbering. One "Shipped:" sentence in each of §E/F, §J/C, §B/A, §H/G and §I/K. |
| `docs/architecture/data-dictionary.md` | New closing section "P6 implementer migrations (0114–0121, DG6): no new table": rows, functions and triggers per file. |
| `docs/architecture/erd.md` | New §1z: no new entity in 0114–0121; the file names and the renumbering. |
| `docs/analysis/permissions-matrix.md` | §27, line 1092: comparison values need `audit.read` (D-199 item 6). This is the same one-line correction BE-Q2 §5 item 2 asks for in ADR-0057. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-07-evidence/*.log` | Logs of §3. |

## 2. Items, one by one (applied or declined)

### 2.1 Assignment item 1: BE-X2

| # | Source | Item | Result |
|---|---|---|---|
| 1 | BE-X2 §2 | ADR-0056 §7 body example and item-key rule | **Applied** in ADR-0056 §7 "Body" and the new "Item keys" bullet. The wording is BE-X2's, plus "or null", which matches the shipped OpenAPI description ("string or null values"). |
| 2 | BE-X2 §5 | `connector.run_failed` gains optional `kpiLinks`; record it in ADR-0053 §3 / ADR-0055 §2 | **Applied** in ADR-0055 §2 step 4 (how the API computes them), ADR-0053 §2 (the consumer only inserts; identity `{}`), and ADR-0053 §3 (the payload). |
| 3 | BE-X2 §4 | (b) technical administrators see linked KPIs | **Declined.** It is a permission change against ADR-0053 §2, and it is not shipped. I recorded the shipped rule in ADR-0053 §2 ("Readable links only"). Option (a), a QA test-side change, is for qa-verifier and the orchestrator. |
| 4 | BE-X2 §5 | `setAssistantSecretProviders` is never called from `server.ts` | **Declined for the ADR.** It is a product wiring gap, not a document error. ADR-0059 already describes the intended wiring. Routed to the orchestrator / BE-T. |

### 2.2 Assignment item 2: every other "for the architect" item

| # | Source | Item | Result |
|---|---|---|---|
| 5 | BE-T §6 | `assistant.test_adapter_shape` in ADR-0059 §10 | **Applied**, in ADR-0059 §10 below the table (see note A). |
| 6 | BE-H §5 item 3 | `AbortIncompleteMultipartUpload` (ADR-0054 §2) | **Applied** in ADR-0054 §2 as a deployment requirement, because the sweep does not list multipart uploads. `docs/operations/storage.md` does **not** state it yet. That is a devops file, routed. |
| 7 | BE-K2S §2 | `connector.run_failed` fan-out to two consumers (ADR-0053 §3, ADR-0055) | **Applied** in ADR-0053 §3 (the new "fan-out" paragraph: D-102 order, the single opener, the starter-16 execution) and ADR-0055 §2 step 4. |
| 8 | BE-L2 §2 | ADR-0055 §2 names the worker as executor | **Applied** as shipped: the API run watch executes runs, and the worker creates slots and consumes the events. **Note:** I found no recorded orchestrator choice among BE-L2's options (a)/(b)/(c) in `decisions.md` (the last entry is D-201) or in `progress.md`. The ADR now describes the merged code, which is option (a). Please record the decision. |
| 9 | BE-L2 §6 item 2 | Codes not in ADR-0055 §9 (`service_identity.out_of_scope` as a run code; `mapping_mismatch` and `response_invalid` uses) | **Applied** in ADR-0055 §2 step 4 as the shipped mapping. These are run `errorCode` values, not problem+json codes, so the §9 table is unchanged. |
| 10 | BE-L2 §6 item 6 | Auto-commit not run for connector runs | **Stated, not removed.** ADR-0055 §2 step 3 keeps the design and adds "Not yet shipped" (`runs.ts` header lines 26–28 confirm it). This is an open product gap: routed to the orchestrator. |
| 11 | BE-L §5 item 4 | `connector.adapter_unavailable` in ADR-0055 §9 and the `testConnector` summary | **Applied** in ADR-0055 §9, below the table (note A). The contract summary is **not** changed (note B). |
| 12 | BE-L §5 item 4 | `webhook.connector_not_webhook` text (ADR-0056 §9) | **Applied** in ADR-0056 §9, below the table (note A). |
| 13 | BE-L §5 item 4 | Field codes `validation.credential_refs`, `validation.commit_on_behalf_of` | **Declined.** These are field-error codes inside the generic 400 `validation` problem. The ADR tables list problem codes, not field codes, and the web catalogue already has them (`problems-all.test.ts` passes). |
| 14 | BE-M §6.2 | `import.csv_malformed`, `import.form_schema_changed`, `import.row.source_record_id_too_long` | **Applied:** ADR-0056 §3 table row (csv), §9 list (both codes) and §5 list (row reason). |
| 15 | BE-M2 §5 item 3 | Undeclared 409 on `createImport` | **Declined for this task, routed.** It is a contract change to `openapi.yaml` (additive), and this assignment changes ADR and architecture documents only. ADR-0056 §9 now names the gap explicitly. The precedent QA-B D1 was treated as a REQ-S16-027 conformance finding, so the orchestrator should route it before the freeze. |
| 16 | BE-M §6.4 | Deviations from the ADR-0056 §1 port sketch (async `validateRow`, `Map` from `existingKeys`, `titleEn/Ar`, `extensionColumns`, `informational`, `ParsedSheet`/`toTable`) | **Declined.** They are additive refinements of a sketch. They contradict no stated rule and change no behaviour, and the code is the definitive type. |
| 17 | BE-M2 §5 item 4 | ADR-0056 §9: Arabic labels "as a comment line only in XLSX" | **Applied:** a second right-to-left worksheet, "Column labels" (verified in `imports/templates.ts` lines 9–10). |
| 18 | BE-M2 §5 item 5 | Templates are not built with the P5 writers | **Applied** in ADR-0056 §9 ("Writers"). |
| 19 | KBE-A §5.3 | `import.row.text_length`, `import.row.reviewer_unavailable` | **Applied** in ADR-0056 §5, below the table (note A). Both are emitted in `kpi/import-target.ts` lines 262 and 403. |
| 20 | BE-N2 §5 item 4 | Reuse of `connector.secret_value_refused` for a payload secret, or a dedicated code | **Applied as shipped:** the reuse is recorded in ADR-0055 §5. **Declined:** the dedicated code `outbound_write.payload_secret_refused`. It is not emitted, and the reuse is truthful. |
| 21 | BE-O §2 note | ADR-0055 §7 "AUD read (200)" against DG5 `job.read` (403) | **Applied as shipped** in ADR-0055 §7: the Job row is 403 for AUD. No permission change. |
| 22 | BE-Q2 §5 item 2 | ADR-0057 §7 and §10, permissions matrix §27: values need `audit.read` only (D-199 item 6) | **Applied** in all three places. |
| 23 | BE-Q §6 | `validation.transformation_not_allowed` not in ADR-0057 §10 | **Applied**, below the table (note A). The API detail ("leave transformationId empty") and the web text ("leave the transformation empty") differ, and both are quoted. |
| 24 | BE-P §5 items 1, 5 | Builders in the worker; `sensitive_access = 'none'` with the exception in `reason` | **Applied** in ADR-0057 §2. **Declined:** the optional `index_columns` CHECK value. It is a schema change that has not shipped. |
| 25 | BE-U §8 item 1 | 404 for a withheld suggestion on to-draft | **Applied** in ADR-0059 §6. |
| 26 | BE-U §8 item 2 | Retrieval caps at 20 items | **Applied** in ADR-0059 §4 (`MAX_ITEMS = 20`, `retrieval.ts`). |
| 27 | BE-V §5 | ADR-0007 §4a "Until that task ships…" and ADR-0021 §11 item 6 | **Applied** in both. ADR-0052 §7's "After T-DG6-BE-V" sentence is updated as well. I checked that the pin `UNPAGINATED_LISTS_AT_HEAD` holds 21 names. |
| 28 | BE-W §2 | Audit diff field `design_source_sha256` | **Applied** in ADR-0061 §1 item 3. |
| 29 | FE-F §6 item 2 | ADR-0061 §8 E2 names `getBenefit → realized.kpiActual` | **Applied** as a note below the §8 table (the register row is the source). |
| 30 | FE-F §6 item 1, KBE-B §3 | E4/E5 words against the code | **Applied** as a note below the §8 table that matches the shipped `formulaNotes` keys. The table's quoted English is kept verbatim, because the web renders it. |
| 31 | FE-F §6 item 3 | `validation.validation.reference` typo in `db-errors.ts` | **Declined.** It is a code fix for that file's owner, not an ADR item. Routed. |
| 32 | BE-K §5 item 4 | Heartbeat `unknown` does not raise | **Applied (confirmed as shipped)** in ADR-0053 §6, together with BE-K §5 item 5 (multi-instance). |
| 33 | BE-K §5 item 1 | `lastValueAt` timestamp against `dataAsOf` business date | **Declined.** It would be an additive contract change (`dataAsOf`) with no shipped counterpart. The orchestrator decides. |
| 34 | BE-K2 §5 item 3 | Alerts by a one-minute sweep, linked-transformation recipients | **Applied** in ADR-0053 §6. |
| 35 | BE-K2 §5 item 2 | Who records starter 16 for a connector failure | **Applied** through item 7 (resolved by BE-K2S). |
| 36 | BE-K2 §5 item 4 | Stale-episode semantics | **Declined (time).** It is shipped detail of the freshness scan, and no ADR sentence contradicts it. It can be added later. |
| 37 | BE-J §5 item 5 | "Never retried" needs a `worker.ts` change | **Stated, not removed.** ADR-0053 §1 now says it has not shipped and names the change (`apps/worker/src/worker.ts` `captured` has no `isServiceIdentityError` branch). This is an open product gap: routed. |
| 38 | BE-J §5 item 2 | Routes in `admin/service-identities.ts`, not `operations/routes.ts` | **Declined (time).** It is a file-placement detail in `p6-work-split.md` §J/C.1, already explained in BE-J's handback, and no behaviour depends on it. |
| 39 | BE-J §5 item 4 | Worker twin `apps/worker/src/secrets.ts` | **Declined.** It is consistent with ADR-0052 §5 and ADR-0002 rule 5, and guarded by a text-equality test. Moving it to a shared package would be a later refactor. |
| 40 | BE-I §5 item 2 | `storage.secret_ref_invalid` (422) on the channel PUT | **Applied (confirmed)** in ADR-0054 §4. |
| 41 | BE-I §5 item 3 | SMTP host and sender patterns in the contract | **Declined.** It is an additive contract change; routed. The shipped 400 is recorded in ADR-0054 §4. |
| 42 | BE-I §5 item 4 | Per-message-key email texts | **Applied as shipped** in ADR-0054 §3: the generic text plus the deep link. The shared catalogue is routed. |
| 43 | BE-I2 §6 | Six worker producers emit no fan-out event | **Applied as shipped** in ADR-0054 §3 step 1. The extension (BE-I2's option (a)) is routed. |
| 44 | BE-H §5 item 2 / BE-H2 | Remote `finalise` inside the transaction | **Applied** as shipped by BE-H2 (finalise before the transaction) in ADR-0054 §2. |
| 45 | BE-H2B | Export files stay on the filesystem store | **Applied** in ADR-0054 §2. |
| 46 | BE-H2B | Content operations do not declare 503 | **Declined.** It is a pre-existing DG2 contract gap and a contract change; routed. |
| 47 | BE-A §4.1 | Audit routes need `access` (a cycle) | **Applied** in ADR-0052 §8 (the `AuditRouteAccess` port, D-197 item 5). |
| 48 | BE-B [BB] | ADR-0051 says BE-B where the work split says BE-B2 | **Applied** in ADR-0051 §1 and §2. |
| 49 | BE-C §5 items 1, 4 | 403 on `getEvidence` and `downloadEvidenceContent`; 404 for metadata, 403 for download | **Applied** in ADR-0051 §4, with D-196 item 1 recorded as decided. I checked that both operations declare 403 in `openapi.yaml` (BE-X1). |
| 50 | BE-F §5 / BE-F2 | `evidence.finalized` code | **Applied** in ADR-0052 §9 item 1. |
| 51 | BE-F §5 | A generic conflict problem `type` | **Declined.** No shipped behaviour needs it (`evidence.finalized` uses `invalid_transition`). The orchestrator decides. |
| 52 | BE-F2 | An inline 409 description on `archiveEvidence` and `removeEvidenceLink`; a defence-in-depth trigger | **Declined.** The first is a contract text change; routed. The second has not shipped. |
| 53 | BE-F (informational) | `operational_exception` and `service_identity` have a nullable `organization_id` | **Declined:** no change needed. ADR-0053 §1 and §2 already state "NULL iff platform" and "NULL for platform sources". |
| 54 | D-199 (BE-B2) | `export.includes_restricted_records` missing from the ADR | **Applied** in ADR-0051 §2, below the table (note A). |
| 55 | BE-R §5 items 1–4 | The sort-absent paging defect; duplicate `sort` on `listTransformations`; two description texts | **Declined, routed.** Item 1 is a DG3/DG5 product defect (a reopen decision). Items 2–4 are `openapi.yaml` changes. **Item 2 is a contract defect** (two parameters with the same name and `in`), and I recommend fixing it before the freeze. |
| 56 | BE-Q2 §5 item 5 | `listFormRecordVersions` has no sensitivity check | **Declined.** It is a DG5 code observation, not an ADR text. Routed to the owner of `forms/history.ts`. |
| 57 | DO-A §5 item 4 | ADR-0052 §6 wording "BLOCKED in this sandbox" | **Already applied** by T-DG6-ARCH-05 (§6 strike and amendment). Nothing to do. |
| 58 | DO-FB §5 item 3 | No workstreams in the load dataset, so `getWorkstreamDashboard` is not measurable | **Declined.** No decision is recorded and nothing has shipped either way: `generate.mjs` creates no `workstream` row, while `workload.mjs` reads them. The choice is the orchestrator's: either the generator adds workstreams, or ADR-0058 §3 drops the operation. |
| 59 | BE-F-3 (F-DG6-BE-F-3) | Lists without `nextCursor` | **Already applied** by ARCH-05 (ADR-0007 §4a). Now closed in the text by item 27. |
| 60 | QA-A F-DG6-QA-A-2, -3 | KPI links; webhook keys | **Applied** through items 1 and 2. |
| 61 | QA-B D1 | Undeclared 403 | **Applied** through item 49 (contract fixed by BE-X1). |
| 62 | QA-C | FE-D2's compare is not in that tree | **Declined:** not an architecture item. It is for QA re-runs after FE-D2. |

**Note A: why some additions are lists under a table, not table rows.** Ten unit-web suites read the P6 ADR tables verbatim and pin their row counts. Examples: `integrations-i18n.test.ts` expects 32 refusal rows and 18 row reasons, `productivity-i18n.test.ts` expects the 8 §10 codes, and `assistant-i18n.test.ts` expects 14 rows. My first attempt added the codes as table rows, and that broke 7 tests in 4 suites (it was run, and it failed). Those tests belong to FE tasks, and I may not edit them. So each addition is a "Codes added after this table was pinned" list directly below its table. After that change, all 10 suites pass (§3 row 4). Folding the lists into the tables needs the test owners to move the pins at the same time; that is routed.

**Note B: no `openapi.yaml` change.** The contract items above (15, 41, 46, 52, 55, and the `testConnector` summary in item 11) are routed to the orchestrator. `pnpm openapi:lint` was run on the unchanged contract.

### 2.3 Assignment item 3: migration ids

`ls packages/db/migrations` shows `0114_p6_job_service_identities.sql` (BE-J, renumbered from 0113), `0115_p6_search_index_jobs.sql`, `0116_p6_connector_run_jobs.sql`, `0117_p6_operations_triggers_freshness.sql` (BE-K2, from 0116), `0118_p6_evidence_content_detected_type_required.sql`, `0119_p6_branding_version_contrast_required.sql`, `0120_p6_audit_required_index_use.sql` (BE-S, from 0119) and `0121_p6_notification_fanout_jobs.sql` (BE-I2, from 0120).

- **The search:** the ERD, data dictionary, p6-work-split, p6-plan and P6 ADRs contained **no** old file name or old id for these tasks. Every implementer migration was cited only as "the next id at merge". The only `0113` hits are ARCH-06's `0113_p6_branding_contrast_reports.sql`, which is correct.
- **What I added**, so that each document cites the shipped names:
  - p6-work-split §2 rule 18: the full table, plus "Shipped:" sentences in §E/F, §J/C, §B/A, §H/G and §I/K;
  - the ERD: §1z;
  - the data dictionary: a closing section with rows, functions and triggers per file;
  - the ADRs: ADR-0052 (0118), ADR-0053 (0114–0117, 0121), ADR-0054 (0121), ADR-0055 (0116), ADR-0057 (0115), ADR-0058 (0120) and ADR-0061 (0119).
- **ADR-0052 §1** said "BE-D's migration `0101`". That id was taken by ARCH-02, and the text now names `0118`.
- The p6-plan's advisory ranges (§4 table) are left as planned history. D-196 item 2 already says the ranges are advisory.

## 3. Checks actually run

Environment: Node 24.21.0, offline, main checkout. Logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-07-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, and again at 23:21) | **0** | `PASS gate DG5 (historical)` | console |
| 2 | `pnpm format:check` | **0** | "All matched files use Prettier code style!" **Caveat:** `.prettierignore` excludes `docs/` ("delivery records … are byte-sensitive"), so this check does not cover the changed files. | `format-check.log` |
| 2b | `prettier --check` on the changed files (respecting `.prettierignore`) | 0 | the same: no file is matched | `prettier-changed-files.log` |
| 2c | Informational: `prettier --ignore-path /dev/null --check` on each changed file, at HEAD and now | — | every file is "unformatted" both at HEAD and now. The docs were never Prettier-formatted, and my edits do not change that. | `prettier-docs-informational.log` |
| 3 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (contract unchanged) | `openapi-lint.log` |
| 4 | `pnpm exec vitest run --project unit-web` on the 10 suites that read the ADRs (`productivity-i18n`, `assistant-i18n`, `integrations-i18n`, `problems-p6`, `problems-all`, `problems-slices-hijk`, `problems-p5`, `fed`, `fef`, `fee`) | 1, then **0** | First run (rows added inside the tables): 7 failed out of 115, in 4 files. After note A: **10 files, 115 tests passed** | `web-adr-reader-tests.log` (final run) |

**Not run:** the full `pnpm test`, the integration suite and e2e. Only documents changed. I searched for other readers of `docs/architecture/**` and found `tests/qa/integration/a09-decision-escalation.test.ts`, which reads `erd.md` and checks that P4 table names are present. My ERD change is additive, but I did not run that suite (it needs PostgreSQL).

## 4. Known gaps and items for the orchestrator

1. **Open product gaps the ADRs now state plainly:**
   - connector-run auto-commit (ADR-0055 §2 step 3);
   - "never retried" for service-identity errors (ADR-0053 §1);
   - the storage runbook's `AbortIncompleteMultipartUpload` line (ADR-0054 §2);
   - per-key email texts and fan-out for the six worker producers (ADR-0054 §3);
   - the `setAssistantSecretProviders` wiring (BE-X2 §5).
2. **Contract changes routed (not made here):**
   - the `createImport` 409;
   - the duplicate `sort` on `listTransformations`;
   - the `listInitiatives` and `RegisterQuery` texts;
   - the `testConnector` summary;
   - the SMTP patterns;
   - the 503 on content operations;
   - the 409 description of `archiveEvidence` and `removeEvidenceLink`.
3. **Decisions to record:**
   - BE-L2's run-executor option (the code is option (a));
   - DO-FB's workstream item;
   - BE-K's `dataAsOf`.
4. **Note A follow-up:** folding the "added after this table was pinned" lists into the tables needs the FE test owners to update their pins.
5. Items 36 and 38 were declined for time. They are low-value text details.

## 5. Merge instructions

Documents only. There is no migration, dependency or code change, and no pinned count changes. The changes are uncommitted in the main checkout. No other running task edits `docs/architecture/**`, and only the permissions-matrix line is outside it, so a conflict is unlikely.

## 6. End

`date -u` at the end: `Fri Oct 30 23:23:14 UTC 2026`, about 20 minutes after the start. `HEAD` is still `135dd5451bf5dcbd3178b04e47e87c152b53b00c`. `git status` shows the 16 modified documents of §1, plus this handback and its evidence folder as untracked. All of it is uncommitted.
