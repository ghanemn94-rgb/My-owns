# Assignment T-DG2-BE17: no client I/O inside a database transaction, and aborted bodies are never a 500 (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768; the harnesses retry on collision.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Findings:** the full text is in `docs/delivery/findings.json`. The reviewer's probe is `docs/delivery/test-evidence/DG2/code-security/round-11/probes/zz-sec-r11-probe.test.ts`; its logs are next to it. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Findings to repair
**F-DG2-411 (Medium, REQ-S16-013): a stalled upload holds a pooled connection and a row lock.**
- `uploadEvidenceContent` (`apps/api/src/modules/evidence/routes.ts:417-464`) starts `db.transaction()`, takes the row lock (`lockEvidence` FOR UPDATE), and only then streams the request body into the store.
- The pooled connection sits idle in transaction for as long as the body takes to arrive.
- The API pool has max 20 and no checkout timeout (`packages/db/src/pool.ts:42-50`), and `statement_timeout` does not cover idle-in-transaction.
- Probe R8: N stalled uploads (N = pool size) by one authorized user block every DB-backed request of every user, and `/readyz`, until `requestTimeout` (300 s).

**F-DG2-412 (Low, REQ-DLV-034): an aborted JSON body is an unhandled 500.**
- A JSON request body aborted mid-way, either by a client disconnect or by `requestTimeout`'s 408, reaches the error handler as an unmapped `ECONNRESET`/`aborted` error.
- Fastify's rawBody sets `statusCode = 400` on it.
- The result is a level-50 `unhandled error` log line and a 500 for every such request.
- BE16's `abortedBodyProblem` fixed this for the upload route only.

## Required
1. **No client I/O while holding a pooled connection or a transaction (F-411, fix the class).**
   - Restructure the upload in this order:
     1. Authorise and check preconditions with short queries, holding no transaction: transformation read, the `EDIT_OWN` check, the item exists and is a file, `If-Match` present, file name valid. If you need a transaction for the checks, release it before reading the body.
     2. Receive the body into the store's temporary object (`.part`), outside any transaction. Keep the streaming size limit and the sha256 over the raw bytes. Leave nothing behind on any failure.
     3. Open a short transaction: lock the row, **re-check `If-Match` against the locked version** (optimistic concurrency, so a concurrent edit during the upload gets the declared 409 `VersionConflict` and the temporary object is discarded), insert the content row and write the audit event. Commit, then finalise the object exactly as today.
   - Every declared status and problem code stays as it is: 400, 401, 403, 404, 409, 413, 428, 422 and the existing `evidence.*` and `validation.*` codes. Show this with the existing evidence tests.
   - **Sweep.** Find every other handler that awaits client I/O while it holds a pooled connection or a transaction. That includes upload reads and also **download writes to a slow reader** (`GET …/content`): is the stream sent after the query's connection is released? List each handler with its before and after behaviour.
   - **Defence in depth on the pool** (`packages/db`): a bounded checkout wait (`connectionTimeoutMillis`, giving a declared 503 or the existing readiness behaviour, never a hang), and `idle_in_transaction_session_timeout` on the app sessions. Choose the values, document them, and show they don't break the migrate, seed or worker paths.
2. **Aborted or incomplete bodies on every route (F-412).**
   - Map the class centrally in `mapError` (`platform/hooks.ts`): a request whose body was not received completely (`request.raw.aborted`, `ECONNRESET`/`aborted`, Fastify's rawBody stream errors) gets the declared 400 `validation.malformed_request`, logged below error level.
   - Do this for JSON and octet-stream alike, and for both the client disconnect and the `requestTimeout` case.
   - Remove or align the route-local `abortedBodyProblem`, so there is one rule.
   - A genuine server fault must still be a 500 with an error log. Do not over-match: a database `ECONNRESET` is not a client abort.
3. **Tests.**
   - **Integration on real sockets:**
     - the reviewer's R8: N stalled uploads with a harness pool of size N; `/me` and `/readyz` still answer promptly;
     - an upload whose `If-Match` goes stale during the body gets the declared conflict, with no content row and no object;
     - R6a and R6d: an aborted or stalled JSON body gives no error-level log and no 500;
     - a database-side `ECONNRESET` is still a 500, so the mapping does not over-match;
     - valid uploads stay byte-exact with their sha256;
     - the existing evidence tests and the BE16 connection-hygiene tests still pass.
   - **Unit tests** for the error mapping.
   - **Negative control:** the new tests fail on `HEAD` before your change.

## Self-verification (real output in the handback)
Run every check in **both locale settings**. **Report every non-zero exit, failed suite, hook timeout or error-level log line in any log, and explain it.** An undisclosed failure in your evidence voids the run.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite **twice per locale setting**
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE17-backend-workflow-engineer.md` with the fix, the sweep table and every check's real output. List any remaining gap honestly. Keep evidence to logs only.
