# P1 (Secure Foundation): independent QA re-review

| Item | Value |
|---|---|
| Reviewer | qa-test-engineer (subagent in its own context, following `.claude/agents/qa-test-engineer.md` and `.claude/AGENT_RULES.md`). I did not author any code under review. I wrote only the test and review files listed in §8. |
| Revision reviewed | **`c1338f74215a1cb23d8e4dc52e80c50aa2d08b14`** (`c1338f7`, "P2 lead follow-ups: dependency guards, prerequisite history, G1 rule for perimeter approval"), frozen in worktree `agent-ad3dcc0fab696f14c`. `git status` was clean before the review. This is 157 commits after my first review at `5d0dd09` (578 files, +103 087 / −3 762 lines). |
| Revision note | Findings are stated for `c1338f7`. Two later commits are referenced **only in clearly labelled addenda** (§1.10, §1.11), at the lead's request: `d508929` (gitleaks allow-list) and the CI runs of `124f3d8`/`f136c42`. `124f3d8` differs from `c1338f7` only in docs, `packages/db/src/cli/data-dictionary.ts` and `scripts/ops/gitleaks.toml` (`git diff --stat c1338f7 124f3d8`), so its CI e2e result applies to the reviewed application code. |
| Databases | Shared cluster `127.0.0.1:5432`: `hub_test_qa3` and `hub_test_qa3_boot` only (API integration suite). Private, throw-away PostgreSQL 16 cluster on `127.0.0.1:5443` (`/var/lib/postgresql/qa-p1r-restart`, trust auth, localhost only): `hub_e2e_qa3` and `hub_e2e_qa3b` for the running stack, the restart check and the sweeps. It was deleted at the end. No other agent's database or process was touched. The shared cluster was never restarted. |
| Running stack | API `node dist/main.js` on **:4133** (`HUB_MODE=demo`, `NODE_ENV=development`, `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`). Worker `node dist/worker.js`. Web: production build (`HUB_API_URL=http://127.0.0.1:4133` at build time, `NODE_ENV` unset), `next start -p 3133`. Playwright 1.56.1, Chromium from `/opt/pw-browsers`. Every process was stopped by PID after its command line was checked (§8). |
| Scope | Re-verify QA-P1-01…15 and the P0 carry-overs QA-08, QA-09 and R-01. Re-check the P1 exit criteria and required outputs (master prompt §19). Traceability of the P1 `Tested` claims and honesty of `docs/phases/P1-must-disposition.md`. Arabic/RTL on the portfolio, the creation wizard and the project home. |
| Date | 2026-09-30 |

**Severity scale** (unchanged from the first review)
- **Critical:** isolation or security bypass, or fabricated evidence that invalidates the gate.
- **High:** a P1 required output or exit criterion is missing or unverified; a P1 `must` is not met or not accounted for; or a status claims verification that was not executed.
- **Medium:** a defect that misleads users or reviewers, or will make a later AT or phase gate fail unless fixed.
- **Low:** robustness, clarity, documentation fidelity.

---

## 1. Commands run and real output (excerpts)

All commands ran in the review worktree (`transformation-hub/`) unless stated otherwise.

### 1.1 Fresh checkout: install, typecheck, lint (QA-P1-08)
The worktree had no `node_modules`, `packages/*/dist`, `apps/*/dist` or `.next` at the start.
```
$ pnpm install --frozen-lockfile        → Lockfile is up to date … Done in 3.4s                               EXIT=0
$ pnpm typecheck                        → e2e / domain / db / contracts / web / api typecheck: Done  (1m25s)   EXIT=0
$ pnpm lint                             EXIT=0 (1m07s)
  apps/web lint: i18n check passed: 16 namespaces, 3835 keys per language, 563 enum values translated in en and ar, 42 server message codes.
  apps/web lint: Hard-coded UI string check passed (self-test: 6 fixture violations detected): src/app, src/components scanned; no JSX text or visible attribute literals outside i18n.
```

### 1.2 Unit tests
```
$ pnpm test:unit
packages/domain test:     Test Files 17 passed (17)   Tests 348 passed (348)
packages/contracts test:  Test Files  2 passed (2)    Tests 100 passed (100)                              EXIT=0
```
`grep -rnE "\b(it|test|describe)\.(fails|skip|todo|only…)"` over `apps/api/test`, `packages/*/src` and `e2e/tests` found no expected-fail, skipped or todo test. The only match is a data-dependent `test.skip` in `e2e/tests/p2-gates.spec.ts:106`. So "all passed" really means every test ran and passed.

### 1.3 API integration suite (real PostgreSQL, own database)
```
$ HUB_DATABASES="hub_test_qa3 hub_test_qa3_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_qa3 hub_test_qa3_boot
$ TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_qa3 TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@…/hub_test_qa3 pnpm --filter @hub/api test
 Test Files  78 passed (78)
      Tests  691 passed (691)
   Duration  657.04s                                                                                   EXIT=0
```
I then ran a verbose re-run of the P1 folder and of every other spec cited as P1 evidence, to get per-test proof for §5:
```
$ vitest run test/p1 test/documents/{storage-contract,at-27-legal-hold,at-01-historical-claims,at-25-file-safety}.spec.ts \
    test/planning/{at-16-baseline-concurrency,acceptance-and-access}.spec.ts test/ai/{ai-settings-ops,at-22-ai-egress,at-28-ai-evidence}.spec.ts --reporter=verbose
 Test Files  24 passed (24)      Tests  255 passed (255)      Duration 333.62s                         EXIT=0
 per file: p1/arch-rereview-hardening 20 · architecture-hardening 16 · isolation-and-auth 16 · oidc-sso 19 · p1-closure 15 ·
   p1-closure-contracts 3 · p1-closure-empty-db 3 · p1-closure-worker 2 · projects-templates-audit 9 · qa-p1-13-list-sort 6 ·
   qa-p1-14-bilingual 7 · qa-p1-sec016-injection 14 · sec-p1r-fixes 25 · security-p1-fixes 9 · traceability-p1 2 (p1 total 166) ·
   documents/storage-contract 21 · at-27 7 · at-01 6 · at-25 11 · planning/at-16 5 · acceptance-and-access 11 · ai/settings-ops 9 · at-22 5 · at-28 14
```

### 1.4 Web production build
```
$ HUB_API_URL=http://127.0.0.1:4133 NEXT_TELEMETRY_DISABLED=1 pnpm --filter @hub/web build     (NODE_ENV unset)
✓ Compiled successfully in 52s · ✓ Generating static pages (7/7)                                       EXIT=0
$ .next/routes-manifest.json rewrites → ['http://127.0.0.1:4133/api/:path*']
$ next start -p 3133 ; curl http://127.0.0.1:3133/login → 200 ; curl -i http://127.0.0.1:3133/api/v1/me → HTTP/1.1 401 Unauthorized
```

### 1.5 Playwright E2E against the running stack
```
$ PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers HUB_WEB_URL=http://127.0.0.1:3133 playwright test tests/p1-smoke.spec.ts tests/p1-closure.spec.ts tests/qa-p1-review.spec.ts
  ✓ p1-closure UX-028: Demo badge on list, detail view and a demo record detail; a non-demo project shows none (6.8s)
  ✓ p1-smoke (a) … (f)  — 6 tests
  ✓ qa-p1-review 1 AT-02 (en) wizard, stored XSS rendered inert · 2 AT-02 (ar, RTL) wizard, NewCo stays unverified ·
    3 portfolio Demo badge / later-phase sections · 4 AT-03 PM-B cannot reach wizard-created projects (404, no title leak) ·
    5 wizard default classification: the creator is not dropped on "Not found" after a successful create
  12 passed (1.1m)                                                                                     EXIT=0
$ playwright test tests/a11y.spec.ts
  118 passed (7.7m)   (57 screen states × en/ar with axe-core WCAG 2.1 A/AA, plus 4 keyboard checks)     EXIT=0
  regenerated docs/test-evidence/a11y-report.md: "Gating result (serious/critical WCAG violations): PASS — 0" (restored to the committed version afterwards)
$ playwright test tests/qa-p1r-arabic-rtl.spec.ts --repeat-each=2        (new QA spec, §1.12)
  6 passed (1.4m)                                                                                      EXIT=0
```
Test 5 of `qa-p1-review` reproduced QA-P1-05 at `5d0dd09`. It is unchanged and now passes.

### 1.5a Full committed Playwright suite (all specs, as the CI e2e job runs it), freshly seeded database `hub_e2e_qa3b`
```
$ playwright test --grep-invert "QA P1 re-review"      (every committed spec; my new spec excluded to mirror CI)
Running 149 tests using 1 worker
  ✘ 139 tests/p3-carveout.spec.ts:72 › P3 carve-out & NewCo › (a) AT-07: an addition after baseline is held Pending with an
        impact assessment and enters scope only once its change request is approved and applied (28.3s)
    Error: expect(locator).toBeHidden() failed — Locator: getByRole('dialog', { name: 'Approve change' }) — Received: visible
  1 failed · 3 did not run (p3-carveout (b)(c)(d), serial describe after the failure) · 145 passed (15.3m)      EXIT=1
```
All P1, P2, a11y and p3-readiness tests passed. The failure screenshot (`e2e/screenshots/qa-p1r/en-p3-carveout-at07-approve-refused-c1338f7.png`) shows the Demo Sponsor approving CR-008 ("Perimeter addition PI-006 after baseline"). The approval is refused with: "The request breaks a business rule — The cost impact of this change request is stated as text only (impacts.cost) and has no amount — the delegated limit for "change_request_budget" cannot be checked; record the monetary impact as an amount with currency and unit (0 when none), or link a final governance decision".

The P2 authority rule (DOM-P2-03) now blocks the P3 AT-07 UI journey as the spec drives it. This is the regression the lead records as F-13 (§1.11). It is outside P1 scope, but it keeps the CI e2e job red for this application code (QA-P1R-01).

### 1.6 Persistence after restart: API, worker **and PostgreSQL** (P1 exit criterion)
Run on the private cluster `:5443`, database `hub_e2e_qa3`, after the P1 E2E specs had created projects through the wizard in English and Arabic.
```
before: node api-snap.mjs login   → demo PM session (cookie kept in a file)
        api view (same session): /me 200 · 12 projects visible · details, activity totals, risks
        db snapshot (owner): 13 projects · 107 tables with project_id · 7 500 project-scoped rows
        audit org mobily: rows 5024 · head 5024 · md5(hashes by chain_pos) a96749f00a580db3ec334248d72698ca · hub_audit_verify: 0 problems
        postmaster start 2026-09-30 10:52:45
kill -TERM 12656 (worker: "worker stopping") 12640 (API) → readyz 000
pgpriv.sh stop → "server stopped"; pg_isready -p 5443 → no response (rc=2); pgpriv.sh start → "server started"
new API 23534, new worker 23557 → readyz {"status":"ready"}
after:  same session cookie → /me 200; same 12 projects; api view identical to before (True)
        db: projects identical (True); per-project table count differences: []  (7 500 rows, 13 projects × 107 tables)
        audit: rows 5024 · digest a96749f00a580db3ec334248d72698ca (unchanged) · hub_audit_verify: 0 problems · sessions 96 = 96
        postmaster start 2026-09-30 11:31:08
QA-AR-ZR7XH (created through the Arabic wizard): dc-carveout; entity incorporation_in_progress / verification proposed;
        workstream 12 · task 102 · milestone 11 · deliverable 99 · dependency 212 · gate_definition 8 · gate_criterion 64 ·
        readiness_check 31 · kpi 15 · status_dimension 4 · project_membership 1 · audit_event 1 — identical after the restart
```
The automated P1 test `p1-closure-worker.spec.ts` "a record written before the restarts reads back identically…" (API and worker restart) also passed (§1.3).

**Worker before bootstrap** (claim: "worker waits for the organization"). Freshly migrated database `hub_e2e_qa3c`, no organisation:
```
$ HUB_MODE=standard timeout 15 node dist/worker.js
LOG  worker qa-p1r-emptydb started; handlers: system.noop, platform.audit.checkpoint, …
WARN waiting for the organization before creating platform schedules: Organization "mobily" not found — run the bootstrap or demo seed
LOG  worker stopping                                      exit=124 (still running after 15 s; stopped by timeout, no crash loop)
```

### 1.7 Denial and isolation sweep over the whole contract registry (504 routes, 487 project-scoped)
Script: `sweep.mjs` (scratchpad). It uses real DEMO-DC and DEMO-TRANSFORM ids, random UUIDs for child ids, the first enum value for enum parameters, and `{}` bodies with a valid CSRF token for mutations. To stay within the per-session limit of 120 mutations per minute without changing the configuration, it signs in again every 100 calls.
```
anonymous → every non-public route                    n=499  {"401":499}   non-conforming (not 401 problem+json) 0
PM — Project B → every :projectId route of DEMO-DC   n=487  {"404":487}   same status as for a random project id: 487/487 · title/code leaks 0
Project Manager → every :projectId route of DEMO-TRANSFORM
                                                      n=487  {"404":487}   same as random project: 487/487 · leaks 0
Platform Admin → every :projectId route of DEMO-DC   n=487  {"404":487}   (infrastructure admin sees no project content, REQ-SEC-002)
Contributor — Project B → every :projectId route of DEMO-DC
                                                      n=487  {"404":487}
Partner Alpha (external, room-scoped in DEMO-DC)     n=487  {"403":481,"404":3,"400":2,"200":1}
      200 = GET …/partner-access/rooms (own rooms); 400 = DD request creates (permitted, then validation)
Auditor → every mutation route of DEMO-DC             n=347  {"403":342,"400":4,"404":1}   2xx: 0
      400/404 only on permitted self-service or compute commands (conflict declaration, recusal, delay-impact what-if,
      finance aggregate, model check)
Contributor → every mutation route of DEMO-DC         n=347  {"403":295,"400":49,"404":1,"201":2}
      201: POST …/ai/briefings (own briefing subscription, permitted) and POST …/readiness-checks/from-template
      (audited "readiness.check.instantiate", created 0 — see observation O-3)
```
At `5d0dd09` the registry had 113 routes. The sweep now covers 504, with 0 non-conforming responses for anonymous, cross-project and platform-admin callers.

### 1.8 Live probes on the running API (QA-P1-04, -05, -06, -07, -12, -13)
```
QA-P1-13  /projects?sort="name;drop table project" | "(select 1)" | "nonexistent" → 400 validation_failed (×3)
          sort=name → DEMO-DC, P1C-UX028…, QA-CONF…, QA-RTL…, QA-XSS…, then the Arabic-named QA-AR… (ICU und-x-icu); -name is the exact reverse
QA-P1-06  PM-B /projects?q=% → total 0 · q=_ → 0 · PM /directory/users?q=% → 0 items (q=Demo → 17) · partner /directory/users → 403
QA-P1-07  DEMO-DC setupState.gaps ["perimeter","owners"] (committee and authority matrix exist → not listed), gapsComputedAt set
          DEMO-TRANSFORM (general-transformation) gaps ["committee","authority_matrix","baseline","owners"] (no perimeter gap)
QA-P1-12  PATCH DEMO-DC {expectedVersion, status:"closed"} → 400 validation_failed; no-op PATCH (same name) → 200, version 1 → 1
QA-P1-04  create project with the external partner as PM → 422 identity.external_account_role
QA-P1-05  Demo Portfolio Admin /me clearance = confidential; API refuses strictly_confidential (test: 403 policy.classification_exceeds_clearance)
```

### 1.9 CI (GitHub Actions, read through the public REST API)
```
run 8   36645986422  7959b44  success  — 12/12 jobs success (cited by ENT-006, SEC-016, ARC-010, PHS-024 …)
run 14  36686259255  223e967  failure  — compose success, secret-scan success; API integration FAILURE, Playwright FAILURE
run 16  36691248333  4f05318  success  — 14/14 jobs success (static, unit, integration, e2e incl. a11y, compose, secret scan …)
run 17  36693223075  224949d  success  — 14/14 jobs success
run 20  71fe927 · run 22  411ee52 · run 23  a471265  failure — only "Secret scan": steps "(a) repository history" and "(a) repository tree" failed
run 18, 19, 21, 25  cancelled (superseded)
run 24  36703774009  c1338f7  cancelled — images, integration, e2e and secret-scan cancelled; the other 10 jobs success
```
**No completed CI run exists for the reviewed revision, and every completed run after run 17 is red.**

### 1.10 Secret scan reproduced at `c1338f7` (pinned gitleaks 8.30.1, SHA-256 verified as in the CI job)
```
$ curl -fsSL -o gitleaks.tgz …/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz && echo "551f6fc8…70eb  gitleaks.tgz" | sha256sum -c -   → OK
$ GITLEAKS=…/gitleaks bash scripts/ops/secret-scan.sh tree
tree: 814 committed files at HEAD c1338f7
RuleID: generic-api-key            File: apps/api/test/p1/sec-p1r-fixes.spec.ts  Line: 354   (HUB_COOKIE_SECRET, redacted)
RuleID: hub-url-embedded-password  File: apps/api/test/p1/sec-p1r-fixes.spec.ts  Line: 342   (postgres://hub_app:REDACTED@db:5432)
SECRET SCAN (tree): FAIL (1)
$ … secret-scan.sh history
history: 185 commits reachable from HEAD c1338f7
3 findings, all in commit 8c685f6: storage-contract.spec.ts (generic-api-key), sec-p1r-fixes.spec.ts (generic-api-key, hub-url-embedded-password)
SECRET SCAN (history): FAIL (1)
```
I inspected the flagged lines. They are synthetic, production-shaped configuration values passed only to `loadConfig()` in memory (hosts `*.example.invalid`). No real secret is exposed. The problem is that REQ-SEC-012's own check is red at this revision.

**Addendum (after the reviewed revision, at the lead's request).** `d508929` changes only `scripts/ops/gitleaks.toml`. It adds path-scoped, exact-value allow-list entries: `sec-p1r-fixes.spec.ts` joins the existing `oidc-sso.spec.ts` entry, and a new entry covers `storage-contract.spec.ts` / `^k8s-secret-ref-7fQ2mZx9LwP4$`. The entries are as narrow as the policy in the file header requires. With that config, gitleaks over the history and tree of `c1338f7` gives `no leaks found` (exit 0) for both. The allow-list extension still needs a security reviewer's confirmation, as the lead notes.

### 1.11 Addendum: CI after the reviewed revision (informational)
```
run 26  36704256587  124f3d8  failure — only "Playwright smoke (demo stack)", step "Run pnpm test:e2e" (secret scan now green)
run 27  36708212015  f136c42  failure — only "Playwright smoke (demo stack)"
```
`124f3d8` has the application code of `c1338f7` (see header). The lead's own work log in `f136c42` names the cause as `e2e/tests/p3-carveout.spec.ts` (a), an AT-07 UI regression (F-13). I reproduced it locally at `c1338f7`: 1 failed, 145 passed, 3 did not run (§1.5a).

### 1.12 Arabic/RTL: automated check and visual inspection
New spec `e2e/tests/qa-p1r-arabic-rtl.spec.ts` (§8). Screens: portfolio home (PM), DEMO-DC home, a freshly created DC project's home, and wizard steps 1–4 (Portfolio Admin; not submitted). For each screen it checks:
- `<html lang="ar" dir="rtl">`.
- **No English half of a bilingual API field is visible.** The spec re-fetches every JSON GET the page loaded, using the page's session. For every object carrying `<field>` plus `<field>Ar` / `<field>I18n`, the English `<field>` text must not appear in any visible text node or in placeholder / aria-label / title / alt.
- **No English UI catalogue message is visible**, whole or as a multi-word fragment. The catalogue is `apps/web/src/i18n/messages/en`, limited to keys whose Arabic text differs.
- A self-check test runs the same detector on the English page and requires both kinds of hit, so the Arabic assertions are not vacuous.

Result: 6/6 passed (3 tests × 2 repeats).

Every remaining visible Latin-letter string was listed by the spec, and I classified each one:
- **User or seed data:** persona names (`Demo Project Manager`, `Demo Portfolio Admin`), project codes and names, the seed programme name ("Demo programme: DC Carve-out → Standalone NewCo → JV"), the seed objective of DEMO-DC, and an e-mail address (`demo.pm@demo.invalid`).
- **Codes:** gate and criterion codes (`G0`…`G7`, `T0`, `G1-C02`) and phase labels (`P2`, `P4`, `P5`, `P6`).
- **Technical identifiers (allowed by REQ-UX-002):** `dc-carveout`, `Asia/Riyadh`, and the `DC-2027` format example.
- **Intentional:** the language switch label `English` (and its aria-label "تغيير اللغة إلى English").
- **No untranslated UI string was found.**

PNG files I read and inspected:
- Committed-suite output (copied before restoring the committed PNGs): `ar-portfolio-home.png`, `ar-project-overview.png`, `qa-p1/ar-wizard-1-template.png` … `ar-wizard-5-created-overview.png`.
- My spec's output: `e2e/screenshots/qa-p1r/ar-project-home-new.png`.

What I checked in them:
- Layout mirrored: brand and navigation on the right, project sidebar on the right, card order right to left.
- Chevrons follow RTL: "التالي" (Next) points left and "السابق"/"رجوع" (Back) points right. Template arrows are `←`.
- Template names are Arabic ("فصل أعمال مراكز البيانات ← شركة جديدة مستقلة ← مشروع مشترك", "تحول عام").
- Gate names, phases and status dimensions are Arabic, including "لم يُقيَّم بعد" (not yet assessed).
- Setup gaps are Arabic. The Demo badge "تجريبي" appears on DEMO-DC only. The DEMO MODE banner appears on every page.
- The wizard classification hint and the NewCo "stays unverified" note are Arabic.
- No clipping or overlap, except the transient success toast covering the sixth key-records card ("الإجراءات المتأخرة") for a few seconds after creation (as in the first review).
- The date field's `mm/dd/yyyy` placeholder is Chromium's native control under the run's `en-US` locale, not an app string.

---

## 2. Status of the findings of the first review

| ID | Sev. (first review) | Status at `c1338f7` | Evidence |
|---|---|---|---|
| QA-P1-01 | High | **Fixed** (CI exists and works). The gate-revision condition moves to **QA-P1R-01**. | `.github/workflows/transformation-hub-ci.yml`: 14 jobs (static incl. fresh-checkout typecheck/lint and `apply_status.py --check`; unit; integration on PG 16; web plus egress; e2e with a11y; compose; secret scan; images; SBOM; audit; licences; Helm; restore drill; OpenAPI). Runs 16 (`4f05318`) and 17 (`224949d`) are 14/14 green, verified through the GitHub API (§1.9). The run on `c1338f7` was cancelled, and all completed runs after run 17 are red (§1.9–1.11). |
| QA-P1-02 | High | **Fixed** | REQ-ARC-005 now cites `documents/storage-contract.spec.ts`: one `describe.each` contract suite over `LocalFsStorage` and `S3CompatibleStorage` (an in-process S3 server that re-checks SigV4, the payload hash and clock skew), plus signer vectors. I recomputed the four botocore vectors (PUT, GET, HEAD, DELETE) with my own Python SigV4 implementation. All four signatures match (`2fb9b176…`, `3d001069…`, `2c4bd24c…`, `6e16b1af…`). 21/21 green (§1.3). REQ-ARC-006 carries the OIDC evidence as quoted strings. `apply_status.py` now rejects non-string items and missing test titles. The matrix has no `{'…'}` artefact, and a re-render gives no diff (§5). |
| QA-P1-03 | High | **Partially fixed** (all 82 dispositioned; residuals in **QA-P1R-02 / QA-P1R-03**) | Register: 82 P1 musts = **56 Tested / 24 Implemented / 2 Deferred / 0 Planned**. Every non-Tested item has a disposition, owner and reason in `docs/phases/P1-must-disposition.md`. Two items that the document commits to "close before the P1 gate" are still open (SRC-002, ARC-011). The document's summary and 23 table rows contradict the register. |
| QA-P1-04 | Medium | **Fixed** | `portfolio.service.ts:359` (422 `identity.external_account_role`); DB triggers `post-migrate.sql:860, 885, 1137`. Probe §1.8: 422. Tests "QA-P1-04 regression" (2) green. My original assertion was tightened to `422` with the error code, not loosened. |
| QA-P1-05 | Medium | **Fixed** | The wizard offers only levels within the creator's clearance (`projects/new/page.tsx:97-103`). The API refuses higher levels (403 `policy.classification_exceeds_clearance`, test green). The demo Portfolio Admin's clearance is now `confidential`. My E2E test 5 (unchanged) passes (§1.5). |
| QA-P1-06 | Low | **Fixed** | `platform/helpers.ts:162` `likeContains`. Probe §1.8: `%`/`_` → 0. The original DEFECT tests now pass. |
| QA-P1-07 | Medium | **Fixed** | Gaps are computed per request from current records and template kind (`portfolio.service.ts:250`, `gapsComputedAt`). Probe §1.8: DEMO-DC shows no committee or authority gap; the general template shows no perimeter gap. Test green. |
| QA-P1-08 | Medium | **Fixed** | `typecheck`, `lint`, `test*` and `db:*` run `build:packages` first (root `package.json`). A genuine fresh checkout passed install, typecheck, lint and unit tests (§1.1–1.2). CLAUDE.md is corrected. |
| QA-P1-09 | Medium | **Partially fixed** (residual Low) | The README (`apps/web/README.md:25`), `next.config.ts` and `docs/deployment/configuration.md:88` now say "fixed at build time", verified behaviour included. Still open: a production build without `HUB_API_URL` silently falls back to `http://127.0.0.1:4000` (`next.config.ts`, `apiUrl`). There is no fail-fast. The ingress routes `/api` directly in Kubernetes, which limits the impact. |
| QA-P1-10 | Medium | **Fixed** | ENT-003: `traceability-p1.spec.ts` links one entity to two projects without duplication; a second identical link → 409. WS-002 is downgraded to Implemented and re-phased. DAT-009: document soft deletion (list, total, detail, never hard-deletable), with a recorded variance that tasks are cancelled, not deleted. DAT-015: committed paging test. All green (§1.3, §5). |
| QA-P1-11 | Low | **Regressed** (fixed at `7959b44`, stale again at `c1338f7`) | `DELIVERY_STATUS.md` says "Last updated … `38f947c`", 233 domain tests (actual 348), 437 API tests (actual 691), Finance/JV "Planned" (backends merged), carve-out/readiness web "In progress" (merged), CI "awaiting a green run". `WORK_LOG.md` checkpoint is `38f947c`. The lead reports a refresh in `124f3d8` (after this revision; not reviewed). |
| QA-P1-12 | Low | **Fixed** | `packages/contracts/src/portfolio.ts:152` `.strict()`. Probe: unknown `status` → 400; a no-op PATCH does not bump the version. |
| QA-P1-13 | Low | **Fixed** | Allow-listed `sort` per list, ICU `und-x-icu` collation, id tiebreak, NULLs last (`platform/sort.ts`). Probe: injection-like and unknown keys → 400. `qa-p1-13-list-sort.spec.ts` 6/6, including "every list route: each declared key works in both directions… any other value is 400". |
| QA-P1-14 | Low | **Fixed** (for the P1 screens) | `<field>Ar` / `<field>I18n` in API responses (§1.12 probe). `qa-p1-14-bilingual.spec.ts` 7/7. My Arabic/RTL spec finds no English server or UI string on the portfolio, project home or wizard (§1.12). |
| QA-P1-15 | Low | **Resolved by delivery** | RAID (P2) is merged. "Open risks 4" on DEMO-DC is the real register count (RSK-001…004), and new projects show 0. |
| QA-08 (P0) | Medium | **Fixed** | Appendices A and B are ported (`apps/api/test/p1/qa-p1-sec016-injection.spec.ts`, `e2e/tests/qa-p1-review.spec.ts`). The DEFECT tests are kept as regressions with equal or stricter assertions, and all pass. REQ-SEC-016 is Tested. |
| QA-09 (P0) | Low follow-up | **Fixed** | `docs/source-register.md` CLM-009 wording updated in `7959b44`. AT-01 6/6 green. |
| R-01 (P0) | Medium | **Fixed**, with residual notes in §5 | The overlay validates (`status-evidence.yaml OK (102 entries)`), the register equals the overlay (0 drift), and the matrix re-renders without diff. |

---

## 3. P1 exit criteria and required outputs (§19), re-checked at `c1338f7`

| Criterion | Evidence (executed in this review) | Result |
|---|---|---|
| Running application | Fresh checkout builds; API, worker and production web run against a migrated DB (§1.1–1.5) | **PASS** |
| Database / migrations | Global setup migrates an emptied schema on every integration run (691/691). `api-entrypoint.cjs migrate` on two brand-new databases: "migrations applied · post-migrate SQL applied (RLS, grants, triggers, audit chain)". Bootstrap on an empty DB: `p1-closure-empty-db` 3/3 | **PASS** |
| Development identity | Demo login only in demo mode: `POST /auth/demo-login` → 404 in standard mode, and production refuses demo mode (`p1-closure` SEC-024, green). No password column. OIDC against a test IdP 19/19 | **PASS** |
| Portfolio UI | E2E p1-smoke (a)(c)(f), p1-closure UX-028, qa-p1-review 3. Arabic/RTL spec and visual inspection (§1.12) | **PASS** |
| Template-based project creation | AT-02 API test. Wizard in en and ar, submitted (qa-p1-review 1, 2), including the default-classification journey (test 5). From the §1.6 snapshot: the DC wizard project has 12 WS / 8 gates / 102 tasks; the general-transformation wizard projects (QA-XSS-…, QA-CONF-…) have 4 WS / 4 gates / 18 criteria / 14 tasks / 5 KPIs each | **PASS** |
| RBAC / ABAC | Registry-wide sweep (§1.7): 0 non-conforming. Clearance ABAC (QA-P1-05 test). External accounts cannot hold internal roles (QA-P1-04) | **PASS** |
| Audit | Denied, rejected and successful mutations audited (ARC-014 tests). The hash-chain verifier detects modified rows, re-hashed forgeries and a re-hashed tail with a checkpoint (DAT-008 test). The chain is intact across the full restart (§1.6) | **PASS** |
| CI | Pipeline present and demonstrably working (runs 8, 16, 17 green). **At `c1338f7` there is no completed run. Its secret-scan check fails here (§1.10), and the e2e job fails for this application code (§1.11, §1.5a)** | **PASS with condition** (QA-P1R-01) |
| **Exit: persistence after restart** | API, worker **and PostgreSQL** stop/start at `c1338f7` (private cluster): 7 500 project-scoped rows identical, audit digest unchanged, `hub_audit_verify` clean, DB-backed session survives (§1.6). Automated API/worker restart IT green | **PASS** |
| **Exit: two isolated projects** | DEMO-DC (dc-carveout) and DEMO-TRANSFORM (general-transformation): 487/487 project routes → 404 in both directions, the same status as a random project, 0 leaks (§1.7). AT-03 E2E 404 with no title leak. RLS tests green | **PASS** |
| **Exit: denied unauthorized access** | 499/499 non-public routes → 401 problem+json for anonymous callers. Platform admin 487/487 → 404. Auditor 0 successful mutations out of 347. CSRF, forged and revoked sessions → 401/403 (ARC-014, SEC-009 tests) | **PASS** |
| **Exit: security review** | `docs/reviews/P1-security-rereview.md`: **PASS with conditions** at `08981f2`, no Critical or High open. The fixes for SEC-P1R-01…06 and I-R1…R5 are marked Fixed by the implementers (appended section). Their tests (`sec-p1r-fixes.spec.ts` 25/25) are green here. A security reviewer has not confirmed those fixes or the `d508929` allow-list | **PASS with condition** (security confirmation) |
| **Exit: QA review** | This document | **PASS WITH CONDITIONS** (§7) |

---

## 4. New findings

| ID | Severity | Location | Finding and reproduction | Requirement / AT | Recommendation |
|---|---|---|---|---|---|
| QA-P1R-01 | **Medium** | CI on `claude/mobily-transformation-hub`; `apps/api/test/p1/sec-p1r-fixes.spec.ts:342,354`; commit `8c685f6`; `e2e/tests/p3-carveout.spec.ts` | **The reviewed revision has no green CI, and its application code fails two CI checks.** (1) Run 24 on `c1338f7` was cancelled. Runs 20, 22 and 23 failed on the secret scan, and I reproduced 2 tree findings and 3 history findings with the pinned gitleaks (§1.10). These are synthetic values, but REQ-SEC-012 (Tested) and REQ-SET-008 (Tested) rely on this scan and it is red at this revision. The allow-list fix `d508929` comes after the revision and passes locally (addendum). (2) The Playwright job fails on the same application code (run 26 on `124f3d8`). My local run of the full committed suite at `c1338f7` gives 145 passed, 1 failed, 3 did not run (§1.5a). The failure is `p3-carveout` (a) AT-07: the sponsor's approval of a change request with a text-only cost impact is refused by the P2 authority rule. The lead records this regression as F-13. The P1 specs themselves are green (12/12, a11y 118/118). CI itself works: it caught both problems. | REQ-DEP-022, REQ-SEC-012, REQ-SET-008, REQ-PHS-024; §19 step 6 | Record the P1 gate on a revision with a **completed, all-green CI run**. Alternatively, if the gate revision still carries the AT-07 regression, list it in the gate report `open_findings` with owner and severity; do not present CI as green. Have a security reviewer confirm the `d508929` allow-list. |
| QA-P1R-02 | **Medium** | `docs/phases/P1-must-disposition.md` "Work to close before the P1 gate"; register REQ-SRC-002, REQ-ARC-011 | **Two P1 musts committed to close before the P1 gate are still open.** REQ-SRC-002 (validator check that every reference heading maps to a workstream; owner carveout-domain-analyst) and REQ-ARC-011 (module-boundary import rule; owner solution-architect) are `Implemented` with no new work. `git log --all --grep 'SRC-002\|ARC-011\|dependency-cruiser'` finds nothing, and there is no boundary rule in the repo. The other 23 of the 25 "close before gate" items are now Tested. | REQ-SRC-002, REQ-ARC-011; §19 step 7 | Close both before the gate, or re-phase them explicitly (target phase, owner, reason) in the gate report as done for the other 16. |
| QA-P1R-03 | **Medium** | `docs/phases/P1-must-disposition.md` (summary, table, evidence baseline) | **The disposition document, declared "Input for P1-gate-report.json", contradicts the register.** It says 33 Tested / 47 Implemented. The register has 56 / 24 / 2 (§5). 23 rows still read "Implemented · Close before P1 gate": PLT-002, PLT-004, PLT-005, SRC-004, SRC-008, ENT-002, UX-002, UX-028, ARC-004, ARC-007, ARC-008, ARC-014, ARC-015, DAT-008, DAT-012, DAT-017, SEC-012, SEC-024, DEP-002, DEP-007, SET-001, SET-006, SET-008. Only REQ-ARC-005 received an update note. The "Evidence baseline" cites run 8 (`7959b44`), while the statuses cite runs 14 and 16. A gate report built from this document would under-report, or mix revisions. | REQ-PHS-012, REQ-PHS-013, REQ-PHS-025 | Regenerate the summary and table from `requirements.yaml` (scripted) at the gate revision, and cite a single CI run on that revision. |
| QA-P1R-04 | Low | `status-evidence.yaml` REQ-PLT-002 | **Tested although part of the AT is manual.** The AT is "IT: records survive API, worker and database restart". The API and worker restart is automated. The database restart is manual (my first review at `5d0dd09`, now repeated at `c1338f7` in §1.6). The document's own rule says "partial coverage stays Implemented". | REQ-PLT-002 | Either automate a DB restart (e.g. a CI job with a dedicated PG service: stop/start plus the §1.6 checks) or record the manual part as a variance citing §1.6 of this review. |
| QA-P1R-05 | Low | `status-evidence.yaml` REQ-UX-001; `P1-must-disposition.md` UX-001 row | **Stale gap text.** UX-001 is re-phased to P2 because "server-provided names stay English in the Arabic UI (QA-P1-14)". QA-P1-14 is fixed, and my spec shows no English server string on the P1 screens (§1.12). Whether all later screens meet "all visible strings" is not established. | REQ-UX-001 | Update the gap to the real remainder (screens not yet covered by an Arabic check). Consider adding `qa-p1r-arabic-rtl.spec.ts` as evidence for the P1 screens. |
| QA-P1R-06 | Low | `status-evidence.yaml` REQ-SET-008; commit message `5bbf52b` | **A pass claim cites a red job.** SET-008 says "the bootstrap-on-empty-database spec p1-closure-empty-db also passed in that run [run 14]". The run 14 API integration job **failed**, and its log cannot be downloaded here (proxy policy). Commit `5bbf52b` calls compose and secret-scan "the two red CI jobs of run 14", but those two were green and integration and e2e were red (§1.9). The spec does pass (my run, and run 16 green), so the status is not affected. | REQ-SET-008; R-01 | Cite run 16 (all green) instead of run 14 for the spec. |
| QA-P1-09 (residual) | Low | `apps/web/next.config.ts` | A production web build without `HUB_API_URL` still proxies to `127.0.0.1:4000` silently. | REQ-ARC-015 | Fail the build when `HUB_API_URL` is unset and `NODE_ENV=production`. |
| QA-P1-11 (regressed) | Low | `docs/DELIVERY_STATUS.md`, `docs/WORK_LOG.md` | Stale at `c1338f7` (§2). | REQ-PHS-025 | Refresh at each merge; a scripted count check would prevent the drift. |

**Observations (no severity; outside P1 scope, for the P2/P3 reviewers)**
- **O-1:** On the project cockpit, "طلبات اللجنة / Committee requests" and "أهم ثلاثة قرارات وعوائق / Top three decisions and blockers" still say "This screen is part of implementation phase P2 and is not implemented in this build yet", although the P2 governance module is merged. This is honest about the tile, but the phase label is now misleading.
- **O-2:** `a11y.spec.ts` does not yet scan the P3 screens (perimeter, NewCo, readiness). This is acknowledged in the ARC-008 evidence.
- **O-3:** `POST …/readiness-checks/from-template` with `{}` by the Demo Contributor, who holds `readiness.check.manage` conditioned on own workstream, returns 201. It is audited as a successful project-wide `readiness.check.instantiate` (`workstreamId: null`). The service passes `ownerUserIds: [caller]` to the policy (`checks.service.ts:264`), which satisfies the own-workstream condition trivially. It created 0 checks, because projects are created with their 31 template checks, so there was no data effect in my probes. P3 reviewers should confirm the intended scope.
- **O-4:** The demo seed's programme name and DEMO-DC objective exist in English only. They are data, not UI, but they are the most visible English text in the Arabic demo.

Open counts at `c1338f7`: **Critical 0 · High 0 · Medium 3 (QA-P1R-01, -02, -03) · Low 5 (QA-P1R-04, -05, -06, QA-P1-09 residual, QA-P1-11 regression).**

---

## 5. Traceability check

**Tooling.**
```
$ python3 scripts/requirements/apply_status.py --check      → status-evidence.yaml OK (102 entries)
$ python3 scripts/requirements/render_traceability.py       → rendered 394 requirements; AT coverage 30/30 ; git status: no diff
$ p1musts.py (independent parse of requirements.yaml + overlay)
  register total 394 · P1 musts 82 → Tested 56 · Implemented 24 · Deferred 2 · Planned 0
  overlay vs register drift: none · P1 musts without overlay entry: none · Tested outside P1 musts: REQ-ARC-006 (P7)
```
The first review said 34 P1 musts were Planned. None are Planned now.

**Every P1 Tested claim is backed by passing tests.** Each of the 56 cites existing tests (`--check`). Every cited API or unit spec ran green here: 691/691 and 348 + 100, with no skipped or expected-fail tests. Every cited E2E spec ran green: p1-smoke, p1-closure, qa-p1-review, a11y, and in the full run (§1.5a) p2-documents, p2-governance and p2-gates. None of the P1 Tested claims cites `p3-carveout`, the only failing spec. Where the evidence is a CI run, I checked the run and its jobs through the GitHub API (runs 8, 14, 16, 17). The one exception is REQ-SEC-012 / SET-008: the secret-scan check they depend on **fails at `c1338f7`** (QA-P1R-01). Titles I checked in the verbose output are in §1.3.

**In-depth spot checks (18)**

| REQ | AT (register) | What the cited test actually does | Verdict |
|---|---|---|---|
| ARC-005 | local FS and S3 adapters pass the same contract tests | `describe.each` over both adapters (round trip with NUL bytes > 64 KiB, overwrite, delete, key validation before I/O). The S3 side runs against a server that re-verifies signatures. Signer vectors confirmed independently (§2) | Exercises the AT |
| DAT-008 | verifier detects a modified row | Owner role, trigger disabled inside a rolled-back transaction, throw-away org: modified outcome → reported at pos 2; re-hashed row → break at pos 3; re-hashed tail → caught only with a checkpoint (honest limit, ADR-0014) | Exercises the AT |
| ARC-014 | 401 without a session; failed rule leaves no business change or outbox rows | 5 anonymous or forged mutations → 401 with unchanged table counts and outbox. A 422 rule → no outbox, job, business or row change, audited `rejected` only. A mid-command failure rolls back project, audit and outbox | Exercises the AT (audited-rejection variance recorded) |
| ARC-004 | worker processes outbox independently of the API | Spawns the real `dist/worker.js` after closing the API app. The event stays pending until the child dispatches it. Checks the job `succeeded` with 1 attempt, and that the worker connects as `hub_app` (not superuser, no BYPASSRLS) | Exercises the AT |
| PLT-002 | survive API, worker and DB restart | API + worker automated. DB restart manual, re-executed here (§1.6) | Tested with a manual part (QA-P1R-04) |
| PLT-005 | contract check fails for a route without a contract | Rogue handler → `createApp` rejects "handlers without contract". A registered but unimplemented route → rejects. A clean app → `unbound=[]`, `missing=[]` | Exercises the AT |
| ARC-007 | OpenAPI matches registered routes | Runs `dist/cli/openapi.js`: registry ⇔ OpenAPI ⇔ Express routes, one operation per route id, permission and security on each, public allow-list of 5, converted schemas, no secrets | Exercises the AT |
| ENT-003 | one entity in two projects, no duplication | Links A's NewCo into B as counterparty: `legal_entity` count unchanged, two `project_entity` rows, duplicate link → 409 | Exercises the AT |
| ENT-002 | project cannot reference a program of another org | API refusal with nothing created. The runtime DB role cannot link across orgs (composite FKs added in post-migrate SQL) | Exercises the AT |
| DAT-009 | soft-deleted task excluded from lists and totals | Soft-deleted **document**: out of list, total and detail; the row remains; hard delete refused | Variance (tasks are cancelled, never deleted), recorded; acceptable |
| DAT-012 | expired download URL rejected | No URLs exist. Download refused without a session, with a forged cookie, after logout and after idle expiry. Responses carry no storage key or presigned parameter | Variance recorded; acceptable |
| DAT-015 | pageSize > 100 rejected | `pageSize=101`, `1000000`, `page=0`, `-1`, `1e309` → 400 problem+json | Exercises the AT |
| SRC-004 | low-confidence claim defaults to Unknown | Two API claims (no status; confidence 0.1) stored `unknown` in API, DB and audit. DB default `unknown` | Exercises the AT |
| SRC-008 | invalid status rejected by contract and DB | 6 bad values → 400 with nothing stored; review with a bad value → 400 and the claim unchanged; enum has exactly 6 labels; owner and runtime roles get `22P02` | Exercises the AT |
| SET-001 / SET-006 | seed idempotent, all `is_demo`; bootstrap only templates and policies | Seed twice on an empty DB → identical counts; every `is_demo` true. Bootstrap twice → only org, admin, role assignment, templates and schedules; no password; refuses demo mode | Exercises the AT |
| SEC-016 | CSRF, XSS, injection, IDOR | Ported QA appendices (API 14/14, E2E XSS inert) plus CSRF and IDOR tests. Registry-wide sweep §1.7 | Exercises the AT |
| UX-028 | Demo badge on list and detail | E2E p1-closure: list, detail and a demo record detail; none on a non-demo project | Exercises the AT |
| ARC-008 / DEP-022 | CI runs unit, integration, E2E and axe | Run 16 at `4f05318`: 14/14 green (GitHub API), and its e2e job includes `a11y.spec.ts` (merged at `6be311a`). Local a11y 118/118 | Exercises the AT **at `4f05318`**. At `c1338f7`, see QA-P1R-01 |

**Honesty of `P1-must-disposition.md`:**
- No item is marked Tested without an executed test. Every Tested claim I checked is backed by a green test or a verified CI job.
- Both Deferred items (ENT-009 → P6, SET-009 → P3) and the 14 re-phased items carry a target phase, an owner and a reason.
- The document itself is stale and inconsistent with the register (QA-P1R-03). Two "close before gate" items remain open (QA-P1R-02).
- Re-phasing is recorded only in free text. The register's `phase` field still says P1 for all 16 items, so the gate report must list them explicitly.
- Four entries were honestly downgraded from Tested to Implemented at `7959b44` (ARC-014, DAT-008, DAT-017, SET-001). All four are now backed by the new closure tests, which I read and ran.

---

## 6. NOT EXECUTED (with reason)

- **Docker Compose `up`, container image build, Helm/kubeconform, restore drill, licence/SBOM/audit jobs at `c1338f7`.** There is no Docker daemon here and CI run 24 was cancelled. The last green evidence is run 16/17 (`4f05318`/`224949d`).
- **Restarting the shared PostgreSQL cluster (`:5432`).** Other agents use it. The database-restart check ran on a private cluster instead (§1.6). A crash (`-m immediate`) restart was not executed.
- **CI job logs** (e.g. run 14 integration). The download is blocked by the egress proxy (`productionresultssa18.blob.core.windows.net` rejected).
- **Security confirmation** of the SEC-P1R fixes and of the `d508929` allow-list. That is a security reviewer's task.
- **Manual screen-reader, zoom and high-contrast checks.** Automated axe only.

---

## 7. Verdict

**PASS WITH CONDITIONS at revision `c1338f74215a1cb23d8e4dc52e80c50aa2d08b14`.**

Every P1 exit criterion was re-executed at this revision and holds:
- **Persistence after restart** of the API, the worker and PostgreSQL.
- **Two isolated projects:** 487/487 project routes → 404 in both directions, with no leaks.
- **Denied unauthorized access:** 499/499 → 401; the platform admin and under-privileged roles are denied.
- The **fresh-checkout** build, **691/691 API**, **448 unit**, the **P1 E2E (12/12)**, **a11y (118/118)** and a new **Arabic/RTL** check (6/6) all pass.
- In the full committed E2E suite, the only failure is the P3 AT-07 regression (145 passed, 1 failed, 3 did not run; §1.5a).

All three High findings of the first review are fixed or reduced to recorded residuals. No Critical or High finding is open.

**Conditions before the P1 gate report records PASS:**
1. **QA-P1R-01:** a completed CI run on the gate revision in which every job is green. If the P3 AT-07 e2e regression (F-13) is still present on that revision, it must appear in the gate report `open_findings` with owner and severity, and the CI must not be presented as green. A security reviewer must confirm the `d508929` allow-list.
2. **QA-P1R-02:** REQ-SRC-002 and REQ-ARC-011 are closed or formally re-phased.
3. **QA-P1R-03:** the gate report's requirement statuses are generated from the register at the gate revision, not from the stale disposition table. Variances and the 16 re-phased/deferred musts are listed.
4. Low items (QA-P1R-04…06, QA-P1-09 residual, QA-P1-11) are recorded with owners (§19 step 7).

---

## 8. Files written by this review and environment cleanup

- This report: `docs/reviews/P1-qa-rereview.md`.
- New E2E spec: `e2e/tests/qa-p1r-arabic-rtl.spec.ts` (Arabic/RTL untranslated-string check with a detector self-check; 3 tests, green).
- Its screenshots: `e2e/screenshots/qa-p1r/ar-*.png` (7 files).
- The AT-07 failure screenshot from §1.5a: `e2e/screenshots/qa-p1r/en-p3-carveout-at07-approve-refused-c1338f7.png`.
- Helper scripts, used from the scratchpad and not committed: `sweep.mjs`, `probes.mjs`, `probe-readiness.mjs`, `snapshot.cjs`, `api-snap.mjs`, `sigv4_check.py`, `p1musts.py`, `pgpriv.sh`, `ci-jobs.sh`, `gl-d508929.sh`.
- The private cluster was started through `pgpriv.sh`, which runs `initdb`/`pg_ctl` as the `postgres` user via `runuser`, as the project's own `pg-init-roles.sh` does with `su`.

**Cleanup:**
- Stopped with SIGTERM after checking command line, working directory and environment:
  - API: 12640, then 23534, then 29508 (`node dist/main.js`, `PORT=4133`).
  - Worker: 12656, then 23557, then 29522 (`node dist/worker.js`, `HUB_WORKER_ID=qa-p1r-worker*`).
  - Web: `next-server` 14749 (cwd `apps/web` of this worktree).
  - The sweep process 5183 was stopped once for the session-rotation change.
- Ports 3133 and 4133 are closed afterwards.
- The empty-database worker run was bounded by `timeout 15`.
- The private cluster `/var/lib/postgresql/qa-p1r-restart` was stopped and deleted (`pg_isready -p 5443`: no response). The shared cluster on `:5432` is still accepting connections.
- `hub_test_qa3` and `hub_test_qa3_boot` were left in their post-test state.
- `e2e/test-results` and `e2e/playwright-report` (ignored) were removed. The committed screenshots and `docs/test-evidence/a11y-report.md`, which the E2E runs rewrote, were restored with `git checkout`.
- Processes of other agents were not touched (API/worker 31030/31043 on `:4317`, Playwright under `agent-a79b279297973113b`).
