# ADR-0062: P7 release archive and reproducible offline build: the archive layout by artefact, the deterministic tar, per-file and archive checksums, the build from the archive with no network, the service/dependency list and its Compose check, the procurement flag of the licence inventory, and the scan of built assets and configuration

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-01), 2026-11-12. Base `fe690c01768fb65370c257c80ac8a55e807f9525` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice A of `docs/architecture/p7-plan.md`):** REQ-S19-001, REQ-S19-002, REQ-S19-003, REQ-S16-009, REQ-S19-019. Slice G is ADR-0063.
- **Sources (quoted where a design point has one):**
  - M0351 (§19): "Deliver a complete source repository plus a portable archive, with clear separation of application code, infrastructure, documentation and demo data."
  - M0352 (§19 item 1): "Frontend, backend, worker, shared schemas, calculation engine, report templates, local assets and all build configuration."
  - M0353 (§19 item 2): "Dependency manifests, lockfiles, license/SBOM inventory, build scripts, container definitions and a complete service/dependency list."
  - M0314 (§16): "Verify current official documentation, support windows, licenses and security maintenance before selecting exact dependency versions. Pin compatible versions and lockfiles. Keep mandatory services runnable within company-controlled infrastructure. Third-party licenses remain applicable; include a license inventory and flag any procurement requirement."
  - M0366 (§19): "Do not make any required runtime service depend on a builder-hosted database, proprietary workflow service, external storage URL, public CDN, original workspace identifier or personal API key."
  - §19 (master prompt l.565): "Supply images or an approved artifact mirror plan where building also needs to occur in a restricted network."
  - Acceptance texts (binding, `docs/delivery/requirements.csv`):
    - REQ-S19-001: "A18;A28: the archive checksum matches the recorded value, and the archive contains separate app, infra, docs and demo-data directories".
    - REQ-S19-002: "A18: a clean build from the archive succeeds without network access to builder-hosted services".
    - REQ-S19-003: "A18: the SBOM lists every runtime dependency with licence; the service list matches the Compose file".
    - REQ-S16-009: "A18: every direct dependency is pinned in a lockfile and listed in the licence inventory with its licence; any licence requiring procurement is flagged".
    - REQ-S19-019: "A18: a scan of built assets and configuration finds no public CDN, builder host or personal key, and the offline e2e run passes".
  - Playbook: no block concerns packaging. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q2**: "archive by artefact, repository layout unchanged";
  - D-243 **Q12**: "no unknown-target manifests";
  - D-243 **Q1**: the container halves are run by the orchestrator on its host;
  - D-243 **Q16**: "all credential material excluded" (it binds the `demo-data/` input, §2);
  - p7-plan §4 "No new runtime dependency is expected in P7", §4.1 (the payload archive is built by the seal step with this ADR's rules), §6 R5/R6;
  - D-057 (no live registry), D-058 (no live CI), D-193, D-138 (tools never read growing delivery folders, except where this ADR names it).
- **Builds on:** ADR-0001 (Node 24, pnpm 10.33.0, exact pins), ADR-0011 (packaging, Compose, `.env.example`), ADR-0013 (CI), ADR-0050 (deterministic demo seed and its checksum), ADR-0052 §6 (offline dependency audit), ADR-0053 §5 (log scan), the P1 licence tooling (`licenses/generate-sbom.mjs`, `licenses/lib/lockfile.mjs`, `licenses/README.md`).
- **Two gate systems.** The release tooling reads the candidate's files and, for the candidate id, `tools/gates/lib/candidate.mjs` (imported read-only, never edited). It writes no gate, review or stage record. A built archive is an engineering artefact. It is not a business, Finance or IT approval, and Mobily IT's acceptance of it (`accept:Mobily IT (external)` in the register) is outside the product and outside every agent.
- **No migration, no advisory lock, no OpenAPI operation.** Migrations `0131`–`0132` and lock classes 730400–730401 stay reserved and unused (p7-plan §4).

## Context

What exists at `fe690c01` (read from the tree):

1. **No archive.** `ls tools/release` fails ("No such file or directory"). No script builds a portable archive or records an archive checksum. `dist/` is already git-ignored (`.gitignore` "dist/"), so `dist/release/` (p7-plan §4.1) needs no new ignore line.
2. **Builds start from a git clone.** `deploy/scripts/clean-start-local.sh` l.96 runs `git clone -q --no-local "$REPO" "$WORK/src"`. With `MTH_PNPM_STORE` and `MTH_PNPM_OFFLINE=1` it installs `--offline` (l.110). `deploy/scripts/assemble-runtime.sh` prunes and assembles the runtime tree offline. `docs/operations/restricted-network.md` §"Building in a restricted network" documents `pnpm fetch` on a connected machine and an IT npm mirror for `build-image.sh`.
3. **Licences.** `licenses/inventory.csv` has the header `name,version,license,scope,direct_dependency_of,integrity` and 483 package rows (171 runtime, 15 bundled, 297 development). `generate-sbom.mjs --check` fails a stale file and a shipped package without a licence id. Container images come from `deploy/images.lock.json` (4 images: `node-runtime` and `postgres` with scope `production`, `keycloak` and `playwright` with scope `test-ci`). **There is no procurement column.** The direct dependencies carry the licences MIT 43, Apache-2.0 3, OFL-1.1 2, ISC 1, MIT-0 1, MPL-2.0 1 (`@axe-core/playwright`, development) and `(MIT OR GPL-3.0-or-later)` 1 (`jszip`, runtime). None is `NOASSERTION`. `scripts/verify-dependency-pins.mjs` checks exact pins against the registry, but it needs network and cannot run here (D-057).
4. **No service list.** Compose services: `db`, `migrate`, `api`, `worker` (default); `keycloak` (profile `test-idp`); `smoke` (profile `smoke`); `load-generate`, `load-sessions` (profile `load`), in `deploy/compose/compose.yaml`, plus the overlays `compose.no-egress.yaml` and `compose.load.yaml`. No file lists them for IT.
5. **CDN check.** `scripts/check-no-cdn.mjs` (`pnpm check:no-cdn`, CI `verify` job) fails on 14 public CDN, font and analytics hosts in `apps/**` and `packages/**`. It does not scan builder hosts, workspace identifiers, personal keys, configuration under `deploy/**`, or the assembled runtime tree, and it has no self-test.
6. **Delivery-only files.** The candidate manifest (`tools/gates/lib/candidate.mjs`) is every tracked and untracked, non-ignored file, minus `trading_agent/**` (D-005) and the META_EXCLUDES (reviews, gates, test evidence, runs, candidates, handbacks, assignments, `findings.json`, `progress.md`, `stages.json`). `manifestFromRef` derives it from a commit.
7. **Demo data.** The demo seed is code inside the application (`packages/db/src/demo/**`, ADR-0050). Its ids are fixed literals, but rows default timestamps from `now()`. ADR-0050 §4's checksum therefore leaves those columns out, so two seedings have equal checksums but unequal bytes.

## Decision

### 1. The release artefacts

A release consists of four files, each with its own SHA-256. Only the first is defined here.

| Artefact | File (under the git-ignored `dist/release/`) | Built by | Defined by |
| --- | --- | --- | --- |
| **Payload archive** | `mth-transformation-hub-<version>.tar.gz`, beside `<same>.tar.gz.sha256` and `<same>.build-report.json` | `tools/release/build-archive.mjs` (DO-A). The seal step runs the same code (DO-J, ADR-0073). | this ADR, §2–§4 |
| Offline dependency store | `mth-transformation-hub-<version>-pnpm-store.tar.gz` (§5.2) | `build-archive.mjs --pack-store` (DO-A) on a store that `pnpm fetch` filled | this ADR, §5.2 |
| Image set | `docker save` of the pinned images | `deploy/scripts/image-bundle.sh` (DO-E), run by the orchestrator (D-243 Q1) | ADR-0069 |
| Envelope archive | payload archive plus the delivery records, `evidence/` | `tools/release/seal.mjs` (DO-J), after DG7 approval | ADR-0073 |

`<version>` is the root `package.json` `version`, followed by `-` and the first 12 hex digits of the candidate id. An example would be `0.1.0-3f2a9c01b7d4`. The candidate id makes two releases with the same version string distinguishable.

The `.tar.gz` cannot hold its own checksum. The **archive checksum** (SHA-256 of the `.tar.gz` bytes) is therefore written:

- to `<name>.tar.gz.sha256` (`sha256sum -c` format);
- to `build-report.json`;
- by the seal step, to the seal report, separately from the payload hash (master prompt l.621; ADR-0073).

"The archive checksum matches the recorded value" (REQ-S19-001) is checked by `build-archive.mjs --verify` (§4.3).

### 2. The layout (REQ-S19-001; D-243 Q2 "archive by artefact")

The archive has one top-level directory, `mth-transformation-hub-<version>/`, holding:

| Entry | Role (acceptance term) | Content rule (exact) |
| --- | --- | --- |
| `source/` | **app**: the complete application source, buildable as it is | Exactly the files of the candidate manifest at the source commit: `manifestFromRef(repo, APPROVED_SPEC, <commit>)` from `tools/gates/lib/candidate.mjs`. That is every repository file except `trading_agent/**` and the META_EXCLUDES. Bytes are as committed, and the file mode is 0755 where the git index mode is `100755`, otherwise 0644. There is no `.git`, `node_modules`, `dist` or `coverage`. A gitlink (mode `160000`) or a symlink (mode `120000`) makes the build fail (`build-archive: <path>: symlinks and submodules are not archived`). There are none at the base. |
| `infra/` | **infra** | Byte copies of these `source/` files, each under `infra/` at its repository path: `deploy/**` (Compose files, Dockerfile, entrypoint, `db-init`, `images.lock.json`, `service-list.json` (§6), `keycloak/**` (test IdP only, marked `test-ci` in the lock), `scripts/**`, `load/**`, `ci/**`), `.env.example` and `licenses/{sbom.cdx.json,inventory.csv,README.md}`. Every `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` (and `.npmrc` if tracked) is copied under `infra/manifests/`, again at its repository path. Examples: `infra/deploy/compose/compose.yaml`, `infra/.env.example`, `infra/manifests/apps/api/package.json` |
| `docs/` | **docs** | Byte copies of `docs/handover/**` (ADR-0072; the release notes are generated into it by DO-J), `docs/operations/**`, `docs/api/**`, `docs/architecture/**` and `docs/delivery/requirements.csv` (the coverage register, REQ-S19-015). The archive's `docs/` stands for the repository's `docs/`, so each file keeps its repository path, for example `docs/handover/README.md` and `docs/delivery/requirements.csv`. No other `docs/delivery/` file is copied. |
| `demo-data/` | **demo-data** | The **input** directory passed with `--demo-data <dir>` (§2.1), copied byte for byte, plus a generated `demo-data/README.txt` |
| `ARCHIVE-MANIFEST.json` | — | §4.2 |
| `SHA256SUMS` | — | §4.1 |
| `README.txt` | — | Fixed text (§2.2) |

- **Why copies.** `source/` stays a working tree that builds unchanged, so moving demo code or deployment files out of it would reopen DG5 for no gain (D-243 Q2). `infra/`, `docs/` and `demo-data/` give IT each artefact on its own, so infrastructure, documentation and demo data can be reviewed, mirrored or discarded without reading the source tree. A copy is byte-identical to its `source/` original, and the verifier checks that (§4.3 check 6).
- **`evidence/` is not in the payload archive.** The delivery records the payload excludes (gate records, reviews, test evidence) go only into the **envelope** archive, under `evidence/`, by ADR-0073. They are outside the candidate, so putting them in the payload archive would make it differ from the approved payload.
- **The name `source/`.** The acceptance text says "app". This ADR keeps the directory name the adopted plan uses (`source/`, D-243 Q2) and records the role in `ARCHIVE-MANIFEST.json` `layout[].role` = `app`. The checks in §4.3 test the roles, not the names. Renaming it to `app/` is a one-constant change in `build-archive.mjs`, and the open question is in the handback (O1).

#### 2.1 `demo-data/`: the synthetic demo installation

- **Content.** `demo-data/` holds the synthetic demo installation exported as a **migration manifest** by ADR-0064's export (`tools/migration/export.mjs`, BE-C), from a database freshly seeded with `mth db seed-demo` (ADR-0050). It is therefore also the A18 source dataset of the transfer drill (DO-D).
- **It is an input, not something the build produces.** The seeded rows carry `now()` timestamps (Context 7), so two exports of two seedings differ in bytes. The archive build takes the directory as given, and determinism is stated over its inputs (§3).
- **Content equivalence.** `ARCHIVE-MANIFEST.json` records the ADR-0050 demo checksum the export carries, if ADR-0064 puts it in the manifest. That checksum leaves out the timestamp columns, so a re-export can be shown to be content-equal. ARCH-02 is asked to carry it (handback O2).
- **Refusals.** The build refuses a `--demo-data` directory:
  - that has no `manifest.json`: `build-archive: demo-data has no manifest.json`;
  - whose environment marker is not `demo`, when ADR-0064's manifest carries the `deployment_environment` marker: `build-archive: demo-data is not a synthetic demo export (environment marker '<value>')`. ADR-0064 fixes the field name. Until it does, DO-A tests against a fixture with the field `sourceEnvironment`, and ARCH-02 confirms or renames it.

  Credential material is excluded by ADR-0064 (D-243 Q16). The secret scan (ADR-0063 §2) also runs over the `demo-data/` input.
- **Rehearsals.** `--rehearsal` accepts a fixture `demo-data/` (`tools/release/tests/fixtures/demo-data/`) and:
  - writes `"rehearsal": true` into the manifest;
  - appends `-REHEARSAL` to the top-level directory and file names.

  A release build (no `--rehearsal`) refuses the fixture, which carries the marker `"fixture": true`: `build-archive: the fixture demo-data cannot be used for a release build`.

#### 2.2 `README.txt` (exact English; an IT-facing document, D-243 Q7: English with an Arabic summary)

```text
Mobily Transformation Hub — release archive <version>

source/     The complete application source at the approved candidate. Build it with the steps in
            docs/handover/ (deployment guide) or tools/release/build-from-archive.sh.
infra/      Deployment files: Compose, container definition, environment template (names only),
            service and dependency list, SBOM and licence inventory, dependency manifests and lockfile.
docs/       Handover documentation, operations guides, API contract, architecture records and the
            requirements coverage register.
demo-data/  SYNTHETIC demonstration data exported as a migration manifest. It is not Mobily data.

SHA256SUMS lists the SHA-256 of every file in this archive. ARCHIVE-MANIFEST.json records the
candidate id, the layout and the inputs. The checksum of the archive file itself is published
next to it, outside the archive.

This archive is an engineering delivery artefact. It is not a business, Finance or IT approval.
The playbook this product operationalizes is a practical synthesis inspired by PMI, Brightline and
BRM practice; it is not an official PMI standard, and this product is not certified by any body.

ملخص: يحتوي هذا الأرشيف على الشيفرة المصدرية الكاملة (source)، وملفات النشر (infra)، والوثائق
(docs)، وبيانات عرض تجريبية اصطناعية (demo-data). وهو مُخرَج تسليم هندسي وليس موافقة عمل أو مالية
أو تقنية. (ترجمة مؤقتة لم يراجعها مراجع عربي مؤهل.)
```

The `<version>` placeholder is substituted. The Arabic summary is marked provisional in its own text (CLAUDE.md, D-243 Q7).

### 3. The deterministic tar (no new dependency)

- **Writer.** `tools/release/lib/tar.mjs` (DO-A) writes POSIX ustar with pax extended headers, using Node built-ins only (`node:fs`, `node:crypto`, `node:zlib`).
- **Entry order.** Entries are sorted by the UTF-8 byte order of the full path (`Buffer.compare`), with no locale. Every directory gets an explicit entry before its contents.
- **Metadata.** Directories have mode 0755, and files 0644 or 0755 (§2). uid and gid are 0, uname and gname are empty, and devmajor and devminor are 0.
- **mtime.** Every entry gets **946684800** (2000-01-01T00:00:00Z), a fixed synthetic constant. `SOURCE_DATE_EPOCH`, if set, overrides it, and the value used is recorded in the manifest. The commit time is deliberately not used, because the candidate is defined by content, and the commit is only a traceability pointer.
- **pax headers.** A pax `x` header is written only when a path is longer than 100 bytes, does not fit the ustar prefix/name split, or is not ASCII. It carries exactly one record, `path`. No `atime`, `ctime` or `mtime` record is written.
- **Refused paths.** An absolute path, a `..` segment, a NUL or control character, or a path that is not valid UTF-8 is refused (`build-archive: refused path <escaped>`).
- **End of archive.** The archive ends with two 512-byte zero blocks and is padded to a 10240-byte record.
- **Compression.** `zlib.gzipSync(tar, { level: 9 })`. Byte 9 of the gzip header (OS) is then set to 255 ("unknown"). Node writes 3 on Unix, and the header CRC flag is not set, so the change is safe and removes a platform difference. The gzip mtime field is 0.
- **What "reproducible" claims, exactly:**
  - the **`.tar` bytes** are a pure function of: the candidate files, the `--demo-data` directory bytes, `<version>` and the mtime constant. That holds on any platform;
  - the **`.tar.gz` bytes** are, in addition, equal for the same Node major and zlib (tested on Node 24.21.0, zlib `1.3.2.1-motley-8002e91`). A different zlib may produce different deflate output.

  `build-report.json` records the SHA-256 of both the `.tar` and the `.tar.gz`, so that case can be diagnosed.
- **Extraction interop.** The archive must extract with GNU tar 1.35 (`tar -xzf`, present at `/usr/bin/tar`). If `bsdtar` is present, it must extract with that too. The test (§9 T-A3) skips `bsdtar` with the reason "bsdtar not installed" when it is absent, and never reports that skip as a pass.

### 4. Checksums, the manifest and verification

#### 4.1 `SHA256SUMS`

One line per regular file in the archive except `SHA256SUMS` itself: `<64 lowercase hex>  <path relative to the top-level directory>`, sorted by byte order. It is LF-terminated and in `sha256sum -c` format, so IT can check an unpacked tree with standard tools: `cd mth-transformation-hub-<version> && sha256sum -c SHA256SUMS`.

#### 4.2 `ARCHIVE-MANIFEST.json` (UTF-8, keys in the order shown, 2-space indent, LF, no wall-clock time)

```json
{
  "schemaVersion": 1,
  "product": "mobily-transformation-hub",
  "version": "<version>",
  "candidateId": "sha256:<64 hex>",
  "sourceCommit": "<40 hex>",
  "rehearsal": false,
  "mtime": 946684800,
  "tool": { "node": "24.21.0", "buildArchiveSha256": "<sha256 of build-archive.mjs + lib/tar.mjs>" },
  "layout": [
    { "dir": "source", "role": "app", "files": 0, "rule": "candidate manifest at sourceCommit" },
    { "dir": "infra", "role": "infra", "files": 0, "rule": "ADR-0062 §2" },
    { "dir": "docs", "role": "docs", "files": 0, "rule": "ADR-0062 §2" },
    { "dir": "demo-data", "role": "demo-data", "files": 0, "rule": "ADR-0064 export of a seeded demo database" }
  ],
  "demoData": { "synthetic": true, "inputSha256": "<sha256 over the input's sorted path+sha256 lines>", "demoChecksum": "<ADR-0050 checksum or null>" },
  "copies": "infra/, docs/ are byte copies of source/ paths (ADR-0062 §2)"
}
```

- `candidateId` is **recomputed** by the build from the files it packs, with the same hash `tools/gates/lib/candidate.mjs` uses (imported, not copied).
- The build fails when `--candidate <id>` is given and differs: `build-archive: the files at <commit> hash to <id>, not the expected <expected>`. This is how the payload archive is bound to the approved payload hash (p7-plan §4.1 step 4; R5).
- `sourceCommit` is recorded as a traceability pointer only (CLAUDE.md).

#### 4.3 `build-archive.mjs --verify <archive.tar.gz> --expect-sha256 <hex> [--candidate <id>]`

The verifier reads the archive with the same code, streaming and without extracting to disk. It prints one line per check and the line `archive-verify: PASS` or `archive-verify: FAIL (<n> checks)`:

1. **archive checksum**: the SHA-256 of the file equals `--expect-sha256` (REQ-S19-001 "matches the recorded value");
2. **single top-level directory**, named per §1;
3. **layout**: the four roles `app`, `infra`, `docs`, `demo-data` are each present as a separate top-level directory with at least one file, and no other top-level directory exists (REQ-S19-001 "separate app, infra, docs and demo-data directories");
4. **SHA256SUMS**: every file is listed, every listed file exists, and every hash matches;
5. **candidate id**: `source/` hashes to `ARCHIVE-MANIFEST.json` `candidateId`, and to `--candidate` if given;
6. **copies**: every `infra/` and `docs/` file is byte-equal to its `source/` path. There is no exception: `infra/deploy/service-list.json` is a copy of the committed `source/deploy/service-list.json` (§6), and nothing in `infra/` or `docs/` is generated at archive time;
7. **determinism metadata**: every entry has the fixed mtime, uid/gid 0 and an allowed mode.

Exit 0 means PASS and exit 1 means FAIL. Exit 2 is BLOCKED: unreadable archive, missing argument, or not gzip. A usage error is never reported as a pass.

### 5. The build from the archive with no network (REQ-S19-002)

#### 5.1 `tools/release/build-from-archive.sh <archive.tar.gz> --sha256 <hex> --store <pnpm store dir> [--work <dir>] [--keep]` (DO-A)

1. Verify the archive checksum (`sha256sum`). A mismatch exits 1 before anything is unpacked.
2. Unpack with `tar -xzf` into an **empty** work directory under `$TMPDIR` (refused if it is not empty). Assert that `source/.git` does not exist.
3. Enter a **network namespace with no interfaces**: `unshare --user --map-root-user --net` (util-linux 2.39.3) or, failing that, `bwrap --dev-bind / / --unshare-net` (bubblewrap 0.9.0). Both were verified here: a TCP connect to 1.1.1.1:443 fails with `ENETUNREACH`. If neither is available, the script exits **3 (BLOCKED)**: `build-from-archive: BLOCKED: no network namespace (unshare and bwrap unavailable)`. It never builds with the network on.
4. Inside the namespace, run a **network probe** first: a TCP connect to `1.1.1.1:443` and a DNS lookup of `registry.npmjs.org` must both fail. If either succeeds, the script exits 1 with `build-from-archive: network isolation is not effective`.
5. Inside the namespace, from `source/`, with `GIT_DIR=/nonexistent` and `GIT_CEILING_DIRECTORIES=<work>`, so a build step that calls git fails visibly:
   1. `CI=true pnpm install --frozen-lockfile --offline --store-dir <store>`;
   2. `pnpm -r build`;
   3. `deploy/scripts/assemble-runtime.sh --store-dir <store> . <work>/runtime`, which prunes the work copy in place, as designed;
   4. `node scripts/check-no-cdn.mjs apps packages`;
   5. `node tools/release/scan-assets.mjs --web apps/web/dist --runtime <work>/runtime --config .` (§8).
6. Print one line per step with its duration and exit status, and the SHA-256 of `apps/web/dist/index.html` and of the runtime tree listing. Exit 0 only if every step passed.

The **image build from the archive** (`deploy/scripts/build-image.sh` run from the unpacked `source/` against IT's mirror) needs a Docker daemon. Under D-243 Q1 it is the orchestrator's half and is not part of this script's acceptance (§10 residual 3).

#### 5.2 The offline dependency store (the "artifact mirror plan" of l.565)

- **The input.** The build needs the packages that `pnpm-lock.yaml` names. Their integrity is fixed by the lockfile's SHA-512 hashes, which pnpm verifies on install, so the source of the bytes does not affect what is installed.
- **Two supported sources, both inside company infrastructure:**
  - **(a) IT's npm mirror.** `pnpm fetch --frozen-lockfile` against the mirror fills a store, as documented in `restricted-network.md`;
  - **(b) the store artefact.** On a connected preparation machine, `pnpm fetch --frozen-lockfile --store-dir <dir>`, then `node tools/release/build-archive.mjs --pack-store <dir> --out dist/release/`. That writes `mth-transformation-hub-<version>-pnpm-store.tar.gz` and its `.sha256`, with the same deterministic tar rules. IT copies it into the restricted network.
- **Host prerequisites,** installed by IT from its own mirror: Node 24.x (ADR-0001), pnpm 10.33.0 and GNU tar. None of them is builder-hosted.
- **Where the agents run the build.** Agents have no network (D-025), so they run the build against the store already present in the sandbox host (`pnpm store path` = `/root/.local/share/pnpm/store/v10`), which was filled by the orchestrator's sandboxed installs (REQ-DLV-042). The run proves the build needs nothing beyond the store and the archive. It does not prove that an IT mirror serves the store: no IT mirror exists here (D-057, residual 4).

### 6. The service/dependency list and its Compose check (REQ-S19-003)

- **The generator.** `tools/release/service-list.mjs` (DO-A) writes `deploy/service-list.json` (committed). `--check` exits 1 when the committed file differs from a fresh generation.
- **YAML parsing.** It reads every `deploy/compose/*.yaml` with the `yaml` package already in the lockfile (2.8.1, ISC), resolved from `apps/api` through `createRequire`, the precedent of `deploy/scripts/check-ci-needs.mjs` l.37. That is no new dependency. Without an installed workspace it exits 3 (BLOCKED).
- **`services[]`, one entry per Compose service** in any Compose file, sorted by name. Each entry has:
  - `name`; `files` (the Compose files that define or extend it); `profiles` (`[]` = default);
  - `image` (the reference as written) and `imageLockId` (the `deploy/images.lock.json` id whose `ref:tag@digest` it equals, or `"mth-app"` for `${MTH_APP_IMAGE:-mth-app:local}`);
  - `imageScope` (`production` / `test-ci` / `application`);
  - `dependsOn`, `volumes`, `publishedPorts`, `networks`;
  - `role` (from the generator's `SERVICE_ROLES` map, exact English);
  - `requiredInProduction` (true only for the default-profile services).
- **`external[]`, the dependencies outside Compose** (from the generator's `EXTERNAL_DEPENDENCIES`, exact English), each with `name`, `required` (true/false), `offUntil` and `guide`:
  - corporate OIDC identity provider (required; `docs/operations/identity-saml-broker.md`, `configuration.md`);
  - SMTP relay (optional, off until configured);
  - S3-compatible object store (optional; the filesystem driver is the default);
  - connector source endpoints (optional);
  - assistant model endpoint (optional, off by default);
  - enterprise messaging (optional), if the P6 channel port lists it.

  The generator's test asserts that every optional row has a matching row in `docs/operations/restricted-network.md` §"Optional outbound destinations" and every required row in §"Runtime".
- **`dependencies`, a summary computed from `licenses/inventory.csv`:** the lockfile SHA-256, the package counts per scope, the counts per `procurement` value (§7), and the container images with their licence notes from `images.lock.json`.
- **"Matches the Compose file", exactly:**
  - the set of service names in `services[]` equals the union of service names in `deploy/compose/*.yaml`;
  - for each service, `profiles` and `image` equal the Compose values;
  - every image except the application image resolves to an `images.lock.json` entry;
  - the SBOM's container components equal the `images.lock.json` entries;
  - a missing `SERVICE_ROLES` entry fails generation: `service-list: no role text for service '<name>'`.

  A later P7 Compose change (DO-F's `backup` profile, DO-D's `compose.transfer.yaml`) therefore fails `--check` until the list is regenerated with a role text. That is the intended seam (§7 of the work split, A.6).
- **`SERVICE_ROLES` at the base (exact English):**

| Service | Role text |
| --- | --- |
| `db` | PostgreSQL database of the hub (product data, audit, job queue). |
| `migrate` | One-shot database migration run before the API and worker start. |
| `api` | HTTP API and the web application (single-page app served by the API). |
| `worker` | Background job worker (notifications, schedules, connectors, exports). |
| `keycloak` | Test identity provider for local verification only; production uses Mobily's corporate identity provider. |
| `smoke` | One-shot smoke test of a running stack (test profile). |
| `load-generate` | One-shot generator of the synthetic load dataset (load profile, never production). |
| `load-sessions` | One-shot creation of synthetic load-test sessions (load profile, never production). |

### 7. The procurement flag and the direct-dependency check (REQ-S16-009)

`licenses/generate-sbom.mjs` (DO-A) gains two columns, **appended** after `integrity` so existing readers keep working. DO-A checks every reader of `inventory.csv` by header name, including `assemble-runtime.sh`'s runtime-set check. The new header is:

```text
name,version,license,scope,direct_dependency_of,integrity,procurement,procurement_reason
```

The SBOM component gains the properties `mth:procurement` and `mth:procurement-reason`, and each container component gets the same two properties.

**The rule** is an engineering classification, recorded in `licenses/README.md`. It is **not legal advice and not a procurement decision**. Mobily procurement or legal decides.

| `procurement` | When | `procurement_reason` (exact English) |
| --- | --- | --- |
| `not_required` | the SPDX expression is satisfied by licences in the permissive set {MIT, MIT-0, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, Zlib}: a single id in the set; an `OR` expression with at least one operand satisfied; an `AND` expression with every operand satisfied | (empty) |
| `required` | the expression is `UNLICENSED`, starts with `SEE LICENSE IN`, or contains a `LicenseRef-` id (a custom or commercial licence) | `Custom or commercial licence: a procurement or legal decision is needed before use.` |
| `review` | anything else, including `NOASSERTION`, any copyleft (GPL, LGPL, AGPL, MPL, EPL, CDDL), OFL-1.1, CC-BY-*, Python-2.0, and a container image whose licence note names more than one licence | `Licence <expression> is not in the permissive set: review the obligations before redistribution.` For an image: `Image contains components under several licences (<note>): review before redistribution.` |

At the base this yields, for the direct dependencies:

- `review` for `@axe-core/playwright` (MPL-2.0, development) and the two `@fontsource/ibm-plex-*` packages (OFL-1.1, runtime);
- `not_required` for `jszip` (`(MIT OR GPL-3.0-or-later)`);
- `not_required` for the 48 others.

For the images:

- `review` for `node-runtime` (MIT plus Debian packages) and `playwright` (browsers under their own licences);
- `not_required` for `keycloak` (Apache-2.0);
- `postgres` (PostgreSQL License) needs `PostgreSQL` added to the permissive set as an image-only entry. DO-A adds it, with a note that it is OSI-approved and permissive.

No `required` row exists at the base. DO-A's regenerated file and its handback give the exact counts.

**The direct-dependency check,** added to `--check`, exits 1 with one line per violation:

1. every entry in `dependencies`, `devDependencies` and `optionalDependencies` of every workspace `package.json` (root, `apps/*`, `packages/*`) that is not `workspace:` is an **exact** version (`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`): `generate-sbom: <manifest>: <name> is not pinned to an exact version (<spec>)`;
2. that version is the version the lockfile's importer entry resolved: `generate-sbom: <manifest>: <name>@<spec> is not in pnpm-lock.yaml`;
3. the package has an inventory row with a licence other than `NOASSERTION`: `generate-sbom: direct dependency <name>@<version> has no licence in the inventory`.

An existing `LICENSE_FILE_OVERRIDES` entry counts as a licence (README "Licence-file overrides").

"Every runtime dependency with licence" (REQ-S19-003) is the existing `--check` rule: a shipped package without a licence id fails. This ADR keeps it, and T-A7 proves it.

The registry half of M0314 (current versions, support windows, deprecation) is `scripts/verify-dependency-pins.mjs`, which needs network. It is not re-run in P7 (D-057; §10 residual 5). The ADR evidence of each pinned version stays where ADR-0001 and later recorded it.

### 8. The scan of built assets and configuration (REQ-S19-019)

`tools/release/scan-assets.mjs --web <dir> --runtime <dir> --config <repo root>` (DO-A). It uses no dependency and no network, and never reads `docs/delivery/**` (D-138).

**Targets:**

| Target | Files |
| --- | --- |
| **T1** first-party built output | `apps/web/dist/**`, `apps/api/dist/**`, `apps/worker/dist/**`, `packages/*/dist/**` (from `--web` and the build tree) |
| **T2** configuration | `deploy/**`, `.env.example`, `deploy/service-list.json`, root and workspace `package.json` |
| **T3** third-party runtime packages | `node_modules/**` of the assembled runtime tree (`--runtime`) |

Files larger than 20 MiB are hashed and listed as `skipped-size`, never silently passed. Binary files (a NUL in the first 8 KiB) are scanned as latin1 for ASCII patterns only.

**Rules.** R3's key shapes are `KEY_SHAPES` in `tools/release/lib/patterns.mjs`. That module was delivered by this task, with its self-test `tools/release/tests/patterns.test.mjs`, and is shared with ADR-0063 S1. It is frozen after ARCH-01, so DO-A and DO-B, which run in the same wave, never edit a common file. The table lists the shapes in simplified form, and the module adds boundary look-arounds.

| Rule | Detects | T1 | T2 | T3 |
| --- | --- | --- | --- | --- |
| **R1 public-cdn** | Every host of `scripts/check-no-cdn.mjs` `BANNED` (a test asserts the superset relation by reading that file's text), plus `cdn.*`, `*.cdn.*` hostnames, `fonts.*` hostnames, `*.cloudflareinsights.com`, `*.sentry.io`, `*.segment.io`, `*.mixpanel.com`, `*.hotjar.com`, `*.intercom.io`, `plausible.io`, `*.datadoghq.com` | fail | fail | fail |
| **R2 builder-host** | builder or workspace hosts and identifiers: `claude.ai`, `*.anthropic.com`, `*.claude.com`, `*.githubusercontent.com`, `*.github.dev`, `*.codespaces*`, `*.repl.co`, `*.vercel.app`, `*.netlify.app`, `*.ngrok*`; the repository slug and owner read at scan time from `git remote get-url origin`, if any; the paths `/home/user/`, `/root/`, `/var/tmp/mth-run`, `/tmp/claude`; `session_[A-Za-z0-9]{20,}` | fail | fail | fail[^t3] |
| **R3 personal-key** | key shapes: `sk-ant-[A-Za-z0-9_-]{20,}`, `sk-[A-Za-z0-9]{32,}`, `AKIA[0-9A-Z]{16}`, `ASIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{60,}`, `xox[abprs]-[A-Za-z0-9-]{10,}`, `AIza[0-9A-Za-z_-]{35}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `eyJ[A-Za-z0-9_-]{10,}\.eyJ` | fail | fail | fail[^t3] |
| **R4 unlisted-host** | any absolute `http(s)://` or protocol-relative `//host/` URL whose host is not on the allow-list | fail | fail | not applied |
| **R5 hosted-data-service** | builder-hosted databases and storage URLs: `*.supabase.co`, `*.firebaseio.com`, `*.firebasestorage.app`, `*.neon.tech`, `*.planetscale.com`, `*.mongodb.net`, `*.s3.amazonaws.com`, `s3.*.amazonaws.com/<bucket>`, `*.blob.core.windows.net`, `storage.googleapis.com` | fail | fail | not applied[^t3b] |
| **R6 personal-email** | an e-mail address whose domain is not `example.invalid`, `example.com`, `example.org`, `example.net`, `*.example`, `*.invalid` or `*.test` | fail | fail | not applied |

[^t3]: In T3, a hit is reported with the package name and version. A hit can be accepted only by an allow-list entry naming `package@version`, the file path and the SHA-256 of the file, with a reason.

[^t3b]: Third-party SDKs (for example `@aws-sdk/client-s3`) contain cloud endpoint templates that are used only when configured. The hub's S3 adapter requires an explicit endpoint (ADR-0054), so R5 targets the hub's own output and configuration.

**The allow-list** `tools/release/asset-scan-allowlist.json` holds entries `{ "rule", "target", "host" | "file"+"sha256", "reason" }`. A reviewer reads every reason. The rules are:

- an entry that matches nothing fails the scan (`scan-assets: stale allow-list entry <n>`), so the list cannot grow silently;
- R1, R3 and R5 hits in T1 and T2 can **never** be allow-listed (the loader refuses such an entry);
- the expected T1/T2 entries, to be confirmed by DO-A from a real run:
  - XML namespace and schema identifiers (`www.w3.org`, `json-schema.org`), never fetched;
  - documentation links inside bundled library error messages (for example `react.dev`), never fetched;
  - the container registries in `deploy/images.lock.json` (`docker.io`, `quay.io`, `mcr.microsoft.com`), the pull sources IT mirrors (`restricted-network.md` §"Images to mirror"), which are build-time and never contacted at runtime;
  - the placeholder origins `*.example.internal` and `localhost`.

**Output:** one line per hit as `<target> <rule> <path>:<line>: <masked context>`. The matched value is replaced by `[<rule>:<first 4 chars>…]`, so a key is never printed whole. The last line is `scan-assets: PASS (<files> files; T1 <n>, T2 <n>, T3 <n>)` or `scan-assets: FAIL (<hits> hits)`. Exit 0 is PASS and exit 1 is FAIL. Exit 2 is BLOCKED: a target directory is missing, for example `scan-assets: BLOCKED: apps/web/dist not found; run pnpm -r build first`. A missing target is never a pass.

**The self-test.** A seeded fixture tree `tools/release/tests/fixtures/assets/` holds one planted hit per rule per applicable target and one clean twin per target. The test asserts each planted hit is reported with its rule and target, the masked output never contains the full planted value, the clean twins pass, and a stale allow-list entry fails. The planted values are synthetic and built at test time from fragments, so the repository itself never contains a whole key shape and ADR-0063's repository scan stays clean.

**"The offline e2e run passes"** is the second half of REQ-S19-019. It is slice B's (DO-E's offline drill, ADR-0069) and is not repeated here. The work split's A requirement table points to it.

### 9. How it is tested

The test ids are used in `p7-work-split.md` §A. All are `node --test` files under `tools/release/tests/` and `licenses/tests/`, dependency-free like the gate tooling, and run in CI by DO-A's job (§9.1). A test that needs an installed workspace or a built tree exits BLOCKED with the reason when it is missing.

| Id | Proves (acceptance clause) |
| --- | --- |
| T-A1 | Two builds of the same candidate and `demo-data` input give byte-identical `.tar` and `.tar.gz` (§3) |
| T-A2 | The verifier passes a fresh archive, and fails each tamper: one changed byte in a `source/` file, a removed file, an added top-level directory, a missing role directory, a wrong `--expect-sha256`, a wrong `--candidate`, and an `infra/` copy differing from `source/` (REQ-S19-001) |
| T-A3 | GNU tar (and bsdtar if installed) extracts the archive, and `sha256sum -c SHA256SUMS` passes on the extracted tree (REQ-S19-001) |
| T-A4 | `source/` hashes to the candidate id `tools/gates/candidate.mjs` prints for the same commit (§4.2; p7-plan §4.1) |
| T-A5 | The build from the archive succeeds inside a network namespace: probe failure is asserted, no `.git`, offline install, build, runtime assembly and asset scan all exit 0 (REQ-S19-002) |
| T-A6 | The service list equals the Compose services; adding a service to a Compose fixture without a role, or changing an image or profile, fails `--check` (REQ-S19-003 "the service list matches the Compose file") |
| T-A7 | A shipped (runtime/bundled) fixture package without a licence id fails `--check`, and the real inventory lists every runtime and bundled package with a licence (REQ-S19-003 "the SBOM lists every runtime dependency with licence") |
| T-A8 | Direct-dependency check: a range spec, a version not in the lockfile, and a direct dependency with `NOASSERTION` each fail. The real repository passes (REQ-S16-009 "every direct dependency is pinned … and listed … with its licence") |
| T-A9 | Procurement classification over a fixture table of SPDX expressions (each row of §7, plus `OR`/`AND` cases), and the real inventory has the two new columns with no empty `procurement` (REQ-S16-009 "any licence requiring procurement is flagged") |
| T-A10 | The asset-scan self-test (§8) |
| T-A11 | The asset scan over the real built SPA, runtime tree and configuration exits 0 (REQ-S19-019 first half) |

#### 9.1 CI (DO-A)

A `release` job in `deploy/ci/ci.yml`, copied verbatim to `.github/workflows/ci.yml` as that file's header requires, after `delivery-gates` and with no status-function `if:` (check-ci-needs). It runs:

- `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` (Node 24 does not accept a directory argument: `node --test tools/release/tests/` exits 1 with "test failed", observed in this run);
- `node tools/release/service-list.mjs --check`;
- a `--rehearsal` archive build and `--verify`;
- `scan-assets.mjs` on the built tree.

Live CI has never run on a hosted runner (D-058). The job is checked statically by `check-ci-needs.mjs`, and its steps are run locally by DO-A, with that stated in the handback.

## Consequences

- IT receives one archive whose directories separate the four artefacts. The candidate id the gate approved can be recomputed from `source/`, and `sha256sum -c` works on the unpacked tree.
- The build from the archive is proven with no network at all, which is stronger than "without builder-hosted services" (REQ-S19-002).
- The licence inventory gains two columns. The SBOM gains two properties per component. The `--check` refusals for direct dependencies are new, and the base passes them.
- `deploy/service-list.json` becomes a committed generated file, like `.env.example`. Every later Compose change must regenerate it.

## Residuals (honest)

1. **`.tar.gz` reproducibility** is claimed for the same Node major and zlib only (§3). The `.tar` is reproducible everywhere.
2. **`demo-data/` bytes are not reproducible across two seedings**, because the seed writes `now()` timestamps. It is an input with a recorded hash. Content equality across re-exports rests on ADR-0050's checksum, if ADR-0064 carries it (handback O2).
3. **The image build from the archive, and `docker compose up` from it,** need a Docker daemon. They are the orchestrator's half (D-243 Q1). Until that run is recorded, they are not evidence for REQ-S19-002.
4. **No IT npm mirror exists here.** The agent build uses the store the orchestrator's sandboxed installs filled. The mirror path is documented, not demonstrated (D-057).
5. **The registry half of M0314** (support windows, deprecation, latest versions) needs network (`verify-dependency-pins.mjs`). It was recorded per ADR when each version was chosen and is not re-verified in P7.
6. **The asset scan is pattern-based.** It shows that the listed classes are absent. It cannot prove that no runtime dependency on an unlisted builder service exists. That proof is the offline e2e run (slice B, DO-E), which REQ-S19-019 requires as its second half.
7. **The procurement flag is an engineering classification** of SPDX expressions. It is not a legal or procurement decision.
8. **Live CI** of the new job is not run (D-058).

## Alternatives considered

- **Move demo seed code into a top-level `demo-data/` in the repository.** Rejected by D-243 Q2: it would reopen DG5 (ADR-0050) for no behaviour gain.
- **System `tar --sort=name --mtime=… --owner=0 --group=0 --numeric-owner` for packing.** Rejected because the flags are GNU-only (bsdtar on macOS differs), and the result would depend on the host's tar version. A Node writer of about 150 lines gives the same bytes everywhere the `.tar` is concerned. GNU tar is still used, and tested, for **extraction**.
- **A `tar` or `archiver` npm package.** Rejected: it would be a new dependency, against p7-plan §4.
- **ZIP.** Rejected because ZIP stores DOS timestamps and per-entry extra fields that vary between writers, `sha256sum -c` cannot check the result without unpacking, and tar.gz is the usual Linux handover format.
- **Bundling the pnpm store inside the payload archive.** Rejected because it would multiply the size several times and put third-party package bytes inside the payload. It is a separate artefact (§5.2) whose integrity the lockfile already fixes.
- **Scanning third-party runtime code for every URL (R4 on T3).** Rejected because SDKs and libraries contain thousands of documentation and template URLs that are never contacted. The allow-list would become unreviewable. T3 gets the rules that indicate a real problem (R1, R2, R3).
- **Writing orchestration manifests (Kubernetes, Helm) for an assumed target.** Rejected by D-243 Q12: no target is known, so they would be untested claims.

## Version evidence (M0314)

No new dependency, runtime or development, is introduced. The tools used and verified in this run:

| Tool | Version (command) | Use | Licence |
| --- | --- | --- | --- |
| Node.js | 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin/node`; zlib `1.3.2.1-motley-8002e91`) | `node:zlib`, `node:crypto`, `node:fs` for the tar writer, checksums and gzip | MIT (already pinned, ADR-0001) |
| pnpm | 10.33.0 (`pnpm --version`; `packageManager` in `package.json`) | offline install, `pnpm fetch` | MIT (already pinned, ADR-0001) |
| `yaml` | 2.8.1 (`licenses/inventory.csv`, development, `apps/api`) | Compose parsing in `service-list.mjs` | ISC (already in the lockfile) |
| GNU tar | 1.35 (`tar --version`) | extraction in `build-from-archive.sh` and the interop test | GPL-3.0-or-later, host tool, not shipped |
| util-linux `unshare` | 2.39.3 (`unshare --version`) | network namespace | GPL-2.0-or-later, host tool, not shipped |
| bubblewrap | 0.9.0 (`bwrap --version`) | fallback network namespace | LGPL-2.0-or-later, host tool, not shipped |

The host tools are existing parts of the build host, not dependencies of the product, and are not redistributed in the archive.
