# Handback T-DG6-BE-G (backend-workflow-engineer): issuer and audience rejection, Administration > Identity

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §J/C.6.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-G-backend-workflow-engineer-20261029T230355Z-7bc17afa","session_id":"7bc17afa-015e-4ee3-92cf-28a2a508e3e4"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-BE-G.md`, sha256 `9eace14834f1a42006b506d402dd9953f62ac7ffbe77cf36d902379842a58199` (verified).
- **Base:** branch `dg6/be-g`, `HEAD` `a28d715fb5da2f666642d75397a0e8571a5fbdd3`, clean tree at start. Changes are **uncommitted**, as instructed.
- **Time:** start `Thu Oct 29 23:04:16 UTC 2026`; handback written at `Fri Oct 30 01:07 UTC 2026` (about 2 h 3 min, at the hard limit).
- **Requirement:** REQ-S16-007 (BE-G's share; DO-B and FE-B own the rest).
- **No migration, no new dependency, no contract change, no product approval.** Product gates G1–G6 are not touched. Nothing here reads or writes DG0–DG7 records.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/identity/oidc.ts` | ADR-0054 §1 issuer/audience lines. (a) New `assertIssuerAndAudience` + `IdTokenRejected`: after openid-client's own validation, `iss` must equal the configured issuer exactly, `aud` must contain the client id, and when `aud` has more than one value, `azp` must equal the client id. Called at the end of `exchange()`, so a failure takes the existing callback path (`/login?error=token_invalid`, `session.login_failed`, no session). The error message names the rule only, never a claim value. (b) `client.enableNonRepudiationChecks(configuration)` after discovery: the ID token's JWS signature is now verified against the configured issuer's JWKS (see §2, "Security note"). (c) A `clientId` getter. |
| `apps/api/src/modules/admin/identity.ts` | `getIdentitySettings` (`GET /api/v1/admin/identity`): `identity.read` held in any scope (installation-wide configuration, like `/roles`), otherwise 403. A strict empty query, so any parameter is a 400. Exports the zod mirror `identitySettings` and the pure `identitySettingsOf(config)`. Never the client secret: only `clientSecretConfigured`. The registration line already existed in `server.ts` (BE-A). |
| `apps/api/test/support/fake-idp.ts` | A second issuer, realm `mth-other`, on the same server, with its own RSA key, discovery document and JWKS. Each realm publishes only its own key. New `IssueOptions` (`issuedBy`, `signedBy`, `kidOf`), `aud`/`azp` claim overrides, `otherIssuer`, `issuerOf()`, and `lastIdToken` (so a test can prove the token never reaches a log). The existing behaviour and API are unchanged; `oidc.test.ts` (33 tests) and the contract test still pass. |
| `apps/api/test/integration/identity/other-realm.test.ts` (new) | 13 tests on their own scratch database: the three ADR cases, plus a relabelled-kid variant and two multi-audience/`azp` refusals, each asserting `/login?error=token_invalid`, exactly one `session.login_failed` (reason and actor), no new `session`/`app_user`/`user_identity` row, and no JWT, payload segment or subject in the captured log lines. Two accepted controls (the configured realm, and multi-audience with `azp` = client id). Administration > Identity tests: ADM_TECH, ADM_ACCESS and AUD read (exact body through the zod mirror); the client-secret canary is absent from the body and headers; TO and a user with no grants get 403; anonymous gets 401; an unknown query parameter gets 400. Every user signs in through the real OIDC flow. |
| `apps/api/src/modules/identity/oidc-issuer-audience.test.ts` (new) | Unit tests of `assertIssuerAndAudience` (5): exact issuer (other realm, trailing slash, case, leading space, missing, non-string), audience (absent, empty, other, malformed array, case, trailing space), `azp`, and no claim value in the message. |
| `apps/api/src/modules/admin/identity.test.ts` (new) | Unit tests of `identitySettingsOf` (2): OIDC mode (effective values, scope splitting, canary secret absent) and dev mode without OIDC (null/empty, never invented values). |
| `apps/api/test/integration/contract/p6-exercises-be-g.ts` | `getIdentitySettings` through the validating client: 200 (ADM_ACCESS+ADM_TECH, AUD), 400, 401, 403; `P6_MIRRORS_BE_G = { getIdentitySettings: identitySettings }`. |
| `apps/api/test/support/p6-pending-be-g.ts` | `getIdentitySettings` removed; the list is now empty. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-G-evidence/*` | Check logs (§3). |

## 2. Behaviour delivered (REQ-S16-007)

**Acceptance text (verbatim):** "A18;A12: e2e tests log in through the Keycloak test realm; a token from another realm is rejected". Procedure: "Login uses OIDC authorization code with PKCE; a Keycloak realm is shipped for tests; SAML is documented through a broker". Screen/API: "Login; Administration > Identity".

| Part | Status | Proof |
|---|---|---|
| "a token from another realm is rejected" | **Delivered (integration, BE-G's proof under D-195 Q5 / D-197 item 1)** | `other-realm.test.ts`: an ID token issued by `mth-other` (its own key); one from `mth-test` with `aud` of another client; one from `mth-test` signed by `mth-other`'s key (with its own kid, and relabelled with `mth-test`'s kid). Each one → 302 `/login?error=token_invalid`, exactly one `session.login_failed` ("OIDC token exchange or ID token validation failed", actor `system`), no session, no user created or bound, and no token or claim in the logs. |
| Administration > Identity (API) | **Delivered** | `getIdentitySettings` returns `authMode`, `issuer`, `clientId`, `clientSecretConfigured`, `scopes`, `expectedAudience` (= client id), `pkceMethod` (`S256` when OIDC is configured), the fixed claim mapping (`sub`/`email`/`name`) and `samlBrokerDocument`. Never the secret (canary test). AUD reads it; without `identity.read`, 403. |
| "e2e tests log in through the Keycloak test realm" | **Not BE-G's.** DO-B (§J/C.7) owns it. Per ADR-0054 §1 and D-197 item 1 it stays a disclosed BLOCKED residual wherever no container runtime exists. | — |
| SAML broker document; Administration > Identity screen | **Not BE-G's.** DO-B owns `docs/operations/identity-saml-broker.md`; FE-B owns the page. | The API returns the document path. Whether the file exists depends on DO-B. |

**Security note: a pre-existing gap, closed here.** openid-client 6.8.1 does **not** verify an ID token's signature when the token comes straight from the token endpoint (OIDC Core §3.1.3.7 lets a client rely on TLS instead), unless `enableNonRepudiationChecks` is on. Until this change, a token with the right `iss`/`aud` signed by **any** key was accepted. The negative control proves it: with only that line commented out, the two "other realm's key" tests fail and the other 11 pass (`negative-control-no-signature-check.log`: `Tests 2 failed | 11 passed (13)`, exit 1). The line was restored, and the file's diff afterwards contains it. The JWKS is fetched during the code exchange, which already runs outside any transaction (`prepareLogin`/`exchange` precede the short DB transactions in `identity/routes.ts`), so §2 rule 4 (no remote I/O inside a transaction) holds. The orchestrator may want to record this as a DG6 decision or finding note. It is not a behaviour change for a legitimate IdP.

**Shared rules (§2) that apply to this read-only slice:** no mutation, so no If-Match, audit or commit-time re-check applies. The refusal path reuses the existing `session.login_failed` audit. Bodiless GET: no `config.consumes`. Strict query parsing. No free text. Problem codes are the shared ones (400/401/403). `token_invalid` is reused, as ADR-0054 §4 states. AUD reads (no write exists). Tests are deterministic: scratch database, row-count deltas in that database, ports from the assigned range.

## 3. Checks (real exit codes; logs in `T-DG6-BE-G-evidence/`)

Environment: Node 24.21.0, offline, harness ports 25100–25149, PostgreSQL 16.15 disposable cluster (`with-pg.sh`). Three other W10 agents were running on the same host throughout, so the suite was heavily loaded.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `validate-historical-DG5-start.log` |
| 1 | `npx vitest run --project integration other-realm.test.ts oidc.test.ts` (with-pg, port 25100) | 0 | 46/46 (other-realm 13, oidc 33) | (console; covered again by row 9) |
| 2 | Negative control: the same, without the signature-check line | 1 (expected) | 2 failed / 11 passed: exactly the two signing-key cases | `negative-control-no-signature-check.log` |
| 3 | `npx vitest run --project unit-node architecture.test.ts admin/identity.test.ts identity/oidc-issuer-audience.test.ts` | 0 | 148/148 (after the fix in §5) | (console) |
| 4 | `pnpm -r typecheck` (final tree) | see §8 | | `rerun-typecheck.log` |
| 5 | `pnpm -r build` (final tree) | see §8 | | `rerun-build.log` |
| 6 | `pnpm lint` (final tree) | see §8 | | `rerun-lint.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | see §8 | | `rerun-prettier.log` |
| 8 | `pnpm openapi:lint` (final tree) | see §8 | | `rerun-openapi-lint.log` |
| 9 | `QA_PG_PORT=25120 MTH_PORT_POOL=25121-25149 tests/qa/support/with-pg.sh pnpm test:integration` | see §8 | | `integration.log` |
| 10 | `pnpm test`, locale unset (final tree) | see §8 | | `rerun-test-locale-unset.log` |
| 11 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (final tree) | see §8 | | `test-c-utf8.log`, `rerun-test-c-utf8.log` |

## 4. Operations routed (pending-list delta)

- `p6-pending-be-g.ts`: `["getIdentitySettings"]` → `[]` (−1). Exercised in `p6-exercises-be-g.ts`, with its mirror in `P6_MIRRORS_BE_G`.
- **Pinned counts:** the operation count is unchanged (the operation was already in `openapi.yaml`). It adds no media type (bodiless GET), no JSON-body route, no CSRF-exempt route and no new rate-limit class (global class). No `contract.test.ts` pin needs to change for BE-G.

## 5. For the orchestrator: contract, schema, dependency

- **zod mirror location.** `packages/shared/src/schemas/` has no `IdentitySettings` mirror, and `packages/shared` is not in BE-G's ownership. So the mirror `identitySettings` lives in `apps/api/src/modules/admin/identity.ts` (exported), and both the contract exercises and the tests import it from there. If FE-A/FE-B want it in `@mth/shared/schemas`, move it there unchanged (one export; the test imports then follow).
- **No contract change, no migration, no dependency.** `openid-client`'s `enableNonRepudiationChecks` is part of the installed 6.8.1.
- **Process note (my own defect, fixed before the final runs).** My first version put the settings unit tests in `identity/oidc-issuer-audience.test.ts`, which imported `admin` from the `identity` module. `architecture.test.ts` refused it ("module identity may not import module admin"). That is the one `unit-node` failure in the first locale-unset run (`test-locale-unset.log`, 1 failed / 2631). I moved those tests to `admin/identity.test.ts` at 23:50:31Z. Every final-tree run listed in §8 started after that time.

## 6. User-facing texts

- `apps/web/src/i18n/{en,ar}/auth.json` `errors.token_invalid` ("The sign-in could not be verified. Please try again.") stays true: a refused token from another realm reaches exactly that message.
- The server navigation item Administration > Identity (`identity/navigation.ts`, `p6Screen: "identity"`) still reports `availability: "planned"`. That stays true until FE-B ships the screen and adds `"identity"` to `DELIVERED_P6_SCREENS` in the same change (D-198, F-DG4-160). **For FE-B:** add it when the page ships. BE-G did not change it, because the screen does not exist yet.
- No en/ar string calls the issuer/audience rejection or the identity settings API "planned". Nothing else became untrue.
- Not user-facing, for the record: ADR-0054 "Context" item 1 ("No test presents a token from another issuer") describes the pre-P6 state and is history. The `fake-idp.ts` header's claim that openid-client "validates everything it returns" is now true for signatures as well.

## 7. What remains

- **For BE-G:** nothing in §J/C.6, unless a check in §8 says otherwise.
- **For others (not BE-G):** DO-B: the Keycloak realm `mth-other`, image pin, e2e login (BLOCKED where there is no container runtime), and the SAML broker document. FE-B: the Administration > Identity page and the `DELIVERED_P6_SCREENS` entry.

## 8. Final results: the state at the time limit (honest status)

**Status: implementation complete; verification INCOMPLETE.** The host was memory-starved (three other W10 agents, plus my own overlapping re-run). The `apps/api` build was SIGKILLed (137) and the integration run lost a worker process (`ERR_IPC_CHANNEL_CLOSED`), both at 00:56–00:58Z. Several suite runs had not finished when I hit the time limit. Nothing below is reported as passed unless it ran and exited 0.

**Final tree** = the tree after the 23:50:31Z test move (§5). Runs that started after that time count for the final tree.

| Check | Run | Exit | Counts / note | Log |
|---|---|---|---|---|
| `validate --historical --stage DG5` | start, 23:07Z | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5-start.log` |
| `validate --historical --stage DG5` | end, 01:02Z | **124 (NOT RUN TO COMPLETION)** | My `timeout 280` wrapper stopped it under load; no verdict. Only the start-of-task PASS stands. | `validate-historical-DG5-end.log` |
| `pnpm -r typecheck` | final tree | **0** | | `rerun-typecheck.log` (first run, pre-fix: 0, `typecheck.log`) |
| `pnpm -r build` | pre-fix tree | **0** | | `build.log` |
| `pnpm -r build` | final tree | **137 (killed)** | `apps/api build: Killed` (OOM). web, db and worker: Done. The change between the two trees is test files only, which `tsconfig.build.json` builds do not compile in production builds, but that is an inference, not a pass. **Re-run needed.** | `rerun-build.log` |
| `pnpm lint` | final tree | **0** | | `rerun-lint.log` (pre-fix: 0, `lint.log`) |
| prettier `--check` over `git ls-files -co` | pre-fix tree | **0** | | `prettier.log` |
| prettier `--check` | final tree | **still running at handback** | My changed files were formatted with `prettier --write` (all "unchanged" afterwards). | `rerun-prettier.log` |
| `pnpm openapi:lint` | pre-fix tree | **0** | No contract change by BE-G. | `openapi-lint.log`; final-tree re-run queued: `rerun-openapi-lint.log` |
| `pnpm test`, locale unset | pre-fix tree | **1** | unit-node 1 failed / 2631 passed (my architecture-boundary defect, fixed in §5); unit-web 1787/1787; unit-formula-nocodegen 259 passed, 2 skipped | `test-locale-unset.log` |
| `pnpm test`, locale unset | final tree | **queued/running at handback** | | `rerun-test-locale-unset.log` |
| `pnpm test`, `C.UTF-8` | final tree (started 23:58Z) | **1** | unit-node 1 failed / 2631: `architecture.test.ts` "apps/web never imports @mth/db…" **timed out at 30 s** (40 s wall time; 11 s when run alone; BE-G touched no `apps/web` file). unit-web 3 failed / 1784: `raid.test.tsx`, `traceability.test.tsx`, `transformations.test.tsx` `findBy…` not found, in pages BE-G did not touch; the same 1787 web tests passed 1787/1787 in the unset run on identical web code. unit-formula-nocodegen 259 passed, 2 skipped. Load-attributed, **not proven**. | `test-c-utf8.log` |
| `pnpm test`, `C.UTF-8` | final tree, re-run | **queued (starts after the unset re-run)** | | `rerun-test-c-utf8.log` |
| `with-pg.sh pnpm test:integration` (ports 25120–25149) | final tree (started after 23:58Z) | **1 (crashed)** | 25 test files completed, **0 failures**, including `contract/contract.test.ts` **101/101** (it runs `exerciseP6BeGOperations`). Then a vitest worker died: `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` (no test assertion failed). No total counts. **Re-run needed.** No pinned-count change from BE-G. | `integration.log` |
| BE-G integration files only (`other-realm.test.ts` + `oidc.test.ts`) | final tree (code); run at 23:18Z, before the 23:50 unit-test move, which does not touch these files | **0** | 46/46 (13 + 33) | (console, §3 row 1) |
| Negative control (signature check removed) | — | 1 (expected) | 2 failed / 11 passed | `negative-control-no-signature-check.log` |
| Unit: `architecture.test.ts` + both new unit files | final tree | **0** | 148/148 | (console, §3 row 3) |

**What remains (for the orchestrator, on the merged tree, ideally with less concurrent load):**
1. `pnpm -r build` (final-tree run killed by OOM).
2. `with-pg.sh pnpm test:integration` (crashed after 25 files with 0 failures).
3. `pnpm test` with the locale unset and with `C.UTF-8` (the unset re-run and the C.UTF-8 re-run were still queued or running at handback; their logs `rerun-test-locale-unset.log` and `rerun-test-c-utf8.log` may complete after this handback, and if they do, they are real outputs of the final tree).
4. Prettier `--check` and `openapi:lint` on the final tree (re-runs in progress; the pre-fix runs exited 0, and BE-G's changed files are prettier-clean).
5. `validate --historical --stage DG5` at the end (stopped by my timeout; it passed at the start).

There is no separable second half of §J/C.6 left unimplemented. Only verification remains.

### 8a. Update at 01:36Z (re-runs completed after the handback was first written)

| Check | Run | Exit | Counts / note | Log |
|---|---|---|---|---|
| prettier `--check` over `git ls-files -co` | final tree | **0** | | `rerun-prettier.log` |
| `pnpm openapi:lint` | final tree | **0** | | `rerun-openapi-lint.log` |
| `pnpm test`, locale unset | final tree | **1** | unit-node **2632/2632** (172 files; the §5 boundary fix confirmed). unit-formula-nocodegen 259 passed, 2 skipped. unit-web **5 failed / 1782**: `change-requests.test.tsx` (ar), `p2-blank-forms.test.tsx` (ar), `portfolio.test.tsx` (ar), `traceability.test.tsx` (ar, en). All are `apps/web` page tests BE-G did not touch (BE-G changed no `apps/web` file). The failing set differs from the C.UTF-8 run's (raid, traceability-ar, transformations), and the same suite passed 1787/1787 in the first unset run on identical web code. This is consistent with load flakiness (F-DG4-143 class), **but not proven**: it is a non-zero exit and is disclosed as such. | `rerun-test-locale-unset.log` |
| `pnpm test`, `C.UTF-8` | final tree, re-run | **started at 01:36Z, not awaited** | Its log may complete after this handback. | `rerun-test-c-utf8.log` |

Remaining items in §8 "What remains" are unchanged, except item 4 (prettier, openapi:lint: now done, exit 0). The orchestrator should re-run unit-web in both locales on the merged tree under lower load. If those page tests still fail there, they are a finding for their owner, not a flake.

### 8b. Update at 01:56Z: the C.UTF-8 re-run completed

| Check | Run | Exit | Counts / note | Log |
|---|---|---|---|---|
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | final tree, re-run (01:36–01:55Z) | **1** | **Every test passed:** unit-node 2632/2632 (172 files), unit-web 1787/1787 (98 files), unit-formula-nocodegen 259 passed, 2 skipped. The non-zero exit comes from one Vitest **unhandled error** in the unit-node invocation, `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` ("Errors 1 error", log line 316): a worker-to-main RPC timeout of the runner under load, not a test assertion. Vitest counts it as a failure, so this run is **not a pass**. | `rerun-test-c-utf8.log` |

Net position for acceptance item 2: under `C.UTF-8`, every test passed on the final tree, but the run exited 1 because of a runner RPC timeout. With the locale unset, unit-node and formula passed, and unit-web had 5 failures in untouched pages that passed in other runs. Item 2 is therefore **not met** in this run. The orchestrator's re-run on the merged tree under lower load decides it.
