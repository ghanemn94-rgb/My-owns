# Handback T-DG6-BE-D (backend-workflow-engineer): upload allow-list, upload policy, safe preview

- **Stage:** P6, gate DG6 (BUILDING). Task T-DG6-BE-D, p6-work-split §E/F.6 (W10). Assignment `docs/delivery/assignments/DG6/T-DG6-BE-D.md` (sha256 `f9d7e7e9…3a37`, verified at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-D-backend-workflow-engineer-20261029T230335Z-2fb54f9a","session_id":"2fb54f9a-21b3-4912-ba9f-827d0734df33"}`.
- **Base:** branch `dg6/be-d` at `a28d715fb5da2f666642d75397a0e8571a5fbdd3`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started `2026-10-29T23:03:55Z`. The end time is in §8.
- **Requirement rows:** REQ-S13-011 (owner BE-D, with FE-B). This task also contributes the "disallowed upload type" and "oversized upload" behaviour to REQ-S16-030; BE-E2 writes the security-suite clause tests.
- **Gates:** product gates G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7. Changing an upload policy approves nothing. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/evidence/content-policy.ts` | The ADR-0052 §1 detector and policy. It has: the magic-byte signatures; the strict streaming UTF-8 and NUL rule for csv/txt/svg; the SVG root-element rule; and the ZIP central-directory reader (≤ 10,000 entries, no decompression, ZIP64 and multi-disk refused). It refuses `vbaProject.bin` (macro-enabled). `ContentInspector` and `inspectedBody` see the same stream the store hashes. `decideUpload` is the accept rule. It also holds the three refusal problems with `params` (D-198), `effectiveUploadPolicy` (row or default) and `mediaTypeOf`. No new dependency. |
| `apps/api/src/modules/evidence/preview.ts` | `previewEvidenceContent` (ADR-0052 §2). It answers 200 only for a `png`/`jpeg`/`gif` `detected_type` whose magic is re-checked on read. It sends exactly the §2 headers and streams the bytes through the API (a web `ReadableStream`; `node:stream` is not on the D-055 allow-list). Everything else is 422 `evidence.preview_unavailable`. Authorization is `requireEvidenceRead` (ADR-0051 §4). |
| `apps/api/src/modules/evidence/routes.ts` | **Upload lines only**, plus one route-list entry. Phase 1 reads the policy's `max_bytes`, and the store enforces it while streaming. Phase 2 feeds the inspector. Phase 3 does the following in order: commit-time authorization, the locked If-Match check, the allow-list decision against the policy as it stands at commit, then stores `detected_type` and the canonical `content_type`. The audit event gains `contentType {from: null, to: <type>}`. The 413 now carries `params.maxBytes`. `GET …/preview` is added to `EVIDENCE_MODULE_ROUTES`. |
| `apps/api/src/modules/admin/upload-policy.ts` | `getUploadPolicy` and `putUploadPolicy` (ADR-0052 §1). GET: `security.read` or `upload_policy.configure`, with ETag `"0"` and the default view when no row exists. PUT: `upload_policy.configure`, IfMatchOrZero, the request-start gate, validation, the commit-time re-check after the row lock, and one audit event `upload_policy.changed` with prior and new version and the reason. A concurrent `"0"` create is 409 through the existing `upload_policy_organization_key` mapping. |
| `packages/shared/src/schemas/uploads.ts` | Zod mirrors `uploadType`, `uploadPolicy` and `uploadPolicyUpdate`, plus `UPLOAD_TYPES`, `INLINE_PREVIEW_TYPES` and `UPLOAD_POLICY_MAX_BYTES`. `reason` uses the shared rule (§2 rule 1). |
| `packages/db/migrations/0118_p6_evidence_content_detected_type_required.sql` | **New migration.** A BEFORE INSERT trigger: a new `evidence_content` row needs `detected_type` (check_violation, constraint `evidence_content_detected_type_required`). This is the rule ADR-0052 §1 calls "BE-D's migration 0101". Pre-P6 rows are untouched. |
| `apps/api/src/modules/evidence/content-policy.test.ts` | Unit tests (50): one case per §1 table row (with every extension, case-insensitive), plus `.exe`, renamed `.exe`, HTML, a non-OOXML ZIP, macro-enabled OOXML (`.xlsx`, `.xlsm`, `.docx`), cross-type renames, strict-UTF-8 failures, a narrowed policy, policy 413, the SVG root rule, the ZIP reader limits (10,000 / 10,001 entries, truncated, corrupt, ZIP64, ambiguous), and chunk-boundary independence including a 6 MiB OOXML. |
| `apps/api/test/integration/evidence/preview.test.ts` | Integration (33 tests): REQ-S13-011 literally, every accepted type stored with its media type and audited once, the preview headers, every refusal path, a pre-P6 row, tampered bytes, authorization (404 / 403 / AUD 200), the 0118 trigger, and a narrowed policy applied to uploads. |
| `apps/api/test/integration/admin/upload-policy.test.ts` | Integration (9 tests): the default view, read authorization, create and update with audit and history, 428 and 409, the validation matrix, request-start 403/404 (AUD 403 on write; CSRF), commit-time re-authorization (the right is revoked while the PUT waits on the row lock: 403, nothing written), concurrent `"0"` creates, and the history table not writable by `mth_app`. |
| `apps/api/test/support/upload-fixtures.ts` | Synthetic byte fixtures and a minimal stored-entry ZIP writer, shared by the integration tests. (The unit test keeps its own copy, because module tests may not import outside `src/modules`.) |
| `apps/api/test/integration/contract/p6-exercises-be-d.ts` | Exercises the 3 operations through `mirrored`. Preview: 200/400/401/403/404/422. Get: 200/400/401/403/404. Put: 200/400/401/403/404/409/428. Plus the zod mirrors. |
| `apps/api/test/support/p6-pending-be-d.ts` | The pending list is now empty (delta in §4). |
| `apps/api/src/modules/evidence/evidence.test.ts` | Route-count pin 13 → 14 (preview), and the preview's declared access. |
| `apps/api/test/integration/contract/contract.test.ts` | **Shared pin:** JSON request bodies 407 → 408 (`putUploadPolicy`). Reconciled by the orchestrator. |
| `packages/db/src/seed.test.ts` | **Shared:** the free-id example 0118 → 0119 (0118 is now shipped on this branch). |
| `apps/api/test/integration/{request-io,shutdown-cleanup,connection-hygiene,commit-time-auth,media-types}.test.ts` | **Behaviour-change adaptations only (no assertion weakened).** These DG2 suites uploaded random bytes named `.bin`, which the allow-list now refuses. Their synthetic binary bodies are now PDFs (`%PDF-` followed by the same random bytes, same length), named `.pdf`. `media-types` sends its ill-formed bytes behind a PDF signature. One size in request-io's byte-exact loop went from 1 to 5 bytes (the smallest PDF). `after-abort.bin` → `.txt` (its body is text). |

## 2. Behaviour delivered (REQ-S13-011)

Requirement text: "Support native evidence notes and common documents/images with file-type and size controls and safe preview/download". Expected behaviour: "Uploads are type- and size-checked; previews are rendered safely (no active content)". **Acceptance:** "A12: an .exe or an oversized file is rejected; an SVG with script is not executed in preview".

- **"an .exe … is rejected":** `setup.exe` (MZ header) → 422 `evidence.type_not_allowed`, "This file type is not allowed. Allowed types: pdf, docx, xlsx, pptx, csv, txt, png, jpeg, gif, svg.", with `params.allowedTypes`. The same bytes named `invoice.pdf` → 422 `evidence.type_mismatch`, "The file's content does not match its extension .pdf.", with `params.extension`. In both cases nothing is stored: no content row, no object, version unchanged, no audit event (`preview.test.ts`, first describe).
- **"an oversized file is rejected":** the policy limit + 1 byte → 413 `evidence.too_large` ("Evidence content is limited to 26214400 bytes per revision.", `params.maxBytes`), nothing stored. Exactly the limit is accepted. A narrowed policy of 100 bytes refuses 101 bytes with `maxBytes "100"`.
- **"an SVG with script is not executed in preview":** an SVG carrying `<script>` and `onload` uploads (svg is allowed). Its preview answers 422 `evidence.preview_unavailable` ("No preview is available for this file. Download it instead."). Its download stays `application/octet-stream` + `attachment` + `nosniff`, byte-identical. SVG is never served inline.
- **Safe preview:** PNG, JPEG and GIF answer 200 with exactly `Content-Type` (the raster type), `Content-Disposition: inline; filename="<sanitised>"`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: private, no-store`. The bytes are the stored ones.
  - PDF, DOCX, XLSX, PPTX, CSV, TXT, SVG, a note, an item without content, a pre-P6 row (`detected_type` NULL, even with PNG bytes) and bytes that lost their magic on disk are all 422.
  - The preview is a read: no audit event, no version change.
- **"a narrowed policy refuses a type the default allows":** with `allowedTypes [pdf, csv]`, a PNG is 422 `type_not_allowed` naming only `pdf, csv`. After the default is restored, the PNG uploads.
- **Stored result:** every accepted type stores `detected_type` and its canonical `content_type` (equal to `p6_upload_media_type`), and is audited once with prior/new version and `contentType`. 0118 refuses a new row without `detected_type` (proven directly as the owner).
- **Authorization of the preview (= download, ADR-0051 §4, D-196 Option A):** an outsider in the same organization gets 404, another organization's user 404, and an unknown item 404. AUD and in-scope readers get 200. An in-scope reader not admitted to a sensitive item gets 403 `evidence.parent_forbidden`, while the uploader (a named party) still gets 200.
- **Upload policy (ADR-0052 §1):**
  - The default (no row) is all ten types, 26214400 bytes, `isDefault: true`, `inlinePreviewTypes [png, jpeg, gif]`, ETag `"0"`.
  - A row can only narrow it (400 `validation` for a type outside the set, a duplicate, an empty list, 0 or > 26214400, a non-integer, a bad reason, an unknown member).
  - ADM_TECH writes. AUD reads and gets 403 on writes. TO, a user without grants, another organization's TO and another organization's ADM_TECH get 403. An unknown organization is 404.
  - Every mutation has: If-Match (428/409; `"0"` creates version 1), one audit event with prior and new version and the reason, and the trigger-written history.
  - Commit-time re-authorization is tested with a real row-lock wait.
- **Rules of §2 checked:**
  - rule 1: `reason` uses the shared rule;
  - rule 2: the shared parsers;
  - rule 3: the PUT's `consumes` is `application/json`; the GETs declare none; the contract test's `consumesDrift` is green;
  - rule 4: as above; no remote I/O in a transaction: the store's receive happens between the two transactions, as in DG2, and finalise stays a local rename;
  - rule 7: AUD 403 on the write, 200 on the reads;
  - rule 10: the concurrent `"0"` create is backstopped by the unique key.

## 3. Checks actually run

The logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-D-evidence/`. Node 24.21.0, offline. The host was shared with three parallel W10 agents (load average about 25–34 during the runs).

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` (`validate-historical-DG5-start.txt`) |
| 1a | `pnpm -r typecheck` (first run) | **2** | Two type errors in my new test files (`readonly` tuple; `max_bytes` number vs string). Fixed. Then `apps/api tsc -p tsconfig.json --noEmit` → 0. The final full run is in §8. |
| 1b | `pnpm -r build` | 0 | `static-checks.txt` |
| 1c | `pnpm lint` | 0 | `static-checks.txt` (run before the two test type fixes; the final rerun is in §8) |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" |
| 1e | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` |
| 2 | `pnpm test`, locale unset / `C.UTF-8` | see §8 | `unit-locale-unset.log`, `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=25060 MTH_PORT_POOL=25061-25099 tests/qa/support/with-pg.sh pnpm test:integration` | see §8 | `integration-full.log` |
| — | Targeted integration (ports 25050/25051-25099): my two files + evidence/admin dirs + the five adapted suites + contract + `packages/db/test/integration` | 1 → 0 | First run: 507 passed / 5 failed. The 5 failures were: the contract pin (needed +1); my legacy-row fixture's audit action (`audit_event_action_check` forbids digits); and three `media-types` cases still sending `.bin`. After the fixes, the three files re-ran: **155/155 passed**. |
| — | `vitest run --project unit-node apps/api/src/modules/evidence/ architecture.test.ts server.test.ts` | 0 | 210/210 |

## 4. Operations routed (delta to `p6-pending-be-d.ts`)

| Operation | Before | After | Exercised in |
|---|---|---|---|
| `previewEvidenceContent` | pending | routed | `p6-exercises-be-d.ts` (200, 400, 401, 403, 404, 422) |
| `getUploadPolicy` | pending | routed | (200, 400, 401, 403, 404; zod mirror `uploadPolicy`) |
| `putUploadPolicy` | pending | routed | (200, 400, 401, 403, 404, 409, 428; zod mirror `uploadPolicy`) |

`P6_PENDING_BE_D` is now `[]` (3 → 0).

**Pinned-count deltas for the orchestrator:**
- JSON request bodies: +1 (`putUploadPolicy`), so `[408, 407, 1]` on this branch.
- Operation count: unchanged (the operations were already in the contract).
- Media types, rate-limit floor and CSRF-exempt routes: unchanged.
- The evidence module's route count: 13 → 14.
- Seed free-id example: 0118 → 0119.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **`Problem.params` description** (`docs/api/openapi.yaml`, `components.schemas.Problem.params`). It says params are sent only with the two gate-waiver codes. Per D-198, `params` is now also sent with `evidence.type_not_allowed` (`allowedTypes`), `evidence.type_mismatch` (`extension`) and `evidence.too_large` (`maxBytes`). This is a contract-text change only, not a schema change. I did not edit the shared `openapi.yaml`.
2. **Migration id:** `0118_p6_evidence_content_detected_type_required.sql` is the next id above the highest file on this branch (0117). If BE-M2, BE-G or KBE-B also took 0118, renumber at merge (D-196 item 2) and move the seed free-id example accordingly. The constraint name `evidence_content_detected_type_required` stays unmapped in `db-errors.ts` (500), like the other evidence_content P6 constraints: the API never sends a NULL type.
3. **Data dictionary** (`docs/architecture/data-dictionary.md`, not my file): add 0118's trigger and function to the "P6 functions" table of slices E/F. Suggested row: `evidence_content_detected_type_required()` | 0118 | trigger: a new `evidence_content` row needs `detected_type` (check_violation) | trigger only (`PUBLIC` revoked).
4. **Catalogue pins:** none needed. `packages/db/test/integration` passed with 0118 applied.
5. **No new dependency.** The ZIP central-directory reader and the detector are new code.
6. **No new problem code.** All codes and English texts are exactly those of ADR-0052 §1 and §2.

## 6. User-facing texts

- **`apps/web/src/i18n/{en,ar}/evidence.json` `upload.hint`** ("Up to 25 MB." / "حتى 25 ميغابايت."): still true as the ceiling, but it no longer tells the whole story. The organization's policy may set a lower limit, and only ten types are accepted. This is FE-owned; I did not edit it. **For FE-B:** suggested en text: "PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG, GIF or SVG; up to 25 MB, or your organization's lower limit." The Arabic needs the same meaning (labelled provisional).
- The problem texts for the three upload codes and `evidence.preview_unavailable` already exist in en/ar (FE-A), with the `{{allowedTypes}}`, `{{extension}}` and `{{maxBytes}}` placeholders that the API now fills through `params`. Routing `fieldErrorMessage` through `problemText` stays FE-B's (D-198).
- No en/ar string calls the upload allow-list or the preview "planned" (searched `apps/web/src/i18n`, `docs/operations`). Nothing else was made untrue.

## 7. Known gaps / not done

- The REQ-S16-030 security-suite clause files (`security/uploads.test.ts`, etc.) are BE-E2's (§E/F.8). This task provides the behaviour they assert.
- The web preview component, the upload-policy page and the hint text are FE-B's.
- No e2e spec was added, so no e2e budget applies.
- Anything in §8 marked as not completed.

## 8. Final results (honest state at handback, `2026-10-30T01:26Z`; started `2026-10-29T23:03:55Z`, so past the ~2 h limit)

The W10 host ran four agents at once. The load average was 16–34, and one typecheck process was OOM-killed. Every non-zero exit is listed here with its cause.

| Acceptance | Command | Exit | Counts and notes |
|---|---|---|---|
| 1 typecheck | `pnpm -r typecheck` | **2**, then **137** | Run 1: exit 2, two type errors, both in my new test files (fixed). Then `apps/api` `tsc -p tsconfig.json --noEmit` → **0**. Every other package passed in run 1, and none changed after it. Run 2 (the final full rerun): **137, `apps/api typecheck: Killed`** by the OOM killer on the shared host; no type error was reported (`static-checks-final.txt`). **The full `pnpm -r typecheck` has not completed with exit 0 on the final tree. The orchestrator must rerun it.** |
| 1 build | `pnpm -r build` | 0 | `static-checks.txt` |
| 1 lint | `pnpm lint` | 0 | final tree (`static-checks-final.txt`) |
| 1 format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (before this handback file was written; the handback was then formatted with Prettier) |
| 1 openapi | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 932 operations` |
| 2 unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **1** | Three invocations, all completed (`unit-locale-unset.log`). **unit-node** 2674 passed / 1 failed: `architecture.test.ts` "apps/web never imports @mth/db…", a 30 s timeout. **unit-web** 1782 passed / 5 failed: `kpi-periods` (ar), `traceability` ×2, `transformations` ×2, all `findBy…` lookups not found in time under load. I changed no `apps/web` file. **unit-formula-nocodegen** 259 passed, 2 skipped. |
| 2 unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **not completed** | Only **unit-node** finished: 2672 passed / 3 failed, all timeouts (`architecture.test.ts` 30 s, `server.test.ts` 5 s, `packages/reporting/src/branding-layout.test.ts` 5 s). The background time limit then stopped the job, so **unit-web and unit-formula-nocodegen did not run in C.UTF-8**. |
| 2 reruns alone | see `unit-reruns-alone.txt`, `unit-node-*-alone.txt`, `unit-web-traceability-alone.txt` | 0 (split) | **unit-node:** the three failed files together: 152/152 passed in both locales, but vitest exited 1 (the cause was not captured; my grep filter dropped it). Re-run split, they exited 0: `architecture.test.ts` + `branding-layout.test.ts` 146/146, and `server.test.ts` 6/6 (locale unset). **unit-web:** the three files together (unset): 58 passed / 1 failed (traceability ar). `traceability.test.tsx` alone at a lower load: **32/32 passed, exit 0**. `kpi-periods` and `transformations` passed in that three-file rerun. |
| 3 integration | `QA_PG_PORT=25060 MTH_PORT_POOL=25061-25099 tests/qa/support/with-pg.sh pnpm test:integration` | **stopped (background time limit), no final totals** | The log `integration-full.log` stops at **2033 passed, 11 marked failed** (one line was a `×` inside a test title, so 10 real failures). **Timeouts (6):** `contract.test.ts` "U+0000 in the query…" (30 s), "an undeclared request media type…" (30 s, twice), and `export (REQ-S05-001)` "at most 5000 rows" (60 s). **Assertion failures (4), not attributed:** (a) "the event-to-queue registry (D-102)": `connector.run_failed` expected `integrations.connector_exception` to be `automation.evaluate`; (b) "the catalogue triggers and starter 16 version 2 (0116)"; (c) "kpi.freshness_scan and operations.exception_raise"; (d) `contract.test.ts` "P5 BE-J operations": expected length 1, got 0. None of these files or areas (worker queue registry, automation starters, KPI freshness, P5 BE-J exercises) is touched by my diff. They look like the W7/W9 merge seams (BE-K2/BE-L2), but **I did not prove that they also fail at HEAD `a28d715fb`**. The orchestrator must confirm on the merged tree. My own and adapted suites passed in the targeted run (preview, upload-policy, media-types, contract 155/155; request-io, shutdown-cleanup, connection-hygiene, commit-time-auth, evidence, `packages/db` all passing in the 512-test run). Pinned-count change: JSON bodies 407 → 408 (§4). |
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` (`validate-historical-DG5-end.txt`) |

**What remains (for the orchestrator, on the merged tree):**
1. Rerun `pnpm -r typecheck` (the final run was OOM-killed, exit 137).
2. Run `pnpm test` in `C.UTF-8` in full (unit-web and unit-formula-nocodegen did not run).
3. Rerun the full integration suite at normal load (it was stopped by the time limit). Confirm the 6 timeouts are load-only, and check the 4 assertion failures (§8 row 3) against HEAD `a28d715fb`.
4. Reconcile the shared pins and migration id (§4, §5).
5. Apply the `Problem.params` contract-text note and the data-dictionary row (§5).
6. Pass the upload-hint text to FE-B (§6).

No separable second half is defined for BE-D. Every BE-D deliverable of §E/F.6 is implemented and tested; what remains is verification, not implementation.
