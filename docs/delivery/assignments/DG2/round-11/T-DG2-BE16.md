# Assignment T-DG2-BE16: a refused or aborted request body never holds a connection, and shutdown is bounded (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING, after the round-10 audit BLOCKED). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768; the harnesses retry on collision.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Defect to repair (found by the release-auditor; a specialist will triage and verify it in round 11)
The defect is listed under blocking condition 2 in `docs/delivery/gates/DG2.json`. The auditor's reproduction and logs are under `docs/delivery/test-evidence/DG2/audit/round-10/`: `repro-diag.log`, `repro-bis-p5*.log`, `repro-base-canon-sock.log` and `zz-aud-diag.test.ts.txt`.
- A 30 MiB **chunked** upload to `uploadEvidenceContent` over a real socket goes over the evidence size limit. The API answers 413 `evidence.too_large`, but **does not close the connection**.
- The server still holds the socket about 65 s after the client has destroyed it (`server connections=1` for 50 s and more).
- `app.close()` completes only after about 65 s. `src/main.ts` runs it on SIGTERM, so graceful shutdown stalls too.
- The defect predates BE15 and is present at `041478cb`.
- The size limit is enforced while streaming, in `apps/api/src/modules/evidence/store.ts:80` (`EvidenceTooLarge`), and mapped to 413 in `routes.ts:266`.

The same mechanism likely affects round 10's code-security probe: `afterAll(() => api.close())` timed out after 30 s.

## Required
1. **Root cause, written in the handback.** Explain exactly why the socket survives the 413. Is it the request stream left paused or half-consumed after the iterator aborts? Node's `_dump` waiting on a stalled body? `keepAliveTimeout`/`requestTimeout` (where does 65 s come from)? Fastify's `forceCloseConnections` default?
2. **Fix the class, not one path.** Whenever the server answers before it has consumed a request body (refused, aborted or over-limit), it must:
   - stop reading;
   - send the declared response with `Connection: close`;
   - close the socket promptly once the response is flushed.

   It must never keep a half-read body open or drain an unbounded body. Cover at least:
   - the evidence upload: 413 over the limit with Content-Length and with chunked framing; a 4xx raised **before** the body is read (403/404/409/428/400 on the upload route); and a client abort mid-upload, which must leave no partial object and no leaked socket;
   - the JSON `bodyLimit` refusal: Content-Length and chunked;
   - the media-type refusals and the unmatched-route 404, which already set `Connection: close`. Confirm on a real socket that the server, not just the client, closes the socket.
3. **Bounded shutdown.** `app.close()` and SIGTERM must complete promptly, within a few seconds, even with an in-flight or stalled upload. Use Fastify's `forceCloseConnections`, a shutdown deadline, or both, and document the policy in the handback and in `docs/operations/` if a runbook covers shutdown. In-flight requests that finish normally must still complete; state the trade-off.
4. **Unmatched-route rate limiting (auditor observation P3, pre-existing).** Unmatched-route 404s are not metered by `@fastify/rate-limit`, because no route means no `onRoute` hook. Apply the limiter to the not-found handler in the documented way (`setNotFoundHandler({ preHandler: app.rateLimit() }, …)` or equivalent). The SPA fallback and the e2e journeys must be unaffected. A 429 on an unmatched route is out of contract by design (ADR-0007 §5b, as for the unmatched 404); say so.
5. **Tests.**
   - **Integration, on a real socket (not just `inject`):**
     - the auditor's scenario: the server closes the connection after the 413; the server's connection count returns to 0 within a short bound; `app.close()` completes within a short bound afterwards;
     - the same for Content-Length over-limit, for a 4xx before the body is read, for a client abort mid-upload, and for JSON over `bodyLimit` with chunked framing;
     - a valid upload is still stored byte-exact with its sha256;
     - a keep-alive client after a normal 200 keeps its connection;
     - an unmatched-route flood is rate-limited (429).
   - **Negative control:** the new tests fail on `HEAD` before your change, including the auditor's scenario.
6. **Sweep table.** For every path that can answer before consuming a body, give the before and after behaviour: status, `Connection` header, who closes the socket and when, and the time `app.close()` takes.

## Self-verification (real output in the handback)
Run every check in **both locale settings** (`env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`). **Report every non-zero exit, failed suite or hook timeout in any log, and explain it.** An undisclosed failure in your evidence voids the run.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite **twice per locale setting**, including `contract.test.ts`, `media-types.test.ts`, `evidence.test.ts` and your new tests
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE16-backend-workflow-engineer.md` with the root cause, the fix, the sweep table and every check's real output. List any remaining gap honestly. Keep evidence to logs only.
