# Handback T-DG7-QA-B (qa-verifier): A01–A16 re-run and the A06 bundle replay

- **Stage:** P7 / DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` = `f8f86a78d25f8641e290dacaacb525232c309ae4`. `git status` at start: clean apart from this run's own `docs/delivery/runs/DG7/DG7-T-DG7-QA-B-…/`.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-QA-B-qa-verifier-20261113T214440Z-20ba2c1e","session_id":"20ba2c1e-46aa-4bdd-8771-a44352490dea"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-QA-B.md`, sha256 `8f322f096d153d32a8062c9ad89fbdc5f3a11b8f54420f0cae205306e45bb392` (verified).
- **Time:** started 21:44:53 UTC and finished about 22:15 UTC on 2026-11-13.
- **Authorship:** this task wrote only acceptance tests under `tests/qa/**`. It edited no product code.

> **Path deviation (contradiction in the assignment).** The assignment asks for this handback at `docs/delivery/handbacks/DG7/T-DG7-QA-B-qa-verifier.md`, with logs in `docs/delivery/handbacks/DG7/T-DG7-QA-B-evidence/`.
>
> - The qa-verifier write guard refuses that path: `BLOCKED by write guard: qa-verifier may not write 'docs/delivery/handbacks/DG7/T-DG7-QA-B-evidence/…' (outside role write scope)`. `tools/agents/write-scopes.json` allows `tests/qa/**`, `e2e/**`, `docs/delivery/reviews/*/round-*/qa-verifier.*` and `docs/delivery/test-evidence/*/qa/**`.
> - The shell sandbox also refuses `mkdir` there with "Read-only file system".
> - The handback and logs are therefore in `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-B/`. The orchestrator may copy them to the handback path.

## 1. Files changed

| File | Change | Purpose |
| --- | --- | --- |
| `tests/qa/support/a06-suite.ts` | new (sha256 `f825385a…aaf99`) | The A06 suite (T-DG5-QA-A), moved verbatim into `defineA06Suite(opts)` so the same assertions can run on two installations. The only additions are the scratch DB name (`opts.dbName`), the beforeAll budget (`opts.setupTimeoutMs`, default 240 000 as before) and the optional `prepareTarget` hook. The hook runs once, after the synthetic world and the A06 sessions exist and before the existing transformation is created and pinned. `git diff --no-index -w` against `HEAD:tests/qa/integration/a06-configuration-change.test.ts` shows only those changes, the import paths (`../support/x` → `./x`) and one Prettier line wrap. |
| `tests/qa/integration/a06-configuration-change.test.ts` | rewritten as a caller (sha256 `582921cf…79640`) | `defineA06Suite({ dbName: "mth_qa_a06" })`: the same 27 tests on a clean migrated installation. The test titles are identical to HEAD's (diff of every `describe(`/`it(` title: no difference). |
| `tests/qa/integration/a06-bundle-replay.test.ts` | new (sha256 `faf9130f…c6d60`) | The A06 replay on an imported configuration bundle (work split §D.3 "A06 replay"; §D.6 REQ-S19-008). See section 2. |

- **Not changed:** `apps/api/test/support/p7-pending*.ts`. QA-B owns no pending entry, and `P7_PENDING_BE_F` is already `[]` (BE-F routed all nine operations). Those files are also outside the qa-verifier write scope.
- **No product file, migration, OpenAPI or i18n change.** Because no product mutation was added, the assignment's generic "authorization / validation / concurrency / audit per mutation" deliverable has nothing to apply to.

## 2. Behaviour delivered, per requirement

### REQ-S19-008: "its published versions behave identically (the A06 assertions replayed)"

`a06-bundle-replay.test.ts` does the following, using only the existing API operations:

1. **Source (demo installation).**
   - The source is the migrations plus `seedDemo` (synthetic), with the API on `MTH_ENV=demo`.
   - Through the Studio pipeline (draft, `PATCH titleEn`, preview, compatibility, source coverage for `methodology`, configured TO review, publish), a new version is published for each of: `form_schema/forms`, `methodology/playbook`, `scoring_defaults/scoring-defaults` and the first published `procedure` key.
   - A job schedule cron is changed, and the demo organization's upload policy is changed.
2. **Bundle.** `POST /admin/config-bundles/exports` (all kinds), then `GET …/download`. The test asserts `bundleSchemaVersion = "mth-config-bundle/1"` and `sourceEnvironment = "demo"`.
3. **Target (clean installation).** The target is migrations only plus the A06 synthetic world. The bundle is imported into organization A by an ADM_METHOD + ADM_TECH + TO user, and the test asserts:
   - upload returns 201;
   - validate returns 200 with status `validated`, no `refused` or `conflict` items, and each of the four changed keys planned as `new_draft`;
   - commit returns 200 with status `committed`.
4. **Publish and compare.**
   - Every imported Studio draft is still a `draft` after the commit. It is then published through the existing pipeline (TO `w.office` reviews, never the importer).
   - Each published `contentSha256` equals both the commit item's hash and the bundle item's `contentSha256`.
   - The newest published version of each of the four keys is the imported one, carrying the source's synthetic `titleEn`.
   - Imported job schedules are `enabled = false`.
   - The source API is closed and its scratch database dropped before A06 starts.
5. **Replay.** The full A06 suite (all 27 tests) then runs on the target. Every Studio change in A06 starts from the imported published versions, and A06's existing transformation is pinned to them.
6. **Closure.** After A06, every imported version is still `published` with the bundle's hash, and at least four were imported.

**Result:** 28/28 pass, exit 0. They passed in 4 separate runs: the default locale, locale unset, `LC_ALL=C.UTF-8`, and together with the contract test.

### A01–A16 re-run on the merged tree (REQ-DLV-039, REQ-S21-004 for A02/A06; §B.8 REQ-S01-001 "A02 re-run (QA-B)")

All 38 files `tests/qa/integration/a0[1-9]*|a1[0-6]*` pass: 378 tests, exit 0, run on a disposable PostgreSQL 16.15 (UTF8, C). This includes:

- `a02-a21-complete-lifecycle` (13 tests) and `a02-a08-drafts-before-g2-scale-after-g5` (1 test): the A02 guided scenario on a persisted database through native workflows only;
- the A13 kill/restart suites;
- the A14 concurrency suites.

### No-wording / bilingual

The replay adds no user-facing string. Every value is synthetic, the comments say so, and no business, Finance or IT approval is implied.

## 3. Checks actually run

Environment for every check:

- Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm from the same directory, `MTH_PNPM_OFFLINE=1`, no network.
- PostgreSQL 16.15 from `/usr/lib/postgresql/16/bin` through `tests/qa/support/with-pg.sh` (ports 24351 and 26411).
- The shell locale is unset unless stated.
- Agent sandbox: `node_modules/` and `test-results/` are read-only for this run.

All logs (ANSI codes and `npm warn` lines removed) are in `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-B/`.

| # | Command | Expected | Actual | Exit | Result | Log |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `tests/qa/support/with-pg.sh npx vitest run --project integration <38 A01–A16 files>` (first attempt) | runs | Vite could not write `node_modules/.vite-temp/vitest.config.ts.timestamp-*.mjs` (EROFS, sandbox) | 1 | BLOCKED (sandbox; not a product result) | not kept; reproduced in #8's `pnpm-test-asis.log` |
| 2 | `tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <38 A01–A16 files>` | all pass | Test Files 38 passed (38); Tests 378 passed (378); 21:46:54–21:55:15 UTC | 0 | PASS | `a01-a16.log` |
| 3 | `QA_PG_PORT=26411 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/a06-bundle-replay.test.ts` (first version) | pass | failed in the test's own source setup: publishing `methodology/playbook` returned 422 `config_version.checks_required` because the helper lacked the source-coverage run. Test defect, fixed in the test (A06's `runPipeline` does the same step). | 1 | FAIL then fixed (test-side) | superseded by #4 |
| 4 | same as #3 (final test) | pass | Test Files 1 passed; Tests 28 passed (28) | 0 | PASS | `a06-replay.log` |
| 5 | `with-pg.sh npx vitest run --configLoader runner --project integration` on: `tests/qa/integration/zz-tmp-head-a06-original.test.ts` (a temporary copy of `HEAD:tests/qa/integration/a06-configuration-change.test.ts`, deleted right after), `a06-configuration-change.test.ts`, `a06-bundle-replay.test.ts` and `apps/api/test/integration/contract/contract.test.ts` | all pass | Test Files 4 passed; Tests 193 passed. HEAD original 27, refactored 27, replay 28, contract 111. | 0 | PASS | `a06-equiv-contract.log` |
| 6 | #4 with `env -u LANG -u LC_ALL -u LANGUAGE` and with `LC_ALL=C.UTF-8 LANG=C.UTF-8` | pass | 28/28 and 28/28 | 0 / 0 | PASS | `a06-replay-locales.log` |
| 7 | `pnpm -r typecheck` | 0 | all packages Done | 0 | PASS | `typecheck.log` |
| 8 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no output | 0 | PASS | `lint.log` |
| 9 | `pnpm openapi:lint` | 0 | lint OK | 0 | PASS | `openapi-lint.log` |
| 10 | `pnpm test` exactly as defined | 0 | EROFS on `node_modules/.vite-temp` (the sandbox makes `node_modules` read-only for this agent) | 1 | **BLOCKED** in this sandbox | `pnpm-test-asis.log` |
| 11 | `pnpm test`'s three projects with `--configLoader runner` (unit-node, unit-web, unit-formula-nocodegen) | 0 | unit-node: 1 failed, 3021 passed. The failure is `tests/qa/unit/a20-p6-token-contrast.test.ts`, which hit EROFS writing `test-results/qa-a20/contrast-pairs.txt` (sandbox). unit-web: 130 files, 2175 passed. nocodegen: 259 passed, 2 skipped. | 1 | FAIL caused only by the sandbox; see #12 | `pnpm-test-runner.log` |
| 12 | `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project unit-node` | 0 | Test Files 205 passed; Tests 3022 passed | 0 | PASS | `unit-node-rerun.log` |
| 13 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | 0 | PASS | `prettier.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG6`, run before and after the changes | 0 | `PASS gate DG6 (historical)` | 0 / 0 | PASS | `validate-dg6.log` |
| 15 | `npx eslint --max-warnings=0 --no-cache` on the 3 changed files | 0 | no output | 0 | PASS | (folded into #8) |
| 16 | scratch `tsc -p $TMPDIR/tsconfig.qa.json` (extends `tsconfig.base.json`) on the A06 files | informational | No error in `a06-bundle-replay.test.ts` or in the added lines. The errors reported (TS4111 index-signature access, `string \| undefined`, and the kysely `information_schema` select) are all in the moved code, which is identical to HEAD's and was never typechecked. | 2 | observation (no tsconfig covers `tests/qa/**`) | not kept (scratch) |

- **Concurrency note.** #2 was running while `a06-configuration-change.test.ts` was refactored (about 21:50 UTC). That run executed the refactored file (27 tests). To make sure this hides no difference, #5 ran the unmodified HEAD file next to the refactored one: both pass with 27 tests.
- **Overlap.** #4 and #2 overlapped on two separate disposable clusters, with no failure from either.

## 4. Known gaps / not done

1. **The exact `pnpm test` is BLOCKED in this agent sandbox** (#10). The cause is the read-only `node_modules/.vite-temp`, an environment effect, not a product result. The equivalent runs (#11 plus #12) pass in full once the A20 test's evidence directory points at scratch. The orchestrator should run plain `pnpm test` on its host to close this.
2. **What the replay's bundle covers.**
   - The demo branding is the default, so no `branding` item is exported. Branding is therefore not replayed through a bundle. This also keeps A06's "fresh install shows 'Mobily Transformation Hub'" assertion true on the target.
   - The automation rule, notification policy and review policy kinds travel only as far as the demo exports them. The replay asserts plan and commit success for every item, but A06 behaviour only for the Studio kinds and the procedure.
   - The source changes to the four Studio keys are title edits. The behaviour A06 then exercises is A06's own changes, built on top of the imported versions.
3. **A06 was not replayed on the source.** The claim "behaves identically" rests on two facts: the content hashes are equal (T-D6 style), and all 27 A06 assertions pass on the target as they do on a clean installation (#5). No side-by-side run on the demo source was made.
4. **`tests/qa/**` is not covered by any tsconfig**, so `pnpm -r typecheck` does not check these files (#16). The moved A06 code has pre-existing strict-mode type errors, inherited from T-DG5-QA-A and unchanged here.
5. **A01–A16 coverage boundary.** This task re-ran the existing `tests/qa/integration/a01…a16-*` suites. It added no new A01–A16 assertions besides the A06 replay. No browser (Playwright) or RTL/LTR UX run was in scope or made.

## 5. Open questions / merge instructions

- **Q1 (assignment contract).** The handback and evidence paths are outside the qa-verifier write scope (see the box at the top). Should future QA assignments name `docs/delivery/test-evidence/DG7/qa/…`, or should the orchestrator relocate these files?
- **Q2 (T-D6 test helper; for BE-F).** `apps/api/test/integration/transfer/config-bundle-roundtrip.test.ts`'s `publishDraft` runs no source-coverage check. A bundle carrying a `methodology` draft would therefore fail there with 422 `config_version.checks_required`, exactly as this task's first replay did (#3). T-D6 passes today only because its source changes no `methodology` key. This is a test-coverage gap in T-D6, not a product defect. Raised for the orchestrator or BE-F; not edited (outside scope).
- **Q3.** Should `package.json`'s `test` script tolerate a read-only `node_modules` (`--configLoader runner`) for sandboxed agents? This is an orchestrator decision; nothing was changed.
- **Merge.** Commit the three `tests/qa/**` files together. The refactored `a06-configuration-change.test.ts` imports `tests/qa/support/a06-suite.ts`. There are no migrations, no ordering constraints and no expected conflicts.
- **No approvals.** No DG0–DG7 record, review, finding or stage state was written. Nothing here grants or implies a business, Finance or IT approval, and product G6 is not involved.
