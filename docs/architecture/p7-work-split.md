# P7 work split: shared rules, file ownership, contracts and integration order

- **Plan:** `docs/architecture/p7-plan.md` (T-DG7-ARCH-00), adopted by D-243 together with the user's decisions on Q1, Q7 and Q19 and the plan's other recommendations.
- **Sections.** This file holds one section per architecture task (p7-plan §4), and each ARCH task writes only its own section:
  - §1–§2, §A and §G: T-DG7-ARCH-01 (this revision);
  - §C/D: T-DG7-ARCH-02;
  - §E: T-DG7-ARCH-03;
  - §B/F: T-DG7-ARCH-04;
  - §I/H (with the J tooling): T-DG7-ARCH-05;
  - §M (with K and L): T-DG7-ARCH-06.
- **Stage:** P7 "Independent transfer and release" (DG7). Base of this revision: `fe690c01768fb65370c257c80ac8a55e807f9525`.
- **Rule:** two tasks never edit the same file at the same time (REQ-DLV-008). Anything not listed under an owner is **frozen**. Changes to it go through the orchestrator (p7-plan §5.3).
- **Off-limits to every implementer** (the write guard enforces it): `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/test-evidence/**`, `docs/delivery/runs/**`, `docs/delivery/stages.json`, `docs/delivery/findings.json`, `trading_agent/`.
- **Two gate systems.**
  - Product gates G1–G6 are business approvals inside the product. DG0–DG7 are engineering delivery gates.
  - The release tooling of P7 may **read** delivery records (the candidate manifest, and the envelope at sealing). It never writes a gate, review or stage record, and nothing in the product runtime reads them.
  - Product G6 never implies DG7. No agent, seed, tool or job grants a real business, Finance or IT approval.
  - A release archive, a scan result or the security-controls matrix is engineering evidence. Mobily IT's acceptance of the package is external.

## 1. How to read a slice section

Each slice section lists:

- what the architect already delivered (do not re-create it);
- one block per implementer task, with its exact files (create / modify / read only), the contracts it consumes and provides, its exact texts, and its tests;
- the seams with other slices;
- the integration order;
- a requirement → clause → test → owner table;
- what the implementers must know.

Paths are relative to the repository root. Test ids (`T-A…`, `T-G…`) are the ADR's. A test id is satisfied only by a test that **ran** and passed, with its command and exit status in the handback.

## 2. Shared rules for every P7 implementer task

1. **The P6 rules still bind.** `docs/architecture/p6-work-split.md` §2 rules 1–18 apply unchanged, with `p6-pending`/`p6-exercises` read as `p7-pending`/`p7-exercises`. The migration id range accepted by `packages/db/src/seed.test.ts` is updated by the ARCH task that first adds a P7 migration.
2. **The carried rules of the P7 plan** (p7-plan header, D-078 §3, D-088 §2, D-141, D-193) bind every task:
   - strict UTF-8 JSON for every manifest and bundle;
   - no remote I/O inside a transaction;
   - exactly-once jobs (advisory locks and unique backstops);
   - decimal strings for every `numeric` value, never a JSON number;
   - texts true for the release they ship in;
   - harness ports in the pool 25000–31999;
   - verification with the locale unset and with `C.UTF-8`;
   - every non-zero exit disclosed;
   - ADR claims enumerated and exactly true;
   - full 40-hex ids in assignments.
3. **Release tooling (`tools/release/**`).**
   - Node 24 ES modules (`.mjs`), with no dependency.
   - They may resolve the lockfile's `yaml` 2.8.1 from `apps/api` through `createRequire`, the precedent of `deploy/scripts/check-ci-needs.mjs` l.37, and nothing else from `node_modules`.
   - They may import `tools/gates/lib/candidate.mjs` **read-only**. They never edit `tools/gates/**`.
   - They never write under `docs/delivery/**`, and they never walk a delivery folder (D-138). The envelope scope reads only the files the envelope manifest lists.
   - Tests are `node --test` files under `tools/release/tests/` and `licenses/tests/`, run as `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs`. Node 24 refuses a directory argument (observed: `node --test tools/release/tests/` exits 1).
4. **Exit codes of every P7 tool.**

   | Exit | Meaning |
   | --- | --- |
   | 0 | PASS |
   | 1 | FAIL |
   | 2 | BLOCKED: missing or invalid input, or a usage error |
   | 3 | BLOCKED: a missing platform capability (no installed workspace, no network namespace, no Docker daemon) |

   A BLOCKED run prints `BLOCKED:` and the reason, and is never reported as a pass.
5. **Masking.** A scan never prints a matched secret or key whole. It prints `[<rule>:<first 4 chars>…]` plus, where an allow-list entry needs it, the first 12 hex digits of the value's SHA-256 (`tools/release/lib/patterns.mjs` `mask`).
6. **Planted test values.** A self-test assembles every planted key, secret or claim **at run time from fragments**, so the repository never contains a whole planted value and the repository scans stay clean without allow-list entries for test files of `tools/release/**`.
7. **Allow-lists.** Every entry has a reason a reviewer can judge. A stale entry fails its scan. The paths that can never be allow-listed are fixed by the ADRs (ADR-0062 §8, ADR-0063 §1.3, §3.3).
8. **No claim wording.** No P7 document, guide or UI string states or implies conformity to a standard, a certification or an IT approval. A measured result is stated as a measurement ("axe reports no violations on these screens"). ADR-0063 T-G6 enforces this over the archive's `docs/` and the UI strings, this file included.
9. **CI files.** `deploy/ci/ci.yml` is copied verbatim to `.github/workflows/ci.yml`, as that file's header requires. Only the task named as the CI owner of a wave edits them. Others hand over a job fragment file, and the orchestrator merges it and runs `node deploy/scripts/check-ci-needs.mjs`. `.github/workflows/delivery-gates.yml` is protected and never touched.
10. **The handover index.** `docs/handover/README.md` is created by DOC-B (ADR-0072). A task that adds a file under `docs/handover/` before that requests its index line in its handback.

## §A. Slice A: source archive and reproducible offline build (T-DG7-ARCH-01; ADR-0062)

### A.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0062-p7-release-archive-reproducible-offline-build-sbom-procurement-asset-scan.md`.
- `tools/release/lib/patterns.mjs`: `KEY_SHAPES`, `keyShapeRegExps()`, `mask()`. It is shared by DO-A (R3) and DO-B (S1) and **frozen**.
- `tools/release/tests/patterns.test.mjs`: 5 tests, passing at this revision (handback §3).
- None of these: a migration (`0131`–`0132` stay unused), an advisory lock (730400–730401 stay unused), an OpenAPI operation, a permission, an i18n key, a product module.

### A.1 DO-A: archive, offline build, service list, procurement flag, asset scan (devops-engineer; W2; after ARCH-01 is merged)

**Creates:**

| File | Purpose |
| --- | --- |
| `tools/release/build-archive.mjs` | ADR-0062 §1–§4. CLI: build (`--commit <40 hex> --demo-data <dir> [--candidate sha256:<hex>] [--rehearsal] --out <dir>`), `--verify <archive> --expect-sha256 <hex> [--candidate <id>]`, `--pack-store <dir> --out <dir>`. **Module API** (DO-J calls it from `seal.mjs`; ADR-0073): `buildArchive({ repo, commit, demoData, candidate, rehearsal, outDir }) → Promise<{ name, tarSha256, archiveSha256, archivePath, manifest }>`, `verifyArchive(path, { expectSha256, candidate }) → Promise<{ ok, checks: { id, ok, detail }[] }>`, and `ARCHIVE_README_TEXT` (the §2.2 text with a `<version>` placeholder) |
| `tools/release/lib/tar.mjs` | ADR-0062 §3: a deterministic ustar/pax writer and a streaming reader |
| `tools/release/build-from-archive.sh` | ADR-0062 §5.1 |
| `tools/release/service-list.mjs` | ADR-0062 §6, with `SERVICE_ROLES` and `EXTERNAL_DEPENDENCIES` (texts in A.3) |
| `deploy/service-list.json` | generated by `service-list.mjs`; committed |
| `tools/release/scan-assets.mjs` | ADR-0062 §8 |
| `tools/release/asset-scan-allowlist.json` | ADR-0062 §8, with a reason per entry |
| `tools/release/tests/{tar,build-archive,build-from-archive,service-list,scan-assets}.test.mjs` | T-A1…T-A6, T-A10, T-A11 |
| `tools/release/tests/fixtures/{archive,demo-data,assets,compose}/**` | synthetic fixtures. `demo-data/manifest.json` carries `"fixture": true` and `"sourceEnvironment": "demo"` (the field name is provisional until ADR-0064; A.2) |
| `licenses/tests/{procurement,direct-dependencies,runtime-licences}.test.mjs`, `licenses/tests/fixtures/**` | T-A7, T-A8, T-A9 |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `licenses/generate-sbom.mjs` | the two appended columns, the two SBOM properties per component, the procurement rule and the direct-dependency `--check` (ADR-0062 §7) |
| `licenses/lib/lockfile.mjs` | only if the direct-dependency check needs importer data it does not expose yet |
| `licenses/inventory.csv`, `licenses/sbom.cdx.json` | regenerated by the script only, never hand-edited |
| `licenses/README.md` | a "Procurement flag" section (the §7 rule and its "not legal advice and not a procurement decision" sentence), and a new "State at DG7" line with the counts |
| `deploy/ci/ci.yml` and `.github/workflows/ci.yml` | the `release` job (ADR-0062 §9.1). DO-A is the **W2 CI owner** (§2 rule 9) |
| `docs/operations/restricted-network.md` | only §"Building in a restricted network": the store artefact of ADR-0062 §5.2 and `build-from-archive.sh`. §"Images to mirror" is DO-E's (W11) |

**Reads only:**

- `tools/gates/lib/candidate.mjs` (imported);
- `scripts/check-no-cdn.mjs` (its `BANNED` list, read as text for the R1 superset test);
- `deploy/scripts/assemble-runtime.sh` (called, unchanged);
- `deploy/scripts/clean-start-local.sh` (unchanged; slice B's);
- `deploy/compose/*.yaml`, `deploy/images.lock.json`, `.env.example`.

**Consumes:** the `--demo-data` input. In W2 this is a fixture. The real one comes from ADR-0064's export (BE-C) and is used by DO-D's drill and by the seal (A.2).

**Provides:**

- the module API above, for DO-J;
- `scan-assets.mjs`, for DO-E's offline drill and the freeze verification;
- `service-list.mjs --check`, for every later Compose change (A.2).

### A.2 Seams with other slices

| Seam | Rule |
| --- | --- |
| **`demo-data/` ← C (ARCH-02, BE-C)** | ADR-0064 fixes the manifest format. ARCH-02 is asked to: (1) name the environment-marker field (DO-A's fixture uses `sourceEnvironment`) and require it to be `demo` for a demo export; (2) carry the ADR-0050 demo checksum in the manifest (`demoChecksum`), so a re-export is provably content-equal (ADR-0062 residual 2). If ARCH-02 chooses other names, DO-A's fixture and refusal are adapted by an orchestrator-assigned one-line repair, never by BE-C. |
| **The real archive build ← B (DO-D)** | DO-D's transfer drill exports the freshly seeded demo installation (the A18 source dataset), then runs `build-archive.mjs` with that directory and `build-from-archive.sh` on the result. The archive the drill installs is the one it built (p7-plan §2: "A (archive is what B installs)"). DO-D owns the drill, and DO-A owns the tools. |
| **The payload archive at sealing ← M (DO-J, ARCH-06)** | `seal.mjs` calls `buildArchive({ candidate: <DG7 id>, … })` and records `archiveSha256` separately from the payload hash (l.621). The `demo-data/` input used at sealing is the one recorded by the freeze verification, identified by its `inputSha256`. ARCH-06 fixes where that input is kept. |
| **Compose changes → the service list** | DO-F's `backup` profile service and DO-D's `compose.transfer.yaml` make `service-list.mjs --check` fail until regenerated. The task that adds a Compose service also adds **one line** to `SERVICE_ROLES` in `tools/release/service-list.mjs` with the role text its ARCH ADR gives, and regenerates `deploy/service-list.json`. That is a named wiring line (p7-plan §5.3), done sequentially by wave. |
| **Offline e2e (REQ-S19-019 second half) → B (DO-E)** | DO-E's offline drill runs the lifecycle e2e with egress blocked (ADR-0069). The REQ-S19-019 row is complete only with both halves. |
| **Image build and `compose up` from the archive → orchestrator (D-243 Q1)** | They are run on the orchestrator's host with logs as orchestrator evidence. They are not part of DO-A's acceptance. |
| **Key shapes → G (DO-B)** | Both scans import `tools/release/lib/patterns.mjs`, and neither edits it. |
| **The archive's `docs/` → H (ADR-0072)** | `build-archive.mjs` copies `docs/handover/**` as it stands. It neither generates nor validates guide content. |

### A.3 Exact texts

User-facing product text: **none**. Slice A adds no screen, route, problem code or i18n key. The texts below are IT-facing tool and document texts, in English (D-243 Q7). The archive README carries the provisional Arabic summary.

- **Archive `README.txt`:** ADR-0062 §2.2, verbatim.
- **Refusals and messages** (exact; `<…>` are substitutions):

  | Tool | Message | Exit |
  | --- | --- | --- |
  | build-archive | `build-archive: <path>: symlinks and submodules are not archived` | 1 |
  | build-archive | `build-archive: refused path <escaped>` | 1 |
  | build-archive | `build-archive: the files at <commit> hash to <id>, not the expected <expected>` | 1 |
  | build-archive | `build-archive: demo-data has no manifest.json` | 2 |
  | build-archive | `build-archive: demo-data is not a synthetic demo export (environment marker '<value>')` | 1 |
  | build-archive | `build-archive: the fixture demo-data cannot be used for a release build` | 1 |
  | build-archive --verify | one line per check `<n> <check id>: ok` / `<n> <check id>: FAIL <detail>`, then `archive-verify: PASS` or `archive-verify: FAIL (<n> checks)` | 0 / 1 |
  | build-from-archive | `build-from-archive: BLOCKED: no network namespace (unshare and bwrap unavailable)` | 3 |
  | build-from-archive | `build-from-archive: network isolation is not effective` | 1 |
  | service-list | `service-list: no role text for service '<name>'` | 1 |
  | service-list --check | `service-list: deploy/service-list.json is out of date: run node tools/release/service-list.mjs` | 1 |
  | generate-sbom --check | `generate-sbom: <manifest>: <name> is not pinned to an exact version (<spec>)` | 1 |
  | generate-sbom --check | `generate-sbom: <manifest>: <name>@<spec> is not in pnpm-lock.yaml` | 1 |
  | generate-sbom --check | `generate-sbom: direct dependency <name>@<version> has no licence in the inventory` | 1 |
  | scan-assets | `<target> <rule> <path>:<line>: <masked context>`, then `scan-assets: PASS (<files> files; T1 <n>, T2 <n>, T3 <n>)` or `scan-assets: FAIL (<hits> hits)` | 0 / 1 |
  | scan-assets | `scan-assets: stale allow-list entry <n>` | 1 |
  | scan-assets | `scan-assets: BLOCKED: <dir> not found; run pnpm -r build first` | 2 |

- **`SERVICE_ROLES`:** ADR-0062 §6, the table, verbatim.
- **`EXTERNAL_DEPENDENCIES`** (exact; `required`, `offUntil`, `guide`):

  | Name | Required | Off until | Guide |
  | --- | --- | --- | --- |
  | Corporate OIDC identity provider | true | — | `docs/operations/identity-saml-broker.md` |
  | SMTP relay (email notifications) | false | an email channel is configured and enabled | `docs/operations/notifications.md` |
  | S3-compatible object store (evidence) | false | the storage setting is switched to s3 | `docs/operations/storage.md` |
  | Connector source endpoints | false | an http_pull connector is created and enabled | `docs/operations/restricted-network.md` |
  | Assistant model endpoint | false | the assistant setting is enabled with http_endpoint | `docs/operations/restricted-network.md` |

  If the P6 channel port lists enterprise messaging, DO-A adds its row with the text of `restricted-network.md` and reports it.
- **Procurement reasons:** ADR-0062 §7, the table, verbatim.

### A.4 Tests (all `node --test`; each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-A1 | `tools/release/tests/build-archive.test.mjs` | two builds of the same commit and `demo-data` input are byte-identical (`.tar` and `.tar.gz`); the gzip OS byte is 255 and the mtime 0 |
| T-A2 | `build-archive.test.mjs` | `--verify` passes a fresh archive and fails each of the 7 tamper cases of ADR-0062 §9 |
| T-A3 | `tar.test.mjs` | GNU tar 1.35 extracts the archive, and `sha256sum -c SHA256SUMS` passes. bsdtar likewise if installed, or a SKIP line "bsdtar not installed" that the handback reports as not run |
| T-A4 | `build-archive.test.mjs` | the `source/` hash equals `node tools/gates/candidate.mjs --stage DG7` for the same commit, run on a disposable clone under `$TMPDIR` |
| T-A5 | `build-from-archive.test.mjs` | the build from the archive inside a network namespace exits 0; the probe failure is asserted; there is no `.git`; install, build, assembly and asset scan all succeed. If no store is present the test reports BLOCKED (exit 3), never pass |
| T-A6 | `service-list.test.mjs` | the real list equals the Compose services. Against Compose fixtures: an added service with no role, a changed image and a changed profile each fail `--check`. Every optional external row has a `restricted-network.md` row |
| T-A7 | `licenses/tests/runtime-licences.test.mjs` | a shipped fixture package without a licence fails `--check`; every runtime and bundled row of the real inventory has a licence |
| T-A8 | `licenses/tests/direct-dependencies.test.mjs` | a range spec, a version not in the lockfile, and a `NOASSERTION` direct dependency each fail; the real repository passes |
| T-A9 | `licenses/tests/procurement.test.mjs` | the SPDX classification table (single ids, `OR`, `AND`, `UNLICENSED`, `SEE LICENSE IN`, `LicenseRef-`, `NOASSERTION`, copyleft, OFL-1.1, the PostgreSQL image entry); no row of the real inventory has an empty `procurement` |
| T-A10 | `scan-assets.test.mjs` | the self-test of ADR-0062 §8: one planted hit per rule and target; clean twins; masking; stale entry; the loader refuses an R1/R3/R5 allow-list entry for T1/T2; R1 is a superset of `check-no-cdn.mjs` `BANNED` |
| T-A11 | `scan-assets.test.mjs` | the real built SPA, runtime tree and configuration scan exits 0. It needs a built tree, otherwise BLOCKED |

**Checks DO-A runs and reports** (command, environment, exit status, output tail):

- `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs`;
- `node licenses/generate-sbom.mjs --check`;
- `node tools/release/service-list.mjs --check`;
- `node deploy/scripts/check-ci-needs.mjs`;
- a `--rehearsal` archive build and `--verify` on it;
- `tools/release/build-from-archive.sh` on that archive with the sandbox store;
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`;
- `pnpm lint`.

Live CI is not run (D-058), and the handback says so.

### A.5 Integration order

1. ARCH-01 is merged (this revision).
2. DO-A (W2) and DO-B (W2) run in parallel. They share no writable file (§A.1, §G.1). DO-A owns the CI files in W2. DO-B hands over a job fragment (§G.1).
3. After ARCH-02: the `demo-data` field-name repair, if ADR-0064 differs (A.2).
4. DO-F, then DO-D: their `SERVICE_ROLES` lines and the regenerated `deploy/service-list.json` (A.2).
5. DO-D: the real archive build in the transfer drill. DO-E: the offline e2e.
6. The freeze verification: `scan-assets` on the merged tree. Then the seal (DO-J's tooling, run by the orchestrator after DG7 approval).

### A.6 Requirement → clause → test → owner

| Requirement | Clause (acceptance text) | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S19-001 | "the archive checksum matches the recorded value" | T-A2 (wrong `--expect-sha256` fails, right passes), and the A28 re-check at sealing (ADR-0073) | DO-A; DO-J/orchestrator (seal) |
| REQ-S19-001 | "the archive contains separate app, infra, docs and demo-data directories" | T-A2 (missing role directory or extra top-level directory fails), T-A3 | DO-A |
| REQ-S19-001 | "The release job produces a checksummed archive from the approved commit" (procedure) | T-A1, T-A4 | DO-A |
| REQ-S19-002 | "a clean build from the archive succeeds without network access to builder-hosted services" | T-A5; DO-D's drill re-runs it on the real archive; QA-C re-runs it independently | DO-A; DO-D; QA-C |
| REQ-S19-003 | "the SBOM lists every runtime dependency with licence" | T-A7 | DO-A |
| REQ-S19-003 | "the service list matches the Compose file" | T-A6 | DO-A (later Compose changes: DO-F, DO-D add their line) |
| REQ-S16-009 | "every direct dependency is pinned in a lockfile and listed in the licence inventory with its licence" | T-A8 | DO-A |
| REQ-S16-009 | "any licence requiring procurement is flagged" | T-A9 | DO-A |
| REQ-S19-019 | "a scan of built assets and configuration finds no public CDN, builder host or personal key" | T-A10 (the scan works), T-A11 (the real tree is clean) | DO-A |
| REQ-S19-019 | "and the offline e2e run passes" | DO-E's offline drill (ADR-0069) | DO-E |

### A.7 What the implementers must know

- **The candidate is defined by content.** `source/` must hash to the candidate id, so the archive never adds, drops or rewrites a candidate file (ADR-0062 §4.2). A file you want in `infra/` or `docs/` must already be in the candidate.
- **No wall clock in any output byte.** `build-report.json` may carry timings, but `ARCHIVE-MANIFEST.json`, `SHA256SUMS` and the tar may not.
- **Leave `dist/` alone.** It is already git-ignored (`.gitignore`), so `dist/release/` needs no new line. Do not add one.
- **Do not edit `scripts/check-no-cdn.mjs`.** It is DG1-approved and used by `pnpm check:no-cdn`. R1 is a superset, enforced by test.
- **The procurement flag is a classification, not advice.** Every text about it says it is not legal advice and not a procurement decision.
- **A missing capability is BLOCKED, never a pass.** No store, no built tree, or no namespace makes the run BLOCKED with its reason.

## §G. Slice G: security controls evidence and secret hygiene (T-DG7-ARCH-01; ADR-0063)

### G.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0063-p7-secret-hygiene-claims-scan-security-controls-evidence.md`.
- `tools/release/lib/patterns.mjs` and its test (§A.0), shared and frozen.
- None of these: a migration, a lock, an operation, a permission, an i18n key.

### G.1 DO-B: secret scan, claims scan, controls matrix (devops-engineer; W2; after ARCH-01 is merged; in parallel with DO-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `tools/release/secret-scan.mjs` | ADR-0063 §1: the scopes `payload`, `history`, `--path`, `envelope --list`; rules S1–S6; masking; exit codes. **Module API** (DO-J calls it at sealing): `scanSecrets({ scope, repo, paths, list }) → Promise<{ ok, hits, allowed, canaries, files }>` |
| `tools/release/claims-scan.mjs` | ADR-0063 §3: groups D and U; rules K1–K4; `--show-negated`. **Module API:** `scanClaims({ repo, roots }) → Promise<{ ok, hits, negated, allowed, files }>` (`roots` lets DO-J scan an unpacked archive's `docs/`) |
| `tools/release/lib/claims-rules.mjs` | `CONFORMITY_WORDS`, `CONFORMITY_WORDS_AR`, `ASSERTION_WORDS`, `FRAMEWORKS`, `CERTIFIED_ADJECTIVES`, `PRODUCT_NOUNS`, `NEGATIONS`, the sentence splitter and the string-literal tokenizer |
| `tools/release/secret-allowlist.json`, `tools/release/claims-allowlist.json` | the allow-lists (ADR-0063 §1.3, §3.3), each entry with a reason |
| `tools/release/tests/{secret-scan,claims-scan,security-controls}.test.mjs` | T-G1…T-G8 |
| `tools/release/tests/fixtures/{secrets,claims}/**` | synthetic fixtures. Key-shaped values are assembled at run time (§2 rule 6) |
| `docs/handover/security-controls.md` | ADR-0063 §4: the header (§4.1, verbatim), Section 1 (SC-01…SC-17 at least, every path verified), Section 2 (HR-01…HR-07) |
| `packages/db/test/integration/db-tls.test.ts` | T-G9: HR-02 against a TLS-enabled scratch PostgreSQL cluster (self-signed CA under `$TMPDIR`, port from `tests/qa/support/pg-port.sh`'s pool), or BLOCKED with the reason |
| `tools/release/ci/secret-scan.job.yml` | the CI job fragment (ADR-0063 §1.5). The orchestrator merges it into both CI files after DO-A's W2 change and runs `check-ci-needs.mjs` (§2 rule 9) |

**Modifies:** nothing outside the files above. In particular, DO-B does not edit:

- `deploy/ci/ci.yml` or `.github/workflows/ci.yml` (DO-A's in W2);
- `tools/release/lib/patterns.mjs` (frozen);
- `packages/shared/src/text-scan/**` (DG5; imported read-only);
- `deploy/scripts/log-scan.mjs` (ADR-0053; unchanged).

**Reads only:**

- `tools/gates/lib/candidate.mjs`;
- `packages/shared/src/text-scan/{claims,corpus}.ts` (imported through Node 24 type stripping);
- `docs/source/master-prompt.anchored.md` (to check M-anchors in T-G7);
- `docs/delivery/requirements.csv` (register ids in T-G7);
- every test file the matrix links.

**Provides:**

- `scanSecrets` and `scanClaims`, for DO-J (seal; the archive and the envelope) and for slice I's release notes (REQ-S21-003 "the handover text");
- the matrix's Section 2, which DOC-B's deployment guide links to (ADR-0063 §4.4);
- the job fragment, for the orchestrator.

### G.2 Seams with other slices

| Seam | Rule |
| --- | --- |
| **Key shapes → A** | `tools/release/lib/patterns.mjs` is shared and frozen (§A.0). |
| **`demo-data/` input → A, C** | The seal and DO-D run `secret-scan.mjs --path <demo-data dir>`. Credential material is excluded by ADR-0064 (D-243 Q16). The scan is the independent check. |
| **Handover text → H, I** | `docs/handover/**` is in the payload scope. Generated text that is not yet committed (release notes before commit, the final report at sealing) is scanned with `--path` by DO-J. That is REQ-S21-003's "secret scan of the repository and the handover text". |
| **Deployment guide → H (DOC-B, ADR-0072)** | The TLS and encryption subsection links to `docs/handover/security-controls.md` §2, and DOC-B's guide check asserts the link. REQ-S16-031's procedure clause is met there. |
| **Envelope → M (DO-J, ADR-0073)** | `--scope envelope --list <manifest>` is the only scope that reads `docs/delivery/**` records. The DG6 review and evidence files that quote redaction fixtures need history and envelope allow-list entries by value hash. |
| **Approval claims in delivery records → J (DO-I)** | Out of the claims scan's scope. DO-I's protocol audit covers REQ-DLV-027. |
| **XSS carry-forward (REQ-S16-030)** | SC-07 is marked `integration-level only` with the reason (p7-plan §1.4). |

### G.3 Exact texts

User-facing product text: **none** (no screen, route, problem code or i18n key).

- **Matrix header:** ADR-0063 §4.1, verbatim, including the provisional Arabic summary.
- **Matrix columns:** ADR-0063 §4.2 and §4.3, verbatim and in order.
- **Messages** (exact):

  | Tool | Message | Exit |
  | --- | --- | --- |
  | secret-scan | `<rule> <path>:<line>: <masked context> (value sha256 <12 hex>)`, then `secret-scan: PASS (<scope>; <files> files; allowed <n>; canary (documented) <n>)` or `secret-scan: FAIL (<hits> hits)` | 0 / 1 |
  | secret-scan | `secret-scan: stale allow-list entry <n> (<path>)` | 1 |
  | secret-scan | `secret-scan: an allow-list entry cannot cover <path>` | 2 |
  | secret-scan | `secret-scan: BLOCKED: <reason>` | 2 |
  | claims-scan | `<rule> <path>:<line>: <sentence, at most 160 chars>`, then `claims-scan: PASS (<files> files; D <n>, U <n>; negated <n>; allowed <n>)` or `claims-scan: FAIL (<hits> hits)` | 0 / 1 |
  | claims-scan | `claims-scan: an allow-list entry cannot cover <path>` | 2 |
  | claims-scan | `claims-scan: BLOCKED: cannot import packages/shared/src/text-scan/claims.ts (<error>)` | 2 |

### G.4 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-G1 | `tools/release/tests/secret-scan.test.mjs` | the S1–S6 self-test (one planted hit each); the non-matches of ADR-0063 §1.2; stale entry; protected-path refusal; masking |
| T-G2 | `secret-scan.test.mjs` | `--scope payload` and `--scope history` over the real repository exit 0. History needs a git repository (BLOCKED otherwise) |
| T-G3 | `secret-scan.test.mjs` | S5: the real `.env.example` passes; `NODE_ENV=production`, `X=""` and a lower-case name each fail |
| T-G4 | `tools/release/tests/claims-scan.test.mjs` | the K1–K4 self-test in en and ar; the negated twins and the non-claims of ADR-0063 Context 4 pass; the M0332 sentence passes; the refusals for `docs/handover/**` and group U; stale entry |
| T-G5 | `claims-scan.test.mjs` | K1 agrees with `claimsOfficialPmi` on every `CLAIM_CORPUS` sample |
| T-G6 | `claims-scan.test.mjs` | the real docs and UI strings exit 0, including ADR-0062, ADR-0063 and this file |
| T-G7 | `tools/release/tests/security-controls.test.mjs` | the matrix: SC-01…SC-17 present; every Section 1 row links at least one existing test file; Source ids exist; Evidence paths exist; every Section 2 row has a resolving guide link; the header equals ADR-0063 §4.1 |
| T-G8 | `security-controls.test.mjs` | both scans pass over `docs/handover/security-controls.md` |
| T-G9 | `packages/db/test/integration/db-tls.test.ts` | HR-02: a connection with `sslmode=verify-full` and the generated CA succeeds, one without the CA fails. Otherwise BLOCKED with the reason, and the matrix cell says so |

**Checks DO-B runs and reports:**

- `node --test tools/release/tests/*.test.mjs`;
- `node tools/release/secret-scan.mjs` (payload);
- `node tools/release/secret-scan.mjs --scope history`;
- `node tools/release/claims-scan.mjs`;
- `pnpm vitest run --project integration packages/db/test/integration/db-tls.test.ts`;
- the job fragment checked by running `node deploy/scripts/check-ci-needs.mjs` on a scratch copy of `ci.yml` with the fragment inserted;
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`;
- `pnpm lint`.

### G.5 Integration order

1. ARCH-01 is merged.
2. DO-B (W2) runs in parallel with DO-A.
3. The orchestrator merges DO-B's job fragment after DO-A's CI change.
4. DOC-B (W9) links the deployment guide to matrix §2.
5. DO-J (W8) calls `scanSecrets`/`scanClaims` from the seal.
6. Freeze verification: both scans on the merged tree.

### G.6 Requirement → clause → test → owner

| Requirement | Clause (acceptance text) | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S16-031 | "the secret scan finds no secrets in the repository" | T-G1 (the scan works), T-G2 (payload and history are clean) | DO-B |
| REQ-S16-031 | "the environment template contains placeholders only" | T-G3 | DO-B |
| REQ-S16-031 | "a CI secret scan blocks committed secrets" (procedure) | the job fragment merged and `check-ci-needs.mjs` passing (static; live CI not run, D-058) | DO-B; orchestrator (merge) |
| REQ-S16-031 | "the deployment guide documents TLS and encryption integration" (procedure) | matrix §2 (T-G7) and DOC-B's guide link check (ADR-0072) | DO-B; DOC-B |
| REQ-S16-033 | "a text scan of docs and UI strings finds no compliance or certification claim" | T-G4, T-G5 (the scan works), T-G6 (the real text is clean); the A28 re-run on the archive's `docs/` at sealing | DO-B; DO-J/orchestrator |
| REQ-S16-033 | "the matrix links each control to a test" | T-G7, T-G8 | DO-B |

### G.7 What the implementers must know

- **Rephrase, never allow-list,** in `docs/handover/**` and UI strings. The loaders refuse such entries.
- **Do not copy the PMI rule.** Import it. T-G5 proves the agreement with the DG5 rule.
- **The matrix is evidence for IT's own assessment,** not a statement of conformity. Its header says so, and T-G7 pins the header.
- **A Section 1 row needs a test that exists and runs.** If a control has no test, report it in the handback as a gap. Do not move it to Section 2 to avoid the rule. Section 2 is only for functions the product does not perform.
- **Database TLS has no product code** (ADR-0063 Context 6). T-G9 tests the integration point, or the matrix says `none (BLOCKED: <reason>)`. Never claim more.
- **History hits** in approved DG0–DG6 records are never fixed by rewriting history or records (D-243 Q13). They are allow-listed by value hash with a reason, or reported to the orchestrator if a real secret is found.
