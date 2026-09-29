# P1 (Secure Foundation) — Security & Privacy Review

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, REVIEW mode, independent. The reviewer did not author any of the reviewed code. |
| Revision | **`5d0dd09`** ("Merge governance module (P2) …"). Detached review worktree `/home/user/My-owns/.claude/worktrees/review-p1-sec/transformation-hub`. `git status` is clean: only git-ignored build output (`dist/`, `.next/`) was produced. |
| Databases | **`hub_test_sec` only**, reset, migrated and seeded by the API test run. No other database was touched (`hub_dev`, `hub_test`, `hub_test_lead`, other agents' DBs). |
| Processes | API on `:4101` (demo; standard + secure cookies; demo + `HUB_TRUST_PROXY=true`), the worker, a web `next start` on `:3101`, and a local header-echo stub on `:4101`, each started from this checkout against `hub_test_sec`. All were stopped by PID afterwards. No external host was contacted: the headless browser aborted every non-`127.0.0.1` request. |
| Scope | `apps/api/src/platform/**`, identity (demo login + OIDC SSO), portfolio, `packages/db/sql/post-migrate.sql`, `packages/db/src/schema/**`, `packages/domain/src/policy/**`, `docs/security/**`, and the web security posture (`next.config.ts`, `lib/api.ts`, cookies, XSS sinks). For documents and governance, only isolation/IDOR, file-upload safety (AT-25) and the SQL visibility of lists, counts and search are in scope. |
| Exit criterion (spec §19) | "Persistence after restart, two isolated projects, denied unauthorized access, security plus QA review" |
| **Verdict** | **FAIL**: 1 open **High** (SEC-P1-01), 3 Medium, 8 Low, 6 Info. |

## 1. Commands run and real results

Test-harness note: the brief's `pnpm test` fails at `5d0dd09` in a fresh worktree until the workspace packages are built. The first run gave `TS2307: Cannot find module '@hub/domain'`, EXIT=2. The fix was `pnpm build:packages`, then the re-run below. The scratch directory is shared with other agents, and another agent overwrote a log with the same name, so every log below comes from a private sub-directory.

**C1. API integration suite (own DB)**
```
$ pnpm build:packages            # domain, contracts, db → tsc OK
$ cd apps/api && TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_sec \
    TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_sec pnpm test
 RUN  v4.1.11 /home/user/My-owns/.claude/worktrees/review-p1-sec/transformation-hub/apps/api
 Test Files  14 passed (14)
      Tests  156 passed (156)
   Duration  50.14s
EXIT=0
```
**C2. Domain unit tests** (includes `policy.test.ts`): `pnpm --filter @hub/domain test` → `Test Files 7 passed (7) · Tests 126 passed (126)`.

**C3. AT-03 isolation and IDOR** (`isolation.mjs`, API :4101, demo mode). Fixtures were created through the API: document `SECPROBEA okapi <img…><script>…` in DEMO-DC (A) and `SECPROBEB zebra <img…><script>…` in DEMO-TRANSFORM (B), each with a text version indexed by the worker (`quokkaalpha` / `quokkabeta`).
```
== pm.b / contributor.b (project B) against project A — every one of these returned 404 not_found:
GET A, A/documents, A/documents/search?q=SECPROBEA, A/documents/<docA>, A/decisions, A/decisions/<decA>, A/members,
    A/workstreams, A/activity, A/committees(/<id>), A/meetings(/<id>), A/actions(/<id>), A/evidence, A/sources, A/escalations
POST A/documents, A/members, A/decisions; PATCH A                                          -> 404
-- IDOR: A's ids under B's path (pm.b)
GET B/documents/<docA> 404 · B/decisions/<decA> 404 · B/committees/<cmtA> 404 · B/meetings/<mtgA> 404 · B/actions/<actA> 404
POST B/members/<memA>/revoke 404 · B/documents/<docA>/classify 404 · B/decisions/<decA>/submit 404 · B/workstreams/<wsA>/lead 404
  (contributor.b gets 403 "Missing permission …" on routes it lacks: route-level RBAC runs before any id lookup, so the answer does not depend on the id)
list projects: total=1 codes=DEMO-TRANSFORM · list projects q=DEMO-DC: total=0
B/documents/search?q=SECPROBEA|okapi|quokkaalpha|TSA|charter -> total 0 · B/documents?q=SECPROBEA -> total 0
== pm / contributor / sponsor (project A) against project B: GET B, B/documents, B/documents/<docB>, B/decisions/<decB>, B/members,
   B/activity, B/decisions -> 404; A/documents/<docB> 404; A/decisions/<decB> 404; POST A/members/<memB>/revoke -> 404 (pm)
   A/documents/search?q=SECPROBEB|zebra -> total 0
positive controls: pm A search SECPROBEA -> 1 hit · pm.b B search SECPROBEB -> 1 hit
content search (worker-indexed chunks):
pm A q=quokkaalpha total=1 · q=quokkabeta total=0 | pm.b B q=quokkabeta total=1 · q=quokkaalpha total=0 · q=quokka total=0
```
**C4. CSRF, unauthenticated access and injection** (`csrf_sqli.mjs`)
```
no x-csrf-token 403 auth.csrf · wrong token 403 · other user's token 403 · cookie only 403 · PATCH w/o header 403
logout w/o header 403 · setLocale w/o header 403 · form-urlencoded w/o header 403 · text/plain w/o header 403
header == own session token, no hub_csrf cookie -> 201   (server verifies against the session's stored hash: synchronizer token)
anon GET /me, /projects, /projects/A, /projects/A/documents, /admin/users, /directory/users, /templates -> 401; anon POST -> 401
"' OR 1=1--", "%' OR '1'='1", "') OR true--", "1;select pg_sleep(3)--", "' union select null,null--" in q (documents, search,
  decisions, projects) + sort="title; drop table document--" / "(select pg_sleep(3))" -> all 200, total 0, 40–67 ms (no delay)
"%" / "_" -> decisions 1, projects 1, admin users 28 (LIKE wildcards unescaped outside documents; not injection — I-2)
path projectId "…c070' OR '1'='1", "..%2F..%2Fetc%2Fpasswd" -> 404 · documentId "x' OR '1'='1" -> 400 Invalid UUID
mass assignment {projectId:B, orgId, legalHold:true, createdBy} and __proto__/constructor keys -> 201, row in DEMO-DC,
  legal_hold=f, created_by=pm (unknown keys stripped by Zod)
```
**C5. Stored XSS: API storage and browser rendering** (`xss-browser.cjs`, headless Chromium 141 through web :3101 → API :4101). pm.b set project B's name to `XSSNAME <img src=x onerror="window.__xss=1;alert(1)"><script>window.__xss=2</script>` and its description to `<svg onload=…><a href="javascript:…">`.
```
PATCH project B name/description with payloads: 200
page /:            window.__xss=null dialogs=0 injectedElements={"imgX":0,"svgOnload":0,"jsHref":0} payloadShownAsText=true
page /projects/B:  window.__xss=null dialogs=0 injectedElements={"imgX":0,"svgOnload":0,"jsHref":0} payloadShownAsText=true
```
Static check: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, markdown or HTML renderer in `apps/web/src`. Web dependencies are React, TanStack Query, lucide and zod only.

**C6. Partner room / clean team: API layer** (`rooms.mjs`, `rooms2.mjs`). The reviewer added fixtures in `hub_test_sec`: a `clean_team` room grant for `cleanteam` on "AT-03 clean team room", and clearances cleanteam → strictly_confidential and partner.alpha → confidential. Without the clearance change, cleanteam (clearance `internal`) could not see even its own room's confidential document.
```
partner.alpha: /projects total 0; every A/* route -> 403 (external_partner_limited has no document/plan/governance permission); B/* -> 404
cleanteam:     list total 1 ['AT-03 clean-team analysis (synthetic) [room 291f5698]'] · search AT-03 -> that doc only
               GET in-room(alpha) 404 · other-room 404 · no-room 404 · restricted 404 · own clean-team doc 200
               POST doc in other room 404 · POST doc without room 404 · POST doc in own CT room 201
pm, contributor, sponsor, auditor (full members, no room grant): room docs visible=[] · GET clean-team doc 404
```
**C7. Partner room / clean team: DB layer** (`dbrooms.sql`, `psql` as `hub_app` with the context the API computes for each principal: `app.project_ids=A`, `app.full_project_ids=''`, `app.room_ids=<room>`)
```
                      partner.alpha           cleanteam
documents             1 (in room 1, out 0)    2 (in room 2, out 0)
document_chunk/_version 0/0                   0/0
partner_room          1 (own)                 1 (own)
room_grant            2 (all own)             1 (own)
project_membership    0                       0          ← ARCH-22 fixed
task / decision / evidence_link / audit_event(project)  0
audit_event(org-level, project_id NULL)  123           123        ← SEC-P1-12
app_user              28                      28         ← SEC-P1-12
project               1 (DEMO-DC row)         1
INSERT room_grant (self-grant) -> ERROR: new row violates row-level security policy for table "room_grant"
INSERT document without room   -> ERROR: new row violates row-level security policy for table "document"
```
**C8. Sessions** (`sessions.mjs`)
```
Set-Cookie hub_session=<token>; Max-Age=43200; Path=/; Expires=…; HttpOnly; SameSite=Lax           (dev: Secure off)
Set-Cookie hub_csrf=<csrf>; Max-Age=43200; Path=/; Expires=…; SameSite=Lax                          (readable by design)
with HUB_COOKIE_SECURE=true: "Set-Cookie: hub_csrf=…; Secure; SameSite=Lax" (session cookie is issued by the same helper)
token length 43 (256-bit base64url) · DB row found by sha256(token); plaintext token/csrf in session table: 0
idle expired -> /me 401 · absolute expired (idle in future) -> /me 401 · touch bounded: idle<=absolute t
logout 201 -> replay old cookie 401, revoked_reason 'logout' · logout without session 401
approver (2 sessions) 200/200 -> platform.admin deactivates -> 401/401; re-login 404; sessions revoked 7/7
self-deactivation 422 identity.self_deactivation · non-admin deactivate 403
```
**C9. Demo login outside demo mode** (API restarted with `HUB_MODE=standard HUB_COOKIE_SECURE=true`)
```
GET /auth/demo-users 404 · POST /auth/demo-login 404 · /auth/config {"demoLogin":false,"oidc":{"status":"not_configured",…}}
demo session minted before restart (auth_method=dev, synthetic sponsor): /me 200 · /projects 200      ← SEC-P1-02
```
**C10. Configuration validation** (`loadConfig` from `dist/platform/config.js`)
```
REJECTED HUB_MODE=demo | cookie not secure | mock AI (default) | dev DB password | owner role | DATABASE_URL unset |
         local storage | no OIDC issuer | OIDC w/o cookie secret | http OIDC issuer | NODE_ENV=staging
ACCEPTED safe baseline | 'postgres' superuser in URL (caught at runtime, C11) | OIDC client id unset | http redirect URI |
         cookie secret 'a'×32 | LINK_BY_EMAIL=true | PRIVATE_MODE=false | TRUST_PROXY=false            ← SEC-P1-10
```
**C11. Runtime DB-role self-check** (production config, owner role URL-encoded so it passes the static regex)
```
$ NODE_ENV=production … DATABASE_URL='postgres://hub%5Fowner:hub%5Fdev%5Fonly@127.0.0.1:5432/hub_test_sec' node apps/api/dist/main.js
API failed to start: Refusing to start: runtime database role owns 104 table(s) — row-level security would not isolate projects. …
exit=1
```
**C12. OIDC** (`oidc-probe.mts`: the repo's `FakeOidcIdp`, used unmodified, plus the compiled API with `HUB_OIDC_LINK_BY_EMAIL=true`)
```
state cookie Set-Cookie : hub_oidc=<sealed>; Max-Age=600; Path=/api/v1/auth/oidc; …; HttpOnly; SameSite=Lax
authorize params        : response_type=code code_challenge_method=S256 scope=openid email profile | state? true nonce? true code_challenge? true
legit S1 login          : / session: true me: victim
attacker S2 same email  : / session: true me.user: VICTIM ACCOUNT (sec.victim.…@example.invalid) authMethod=oidc   ← SEC-P1-01
victim oidc_subject after: S1-…            (not re-bound; the takeover does not even leave a trace in the binding)
link_subject audit rows for victim: 1      (written although the UPDATE bound nothing)
attacker S3 UPPERCASE email: / session: true VICTIM ACCOUNT
callback ?error=<script> -> 302 /login?sso_error=x%22%3E%3Cscript%3E…   (encoded; the web ignores sso_error)
state cookie exp extended w/o re-MAC -> /login?sso_error=oidc.bad_state
```
The test suite `test/p1/oidc-sso.spec.ts` (part of C1) passed its PKCE, state, nonce, replayed-code, and bad nonce/audience/issuer/expiry/**signature** cases, plus no-auto-provisioning, demo-user and inactive-user refusal, and redirect-after-commit.

**C13. Rate limiting and error redaction** (`errors_rl.mjs`, `rl2.mjs`, and web :3101 → echo stub)
```
invalid calendar date (PG 22008) -> 500 {"code":"internal_error","detail":"An unexpected error occurred.","correlationId":…}
   API log: "unhandled error [3c9e…] Error: Failed query: [redacted]"   (no SQL, no params, no stack in the response)
malformed JSON 400 · 2 MB JSON 413 request.too_large · bad enum 400 validation_failed · unknown route 404
public: 70 GET /auth/config -> {"200":51,"429":19}; demo-login while bucket exhausted -> 429; spoofed XFF (trust proxy off) -> 429
mutations: 130 POST /me/locale -> {"201":120,"429":10}; other session 201; reads for the limited session 200
Next rewrite forwards to API:  no client XFF -> {"xff":null,…,"remote":"127.0.0.1"} · client XFF 6.6.6.6 -> {"xff":"6.6.6.6"}
HUB_TRUST_PROXY=true behind web: 150 req rotating spoofed XFF -> {"200":150}; fixed XFF -> {"200":60,"429":10}   ← SEC-P1-04
```
**C14. Secrets**
```
git grep private keys / AKIA / xox / ghp_ / sk- / JWTs -> none
postgres URLs with credentials: only the documented dev password `hub_dev_only` (dev CLIs, test-env, docs) — rejected in production (C10)
built web client (.next/static, 2.8 MB): hub_dev_only 0 · hub_owner 0 · postgres:// 0 · DATABASE_URL 0 · HUB_COOKIE_SECRET 0 ·
  OIDC client secret 0 · PRIVATE KEY 0 · API URL 0 · process.env 0 · source maps 0; .next/server: no credentials
session token in API logs 0 · in audit/outbox/job 0 · audit before/after with unredacted token/secret/password/csrf/cookie keys 0
```
**C15. Audit** (`dbarch.sql` as `hub_app`; tamper steps as owner inside `BEGIN … ROLLBACK`)
```
hub_app: UPDATE/DELETE/TRUNCATE audit_event -> permission denied · DELETE project_membership / UPDATE vote -> permission denied
owner:   TRUNCATE audit_event / audit_checkpoint -> append_only_violation
verify (own org) broken rows 0 · owner rewrites chain_pos 10 -> broken_at 10 · deletes 5 rows up to last checkpoint -> broken_at 783
deletes the tail after the last checkpoint -> 0 broken rows   (documented ADR-0014 window, ≤15 min; WORM export is P7)
denied mutations audited: 161 denied/rejected rows, e.g. pm.b "denied | portfolio.revokeMembership | DEMO-TRANSFORM | not_found"
auth.csrf denials audited 0 · rate-limit denials audited 0      ← SEC-P1-11
```
**C16. File upload safety, AT-25** (`upload.mjs`)
```
html as .html / svg as .png / MZ exe as .pdf / EICAR .txt / <script> html as .txt -> quarantined, never current, mime octet-stream
application/json upload -> 415 · "../../../etc/passwd.txt" -> filename "passwd.txt" · "a\"\r\nX-Injected: 1.txt" -> "a_X-Injected_ 1.txt"
  Content-Disposition: attachment; filename="a_X-Injected_ 1.txt"; filename*=UTF-8''…  (no injected header)
bidi RLO name -> 422 extension_mismatch · quarantined version download -> 422 (problem, no file bytes)
```
The AT-25 suite (C1) also passed its oversize, allowlist, integrity (SHA-256), SSRF (URLs never fetched) and storage-key tests.

## 2. Findings

| ID | Sev | Location (5d0dd09) | Finding | Reproduction | Req / AT | Recommendation |
|---|---|---|---|---|---|---|
| **SEC-P1-01** | **High** | `apps/api/src/modules/identity/oidc.service.ts:124-133, 150-153`; `packages/db/sql/post-migrate.sql:418-422` (`hub_auth_user_by_email` returns users already bound to a subject); `config.ts:26` (flag accepted in production) | **OIDC link-by-email takes over accounts that are already bound.** With `HUB_OIDC_LINK_BY_EMAIL=true`, any IdP identity with a *different* `sub` whose `email` claim matches an existing active non-demo user gets a session **as that user**, even when the user is already bound to another subject. `linkSubject` updates `where oidc_subject is null` (0 rows), ignores the row count, and the code then sets `user = byEmail`. `email_verified` is never checked (`:125`). An `identity.oidc.link_subject` audit row is written although nothing was bound. The documented semantics ("by email **on first login**", `oidc.service.ts:22`) are not enforced. Any privileged account (platform_admin, sponsor, …) is reachable. The default (`false`) is safe. | C12: bound victim (S1); attacker subject S2 (and S3 with the upper-case email) → `302 /`, `/me` = victim, `authMethod=oidc`. | REQ-SEC-003, REQ-SEC-024, ADR-0005 (no auto-provisioning / first-login binding); P1 "denied unauthorized access" | Only link when the stored `oidc_subject IS NULL`: filter in `hub_auth_user_by_email` or a dedicated link function, and require `rowCount === 1` before using the row. Require `claims.email_verified === true`. Write the audit row only after a real bind. Consider rejecting `LINK_BY_EMAIL=true` in production, or making it a time-boxed admin-armed one-time link. Add a regression test: a bound user logged in by a second subject must be refused. |
| SEC-P1-02 | Medium | `apps/api/src/platform/auth/session.service.ts:35-56` | **Demo sessions and synthetic users survive a switch out of demo mode.** `resolve()` does not reject `auth_method='dev'` or `user_is_demo` when `demoMode` is false. A session minted by the credential-less demo login (anyone who reached a demo instance can mint one, including for `platform.admin`) stays valid for up to 12 h after the same DB is served in standard mode. | C9: demo sponsor session → restart with `HUB_MODE=standard` → `/me` 200, `/projects` 200. | REQ-SEC-024, REQ-SEC-009, ADR-0005 | In `resolve()`, return null for `auth_method='dev'` or `user_is_demo` unless `config.demoMode`. On non-demo start, revoke all `dev` sessions. Optionally refuse production start while active `is_demo` users exist. |
| SEC-P1-03 | Medium | `apps/api/src/modules/portfolio/portfolio.service.ts:558-597` | **The activity feed ignores the ABAC conditions of `audit.event.read`** (classification, room, clean_team per the policy matrix). An auditor with `confidential` clearance and no room grant sees events (entity ids, actions, free-text reasons) of **restricted** and **clean-team-room** documents they get 404 for. The `entityType=document&entityId=<id>` filter is an existence oracle (total 1 vs. GET 404). | C3/`activity2.mjs`: 5 events about hidden docs, e.g. `documents.document.classify 01a0edf9-56fe [restricted] reason="Demo reclassification"`, `documents.document.create 01a0edf9-4193 [confidential+room]`. GET of the same docs → 404. | AT-03, REQ-SEC-006/007, policy-matrix `audit.event.read` | For document, document_version and evidence entity types, join to `document` and apply `visibilitySql` (classification + room) in both the list and the count. Treat room/clean-team entities as invisible without a room grant. Add a test with an org auditor and a clean-team document. |
| SEC-P1-04 | Medium | `apps/api/src/platform/hub.guard.ts:52-56`, `bootstrap.ts:14`, `apps/web/next.config.ts:40-42`, ADR-0017:16-17 | **The public rate limit either shares one bucket or is spoofable behind the project's own same-origin proxy.** The Next rewrite adds no `X-Forwarded-For` and forwards a client-supplied one verbatim. With `HUB_TRUST_PROXY=false` (default), every user shares the web server's bucket (60/min), so an unauthenticated client can block all demo-login, OIDC login and callback for everyone. With `true`, the per-IP limit is bypassed by rotating XFF. | C13: web → echo stub shows `xff:null` or the client's value. Trust proxy on: 150 spoofed requests → 150×200. Bucket exhausted → demo-login 429. | REQ-DAT-016, ADR-0017 | Make the web tier overwrite XFF (or send a signed client-IP header) and trust exactly that hop (`trust proxy` = proxy address list). Add an ingress limiter. Add a production check that the proxy topology is configured. |
| SEC-P1-05 | Low | `apps/web/src/app/login/page.tsx:23-26, 73, 93` | **Open redirect after login.** `safeNext` accepts `/\t/host`, `/\n/host` and `/\r\n/host`. The URL parser strips tab and newline, giving `//host`. | C5 browser: `/login?next=%2F%09%2Fevil.example.invalid%2Fphish` while signed in → "Continue" href `"/\t/evil…"`; navigation attempted to `http://evil.example.invalid/phish` (aborted by the probe). | REQ-SEC-016 | Resolve with `new URL(next, location.origin)` and require the same origin and a path without control characters. |
| SEC-P1-06 | Low | `post-migrate.sql:609-642` ($userfk$ skips columns that already have a single-column FK); `:369-378` (`hub_auth_user_scope` membership branch has no org check); project RLS policies test `project_id` only | **Org-scoped user FKs are incomplete.** 151 user columns are `(org_id, col)`-scoped, but **31 are not**, including `project_membership.user_id`, `room_grant.user_id`, `org_role_assignment.user_id`, `committee_membership.user_id` and `decision.requester_user_id`. A cross-org membership or room grant is accepted. Scope resolution and project RLS would then admit that user. The API cannot create one today (RLS hides other-org users). This is defence in depth. | `psql` as owner, rolled back: INSERT `project_membership` / `room_grant` naming an org-2 user in an org-1 project → **ACCEPTED**. Same test on `document.owner_user_id` → FK `hub_ufk_document_owner_user_id` violation. | REQ-DAT-002, ARCH-21 | Add composite `(org_id, col)` FKs to those 31 columns as well. Add `pm.org_id = u.org_id` (and the same for `ora`/`rg`) in `hub_auth_user_scope`. |
| SEC-P1-07 | Low | `apps/api/src/bootstrap.ts:13` (`bodyParser: true` also registers urlencoded); `identity.controller.ts:95-101` | **Login CSRF on demo login** (demo mode only). The public route accepts `application/x-www-form-urlencoded`, so a cross-site HTML form can sign a victim's browser in as any synthetic persona, including `platform.admin`. | `fetch` urlencoded `userId=…` with `Origin: https://attacker.example`, `Sec-Fetch-Site: cross-site` → 201 + `hub_session` set. text/plain → 400. CORS preflight → 404, no ACAO. | REQ-SEC-016 | Accept only `application/json` on public POST routes (disable the urlencoded parser). Check `Origin`/`Sec-Fetch-Site` on public POSTs. |
| SEC-P1-08 | Low | `apps/web/next.config.ts:19`; API responses (no `Cache-Control`); `docs/security/threat-model.md` C-26 (P1) | Security headers fall short of control C-26. The web CSP has `script-src 'self' 'unsafe-inline'` (documented follow-up in `apps/web/README.md:59`). Authenticated API JSON carries only `ETag`, no `Cache-Control: no-store`. The web `fetch` uses `cache:'no-store'`, which mitigates the browser case only. | `curl -D -` on web `/login` shows the CSP. `GET /projects/A/documents` headers: `cache-control: null`, `etag: W/"2ba3-…"`. | REQ-SEC-016, C-26 | Use a nonce-based CSP (`proxy.ts`). Set `Cache-Control: no-store` on every `/api` response. Mark C-26 as partial in the threat model until then. |
| SEC-P1-09 | Low | `apps/api/src/platform/db.service.ts:68-72` | **ARCH-07 residual.** `db.tx()` and captured handles now throw after commit, but `db.query()` falls back **silently to the pool with no RLS context** when the ALS store is closed. RLS-exempt tables (`session`, `job`, `outbox_event`) are fully accessible there. | `txproxy.cjs`: continuation after commit → `capturedTx threw…`, `dbTx threw…`, `dbQueryAfterClose EXECUTED on pool without RLS context: {"org":"","sessions":115,"tasks":0}`. | ADR-0003, REQ-SEC-006 | Throw when a store exists but is closed. Use the pool only via an explicit `db.pool` call. |
| SEC-P1-10 | Low | `apps/api/src/platform/config.ts:54-64` | **Production validation gaps against C-04.** The following are accepted: OIDC issuer without `HUB_OIDC_CLIENT_ID` (SSO silently disabled, so production has no login), `http://` redirect URI, a trivially weak `HUB_COOKIE_SECRET` (`'a'×32`), `HUB_OIDC_LINK_BY_EMAIL=true`, and no `HUB_TRUST_PROXY`. The "default/sample secrets" and "non-TLS public URL" checks listed in C-04 do not exist. | C10 | REQ-SEC-012, REQ-SEC-024, C-04 | Require the complete OIDC triple and an https redirect. Reject low-entropy or repeated-character secrets. Reject or warn on link-by-email. Validate the proxy settings. |
| SEC-P1-11 | Low | `hub.guard.ts:83-90`, `errors.ts:219-230`, `audit.service.ts:57-70` | **Gaps in auditing denied attempts.** CSRF failures and rate-limit denials are not audited (no `hubCtx` yet), and their problem bodies have no `correlationId`. Denied out-of-scope mutations record neither the target entity id nor the attempted project id (reason only `not_found: Resource not found`). | C15: `auth.csrf` audited 0, `rate_limited` 0. pm.b's cross-project revoke is audited with no entity id. | REQ-DAT-006, REQ-SEC-019 | Audit auth, CSRF and rate-limit denials as security events (session id, route id, ip). Store the attempted project and entity ids in `after` (plain values, not FKs). |
| SEC-P1-12 | Low | `post-migrate.sql:57-60` (nullable-project policy), `:75-92` (org tables) | **Gaps at the DB layer only, for room-only principals** (no API path exposes them today; verified: no service reads org-level audit). Under the partner or clean-team context, `hub_app` reads all **org-level audit rows** (123: every user's logins, admin actions including created users' emails in the after-image) and the full **org user directory** (28 `app_user` rows). | C7 | REQ-SEC-006, ARCH-02/22 | Restrict `project_id IS NULL` audit reads and `app_user` reads to principals with an org role (e.g. an `app.org_reader` GUC the API sets only for org-role principals). |
| I-1 | Info | `document_version` has no `room_id` | Room-only principals get `versions: []` for their own room's document and cannot download it. This fails closed, but clean-team downloads will not work in P4. | C7 (document_version 0) | — | Add `room_id` derived from the parent document, as for `document_chunk`. |
| I-2 | Info | `portfolio.service.ts:92,408`, `identity.service.ts:102`, governance `q` filters | LIKE wildcards are not escaped (`%`/`_` match everything). Parameterised, so no injection. `documents` already uses `likePattern`. | C4 | — | Reuse `likePattern`. |
| I-3 | Info | `hub.guard.ts:115` | An upper-case UUID for `:projectId` returns 404 (case-sensitive map). Harmless. | C4 | — | Lower-case before the lookup. |
| I-4 | Info | `identity.controller.ts:31-39` | `GET /me` without the `hub_csrf` cookie rotates the session's CSRF secret: a state change on GET that invalidates other tabs' tokens. | C13 (a later POST from the same persona got 403 until re-login) | — | Rotate only on an explicit POST, or return the existing token. |
| I-5 | Info | `identity.controller.ts:26-28` | Session and CSRF cookies are persistent (`Max-Age` = absolute lifetime of 12 h), not browser-session cookies. Server-side idle expiry (60 min) mitigates this. | C8 | REQ-SEC-009 | Consider session cookies (no `Max-Age`) on shared workstations. |
| I-6 | Info | contracts: `governance.ts:157,170,239,271,315`, `portfolio.ts:44` | `z.record`/`z.unknown` response fields are not stripped by the contract interceptor. Their content is built server-side (charter, policy, quorum and tally snapshots, pack payload). | code | ARCH-18 | Tighten the schemas when those payloads stabilise. |

## 3. Verification of the P0 architecture re-review fixes (commit f1b3aa1)

All probes were run as `hub_app` on `hub_test_sec`. The context holds **both** projects in full scope (the worst case for the DB guards), and everything ran in `BEGIN … ROLLBACK` (`dbarch.sql`, `dbarch2.sql`).

| # | Item | Status | Real probe result |
|---|---|---|---|
| 1 | `project_id` / `org_id` immutability (ARCH-23) | **Verified** | UPDATE `task.project_id`→B, `document.project_id`→B, `project_membership.org_id`, `decision.project_id` → `ERROR: immutable_scope: project_id/org_id cannot change on <table>` (4/4). There are 103 `hub_scope_immutable` triggers for 103 tables with `project_id`/`org_id`. |
| 2 | Org-scoped user FKs and (org, project) FKs (ARCH-21, ARCH-15b) | **Partially verified** | `hub_opfk_*`: 91 of 91 tables with `org_id`+`project_id`. User columns: 151 org-scoped, **31 single-column only** (list in SEC-P1-06). A cross-org `project_membership`/`room_grant` is **accepted**; the same on `document.owner_user_id` is rejected by `hub_ufk_document_owner_user_id`. |
| 3 | `document.current_version_id` deferred check | **Verified** | INSERT a B document with A's version → `cross_project_reference: current version must be a version of this document`. INSERT and UPDATE with another A document's version → same error. Own version on own document → accepted. |
| 4 | DD evidence id lists | **Verified** | INSERT a B request with an A document → `cross_project_reference: document … is not a record of this project`. UPDATE an existing A request to a B document → same. Non-array → `invalid_reference_list`. Non-uuid → 22P02 (mapped to 400). Same-project document → accepted. |
| 5 | Vote binding | **Verified** | A vote by a user other than the membership's user → `vote_membership_mismatch`. A membership of another committee → `vote_membership_mismatch`. The bound member → accepted (rolled back). `UPDATE vote` → permission denied. |
| 6 | Membership and room_grant policies (ARCH-22) | **Verified** | Room-only contexts see 0 memberships and only their own grants. `INSERT room_grant` (self-grant) and `INSERT document` without a room → RLS violation (C7). |
| 7 | Audit checkpoint lockdown and scheduled job (ARCH-05) | **Verified** | `INSERT audit_checkpoint` → permission denied. `hub_audit_checkpoint(<other org>)` → `audit_checkpoint_forbidden`. Without context, `hub_audit_verify`/`hub_audit_checkpoint` → forbidden. The worker (started from this checkout) ran `platform.audit.checkpoint`: `job succeeded {"chainPos": 782}`, checkpoints 2 → 3, `next_run_at` rescheduled; `platform.delivery.reconcile` succeeded `{"markedUncertain": 0}`. |
| 8 | Service-actor binding (ARCH-05c, ARCH-16) | **Verified** | `actor_kind='service'` naming another user → `audit_actor_mismatch: a service/system audit row cannot name another user`. `'user'` mismatch → rejected. Other org → `audit_org_mismatch`. `'system'` with null actor → accepted, `created_at` server-stamped (the supplied 2001-01-01 was ignored). |
| 9 | `tx` proxy (ARCH-07) | **Verified with a residual** | A captured `tx` and `db.tx()` after commit throw `Transaction already finished…`. **Residual:** `db.query()` falls back to the pool without context (SEC-P1-09). |
| 10 | Response-contract stripping (ARCH-18) | **Verified** | Interceptor with a body carrying `tokenHash` and `nested.internal`: production → `{"id":"x","nested":{"a":1}}` plus an error log; development → the same stripped body plus a warning; test → `contract.response_mismatch` (500). Residual I-6 (record/unknown fields). |
| — | Runtime DB-role self-check (ARCH-04) | **Verified** | C11: production start as owner → `Refusing to start: runtime database role owns 104 table(s)`, exit 1. |
| — | Room-only principals, API and DB (ARCH-02) | **Verified** | C6/C7. |

## 4. Coverage of the requested items

1. **REQ-SEC-016:** CSRF enforced on every non-GET (C4). Injection: none found; all SQL is parameterised; `sort` is allowlisted or ignored (C4). Stored XSS: stored raw and rendered as text in the browser (C5). IDOR across DEMO-DC and DEMO-TRANSFORM: 404 (C3). Open items: SEC-P1-05 and SEC-P1-07 (Low) and SEC-P1-08 (Low).
2. **AT-03:** lists, counts (`total`), title and content search, activity feeds and documents are isolated both ways (C3). Within a project, the activity feed leaks restricted and room documents to auditors (SEC-P1-03).
3. **Partner room / clean team:** isolated at the API (C6) and DB (C7) layers for project data and documents. DB-only residuals are SEC-P1-12 and I-1.
4. **ARCH fixes:** §3. Nine are verified; item 2 is partial (SEC-P1-06) and item 9 has a residual (SEC-P1-09).
5. **Sessions:** idle and absolute expiry, logout, revocation on deactivation, httpOnly/SameSite/Secure, and SHA-256 token storage all hold (C8). Demo login is impossible in standard mode and rejected in production config (C9, C10). **But** demo sessions survive a mode switch (SEC-P1-02).
6. **OIDC:** PKCE S256, state, nonce and ID-token signature (`enableNonRepudiationChecks`) hold, with no auto-provisioning, redirect only after commit, and the HMAC-sealed state cookie (C12 plus the suite). **Link by email is broken (SEC-P1-01).**
7. **Audit:** hash chain and tamper detection work; append-only holds for the runtime role; TRUNCATE is blocked even for the owner; the checkpoint job runs; denied mutations are audited; no secrets appear in audit or logs (C14, C15). Gaps are in SEC-P1-11. PII is limited to user emails in the `admin.users.create` after-image and IP in `audit_event.ip` (both expected), but those rows are readable to room-only contexts at the DB layer (SEC-P1-12).
8. **Config:** production rejects the main unsafe settings and the runtime self-check works (C10, C11). Gaps are in SEC-P1-10.
9. **Secrets:** none in source (only the documented dev password), none in the client bundle, logs or audit (C14).
10. **Rate limiting and error redaction:** limits work per session and per IP (C13); problem+json responses carry no SQL or stack and logs redact query text (C13). Proxy-topology issue: SEC-P1-04.

Persistence after restart (exit criterion): the API was restarted four times against `hub_test_sec` (demo → standard → demo+trust-proxy → demo). Documents, sessions, memberships and audit rows created before each restart were served afterwards (e.g. C9, C3 fixtures reused across restarts). This was observed during the probes; it was not run as a separate test.

## 5. NOT EXECUTED

- An `email_verified=false` login. The in-process `FakeOidcIdp` always emits `email_verified: true` and was not modified. The evidence that the claim is ignored is static (`oidc.service.ts:125-126`).
- A real enterprise IdP, MFA, and an https issuer. None is configured in this environment.
- A full production boot as `hub_app`. Only the refusal path (owner role) was executed in production mode.
- The Playwright E2E suite (`pnpm test:e2e`). A targeted headless-Chromium probe was run instead (C5).
- `packages/contracts` unit tests. Only the API integration and domain suites were run.
- Multi-replica rate limiting, and ingress or TLS behaviour.
- AT-19 revocation between scheduling and execution of a worker job. No user-facing job handlers exist yet.
- AI retrieval, reports, notifications, exports and CSV/Excel formula injection. These modules are not implemented at `5d0dd09`.
- Governance business rules (quorum, recusal, self-approval, authority). They are reviewed in P2; only isolation and IDOR were probed here.

Fixture changes in `hub_test_sec` made by this review (the next test run resets it):
- probe documents in A and B, including XSS titles and indexed text versions;
- a `clean_team` room grant for `cleanteam`;
- clearance changes for `cleanteam` and `partner.alpha`;
- `approver` deactivated;
- project B's name changed and restored;
- one extra audit checkpoint.

## 6. Verdict

**FAIL.** One High finding is open: **SEC-P1-01**, account takeover through OIDC link-by-email in a configuration that production validation accepts. Per CLAUDE.md there is no PASS with an open Critical or High.

To reach PASS:
1. Fix SEC-P1-01 and add the regression test described.
2. Fix the three Mediums before the gate, or carry them as explicit conditions with owners:
   - SEC-P1-02 (demo sessions after a mode switch);
   - SEC-P1-03 (activity-feed ABAC);
   - SEC-P1-04 (rate-limit proxy topology).
3. Track the Lows. SEC-P1-06 and SEC-P1-09 should be fixed before the P2 modules copy the patterns.

The core isolation properties the P1 exit criterion depends on hold under real probes, at both the API and the DB layer:
- two isolated projects;
- 404 on cross-project ids;
- room and clean-team scoping;
- RLS with a non-owner runtime role.
