# Security controls: evidence for Mobily IT's assessment

This matrix lists the security controls the Mobily Transformation Hub implements, the source clause
each one answers, where it is implemented and the automated test that exercises it. It is evidence for
Mobily IT to assess against its own requirements. It is not a statement of compliance with any
organizational or regulatory standard, not a certification and not an IT approval. Hosting
responsibilities (section 2) are integration points that the hosting environment must provide.

ملخص: تسرد هذه المصفوفة ضوابط الأمان التي ينفّذها النظام، والبند المصدر لكل ضابط، والاختبار الآلي الذي
يتحقق منه، لتستخدمها إدارة تقنية المعلومات في موبايلي في تقييمها. وهي ليست إقرارًا بالامتثال لأي معيار
تنظيمي أو مؤسسي، وليست شهادة ولا موافقة من تقنية المعلومات. (ترجمة مؤقتة لم يراجعها مراجع عربي مؤهل.)

## How to read this matrix

- **Source** names the master-prompt clause (`M0330`, `M0331`) and the requirement-register id it answers.
- **Implemented in** names repository paths and the architecture decision records (ADRs) in `docs/architecture/adr/`.
- **Test(s)** are repository paths of the automated tests that exercise the control. Each one is a test file that
  exists at this revision; `tools/release/tests/security-controls.test.mjs` checks this on every run.
- **Level** is `unit`, `integration` (against a real, disposable PostgreSQL database), `e2e` or
  `integration-level only` (the reason is in Notes).
- **Evidence** would name recorded gate test runs. It is left empty (`—`) here because those records stay in the
  engineering repository and are not part of the handover archive. Run the tests to reproduce the evidence.
- Section 2 rows are **not** product controls. They are what the hosting environment must provide, with the
  product-side integration point. `none` means that the product has no function for it.
- Optimistic concurrency and decimal arithmetic are integrity controls, not security controls. They are not listed.

All data used by the tests is synthetic.

## Section 1: product controls

| Id | Control | Source | Implemented in | Test(s) | Level | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SC-01 | Secure sessions: server-side sessions, `httpOnly`, `sameSite=lax`, `Secure` and the `__Host-` prefix under https, idle and absolute expiry, CSRF token hash | M0331; REQ-S16-030 | `apps/api/src/modules/identity/`; ADR-0005 | `apps/api/test/integration/identity.test.ts`<br>`apps/api/test/integration/oidc.test.ts` | integration | — | The `Secure` flag under an https base URL is asserted in both files. |
| SC-02 | OIDC sign-in with issuer and audience validation; a token from a foreign issuer is refused | M0331; REQ-S16-030 | `apps/api/src/modules/identity/oidc.ts`; ADR-0005, ADR-0054 §1 | `apps/api/test/integration/identity/other-realm.test.ts`<br>`apps/api/test/integration/oidc.test.ts` | integration | — | The tests use a synthetic test identity provider. |
| SC-03 | Role and scoped authorization on every operation; read-scope parity of lists, exports and search | M0331; M0330; REQ-S10-004; REQ-S16-030 | `apps/api/src/modules/access/`; ADR-0006, ADR-0020, ADR-0051 | `apps/api/test/integration/access-scope.test.ts`<br>`apps/api/test/integration/access/read-scope-parity.test.ts`<br>`apps/api/test/integration/reporting/scope.test.ts`<br>`apps/api/test/integration/aud-write-deny.test.ts` | integration | — | `aud-write-deny` calls every mutating operation of the contract as a read-only auditor (403, nothing written). |
| SC-04 | Sensitive records and explicit grants | M0331; REQ-S16-030 | `apps/api/src/modules/access/`; ADR-0051 | `apps/api/test/integration/access/sensitivity.test.ts`<br>`apps/api/test/integration/access/sensitive-reach-sweep.test.ts` | integration | — | |
| SC-05 | Input validation and sanitization: strict UTF-8, free-text rules (no NUL, no blank text), schema validation of every request and response | M0331; REQ-S16-030 | `apps/api/src/modules/platform/`; ADR-0052 | `apps/api/test/integration/invalid-character.test.ts`<br>`apps/api/test/integration/invalid-utf8.test.ts`<br>`apps/api/test/integration/blank-text.test.ts`<br>`apps/api/test/integration/contract/response-validation.test.ts` | integration | — | Every response of the contract suite is validated against `docs/api/openapi.yaml`. |
| SC-06 | SQL injection protection: parameterized queries only | M0331; REQ-S16-030 | `packages/db/src/`; ADR-0052 | `apps/api/test/integration/security/sql-injection.test.ts` | integration | — | |
| SC-07 | Cross-site scripting protection: the API stores and returns no HTML, the web renders user text as text nodes, and a strict same-origin Content Security Policy is sent | M0331; REQ-S16-030 | `apps/api/src/modules/platform/`, `apps/web/src/`; ADR-0052 §3 | `apps/api/test/integration/security/xss.test.ts`<br>`apps/web/src/security-source-scan.test.ts`<br>`apps/api/test/integration/platform.test.ts` | integration-level only | — | The XSS payloads round-trip byte-identical through the API (nothing stored as HTML); the web source scan and the CSP header test complete the picture. No browser test executes a payload; carried forward from REQ-S16-030 (p7-plan §1.4). |
| SC-08 | CSRF protection for cookie-authenticated mutations | M0331; REQ-S16-030 | `apps/api/src/modules/identity/`; ADR-0005, ADR-0052 | `apps/api/test/integration/security/csrf.test.ts` | integration | — | |
| SC-09 | Rate limiting by request class | M0331; REQ-S16-030 | `apps/api/src/modules/platform/`; ADR-0052 | `apps/api/test/integration/security/rate-limits.test.ts` | integration | — | |
| SC-10 | Upload restrictions: type allow-list, size limit, safe preview, administrator upload policy | M0331; REQ-S16-030 | `apps/api/src/modules/evidence/`; ADR-0052 | `apps/api/test/integration/security/uploads.test.ts`<br>`apps/api/test/integration/admin/upload-policy.test.ts`<br>`apps/api/test/integration/evidence/preview.test.ts` | integration | — | |
| SC-11 | Dependency checks: offline advisory audit of the SBOM, exact pins of direct dependencies, licence inventory | M0331; REQ-S16-030 | `deploy/scripts/dep-audit.mjs`, `licenses/`; ADR-0052 §6, ADR-0062 §7 | `deploy/scripts/tests/dep-audit.vitest.mjs`<br>`licenses/tests/direct-dependencies.test.mjs`<br>`licenses/tests/runtime-licences.test.mjs` | unit | — | The offline audit compares with a dated advisory snapshot; the live audit needs the registry's advisory service (`docs/operations/dependency-audit.md`). |
| SC-12 | Secret-management interface: `SecretProvider`, secret references per namespace, no secret value in any response | M0331; REQ-S16-030 | `packages/config/src/secret-bindings.ts`, `apps/api/src/modules/integrations/`; ADR-0052 §5 | `apps/api/test/integration/integrations/secret-binding.test.ts`<br>`apps/api/test/integration/integrations/secret-composition.test.ts`<br>`apps/api/test/integration/integrations/secret-namespace.test.ts` | integration | — | |
| SC-13 | Production secrets are runtime configuration: `NAME` or `NAME_FILE` (never both), a placeholder-only environment template, a repository and history secret scan | M0331; REQ-S16-031 | `packages/config/src/load.ts`, `.env.example`, `tools/release/secret-scan.mjs`; ADR-0011, ADR-0063 §1–§2 | `packages/config/src/load.test.ts`<br>`tools/release/tests/secret-scan.test.mjs` | unit | — | The scan is pattern-based: it finds the listed key shapes, credential URLs and high-entropy assignments, not every possible secret (ADR-0063 §5). |
| SC-14 | No secrets or private evidence URLs in client code or logs: redaction, log scan of test runs | M0330; REQ-S16-029 | `packages/config/src/load.ts` (`redactText`, `redactLogLine`), `deploy/scripts/log-scan.mjs`; ADR-0053 §5 | `apps/api/test/integration/operations/log-redaction.test.ts`<br>`deploy/scripts/tests/log-scan.test.mjs`<br>`packages/config/src/redaction.test.ts`<br>`apps/worker/src/exception-redaction.test.ts` | integration | — | |
| SC-15 | Audit of actor, action, timestamp, record id, prior and new version and reason for every mutation | M0331; REQ-S16-032 | `packages/db/src/audit.ts`; ADR-0004 | `apps/api/test/integration/audit/audit-events.test.ts` | integration | — | |
| SC-16 | Append-only audit, protected from ordinary modification (privileges and triggers, even for the owner role) | M0331; REQ-S16-032 | `packages/db/migrations/0003_audit_event.sql`; ADR-0004 | `packages/db/test/integration/protection.test.ts` | integration | — | The test proves that `UPDATE`, `DELETE` and `TRUNCATE` on the audit table are rejected. |
| SC-17 | A constrained service identity per background job and connector | M0330; REQ-S16-029 | `apps/worker/src/`; ADR-0053 | `apps/api/test/integration/operations/service-identity-scope.test.ts` | integration | — | |

## Section 2: hosting responsibilities

These rows answer M0331 "Integrate TLS and database/storage encryption with the hosting environment"
(REQ-S16-031). A hosting row is not a product control and is not counted as one.

| Id | Responsibility (hosting environment) | Product-side integration point | Product test, if any | Guide |
| --- | --- | --- | --- | --- |
| HR-01 | TLS termination for the hub's public origin, with a certificate from Mobily's certificate authority | `APP_BASE_URL` must be https in production (plain http only for a loopback host); the session cookie is `Secure` with the `__Host-` prefix under https | `packages/config/src/load.test.ts` (the https rule)<br>`apps/api/test/integration/identity.test.ts` (the `Secure` cookie) | [configuration](../operations/configuration.md); [deployment guide](deployment.md#domains-and-tls) |
| HR-02 | TLS to the database | `DATABASE_URL` and `DATABASE_OWNER_URL` carry the server's TLS parameters (`sslmode=verify-full`, `sslrootcert=<CA file>`), or a corporate CA through `MTH_EXTRA_CA_CERTS_FILE` (Compose passes it as `NODE_EXTRA_CA_CERTS`). No product code sets TLS on its own: the URL is handed to the PostgreSQL driver as given | `packages/db/test/integration/db-tls.test.ts`: against a TLS-only scratch PostgreSQL cluster with a throwaway CA, `verify-full` with the CA connects and the session is encrypted; without the CA it is refused; a plaintext connection is refused; `NODE_EXTRA_CA_CERTS` verifies the server | [configuration](../operations/configuration.md); [deployment guide](deployment.md#domains-and-tls) |
| HR-03 | TLS to the identity provider, SMTP, object store, connector and assistant endpoints | https is required in production for the OIDC issuer and the assistant endpoint; per-channel TLS settings for SMTP (ADR-0054); the object store endpoint URL | `packages/config/src/load.test.ts`<br>`apps/api/test/integration/evidence/store-contract.test.ts`<br>`apps/api/test/integration/tasks/email-adapter-contract.test.ts` | [identity](../operations/identity-saml-broker.md), [notifications](../operations/notifications.md), [storage](../operations/storage.md) |
| HR-04 | Encryption at rest of the PostgreSQL data volume and its backups | none: a hosting function (disk, volume or managed-service encryption) | none: no product function exists | [configuration](../operations/configuration.md); [deployment guide](deployment.md#database); [backup guide](backup-restore.md) |
| HR-05 | Encryption at rest of evidence storage | none for the filesystem driver (volume encryption by hosting); for S3-compatible storage, server-side encryption is a bucket setting that IT controls | none | [storage](../operations/storage.md) |
| HR-06 | Secret storage and rotation (a vault or mounted files) | `NAME_FILE` for every secret; `SecretProvider` references for connector secrets | the SC-12 and SC-13 tests | [configuration](../operations/configuration.md); [deployment guide](deployment.md#secrets) |
| HR-07 | Network boundaries and egress control | `compose.no-egress.yaml`; the outbound destinations listed in the restricted-network guide are off by default | the offline drill of slice B (ADR-0069) | [restricted network](../operations/restricted-network.md) |

## Residuals

1. The secret scan and the claims scan are pattern-based (ADR-0063 §5).
2. Database TLS depends on the PostgreSQL driver honouring the URL's TLS parameters. HR-02's test proves this for the
   pinned driver against a scratch cluster. It is not a test of Mobily's database service.
3. Encryption at rest is entirely a hosting function (HR-04, HR-05).
4. The cross-site scripting evidence stays at integration level (SC-07).
5. The Arabic summary is a provisional translation that no qualified Arabic reviewer has checked yet.
