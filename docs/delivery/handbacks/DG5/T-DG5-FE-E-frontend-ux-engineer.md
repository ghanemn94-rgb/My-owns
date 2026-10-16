# Handback: T-DG5-FE-E (frontend-ux-engineer), stage P5 / DG5

- **Run:** `DG5-T-DG5-FE-E-frontend-ux-engineer-20261016T162515Z-f10ef824`, session `f10ef824-a614-4719-b20b-1a501115a20c`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-E.md` (sha256 `44b1d94c…096a9`, verified at start).
- **Base:** branch `dg5/fe-e` at `f534d20`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started 16:25:29Z; handback closed at about 18:05Z (≈100 minutes; see §7).
- **Scope:** p5-work-split §F, the FE-E row of p5-plan §5.1 (`pages/reports/**`, `pages/exports/**`, `pages/presentation/**`, `pages/updates/**`), plus the items routed to FE-E by D-155 (d) and D-159 (e).
- **Approvals:** nothing in this work grants or records a business, Finance or IT approval. All test data is SYNTHETIC. Product gates G1–G6 are business approvals inside the product; no screen shows DG0–DG7.

## 1. Changed files

**New: web screens (FE-E ownership)**

| File | Purpose |
|---|---|
| `apps/web/src/pages/reports/api.ts` | Request paths of the 26 slice F operations, query keys under `["p5","reports",…]`, and read hooks. Typed with the `@mth/shared` mirrors. |
| `apps/web/src/pages/reports/ui.tsx` | Shared FE-E UI. `ReportDocumentView` renders sections, labels and empty texts through `REPORT_CONTENT_LABELS` (the shared export table). `ReportValueView` shows Provisional / Unknown / Stale; Unknown and Stale never show a number. Also: legend, status chips (icon + text), guarded runner (one form alert), `NoteForm`, transformation entry, "Not stated". |
| `apps/web/src/pages/reports/ReportsPage.tsx` | The 12 outputs: generate form (subject for meeting, gate or handover outputs; period; register and RAID filters), live preview (not stored), snapshot list with filters and counts. Also the entry page. |
| `apps/web/src/pages/reports/SnapshotPage.tsx` | One snapshot: draft / issued / superseded / discarded states; issue (optional note), discard (reason), reissue (reason); export form; content; retained versions, source revisions and cited evidence. |
| `apps/web/src/pages/reports/EvidenceRegisterPage.tsx` | Evidence register (REQ-S13-010): links, type, source, owner, observation period, upload date, version, SHA-256, review status, versions list. Also the entry page. |
| `apps/web/src/pages/exports/ExportForm.tsx` | Export of a snapshot: only the output's formats, en/ar, `Idempotency-Key`, then live progress. |
| `apps/web/src/pages/exports/ExportsPage.tsx` | Your export jobs: status, stage, percent and sections (polled while active); translated job error codes; download via fetch, so 409/422/404 are translated; cancel with If-Match. |
| `apps/web/src/pages/presentation/PresentationPage.tsx` | Presentation entry, the transformation's meetings, and a meeting's presentation: live or a meeting-pack snapshot (`?snapshotId=`), read-only. Generating the pack snapshot is the printable pack (issue, then PDF/PPTX). |
| `apps/web/src/pages/updates/OwnerUpdatesPage.tsx` | Owner updates (REQ-S09-011): per period, the transformation and each active workstream; the eight fields; saved draft vs submitted; submit; reopen (reason); revisions. Also the entry page. |
| `apps/web/src/pages/reports/fee.test.tsx` | 16 unit tests with stubbed API, en and ar (§3). |
| `apps/web/e2e/p5-reports-exports.spec.ts` | 5 Playwright journeys × 2 languages against the real API (§3). |
| `apps/web/src/i18n/{en,ar}/reportsP5.json` | New namespace, 280 keys each, identical key sets. |

**New: shared mirrors (routed to FE-E by D-155 d and D-159 e)**

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/export-jobs.ts` | `ExportLiveSelection`, `ExportCreate`, `ExportJob`, `ExportJobPage`, and the closed sets `EXPORT_STATUSES`, `EXPORT_STAGES`, `EXPORT_ERROR_CODES` (moved verbatim from the API). |
| `packages/shared/src/schemas/presentation.ts` | `MeetingPresentation`. |
| `packages/shared/src/schemas/evidence-register.ts` | `EvidenceRegisterPage` and `EvidenceVersionPage`, with their item schemas. |

**Edited files that other tasks own (routed or required)**

| File | Change |
|---|---|
| `packages/shared/src/schemas/index.ts` | +3 barrel lines, appended. |
| `apps/api/src/modules/reporting/exports/jobs.ts` (BE-M) | The local definitions of the closed sets, `exportLiveSelection`, `exportCreate`, `exportJob` and `exportJobPage` are removed. They are imported from `@mth/shared/schemas` and re-exported under the same names, so no caller changes. Behaviour is unchanged. |
| `apps/api/test/integration/contract/p5-exercises-be-m.ts` (BE-M) | Imports `exportJob` and `exportJobPage` from `@mth/shared/schemas`. |
| `apps/api/test/integration/contract/p5-exercises-be-o.ts` (BE-O) | Its local zod mirrors are replaced by the shared `meetingPresentation`, `evidenceRegisterPage` and `evidenceVersionPage` (field-for-field identical). |
| `apps/web/src/app/router.tsx` (FE-A) | 11 lazy pages and 12 routes appended. The placeholder filter also excludes `FE-E`, and the five FE-E rows of `P5_PLANNED_ROUTES` are removed: the FE-B/C/D precedent, D-161. |
| `apps/web/src/app/nav.ts` (FE-A) | The `NavSubPage.id` union gets `evidenceRegister` and `ownerUpdates`, with two appended `NAV_SUBPAGES` entries. Evidence-area `AREA_CONTENTS`: "Snapshots" and "Generated packs" move from `p5` ("Not available yet") to delivered `links`, and "Attachments" links the evidence register (F-DG4-160). |
| `apps/web/src/app/p5-shell.test.tsx` (FE-A) | `reports`, `exports` and `presentation` are no longer expected as placeholders. Adds an "FE-E built" check: no FE-E planned route, and the 12 routes are present. |
| `apps/web/src/i18n/index.ts` (FE-A) | `reportsP5` namespace registered (3 appended lines). |
| `apps/web/src/i18n/{en,ar}/problems.json` (FE-A) | +24 keys each, appended; no duplicates (checked by script: `dups []`). See §2.8. |
| `apps/web/src/i18n/{en,ar}/nav.json` (FE-A) | `nav.sub.evidenceRegister` and `nav.sub.ownerUpdates`. |
| `apps/web/src/pages/meetings/MeetingPage.tsx` (DG4 FE-D) | One appended link: "Present this meeting (presentation mode)", for Governance > Meetings > Present (REQ-S10-013 `screen_api`). This is the cut-off-pack link precedent. |

## 2. Behaviour delivered, per requirement row

### 2.1 REQ-S13-004: generate screens

Acceptance: *"A15: each of the ten outputs (charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard, handover) generates from the demo transformation and contains that transformation's ID and records."*

- **Reports page.** The output list comes from `listReportDefinitions`: all 12, in ordinal order, with bilingual labels and descriptions and their formats.
- **Subject picker** by `subjectType`: meeting, gate instance (`useGates`), or BAU handover. A transformation subject needs none.
- **Reporting period** is offered only when `needsReportingPeriod` is true.
- **Registers parameters:** the register, plus the RAID `type` and `status` filters.
- **Live preview** comes from `getLiveReport` and is labelled "not stored". "Generate snapshot" calls `generateReportSnapshot` and opens the snapshot.
- **Document header** shows the transformation **code** (`data-transformation-code`), subject, period, as-of time, methodology version and the approval state of the sources.
- **e2e:** the register output generates in a fresh synthetic transformation, and the header shows that transformation's code, in en and ar.
- **Not covered:** all ten outputs from the *demo* dataset are QA-C's A15. My unit and e2e tests cover the register output and the meeting pack only.

### 2.2 REQ-S13-005: export dialog and progress

Acceptance: *"A15: an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria."*

- **Export form** on every non-discarded snapshot. It offers only `definition.formats`, plus language en/ar, and sends `createExport` with an `Idempotency-Key`. A new choice of format or language gets a new key; a retry of the same choice reuses it.
- A generated snapshot's form says the file will be marked "Draft — not an issued report".
- **Progress** shows status, stage, percent (`<progress>` with an accessible name) and sections. It is polled every 2 s while queued or running.
- **Exports page:** your own jobs, filterable by status, also scoped per transformation. Downloads show name, size and SHA-256; failed jobs show their translated error code; queued or running jobs can be cancelled with If-Match.
- **Not checked by me:** the file contents (exact filtered rows, gate criteria) are the BE-M/BE-N renderer tests and QA-C's A15.
- **No worker in the e2e stack:** `with-stack.sh` starts none, so an e2e job stays queued until cancelled; the download path is not exercised end-to-end. Download through the UI is covered only by the code path (fetch, then a blob, or the translated problem).

### 2.3 REQ-S13-007: snapshots screen

Acceptance: *"A07;A15: after a later KPI change, the issued snapshot still shows the old values and their versions."*

- **Snapshot page** shows the stored `content` as it is. It never re-reads live data.
- It lists what the snapshot retains (M0254):
  - as-of time, period and methodology version;
  - the `report_snapshot_version` rows (methodology, config, KPI, formula, weights, calculation engine, scoring scheme);
  - source record revisions with approval and validation state;
  - cited evidence with revision and checksum;
  - the content SHA-256.
- **State machine in the UI:**
  - generated: "Draft — not an issued report" banner; Issue (optional note) or Discard (reason ≥ 3);
  - issued: vN, with Reissue (reason ≥ 3), which opens the new generated reissue;
  - superseded: banner, link to the current issue;
  - discarded: who, when and reason; no export.
- **Refusals** are translated and stay visible after the automatic reload: one runner and one alert above the actions. This was a defect I found and fixed; see §3.
- **e2e:**
  - generate, then issue meanwhile through the API; the UI's stale issue is refused (409 `version_conflict` or 422 `report_snapshot.not_generated`);
  - reissue with a reason, issue it as v2;
  - v1 shows superseded and still v1.
- **Not done here:** the "later KPI change" part of A07 belongs to QA-B and KBE-C's integration test.

### 2.4 REQ-S13-008: provisional labels in reports

Acceptance: *"A10;A15: a pending benefit value is labelled provisional in the PDF pack."*

- Every value of the native view shows its `validation`:
  - "Provisional"/"مؤقت" next to a provisional value;
  - "Unknown"/"غير معروف" or "Stale"/"قديم" with its reason **in place of** the number;
  - "n/a" for a value that does not apply.
- Unknown and Stale are never shown as 0 and never green; there is no green chip for them (unit test).
- A legend sits on every rendered document. The snapshot list and page show the provisional and unknown counts.
- The PDF label itself is BE-N's renderer.

### 2.5 REQ-S13-010: evidence register screen

Acceptance: *"A01;A12: an uploaded file stores a SHA-256 checksum and version 1; a second upload becomes version 2."*

- Routes: `/transformations/:id/evidence-register`, and the entry page `/evidence-reports/evidence-register` (nav: Evidence and Reports > Evidence register).
- A file shows its current revision and SHA-256. "Versions" lists every revision with checksum, size, file name, uploader and time; the unit test checks v2 and v1 with both checksums.
- A note or link shows "No checksum (not a file)" and its record version.
- A missing source or observation date shows "Not stated".
- Filters: review status and evidence type. Uploads stay on the DG2 evidence screen, which the register links to.
- **e2e:** the auditor reads the register; a note shows "No checksum" and 3× "Not stated"; there is no form.

### 2.6 REQ-S09-011: `pages/updates/**`

Acceptance: *"A02;A15: the executive pack's workstream section contains the submitted update text and current metrics without manual editing."*

- `/transformations/:id/owner-updates` is the `owner_update_due` work item's `linkPath`. The entry is Initiatives and Roadmaps > Owner updates.
- Period select: the first open period by default.
- One card for the transformation and one per active workstream. Each states its owner, or "No owner" for a workstream without a lead.
- Status chip: "No update submitted" / "Draft (not submitted)" / "Submitted".
- A saved draft carries a "not submitted" banner. **Save draft** creates or PATCHes with If-Match; **Submit** calls submit with If-Match; reopen takes a reason; the revisions list follows.
- A closed period says its updates are read-only.
- **e2e:** an empty submit is refused (422 `owner_update.empty`) and stays a saved draft; then written and submitted, it shows the submitted text.
- **Not covered by FE-E:** the pack content is KBE-D's assembler and test. The screen states the link and points to Reports.

### 2.7 REQ-S10-013: `pages/presentation/**`

Acceptance: *"A15: changing a linked decision before cut-off changes the presentation; the issued pack remains the snapshot."*

- Route `/transformations/:id/meetings/:meetingId/presentation`, linked from the meeting page.
- **Live mode** is the default ("assembled now … a linked decision changed before cut-off appears changed here").
- **Snapshot mode:** pick one of this meeting's meeting-pack snapshots, or `?snapshotId=`. It shows the stored content.
- "Generate the pack snapshot" opens the snapshot, where it is issued and exported as PDF/PPTX: the printable pack.
- Read-only: there is no editable copy.
- **e2e:**
  - live from the meeting page link;
  - meeting B's pack inside meeting A is refused (422 `presentation.snapshot_mismatch`, translated);
  - B's own pack shows the snapshot mode.
- **Not covered:** the decision-change behaviour is BE-O's integration test (D-159). It is not re-tested in e2e.

### 2.8 Routed items (D-155 to D-159)

- **Problem texts, en and ar:** all nine export codes, `presentation.snapshot_mismatch`, and the 14 ADR-0045 §11 codes the screens can receive (`report.*`, `report_snapshot.*`, `owner_update.*`). That is 24 keys per language.
  - The English text equals the ADR text exactly. The unit test parses ADR-0045 §11 and ADR-0046 §8, including the job-error sentence (24 codes), and checks English equality and Arabic presence.
  - No key was added to the ADRs; there are no new codes.
- **Zod mirrors** promoted with one barrel line each, and used by the API (`jobs.ts`), both contract exercises and the web.
- **Content labels** render through `packages/shared/src/reports/content-labels.ts`. One gap: `report.empty.no_records` is an exporter *frame* label (`@mth/reporting` `FRAME_LABELS`) that the web does not import. The web shows its own en/ar "No records" for it, and for any empty key missing from the table. The Arabic screenshot showed the raw key before this fix; the unit test now checks it.

## 3. Checks actually run

**Environment:** Node 24.21.0, offline. Harness ports 23500–23549 only. The machine was shared with three other W16 runs (load average about 11–12 on 4 CPUs).

| # | Command | Result |
|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | `PASS gate DG4 (historical)`, **exit 0** |
| 1 | `pnpm -r build` | **exit 0** (`build.log`). The web was rebuilt after the last source edit: `build-web-3.log`, exit 0. |
| 2 | `pnpm -r typecheck` | **exit 0** (`typecheck-final.log`). After the last edit to `ExportForm`/`SnapshotPage`/the test: web `tsc --noEmit` **exit 0** (`typecheck-web-after-last-edit.log`). |
| 3 | `pnpm lint` | **exit 0** (`lint-final.log`). After the last edit: `eslint --max-warnings=0` on `apps/web/src/pages`, `apps/web/src/app` and the spec, **exit 0** (`lint-after-last-edit.log`). |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (`prettier.log`). All files edited later were re-formatted with `prettier --write`. |
| 5 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`, **exit 0** |
| 6a | `pnpm test`, locale unset, run 1 | **exit 1**: unit-node 2252/2252, unit-web 2 failed / 1484 passed, worker 259 + 2 skipped. The 2 failures were mine: Arabic "تحول" without the glossary's shadda, and Arabic format labels that were English. Fixed (`unit-locale-unset-run1-2failed.log`). |
| 6b | `pnpm test`, locale unset, run 2 (after the fix) | **exit 1**: unit-web **1486/1486**, worker **259 + 2 skipped**, unit-node 2 failed / 2250 passed. The 2 are load timeouts: `architecture.test.ts` at 30 s and `pdf.test.ts` at 5 s, the F-DG4-143…148 class recorded in D-160 (d). Both passed in run 1 (2252/2252) (`unit-locale-unset.log`). |
| 6c | the two timed-out files alone, locale unset | **exit 0**, 152/152 (`unit-node-timeout-rerun.log`) |
| 7 | `LC_ALL=C.UTF-8 pnpm test` | First attempt: **stopped by the harness's 30-minute background limit**, with no result (`unit-c-utf8-STOPPED-by-time-limit.log`). Second attempt, final tree: **exit 1**: unit-web **1487/1487**, worker **259 + 2 skipped**, unit-node 1 failed / 2251 passed. The failure is the `architecture.test.ts` 30 s load timeout (`unit-c-utf8-final.log`). |
| 7b | `architecture.test.ts` alone, `C.UTF-8` | **exit 0**, 139/139 (`unit-node-arch-c-utf8-rerun.log`) |
| 8a | `QA_PG_PORT=23500 MTH_PORT_POOL=23501-23519 tests/qa/support/with-pg.sh pnpm test:integration` | **Stopped by the harness's 30-minute background limit** after 114 of about 278 files: 114 files and 1594 tests passed, **0 failed**. Not a pass (`integration.log`). |
| 8b | the same harness (ports 23510, 23511–23519), targeted on what my change touches: `contract.test.ts`, `exports.test.ts`, `exports-paged.test.ts`, `report-snapshots.test.ts`, `owner-updates.test.ts`, `governance/presentation.test.ts`, `evidence/evidence-register.test.ts` | **exit 0**: 7 files, **137 passed + 1 skipped** (BE-O's no-assembler case, D-159) (`integration-targeted.log`). **No pinned-count change.** |
| 9 | FE-E e2e spec, final: `with-stack.sh npx playwright test apps/web/e2e/p5-reports-exports.spec.ts --workers=1` (ports 23540–23549) | **exit 0, 10/10** (5 journeys × en, ar), axe clean (`e2e-fee-final.log`) |
| 10 | full web e2e: `with-stack.sh npx playwright test apps/web/e2e --workers=1` (ports 23520–23549), 406 tests in 32 files | **Stopped by the harness's 30-minute background limit** at test 155 of 406: **124 passed, 7 failed**, the rest not run (`e2e-full.log`). Details below. |
| 11 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | `PASS gate DG4 (historical)`, **exit 0** (`validate-dg4-end.log`) |

**Full e2e: the 7 failures** are all outside FE-E's screens:

- `p2-journeys` Define → G2 (35 s);
- `p4-adoption-bau` 6 (30 s);
- `p4-benefits` 8 (30 s; its screenshot shows the page still "Loading…");
- `p4-dashboards` 6 (30 s);
- `p4-execution` 1 (20 s);
- `p4-gates-closure` 1 (12 s);
- `p4-governance` role mapping (11 s).

They ran while my integration and unit suites and three other W16 runs shared 4 CPUs (load average about 12). `p4-governance` re-run alone passed **16/16** in en and ar (`e2e-rerun.log`), so that failure was load. The other six were not re-run, for lack of time, so they are **not shown** to be load. My only edits that touch those pages are the appended nav entries, the evidence landing chips and one link on the meeting page.

### 3.1 Unit summary

- **What is shown:** in both locales, every web and worker test passes (web 1486/1487, worker 259 + 2 skipped). The only node failures are known load timeouts (`architecture.test.ts`, `pdf.test.ts`), and each passes when run alone in the same locale.
- **What is not shown:** no single `pnpm test` invocation exited 0 on this loaded machine. Acceptance item 2 is therefore **not met as literally stated**; it needs an unloaded rerun.
- **Count change:** unit-web grew from 1470 (D-161) to 1487 (+16 `fee.test.tsx`, +1 `p5-shell` check).

**e2e run 1, the failure (`e2e-fee-only-1.log`).** It was a real defect, not a flake. After a stale-issue refusal, the reload turned the snapshot "issued". That unmounted the issue form, and its alert with it, so the refusal disappeared. The Arabic run passed only by timing.

- **Fix:** one runner and one alert for the snapshot actions, rendered above the forms (`SnapshotPage.tsx`).
- **Regression tests:** a unit test (the 409 alert stays after the reload finds the snapshot issued), and the e2e asserts the alert inside `[data-snapshot-actions]` after the reload.

**e2e rerun, the same defect class (`e2e-rerun.log`).** "Export a snapshot discarded meanwhile" failed deterministically in en and ar: the reload found the snapshot discarded, the export section unmounted, and the 422 went with it.

- **Fix:** the export section stays for a discarded snapshot, with its alert and the note "A discarded snapshot cannot be exported."
- **Regression test:** a new unit test. The final spec run passed 10/10.

**Arabic screenshot, a defect (no failing test showed it).** The empty-section key `report.empty.no_records` appeared raw (§2.8). Fixed; the unit test now checks it.

**Evidence of what I looked at:** screenshots, en and ar, of every screen and refusal, under `T-DG5-FE-E-evidence/screenshots/{en,ar}/p5-*.png`, written by the final runs. I inspected these visually:

- `ar/p5-report-snapshot-stale-issue.png` (from run 1: RTL layout, chips with icon and text, the Provisional, Unknown and Stale legend);
- `en/p5-owner-update-submitted.png`.

**Interaction checks the e2e actually ran:**

- keyboard-reachable buttons and selects, by role and label;
- axe (no serious or critical violation) on reports, the draft and issued snapshot, exports, owner updates (empty and submitted), presentation and the evidence register, in en and ar;
- no request to a foreign origin (`trackRequests`).

## 4. Operations routed (pending-list delta)

FE-E has no `p5-pending-fe-e.ts`. All 26 slice F operations were routed and exercised by KBE-C, KBE-D, BE-M and BE-O. **The delta is zero.**

- No route was added. No `config.consumes` or request body changed, so the media-type pin is unchanged at `[391, 390, 1]` and the operation count stays 846.
- The contract exercises of BE-M and BE-O now import the promoted shared mirrors. The schemas are field-for-field identical, so no exercise behaviour changes.

## 5. Contract, schema and dependency needs

- **No new dependency. No contract change.**
- **Suggestion for the owner of `content-labels.ts` (KBE-D2) or BE-N:** add `report.empty.no_records` to the shared content table, so the web need not special-case a frame label. The web already handles it.
- **Contract note:** the meeting-pack snapshot list has no `subjectId` filter on `listReportSnapshots`. The presentation screen filters the meeting's packs client-side, from all `meeting_pack` snapshots of the transformation (cursor pages, at most 20 × max limit). This works for P5 volumes. A `subjectId` query parameter would be a contract addition for the architect, so none was added.

## 6. User-facing texts made untrue, and what I did

- **Evidence and Reports landing page:** "Snapshots" and "Generated packs" were marked "Not available yet" through `p5`. They are now delivered `links`, with the "Available" chip, in `nav.ts` `AREA_CONTENTS`. The en/ar strings are generic and stay true.
- **Placeholders:** `nav.p5.{reports,reportSnapshot,exports,presentation,ownerUpdates}` are no longer rendered: their routes are real screens. The keys stay in `nav.json`, unused (the FE-B precedent). The owner of `nav.json` (FE-A/FE-G) may delete them.
- **Other strings:** a scan of the en/ar catalogues for "planned / not available / later / being built" near report, export, pack, presentation or update found no other text made untrue.

## 7. What remains

- **Checks not completed in the time limit:** the full integration suite (stopped at 114/≈278 files with 0 failures; the targeted suites pass) and the full web e2e (stopped at 155/406: 124 passed, 7 failed outside FE-E, 1 of the 7 shown to be load). Both need an unloaded run, which the orchestrator's merged-tree verification does. No single `pnpm test` invocation exited 0 on the loaded machine (only load timeouts, each passing alone; §3.1).

- **e2e gaps:**
  - The download path end-to-end and a `succeeded` job in e2e: the stack runs no worker. This is a harness limit, disclosed in §2.2.
  - All ten outputs from the demo dataset in the UI: QA-C's A15.
- **Owners of other files:**
  - `P5_PENDING_TESTS_BE_O` still lists the now-running REQ-S10-013 test (D-159 e); its owner, BE-O or AN-P5, clears it.
  - The unused `nav.p5.*` FE-E placeholder keys (§6).
- **Untracked files I did not create:** dotfiles appeared at the worktree top level during the run (`.bashrc`, `.zshrc`, `.mcp.json`, `.vscode/`, `.idea/`, `CLAUDE.local.md`, …); the session's HOME is the worktree. They are not mine and I did not touch them, but the prettier command over `git ls-files -co --exclude-standard` sees them. See §3, row 4.
