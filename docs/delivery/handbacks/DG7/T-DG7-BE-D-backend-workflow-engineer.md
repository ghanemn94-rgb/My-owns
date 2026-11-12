# Handback T-DG7-BE-D: import, reconcile, rebind and the read-only routes (backend-workflow-engineer)

- **Stage / gate:** P7 "Independent transfer and release", DG7 (BUILDING). Task §C.2 of `docs/architecture/p7-work-split.md` (W6, after BE-C).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-D-backend-workflow-engineer-20261112T230416Z-91b81b07","session_id":"91b81b07-87e5-4112-93c0-27e563d5ab15"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-D.md`, sha256 `9a7837865a2288d5ccc5e38ce71dd2bdb3d67f20bdbe18e9ea1d64448dcd3dce` (verified).
- **Base:** `10476a27835174b01812281bc2b1266a3c53d0aa` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's directory. Nothing was committed.
- **Time (`date -u`):** started 23:04:25Z; last check finished 23:33Z.
- **Requirements:** REQ-S19-014 and REQ-S19-016, the BE-D clauses of C.10 (T-C8–T-C15).
- **Two gate systems.** Imports, reconciliations and rebinds are engineering and IT operations. They approve nothing: no G1–G6, Finance or IT approval. Nothing here reads or writes DG0–DG7 records. All test data is synthetic.

> **Headline: the import's load is BLOCKED (open question Q1).** C.11 says to stop and report rather than touch `audit_event`'s triggers, so I did not build the load. ADR-0064 §6 says "a freshly migrated database passes" the empty-target check, and that `audit_event` loads by plain INSERT with its original `id` and `seq` while its triggers stay on. I measured this on PostgreSQL 16.15 and it is not true. Migrations write `audit_event` rows themselves (for example `job_schedule.create`), with uuid v7 ids and `seq` starting at 1. So:
>
> - The step 4 check, read literally, refuses every migrated target.
> - Without step 4, the source's rows collide on `audit_event_seq_key`.
> - The target's own rows cannot be removed without disabling `audit_event`'s triggers. That is forbidden: it would be a DG1 reopen (seam 8).
>
> **What this blocks:** T-C8 and T-C11, and the load half of T-C12, cannot pass until the architect decides. A test pins the measured fact (`transfer-roundtrip.test.ts`, "Q1 (BLOCKED …)"), so it is not hidden.

## 1. Files changed

### Created

| File | Purpose |
| --- | --- |
| `packages/db/src/transfer/import.ts` | ADR-0064 §6, steps 1, 2 and 4 of `import-migration`, with the exact C.5 lines and exit codes:<br>- step 1, package checks: schema version, canonical manifest, optional `--manifest-sha256`, and the SHA-256 of every table file and of `attachments.json`;<br>- step 2, target checks: up to date with this build, the level, the app version;<br>- step 4, the empty-target check;<br>- the session lock `MIGRATION_IMPORT_LOCK_CLASS`.<br>After the checks it exits 1, with `LOAD_BLOCKED_REASON` naming Q1. Steps 5–7 and 9 are not built. |
| `packages/db/src/transfer/reconcile.ts` | ADR-0064 §6 step 8:<br>- `reconcileTables` uses the export's own encoder for the live count and digest of each table;<br>- `buildReport` applies 0133's result rule, with bigint sums;<br>- `recordReconciliation` writes the run, its table and attachment rows, and the `migration.reconciled` audit event;<br>- `withMigrationImportLock` holds the session lock 730403, key `migration-import`;<br>- `runReconcileMigrationCommand` (`reconcile-migration`) exits 0, 2 or 4. |
| `packages/db/src/transfer/rebind.ts` | ADR-0064 §8 `rebind-identity`:<br>- a strict UTF-8 CSV parser;<br>- `validateMapping` checks every line in the applying transaction, under lock 730404 (key `identity-rebind`);<br>- `applyRebind` is all or nothing: `user_identity` update, hold `unbound → rebound/retained` (version +1, optimistic `WHERE version`), `identity_rebind_event`, and the `identity.rebound`/`identity.retained` audit events with the old and new pair and the mapping file's SHA-256;<br>- `rebindLines` prints the C.5 lines. |
| `packages/db/src/transfer/{import,reconcile,rebind}.test.ts` | Unit tests (13): package refusals, the report rule and lines, parser problems and lines. |
| `packages/db/test/integration/transfer-roundtrip.fixture.ts` | The round-trip helpers for KBE-A (C.4): `RoundtripWorkspace` (demo source, migrated target, export to a directory, copies, cleanup) and `importInto`. |
| `packages/db/test/integration/transfer-roundtrip.test.ts` | T-C9; T-C10 (all refusals); T-C12 on the refusal paths; the step 8 reconciliation against the live source; the Q1 pin; the CLI lines and both wrappers as subprocesses. 12 tests. |
| `packages/db/test/integration/transfer-locks.test.ts` | T-C13: the constants equal the registry entries, read as text. A second import waits on 730403 and a rebind waits on 730404. 3 tests. |
| `apps/api/src/modules/transfer/import/service.ts` | `migration_import.read` at organization scope (403 otherwise), the zod contract mirrors, and the presenters. |
| `apps/api/test/integration/transfer/import-routes.test.ts` | T-C14 (5 tests). |
| `apps/api/test/integration/identity/unbound-signin.test.ts` | T-C15 (5 tests): fake IdP and dev login; rebind, retain, invalid file, terminal hold. |
| `apps/api/test/integration/contract/p7-exercises-be-d.ts` | The contract exercises of the 5 operations, plus `seedSyntheticImport`, a synthetic recorded import written as the owner, with its audit events. |
| `tools/migration/import.mjs` | Steps in ADR order. It runs the attachment copy-in when the package lists attachments; if BE-E's CLI is absent it exits 3 BLOCKED. Then it runs `mth-db import-migration` and passes the codes through. |
| `tools/migration/reconcile.mjs` | A thin wrapper over `mth-db reconcile-migration`, exiting 0, 2, 3, 4 or 1. |

### Modified

| File | Exactly what |
| --- | --- |
| `packages/db/src/cli.ts` | Three commands (header, usage lines, dispatch): `import-migration`, `reconcile-migration`, `rebind-identity`. |
| `packages/db/src/transfer/index.ts` | Exports of the three new modules, and the header line. |
| `apps/api/src/modules/transfer/import/routes.ts` | Fills the BE-A stub: the 5 GET routes. The guard table is unchanged. |
| `apps/api/src/modules/identity/oidc.ts` | `identityUnbound(db, userId)` and the result `identity_unbound`, beside `account_disabled`, for an existing (iss, sub). Also refuses e-mail binding of a held user, so the hold cannot be bypassed by e-mail matching. |
| `apps/api/src/modules/identity/routes.ts` | The dev login applies the same hold. `auditLoginFailure` adds `changes.error = {from: null, to: "identity_unbound"}` for this refusal only. The callback's redirect is the existing `fail(code)`. |
| `apps/web/src/i18n/{en,ar}/auth.json` | One appended key, `errors.identity_unbound`, with the exact C.5 texts. The Arabic is provisional (D-243 Q7). FE-A owns these files. |
| `apps/api/test/support/p7-pending-be-d.ts` | Now empty: all 5 operations are routed and exercised. |
| `apps/api/test/integration/contract/contract.test.ts` | Imports the exercise and its mirrors, and adds the `it(...)` call. No media-type pin change (GET only). |

**No migration was added.** No id was taken, so `0149`+ stay free.

## 2. Behaviour delivered, per requirement

**REQ-S19-014 "reports equal record counts and matching attachment checksums"**
- The reconciliation compares each table's live `count` and `contentDigest`, from the same encoder as the export, with the expectations. A changed table is reported by name; the test changes `audit_event` after the export.
- Attachment mismatches are recorded and shown, with `missing`, `size_mismatch` or `sha256_mismatch`.
- The report is readable through `getMigrationReconciliation`: per-table expected and actual rows and digests, plus the attachment mismatches (T-C14).

**REQ-S19-014 M0362 "validation"**
- Every refusal has its C.5 exit code and line, and leaves the target unchanged. The test compares all table counts before and after (T-C10):
  - schema version (2);
  - table-file checksum (2);
  - `--manifest-sha256` (2);
  - level (2);
  - app version (2);
  - non-empty target (3).
- **Mapping:** see T-C15 below.

**REQ-S19-016 "no password hashes"**
- The package scan (T-C9) checks every file. It finds:
  - no file of an excluded table;
  - no session token or CSRF hash (a synthetic session was planted in the source);
  - no OIDC state hash;
  - no `provider` other than `unbound`.
- No column is named like a password outside the SecretRef columns. The two `smtp_password_ref` columns are references, exempt under ADR-0064 §3.

**REQ-S19-016 M0364 "rebind corporate identity subjects under IT control" (T-C15)**
- **Refused before the rebind.** A held user signs in neither through the OIDC callback (fake OP) nor through the dev login. The callback ends at `/login?error=identity_unbound` (dev login: 401). No session is created, and `session.login_failed` is written with `changes.error = "identity_unbound"`.
- **Invalid file.** It refuses the whole file: exit 2, then `rebind-identity: refused: <n> invalid lines; nothing was changed` and one `line <k>: <reason>` per problem. The audit count and holds are unchanged.
- **Valid file.** It prints `rebind-identity: rebound 1, retained 1; 0 users remain unbound`. The holds are at version 2, with an audit event and a rebind event each.
  - The rebound user signs in with the new subject. The old subject never resolves to them; with one organization it provisions a new user just in time, which is unchanged DG1 behaviour.
  - The retained user signs in with the confirmed subject.
- **Terminal holds.** A resolved hold cannot be rebound again.

**Read-only routes (T-C14)**
- ADM_TECH, ADM_ACCESS and AUD read all 5. Every other seeded role, a user with no grants, and AUD at business-unit scope get 403 on all 5.
- No write route exists under either path, and the reads write no audit event.
- No route, job or permission can start an import or a rebind (C.11).

**Locks (T-C13)**
- `MIGRATION_IMPORT_LOCK_CLASS = 730403` and `IDENTITY_REBIND_LOCK_CLASS = 730404` equal the registry entries, read as text.
- A second import or re-check waits on the session lock. A rebind waits on 730404.

**`audit_event` (T-C12, refusal paths)**
- Both triggers are `O` (enabled) before and after every refusal, and no row changes.
- Nothing in this code disables, truncates or deletes from `audit_event`.

**Not delivered (§4):** T-C8, T-C11, and the load half of T-C12.

## 3. Checks run (real exit codes)

Environment for all checks:
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`.
- Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`: UTF8, C locale, port 24351.
- Logs are in `docs/delivery/handbacks/DG7/T-DG7-BE-D-evidence/`.

| Command | Result | Log |
| --- | --- | --- |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| `pnpm test` | exit 0. unit-node 201 files / 2958 tests; unit-web 125 / 2113; formula 259 passed, 2 skipped | `pnpm-test.log` |
| `tests/qa/support/with-pg.sh npx vitest run --project integration` on 12 files (see below) | exit 0: 12 files, 263 tests | `integration-final.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, run before the handback was written and again after it (`prettier-final.log`, exit 0) | `prettier.log`, `prettier-final.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | exit 0: `PASS gate DG6 (historical)` | `validate-dg6.log` |

The 12 integration files:
- `packages/db/test/integration/transfer-locks.test.ts`
- `packages/db/test/integration/transfer-roundtrip.test.ts`
- `packages/db/test/integration/transfer-export.test.ts`
- `packages/db/test/integration/catalogue.test.ts`
- `packages/db/test/integration/p7-transfer-guards.test.ts`
- `apps/api/test/integration/identity/unbound-signin.test.ts`
- `apps/api/test/integration/identity/other-realm.test.ts`
- `apps/api/test/integration/oidc.test.ts`
- `apps/api/test/integration/transfer/import-routes.test.ts`
- `apps/api/test/integration/transfer/export.test.ts`
- `apps/api/test/integration/contract/contract.test.ts`
- `apps/api/test/integration/text-scan/seeded-texts.test.ts`

**Failures seen and fixed:**
- `integration-new-run1.log`, exit 1. T-C9's password-column scan flagged the two `smtp_password_ref` SecretRef columns. ADR-0064 §3 exempts SecretRef columns, so the test now excludes `transfer_column_rule` columns. Rerun: `integration-new.log`, exit 0, 23/23.
- Two subprocess expectations in the round-trip test, not kept as logs:
  - the real CLI reports the real release `0.1.0` against the test package's `0.1.0-roundtrip`, which is correct (exit 2);
  - a `trim()` removed a trailing space.
  Both were fixed in the test and rerun: exit 0, 12/12, and again in `integration-final.log`.
- The unit tests of the three modules: `npx vitest run --project unit-node packages/db/src/transfer/{import,rebind,reconcile}.test.ts` exit 0, 13 tests. They are included in `pnpm-test.log`.

**Not run:** the whole integration project (`pnpm test:integration`). Only the 12 files above were run.

## 4. Known gaps / not done

1. **The load (ADR-0064 §6 steps 5–7, 9) is not built (Q1).** These are not implemented: the trigger-disabled load, the deferred second pass, the sequence reset, the holds, and the `migration_import` and import-run records. `import-migration` never exits 0 or 4. Consequences:
   - **T-C8 BLOCKED.** No round trip, so I cannot show equal ids, `audit_event` with equal `seq`, the target's `demoChecksum`, or the P6 integrity sweep on an imported database.
   - **T-C11 BLOCKED** for the tampered-table and tampered-attachment rollback with exit 4. The detection half runs: the step 8 comparison reports a changed table.
   - **T-C12, load half, BLOCKED.**
   - The holds and the import records exist only as synthetic owner-written fixtures (`seedSyntheticImport`). They are used to prove the routes, the sign-in check and the rebind.
2. **`reconcile-migration` re-checks tables only.** It reports `attachments_checked = 0`, because BE-E's `verify` output format is not defined yet. It also needs a recorded import, so today it always exits 2 (see Q2).
3. **`tools/migration/import.mjs` and attachments.** For a package with attachments it exits 3 BLOCKED until BE-E's `transfer-attachments` exists. C.9 step 5 ("BE-D lands the test with the byte step stubbed by the filesystem adapter") is therefore not done; there is no load to put it in front of.
4. **Web.** `apps/web/src/pages/LoginPage.tsx` `KNOWN_LOGIN_ERRORS` does not list `identity_unbound`, so the page would show the generic text instead of the C.5 sentence. The file is outside my list. **Request to FE-A/FE-B:** add `"identity_unbound"` to that array.
5. **The dev-login refusal** returns the existing `auth.login_failed` problem (401), not a redirect. The dev login is a JSON POST, and the contract declares no new code.

## 5. Open questions

- **Q1 (blocking; architect + orchestrator). ADR-0064 §6 step 4 and step 5 conflict with migration-written `audit_event` rows.** Measured (test "Q1 (BLOCKED …)"): a freshly migrated target has `audit_event` rows with `min(seq) = 1`, fewer than the demo source's. The target's rows have their own uuid v7 ids and `occurred_at` values, so they are never equal to the source's rows from the same migrations. Options I can see (none implemented):
  - (a) An audited, owner-only exception that empties `audit_event` on an otherwise empty target before the load. This needs the triggers bypassed, which is a DG1 reopen (seam 8).
  - (b) Keep the target's migration-written rows and load the source's rows after them, renumbering `seq`. That breaks "rows equal including `seq`" (T-C8), and the source's own migration rows would be duplicated in meaning.
  - (c) Load only the source rows whose `source <> 'migration'`, keep the target's migration rows, and renumber `seq`. Same `seq` issue as (b).
  - (d) Create targets from a schema-only path that writes no audit rows. Today `mth-db migrate` always writes them.
  - Each option changes ADR-0064 §6 and the T-C8/T-C12 wording. Please decide before KBE-A (T-C17) and DO-D (A18), which both depend on a working import.
- **Q2. The recheck versus the import's own appended events.**
  - After a successful import, the import appends `migration.imported`, `migration.reconciled` and `identity.binding_held` to `audit_event`. Later CLI and app activity adds more.
  - A recheck against the import-time expectations would then always mismatch on `audit_event`, and on any table the app has since changed.
  - Proposal: compare `audit_event` only up to the source's highest `seq` (record it on `migration_import`, which needs a column), and state that a recheck is meaningful only before the target is used.
- **Q3. `line <k>` reasons beyond the six C.5 reasons.** I added these:
  - `the header must be user_id,action,new_issuer,new_subject`;
  - `a line has exactly 4 fields: …`;
  - `the mapping file is not valid UTF-8`;
  - `the mapping file has no line`;
  - `user <id> has <n> carried identities; exactly 1 is needed`;
  - `rebind needs a new issuer of 1-512 and a new subject of 1-255 characters`;
  - `rebind needs a pair other than the carried one; use retain to confirm it` (0133's `identity_rebind_event_retained_same` check requires this).

  A non-uuid user id reports `unknown user <id>`. Please confirm, or give exact texts.
- **Q4. Users with zero or several identities are refused**, because one `identity_rebind_event` records one old pair. The alternative is to rebind all of a user's identities, or to delete the extras, which would lose history. Architect to confirm.
- **Q5. FE ownership** of `auth.json` (C.2 grants me the key) and of the `LoginPage.tsx` line (§4 item 4).
- **Q6. Recheck attachments.** The format of BE-E's `verify --out <json>` should be fixed so `reconcile-migration` (and the import's step 8) can read the mismatches into `migration_reconciliation_attachment`.

## Merge instructions

- **No migration.** No renumbering is needed.
- **Expected conflicts:**
  - `apps/api/test/integration/contract/contract.test.ts`: one import line, one mirror line, one `it(...)`.
  - `apps/web/src/i18n/{en,ar}/auth.json`: one appended key at the end of `errors`, if FE-A also appends.
  - `packages/db/src/cli.ts`: comes after BE-C's line. DO-G's line comes after these (p7-plan §5.3).
- **Order.** BE-E (W7) should make `tools/migration/import.mjs` call its `copy-in`. The path it looks for is `apps/api/src/cli/transfer-attachments.ts` or `apps/api/dist/cli/transfer-attachments.js`. KBE-A should wait for Q1.
