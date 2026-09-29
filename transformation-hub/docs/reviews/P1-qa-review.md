# P1 (Secure Foundation): independent QA gate review

| Item | Value |
|---|---|
| Reviewer | qa-test-engineer (subagent in its own context, following `.claude/agents/qa-test-engineer.md` and `.claude/AGENT_RULES.md`). I did not author any code under review. |
| Revision reviewed | **`5d0dd09`** ("Merge governance module (P2): committees, charters, …"), frozen detached worktree `/home/user/My-owns/.claude/worktrees/review-p1-qa/transformation-hub` (`git status`: clean before the review). |
| Revision note | The lead branch moved on during the review (HEAD `bf8e712`; CI merged in `fb1fbf0`; next.config note corrected in `bf8e712`). **Nothing after `5d0dd09` was reviewed**; findings below are stated for `5d0dd09`. |
| Databases | `hub_test_qa2` (PostgreSQL 16, shared cluster `127.0.0.1:5432`). For the database-restart test only: a private, throw-away PG 16 cluster on `127.0.0.1:5442` (`/var/lib/postgresql/qa-p1-restart`, database `hub_test_qa2r`), deleted afterwards. No other database was touched. |
| Running stack | API `node dist/main.js` on **:4102** (`HUB_MODE=demo`, `NODE_ENV=development`); web `next start` production build on **:3102** (`HUB_API_URL=http://127.0.0.1:4102` at build time); worker `node dist/worker.js` (12 s smoke run). Playwright 1.56.1, Chromium from `/opt/pw-browsers`. All processes stopped at the end. |
| Scope | Master prompt §19, P1 row: outputs "Running application, database/migrations, development identity, portfolio UI, template-based project creation, RBAC/ABAC, audit, CI"; exit "Persistence after restart, two isolated projects, denied unauthorized access, security plus QA review". Plus requirement traceability and the P0 items due at P1 (QA-06, QA-08, QA-09, R-01). |
| Date | 2026-09-29 |

**Severity scale**
- **Critical:** isolation/security bypass, or fabricated evidence that invalidates the gate.
- **High:** a P1 required output or exit criterion is missing/unverified; a P1 `must` requirement is not met or not accounted for; or a status claims verification that was not executed ("unexecuted required verification presented as successful", §19 step 6).
- **Medium:** a defect that misleads users/reviewers or will make a later AT or phase gate fail unless fixed.
- **Low:** robustness, clarity, documentation fidelity.

---

## 1. Commands run and real output (excerpts)

All commands were run in the review worktree unless stated otherwise.

### 1.1 Clean build and typecheck
```
$ pnpm -r run typecheck                      # fresh checkout, right after `pnpm install`
packages/contracts typecheck: src/common.ts(2,56): error TS2307: Cannot find module '@hub/domain' or its corresponding type declarations.
... (5 errors)
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @hub/contracts@0.1.0 typecheck: `tsc -p tsconfig.json --noEmit`   Exit status 2
$ (cd apps/api && npx tsc -p tsconfig.build.json --noEmit)   # with packages/*/dist removed (clean state)
src/cli/bootstrap.ts(3,46): error TS2307: Cannot find module '@hub/db' ...          api build EXIT=2
$ pnpm build:packages && pnpm -r run typecheck
e2e / domain / contracts / db / api / web typecheck: Done                             EXIT=0
$ pnpm -r run lint                         # = tsc --noEmit (+ i18n check for web); no ESLint, no security scan
apps/web lint: i18n check passed: 9 namespaces, 924 keys per language, 559 enum values translated in en and ar.   EXIT=0
```
→ QA-P1-08 (fresh checkout needs an undocumented `pnpm build:packages` first).

### 1.2 Unit tests
```
$ cd packages/domain && npx vitest run
 Test Files  7 passed (7)
      Tests  126 passed (126)
   per file: calendar 7/7 · documents 17/17 · governance.p2 17/17 · governance 24/24 · rules 45/45 · schedule 10/10 · policy/policy 6/6
$ cd packages/contracts && npx vitest run --passWithNoTests
No test files found, exiting with code 0
$ node packages/db/scripts/validate-templates.mjs
dc-carveout.v1.json: gates=8 workstreams=12 wbs=113 kpis=15 readinessAreas=14
general-transformation.v1.json: gates=4 workstreams=4 wbs=17 kpis=5
checks executed: 23735
PASS — all checks passed
```

### 1.3 API integration suite (real PostgreSQL, `hub_test_qa2`)
```
$ cd apps/api && TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_qa2 \
    TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_qa2 pnpm test
 Test Files  14 passed (14)
      Tests  156 passed (156)
   Duration  53.31s                                                                  EXIT=0
$ npx vitest run --reporter=json   (second run, per-file counts)
total 156 passed 156 failed 0 pending 0
  documents/at-01-historical-claims 6/6 · at-03-documents-isolation 12/12 · at-14-conflicting-evidence 7/7 · at-25-file-safety 10/10 · at-27-legal-hold 7/7
  governance/at-04-decision-outside-delegation 6/6 · at-05-quorum-recusal-self-approval 9/9 · decision-lifecycle 11/11 · governance-integrity 17/17
  p1/arch-rereview-hardening 16/16 · architecture-hardening 16/16 · isolation-and-auth 16/16 · oidc-sso 14/14 · projects-templates-audit 9/9
```

### 1.4 Web
```
$ cd apps/web && node scripts/check-i18n.mjs
i18n check passed: 9 namespaces, 924 keys per language, 559 enum values translated in en and ar.     EXIT=0
$ pnpm build            # Next.js 16.3.6 (Turbopack)
✓ Compiled successfully in 14.8s · ✓ Generating static pages (7/7) · 22 routes                         EXIT=0
$ python3 -c '…routes-manifest.json…'   → "destination": "http://127.0.0.1:4000/api/:path*"      (built without HUB_API_URL)
$ HUB_API_URL=http://127.0.0.1:4102 next start -p 3102 ; curl -i http://127.0.0.1:3102/api/v1/me
HTTP/1.1 500 Internal Server Error   … code: 'ECONNREFUSED', address: '127.0.0.1', port: 4000
$ HUB_API_URL=http://127.0.0.1:4102 pnpm build && next start -p 3102 ; curl -i …/api/v1/me
HTTP/1.1 401 Unauthorized  content-type: application/problem+json
```
→ QA-P1-09 (the README says `HUB_API_URL` is read at server start; it is fixed at build time).

### 1.5 Playwright E2E — committed suite (`e2e/tests/p1-smoke.spec.ts`)
```
$ cd e2e && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers HUB_WEB_URL=http://127.0.0.1:3102 npx playwright test
  ✓ (a) Demo Project Manager sees DEMO-DC with a Demo badge and not DEMO-TRANSFORM (1.8s)
  ✓ (b) switching to Arabic sets html[dir=rtl] and translates navigation (2.3s)
  ✓ (c) Demo PM — Project B opening the DC project URL sees the restricted state (1.8s)
  ✓ (d) Demo Portfolio Admin sees "Create project"; Demo Contributor does not (2.2s)
  ✓ (e) charter edit with a stale version gets the real 409 "reload and review" state (no data changed) (1.6s)
  ✓ (f) without a session, a project URL redirects to the login page and keeps the destination (881ms)
  6 passed (12.2s)
```
Note: the committed suite never submits the wizard (test (d) only opens `/projects/new`).

### 1.6 Playwright E2E — QA review spec (new, Appendix B: `e2e/tests/qa-p1-review.spec.ts`)
```
  ✓ 1 AT-02 (en) wizard: General Transformation project with stored XSS payloads rendered inert (3.5s)
  ✓ 2 AT-02 (ar, RTL) wizard: DC carve-out project with NewCo "incorporation in progress" stays unverified (3.7s)
  ✓ 3 portfolio (PM): Demo badge only on demo records; later-phase sections render NotImplementedYet (6.1s)
  ✓ 4 AT-03: Project-B manager cannot reach wizard-created projects via UI or API (404, no title leak) (2.0s)
  ✘ 5 wizard default classification: the creator is not dropped on "Not found" right after a successful create (17.5s)
    Error: expect(locator).toHaveCount(expected) failed   Locator: getByTestId('restricted-state')  Expected: 0  Received: 1
  1 failed · 4 passed (34.4s)
```
Test 5 is the reproduction of **QA-P1-05** and stays failing until fixed.

### 1.7 QA API spec (new, Appendix A: `apps/api/test/p1/qa-p1-sec016-injection.spec.ts`)
```
$ npx vitest run test/p1/qa-p1-sec016-injection.spec.ts
 FAIL … DEFECT QA-P1-06 … "%" and "_" in /projects?q are matched literally   AssertionError: q=%: expected 3 to be +0
 FAIL … DEFECT QA-P1-06 … "%" in /directory/users?q is matched literally       AssertionError: expected 17 to be +0
 FAIL … DEFECT QA-P1-04 … external partner persona cannot be made project manager   AssertionError: expected 201 to be greater than or equal to 400
 Test Files  1 failed (1)
      Tests  3 failed | 8 passed (11)
```
The 8 passing tests are the QA-08 evidence (SQL-looking search, `pg_sleep`, paging limits, path injection, correlation-id reflection, stored XSS round-trip, mass assignment, status via PATCH). The 3 failures reproduce QA-P1-04 and QA-P1-06.

### 1.8 Persistence after restart
```
# (a) API process restart — shared cluster, hub_test_qa2
POST /api/v1/projects (Demo Portfolio Admin, general-transformation v1, code QA-PERSIST-API) → 201
   created {"workstreams":4,"tasks":14,"milestones":3,"deliverables":13,"dependencies":23,"gates":4,"criteria":18,"kpis":5,…}
owner SQL before:  QA-PERSIST-API | ws 4 | tasks 14 | ms 3 | dl 13 | gates 4 | criteria 18 | members 1 | audit_rows 1
                   audit_total 111 | head 111 | md5(hashes by chain_pos) 381d91322fcd681fa191c78328ef8a28 | hub_audit_verify(mobily): <no broken link>
kill <api pid> → "API 7828 stopped", healthz after stop: 000 → restart → {"status":"ok"}
after restart (PM): list [ 'DEMO-DC', 'QA-PERSIST-API' ]; detail 200 phases [initiate, plan, execute, close]; activity [portfolio.project.create @16:26:10.872Z]
owner SQL after:   identical per-project counts; audit_total 112 (one new identity.login row)
                   md5 of chain_pos<=111 = 381d91322fcd681fa191c78328ef8a28 (unchanged); hub_audit_verify: <no broken link>
# DB-backed session: cookie obtained before restart → GET /me 200 after restart; stale-version PATCH with the old CSRF token → 409 concurrency.version_mismatch

# (b) PostgreSQL restart — private PG 16 cluster :5442 (fresh initdb → pg-init-roles.sh → migrate → seed-demo)
create QA-PGRESTART → 201; audit_total 102 | md5 bdb61250d180e6b844fbaeab22a98ae0 | verify: <no broken link>
kill API; pg_ctl -m fast stop → "server stopped"; pg_isready rc=2; pg_ctl start → "database system is ready to accept connections"; API restarted
after: list [ 'DEMO-DC', 'QA-PGRESTART' ]; same per-project counts (ws 4, tasks 14, ms 3, dl 13, gates 4, criteria 18, members 1, audit 1)
       md5 of chain_pos<=102 = bdb61250d180e6b844fbaeab22a98ae0 (unchanged); hub_audit_verify: <no broken link>
```
**NOT EXECUTED:** restarting the shared cluster on :5432 (another reviewer's API on :4101 and another agent's vitest run were using it); a crash (`-m immediate`) restart.

### 1.9 Isolation and denial sweeps over the whole route registry (113 routes from `@hub/contracts` `ROUTES`)
```
anon (every non-public route, real DEMO-DC ids)                     status tally {"401":108}   non-conforming: 0
Demo PM — Project B → every :projectId route on DEMO-DC (real child ids for membership, workstream,
   document, version, evidence link, source, claim, committee, meeting, agenda item, decision, action, escalation)
                                                                    status tally {"404":97}    non-conforming: 0   leaks: 0
   (each response identical in status to the same route with a random project id)
Demo Project Manager → every GET :projectId route on DEMO-TRANSFORM  status tally {"404":28}    leaks: 0
Demo Auditor → every mutation route on DEMO-DC                       {"400":2,"403":70}  (400 = self-service conflict/recusal declarations, validation after authorization)
Demo Contributor → every mutation route on DEMO-DC                   {"400":9,"403":63}  (400 = permitted upload/evidence/action commands failing validation) — no 2xx
IDOR with child ids: PM-B assigns lead / grants workstream role / revokes membership in DEMO-TRANSFORM using DEMO-DC ids → 404, 404, 404 (DC membership still active: 1)
Denied writes are audited: portfolio.updateProject | denied | "not_found: Resource not found" | correlation_id = response correlationId
RLS as hub_app: no context → 0 projects; app.project_ids = DEMO-TRANSFORM → `select code from project` = DEMO-TRANSFORM;
   DC tasks visible 0; UPDATE 0; INSERT audit_event for DC → "new row violates row-level security policy"
```

### 1.10 Authentication, CSRF, injection and XSS probes (running API)
```
create project as Demo Contributor / PM — Project B / Project Manager / Auditor / Platform Admin → 403 policy.forbidden (×5)
PATCH DC without x-csrf-token / wrong token / another session's token                              → 403 auth.csrf (×3)
logout, then reuse the revoked session cookie → 401 auth.required; forged hub_session → 401
3 MB JSON body → 413 request.too_large; malformed JSON → 400
create with extra fields status/isDemo/orgId/version → 201, stored {"status":"setup","isDemo":false,"version":1}
PATCH DC {status:"closed"} → 200 {"version":2}; status before/after: setup setup     (QA-P1-12)
PM-B /projects?q="' OR 1=1 --" | "%' OR '1'='1" | "…UNION SELECT…" → 200 total 0 no-leak; q="\\'; select pg_sleep(3); --" → 13 ms
PM-B /projects?q="%" → total 1; q="_" → total 1; PM-B /directory/users?q="%" → 17 items (every user)   (QA-P1-06)
/projects?sort="name;drop table project" | "(select 1)" | "nonexistent" → 200 (sort ignored)                (QA-P1-13)
pageSize=101 | pageSize=1000000 | page=0 | page=-1 | page=1e309 | includeDemo=maybe → 400 validation_failed
x-correlation-id "<script>…" → server returns its own UUID (not reflected)
Set-Cookie: hub_session …; HttpOnly; SameSite=Lax · hub_csrf …; SameSite=Lax (readable, double-submit) · Secure absent (dev; production config requires it)
External partner persona made PM of an internal project → 201; partner then lists it with role project_manager and can search the directory (QA-P1-04)
```

### 1.11 Development identity, worker, OpenAPI
```
HUB_MODE=standard: GET /api/v1/auth/demo-users 404 · POST /api/v1/auth/demo-login 404 · /auth/config {"demoLogin":false,"oidc":{"status":"not_configured","loginUrl":null}}
loadConfig(NODE_ENV=production, HUB_MODE=demo) → "Unsafe configuration rejected: HUB_MODE=demo is not allowed in production …"
timeout 12 node dist/worker.js → "worker worker-31107 started; handlers: system.noop, platform.audit.checkpoint, …"; job table: documents.index_version | succeeded | 4
node dist/cli/openapi.js → "OpenAPI written to openapi.json: 113 operations" (openapi 3.1.0, 95 paths; file deleted afterwards)
```

### 1.12 CI
```
$ ls /home/user/My-owns/.claude/worktrees/review-p1-qa/.github  → No such file or directory
$ git ls-tree -r --name-only HEAD | grep -iE '\.github|gitlab-ci|jenkins|azure-pipelines|\.circleci|ci\.ya?ml'  → (nothing)
```
No CI definition exists at `5d0dd09`. (`fb1fbf0`, merged after this revision, reportedly adds one; not reviewed.)

### 1.13 Visual Arabic/RTL inspection (PNG files read and inspected)
Files under `/home/user/My-owns/.claude/worktrees/review-p1-qa/transformation-hub/e2e/screenshots/`:
- `ar-portfolio-home.png`, `en-portfolio-home.png`, `en-project-overview.png` (committed suite output).
- `qa-p1/ar-wizard-1-template.png` … `ar-wizard-5-created-overview.png`, `qa-p1/en-wizard-1…5*.png`, `qa-p1/en-portfolio-pm-after-wizard.png`, `qa-p1/en-section-finance-not-implemented.png`, `qa-p1/en-wizard-default-classification-after-create.png`.

What I checked: in Arabic the header, navigation, step bar, form grid, labels, required markers, radio groups, the NewCo "unverified" note, review list and project sidebar are mirrored (start = right). "Next" chevrons point left and "Back" chevrons point right. Pagination is mirrored. The project code field stays LTR. Mixed Arabic/Latin names (`… مراكز البيانات WECFB`) keep their order through `dir="auto"`, in both the English sidebar and the Arabic heading. There is no clipping or overlap, except the transient success toast covering part of the "Open risks" card for a few seconds. `DEMO MODE` banner on every page. `Demo` badge on DEMO-DC in the card, the detail header and the sidebar, and none on user-created projects. Later-phase screens show "This screen is part of implementation phase P4 and is not implemented in this build yet. No sample or simulated data is shown here." Residual English server strings in the Arabic UI: see QA-P1-14.

---

## 2. P1 exit criteria and required outputs

| Criterion (§19 P1) | Evidence | Result |
|---|---|---|
| Running application | §1.3–1.5, §1.11: API, worker and production web build run against a migrated DB; 156/156 API, 126/126 domain, 6/6 E2E | **PASS** (fresh-checkout build needs an extra step: QA-P1-08) |
| Database / migrations | `db-reset.sh hub_test_qa2` and a brand-new PG 16 cluster: `migrations applied` + `post-migrate SQL applied (RLS, grants, triggers, audit chain)`; 99 tables with RLS, 5 infrastructure tables without it (as documented) | **PASS** |
| Development identity | §1.11: demo login only in `HUB_MODE=demo`; production+demo rejected; no passwords | **PASS** |
| Portfolio UI | E2E (a)(b)(c)(f) plus QA spec 3; RTL inspected (§1.13) | **PASS with findings** (QA-P1-07, -14, -15) |
| Template-based project creation | API: AT-02 test plus my probes (general v1 → 4 WS / 4 gates; DC v1 → 12 WS / 8 gates / 4 dimensions). Web wizard en and ar: QA spec 1–2 (201, redirect, server state verified; NewCo stays unverified) | **PASS with a defect** (QA-P1-05) |
| RBAC / ABAC | §1.9–1.10 sweeps: 0 non-conforming responses; clearance ABAC observed (internal-clearance admin cannot open confidential projects) | **PASS with a gap** (QA-P1-04, external account type not enforced) |
| Audit | Denied, rejected (409) and successful mutations audited with correlation id; chain verifies before and after both restarts; RLS blocks cross-project audit inserts | **PASS** |
| CI | §1.12: none at `5d0dd09`; REQ-DEP-022 and REQ-ARC-008 `Planned` | **FAIL** (QA-P1-01) |
| **Exit: persistence after restart** | §1.8: API restart and a full PostgreSQL stop/start (private cluster); projects, template instantiation, memberships, audit rows and sessions survive; hash-chain prefix digests unchanged; `hub_audit_verify` clean | **PASS** (shared-cluster restart and crash restart NOT EXECUTED) |
| **Exit: two isolated projects** (AT-02, AT-03) | DEMO-DC (dc-carveout) and DEMO-TRANSFORM (general-transformation); 97/97 project routes → 404 for PM-B with real ids, 28/28 for PM → DEMO-TRANSFORM, no title leaks; UI restricted state (E2E (c), QA spec 4); RLS probe | **PASS** |
| **Exit: denied unauthorized access** | 108/108 non-public routes → 401 unauthenticated; role denials 403; out-of-scope 404; CSRF 403; revoked or forged sessions 401; the UI hides "Create project" and the server still refuses it (403) | **PASS** |
| **Exit: security review** | Not part of this review (separate reviewer) | NOT EXECUTED by me |
| **Exit: QA review** | This document | **FAIL** (3 High open) |
| Requirement traceability / honest status | §5 below | **FAIL** (QA-P1-02, -03, -10) |

---

## 3. Findings

| ID | Severity | Location | Finding and reproduction | Requirement / AT | Recommendation |
|---|---|---|---|---|---|
| QA-P1-01 | **High** | repository root at `5d0dd09`; `docs/requirements/requirements.yaml` REQ-DEP-022, REQ-ARC-008 | **CI, a required P1 output, is absent.** No workflow or pipeline file exists (§1.12). `pnpm lint` is only `tsc` (plus i18n), with no ESLint, dependency/licence or security scan and no accessibility (axe) checks. The register honestly keeps REQ-DEP-022 and REQ-ARC-008 `Planned`. | §19 P1 outputs; REQ-DEP-022, REQ-ARC-008, REQ-ARC-010 | Merge the CI workflow (reportedly `fb1fbf0`). It must run `build:packages` → typecheck → domain tests → API integration against a service PostgreSQL → web build/i18n → Playwright, and show a green run on the gated revision. Record that run as the evidence. |
| QA-P1-02 | **High** | `docs/requirements/status-evidence.yaml:70`; `requirements.yaml` REQ-ARC-005; `requirements-traceability.md:307`; `apps/api/test/p1/oidc-sso.spec.ts:11,87,208` | **False "Tested" status.** REQ-ARC-005 is "Object storage and file services via adapters" (AT: "local filesystem and S3 adapters pass the same contract tests"). It is marked **Tested** with OIDC SSO evidence, which belongs to REQ-ARC-006 (P7). No storage-adapter contract test exists, and `S3CompatibleStorage` is a stub that throws `storage.not_configured` on every call. The evidence YAML is also malformed: the unquoted `:` makes the item parse as a mapping, so the matrix renders `{'P1 oidc-sso.spec.ts (in-process test IdP': 'PKCE'}`. This is verification presented as executed when it was not (§19 step 6; "never record an unexecuted test as passed"). | REQ-ARC-005, REQ-ARC-006, REQ-PHS-012 | Set REQ-ARC-005 to `Implemented` (local FS) / `Not configured` (S3). Move the OIDC evidence to REQ-ARC-006 (quoted string) and fix the test titles. Add a check to `apply_status.py` that each evidence item is a string and each cited test title exists. |
| QA-P1-03 | **High** | `requirements.yaml` (phase P1) | **34 of 82 P1 `must` requirements are `Planned` with `evidence: []` at the P1 gate, and there is no deferral record.** (a) Delivered and tested but not recorded: REQ-UX-001/004/028 (E2E (a)(b)), REQ-SRC-003…008 (AT-01/AT-14 specs, green here), REQ-ARC-007 (OpenAPI 3.1 generator works), REQ-PLT-001 (`HUB_APP_NAME`), REQ-PLT-002. (b) Genuine gaps at this revision: REQ-DEP-022 CI, REQ-ARC-008 accessibility checks, REQ-DEP-007 Docker Compose (no `deploy/` directory exists, although CLAUDE.md lists it), REQ-SEC-012 secrets management, REQ-SET-009 wizard step 1 (parties and sites are not in the wizard), REQ-ENT-009 template-upgrade preview (AT-26). (c) Gate-process items that close with the gate report: REQ-PHS-003/011/012/013. I did not assess every remaining item individually. §19 step 7 forbids scope disappearing silently. | REQ-PHS-012, REQ-PHS-013, REQ-PHS-025; §19 steps 6–7 | Before PASS, give every P1 `must` either evidence (test file plus executed run) or an explicit re-phase/deferral with owner and reason in the P1 gate report. Update the register for (a). |
| QA-P1-04 | Medium | `packages/db/src/schema/identity.ts` (`app_user` has no account type or counterparty); `portfolio.service.ts` create/grant | **External accounts can hold internal roles.** `docs/security/access-matrix.md` §2.8 says external accounts may hold only `external_partner_limited` and never see the directory. Reproduction: as Demo Portfolio Admin, `POST /api/v1/projects {classification:"internal", projectManagerUserId:<Demo Partner Alpha User>}` → 201. The partner then lists `QA-PMPARTNER2` with `myRoles:["project_manager"]`, and `GET /directory/users` → 200. Exploitation needs a privileged mis-assignment, but the documented invariant is not enforced. The failing test `DEFECT QA-P1-04` is in Appendix A. | access-matrix §2.8; REQ-SEC-003; P4 exit "partner isolation" | Model `account_type` (`internal`/`external`) plus `counterparty_id` on `app_user`. Reject internal project/org roles for external accounts in create, grant and assign-lead, and in a DB check. Fix before P4 at the latest; preferably now, since RBAC is a P1 output. |
| QA-P1-05 | Medium | `apps/web/src/app/(app)/projects/new/page.tsx:51` (default `classification: 'confidential'`), `:167` (`router.push`) | **The wizard sends the creator to "Not found" after a successful create.** The Demo Portfolio Admin has clearance `internal`. Creating a project with the wizard's default classification (`confidential`) returns 201, shows the toast "Project QA-CONF-… was created.", and then renders "Not found or you don't have access" (screenshot `qa-p1/en-wizard-default-classification-after-create.png`; failing E2E test 5). The PM can open it, so the data is correct. The core P1 creation journey is broken for the persona that owns it. | REQ-ENT-006; AT-30; REQ-SEC-003 (ABAC by clearance) | Default the classification to at most the creator's clearance, or warn on the review step and redirect to the portfolio with an explicit message. Also reconsider the demo persona's clearance. |
| QA-P1-06 | Low | `apps/api/src/modules/portfolio/portfolio.service.ts:92, :408`; `modules/identity/identity.service.ts:102` | **LIKE metacharacters are not escaped.** `%`/`_` in `q` act as wildcards: PM-B `/projects?q=%` → all visible projects, and `/directory/users?q=%` → all 17 users. The input is parameterized, so there is no SQL injection. The documents module already matches `q` literally (tested). Failing tests `DEFECT QA-P1-06` are in Appendix A. | REQ-SEC-016, REQ-DAT-015 | Reuse the documents module's escaping (`ESCAPE '\'`) for projects, directory and admin users. |
| QA-P1-07 | Medium | `portfolio.service.ts:356` (`setupState.gaps` hard-coded at creation); `apps/web/…/projects/[projectId]/page.tsx:46` | **The "Setup gaps" list on the executive cockpit is a stale snapshot.** DEMO-DC shows "Committee not configured" and "Delegation of authority not approved", yet the DB holds an **active** "DC Carve-out & JV Steering Committee (Demo)" and an **approved** authority-matrix version (seeded through the merged governance module). The same five gaps (including "Perimeter not approved") appear for general-transformation projects, which have no perimeter concept. Status shown to executives is false. | REQ-PLT-006 (honest status); §21 step 8 (gap list after validation) | Compute gaps from current records per template kind (or label them "at creation"). Add a test covering DEMO-DC after the governance seed. |
| QA-P1-08 | Medium | root `package.json`; `packages/*/package.json` (`main`/`types` → `dist/`); CLAUDE.md "Resumption procedure" | **The documented commands fail on a fresh checkout.** `pnpm typecheck` and `pnpm test` (API `tsc -p tsconfig.build.json`) fail with TS2307 until `pnpm build:packages` is run (§1.1). The CLAUDE.md resumption procedure (`pnpm install && … && pnpm test`) therefore fails, and so would a CI job that follows it. | REQ-PHS-015; REQ-DEP-022 | Add `pretest`/`pretypecheck` hooks (or TS project references/`paths`) and correct CLAUDE.md. |
| QA-P1-09 | Medium | `apps/web/next.config.ts` rewrites; `apps/web/README.md` "Configuration" | **`HUB_API_URL` is fixed at build time,** although the README says it is "Read when the server starts". A build made without it proxies `/api/*` to `127.0.0.1:4000` even when `next start` runs with `HUB_API_URL=…:4102` (500 ECONNREFUSED, §1.4). One image cannot be re-pointed per environment, and a mis-built image silently routes to an unintended backend. (`bf8e712` reportedly corrects the comment; not verified.) | REQ-ARC-015; P7 deployment | Resolve the target at runtime (e.g. a middleware proxy or a standalone server wrapper) or document it as a build argument, and fail the build or boot when it is unset outside dev. |
| QA-P1-10 | Medium | `status-evidence.yaml` (REQ-ENT-003, REQ-WS-002, REQ-DAT-009, REQ-DAT-015) | **"Tested" evidence does not exercise the stated acceptance test.** ENT-003 AT: "one entity linked to two projects" — the cited AT-02 test links one new NewCo to one project. WS-002 AT: "deliverables for every minimum-scope element" — the validator checks only ≥1 activity per workstream. DAT-009 AT: "soft-deleted task excluded from lists and totals" — the evidence is a legal-hold trigger test. DAT-015 AT: "pageSize > 100 rejected" — no committed test (the behaviour is correct: my probe and the new spec pass). | REQ-PHS-012; §22 traceability | Downgrade to `Implemented` until the specific AT runs, or add the missing tests (DAT-015: port Appendix A). |
| QA-P1-11 | Low | `docs/DELIVERY_STATUS.md`, `docs/WORK_LOG.md`, `docs/source-register.md:37-39`, CLAUDE.md | **Status documents lag the merges (under-reporting).** DELIVERY_STATUS lists "Governance, planning, gates, documents — In progress", defined as "being built in a module branch, not yet merged". Governance and documents **are merged**, with 85 integration tests green here. It also says 92 domain tests (actual 126) and 70 p1 tests (actual 71). WORK_LOG says "41 API integration tests + 92 domain unit tests". The source register still calls CLM-009 "planned … updated when the seed and the AT-01 test exist and pass"; both exist and pass. CLAUDE.md describes a `deploy/` directory that does not exist at this revision. | REQ-PHS-025, REQ-AGT-005 | Refresh at each merge; a scripted count check (P0 QA-17) would prevent drift. |
| QA-P1-12 | Low | `packages/contracts/src/portfolio.ts` (`updateProject` body non-strict) | `PATCH /projects/:id {expectedVersion, status:"closed"}` → 200 and version bumped 1→2, with status unchanged. Unknown or forbidden fields are silently stripped, and a no-op write increments the version (spurious 409s for other editors) and writes an audit row. | CLAUDE.md "No generic PATCH may change a status column" (met); REQ-DAT-005 | Use `.strict()` on command bodies (400 on unknown keys), or skip the version bump and audit when nothing changed. |
| QA-P1-13 | Low | `packages/contracts/src/common.ts:27` (`sort`), list services | `sort` is accepted (any string up to 64 characters) but ignored by `/projects` and other lists. There is no injection risk, but the API conventions promise sorting. | REQ-DAT-015 | Allow-list the sort keys per list and return 400 for unknown ones, or remove `sort` from the contract. |
| QA-P1-14 | Low | server-provided strings (gate names, dimension explanations, template names) | The Arabic UI shows English "Not yet assessed", "G0 — Mandate & Governance" and "DC Carve-out → Standalone NewCo → JV" (`qa-p1/ar-wizard-5-created-overview.png`). This is documented in `apps/web/README.md` "Known limitations". | REQ-UX-001, REQ-UX-002 | Return `{en, ar}` from the API (the templates are already bilingual; the validator checks this). |
| QA-P1-15 | Low | portfolio cards and overview "Open risks" / "Overdue actions" | "Open risks 0" is displayed although RAID (P2) is not delivered at this revision. It is a real count of an unpopulated register, but readers may take it as "no risks". | REQ-PLT-006 | Show "—" with "available when RAID is delivered", as the README does for hidden counts. |

**Observations (no severity; for the domain/security reviewers):** (1) Projects created by demo personas in the demo sandbox org are `is_demo = false`, so they get no Demo badge; confirm this against REQ-SET-005 reporting exclusion. (2) The web CSP allows `'unsafe-inline'` scripts (documented). In my tests, React escaping alone kept the stored payloads inert (§1.6 test 1).

Open counts: **Critical 0 · High 3 (QA-P1-01, -02, -03) · Medium 7 (-04, -05, -07, -08, -09, -10, and QA-08 carry-over) · Low 7 (-06, -11, -12, -13, -14, -15, QA-09 follow-up).**

---

## 4. P0 items due at P1

| ID | P0 severity | Status at `5d0dd09` | Evidence |
|---|---|---|---|
| QA-06 | Medium | **Resolved** (`734d091`) | All 10 items are now `must` (REQ-PLT-001, GOV-009, PLN-014, UX-003, RPT-011, AI-015, AI-032, ARC-009, DAT-007, DAT-011); only 5 `should` remain (AI-022, DEP-004, DEP-005, INT-003, INT-006), all legitimately optional. The prohibitions in UX-003/GOV-009 were not split out, but they are now carried by `must`. |
| QA-08 | Medium | **Open** (evidence now exists, committed tests do not) | `grep -riE "xss|<script|inject|1=1|onerror"` over `apps/api/test`, `e2e/tests` and the domain tests finds only OIDC code-injection and the documents "literal search" test. REQ-SEC-016 stays `Implemented` ("XSS/injection tests pending"), which is honest. My executed evidence (§1.6 test 1, §1.7, §1.10) shows parameterized SQL, inert stored XSS in the UI, and paging and CSRF enforcement, and it surfaced QA-P1-06. **To close:** port Appendices A and B (fixing or keeping as failing only the tests linked to QA-P1-04/-05/-06). |
| QA-09 | Medium | **Resolved** (`734d091`), **Low follow-up** | The wording is now honest ("will be represented … planned"). At `5d0dd09` the condition in that sentence is met: the seed has CLM-009 `historical_unverified`, `applied_to_record = f`, `is_demo = t`, and AT-01 passes 6/6. The line should now be updated to present tense (QA-P1-11). |
| R-01 | Medium | **Partly resolved** (`dc9e612`), **regressed** | The register now carries evidence (30 Tested / 37 Implemented) and the matrix re-renders without drift (`render_traceability.py` → no diff; "AT coverage 30/30"). New issues: a false Tested (QA-P1-02), Tested with non-matching evidence (QA-P1-10), P1 `must` items unaccounted for (QA-P1-03), and DELIVERY_STATUS/WORK_LOG drift (QA-P1-11). |

---

## 5. Traceability check: every "Tested" status (30, all phase P1)

Method: for each requirement I opened the cited evidence, confirmed that the file and test title exist, and matched it against my executed runs (§1.2–1.3). I then compared the test's assertions with the requirement's `acceptance_tests`.

| Requirement(s) | Cited evidence exists and ran green here | Exercises the stated AT |
|---|---|---|
| ENT-001, ENT-005, ENT-006, ENT-011, WS-001, WS-004, WS-005, WS-006, WS-007, ARC-002, ARC-003, ARC-014, DAT-002, DAT-003 (`rules.test.ts` "AT-29"), DAT-005, DAT-006, DAT-008, DAT-017, SEC-001 (`policy.test.ts`), SEC-002, SEC-003, SEC-006, SEC-009, SET-001, SET-003 | Yes | Yes |
| ENT-003 | Yes | **No**: one project only (QA-P1-10) |
| WS-002 | Yes (validator PASS, 23 735 checks; not part of `pnpm test`) | **Partially**: minimum-scope coverage is not checked (QA-P1-10) |
| DAT-009 | Yes | **Partially**: documents trigger, not soft-deleted-task list exclusion (QA-P1-10) |
| DAT-015 | "P1 list tests (pagination)": no test asserts the limit | **No** committed test; behaviour correct per my probe (QA-P1-10) |
| ARC-005 | The cited test exists and is green but belongs to another requirement | **No**: false Tested (QA-P1-02) |

---

## 6. Verdict

**FAIL at revision `5d0dd09`.**

The core P1 behaviour holds up under real execution:
- Persistence across API and PostgreSQL restarts, with an intact audit hash chain.
- Two template-based projects isolated at the API (0 non-conforming responses over the full 113-route registry), the UI and RLS.
- Unauthenticated, out-of-scope and under-privileged access denied and audited.
- Wizard creation in Arabic (RTL) and English.
- SQL and XSS payloads handled as data.

The gate still cannot pass while these three High findings are open:
1. **QA-P1-01:** CI, a required P1 output, is absent.
2. **QA-P1-02:** a requirement is recorded as Tested on evidence that belongs to a different requirement.
3. **QA-P1-03:** 34 P1 `must` requirements are neither evidenced nor formally deferred.

Also required: the P0 carry-over QA-08 must be closed with committed tests, and the independent security review is still outstanding.

**To reach PASS:**
- Merge and demonstrate a green CI run on the gated revision (it should include the `build:packages` fix, QA-P1-08).
- Correct REQ-ARC-005/006 and the evidence format.
- Evidence or formally re-phase every P1 `must`.
- Port Appendices A and B.
- Fix or explicitly accept (with owner) QA-P1-04, -05, -07, -09, -10.
- Then re-run §1.3, §1.5–1.7 on the new revision.

---

## 7. Files written by this review and environment cleanup

- This report: `/home/user/My-owns/transformation-hub/docs/reviews/P1-qa-review.md`.
- New tests in the **review worktree only**, for the lead to port (full content below):
  - `/home/user/My-owns/.claude/worktrees/review-p1-qa/transformation-hub/apps/api/test/p1/qa-p1-sec016-injection.spec.ts`
  - `/home/user/My-owns/.claude/worktrees/review-p1-qa/transformation-hub/e2e/tests/qa-p1-review.spec.ts`
  - Screenshots: `/home/user/My-owns/.claude/worktrees/review-p1-qa/transformation-hub/e2e/screenshots/qa-p1/*.png` (13 files)
- Cleanup:
  - API (:4102) and web (:3102) processes stopped; no listener remains on 3102/4102.
  - The worker ran under `timeout`.
  - The private PG cluster `/var/lib/postgresql/qa-p1-restart` was stopped and deleted.
  - The generated `apps/api/openapi.json` was deleted.
  - `hub_test_qa2` was left in its post-test state.

---

## Appendix A: `apps/api/test/p1/qa-p1-sec016-injection.spec.ts`

Result on `5d0dd09`: 8 passed, 3 failed (the 3 failures are QA-P1-04 and QA-P1-06, and must stay failing until fixed).

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, demoUserId, getApp, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import request from 'supertest';

/**
 * Independent QA — P1 gate review (revision 5d0dd09).
 * QA-08 carry-over: REQ-SEC-016 names XSS and injection, but no committed test exercised them.
 * Tests marked "DEFECT QA-P1-xx" reproduce findings of docs/reviews/P1-qa-review.md and are expected to FAIL
 * until fixed (do not loosen them; the review links each to its finding).
 */
let dcId: string;
let admin: Client;
let pm: Client;
let pmB: Client;
let genTemplateId: string;
let pmUserId: string;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  pmB = await loginAs('pm.b');
  pmUserId = pm.userId;
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  genTemplateId = templates.find((t) => t.templateKey === 'general-transformation')!.id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-SEC-016 / QA-08 — injection payloads in list, search and paging parameters are data, never SQL [REQ-SEC-016, REQ-DAT-015, AT-03]', () => {
  it('SQL-looking search input matches nothing and leaks nothing across projects', async () => {
    for (const q of ["' OR 1=1 --", "%' OR '1'='1", "DEMO-DC' UNION SELECT name FROM project --"]) {
      const r = await pmB.get(`/api/v1/projects?q=${encodeURIComponent(q)}`).expect(200);
      expect(r.body.total).toBe(0);
      expect(JSON.stringify(r.body)).not.toMatch(/DEMO-DC|Carve-out/);
    }
  });

  it('a pg_sleep payload is not executed', async () => {
    const t0 = Date.now();
    await pm.get(`/api/v1/projects?q=${encodeURIComponent("x'; select pg_sleep(3); --")}`).expect(200);
    expect(Date.now() - t0).toBeLessThan(2500);
  });

  it('REQ-DAT-015: pageSize > 100, page < 1 and non-numeric paging are rejected with 400 problem+json', async () => {
    for (const qs of ['pageSize=101', 'pageSize=1000000', 'page=0', 'page=-1', 'page=1e309']) {
      const r = await pm.get(`/api/v1/projects?${qs}`);
      expect(r.status, qs).toBe(400);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });

  it('path-parameter injection is a plain 404', async () => {
    for (const pid of ["' OR 1=1 --", '..%2F..%2Fadmin', '1']) {
      await pmB.get(`/api/v1/projects/${encodeURIComponent(pid)}`).expect(404);
    }
  });

  it('a client-supplied x-correlation-id is not reflected (no header/log injection)', async () => {
    const app = await getApp();
    const r = await request(app.getHttpServer()).get('/api/v1/auth/config').set('x-correlation-id', '<script>alert(1)</script>');
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('REQ-SEC-016 / QA-08 — stored XSS payloads are persisted verbatim and served as JSON data [REQ-SEC-016]', () => {
  it('HTML/script in project fields round-trips as an inert JSON string (web rendering: e2e qa-p1-review.spec.ts)', async () => {
    const name = 'QA <img src=x onerror="alert(1)"> <script>alert(2)</script>';
    const description = '"><svg onload=alert(3)></svg> javascript:alert(4)';
    const c = await admin.post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-SEC016-XSS', name, description, classification: 'internal', projectManagerUserId: pmUserId }).expect(201);
    const d = await pm.get(`/api/v1/projects/${c.body.id}`).expect(200);
    expect(d.headers['content-type']).toMatch(/application\/json/);
    expect(d.body.name).toBe(name);
    expect(d.body.description).toBe(description);
  });

  it('mass assignment: status, isDemo, orgId and version in the create body are ignored', async () => {
    const c = await admin
      .post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-SEC016-MASS', name: 'mass', projectManagerUserId: pmUserId, status: 'active', isDemo: true, orgId: '01a0ee00-0000-7000-8000-000000000009', version: 99 })
      .expect(201);
    const row = (await owner().query('select status, is_demo, version, org_id = (select org_id from project where code = $2) as same_org from project where id = $1', [c.body.id, DC])).rows[0];
    expect(row).toEqual({ status: 'setup', is_demo: false, version: 1, same_org: true });
  });

  it('a PATCH cannot change the project status column', async () => {
    const before = (await pm.get(`/api/v1/projects/${dcId}`).expect(200)).body;
    await pm.patch(`/api/v1/projects/${dcId}`, { expectedVersion: before.version, status: 'closed' });
    const after = (await pm.get(`/api/v1/projects/${dcId}`).expect(200)).body;
    expect(after.status).toBe(before.status);
  });
});

describe('DEFECT QA-P1-06 — LIKE metacharacters in project and directory search are not escaped [REQ-SEC-016, REQ-DAT-015]', () => {
  // The documents module already matches "%" literally (at-03-documents-isolation.spec.ts "title search ... literal").
  it('"%" and "_" in /projects?q are matched literally (no project code or name contains them)', async () => {
    for (const q of ['%', '_']) {
      const r = await pm.get(`/api/v1/projects?q=${encodeURIComponent(q)}`).expect(200);
      expect(r.body.total, `q=${q}`).toBe(0);
    }
  });

  it('"%" in /directory/users?q is matched literally (no enumeration of every user)', async () => {
    const r = await pm.get(`/api/v1/directory/users?q=${encodeURIComponent('%')}`).expect(200);
    expect(r.body.items.length).toBe(0);
  });
});

describe('DEFECT QA-P1-04 — external partner accounts cannot hold internal project roles [docs/security/access-matrix.md §2.8, REQ-SEC-003]', () => {
  it('the external partner persona cannot be made project manager of a new project', async () => {
    const partnerId = await demoUserId('partner.alpha');
    const r = await admin.post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-P1-04-EXT', name: 'external PM probe', classification: 'internal', projectManagerUserId: partnerId });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});
```

## Appendix B: `e2e/tests/qa-p1-review.spec.ts`

Result on `5d0dd09` against API :4102 / web :3102: 4 passed, 1 failed (test 5 is QA-P1-05 and must stay failing until fixed). Run it with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers HUB_WEB_URL=http://127.0.0.1:<port> npx playwright test tests/qa-p1-review.spec.ts`. It creates projects with a per-run suffix, so it can be re-run against the same database.

```ts
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs, setSavedLocale, watchConsole } from './helpers';

/**
 * Independent QA (P1 gate review) — web wizard journeys and UI-bypass checks against the REAL API.
 * Scenario / requirement IDs: AT-02, AT-03, REQ-ENT-005, REQ-ENT-006, REQ-SEC-016 (XSS), REQ-UX-001, REQ-UX-004,
 * REQ-UX-028, REQ-PLT-006 (honest NotImplementedYet).
 * Needs: API in DEMO mode + seeded demo sandbox; web at HUB_WEB_URL. Creates projects with a per-run suffix.
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'qa-p1');
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const XSS_NAME = `QA XSS <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> ${RUN}`;
const XSS_DESC = `"><svg onload="window.__xss=3"></svg> javascript:alert(1) {{7*7}} \${7*7}`;
const AR_NAME = `مشروع ضمان الجودة التجريبي — مراكز البيانات ${RUN}`;

function trackXss(page: Page) {
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  return async () => ({
    dialogs,
    flag: await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null),
    injectedImg: await page.locator('img[src="x"]').count(),
    injectedSvg: await page.locator('svg[onload]').count(),
  });
}

async function pickPm(page: Page, query: string, name: string) {
  const box = page.getByRole('combobox');
  await box.fill(query);
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
}

test.describe.configure({ mode: 'serial' });

test.describe('QA P1 review — AT-02 wizard creation (en/ar), AT-03 isolation, REQ-SEC-016 XSS, REQ-UX-001/004/028', () => {
  let xssProjectId = '';
  let arProjectId = '';
  let confidentialProjectId = '';

  test('AT-02 (en) wizard: General Transformation project with stored XSS payloads rendered inert [REQ-ENT-005, REQ-ENT-006, REQ-SEC-016]', async ({ page }) => {
    const xss = trackXss(page);
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.portfolioAdmin);
    await setSavedLocale(page, 'en');
    await page.reload();
    await page.getByTestId('create-project').click();
    await expect(page).toHaveURL(/\/projects\/new$/);

    await page.getByRole('radio', { name: /General Transformation/ }).check();
    await page.screenshot({ path: join(SHOTS, 'en-wizard-1-template.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel(/^Project code/).fill(`QA-XSS-${RUN}`);
    await page.getByLabel(/^Name/).fill(XSS_NAME);
    await page.getByLabel(/^Description/).fill(XSS_DESC);
    await page.getByLabel(/^Objective/).fill('Arabic in an English field: هدف تجريبي');
    await page.getByLabel(/^Classification/).selectOption('internal');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-2-details.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next' }).click();

    await pickPm(page, 'Demo Project', 'Demo Project Manager');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-3-people.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(XSS_NAME)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'en-wizard-4-review.png'), fullPage: true });

    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST');
    await page.getByTestId('create-submit').click();
    const res = await created;
    expect(res.status()).toBe(201);
    xssProjectId = (await res.json()).id;
    await page.waitForURL(new RegExp(`/projects/${xssProjectId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('<img src=x onerror=');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-5-created-overview.png'), fullPage: true });

    await page.goto(`/projects/${xssProjectId}/charter`);
    await expect(page.getByText(XSS_DESC)).toBeVisible();
    await page.goto('/');
    await expect(page.locator(`[data-project-code="QA-XSS-${RUN}"]`)).toBeVisible();
    const r = await xss();
    expect(r, JSON.stringify(r)).toEqual({ dialogs: [], flag: null, injectedImg: 0, injectedSvg: 0 });
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('AT-02 (ar, RTL) wizard: DC carve-out project with NewCo "incorporation in progress" stays unverified [REQ-ENT-001, REQ-ENT-003, REQ-UX-001]', async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    await loginAs(page, PERSONAS.portfolioAdmin);
    await setSavedLocale(page, 'ar');
    try {
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.getByTestId('create-project').click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.getByRole('radio', { name: /DC Carve-out/ }).check();
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-1-template.png'), fullPage: true });
      await page.getByRole('button', { name: 'التالي' }).click();

      await page.getByLabel(/^رمز المشروع/).fill(`QA-AR-${RUN}`);
      await page.getByLabel(/^الاسم/).fill(AR_NAME);
      await page.getByLabel(/^التصنيف/).selectOption('internal');
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-2-details.png'), fullPage: true });
      await page.getByRole('button', { name: 'التالي' }).click();

      await pickPm(page, 'Demo Project', 'Demo Project Manager');
      await page.locator('input[name="newcoMode"]').nth(1).check();
      await page.getByLabel(/^اسم الشركة الجديدة/).fill('شركة تجريبية جديدة (Demo)');
      await page.locator('input[name="newcoStatus"]').nth(1).check(); // incorporation_in_progress
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-3-people.png'), fullPage: true });
      await page.getByRole('button', { name: 'التالي' }).click();
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-4-review.png'), fullPage: true });

      const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST');
      await page.getByTestId('create-submit').click();
      const res = await created;
      expect(res.status()).toBe(201);
      const body = await res.json();
      arProjectId = body.id;
      expect(body.created).toMatchObject({ workstreams: 12, gates: 8, statusDimensions: 4 });
      await page.waitForURL(new RegExp(`/projects/${arProjectId}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(AR_NAME);
      await page.screenshot({ path: join(SHOTS, 'ar-wizard-5-created-overview.png'), fullPage: true });

      // Server truth: the PM sees the project with its own template, and the NewCo is NOT verified.
      const pm = await apiSessionAs(baseURL!, PERSONAS.pm);
      const detail = await (await pm.get(`/api/v1/projects/${arProjectId}`)).json();
      expect(detail.templateKey).toBe('dc-carveout');
      expect(detail.entities).toEqual([expect.objectContaining({ incorporationStatus: 'incorporation_in_progress' })]);
      expect(detail.entities[0].verification).not.toBe('confirmed');
      await pm.dispose();
    } finally {
      await setSavedLocale(page, 'en');
    }
    expect(problems(), problems().join('\n')).toEqual([]);
  });

  test('portfolio (PM): Demo badge only on demo records; later-phase sections render NotImplementedYet, never sample data [REQ-UX-004, REQ-UX-028, REQ-PLT-006]', async ({ page }) => {
    const xss = trackXss(page);
    await loginAs(page, PERSONAS.pm);
    await expect(page.locator('[data-project-code="DEMO-DC"]').getByTestId('demo-badge')).toBeVisible();
    const mine = page.locator(`[data-project-code="QA-AR-${RUN}"]`);
    await expect(mine).toBeVisible();
    await expect(mine.getByTestId('demo-badge')).toHaveCount(0);
    await expect(page.locator(`[data-project-code="QA-XSS-${RUN}"]`)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'en-portfolio-pm-after-wizard.png'), fullPage: true });

    for (const seg of ['committee', 'plan', 'raid', 'perimeter', 'newco', 'readiness', 'finance', 'jv', 'documents', 'ai', 'reports']) {
      await page.goto(`/projects/${arProjectId}/${seg}`);
      await expect(page.getByTestId('not-implemented'), `section ${seg}`).toBeVisible();
      await expect(page.locator('table'), `section ${seg} has no data table`).toHaveCount(0);
    }
    await page.goto(`/projects/${arProjectId}/finance`);
    await page.screenshot({ path: join(SHOTS, 'en-section-finance-not-implemented.png'), fullPage: true });
    const r = await xss();
    expect(r.flag).toBeNull();
    expect(r.dialogs).toEqual([]);
  });

  test('AT-03: Project-B manager cannot reach wizard-created projects via UI or API (404, no title leak)', async ({ page, baseURL }) => {
    const pmb = await apiSessionAs(baseURL!, PERSONAS.pmB);
    for (const id of [xssProjectId, arProjectId]) {
      for (const p of [`/api/v1/projects/${id}`, `/api/v1/projects/${id}/workstreams`, `/api/v1/projects/${id}/members`, `/api/v1/projects/${id}/activity`]) {
        const r = await pmb.get(p);
        expect(r.status(), p).toBe(404);
        const text = await r.text();
        expect(text).not.toContain(RUN);
      }
    }
    const list = await (await pmb.get(`/api/v1/projects?q=${RUN}`)).json();
    expect(list.total).toBe(0);
    await pmb.dispose();

    await loginAs(page, PERSONAS.pmB);
    for (const id of [xssProjectId, arProjectId]) {
      await page.goto(`/projects/${id}`);
      await expect(page.getByTestId('restricted-state')).toBeVisible();
      await expect(page.getByText(RUN)).toHaveCount(0);
    }
  });

  test('wizard default classification: the creator is not dropped on "Not found" right after a successful create [REQ-ENT-006, AT-30]', async ({ page }) => {
    await loginAs(page, PERSONAS.portfolioAdmin);
    await page.getByTestId('create-project').click();
    await page.getByRole('radio', { name: /General Transformation/ }).check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/^Project code/).fill(`QA-CONF-${RUN}`);
    await page.getByLabel(/^Name/).fill(`QA default classification ${RUN}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await pickPm(page, 'Demo Project', 'Demo Project Manager');
    await page.getByRole('button', { name: 'Next' }).click();
    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST');
    await page.getByTestId('create-submit').click();
    const res = await created;
    expect(res.status()).toBe(201);
    confidentialProjectId = (await res.json()).id;
    await page.waitForURL(new RegExp(`/projects/${confidentialProjectId}$`));
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: join(SHOTS, 'en-wizard-default-classification-after-create.png'), fullPage: true });
    // Defect check (QA-P1-05): the Demo Portfolio Admin (clearance internal) creates a project with the wizard's
    // default classification (confidential) and is redirected to a page that says the project does not exist.
    await expect(page.getByTestId('restricted-state')).toHaveCount(0);
  });
});
```
