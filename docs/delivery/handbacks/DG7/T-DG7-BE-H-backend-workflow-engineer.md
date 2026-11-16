# Handback T-DG7-BE-H: the snapshot, the register and About (backend-workflow-engineer)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `HEAD` `2ba1b93e7b45ef69d89ab39cb82ee60b46e8558b`. At the start the working tree was clean except for this run's own run directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-H.md` (sha256 `685571ff…249954f`, verified). Scope: `docs/architecture/p7-work-split.md` §I.1, with §1, §2 and §I read in full; ADR-0071; D-243 onward.
- **Invocation:** run `DG7-T-DG7-BE-H-backend-workflow-engineer-20261113T013930Z-19e9bf49`, session `19e9bf49-c4ae-42a8-aa63-d930a67bbd62`.
- **Time:** start `2026-11-13T01:39:41Z`, end about `2026-11-13T02:22Z` (about 43 minutes).
- **Two gate systems:** a register status is an engineering delivery state. Nothing here is a DG0–DG7 gate decision or a G1–G6 business approval. No text says the release "is approved". The product reads no delivery record at run time. Nothing reads or writes a gate, review or stage record.

## Summary

- **Migrations:** none. Slice I adds no table (I.0), and `0153`–`0155` are still free.
- **Permission codes:** none added. All three operations use `operations.read` (D-250 O1).
- **Advisory locks:** none allocated. 730418–730419 are still reserved.
- **Endpoints added** (all GET, all read-only, tag `release`):
  - `GET /api/v1/admin/requirements`: `listRequirements`.
  - `GET /api/v1/admin/requirements/{reqId}`: `getRequirement`.
  - `GET /api/v1/admin/about`: `getReleaseAbout`.
- **Build step:** `apps/api` `build` now also runs `scripts/register-snapshot.mjs`, which writes `dist/release/register-snapshot.json`.
- **Pending:** `p7-pending-be-h.ts` is now empty. The response-validation ledger reports "965 of 965 live operations (0 pending excluded)".

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/api/scripts/register-snapshot.mjs` (new) | The ADR-0071 §2 generator, using Node built-ins only. It does a strict RFC 4180 parse (no BOM, the 19 columns, the id/area/class/status/final-gate rules, unique ids) and keeps every field verbatim, including CRLF inside quotes, which becomes `\n`. It writes `mth-register-snapshot/1` with the keys in ADR order. `generatedAt` comes from `SOURCE_DATE_EPOCH` when set. `--deps` is validated against `ExternalDependency`; when it is absent or names no file, the value is `null`. `--check` is supported. Exit codes 0/1/2 with the §I.3 lines. Exports `parseRegister`, `buildSnapshot`, `parseDependencies`, `main`. |
| `apps/api/scripts/register-snapshot.test.mjs` (new) | T-I1, T-I2, T-I3 (`node --test`, 21 tests). |
| `apps/api/src/modules/release/snapshot.ts` (new) | `RegisterSnapshotSource`. `fileRegisterSnapshotSource(path)` loads lazily, caches on success only, and logs the §I.3 warn line once per source through the caller's logger. `defaultSnapshotPath()` resolves the compiled `dist/release/…`, with the source-mode fallback `apps/api/dist/release/…`. `defaultRegisterSnapshotSource()` is one per process. G4 validation and frozen rows ordered by `reqId` (code-point order). |
| `apps/api/src/modules/release/about.ts` (new) | `buildAbout(snapshot \| null, versions)` (ADR-0071 §4), and the zod mirrors `releaseAboutView` and `registerSnapshotInfoView`. |
| `apps/api/src/modules/release/cursor.ts` (new) | Opaque cursor, base64url of `{ after, filtersHash }`. A mismatch or a cursor that does not decode gives 400 `validation.cursor`. |
| `apps/api/src/modules/release/routes.ts` | The three routes behind G1–G8. The guard table is copied into the header, replacing "no guard table here yet". Signature: `registerReleaseRoutes(app, deps, source = defaultRegisterSnapshotSource(), options = {})`. The zod mirrors are `requirementSummaryView`, `requirementPageView` and `requirementView`. `registerSnapshotUnavailable()` is the 503 problem. |
| `apps/api/src/modules/release/index.ts` | Passes the source through, with `registerReleaseModule(app, deps, source = defaultRegisterSnapshotSource())`. Also re-exports the `RegisterSnapshotSource` type. |
| `apps/api/src/modules/release/release.test.ts` | Covers registration (now `active`), T-I8, T-I9, and the loader, cursor and `buildAbout` units. |
| `apps/api/package.json` | The `build` line of ADR-0071 §2.4, and nothing else. |
| `.dockerignore` | `!docs/delivery/requirements.csv` directly after `docs/delivery`. |
| `apps/api/test/integration/release/register.test.ts` (new) | T-I4, T-I5, T-I6, plus G5 (no audit event). |
| `apps/api/test/integration/release/about.test.ts` (new) | T-I7. |
| `apps/api/test/integration/contract/p7-exercises-be-h.ts` (new) | The three operations exercised through `mirrored`: 200/400/401/403/404, with the zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | The import line, the `it(...)` hook and **one** `...P7_MIRRORS_BE_H` line in `ZOD_MIRRORS` (the mirror line follows the BE-B…BE-G precedent; see O3). |
| `apps/api/test/support/p7-pending-be-h.ts` | Emptied. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-H-*` | This handback and its logs. |

`server.ts` was **not** changed. It still calls `registerReleaseModule(app, deps)`, so the default source applies (ADR-0071: "server.ts passes the default source").

## 2. Behaviour per requirement

- **REQ-S02-003: "the in-app view lists the same row count and IDs as requirements.csv".**
  - The tree's register has 412 rows, sha256 `f08ff839c7cb…`.
  - T-I1 compares the generated snapshot with an independent sticky-regex parse of the file and an independent quote-parity record count: `rowCount`, ids in order, `sourceSha256`, and every field equal. Multi-line, quoted and padded fields are proven on a fixture, because the current tree register has no multi-line field.
  - T-I4 pages `listRequirements` to the end at two page sizes (100 and 37). The ids equal the snapshot's ids in `reqId` order, and the count equals `rowCount`.
  - The list is ordered by `reqId` (ADR-0071 §3), not in file order: the file is not sorted.
- **REQ-S02-003: "with filters by class, status and area".**
  - T-I4 checks `class`, `status`, `area` and `finalGate` alone and combined, against an independent filter of the snapshot rows.
  - A cursor reused with another filter gives 400. `limit` 0, 101 or `x` gives 400, and so do an unknown parameter and a bad enum or pattern.
- **REQ-S02-003: "view:ADM,AUD,TO; edit:none".**
  - T-I5 covers all 14 roles plus a user with no grant, on all three operations. ADM_TECH, TO, KDS, TD and AUD get 200. SP, TL, BO, WL, FIN, CM, SEC, ADM_ACCESS, ADM_METHOD and the no-grant user get 403. A request without a session gets 401.
  - No write operation exists. G5 also checks that no audit event is written.
- **REQ-S02-005: "in-app 'About' list unfinished items as such".**
  - T-I7 runs on a fixture with SPECIFIED, BLOCKED, IMPLEMENTED (marked) and IMPLEMENTED rows. `statusCounts` holds all four statuses and sums to `rowCount`. `openItems` holds exactly the two unfinished rows with their notes verbatim. `laterClauses` holds exactly the marked row.
  - A missing snapshot still gives 200, with `register`, `statusCounts`, `openItems`, `laterClauses` and `externalDependencies` all `null`. A `null` dependency list stays `null`, and a supplied list is carried as it is.
- **REQ-S02-005: "no planned feature is labelled delivered".** Statuses and notes are passed verbatim. No status is derived or upgraded.
- **REQ-S21-003: "preserve the full platform scope".** About `statusCounts` covers every row.
- **Guards:**
  - **G4:** in T-I6 a missing file, a wrong `schemaVersion`, `rowCount ≠ rows` and non-JSON each give 503 `release.register_snapshot_unavailable` (type `urn:mth:problem:unavailable`, valid against `Problem`) on list and get, with no `items`. About gives 200 with nulls. After the file is fixed, the next request returns 200 on the same source, without a restart. Authentication, authorization and validation still answer before the 503.
  - **G7:** T-I9 records every `node:fs` and `node:fs/promises` path argument during a full request cycle of the three operations. The only path is the snapshot file. The version is read from `package.json` once, at registration, never during a request.
  - **T-I8:** the `.dockerignore` order, the absence of any other `!docs/delivery` line or re-exclusion, and the exact `build` line.
  - **Versions:** `appVersion` and `contractVersion` equal `getDeploymentStatus`'s `release` values (T-I7 compares them; BE-B is merged, so this is not skipped). `appVersion` reads the same `apps/api/package.json` with the same rule as `apiAppVersion`. `platform/index.ts` does not export `apiAppVersion`, so `releaseAppVersion()` in `routes.ts` re-implements that rule. `contractVersion` uses the exported `CONTRACT_VERSION`.

## 3. Checks run (Node 24.21.0, offline, locale unset unless stated)

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node --test apps/api/scripts/register-snapshot.test.mjs` | 0 | 21 pass, 0 fail | `register-snapshot-node-test.log` |
| `LC_ALL=C.UTF-8 node --test apps/api/scripts/register-snapshot.test.mjs` | 0 | 21 pass | `register-snapshot-node-test-c-utf8.log` |
| `(cd apps/api && pnpm build)` | 0 | `register-snapshot: wrote dist/release/register-snapshot.json (412 rows, sha256 f08ff839c7cb)` | `api-build.log` |
| `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `pnpm-lint.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| `pnpm test` | 0 | unit-node 201 files / 2973 tests passed; unit-web 127 / 2133 passed; nocodegen 3 files, 259 passed, 2 skipped | `pnpm-test.log` |
| `QA_PG_PORT=27471 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/release …/contract/contract.test.ts …/contract/response-validation.test.ts …/hardening/route-inventory.test.ts …/access/sensitive-reference-inventory.test.ts …/p6-guard-mapping.test.ts …/platform/deployment-status.test.ts` | **1** | 7 files passed, 1 failed; 269 tests passed, **1 failed** (route-inventory case 4, `uploadConfigBundleImport`; see §4). Results: register 9/9, about 4/4, contract 111/111, response-validation 119/119 ("965 of 965 live operations (0 pending excluded)"), deployment-status 9/9, p6-guard-mapping 6/6, sensitive-reference-inventory 2/2 | `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `All matched files use Prettier code style!` | `prettier-check.log` |

An earlier `pnpm test` run failed on `architecture.test.ts`: there were non-literal computed keys and `process.emitWarning` in the new release files. Both were fixed, and every check in the table was re-run on the final state.

## 4. Known gaps / not done

1. **Route-inventory case 4 fails, outside this task's scope.**
   - The failing case is `apps/api/test/integration/hardening/route-inventory.test.ts`, "case 4, invalid input": `uploadConfigBundleImport` (POST `/api/v1/admin/config-bundles/imports`, BE-F's transfer module) answers **422** `config_bundle.schema_version_unsupported`, where the sweep expects 400.
   - It failed the same way in both of my runs. Case 4 sweeps only mutating operations, and my change adds three GET routes in `release` only.
   - I could not run it on the unmodified base. The git metadata is read-only, so `git stash` is not available, and the assignment forbids an extra checkout. No DG7 handback records a route-inventory run after BE-F.
   - The file and the behaviour belong to BE-F, so I did not change them. **The orchestrator should confirm this and route it.**
2. **The image half of the `.dockerignore` exception is BLOCKED.** There is no Docker daemon here (D-243 Q1; ADR-0071 Residual 2). T-I8 checks the lines only.
3. **T-I10 to T-I17** belong to other tasks (QA-D, DO-J, DOC-B, FE-C, FE-D) and were not run here.
4. **The contract exercise does not provoke the declared 503.** Breaking it would mean breaking the shared snapshot. T-I6 proves the 503 on the real server and validates its body against `Problem`.
5. **Local runs depend on the build.** The shared contract server reads `apps/api/dist/release/register-snapshot.json`; CI builds before the integration job. On a local run without a build, `p7-exercises-be-h.ts` runs the generator into that gitignored path first. That is the same command as the `build` script.
6. **Generator refusal wording.** Two refusal reasons are not in the §I.3 list: `the file is not valid UTF-8` and `unexpected character after a closing quote`. Both exit 1 and use the same line format. The `--check` success line (exit 0) is also not specified in I.3.

## 5. Open questions and merge instructions

- **O1 (role set):** as ADR-0071 Residual 1 says, KDS and TD can also read and ADM_ACCESS and ADM_METHOD cannot. An exact "ADM, AUD, TO" set needs a new permission code and a migration.
- **O2 (route-inventory):** see §4 item 1. Please confirm on the base and assign it to BE-F's line.
- **O3 (`contract.test.ts`):** besides the import and the `it(...)` hook, I added one `...P7_MIRRORS_BE_H` line to `ZOD_MIRRORS`. That is needed for the mirror check, and every P7 BE task did the same. Please accept it or move it.
- **Request to FE-A:** `problems.json` already has `release__register_snapshot_unavailable` in EN and AR (verified). The nav entries Administration > Requirement register (`/admin/requirements`) and Administration > About (`/admin/about`), visible with `operations.read`, are still FE-A's.
- **Merge:** no migration and no ordering constraint. `pnpm -r build` must run before the integration job, as it already does in CI. Conflicts are only possible in `contract.test.ts`, in the import, mirror and hook blocks, which other P7 tasks also append to.
