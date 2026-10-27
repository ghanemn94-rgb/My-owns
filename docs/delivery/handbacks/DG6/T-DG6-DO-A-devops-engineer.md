# Handback T-DG6-DO-A: dependency audit and environment template (devops-engineer)

- **Stage:** DG6 (BUILDING), P6 "Integration and system hardening". Section `docs/architecture/p6-work-split.md` §E/F.11, plus the D-198 additions (`.env.example`, `configuration.md`) and the D-197 SBOM refresh.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-DO-A-devops-engineer-20261027T010302Z-f4cfca0c","session_id":"f4cfca0c-1917-4f7b-b10a-35431a72a312"}`. Assignment sha256 `fbca6be2…f08a9` (verified).
- **Tree:** worktree `/home/user/wt/dg6-do-a`, branch `dg6/do-a`, base `HEAD` `5e4cbad20917cb4f50517981d15fb87441fedfc5`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started 2026-10-27 01:03:14 UTC; finished at the `date -u` in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0** at the start (01:03 UTC). It was re-run at the end (§3).

## 0. Headline: the dependency audit finds 20 High advisories on shipped packages

The control the assignment asks for works, and on this tree it **fails**. This needs an orchestrator decision before DG6 can pass, because 20 High advisories are open on shipped components.

- **The live audit is not BLOCKED here.** ADR-0052 §6 and §E/F.11 expected `pnpm audit` to be BLOCKED in the sandbox. It is not. The registry's advisory service is reachable through the build environment's egress proxy, once `registry.npmjs.org` is allowed for the command and npm's `noproxy` setting (which sends the registry direct, where DNS fails with `EAI_AGAIN`) is overridden. I ran it, and its exit code was 1:
  - `pnpm audit --audit-level high --prod` reported **43 vulnerabilities: 5 low, 18 moderate, 20 high, 0 critical** over 182 production dependencies.
  - Evidence: `T-DG6-DO-A-evidence/pnpm-audit-live-prod.txt` (table) and `pnpm-audit-live-prod.json` (full JSON), 2026-10-27 01:07–01:08 UTC.
- **The offline check reproduces it exactly.** The snapshot (retrieved 01:12:11 UTC from the same service) gives 20 High on shipped components, 18 Moderate (12 runtime + 6 bundled) and 5 Low. That is an independent cross-check of the range evaluator against the registry's own evaluation.
- **The affected shipped packages** (orchestrator decision; D-195 "no new dependency" puts version changes with the orchestrator):

| Package (scope) | Locked | Advisories (High) | Fixed in | Latest in line (registry, 2026-10-27) | Note |
|---|---|---|---|---|---|
| `fastify` (runtime, apps/api) | 5.6.1 | 6 (GHSA-jx2c-rxcm-jvmq, -247c-9743-5963, -667r-xxjv-c9mm, -p68q-wchp-6fh7, -hwr6-493r-vm6h, -9q9j-q6p8-xq58) | ≥ 5.12.2 | 5.12.7 | same major; includes an authentication bypass via malformed URLs reaching not-found handlers |
| `@fastify/static` (runtime) | 8.2.0 | 1 (GHSA-83w8-p2f5-377r, route guard bypass via path traversal) | ≥ 10.1.1 | 10.1.7 | **major** upgrade (8 → 10) |
| `kysely` (runtime) | 0.28.7 | 3 (GHSA-wmrf-hv6w-mr66, -8cpq-38p9-67gx (MySQL only), -pv5w-4p9q-p3v2) | ≥ 0.28.17 | 0.28.18 (`release-0.28`) | JSON-path injection; the product uses PostgreSQL |
| `zod` (runtime) | 4.1.12 | 1 (GHSA-mrhx-c7xc-m3w5, memory exhaustion) | ≥ 4.6.6 | 4.6.7 | same major |
| `react-router` (bundled, apps/web) | 7.9.0 | 7 (GHSA-2w69-qvjg-hvjx, -49rj-9fvp-4h2h, -8646-j5j9-6r62, -8x6r-g9mw-2r78, -rxv8-25v2-qmq8, -chx6-hx7r-mcp5, -8v8x-cx79-35w7) | ≥ 7.18.0 | 7.18.4 (`version-7`) | several apply to SSR/RSC/framework mode, which a SPA may not use; that applicability is not analysed here |
| `image-size` (runtime, via `packages/reporting` → `pptxgenjs`) | 1.2.1 | 2 (GHSA-5p2g-fcmc-qvqq, -w3rx-r6r6-pgpr; DoS infinite loop on JXL/HEIF/ICNS) | ≥ 2.0.3 | 2.0.4; no patched 1.x | `pptxgenjs@4.0.1` is the latest version and requires `image-size ^1.2.1`, so the fix needs a pnpm override to 2.x (an API-compatibility risk for pptxgenjs) or a recorded risk decision |

- **Development-only toolchain, never shipped**, so not failing by design:
  - `vitest@3.2.4`: Critical GHSA-5xrq-8626-4rwp, fixed in < 3.2.6;
  - `tinypool@1.1.1`: Critical GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr;
  - `vite@7.1.11`: 4 High.

  These still run on developer and CI machines, so I recommend upgrading them together with the shipped packages.
- **Consequence for the acceptance checks.** Per ADR-0052 §6, the offline check "runs in `pnpm test`" and "fails on a matching High/Critical advisory". So `pnpm test` exits 1 on this tree, with exactly **one** failing test: `deploy/scripts/tests/dep-audit.vitest.mjs > the committed tree > no High/Critical advisory …`. Every other test passes (§3).
  - Assignment acceptance 2 ("`pnpm test` passes") and §E/F.11 ("passes on the committed snapshot") assumed a clean snapshot. They contradict the measured advisory state, and per the protocol I report the contradiction rather than resolving it.
  - I did **not** add a waiver or exception list, mark the test `skip`/`fails`, or commit a trimmed snapshot. Any of these would be an engineering agent accepting a security risk.
  - The orchestrator's options are:
    - (a) upgrade the packages above, then `node licenses/generate-sbom.mjs && node deploy/scripts/dep-audit.mjs --refresh` (the new versions are otherwise reported as "not covered" and fail);
    - (b) record a risk decision. That is the user's or Mobily IT's call, not an agent's, and it would need a design change to ADR-0052 §6, which today has no waiver mechanism.
- **Finding proposal (for a reviewer to raise; I do not allocate ids):** REQ-S16-030, severity **High**, `mandatory_violation: true` (security). Shipped production dependencies carry 20 published High advisories. Reproduce with `node deploy/scripts/dep-audit.mjs` (offline) or `pnpm audit --audit-level high --prod` (live).

## 1. Changed files

| File | Purpose |
|---|---|
| `deploy/scripts/dep-audit.mjs` (new) | Offline SBOM-vs-snapshot check (ADR-0052 §6). See the bullets below the table. |
| `deploy/advisories/snapshot-2026-10-27.json` (new) | The dated advisory snapshot. Source: `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` (GitHub Advisory Database as served by npm, CC-BY-4.0). `retrieved_at` 2026-10-27T01:12:11.669Z. Queried 465 package versions (448 names) of the SBOM with lockfile sha256 `d7e795c9…711895`; 60 advisories on 14 packages. sha256 `c98f0397…63feff` (after `prettier --write`). |
| `deploy/scripts/tests/dep-audit.vitest.mjs` (new) | 30 Vitest tests, listed below the table. |
| `deploy/scripts/tests/fixtures/dep-audit/{sbom.json, snapshot-clean.json, snapshot-negative.json, snapshot-uncovered.json, snapshot-unsupported-range.json}` (new) | **Synthetic** fixtures: invented packages and advisories, labelled so in each file's `source`. |
| `vitest.config.ts` | **One named include line** in project `unit-node`: `"deploy/scripts/tests/**/*.vitest.mjs"`, so the offline check runs in `pnpm test` as ADR-0052 §6 requires. This root file is outside §E/F.11's list. It is the only way to satisfy "runs in `pnpm test`", so the orchestrator should confirm it. |
| `deploy/ci/ci.yml` | New job `dependency-audit` (`needs: delivery-gates`). Its steps: sandboxed install → `generate-sbom.mjs --check` → **live** `pnpm audit --audit-level high --prod` → offline `dep-audit.mjs` (step-level `if: ${{ !cancelled() }}`, so both results are reported). `images` now `needs: [integration, e2e, dependency-audit]`, so no image is built or pushed while a High/Critical advisory is open. |
| `.env.example` | Regenerated with `node deploy/scripts/generate-env-example.mjs`: 30 variables, names only. It adds the five rate-limit class variables, `SECRETS_DIR`, `MTH_ENV` and `MTH_DEMO_ADMIN_DATABASE_URL` (the 8 names `--check` reported missing at HEAD). |
| `docs/operations/configuration.md` | New sections "Secret providers" (`SECRETS_DIR`, the `env`/`file` providers, the file-name rule, the worker wiring still pending under D-198/BE-J, no vault claimed) and "Rate-limit classes" (all 7 classes with variable, default, key and the operations wired in this tree). |
| `docs/operations/dependency-audit.md` (new) | Live vs offline audit, the SBOM scopes, refreshing the snapshot (proxy and mirror variants), restricted networks, who decides on a failure. |
| `docs/operations/README.md` | Index rows for the new guide, `deploy/advisories/` and `dep-audit.mjs`. |
| `licenses/lib/lockfile.mjs` | **SBOM correctness fix**, details below the table. |
| `licenses/sbom.cdx.json`, `licenses/inventory.csv` | Regenerated: 465 packages (158 runtime, 15 bundled, 292 development), 4 containers, 0 shipped without a licence id. |
| `licenses/README.md` | The runtime-closure rule, the override mechanism and the DG6 state. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-A-devops-engineer.md`, `…/T-DG6-DO-A-evidence/*` | This handback and its logs. |

**`dep-audit.mjs`, in more detail:**

- It fails (exit 1) on a High or Critical advisory matching a **shipped** component (`runtime`/`bundled`), or on a shipped component the snapshot never queried. Unknown is never a pass.
- It prints the snapshot's source, retrieval date and age, and says that it is not the live audit.
- `--refresh` (network) writes a new dated snapshot. `--max-age-days` is optional.
- It refuses range syntax it cannot evaluate (exit 2).
- It uses the Node standard library only.

**`dep-audit.vitest.mjs` covers:**

- SemVer precedence and range evaluation, including refusal of `^`/`~`/x-ranges;
- the negative fixture: a High and a Critical match on shipped entries, which fails;
- the clean fixture, which passes, with a dev-only Critical and a shipped Moderate listed but not failing;
- an uncovered shipped component, which fails;
- snapshot validation;
- the CLI on the fixtures (exit codes 1/0/1/2, the age line, the "not the live registry audit" line);
- the committed tree: a dated snapshot with source and date exists, and the SBOM has no High/Critical match against it (**this one fails, see §0**).

**`licenses/lib/lockfile.mjs`, in more detail:**

- `RUNTIME_IMPORTERS` was a hand-kept list (the F-DG1-202 class) that missed `packages/reporting`, which `apps/api` and `apps/worker` link in production. As a result 47 shipped packages (`pdfkit`, `docx`, `pptxgenjs`, `jszip`, `image-size`, the fonts, …) were inventoried as `development`, although the image ships them, because `assemble-runtime.sh` already follows workspace links. The new `linkedImporters()` follows production `link:` dependencies from the lockfile.
- That correction surfaced `png-js@1.1.0` (a pdfkit dependency) as shipped with no `license` field. `LICENSE_FILE_OVERRIDES` takes MIT from the package's own LICENSE file, pinned to that file's sha256 `bdb26a2e…4c75c3`, so a changed or missing file reverts to `NOASSERTION`.

## 2. Behaviour delivered, per requirement row

**REQ-S16-030** (owners backend-workflow-engineer; devops-engineer). The acceptance text, quoted: *"A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass"*. The row's DO-A part is "dependency checks" / "Dependency audit in CI" (the description and the "dependency audits run in CI" control text).

- **Delivered:**
  - the CI job `dependency-audit` with the live `pnpm audit --audit-level high --prod`;
  - the offline SBOM check against a dated, committed advisory snapshot that records its source and retrieval date, with a negative fixture test;
  - the check runs in `pnpm test`.
- **Result on this tree:** the dependency audit **FAILS**, live and offline: 20 High on shipped packages (§0). The A12 clauses themselves (CSRF, SQL injection, XSS, upload type and size, rate limiting) are BE-E2's security suite, not this task.
- **The "secret-management interface" part** is BE-E's (`SecretProvider`). My part is its documentation (`SECRETS_DIR`) in `configuration.md`.

**D-198 additions:**

- `.env.example --check` now exits 0 (it failed at HEAD for 8 names).
- `SECRETS_DIR` and the five class budget variables are documented in `configuration.md`. So are the global and auth rows, for completeness.

**D-197 (SBOM refresh for `@aws-sdk/client-s3@3.1156.0` and `nodemailer@10.2.1`):** **not yet possible.** Neither package is in `pnpm-lock.yaml` at `5e4cbad` (`grep` finds no match). The SBOM was regenerated for the current lockfile, which had drifted since the last generation (`--check` printed `STALE` at HEAD). When the two packages land, run the following and commit the result:

```bash
node licenses/generate-sbom.mjs
NODE_USE_ENV_PROXY=1 node deploy/scripts/dep-audit.mjs --refresh
npx prettier --write deploy/advisories/
```

Until the snapshot is refreshed, the offline check reports them as "not covered" and fails.

## 3. Checks actually run

Environment:

- Linux 6.18.44 (sandboxed agent run); Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`).
- pnpm from `packageManager`; PostgreSQL from `with-pg.sh` (newest `/usr/lib/postgresql/*/bin`); harness ports 23900–23949.
- No Docker was used (none needed).
- The network was used only for `registry.npmjs.org` (the audit, the snapshot and the version lookups), through the build environment's egress proxy.
- Logs are under `docs/delivery/handbacks/DG6/T-DG6-DO-A-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start, 01:03) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |
| 1 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0`, no output | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 910 operations` | `openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (01:22:24–01:29:16) | **1** | unit-node **1 failed** \| 2454 passed (2455; files 1 failed \| 155 passed); unit-web 1768 passed (96 files); unit-formula-nocodegen 259 passed \| 2 skipped (261; the 2 skips are in `packages/shared/src/formula/fuzz.test.ts`, pre-existing, not mine). **The only failure is the designed audit failure (§0).** | `test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (01:29:16–01:41:51) | **1** | identical counts to row 6, the same single failure | `test-c-utf8.log` |
| 8 | `QA_PG_PORT=… MTH_PORT_POOL=… tests/qa/support/with-pg.sh pnpm test:integration` | run 1: **1**; run 2: not finished | **NOT COMPLETED**, see §3a | `test-integration-run1.log`, `test-integration-run2.log`, `test-integration-*-isolated.log` |
| 9 | `pnpm audit --audit-level high --prod` (live; with `npm_config_noproxy=localhost,127.0.0.1`, `npm_config_https_proxy=$HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`) | **1** | 43 vulnerabilities: 5 low, 18 moderate, 20 high (a High fails `--audit-level high`) | `pnpm-audit-live-prod.txt`, `.json` |
| 10 | `node deploy/scripts/dep-audit.mjs` (offline, committed tree) | **1** | 20 High on shipped, 0 uncovered; 40 listed not failing | `dep-audit-offline.log` |
| 10b | same with `--sbom fixtures/sbom.json --snapshot fixtures/snapshot-negative.json` / `snapshot-clean.json` | 1 / 0 | the negative fixture fails; the clean one passes | `dep-audit-offline.log` |
| 11 | `node deploy/scripts/generate-env-example.mjs --check` | 0 | `OK: .env.example lists exactly the 30 ENV_VARS names, none with a value` (exit 1 at HEAD, 8 missing) | `deploy-checks.log` |
| 12 | `node licenses/generate-sbom.mjs --check` | 0 | `packages=465 runtime=158 bundled=15 development=292 containers=4 shipped-without-licence-id=0` (exit 1 `STALE` at HEAD) | `deploy-checks.log` |
| 13 | `node deploy/scripts/check-ci-needs.mjs deploy/ci/ci.yml`; `node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs` | 0; 0 | 6 jobs, `dependency-audit <- delivery-gates`, `images <- integration, e2e, dependency-audit`; 59/59 pass | `deploy-checks.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG5` (end, 02:41:47) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |

The live audit is **not** reported as BLOCKED, because it ran. Its earlier failures in this session are disclosed for honesty:

- first attempt: `EAI_AGAIN` (npm `noproxy` sends the registry direct; there is no DNS in the sandbox);
- second attempt: `ECONNREFUSED 127.0.0.1:44777` (npm's own proxy setting points at a port that doesn't exist in the sandbox);
- third attempt: ran, with the result above.

### 3a. Integration: **NOT COMPLETED within the time limit; not reported as passed**

The host was heavily loaded throughout: 4 CPUs, load average 16–24, from the concurrent W4 runs. The integration suite (326 files, run serially by design) could not finish inside the 2-hour limit.

| Run | Command | Window | Result | Log |
|---|---|---|---|---|
| 1 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh pnpm test:integration` | 01:41:57–01:48:22 | **exit 1, aborted** | `test-integration-run1.log` |
| 2 | `QA_PG_PORT=23910 MTH_PORT_POOL=23911-23949 tests/qa/support/with-pg.sh pnpm test:integration` | 01:48:51 (load 20.09) to ≈02:48 | **stopped by the agent runtime's background time limit** at ≈02:48 with no summary and no exit code. **186 of 326 files** reported: 184 passed and 2 had failures (listed below). Not restarted, because the time limit had passed. | `test-integration-run2.log` (partial; the stop is noted at its end) |
| iso-1 | `QA_PG_PORT=23930 … with-pg.sh pnpm vitest run --project integration apps/api/test/integration/portfolio/budget.test.ts` | ≈02:29 | exit 0, **13/13 passed** | `test-integration-budget-isolated.log` |
| iso-2 | `QA_PG_PORT=23935 … with-pg.sh pnpm vitest run --project integration apps/api/test/integration/reporting/registers-report.test.ts` | 02:39:19–02:40:11 | exit 0, **5/5 passed** | `test-integration-registers-isolated.log` |

**Run 1** aborted with exit 1 and no summary. Two things happened:

- `contract.test.ts` had 1 failure: "every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written" → `Test timed out in 30000ms` (39 s).
- Then a tinypool worker died: `Unhandled Rejection: Error: Channel closed` (`ERR_IPC_CHANNEL_CLOSED`).

**Run 2**, at the last check:

- `contract.test.ts` passed **101/101**, so run 1's timeout was not reproduced.
- `portfolio/budget.test.ts` showed 13/13 skipped (a `beforeAll` error, 17.7 s, below the 30 s hook timeout). Its message only prints in the final summary, which wasn't reached. The file passes 13/13 alone (iso-1).
- `reporting/registers-report.test.ts` had 1 failure: "size limit (ADR-0045 §1) > 5,001 rows -> 422 report.too_large …" timed out at 120,008 ms. The file passes 5/5 alone (iso-2).

**Assessment.** None of these files is touched by this task. The change set has no API, database, contract or integration-test code. The only shared file, `vitest.config.ts`, gained one include line in project `unit-node`, and the `integration` project is unchanged. Every observed failure is a timeout or worker crash that does not reproduce in isolation, which fits the load (F-DG4-143..148 class).

Still, the full integration acceptance (assignment item 3) is **not met by this run**. The orchestrator should re-run it on the merged tree on a quieter host. Pinned-count change from this task: **none**.

## 4. Operations routed (pending-list delta)

None. DO-A has no API operations and no `p6-pending-do-a.ts` / `p6-exercises-do-a.ts`, and `contract.test.ts` is untouched. Pinned-count deltas: **none** (operation count, media types, rate-limit floor and CSRF-exempt routes are unchanged).

## 5. Contract, schema, dependency and orchestrator needs

1. **Dependency decision (blocking, §0):** upgrade `fastify` → ≥ 5.12.2, `@fastify/static` → ≥ 10.1.1 (major), `kysely` → ≥ 0.28.17, `zod` → ≥ 4.6.6, `react-router` → ≥ 7.18.0, and decide `image-size` (override to ≥ 2.0.3, or a recorded risk decision by the user or IT). Recommended alongside: `vitest` → ≥ 3.2.6 and the `vite`/`tinypool` it pulls. Then regenerate the SBOM, refresh the snapshot, format it and commit (§2).
2. **Install the workflow:** `deploy/ci/ci.yml` must be copied verbatim to `.github/workflows/ci.yml`. My run cannot write `.github/` (`cp: cannot create regular file '.github/workflows/ci.yml': Read-only file system`). The two were identical at `5e4cbad`.
3. **Frozen-file line:** `vitest.config.ts` gains one include line (§1). Please confirm it.
4. **ADR-0052 §6 wording:** "In this sandbox the live audit is BLOCKED" no longer holds. The live audit runs through the egress proxy (§3 row 9). ADR edits are the architect's, so I leave the wording to them. `docs/operations/dependency-audit.md` describes BLOCKED only for networks without the advisory service.
5. **No migration, no contract change, no new dependency.** The snapshot is data (ADR-0052 "Dependencies").
6. **D-197 follow-up:** refresh the SBOM and snapshot once `@aws-sdk/client-s3` and `nodemailer` are in the lockfile (§2).

## 6. User-facing texts made untrue

None. No en/ar UI string mentions the dependency audit, SBOM, advisories or `SECRETS_DIR` (`grep` over `apps/web/src/i18n`). In the operations documentation I avoided two untrue statements:

- `configuration.md` says the Administration > Security **page** is a planned frontend item (FE-B), since only the API read model exists in this tree.
- It says the worker's `SecretProvider` registration is pending (D-198 → BE-J).

`configuration.md` still has "SAML-only IdPs need an OIDC broker; this is documented for P6" and "The optional S3-compatible adapter is a later-stage item (P6)". Those are DO-B's and DO-C's sections and stay true until their tasks land.

## 7. What remains

- **The dependency upgrade decision and its execution** (§0, §5.1). Until then `pnpm test` has one failing test by design, and the CI `dependency-audit` and `images` jobs fail.
- Installing `.github/workflows/ci.yml` (§5.2).
- The D-197 SBOM and snapshot refresh after the two new dependencies land (§2).
- Not done here, by design: the live audit on GitHub-hosted CI (it runs only where CI runs), and any applicability analysis of the individual advisories, which is the security reviewers' and IT's call.

## 8. End

- Ended at 2026-10-27 **02:42 UTC**, about 99 minutes after the 01:03:14 start. I stopped at the ~100-minute mark as the assignment requires.
- At that point the tree typechecks, builds, lints and is prettier-clean (§3 rows 1–4; nothing changed after those runs except this handback and its evidence logs, which are prettier-checked).
- Integration run 2 was stopped by the runtime's background time limit at ≈02:48, after 186 of 326 files. Its log is partial and is **not** claimed as a result.

**Acceptance summary:**

| Item | Result |
|---|---|
| 1. typecheck, build, lint, prettier, openapi lint | all exit 0 |
| 2. `pnpm test` (both locales) | exit 1 in both: exactly one failure, the designed dependency-audit failure on 20 real High advisories (§0); everything else passes, with identical counts |
| 3. Integration | **not completed** (§3a) |
| 4. `validate --historical --stage DG5` | exit 0 at start and end |
