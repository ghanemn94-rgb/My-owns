# Handback T-DG6-BE-C (backend-workflow-engineer): deep links, inbox redaction, evidence access after ownership transfer

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Task T-DG6-BE-C, `docs/architecture/p6-work-split.md` §E/F.4.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-C.md`, sha256 `765fb84e2682f9b4a2def01014bd6f9a2dbadb13e1f1050cd7376b61c7a1d767` (verified before starting).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-C-backend-workflow-engineer-20261027T032111Z-ff014bd8","session_id":"ff014bd8-1057-4c6b-a39b-93fa76e75830"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-c`, branch `dg6/be-c`, base `HEAD` `af13bd6168e3a77485d95133f0a9ada7f0783735`. The changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` at start `Tue Oct 27 03:21:24 UTC 2026`; at end `Tue Oct 27 05:13:56 UTC 2026`. The full integration run (§4 #9) was still running then and completed at 05:38 UTC. This handback was updated with its result afterwards.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` gave `PASS gate DG5 (historical)`, **exit 0**. It ran before any change, and again at the end (§4).
- **Decisions applied:** D-196 point 1 (**Option A**: a caller without `transformation.read` keeps the DG2 404; an in-scope caller without admission gets 403 `evidence.parent_forbidden`), D-196 point 5 (`inbox.restricted` texts), D-195 (reopen row 6: inbox title redaction accepted), D-199 (W5).
- **Product gates:** G1–G6 are business approvals inside the product. Nothing here grants, records or simulates one. The BAU handover acceptance in the test is a synthetic in-product approval of synthetic data. A deep link is navigation, never an approval. Nothing reads or writes the DG0–DG7 records, and product G6 never implies DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/tasks/deep-links.ts` (stub filled) | `deepLinkTarget(linkPath)`: a pure function over the benefit, business-case and evidence web routes. `targetRefOf` and `readableTargets`: the read-time rule "may this principal read the notification's target now", batched. It uses one `ReadScope` per call, and also checks an evidence target's linked benefits and business cases. `issueDeepLink`: the lazy token issue under the `deepLinkIssue` lock (730301), with a version step and the audit event `inbox_notification.link_issued`. The `resolveDeepLink` route `GET /api/v1/links/:token`. |
| `apps/api/src/modules/tasks/routes.ts` | `listMyInbox` redaction lines. An item whose target the recipient cannot read now gets `messageKey` `inbox.restricted` and `messageParams` `{}`. `INBOX_RESTRICTED` constant. Header note. |
| `apps/api/src/modules/tasks/index.ts` | Public surface: `deepLinkTarget`, `issueDeepLink` (for the ADR-0054 channel fan-out, BE-I2), `readableTargets`, `INBOX_RESTRICTED`. |
| `apps/api/src/modules/evidence/access.ts` (stub filled) | ADR-0051 §4 rule. `evidenceReadDecision` (rules 1–3; 404 out of scope). `requireEvidenceRead` (download and preview gate; 403 `evidence.parent_forbidden`). `evidenceParents` (the link-table enumeration). `evidenceParentsAdmittedSql` (rule 3 as SQL, for lists). |
| `apps/api/src/modules/evidence/routes.ts` | **Content read line:** `downloadEvidenceContent` calls `requireEvidenceRead`. **Metadata lines (BE-B2's, extended as BE-B2's comment deferred to BE-C):** the GET uses `evidenceReadDecision`. A sensitive item itself stays 404 (§2, unchanged). A sensitive parent gives 403 `evidence.parent_forbidden`. The list adds the rule-3 predicate. Upload lines untouched (BE-D). |
| `packages/shared/src/schemas/deep-links.ts` (stub filled) | zod mirrors `deepLinkToken`, `deepLinkResolution` (contract `DeepLinkResolution`, `DeepLinkToken`). |
| `apps/api/test/support/p6-pending-be-c.ts` | `resolveDeepLink` removed (list now empty). |
| `apps/api/test/integration/contract/p6-exercises-be-c.ts` | Exercises `resolveDeepLink` through `mirrored`: 200, 400, 401, 403, 404. Mirror map. |
| `apps/api/test/integration/tasks/deep-links.test.ts` (new) | REQ-S12-024 literal tests, 13 tests (§2). |
| `apps/api/test/integration/evidence/ownership-transfer.test.ts` (new) | REQ-S13-013 literal tests, ADR-0051 §4 (a)–(e), 5 tests (§2). |
| `apps/api/src/modules/tasks/tasks.test.ts` | One named line: the tasks module's route list gains `GET /api/v1/links/:token`. |
| `apps/api/src/server.test.ts` | One named line: the tasks module registers 11 routes (was 10). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-C-evidence/*.log` | Check logs (§4). |

No migration, no new dependency, no notification writer edited (ADR-0051 §3: the seven insert sites are unchanged), and no contract or i18n file edited. The i18n keys `deep_link.forbidden`, `evidence.parent_forbidden` and `inbox.restricted` already exist (FE-A).

## 2. Behaviour delivered, per requirement row

### REQ-S12-024: Enforce access on notification deep links

Acceptance (quoted): *"A12: a forwarded link opened by an unauthorized user returns 403 without leaking the record title"*.

- **Forwarded link, unauthorized user: 403 without the title.** A user of another organization opens a benefit link forwarded from the recipient. The response is `403`, `code` `deep_link.forbidden`, `detail` "You do not have access to this item." The raw body contains neither the benefit title nor its id (`deep-links.test.ts` › "A12: a forwarded link …").
- **Byte-identical refusals** (§E/F.4 literal). For three tokens, the 403 bodies with `requestId` blanked are compared and form **one** distinct value:
  - a sensitive benefit the caller (a BO of the transformation without a grant) is not admitted to;
  - a benefit in a transformation where the caller holds nothing;
  - a benefit id with no row.
  
  Each body is checked to contain none of the title, the record ids, either transformation id, or the word "benefit". The body equals exactly `{type, title "Forbidden", status 403, detail, code "deep_link.forbidden", requestId}`. "Deleted target" is a link whose record no longer exists. The application role cannot DELETE a benefit (`mth_app`), so the test points the link at an id with no row. It does not delete a row.
- **Authorized colleague resolves it.** The recipient, a TL and the AUD user (all with read on the transformation) get `200 {linkPath, recordType: "benefit", recordId}`. Being the recipient is neither required nor sufficient: the recipient who lost access gets 403, and a grant then restores 200. A revocation brings back 403.
- **Inbox redaction.** The recipient who cannot read the target sees the item with `messageKey` `inbox.restricted` and `messageParams` `{}`. `id`, `transformationId`, `workItemId`, `linkPath`, `readAt`, `createdAt` and `version` are unchanged (exact equality). After a grant the original key and params (with the title) return. After the revocation the item is redacted again. The stored row is byte-equal before and after. Target selection follows ADR-0051 §3:
  - the stored target if set;
  - otherwise the recognized path;
  - otherwise the item's transformation (`transformation.read`);
  - otherwise organization-level, never redacted.
  
  Each case is tested, and the batch rule agrees row by row with the expected decisions.
- **Lazy issue ×5, one token.** Five concurrent `issueDeepLink` calls on one notification return one token, and exactly one call reports `issued: true`. The row gets the token, `target_record_type` `benefit` and `target_record_id`, with one version step and `message_key`/`message_params` unchanged. There is exactly **one** `inbox_notification.link_issued` audit event with prior and new version, and the token is not copied into the audit `changes`. A later call returns `{token, issued: false}` and writes nothing. So the unmapped `inbox_notification_deep_link_once` / `inbox_notification_link_token_key` constraints are never violated by the API (the §E/F.1 obligation "a test of BE-C proves it").
- **Other refusals and no writes.** Unknown token: 404. Malformed token: 400 `validation`. No session: 401. The resolver and the inbox read write no audit event and leave the row unchanged. These counts are scoped to this file's transformations and notifications, because the run's database is shared by concurrent files.
- **`deepLinkTarget`.** It recognizes exactly the benefit, business-case and evidence routes, including with a sub-path, query or fragment and in any case. It recognizes nothing else: lists, measurements, KPIs, approvals, prefixed paths and a longer id.

### REQ-S13-013: Preserve evidence access after ownership transfer, and apply the parent record's authorization to downloads and previews

Acceptance (quoted): *"A12: a user without access to the parent gets 403 on the evidence download URL; after BAU handover the new owner can download it"*.

The ADR-0051 §4 test runs in `ownership-transfer.test.ts`, through the API end to end:

- **(a)** A benefit owned by the BO. A **file** evidence item created, owned and uploaded by the WL (PDF bytes). The evidence is attached to the benefit as a T14 form-record attachment (the API link to a benefit).
- **(b)** A performance area. A complete BAU handover prepared by the WL, naming a **new** receiving owner who holds a BO assignment on the transformation. The evidence is linked to the handover, the handover is submitted, and it is **accepted by the new owner** (`acceptedBy` asserted).
- **(c)** The new owner downloads it: `200`, the exact bytes, `application/octet-stream`, `attachment`. The new owner also reads the metadata (GET 200; the item is in the list). The owner field still names the WL: no rule reads the owner for a non-sensitive item.
- **(d)** A user of the same organization with an assignment only on another transformation, and a user of another organization: `404 not_found` on the download and the GET. This is **Option A** (D-196), the DG2 non-disclosure form.
- **(e) Sensitive evidence.**
  - Marked sensitive: the new owner (not a named party) gets **403 `evidence.parent_forbidden`** on the download, and so does AUD.
  - The metadata GET keeps BE-B2's §2 404, and the list omits the item.
  - The WL (owner and creator, named party) and the TO (`sensitive_record.grant`) get 200.
  - A grant to the new owner gives 200 on the download and the GET. A revocation gives 403 again.
  - The out-of-scope user stays 404.
- **(e) Sensitive parent.** This is the acceptance's "a user without access to the parent gets 403 on the evidence download URL".
  - The benefit is marked sensitive. The new owner reads the transformation but is no party of the benefit and holds no grant: **403 `evidence.parent_forbidden`** on the download and the GET, and the item is absent from the list.
  - The benefit's owner and the TO get 200.
  - A grant on the **parent** restores 200 and the list entry. A revocation gives 403 again.
- **Deep link and download agree.** A notification linking to the evidence route resolves with the same outcome as the download: 200/200, then 403/403 after marking the parent, 200/200 with a grant, and 403/403 after the revocation.
- **Preview:** the preview route is BE-D's (`previewEvidenceContent`, ADR-0052 §2, W5 after BE-C). `requireEvidenceRead` is exported for it. This task proves the download and metadata halves. The preview half is BE-D's test.
- **Linked tables** (ADR-0051 §4 asks for the list). `grep -l evidence_id packages/db/migrations/*.sql` gives `0012, 0015, 0019, 0020, 0034, 0035, 0038, 0044, 0048, 0051, 0055, 0068, 0075, 0080, 0086, 0106`. Of these, only two tables can name a **benefit or business case**:
  - `benefit_evidence` (0038);
  - `form_record_attachment` (0068), when its `form_record_type.table_name` is `benefit` or `business_case`, i.e. `T14` and `business_case`.
  
  `evidence_link` (0012) has a closed `record_type` CHECK without either type. The others name a diagnostic output, gate dispensation, KPI actual, RAG override, agenda item, BAU handover, phase step, inherited record, gate condition closure, report snapshot, Day-90 response, health answer or deliverable external change. **Every row counts, including a removed attachment** (fail closed; ADR §4 says "every row"). If the orchestrator prefers active links only, it is one `status = 'active'` condition in both enumerations.
- **No DG2–DG5 fix was needed for (c).** The download already authorized by `transformation.read` alone. No P6 finding is raised from (c).

## 3. Operations routed (delta to the pending list)

| List | Before | After |
|---|---|---|
| `apps/api/test/support/p6-pending-be-c.ts` | `["resolveDeepLink"]` | `[]` |

`resolveDeepLink` is exercised in `p6-exercises-be-c.ts` (200, 400, 401, 403, 404) with its zod mirror. Pinned-count deltas for the orchestrator: **operation count unchanged** (the operation was already in the contract). The P6 pending aggregate is down by 1, with no new media type, no new rate-limit class and no CSRF-exempt route (it is a GET).

## 4. Checks actually run

All checks ran in `/home/user/wt/dg6-be-c` with Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. The harness ports were 23800–23849. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-C-evidence/`.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, before any change) | `PASS gate DG5 (historical)`, **exit 0** | in this run's transcript |
| 1b | the same, at the end | `PASS gate DG5 (historical)`, **exit 0** | `validate-dg5-historical-end.log` |
| 2 | `pnpm -r typecheck` (final tree) | **exit 0** | `typecheck.log` (run 1 `typecheck.run1.log`: exit 2 on a test-file type error `session?: Session`, fixed) |
| 3 | `pnpm -r build` (final tree) | **exit 0** | `build.log` (run 1 before the last edits: exit 0, `build.run1.log`) |
| 4 | `pnpm lint` (final tree) | **exit 0** | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (final run after this handback was written; see the end of §4) | `prettier.log` |
| 6 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 922 operations`, **exit 0** | `openapi-lint.log` |
| 7 | `pnpm test`, locale **unset** (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **exit 1**: unit-node 2459 passed / **1 failed** (156 files); unit-web 1768/1768 (96 files); unit-formula-nocodegen 259 passed + 2 skipped (3 files) | `unit-locale-unset.log` |
| 8 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **exit 1**: identical counts; the same single failure | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1**, completed at 05:38 UTC (duration 4262 s): **330 files passed, 2 failed (332)**; **3324 tests passed, 3 failed**, 1 skipped, 1 todo (3329). Snapshot at the time limit (05:10): 115 files passed, 0 failed. | `integration.log`, `integration-snapshot-at-limit.log` |
| 9b | re-run of `contract/response-validation.test.ts` alone, unloaded (`QA_PG_PORT=23840`) | **109/109 passed, exit 0** | `integration-response-validation-rerun.log` |
| 10 | targeted: `QA_PG_PORT=23830 MTH_PORT_POOL=23831-23849 tests/qa/support/with-pg.sh npx vitest run --project integration` on 8 affected files (ownership-transfer, sensitive-reads, sensitive-reads-ab-transcript, read-scope-parity, evidence-register, integrity-sweep, approvals/reminders, automation-notify-delivery) | **exit 1**: 63 passed, **1 failed** (see below) | `integration-targeted.log` |
| 11 | targeted, earlier: the two new files alone | 18/18 passed, exit 0 | in this run's transcript |

**Every non-zero exit, explained:**

- **#7 and #8: `deploy/scripts/tests/dep-audit.vitest.mjs`** ("no High/Critical advisory in the committed snapshot matches a shipped component of the committed SBOM") fails with the 20 High advisories of D-199 (fastify 5.6.1, @fastify/static 8.2.0, image-size 1.2.1, …).
  - This is pre-existing and independent of this task: `git diff af13bd6 -- deploy/` is empty, and I changed no manifest, SBOM or snapshot.
  - D-199 assigns the upgrade to T-DG6-DO-A2 (W5, concurrent).
  - It is the **only** unit failure in both locales.
- **Pre-fix runs:** the first unit runs (`*.prefix-run1.log`) also showed four failures caused by this task, all fixed and re-run green on the final tree:
  - `architecture.test.ts`: a computed member `readable[i]`, now `readable.at(i)`;
  - `advisory-locks.test.ts`: the lock number spelled in a comment, removed;
  - `server.test.ts` and `tasks.test.ts`: the tasks module's route pins, +1 named line each.
  
  The 155 tests of those four files pass (transcript).
- **#10: `hardening/integrity-sweep.test.ts`** › "every DELETE operation of the contract is listed…" expects `['retireDependencyType']` but the contract now has a second DELETE operation from a later P6 contract block.
  - This is pre-existing and independent of this task: `docs/api/openapi.yaml` and `apps/api/test/integration/hardening/**` are byte-identical to HEAD (`git diff --quiet af13bd6 -- …` true).
  - It is BE-F's test (W4) against a contract that grew in W4; it is for the orchestrator or BE-F2.
  - The other 18 tests of that file pass, including the P6 grant transition, duplicate and reference rows.
- **#9: the three failed tests.**
  - `hardening/integrity-sweep.test.ts` › "every DELETE operation…": the same pre-existing failure as #10. The contract's second DELETE operation is `deleteSavedView`.
  - Two tests in `contract/response-validation.test.ts` failed **under load** and passed when the file was re-run alone (#9b, 109/109). The full suite ran alongside both `pnpm test` locale runs, `pnpm -r typecheck`, `lint`, `build` and the targeted run #10.
    - "every operation: an undeclared request media type…": a 30 s test timeout.
    - "P5 BE-J operations": `p5-exercises-be-j.ts:61` expected one dependency slip in the list and got zero.
  - These are **flaky under load**. They are disclosed, not claimed as passes. The BE-J slip assertion depending on load is a determinism concern of the F-DG4-143 class, for that exercise's owner. This task touches neither file nor their routes.
  - No pinned count was changed by this task, except that the P6 pending aggregate is down by 1 (§3).

Note on #5 and #9: the per-run `.claude/.cc-writes` empty directories created inside source folders were removed before the test runs, as the assignment asks.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Contract need: add 403 to `downloadEvidenceContent` and `getEvidence`.** ADR-0051 §4 and D-196 point 1 give these two GETs a 403 `evidence.parent_forbidden`, but `openapi.yaml` 1.5.0-p6 declares `200, 400, 401, 404, 429` only. Proposed: add `"403": { $ref: "#/components/responses/Forbidden" }` to both, and mention `evidence.parent_forbidden` in each summary. `previewEvidenceContent` already declares 403. Until it is added:
   - the server answers an undeclared 403 on those two operations, in the in-scope, not-admitted case only;
   - `ownership-transfer.test.ts` sends those specific calls with `contract: false` (commented in the file). Every 200 and 404 there is still asserted against the contract.
   
   BE-F's response-validation test should know about this.
2. No new problem code. `deep_link.forbidden` and `evidence.parent_forbidden` are the ADR-0051 §3/§4 texts, already in the i18n catalogue.
3. No migration. No dependency.

## 6. User-facing texts made untrue

- No en/ar string calls the deep-link resolver, the inbox redaction or evidence access "planned". Searched: `apps/web/src/i18n/en/*.json` for planned / later / coming wording near link, inbox, notification and evidence access.
- **For FE-B:** the web route `/l/:token` is still in `P6_PLANNED_ROUTES` (`apps/web/src/app/router.tsx`, owner FE-B), so the landing page still renders as planned. The API it needs (`GET /api/v1/links/{token}`) now exists. When FE-B builds the page, it removes the planned entry. `nav.json` `deepLink` ("Your access is checked again before the item opens.") is already true.

## 7. Known gaps and what remains (stated plainly)

1. **Other evidence metadata reads do not apply the sensitivity rules.** This is a finding candidate for the owner. It is not fixed here: those files are outside BE-C's ownership (p6-plan R1).
   - `listEvidenceRegister` and `listEvidenceVersions` (`evidence/register.ts`, T-DG5-BE-O) and `listFormRecordAttachments` (`forms/attachments.ts`) do not apply ADR-0051 §2 or §4.
   - A reader of the transformation therefore sees a sensitive evidence item's title, and an item under a sensitive parent, in those lists.
   - Proposed owner: BE-B2's inventory successor, or BE-C2's sweep. Fix: the `ReadScope.predicate` plus `evidenceParentsAdmittedSql` (exported from `evidence/access.ts`).
2. **The link-table enumeration exists twice.** It is in `evidence/access.ts` and in `tasks/deep-links.ts`, because `tasks` may not import `evidence` (`apps/api/src/modules.ts`: tasks depends on platform, audit, access only). The agreement is pinned by the ownership test's deep-link-versus-download case. A single home would need either the `access` module (frozen; owner BE-B) or an injected port wired in `server.ts` (the D-197 item 5 pattern). That is an orchestrator choice.
3. **`issueDeepLink` has no route.** It is an internal service for the ADR-0054 channel fan-out (BE-I2), like `createWorkItemOnce`. Authorization is by its caller (a service actor). There is no `If-Match` because there is no HTTP request. It is serialized by the lock and the row lock, and it writes one audit event with prior and new version. The worker cannot import API code (ADR-0002), so BE-I2 needs either a worker twin (the `kit.ts` precedent) or an API-side fan-out. This is listed for BE-I2 and the orchestrator.
4. **Where the metadata GET and the download differ.** For a sensitive evidence item itself (rule 2), the download answers 403 (ADR-0051 §4). The metadata GET keeps the 404 of ADR-0051 §2 and BE-B2's tests. Allow or deny is identical: one decision function. Only the status differs, and the ADR text states both statuses.
5. **`finance-validations/{id}` and measurement links** are not recognized as benefit targets: `deepLinkTarget` recognizes only the three record routes, as ADR-0051 §3 states. Their inbox items fall back to `transformation.read`. The Finance validator is a named party of a sensitive benefit anyway.
6. The pre-existing untracked top-level files in this worktree (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json`, `.vscode`, `CLAUDE.local.md`, …) were present before I started. They are not mine, and I did not touch them.

## 8. Merge instructions

- No migration and no ordering constraint on the database.
- `evidence/routes.ts` is edited sequentially per §E/F.13: BE-B2 metadata lines, then **BE-C** (content line plus the metadata lines named above), then BE-D (upload lines). BE-F2 (W5) adds the finalized-evidence rule to `archiveEvidence`/`removeEvidenceLink`. If that touches `evidence/routes.ts`, expect a textual merge only. The hunks are disjoint: the imports block, `registerEvidenceMetadataReads` and `registerContentRoutes`' GET.
- `server.test.ts` and `tasks.test.ts`: one line each (the tasks route count and list).
- After merge, the orchestrator reconciles the pending aggregate (−1) and applies the contract need of §5.1.
