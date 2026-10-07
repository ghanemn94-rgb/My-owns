# Handback: T-DG2-BE16, backend-workflow-engineer

- **Stage:** P2 / DG2 (FIXING, after the round-10 audit BLOCKED). **Branch:** `claude/mobily-transformation-platform-regate`.
- **Base:** `8b50cbfd541e5c82a7fdf5eb68dcccccd5bac455`. `git rev-parse HEAD` returned it before I wrote anything. The tree was clean apart from the sandbox-masked untracked dotfiles and this run's own `runs/` directory.
- **Run:** `DG2-T-DG2-BE16-backend-workflow-engineer-20261007T001928Z-87a53fd9`, session `87a53fd9-3d3d-41dc-9564-eef928ed1a04`.
- **Assignment:** `docs/delivery/assignments/DG2/round-11/T-DG2-BE16.md`. Its sha256 was `ce08d387…24926c`, checked before starting.
- **Defect:** blocking condition 2 of `docs/delivery/gates/DG2.json`, in the scope of REQ-S13-012 and REQ-S16-013. **It has no finding ID.** The code-security-reviewer triages it in round 11. I assigned no severity and closed nothing.
- **Not touched:**
  - no migrations;
  - no API endpoints added or changed;
  - no change to `docs/api/openapi.yaml` (still 161 operations);
  - no dependency change;
  - nothing under `tools/**`, `.claude/**` or `docs/source/**`, and no reviews or gate records.
- **Gates:** this is engineering delivery work. It grants no G1–G6 business approval and implies nothing about DG7.

## 1. Root cause (Required 1)

I reproduced the defect without the database or any project code: `T-DG2-BE16-evidence/root-cause-repro.log`. The reproduction uses plain `node:http`, then plain Fastify 5.6.1 with the upload route's pattern: a parser that calls `done(null, payload)`, and the handler reading with `for await` over the body.

**Over-limit upload (the auditor's case): the socket is left paused for good.**

1. `FilesystemEvidenceStore.put` throws `EvidenceTooLarge` inside `for await (const chunk of body)` (`store.ts:80`). The body is the raw `IncomingMessage`.
2. The async iterator's `return()` calls Node's stream `destroyer()`.
   - For a **server** request, `destroyer()` first sets `req.socket = null`, so that the response can still be written. Only then does it destroy the request.
   - The trace in the log shows this: `IncomingMessage.set [as socket]` ← `Object.destroyer (node:internal/streams/destroy:333)` ← `createAsyncIterator`.
   - `IncomingMessage._destroy` therefore finds no socket and leaves it alone.
3. The HTTP parser is still in the middle of the body. It pushes the next chunk into the destroyed request. `push()` returns false, so the parser calls `readStop()` on the socket. Nothing ever calls `_read()` again.
   - After the 413 the log shows `flowing=false reading=false`.
   - `bytesRead` stays at about 5 MB of the 30 MB sent.
4. **So the request stream is not left half-consumed: it is destroyed, and the socket is stopped.** Node's `_dump` is not waiting either: it calls `resume()` on the destroyed request, which does nothing.
   - The 413 goes out with `Connection: keep-alive`, because Node doesn't know the body was abandoned.
   - A paused socket never reads, so it never notices the client's FIN or RST.
   - That is why the server still reported `connections=1` after the client had gone.
5. **Where the 65 s comes from.** It is Fastify's `keepAliveTimeout`, **72 000 ms** by default. Node arms it on the socket in `resOnFinish`, after the response.
   - The auditor's client waited 8 s before destroying its socket: 8 s + 65 s ≈ 73 s.
   - My plain-Fastify reproduction logs `app.close done` at 73 101 ms. Its client also waited 8 s, and the server reports `connections=1` every 5 s until then.
   - Fastify's `requestTimeout` is **0** (Node's own default is 300 s), so Node's connection checker never expires the request.
   - `headersTimeout` doesn't apply, because the headers are complete.
6. **Why `app.close()` and SIGTERM waited.** Fastify's `forceCloseConnections` defaults to `"idle"`, which calls `server.closeIdleConnections()`.
   - The connection isn't idle, because its request never completed in the parser, so it is skipped.
   - `server.close()` then waits until the keep-alive timer destroys the socket.
   - This is also why round 10's code-security probe timed out in its `afterAll(() => api.close())` hook after 30 s: the probe ran the same scenario (P5s).

**A sibling defect: the server drained the body without limit.** This happens when the response is sent **before** the body is read:

- 401/403 from the identity `preValidation` hook (the octet parser reads nothing);
- 404/409/428/400/422 from the upload handler;
- `FST_ERR_BAD_URL` from the router.

Here the request is not destroyed, so `resOnFinish` calls `req._dump()`. That reads and discards the whole body, keeping the connection alive for as long as the client sends.

- In the negative control, `app.close()` had not finished after 8 s while a refused client kept sending.
- A stalled body (the client sends part of it, then nothing) was held for ever, because there was no request timeout. On the upload route that also holds a pooled database connection and the evidence row lock.

## 2. The fix (Required 2–4)

All of the policy lives in `apps/api/src/modules/platform/connection-hygiene.ts` (new), and applies to every route.

1. **`Connection: close` on any response sent before its request body has fully arrived.**
   - The test is `request.raw.complete === false`.
   - It runs as an `onSend` hook on the root instance, so every route, the error handler and the not-found handler inherit it.
   - The router-level `frameworkErrors` handler runs no `onSend` hook, so it calls `closeIfBodyUnconsumed` itself.
   - A body that arrived completely (normal 2xx responses, small refusals) keeps its keep-alive connection.
   - light-my-request has no `complete` property, so `inject` responses are never treated as unconsumed.
2. **A bounded lingering close (RFC 9112 §9.6).** After a `Connection: close` response, Node calls `socket.destroySoon()`. For these sockets only, `lingerOnClose` replaces it with the following sequence:
   - shut down the write side (FIN) once the response is flushed;
   - `destroy()` 500 ms later (`RST_AVOIDANCE_DELAY_MS`, the delay Go's net/http uses);
   - destroy at the latest 2 s after the close starts (`LINGER_CAP_MS`), even if the client reads nothing.

   The delay lets the client read the response before the reset that closing with unread bytes causes. The rest of the body is never read.

   If a future Node stopped calling `destroySoon`, it would fall back to its own `socket.end()` after the `Connection: close` response, and only the delay would be lost. Node 22.22.2 and 24.21.0 both pass the integration tests.
3. **Bounded shutdown.**
   - `forceCloseConnections` stays `"idle"`, so idle keep-alive connections are closed at once.
   - A `preClose` hook marks the instance as closing, so every later response carries `Connection: close`.
   - The same hook starts a deadline. After `shutdownGraceMs` (default **5 s**, `DEFAULT_SHUTDOWN_GRACE_MS`), `server.closeAllConnections()` destroys whatever is still open, and a warn line gives the count.
   - `main.ts` now logs `shut down` before exiting 0. As a backstop, it logs an error and exits 1 if shutdown hasn't finished 10 s after the signal.
4. **`requestTimeout` = 300 s.** This is Node's own default; Fastify's default is 0.
   - A stalled body gets 408 `request_timeout` from the existing `clientErrorHandler`, and the connection closes.
   - Node arms this timeout only when it is passed to `http.createServer`. Fastify's own option alone has no effect: in a standalone check it never fired, and it did once I added the `http` option. It is now passed in Fastify's `http` options as well.
5. **The upload handler (`evidence/routes.ts`), when the client goes away mid-body.** This covers `request.raw.aborted` and `ECONNRESET`.
   - The store has already removed its `.part` file, and the transaction rolls back.
   - The handler now answers with the declared 400 `validation.malformed_request`. Nobody receives it, because the socket is gone.
   - Before, this was a 500 with an `unhandled error` log line at level 50. The negative control shows it.
6. **Unmatched-route rate limiting (Required 4).**
   - `registerPlatformHooks(app, { notFound: "deferred" })` no longer installs the not-found handler. Without the option, behaviour is unchanged; the unit tests use it that way.
   - `server.ts` installs it after `@fastify/rate-limit` with `registerNotFoundHandler(app, { spaFallback, preHandler: app.rateLimit() })`. This is the plugin's documented form, with the same key generator, store, limit, allow-list and 429 problem.
   - **A 429 on an unmatched route is outside the contract by design, as the unmatched 404 is (ADR-0007 §5b).** No operation matched, so no operation can declare it.
   - The SPA fallback still serves `index.html`, and is now counted in the same bucket as the static assets.

**Trade-offs:**

- An in-flight request that needs more than 5 s after SIGTERM is cut off. Its transaction rolls back and no partial object is kept, so a large upload on a slow link has to be retried.
- Requests that finish within the grace period complete normally, with `Connection: close`. The test is "in-flight upload … completes normally".
- I didn't choose `forceCloseConnections: true`, because it would cut every in-flight request at `close()`.
- A 25 MiB upload slower than about 0.7 Mbit/s (more than 300 s) now gets 408.
- A client that is still sending when it is refused may see a reset 0.5–2 s after the response.
- The policy is documented in `docs/operations/health-readiness.md`, in the new section "Shutdown and connection limits". No runbook covered shutdown before.

## 3. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/connection-hygiene.ts` (new) | The policy: `Connection: close` for an unread body, the lingering close, shutdown grace and deadline, and the timeout constants |
| `apps/api/src/modules/platform/connection-hygiene.test.ts` (new) | Unit tests: linger timing and cap, idempotence, light-my-request safety, the header, `Connection: close` while closing |
| `apps/api/src/modules/platform/index.ts` | Exports the new functions and constants, and `registerNotFoundHandler` |
| `apps/api/src/modules/platform/hooks.ts` | Not-found handler split out as `registerNotFoundHandler` (with `preHandler`); option `notFound: "deferred"` |
| `apps/api/src/modules/platform/framework-errors.ts` | Router-level errors apply `closeIfBodyUnconsumed` |
| `apps/api/src/server.ts` | `requestTimeout` (also in `http`), `forceCloseConnections: "idle"`, connection hygiene, rate-limited not-found handler; new `ServerOptions` `shutdownGraceMs`, `requestTimeoutMs`, `connectionsCheckingIntervalMs` |
| `apps/api/src/main.ts` | SIGTERM/SIGINT backstop (exit 1 after 10 s) and the `shut down` log line |
| `apps/api/src/modules/evidence/routes.ts` | Client abort mid-body becomes the declared 400, not an `unhandled error` 500 |
| `apps/api/test/integration/connection-hygiene.test.ts` (new) | 13 integration tests over a real socket (see §5) |
| `apps/api/test/support/harness.ts` | `startApi({ server })` passes the new server options and `webRoot` through |
| `apps/api/test/integration/framework-errors.test.ts` | The reference unmatched 404 now carries `x-ratelimit-*`; the security-header comparison excludes those rate-limit headers (no other change) |
| `docs/operations/health-readiness.md`, `docs/operations/README.md` | Shutdown and connection-limit runbook section, and the index entry |
| `docs/delivery/handbacks/DG2/T-DG2-BE16-evidence/*.log` | Evidence (logs only) |

## 4. Sweep (Required 6)

The sources are `sweep-before-8b50cbf.log` (the negative control, with `apps/api/src` at HEAD) and `sweep-after.log` (six runs: two per locale on Node 24, and the targeted run on Node 22 in each locale). The values below are from `nolocale-09a`; the other five runs agree within a few ms.

How to read the table:

- "FIN 0 ms": the server ended the connection together with its response, while the client was still connected (and, for the refusal sweep, still sending).
- "conns 0": the server's `getConnections()` count reached 0, measured after the test client destroyed its socket.
- In the refusal sweep, the client sends an **endless** body (64 KiB pieces) and waits up to 3 s for the server to close.

| Path (real socket) | Before @8b50cbf: status · `Connection` · who closes, when | After: status · `Connection` · who closes, when |
|---|---|---|
| Upload over the limit, 30 MiB **chunked** (the audit repro) | 413 · keep-alive · **nobody**: the server never closes, and conns is still 1 three seconds after the client left. The socket is paused until the 72 s keepAliveTimeout (73.1 s in `root-cause-repro.log`). | 413 · close · server FIN 0 ms, destroyed 0.5 s later (conns 0 at 505 ms) |
| Upload over the limit, 30 MiB **Content-Length** | 413 · keep-alive · nobody (same as above) | 413 · close · FIN 0 ms, conns 0 at 505 ms |
| Upload 401 no session / 403 no CSRF / 404 unknown id / 409 stale If-Match / 428 no If-Match / 400 `%FF` file name / 422 not a file (chunked, endless) | declared status · keep-alive · **the server drains the body without limit** and never closes; the client gives up after 3 s | same status · close · FIN 0 ms, conns 0 |
| Upload 401 and 428, Content-Length 30 MiB | 401/428 · keep-alive · the server drains the 30 MiB; it closes about 2.5 s in, only because the bytes the test sends beyond the declared length don't parse | 401/428 · close · FIN 1 ms, conns 0 |
| Upload 400 media type (`text/plain`) | 400 `validation.content_type` · close · FIN 0 ms (already correct) | unchanged, plus the lingering destroy |
| JSON over bodyLimit, chunked and Content-Length | 400 `validation.body_too_large` · close · FIN 0 ms (Fastify's own parser error) | unchanged, plus the lingering destroy |
| Unmatched route 404, chunked and Content-Length 30 MiB | 404 · close · FIN 0 ms (already correct) | unchanged; now rate limited |
| Router-level 400 `FST_ERR_BAD_URL`, chunked | 400 · keep-alive · server drains without limit | 400 · close · FIN 0 ms |
| Client aborts mid-upload (CL and chunked) | conns 0 at about 25 ms and the `.part` file removed, but logged as `unhandled error` (level 50, ECONNRESET) with a 500 | conns 0 at about 25 ms, no partial file, no content row, version unchanged, no error log; the same If-Match then uploads (200) |
| Stalled body, no shutdown | held for ever (no `requestTimeout`) | 408 and closed at 1.76 s with the test's `requestTimeout` of 1.5 s (production: 300 s) |
| Valid 3 MiB upload (keep-alive) | 200 · keep-alive · stays open | unchanged: 200 · keep-alive · stays open (the next request is served); sha256 byte-exact |
| Small refused body that arrived completely (428) | keep-alive, next request served | unchanged |
| Unmatched-route flood at a limit of 4/min | `[404, 404, 404, 404]`, never limited | `[404, 404, 404, 429]`; SPA deep link 200 before the limit, 429 after |

**How long `app.close()` takes:**

| Situation | Before @8b50cbf | After |
|---|---|---|
| After the 413 (client gone) | **not done after 6 s** (test cap); 65 s in the audit, 73.1 s in `root-cause-repro.log` | 0–1 ms |
| After the refusal sweep (clients gone) | 0 ms | 1 ms |
| While a refused (403) client keeps sending | **not done after 8 s** (cap) | 0 ms |
| With a stalled upload in flight | **not done after 15 s** (cap); unbounded | 5.003 s (grace 5 s) |
| With an in-flight upload that finishes during shutdown | **not done after 15 s** (cap): the keep-alive 200 held the connection | 0.467 s; 200 with `Connection: close` |
| SIGTERM to `src/main.ts` with a stalled upload | **no exit after 15 s** | exit 0 at 5.03 s (Node 24) and 5.027 s (Node 22) |

## 5. Tests (Required 5)

All 13 tests in `apps/api/test/integration/connection-hygiene.test.ts` use a real socket (llhttp). They run against the run's disposable PostgreSQL, and every in-contract response is asserted with `assertContract`.

1. **The auditor's scenario** (30 MiB chunked, every byte queued at once): 413 `evidence.too_large`, `Connection: close`, the server closes, connection count back to 0 within 2 s, `app.close()` within 2 s. Also checked: nothing stored, no `.part` file, version unchanged, no error log.
2. The same scenario with Content-Length.
3. **The refusal sweep** on the upload route, with an endless body each time:
   - 401, 403, 404, 409, 428, 400 (file name), 422 and 400 (media type) on chunked bodies;
   - 401 and 428 on Content-Length;
   - JSON over bodyLimit, chunked and Content-Length;
   - unmatched 404, chunked and Content-Length;
   - `FST_ERR_BAD_URL`.

   Each must answer with its declared status and `Connection: close`, the server must close within 2 s, and the connection count must reach 0. `app.close()` must then be prompt.
4. `app.close()` while a refused client keeps sending.
5. Positive control: a small refused body that arrived completely keeps its keep-alive connection.
6. Client abort mid-upload, Content-Length.
7. Client abort mid-upload, chunked. For both: no partial object, no content row, version unchanged, the connection count back to 0, no error log, and the lock is released.
8. A valid 3 MiB upload is stored byte-exact with its sha256 (also checked through the download), and the keep-alive connection serves the next request.
9. `app.close()` with a stalled upload completes within the default 5 s grace period.
10. An in-flight upload that finishes during shutdown completes normally.
11. Stalled body → 408 via `requestTimeout`.
12. SIGTERM: the real `src/main.ts` process exits 0 within the grace period.
13. Unmatched-route flood → 429. The SPA fallback works; a matched route shares the bucket.

**Negative control** (`negative-control-head-8b50cbf.log`). Command: `QA_PG_PORT=24471 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/connection-hygiene.test.ts`.

- Setup: the final test file and the harness option, with every `apps/api/src` change reverted to HEAD (`git status` is in the log). I backed up my versions, restored HEAD's with `git show HEAD:<path>`, ran the file, and put my versions back. git metadata was never written.
- Result: **exit 1, `Tests 11 failed | 2 passed (13)`**. Every new test fails, including the auditor's scenario, except the two positive controls (valid upload, small complete body), which are expected to pass on HEAD.

Unit tests: `apps/api/src/modules/platform/connection-hygiene.test.ts` (6 tests) is included in the 771.

## 6. Checks actually run (Self-verification)

**Matrix.** The script is recorded verbatim in `T-DG2-BE16-evidence/matrix-commands.log`. It was run once per locale setting:

- `nolocale`: `env -u LANG -u LC_ALL -u LC_CTYPE …`;
- `cutf8`: the same with `LANG=C.UTF-8`.

Each check writes one log, `<mode>-<id>.log`, containing the command, the Node version, the locale variables and the exit status. The summaries are `nolocale-00-summary.log` and `cutf8-00-summary.log`.

| # | Command (Node 24.21.0 unless stated) | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 0, "All matched files use Prettier code style!" | same |
| 05 | `npx prettier --check . '!.bash_profile' …` (the `--ignore-path` variant, excluding the masked dotfiles) | exit 0 | exit 0 |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | same |
| 07 | `pnpm test` (Node 22.22.2) | exit 0, Test Files 41 passed (41), Tests 771 passed (771) | same |
| 08 | `pnpm test` (Node 24.21.0) | exit 0, 41 / 771 passed | same |
| 09a | `tests/qa/support/with-pg.sh pnpm test:integration`, run 1 | exit 0, Test Files 35 passed (35), Tests 583 passed (583) | same |
| 09b | the same, run 2 | exit 0, 35 / 583 passed | same |
| 09c | Node 22.22.2: `with-pg.sh npx vitest run --project integration` on connection-hygiene, `contract/contract.test.ts`, `media-types.test.ts` and `evidence.test.ts` | exit 0, Test Files 4 passed (4), Tests 58 passed (58) | same |
| 10 | `apps/web/e2e/support/with-stack.sh npx playwright test journeys.spec.ts p2-journeys.spec.ts p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (pre-installed Chromium, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` never run) | exit 0, `60 passed (3.8m)` | exit 0, `60 passed (3.7m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | same |

The integration runs 09a and 09b include `contract/contract.test.ts`, `media-types.test.ts`, `evidence.test.ts`, `framework-errors.test.ts` and the new `connection-hygiene.test.ts`. The new file ran 13/13 in each of the six runs, in about 18.6 s.

**Disclosure of every failure, warning and repeated run:**

- **No check in the recorded matrix exited non-zero.** I grepped every log for `Hook timed out`, `Failed Suites`, `Failed Tests`, ` FAIL `, `failed (` and `×`, and found nothing.
- I wrote this handback after the matrix's format checks (04/05) had run. I checked it separately: `npx prettier --check docs/delivery/handbacks/DG2/T-DG2-BE16-backend-workflow-engineer.md` → exit 0, "All matched files use Prettier code style!". After the matrix I wrote only this handback and the two sweep extracts (`sweep-before-8b50cbf.log`, `sweep-after.log`). No source, test or documentation file changed.
- The unit logs (07/08) contain one Node warning, `[FSTDEP022] FastifyWarning: The router options for constraints property access is deprecated`. It also appears in BE15's logs, so it isn't from this change.
- The web build prints Vite's chunk-size advisory. It predates this change.
- **Superseded runs** (logs deleted, not used as evidence):
  1. A first matrix started from a foreground shell was killed when that tool call ended. Nothing was recorded.
  2. Its relaunch, started as a background task, couldn't be stopped: my `pkill` runs in a separate PID namespace. It ran **concurrently** with a second matrix that I started after adding test 4. Both wrote the same log files, so I deleted all their logs.
  3. I then ran the matrix once more, alone. The logs in the evidence directory are from that run only; each summary has exactly one line per check.

  I didn't use the superseded runs' results. Their summaries showed exit 0 for every check, but I don't rely on them.
- **Failures during development, all fixed before the recorded matrix:**
  - My first run of the new file had 2 failures: a wrong expected code (`evidence.not_a_file`; the real code is `validation.evidence.not_a_file`), and `requestTimeout` never firing. The second led to the `http`-options fix in §2.4.
  - One sanity run of the full integration suite had 7 failures in `framework-errors.test.ts`: the reference unmatched 404 now carries `x-ratelimit-*` headers. I adjusted the test helper (see §3).
  - One unit run had 2 failures: the architecture test rejected `node:events` and computed members in the new files, and a timing race in my close test. I rewrote both.

## 7. Known gaps / not done

- **Triage is pending.** A specialist (code-security-reviewer) must give this defect an ID, a severity and the mandatory classification, and a non-author must verify the repair. I can't do either.
- **ADR-0007 §5b** doesn't list "429 on an unmatched route" among the out-of-contract answers. It follows from §5b's own reasoning: no operation matched. The contract and `openapi.yaml` are unchanged. A one-line amendment by the solution-architect would make it explicit. I didn't edit the ADR.
- **"Before" times for `app.close()` are capped.** In the negative control the test stops waiting at 6, 8 or 15 s, then force-closes so the run never hangs. The full duration after the 413 (73.1 s, and 65 s in the audit) comes from `root-cause-repro.log` and the auditor's `repro-diag.log`, not from that run.
- **The shutdown grace period (5 s) and `requestTimeout` (300 s) are code constants.** Tests override them through `ServerOptions`, but there's no environment variable for them; adding one is a configuration change for a later increment.
- **The lingering close replaces Node's `socket.destroySoon` on the affected sockets only.** That is an undocumented Node method. If a future Node stopped calling it, Node would still close the socket after a `Connection: close` response, so only the 0.5 s RST-avoidance delay would be lost. Node 22.22.2 and 24.21.0 both pass the tests.
- **SIGINT** uses the same handler as SIGTERM. Only SIGTERM is tested.

## 8. Merge instructions

- No migrations, no new dependencies and no configuration variables.
- The new integration test file spawns `node --conditions=@mth/source apps/api/src/main.ts` for the SIGTERM test. It needs Node ≥ 22.18, for native type stripping, which matches the repository's `engines`.
- Callers of `registerPlatformHooks` that don't pass `notFound: "deferred"` behave exactly as before.
- Expect no conflicts unless another change edits `platform/hooks.ts` (the not-found handler) or the Fastify options in `server.ts`.
