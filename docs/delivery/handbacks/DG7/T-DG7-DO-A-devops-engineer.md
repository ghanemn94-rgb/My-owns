# Handback T-DG7-DO-A (devops-engineer): Slice A — archive, offline build, service list, procurement flag, asset scan

- **Stage / gate:** P7, DG7 (BUILDING). Engineering work only. Nothing here is a business, Finance or IT approval. Product gate G6 does not imply DG7, and DG7 does not imply G6.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-A.md` (sha256 `3f5c75c5054afe599994779b4548c9d4bcc8f538c53f607c8aa5958533817e6e`). Work split `docs/architecture/p7-work-split.md` §A.1; ADR-0062; D-243, D-244 (O2 → `sourceEnvironment` / `demoChecksum`, confirmed by ADR-0064 l.59–60).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-A-devops-engineer-20261112T150213Z-a1b38000","session_id":"a1b38000-0c16-4b27-b425-f230350f02db"}`.
- **Base:** `cb02a91bc83f4eeb4650efd783158604ed0b51bb` (`HEAD` at start, branch `claude/mobily-transformation-platform-dg6-regate`). Nothing was committed; the changes are in the working tree.
- **Time:** started 2026-11-12T15:02:23Z, handback 2026-11-12T15:40Z (`date -u`).
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-DO-A-evidence/`. In the logs, `$TMPDIR` stands for this run's private scratch directory.

## 0. Summary

Everything §A.1 lists under "Creates" and "Changes" exists, with one exception: `.github/workflows/ci.yml` is read-only in this sandbox, so the orchestrator must copy it (§4).

| Test | Result |
| --- | --- |
| T-A1, T-A2, T-A3 (GNU tar), T-A4, T-A6, T-A7, T-A8, T-A9, T-A10 | **PASS** |
| T-A3 bsdtar half | **NOT RUN**: "bsdtar not installed" (SKIP) |
| **T-A5** | **FAIL** |
| **T-A11** | **FAIL** |

Both failures come from defects in `deploy/scripts/assemble-runtime.sh`, which is read-only to DO-A. Neither defect is in the new tools:

- **P-1 (proposed High, mandatory: deployment portability).** It derives package names with `d.replace(/_.*$/, "")`, so `string_decoder@1.1.1` becomes `string`, and its layout check refuses the runtime tree. The Dockerfile (l.59) and `clean-start-local.sh` (l.123) call the same script, so the image build and the clean start are affected the same way. The row has been in the inventory since the DG6 base `d756000bd`.
- **P-2 (proposed Medium).** The assembled runtime tree records the absolute path it was assembled in, inside pnpm's own metadata. The asset scan flags that path as a builder path (R2).

Details and proposed fixes are in §5.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `tools/release/build-archive.mjs` (new) | ADR-0062 §1–§4. It builds the payload archive, writing the four role directories, `ARCHIVE-MANIFEST.json`, `SHA256SUMS` and `README.txt`, with the candidate id recomputed through `tools/gates/lib/candidate.mjs` (imported read-only). `--verify` runs 7 checks without extracting to disk. `--pack-store` packs the store artefact (§5.2). Module API: `buildArchive`, `verifyArchive`, `ARCHIVE_README_TEXT` (also `packStore`, `readDemoData`). |
| `tools/release/lib/tar.mjs` (new) | ADR-0062 §3. Deterministic ustar/pax writer and reader, with the deterministic gzip header (OS byte 255, mtime 0). Node built-ins only. |
| `tools/release/build-from-archive.sh` (new) | ADR-0062 §5.1: checksum, then an empty work directory, `.git` assertion, namespace (`unshare`, falling back to `bwrap`), network probe, then install, build, assemble, check-no-cdn and scan-assets. Exit 3 means no namespace. |
| `tools/release/service-list.mjs` (new) | ADR-0062 §6, with `SERVICE_ROLES` (verbatim) and `EXTERNAL_DEPENDENCIES` (A.3 verbatim). `--check`; `--root` for fixtures. |
| `deploy/service-list.json` (new, generated) | 8 services; 5 external dependencies; summary (483 packages, procurement counts, 4 images). |
| `tools/release/scan-assets.mjs` (new) | ADR-0062 §8. Targets T1–T3, rules R1–R6, masking through `patterns.mjs` `mask`, an allow-list loader with the refusals, stale-entry detection, and BLOCKED exit 2 when a target is missing. |
| `tools/release/asset-scan-allowlist.json` (new) | 72 entries (31 T1/T2, 41 T3), each with a reason. Every one is matched by the real built tree (no stale entry). |
| `tools/release/tests/{tar,build-archive,build-from-archive,service-list,scan-assets}.test.mjs` (new) | T-A1–T-A6, T-A10, T-A11. |
| `tools/release/tests/helpers.mjs` (new) | Test support: fixture git repository, `runNode`, temporary directories. Not named in the work split (§3 D9). |
| `tools/release/tests/fixtures/{archive,demo-data,assets,compose}/**` (new) | Synthetic fixtures. `demo-data/manifest.json` has `"fixture": true` and `"sourceEnvironment": "demo"`. |
| `licenses/tests/{procurement,direct-dependencies,runtime-licences}.test.mjs`, `licenses/tests/helpers.mjs`, `licenses/tests/fixtures/workspace/**` (new) | T-A9, T-A8, T-A7. A three-package fixture workspace; its `node_modules` is written at run time. |
| `licenses/generate-sbom.mjs` (modified) | Two appended columns; the `mth:procurement` and `mth:procurement-reason` SBOM properties (packages and containers); the procurement rule (`classifyLicence`, `classifyImage`, with `PostgreSQL` image-only); the direct-dependency `--check`; `--root`. The main block is guarded so the tests can import it. The existing output is otherwise unchanged. |
| `licenses/lib/lockfile.mjs` | **Not changed.** `buildInventory` already returns the parsed `lock` with the importers. |
| `licenses/inventory.csv`, `licenses/sbom.cdx.json` (regenerated by the script only) | New header `name,version,license,scope,direct_dependency_of,integrity,procurement,procurement_reason`. |
| `licenses/README.md` (modified) | Table row updated; new "Procurement flag" section with the "not legal advice and not a procurement decision" sentence; "State at DG7" paragraph with the counts. |
| `deploy/ci/ci.yml` (modified) | New `release` job (ADR-0062 §9.1), `needs: [delivery-gates]`, no `if:`. |
| `.github/workflows/ci.yml` | **Not changed: read-only in this sandbox** (`cp: cannot create regular file '.github/workflows/ci.yml': Read-only file system`). See §4. |
| `docs/operations/restricted-network.md` (modified) | Only §"Building in a restricted network": the store artefact (§5.2) and `build-from-archive.sh`. §"Images to mirror" is untouched (DO-E). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-A-devops-engineer.md`, `…-evidence/*.log` | This handback and its logs. |

Frozen and read-only files are unchanged (`git diff --quiet HEAD -- deploy/compose deploy/images.lock.json .env.example scripts/check-no-cdn.mjs deploy/scripts/assemble-runtime.sh tools/release/lib/patterns.mjs` → exit 0; `checks.log`). No migration, advisory lock, OpenAPI operation, permission, i18n key or product module was added.

SHA-256 of the main deliverables (working tree at handback):

```text
1b9cab82570559795466bdeee4cb5b4c7a1686f2037523f58404fa4759cb880a  tools/release/build-archive.mjs
bb3b66988b958b26f65e84c0bcf1fb20405a49dd9ca90518a2993f6c5e0f6dee  tools/release/lib/tar.mjs
e83af1a98fb1296fb1de15601b55bd32c93c12fd3a7d4e48bc9e23ccfd63764a  tools/release/build-from-archive.sh
e220ce36ddfbd911bb5711c773f3c2ca8d547b630381c1c74837ac434149f3a4  tools/release/service-list.mjs
37269237dba4e1e1ee31bf7fb069813d70d44b4690349d35de7607f9de963310  tools/release/scan-assets.mjs
9497a37665abab6da0aeba0c2ec84d1d9e7fb781aa91a614a69472123f375429  tools/release/asset-scan-allowlist.json
f0103e418d0d6a45b70c228eddd69064341803fae3f3a776a32c2e63122d45e3  deploy/service-list.json
ed7226e26f7a6b05e1e73ecd823d9980c078caa626e9e0431fd8f74fd4ac6c07  licenses/generate-sbom.mjs
c8248f46a0b28007134b39b9a1b683b2b73f5a40a8c97a22f206d3bd892a2304  licenses/inventory.csv
eff94c4d60d288f73b6c8f26af13e0999b123c8d7ebd27d90bbc2ce4e5ed993e  licenses/sbom.cdx.json
4d03d75bdf1991cec668ebdacf486077f5dbad1d28be2c0c0ebdf250d9bc1ff8  deploy/ci/ci.yml
```

## 2. Behaviour delivered, per requirement

| Requirement / clause | Delivered | Test status |
| --- | --- | --- |
| REQ-S19-001 "the archive checksum matches the recorded value" | `<name>.tar.gz.sha256` and `build-report.json`; `--verify` check 1. | T-A2 PASS (the right hash passes, a wrong one fails with exit 1). |
| REQ-S19-001 "separate app, infra, docs and demo-data directories" | `source/` (role `app`, D-244 O1), `infra/`, `docs/`, `demo-data/`; checks 3 and 6. | T-A2 PASS (extra top-level directory and missing role both fail), T-A3 PASS (GNU tar). |
| REQ-S19-001 procedure "checksummed archive from the approved commit" | The `.tar` and `.tar.gz` are reproducible. `source/` equals the candidate manifest at the commit. | T-A1 PASS, T-A4 PASS. |
| REQ-S19-002 "a clean build from the archive succeeds without network access" | `build-from-archive.sh`. Inside `unshare --user --map-root-user --net`: probe TCP `ENETUNREACH`, DNS `EAI_AGAIN`; no `source/.git`; offline install exit 0 (1.2 s); `pnpm -r build` exit 0 (119.1 s). | **T-A5 FAIL**: the `assemble` step exits 1 on P-1 (§5). Not complete. |
| REQ-S19-003 "the SBOM lists every runtime dependency with licence" | Existing rule kept; T-A7 adds a fixture proof. | T-A7 PASS (171 runtime + 15 bundled rows, all licensed). |
| REQ-S19-003 "the service list matches the Compose file" | `service-list.mjs`, `deploy/service-list.json`, `--check`. | T-A6 PASS. |
| REQ-S16-009 "every direct dependency is pinned … and listed … with its licence" | Direct-dependency `--check` (3 messages, exact A.3 text). | T-A8 PASS; real repository: `direct-dependency-problems=0`. |
| REQ-S16-009 "any licence requiring procurement is flagged" | `procurement` / `procurement_reason` columns and SBOM properties. | T-A9 PASS; packages: 426 `not_required`, 57 `review`, 0 `required`; images: 2 `review`, 2 `not_required`. |
| REQ-S19-019 "a scan of built assets and configuration finds no public CDN, builder host or personal key" | `scan-assets.mjs`; the allow-list. | T-A10 PASS. **T-A11 FAIL**: 48 R2 hits, all the assembly path inside pnpm metadata (P-2). All other built output is clean. |
| REQ-S19-019 "and the offline e2e run passes" | Not DO-A's (DO-E, ADR-0069). | — |

## 3. Checks actually run

**Environment.**

| Item | Value |
| --- | --- |
| Node | 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`, put first on `PATH`). The shell's default `node` is 22.22.0: an environment fact, not used for any check. |
| zlib | `1.3.2.1-motley-8002e91` |
| pnpm | 10.33.0 |
| Host tools | GNU tar 1.35; util-linux `unshare` 2.39.3; bubblewrap available; `bsdtar` absent; `/usr/bin/time` absent |
| Locale | Unset (`LANG`/`LC_ALL` unset), and `C.UTF-8` for the repeat run |
| Network | No outbound network inside the namespaces (probes above) |
| Docker | No daemon (D-243 Q1) |
| Disk | About 3.2–3.8 GB free during the run. The first trial clone (a full checkout, 3.0 GB of `docs/`) filled the disk to 413 MB free; I deleted it and switched to object-only clones. |

**The commit used for the archive builds.** The new tools are uncommitted, and committing is not mine to do. I built the archives from a disposable `git clone --shared --no-checkout` under `$TMPDIR`, with one extra commit made only in that clone: HEAD plus this run's working tree (`a51f3a8fbfcef44bde77438e71cef1905c1fba20`). The repository's `.git` was not written.

**The pnpm store.** The sandbox host store `/root/.local/share/pnpm/store/v10` (290 MB) is read-only to this run. pnpm needs a writable store: the first trial failed with `EROFS … symlink … store/v10/projects`, install exit 226. The builds therefore used a byte copy under `$TMPDIR/pnpm-store-root/v10`.

| # | Command | Result | Exit | Log |
| --- | --- | --- | --- | --- |
| 1 | `MTH_RELEASE_REPO=$TMPDIR/clone1 MTH_RELEASE_COMMIT=a51f3a8f… MTH_PNPM_STORE=$TMPDIR/pnpm-store-root/v10 MTH_RELEASE_SOURCE_DIR=<built source/> MTH_RELEASE_RUNTIME_DIR=$TMPDIR/bfa-final/runtime node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` (locale unset) | tests 58, pass 55, **fail 2 (T-A5, T-A11)**, skipped 1 (bsdtar), 135.2 s | **1** | `node-test-release.log` |
| 2 | Same suite without the T-A5/T-A11 inputs (`MTH_PNPM_STORE=/nonexistent`), locale unset and `LC_ALL=C.UTF-8`, after the fixture fix in §3 D10 | Each run: tests 58, pass 55, fail 0, skipped 3 (T-A5 and T-A11 "BLOCKED: …", bsdtar "not installed"). Skips are not passes. | 0, 0 | `node-test-release-postfix.log` |
| 3 | `node licenses/generate-sbom.mjs --check` | `OK: packages=483 runtime=171 bundled=15 development=297 containers=4 shipped-without-licence-id=0 procurement(not_required=428 review=59 required=0) direct-dependency-problems=0 lockfile-sha256=4dd7e22d…64ba65` (the counts include the 4 images) | 0 | `checks.log` |
| 4 | `node tools/release/service-list.mjs --check` | `service-list: OK deploy/service-list.json matches the Compose files` | 0 | `checks.log` |
| 5 | `node deploy/scripts/check-ci-needs.mjs deploy/ci/ci.yml` | OK, 7 jobs, `release <- delivery-gates` | 0 | `checks.log` |
| 6 | `node deploy/scripts/check-ci-needs.mjs` (default `.github/workflows/ci.yml`, the old copy) | OK, 6 jobs | 0 | `checks.log` |
| 7 | `node tools/release/build-archive.mjs --repo $TMPDIR/clone1 --commit a51f3a8f… --demo-data tools/release/tests/fixtures/demo-data --rehearsal --out $TMPDIR/rel-final` | `mth-transformation-hub-0.1.0-a9679ce70fd7-REHEARSAL.tar.gz`: 12,669,468 bytes; archive sha256 `0dcc0c18280769a1f17c8706188db3204ef1bd160d8b6e2de4e911275ac1e2c5`; tar sha256 `7efe1c3651a0727d5b88b5dcfe74c884ed5ca0227133651185a8c3a9cbb1f1d8`; candidate `sha256:a9679ce70fd70161aa07a773a8ddb946a416469380e0495f8b427d090debde3f`; 3004 files (source 2840, infra 65, docs 93, demo-data 3); 12.35 s | 0 | `rehearsal-archive.log` |
| 8 | `node tools/release/build-archive.mjs --verify <that archive> --expect-sha256 0dcc0c18…` | 7/7 ok, `archive-verify: PASS` | 0 | `rehearsal-archive.log` |
| 9 | `tools/release/build-from-archive.sh <that archive> --sha256 0dcc0c18… --store $TMPDIR/pnpm-store-root/v10 --work $TMPDIR/bfa-final --keep` | checksum ok; unpack 0.3 s; probes fail as required; install exit 0 (1.2 s); build exit 0 (119.1 s); **assemble exit 1** (`not in the shipped set: string_decoder@1.1.1`); total 122.2 s; `build-from-archive: FAIL (exit 1)` | **1** | `build-from-archive.log` |
| 10 | Steps 4–5 run by hand on the kept tree: `node scripts/check-no-cdn.mjs apps packages` | `PASS no-cdn` | 0 | `scan-assets-built-tree.log` |
| 11 | `node tools/release/scan-assets.mjs --web <source>/apps/web/dist --runtime $TMPDIR/bfa-final/runtime --config <source>` | `scan-assets: FAIL (48 hits)`. All 48 are `T3 R2 … [R2:/var…]` in `runtime/node_modules/.modules.yaml`, `.pnpm-workspace-state-v1.json` and `.bin/*` shims (P-2). No stale entry. T1/T2 and all third-party content are clean. | **1** | `scan-assets-built-tree.log` |
| 12 | `pnpm lint` | `eslint . --max-warnings=0` clean. `tools/**` is in the ESLint ignores, so only the `licenses/` files are linted. | 0 | `lint.log` |
| 13 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | All files formatted. The final re-run after the last edit also exited 0. | 0 | `prettier.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG6` | `PASS gate DG6 (historical)` | 0 | `validate-historical-DG6.log` |

**Other non-zero exits during development, disclosed (rule 2):**

- trial builds of earlier rehearsal archives:
  - install exit 226 (EROFS store);
  - install exit 1 (`ERR_PNPM_NO_OFFLINE_TARBALL`: the store path pointed at a fresh empty `v10/` below the copy, fixed in the script);
  - assemble exit 1 (P-1);
- the first archive smoke run under `/usr/bin/time` (exit 127, no such binary);
- one `service-list.test` failure from a wrong fixture edit, fixed;
- `pnpm lint` exit 1 (two `no-unused-expressions` in `generate-sbom.mjs`), fixed;
- prettier exit 123 on `generate-sbom.mjs`, fixed;
- `cp … .github/workflows/ci.yml` read-only;
- `node --test` exit 1 in run 1 above.

**Not run:**

- **Live CI** (D-058): the `release` job was only checked statically (check-ci-needs) and its steps run locally as above.
- **bsdtar interop:** not installed.
- **Image build and `docker compose up` from the archive:** no Docker daemon (D-243 Q1). The orchestrator's half:

  ```bash
  tar -xzf <archive> && cd mth-transformation-hub-<version>/source
  deploy/scripts/build-image.sh --tag mth-app:archive
  deploy/scripts/verify-stack.sh --skip-build
  ```

  It will hit P-1 in the Dockerfile (l.59) until P-1 is fixed.
- **A local Compose run is not proof of high-availability production readiness.**

**Measured observations:**

- **Archive determinism:** two builds of the same inputs are byte-identical (T-A1).
- **Web build determinism:** two independent archive builds (different archives, same `apps/` sources) produced the same `apps/web/dist/assets/vendor-forms-DLh3TFGs.js.map` (sha256 `a200f5df…f228`).
- **The repository's own `apps/web/dist`** has a different map (`vendor-forms-BNqHBvhj.js.map`, `dc348204…6324`). It is a stale build, not this candidate's.

## 4. Merge instructions

1. Take the working-tree changes as listed in §1. There are no migrations and no ordering constraints with ARCH-02 or DO-B: no shared writable file, and `patterns.mjs` is untouched.
2. **CI owner step the sandbox prevented.** Run `cp deploy/ci/ci.yml .github/workflows/ci.yml` and then `node deploy/scripts/check-ci-needs.mjs`.
   - This also carries the DG6 changes that were already in `deploy/ci/ci.yml` but missing from `.github/workflows/ci.yml` at the base: the integration log canaries and the post-suite log scan (l.110–152), and `log-scan.test.mjs` in the images job.
   - The two files differed at `cb02a91b` before this task: `cmp` reports a difference at line 110.
   - DO-B's `tools/release/ci/secret-scan.job.yml` fragment merges after this.
3. **Index line requests:** none; DO-A adds no file under `docs/handover/`.
4. **For later Compose changes (DO-F, DO-D):** add one `SERVICE_ROLES` line in `tools/release/service-list.mjs` and run `node tools/release/service-list.mjs`. Rerun it after any `node licenses/generate-sbom.mjs` too, because the list's dependency summary is computed from the inventory.
5. **For the freeze verification and DO-D/DO-J:**
   - Run `scan-assets` on a **fresh** build of the candidate, not on the repository's stale `apps/web/dist`. The R6 allow-list entry is pinned to the candidate's build output (§3 D7).
   - `build-from-archive.sh` needs a **writable** store; pass either `<dir>` or `<dir>/v10`.
   - T-A5 and T-A11 read `MTH_RELEASE_REPO`, `MTH_RELEASE_COMMIT`, `MTH_PNPM_STORE`, `MTH_RELEASE_SOURCE_DIR` and `MTH_RELEASE_RUNTIME_DIR`. Without them they skip as BLOCKED and are never reported as passes.

### 3-bis. Deviations from the work split and ADR (with reasons)

| # | Deviation | Reason |
| --- | --- | --- |
| D1 | ADR §2 writes `manifestFromRef(repo, APPROVED_SPEC, <commit>)`. The real signature is `(repo, ref, spec)`, and I used it that way. | Text slip in the ADR. |
| D2 | `infra/manifests/` holds the **workspace** manifests: root, `apps/*`, `packages/*` (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` if tracked). | "Every `package.json`" read literally would copy test-fixture manifests (e.g. `licenses/tests/fixtures/**`), which are not dependency manifests of the product. |
| D3 | Extra messages not in A.3, all with the specified exit codes: `--commit must be a full 40-hex commit id` (2); `SOURCE_DATE_EPOCH is not an integer` (2); `refused path "demo-data/README.txt" (the README is generated)` (1); `service-list: service '<n>' image '<i>' is not a deploy/images.lock.json entry` (1); `service-list: SBOM container components … differ …` (1); `scan-assets: BLOCKED: allow-list entry <n> refused: <why>` (2); `build-from-archive: archive checksum <x> does not match <y>` (1); `build-from-archive: BLOCKED: work directory … is not empty` (2). | ADR rules that need a message A.3 does not give. |
| D4 | `ARCHIVE-MANIFEST.json` `tool.node` is the running Node version, as ADR §4.2 specifies. This makes the `.tar` bytes depend on the Node version, against §3's claim that they are "a pure function … on any platform". | ADR internal conflict (open question Q1). |
| D5 | R4 reports single-label hosts (`api`, `keycloak`, and `localhost`) and lists them in the allow-list. Reserved names are listed as `*.invalid`, `*.example` and `*.example.internal`. The ADR's expected `docker.io` and `mcr.microsoft.com` entries are **not** listed. | No file in T2 names them, so the entries would be stale and fail the scan. |
| D6 | The URL pattern does not take a host followed by a backslash. | `https://exa\nmple.com` in a library comment is not a host. |
| D7 | The R6 T1 entry (decimal.js author's address in the MIT header kept in the forms vendor **source map**) is `file` + `sha256` of a content-hashed Vite file. | A `gmail.com` host entry would hide exactly what R6 is for. The entry fails as stale whenever that chunk changes, which forces a fresh review (Q3). |
| D8 | T-A4 runs `tools/gates/candidate.mjs --stage DG7 --ref <commit>` in a **sparse** `--shared` clone (only `/tools/gates/` and `/docs/delivery/stages.json` checked out). | A full checkout is about 3 GB of delivery records and filled the disk once. `--ref` hashes the committed tree, the same input the archive reads. |
| D9 | Added `tools/release/tests/helpers.mjs` and `licenses/tests/helpers.mjs`. | Test support; not named in §A.1. |
| D10 | The asset fixture's `dist/` and `node_modules/` clean twins are written by the test at run time. | Those paths are git-ignored and would be missing from a clean checkout. |
| D11 | `EXTERNAL_DEPENDENCIES` has no enterprise-messaging row. | `restricted-network.md` lists none (A.3 "if the P6 channel port lists enterprise messaging"). Reported as required. |

## 5. Known gaps, defects found, open questions

**P-1 (proposed finding, High, `mandatory_violation: true`: deployment portability; REQ-S19-002).**

- **Where:** `deploy/scripts/assemble-runtime.sh` l.128: `const base = d.replace(/_.*$/, "")`. This is meant to strip pnpm's peer suffix, but it also truncates names that contain `_`. `string_decoder@1.1.1` (runtime since `d756000bd`) becomes `string`, so the shipped-set check fails: `not in the shipped set: string_decoder@1.1.1`, `layout check failed`.
- **Reach:** the same script runs in the Dockerfile (l.59) and `clean-start-local.sh` (l.123).
- **Reproduced:** twice, in `build-from-archive.log` and in run 1 (T-A5). The archives differ from HEAD only in files this script does not read for that check.
- **Proposed one-line fix (owner: orchestrator-assigned, not DO-A):** `const base = d.replace(/^(.*?@[^_]+)_.*$/, "$1");`. I checked it in a node one-liner on `string_decoder@1.1.1` (unchanged) and `react-dom@19.1.0_react@19.1.0` (→ `react-dom@19.1.0`). I did not run it in the script.
- **T-A5 passes only after this fix.**

**P-2 (proposed finding, Medium; REQ-S19-019).**

- **What:** the runtime tree from `assemble-runtime.sh` records the absolute directory it was assembled in. It appears in `node_modules/.modules.yaml` (`storeDir`), `.pnpm-workspace-state-v1.json` and the `.bin/*` shims' `NODE_PATH`.
- **Effect:** assembled under a builder path, as here under `/var/tmp/mth-run…`, the scan correctly reports R2 hits (48). In the image the path is the Dockerfile's `/src`→`/out/app`, which R2 does not flag. But IT gets a tree that still carries build-host paths.
- **Proposed:** `assemble-runtime.sh` deletes `.modules.yaml`, `.pnpm-workspace-state-v1.json` and the `.bin` shims (the runtime uses `node <file>`, not bins), or the orchestrator decides that these pnpm metadata files are outside T3.
- **T-A11 passes only after one of these.** The rest of the real tree, T1, T2 and every third-party file, is clean, with all 72 allow-list entries matched.

**Not done / not proven:**

- T-A5 and T-A11 (above).
- The bsdtar half of T-A3.
- Live CI.
- The container halves.
- An IT npm mirror serving the store (none exists; ADR residual 4).
- The `--pack-store` output is implemented but not exercised against a `pnpm fetch`-filled store. Agents have no network, and packing the 290 MB host store would have used scarce disk; it has no test.
- `.github/workflows/ci.yml` not installed (§4).

**Open questions:**

- **Q1 (D4):** drop `tool.node` from the manifest (keep it in `build-report.json`), or soften ADR §3's claim?
- **Q2:** `docs/operations/restricted-network.md` §"Runtime" says "A default installation needs exactly two services". The service list confirms `db` plus the IdP; no change made.
- **Q3:** the web build ships `.js.map` source maps in `apps/web/dist`. These carry third-party comments, and with them the R6 address and most of the T1 R4 documentation hosts. Should the SPA ship source maps? That is not DO-A's file (Vite config).
- **Q4:** the archive's `docs/` copies `docs/architecture/**`. That includes `p7-work-split.md` and ADRs which quote planted-pattern descriptions. DO-B's claims scan (T-G6) should be run over the archive's `docs/` before sealing.

**Honesty notes:**

- The demo data in every archive here is the **fixture**, so every archive was a rehearsal (`-REHEARSAL`). A release build refuses it, as tested.
- No real export (BE-C) was available.
- The archive is engineering evidence. Mobily IT's acceptance is external.
- The procurement flag is not legal advice and not a procurement decision.
