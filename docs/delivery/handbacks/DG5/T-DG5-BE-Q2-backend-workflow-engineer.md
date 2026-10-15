# Handback T-DG5-BE-Q2 (backend-workflow-engineer): p5-work-split §I.2

**Search, provenance, element profiles, guiding questions, and the reader namespaces in Studio.**

- **Stage:** DG5 (P5), BUILDING.
- **Invocation:** `DG5-T-DG5-BE-Q2-backend-workflow-engineer-20261015T101847Z-4c8aea42`, session `4c8aea42-e112-469a-b5b5-a45001d1e695`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-Q2.md`. The sha256 `6a928351…3937a` was verified before starting.
- **Worktree:** `/home/user/wt/dg5-be-q2`, branch `dg5/be-q2`, base `1487877` (the integrated `HEAD`).
- **Changes:** left uncommitted for the orchestrator.
- **Time:** started `2026-10-15T10:27:05Z`, ended ``2026-10-15T12:08:57Z` (about 1 h 42 min; the full integration run alone took 53.5 min under a load average of 10–19)`.
- **Product gates:** nothing here grants or records a business, Finance or IT approval, and nothing reads or writes DG0–DG7. All test data is synthetic.

## 0. Preceding gate

- **Command:** `node tools/gates/validate.mjs --historical --stage DG4`, run before implementation.
- **Result:** exit 0, `PASS gate DG4 (historical)`.
- **Log:** `T-DG5-BE-Q2-evidence/validate-DG4-historical-start.log`.
- It was re-run at the end; the result is in §3.

## 1. Changed files

### New files

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/search.ts` | `searchMethodology`. Covers `websearch_to_tsquery('english'\|'arabic')` against `search_en`/`search_ar`, ordering by `ts_rank` then `block_ref`, and cursor pages on (rank bucket, `block_ref`). `ts_headline` uses private sentinels (U+E000/U+E001), which become `highlights[{offset,length}]` (UTF-16). No HTML is ever returned. Also the `q` rule (400 `validation.search_query`), the default language (the caller's `preferred_locale`), and the zod mirrors. |
| `apps/api/src/modules/methodology/provenance.ts` | `getMethodologyProvenance`. Returns the verbatim blocks B0004 (statement), B0024 (connection), B0157–B0162 (custom extensions) and B0124 (Realize note); the three B0156 `source_foundation` rows; and the version's `provenance.note` (or null). Also the zod mirrors. |
| `apps/api/src/modules/methodology/element-profiles.ts` | `listMethodologyElements`: the 56 profiles resolved per version, with `profile.<element_ref>` overrides and `overridden`, filtered by `provenance` and `kind`. `listGuidingQuestions`: the four B0016 questions. Also the **Studio reader-namespace rules** of ADR-0049 §6 with the §11 codes (`validateReaderElement`), composed in front of the `methodology` kind's `validateElement` hook (see §6.1). Also the zod mirrors. |
| `apps/api/test/integration/methodology/reader-search-provenance.test.ts` | The literal tests of §I.2 and more (15 tests). |
| `apps/api/test/integration/contract/p5-exercises-be-q2.ts` | The contract seam: the four operations through the validating client, each with success and every reachable refusal. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-Q2-evidence/*` | Logs of every check below. |

### Edited files (named lines only)

| File | Lines |
|---|---|
| `apps/api/src/modules/methodology/routes.ts` | 3 import lines and 3 registration lines, after BE-Q's, each marked `// BE-Q2 (slice I)`. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP5MethodologyReaderError` (the `methodology_element_reader_*` constraints → the §11 codes) and its 2 dispatch lines, after BE-Q's. |
| `packages/shared/src/schemas/studio.ts` | `CONFIG_ELEMENT_ATTRIBUTES.methodology_text` gains the optional `provenance`, `questionTag`, `linksAdded` and `linksRemoved` (named lines with a comment). Nothing else in the file changed. |
| `apps/api/test/support/p5-pending-be-q2.ts` | The list is now empty (all four operations are routed). |
| `apps/api/test/integration/contract/contract.test.ts` | 3 named lines (`// T-DG5-BE-Q2`): the import of `p5-exercises-be-q2.ts`, the `...P5_MIRRORS_BE_Q2` spread, and one `it(...)` that runs the seam. The contract test fails if a routed operation is not exercised, and no BE-Q2 seam was pre-wired (BE-A wired only `p5-exercises-be-q.ts`). This follows the BE-I2/BE-F2 precedent (they wired their own seams). **Pinned counts are unchanged:** the four operations are bodiless GETs, so the media-type triple is unaffected, and the rate-limit floor is a `>=` bound. |

### No migration, no new dependency

I wrote no migration (slice I gives BE-Q2 none). I added no dependency.

## 2. Behaviour delivered, per requirement row

The acceptance texts are quoted from `docs/delivery/requirements.csv`. Each row is judged on its own acceptance text (D-142 R1). Where a row is completed by another task (§I.6), I deliver the BE-Q2 part only, and say so.

### REQ-S03-010 (BE-Q2 part: search)

- **Acceptance:** "A01: searching 'value pools' returns the Diagnose blocks; the 'Launch' action on the gate-review procedure creates a procedure instance".
- **Delivered:** `GET /api/v1/methodology/search` (`searchMethodology`), in session, with `transformationId` → `transformation.read` (else 404).
- **Test results:**
  - "value pools" (`lang=en`) returns B0029, the probe PB03 Diagnose match.
  - With `phase=diagnose`, every hit has `phaseCode = diagnose`, and the hits include every Diagnose block whose text contains "value pools".
  - Highlights cover only value/pool words, and the snippets are excerpts of the verbatim text with no `<b>` and no sentinel.
  - An Arabic query (a word of B0124's `text_ar`) returns B0124 from `search_ar`, with `lang = ar`. The same word against `lang=en` returns nothing. Without `lang`, the caller's `preferred_locale` decides (`ar` by default).
  - `q` of 1 character gives 400 `validation.search_query` with "Enter a search term of 2 to 200 characters.". So do blank, invisible-only, missing, repeated and 201-character values, and NUL.
  - Pages never repeat a block.
- **Launch:** the "Launch" half is slice C's `launchProcedureInstance` plus FE-G (ADR-0049 §3). BE-Q's `launchable` flag on links is already merged. I did not change it.

### REQ-PB-001 (BE-Q2 part: provenance)

- **Acceptance:** "A01: provenance text on reader/About/report footer matches B0004 verbatim; an automated text scan of UI strings (en+ar) and report templates finds no claim of 'official PMI standard', 'PMI certified' or equivalent".
- **Delivered:** `GET /api/v1/methodology/provenance`.
- **Test results:**
  - `statement.textEn` equals B0004 verbatim (literal string in the test). Each quoted block equals the catalogue `text_en`.
  - The SQL rules `p5_claims_official_pmi`/`p5_mentions_engineering_gate` find **no** claim and no DG0–DG7 in any string of the response.
  - A version's `provenance.note` is shown beside the unchanged statement.
- **Not mine:** the UI/report-template text scan is BE-R2's, and the report footer is BE-N/BE-R's.

### REQ-PB-002

- **Acceptance:** "A01: every seeded element listed in B0158-B0162 returns provenance=custom-extension from the API and renders the badge in en and ar; no such element is labelled as a PMI standard".
- **Delivered:** `GET /api/v1/methodology/elements`.
- **Test results:**
  - `?provenance=custom_extension` returns exactly **50** rows: phase 6, gate 6, tom_dimension 10, template 16, scoring_model 1, forum 5, launch_window 3, health_check 1, roaming_example 1, traceability_chain 1.
  - Every one of them has `provenanceSourceRef` in B0158–B0162.
  - The 6 `foundation_inspired` rows are the benefit-lifecycle steps (B0156).
  - No label or provenance value matches "PMI standard/official/certified", and the SQL claim rule is false on every en and ar label.
  - Studio overrides resolve per version, with `overridden: true`.
- **Notes:**
  - The contract's enum value is `custom_extension` (underscore). The acceptance text writes "custom-extension".
  - The en/ar badge rendering is FE-G's.

### REQ-PB-011

- **Acceptance:** "A01: all four questions render verbatim (en) with ar translations; every seeded template has exactly one question tag".
- **Delivered:** `GET /api/v1/methodology/guiding-questions` and the `questionTag` of `listMethodologyElements`.
- **Test results:**
  - The four questions match B0016 verbatim in English: each `textEn` is contained in B0016's `text_en`, and the literal list is asserted.
  - Each has an Arabic `textAr`.
  - Each of T01–T16 has exactly one tag from the four codes, and every non-template has `null`.
  - A version can re-tag a template (T05 → `how_prove_value`) without changing other versions.
- **Not mine:** rendering in the reader and form headers is FE-G's.

### REQ-PB-077 (BE-Q2 part: `realizeNote`)

- **Acceptance:** "A01: Realize guidance shows 'aligns with PMI Benefits Realization Management logic' and no 'certified'/'official' wording".
- **Test results:**
  - `realizeNote` is B0124, and its `textEn` contains "aligns with PMI Benefits Realization Management logic".
  - The claim scan of the response passes.
- **Not mine:** the Realize guidance screen is FE-G's.

### REQ-S02-004 (BE-Q2 part: Studio link edits)

- **Acceptance:** "A01: opening block B0031 (Template 1) shows a link that opens the T01 register; the T01 form shows a source link back to B0031".
- **Already merged (BE-Q):** the seeded links, both directions.
- **Delivered here:** Studio `PUT …/elements/methodology_text/block.<Bxxxx>` now accepts `linksAdded`/`linksRemoved` (they were refused before, because the zod shape was strict). They are validated with 422 `methodology_reader.invalid_block_link` before the database.
- **Test result:** a valid edit (add `procedure:baseline_validation`, remove `requirement:REQ-PB-026`) is accepted with one audit event.

### §I.2 literal Studio tests

All of these refusals happen before the database, and nothing is written:

- `profile.phase.diagnose` with a `questionTag` gives **422 `methodology_reader.invalid_override`**, with the exact §11 English text. So do:
  - an unknown tag or element;
  - a provenance outside the set, or null;
  - links on a profile key;
  - a reader attribute outside its namespace.
- `invalid_block_link` is given for:
  - an unknown block;
  - a profile attribute on a block key;
  - a bad link kind or key;
  - a non-array;
  - 51 links;
  - links outside `block.*`.
- A note claiming certification ("This methodology is PMI certified.", "منهجية معتمدة من PMI", "an official PMI standard product") gives **422 `methodology_reader.prohibited_text`**. So do "DG7" in block guidance and a "PMI-certified" profile label.
- The true disclaimer "Not an official PMI standard …" (en and ar) is accepted.
- **AUD gets 403** on these Studio writes, and so does TO; nothing is written.
- Valid writes:
  - succeed with one audit event per row;
  - `If-Match` missing gives 428, and stale gives 409.
- The database mapping of the four `methodology_element_reader_*` constraints gives the same codes.

### Shared rules (§2)

- **Rule 1:** `q` goes through `hasInvalidCharacter`/`hasText`.
- **Rule 2:** the routes use the central parser; there are no route-local parsers.
- **Rule 3:** no body, so `consumes` is not declared.
- **Rule 4:**
  - My routes are reads.
  - The Studio writes are BE-B's route. I added validation only, and tested it together with its authorization, `If-Match` and audit.
- **Rule 5:** the rank is never returned.
- **Rule 6:** codes are i18n keys (see §6.3).
- **Rule 7:** AUD 403 is tested.
- **Rule 8:** ports 24101–24149, and both locales are run.
- **Rule 13:** the tests read no delivery folder.
- **Rule 14:** the seam is in place.
- **Rule 15:** the §11 texts are exact.
- **Rule 16:** no migration.
- **Rule 17:** no dependency.
- **Rule 18:** no worktree was added.

## 3. Checks actually run

The environment was Node 24.21.0, offline, in worktree `/home/user/wt/dg5-be-q2`, with harness ports 24101–24149. Up to four W10 agents ran on the machine; the load average was about 10–12 during the runs.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-DG4-historical-start.log` |
| 2 | `pnpm -r typecheck` (final tree) | 0 | all workspace packages | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | | `build.log` |
| 4 | `pnpm lint` (final tree) | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | 0 | "All matched files use Prettier code style!"; the handback file was checked separately (exit 0) | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 111 files / **1943** passed; unit-web 72 / **1400**; unit-formula-nocodegen 3 / **259** passed + 2 skipped | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 1943; 1400; 259 + 2 skipped | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=24110 MTH_PORT_POOL=24111-24149 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **244 files / 2358 tests passed**, 0 failed, 0 skipped, no retries; 3207.96 s. Includes `reader-search-provenance.test.ts` (15) and `contract.test.ts` (76, with the new BE-Q2 seam). No pinned count changed. | `integration.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-DG4-historical-end.log` |

### Disclosed non-zero exits during development

These were all fixed before the final runs above.

- **First lint run: exit 1.** `HttpProblem` was imported as a value but used only as a type. Fixed.
- **First prettier run: exit 123.** Three of my files were unformatted. Fixed with `prettier --write` on my files only.
- **First run of my test file: exit 1.** Two tests failed, and both were real findings:
  - **Pagination bug.** The outer `ORDER BY bucket` bound to the `bucket::text` alias, so pages repeated blocks. Fixed: it now orders by the bigint `h.bucket`, and the alias is now `bucket_text`.
  - **Arabic word selection.** The test's word sat before an Arabic comma; see §6.2.
- **Targeted re-run:** methodology plus contract, 13 files / 192 tests, exit 0.

## 4. Operations routed (delta to my pending list)

| Pending list | Before | After |
|---|---|---|
| `p5-pending-be-q2.ts` | `searchMethodology`, `getMethodologyProvenance`, `listMethodologyElements`, `listGuidingQuestions` | `[]` |

All four are exercised in `p5-exercises-be-q2.ts`, and their bodies are checked against the mirrors in `P5_MIRRORS_BE_Q2`.

| Operation | Responses exercised |
|---|---|
| `searchMethodology` | 200 (en, ar, phase, pinned, second page); 400 `validation.search_query` (1 character, missing); 400 (bad `lang`, a cursor from other filters); 404 (unreadable transformation, unknown transformation) |
| `getMethodologyProvenance` | 200 (published, pinned); 400; 404 |
| `listMethodologyElements` | 200 (all, filters, pinned); 400 (bad `provenance`, bad `kind`); 404 |
| `listGuidingQuestions` | 200; 400 (unknown parameter) |

- **401:** covered by the platform sweep and by my integration test.
- **403:** declared by the contract, but no session caller can reach it (an unreadable transformation is 404, never disclosed), the same as BE-Q's seam.

**Pinned counts:** no change. There are no new request media types, and the operation count (846) is unchanged, because the operations were already declared.

## 5. Contract, schema or dependency needs (for the orchestrator)

None is blocking.

- **400 code placement.** I followed the platform's 400 convention (`problems.badRequest`): the top-level `code` is `validation`, and `errors[0].code` is `validation.search_query` with pointer `/query/q`. If the ADR meant the top-level code, it is a one-line change in `search.ts`.
- **Contract nit.** The OpenAPI parameter `q` has `required: true`. My route answers a missing `q` with the §11 code (400 `validation.search_query`), not a generic "required" error. This is deliberate, so every bad `q` gets one refusal.

## 6. Notes for integration and reviewers

### 6.1 How the Studio rules are attached

The reader rules have to run on BE-B's element `PUT`, before the database (ADR-0049 §6), but `providers/methodology-kind.ts` and `invariants.ts` are not in my ownership.

- **What I did:** `registerMethodologyElementProfileRoutes` calls `registerReaderStudioRules()`, which re-registers the `methodology` provider with a `validateElement` that runs `validateReaderElement` and then BE-B's own hook. All other hooks are kept.
- **Why it works:** the call is idempotent (a `WeakSet` marks the composed hook), and it runs after `elements.ts` registers BE-B's provider, because the `routes.ts` order puts BE-Q2's line after BE-B's. Preview and compatibility (`elementRowFindings`) run the same hook, so a stored invalid row also becomes a `fail` finding there.
- **Alternative:** if the orchestrator prefers a named call line inside `methodology-kind.ts`, that is a 2-line move.

### 6.2 Arabic search recall (not fixed here: frozen migration)

- **Finding:** in the C-locale test cluster, PostgreSQL's default text-search parser keeps Arabic punctuation (U+060C "،", likely also U+061B "؛" and U+061F "؟") attached to the preceding word. B0124's `search_ar` holds `'متوقعة،'`, so the query "المتوقعة" (stem `'متوقع'`) does not find that occurrence.
- **Where it comes from:** the `0089` generated column `to_tsvector('arabic', text_ar)`. The route cannot correct it.
- **Possible fix (orchestrator/architect decision):** a repair-range migration that redefines `search_ar` over `translate(text_ar, '،؛؟', ',;?')`, or a production cluster with a UTF-8 `lc_ctype`. The behaviour also depends on the cluster's `lc_ctype`.
- **Impact:** REQ-S03-010's Arabic test still passes on words between spaces.

### 6.3 Problem-code translations (for the owner of `apps/web/src/i18n/{en,ar}/problems.json`, FE-G)

These codes need en and ar strings:

- `validation.search_query`;
- `methodology_reader.invalid_override`;
- `methodology_reader.invalid_block_link`;
- `methodology_reader.prohibited_text`.

I did not edit web files.

### 6.4 User-facing texts made untrue (F-DG4-160)

- **None.** I checked the en/ar i18n strings for the reader, search and provenance.
- `nav.json` lists the Playbook reader under "Being built in this release:". That stays true until FE-G ships `pages/playbook/**`.
- `common.methodBody` already says the methodology is not an official PMI standard, which agrees with this API.

### 6.5 Merge expectations

- **Additive conflicts are possible:**
  - in `routes.ts`, if another W10 task touches the methodology registration list;
  - in `db-errors.ts`, in the dispatch block;
  - in `contract.test.ts`, the import, mirror and `it` lines.
- **Resolution:** keep both sides.
- **Migrations:** none to run.

## 7. What remains

- Nothing in §I.2's file list or literal tests remains.
- **Open items for others:**
  - §6.2 (Arabic punctuation in `search_ar`: a migration decision);
  - §6.3 (web translations of the four codes);
  - FE-G's screens.
- The REQ-S03-010 "Launch" half and the REQ-PB-001 text scan belong to their owners (slice C/FE-G and BE-R2).
