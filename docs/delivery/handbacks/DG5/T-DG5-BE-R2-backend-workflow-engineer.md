# Handback: T-DG5-BE-R2 (backend-workflow-engineer), `GET /me/navigation` and the two text scans

- **Stage:** P5 / DG5 (BUILDING). **Section:** `docs/architecture/p5-work-split.md` §I.4.
- **Invocation:** `DG5-T-DG5-BE-R2-backend-workflow-engineer-20261016T111616Z-5596f476`, session `5596f476-3963-4ee1-b7c5-07f83bf05541`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-R2.md`; its sha256 `58e47c16…3c440` was verified at start.
- **Base:** branch `dg5/be-r2` at `4a05c4fb27c605fb04c6852b5abffc5ee0065788`, clean at start.
- **Time:** started `2026-10-16T11:16:33Z`; the end time is in the closing section.
- **Changes are uncommitted**, for the orchestrator to integrate.
- **No migration**, no new dependency, no secret, no CDN.
- **Approvals:** nothing here grants or records any business, Finance or IT approval. Nothing reads or writes DG0–DG7 records.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/identity/navigation.ts` | Fills BE-A's stub. It holds the ADR-0049 §9 table as data (`NAVIGATION_AREAS`, 14 areas, M0100–M0113 contents). Visibility comes from held permissions through `holdsAnywhere`, and hidden areas and items are omitted. It also holds the `DELIVERED_P5_SCREENS` availability list that the FE tasks update, and the route `GET /api/v1/me/navigation` (session; strict empty query). |
| `apps/api/src/modules/identity/navigation.test.ts` | Unit tests (12): the table; visibility per role default, including WL's codes against the §9 Administration list; omission; availability; and the web label keys in en and ar. |
| `packages/shared/src/text-scan/claims.ts` | `claimsOfficialPmi` mirrors `p5_claims_official_pmi`. The SQL constants `claim` and `neg` are copied verbatim. |
| `packages/shared/src/text-scan/engineering-gates.ts` | `mentionsEngineeringGate` mirrors `p5_mentions_engineering_gate`. The pattern is copied verbatim. |
| `packages/shared/src/text-scan/ascii-classes.ts` | `postgresCClasses`: compiles the verbatim SQL patterns with PostgreSQL's C-ctype `\s`/`\S` (ASCII whitespace only), as on the pinned clusters (ADR-0003). See §5.3. |
| `packages/shared/src/text-scan/corpus.ts` | The one rule corpus with expected answers: probe T01–T04 plus dialect edge cases. Test-only data, not exported from the entry. |
| `packages/shared/src/text-scan/text-scan.test.ts` | Unit tests (77) of the mirrors and the class rewrite. |
| `packages/shared/src/index.ts` | Export lines for the two rules: one comment and two `export *` lines. |
| `apps/api/test/text-scan/scan.ts` | The scanner and corpus collectors: (a) i18n JSON strings; code string literals read with the TypeScript scanner (comments are never read); `REPORTED_EXISTING_FINDINGS` (§6). |
| `apps/api/test/text-scan/rendered.ts` | The read-back text of one rendered export per format: PDF runs and visual and logical lines; DOCX/PPTX runs and paragraphs; XLSX cells; CSV lines. |
| `apps/api/test/integration/text-scan/ui-strings.test.ts` | Scan (a): every string of `apps/web/src/i18n/{en,ar}/*.json`, with positive controls (8 tests). |
| `apps/api/test/integration/text-scan/problem-texts.test.ts` | Scan (b): every string literal of `apps/api/src` (a superset of every problem `detail`) and `problems.json` en/ar (6 tests). |
| `apps/api/test/integration/text-scan/export-templates.test.ts` | Scan (c): the literals of `packages/reporting/src`, `apps/api/src/modules/reporting`, `apps/worker/src/reports` and `packages/shared/src/reports`; the label tables; and one rendered sample per format (pdf, docx, xlsx, pptx, csv) in en and ar, with planted-text controls per format (23 tests). |
| `apps/api/test/integration/text-scan/sql-agreement.test.ts` | SQL and TypeScript agree on the corpus (with the expected answers) and on every UI string and API literal, more than 20,000 texts (4 tests). |
| `apps/api/test/integration/navigation/navigation.test.ts` | `GET /me/navigation` against a real PostgreSQL (8 tests). |
| `apps/api/test/integration/contract/p5-exercises-be-r2.ts` | Contract exercise of `getMyNavigation` (200 ×2, 400, 401) and its zod mirror of the OpenAPI `Navigation` schema. |
| `apps/api/test/integration/contract/contract.test.ts` | Three named lines `// T-DG5-BE-R2`: the import, the `...P5_MIRRORS_BE_R2` mirror line, and the `it("P5 BE-R2 operations …")` block. BE-A had wired every other exercises file but not this one; the precedent is BE-Q2's named lines. |
| `apps/api/test/support/p5-pending-be-r2.ts` | Emptied (see §4). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-R2-evidence/*` | Logs (§3). |

**Merge notes:**
- `contract.test.ts` gets 3 additive lines next to BE-R's; expect a trivial union conflict with other W15 tasks.
- No other shared file is touched.

## 2. Behaviour delivered, per requirement row

### REQ-S03-007

Acceptance: *"A01;A12;A20: an ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration; each area's landing page lists the contents named in §3"*.

- **The 14 areas.** `getMyNavigation` returns the areas in the §9 order. Each area carries `code`, `webId`, `labelKey` (`nav.areas.<webId>.label`) and `path`, and its §3 items each carry `code`, `labelKey` (`nav.contents.<webId>.<code>`), `path` and `availability`. The integration test grants a synthetic user every role code at organization scope (the union of the role defaults). It asserts all 14 areas with exactly their M0100–M0113 items, and that all 14 area labels resolve in `nav.json` en and ar (the Arabic is non-empty, differs from the English and is Arabic script).
- **Workstream Lead.** A WL (business-unit grant) gets 13 areas, without Administration. The raw body contains none of the Administration paths or items (omitted, not flagged). The unit test asserts that `ROLES.WL.permissions` holds none of the 13 §9 Administration codes.
- **Administration for other roles:**
  - TO sees Administration with `methodology` only (the Studio review page);
  - AUD sees it with `access` only (read-only through `user.read`/`access.read`);
  - ADM_TECH, ADM_ACCESS and ADM_METHOD each see it;
  - `job.read` alone shows `automation` only.
- **Grants and scope.** A user without grants gets My Work and the playbook's source and guidance. The answer is identical for the same role at two different business units. A grant revoked in the database hides its items on the next request (no caching). An undeclared query parameter gives 400 `validation`, and a missing session gives 401.
- **Availability** is `planned` only for items whose P5 screen is not merged: `source` (FE-G reader), `procedures` (FE-D), `packs` (FE-E), `forms` (FE-C), `workflows`, `automation` (FE-D), `branding`, `environment` (FE-G). `methodology` → `/admin/studio` is `working` (FE-B delivered). FE tasks flip an item by adding their screen to `DELIVERED_P5_SCREENS` in `identity/navigation.ts`.
- **Gap: 22 item label keys.** The four "available" areas (My Work, Executive Overview, Transformations, Administration) have no `nav.contents.<area>.*` keys in the web catalogue yet, so 22 item label keys don't resolve. `nav.json` is not my file, and FE-C and FE-D edit the web concurrently. The test pins them as `AWAITING_WEB_KEYS`, a list that may only shrink. All other item keys resolve in en and ar. The proposed lines are in §5.1.

### REQ-PB-001 (claim-scan half)

Acceptance: *"… an automated text scan of UI strings (en+ar) and report templates finds no claim of 'official PMI standard', 'PMI certified' or equivalent"*.

- **The scan runs on:**
  - every en and ar UI string (16,752 strings);
  - every API string literal and `problems.json` en/ar;
  - the report and export template literals and label tables;
  - the rendered text of a sample PDF, DOCX, XLSX, PPTX and CSV in en and ar. The samples use the production `REPORT_CONTENT_LABELS` and the B0004 provenance footer the worker reads from the database.
- **Result.** UI strings, `problems.json`, the template literals, the label tables and all 10 rendered samples have no claim. The shipped disclaimer `common.about.methodBody` passes.
- **Controls.** A planted en and ar claim is found in each of the 10 rendered samples, which proves the read-back sees the text.
- **Four existing API literals are flagged**: the exact ADR-0049 §11 texts. They are reported in §6 and not changed.

### REQ-S21-001 (scan half)

Acceptance: *"a text scan of UI strings and export templates finds no DG0-DG7 references; demo G-approvals display 'Synthetic demonstration - approves nothing real'"*.

- **No DG0–DG7** in UI strings (en, ar), in export templates or label tables, or in the 10 rendered samples. A planted "DG7" is found in every format.
- **One API literal is flagged:** the DG2 gate-snapshot `note`, reported in §6.
- **Not this task:** the synthetic-approval label belongs to BE-S/FE-G (§J). The scan accepts that text, which is in the corpus.

### SQL/TypeScript agreement (§I.7 item 4)

The two implementations agree on all 71 corpus entries (45 claim, 26 engineering-gate), each equal to its expected answer, and on more than 20,000 product texts. Fewer than 50 literals containing U+0000 or lone surrogates (input-rule probes, not product text) are not sent to PostgreSQL and are counted in the test.

## 3. Checks, with real exit codes

Environment: Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, offline, harness ports 23250–23299. Before every test run, the empty harness-created `.claude/.cc-writes` and `.claude` directories inside `apps/`, `packages/` and `tests/` were removed. The file tools recreate them, and `architecture.test.ts` rejects an unmapped `modules/.claude` directory (see run 1).

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | (start, console) |
| 1 | `pnpm -r typecheck` | 0 | | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | | `build.log` |
| 3 | `pnpm lint` | 0 | | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| 6a | `pnpm test`, locale unset, **run 1** | **1** | unit-node: 2 failed, 2247 passed (2249). Both in `architecture.test.ts`, both mine (see below). unit-web 1429/1429; nocodegen 259 passed, 2 skipped. | `unit-locale-unset-run1-fail-architecture.log` |
| 6b | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`), **run 2** | 0 | unit-node 135 files / 2249 passed; unit-web 74 / 1429 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2249; 1429; 259 + 2 skipped | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=23260 MTH_PORT_POOL=23261-23299 tests/qa/support/with-pg.sh pnpm test:integration` | **none: STOPPED** | **Incomplete, not a pass.** The agent runner stopped the background command at its 1-hour limit. By then 250 of 277 files had finished, all passing: 2597 tests, 1 skipped (pre-existing, `governance/presentation.test.ts`), 0 failed. The 27 files that had not run are listed in `integration-not-run.txt`; they include my four text-scan files (they pass in the targeted run below). | `integration.log`, `integration-not-run.txt` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-end.log` |

**Run 1's failures, disclosed:**
- **(i)** `has only mapped module directories`: an empty `apps/api/src/modules/.claude` directory, created by the file tool's write tracking during this run. It was removed (environment artefact; not tracked).
- **(ii)** `every import respects …`: two computed-member accesses with non-literal keys in my `navigation.test.ts` (`ROLES[r]` and a `reduce` lookup). I rewrote them with `Map`, and lint and the run-2 tests pass.

**Targeted runs during development:**
- `vitest --project integration` on `text-scan/` and `navigation/`, run 1: exit 1, 4 failures, all mine:
  - the 400 problem code is `validation`, not `validation.failed` (test fixed);
  - the Arabic planted claim was missed in the PDF/DOCX read-back. Joining every DOCX run without separators let an earlier "لا" ("not") act as a negation, and a PDF Arabic line is in visual order. The extraction was fixed (per-paragraph joins; right-to-left logical lines);
  - the agreement query failed on literals containing U+0000 (now excluded and counted).
- Run 2: exit 0, 5 files, 49/49 passed (`integration-targeted-text-scan-navigation.log`; run 1 is `integration-targeted-run1-fail.log`). Commands: `QA_PG_PORT=23250 MTH_PORT_POOL=23251-23299 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/text-scan apps/api/test/integration/navigation` (run 1), and the same command on ports 23252/23253-23299 (run 2).

**Contract pins.** `getMyNavigation` is a bodiless GET, so I expect the media-type triple delta to be **0** and no rate-limit floor change. `contract.test.ts` passed in the full run (82 tests) without any pin edit.

## 4. Operations routed (delta to the pending list)

`apps/api/test/support/p5-pending-be-r2.ts`: `["getMyNavigation"]` → `[]`. `getMyNavigation` is exercised in `p5-exercises-be-r2.ts`:
- 200 for ADM_ACCESS + ADM_TECH, with the Administration items;
- 200 for a user without grants: `my_work` and `playbook_procedures` only;
- 400 on an undeclared parameter;
- 401 without a session.

429 is the shared rate limiter's (the contract test's rate-limit checks).

## 5. Needs for the orchestrator (contract, schema, text, dependency)

### 5.1 Web catalogue keys (owner of `apps/web/src/i18n/{en,ar}/nav.json`)

Add `nav.contents.{myWork,executive,transformations,admin}.*` so that every navigation item renders in en and ar. These are proposed texts. The Arabic is a provisional translation and should be aligned with the glossary.

| Key | en | ar (provisional) |
|---|---|---|
| `nav.contents.myWork.assignedActions` | Assigned actions | الإجراءات المسندة |
| `nav.contents.myWork.drafts` | Drafts | المسودات |
| `nav.contents.myWork.reviews` | Reviews | المراجعات |
| `nav.contents.myWork.approvals` | Approvals | الموافقات |
| `nav.contents.myWork.missingUpdates` | Missing updates | التحديثات الناقصة |
| `nav.contents.myWork.upcomingDeadlines` | Upcoming deadlines | المواعيد النهائية القادمة |
| `nav.contents.executive.outcomes` | Outcomes | النتائج |
| `nav.contents.executive.value` | Value | القيمة |
| `nav.contents.executive.criticalInitiatives` | Critical initiatives | المبادرات الحرجة |
| `nav.contents.executive.adoption` | Adoption | التبنّي |
| `nav.contents.executive.blockers` | Blockers | المعوّقات |
| `nav.contents.executive.decisions` | Decisions | القرارات |
| `nav.contents.transformations.portfolio` | Portfolio | المحفظة |
| `nav.contents.transformations.workspaces` | Transformation workspaces | مساحات عمل التحوّل |
| `nav.contents.admin.methodology` | Methodology | المنهجية |
| `nav.contents.admin.forms` | Forms | النماذج |
| `nav.contents.admin.workflows` | Workflows | سير العمل |
| `nav.contents.admin.automation` | Automation | الأتمتة |
| `nav.contents.admin.organization` | Organization | المؤسسة |
| `nav.contents.admin.access` | Access | الصلاحيات |
| `nav.contents.admin.branding` | Branding | الهوية البصرية |
| `nav.contents.admin.environment` | Environment | البيئة |

When they are added, the `AWAITING_WEB_KEYS` list in `navigation.test.ts` should be emptied, which turns the check strict.

### 5.2 Other items

- **Zod mirror.** There is no shared zod schema for the OpenAPI `Navigation`/`NavigationArea`/`NavigationItem`. A local mirror lives in `p5-exercises-be-r2.ts` (`navigationMirror`). If the orchestrator wants it in `packages/shared/src/schemas/` (a frozen file for me), it can be moved as-is.
- **Availability flips at the W15 merge.** FE-C (form builder) and FE-D (procedures, automation, approval routes, my procedures) run concurrently and cannot edit `identity/navigation.ts`. When they merge, `DELIVERED_P5_SCREENS` needs `formBuilder`, and `procedureBuilder`/`automation`/`myProcedures` as delivered. Otherwise `availability: "planned"` becomes untrue (F-DG4-160). It is a one-line edit each.
- **Test location.** §I.4 names `apps/api/test/text-scan/**`, but no Vitest project includes that folder, and `vitest.config.ts` is frozen. So the scan modules live there and the test entry files are in `apps/api/test/integration/text-scan/`, which the integration project runs (the SQL agreement needs PostgreSQL anyway). If the orchestrator prefers the scans in `pnpm test` too, add `apps/api/test/text-scan/**/*.test.ts` to `unit-node` and move the three non-DB tests.
- **New files beyond §I.4's list,** all inside my folders: `text-scan/ascii-classes.ts` and `text-scan/corpus.ts` (shared), and `scan.ts` and `rendered.ts` (API test).
- **Dependency:** none. `typescript` (already a root devDependency) is used by the test scanner only.

### 5.3 A design point for the reviewers: the regex dialect

PostgreSQL's `\s` is locale-dependent:
- under the C ctype of every test and demo cluster (ADR-0003), it matches only ASCII whitespace;
- under a Unicode ctype, such as the Compose default `en_US.utf8`, it also matches U+00A0 and other Unicode spaces.

The mirrors follow the pinned C ctype exactly, through `postgresCClasses` and without the `u` flag (ASCII-only case folding). The agreement test asserts `datctype = 'C'`.

To stay strict for a Unicode-ctype database, the product-text scanner also tests a copy of every text with Unicode whitespace made ASCII and NFKC-normalized, and flags when either copy matches. The corpus includes U+00A0/U+2003 cases. Under the C ctype, "Not an official PMI standard." is a claim on both sides.

## 6. Texts my scans found untrue or violating (existing strings; not changed)

The scans found five existing strings. They are pinned in `REPORTED_EXISTING_FINDINGS` (`apps/api/test/text-scan/scan.ts`), matched by file and exact text. A test asserts each one is still a real match, so the list can't hide a passing text, and every other violation fails.

**1. The exact ADR-0049 §11 texts.** These are P5, so not DG1–DG4 text, but shared rule 15 fixes them.
- **Strings:**
  - `branding.prohibited_claim`: *"Branding text must not claim official PMI status or certification."* (`admin/branding.ts:160`, `platform/db-errors.ts:3274`);
  - `methodology_reader.prohibited_text`: *"Reader text must not claim official PMI status or certification, or name an engineering delivery gate."* (`methodology/element-profiles.ts:107`, `platform/db-errors.ts:2853`).
- **Why they match.** The claim rule (SQL and TS alike) only removes a negation that directly precedes the claim phrase. Here "claim" stands between "not" and "official PMI". So ADR-0049 §11's "None of these texts … claims official status: the §7 scans cover the problem texts too" is contradicted by its own §7 rule. The web's `problems.json` translations of these codes pass.
- **Option 1 (text change).** Replace the two texts, for example with:
  - *"Branding text must not claim that PMI has officially endorsed or certified the product."*
  - *"Reader text must not claim that PMI has officially endorsed or certified the methodology, or name an engineering delivery gate."*

  Both were checked with the TS rules: no match on either rule. This is an ADR amendment plus an edit by BE-R/BE-Q2.
- **Option 2 (rule change).** Widen the negation so that "not claim/state/imply" counts as negated. That is a repair-range migration (0094+) redefining `p5_claims_official_pmi`, plus the mirror.
- The orchestrator decides.

**2. The DG2 gate-submission snapshot note.** *"Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7."* (`workflows/gates.ts:916`, from `43942b6`, T-DG2-BE). It is written into every new gate-submission snapshot, which is part of the hashed snapshot content. It is an approved DG2 text, so changing it needs the orchestrator. A proposed text is *"Product gate (business approval inside the product); unrelated to the engineering delivery gates."* A change affects only new snapshots' canonical JSON and hash; existing snapshots keep theirs.

**User-facing texts my work made untrue:** none found. No en/ar string calls `/me/navigation` planned. One **code comment** is now untrue and is not my file: `apps/api/src/modules/identity/index.ts:6` "P5 (T-DG5-BE-A stub; …): GET /me/navigation". It is for the orchestrator or BE-A's file owner.

## 7. What remains, and the closing checks

- **Acceptance 3 is not met by this run.** The full `pnpm test:integration` did not finish within my time budget. The runner stopped it at 250/277 files, with no failure. It is **not** reported as passed.
  - **For the orchestrator:** rerun it at integration with a background limit above 1 hour. The serial suite took about 60 minutes for 250 files under the W15 load.
  - **Already covered:**
    - `contract.test.ts` (82), `navigation.test.ts` and `branding.test.ts` passed in the full run;
    - all five of my integration files passed in the targeted run (49/49).
  - **Not run in this task:** the other 23 not-run files, which are not mine, were not run here.
- **Pinned counts:** no pinned-count change was needed. `contract.test.ts` passed unmodified apart from my 3 named lines.
- **Waiting on others:**
  - the 22 web label keys (§5.1);
  - the `DELIVERED_P5_SCREENS` flips at the FE-C/FE-D merge (§5.2);
  - the orchestrator's decision on the five reported texts (§6);
  - the final re-run of the scans at the freeze, after every P5 FE text and BE-N template is merged (§I.5 item 3; QA).
- **Stale code comment:** `identity/index.ts:6` (§6).
- **Separable second half:** none; the section's items are all implemented.
- **Ended:** `2026-10-16T13:13Z`, after about 117 minutes.
- **Harness artefacts:** the empty `.claude`/`.cc-writes` directories under `apps/` and `packages/` were removed with `rmdir` only (never the root `.claude`). Any made by the handback's own writes are environment artefacts, not part of the change.
