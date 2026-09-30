# Handback: T-DG1-QA (qa-verifier): first executable acceptance suites

> **Location note (assignment/guard conflict).** The assignment names `docs/delivery/handbacks/DG1/T-DG1-QA-qa-verifier.md`, but the write guard (`tools/agents/write-scopes.json`) refuses it for qa-verifier: `BLOCKED by write guard: qa-verifier may not write 'docs/delivery/handbacks/DG1/T-DG1-QA-qa-verifier.md' (outside role write scope)`. The shell also got `Read-only file system` there. This handback is therefore in my evidence directory. **Orchestrator:** copy it verbatim to the assigned path.

- **Stage/gate:** P1 / DG1 (BUILDING). This is an **authoring** task before the freeze, not a gate review. Writing these suites does not make me the DG1 gate reviewer, and nothing here grants or implies a product G1–G6 business approval. All users and records are **synthetic**.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-QA-qa-verifier-20260930T233036Z-19a62814","session_id":"19a62814-90a2-4120-a9ad-cea19a0820a5"}`.
- **Assignment:** `docs/delivery/assignments/DG1/T-DG1-QA.md`, sha256 `ffc971a14dabb27663504261247570d0021b26d6e21088109f5bca161094e201` (checked with `sha256sum` before starting).
- **Starting revision:** HEAD `4e5e72a2f0b4cec7207cd95e081ee3b1434c26d8`, which is BE, FE and DevOps integrated plus CI install and formatting.
  - `git status` at start showed only pre-existing untracked files that are not mine: root dotfiles, `.idea`, `.vscode`, `.mcp.json`, `CLAUDE.local.md` and this run's `docs/delivery/runs/DG1/…`.
  - `node tools/gates/validate.mjs --stage DG0 --historical` gave `PASS gate DG0 (historical)`.
  - `--pipeline` gave `PASS pipeline (active stage: DG1 BUILDING)`.
- **State of my work:** all files are new and **uncommitted**. The orchestrator integrates them.
- **Product files touched:** none. Mutation checks changed product files **only in a disposable clone under `$TMPDIR`**.

## Status: COMPLETE for A12, A13, A14 and A20 (first cases). A18 is PASS for the container-free path; its install step and Compose path are NOT RUN/BLOCKED (§4)

No product defect was found. Every suite passes on the integrated candidate. Every suite also fails when the behaviour it guards is deliberately broken (§3, mutation checks). There are no findings to report.

## 1. Changed files (all new, all in my scope)

| File | Purpose |
|---|---|
| `tests/qa/support/with-pg.sh` | Runs a command against a **disposable PostgreSQL** cluster: created, used and deleted inside one process tree. Exports `TEST_DATABASE_ADMIN_URL` for the `integration` project. Exits 3 with `BLOCKED` when the binaries are missing. |
| `tests/qa/support/api.ts` | Thin layer over the backend harness (`startApi`, `signIn`, `call`). The harness validates every response against `docs/api/openapi.yaml`. This file adds the problem+json assertion, the non-disclosure shape and PATCH/POST helpers. |
| `tests/qa/integration/a12-cross-scope.test.ts` | **A12**, 14 tests |
| `tests/qa/integration/a13-job-idempotency.test.ts` | **A13**, 5 tests. Uses its own fresh database, because pg-boss state is global. |
| `tests/qa/integration/a14-concurrency.test.ts` | **A14**, 5 tests |
| `e2e/a20-bilingual-shell.spec.ts` | **A20**, 2 tests × `chromium-en` and `chromium-ar` |
| `e2e/support/qa-stack.sh` | Real local stack for root e2e: disposable PG → `mth-db migrate` → `seed-dev` (synthetic) → API serving the built SPA on :3000 → command → teardown |
| `e2e/support/a20-token-propagation.sh` | A20 token change. Changes `brand.deep` in a **disposable copy under `$TMPDIR`**, rebuilds the web there, and runs the token test against the changed build. It refuses the candidate tree (exit 64). |
| `e2e/clean-start/a18-clean-start.sh` | **A18** clean start from the documented commands on a fresh checkout. Independent of devops' `clean-start-local.sh`. |
| `docs/delivery/test-evidence/DG1/qa/T-DG1-QA-authoring/**` | Logs 01–09, the mutation script, the A20 screenshots (EN and AR) and this handback |

## 2. What each suite asserts (derived from the acceptance criteria and the OpenAPI contract)

### A12: cross-scope read/write is denied; the in-scope case succeeds (`a12-cross-scope.test.ts`)

**Setup.** Three principals, each scoped at **one** level to "A":
- organization: TO @ org A;
- business unit: TO @ BU A1, which inherits downward;
- transformation: TL @ transformation A1, which does not inherit.

Each principal is probed against every "B" outside its scope: a sibling transformation in the same BU, a sibling BU, and another organization.

| Test | Asserts |
|---|---|
| Read (×3 scopes) | **In scope:** `GET` is 200 with a strong `ETag`. **Out of scope:** `GET` and `GET …/audit` are **404** `urn:mth:problem:not-found`. The problem body does not contain the record's name. The status, type, code, title and detail are **identical** to those for a random non-existent id, so existence is not disclosed. |
| List (×3) | The list contains exactly the in-scope ids and none of the out-of-scope ones. `organizationId=<org B>` returns `[]`. A `q=<B's name>&includeArchived=true` search does not return B. |
| Write denied (×3) | `PATCH` and `POST …/archive` on B with B's **correct** `If-Match` are **404**, with the same shape as for an unknown id. A **missing** If-Match on B gives the same response as on an unknown id, so there is no 428 existence oracle. Afterwards the DB row (version, name, description, status, archived_at, updated_at) is **unchanged**, and B's `transformation.*` audit trail is unchanged. |
| Write allowed (×3) | An in-scope `PATCH` with a fresh If-Match is 200, and `version` goes up by 1 in the response and in the DB. |
| Create | These creates are 403/404 problem+json and write **no row**: org-scoped in org B's BU; BU-scoped in the sibling BU and in org B; transformation-scoped in its own BU (a transformation grant does not cover the BU) and in org B. A BU-scoped create in its own BU is 201. |
| Policy function | `authorize()` (the single decision point exported by `apps/api/src/modules/access`) allows read, update and archive in scope and denies them out of scope for all three scope levels. |

### A13: job-framework idempotency (`a13-job-idempotency.test.ts`)

This suite drives the **real API** (create) and then the **real worker functions and pg-boss** on the same disposable database.

| Test | Asserts |
|---|---|
| Create with Idempotency-Key | A replay with the same key and body returns the **same 201 body**. It leaves exactly **1** transformation and **1** outbox event. The same key with a different body is **422**, and nothing is written. |
| Relay twice | The second `relayOnce` publishes 0, and there is exactly **1** pg-boss job for the event. **Crash-window replay:** the owner resets `published_at`, the relay sends again, and there is still **1** job (id = outbox id). |
| Handler twice | `done`, then `duplicate`, then `duplicate` again under a different job id. The result is **1** `processed_message` row and **1** starter-automation audit event. |
| Concurrent handlers | 5 parallel deliveries give exactly 1 `done` and 4 `duplicate`, with 1 ledger row and 1 audit event. |
| Running worker | `startWorker` consumes the event once. A **duplicate delivery**, meaning the same envelope enqueued under a new job id, completes with output `{outcome:"duplicate"}`. After the queue drains, every transformation has at most one ledger row, and exactly as many starter-automation audit events as ledger rows (the created one has 1/1). |

### A14: optimistic-concurrency conflict (`a14-concurrency.test.ts`)

| Test | Asserts |
|---|---|
| Create | `version` 1 and `ETag: "1"` |
| PATCH | **Fresh** If-Match `"1"`: 200, version 2, ETag `"2"`, DB updated, and an audit entry `transformation.update` with prior 1 → new 2. **Stale** `"1"`: **409** `urn:mth:problem:version-conflict` with **`currentVersion: 2`**. **Missing**: **428** `urn:mth:problem:precondition-required`. **Future** `"99"`: 409. After the 409s and the 428, the DB row and audit trail are byte-equal to before. A re-read and re-apply on `"2"` succeeds (version 3) and keeps the other writer's change. |
| Race | 6 parallel PATCHes on `"1"` give exactly **one 200** and five 409s with `currentVersion 2`. The final version is 2, and there is 1 `transformation.update` audit event. |
| Archive | Stale gives 409 with `currentVersion`, and missing gives 428, with the DB unchanged. Fresh gives 200, version +1 and `archivedAt` set. |
| `PUT /me/preferences` | Missing gives 428 with the DB unchanged. Fresh gives 200 with version +1. Stale gives 409 with `currentVersion`. |

### A20: bilingual shell and token change (`e2e/a20-bilingual-shell.spec.ts`)

This suite runs against the running API and the built SPA. A **fresh synthetic user** is created per run through `POST /api/v1/users` (by `dev.admin`), so the default is not affected by preferences stored by other suites.

**Bilingual shell test** (each step in both the `chromium-en` and `chromium-ar` browser locales):
1. Signed out, the page renders `<html lang="ar" dir="rtl">` and the computed `direction` is rtl in **both** browser locales, so the default does not follow the browser.
2. Signed in through the dev form, the shell is AR-RTL with the "مؤقت" badge. The navigation is **right** of `main`.
3. The language switch gives `lang="en" dir="ltr"`, and `PUT /me/preferences` returns 200. The navigation is **left** of `main` and the "Provisional" badge shows.
4. After a reload the page is still EN-LTR.
5. Switching back gives AR-RTL.
6. There are no CSP console errors.

**Token test:**
- The seven seeded `--mth-*` variables on `:root` equal `tokens.json` of the tree that was built.
- The navigation background equals the resolved `nav.background` token, following its `ref` to `brand.deep`.
- The header gradient contains `header.gradient-start`.

**Token change** (`a20-token-propagation.sh`): `brand.deep` goes from `#003B73` to `#6B1D5C` in a disposable copy. The new value is in the built CSS, and the same test passes with the navigation and header rendered in `#6B1D5C`. This is shown in the screenshots `…--04-tokens-6B1D5C.png` next to `…--04-tokens-003B73.png`.

**Screenshots:** EN and AR, in `screenshots/{ar,en}/` next to this file. I viewed them: AR has the navigation on the right, and EN has it on the left with English strings.

### A18: clean start (`e2e/clean-start/a18-clean-start.sh`)

1. A fresh `git clone` at the commit has a clean tree, with no `dist` or `node_modules`.
2. Dependencies (see §4).
3. `pnpm -r build` produces the api, worker, db-cli and web outputs.
4. A fresh PG cluster is created, with the roles `mth_owner`/`mth_app` and the database owned by `mth_owner`.
5. `mth-db status` returns **3** (pending). `migrate` returns 0. A second `migrate` is a no-op. `status` then returns **0**, and 6 rows are recorded in `schema_migration`.
6. The api and worker start in **production configuration**: `NODE_ENV=production`, `AUTH_MODE=oidc`, an unreachable https issuer, and the client secret via `*_FILE`.
7. `/healthz` returns 200 `{"status":"ok"}`. `/readyz` returns 200 `{"status":"ready","checks":{"database":"ok","migrations":"ok"}}`. `/` serves the SPA with `lang="ar" dir="rtl"`. Dev login is 404. `/me` without a session is 401. The worker is still alive.
8. After an API **restart**, the API is ready again.
9. **Negative case:** against an **unmigrated** database, `/healthz` is 200 but `/readyz` is **503** `migrations: pending`.

## 3. Checks actually run

**Environment:** this sandbox. Node v22.22.2, pnpm 10.33.0, Vitest 3.2.4, Playwright 1.56.1 with the pre-installed chromium-1194 (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was never run), and **PostgreSQL 16.13** in disposable clusters. There was no network. Date 2026-09-30 (UTC).

**Where they ran.** In my sandbox the candidate's `node_modules` is **read-only**, and `pnpm test:integration` there fails at startup with `EROFS … node_modules/.vite-temp/…`, an environment limit. The full runs (rows 1–7, 9) therefore ran in a **disposable clone of `4e5e72a`** under `$TMPDIR`. The clone has a copy of the installed `node_modules` and my new files. `git status` in the clone shows only `?? e2e/` and `?? tests/`. Row 8 ran the QA suites directly on the candidate tree, using `--configLoader runner`.

| # | Command | Result | Evidence (this directory) |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --stage DG0 --historical` and `--pipeline` | `PASS gate DG0 (historical)` and `PASS pipeline (active stage: DG1 BUILDING)` | (this run, before writing) |
| 1 | `pnpm test` (unit-node + unit-web) | `Test Files 14 passed (14)`, `Tests 126 passed (126)`, exit 0 | `01-pnpm-test.log` |
| 2 | `tests/qa/support/with-pg.sh pnpm test:integration` | `applied 6 migrations to a fresh database` … `Test Files 17 passed (17)`, `Tests 181 passed (181)`, exit 0. That is 157 existing plus 24 QA tests. | `02-pnpm-test-integration.log` |
| 3 | `QA_EVIDENCE_DIR=… e2e/support/qa-stack.sh pnpm e2e --workers=1` | `readyz {"status":"ready",…}`; `20 passed (38.4s)`, exit 0. That is 4 A20 tests plus the FE's 16 journeys. | `03-pnpm-e2e.log`, `screenshots/` |
| 4 | `e2e/support/a20-token-propagation.sh <clone>` | `brand.deep #003B73 -> #6B1D5C`; new value in the built CSS; `2 passed`; `A20 token propagation: PASS`, exit 0. On the candidate tree: `REFUSED …`, exit 64. | `04-a20-token-propagation.log` |
| 5 | **Negative control:** the token test with an expectation (`#6B1D5C`) that does not match the build | `Expected "#6B1D5C" / Received "#003B73"`, `2 failed`, exit 1 (as intended) | `05-a20-negative-control.log` |
| 6 | **Mutation checks** (product code mutated only in the clone) | M1 policy `requireRead` ignores denial → A12 **fails** (6 tests). M2 handler ignores the ledger result → A13 **fails** (3). M3 stale If-Match accepted → A14 **fails** (3). M4 missing If-Match accepted → A14 **fails** (3). Unmutated control: `24 passed`, exit 0. | `06-mutation-checks.log`, `06-mutation-checks.sh` |
| 7 | `e2e/clean-start/a18-clean-start.sh` | All steps PASS; `A18 CLEAN START: PASS (commit 4e5e72a…; install step: NOT RUN, candidate node_modules reused; total 23.5 s)`, exit 0 | `07-a18-clean-start.log` |
| 8 | `tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa`, on the **candidate tree** | `Test Files 3 passed (3)`, `Tests 24 passed (24)`, exit 0 | `08-qa-suites-candidate-tree.log` |
| 9 | Determinism: QA suites 3× on fresh clusters. BLOCKED paths: no `TEST_DATABASE_ADMIN_URL`; `PGBIN=/nonexistent`. | 3 × `24 passed`. `Error: BLOCKED: no database …`, exit 1. `BLOCKED: PostgreSQL server binaries not found`, exit 3. | `09-determinism-and-blocked.log` |
| 10 | `npx eslint tests/qa e2e --max-warnings=0`; `npx prettier --check tests/qa e2e`; `tsc` over `tests/qa/**` and `e2e/**` (scratch tsconfig extending `tsconfig.base.json`, in the clone) | eslint exit 0; `All matched files use Prettier code style!`; tsc exit 0. Root `pnpm lint` in the clone also exits 0. | (this run) |

`$TMPDIR` paths in the logs are masked. The logs contain no credentials: the only secret, a random OIDC client secret for A18, was written to a scratch file that was deleted and never printed.

**While authoring, I found and fixed defects in my own scripts:**
- The first `with-pg.sh` killed the launching shell instead of the postmaster, which left the port in use for the next run in the same command. The first mutation run's "killed" results were therefore **not** trusted: its control run showed BLOCKED. The runs were repeated after the fix.
- A copy path error made the first mutation run exit 127.

## 4. Known gaps, NOT RUN and BLOCKED

| Item | Status and exact reason |
|---|---|
| **A18 install step** (`pnpm install --frozen-lockfile` in the fresh checkout) | **NOT RUN.** The assignment says "Do not run `pnpm install`". My script copies the candidate's installed `node_modules` into the fresh checkout, after checking that `pnpm-lock.yaml` is identical at the commit. `--install` runs the documented offline install for reviewers and CI. DevOps' `docs/delivery/handbacks/DG1/T-DG1-DEVOPS-evidence/clean-start-local.log` records an offline frozen-lockfile install. I did not re-run it. |
| **A18 Compose path** (`docker compose … up`, image build, test-idp, no-egress) | **BLOCKED.** No Docker daemon in this sandbox: `docker info` shows the client only and there is no `/var/run/docker.sock`. `deploy/scripts/verify-stack.sh` must be run on a Docker host. |
| PostgreSQL **18** | **BLOCKED.** Only 16.13 (the ADR-0003 floor) is installed here. CI runs PG 18. |
| OIDC / Keycloak sign-in in e2e | Not in scope for these first cases, and **BLOCKED** offline (no Keycloak). A20 signs in through the dev form (`AUTH_MODE=dev`). A18 only proves that production mode starts, with dev login 404. |
| `tests/qa/unit/**` | None authored. The five assigned criteria are integration or e2e by nature. |
| A20 "the API returns the seven tokens" | Not tested: the P1 contract has no tokens endpoint, as the FE handback notes. Only rendered CSS and token source are asserted. |
| A20 token change | Covered for `brand.deep`, a seed with `ref` dependants. Changing `brand.primary` also requires re-deriving the action shades (guarded by `resolveTokens`). Branding Settings is P5. |

## 5. Contract and assignment notes (for the orchestrator)

1. **Handback path vs write guard.** See the note at the top.
2. **Acceptance check 1 wording.** It says "`pnpm test` (unit-node + integration …)". In fact root `pnpm test` runs `unit-node` + `unit-web`, and integration is `pnpm test:integration`. I ran both (rows 1–2). The CI workflow also runs both.
3. **`pnpm e2e` needs a running stack.** `playwright.config.ts` has no `webServer`. Locally, use `e2e/support/qa-stack.sh pnpm e2e`. In CI (`.github/workflows/ci.yml`), `node deploy/scripts/ci-e2e-stack.mjs` starts the stack with synthetic dev users, then `pnpm e2e --workers=1` picks up root `e2e/**`. My spec needs the seeded `dev.admin` (true in both) and reads `packages/design-tokens/src/tokens.json` relative to the cwd (the repository root), or `QA_TOKENS_JSON`. Screenshots go to `QA_EVIDENCE_DIR`, default `test-results/qa-a20`, which is git-ignored.
4. **`EROFS` on `node_modules/.vite-temp`** occurs in read-only-`node_modules` sandboxes. Reviewers in the same sandbox need `--configLoader runner` or a disposable clone.
5. **Contract coupling.** The A12 create-denial accepts 403 **or** 404. The contract does not fix which applies when the target BU is unreadable. The BE implements 404 for unreadable and 403 for readable-but-not-permitted.

## 6. Merge instructions

1. Commit `tests/qa/**`, `e2e/**` and `docs/delivery/test-evidence/DG1/qa/T-DG1-QA-authoring/**`. Copy this file to `docs/delivery/handbacks/DG1/T-DG1-QA-qa-verifier.md`. Leave the pre-existing untracked dotfiles out. There are no conflicts: the paths are new and qa-owned.
2. Keep the executable bit on `tests/qa/support/with-pg.sh`, `e2e/support/*.sh` and `e2e/clean-start/a18-clean-start.sh`. `git add` records it.
3. No migrations, no dependency changes and no product changes.
4. **Running the suites:**
   - Integration: `pnpm -r build` is not needed. Run `tests/qa/support/with-pg.sh pnpm test:integration`.
   - e2e: run `pnpm -r build`, then `e2e/support/qa-stack.sh pnpm e2e --workers=1`.
   - Token change: run `e2e/support/a20-token-propagation.sh <disposable clone under $TMPDIR>`.
   - Clean start: run `e2e/clean-start/a18-clean-start.sh [--install]`.

Agent count or agreement does not guarantee correctness. What counts is the independent DG1 review of the frozen candidate, the executed tests and reproducible evidence.
