# Assignment T-DG2-BE12: router-level errors answer the declared problem+json 400 (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. BE11 `cf9c653` is integrated. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium; never run `playwright install`.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Why
Your BE11 handback (§2, "Observation") reports that a path segment with an undecodable percent escape (`%ED%A0%80`, `%ZZ`) is refused by Fastify's router (`FST_ERR_BAD_URL`) before any hook runs. The answer is a **plain `application/json` 400**, not `application/problem+json`.

Since ARCH-02, every operation declares 400 as the shared `ValidationError` (a `Problem` body, `application/problem+json`). A plain-JSON 400 is therefore a response-body contract drift on every route with a path. Router-level errors bypass `app.setErrorHandler` (`apps/api/src/modules/platform/hooks.ts`, which already maps the body-parser errors `FST_ERR_CTP_*` to problems). They need Fastify's `frameworkErrors` server option (`apps/api/src/server.ts`).

## Required
1. **`frameworkErrors` handler.** In `apps/api/src/server.ts`, add a `frameworkErrors(error, request, reply)` handler. It answers every router-level error as an RFC 7807 problem, using the same `sendProblem`/`problems` helpers as the rest of the API: `application/problem+json`, with `requestId` and no internals.
   - Handle at least `FST_ERR_BAD_URL` (400, code `validation.format`, with a clear `detail` such as "The request URL contains an invalid percent-encoding.") and `FST_ERR_ASYNC_CONSTRAINT`.
   - Any other framework error code it receives falls back to the generic mapping, never to a plain body.
   - Keep any security headers that the `onSend` hooks add. Confirm this, because `frameworkErrors` runs early.
2. **Sweep the other framework-level paths that produce non-problem bodies.** Cover at least:
   - unsupported method on a known path (405, if Fastify answers it);
   - `OPTIONS`/CORS preflight;
   - a request header that is too large;
   - a URL that is too long;
   - the non-API SPA fallback with a bad URL.

   For each, record in the handback the status, the content-type, and whether it is declared and problem-shaped. Fix every API path (`/api/**`) so it gives a problem-shaped, declared status. Report anything that would need a contract change, but do not change `openapi.yaml`.
3. **Tests.** Add an integration test for each of these:
   - `GET /api/v1/transformations/%ZZ` returns 400 `application/problem+json` with `code: validation.format` and a `requestId`, and nothing is written;
   - a GET-by-id path with `%ED%A0%80` returns the same;
   - the undecodable-escape case from your BE11 test now asserts the contract (turn the contract assertion back **on**).
   - Run a negative control: the new tests must fail on the old code.

## Self-verification (real output in the handback)
Run in **both locale settings** (`env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`):
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite (`QA_PG_PORT=55471`), including `contract.test.ts` and `invalid-character.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports)
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE12-backend-workflow-engineer.md` with the fix, the sweep table and every check's real output. Keep the evidence to logs only.
