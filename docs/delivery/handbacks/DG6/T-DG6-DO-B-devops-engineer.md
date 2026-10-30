# Handback T-DG6-DO-B (devops-engineer): Keycloak realms, image pin, e2e login, SAML broker document

- **Stage:** P6, gate DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §J/C.7. Requirement row: **REQ-S16-007** (DO-B's share).
- **Invocation:** `DG6-T-DG6-DO-B-devops-engineer-20261030T180405Z-5eadb398`, session `5eadb398-4161-4daf-a362-1d9f2f6f97a8`. Assignment sha256 `0c863c95…8d3b88d` (verified).
- **Start revision:** branch `dg6/do-b`, `HEAD` = `6b6471b407952f891427256dc6d13b40483fb5a4`, clean tree at start. Changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-30T18:04:22Z`; end: see §9.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. No agent grants a business, Finance or IT approval. Every user, realm and credential is SYNTHETIC. The corporate IdP and the brokered SAML path are **not live** (p6-plan R3).

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (1 min 50 s). Log: `T-DG6-DO-B-evidence/validate-dg5-historical.txt`.

## 1. Files changed

| File | Owner per §J/C.7 | Purpose |
|---|---|---|
| `deploy/keycloak/realm-mth-other.json` (new) | DO-B | SYNTHETIC negative-test realm `mth-other`. It uses the **same** client id `mth-hub` and the same secret placeholder as `mth-test`, so only the issuer and signing keys differ. It also has a user `smoke.admin` with the same e-mail as the hub's bootstrapped admin. No credential: `${...}` placeholders only. |
| `deploy/compose/compose.yaml` (test-idp lines) | DO-B | Keycloak image `quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79…dd6b` (applied by `pin-images.mjs --apply`). The `mth-other` realm is mounted read-only next to `mth-test`. Header comment updated. |
| `deploy/images.lock.json` (keycloak entry) | DO-B | `tag` 26.4 → **26.8.1** (hand-edited: D-197 item 1 / ADR-0054 §1 recommendation). `digest`, `verifiedAt` and `blockedReason: null` were written **by `pin-images.mjs --resolve keycloak`**, not by hand. |
| `e2e/support/keycloak-login.ts` (new) | DO-B | Configuration (enable flag; password **file**, never an env value), Chromium host-resolver mapping for the Compose host name `keycloak`, realm re-addressing, Keycloak login-form helper. Gives a `BLOCKED: …` skip reason when no stack is configured. |
| `e2e/identity/keycloak-login.spec.ts` (new) | DO-B | Two tests × `chromium-en`/`chromium-ar`: (1) sign-in through `mth-test` → session; (2) the hub's own authorization request answered by realm `mth-other` → `/login?error=token_invalid`, the translated alert, `/api/v1/me` 401. |
| `docs/operations/identity-saml-broker.md` (new) | DO-B | The SAML broker document (M0312). Contents: Keycloak SAML 2.0 brokering; the hub-side contract; attribute → claim mappers for `email`/`name`; the fixed `sub` and why it must never change; groups as **input only** (ADR-0006); signing-certificate rotation; logout; IT acceptance steps. States plainly that the path is **not exercised live**. The path matches `SAML_BROKER_DOCUMENT` in `apps/api/src/modules/admin/identity.ts`. |
| `deploy/scripts/tests/pin-images.test.mjs` | **not listed** (see §6) | 4 assertions hard-coded `keycloak:26.4`. They now read the tag from the committed lock, with no other change. Without this, the CI `Deploy tooling self-tests` step fails on the tag move. |
| `licenses/sbom.cdx.json` | **not listed** (DO-A's file; see §6) | Regenerated with `node licenses/generate-sbom.mjs`, no hand edit. The diff is the keycloak component only (`version` → `26.8.1@sha256:…`, "pinned" `NO - BLOCKED…` → `yes`). Without it, `generate-sbom.mjs --check` (a CI step) fails, because the SBOM reads the image lock. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-B-evidence/**` | DO-B | Logs and the stand-in rehearsal tooling (§3.3). These are evidence, not product. |

Final sha256 values:

| File | sha256 |
|---|---|
| realm-mth-other | `1e7210d5…d7e08c9d` |
| compose | `e822f0a2…7f97475b` |
| images.lock | `f72a87fe…6edd6982` |
| support | `ecd2f4cc…5419f4e3` |
| spec | `fcb8cbae…6a6a4386` |
| SAML doc | `62968344…bb0443a3` |
| pin-images.test | `44a86eb2…ca2986e5` |
| sbom | `8bfb4794…2be31ce0` |

## 2. Behaviour delivered: REQ-S16-007

Acceptance text, quoted: **"A18;A12: e2e tests log in through the Keycloak test realm; a token from another realm is rejected"**. Row text: "Login uses OIDC authorization code with PKCE; a Keycloak realm is shipped for tests; SAML is documented through a broker". Owners: backend-workflow-engineer (BE-G); devops-engineer (DO-B).

| Part | Status | Proof |
|---|---|---|
| Keycloak realm shipped for tests | **Done.** `mth-test` (existing) plus `mth-other` (new, negative) | Files; the `docker compose … --profile test-idp config` output shows both mounts and the pinned image (`deploy-tooling-checks.txt`) |
| Image pinned by digest from the vendor-documented registry | **Done.** `quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b` (OCI index; amd64 `sha256:3e1ac632…8dfc`, arm64 `sha256:f259c5f8…e5f9`, ppc64le `sha256:66d935ca…e2ab`). Equals the digest ARCH-02 recorded on 2026-10-26 (ADR-0054 §1 item 2) | `pin-images-keycloak.txt`: `--resolve keycloak` exit 0, `--apply` exit 0, `--check` → `OK: 4 images pinned by digest` exit 0 |
| e2e logs in through the Keycloak test realm | **Spec delivered. Live Keycloak run BLOCKED** (no container runtime). The spec passed 4/4 against a **stand-in IdP**, which is not Keycloak (§3.3) | `container-runtime.txt`; `standin/rehearsal-run-3.txt`, `rehearsal-run-4.txt` |
| A token from another realm is rejected | **e2e: spec delivered.** It passed against the stand-in; on Keycloak it is BLOCKED like the row above. **Integration (always runnable):** BE-G's `apps/api/test/integration/identity/other-realm.test.ts` (other issuer, other audience, other key) ran in this tree's integration suite (§4) | §3.3, §4 |
| SAML documented through a broker | **Done.** `docs/operations/identity-saml-broker.md`. Keycloak console labels are quoted from the Keycloak 26.8.1 Server Administration Guide, fetched 2026-10-30 (sha256 and verbatim excerpts in `keycloak-docs-saml-brokering.txt`). Mapper type names the guide doesn't spell out are marked _(console list)_ | File; evidence excerpt file |

**What the e2e's second test proves, precisely.** The browser starts a real hub login, so the hub holds its state, nonce, PKCE verifier and browser-binding cookie. The hub's authorization request, unchanged, is then sent to realm `mth-other`, and a `mth-other` user signs in. The IdP returns a code issued by `mth-other` (and, with Keycloak and the stand-in, an RFC 9207 `iss` = the `mth-other` issuer) to the hub's callback. The spec asserts:
- exactly one callback carried a `code` and no `error`;
- the `iss` parameter, when present, is `mth-other`'s;
- the hub ended at `/login?error=token_invalid` with the translated alert;
- `/api/v1/me` returns 401.

Whichever check fires first (the response `iss`, the code at `mth-test`'s token endpoint, or the ID token's issuer and signature), no session results. The forged-ID-token cases (a valid code but a token from another issuer, another audience or another key) cannot be produced through a real IdP. They are BE-G's integration test, which also asserts the single `session.login_failed` audit event.

## 3. Checks actually run

Environment: Linux 6.18.44, 4 CPUs, 15 GiB RAM. Node 24.21.0, pnpm 10.33.0, PostgreSQL 16.15 (local binaries, disposable clusters), Chromium from `/opt/pw-browsers` (Playwright 1.56.1). Docker client 29.9.2, Compose v5.6.1. The host was shared with other agents throughout: load average 16–24.

### 3.1 Container runtime and registry (environment facts)

- `docker info` → exit 1, "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock".
- `deploy/scripts/ensure-docker.sh` → exit 3, "BLOCKED: /run is read-only here (sandboxed shell); dockerd cannot create its socket".

So **no container can run here**. `scripts/dev/ensure-docker.sh` (named in my role brief) does not exist; the repository's script is `deploy/scripts/ensure-docker.sh`. Log: `container-runtime.txt`.

- quay.io **is** reachable for manifest lookups: `docker buildx imagetools inspect` worked with `DOCKER_CONFIG` pointed at `$TMPDIR`, because `/root/.docker` is read-only.
- I also tried to run the pinned image's Keycloak distribution **without** a container (host Java 21), by fetching its layers by digest. The environment's permission policy **refused** the layer download. I did not try any other route. So no real Keycloak ran in this task.

### 3.2 Acceptance checks

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.txt` |
| 1 | `pnpm -r build` | 0 | | `build.txt` |
| 1 | `pnpm lint` | 0 | | `lint.txt` (re-run at the end: §9) |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.txt` (re-run at the end: §9) |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.txt` |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **1** | see §3.4 | `test-locale-unset.txt` |
| 2 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | see §3.4 | | `test-c-utf8.txt` |
| 3 | `QA_PG_PORT=26270 MTH_PORT_POOL=26271-26299 tests/qa/support/with-pg.sh pnpm test:integration` | see §4 | | `integration.txt` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | PASS | `validate-dg5-historical.txt` |

Additional checks (`deploy-tooling-checks.txt`, `pin-images-keycloak.txt`, `tsc-e2e-keycloak.txt`, `e2e-keycloak-login-skip.txt`):

- `node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs deploy/scripts/tests/log-scan.test.mjs` (the CI step) → **74/74 pass**, exit 0. pin-images alone: 13/13.
- `node licenses/generate-sbom.mjs --check` → exit 0 after regeneration. It was exit 1 ("STALE") with the new lock and the old SBOM, and exit 0 with HEAD's lock: the staleness came from this task's lock change only.
- `node deploy/scripts/pin-images.mjs --check` → `OK: 4 images pinned by digest and referenced consistently`, exit 0. This is the first time the keycloak entry passes `--check`; D-049's BLOCKED residual for the **pin** is closed.
- `pnpm check:no-cdn` → `PASS no-cdn`, exit 0.
- `docker compose -f deploy/compose/compose.yaml --profile test-idp config` (empty throwaway secret files under `$TMPDIR`) → exit 0. It shows the pinned keycloak image and both realm mounts, read-only.
- **Root `e2e/**` is not covered by `pnpm -r typecheck`** (`apps/web/tsconfig.e2e.json` includes only `apps/web/e2e/**`; the existing root specs are not checked either). So I ran `tsc` on the two new files with the e2e compiler options → exit 0.
- `pnpm exec playwright test e2e/identity/keycloak-login.spec.ts` with no stack configured → **4 skipped**, exit 0. The skip reason starts "BLOCKED: no Keycloak test-idp stack configured …". A skip is not a pass.

### 3.3 Stand-in rehearsal of the e2e (NOT Keycloak; NOT the acceptance proof)

The Keycloak run is impossible here, so I ran the **unchanged** spec against the real built API (`AUTH_MODE=oidc`, `NODE_ENV=development` for the http issuer) serving the built SPA. A **stand-in IdP** replaced Keycloak: `standin/standin-idp.mjs`, derived from DG1's `fake-idp.mjs`. It has two realms with their own issuers and RSA keys, the same client id and secret, Keycloak's form ids, RFC 9207 `iss`, and realm-local codes. Command:

```bash
QA_PG_PORT=26251 MTH_PORT_POOL=26252-26259 tests/qa/support/with-pg.sh \
  docs/delivery/handbacks/DG6/T-DG6-DO-B-evidence/standin/rehearse.sh
```

| Run | Spec state | Result | Notes |
|---|---|---|---|
| 1 | first version | exit 1, 0 tests ran | **Spec defect found:** `test.use({ launchOptions })` inside `describe` is refused by Playwright. Moved to file level. The rehearsal script's role URL also had a `+` encoding bug, which I fixed |
| 2 | after fix 1 | 1 passed, 3 failed | **Two spec defects found:** (a) the anonymous sign-in page renders in Arabic, so the English link name was not found → `ensureLanguage` added; (b) `page.route` on the IdP authorization URL never fired, because Playwright does not intercept requests reached through a redirect → replaced by `page.goto(inRealm(page.url(), …))` after the hub's redirect |
| 3 | final logic | **4 passed** (20.1 s), exit 0 | Slowest test 4.5 s; load average 16.8 → 18.8 |
| 4 | final file (budget comment only) | **4 passed** (19.7 s), exit 0 | Slowest 3.8 s; load average 19.9 → 20.7 |

Database after runs 3 and 4:
- `user_identity`: one row, issuer `…/realms/mth-test`, subject `5f0c7a52-…0001`. **No `mth-other` identity was stored.**
- audit: `session.create` 2 (one per `mth-test` login, en and ar), `session.login_failed` 2 (one per `mth-other` attempt).
- `session` rows: 2.

**Budget (§2 rule 13/15):** 60 s per test. Measured only against the stand-in: worst case 4.5 s at load average about 18 on 4 CPUs, so the budget is more than 13x that. Keycloak's pages are heavier. The first Keycloak run must record its loaded worst case and keep at least 2x headroom. The spec header says so.

### 3.4 `pnpm test` results

Locale unset (`test-locale-unset.txt`, 16 min 4 s, **exit 1**):

| Vitest invocation | Files | Tests |
|---|---|---|
| unit-node | 180 passed | 2745 passed |
| unit-web | **1 failed**, 103 passed (104) | **1 failed**, 1869 passed (1870) |
| unit-formula-nocodegen | 3 passed | 259 passed, 2 skipped |

**The one failure is not caused by this task, and it is deterministic.**
- Test: `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx` › "identity shows whether a client secret is configured, never a secret value". It asserts `document.querySelector("input, textarea")` is null on Administration > Identity.
- What it finds: the shell's **global search input** (`class="global-search__input"`, placeholder "Search records").
- Origin: the test came from T-DG6-FE-B (`71e013b96`), and the search input from T-DG6-FE-D (`480717236`). Both are already merged at `HEAD` `6b6471b4`.
- This task changes nothing under `apps/web` (`git diff --stat HEAD -- apps/web` is empty).
- It is a merge interaction between FE-B and FE-D, and it is open for the orchestrator or FE owner. The likely fix is to scope the query to the page's `main` region. I did not edit the file (not mine).

`LANG=LC_ALL=C.UTF-8` (`test-c-utf8.txt`, 24 min 24 s, **exit 1**). This run overlapped my integration run, at load average 21–27:

| Vitest invocation | Files | Tests |
|---|---|---|
| unit-node | 180 passed | 2745 passed |
| unit-web | **2 failed**, 102 passed (104) | **2 failed**, 1868 passed (1870) |
| unit-formula-nocodegen | 3 passed | 259 passed, 2 skipped |

The two unit-web failures:
1. The same deterministic `p6-admin-screens.test.tsx` failure as above.
2. `apps/web/src/pages/dependencies/slips.test.tsx` › "names the dependency, the slip in days, …" (en): **"Test timed out in 20000ms"**. This is a **load timeout**. It passed in the locale-unset run. Re-run alone under `C.UTF-8` at load average about 22 (`test-c-utf8-rerun-two-files.txt`): `slips.test.tsx` **8/8 passed** in 4.3 s, and `p6-admin-screens.test.tsx` failed again with the same assertion (deterministic). I am disclosing this as a flake under load (F-DG4-143 class). It is not caused by this task (no `apps/web` change).

**Acceptance item 2 is therefore not met as "passes"** in either locale. The only deterministic failure belongs to another task's merged code (§8 item 4).

## 4. Integration suite

Command: `QA_PG_PORT=26270 MTH_PORT_POOL=26271-26299 tests/qa/support/with-pg.sh pnpm test:integration` (`integration.txt`). It started at 18:52Z alongside the `C.UTF-8` unit run, with host load average 20–27 from other agents. It **completed after the handback's first version**, in 70 min 37 s, with **exit 1**:

- **Test files:** 3 failed, 382 passed (385).
- **Tests:** 4 failed, 3965 passed, 1 skipped, 2 todo (3972).

Pinned-count changes: none (no API, contract or schema change in this task). None of the failures touches this task's files.

| Test | Result | Re-run alone | Assessment |
|---|---|---|---|
| `assistant/conversations.test.ts` › "over the per-minute budget a post is 429 …; each post writes one log line without the prompt" | `toMatchObject`: the log line has `replyKind: "answer"`, `dataItems: 1`; the test expects `no_sources`, `0` | **Fails again** (`integration-assistant-rerun.txt`, 1 failed / 16 passed) | **Deterministic**, in the assistant slice (BE-T/BE-U with the search index). Open for its owner |
| `admin/security.test.ts` › "getSecurityRateLimits › ADM_TECH and AUD read every class …" | deep-equal: class `webhook` now lists `operationIds: ["receiveWebhook", …]`; the test pins `[]` | not re-run | A pinned expectation that went stale after the webhook routes merged (BE-E's test vs BE-N). Deterministic by its nature. Open for its owner |
| `contract/response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)" | `expected [] to have a length of 1 but got +0` (`p5-exercises-be-j.ts:61`) | not re-run (time) | Unknown; needs a re-run by the orchestrator. This task changes no API code |
| same file › "every operation: an undeclared request media type is a declared 400 validation.content_type" | "Test timed out in 30000ms" | not re-run (time) | A timeout under load average about 25. This task changes no API code |

**Targeted run of this requirement's integration proof** (`integration-identity-only.txt`, its own disposable cluster on port 26290): `npx vitest run --project integration apps/api/test/integration/identity` → **2 files, 26/26 passed**, exit 0. That covers `identity.test.ts` (13) and BE-G's `identity/other-realm.test.ts` (13): other issuer, other audience and other key are each refused with `session.login_failed` and no session.

## 5. Operations, contract, schema, migration, dependency

- **Operations routed:** none. DO-B owns no `p6-pending-*.ts` list (§J/C.7 lists none). Delta to the pending lists: **0**. No contract change. `openapi.yaml` is untouched (932 operations). Pinned counts in `contract.test.ts`: no change.
- **Migration:** none.
- **New dependency:** none. Keycloak is a pinned **test** container image, already in the lock since P1. Only its tag and digest moved, as D-197 item 1 decided.
- **For the orchestrator:**
  1. **Registry and tag:** `quay.io` by digest, 26.4 → 26.8.1, as D-197 item 1 decided. If you want to re-verify, run `DOCKER_CONFIG=$TMPDIR/dc node deploy/scripts/pin-images.mjs --resolve keycloak && node deploy/scripts/pin-images.mjs --apply && node deploy/scripts/pin-images.mjs --check`. It should be a no-op apart from `verifiedAt`.
  2. **The CI `images` job's** `--resolve --missing` step now finds nothing missing, and exits 0 without a registry call (pin-images test C12).

## 6. Files outside my listed ownership (please accept or redo at merge)

1. `deploy/scripts/tests/pin-images.test.mjs`: 4 hard-coded `26.4` assertions now read the tag from the lock (constant `KC_IMAGE`). The behaviour under test is unchanged, and 13/13 pass. Without the change, CI's "Deploy tooling self-tests" step fails.
2. `licenses/sbom.cdx.json`: regenerated by the generator after the lock change (keycloak component only). DO-A owns it. You may prefer to regenerate it yourself at merge: `node licenses/generate-sbom.mjs && node licenses/generate-sbom.mjs --check`.

## 7. User-facing texts made untrue, and what I did

The product UI strings are still true: `adminP6.identity.saml` / `samlDoc` / `issuerHint` / `residual`, en and ar, all point at a document that now exists, and they claim nothing live. The operations documents below are not my files, so I list them for their owners:

| File:line | Now untrue | Proposed correction |
|---|---|---|
| `docs/operations/restricted-network.md:38` | Image table says `quay.io/keycloak/keycloak` `26.4` | `26.8.1`, pinned by digest (`deploy/images.lock.json`) |
| `docs/operations/configuration.md:105–106` | "SAML-only IdPs need an OIDC broker; this is documented for P6." | "… documented in `identity-saml-broker.md`." |
| `docs/operations/configuration.md:108–125` | Lists only realm `mth-test` | Add `realm-mth-other.json` (negative test realm; the hub is never configured for it) |
| `docs/operations/configuration.md:123–124` | Browser sign-in from the host needs a hosts-file entry | Still true for people. The e2e uses Chromium's `--host-resolver-rules` instead; optional mention |
| `docs/operations/README.md` (index tables) | No entry for `identity-saml-broker.md` or `deploy/keycloak/realm-mth-other.json` | Add both rows |
| `docs/delivery/environment.md:100` (DO-C's residual row) | "The image pin moves to `quay.io/keycloak/keycloak` by digest" | "Pinned: `26.8.1@sha256:a78d6b79…dd6b` (T-DG6-DO-B)". The e2e stays BLOCKED without a container runtime; the stand-in rehearsal passed |
| `deploy/ci/ci.yml:232–237` (and `.github/workflows/ci.yml:213–218`) | Comment: "the committed lock records the TEST-ONLY keycloak image … as BLOCKED (null digest)" | "… the committed lock pins every image; this step resolves any image still missing a digest (none at present)" |

## 8. What remains

1. **The live Keycloak e2e: BLOCKED** (no container runtime: `docker info` exit 1, `/run` read-only). To run it on a host with Docker, follow the steps in `e2e/support/keycloak-login.ts`:
   - `init-secrets.sh`, then `build-image.sh`;
   - `docker compose -f deploy/compose/compose.yaml --profile test-idp up -d --wait`;
   - bootstrap `smoke.admin` by subject;
   - `MTH_E2E_KEYCLOAK=1 MTH_E2E_KEYCLOAK_PASSWORD_FILE=… E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/identity/keycloak-login.spec.ts`.

   Then record the loaded worst case and confirm the 60 s budget. Not yet verified on real Keycloak 26.8.1:
   - the form ids `kc-form-login`, `username`, `password`, `kc-login` (keycloak.v2 theme);
   - realm import with `${...}` placeholders;
   - that Keycloak's authorization response to a foreign-realm request reaches the callback rather than an IdP error page.

   The stand-in proved the spec mechanics, not these Keycloak facts.
2. **The brokered SAML path: not live** (no SAML IdP). It is a documented residual for Mobily IT (`identity-saml-broker.md` §4).
3. Root `e2e/**` has no `tsc` coverage in `pnpm -r typecheck`. This predates the task; it could be added to `apps/web/tsconfig.e2e.json` by its owner.
4. The `p6-admin-screens.test.tsx` failure (§3.4): FE-B/FE-D interaction, open for the owner. The four integration failures (§4): open for their owners and the orchestrator.
5. The texts in §7, for their owners.

## 9. End-of-run checks and timing

- Final re-runs on the final tree (after the last spec change):
  - `pnpm lint` → exit 0 (`lint-final.txt`);
  - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` → exit 0 (`prettier-final.txt`), re-run once more after this handback was written: see the last line of `prettier-final.txt`;
  - `tsc` on the two e2e files → exit 0.
- `pnpm -r typecheck` (exit 0) and `pnpm -r build` (exit 0) ran at 18:15–18:30Z. After them, only `e2e/**` and non-TypeScript files changed, so the separate `tsc` covers the change.
- The integration suite finished at about 20:02Z (§4). This handback was updated with its final counts at 20:03Z.
- Time: start 18:04:22Z; end 19:45:08Z (`date -u`). Handback written about 19:45Z (about 101 minutes). The integration suite was still running at that point (§4).

### Summary against the assignment's acceptance list

| # | Item | Status |
|---|---|---|
| 1 | typecheck, build, lint, prettier, openapi:lint | **all exit 0** |
| 2 | `pnpm test` in both locales | **exit 1 in both.** One deterministic failure that is not mine (`p6-admin-screens.test.tsx`, FE-B × FE-D). One load timeout under `C.UTF-8` (`slips.test.tsx`) that passes alone |
| 3 | integration | **exit 1: 3965 passed, 4 failed** (3 files of 385), all in other slices: 2 deterministic (assistant log line; a stale security rate-limit pin), 1 unknown (P5 BE-J exercise), 1 timeout under load. This task's identity tests: 26/26 |
| 4 | `validate.mjs --historical --stage DG5` | **exit 0** |
| — | REQ-S16-007 DO-B share | realms, pin, e2e spec, SAML document delivered. Keycloak e2e **BLOCKED** (no container runtime); the spec passed 4/4 against a stand-in IdP (not Keycloak) |
