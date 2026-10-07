# Assignment T-DG2-BE18: authorise at commit time, and no remote call inside a transaction (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768; the harnesses retry on collision.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Findings:** the full text is in `docs/delivery/findings.json`. The reviewer's probes are under `docs/delivery/test-evidence/DG2/code-security/round-12/probes/` (`zz-sec-r12-probe.test.ts` Q1/Q1b; `zz-sec-r12-oidc-probe.test.ts`), with their logs alongside. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Findings to repair (both pre-existing)
**F-DG2-440 (Medium): an in-flight upload commits after its grant is revoked or its session is logged out.**
- The identity `preValidation` hook (`apps/api/src/modules/identity/routes.ts:120-140`) resolves the session and loads the principal's grants **once per request**. The policy decides on `principal.grants`.
- The three-phase upload (`evidence/routes.ts:443-548`) receives the body between phase 1 and phase 3, for up to `requestTimeout` (300 s). Phase 3's `openWrite` re-reads ownership, archive state and target, but re-runs the policy on the **request-start** grants and session.
- Probe Q1: the Workstream Lead's only grant is revoked mid-body, and the upload still commits with 200 and is audited to the revoked user.
- Probe Q1b: the session is logged out mid-body (`/me` then gives 401), and the upload still commits.

**F-DG2-441 (Low): OIDC discovery runs inside an open transaction.**
- `GET /api/v1/auth/login` (`identity/routes.ts:268`) runs `db.transaction().execute((tx) => oidc.startLogin(tx, …))`.
- `startLogin` first awaits OIDC discovery over HTTP (`oidc.ts:37-59`, 10 s timeout, cached only on success).
- While the IdP is slow or down, each unauthenticated login holds a pooled connection idle in transaction for 10 s, and signed-in users stall (probe: `/me` takes about 9 s with pool max 3).
- The OIDC callback already does it right: it consumes the state in its own transaction and exchanges the token outside any transaction.

## Required: fix both classes
1. **Authorise at commit time (F-440).**
   - Any write that commits after waiting on the client must re-validate the caller's authority **inside its write transaction**, immediately before the change:
     - the session is still active, not revoked, logged out or expired (idle or absolute), giving 401 and the existing session-ended problem;
     - the caller's grants are reloaded and the policy is re-run on them, giving 403 with the denied-mutation audit as today.
   - The received temporary object is discarded on refusal.
   - Reuse the identity module's own resolution, so there is one source of truth, not a copy.
   - **Sweep:** list every route that awaits the client, or anything slow, between `preValidation` and its commit, and show which need this. Today that is `uploadEvidenceContent`.
   - Also state the residual window: the time between the re-check and the commit inside one short transaction.
   - Optional, if you judge it worth it: bound how long an upload may take after authorisation, documented and covered by tests.
2. **No remote call inside a database transaction (F-441).**
   - Resolve the OIDC configuration (discovery) **before** opening the transaction, then insert the login state in a short transaction. Discovery failure keeps today's answer (302 `/login?error=idp_unavailable`).
   - **Sweep the class:** find every `await` inside a `db.transaction()` callback, or while a pooled client is checked out, that is not a database call. Look for HTTP/IdP calls, object-store I/O, `setTimeout` or sleeps, worker or queue calls, file I/O beyond the evidence store's documented finalise, and child processes. Cover the API, the worker and `packages/**`. Fix each one, or justify it in a table. Update the sweep note in `packages/db/src/pool.ts:34`, so it is accurate.
3. **Tests.**
   - **Integration on real sockets:**
     - the reviewer's Q1: a grant revoked mid-body gives 403, nothing committed, no object, and the denied-mutation audit as designed;
     - Q1b: logout mid-body gives 401 and nothing committed;
     - an expired session mid-body (idle timeout shortened in the test) gives 401;
     - the OIDC probe: with a never-answering IdP and pool max 3, concurrent logins hold no transaction (`pg_stat_activity`), and `/me` stays prompt;
     - a normal upload and a normal OIDC login still work.
   - **Negative control:** the new tests fail on `HEAD` before your change.

## Self-verification (real output in the handback)
Run every check in **both locale settings**. **Report every non-zero exit, failed suite, hook timeout or error-level log line in any log, and explain it.** An undisclosed failure in your evidence voids the run.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite **twice per locale setting**, including `oidc.test.ts`, the evidence tests, `request-io.test.ts` and `connection-hygiene.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE18-backend-workflow-engineer.md` with the fix, both sweep tables and every check's real output. List any remaining gap honestly. Keep evidence to logs only.
