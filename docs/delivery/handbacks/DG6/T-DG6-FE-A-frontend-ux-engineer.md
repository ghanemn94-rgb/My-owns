# Handback: T-DG6-FE-A (frontend-ux-engineer), the P6 web shell for slices E, F, J and C

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Engineering delivery gate work only. No product gate G1–G6 was granted, and no business, Finance or IT approval was given or implied.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-A.md` (sha256 `187fe183…8b166c`, verified at start).
- **Invocation:** `DG6-T-DG6-FE-A-frontend-ux-engineer-20261026T195929Z-0d48f532`, session `0d48f532-4500-45e2-b080-0aff2b2d9705`.
- **Base:** branch `dg6/fe-a`, `HEAD` `1c061ab8b9dae8ae5fce31dd261299024d014f56`. The changes are left uncommitted, as instructed.
- **Scope:** p6-work-split §E/F.12 and §J/C.13 (the FE-A bullets) and the FE-A row of p6-plan §5.1, limited to slices E, F, J and C. Those are the slices with a contract at this revision.
- **Time:** started 2026-10-26 19:59:45 UTC. The run was stopped by a container restart (D-198) before it recorded an end time; no `end-of-run.log` was written.

## Continuation T-DG6-FE-AB (D-198): read this first

- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-AB.md` (sha256 `392bd4fa9a6f6e01f04881925c122af115c5f66ee54675115136a97d7216f6eb`, verified at start).
- **Invocation:** `DG6-T-DG6-FE-AB-frontend-ux-engineer-20261026T213421Z-0bf23010`, session `0bf23010-6737-4b24-9a78-10277bd809af`.
- **Base:** branch `dg6/fe-a`, `HEAD` `eecd4ad74d0104ee000a548bdc2af8945ddef02f` (the orchestrator's WIP commit of T-DG6-FE-A on top of `1c061ab`). The continuation's changes are left **uncommitted**.
- **Time:** `date -u` at start: 2026-10-26 21:44:11 UTC; at end: see §3.2.
- **What I did:**
  1. I reviewed the WIP critically against §E/F.12, §J/C.13, the FE-A row of p6-plan §5.1 and `docs/api/openapi.yaml`. I re-derived the parameters, responses and enums of all 30 operations from the contract. The client (`api/p6.ts`) matches:
     - every required `organizationId` and `transformationId` gates its hook's `enabled`;
     - the paged lists use cursors;
     - the closed sets equal the contract enums (`SensitiveRecordType`, `UploadType`, `inlinePreviewTypes`, `NotificationChannelKind`, `WorkerHeartbeatStatus`);
     - the deep-link token pattern equals the `DeepLinkToken` parameter;
     - `safeInternalPath` matches `DeepLinkResolution.linkPath` (`^/[^/\\]`, at most 500 characters).
  2. **I found and fixed one gap.** §E/F.12 requires the Arabic texts to be "provisional and labelled so in the catalogue comments". The WIP labelled them only in a test-file header, and that header wrongly implied that the ADR-0053/0054 Arabic was not provisional (both ADRs title their Arabic column "Arabic (provisional)"). JSON cannot carry comments, so the label is now data beside the catalogues: `i18n/provisional-ar-p6.ts`, pointed to from `i18n/index.ts`. A new test binds it to the catalogue and to the ADR tables. See §1 (rows marked **[FE-AB]**) and §2 "Arabic".
  3. I re-swept the en catalogues for texts P6 makes untrue and added one item to recheck (§6, **[FE-AB]**).
  4. **I ran every acceptance check myself** (§3, rows marked **[FE-AB]**). The orphaned run's logs are kept unchanged as provenance. Its `integration.log` is **truncated**: it stops inside `request-io.test.ts` with no summary or exit code, because the restart cut it off. Its row 9 was therefore never a result, and my row replaces it.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → **exit 0**, `PASS gate DG5 (historical)`. Log: `T-DG6-FE-A-evidence/validate-historical-DG5.txt`.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/api/p6.ts` (new) | The P6 API client, all up front:<br>- `p6Keys` (scoped `["p6","admin",<area>,…]` and `["p6","sensitivity",tid,…]`), `isP6AdminKeyOf`, `useP6AdminRefresh`, `useP6SensitivityRefresh`.<br>- `p6Paths`: the request path of all 30 slice E/F/J/C operations, with the operationId in a comment.<br>- `P6_SLICE_EFJC_OPERATIONS`: (operationId, method, template) for the parity test.<br>- Read hooks for the GET operations.<br>- Closed sets (`SENSITIVE_RECORD_TYPES`, `UPLOAD_TYPES`, `INLINE_PREVIEW_TYPES`, `NOTIFICATION_CHANNEL_KINDS`), `DeepLinkResolution`, `DEEP_LINK_TOKEN` and `safeInternalPath` (a resolved link navigates only inside the app). |
| `apps/web/src/app/nav.ts` | - `P6SubPageId` and `P6_SUBPAGES`: Administration > Audit, Security, Sensitive grants, Operations, Identity, Storage, Notifications, each with `requiresAny` as a UI hint and owner FE-B.<br>- `P6_ADMIN_READ_PERMISSIONS`, added to the Administration area hint.<br>- `p6Feature` on `NavSubPage`.<br>- A header note. |
| `apps/web/src/app/router.tsx` | `P6_PLANNED_ROUTES` (16 routes) with the lazy `P6NotAvailablePage` placeholder, registered before the catch-all. They cover all FE-B screens, their detail paths and the deep-link landing `/l/:token`, which sits behind `RequireSession`. |
| `apps/web/src/components/P6NotAvailablePage.tsx` (new) | An honest "Not available yet" placeholder (`nav.p6.<feature>.*`). It loads no data and offers no action. |
| `apps/web/src/i18n/{en,ar}/nav.json` | `nav.sub.<id>` and `nav.contents.admin.<id>` for the 7 entries, plus `nav.p6.*` (title and summary for 16 placeholder features, `notAvailableTitle`, `notAvailableBody`). |
| `apps/web/src/i18n/{en,ar}/problems.json` | - 27 new problem keys, with `code` → `problems.<code with "." → "__">` (list in §2).<br>- `evidence__too_large` reworded so it no longer names a fixed 25 MB (F-DG4-160). |
| `apps/web/src/i18n/{en,ar}/access.json` (new) and `apps/web/src/i18n/index.ts` (2 imports, 2 catalogue lines) | The new `access` namespace for `access.includesRestrictedRecords` ("Includes restricted records" / "يشمل سجلات مقيدة"). See §6.1. |
| `apps/web/src/i18n/{en,ar}/myWork.json` (1 key each) | `myWork.message.inbox__restricted`. This is where the inbox renderer (`pages/my-work/messages.ts`) looks up the messageKey `inbox.restricted`. See §6.1. |
| `apps/web/src/app/p6-shell.test.tsx` (new) | Unit tests for the nav entries, the placeholder routes (en/ar), the 30-operation contract parity (method and path), path encoding, key scoping and `safeInternalPath`/token format. |
| `apps/web/src/i18n/problems-p6.test.ts` (new) | Unit tests over the refusal tables of ADR-0051 to ADR-0054, read from the ADR files (including indented and "job error" rows): en equals the ADR's English, ar equals the ADR's Arabic where given, no raw placeholder. Also the prose codes, `evidence.too_large`, and the two restricted texts through their real renderers.<br>**[FE-AB]** One added test, "labels every Arabic text of the P6 blocks provisional". Every entry of `P6_PROVISIONAL_ARABIC` must exist in the ar catalogue as Arabic. Every P6 refusal code (and its `_detail`) must be listed, as `"adr"` exactly when the ADR gives the Arabic, otherwise as `"fe-a"`. So must the prose codes and the 7 × 2 nav entries. The header was corrected: all P6 Arabic is provisional. |
| `apps/web/src/i18n/provisional-ar-p6.ts` (new, **[FE-AB]**) | The provisional-Arabic label that §E/F.12 asks for "in the catalogue comments": `P6_PROVISIONAL_ARABIC`, the catalogue path of every Arabic text the P6 shell added, with its source. `"adr"` is the ADR's own provisional Arabic (ADR-0053 §2, ADR-0054 §4). `"fe-a"` is Arabic written by FE-A (ADR-0051/0052 give English only; the restricted texts; the nav and placeholder texts). |
| `apps/web/src/i18n/index.ts` (**[FE-AB]**, 1 comment line) | Points from the catalogue registration to `provisional-ar-p6.ts`. |
| `apps/web/e2e/p6-shell.spec.ts` (new) | e2e on the real stack, en and ar:<br>- the 7 entries for `dev.admin`;<br>- each placeholder: heading, "Not available yet", `aria-current`, `dir`, axe (no serious or critical violation), screenshot, no P6 API request;<br>- `/l/:token` placeholder without a request to `/api/v1/links/`.<br>The budget statement is in the header (§3).<br>**[FE-AB]** Header comment only: it now cites both loaded measurements (4.6 s and 4.4 s). |
| `docs/delivery/handbacks/DG6/T-DG6-FE-A-*` | This handback and its evidence. |

No file under `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews, gates, `stages.json`, `findings.json` or `trading_agent/` was touched.

The untracked dotfiles at the worktree root (`.bashrc`, `.zshrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `CLAUDE.local.md`) were already there when the run started. They are not mine and must not be integrated.

## 2. Behaviour delivered

FE-A owns no requirement row on its own. Every slice E/F/J/C row lists FE-A only as the shell for FE-B (p6-work-split §E/F.14, §J/C.16), so none of those rows is complete through this task. What FE-A delivers toward each row:

| Requirement (acceptance quoted) | FE-A contribution | Status |
|---|---|---|
| REQ-S15-007 "a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable" | - Every new key exists in both catalogues: `i18n.test.ts` parity now walks the new `access` namespace too.<br>- Every P6 E/F/J/C refusal code renders through `problemText` in en and ar (`problems-p6.test.ts`).<br>- Export readability is not FE-A's work (FE-F, QA-D). | Partial (shell part) |
| REQ-S10-002 "…a sensitive benefit is hidden from a workstream member without the grant" | The `access.includesRestrictedRecords` text, Administration > Sensitive grants (entry and route), sensitivity paths and keys, the grant problem codes. The hiding is BE-B/BE-B2, the screens FE-B. | Shell only |
| REQ-S12-024 "a forwarded link opened by an unauthorized user returns 403 without leaking the record title" | - `deep_link.forbidden` en/ar.<br>- The `/l/:token` route (signed in; placeholder) and `useDeepLink`, which never sends a malformed token.<br>- `safeInternalPath` refuses `//host`, backslash, scheme and control-character paths.<br>- The `inbox.restricted` text through the real inbox renderer. | Shell only |
| REQ-S13-011 "an .exe or an oversized file is rejected; an SVG with script is not executed in preview" | - `evidence.type_not_allowed`, `.type_mismatch`, `.preview_unavailable`, `.too_large` (+ `_detail`).<br>- `p6Paths.evidencePreview`, documented as an `<img>` source only.<br>- `INLINE_PREVIEW_TYPES` = png, jpeg, gif (never svg). | Shell only |
| REQ-S16-032 "each mutation test asserts one audit event with prior and new version; an UPDATE on the audit table by the application role fails" | Administration > Audit (entry and route, read-only), the audit paths, keys and hooks. | Shell only |
| REQ-S12-019 "a failing test connector produces one exception and the KPI shows Stale with its last value and date" | - Administration > Operations, plus routes for the exception detail and service identities.<br>- The operations and service-identity codes (Arabic exactly as ADR-0053 §2).<br>- The heartbeat hook documents that `unknown`/`stale` are never "alive". | Shell only |
| REQ-S12-023 "with no email adapter configured all workflows complete and notifications appear in the inbox" | Administration > Notifications, plus routes for the channel detail and deliveries; the channel codes (Arabic exactly as ADR-0054 §4). | Shell only |
| REQ-S16-006 "contract tests pass for both adapters; evidence is never served from a public URL" | Administration > Storage, the storage codes, the storage paths and hooks. | Shell only |
| REQ-S16-007 "e2e tests log in through the Keycloak test realm; a token from another realm is rejected" | Administration > Identity (its summary states that the client secret is never shown), the identity path and hook. | Shell only |

### Problem codes added (`problems.json`, en/ar)

- **ADR-0051:** `sensitive_grant.not_self`, `.grantee_not_in_organization`, `.duplicate`, `sensitivity.reason_required`, `deep_link.forbidden`, `evidence.parent_forbidden`.
- **ADR-0052:** `evidence.type_not_allowed` (+`_detail`), `evidence.type_mismatch` (+`_detail`), `evidence.too_large_detail`, `evidence.preview_unavailable`.
- **ADR-0053 §2:** `operations.exception_not_open`, `.exception_resolved`, `.note_required`, `service_identity.grant_exceeds_declaration`, `.reason_required`, `.out_of_scope`, `.missing`.
- **ADR-0054 §4:** `storage.s3_incomplete`, `.secret_ref_invalid`, `.test_required`, `notification_channel.email_incomplete`, `.adapter_unavailable`, `.insecure_transport`, `.not_configured`, `.no_recipient_address`, `admin.reason_required`.

Codes that already existed and keep their generic texts: `invalid_transition`, `not_found`, `forbidden`, `unavailable`, and `auth.errors.token_invalid` for sign-in.

### Placeholders, not delivered screens

Every P6 route shows "Not available yet" / "غير متاح بعد". It loads no data, which the e2e asserts: no request to any P6 path. Nothing is presented as delivered. FE-B replaces each element and removes its entry from `P6_PLANNED_ROUTES`.

### Arabic

**[FE-AB, corrected]** **All** Arabic added by the P6 shell is **provisional** and awaits a Mobily language review. That includes the ADR-0053/0054 Arabic, which is used verbatim and asserted by the test, because both ADRs label their Arabic column "(provisional)". The rest was written by FE-A: the Arabic for the ADR-0051/0052 codes, the two restricted texts and all nav and placeholder texts.

JSON cannot carry comments, so the label is `apps/web/src/i18n/provisional-ar-p6.ts`, and `i18n/index.ts` points to it. The test "labels every Arabic text of the P6 blocks provisional" fails if a P6 key is missing from it, or if the recorded source (ADR or FE-A) disagrees with the ADR tables. When a reviewed translation lands, its entry is removed in the same change.

## 3. Checks actually run (logs in `T-DG6-FE-A-evidence/`)

### 3.1 The orphaned run's checks (T-DG6-FE-A; kept as provenance, superseded by §3.2)

These rows are the orphaned run's own report. Its tree differs from the final one by the **[FE-AB]** changes, and its last checks were not confirmed before the restart, so §3.2 is the result of record. Row 9 never produced a result: its log ends mid-file, with no summary and no exit code.

Node 24.21.0, offline. Harness ports: PostgreSQL 23900, API 23901, pool 23902–23949. Empty `.claude/.cc-writes` directories in source folders were removed before testing.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | PASS gate DG5 (historical) | `validate-historical-DG5.txt` |
| 2 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages | `build.log` |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 876 operations (unchanged) | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`; the shell had `LC_CTYPE=C.UTF-8`) | 0 | unit-node 153 files / **2398 passed**; unit-web 96 files / **1767 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** | `test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical: 2398; 1767; 259 + 2 skipped | `test-c-utf8.log` |
| 9 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh pnpm test:integration` | none (cut off by the restart) | **no result**: the log is truncated (see §3.2 row 9) | `integration.log` |
| 10 | `E2E_PG_PORT=23900 E2E_API_PORT=23901 MTH_PORT_POOL=23902-23949 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-shell.spec.ts apps/web/e2e/p5-shell.spec.ts --workers=1` | 0 | **42 passed** (P6: 9 tests × en/ar = 18; P5 shell regression: 12 × 2 = 24) | `e2e-p6-shell.log` |

**About rows 7 and 8.**

- The 2 skipped tests are the existing `it.skipIf(NOCODEGEN)` cases in `packages/shared/src/formula/fuzz.test.ts` (lines 600 and 833). They are skipped by design in the no-codegen project and are not mine.
- No test failed and none was retried.
- The unit-web count includes the 21 new tests: 12 in `app/p6-shell.test.tsx` and 9 in `i18n/problems-p6.test.ts`.
- The last minute of row 8 (unit-formula-nocodegen) overlapped the start of row 9.

**e2e budget (F-DG5-145/146/151).** The e2e (row 10) ran while `pnpm -r typecheck` (row 2) ran in parallel on the same host, as a CPU load. The slowest P6 test under that load took **4.6 s** (`/l/:token`, ar); the slowest Administration placeholder took 3.8 s. The default 30 s budget is kept: that is more than 6× the loaded worst case, so it meets "at least 2×".

### 3.2 [FE-AB] Checks run in this continuation (the result of record)

Final tree: `eecd4ad` plus the **[FE-AB]** changes. Node 24.21.0, offline. Ports: PostgreSQL 23900, API 23901, pool 23901/23902–23949. Before testing, I removed the empty `.claude/.cc-writes` directories (and their empty `.claude` parents) under `apps/web/`, `apps/web/src/` and `apps/web/src/i18n/{,en/}`. My tool writes had created them.

| # | Command | Exit | Result | Log (`T-DG6-FE-A-evidence/`) |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` | `fe-ab-validate-historical-DG5.txt` |
| 2 | `pnpm -r typecheck` | **0** | all packages | `fe-ab-typecheck.log` |
| 3 | `pnpm -r build` | **0** | all packages | `fe-ab-build.log` |
| 4 | `pnpm lint` | **0** | `eslint . --max-warnings=0`, clean | `fe-ab-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!". Rerun after the last edit to this handback. | `fe-ab-prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | PASS, OpenAPI 3.1.1, **876** operations (unchanged) | `fe-ab-openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **0** | unit-node 153 files / **2398** passed; unit-web 96 files / **1768** passed; unit-formula-nocodegen 3 files / **259** passed, 2 skipped | `fe-ab-test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | identical: 2398; 1768; 259 + 2 skipped | `fe-ab-test-c-utf8.log` |
| 9 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **322 files; 3113 passed, 1 skipped (3114)**; ran 22:27 to 23:22:49 UTC | `fe-ab-integration.log` |
| 10 | `E2E_SCREENSHOT_DIR=…/screenshots-fe-ab E2E_PG_PORT=23900 E2E_API_PORT=23901 MTH_PORT_POOL=23902-23949 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-shell.spec.ts --workers=1` | **0** | **18 passed** (9 tests × en/ar) in 1.3 min | `fe-ab-e2e-p6-shell.log` |

**Disclosures:**

- **Unit-web is 1768**, one more than the orphaned run's 1767. The extra test is the provisional-label test.
- **The skipped tests:**
  - The 2 skips are the existing `it.skipIf(NOCODEGEN)` cases in `packages/shared/src/formula/fuzz.test.ts`.
  - The integration skip is the existing `it.runIf(hasMeetingPackAssembler)` / `it.runIf(!…)` pair in `apps/api/test/integration/governance/presentation.test.ts` (DG5): exactly one branch runs, by design.
  - None of these is mine.
- **No failure, retry or timeout.** The only "retry" matches in the logs are test names. Rows 7–9 ran sequentially, each alone.
- **Pinned counts:** `contract.test.ts` still pins 876 operations, and FE-A changes no operation, media type or rate-limit floor. Delta: none.
- **e2e budget.** Row 10 ran with the repository-wide prettier check (row 5) in parallel as CPU load, during its first part. The slowest tests took **4.4 s**: `/l/:token` (en) and the Administration entries list (en). The spec keeps the default 30 s, more than 6× that worst case, and its header now cites this log as well. I did not rerun the P5 shell regression spec (`p5-shell.spec.ts`), because FE-AB changes no rendered UI.
- **Screenshots** (fresh, this run): `T-DG6-FE-A-evidence/screenshots-fe-ab/{en,ar}/p6-admin-nav.png` and `p6-placeholder-{audit,security,sensitiveGrants,operations,identity,storage,notifications,deep-link}.png`, 18 in total. I inspected two:
  - `ar/p6-placeholder-sensitiveGrants.png`: RTL, the nav on the right with the active entry marked, "غير متاح بعد", and the provisional wordmark "مؤقت".
  - `en/p6-admin-nav.png`: the seven entries under Administration.
- **Time:** `date -u` at the end is in `fe-ab-end.txt`. It was **2026-10-26 23:26:48 UTC**, 103 minutes after the 21:44:11 start. Typecheck (row 2) ran after the last code change. The only later edit is a comment in the e2e spec, which the final lint and prettier runs (rows 4 and 5, rerun at the end) cover.

### Interaction checks run in the e2e (en and ar)

- Sign in as `dev.admin` and read the 7 Administration links and their `href`s.
- Click each one: the URL, the `h1`, the "Not available yet" state and `aria-current="page"` on the link are checked.
- `<html dir>` is `rtl` in Arabic and `ltr` in English.
- axe (WCAG 2.0/2.1 A and AA) finds no serious or critical violation on any page.
- No DG0–DG7 text appears, and no P6 API request or foreign-origin request is sent.
- `/l/<well-formed token>` as `dev.office`: the placeholder shows and no request goes to `/api/v1/links/`.

### Screenshots (`T-DG6-FE-A-evidence/screenshots/{en,ar}/`)

- `p6-admin-nav.png`
- `p6-placeholder-{audit,security,sensitiveGrants,operations,identity,storage,notifications,deep-link}.png`

That is 9 per language, 18 in total. I inspected `ar/p6-placeholder-operations.png` (RTL, nav on the right, active entry marked, provisional wordmark) and `en/p6-placeholder-audit.png`.

## 4. Operations routed, and the contract-test delta

- **None.** FE-A routes no API operation and owns no `p6-pending-*.ts` or `p6-exercises-*.ts` file.
- Pending-list delta: none. Pinned-count delta in `contract.test.ts`: none (operation count stays 876).
- The `P6_SLICE_EFJC_OPERATIONS` parity test reads `apps/api/test/support/p6-operations.ts` (ARCH-01 and ARCH-02 blocks, 30 ids) and `docs/api/openapi.yaml`. It checks each operation's method and path template.

## 5. Needs for the orchestrator (contract, schema, files outside FE-A's list, dependencies)

1. **The server navigation catalogue** (`apps/api/src/modules/identity/navigation.ts`, ADR-0049 §9; not FE-A's file).
   - **Problem:** the shell shows only the areas `GET /me/navigation` returns. The Administration area therefore appears only for callers who hold one of its P5 items. An AUD, KDS, TD or TO user who holds only P6 read permissions does **not** see Administration, so none of the P6 entries is reachable from their navigation (the routes still work by URL).
   - **Request:** append these items to the `administration` area, with labels `nav.contents.admin.<code>`, which already exist in en/ar:

     | code | path | access |
     |---|---|---|
     | `audit` | `/admin/audit` | `audit_event.read` |
     | `security` | `/admin/security` | `security.read`, `upload_policy.configure` |
     | `sensitiveGrants` | `/admin/sensitive-grants` | `sensitive_record.read`, `sensitive_record.grant` |
     | `operations` | `/admin/operations` | `operations.read`, `service_identity.configure` |
     | `identity` | `/admin/identity` | `identity.read` |
     | `storage` | `/admin/storage` | `storage.configure` |
     | `notifications` | `/admin/notification-channels` | `notification_channel.configure` |

   - `pages/admin/AdminHomePage.tsx` (FE-B or the orchestrator) shows "no permission" to a user who has neither an `ADMIN_PERMISSIONS` code nor a server admin item. It needs the same items, or a P6 card.
2. **Web permission mirror** (`apps/web/src/auth/permissions.ts`, `STRUCTURAL`; not FE-A's file). BE-B adds `sensitive_record.grant` and `sensitive_record.read` to the API's `STRUCTURAL_PERMISSIONS` (§E/F.2). The web mirror should gain the same two lines, so the `canOn` UI hint matches the server.
3. **Problem `params` for three ADR-0052 §1 codes** (BE-D, contract).
   - The ADR texts carry `{allowedTypes}`, `{extension}` and `{maxBytes}`, but the contract defines no `params` for these problems. The catalogue therefore renders the ADR sentence without the value clause, and provides `<key>_detail` with `{{…}}` for screens that know the value (the policy from `getUploadPolicy`, the chosen file).
   - If BE-D adds `params`, the orchestrator can switch these keys to the ADR-0038 Q1 `{{…}}` + `_noParams` pattern. Before that, `lib/problem.ts` `fieldErrorMessage` must be routed through `problemText`, because it calls `t()` directly and would show a raw `{{maxBytes}}`.
4. **No migration, no new dependency, no contract change** from FE-A.

## 6. User-facing texts this work makes untrue, and what was done

- **`problems.evidence__too_large`** (en/ar) said "(25 MB)". A narrowed upload policy (ADR-0052 §1, BE-D) makes that untrue. **Fixed** in both languages: "The file is larger than the upload limit of your organization." / "حجم الملف أكبر من حد الرفع المسموح في مؤسستك.", plus `_detail` with `{{maxBytes}}`.
- **`evidence.upload.hint`** (en "Up to 25 MB." / ar "حتى 25 ميغابايت.") in `i18n/{en,ar}/evidence.json`, and the hard-coded `MAX_UPLOAD_BYTES = 25 MiB` in `pages/evidence/EvidencePage.tsx`. These become untrue when BE-D ships the policy. **Not FE-A's files: listed for FE-B or the evidence-page owner.** The hint should show the effective policy (`useUploadPolicy`: types and `maxBytes`), and the local pre-check should use the policy's `maxBytes`.
- **`admin.plannedSections`** (`admin.json`) lists the configuration screens "available in this release". It is still true today, because no P6 screen is delivered yet. FE-B must add the P6 screens to it when they ship.
- The sweep of all en catalogues for planned, later and not-available texts mentioning audit, security, storage, identity, notifications, email, uploads, sensitivity, links or operations found nothing else. `nav.portfolioPlanned` (the cross-portfolio view) belongs to slice H.
- **[FE-AB] Re-sweep.** I grepped every en catalogue for planned, not available, not yet, later or future release, coming soon, P6, e-mail, 25 MB, in-app, channel, messaging, preview, sensitive and restricted. It confirms the items above and adds one item to recheck. It is not untrue today:
  - **`workflowsP5.digestHint`** ("Non-urgent notifications are collected into one in-app digest.", `i18n/{en,ar}/workflowsP5.json`, not FE-A's file).
  - ADR-0054 §3 item 6 fans channel notifications out "when released", respecting the P5 digest policy. When BE-I2 ships email fan-out, the digest may also go to email, and "in-app" alone would then understate it.
  - **For the owner of the notification-preferences screen (FE-B or BE-I2's FE counterpart):** recheck it then.

### 6.1 Two files beyond the FE-A list, disclosed

The section requires the texts `access.includesRestrictedRecords` and `inbox.restricted` from FE-A, and neither key can work from `nav.json` or `problems.json`:

- `access.*` needs an `access` namespace: new `i18n/{en,ar}/access.json`, plus 2 imports and 2 catalogue lines in `i18n/index.ts`.
- The inbox resolves a messageKey as `myWork.message.<key>`: one key in each `i18n/{en,ar}/myWork.json`.

All of these changes are additive. If the orchestrator prefers another owner for these lines, they can move unchanged.

## 7. What remains

FE-A has no separable second half in §E/F.12 or §J/C.13.

1. **The FE-A row of p6-plan §5.1 for the other slices** (A, B, D, G, H, I, K). Their contracts are not in this revision: ARCH-03 (slices B and A) is running in parallel, and ARCH-04 to ARCH-06 have not run. Their remaining shell pieces are:
   - the routes, query keys and API entries;
   - the i18n blocks;
   - the shell slots: the global search box (slice H, ADR-0057), breadcrumbs (FE-D owns `components/breadcrumbs/**`) and the assistant panel "hidden when disabled" (slice D, ADR-0059).

   These need a later FE-A run (FE-A2) once each ARCH section exists. Nothing was guessed ahead of a contract.
2. **The FE-B screens** behind all 16 placeholder routes, including the sensitivity panel, the evidence preview and the restricted-records label component.
3. **The items in §5** (server navigation catalogue, web `STRUCTURAL` mirror, problem `params`) and **§6** (evidence upload hint, `admin.plannedSections`, and **[FE-AB]** the `workflowsP5.digestHint` recheck).
4. **[FE-AB]** A Mobily language review of every Arabic text listed in `i18n/provisional-ar-p6.ts`. Until then they stay labelled provisional.

## 8. Merge instructions

- No migration and no ordering constraint against BE-B or BE-E: there are no shared files.
- Conflicts are possible with ARCH-03 only if it edits `apps/web/**`, which its section does not list.
- `i18n/{en,ar}/problems.json` and `nav.json` are appended at the end of their objects (`problems`; `nav.sub`, `nav.contents.admin` and the new `nav.p6`). Later FE tasks append after these lines.
- Do not stage the untracked root dotfiles listed in §1. They are environment files, not part of this task. I did not delete them.
