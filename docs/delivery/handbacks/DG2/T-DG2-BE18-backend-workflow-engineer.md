# Handback T-DG2-BE18 / T-DG2-BE18A (backend-workflow-engineer): authorise at commit time, no remote call inside a transaction, and no upload leftovers after shutdown

- **Stage:** P2 / DG2 (FIXING), round-13 repair.
- **Assignments:**
  - `docs/delivery/assignments/DG2/round-13/T-DG2-BE18A.md` (sha256 `d3e84f66…5f8e`, verified before starting). It
    includes in full `docs/delivery/assignments/DG2/round-13/T-DG2-BE18.md`.
  - One change covers all three findings, as BE18A requires.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE18A-backend-workflow-engineer-20261007T053122Z-e00e041f","session_id":"e00e041f-e8f3-4076-acc4-e96ff15bfb20"}`.
- **Base:** `HEAD` = `8c02475ccc36bc17fb0232c429d5164c98be1f26`. The tracked tree was clean apart from sandbox-masked
  dotfiles and this run's own `runs/` directory. Nothing is committed; the orchestrator integrates.
- **Findings repaired:**
  - F-DG2-440 (Medium, REQ-S10-001);
  - F-DG2-441 (Low, REQ-S16-007);
  - F-DG2-460 (Medium, REQ-S16-013, a BE17 regression).

  I can't close them. A non-author reviewer verifies each fix, and the orchestrator records `import-findings --fix`.
- **Migrations:** none. **API endpoints added:** none.
  - `docs/api/openapi.yaml` and migrations 0001-0019 are unchanged.
  - Every status the change produces is already declared on the upload operation: 401 `unauthenticated`, 403
    `forbidden`, and the 302 of `GET /auth/login`.
- **Evidence:** `docs/delivery/handbacks/DG2/T-DG2-BE18-evidence/` (logs only).
- **Synthetic data, no approvals:** all test data is SYNTHETIC. G1-G6 are product business gates. Nothing here grants
  or implies one, and nothing here implies DG7.
- **Validator timing (disclosed):** I did not run `node tools/gates/validate.mjs --historical --stage DG1` before I began
  editing. It ran in both locale matrices after the change and exited 0 (`PASS gate DG1 (historical)`, §5 row 11). The
  change touches no gate tooling or record.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/request.ts` | Commit-time authorisation for F-440.<br>• `PrincipalResolver` type and the `request.reauthenticate` declaration.<br>• `refreshPrincipal(tx, request)` re-resolves the session and grants inside `tx`. It answers 401 when the session ended.<br>• `commitTimeDenial(err)`: a read denial at commit time becomes 403 with the same denial details. |
| `apps/api/src/modules/access/index.ts` | Exports `refreshPrincipal`, `commitTimeDenial` and `PrincipalResolver`. |
| `apps/api/src/modules/identity/routes.ts` | F-440: `principalFor()` is now the single session → principal resolution (session + `loadGrants`).<br>• The `preValidation` hook uses it.<br>• It sets `request.reauthenticate`, which re-runs the same function on a transaction, bound to the same token and user.<br>F-441: `GET /auth/login` runs `oidc.prepareLogin()` (discovery) before the transaction, then `oidc.saveLoginState()` in a short one. |
| `apps/api/src/modules/identity/oidc.ts` | F-441: `startLogin(tx, …)` is split into two steps.<br>• `prepareLogin()` takes no transaction. It runs discovery and builds the state, nonce, PKCE and URL.<br>• `saveLoginState(tx, login)` does the database insert only. |
| `apps/api/src/modules/transformations/register-kit.ts` | `openWrite(…, { atCommit: true })`. It calls `refreshPrincipal` first, and its read and write gates then decide on the reloaded grants. A refusal is mapped by `commitTimeDenial`. |
| `apps/api/src/modules/evidence/routes.ts` | Phase 3 of the upload uses `openWrite(…, { atCommit: true })` (F-440). An `onReady` hook starts the store's stale-temporary sweep in the background and tracks it (F-460). |
| `apps/api/src/modules/evidence/store.ts` | `STALE_TEMPORARY_AGE_MS` (1 h, with its justification).<br>• `EvidenceStore.sweepStaleTemporaries` and the filesystem implementation.<br>• `receive()` removes its `.part` even if closing the handle fails.<br>• The S3 stub's sweep is a no-op. |
| `apps/api/src/modules/platform/in-flight.ts` (new) | F-460: `createInFlight()` tracks promises until they settle, and `settled(timeoutMs)` waits for them. `registerInFlightTracking(app)` decorates `app.inFlight` and wraps every route handler in an `onRoute` hook. The wrapper returns the handler's own result. |
| `apps/api/src/modules/platform/index.ts` | Exports the tracker. |
| `apps/api/src/server.ts` | Registers the tracking before the modules and returns `inFlight` from `buildServer`. |
| `apps/api/src/main.ts` | Shutdown order: `app.close()`, then `inFlight.settled(3 s)`, then `db.destroy()`, then `exit(0)`, all under the existing 10 s backstop. |
| `apps/api/src/modules/access/denials.ts` | The failed-mutation audit hook runs after the handler settled, so its transaction is tracked too. |
| `packages/db/src/pool.ts` | The sweep note above `DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS` now matches the BE18 sweep. |
| `docs/operations/health-readiness.md` | Shutdown step 4 (handlers settle, ≤ 3 s), the full order, the start-up sweep (what, age, logging), and the upload's commit-time authorisation. |
| `apps/api/test/integration/commit-time-auth.test.ts` (new) | Real-socket tests for F-440 (8 tests) and F-441 (Q7). |
| `apps/api/test/integration/shutdown-cleanup.test.ts` (new) | Real-process tests (`src/main.ts`) on a real filesystem store for F-460: R12-07 (stalled), an actively streaming upload, a positive control, and the start-up sweep. |
| `apps/api/src/modules/platform/in-flight.test.ts` (new) | Unit tests of the tracker and the handler wrapping. |
| `apps/api/src/modules/evidence/evidence.test.ts` | Unit tests of the sweep: what it removes and keeps, symlinks, a missing root, and a bound on the age constant. |

## 2. Behaviour delivered

### F-DG2-440 (REQ-S10-001): authorise at commit time

**The fix.** Phase 3 of `POST /api/v1/transformations/{id}/evidence/{evidenceId}/content` (`evidence/routes.ts:514-521`)
opens its write transaction with `openWrite(…, { atCommit: true })` (`register-kit.ts:254-268`). Inside that
transaction, immediately before the row lock and the write:

1. `refreshPrincipal(tx, request)` (`access/request.ts:42`) calls `request.reauthenticate(tx)`.
   - That is the identity module's own `principalFor()` (`identity/routes.ts:125`), the same function the
     `preValidation` hook uses. It re-runs `resolveSession` (not revoked, idle and absolute expiry not passed, user
     active) and `loadGrants`, on the transaction.
   - It is bound to the request's token and to the user it was resolved for.
   - If the session is no longer valid, the answer is **401 `unauthenticated`**: the same problem the hook gives a
     request without a valid session.
   - Otherwise the reloaded grants replace `request.principal`.
2. The read and write gates then run the policy on the reloaded grants.
   - A write right lost meanwhile is **403 `forbidden`**.
   - A read right lost meanwhile is also 403, not 404, through `commitTimeDenial`. The caller passed the read gate when
     the request started, so it already knows the record exists.
   - Both carry the denial details, so the existing failed-mutation audit (`access/denials.ts`) records
     `authorization.denied` exactly as for any other denied mutation.
3. Every refusal throws inside the transaction, so it rolls back. The route's existing `catch` runs
   `store.discardUncommitted(key)`, and the received temporary is removed.

There is one source of truth: the access module declares only the resolver's type, and the identity module supplies the
implementation. The module graph is unchanged (identity → access is already allowed), and `architecture.test.ts`
passes.

**Observed** (`cutf8-09c…node22.log`, also in every integration run):
- Q1 (grant revoked mid-body): 403 `forbidden`. Nothing changed: no content row, version 1, `current` null, no file, no
  upload audit. There is one `authorization.denied` event on the transformation, with reason
  `POST …/content requires transformation.read`.
- Q1b (logout mid-body): the logout is 200 and `/me` 401; the upload is 401 `unauthenticated` and nothing is stored.
- Idle expiry and absolute expiry mid-body: 401 each, nothing stored.
- User disabled mid-body: 401, nothing stored.
- Positive controls:
  - a normal upload is 200, byte-exact (sha256), audited once;
  - a grant revoked and re-granted (a new assignment) mid-body is 200, because the commit sees the current grants.

**Sweep: routes that wait on the client, or on anything slow, between `preValidation` and their commit.**

| Route / wait | Waits on | Between preValidation and commit? | Needs the commit-time re-check? |
|---|---|---|---|
| `POST …/evidence/{id}/content` (upload) | the request body, up to requestTimeout (300 s). Its parser passes the raw stream through; it is the only route that declares `application/octet-stream`. | yes (phase 2) | **yes: fixed** |
| Every JSON route (all other mutations) | the body | no: Fastify parses the body (preParsing → parsing) **before** `preValidation` (bodyLimit 1 MiB, the same requestTimeout) | no |
| `GET …/content` (download) | a slow reader, while the file streams | after the read decision; it is a read, not a commit | no (see gaps: an in-progress download continues after a revocation) |
| `GET /auth/callback` | the IdP token exchange | public route, no session yet; the user and grants are resolved after the exchange | no |
| `POST /auth/logout` | `oidc.endSessionUrl()` (discovery) | after its commit, outside any transaction | no |
| Any route | a pooled connection: checkout ≤ 10 s (`connectionTimeoutMillis`) between the hook and the route's transaction | yes, bounded at 10 s | no: it is the same bounded window as any request in flight at the moment of a revocation |

**Residual window.** The re-check runs as the first statements of phase 3's transaction, which is READ COMMITTED.

- A revocation, logout or expiry that commits after those statements read the session and grants, and before the
  upload's COMMIT, is not seen.
- That window holds only the rest of one short transaction: `ownershipOf`, the version check with the row lock
  (`FOR UPDATE`), the content insert, the item update, the audit insert and the local rename. That is milliseconds,
  bounded by `statement_timeout` (30 s) per statement.
- The upload is then ordered before the revocation. I chose not to lock the session and assignment rows (`FOR SHARE`),
  because a revocation or logout would then queue behind uploads.
- The optional bound on the upload time after authorisation was not added: the commit-time check makes it unnecessary.

### F-DG2-441 (REQ-S16-007): no remote call inside a transaction

**The fix.** `GET /api/v1/auth/login` (`identity/routes.ts:295`) now calls `oidc.prepareLogin()` first, holding no
connection.

- `prepareLogin()` covers discovery (an HTTP call with the configured timeout, cached on success and retried after a
  failure), the random state, nonce and PKCE verifier, the S256 challenge and the authorization URL.
- Only then does it open `db.transaction()` for `oidc.saveLoginState(tx, login)`, a single insert.
- If discovery fails, the answer is unchanged: 302 `/login?error=idp_unavailable` (the same `catch`).
- The OIDC callback was already correct and is unchanged.

**Observed:** this is Q7, with a never-answering IdP, pool max 3 and `AUTH_RATE_LIMIT_PER_MINUTE=20`.

- One second after three concurrent logins start, `pg_stat_activity` (read as superuser) shows the API pool's 3
  sessions as `idle`. None is `idle in transaction` or `active`.
- A signed-in user's `/me` is 200 in 6-7 ms; before the fix it took about 9 s.
- The logins end in 302 `/login?error=idp_unavailable`.
- The test shortens the discovery timeout to 4 s to keep the run short. The reviewer's probe used the default 10 s.
  The observation is made at 1 s, so the timeout value doesn't change it.

`oidc.test.ts` (normal OIDC login, callback, binding, expiry and the other cases) passes in all four integration runs
(§5).

**Sweep: every `await` inside a transaction, or while a pooled client is checked out.** This was an AST scan with the
TypeScript compiler API over all 121 non-test source files in `apps/api/src`, `apps/worker/src` and `packages/*/src`.
The log, with both scripts verbatim, is `02-transaction-await-sweep.log`.

- **Scope of the scan:** every `await` and `for await` inside
  - a `….transaction().execute(cb)` or `withTransaction(db, cb)` callback, including nested closures;
  - any function with a `Tx`, `DbOrTx`, `Transaction<…>`, `PoolClient` or `WriteContext` parameter, or a parameter
    named `tx`. This covers every helper called with the transaction, transitively.
  - every `pool.connect()`.

  The register specs' `check` and `beforeInsert` callbacks (they receive `ctx.tx`) are scanned separately.
- **Result:** 569 awaits. 548 reference the handle directly. The register spec callbacks: 29 of 29 are database calls.
- **The remaining items, resolved by hand:**

| Site | What it awaits | Verdict |
|---|---|---|
| `identity/oidc.ts` `startLogin`: `configuration_()` (discovery), `calculatePKCECodeChallenge` | **remote HTTP call** to the IdP; WebCrypto | **Fixed** (F-441). Both moved to `prepareLogin`, outside the transaction. Not in the after-scan. |
| `evidence/routes.ts:569` `store.finalise(key)` | local `rename()` of the received temporary | **Justified, the documented exception.** It is the last step before COMMIT, so a committed row never points at a missing object (BE17 design). It is local metadata I/O, not client or remote I/O. |
| `worker/relay.ts:57` `boss.send(…, { db: txExecutor(tx) })` | pg-boss insert | Database: pg-boss runs its SQL on our transaction. The scan classifies it `db`. |
| `access/team.ts:236`, `transformations/routes.ts:261`, `register-kit.ts:297`, `platform/idempotency.ts:57`, `kpi/support.ts:210` (`run()` / `exec()`) | closures defined in the same transaction callback | Database: their bodies are scanned too (nested or `tx`-named), with no non-database await. |
| `register-kit.ts:418/419/496` (`spec.check`, `spec.beforeInsert`) | register spec callbacks | Database: 29 of 29 awaits use `ctx.tx` (separate scan in the same log). |
| `assignments.ts:195/315`, `audit/index.ts:60`, `users.ts:236`, `charter.ts:231`, `register-kit.ts:356`, `canvas.ts:51`, `gates.ts:222`, `evidence/routes.ts:292` (`q….execute()`) | a Kysely query built earlier from the handle | Database. |
| `platform/health.ts:30` `pool.connect()` (`/readyz`) | `SELECT 1`, encoding, migration status | Database only, then `release()`. |
| `packages/db/src/cli.ts:51`, `migrate.ts:133` | migration CLI client | Database only. The migration files are read **before** `connect()`, and `log()` is synchronous. |
| `packages/db/src/dev-seed.ts` | `readFileSync` of the seed | Before `db.transaction()`. |

No `setTimeout`, sleep, queue call (other than pg-boss on the same transaction), child process or other HTTP call runs
inside a transaction anywhere in the API, the worker or the packages. The note in `packages/db/src/pool.ts` now says
exactly this.

### F-DG2-460 (REQ-S16-013): an upload cut by shutdown leaves nothing behind

**Cause, confirmed.** The shutdown grace destroys the connection of an upload still receiving its body.

- `receive()` then fails and cleans up asynchronously (close the handle, then `rm(.part)`), and the route's `catch`
  calls `discardUncommitted`.
- Since BE17 nothing in `main.ts` waited for that work: the handler holds no pooled client, so `db.destroy()` resolved
  at once, and `process.exit(0)` won.

**1. Shutdown waits for in-flight handlers.**

- `registerInFlightTracking` (`platform/in-flight.ts`) is registered in `buildServer` before any module. Its `onRoute`
  hook wraps every route handler: a promise a handler returns is tracked until it settles. That is after its
  `catch`/`finally`, so after the `.part` is removed.
- The wrapper returns the handler's own value, and synchronous handlers are untouched.
- `main.ts` (order also in `docs/operations/health-readiness.md`, "Shutdown and connection limits"):
  1. `app.close()`: stop accepting connections; idle connections close at once; in-flight requests get the 5 s grace,
     then the rest is destroyed.
  2. `await inFlight.settled(SHUTDOWN_SETTLE_MS = 3 s)`. A warn line is logged if handlers are still running.
  3. `db.destroy()`.
  4. `process.exit(0)`.
- The 5 s grace still bounds connections, and the 10 s backstop still bounds the whole sequence: 5 + 3 s plus the pool
  close stays under 10 s.
- `settled()` re-checks after a macrotask. So work that Fastify starts synchronously when a handler rejects is seen,
  such as the failed-mutation audit hook, which is tracked as well.

**2. Defence in depth: the start-up sweep.**

- Once the instance is ready, `FilesystemEvidenceStore.sweepStaleTemporaries` runs in the background and is tracked.
- **What it removes.** Only regular files named `<uuid>.part`, exactly 3 directories below the root (where upload keys
  put temporaries), last written more than **`STALE_TEMPORARY_AGE_MS` = 1 h** ago.
- **What it never touches.**
  - a final object (no `.part` suffix), whatever its age;
  - any other name;
  - a symlinked directory (not followed; unit-tested);
  - a fresh `.part`, which is counted as `keptFresh`.
- **Logging.** Each removal is logged at info, `evidence store: stale temporary object removed`, with `key`
  (identifiers only), `sizeBytes` and `ageMs`, never the content. The test asserts that the content string does not
  appear in the output. A summary line follows.
- **Why 1 h is safe with shared storage.**
  - A live upload's temporary has its mtime refreshed on every write, and the body must arrive within requestTimeout
    (300 s).
  - Phase 3 is bounded by the pool checkout (10 s) and the statement and idle-in-transaction timeouts (30 s).
  - Shutdown adds at most 10 s.
  - So any instance owns a temporary for under about 6 minutes. One hour is six times that or more, and leaves room
    for clock skew between hosts writing to shared storage. No live request on any instance can own what the sweep
    removes.
  - A unit test pins `STALE_TEMPORARY_AGE_MS >= 6 × (300 + 10 + 30 + 10) s`.
- **Limit.** A leftover younger than 1 h at start-up waits for a later start. There is no periodic sweep (see gaps).
  The primary guarantee is (1).

**3. Sweep of the class: handlers that own a temporary resource with asynchronous cleanup.**

| Owner | Resource | Cleanup | Does a graceful shutdown let it finish? |
|---|---|---|---|
| `POST …/content` (upload): `store.receive` | file handle + `<uuid>.part` | `catch` in `receive` (close, then `rm`), then the route's `catch` → `discardUncommitted` (final + `.part`) | **Yes, now**: the handler promise is tracked and `main.ts` awaits it before `db.destroy()`/`exit`. Tested: stalled, actively streaming, qa R12-07 and R11-02(b). |
| `POST …/content`, phase 3 failure (commit refused, 401/403/409/422/500) | `.part` or a finalised object | the same route `catch` | Yes: the same tracked handler. |
| `GET …/content` (download) | a read stream (file descriptor) | the stream is destroyed with the socket | Nothing persists: a descriptor is released at exit, and no file is created. Tracked as a handler anyway. |
| Failed-mutation audit hook (`access/denials.ts`, onError) | a short DB transaction after the handler settled | commit or rollback | Yes: tracked (`app.inFlight.track`), so the pool is not closed under it. |
| Evidence start-up sweep (`evidence/routes.ts` onReady) | `rm` of stale temporaries | n/a (each `rm` is atomic) | Yes: tracked. Interrupting it would leave only temporaries for a later start. |
| Connection hygiene timers (lingering close, shutdown grace) | `setTimeout`, all `unref()`'d | none needed | Nothing persists; these timers are what bound the shutdown. |
| Every other handler | DB transactions only | rollback | `db.destroy()` (pg-pool `end`) waits for checked-out clients, and handlers are tracked as well. |
| Worker (`apps/worker`) | DB transactions; pg-boss jobs | rollback, job retry | The worker's shutdown awaits the running relay tick (`worker.stop()`) and `boss.stop({ graceful: true, wait: true })` before `db.destroy()`. It owns no files. |

**Observed** (real process, real filesystem store; `nolocale-09a`, `cutf8-09c`, all runs):
- R12-07 (2 MiB of a declared 10 MiB, stalled): the store held the `.part` (2,097,152 B) during the stall. On SIGTERM
  the process exits 0 in about 5,030 ms and the store is **empty**, with 0 content rows. There is no error-level log
  line, and `shut down` is logged.
- An upload still streaming at about 1.25 MiB/s through the grace: exit 0 in about 5,030 ms (it is given the full
  grace), and the store is empty.
- Positive control: an upload completed before SIGTERM keeps exactly one final object and its row. Shutdown is prompt
  (< 3 s).
- Sweep: the stale `.part` is removed and logged (info, key, 46 B, age about 7,200,000 ms). Kept: a 10-minute-old
  `.part`, an old and a new final object, `notes.part`, and a stale `.part` at the wrong depth. The summary is
  `removed 1, keptFresh 1`.
- qa's own probes, on a disposable build of this change (`03-qa-R11-02-R12-07-{unset,cutf8}.log`):
  - R11-02 (a)+(b) and R12-07 **pass** in chromium-en and chromium-ar, under both locale settings (4 of 4 per
    setting);
  - R11-02(b) reports `stored files 0`;
  - R12-07 reports `store after exit []` for both the SIGTERM case and the control.

## 3. Checks actually run

**Environment.**
- The matrix ran on this working tree (`matrix-commands.log` is the exact script).
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) and Node 22.22.2 (`/opt/node22/bin`).
- Disposable PostgreSQL 16.13 clusters (`tests/qa/support/with-pg.sh`, `apps/web/e2e/support/with-stack.sh`,
  `e2e/support/qa-stack.sh`), ports below 32768, offline.
- The pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); `playwright install` was never run.
- Locale settings: **nolocale** = `LANG`/`LC_*` unset; **cutf8** = `LANG=C.UTF-8`.

| # | Command | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | **exit 2**: only the 12 sandbox-masked dotfiles fail with EACCES (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`), then "All matched files use Prettier code style!" | same, exit 2 |
| 05 | `npx prettier --check .` excluding those 12 paths | exit 0 | exit 0 |
| 06 | `pnpm openapi:lint` | exit 0, `PASS … OpenAPI 3.1.1, 161 operations` | same |
| 07 | `pnpm test`, Node 22.22.2 | exit 0, 44 files, 796 tests passed | same |
| 08 | `pnpm test`, Node 24.21.0 | exit 0, 44 files, 796 tests passed | same |
| 09a | `with-pg.sh pnpm test:integration`, run 1, Node 24 | exit 0, 39 files, 612 tests passed | same |
| 09b | `with-pg.sh pnpm test:integration`, run 2, Node 22 | exit 0, 39 files, 612 tests passed | same |
| 09c | Node 22: `with-pg.sh npx vitest run --project integration` on `commit-time-auth`, `shutdown-cleanup`, `oidc`, `evidence`, `request-io`, `connection-hygiene`, `identity` | exit 0, 7 files, 87 tests passed | same |
| 10 | `with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | exit 0, `60 passed (3.9m)` | exit 0, `60 passed (3.9m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | same |
| 12 | qa's R11-02 + R12-07 (`qa-stack.sh npx playwright test e2e/dg2-qa-r11.spec.ts e2e/dg2-qa-r12.spec.ts -g 'R11-02\|R12-07' --workers=1`), disposable clone = HEAD + this change, built; the specs are byte-identical to qa's (`cmp`) | exit 0, 4 passed | exit 0, 4 passed |

Each logged in `<mode>-<id>.log`, summarised in `<mode>-00-summary.log`. Row 12 is in `03-qa-R11-02-R12-07-{unset,cutf8}.log`. The integration suite therefore ran twice per locale setting, four runs in all, each including `oidc.test.ts`, the evidence tests, `request-io.test.ts`, `connection-hygiene.test.ts` and both new files.

**Negative control: the new tests fail on `HEAD` before the change.**

- **`01-negative-control-on-HEAD.log`:** a disposable clone at `8c02475` plus the two new integration files in their
  final form (sha256 prefixes in the log header), on Node 24 with `LANG=C.UTF-8`. Exit 1, **9 failed and 3 passed of
  12**.
  - The failures:
    - R12-07 and the streaming case: the `.part` file is left behind (2,097,152 B and 7,274,496 B);
    - the sweep: the summary line never appears;
    - Q1: 200, committed;
    - Q1b, idle expiry, absolute expiry and disabled user: 200 instead of 401;
    - Q7: `idle in transaction`.
  - The 3 that pass are the positive controls, which must pass on HEAD too: a completed upload kept, a normal upload,
    and a re-grant.
- **`04-qa-R11-02-R12-07-on-HEAD-baseline-unset.log`:** qa's R11-02 and R12-07 on a build of HEAD fail 4 of 4 (`content
  rows 0, stored files 1`), which reproduces F-460.
- The two new unit files test symbols that don't exist at HEAD (`in-flight.ts`, `sweepStaleTemporaries`), so they
  cannot pass there.

**Every non-zero exit, failed suite, hook timeout or error-level log line in my evidence:**

- Row 04: exit 2 in both settings. Its cause is the 12 sandbox-masked dotfiles only (EACCES). They are not repository
  files I can read. Row 05 is the passing variant.
- `01-negative-control-on-HEAD.log` and `04-qa-…-on-HEAD-baseline-unset.log`: exit 1, the intended negative controls.
- In every integration log, the line `BE17 db-econnreset: {"status":500,…,"errors":[{"msg":"unhandled error","code":"ECONNRESET",…}]}`.
  This is BE17's deliberate "no over-match" test in `request-io.test.ts`: a database-side reset must be a 500 with an
  error log, and the test asserts that this error-level line exists. It passes.
- No log contains `Hook timed out`, `Failed Suites`, an unhandled error, or any other error-level (`"level":50/60`)
  line.
- Warnings, not errors, all pre-existing:
  - Fastify `FSTDEP022` (router options deprecation) in the unit runs;
  - npm `Unknown project config` warnings when `npx` reads `.npmrc`.

## 4. Known gaps / not done

- **Downloads in progress are not cut on revocation.** A download (`GET …/content`) that started before a revocation
  keeps streaming. It is a read authorised when it started, and no commit is involved. Out of scope for F-440, which is
  about writes; stated for completeness.
- **The residual commit-time window remains** (§2, F-440): a revocation committed during the few milliseconds of phase
  3's own transaction is ordered after the upload.
- **The start-up sweep only runs at start-up.** A temporary orphaned by a crash or SIGKILL is removed at the first
  start at least 1 h later. The worker does not sweep, because it may not share the store. The S3-compatible store (P6)
  will need its own equivalent (for example, a lifecycle rule on incomplete uploads). Its stub's sweep is a no-op.
- **The handler settle wait is bounded at 3 s.** A handler stuck longer, for example on a database statement up to the
  30 s statement timeout, is not awaited. The process then logs a warn line and proceeds. If `db.destroy()` still waits
  for that client, the existing backstop exits 1 at 10 s, as before.
- **Shortened timeout in Q7.** Q7 runs with a 4 s discovery timeout instead of the default 10 s, to keep the suite
  fast. The observation is made at 1 s, so it doesn't change the result.
- **Session-expiry tests.** The idle and absolute expiry tests move the session's expiry columns into the past in the
  middle of the body. The assignment's alternative was a shortened idle timeout; this is equivalent for the commit-time
  check, which reads those columns.

## 5. Merge instructions

- No migrations and no contract changes. No new dependencies; `pnpm-lock.yaml` is unchanged.
- **Interface changes:**
  - `buildServer()` now also returns `inFlight`;
  - `EvidenceStore` gains `sweepStaleTemporaries`, so a custom implementation must add it;
  - `OidcService.startLogin(tx, …)` is replaced by `prepareLogin(…)` + `saveLoginState(tx, …)`;
  - `FastifyRequest` gains `reauthenticate`, and `FastifyInstance` gains `inFlight`.

  No other caller exists in the repository: `pnpm -r typecheck` is clean in both settings.
- **Conflicts:** none expected. No other agent ran at the same time.
