# Handback T-DG5-BE-Q (backend-workflow-engineer): the 165 verbatim blocks, block reads and links in both directions (p5-work-split §I.1)

## 0. Continuation run (T-DG5-BE-QB)

### Run details

- **Interrupted run:** `DG5-T-DG5-BE-Q-backend-workflow-engineer-20261014T214728Z-5877d370` (session `5877d370-f793-40e0-82a7-72a9d6784372`). A container restart on 2026-10-14 stopped it (exit 143, no result). D-151 and the D-147 procedure apply.
- **Continuation run:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-QB-backend-workflow-engineer-20261014T232552Z-b97934d2","session_id":"b97934d2-150a-4d1c-8307-dc8c00bc2373"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-QB.md`, sha256 `be25d597554ca2540f482e6113d7b4893838964e361f9ca19d2824d7712ac784` (verified at the start).
- **Time:** start `2026-10-14T23:26:06Z`, end `2026-10-15T00:32:54Z` (`date -u`).
- **Tree:** the WIP commit `d3c0854` on `dg5/be-q`, plus the uncommitted changes listed below.

### What I found (the handback compared with the tree)

- **Every file in §2 exists and holds what §2 says:**
  - `reader.ts` and `source-links.ts`;
  - the four registration lines in `routes.ts`;
  - `mapP5PlaybookBlockError` and its one chain line in `db-errors.ts`;
  - the eight tests in `playbook-blocks.test.ts`;
  - the four operations and their mirrors in `p5-exercises-be-q.ts`;
  - `P5_PENDING_BE_Q` set to `[]`;
  - `0092`;
  - the generator, the parser, the docx dump and the three Arabic files.
- **`0092` is reproducible.** `node docs/delivery/handbacks/DG5/T-DG5-BE-Q-evidence/generate-0092.mjs` regenerated it **byte for byte** (`cmp` identical). It printed "165 blocks (73 headings), 240 links { template: 32, procedure: 13, requirement: 195 }".
  - sha256 of `0092`: `16ca6bec…ef23497`, as stated in §2.
  - sha256 of `playbook.md`: `5468e5e0…981378`, as stated in §2.
- **Incomplete parts of the handback:**
  - **§4 row 10 (full integration)** was still running at the restart. `integration-full.txt` is cut off mid-run, with no summary and no exit code. Its row held the placeholders `INTEGRATION_EXIT`/`INTEGRATION_COUNTS`.
  - **§4 row 11 (validator at the end)** never ran. `validate-dg4-end.txt` does not exist, although the old §1 cited it.
  - **The end time** was the placeholder `END_TIME`.
  - I corrected all of these in place (§1, §4).
- **One inaccurate code comment.** The header of `source-links.ts` named `resolveReaderVersion`, but the function is `readerContext`. I fixed the comment. No behaviour changed.
- **Old logs record no Node version.** The interrupted run's check logs don't show which Node ran them. This continuation run's own shell started on Node v22.22.2, so it re-ran everything with `/opt/nvm/versions/node/v24.21.0/bin` first on `PATH`. Every `-B` log records `node v24.21.0` on its first line.
  - A first pass of typecheck, build, lint and openapi:lint ran on v22 by mistake. All four exited 0. Those results are not reported here, and their logs were overwritten by the v24 runs.
- **Nothing in §I.1 was left undone**, so no implementation was added. The only source change in this run is the comment.

### Changed in this continuation run (uncommitted, on top of `d3c0854`)

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/source-links.ts` | Header comment: `resolveReaderVersion` → `readerContext` (comment only). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-Q-backend-workflow-engineer.md` | This §0, plus corrections to §1 and §4 (placeholders replaced, the missing end check disclosed). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-Q-evidence/*-B.txt` (10 new logs) | The re-run evidence below. |

### Checks re-run on the final tree

All on Node 24.21.0, offline, ports 23910–23949, this worktree. No empty `.claude/.cc-writes` directory existed in a source folder (`find`, none). Logs are in `T-DG5-BE-Q-evidence/`. Each log ends with a `# command: … | exit=N` line that the shell wrote.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| B1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-start-B.txt` |
| B2 | `pnpm -r typecheck` | 0 | | `typecheck-B.txt` |
| B3 | `pnpm -r build` | 0 | | `build-B.txt` |
| B4 | `pnpm lint` | 0 | | `lint-B.txt` |
| B5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" in every batch. The npm warnings about unknown project config are noise. | `prettier-B.txt` |
| B6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint-B.txt` |
| B7a | `env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE -u LC_MESSAGES pnpm test` (locale unset; the log prints `locale vars: none`) | **0** | unit-node 105 files, 1885/1885; unit-web 72 files, 1400/1400; unit-formula-nocodegen 3 files, 259 passed + 2 skipped (261) | `unit-locale-unset-B.txt` |
| B7b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | unit-node 1885/1885; unit-web 1400/1400; unit-formula-nocodegen 259 + 2 skipped (261) | `unit-c-utf8-B.txt` |
| B8 | `QA_PG_PORT=23910 MTH_PORT_POOL=23911-23949 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | 230 files, 2232/2232 passed. Includes `playbook-blocks.test.ts` 8/8 and `contract/contract.test.ts` 74/74. PostgreSQL 16.13 bound port 23910 on attempt 1. Duration 1516 s. | `integration-full-B.txt` |
| B9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-end-B.txt` |

- **Failures and flakiness:** every Vitest invocation in B7a, B7b and B8 passed. None failed, timed out or was flaky. The two load timeouts of the interrupted run (§4 note B) did not recur.
- **The 2 skipped tests** in unit-formula-nocodegen are the by-design skips that run 7a of the interrupted run also reported.
- **Pinned counts:** none changed.
  - All four operations are GETs, so the media-type triple `[361, 360, 1]` is unchanged. So is the 846 operation count.
  - The rate-limit floor is `>=`.
  - Pending delta: `P5_PENDING_BE_Q` went from 4 to 0 (§5.3).

### Still true, and still open for the orchestrator

- §5.5: the launch-check port decision.
- §5.6: no web route exists for a requirement link, and the route patterns need FE-G's confirmation.
- §6: the two i18n keys for FE-G.
- §7: the interpretations.

None of these changed. FE-G owns the user-facing text items. This run changed no en/ar string, and none became untrue.

- **Stage / gate:** P5 "Configuration automation and outputs", DG5 (BUILDING). Wave W8.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-Q-backend-workflow-engineer-20261014T214728Z-5877d370","session_id":"5877d370-f793-40e0-82a7-72a9d6784372"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-Q.md` (sha256 `701ae482…737ed3d`, verified at the start).
- **Working tree:** `/home/user/wt/dg5-be-q`, branch `dg5/be-q`, base `b8c9769` (D-150).
  - The interrupted run's work was committed by the orchestrator as WIP `d3c0854` (D-151).
  - The continuation run's changes on top of it are **uncommitted**, as the assignment asks.
- **Time:** the interrupted run started at `2026-10-14T21:47:42Z` and never ended (container restart). The continuation run's times are in §0.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Reading the playbook approves nothing. No business, Finance or IT approval is granted. All test data is synthetic.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG4` → **exit 0**, `PASS gate DG4 (historical)`, at the interrupted run's start (`T-DG5-BE-Q-evidence/validate-dg4-start.txt`). That run never reached its end check, so `validate-dg4-end.txt` was never written. The continuation run ran it at its start and at its end (§0: `validate-dg4-start-B.txt`, `validate-dg4-end-B.txt`).

## 2. Files changed

| File | Purpose |
|---|---|
| `packages/db/migrations/0092_p5_playbook_blocks.sql` (new, generated) | Seeds the 165 `playbook_block` rows (`text_en` verbatim, provisional `text_ar`, `is_heading`, `section_block_ref`, `phase_code`) and the 240 `playbook_block_link` rows: 32 template, 13 procedure and 195 requirement links. |
| `apps/api/src/modules/methodology/reader.ts` (new) | Resolves the reader's version (latest published `methodology`/`playbook`, or the transformation's pin through `ConfigResolver` with `transformation.read`, else 404). Serves `listMethodologyBlocks` and `getMethodologyBlock`, the guidance from `block.<ref>`, and the shared resolved-link function (seed + `linksAdded` − `linksRemoved`). Holds the zod mirrors. |
| `apps/api/src/modules/methodology/source-links.ts` (new) | Serves `listMethodologyBlockLinks` (labels, web routes, `origin`, `launchable`) and `listTemplateSourceLinks` (the reverse, template → blocks). Holds the zod mirrors. |
| `apps/api/src/modules/methodology/routes.ts` | Four named registration lines (two imports, two calls), marked `BE-Q (slice I)`. |
| `apps/api/src/modules/platform/db-errors.ts` | Adds `mapP5PlaybookBlockError`: the `playbook_block*` guards → 500 (programming error), plus one line in the chain. |
| `apps/api/test/integration/methodology/playbook-blocks.test.ts` (new) | Eight integration tests against real PostgreSQL (§3). |
| `apps/api/test/integration/contract/p5-exercises-be-q.ts` | Exercises the four operations (success plus every reachable declared refusal) and their zod mirrors. |
| `apps/api/test/support/p5-pending-be-q.ts` | The pending list, 4 → 0. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-Q-evidence/` | The generator (`generate-0092.mjs`, `parse-playbook.mjs`), the docx heading dump (`docx-headings.py` → `docx-headings.txt`), the provisional Arabic (`translations-ar-{1,2,3}.mjs`) and every check log. |

To regenerate `0092`, run `node docs/delivery/handbacks/DG5/T-DG5-BE-Q-evidence/generate-0092.mjs` from the repository root. The output is deterministic (sha256 of `0092`: `16ca6bec022e77fce0034aa9a6c33a833879c5810c805f8dc5c7d4a47ef23497`; source `playbook.md`: `5468e5e0…981378`).

## 3. Behaviour delivered, per requirement row

### REQ-S02-004 (BE-Q: seeded links, both directions; BE-Q2 adds the Studio link edits; FE-G adds the screens)

Acceptance (quoted): *"A01: opening block B0031 (Template 1) shows a link that opens the T01 register; the T01 form shows a source link back to B0031"*.

- `GET /methodology/blocks/B0031/links` returns `{targetKind: "template", targetKey: "T01", labelEn: "Template 1 — Current-State Diagnostic", labelAr: "النموذج 1 — تشخيص الوضع الحالي", origin: "seed", launchable: false}`.
  - Its `route` is `/transformations/{id}/diagnose` (the T01 grid) in a transformation context, else `/transformations`.
  - The block also links its register row `REQ-PB-026`.
- `GET /methodology/templates/T01/source-links` returns `B0030` and `B0031`, with excerpts. All 16 templates return their heading and table blocks.
- A methodology version's `block.<ref>` element changes only that version's resolved list. The test pins one transformation to a synthetic version that adds `baseline_validation` and removes `REQ-PB-026` and `T01` from B0031:
  - that version shows the added link (`origin: "version"`), loses the two removed ones, and carries its guidance and its link count;
  - the published `playbook` and a v1-pinned transformation keep the seed;
  - the reverse direction follows the version: T01 → `[B0030]` there, and `[B0030, B0031]` elsewhere.
- Seed derivation (generated, not hand-written):
  - **Template links:** each "Template N —" heading and the table right after it → `TNN` (asserted 16 × 2).
  - **Requirement links:** every register row whose `source_ref` cites the block (195 links, from `docs/delivery/requirements.csv` at generation time; later rows go through Studio `linksAdded`).
  - **Procedure links:** the ten ADR-0042 procedures → the block whose practice each executes. This is an engineering default, because the playbook does not name the procedures (listed in the `0092` header). For example, `gate_review` → B0023 (the stage gates).
- The FE half (the reader's link list, the T01 form's "Source: B0031") is FE-G's.

### REQ-S03-010 (BE-Q: blocks; BE-Q2 adds search; FE-G adds search and Launch)

Acceptance (quoted): *"A01: searching 'value pools' returns the Diagnose blocks; the 'Launch' action on the gate-review procedure creates a procedure instance"*.

- **Delivered by BE-Q:**
  - the 165 blocks with stored `search_en`/`search_ar`, which the 0089 generated columns compute from the seeded texts;
  - the phase sections (Diagnose B0025–B0043 … Realize B0117–B0131, each boundary asserted against the file);
  - block list and get, with phase filter and cursor;
  - `launchable` on procedure links. In the test, TO in a readable transformation gets `true` for `gate_review` on B0023. Without a transformation, and for AUD or a user with no grants, it is `false`.
- **Not BE-Q's:** `searchMethodology` (the "value pools" search) is BE-Q2's operation. Launch itself is `launchProcedureInstance` (slice C) called from FE-G's button. This row completes with BE-Q2 and FE-G; I do not claim its acceptance.
- **Tests (literal, §I.1):**
  - 165/165 blocks equal `docs/source/playbook.md`. The test reads the file once and parses it independently of the generator.
  - `text_en` cannot be changed: `playbook_block_immutable` refuses changes to `text_en` and `section_block_ref`, and any delete. A link delete is refused (append-only). mth_app gets 42501. Only the owner may correct `text_ar` (shown rolled back).
  - A pinned read without `transformation.read` gives 404 on all four operations, for a user with no grants and for another organization's TO. An unknown transformation id gives the same 404.

## 4. Checks of the interrupted run (history only; §0 holds the evidence for the final tree)

These logs record no Node version, so they can't show which Node ran them. Each one is superseded by its `-B` log in §0.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | PASS | `validate-dg4-start.txt` |
| 2 | `pnpm -r typecheck` | 0 | | `typecheck.txt` |
| 3 | `pnpm -r build` | 0 | | `build.txt` |
| 4 | `pnpm lint` | 0 | | `lint.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `prettier.txt` |
| 6 | `pnpm openapi:lint` | 0 | PASS, 846 operations | `openapi-lint.txt` |
| 7a | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | unit-node 1885/1885; unit-web 1400/1400; formula-nocodegen 259 + 2 skipped by design | `unit-c-utf8.txt` |
| 7b | `pnpm test`, locale unset, run 1 (before a fix) | **1** | unit-node 2 failed / 1883 (see note A) | `unit-locale-unset-run1-before-fix.txt` |
| 7c | `pnpm test`, locale unset, run 2 (after the fix) | **1** | unit-node 1884/1885 and unit-web 1399/1400: one timeout each, under load (note B); formula-nocodegen 259 + 2 skipped | `unit-locale-unset.txt` |
| 7d | the two tests of 7c, alone, locale unset | 0, 0 | `architecture.test.ts` 139/139; `raid.test.tsx` 18/18 | `unit-locale-unset-reruns.txt` |
| 8 | `QA_PG_PORT=23900 … with-pg.sh npx vitest run --project integration …/playbook-blocks.test.ts` | 0 | 8/8 | `it-playbook-blocks-run1.txt` |
| 9 | `QA_PG_PORT=23902 … with-pg.sh npx vitest run --project integration …/contract/contract.test.ts` | 0 | 74/74 | `it-contract-run1.txt` |
| 10 | `QA_PG_PORT=23910 MTH_PORT_POOL=23911-23949 tests/qa/support/with-pg.sh pnpm test:integration` | **none** | Interrupted by the container restart. The log is truncated mid-run, with no summary and no exit code. **Not evidence.** Superseded by §0 row B8. | `integration-full.txt` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **not run** | Never reached. `validate-dg4-end.txt` does not exist. Superseded by §0 row B9. | none |

**Note A (a real defect of mine, fixed).** Run 1 failed in `architecture.test.ts` and `methodology.test.ts`: *"modules/methodology/reader.ts: computed member with a non-literal key (line 186) bypasses the module-interface check"*. The cause was `LINK_KEY[kind]` (F-DG1-124). I replaced it with a `Map` lookup. Both suites then passed (143/143), and so did run 7a, which started after the fix.

**Note B (load timeouts in code I did not change).** Run 2 had two timeouts while four W8 runs shared the machine. The unit-node phase took 264 s, against 117 s in run 1.
- `architecture.test.ts` "every import respects dependsOn…" hit `Test timed out in 30000ms`, with a vitest `Timeout calling "onTaskUpdate"` unhandled error.
- `raid.test.tsx` "action register: source, follow-up date and overdue flag; edit sends If-Match" could not find a link in time. I changed no web code.

Both passed in 7a (`C.UTF-8`) and alone with the locale unset (7d). I report 7c as exit 1, not as a pass. The orchestrator's merged-tree run is the full check.

**End time:** none. The interrupted run ended at the container restart (exit 143, no result). The continuation run's end time is in §0.

## 5. Contract, schema, migration and wiring notes for the orchestrator

1. **Migration `0092`** (my assigned number, §J.5). Forward-only and generated: change the generator, never the file. It needs `0089` (tables, guards) and `0064`/`0069` (template labels, procedure codes; the links themselves have no FK to them). `seed.test.ts`'s rule holds: 0092 ≤ 0099 and strictly increasing.
2. **Contract test pins:**
   - all four operations are GETs, so the media-type triple `[361, 360, 1]` and the 846 operation count are unchanged;
   - the rate-limit floor is `>=`;
   - `exerciseMalformedPathParams` and the U+0000 query sweep cover the new routes (contract run 74/74).
3. **Pending delta:** `P5_PENDING_BE_Q` 4 → 0 (−4: `listMethodologyBlocks`, `getMethodologyBlock`, `listMethodologyBlockLinks`, `listTemplateSourceLinks`). Each is exercised in `p5-exercises-be-q.ts`.
4. **Refusal codes (rule 15):** exactly ADR-0049 §11:
   - 404 `methodology_block.not_found` "This playbook block does not exist.";
   - 404 `methodology_template.not_found` "This template does not exist.".

   The second is coded but not reachable today. The path pattern admits only T01–T16, and all 16 are seeded in `source_element`, so the contract exercise can't trigger it. An unreadable or unknown transformation gives the platform 404 `not_found` (never disclosed). 403 is declared by the contract, but no session caller reaches it on these reads.
5. **`launchable` without importing `procedures`.** `methodology` may not import any P5 module (`architecture.test.ts`, p5-plan §3 seam 24), and `server.ts` is not mine. So `source-links.ts` evaluates ADR-0042 §9–§10's launch check itself, without throwing, in `launchProcedureInTx`'s order:
   - it uses the `procedure` pin, else the newest published `procedures` version, with its lineage rows;
   - the definition must be published and not removed, and its scope must match the context;
   - the caller needs `procedure.read` and `procedure.launch` through one of the definition's launch roles.

   If slice C's launch rules change, this mirror must change too. A cleaner alternative is a `ProcedureLaunchCheck` port that `server.ts` injects into `registerMethodologyModule`. Decide whether you want it; the change is outside my files.
6. **Web routes in `MethodologyLink.route`** (FE-G, please confirm, or ask me to change them):
   - template → `/transformations/{id}/<page>` (T01 `diagnose`, T02 `define`, T03 `design`, T04 `decisions`, T05 `portfolio`, T06 `prioritization`, T07 `roadmap`, T08 `dependencies`, T09 `benefit-formulas`, T10 `dashboard`, T11 `decision-rights`, T12 `raci`, T13 `adoption`, T14 `benefits`, T15 `raid`, T16 `executive-decisions`), or `/transformations` without a context;
   - procedure → `/admin/procedures/{code}`, FE-D's planned definition page. It is an admin page; a non-admin reader page for a definition does not exist yet;
   - requirement → `/playbook/requirements/{REQ-ID}`. **No web route exists for it yet** (the router has none, and no API reads the register). FE-G or the orchestrator should add it, or tell me the route to use.
7. **Labels:**
   - a requirement link is labelled `Requirement REQ-…` / `المتطلب REQ-…`, because the register is not in the database;
   - a procedure link uses the resolved definition's `name_en`/`name_ar`;
   - a template link uses the `source_element` labels.
8. **No new dependency, secret or CDN.** No shared schema file was edited: the zod mirrors live in my two module files, on the BE-F2 precedent.

## 6. User-facing texts (F-DG4-160)

- **i18n keys for FE-G:** `methodology_block.not_found` and `methodology_template.not_found` have no entries in `apps/web/src/i18n/{en,ar}` yet. That locale file is not mine.
  - en: as in §5.4.
  - ar (provisional): «كتلة الدليل هذه غير موجودة.» / «هذا النموذج غير موجود.».
- **No existing en/ar string became untrue.** The `nav.*` reader strings are neutral ("The published methodology to read and search…"). The reader screen's `availability` in `apps/web/src/app/nav.ts` is FE-owned and stays `planned` until FE-G merges `pages/playbook/**`. This task ships the API, not the screen.
- **Provisional Arabic.** The 165 `text_ar` values are a provisional translation drafted by an engineering agent, seeded `ar_provisional = true`. A Mobily Arabic editor must review them.
  - Proper names (PMI, Brightline) and URLs are kept.
  - Terminology follows the shipped seeds (`0011`, `0051`, `0064`).
  - Each Arabic table keeps the source's row count (asserted by the generator and the test).
  - Nothing in the Arabic claims official PMI status: B0124 is rendered «تتوافق هذه المرحلة مع منطق إدارة تحقيق المنافع من PMI…», and B0163 «المراجع الأصلية».

## 7. Known gaps, interpretations and limits

1. **Heading levels come from the source docx**, because the Markdown has no heading marks. The rule is: a bold paragraph at size 16 is a kicker, at 46/68 a title, and at 28 a sub-heading. `docx-headings.txt` was produced by `docx-headings.py` from the docx in `docs/source/`, whose 165 body items align 1:1 with the anchors (asserted). That gives 73 headings, and `section_block_ref` = the nearest earlier heading of a higher level.
2. **The procedure → block mapping is an engineering default.** Neither the playbook nor ADR-0042 gives it. An admin can change it per version through Studio (BE-Q2's attribute validation).
3. **The requirement links are a snapshot of the register** at generation time (195 links). A migration never re-reads the CSV.
4. **Excerpts** in `TemplateSourceLink` are the first 280 characters plus "…" (the contract fixes no length).
5. **REQ-S03-010's "value pools" search and "Launch"** are not delivered here (BE-Q2, FE-G, slice C).

## 8. What remains

- **For this task:** nothing in §I.1's file list remains. Everything listed in §I.1 is delivered and tested.
- **For others:** BE-Q2 (search, provenance, profiles, guiding questions, the Studio attribute validation for `linksAdded`/`linksRemoved`); FE-G (the reader, the source link, the i18n keys in §6, the requirement route in §5.6); the orchestrator's decision on the launch-check port (§5.5).
