# Handback T-DG5-ARCH-04 (solution-architect): P5 architecture, slice F (reports, snapshots, exports, presentation, owner updates, evidence)

- **Stage:** P5 "Configuration automation and outputs", DG5 (BUILDING). Branch `claude/mobily-transformation-platform-regate`, base `HEAD` `8ac7fec8db8d2cfce34c9d3f11c5543800872798`.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-04-solution-architect-20261014T055554Z-48105904","session_id":"48105904-4ca9-4c81-8ac2-eac5a31cd278"}`. Assignment `docs/delivery/assignments/DG5/T-DG5-ARCH-04.md`, sha256 `618fc43c…b882d` (checked at the start).
- **Time:** start `Wed Oct 14 05:56:08 UTC 2026`; end `Wed Oct 14 08:02:08 UTC 2026`.
- **Ports used:** 23710 (probe), 23715 (dictionary generator), 23720 (integration); all inside 23700–23749.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. Issuing a report snapshot approves nothing; no agent, seed or job grants a business, Finance or IT approval.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0045-p5-generated-outputs-report-snapshots-owner-updates-presentation-evidence.md` (new) | Slice F outputs: the twelve definitions and their assemblers, live vs generated vs issued, ReportSnapshot (M0254 items), reissue as a new version, provisional/Unknown/Stale rules, owner updates and the executive pack, presentation mode and printable packs, evidence fields and linkage, authorization, exact refusal codes |
| `docs/architecture/adr/ADR-0046-p5-exporters-pdf-docx-xlsx-pptx-csv-fonts-rtl-injection-export-jobs.md` (new) | Exporters in the worker via `@mth/reporting`, RTL/LTR and bundled fonts, formula-injection rules, async export jobs with progress, export authorization, the D-142 Q8 dependency and licence table |
| `packages/db/migrations/0080_p5_reports_snapshots_updates.sql` (new) | `report_definition` (12 seeded), `report_snapshot` (+ sources, versions, evidence children), `owner_update` (+ revisions), work-item kind `owner_update_due`, job schedule `reports.owner_update_tasks` |
| `packages/db/migrations/0081_p5_export_jobs.sql` (new) | `export_job`, `export_job_progress` |
| `packages/db/migrations/0082_p5_reporting_permissions.sql` (new) | 4 permission codes and 25 role links |
| `packages/db/src/schema.ts` | Kysely types and column catalogue for the 9 new tables |
| `packages/db/src/seed.test.ts` | 0082 block (3 tests: rows, role links, no approval code / AUD and admins none / issuers TL, TO, SEC); header and the aggregate permission sets |
| `packages/db/test/integration/catalogue.test.ts` | Slice F trigger-set test; 4 mutable `version` tables; 9 privilege rows |
| `packages/shared/src/permissions.ts` | `P5_REPORTING_PERMISSIONS`, `P5_REPORTING_ROLE_PERMISSIONS`, spread into `PERMISSIONS` and the ten business roles |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | Lock classes 730263 `reportSnapshotIssue`, 730264 `exportJob` (730265 reserved) |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry rows 730263–730265 and the allocation sentence |
| `docs/api/openapi.yaml` | 26 slice F operations, 15 parameters, 34 schemas, 4 tags; `PermissionCode` +4; `info.version` already `1.4.0-p5` |
| `apps/api/test/support/p5-pending-arch-04.ts` (new, aggregate), `p5-pending-kbe-c.ts` (11), `p5-pending-kbe-d.ts` (7), `p5-pending-be-m.ts` (5), `p5-pending-be-o.ts` (3) (new) | Pending lists so the contract test stays green until the routes exist |
| `apps/api/test/support/p5-pending.ts`, `p5-operations.ts` | Aggregate import line; the 26-id slice F block |
| `apps/api/test/integration/contract/contract.test.ts` | Operation count 763 → 789 and its comment line (the D-079 pin pattern) |
| `apps/api/test/integration/identity.test.ts`, `apps/api/test/integration/reporting/my-work.test.ts`, `apps/worker/test/integration/schedules.test.ts` | Pins that read the seeded catalogue: the TO effective-permission list (+`export.create`, `report.generate`, `report.issue`), the work-item kind count 38 → 39 and `missing_updates` 5 → 6, and `reports.owner_update_tasks` listed as unhandled until KBE-D (the ARCH-01/ARCH-03 precedent) |
| `apps/api/src/modules/reporting/my-work.ts`, `apps/web/src/i18n/en/myWork.json`, `apps/web/src/i18n/ar/myWork.json` | The new kind `owner_update_due` mapped to `missing_updates` with its en/ar label (the completeness tests read every `work_item_kind` row; the ARCH-01/ARCH-03 precedent) |
| `docs/architecture/erd.md` | §1o (diagram and entity register) |
| `docs/architecture/data-dictionary.md` | "P5 tables, slice F" (generated from the catalogue) plus seeds, functions and validation summary |
| `docs/analysis/permissions-matrix.md` | §21 (codes, per-entity rights, AUD read-only, admins none) |
| `docs/architecture/p5-work-split.md` | §F (F.0–F.11) |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/**` (new) | Logs, probe, generators, font evidence (§3) |

## 2. Behaviour delivered, per requirement (architecture level; implementers build the services)

| Requirement | What this task fixes | Where |
|---|---|---|
| REQ-S13-004 | Twelve report definitions (the ten M0253 outputs + executive pack + meeting pack), one assembler per definition, every output scoped to one transformation with its subject checked by the database | ADR-0045 §1; `0080` S01; RS05/RS06/RS10 |
| REQ-S13-005 | Server-side rendering of all five formats from a stored snapshot; async jobs with progress; exactly the snapshot's records | ADR-0046 §1, §2, §5; `0081` EJ01–EJ20 |
| REQ-S13-006 | The six leading characters; inline strings + `quotePrefix` in XLSX, `'` in CSV; only declared totals become `SUM` formulas | ADR-0046 §4 |
| REQ-S13-007 | Typed as-of, period copy, source revisions, methodology and calculation versions, approval state, cited evidence; content immutable; issue/reissue/supersede with one issued per series | ADR-0045 §2–§4; RS01–RS30, RC01–RC08 |
| REQ-S13-008 | Validation state on every value, the six assembler rules, counts on the snapshot, labels in views and every file | ADR-0045 §5; ADR-0046 §4, §9 |
| REQ-S13-009 | Language per export, Latin digits, bidi layout with `bidi-js`, bundled IBM Plex Sans Arabic / IBM Plex Sans (OFL-1.1; GSUB/GPOS checked) | ADR-0046 §3, §7; `font-tables.txt` |
| REQ-S13-010 | Every M0255 field is mapped to an existing column (no evidence column added); evidence register and versions reads; snapshot evidence linkage with revision and checksum | ADR-0045 §8; RC01, RC06 |
| REQ-S09-011 | `owner_update` with the eight M0185 fields, revisions, open-period rule, update tasks, the executive pack built from updates + canonical metrics | ADR-0045 §6; OU01–OU17; S03 |
| REQ-S10-013 | Presentation live or from a meeting-pack snapshot, same assembler as the printable pack | ADR-0045 §7 |

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm workspace, offline; PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh` (UTF8, C collation).

### 3.1 `node tools/gates/validate.mjs --historical --stage DG4` (start)

`PASS gate DG4 (historical)`, exit 0 — `00-start-validate.log`. End-of-task run: §3.9.

### 3.2 Migration apply and guard probe

Command: `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe.ts` → exit 0, **93/93 PASS** (`probe-output.txt`). It covers:

- G00 0080–0082 present, 0083–0084 free; G01 fresh database 0001→0082 (73 files) applies; G02 a database populated by 0001–0061 with a synthetic transformation instantiated by the DG3 function; G03 0062→0082 apply over it; G04 the DG4 transformation unchanged and no slice F row created by the upgrade.
- Seeds S01–S04 (12 definitions, five formats offered, the work-item kind and audited schedule, 4 write codes with no approval right, AUD/admins none, issuers SEC/TL/TO).
- Guards: missing audit fails at COMMIT (RS02, OU02, EJ02); a non-stepping version fails (RS03, OU03, EJ09, EJ15); UPDATE/DELETE on history fails (RC04, RC05, OU15) and mth_app has no UPDATE/DELETE on history and no DELETE anywhere in slice F (AO, AD, RS30, EJ20); every database invariant the ADRs claim (RS04–RS29, RC01–RC08, OU04–OU17, EJ03–EJ19).

**Disclosed failing intermediate runs:** run 1 did not start (a syntax error where I concatenated the copied harness: a missing `}`; nothing ran against the database). Run 2 gave 91/93: RS22 and OU16 were refused by a different guard than the probe expected (the trigger `report_snapshot_reissue_of_issued` fires before the CHECK `report_snapshot_reissue_shape`; `owner_update_period_open` fires before `owner_update_identity_immutable` because the probe moved the update to a closed period). Both refusals were correct; I changed the two probes to isolate the intended guard, not the migrations. Run 2's output is kept as `probe-run2-2-fail-probe-ordering.txt`.

### 3.3 Data dictionary generation

`QA_PG_PORT=23715 … with-pg.sh node --conditions=@mth/source …/gen-dictionary.ts > dictionary-section.md` → exit 0; inserted verbatim (minus the harness banner line) into `data-dictionary.md`.

### 3.4 Static checks (final runs, after the last code change)

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm -r build` | 0 | `build.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `format.log` |
| `pnpm openapi:lint` | 0 — `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 789 operations` | `openapi-lint.log` |

Contract diff: `diff` of `openapi.yaml` before/after shows **0 removed lines**; every change is an insertion (tags, paths, parameters, schemas, the `PermissionCode` enum lines). Every P1–P4 and slice A–E path is byte-stable.

### 3.5 Unit tests (`pnpm test` = unit-node, unit-web, unit-formula-nocodegen)

The machine was shared with three W4 runs; `uptime` showed a load average of about 25 on 4 CPUs (07:09 UTC) and 18 (07:23 UTC). All runs, in order:

| Run | Locale | unit-node | unit-web | formula | Exit | Cause of failures | Log |
|---|---|---|---|---|---|---|---|
| 1 | unset | 1815/1815 | 1383/1385 | 259 + 2 skipped | 1 | **my defect:** the new work-item kind `owner_update_due` had no My Work label (`message-keys.test.ts`, en and ar) | `unit-locale-unset-run1-2-fail-mywork-label.log` |
| 1 | C.UTF-8 | 1814/1815 | 1383/1385 | 259 + 2 skipped | 1 | the same label defect; `architecture.test.ts` "every import respects dependsOn…" timed out at its 30 s limit (it took 29.2 s in the passing run 1 unset) | `unit-c-utf8-run1-fail-mywork-label-and-arch-timeout.log` |
| 2 | unset | 1814/1815 | 1385/1385 | 259 + 2 skipped | 1 | `architecture.test.ts` timeout again (load); the label fix holds | `unit-locale-unset-run2-1-fail-architecture-timeout.log` |
| 2 | C.UTF-8 | 1815/1815 | 1384/1385 | 259 + 2 skipped | 1 | `raid.test.tsx` "action register: source, follow-up date…" did not find a link in time (load; a DG4 screen test this task does not touch) | `unit-c-utf8-run2-1-fail-raid-under-load.log` |
| targeted | unset | 188/188 (`architecture.test.ts`, `advisory-locks.test.ts`, `seed.test.ts`) | 105/105 (`raid.test.tsx`, `message-keys.test.ts`) | — | 0 / 0 | — | `unit-targeted-unset.log` |
| targeted | C.UTF-8 | 188/188 (same files) | 105/105 (same files) | — | 0 / 0 | — | `unit-targeted-c-utf8.log` |

Fix between run 1 and run 2: `owner_update_due` mapped to `missing_updates` in `reporting/my-work.ts` with its en/ar labels. Run 1 overlapped the start of run 2 for a few minutes (I renamed the run-1 logs while its C.UTF-8 unit-web part was still finishing; its exit line was written to a new file and is appended by hand, marked so, to the run-1 log). **Honest status:** every test passed in at least one full run and in the targeted re-runs of the failing files in both locales, but no single full `pnpm test` run in either locale exited 0 after the fix; the two remaining failures are timeouts of tests outside this task's change under the shared load. A full re-run in both locales on an idle machine is left to the orchestrator's merged-tree verification.

### 3.6 Integration tests (`QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration`)

- **Run 1:** 2043/2050, 7 failures in 4 files, exit 1 (`integration-run1-7-fail-pins.log`). All 7 were mine: (a) `contract.test.ts` §5a/§5b: `listReportDefinitions` lacked 400 and `cancelExport` lacked 403 in the contract (fixed in `openapi.yaml` and the generator); (b) pins that count the seeded catalogue: `identity.test.ts` (the TO permission list), `my-work.test.ts` (38 → 39 kinds; `missing_updates` 5 → 6), `schedules.test.ts` (the new schedule is unhandled until KBE-D) — updated.
- **Re-run of the four failing files plus `catalogue.test.ts`:** 120/120, exit 0 (`integration-rerun-failed-files.log`). The other 207 files passed in run 1 and contain no change of this task's after run 1 (the fixes touched only `openapi.yaml` statuses and the three pins). A full integration re-run is left to the merged-tree verification.
- Count change: 2049 (D-145 merged tree) → 2050 here (+1 `catalogue.test.ts` slice F trigger-set test).

### 3.7 Pinned-count changes

- `contract.test.ts` operation count: 763 → **789** (+26).
- `packages/db/src/seed.test.ts`: +3 tests (0082 block) → unit-node 1812 → 1815.
- `catalogue.test.ts`: +1 test (slice F trigger set); extended privilege and mutable-table lists.
- `my-work.test.ts`: 38 → 39 kinds, `missing_updates` 5 → 6. `identity.test.ts`: TO permissions +3. `schedules.test.ts`: +1 unhandled schedule.
- Lock registry: 32 → **34** classes.
- No media-type or rate-limit pin changed (all 26 operations are pending; their routes do not exist yet).

### 3.8 What was not run

- No exporter code exists yet (implementers' work), so no export file was produced or inspected; REQ-S13-005/006/009 are designed, not built.
- Registry metadata (versions, licences, install scripts, sizes) of `pdfkit`, `@types/pdfkit`, `docx`, `pptxgenjs`, `jszip` was **not verified**: the run is offline and none is in the local store (`font-tables.txt` last line: 0 store entries). See §6.

### 3.9 End-of-task checks

See the bottom of this file (`validate --historical --stage DG4` and `date -u`, `99-end.log`).

## 4. Known gaps and continuation

- Nothing in deliverables 1–6 is left unwritten. The services, assemblers, renderers and screens are implementer work in p5-work-split §F (KBE-C, KBE-C2, KBE-D, KBE-D2, BE-M, BE-N, BE-O, then FE-E and QA-C).
- The export dependencies must be installed by the orchestrator before BE-M/BE-N (§6). Until then their rendering checks are BLOCKED.
- The worker must mount the evidence-storage volume to write export files (ADR-0046 §5): a packaging change to request from devops through the orchestrator (additive).
- The DOCX font-embedding outcome is decided by BE-N's test (ADR-0046 §3), and recorded in BE-N's handback.

## 5. DG1–DG4 artifacts changed, and why (D-142)

- `apps/api/src/modules/platform/advisory-locks.ts` and its test: two new classes in this task's block (p5-plan §4; D-142 adopted the block). Existing classes unchanged.
- `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` §6: the registry rows for the block (the rule in that section requires them in the same change).
- `docs/api/openapi.yaml`: additive operations; the `PermissionCode` enum gains the four codes (the ARCH-01..03 precedent). No P1–P4 path changes.
- `apps/api/test/integration/contract/contract.test.ts`: the operation-count pin only (D-079 pattern).
- `apps/api/src/modules/reporting/my-work.ts` (DG4) and `apps/web/src/i18n/{en,ar}/myWork.json`: one appended map entry and one appended label each, for the new work-item kind, because the DG4 completeness tests (`message-keys.test.ts`, the My Work integration test) require every `work_item_kind` row to be mapped and labelled (the ARCH-01 and ARCH-03 precedent, D-143). Existing kinds unchanged.
- `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts`, `packages/db/src/schema.ts`, `packages/shared/src/permissions.ts`: append-only blocks (p5-plan §5.3).
- `apps/api/test/integration/identity.test.ts` (DG1), `apps/api/test/integration/reporting/my-work.test.ts` (DG4), `apps/worker/test/integration/schedules.test.ts` (DG4): count and list pins that read the seeded catalogue, updated for the new permissions, kind and schedule (§3.6). The behaviour they test is unchanged.
- No DG1–DG4 table, constraint, function, route, text or behaviour changes. `evidence` gains no column (p5-plan §3 row 16: no reopen needed).
- **One plan deviation for the orchestrator to note:** the renderers live in `packages/reporting/src/**` (the ADR-0002 reservation) instead of `apps/api/src/modules/reporting/exports/{pdf,docx,xlsx,pptx,csv}.ts` (p5-plan §5.1), because the worker renders and cannot import API code (ADR-0002 rule 5). The plan's KBE-C and KBE-D are split into KBE-C/KBE-C2 and KBE-D/KBE-D2 (time bound), and the BE-M/BE-N/BE-O file lists follow (p5-work-split §F). p5-plan names `packages/report-assets/**` for fonts; ADR-0046 instead depends on the two `@fontsource` packages already pinned by `apps/web` (no copied font files).

## 6. Install request (D-142 Q8; the orchestrator checks the registry and installs)

New workspace package `packages/reporting` (`@mth/reporting`, private, `type: module`, ADR-0002 reservation), with `exports` `.` and `./storage` in the `@mth/source`/`types`/`default` pattern of `@mth/shared`:

| Workspace package | dependency (exact pin requested) | kind | Verified offline |
|---|---|---|---|
| `packages/reporting` | `pdfkit@0.17.2` | dependency | **No** |
| `packages/reporting` | `docx@9.5.1` | dependency | **No** |
| `packages/reporting` | `pptxgenjs@4.0.1` | dependency | **No** |
| `packages/reporting` | `jszip@3.10.1` | dependency | **No** |
| `packages/reporting` | `bidi-js@1.1.0` | dependency | Yes (lockfile, MIT, no install hook) |
| `packages/reporting` | `@fontsource/ibm-plex-sans-arabic@5.2.6` | dependency | Yes (OFL-1.1, already pinned by `apps/web`) |
| `packages/reporting` | `@fontsource/ibm-plex-sans@5.2.6` | dependency | Yes (OFL-1.1, already pinned by `apps/web`) |
| `packages/reporting` | `@mth/shared@workspace:*`, `decimal.js` at the workspace's existing pin | dependency | workspace |
| `packages/reporting` | `@types/pdfkit` (the release matching the installed pdfkit) | devDependency | **No** |
| `apps/worker` | `@mth/reporting@workspace:*` | dependency | workspace |
| `apps/api` | `@mth/reporting@workspace:*` (imports only `@mth/reporting/storage`) | dependency | workspace |

For each unverified package the orchestrator records, from the registry metadata: that the version exists and is the latest stable release of its line (else pin the latest and record it), `license`, `hasInstallScript` (must be false for it and every transitive package, ADR-0001 `onlyBuiltDependencies: []`), the transitive set with licences, the unpacked size and the publication date; plus the official documentation URLs listed in ADR-0046 §7. `bidi-js@1.1.0` ships its own declarations (`package.json` `types`: `src/bidi.d.ts`, checked locally).

## 7. What the implementers of slice F must know

See p5-work-split §F.11. The most important: snapshot content never changes (do not set `report_snapshot.created_at` explicitly — the children's guard compares it with the transaction time); one assembler feeds live view, snapshot, presentation and every file; Unknown/Stale/Provisional never show as 0 or green; renderers are pure and run in the worker outside any transaction; formulas only from declared totals; create and download re-check `transformation.read`; do not add dependencies yourself.

## 8. Merge instructions

- Migrations `0080`, `0081`, `0082` in order after `0076` (0077–0079 stay free for slices D/E). Forward-only; sha256 in `migration-sha256.txt`.
- No conflict expected with BE-B2, BE-D or BE-H (they do not touch these files). If another W4 task appends to `p5-operations.ts`, `p5-pending.ts`, `schema.ts`, `permissions.ts`, `seed.test.ts` or `catalogue.test.ts`, merge as appends.
- Before BE-M and BE-N: the §6 install, then `pnpm install --frozen-lockfile` and the build.

## End of task

- `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0 (`T-DG5-ARCH-04-evidence/99-end.log`).
- `date -u` at the end: `Wed Oct 14 08:02:08 UTC 2026` (start `Wed Oct 14 05:56:08 UTC 2026`; about 2 h 6 min, slightly over the ~2 h bound because of the shared-load unit re-runs).
- Nothing was committed; the orchestrator integrates. I did not stop any process I did not start, ran no `git worktree add`, and installed nothing.
