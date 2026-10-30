# Handback: T-DG6-FE-B (frontend-ux-engineer), the P6 screens of slices E, F, J and C

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. This is engineering delivery-gate work only. No product gate G1–G6 was granted, and no business, Finance or IT approval was given or implied. All e2e and test data is SYNTHETIC.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-B.md` (sha256 `18b8a176c756b08275d7d67ee9ece3b19d30d130e9859b3fc2e04f9e5a7fa4c7`, verified at start).
- **Invocation:** `DG6-T-DG6-FE-B-frontend-ux-engineer-20261030T152311Z-2a9e911b`, session `2a9e911b-8123-45d4-bddd-e2b1162a8c9b`.
- **Base:** branch `dg6/fe-b`, `HEAD` `12a1c5903fe60d94a5dcb82d443a04ba69c5b97b`. The changes are left **uncommitted**, as instructed.
- **Scope:** p6-work-split §E/F.12 (FE-B bullet) and §J/C.13 (FE-B bullet); D-196 item 6 (the ownership extension); D-198 follow-ups for FE-B (the web permission mirror; `AdminHomePage`).
- **Time:** `date -u` at start: 2026-10-30 15:23:27 UTC; at end about 17:25 UTC (`T-DG6-FE-B-evidence/end.txt`), about 2 hours. I passed the 100-minute mark while waiting for the test runs, and stopped after recording them.
- **Migrations:** none. **New dependency:** none.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → **exit 0**, `PASS gate DG5 (historical)` (`T-DG6-FE-B-evidence/validate-dg5-historical.txt`).

## 1. Changed files

### New

| File | Purpose |
|---|---|
| `apps/web/src/pages/admin/security/shared.tsx` | Shared UI for the P6 admin screens: home-organization id, `useCan` hint, read-only and not-an-approval notes, reason field (the shared `reason` rule plus the blank-text rule), cursor pager (one page at a time, never "all pages"), `Fact`/`Code`, SecretRef inputs (provider + name only; there is no field for a secret value), and the page-level "Saved" notice. |
| `apps/web/src/pages/admin/security/SecurityPage.tsx` | Administration > Security: the rate-limit classes (`getSecurityRateLimits`), read-only, with a link to the upload policy. |
| `apps/web/src/pages/admin/upload-policy/UploadPolicyPage.tsx` | Upload policy: the effective policy (default or saved), and `putUploadPolicy` for `upload_policy.configure` holders. The save uses If-Match (`"0"` creates the row), the required `organizationId` query and a reason. Everyone else sees it read-only. |
| `apps/web/src/pages/admin/audit/AuditPages.tsx` | Administration > Audit: `listAuditEvents` with the contract filters (transformation, record type, action, date range), validated by the zod `auditEventListQuery` before sending, plus cursor paging. `getAuditEvent` shows the detail with the field changes. A redacted event shows "Redacted", never a reason. No write control exists. |
| `apps/web/src/pages/admin/sensitive-grants/SensitiveGrantsPages.tsx` | Sensitive grants: the list for one transformation (required by the contract), with status and record-type filters; the grant detail; revoke with a reason and If-Match. A redacted title shows "Restricted record". |
| `apps/web/src/pages/deep-link/DeepLinkPage.tsx` | `/l/:token`: resolves the link and navigates only to a `safeInternalPath`. A 403 shows only the `deep_link.forbidden` text. A malformed token is never sent. An unsafe `linkPath` is refused. Navigation is session-bound. |
| `apps/web/src/pages/admin/operations/OperationsPages.tsx` | Operations: the worker heartbeat (`alive`/`stale`/`unknown`, each with icon and text; never "Running" unless the API says `alive`) and the exceptions list (status filter sent as repeated `status` parameters). The exception detail shows linked KPIs with their DG4 freshness label, last value as the server's decimal string (null shows Unknown, never 0), the value date, the count of hidden KPIs, and the history. Acknowledge and resolve use If-Match (resolve needs a note). A resolved exception is final and offers no action. |
| `apps/web/src/pages/admin/service-identities/ServiceIdentitiesPages.tsx` | Service identities: the list and the detail. `putServiceIdentity` offers only the declared codes (narrow or restore), with a reason and If-Match. |
| `apps/web/src/pages/admin/identity/IdentityPage.tsx` | Identity: `getIdentitySettings`, read-only. Shows "Configured (never shown)" for the client secret, the accepted issuer and audience, PKCE, the claim mapping, the SAML broker document path, and an honest residual note. |
| `apps/web/src/pages/admin/storage/StoragePage.tsx` | Storage: the effective store; "Public URLs: Never"; a test (`testStorageSetting`, per-check results); a save (`putStorageSetting`, If-Match/`"0"`, reason); S3 credentials as SecretRefs. Readers with only `operations.read` (the auditor) see it read-only. |
| `apps/web/src/pages/admin/notification-channels/NotificationChannelsPages.tsx` | Notifications: an "in-app always" note; both channel kinds, with "Not configured" for one never saved. Email SMTP form: SecretRef credentials, a pair check, If-Match/`"0"`, `organizationId` query, reason. A test message goes to "self". Enterprise messaging is shown as "Not available in this release" and has no form. Readers see the channels read-only. A deliveries list is included (see §5). |
| `apps/web/src/components/sensitivity/SensitivityPanel.tsx` | The record's access-restriction panel. Mark or unmark with a reason (`putRecordSensitivity`, If-Match/`"0"`, refresh on 409). The active grants of the record, each revocable. Grant to a team member with a reason. Read-only when `canManage` is false. Renders nothing when the record is not readable. |
| `apps/web/src/components/sensitivity/RestrictedRecordsLabel.tsx` | "Includes restricted records": a lock icon, text and a screen-reader explanation. Shown only for `includesRestrictedRecords === true`. |
| `apps/web/src/components/evidence-preview/EvidencePreview.tsx` | The safe preview: an `<img>` of the preview route for `.png/.jpg/.jpeg/.gif` only. On any error it falls back to "Download". Every other type, SVG included, gets an icon and "Download". Never an `<iframe>`, `<object>` or `<embed>`. Also `EvidencePreviewAction`, the evidence row action "Preview and access": a dialog with the preview and the sensitivity panel. |
| `apps/web/src/i18n/{en,ar}/adminP6.json` | All texts of these screens, en and ar. The Arabic is provisional. |
| `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx` | 33 unit tests (en and ar); see §2. |
| `apps/web/e2e/p6-admin-screens.spec.ts` | e2e on the real stack, en and ar. The 60 s budget is stated in the header (§3). |

### Modified

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | 16 lazy routes registered (audit ×2, security, upload-policy, sensitive-grants ×2, `l/:token`, operations ×2, service-identities ×2, identity, storage, notification-channels ×2, notification-deliveries). `P6_PLANNED_ROUTES` is now `[]`: an empty, tested seam, like P4/P5. |
| `apps/web/src/auth/permissions.ts` | The web mirror of the two structural codes `sensitive_record.grant` and `sensitive_record.read` (D-198 follow-up; equals `access/rules.ts`). |
| `apps/web/src/i18n/index.ts` | Registers the `adminP6` namespace (2 imports, 2 catalogue lines). |
| `apps/web/src/i18n/provisional-ar-p6.ts` | Adds the source `"fe-b"` and the entry `"adminP6."`: all FE-B Arabic is labelled provisional. |
| `apps/web/src/pages/benefits/BenefitPage.tsx` | One named line: `<SensitivityPanel recordType="benefit">`. |
| `apps/web/src/pages/business-cases/BusinessCasePage.tsx` | One named line: `<SensitivityPanel recordType="business_case">`. |
| `apps/web/src/pages/evidence/EvidencePage.tsx` | One named line in the actions cell: `<EvidencePreviewAction>` (the evidence register has no detail page; the dialog is its detail view). |
| `apps/web/src/pages/benefits/Totals.tsx`, `pages/dashboards/{TransformationDashboardPage,DashboardsPage,ui}.tsx` | One `<RestrictedRecordsLabel>` line each: benefit totals, transformation and workstream dashboards, finance dashboard, drill-down. |
| `apps/web/src/app/p6-shell.test.tsx` (FE-A's) | The placeholder assertions are replaced: every FE-B route is a real route before the catch-all, `P6_PLANNED_ROUTES` is `[]`, `/admin/audit` requests the audit API, and `/l/:token` resolves. |
| `apps/web/e2e/p6-shell.spec.ts` (FE-A's) | The placeholder tests are replaced by "each entry opens its screen, not a placeholder". |

No file under `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews, gates, `stages.json`, `findings.json` or `trading_agent/` was touched. The untracked dotfiles at the worktree root (`.bashrc`, `.idea`, …) were there before the run and are not mine.

## 2. Behaviour delivered, per requirement row

FE-B is a co-owner of each row. The server-side proof belongs to the BE tasks named in p6-work-split §E/F.14 and §J/C.16. What the UI now does, and what the tests check:

| Requirement (acceptance quoted) | Delivered by FE-B | Tests |
|---|---|---|
| **REQ-S10-002** "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant" | - The sensitivity panel on benefit, business-case and evidence views: mark/unmark with a reason and If-Match, grant, revoke. It is read-only without `canManage` and shows nothing when the record is unreadable.<br>- Sensitive grants admin (list, detail, revoke; redacted titles).<br>- "Includes restricted records" on the benefit totals, three dashboards and the drill-down.<br>- The web permission mirror.<br>- The hiding itself is server-side (BE-B/B2). | Unit: mark sends PUT with `If-Match "0"` and body; a reader sees status only, no buttons, no reason, no grant request (en/ar); 404 renders nothing; the label shows only for `true` (en/ar). e2e: sensitive-grants screen (axe, en/ar). |
| **REQ-S12-024** "A12: a forwarded link opened by an unauthorized user returns 403 without leaking the record title" | `/l/:token`. A 403 shows only the translated `deep_link.forbidden` text, adding nothing of the target. A malformed token is never sent. An unsafe path (`//evil…`) is not followed. An authorized link navigates in-app. | Unit: 403 (en/ar), malformed (no request), authorized navigates to `/admin/security`, unsafe stays. e2e: an unknown well-formed token against the real API → `deep-link-forbidden` with the text (en/ar, axe). |
| **REQ-S13-011** "A12: an .exe or an oversized file is rejected; an SVG with script is not executed in preview" | - The preview is an `<img>` for raster files only. SVG/PDF and any other type is download-only (the download stays the API's `attachment`). Never an iframe/object/embed.<br>- Upload policy admin (types, MiB limit, reason).<br>- The rejection of `.exe`/oversized files is server-side (BE-D); its codes are translated (FE-A). | Unit: PNG `<img>` src equals the preview route; `onError` falls back to Download; `drawing.svg`, `report.pdf` and `tool.exe.png.svg` give no `<img>` and no iframe/object/embed, and the link has `download`. Upload policy: auditor read-only; admin PUT body, `If-Match "0"` and the `organizationId` query; 409 alert and reload. e2e: the admin narrows the limit; it persists after a reload (en 20 MiB, ar 21 MiB). |
| **REQ-S16-032** "A07;A12: each mutation test asserts one audit event with prior and new version; an UPDATE on the audit table by the application role fails" | Administration > Audit (read-only, filters, paging, detail with changes, Redacted). The audit-event assertions per mutation are server-side (BE-E/BE-F). | Unit: redacted vs normal (en/ar), no non-GET request, cursor follows `nextCursor`, an invalid filter gives an alert and sends nothing, the detail shows changes. e2e: after the upload-policy save, `upload_policy.changed` with "created → 1" and the reason appears in Audit; the auditor reads Audit with no save control. |
| **REQ-S12-019** "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date" | Operations: the heartbeat, exceptions, the detail with linked KPIs (Stale label, last value as a decimal string, date; null shows Unknown, never 0), acknowledge/resolve with If-Match, final when resolved. The exception creation is BE-K/K2/L. | Unit: `unknown` heartbeat shown as Unknown, not the on-track tone (en/ar); repeated `status` params; KPI rows "12.5"+Stale and Unknown (no 0); hidden-KPI count; acknowledge `If-Match "4"`, body `{note:null}`; resolved offers no action. e2e: no worker runs in the stack, and the heartbeat is never `alive`/"Running" (en/ar). |
| **REQ-S12-023** "A21: with no email adapter configured all workflows complete and notifications appear in the inbox" | Notifications admin: the in-app-always note, "Not configured", the email SMTP form (SecretRefs), a test to self, and enterprise messaging "Not available in this release" with no form. The A21 behaviour itself is BE-I/I2. | Unit (en/ar): the in-app note, enterprise messaging unavailable, no email form on its page. e2e: notifications screen (axe, en/ar). |
| **REQ-S16-006** "A18;A12: contract tests pass for both adapters; evidence is never served from a public URL" | Storage admin: "Public URLs: Never…", the test result per check (including "Anonymous read refused"), SecretRef credentials only, read-only for readers. | Unit: the test body is exactly the S3 input with refs; no secret-value field; auditor read-only. e2e: storage (admin, axe) and auditor read-only (no form, no write request). |
| **REQ-S16-007** "A18;A12: e2e tests log in through the Keycloak test realm; a token from another realm is rejected" | Identity admin, read-only: the issuer ("a token from any other issuer or realm is refused"), "Configured (never shown)" for the secret, the SAML broker document, and the residual note. The Keycloak e2e is DO-B's (BLOCKED without a container runtime, per D-197). | Unit: no input/textarea; secret status text. e2e: identity (axe, en/ar). |

**Shared rules (§2).** These rules are met as follows:

- **One form-level alert per form.** It comes from `useRunner`.
- **Every write uses If-Match from the record the user saw, and is session-bound.** This covers `useRunner`, `ReasonDialog` and `useSessionNavigate`.
- **The AUD user sees every page read-only.** The exceptions:
  - pages whose server read the auditor's role lacks show the server's 403 as the no-permission state (sensitive grants: `sensitive_record.read` is held by AUD, so it reads);
  - Storage and Notifications are read by AUD through `operations.read`, and I made them read-only after the e2e run found this (see §3, run 1).
- **The label "business approval" is used; DG0–DG7 are never shown.** The e2e asserts that no `DG[0-7]` text appears.
- **Statuses always carry a text label and an icon. Unknown/Stale is never green.**
- **Decimal strings are shown as sent.**

## 3. Checks actually run (logs in `T-DG6-FE-B-evidence/`)

Node 24.21.0, offline. Harness ports: integration PostgreSQL 25950, pool 25951–25969; e2e PostgreSQL 25975, API 25976, pool 25977–25999. Empty `.claude/.cc-writes` directories in source folders were removed before testing.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | PASS gate DG5 (historical) | `validate-dg5-historical.txt` |
| 2 | `pnpm -r typecheck` | **0** | all packages | `typecheck.log` |
| 3 | `pnpm -r build` | **0** | all packages | `build.log` (first build; rebuilt twice more before the e2e runs, both exit 0) |
| 4 | `pnpm lint` | **0** | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | PASS, OpenAPI 3.1.1, 932 operations (unchanged; FE-B changes no contract) | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **0** | unit-node 177 files / **2726** passed; unit-web 100 files / **1822** passed; unit-formula-nocodegen 3 files / **259** passed, 2 skipped | `test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | every test passed: unit-node 177 files / **2726**; unit-web 100 / **1822**; nocodegen 3 / **259** + 2 skipped. The exit 1 is one **unhandled Vitest error** in unit-node, `[vitest-worker]: Timeout calling "onTaskUpdate"` (an RPC timeout, not a test). See the disclosure below. | `test-c-utf8.log`; `test-c-utf8-unit-node-rerun.log`; `test-c-utf8-architecture-alone.log` |
| 9 | `QA_PG_PORT=25950 MTH_PORT_POOL=25951-25969 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **No complete result.** The single integration fork died after about 300 files (`Error: Channel closed`, `ERR_IPC_CHANNEL_CLOSED`, tinypool), so there is no summary and no counts. Before that, 4 tests failed (all API; see below). | `integration.log`; `integration-run1-killed-at-30min.log` |
| 10 | `E2E_SCREENSHOT_DIR=…/screenshots E2E_PG_PORT=25975 E2E_API_PORT=25976 MTH_PORT_POOL=25977-25999 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-admin-screens.spec.ts apps/web/e2e/p6-shell.spec.ts --workers=1` | **0** | **42 passed** (21 tests × en/ar) in 2.5 min | `e2e-p6.log` |

**Disclosures**

- **Row 8 is not a clean pass.**
  - The full C.UTF-8 run had all 4807 tests passing but exited 1 on the worker RPC timeout, while the integration suite (row 9) was loading the host.
  - I reran unit-node alone under C.UTF-8 (`test-c-utf8-unit-node-rerun.log`, exit 1), still under the same load. It had 2725 passed and 1 failed: `apps/api/src/architecture.test.ts` › "apps/web never imports @mth/db or @mth/config" **timed out at 30 s**, with two more RPC timeouts.
  - That test scans the web source, so it is relevant to my change. Run alone under C.UTF-8 (`test-c-utf8-architecture-alone.log`), it **passed: exit 0, 141/141**, that test in 11.5 s.
  - With the locale unset (row 7), the same test passed in the full run.
  - I attribute the timeouts to host load; the scan itself passes. The orchestrator should rerun row 8 on the merged tree without concurrent suites.
- **Row 9 has no result, and I cannot claim it passed.** The rerun ran concurrently with my e2e and unit runs. Its single fork crashed with `ERR_IPC_CHANNEL_CLOSED` near the end, so there is no summary. Before the crash, four API tests failed. FE-B changed no file under `apps/api`, `apps/worker` or `packages`, and the integration suite contains no web code. I did not investigate them further and did not rerun them alone (the time limit). They are reported here, not explained away:
  - `the rate-limit class assistant and the log line > over the per-minute budget a post is 429 with Retry-After…`
  - `every operation, validated against the contract and the zod mirrors > P5 BE-J operations (p5-exercises-be-j.ts)`
  - `… > every operation: an undeclared request media type is a declared 400 validation.content_type` (a 30 s timeout)
  - `getSecurityRateLimits > ADM_TECH and AUD read every class with its configured budget, key and operations`

  The two `response-validation` cases match the load-attributed pair of D-201. **The orchestrator must run row 9 on the merged tree.** Pinned-count change from FE-B: none.

- **The 2 skips in rows 7 and 8** are the existing `it.skipIf(NOCODEGEN)` cases in `packages/shared/src/formula/fuzz.test.ts`. They are not mine.
- **Row 9, first attempt.** It was started in the background with the tool's default 30-minute background limit and was **killed** at that limit, partway through. Its log is kept as `integration-run1-killed-at-30min.log`; it has no summary and no exit code, so it is **not a result**. Row 9 is the rerun.
- **Row 9 concurrency.** The integration suite runs only `apps/*/test/integration`, `packages/*/test/integration` and `tests/qa/integration`. None of these contain web code, and this task changed no API, worker or package file. The rerun started while my web edits were still in progress and ran concurrently with rows 2–8 and 10, so it ran under load.
- **Row 10 history.**
  - **Run 1** (`e2e-p6-run1.log`, exit 1): 40 passed, 2 failed. Both failures were "auditor gets no-permission on Storage". They were a real defect in my assumption: the API grants `getStorageSetting` and the channel reads to `operations.read`, which AUD holds. I fixed both pages to be read-only for readers, and changed the unit test and the e2e to assert read-only.
  - **Run 2** (`e2e-p6-run2.log`, exit 0): 42 passed. After it I fixed an Arabic overflow of the "Public URLs" chip, which I saw in the screenshot.
  - **Run 3** (`e2e-p6.log`, exit 0): 42 passed. This is the result of record, and the screenshots come from it.
- **e2e budget (F-DG5-145/146/151).** Every new test sets 60 s. The slowest loaded test was **5.9 s** in run 3 (5.8 s in run 2), measured while the integration suite ran on the same host. 60 s is more than 10× that, which meets "at least 2×". FE-A's modified `p6-shell.spec.ts` keeps the default 30 s; its tests took at most about 4 s under the same load.

### Screenshots (run 3)

`T-DG6-FE-B-evidence/screenshots/{en,ar}/`, 16 per language: `p6-admin-nav`, `p6-audit`, `p6-audit-after-change`, `p6-security`, `p6-upload-policy`, `p6-upload-policy-saved`, `p6-sensitive-grants`, `p6-operations`, `p6-service-identities`, `p6-identity`, `p6-storage`, `p6-notifications`, `p6-deep-link-forbidden`, `p6-auditor-audit`, `p6-auditor-upload-policy`, `p6-auditor-storage`.

I inspected these by eye:

- `ar/p6-operations.png`: RTL; the heartbeat is "غير معروف" with a question icon, in the neutral tone.
- `en/p6-upload-policy-saved.png`: the "Organization setting" chip, the 20 MiB limit and the reason. This is where I found the missing "Saved" notice, which I fixed.
- `en/p6-audit-after-change.png`: `upload_policy.changed`, "created → 1" and the reason.
- `ar/p6-storage.png`: where I found the chip overflow, which I fixed.
- `ar/p6-deep-link-forbidden.png`: only the refusal text and "الانتقال إلى أعمالي".
- `en/p6-auditor-storage.png`: read-only note, no form.

### Interaction checks actually run (e2e, real API, en and ar)

- The upload-policy save:
  - with no reason, an inline error and nothing saved;
  - with a reason, it is saved, the "Saved" notice shows, the value persists after a reload, and the audit row is present.
- The auditor's read-only pass over Audit, the upload policy and Storage, with zero non-GET `/api/v1/admin/` requests.
- The deep link with an unknown token.
- The operations heartbeat, which is never `alive`.
- The nav entries open real screens with `aria-current`.
- axe on every screen: no serious or critical violation.

## 4. Operations routed (pending-list delta)

**None.** FE-B is a web task and routes no API operation. I edited no `p6-pending-*.ts` or `p6-exercises-*.ts`, and changed no pinned count in `contract.test.ts` (no delta). It consumes the 30 slice E/F/J/C operations through FE-A's `api/p6.ts`.

## 5. For the orchestrator (contracts, schemas, dependencies, merge)

1. **`listNotificationDeliveries` is still pending** at this base (`p6-pending-be-i2.ts`; BE-I2 runs in parallel).
   - The deliveries page (`/admin/notification-deliveries`) is built against the contract and works once BE-I2 merges.
   - Until then the API answers 404, and the page shows the not-found state (`QueryState`), never a fabricated list.
   - The e2e deliberately does not open it.
   - After the merge, please add `/admin/notification-deliveries` to the e2e `SCREENS` list (one line) or have QA do so.
2. **No zod mirrors exist for the slice J/C bodies** (exceptions, heartbeat, service identities, identity, storage, channels, deliveries). I typed them in the page files from `docs/api/openapi.yaml`, each with a comment saying so. If a later task adds mirrors, the pages can import them.
3. **No dependency or migration.**
4. **Shared files I edited** (to reconcile at merge): `app/router.tsx` (routes + the empty `P6_PLANNED_ROUTES`), `i18n/index.ts`, `i18n/provisional-ar-p6.ts`, `auth/permissions.ts`, and FE-A's two P6 shell test files.
5. **Navigation hint (not changed; outside my files).** The auditor's sidebar (`app/nav.ts` `P6_SUBPAGES.requiresAny`, FE-A) lists no Storage or Notifications entry, although the API lets `operations.read` read both. The screens work for the auditor by URL. If the auditor should see the entries, the `requiresAny` of those two entries (and the server catalogue `identity/navigation.ts`) should include `operations.read`.
6. **Styles.** I added no CSS (`styles/**` is not in my ownership). The checkbox lists of the upload policy and service identities flow inline using the existing `.checkbox` class.

## 6. User-facing texts made untrue, and what I did

- **`nav.p6.notAvailableTitle` / `notAvailableBody`** ("not available yet") are no longer shown on any route: every FE-B route now renders its screen, and `P6_PLANNED_ROUTES` is empty. The texts and `P6NotAvailablePage` stay as the seam for later slices, so they remain true wherever they are used. The FE-A tests that asserted the placeholder are updated.
- **`admin.plannedSections`** lists the P5 configuration screens "available in this release". It does not mention the P6 screens, but it says nothing false. I left it unchanged; the owner of `admin.json` may want to add the P6 Administration screens to that sentence.
- I searched the en catalogues for texts that call audit, security, uploads, preview, sensitive records, deep links, operations, identity, storage, email or notifications "planned", "later" or "not yet". I found no other untrue text.

## 7. What remains

- **Acceptance items 2 and 3 are not demonstrated green.** Row 8 (C.UTF-8) exited 1 on load-related timeouts. Row 9 (integration) crashed without a result and showed 4 API failures. Both need a clean run on the merged tree (§3).
- **`AdminHomePage` (D-198 follow-up) is not changed.** It already lists the Administration items that `GET /me/navigation` grants (BE-B2 added the P6 items to the server catalogue). I added no card of my own.

- The deliveries page cannot be exercised end-to-end until BE-I2 merges (§5.1).
- The auditor's nav entries for Storage and Notifications are an FE-A/BE-B2 navigation decision (§5.5).
- The live IdP, object store, SMTP and SAML are residuals by design (§2 rule 14). The screens say so and claim nothing live.
