# ADR-0063: P7 secret hygiene and security-controls evidence: the repository, history and handover-text secret scan, the placeholder-only environment template, TLS and database/storage encryption as hosting integration, the scan for compliance and certification claims, and the security-controls matrix

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-01), 2026-11-12. Base `fe690c01768fb65370c257c80ac8a55e807f9525` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice G of `docs/architecture/p7-plan.md`):** REQ-S16-031, REQ-S16-033. REQ-S21-003 (slice I) uses this ADR's secret scan for "the handover text". Slice A is ADR-0062.
- **Sources:**
  - M0331 (§16): "Implement secure sessions, role/scoped authorization, input sanitization, protection against common injection and request attacks, upload restrictions, rate limiting, dependency checks and a secret-management interface. Production secrets are runtime configuration, not repository content. Integrate TLS and database/storage encryption with the hosting environment. Audit actor, action, timestamp, record ID, prior/new version and reason; append-only audit data must be protected from ordinary user modification."
  - M0332 (§16): "Do not claim compliance with an organizational or regulatory standard based solely on these controls. Provide evidence for implemented controls so Mobily IT can assess them against its actual requirements."
  - Acceptance texts (binding):
    - REQ-S16-031: "A18: the secret scan finds no secrets in the repository; the environment template contains placeholders only". The procedure says: "a CI secret scan blocks committed secrets; the deployment guide documents TLS and encryption integration".
    - REQ-S16-033: "A22;A28: a text scan of docs and UI strings finds no compliance or certification claim; the matrix links each control to a test". The `screen_api` is `docs/handover/security-controls`.
  - CLAUDE.md: the playbook is "a practical synthesis _inspired by_ PMI/Brightline/BRM", and neither it nor this product may be presented as a PMI standard or as certified. It also says: "`#0078FF` is a **provisional** brand token, not a verified Mobily colour."
- **Decisions applied:**
  - D-243 **Q16**: credential material is excluded from transfers. That binds the scan scope of `demo-data/` (ADR-0062 §2.1);
  - D-243 **Q7**: IT guides in English with an Arabic summary;
  - p7-plan §1.4 (REQ-S16-030 is carried into the matrix as "integration-level evidence only");
  - D-138 (tools never read growing delivery folders, except the envelope scope named in §1.1);
  - D-057, D-058.
- **Builds on:**
  - ADR-0011 (secrets from the environment or `<NAME>_FILE`; `.env.example` generated, names only);
  - ADR-0052 (`SecretProvider`, request hardening, uploads, rate limits);
  - ADR-0053 §5 (the log scan and the `mth-canary-` prefix);
  - ADR-0049 §7 and `packages/shared/src/text-scan/claims.ts` (the PMI claim rule and its negation rule, mirrored by the SQL function `p5_claims_official_pmi`);
  - ADR-0062 §8 (`tools/release/lib/patterns.mjs`, shared key-shape patterns).
- **Two gate systems.** The scans read files and print results. They write no gate, review or stage record and grant nothing. The controls matrix is engineering evidence for Mobily IT's own assessment, as M0332 asks. It is **not** an attestation, a certification or an IT approval, and its header says so (§4.1).
- **No migration, no advisory lock, no OpenAPI operation** (the reserved `0131`–`0132` and 730400–730401 stay unused).

## Context

What exists at `fe690c01` (read from the tree):

1. **Secrets as runtime configuration** (ADR-0011, ADR-0052):
   - configuration reads `NAME` or `NAME_FILE`, and refuses both being set;
   - `.env.example` is generated from `packages/config/src/index.ts` `ENV_VARS` by `deploy/scripts/generate-env-example.mjs`, and `--check` runs in CI. It has 37 lines with `=`, and every assignment line has an empty value;
   - `deploy/scripts/init-secrets.sh` writes random local secrets **outside** the repository;
   - `.gitignore` ignores `.env` and `.env.*` except `.env.example`;
   - no tracked file outside `trading_agent/` is named `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.crt`, `id_rsa*` or `credentials.json` (`git ls-files` census, this run);
   - the Keycloak test realms reference `${MTH_TEST_OIDC_CLIENT_SECRET}` and `${MTH_TEST_USER_PASSWORD}`, never literal values.
2. **No repository secret scan exists.** `deploy/scripts/log-scan.mjs` scans **logs** of a test run for canaries and fixed key shapes (ADR-0053 §5). Nothing scans the tracked files, git history or the handover text.
3. **Synthetic key shapes are committed on purpose.** They appear in redaction tests:
   - `apps/worker/src/exception-redaction.test.ts`: a truncated RSA private-key block, `AKIA…`, a JWT, `postgres://mth_app:s3cret-pw@…`;
   - `packages/config/src/redaction.test.ts`;
   - `apps/api/test/integration/operations/exceptions.test.ts`.

   CI uses documented non-secrets: `mth-canary-ci-db-password` (`deploy/ci/ci.yml` l.118, the ADR-0053 §5 canary) and `ci-only-not-a-secret` (l.177). The DG6 code-security reviewer's ad-hoc scan (`docs/delivery/test-evidence/DG6/code-security/round-7/21-secrets-scan.log`) found exactly these fixtures.
4. **Claims.**
   - The PMI claim rule exists in SQL (`0089`, `p5_claims_official_pmi`) and TypeScript (`claimsOfficialPmi`, `PMI_CLAIM_PATTERN`, `PMI_NEGATION_PATTERN`), with an agreement corpus (`packages/shared/src/text-scan/corpus.ts`). It guards methodology reader text and branding text on write.
   - P6 scans seeded texts for business terms (`apps/api/test/integration/text-scan/seeded-texts.test.ts`) and problem responses for infrastructure terms (`tests/qa/integration/a20-s15-014-no-infra-terms.test.ts`).
   - **No scan covers documentation or the UI catalogues for claims of conformity to standards and regulations in general.** The PMI rule covers one subject only.
   - Words that are not claims are frequent and must not be flagged: "Risk / compliance" (a category label, `apps/web/src/i18n/en/prioritization.json`), TLS "certificate" (`docs/operations/identity-saml-broker.md`), and the disclaimer in `common.json` "this product is not certified by PMI or any other body".
5. **No controls matrix exists,** and neither does `docs/handover/`. The P6 security tests exist, for example under `apps/api/test/integration/security/` (`csrf`, `rate-limits`, `sql-injection`, `uploads`, `xss`), `access/`, `integrations/secret-*`, `operations/log-redaction`, `audit/audit-events`, `identity.test.ts`, `oidc.test.ts` and `packages/config/src/load.test.ts`.
6. **TLS integration points in the product:**
   - `APP_BASE_URL` must be https in production, except for loopback (`packages/config/src/load.ts` l.267);
   - `OIDC_ISSUER_URL` must be https in production (l.311);
   - the session cookie is `secure` when the base URL is https (`apps/api/src/modules/identity/routes.ts` l.90–102);
   - the assistant `endpointUrl` must be https in production (ADR-0059, `restricted-network.md`).

   **No product code configures database TLS.** `DATABASE_URL` is passed to the PostgreSQL driver as given, so `?sslmode=…` in the URL is the integration point, and no test at the base exercises it. Encryption at rest of the database volume and the evidence store is not a product function.

## Decision

### 1. The secret scan: `tools/release/secret-scan.mjs` (DO-B)

The script uses no dependency and no network. Key shapes come from `tools/release/lib/patterns.mjs` (shared with ADR-0062 §8).

#### 1.1 Scopes

| Flag | Files scanned | Used by |
| --- | --- | --- |
| `--scope payload` (default) | the candidate manifest of the working tree (`manifestFromWorkingTree(repo, APPROVED_SPEC)` from `tools/gates/lib/candidate.mjs`, imported read-only): every tracked and untracked, non-ignored file except `trading_agent/**` and the META_EXCLUDES. This is exactly what the archive's `source/` contains (ADR-0062 §2) | CI (DO-B), the freeze verification, A18 |
| `--scope history` | every blob reachable from `HEAD` (`git rev-list --objects HEAD`, read through `git cat-file --batch`), each scanned once, except paths under `trading_agent/` | CI (DO-B), A18. "No secrets in the repository" covers the history a clone delivers, not just the tip |
| `--path <dir-or-file>`… | the given files, recursively | the generated handover text before it is committed (release notes, DO-J; REQ-S21-003), the `demo-data/` input (ADR-0062 §2.1), an unpacked archive |
| `--scope envelope --list <file>` | the files named in the envelope manifest | the seal step (DO-J, ADR-0073). This is the one scope that reads `docs/delivery/**` records, as fixed files listed by the manifest, never by walking a folder (D-138) |

A file is scanned as UTF-8 text. A file with a NUL byte in its first 8 KiB is scanned as latin1 for the ASCII key shapes only. Files over 20 MiB are hashed and listed as `skipped-size`, never silently passed. At the base there are none in the payload.

#### 1.2 Rules

| Rule | Detects (exact) | Placeholders and non-secrets that do **not** match |
| --- | --- | --- |
| **S1 key-shape** | `KEY_SHAPES` of `tools/release/lib/patterns.mjs` (delivered by ARCH-01, shared with ADR-0062 R3; frozen), in simplified form: `sk-ant-…`, `sk-…`, `AKIA…`/`ASIA…`, `ghp_…`, `github_pat_…`, `xox?-…`, `AIza…`, `-----BEGIN … PRIVATE KEY-----`, JWT `eyJ….eyJ` | — |
| **S2 credential-url** | `<scheme>://<user>:<password>@` where the password is a literal | password `%s`, `${…}`, `$NAME`, `<…>`, `***`, `[REDACTED]`, `…` |
| **S3 secret-assignment** | a key name matching `(secret|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|signing[_-]?key)` (any case, also inside a longer name such as `smtpPassword`), then `=`, `:` or `": "`, then a value of at least 16 characters whose Shannon entropy is at least 3.5 bits per character | the placeholders of S2; `process.env.…`; `/run/secrets/…` and other `*_FILE` paths; checksum shapes (64 hex, `sha256:<hex>`, `sha512-<base64>`); a value that is a key **name** (`[A-Z][A-Z0-9_]+`); an i18n key (`[a-z0-9_.]+`) |
| **S4 canary-misplaced** | a value starting with `mth-canary-` (the ADR-0053 §5 prefix) **outside** test and CI paths. The test and CI paths are `**/*.test.*`, `**/*.vitest.mjs`, `**/test/**`, `**/tests/**`, `tests/**`, `e2e/**`, `deploy/ci/**`, `.github/workflows/**`, `deploy/scripts/log-scan.mjs` and `docs/architecture/**` | canaries inside those paths are reported in the summary count as `canary (documented)`, never as a pass in disguise |
| **S5 env-template** | in `.env.example`: any non-blank, non-comment line not matching `^[A-Z][A-Z0-9_]*=$`. That is REQ-S16-031 "the environment template contains placeholders only": a variable **name** with an empty value. Comment lines are still subject to S1–S3 | — |
| **S6 secret-file** | a scanned path whose name is `.env` or `.env.*` other than `.env.example`, or that ends in `.pem`, `.key`, `.p12`, `.pfx`, `.keystore`, `.jks`, or is named `id_rsa*`, `id_ed25519*` or `credentials.json` | — |

#### 1.3 The allow-list: `tools/release/secret-allowlist.json`

Each entry is `{ "rule", "path" (glob), "valueSha256", "reason" }`. Rules for entries:

- **No value is stored.** The SHA-256 of the matched value identifies it.
- **History scope** matches on `rule` + `valueSha256` only, because paths vary across history.
- **Stale entries fail.** An entry that matches nothing in the scope being run fails the scan: `secret-scan: stale allow-list entry <n> (<path>)`. For history, "matches nothing" is computed over the history scope.
- **Protected paths.** The loader **refuses** an entry whose path glob can match `.env.example`, `deploy/compose/**`, `deploy/docker/**`, `deploy/keycloak/**`, `docs/handover/**`, or non-test files under `apps/*/src/**` or `packages/*/src/**`: `secret-scan: an allow-list entry cannot cover <path>`. A real secret in deployable configuration, product code or the handover text can therefore never be accepted.
- **Expected entries.** DO-B confirms them from a real run and lists them in its handback:
  - the redaction-test fixtures of Context 3, as `synthetic redaction-test fixture (truncated, not a credential)`;
  - `ci-only-not-a-secret` in `deploy/ci/ci.yml` and `.github/workflows/ci.yml`, as `CI-only throwaway database password for the ephemeral e2e service container`;
  - the DG6 review and test-evidence files that quote those fixtures (history scope and envelope scope only).

#### 1.4 Output and exit codes

- **Output.** One line per hit: `<rule> <path>:<line>: <masked context> (value sha256 <first 12 hex>)`. The matched value is replaced by `[<rule>:<first 4 chars>…]`, so a secret is never printed whole. The fingerprint is enough to write an allow-list entry.
- **Summary.** `secret-scan: PASS (<scope>; <files> files; allowed <n>; canary (documented) <n>)` or `secret-scan: FAIL (<hits> hits)`.
- **Exit codes.** Exit 0 is PASS and exit 1 is FAIL. Exit 2 is BLOCKED: no git repository for `--scope history`, an unreadable list, or a usage error. A BLOCKED run is never reported as a pass.

#### 1.5 CI and the blocking rule

DO-B adds a `secret-scan` job to `deploy/ci/ci.yml` (copied verbatim to `.github/workflows/ci.yml`), after `delivery-gates`, with no status-function `if:`. It runs `--scope payload`, then `--scope history`, then the self-test. A hit fails the job, and every later product job `needs` it ("a CI secret scan blocks committed secrets"). The job needs `fetch-depth: 0` for the history scope. Live CI is not run here (D-058). DO-B runs the job's commands locally and says so.

### 2. The environment template (REQ-S16-031, second clause)

S5 (§1.2) is the check. It is independent of `generate-env-example.mjs --check`, which proves that the file is **generated**, not that it is empty of values. The template stays at the repository root (D-243 Q10) and is copied to the archive as `infra/.env.example` (ADR-0062 §2).

### 3. The claims scan: `tools/release/claims-scan.mjs` (DO-B)

The scan uses no new dependency.

- **The PMI rule is reused as it is.** The script imports `PMI_CLAIM_PATTERN`, `PMI_NEGATION_PATTERN` and `claimsOfficialPmi` from `packages/shared/src/text-scan/claims.ts` through Node 24's built-in type stripping. If that import fails, the scan exits 2 (BLOCKED). It never falls back to a copy, so the DG5-approved rule cannot drift.
- **The new rules** live in `tools/release/lib/claims-rules.mjs`. Their term lists (`CONFORMITY_WORDS`, `CONFORMITY_WORDS_AR`, `ASSERTION_WORDS`, `FRAMEWORKS`, `CERTIFIED_ADJECTIVES`, `PRODUCT_NOUNS`, `NEGATIONS`) are kept **only** there, so documentation never has to spell out a claim to describe the rule. This ADR, ADR-0062 and `p7-work-split.md` must pass T-G6 themselves, by rephrasing rather than allow-listing.

#### 3.1 Scope ("docs and UI strings")

| Group | Files | What is read |
| --- | --- | --- |
| **D docs** | everything the archive's `docs/` holds (ADR-0062 §2: `docs/handover/**`, `docs/operations/**`, `docs/api/**`, `docs/architecture/**`, `docs/delivery/requirements.csv`), plus root and package `README.md` files, `licenses/README.md`, and the archive `README.txt` text (ADR-0062 §2.2, as a fixture string exported by `build-archive.mjs`) | prose: Markdown, YAML descriptions, CSV cells |
| **U UI strings** | `apps/web/src/i18n/**/*.json` (en and ar); the string literals of `apps/web/src/i18n/**/provisional-ar*.ts`; `apps/web/index.html`; the string literals of non-test `apps/api/src/**/*.ts` (problem texts and other response strings; comments are not UI and are skipped by a small tokenizer for `'…'`, `"…"` and template literals); the string literals of `packages/db/migrations/*.sql` (seeded texts) and of non-test `packages/db/src/demo/**/*.ts` (demo texts) | text values and string literals |

**Not in scope:**

- `docs/source/**`: read-only inputs, which quote rules such as "Do not claim compliance";
- `docs/delivery/**` other than the register: engineering records, which are covered for approval claims by DO-I's protocol audit (REQ-DLV-027);
- `docs/analysis/**`: analyst working papers, which are not shipped in the archive's `docs/`;
- tests, fixtures and `trading_agent/`.

#### 3.2 Rules (case-insensitive; Arabic has no case)

| Rule | A claim is | Example of what it must catch (described, not quoted) |
| --- | --- | --- |
| **K1 pmi** | `claimsOfficialPmi(text)` is true (ADR-0049 §7, unchanged) | a sentence that gives the product or the playbook official standing from PMI |
| **K2 conformity-verb** | a word of `CONFORMITY_WORDS` in `claims-rules.mjs` that **governs** an object. The list holds the English verb, adjective and noun forms of comply, conform, certify, accredit and attest. It never includes "certificate". A word governs an object when it is followed within 4 words by `with`, `to`, `by`, `under`, `against` or `for`, or preceded by `fully`, `100%` or `officially`. The Arabic forms (`CONFORMITY_WORDS_AR`: the derived forms of the roots و-ف-ق, ط-ب-ق, م-ث-ل and ع-م-د, and the noun شهادة) are matched the same way, with the governing particles مع, لـ and من | a sentence asserting the hub's conformity to a standard |
| **K3 named-framework** | a name from `FRAMEWORKS` in the same sentence as a K2 word or a word of `ASSERTION_WORDS` (meets, satisfies, aligned, approved, and their Arabic forms). `FRAMEWORKS` holds at least these names. The ISO/IEC 27000 series, 22301 and 9001. SOC reports. PCI DSS. HIPAA. GDPR. The Saudi PDPL (and its Arabic name). The NCA control sets (and the authority's Arabic name). SAMA CSF. CST and its predecessor CITC. NIST SP 800-53 and the NIST CSF. CIS Benchmarks. FedRAMP. CSA STAR. Cyber Essentials. OWASP ASVS. WCAG. The Mobily brand guidelines | a sentence asserting that the hub satisfies a named standard |
| **K4 certified-product** | an adjective of `CERTIFIED_ADJECTIVES` placed directly before a noun of `PRODUCT_NOUNS` (product, platform, solution, software, system, application, tool), and the Arabic order (noun, then adjective) | a product label carrying a certification adjective |

- **Sentences.** A sentence is split at `.`, `!`, `?`, `؟`, `؛`, a newline in Markdown prose, a table-cell boundary, and the end of a JSON string value.
- **Negation.** A K2–K4 hit is **negated**, and allowed, when a negation token occurs in the same sentence **before** the hit, at most 6 words before its first word. The tokens are those of `PMI_NEGATION_PATTERN` (not, never, no, nor, without, isn't, aren't; ليس، ليست، لا، غير، دون) plus `does not`, `do not`, `cannot`, `makes no`, `is not`, `are not`, `لم`, `لن`. K1 keeps its own negation rule unchanged.

  This lets through, among others: "this product is not certified by PMI or any other body" (`common.json`), "Do not claim compliance with an organizational or regulatory standard" (M0332, quoted in the register), and the register's "Make no organizational or regulatory compliance claims".
- **Not claims, by construction:** "compliance" with no governed object and no framework ("Risk / compliance"); "certificate" (TLS), which is not a K2 word; "WCAG" with no claim word. A statement of a measured result, such as "axe reports no violations on these screens", is not a claim either, because it names no framework next to a claim word. The guides must keep phrasing it that way (ADR-0072 guide checks).

#### 3.3 The allow-list: `tools/release/claims-allowlist.json`

Each entry is `{ "rule", "path", "lineSha256", "reason" }`. The `lineSha256` is the SHA-256 of the full sentence. A stale entry fails.

The loader refuses entries for `docs/handover/**` and for group U. Handover text and UI strings must be **rephrased**, never allow-listed. Entries are therefore possible only for engineering records in `docs/architecture/**`, `docs/api/**` or the register, where a requirement or a rule is quoted. Each one needs a reason. DO-B lists every entry in its handback.

#### 3.4 Output and exit codes

The same format as §1.4: `<rule> <path>:<line>: <sentence, truncated to 160 chars>`, then `claims-scan: PASS (<files> files; D <n>, U <n>; negated <n>; allowed <n>)` or `claims-scan: FAIL (<hits> hits)`. Exit 0, 1 or 2, as §1.4.

The **negated** count is printed so a reviewer can sample what the negation rule let through. `--show-negated` prints those sentences.

### 4. The security-controls matrix: `docs/handover/security-controls.md` (DO-B)

#### 4.1 Header text (exact English; IT document, English with an Arabic summary, D-243 Q7)

```text
# Security controls: evidence for Mobily IT's assessment

This matrix lists the security controls the Mobily Transformation Hub implements, the source clause
each one answers, where it is implemented and the automated test that exercises it. It is evidence for
Mobily IT to assess against its own requirements. It is not a statement of compliance with any
organizational or regulatory standard, not a certification and not an IT approval. Hosting
responsibilities (section 2) are integration points that the hosting environment must provide.

ملخص: تسرد هذه المصفوفة ضوابط الأمان التي ينفّذها النظام، والبند المصدر لكل ضابط، والاختبار الآلي الذي
يتحقق منه، لتستخدمها إدارة تقنية المعلومات في موبايلي في تقييمها. وهي ليست إقرارًا بالامتثال لأي معيار
تنظيمي أو مؤسسي، وليست شهادة ولا موافقة من تقنية المعلومات. (ترجمة مؤقتة لم يراجعها مراجع عربي مؤهل.)
```

The header passes the claims scan by construction: every conformity word in it is negated.

#### 4.2 Section 1: product controls, the table format (exact columns, in this order)

`| Id | Control | Source | Implemented in | Test(s) | Level | Evidence | Notes |`

- **Id:** `SC-NN`, stable and never reused.
- **Source:** one or more of an M-anchor (`M0331`) or a register id (`REQ-S16-0NN`).
- **Implemented in:** repository paths or ADR ids.
- **Test(s):** one or more repository paths of test files, separated by `<br>`.
- **Level:** `unit`, `integration`, `e2e` or `integration-level only` (the last with the reason in Notes).
- **Evidence:** optional paths of the gate test evidence that recorded a run.

The rows SC-01…SC-17 below are the **minimum set**, one per M0331/M0330 element. DO-B fills the paths, verifies every path exists, and may split a row. A row cannot be dropped without an orchestrator decision.

| Id | Control (what the hub does) | Source | Tests to link (verified to exist at `fe690c01`; DO-B completes the list) |
| --- | --- | --- | --- |
| SC-01 | Secure sessions: server-side sessions, `httpOnly`, `sameSite=lax`, `secure` under https, idle and absolute expiry, CSRF token hash (ADR-0005) | M0331 "secure sessions"; REQ-S16-0xx per DO-B | `apps/api/test/integration/identity.test.ts`, `apps/api/test/integration/oidc.test.ts` |
| SC-02 | OIDC sign-in with issuer and audience validation; a foreign issuer refused (ADR-0005, ADR-0054 §1) | M0331 | `apps/api/test/integration/identity/other-realm.test.ts` |
| SC-03 | Role and scoped authorization on every operation; read-scope parity of lists, exports and search (ADR-0006, ADR-0020, ADR-0051) | M0331 "role/scoped authorization"; M0330 | `apps/api/test/integration/access-scope.test.ts`, `apps/api/test/integration/access/read-scope-parity.test.ts`, `apps/api/test/integration/reporting/scope.test.ts` |
| SC-04 | Sensitive records and grants (ADR-0051) | M0331 | `apps/api/test/integration/access/sensitivity.test.ts`, `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` |
| SC-05 | Input validation and sanitization: strict UTF-8, free-text rules, schema validation of every request and response (ADR-0052) | M0331 "input sanitization" | DO-B: the free-text and response-validation tests |
| SC-06 | SQL injection protection: parameterized queries only | M0331 "injection" | `apps/api/test/integration/security/sql-injection.test.ts` |
| SC-07 | Cross-site scripting protection: output encoding, CSP | M0331 "request attacks" | `apps/api/test/integration/security/xss.test.ts` (Level: `integration-level only`, carried from REQ-S16-030, p7-plan §1.4) |
| SC-08 | CSRF protection for cookie-authenticated mutations | M0331 "request attacks" | `apps/api/test/integration/security/csrf.test.ts` |
| SC-09 | Rate limiting by class | M0331 "rate limiting" | `apps/api/test/integration/security/rate-limits.test.ts` |
| SC-10 | Upload restrictions: allow-list, size, safe preview, upload policy | M0331 "upload restrictions" | `apps/api/test/integration/security/uploads.test.ts`, `apps/api/test/integration/admin/upload-policy.test.ts` |
| SC-11 | Dependency checks: offline advisory audit of the SBOM; exact pins; licence inventory (ADR-0052 §6, ADR-0062 §7) | M0331 "dependency checks" | `deploy/scripts/tests/dep-audit.vitest.mjs`, ADR-0062 T-A8 |
| SC-12 | Secret-management interface: `SecretProvider`, secret references, no secret in responses (ADR-0052) | M0331 "secret-management interface" | `apps/api/test/integration/integrations/secret-binding.test.ts`, `secret-composition.test.ts`, `secret-namespace.test.ts` |
| SC-13 | Production secrets are runtime configuration: `NAME`/`NAME_FILE`, placeholder-only template, repository and history secret scan (ADR-0011, this ADR §1–§2) | M0331; REQ-S16-031 | `packages/config/src/load.test.ts`, this ADR's T-G1–T-G3 |
| SC-14 | No secrets or private evidence URLs in client code or logs: redaction, log scan (ADR-0053 §5) | M0330 | `apps/api/test/integration/operations/log-redaction.test.ts`, `deploy/scripts/tests/log-scan.test.mjs`, `packages/config/src/redaction.test.ts` |
| SC-15 | Audit of actor, action, timestamp, record id, prior and new version and reason (ADR-0004) | M0331 "Audit actor, action…" | `apps/api/test/integration/audit/audit-events.test.ts` |
| SC-16 | Append-only audit protected from ordinary modification (`REVOKE` and triggers, `0003`; ADR-0004) | M0331 "append-only audit" | DO-B: the `packages/db` audit-guard probe test |
| SC-17 | A constrained service identity per job and connector (ADR-0053) | M0330 | `apps/api/test/integration/operations/service-identity-scope.test.ts` |

Optimistic concurrency and decimal arithmetic are integrity controls, not M0331 security controls. They are not in this matrix and stay in the A-test evidence.

#### 4.3 Section 2: hosting responsibilities (REQ-S16-031 "integrate TLS and database/storage encryption with the hosting environment")

`| Id | Responsibility (hosting environment) | Product-side integration point | Product test, if any | Guide |`

| Id | Responsibility | Product-side integration point (exact) | Product test | Guide |
| --- | --- | --- | --- | --- |
| HR-01 | TLS termination for the hub's public origin, with a certificate from Mobily's CA | `APP_BASE_URL` must be https in production, except for loopback; the session cookie is `secure` under https | `packages/config/src/load.test.ts` (https rule); DO-B adds or links a test of the `secure` cookie flag | deployment guide, domains and TLS (ADR-0072, DOC-B) |
| HR-02 | TLS to the database | `DATABASE_URL` / `DATABASE_OWNER_URL` carry the server's TLS parameters (`sslmode=verify-full`); a corporate CA through `MTH_EXTRA_CA_CERTS_FILE`. **No product code sets TLS on its own** | DO-B adds an integration test against a TLS-enabled scratch PostgreSQL cluster (a self-signed CA generated under `$TMPDIR`) if the host's PostgreSQL supports `ssl=on`. Otherwise the cell reads `none (BLOCKED: <reason>)` and §5 residual 2 applies | deployment guide; `docs/operations/configuration.md` |
| HR-03 | TLS to the IdP, SMTP, object store, connector and assistant endpoints | https required in production for the issuer and the assistant; per-channel settings for SMTP (ADR-0054) | `packages/config/src/load.test.ts`, the P6 channel and storage contract tests (DO-B links them) | `docs/operations/{identity-saml-broker,notifications,storage}.md` |
| HR-04 | Encryption at rest of the PostgreSQL data volume and backups | none: a hosting function (disk, volume or managed-service encryption) | none: no product function exists | deployment guide; backup guide (ADR-0066) |
| HR-05 | Encryption at rest of evidence storage | none for the filesystem driver (volume encryption by hosting); for S3, server-side encryption is a bucket setting IT controls | none | `docs/operations/storage.md` |
| HR-06 | Secret storage and rotation (vault or mounted files) | `NAME_FILE` for every secret; `SecretProvider` references for connector secrets | SC-12, SC-13 tests | deployment guide, secrets |
| HR-07 | Network boundaries and egress control | `compose.no-egress.yaml`; the outbound destinations of `restricted-network.md` are off by default | slice B's offline drill (DO-E) | `docs/operations/restricted-network.md` |

A hosting row is **not** a product control and is not counted as one. The matrix test (§6 T-G7) requires a test for every Section 1 row and only a guide link for every Section 2 row. A `none` in Section 2 is the honest answer where no product function exists.

#### 4.4 The deployment guide's TLS and encryption content

REQ-S16-031's procedure ("the deployment guide documents TLS and encryption integration") is met by the deployment guide (ADR-0072, DOC-B). That guide's TLS and encryption subsection **links to Section 2 of this matrix** instead of restating it, so the two cannot drift. DOC-B's guide checks (ADR-0072) assert the link.

### 5. Residuals (honest)

1. **The scans are pattern-based.** The secret scan finds the listed shapes, credential URLs and high-entropy assignments. It cannot prove that no secret exists in a shape it does not know. The claims scan cannot understand every phrasing, and the negation window can let through an unusual sentence that both negates and claims. `--show-negated` exists so a reviewer can sample it.
2. **Database TLS has no product-side code.** It depends on the driver honouring `sslmode` in the URL. Whether a test can be run depends on the host PostgreSQL (§4.3 HR-02). Encryption at rest is entirely a hosting function (HR-04, HR-05).
3. **History scope covers `HEAD`'s ancestry only.** Other branches of the repository (for example the user's unrelated branches) are not part of the handover and are not scanned.
4. **Live CI** of the new job is not run (D-058).
5. **XSS evidence stays integration-level** (REQ-S16-030 carry-forward, p7-plan §1.4).
6. **The Arabic summaries are provisional** until a qualified reviewer checks them (D-243 Q7).

### 6. How it is tested

The test ids are used in `p7-work-split.md` §G. All are `node --test` files under `tools/release/tests/`, except T-G7, which is a `node --test` file next to the matrix tooling.

| Id | Proves (acceptance clause) |
| --- | --- |
| T-G1 | Secret-scan self-test. A fixture tree, built at test time from fragments so the repository never holds a whole key, contains one planted hit per rule S1–S6, and each is reported with its rule. The placeholders, checksum shapes, key names, i18n keys and test-path canaries of §1.2 are not reported. A stale allow-list entry fails. An entry covering a protected path is refused. No full planted value appears in the output |
| T-G2 | `secret-scan.mjs --scope payload` over the real tree exits 0, and so does `--scope history` (REQ-S16-031 "the secret scan finds no secrets in the repository") |
| T-G3 | S5 over the real `.env.example` passes, and over fixtures with a value (`NODE_ENV=production`), a quoted empty value (`X=""`) or a lower-case name, each fails (REQ-S16-031 "the environment template contains placeholders only") |
| T-G4 | Claims-scan self-test. A fixture corpus in en and ar holds one claim per rule K1–K4 and is reported. The negated twins ("is not certified by …", "لا يدّعي … الامتثال …"), the non-claims of Context 4, and the M0332 sentence quoted in the register are not reported. An allow-list entry for `docs/handover/**` or group U is refused. A stale entry fails |
| T-G5 | K1 parity. For every sample of `CLAIM_CORPUS` (`packages/shared/src/text-scan/corpus.ts`), `claims-scan`'s K1 verdict equals `claimsOfficialPmi`, so the rule is reused, not re-implemented |
| T-G6 | `claims-scan.mjs` over the real docs and UI strings exits 0 (REQ-S16-033 "a text scan of docs and UI strings finds no compliance or certification claim") |
| T-G7 | The matrix test parses `docs/handover/security-controls.md`. Section 1 has at least SC-01…SC-17. Every row has at least one test path, each path is an existing regular file that is a test file (`*.test.ts`, `*.test.mjs`, `*.vitest.mjs`, `*.spec.ts`), and every Source cell names an M-anchor present in `docs/source/master-prompt.anchored.md` or a register id present in `docs/delivery/requirements.csv`. Every Evidence path exists. Every Section 2 row has a guide link that resolves to an existing file. The header text equals §4.1 (REQ-S16-033 "the matrix links each control to a test") |
| T-G8 | The claims scan and the secret scan both run over `docs/handover/security-controls.md` and pass (the matrix must not itself claim) |
| T-G9 | HR-02 database TLS: the integration test of §4.3, or BLOCKED with the reason |

The **A28 half** of REQ-S16-033 is the seal-time re-run of T-G6 and T-G7 over the archive's `docs/` (DO-J, ADR-0073). The **A22 half** is the qa-verifier's re-run on the candidate (QA-C).

## Consequences

- A committed secret fails CI before any product job runs, in both the tip and the history.
- Handover text and UI strings can only be fixed by rephrasing, never by allow-listing.
- The PMI claim rule stays single-sourced (DG5).
- Mobily IT gets one matrix that separates what the hub does (with tests) from what the hosting environment must do (with integration points), and states plainly that it is not a compliance statement.

## Alternatives considered

- **gitleaks or trufflehog.** Rejected because each would be a new dependency, or a binary not in the lockfile or image lock (p7-plan §4). Neither can be fetched or verified offline here (D-057). Their rule sets also do not know the hub's documented canaries and placeholders. The rules here are narrower and fully reviewable.
- **Scanning for the bare word "compliance".** Rejected because it flags category labels such as "Risk / compliance" and the disclaimers this ADR requires. Claims are recognised by a governed object or a named framework, with negation.
- **Keeping the claim term list in this ADR.** Rejected because the ADR would then contain claim sentences and fail its own scan, or need an allow-list. The rules live in code (`claims-rules.mjs`), and the ADR describes them.
- **Listing hosting responsibilities as controls with "no test".** Rejected because it would break "the matrix links each control to a test" or water it down. They are a separate section with integration points.
