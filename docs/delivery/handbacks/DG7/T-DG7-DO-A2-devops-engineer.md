# Handback T-DG7-DO-A2 (devops-engineer): repair P-1 and P-2; move `tool.node` out of the archive manifest

- **Stage / gate:** P7, DG7 (BUILDING). This is engineering work only, not a business, Finance or IT approval. Product gate G6 does not imply DG7, and DG7 does not imply G6.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-A2.md` (sha256 `7470184231bfed389e0cb9bd3baa09075c8d275352009a42fa77d86f25b8e3b1`, checked at start). Inputs: D-246; `T-DG7-DO-A-devops-engineer.md` §4 (D4) and §5 (P-1, P-2, Q1); ADR-0062; `p7-work-split.md` §A.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-A2-devops-engineer-20261112T154234Z-07e799ff","session_id":"07e799ff-be01-4f60-ad43-c21ab8609a03"}`.
- **Base:** `092a7dec6adb449977b733c3d405c9059facb0ab` (`HEAD`, branch `claude/mobily-transformation-platform-dg6-regate`). Nothing is committed; the changes are in the working tree.
- **Time:** start 2026-11-12T15:42:44Z, last check 16:07:29Z, handback about 16:10Z (`date -u`).
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-DO-A2-evidence/`. In the logs, `$TMPDIR` stands for this run's private scratch directory.

## 0. Summary

| Item | Result |
| --- | --- |
| P-1 fix plus regression test | Done. The new test **passes** on the new parser (5/5, exit 0) and **fails** on the old expression (3 of 5 fail, exit 1). |
| P-2 fix | Done. The assembled tree has no `.modules.yaml`, no `.pnpm-workspace-state-v1.json`, no `.bin` directory and no assembly path. |
| Q1 (`tool.node` moved to `build-report.json`), tests, ADR-0062 §4.2 amendment | Done |
| **T-A5** (build from the unpacked archive, no network) | **PASS** |
| **T-A11** (asset scan on the real assembled tree) | **PASS** |
| Rest of the `tools/release` and `licenses` tests | 57 pass, 0 fail, 1 skip (bsdtar not installed) |
| `clean-start-local.sh` phase A | **The repository script was NOT RUN**: its full clone does not fit the disk (§3.3). A **derived** phase A on the real stripped runtime tree passed A1–A6. |
| `pnpm lint`, prettier, `validate.mjs --historical --stage DG6` | exit 0, exit 0, exit 0 |

## 1. Files changed

| File | Change |
| --- | --- |
| `deploy/scripts/check-virtual-store.mjs` (new) | P-1. The shipped-set check that was inline in `assemble-runtime.sh` (l.117–135), moved to a module so it can be tested. `parseVirtualStoreDir` matches `^(@[^@/]+\|[^@/]+)@([^_/@]+)(?:_.+)?$`: a name with no `@` inside, then `@`, then the version up to the first `_`, then an optional peer suffix. A scope's `+` is mapped back to `/`. An unparseable name is reported as not shipped, never skipped. CLI exit codes: 0 PASS, 1 FAIL, 2 BLOCKED (usage error or unreadable input). Output lines are the same as before. |
| `deploy/scripts/tests/check-virtual-store.test.mjs` (new) | Regression test (5 tests). Covers `string_decoder@1.1.1` unchanged, `react-dom@19.1.0_react@19.1.0` → `react-dom@19.1.0`, a scoped name with `_`, a peer suffix on an `_` name, build metadata, unparseable names, fixture stores through the module and the CLI, exit 2, and a static guard that `assemble-runtime.sh` calls the module, never reintroduces `replace(/_.*$/`, and strips the metadata before step 4. |
| `deploy/scripts/assemble-runtime.sh` | P-1: step 4 calls `node "$HERE/check-virtual-store.mjs" …` (`HERE` = script directory). P-2: a new step 3b removes `node_modules/.modules.yaml`, `node_modules/.pnpm-workspace-state-v1.json` and every `*/node_modules/.bin` directory. Step 4 adds layout assertions that these are absent. The existing resolve and import checks of every shipped workspace package run **after** the removal. |
| `deploy/ci/ci.yml` | `check-virtual-store.test.mjs` added to the "Deploy tooling self-tests" step. `.github/workflows/ci.yml` is read-only in this sandbox (as for DO-A), so the orchestrator copies it (§4). |
| `tools/release/build-archive.mjs` | Q1. `ARCHIVE-MANIFEST.json` `tool` is now `{ buildArchiveSha256 }` only. `build-report.json` gets `tool: { node, zlib, buildArchiveSha256 }`, which replaces its top-level `node` and `zlib` keys. No consumer read those keys (grep over `tools/release`, `deploy`, `docs/operations`, `licenses`). |
| `tools/release/tests/build-archive.test.mjs` | Q1 assertions. Manifest `tool` keys are exactly `["buildArchiveSha256"]`, and the manifest text contains no Node version. The report's `tool` equals `{ node, zlib, buildArchiveSha256 }`, and the report's `tarSha256` matches. |
| `docs/architecture/adr/ADR-0062-…-asset-scan.md` | §4.2: removed `"node"` from the example. Added "**Amendment 2026-11-12 (D-246 Q1, T-DG7-DO-A2)**". §3 is unchanged. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-A2-devops-engineer.md`, `…-evidence/*` | This handback and its logs. `clean-start-phase-a.derived.sh.txt` is the derived script (§3.3), kept as evidence only and not executable from the repository. |

Checksums (working tree at handback):

```text
2c825d7a909342cd98390c72d4485064f68b4adcfca5f7f658e957f446c69086  deploy/scripts/assemble-runtime.sh
50a5fdf195673b986f0442ddd470d21bf0bbe29f550a21bd2aa6b961e0cb74ab  deploy/scripts/check-virtual-store.mjs
73112d6460ce7a8281d6e16d8a620be0798f69f578fd326033c68b6444890e78  deploy/scripts/tests/check-virtual-store.test.mjs
9ee5fc5b320751a65a12e8f9ac298c8555975bff51650c320a69ce6ad9946fdf  tools/release/build-archive.mjs
e49da31a10d9334892b7152a319dec13826a9e82f6845b060fc46ac481a453f5  tools/release/tests/build-archive.test.mjs
c9dee7a7eca32123558dda8ed9ab7fead6d5da5c3015131f3e087c6aff2224fd  deploy/ci/ci.yml
b30341320eb2d93661c45b14a1b17fb3716c6604f958728c4604406a3413d631  docs/architecture/adr/ADR-0062-p7-release-archive-reproducible-offline-build-sbom-procurement-asset-scan.md
```

Not touched: `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews, gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`, the Dockerfile, `clean-start-local.sh`, `entrypoint.sh`, and the repository `.git` index. Every `git` write went to disposable clones under `$TMPDIR`.

## 2. Analysis

### 2.1 P-1: other places that parse pnpm directory names

I searched `deploy/**`, `tools/release/**`, `licenses/**` and `scripts/**` for `replace(/_`, `.pnpm`, `lastIndexOf("@")` and similar. Findings:

- The only parser of virtual-store **directory names** was `assemble-runtime.sh` l.128, now replaced.
- `licenses/lib/lockfile.mjs` `splitKey` parses **lockfile keys** (`name@version(peers)`, with parentheses and no `_`). It splits at the first `@` after a leading scope `@`, so `_` in a name is safe. `indexInstalled` reads `package.json` `name` and `version` and never parses directory names.
- `tools/release/scan-assets.mjs` only skips symlinks under `.pnpm`.
- `tools/release/build-from-archive.sh` calls `assemble-runtime.sh`, so it is fixed by the same change.
- The Dockerfile (l.59) and `clean-start-local.sh` (l.123) call the same script, so they are fixed by the same change.

The real assembled tree exercised all of these shapes, and every one passed the check:

- an `_` name: `string_decoder@1.1.1`;
- single peer suffixes: `pg-pool@3.14.0_pg@8.16.3`, `react-dom@19.2.0_react@19.2.0`;
- a scoped name with a peer suffix: `@tanstack+react-query@5.90.2_react@19.2.0`;
- a nested peer suffix: `react-i18next@17.0.15_i18next@26.4.2_typescript@6.0.2__react-dom@19.2.0_react@19.2.0__react@19.2.0_typescript@6.0.2`.

The full list is in `p2-runtime-tree.log`.

The DO-A handback proposed `^(.*?@[^_]+)_.*$`. I did not use it: for a scoped name with `_` plus a peer suffix (`@scope+under_score@2.0.0_typescript@5.9.3`), its lazy `.*?@` matches the scope's own `@` and returns `@scope+under`. The test includes that case.

Residual (not changed): pnpm shortens directory names longer than `virtual-store-dir-max-length` (default 120) to a truncated name plus a hash. Such a directory would fail the check loudly, as before. No shipped package hits it today: the 186 directories all pass, including the 104-character `react-i18next` one.

### 2.2 P-2: confirming nothing at run time needs the removed files

- **Entry points.** The Dockerfile has `ENTRYPOINT ["/usr/local/bin/mth"]` and `CMD ["api"]`. `deploy/docker/entrypoint.sh` runs `exec node "$APP/apps/api/dist/main.js"`, `…/apps/worker/dist/main.js` and `…/packages/db/dist/cli.js`. The health check is `node /app/healthcheck.mjs`. `clean-start-local.sh` runs the same `entrypoint.sh` through `MTH_APP_ROOT`, and its seed-dev step uses `node "$WORK/src/…"` from the source tree, not the runtime tree. None of them uses a `.bin` shim.
- **CLI wrappers.** `@mth/db`'s `bin` entry (`mth-db` → `./dist/cli.js`) is never invoked through a shim in the image: `mth migrate` and `mth db …` call `node $DB_CLI`.
- **Shipped code.** `apps/api/src`, `apps/worker/src` and `packages/*/src` (non-test) use no `child_process`. The only hit is `architecture.testkit.ts`, a test kit that *forbids* it.
- **Third-party files.** In the real runtime tree, the only references to `node_modules/.bin` are `scripts` entries in `pg-pool` and `jpeg-exif` `package.json`, the `isarray` Makefile and `pino`'s `inc-version.sh`. These are development scripts, never run at run time (`p2-runtime-tree.log`).
- **Resolution.** Node's resolver follows the symlinks, not pnpm metadata. The runtime tree is a copy and is never `pnpm install`ed again.
- **Proof by running.** With the metadata removed, all 7 shipped workspace packages resolved every production dependency and imported their entry modules (`bfa-assemble.log`). The derived phase A then ran migrate, the API and the worker from that tree (§3.3).

## 3. Checks actually run

**Environment.**

| Item | Value |
| --- | --- |
| Node | 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`, put first on `PATH`) |
| zlib | `1.3.2.1-motley-8002e91` |
| pnpm | 10.33.0 |
| PostgreSQL | 16.15 (Ubuntu) |
| Host | Linux 6.18.44, 4 vCPU, 15 GiB RAM |
| Network | No outbound network inside the namespace: TCP `ENETUNREACH`, DNS `EAI_AGAIN` |
| Docker | No daemon |
| Disk | 3.8 GB free at start, 1.2 GB at the low point, 3.8 GB again after cleanup |

**How I built from uncommitted changes.** As in DO-A, I used a disposable `git clone --shared --no-checkout` under `$TMPDIR`. A temporary `GIT_INDEX_FILE` held `HEAD` plus this working tree, committed only in that clone.

**Store.** The host store `/root/.local/share/pnpm/store/v10` (290 MB) is read-only, so I used a byte copy under `$TMPDIR`. All temporary trees (clone, archive, store copy, work and runtime trees, PostgreSQL cluster) were deleted after the runs.

### 3.1 Final run, on the final file bytes

| # | Command | Result | Exit | Log |
| --- | --- | --- | --- | --- |
| 1 | `node --test deploy/scripts/tests/check-virtual-store.test.mjs` | tests 5, pass 5, fail 0 | 0 | `check-virtual-store-test-new.log` |
| 2 | Same test, with the body of `parseVirtualStoreDir` temporarily replaced by the old `d.replace(/_.*$/, "")` + `lastIndexOf("@")` logic. Restored afterwards; sha256 `50a5fdf1…74ab` before and after. | tests 5, **pass 2, fail 3**. The failures are the P-1 parse test (`string_decoder@1.1.1` → `{name:'string', …}` against the expected `string_decoder`), the passing-store test (extra `string_decoder@1.1.1`, `@scope+under_score@2.0.0`), and the failing-store test (an extra `string_decoder@1.1.1`). | **1** (expected) | `check-virtual-store-test-old-expression.log` |
| 3 | `node tools/release/build-archive.mjs --repo $TMPDIR/clone1 --commit 015f6483276e95060d574568dbcb65c772032922 --demo-data tools/release/tests/fixtures/demo-data --rehearsal --out $TMPDIR/rel` | `mth-transformation-hub-0.1.0-3017b2de2279-REHEARSAL.tar.gz`. Archive sha256 `60a81b83425c7416b401c7aa86052c8114c5f29f5161ad898c6c9e2d3ccf77e3`, tar sha256 `52a0412596231a79e97b665924f4045d3f529704772d2d394a818e7fedafe8ed`, candidate `sha256:3017b2de2279c962973171586226a4962efa4b1ebee08cc2099eb155ab9c8635`, 10.9 s. | 0 | `rehearsal-archive.log` |
| 4 | `node tools/release/build-archive.mjs --verify <archive> --expect-sha256 60a81b83…` | 7/7 ok, `archive-verify: PASS`. Manifest `tool` = `{"buildArchiveSha256":"c8e5a768…9340"}`; `"node"` occurs 0 times. `build-report.json` `tool` = `{node: 24.21.0, zlib: 1.3.2.1-motley-8002e91, buildArchiveSha256: c8e5a768…}`. | 0 | `rehearsal-archive.log` |
| 5 | `tools/release/build-from-archive.sh <archive> --sha256 60a81b83… --store $TMPDIR/pnpm-store-root/v10 --work $TMPDIR/bfa --keep` | Steps: checksum ok; unpack 0.4 s (no `.git`); probes fail as required; install exit 0 (1.4 s); build exit 0 (110.6 s); **assemble exit 0** (5.0 s); check-no-cdn exit 0; **scan-assets exit 0** (16.6 s). `virtual store: 186 package directories, all in the shipped set (186 runtime+bundled)`; 7 workspace packages resolve; runtime 202 MB; `runtime-tree-listing` sha256 `98c33aa8…00f9`. Total 134.5 s, `build-from-archive: PASS`. | 0 | `build-from-archive.log`, `bfa-assemble.log`, `bfa-scan-assets.log`, `bfa-check-no-cdn.log` |
| 6 | P-2 checks on `$TMPDIR/bfa/runtime` (`ls -A`, `find`, `grep -rlF`) | `node_modules/` contains only `.pnpm`. 0 `.bin` directories, 0 `.modules.yaml` / `.pnpm-workspace-state*` files, 0 files containing the assembly path, 0 files containing `/var/tmp/`. | 0 | `p2-runtime-tree.log` |
| 7 | `MTH_RELEASE_REPO=$TMPDIR/clone1 MTH_RELEASE_COMMIT=015f6483… MTH_PNPM_STORE=$TMPDIR/pnpm-store-root/v10 MTH_RELEASE_SOURCE_DIR=<unpacked>/source MTH_RELEASE_RUNTIME_DIR=$TMPDIR/bfa/runtime node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | tests 58, pass 57, fail 0, skipped 1 (`T-A3 bsdtar … # bsdtar not installed`). **T-A5 ✔** (144.5 s; it builds its own archive and runs the offline build again), **T-A11 ✔** (17.8 s), T-A1/T-A2 (with the Q1 assertions) ✔, T-A4 ✔. 145.7 s. | 0 | `node-test-release.log` |
| 8 | Derived phase A (§3.3) on the run-5 trees | A1 status exit 3; A2 migrate 125 applied, idempotent, status exit 0; A3 seed-dev exit 64, `AUTH_MODE=dev` in production exit 78; A4 `/healthz` ok, `/readyz` `{"database":"ok","migrations":"ok"}`; A5 `GET /` 200 HTML, dev-login 404, IdP outage → 302 `/login?error=idp_unavailable` without a crash, `/me` 401; A6 bootstrap ok, second refused with exit 1. `CLEAN START PHASE A (derived): PASS`, 8.8 s. | 0 | `clean-start-phase-a.log` |
| 9 | `node --test deploy/scripts/tests/{check-ci-needs,pin-images,log-scan,check-virtual-store}.test.mjs` | tests 79, pass 79 | 0 | `checks.log` |
| 10 | `node deploy/scripts/check-ci-needs.mjs deploy/ci/ci.yml` | OK, 7 jobs | 0 | `checks.log` |
| 11 | `bash -n deploy/scripts/assemble-runtime.sh` | syntax ok | 0 | `checks.log` |
| 12 | `node licenses/generate-sbom.mjs --check` | `OK: packages=483 runtime=171 bundled=15 … procurement(not_required=428 review=59 required=0) direct-dependency-problems=0` | 0 | `checks.log` |
| 13 | `node tools/release/service-list.mjs --check` | OK | 0 | `checks.log` |
| 14 | `pnpm lint` | `eslint . --max-warnings=0` clean | 0 | `lint.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG6` | `PASS gate DG6 (historical)` | 0 | `validate-historical-DG6.log` |
| 16 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | All files formatted (22 batches, each "All matched files use Prettier code style!"), run with this handback present | 0 | `prettier.log` |

### 3.2 Non-zero exits and superseded runs

- **First full pass** (15:45–15:57). Archive commit `1ee7cf5d…`, candidate `sha256:8c142097…03dd`. It passed everything: build-from-archive PASS, suite 57/0/1 with T-A5 and T-A11 ✔, derived phase A PASS.
- **Prettier.** After that pass, prettier exited **123** on the two new files (formatting only). I ran `prettier --write` on them and **re-ran everything in §3.1** on the formatted bytes. The §3.1 logs overwrite the first pass's logs.
- **Final prettier check.** Run with this handback present: exit 0 (row 16). After the run I edited only this file, to record that result, and re-checked it with `npx prettier --check` (exit 0).
- **Stray `git status` output.** During the first clone commit, one `git status --short` in the repository ran while `GIT_INDEX_FILE` still pointed at the deleted temporary index, so it listed every file as deleted. The real index was untouched: a fresh `git status` showed only this task's changes. The second time, I scoped the variable to a subshell.
- **Expected failure.** Run 2 (old expression) exited 1, as intended.

### 3.3 `clean-start-local.sh` phase A: the repository script was not run

- **Why not.** Step 1 of the script is `git clone -q --no-local "$REPO" "$WORK/src"`, a full checkout. DO-A measured about 3 GB of `docs/` (DO-A §3), and disk was at 1.2–3.8 GB free. The assignment forbids a full extra checkout. The script has no phase-A-only or reuse option, and I did not change it (not in scope).
- **What I ran instead.** `clean-start-phase-a.derived.sh.txt`, generated from the repository script with three changes:
  1. `REPO` comes from `MTH_REPO_ROOT`;
  2. steps 1–4 are replaced by symlinks to the **already built** `source/` and the **assembled, metadata-stripped** runtime tree from run 5;
  3. the script stops after phase A, with the cleanup removing only the symlinks.
- **What it uses unchanged.** Step 5 (`initdb` and `db-init/10-mth-roles.sh`), the `mth` entry point, the environment and A1–A6.
- **What it proves.** The P-2 tree runs migrate, the API (production, OIDC) and the worker. It is **not** a substitute for the repository script's clean start: steps 1–4 there are a fresh clone, install, build and assemble. Phase B was not run.

### 3.4 Not run

- **Docker image build and `docker compose up`:** no daemon. The Dockerfile path uses the same `assemble-runtime.sh`. `COPY . .` includes `deploy/scripts/check-virtual-store.mjs`; `.dockerignore` does not exclude `deploy/` or `*.mjs`, which I checked. But no image was built.
- **bsdtar half of T-A3:** not installed.
- **Live CI:** checked statically only.
- **A local Compose or clean-start run is not proof of high-availability production readiness.**

## 4. Merge instructions

1. Take the working-tree changes listed in §1. There is no migration and no ordering constraint.
2. **CI owner step:** `cp deploy/ci/ci.yml .github/workflows/ci.yml`, then `node deploy/scripts/check-ci-needs.mjs`. This was already pending from DO-A §4, and the copy now also carries the new test in the deploy-tooling step.
3. The `build-report.json` shape changed: top-level `node` and `zlib` are now under `tool`. DO-J (seal step, ADR-0073) should read `tool.node` and `tool.zlib`.

## 5. Open items

- **Finding status.** P-1 and P-2 are repaired in the working tree. Closing them in `findings.json` is the orchestrator's job; I cannot write that file.
- **Not changed:** pnpm's hashed long-name directories (§2.1 residual), and DO-A's Q3 (SPA source maps) and Q4 (claims scan over the archive's `docs/`).
- **Honesty notes:**
  - Every archive here is a **rehearsal** built with the fixture demo data.
  - The archive is engineering evidence; Mobily IT's acceptance is external.
  - Nothing here is a business, Finance or IT approval.
