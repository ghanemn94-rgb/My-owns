# DG1 assignment: code-security-reviewer (round 1)

Read `docs/delivery/assignments/DG1/round-1/review-common.md` first. Task ID: `T-DG1-REV-SEC-R1`.

## Your scope: correctness and security of the product code and configuration
Directly review the source (full files) of `apps/api/**`, `apps/worker/**`, `packages/{shared,db,config,design-tokens}/**`, `tools/deps/**`, `deploy/**`, `.github/workflows/ci.yml`, and the contract `docs/api/openapi.yaml`. (`apps/web` is primarily the domain/qa + UX reviewers' scope, but flag any web security issue you see, e.g. token handling, CSRF, XSS.)

Look for, with file:line, a concrete failure scenario, severity and `mandatory_violation`:
1. **Authorization (ADR-0006).** One server-side policy function + scope filter used by **every** route/export/search; scoped RBAC resolves correctly (org/BU/transformation/record; inheritance; siblings never cross; approval permissions never cross scope without inheritance); technical admins are not business approvers (SoD trigger + policy); no route bypasses the policy. Try cross-scope reads/writes.
2. **Every mutation (CLAUDE.md invariant):** server-side authorization check, input validation (zod), optimistic concurrency (`version`/`If-Match`→409, missing→428), and an append-only audit event — **each covered by tests**. Find any mutating route missing one.
3. **Audit integrity (ADR-0004):** the `audit_event` table rejects UPDATE/DELETE (trigger + restricted role); every mutation writes one; the audit API cannot be forged.
4. **Identity/sessions (ADR-0005):** OIDC authorization-code + PKCE; dev-login compiled/configured off unless `AUTH_MODE=dev`; server-side sessions, secure HttpOnly cookies, CSRF; `sub`+issuer binding. No auth bypass; dev-login cannot be reached in production config.
5. **Data integrity (ADR-0003):** migrations apply to a fresh DB and are forward-only; `numeric` for money + decimal in TS (the lint bans `parseFloat`); `timestamptz`; optimistic concurrency columns; roles/grants. Missing/stale data never shows as zero/green.
6. **Jobs/outbox (ADR-0008):** transactional outbox; idempotency keys; bounded retry/backoff; dead-letter; the relay is idempotent (double/parallel/duplicate delivery → one effect).
7. **Module boundaries (REQ-S16-003/ADR-0002):** `apps/api/src/modules.ts` declares all boundaries + dependency rules; `architecture.test.ts` fails on any import bypassing a module interface. Judge D-047 (reserved modules P2/P4/P5). Confirm the dependency-lint actually catches a planted violation.
8. **Sandboxed installer (REQ-DLV-042/D-046):** review `tools/deps/install-sandbox.sh` + its tests — read-only root, only target tree + store writable, lifecycle scripts off unless allow-listed, frozen-lockfile enforcement, missing-bwrap→65. Assess the egress residual (threat-model 3).
9. **CI/secrets/packaging:** `.github/workflows/ci.yml` makes every product job `needs` `delivery-gates` (REQ-DLV-025) and never edits `delivery-gates.yml`; no secrets in the repo; `.env.example` has names only; images non-root; no public CDN at runtime/build (`pnpm check:no-cdn`); the no-egress Compose variant.
10. **Contract robustness & gate-integrity:** problem+json (RFC 9457); pagination; rate limits + request IDs; and that the DG1 product changes did not weaken any DG0 delivery control (`tools/gates/**`, the write guard, the candidate hash). Assess the open contract items (BE 400/403-vs-422; FE `/auth/options`).

## Checks to run (record each in checks_run with real output; BLOCKED if a tool/DB is missing)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm test` (unit), the integration suite against a disposable PostgreSQL (`e2e/support/qa-stack.sh` / `packages/db/test/global-setup.ts`), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, and `tools/deps/tests/install-sandbox.test.sh`. Write your own reproduction attempts (e.g. a planted cross-module import; a mutation without an audit write). Save evidence under `docs/delivery/test-evidence/DG1/code-security/round-1/`.

## Requirements to check (record exactly these in `requirements_checked`)
Check these DG1-final requirements against the code that implements them, each completely + correctly IMPLEMENTED with existing evidence: `REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`. (domain+qa cover the REQ-S15 UX ones; qa checks all 12.)
