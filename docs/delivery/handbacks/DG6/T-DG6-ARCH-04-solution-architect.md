# Handback: T-DG6-ARCH-04 — P6 architecture, slices H + G (solution-architect)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-04-solution-architect-20261027T010202Z-83672133","session_id":"83672133-352a-49b5-9b44-2bb6af6f1b3d"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-04.md`, sha256 `1b30fb6e14434602fc94583079d98f2ee7774456c07615c29243f5afec92cc08` (verified with `sha256sum` at the start; identical).
- **Base:** branch `claude/mobily-transformation-platform-dg5-regate2`, `HEAD` `5e4cbad20917cb4f50517981d15fb87441fedfc5`. Nothing committed (the orchestrator commits).
- **Start:** `date -u` → `Tue Oct 27 01:02:23 UTC 2026`. **End:** §8.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. No business, Finance or IT approval was granted. Searching, saving a view, recovering a draft, comparing versions and the load run approve nothing. Product G6 never implies DG7.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` (Node 24.21.0), run first, before any write, with its own exit code captured: `PASS gate DG5 (historical)`, exit 0. It was run again at the end (§8).

## 2. Deliverables

### 2.1 ADRs (deliverable 1)

| File | Content |
|---|---|
| `docs/architecture/adr/ADR-0057-p6-search-saved-views-filters-drafts-compare-bulk-help.md` | §1 the search document: 12 record types, the exact columns each contributes (no money, rate, FTE, KPI or score value), the three stored tsvectors (english, arabic, simple) verified on 16.13 with the observed Arabic stemming limit, 6 database invariants, not audited by design. §2 maintenance: the audit-event feed as the transactional outbox (a stated refinement of p6-plan's "by outbox"), `search.index_feed` and `search.reindex` (through the P5 `runJobNow`), lock 730318, the declared sensitive-read exception for the two job identities, freshness (`indexedThrough`, `stale`). §3 the query: match, integer relevance keyset, query-time `ReadScope` per type with the live named-party join, the 12-type parity rule. §4 saved views: entity, state machine, 11 database invariants, the list registry, 6 operations, share rule, column choices moved from the browser. §5 server-side filters and sorts on 11 list operations (absent = today's result). §6 draft recovery on the P5 `form_draft` (one draft model; `listMyFormDrafts`; "Draft - not submitted"; never counted). §7 compare-and-reapply (client three-way; no new endpoint) and `compareFormRecordVersions` (values rule of ADR-0041 §5). §8 bulk (DG5 unchanged; how it meets "a conflict for that record only") and inline edit. §9 breadcrumbs, help topics, the six states with their two new texts. §10 authorization table, locks, 8 refusal codes with English texts. §11 decimal and Unknown. |
| `docs/architecture/adr/ADR-0058-p6-performance-load-dataset-workload-p95-index-plan-async-export.md` | §1 targets and the finding rule (D-195 Q9). §2 the `mth_load_v1` dataset: generator separate from the demo seed, deterministic, written through the guards, sizes table, the `register-1000` profile. §3 the workload: 100 virtual users, the mix by class with operation ids. §4 sessions: `MTH_ENV=load` rules and start-up refusals, `sessions.mjs` through `createSession`. §5 the infrastructure statement. §6 the p95 method (integer microseconds, nearest rank, 3 repetitions, warm-up excluded) and the index plan (`0110` now; BE-S only on evidence). §7 the async export at full scale and how "the full load dataset" is read. §8 ownership. §9 authorization. §10 decimal and Unknown. |

Every claim is enumerated (tables, columns, constraint and trigger names, codes, texts, roles, files, operation ids). Sources quoted: M0303, M0304, M0329, M0398 and the six acceptance texts in scope. Playbook: the templates whose registers are indexed (B0071, B0080, B0122) are named; the ADRs say plainly that the playbook names no search, saved-view, draft, comparison or performance control.

**No new dependency.** PostgreSQL's shipped text search configurations; the load harness and PRNG in plain Node.

### 2.2 Migrations, schema types, permissions, locks (deliverable 2)

| File | Purpose |
|---|---|
| `packages/db/migrations/0108_p6_search_saved_views_help.sql` | 4 validation functions; `search_document` (derived, version-stepped, not audited, monotonic guard, 3 GIN indexes), `search_index_state` (12 seeded rows, not audited), `saved_view` (+ `saved_view_event`; full P2 guards, audited), `help_topic` (11 bilingual seeded topics; the Arabic labelled "(ترجمة مؤقتة)"), `load_dataset_marker` (append-only singleton, empty-database guard). |
| `packages/db/migrations/0109_p6_search_productivity_permissions.sql` | 2 permission codes (`saved_view.manage`, `saved_view.share`) and 19 role links; no approval code. |
| `packages/db/migrations/0110_p6_register_filter_indexes.sql` | 8 btree indexes (initiative and transformation filters and sorts; the search audit feed). No table change. |
| `packages/db/src/schema.ts` | 6 table interfaces, `Database` block, row types and `SCHEMA_COLUMNS` entries, **generated from the migrated catalogue** (`gen-dictionary.ts` → `schema-types.ts.txt`). |
| `packages/db/test/integration/catalogue.test.ts` | New test "0108: the P6 slice H/G guards are attached" (13 triggers); 3 tables added to the version-column pin; 6 privilege pins. |
| `packages/db/src/seed.test.ts` | "0109 seed equals the P6 part of permissions.ts (slices H and G)" (3 tests); the free-id example of the numbering test 0108 → 0111. |
| `packages/shared/src/permissions.ts` | `P6_SEARCH_PERMISSIONS`, `P6_SEARCH_ROLE_PERMISSIONS`, added to `P6_PERMISSIONS` and to all 14 role blocks (AUD's entry is empty). |
| `apps/api/src/modules/platform/advisory-locks.ts`, `.test.ts` | `searchReindex` 730318, `savedViewShare` 730319; 730320–730322 reserved; the pin (49 → 51 classes). |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 rows 730318–730322 and the P6 block sentence. |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list + `saved_view.manage`, `saved_view.share` (the `0109` defaults). |

Migration ids: `0108`–`0110` directly above the shipped `0107` (D-196); no gap, no retired id. Hashes: `T-DG6-ARCH-04-evidence/migration-sha256.txt`.

### 2.3 ERD and data dictionary (deliverable 4)

- `docs/architecture/erd.md` §1w (diagram, the polymorphic-record note, the entity register), inserted before §2.
- `docs/architecture/data-dictionary.md` "P6 tables, slices H and G (migrations 0108–0110, DG6)": 6 table sections generated from the catalogue of a freshly migrated database (`gen-dictionary.ts`, output `dictionary-section.md`), the `0110` indexes on earlier tables and the function list.

### 2.4 Contract (deliverable 5)

- `docs/api/openapi.yaml`: `info.version` stays `1.5.0-p6` (set by ARCH-01). 1 new tag (`search`), **12 operations** appended, 4 parameter components, 20 schemas:
  - search (2): `searchRecords`, `getSearchIndexStatus`;
  - saved views (6): `listSavedViews`, `createSavedView`, `getSavedView`, `putSavedView`, `deleteSavedView` (DELETE with If-Match, the `retireDependencyType` precedent), `shareSavedView`;
  - forms (2): `listMyFormDrafts`, `compareFormRecordVersions`;
  - help (2): `listHelpTopics`, `getHelpTopic`.
- **Extensions of routed operations (D-195 seam 14, additive):** optional query parameters inserted before `Cursor` in `listInitiatives` (`q`, `executiveOwnerUserId`, `workstreamLeadUserId`, `sort` enum), `listTransformations` (`sort` enum) and the 9 register-kit lists `listStrategicGuardrails`, `listOutcomes`, `listDiagnosticItems`, `listDiagnosticFindings`, `listWorkstreamOutputs`, `listTomGaps`, `listCapabilityHeatmapEntries`, `listJourneies`, `listJourneyPainPoints` (`RegisterQuery`, `RegisterSort`). The `PermissionCode` enum (response-only) gains the 2 codes.
- ADR-0007 §5b statuses: every operation declares 400 and 429; every session operation 401 and 403; every `IfMatch` operation 409 and 428; 404 on every path with an id and on `createSavedView` (transformation not readable); 422 where a business rule can refuse; `searchRecords` also 503 as problem+json. Request media type `application/json` on the 3 operations with a body (= their future `config.consumes`). ETag on `getSavedView` and every saved-view mutation response. Cursor pagination on the 5 list operations.
- `diff` against the pre-task file removes **0 lines** and adds 539. The final file is byte-identical to the output of `openapi-p6-arch04.py` run on the pre-task file (checked with `cmp` on a regenerated copy).
- `pnpm openapi:lint` → `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 922 operations`, exit 0 (`openapi-lint.log`).
- **Pending seams:** `apps/api/test/support/p6-pending-arch-04.ts` (slice aggregate), `p6-pending-be-p.ts` (2), `p6-pending-be-q.ts` (6), `p6-pending-be-q2.ts` (4); one import line in `p6-pending.ts`; `p6-operations.ts` +12 ids (keeps the P2-scoped AUD sweeps on their scope).
- **`contract.test.ts` pins changed (only as the pattern requires):** the operation count **910 → 922** (with its comment line). No other pin changed.

### 2.5 Permissions matrix and work split (deliverable 6)

- `docs/analysis/permissions-matrix.md` §27: 2 codes, per-entity rights for all 14 roles, AUD read-only (searches, lists and applies shared views, reads help; every saved-view write 403), technical admins (`saved_view.manage` only), the load-run rules.
- `docs/architecture/p6-work-split.md` §H/G (15 subsections), appended after §B/A; §1–§2 unchanged: what the architect delivered; BE-P, BE-P2, BE-Q, BE-Q2, BE-R, FE-D, FE-D2, DO-E, DO-F, BE-S, DO-G with exact files, operations, consumed contracts and tests; the exact `db-errors.ts` mappings for the saved-view constraints (BE-Q); migrations left and their order; integration order; requirement → owner; 10 points the implementers must know.

## 3. Requirements in scope

| Requirement | Architect delivered | Remaining owner(s) |
|---|---|---|
| REQ-S15-010 | `0108`–`0110`; ADR-0057 §1–§10; probes S, SD, IS, SV, HT; 12 operations and the list parameters | BE-P, BE-P2, BE-Q, BE-Q2, BE-R, FE-D, FE-D2; QA-B, QA-C |
| REQ-S15-011 | ADR-0057 §6, §9; help topic `records.drafts` | FE-D2, BE-Q2; QA-C/QA-D |
| REQ-S15-013 | ADR-0057 §4, §5; `0110`; contract parameters | BE-R, BE-Q, FE-D; QA-D |
| REQ-S16-026 | ADR-0057 §7, §8 | FE-D2, BE-Q2; QA-C |
| REQ-S20-029 | ADR-0058; `0108` (`load_dataset_marker`), `0110`; probe LM | DO-E, DO-F, BE-S, DO-G; QA-E |
| REQ-S20-030 | ADR-0058 §7 | BE-S, DO-G; QA-E |

No requirement is complete yet: every row needs its implementer work. This is an architecture task.

## 4. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL 16.13 disposable clusters from `tests/qa/support/with-pg.sh` on ports 23701–23749 only. Every log ends with the command's own `EXIT=` line unless stated. Logs are in `T-DG6-ARCH-04-evidence/`.

### 4.1 Migration apply and guard probe

`QA_PG_PORT=23711 MTH_PORT_POOL=23712-23719 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-04-evidence/probe.ts` → **71/71 PASS, exit 0** (`probe-output.txt`).

- G00: 0108–0110 present directly above 0107; nothing above 0110. G01: fresh database, 0001 → 0110 applied (102 files).
- G02–G05: 0001–0097 applied; then 2 transformations (one instantiated by the DG3 function), 12 initiatives (English and Arabic names), 3 users; then 0098–0110 applied on top (13 files). Initiatives and transformations are byte-identical before and after (md5 of their JSON) and the audit count is unchanged; no document, view or marker exists; the 12 index states are at sequence 0 with an Unknown count; 11 help topics; the 11 named indexes exist.
- **Guards fire:**
  - missing audit fails at COMMIT: SV03 (`saved_view_audit_required`);
  - a non-stepping version fails: SD02, IS05, SV04 (`*_version_step`);
  - UPDATE/DELETE on history and append-only rows fails: SV28, SV29 (`saved_view_event`, even as the owner role), LM05, LM06 (`load_dataset_marker`); and the grants hold: HT03 (`help_topic` SELECT only), IS06, SV30, LM02;
  - every database claim of the ADRs holds: the text search configurations and queries (S01, S02), the document invariants (SD04–SD10, SD12) and its deletion by the job (SD11), the index-state rules (IS01–IS04), the saved-view JSON shapes (SV05–SV10), uniqueness of names and defaults (SV11, SV12, SV26), owner-only change and share (SV13, SV14, SV16), the shared shape (SV15, SV17), organization matching (SV20, SV21), list rules (SV18, SV19), the state machine (SV22–SV25), the trigger-written history (SV02, SV27), the help seeds (HT01, HT02, HT04), the load marker's empty-database rule (LM01, LM03, LM04, LM07), and the permission seeds (PM01–PM04).

**Disclosed first run:** `probe-output-run1-fixture-error.txt`. The first attempt (port 23701) stopped in the probe's own fixture before any slice probe: the second synthetic transformation had no business unit (`transformation.business_unit_id` is NOT NULL, error 23502), and the uncaught error left the pg clients open, so the process hung until the shell `timeout`. I added a business unit for it and made the probe exit explicitly; no migration changed. The run above is the complete one. The migrations are unchanged since it (`sha256sum -c migration-sha256.txt` → 3 × OK at 02:45 UTC).

### 4.2 Static checks

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | 0 | `typecheck.log` (an earlier run during the work: `typecheck-early.log`, exit 0) |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `format.log` ("All matched files use Prettier code style!") |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 922 operations`) |

The documentation edits made after the format run are under `docs/`, which `.prettierignore` excludes; a direct `prettier --check` of the edited Markdown files also passed.

### 4.3 Unit tests

| Command | Locale | Result | Exit | Log |
|---|---|---|---|---|
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | unset | unit-node 155 files: **1 failed**, 154 passed; 2428 tests: **1 failed**, 2427 passed. unit-web 96 files / 1768 tests passed. unit-formula-nocodegen 3 files / 259 passed, 2 skipped | 1 | `unit-locale-unset.log` (02:00 → 02:18 UTC) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | `C.UTF-8` | unit-node 155 files / 2428 tests passed. unit-web 96 files: **3 failed**, 93 passed; 1768 tests: **5 failed**, 1763 passed. unit-formula-nocodegen 3 / 259 passed, 2 skipped | 1 | `unit-c-utf8.log` (02:18 → 02:41 UTC) |

**Both non-zero exits, explained:**

1. **Locale unset, `apps/api/src/architecture.test.ts` › "has only mapped module directories …"** → `expected [ '.claude' ] to deeply equal []`. Cause: an empty directory `apps/api/src/modules/.claude/.cc-writes`, created at 01:04:32 UTC by my session's tool harness when my shell's working directory was `apps/api/src/modules` (the harness creates `.claude/.cc-writes` in its working directory). It is not repository content (git does not track empty directories, so it is not in any candidate), but the test lists directories on disk. I removed it and the two other such directories my session created (`apps/web/src/.claude`, `T-DG6-ARCH-04-evidence/.claude`), all empty, at about 02:13 UTC; the older `.claude` directories elsewhere in the tree were not created by me and were left alone. Re-verification: the C.UTF-8 run, which reached the file after the removal, passed it; a re-run of the file with the locale unset gave 141/141 passed but **exit 1** from a Vitest worker RPC timeout ("Timeout calling onTaskUpdate", an unhandled harness error under machine load; `unit-architecture-rerun-locale-unset.log`); a second re-run gave **141/141 passed, exit 0** (`unit-architecture-rerun2-locale-unset.log`).
2. **C.UTF-8, unit-web:** `pages/gates/g5-g6.test.tsx` (2 tests), `pages/portfolio/portfolio.test.tsx` (2 tests), `pages/roadmap/roadmap.test.tsx` (1 test): three "Test timed out in 20000ms" and two `findByRole` lookups that gave up. They ran while the full integration suite was running on the same host (§4.4), and the same 96 web files passed with the locale unset; this task changed no web file. Re-run of the three files with `C.UTF-8`: **3 files, 81 tests passed, exit 0** (`unit-web-rerun-c-utf8.log`). I report them as load-sensitive timing in existing DG5 web tests (the F-DG5-145/146 class), not as a defect of this change.

The 2 skipped tests are in `packages/shared/src/formula/fuzz.test.ts`, unchanged. Targeted runs during the work: `vitest run --project unit-node packages/db/src/seed.test.ts apps/api/src/modules/platform/advisory-locks.test.ts` → 2 files, 68 tests passed, exit 0 (`unit-targeted-early.log`).

### 4.4 Integration tests

- **Targeted, during the work:** `QA_PG_PORT=23731 MTH_PORT_POOL=23732-23739 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration packages/db/test/integration/` → **12 files, 225 tests passed, exit 0** (`integration-db-early.log`; includes `catalogue.test.ts` 33 tests with the new pins, `migrate.test.ts`, the demo seed tests).
- **Full suite:** `QA_PG_PORT=23741 MTH_PORT_POOL=23742-23749 tests/qa/support/with-pg.sh pnpm test:integration`, 01:41:45 → 03:02:53 UTC (duration 4866.81 s; slower than ARCH-03's 56-minute solo run because the unit suites ran on the same host at the same time) → **exit 0: 326 files passed; 3163 tests: 3161 passed, 1 skipped, 1 todo** (`integration-full.log`, which ends with `EXIT=0`). It finished after the first version of this paragraph was written (that version reported 161 of the files completed with 0 failures). Among them: `contract.test.ts` 101 tests passed (the 922-operation count, the pending exclusions, the ADR-0007 §5b derivation and the public-operation pin hold), `catalogue.test.ts` and `identity.test.ts` passed. Before it finished I also ran `identity.test.ts` alone: `QA_PG_PORT=23721 MTH_PORT_POOL=23722-23729 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/identity.test.ts` → 1 file, 13 tests passed, exit 0 (`integration-identity-targeted.log`).
- **Pinned counts:** the operation count 910 → 922 (contract test passed). No other pinned count changed.


## 5. Raised to the orchestrator (decisions needed; nothing decided by me)

1. **Bulk per-record outcome (p6-plan §3 row 15).** The DG5 `bulkUpdateFormRecords` is all-or-nothing. ADR-0057 §8 reads REQ-S15-010's "a bulk update touching a stale record reports a conflict for that record only" as met by the DG5 response, which lists only the stale items (and saves nothing). **Recommendation:** keep it (no reopen). **Alternative (additive):** an optional request field `mode: "all_or_nothing" | "per_record"` (absent = DG5 behaviour, byte-identical), where `per_record` commits each non-stale item in its own savepoint and returns 200 with one result per item (`updated` with its new version, or `conflict` with the current version, or `refused` with its problem). That is a contract change of a DG5 operation (BE-Q2 + one contract edit by an ARCH task); decide before BE-Q2 starts.
2. **"The full load dataset" export (REQ-S20-030; ADR-0058 §7).** P5 exports are per transformation; no cross-transformation export exists. The ADR's proof is the largest transformation's full live selection (xlsx and csv) plus 50 concurrent exports, one per transformation. Confirm this reading, or schedule a cross-transformation export (a new feature and a DG5 contract change).
3. **The search index jobs read sensitive records (ADR-0057 §2).** ADR-0051 §2 requires an explicit ADR-0053 exception for a job to read a sensitive record. ADR-0057 declares it for `search.index_feed` and `search.reindex`, limited to the indexed columns (titles, codes, descriptions; no value column); readers are filtered at query time. Confirm, or decide that sensitive records are not indexed at all (then a granted user would not find them by search).
4. **Register lists outside ADR-0057 §5.** P6 adds server-side sort and text filters to 11 list operations (initiatives, transformations, the 9 register-kit lists). Benefits, RAID, KPIs, decisions, dependencies and deliverables keep their DG2–DG5 filters and fixed order. REQ-S15-013's acceptance names only the 1,000-initiative register; decide whether more lists need sort in DG6 (each is a contract change by an ARCH task and a BE-R-sized task).
5. **Draft recovery scope (ADR-0057 §6).** P6 recovers drafts for the form-record editors (P5 `form_draft`). Other editors (for example KPI actual entry, gate submissions) keep their DG behaviour. Confirm that this meets "unsaved drafts are recoverable".
6. **Comparison values (ADR-0057 §7).** The DG5 rule (`forms/history.ts`) is that `audit.read` is the only way to see before/after values. ADR-0057 gives values to `audit.read` holders **and** the record type's editors (who already see and can overwrite the current values and need them to reapply); plain readers get field names only. This widens the DG5 rule for one new read. Confirm, or choose the `audit.read`-only variant (BE-Q2 implements either).
7. **A DG2 contract description discrepancy found while reading (not changed).** The 9 register-kit list operations describe their 200 response as "Page, newest change first (`updatedAt` desc, `id` desc)", but `register-kit.ts` orders by `id` ascending (`.orderBy("id")`). ADR-0057 §5 keeps "absent parameter = today's result" (the code's order). The description is a DG2 contract text; correcting it (or the code) is the orchestrator's call (a P6 finding for BE-F's response sweep, R1).
8. **Task splits (p6-plan §5.1):** BE-P → BE-P/BE-P2, BE-Q → BE-Q/BE-Q2, FE-D → FE-D/FE-D2 (+3 runs), each sized for 60–75 minutes; no file outside the plan's boundaries.
9. **`MTH_ENV=load` (ADR-0058 §4)** is a new configuration value with two start-up refusals (DO-E, `packages/config`). It follows D-195 Q9; confirm it before DO-E starts.

## 6. DG1–DG5 artifacts changed, and why (D-195: additive changes)

| Artifact | Change | Why |
|---|---|---|
| `docs/api/openapi.yaml` | 1 tag, 12 appended operations, 4 parameters, 20 schemas; optional query parameters inserted into 11 DG2/DG3 list operations; `PermissionCode` +2 values | Deliverable 5; seam 14 ("optional query parameters; an absent parameter returns today's result"), adopted by D-195; the enum addition is response-only (needed for `getMe`). 0 lines removed. |
| `apps/api/test/integration/contract/contract.test.ts` | count 910 → 922 | The P3–P6 pending precedent; p6-plan §5.3. |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list + 2 codes | The `0109` role defaults. |
| `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts`, `packages/shared/src/permissions.ts`, `advisory-locks.ts` (+ test), ADR-0016 §6 | as §2.2 | Mirror `0108`–`0110`; registry rule. |
| `apps/api/test/support/p6-pending.ts`, `p6-operations.ts` | one import; +12 ids | The pending seam. |
| `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md`, `docs/architecture/p6-work-split.md` | appended H/G sections | Deliverables 4 and 6. |
| `packages/db/migrations/0110_p6_register_filter_indexes.sql` | 8 indexes on `initiative`, `transformation`, `audit_event` | DG3/DG1 tables; indexes only, no row, column, constraint or response change (probe G04). |

No DG1–DG5 behaviour changes: no existing table, column, constraint, trigger, row, route or user-facing text changes. With no H/G row and no new parameter sent, every response is as at DG5 (probe G04: initiatives and transformations byte-identical, audit count unchanged).

Untracked dot-files at the repository top level (`.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.vscode`, `CLAUDE.local.md`, …) appeared in `git status` at the start; I did not create them and left them untouched.

## 7. What the implementers of this slice must know

In `p6-work-split.md` §H/G.14 and §2. The main points: permission is decided at query time through `ReadScope`, never at index time; no value column is indexed; the audit trail is the search feed (no new outbox emits on DG1–DG5 paths), and upserts are monotonic so a replay creates nothing; a saved view grants no data and only its owner changes it; one draft model (P5 `form_draft`), read only by `forms/drafts.ts`, labelled exactly "Draft - not submitted"; reapply sends only the user's own changed fields with the current If-Match; absent list parameters change nothing; load figures are reported as measured and every miss is a Medium, non-mandatory finding; the load dataset never touches the demo seed or a marked database.

## 8. End

- **End validation:** `node tools/gates/validate.mjs --historical --stage DG5` at the end: `PASS gate DG5 (historical)`, `EXIT=0`, at `HEAD` `5e4cbad` (`end-validate-dg5.log`).
- **End:** `date -u` → `Tue Oct 27 02:47:08 UTC 2026` (start 01:02:23 UTC, so about 1 h 45 min).
- **Commits:** nothing committed (the orchestrator commits).
- **Remaining for a continuation or the orchestrator:**
  1. The usual post-merge `pnpm test:integration` on the merged tree (the full run here passed on this tree: §4.4).
  2. The decisions in §5, items 1–9 (items 1, 3, 5, 6 before BE-Q2/BE-P start; item 9 before DO-E).
  3. Nothing else of deliverables 1–6 is outstanding.

No requirement in scope is complete. Every row still needs its implementer work (§3).

### Merge instructions

- Apply as one change. The migrations are `0108`, `0109`, `0110`, forward-only, applied on top of `0107` (probe G03).
- Expect small textual conflicts only in shared pins if a concurrent task touched the same lines (`contract.test.ts` count, `p6-pending.ts`, `p6-operations.ts`, `identity.test.ts`, `catalogue.test.ts`, `seed.test.ts`, `permissions.ts`, `schema.ts`, `advisory-locks.ts`); keep both sides' lines.
- After merge: `pnpm test`, `pnpm test:integration` (full), `pnpm openapi:lint`, `node tools/gates/validate.mjs --historical --stage DG5`.
- Evidence: `docs/delivery/handbacks/DG6/T-DG6-ARCH-04-evidence/` (probe script and outputs including the disclosed first run, dictionary/type generator and outputs, contract generator, check logs).
