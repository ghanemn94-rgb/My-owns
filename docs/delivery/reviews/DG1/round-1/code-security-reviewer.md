# DG1 round 1: code-security-reviewer narrative

- **Candidate:** `sha256:7fcc4943694dc9d7d207b18b53c42eab1efa131da46b898f733ae20298b39367`, source commit `85e5bbd`. Recomputed in the repository and in a disposable clone at the freeze commit. HEAD `863505e` is a metadata-only freeze commit.
- **Run:** `DG1-T-DG1-REV-SEC-R1-code-security-reviewer-20261001T062250Z-02a4db71`.
- **Verdict: FAIL.** 2 High, 6 Medium and 4 Low findings. 5 findings are mandatory violations: F-DG1-101, 102, 103, 104, 105.
- **Independence:** I read no other round-1 record before forming this verdict.

## What is sound (verified, not assumed)

- **Authorization (ADR-0006).** One policy function (`access/policy.ts` with `rules.ts`) and a SQL `scopeFilter` that compiles the same rules.
  - Every governed route must declare `config.access` at registration, or the server refuses to start.
  - A response-time fail-closed guard turns a successful response from a permission route that never consulted the policy into a 500.
  - My probe ran 10 grant cases on a real database (C14). For each user, the SQL-filtered list equals the per-record readable set.
    - Siblings and other organizations never cross.
    - Technical admins see no business records.
    - A cross-scope PATCH or audit read returns 404 and changes nothing.
  - Approval permissions never cross scope without inheritance. Service principals cannot approve. Requester ≠ approver is wired as a hook.
  - The DB trigger on `role`, `permission` and `role_permission` stops a technical-admin role from carrying an approval permission.
  - One person holding both kinds of role through separate audited assignments is explicitly allowed by ADR-0006, so it is not a finding.
- **Every mutation.** Each one has an authz check, zod validation, If-Match (428 missing, 400 malformed, 409 stale, with a row lock) and one audit event in the same transaction.
  - I planted 6 defects (four missing audit writes, one missing If-Match, one missing authz check). The suite caught all 6 (C13).
  - Failed mutation authorizations are audited in a separate transaction (`denials.ts`).
- **Audit integrity (ADR-0004).**
  - `mth_app` has only INSERT and SELECT on `audit_event`; triggers reject UPDATE, DELETE and TRUNCATE, even for the owner.
  - `insertAuditEvent` takes a transaction and refuses secret-like field names.
  - The API offers no write path to the audit trail.
- **Sessions (ADR-0005).**
  - Session tokens are 32 random bytes; only their SHA-256 is stored.
  - Cookies are HttpOnly and SameSite=Lax, with `__Host-` and Secure on https.
  - The CSRF token is an HMAC of the session token, stored hashed and compared in constant time, plus an Origin/Referer check.
  - PKCE S256, nonce and single-use state are in place; the session rotates on login.
  - The dev login is refused with `NODE_ENV=production` both in the config loader and at route registration. The image defaults to production/oidc and does not ship the seeds.
- **Jobs (ADR-0008).**
  - The outbox row is written in the business transaction.
  - The relay uses `FOR UPDATE SKIP LOCKED` and sends with job id = event id plus a singleton key, in the same transaction as `published_at`.
  - The consumer ledger `processed_message` uses `ON CONFLICT DO NOTHING`.
  - Retry is bounded (5 attempts with backoff), then the dead-letter queue; relay attempts are capped at 10 with `last_error`.
  - HTTP `Idempotency-Key` is serialized with an advisory lock.
- **Data (ADR-0003).**
  - 6 forward-only migrations apply to a fresh database in every integration run.
  - All timestamps are `timestamptz`; the only exception is pg-boss's own `singleton_on`, documented.
  - Grants are least-privilege: the catalogue is read-only to `mth_app`, and the pg-boss tables are DML-only.
  - P1 has no money columns yet.
- **Platform.** problem+json, opaque filter-bound cursors, global and auth rate limits, validated inbound `X-Request-Id`, strict same-origin CSP, a 1 MiB body limit, and log redaction of cookie, authorization and CSRF headers.
- **Web.** The CSRF token lives in memory, requests use `credentials: same-origin`, localStorage holds only preferences, and there are no `innerHTML`/`eval` sinks.
- **CI and secrets.**
  - Every product job reaches `delivery-gates`, and `delivery-gates.yml` is untouched.
  - `.env.example` has names only, and the secret scan found nothing.
  - Images run as non-root uid 10001, read-only, with `cap_drop ALL`.
  - `pnpm check:no-cdn` passes.
- **DG0 controls.** Gate and agent tooling passes 105/105. The only DG1 change to agent tooling adds `tools/deps` to `COMMON_DENY`, which strengthens it.

## Findings (details in `code-security-reviewer.findings.json`)

| ID | Sev | Mand. | Summary | Owner |
|---|---|---|---|---|
| F-DG1-101 | High | yes | `pnpm test:integration` fails 3/3 on the candidate: the contract test never exercises `getBrandingTokens`. REQ-S19-006 evidence ("32 ops, 8/8") predates the contract. | backend-workflow-engineer |
| F-DG1-102 | High | yes | Installer sandbox lets credentials (GH_TOKEN, AWS keys, …) through with host network. `.git/hooks`, `.claude`, `tools/gates` and `.github` are writable from inside. Root capabilities are retained. | delivery-orchestrator |
| F-DG1-103 | Medium | yes | OIDC login CSRF: state is not bound to the browser. Reproduced: victim signed in as attacker. | backend-workflow-engineer |
| F-DG1-104 | Medium | yes | CI installs without the wrapper, although the register says "(and by CI)". | devops-engineer |
| F-DG1-105 | Medium | yes | REQ-S16-003 is marked IMPLEMENTED at DG1, but workflows, formulas and reporting don't exist (D-047 judgement below). | transformation-analyst |
| F-DG1-106 | Medium | no | TL@BU creates a transformation (201), then cannot read it (404). | backend-workflow-engineer |
| F-DG1-107 | Medium | no | `check-ci-needs.mjs` accepts a job-level `if: always()` / `!cancelled()` bypass. | devops-engineer |
| F-DG1-108 | Medium | no | The CI images job cannot pass: image digests are unpinned and the SBOM lockfile hash is stale. | devops-engineer |
| F-DG1-109 | Low | no | The dependency-lint misses `createRequire` and computed `import()`. | backend-workflow-engineer |
| F-DG1-110 | Low | no | Flaky global audit-count assertion; the worker test leaves a connection open (1 run in 3). | backend-workflow-engineer |
| F-DG1-111 | Low | no | Installer AC-2 negative and AC-3(b) can pass vacuously when setup fails. | delivery-orchestrator |
| F-DG1-112 | Low | no | Production accepts an http `APP_BASE_URL`, so the cookie loses Secure and `__Host-`. | backend-workflow-engineer |

## Requirements (the 8 assigned)

- **REQ-DLV-025: met.** Every product job needs `delivery-gates`, the check rejects a missing dependency, and `delivery-gates.yml` is unchanged.
  - Residual F-DG1-107: the checker can be bypassed with status functions.
  - A live CI run with a failing gate record is not observable here.
- **REQ-DLV-033: not complete for DG1.** The foundation is real: clean CRUD, authz, audit and migrations, verified.
  - However, the candidate's CI pipeline cannot pass (F-DG1-101, F-DG1-108).
  - The register's integration evidence is stale (F-DG1-101).
  - F-DG1-106 breaks create→read for one valid grant.
- **REQ-DLV-042: not met.**
  - The containment properties are not achieved (F-DG1-102), and CI doesn't use the wrapper (F-DG1-104).
  - The four listed acceptance properties do pass 7/7 with a writable store. Two of the tests are vacuous-prone (F-DG1-111).
- **REQ-S16-001: met.** The API and worker are separate processes of one codebase. The API suites run without a worker. The Compose services are separate; running them was not possible (no Docker, C20 BLOCKED).
- **REQ-S16-003: not complete as written** (F-DG1-105). The boundary architecture and lint are good, with one Low gap (F-DG1-109).
- **REQ-S16-004: met for the DG1 increment.** All P1 state lives in PostgreSQL through migrations: records, catalogue, audit, outbox and pg-boss. The A19 restore drill belongs to REQ-S19-012 and REQ-S20-019 (DG7).
- **REQ-S19-004: met.** The ERD and migrations exist, and the migrations apply to a fresh database in every run (C09). Its cited QA log is stale, but my own runs show the property.
- **REQ-S19-006: not met.** The contract lints (33 operations), but the contract test fails on the candidate (F-DG1-101).

## Assessments requested by the orchestrator

- **D-047 (REQ-S16-003).** I agree that building workflows, formulas and reporting in P1 would be wrong; the staging is P2, P4 and P5.
  - But A12 literally requires the six modules to exist with suites.
  - Marking the requirement IMPLEMENTED at final gate DG1 labels planned work as delivered.
  - The fix is a register re-staging: move `final_gate` to DG5 and record a P1 increment of "boundaries + lint + P1 modules". This is F-DG1-105.
- **BE 400/403 instead of 422.** Acceptable for P1 inside the frozen contract. Examples: `createBusinessUnit` parent invalid → 400 with a field pointer; `updateUser` self-disable → 403 with `user.cannot_disable_self`.
  - These responses are deterministic, documented in code, and don't leak information.
  - Recommendation: add 422 to those operations at the next contract revision, and align them with the other operations' business-rule responses.
- **FE `/auth/options` and the empty dev-login probe.** Acceptable for P1. In production `POST /auth/dev-login` is not registered (404); in dev an empty body returns 400.
  - The probe costs one auth-rate-limit token per login-page load and discloses only the auth mode, which the UI shows anyway.
  - A small public `GET /api/v1/auth/options` (modes only) would be cleaner at the next contract revision. Note that FE currently calls no such endpoint (grep found none).
- **DevOps flags.**
  - Unpinned digests make the CI images job red today (F-DG1-108); pin them before DG1 approval, or accept that failure explicitly.
  - The EN/AR same-user race with `--workers=1` is acceptable, because it is documented and deterministic.
  - `.env.example` sits at the repository root and `--check` keeps it equal to the catalogue, so its location vs. `deploy/` doesn't matter for security.
- **Branding.** Tokens are labelled provisional, and the `/branding/tokens` route is authenticated-only. I saw no official Mobily or PMI claim in the files in scope.

## Not checked / BLOCKED

- **C20, Compose clean start, test-IdP login and the no-egress smoke: BLOCKED.** The Docker daemon is not accessible (permission denied on `/var/run/docker.sock`). Reviewed statically only.
- Playwright e2e was not in my check list; it is qa's scope.
- I copied the installed `node_modules` into the clone and ran no `pnpm install` (no network).

## Reproduce

All repro scripts and logs are under `docs/delivery/test-evidence/DG1/code-security/round-1/`.

- **Integration and plant runs** use `withpg.sh.txt` (starts a throwaway cluster on 54391) and `plant.sh.txt`.
- **Repro tests** go into a disposable clone at `apps/api/test/integration/` before running.
- **Credentials.** The installer probe records only the *names* of environment credentials, never their values.
