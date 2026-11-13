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

## §C. Slice C: data migration manifest and tools (T-DG7-ARCH-02; ADR-0064)

### C.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md`.
- **Migration `0133_p7_transfer_migration_manifest.sql`:** `transfer_table_rule` (14 rows), `transfer_column_rule` (15 rows), `migration_export`, `migration_import`, `migration_reconciliation`, `migration_reconciliation_table`, `migration_reconciliation_attachment`, `identity_binding_hold`, `identity_rebind_event`, with their guards and grants.
- **Migration `0135_p7_transfer_permissions.sql`:** `migration.export`, `migration_import.read`, `config_bundle.export`, `config_bundle.import` and their role defaults. `packages/shared/src/permissions.ts` `P7_TRANSFER_PERMISSIONS`, `P7_TRANSFER_ROLE_PERMISSIONS`, `P7_PERMISSIONS`.
- **Kysely types** (`packages/db/src/schema.ts`) and the `SCHEMA_COLUMNS` entries of the 13 tables of 0133–0134. **Catalogue pins** (`packages/db/test/integration/catalogue.test.ts`): the 0133–0134 trigger test, the SecretRef/exclusion test, the mutable-table pin, the `mth_app` privilege pins. **Seed parity** (`packages/db/src/seed.test.ts`): the 0135 block and the P7 migration ceiling 0163.
- **Guard probe:** `packages/db/test/integration/p7-transfer-guards.test.ts` (state machines, write rules, audit rule; real PostgreSQL).
- **Advisory locks** 730402–730405 in `apps/api/src/modules/platform/advisory-locks.ts` (+ test) and ADR-0016 §6; 730406–730409 reserved.
- **Contract:** 10 slice C operations (tag `transfer`, `info.version` 1.6.0-p7), `apps/api/test/support/p7-operations.ts`, `p7-pending.ts`, `p7-pending-arch-02.ts`, `p7-pending-be-c.ts`, `p7-pending-be-d.ts`; `p2-pending.ts` and both AUD sweeps include the P7 sets; the contract count pin is 951.
- **Inventory:** `migration_import.source_export_reference` classified in `apps/api/test/support/sensitive-reference-inventory.ts`.
- **ERD, data dictionary and permissions matrix** sections for 0133–0135.
- **Free ids:** migrations `0136`–`0142` are for the slice C and D implementers, in the order of C.9. `0131`–`0132` stay unused (T-DG7-ARCH-01 needed none, and the runner refuses an id below the highest applied one).

### C.1 BE-C: export (backend-workflow; W5; after BE-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `packages/db/src/transfer/plan.ts` | ADR-0064 §2.2: the catalogue-driven plan (tables minus `transfer_table_rule`, FK graph, SCCs, `deferredColumns`, `loadPhase`, self-reference order). `buildPlan(db) → Promise<TransferPlan>`; throws `TransferPlanError` with the C.5 text on a cycle without a nullable edge |
| `packages/db/src/transfer/export.ts` | ADR-0064 §2.3, §4: the encoder (pinned settings, text output, JSON for json/jsonb, SecretRef rewrite from `transfer_column_rule`), one `REPEATABLE READ READ ONLY` snapshot, `contentDigest`. `exportPackage(db, sink, opts) → Promise<ExportResult>`; `sink` writes files (a directory writer here, an EvidenceStore writer in the job) |
| `packages/db/src/transfer/manifest.ts` | ADR-0064 §2.1: the canonical manifest writer and reader, `MANIFEST_SCHEMA_VERSION = "mth-migration/1"`, `sourceEnvironment` from `readDeploymentEnvironment`, `demoChecksum` from `packages/db/src/demo/checksum.ts` for a demo source only |
| `packages/db/src/transfer/index.ts` | the package's exports |
| `packages/db/src/transfer/{plan,export,manifest}.test.ts` | unit tests T-C1…T-C3 |
| `packages/db/test/integration/transfer-export.test.ts` | T-C4, T-C5 |
| `apps/api/src/modules/transfer/export/routes.ts` (+ `service.ts`) | the 5 export operations (C.5 texts), lock 730402, audit per transition |
| `apps/worker/src/handlers/transfer/export.ts` | the job `transfer.export` (exactly once under 730402; writes through an EvidenceStore sink under `transfer/migration-exports/<exportId>/`; byte reads through the port, ADR-0064 §5) |
| `packages/db/migrations/0136_p7_transfer_export_job.sql` | the `job:transfer.export` service identity (no permission code, ADR-0064 §7) and its `job_schedule` row only if the kit needs one (none expected: the job is enqueued, not scheduled) |
| `tools/migration/export.mjs` | thin wrapper over `mth-db export-migration` (exit codes of §2 rule 4) |
| `apps/api/test/integration/transfer/export.test.ts`, `apps/api/test/integration/contract/p7-exercises-be-c.ts` | T-C6, T-C7; contract exercises |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `packages/db/src/cli.ts` | one command line: `export-migration --out <dir> --operator <name>` (BE-C first, then BE-D, then DO-G; p7-plan §5.3) |
| `apps/api/test/support/p7-pending-be-c.ts` | removes each entry as it is routed and exercised; empty at the end |
| `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts` | only the lines for `0136` (the numbering example moves to `0137`) |

**Reads only:** `transfer_table_rule`, `transfer_column_rule`, `packages/db/src/demo/{guard,checksum}.ts`, `apps/api/src/modules/evidence/store.ts` (the port).

### C.2 BE-D: import, reconcile, rebind and the read-only routes (backend-workflow; W6; after BE-C)

**Creates:**

| File | Purpose |
| --- | --- |
| `packages/db/src/transfer/import.ts` | ADR-0064 §6 steps 1, 2, 4–7, 9 (owner role; session lock 730403 as `MIGRATION_IMPORT_LOCK_CLASS`); `audit_event` never truncated and its triggers never disabled |
| `packages/db/src/transfer/reconcile.ts` | ADR-0064 §6 step 8 and `reconcile-migration` |
| `packages/db/src/transfer/rebind.ts` | ADR-0064 §8 (mapping file, all-or-nothing, lock 730404 as `IDENTITY_REBIND_LOCK_CLASS`) |
| `packages/db/src/transfer/{import,reconcile,rebind}.test.ts` | unit tests |
| `packages/db/test/integration/transfer-roundtrip.test.ts` | T-C8…T-C12 |
| `packages/db/test/integration/transfer-locks.test.ts` | T-C13 (the two CLI lock constants equal `ADVISORY_LOCK_CLASSES.migrationImport`/`identityRebind`, read as text from `apps/api/src/modules/platform/advisory-locks.ts`) |
| `apps/api/src/modules/transfer/import/routes.ts` (+ `service.ts`) | the 5 read-only operations (`migration_import.read`) |
| `tools/migration/import.mjs`, `tools/migration/reconcile.mjs` | ADR-0064 §6 order: package checks → `transfer-attachments copy-in` (BE-E) → `mth-db import-migration` → print report |
| `apps/api/test/integration/transfer/import-routes.test.ts`, `apps/api/test/integration/identity/unbound-signin.test.ts`, `apps/api/test/integration/contract/p7-exercises-be-d.ts` | T-C14, T-C15; contract exercises |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `packages/db/src/cli.ts` | three command lines: `import-migration`, `reconcile-migration`, `rebind-identity` |
| `apps/api/src/modules/identity/oidc.ts` | the `identity_unbound` result beside `account_disabled` (ADR-0064 §8): one query on `identity_binding_hold` |
| `apps/api/src/modules/identity/routes.ts` | only if the callback's error mapping needs the new code listed (the redirect itself is the existing `fail(code)`) |
| `apps/web/src/i18n/{en,ar}/auth.json` | the one key `errors.identity_unbound` (C.5), append-only (FE-A owns the file; this key is requested in the handback if FE-A has merged first) |
| `apps/api/test/support/p7-pending-be-d.ts` | removes each entry as it is routed and exercised |

### C.3 BE-E: evidence bytes (backend-workflow; W7; after BE-C)

**Creates:** `apps/api/src/modules/transfer/attachments.ts` (`readForExport(store, entry)`, `copyIn(store, dir, manifest)`, `verify(store, manifest) → mismatch[]`), `apps/api/src/cli/transfer-attachments.ts` (`copy-in --from <dir>`, `verify --from <dir> --out <json>`; exit codes of §2 rule 4), `apps/api/test/integration/transfer/attachments.test.ts` (T-C16 against the filesystem adapter and `apps/api/test/support/fake-s3.ts`, through the P6 store contract kit `apps/api/src/modules/evidence/stores/contract.ts`).

**Deviation from p7-plan §5.1, recorded:** the plan put this file at `packages/db/src/transfer/attachments.ts`. The `EvidenceStore` port and both adapters are in `apps/api`, and `packages/db` must not import `apps/api` (ADR-0002), so the byte copy is in `apps/api` (ADR-0064 §5).

### C.4 KBE-A: financial parity of the round-trip (kpi-benefits; W8; after BE-D)

**Creates:** `tests/integration/transfer/financial-parity.test.ts` (T-C17). It reuses BE-D's round-trip helper (exported from `packages/db/test/integration/transfer-roundtrip.test.ts`'s sibling `transfer-roundtrip.fixture.ts`, which BE-D creates).

### C.5 Exact texts

**Problem codes** (`apps/web/src/i18n/{en,ar}/problems.json`, keys with `.` written `__`; FE-A adds them; the Arabic is **provisional** until a qualified reviewer checks it, D-243 Q7):

| Code | Status | English | Arabic (provisional) |
| --- | --- | --- | --- |
| `migration.export_in_progress` | 422 | A migration export is already queued or running. Wait for it to finish. | يوجد تصدير ترحيل قيد الانتظار أو التنفيذ. انتظر حتى يكتمل. |
| `migration.export_not_ready` | 409 | This export has not finished yet. | لم يكتمل هذا التصدير بعد. |
| `migration.export_failed` | 422 | This export failed. Its manifests are not available. | فشل هذا التصدير، وبياناته الوصفية غير متاحة. |

**Sign-in refusal** (`apps/web/src/i18n/{en,ar}/auth.json` `errors.identity_unbound`):

- EN: "Your account was moved from another installation and is not linked to your corporate sign-in yet. Contact your IT administrator."
- AR (provisional): "نُقل حسابك من منصة أخرى ولم يُربط بعد بتسجيل الدخول المؤسسي. تواصل مع مسؤول تقنية المعلومات."

**CLI lines** (operator-facing, English; the operator guide gives the Arabic summary, D-243 Q7). `<…>` is filled at run time:

| Command | Exit | Line |
| --- | --- | --- |
| `import-migration` | 2 | `import-migration: refused: unsupported manifest schema version '<v>'` |
| `import-migration` | 2 | `import-migration: refused: checksum mismatch for <file>` |
| `import-migration` | 2 | `import-migration: refused: the target is at <level>, the package at <level>` |
| `import-migration` | 2 | `import-migration: refused: the target runs <appVersion>, the package was written by <appVersion>` |
| `import-migration` | 3 | `import-migration: refused: the target database is not empty` |
| `import-migration` | 4 | `import-migration: reconciliation mismatch: <n> tables, <m> attachments differ; nothing was imported` |
| `import-migration` | 0 | `import-migration: imported <rows> rows in <tables> tables and <count> attachments; reconciliation matched; <users> users wait for an identity rebind` |
| `reconcile-migration` | 0 / 4 | `reconcile-migration: matched` / `reconcile-migration: mismatch: <n> tables, <m> attachments differ` |
| `rebind-identity` | 2 | `rebind-identity: refused: <n> invalid lines; nothing was changed` (then one line per problem: `line <k>: <reason>`) |
| `rebind-identity` | 0 | `rebind-identity: rebound <r>, retained <t>; <u> users remain unbound` |
| `export-migration` | 1 | `export-migration: failed: <reason>` |
| plan | 1 | `migration plan: foreign-key cycle without a nullable edge: <tables>` |

The `line <k>` reasons: `unknown user <id>`, `user <id> has no unbound hold`, `user <id> appears twice`, `<issuer> <subject> is already bound to another user`, `retain needs the carried issuer and subject`, `action must be rebind or retain`.

**Audit actions:** `migration_export.requested`, `.started`, `.succeeded`, `.failed`; `migration.imported`; `migration.reconciled`; `identity.binding_held`, `identity.rebound`, `identity.retained`; `session.login_failed` with `changes.error = "identity_unbound"`.

### C.6 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-C1 | `plan.test.ts` + `transfer-export.test.ts` | every public base table is exported or in `transfer_table_rule`; the real schema has no cycle without a nullable edge; every FK's referenced table loads first or the column is deferred; a synthetic depth-3 self-reference loads in order |
| T-C2 | `export.test.ts` | the encoder round-trips `numeric` (money with 4 decimals, rates), `bigint`, `timestamptz` with microseconds, arrays, `bytea`, `jsonb`, `NULL` through `jsonb_populate_recordset` unchanged; no value is a JSON number |
| T-C3 | `manifest.test.ts` | canonical bytes are stable; `schemaVersion` is `mth-migration/1`; `sourceEnvironment` is `demo`/`production`/`unmarked` from the marker; `demoChecksum` is set exactly for a demo source and equals `datasetChecksum()` (`packages/db/src/demo/checksum.ts`) |
| T-C4 | `transfer-export.test.ts` | `fileSha256 = contentDigest` for every table; two exports of the demo give equal `demoChecksum` and equal `contentDigest` for every table whose rows have no `now()` column |
| T-C5 | `transfer-export.test.ts` | every SecretRef in the package has provider `unbound`; no file is named after an excluded table |
| T-C6 | `transfer/export.test.ts` | the 5 routes: 403 for every role except ADM_TECH (AUD included); 422 `migration.export_in_progress`; one audit event per transition; the job runs once under 730402; no response contains a row value |
| T-C7 | `p7-exercises-be-c.ts` | each of the 5 operations is exercised and its responses validate against the contract |
| T-C8 | `transfer-roundtrip.test.ts` | demo + P6 fixtures (sensitive benefit, grant, connector with SecretRefs, import batch, assistant setting) → export → import into an empty database: every table's ids and rows equal (reconciliation `matched`), `audit_event` rows equal including `seq`, the target's `demoChecksum` equals the manifest's, the P6 integrity sweep passes |
| T-C9 | `transfer-roundtrip.test.ts` | the package scan of ADR-0064 §3 finds no session or state hash, no provider other than `unbound`, no canary secret value, and no column named like a password exists in the schema |
| T-C10 | `transfer-roundtrip.test.ts` | each refusal (schema version, level, app version, non-empty target, file checksum) exits with its code and line and leaves the target unchanged |
| T-C11 | `transfer-roundtrip.test.ts` | a tampered table file and a tampered attachment make the reconciliation mismatch; the transaction rolls back; exit 4; the database stays empty |
| T-C12 | `transfer-roundtrip.test.ts` | `audit_event`'s two triggers are enabled at every step (checked between steps), the import issues no `TRUNCATE` (seeded rows are deleted in reverse load order), and the only new audit rows after the load are the import's own |
| T-C13 | `transfer-locks.test.ts` | the CLI lock constants equal the registry's 730403 and 730404; a second import waits on the lock |
| T-C14 | `transfer/import-routes.test.ts` | the 5 read-only routes for ADM_TECH, ADM_ACCESS and AUD; 403 for every other role; the reconciliation report shows per-table counts and digests and attachment mismatches |
| T-C15 | `identity/unbound-signin.test.ts` | an unbound user (OIDC through the fake IdP, and the dev login) gets `/login?error=identity_unbound`, no session, and a `session.login_failed` event; after `rebind-identity` the user signs in with the new subject, and the old subject no longer resolves; an invalid mapping line changes nothing |
| T-C16 | `transfer/attachments.test.ts` | copy-in and verify with both adapters; the target object under the same name has equal size and SHA-256; a missing object and a changed byte are reported, never skipped |
| T-C17 | `tests/integration/transfer/financial-parity.test.ts` | benefit totals, allocations, formula versions, KPI calculation runs and Finance validations recompute identically after the round-trip (decimal strings exact); Unknown and Stale stay Unknown and Stale, never 0 |

### C.7 Seams with other slices

| Seam | Rule |
| --- | --- |
| **`demo-data/` → A (DO-A)** | Settled by ADR-0064 §2.1: the marker field is `sourceEnvironment` and must be `demo`; the checksum field is `demoChecksum`. These are the names DO-A's fixture already uses, so **no repair is needed** (A.2). |
| **Transfer drill → B (DO-D)** | DO-D runs `mth-db export-migration` on the seeded demo, `tools/migration/import.mjs` into the clean environment with a different base URL, then `rebind-identity` with a mapping for the drill's Keycloak users, and records the reconciliation report (REQ-S19-014's evidence). |
| **Backups → E (ARCH-03)** | ADR-0066 may reuse `attachments.json` (ADR-0064 §5) to check evidence bytes. It does not reuse the migration package as the backup format (ADR-0064 Alternatives 1). |
| **Retention → E** | A purge of a business record is out of P7 scope (D-243 Q3); `transfer_table_rule` gets no row from retention. |
| **Module registry → BE-A** | BE-A registers the module `transfer` with the stubs `transfer/export/routes.ts`, `transfer/import/routes.ts`, `transfer/config-bundle/routes.ts` and the worker stub `apps/worker/src/handlers/transfer/index.ts`. `transfer` imports no domain module except `evidence` (the port) (p7-plan §2). |
| **Guides → H (DOC-B, DOC-A)** | DOC-B's deployment and operator guides describe export, copy, import, reconcile and rebind, including "map at least one administrator before first sign-in" and "stop the source's worker and wait for an empty queue before exporting". DOC-A's admin guide covers the Data export screen (FE-B). |
| **Screens → FE-B** | Administration > Data export (exports list, request with reason, status, the two manifest downloads), Migration status (imports, reconciliation reports, identity rebind list, read-only). Texts in C.8. |

### C.8 Screen texts (FE-B; EN and AR, the Arabic provisional)

| Key (`apps/web/src/i18n/{en,ar}/transfer.json`) | English | Arabic (provisional) |
| --- | --- | --- |
| `export.title` | Data export | تصدير البيانات |
| `export.intro` | A migration export copies this whole installation, with its ids, links, audit history and evidence, into a package in IT-controlled storage. It never contains sessions, tokens or secret values. | ينسخ تصدير الترحيل هذه المنصة بالكامل، بمعرّفاتها وروابطها وسجل التدقيق والأدلة، إلى حزمة في تخزين تتحكم فيه إدارة تقنية المعلومات. ولا يتضمن أبدًا جلسات أو رموزًا أو قيمًا سرية. |
| `export.request` | Request export | طلب تصدير |
| `export.reason` | Reason | السبب |
| `export.status.queued` / `running` / `succeeded` / `failed` | Queued / Running / Succeeded / Failed | في الانتظار / قيد التنفيذ / نجح / فشل |
| `export.environment.demo` | Synthetic demo data | بيانات عرض تجريبية اصطناعية |
| `export.downloadManifest` / `downloadAttachments` | Download manifest / Download attachment manifest | تنزيل البيانات الوصفية / تنزيل بيان المرفقات |
| `import.title` | Migration status | حالة الترحيل |
| `import.cliOnly` | Imports and identity rebinds are run by IT with the migration tools. This page is read-only. | تنفّذ إدارة تقنية المعلومات عمليات الاستيراد وإعادة ربط الهويات باستخدام أدوات الترحيل. هذه الصفحة للقراءة فقط. |
| `import.result.matched` / `mismatched` | Counts and checksums match / Differences found | الأعداد ومجاميع التحقق متطابقة / وُجدت اختلافات |
| `rebind.title` | Identity rebind | إعادة ربط الهويات |
| `rebind.state.unbound` / `rebound` / `retained` | Not linked: cannot sign in / Linked to a new identity / Same identity confirmed | غير مربوط: لا يمكنه تسجيل الدخول / مربوط بهوية جديدة / تأكيد الهوية نفسها |

### C.9 Integration order

1. ARCH-02 merged (this revision).
2. BE-A (W4): the `transfer` module, route stubs and worker stub.
3. BE-C (W5): `0136`, export, routes, job.
4. BE-D (W6): import, reconcile, rebind, sign-in check, read-only routes (`cli.ts` after BE-C).
5. BE-E (W7): attachments; then BE-D's round-trip test runs with real bytes (BE-D lands the test with the byte step stubbed by the filesystem adapter in W6, and BE-E switches it to the real step).
6. KBE-A (W8), FE-B (W9), DO-D (W10).

### C.10 Requirement → clause → test → owner

| Requirement | Clause (acceptance text) | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S19-014 | "migrating the demo dataset into a clean installation" | T-C8 (demo → empty database); DO-D's A18 drill (clean installation, different base URL) | BE-D; DO-D |
| REQ-S19-014 | "reports equal record counts" | T-C8, T-C11 (a difference is reported, never hidden), T-C14 (the report is readable) | BE-D |
| REQ-S19-014 | "and matching attachment checksums" | T-C16, T-C11 | BE-E; BE-D |
| REQ-S19-014 | M0362 "mapping, validation, reconciliation, attachment manifests and checksum/record-count checks" | T-C10 (validation), T-C8/T-C11 (reconciliation), T-C15 (mapping file), T-C4 (checksums) | BE-C; BE-D |
| REQ-S19-016 | "an export and import round-trip preserves IDs" | T-C8 | BE-D |
| REQ-S19-016 | "links" | T-C8 (every FK value equal), T-C16 (attachment links under the same object name) | BE-D; BE-E |
| REQ-S19-016 | "audit history" | T-C8 (rows and `seq` equal), T-C12 | BE-D |
| REQ-S19-016 | "and evidence checksums" | T-C16, T-C8 | BE-E |
| REQ-S19-016 | "the package contains no password hashes" (and D-243 Q16: no credential material) | T-C9, T-C5 | BE-D; BE-C |
| REQ-S19-016 | M0364 "rebind corporate identity subjects under IT control" | T-C15 | BE-D |
| REQ-S19-016 | M0364 decimal and status integrity across the move | T-C2, T-C17 | BE-C; KBE-A |

### C.11 What the implementers must know

- **Never disable `audit_event`'s triggers, never truncate it.** T-C12 checks it between steps. If a load needs it, stop and report: it would be a DG1 reopen (seam 8).
- **The import is CLI-only.** No route, job or permission may start an import or a rebind.
- **Same release, same level, empty target.** Do not add a "merge" or "force" option.
- **Every value is text.** A JSON number in a table file is a defect (T-C2).
- **The attachment manifest lists object names, not bytes.** Never return evidence bytes or row data from an API operation of this slice.
- **`deployment_environment` travels.** A demo package imported anywhere stays labelled synthetic.

### C.12 BE-R1: the import load (backend-workflow; repair; after ARCH-R2)

**What this is.** The repair task for the import, under p7-plan §5.3 (D-258). It builds ADR-0064 **Amendment 1** (A1.1–A1.11): the target reservation, the empty-target rule E1–E4, the load L0–L12, the audit verification, the recheck in modes 1 and 2, and the attachment report. It also builds the loopback exception for `OIDC_ISSUER_URL` (D-258, item 2). Where §6 of ADR-0064 or the earlier rows of C.2, C.5, C.6 or C.10 differ from Amendment 1, the amendment wins.

**Hard rules.**
- Never disable, drop, alter or truncate anything of `audit_event`.
- Never UPDATE or DELETE an `audit_event` row.
- If the build seems to need any of these, stop and report: it would be a DG1 reopen.

**Creates:**

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0149_p7_transfer_import_load.sql` (the next free id above the highest shipped file, D-245 O9) | A1.6: the seven `migration_import` columns and `migration_import_audit_ranges`; `migration_reconciliation` `run_kind` `recheck_after_use` and the replaced result CHECK; `migration_reconciliation_delta` (append-only, `mth_app` SELECT); the one `transfer_table_rule` row. The header states that nothing here touches `audit_event`. |
| `packages/db/src/transfer/recheck.ts` | A1.9: `RECHECK_OPERATIONAL_TABLES`, `RECHECK_NEVER_OPERATIONAL`, `parseAllowance` (`mth-recheck-allowance/1`), the row-by-row package comparison (`compareRows(tx, table, packageFile) → {added, changed, missing}` by primary-key tuple), the `user_identity` rebind reversal, and the audit ranges check (A1.5) |
| `packages/db/src/transfer/attachment-report.ts` | A1.8: `parseAttachmentReport(bytes, expected) → AttachmentMismatch[]`, refusing with the A1.8 lines |
| `packages/db/src/transfer/{recheck,attachment-report}.test.ts` | unit parts of T-R7 and T-R8 |
| `tools/migration/prepare-target.mjs` | a thin wrapper over `mth-db migrate --reserve-audit-seq-for <dir>` (p7-work-split §2 rule 4 exit codes) |
| `packages/db/test/integration/transfer-load.test.ts` | T-R1, T-R2, T-R4, T-R5, T-R9 |
| `packages/db/test/integration/transfer-recheck.test.ts` | T-R6, T-R7, T-R8 (database part) |
| `packages/config/src/oidc-issuer.test.ts` (or new cases in the existing `load.test.ts`, whichever holds the `APP_BASE_URL` loopback cases) | T-R10 |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `packages/db/src/migrate.ts` | `MigrateOptions.reserveAuditSeqFrom?: bigint` and the A1.2 hook (refuse unless no migration is applied; inside the first transaction after which `audit_event_seq_seq` exists: assert `audit_event` empty, `setval(…, R, false)`; refuse if the hook never fired). No other behaviour changes. |
| `packages/db/src/cli.ts` | `migrate` accepts `--reserve-audit-seq-for DIR` (package checks through `import.ts`'s `checkPackage`, then `M` by streaming `tables/audit_event.ndjson`). `import-migration` accepts `--attachments-report FILE [--report FILE]`. `reconcile-migration` accepts `--attachments-report FILE` and `--after-use --from DIR --allow FILE [--report FILE]`. Usage and header lines are updated. |
| `packages/db/src/transfer/import.ts` | Removes `LOAD_BLOCKED_REASON` and the exit-1 stop. Replaces `EMPTY_TARGET_TABLES` and step 4 with E1–E4 inside the load transaction. Adds L0–L12 (A1.4) and an optional test hook `onStep(step, tx)` that is not reachable from the CLI. Header updated. |
| `packages/db/src/transfer/reconcile.ts` | `reconcileTables` compares `audit_event` over `seq <= M` (the encoder with a `WHERE` clause; `encodeTable` gains an optional `where` and nothing else). Adds the baseline check, the delta rows, modes 1 and 2, and the attachment report in place of `attachments_checked = 0`. `recordReconciliation` writes the deltas and the run kind. |
| `packages/db/src/transfer/export.ts` | only `encodeTable(db, table, rewritten, opts?: { where?: string })`. The export never passes `where`, so its bytes are unchanged (T-C4 still passes). |
| `packages/db/src/transfer/index.ts` | export lines |
| `packages/db/test/integration/transfer-roundtrip.fixture.ts`, `transfer-roundtrip.test.ts` | `RoundtripWorkspace` creates the target with the reservation. The Q1 pin becomes T-R3 (T-C8 in full). T-C11 and T-C12 run on the load (T-R5, T-R4). `seedSyntheticImport` fills the seven columns. |
| `tools/migration/import.mjs` | the order: package checks → `copy-in` → `verify --out <tmp>` → `mth-db import-migration --attachments-report <tmp>` → print the report. `--keep-reports <dir>` keeps the verify output. |
| `tools/migration/reconcile.mjs` | runs `verify` first when the import recorded attachments (needs `--from`), then `mth-db reconcile-migration` and passes the flags through |
| `packages/db/src/schema.ts`, `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts`, `packages/db/test/integration/p7-transfer-guards.test.ts` | only the 0149 lines: Kysely types, `SCHEMA_COLUMNS`, the trigger, privilege and mutable-table pins, and T-R9's probe cases |
| `docs/architecture/data-dictionary.md`, `docs/architecture/erd.md` | the 0149 columns and table (the dictionary coverage tool `tools/release/dictionary-coverage.mjs` must stay PASS; regenerate `docs/handover/data/coverage.json` with it) |
| `docs/handover/migration-catalogue.json`, the generated table of `docs/handover/upgrades.md` | regenerated by `node tools/release/migration-catalogue.mjs` (no override lowers 0149's class) |
| `docs/api/openapi.yaml` | additive only (A1.6): the seven nullable `MigrationImport` fields, `runKind` `recheck_after_use`, and `MigrationReconciliation.deltas[]`. `info.version` and the operation count are unchanged. |
| `apps/api/src/modules/transfer/import/service.ts`, `apps/api/test/integration/contract/p7-exercises-be-d.ts` | the presenters and zod mirrors of those fields; the exercise seeds one delta row (T-R12) |
| `packages/config/src/load.ts` | `OIDC_ISSUER_URL`: in production, plain http is accepted only for a loopback host (`isLoopbackHost`, the same helper as `APP_BASE_URL`). Export `secureIssuerAllowed(issuerUrl, nodeEnv)` next to `secureOriginAllowed`. The refusal text is the C.12 line. |
| `apps/api/src/modules/identity/oidc.ts` | `allowHttp = issuerUrl.protocol === "http:" && (nodeEnv !== "production" \|\| isLoopbackHost(issuerUrl))`, through `secureIssuerAllowed`. Nothing else. |
| `tests/integration/transfer/financial-parity.test.ts` (KBE-A's file) | only: replace the loaded-target `it.todo` with its test body, on a target loaded by `importInto` (T-R11). Nothing else in the file. |
| `vitest.config.ts` | only: add `"tests/integration/**/*.test.ts"` to the `integration` project's `include` (KBE-A Q2), so T-C17 runs in `pnpm test:integration` |

**Reads only:** BE-E's `apps/api/src/cli/transfer-attachments.ts` and `attachments.ts`. The report format is fixed by A1.8, so BE-R1 does not change them. A needed change goes in the handback.

**Exact texts.** These add to C.5; every existing C.5 line stays as it is.

| Command | Exit | Line |
| --- | --- | --- |
| `migrate` | 0 | `migrate: the audit sequence of this target starts at <R> (the package's highest audit seq is <M>)` |
| `migrate` | 2 | `migrate: refused: --reserve-audit-seq-for needs a database with no applied migration` |
| `migrate` | 2 | `migrate: refused: the package at <dir> failed its checks: <reason>` |
| `migrate` | 2 | `migrate: refused: the migrations never created audit_event_seq_seq; nothing was reserved` |
| `import-migration` | 3 | after the C.5 line: `import-migration: <table> holds <n> rows` (one per E1 table) / `import-migration: audit_event holds <n> rows not written by migrations` |
| `import-migration` | 2 | `import-migration: refused: the target's audit events start at seq <s>, at or below the package's highest audit seq <M>; recreate the target with mth-db migrate --reserve-audit-seq-for <dir>` |
| `import-migration` | 2 | `import-migration: refused: audit_event trigger <name> is not enabled` |
| `import-migration` | 1 | `import-migration: failed: the plan defers a column of audit_event, which can never be updated` |
| `import-migration` | 0 | after the C.5 success line: `import-migration: audit history: <c> carried events (seq <a>-<M>) and <b> target migration events (seq <x>-<y>) kept; nothing was renumbered` (the range in brackets is omitted when `<b>` is 0) |
| `import-migration`, `reconcile-migration` | 2 | the four A1.8 refusals, with `<cmd>` replaced by the command name |
| `reconcile-migration` | 2 | `reconcile-migration: refused: --after-use needs --from <dir> and --allow <file>` |
| `reconcile-migration` | 2 | `reconcile-migration: refused: invalid allowance file: <reason>` |
| `reconcile-migration` | 0 | `reconcile-migration: matched after use: <t> tables unchanged, <d> tables with allowed differences, <e> audit events added since the import` |
| `reconcile-migration` | 4 | after the C.5 mismatch line: `  <table>: <a> added, <c> changed, <m> missing (<basis>)` per disallowed table; for `exact_ids`, then up to 20 `    unexpected <added\|changed> <key>` and 20 `    expected but not <added\|changed> <key>` lines |
| config | refusal | `OIDC_ISSUER_URL must use https when NODE_ENV=production (plain http is accepted only for a loopback host: localhost, 127.0.0.1 or [::1])` |

`<key>` is the JSON text of the primary-key tuple. The `migration.imported` `changes` fields are as listed in A1.7. No new audit action is introduced, and no new i18n key either: every text here is operator-facing English (D-243 Q7).

**Tests (each line states what it proves; real PostgreSQL through `tests/qa/support/with-pg.sh`):**

| Test | File | Proves |
| --- | --- | --- |
| T-R1 | `transfer-load.test.ts` | A freshly migrated target (with or without the reservation) satisfies E1, E2 and E4, measured. A plainly migrated target is refused by E3 with its exact line and exit 2. A target with one `organization` is refused with exit 3 and the detail line. A target with one `audit_event` row written as `mth_app` with `source` `api` is refused with exit 3 and the E2 line. Each refusal leaves every table's count and the trail unchanged. |
| T-R2 | `transfer-load.test.ts` | `migrate --reserve-audit-seq-for` on a fresh database sets the first baseline `seq` to `M + 1`, prints the line, and the hook fires once, after `0003`. It refuses on a database with an applied migration and on a bad package (no connection is made: an unreachable URL still gives the package refusal). The plan has no deferred column on `audit_event`. |
| T-R3 (= T-C8) | `transfer-roundtrip.test.ts` | Demo plus the P6 fixtures → export → reserved target → import, exit 0: every exported table `matched`; `audit_event` rows with `seq <= M` equal the source's **row by row, including `id` and `seq`**; the baseline rows and their digest equal the L2 values on `migration_import`; the ranges do not interleave (A1.5); the target's `demoChecksum` equals the manifest's; the P6 integrity sweep passes on the target. |
| T-R4 (= T-C12) | `transfer-load.test.ts` | Through `onStep`, at L0, L1, L3, L5, L8, L9 and L12: both `audit_event` triggers have `tgenabled = 'O'`, and `pg_stat_xact_user_tables` for `audit_event` shows `n_tup_upd = 0` and `n_tup_del = 0`. No `TRUNCATE` is issued (a statement spy on the client). The only audit rows with `seq > audit_baseline_seq_max` are the import's own `migration.imported`, `migration.reconciled` and `identity.binding_held` events. |
| T-R5 (= T-C11) | `transfer-load.test.ts` | (a) One target object's byte is flipped between `copy-in` and `verify` → exit 4, the C.5 mismatch line, and the attachment mismatch reported. (b) `onStep("L8")` changes one value of a loaded non-audit row → exit 4. In both cases every table's count and digest, and the baseline, equal their pre-import values, and no `migration_import` row exists. |
| T-R6 | `transfer-recheck.test.ts` | Mode 1 after the import and a rebind: exit 0 `matched`, with deltas `audit_baseline`, `audit_additions` (counted by action) and `rebind` (n = rebound identities), all allowed. An owner UPDATE of one non-audit row → exit 4 naming the table. A further edit of a rebound identity's pair → `unexplained`, exit 4. |
| T-R7 | `recheck.test.ts`, `transfer-recheck.test.ts` | Mode 2: an allowance with exactly the keys of two created and one changed record → exit 0 and the line. One extra created row → exit 4 listing its key as unexpected. One key listed but not created → exit 4 listing it as expected. A missing row in a non-operational table → exit 4. Each malformed allowance (unknown table, excluded table, duplicate, both lists, operational name outside the constant, bad tuple) → exit 2 with the line. `RECHECK_OPERATIONAL_TABLES ∩ RECHECK_NEVER_OPERATIONAL = ∅`, and `RECHECK_NEVER_OPERATIONAL` holds every table named in A1.9 rule 6 (the 17 financial tables read from T-C17's list). |
| T-R8 | `attachment-report.test.ts`, `transfer-recheck.test.ts` | Each A1.8 refusal, with its line. A report with three mismatches lands as three `migration_reconciliation_attachment` rows with the same fields in order. A package with attachments and no report is refused, never counted as 0. A package without attachments needs no report and records 0. |
| T-R9 | `p7-transfer-guards.test.ts` | 0149: `migration_reconciliation_delta` is append-only and `mth_app` cannot insert into it. `migration_import_audit_ranges` refuses a partial set and a baseline minimum at or below the carried maximum. The new result rule accepts `recheck_after_use` with unequal row counts and refuses it with a disallowed table count. `transfer_table_rule` has the new row. |
| T-R10 | config test | `NODE_ENV=production`: `http://127.0.0.1:<p>`, `http://localhost:<p>` and `http://[::1]:<p>` issuers load; `http://idp.example.test` is refused with the exact line; https is unchanged. `secureIssuerAllowed` drives `allowHttp` in `oidc.ts` (unit case on the constructor). |
| T-R11 (= T-C17, loaded half) | `tests/integration/transfer/financial-parity.test.ts` | The loaded-target test, written by KBE-A and switched on here, passes on a target loaded by `importInto`. It is collected by `pnpm test:integration` (`vitest list` shows it). |
| T-R12 | `contract.test.ts` with `p7-exercises-be-d.ts` | `getMigrationImport` and `getMigrationReconciliation` responses with the new fields and one delta validate against the contract. |

T-C9, T-C10, T-C13, T-C14 and T-C15 stay as they are and must still pass.

**Requirement → clause → test** (this adds to C.10 and does not replace its rows):

| Requirement | Clause | Test(s) |
| --- | --- | --- |
| REQ-S19-014 | "migrating the demo dataset into a clean installation" | T-R2 (clean target, prepared), T-R3 |
| REQ-S19-014 | "reports equal record counts" | T-R3, T-R5, T-R6 |
| REQ-S19-014 | "and matching attachment checksums" | T-R5 (a), T-R8 |
| REQ-S19-014 | M0362 "validation, reconciliation" | T-R1, T-R2 (validation); T-R3, T-R5, T-R6, T-R7 (reconciliation) |
| REQ-S19-016 | "preserves IDs, links" | T-R3 |
| REQ-S19-016 | "audit history" | T-R3 (carried rows equal, including `seq`), T-R4 (append-only, triggers on), T-R6 (baseline and ranges) |
| REQ-S19-016 | "evidence checksums" | T-R5 (a), T-R8 |
| REQ-S19-016 | M0364 decimal and status integrity across the move | T-R11 |
| REQ-S19-017 (B.8, with DO-D2) | "the drill report shows matching counts and checksums"; "records … intact after a full restart" | T-R6 (mode 1, D5), T-R7 (mode 2, D9) |
| REQ-S19-017 / REQ-S01-006 (B.8) | production-semantics sign-in through the drill IdP | T-R10 |

**What BE-R1 must know.**
- The reservation is the only way a target can take an import. Do not add a fallback that renumbers, skips or archives audit rows.
- `M` is read from the package file, never from the target.
- E1–E4 run after `LOCK TABLE audit_event IN EXCLUSIVE MODE`, inside the load transaction. A check outside that transaction is a defect.
- A recheck never reports `attachments_checked = 0` for a package that has attachments.
- `RECHECK_OPERATIONAL_TABLES` may shrink by measurement. It never grows without the architect.
- Run before the handback: `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, `pnpm test`, the integration files named above plus `transfer-export.test.ts`, `catalogue.test.ts`, `contract.test.ts`, `unbound-signin.test.ts`, `import-routes.test.ts`, `attachments.test.ts` and `oidc.test.ts`, `node tools/release/migration-catalogue.mjs --check`, the dictionary coverage tool, the repository-wide prettier check, and `node tools/gates/validate.mjs --historical --stage DG6` **before** implementing.

### C.13 BE-R2: finish the load and recheck (backend-workflow; repair; after ARCH-R3)

**What this is.** The second repair task for the import, under p7-plan §5.3 (D-259). It builds ADR-0064 **Amendment 2** (A2.1–A2.10) and closes every BE-R1 gap: `prepare-target.mjs`, `--keep-reports`, `reconcile-migration --from`, mode 1, mode 2 `--after-use --allow`, `recheck.ts`, `parseAllowance`, T-R3–T-R8, T-R11 and T-R12. It also adds the register guard of A2.8. C.12's rows stand where Amendment 2 does not change them. Where they differ, Amendment 2 wins.

**Hard rules.**
- C.12's hard rules stand.
- A carried audit row whose `id` exists on the target is either proven to be the same event (E5) and recorded, or it refuses the import. It is never inserted, skipped without a record, renumbered or archived.
- If a measurement contradicts Amendment 2, stop and report. It is a design question.

**Creates:**

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0150_p7_transfer_import_shared_audit.sql` (the next free id above the highest shipped file, D-245 O9) | A2.4: `migration_import.audit_already_present_rows` with CHECK `migration_import_audit_present`, and the dropped and re-added `basis` CHECK of `migration_reconciliation_delta` (nine values). The header states that nothing here touches `audit_event`. |
| `packages/db/src/transfer/recheck.ts` | A1.9 and A2.6: `RECHECK_OPERATIONAL_TABLES`, `RECHECK_NEVER_OPERATIONAL`, `ALLOWANCE_SCHEMA_VERSION = "mth-recheck-allowance/2"`, `parseAllowance(bytes) → Allowance` (structure only, no database, the A1.9 and A2.6 refusals that need no catalogue), `validateAllowance(tx, allowance)` (the catalogue refusals: triggers, primary keys, foreign keys, actors, cycles), `compareRows(tx, table, packageFile) → {added, changed, missing}` by primary-key tuple, `explainAudited`, `explainChildren`, the `user_identity` rebind reversal, and `checkAuditTrail` (A1.5 with A2.3) |
| `packages/db/src/transfer/recheck.test.ts` | unit parts of T-R7 and T-R15 (parsing, the constants' disjointness, refusal lines) |
| `packages/db/test/integration/transfer-recheck.test.ts` | T-R6, T-R7, T-R8 (database part), T-R15 |
| `packages/db/src/transfer/table-digest.ts` | `tableDigest(tx, table, { rows?: boolean })`. It returns `{name, rows, digest, lines?: [{key, sha256}]}` using `encodeTable`'s encoder, settings, order and line format, so `digest` equals what the manifest's `contentDigest` would be. |
| `tools/migration/prepare-target.mjs` | thin wrapper over `mth-db migrate --reserve-audit-seq-for <dir>`. `--from <dir>` is required; the exit codes are those of §2 rule 4; the child's lines are passed through unchanged. |
| `tools/migration/tests/wrappers.test.mjs` (or new cases in the existing wrapper test, if there is one) | T-R18 |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `packages/db/src/transfer/import.ts` | Removes BE-R1's provisional exit-1 collision line and `checkAuditIdCollisions`. Adds E5 at L1 (A2.2), with the per-row comparison of the 13 columns of A2.1 through the encoder. Then: L5 skips exactly the `P` rows and checks the inserted count; L9 reconciles by reconstruction; L11 fills `audit_already_present_rows`; L12 adds `auditAlreadyPresent`; and the A2.2 output line. |
| `packages/db/src/transfer/reconcile.ts` | `encodeCarriedAudit(tx, M, present)` (A2.3; it equals `encodeTable(…, { where: 'seq <= M' })` for `present = []`), the `audit_already_present` delta, mode 1 and mode 2 through `recheck.ts`, and the A1.8 report in place of `attachments_checked = 0`. Every recheck reads `P` from the latest `migration.imported` event and cross-checks it with `migration_import.audit_already_present_rows`. |
| `packages/db/src/cli.ts` | `reconcile-migration` accepts `--attachments-report FILE` and `--after-use --from DIR --allow FILE`, plus `--report FILE`. New read-only command `table-digest --table T [--table T …] [--rows]`: as `mth_app` (`DATABASE_URL`), only tables of the export plan; one canonical JSON line `mth-table-digest/1` on stdout; exit 0, or exit 2 with `table-digest: refused: <t> is not an exported table`. Usage and header updated. |
| `packages/db/src/transfer/index.ts` | export lines (`parseAllowance`, `validateAllowance`, the constants, `tableDigest`) |
| `tools/migration/import.mjs` | the order: package checks, then `copy-in`, then `verify --out <tmp>`, then `mth-db import-migration --attachments-report <tmp> [--report …]`. `--keep-reports <dir>` copies the verify output there; otherwise the temporary file is deleted, on success and on failure. |
| `tools/migration/reconcile.mjs` | `--from <dir>` (re-checked as in §6 step 1). When the import recorded attachments, it runs `verify` first and passes `--attachments-report`. With `--after-use --allow <file>`, mode 2. The flags are passed through. `--keep-reports <dir>` works as in `import.mjs`. |
| `packages/db/test/integration/transfer-load.test.ts` | The "R1 (BLOCKED …)" test is replaced by T-R13 and T-R14. T-R4 and T-R5 run on the real load. |
| `packages/db/test/integration/transfer-roundtrip.fixture.ts`, `transfer-roundtrip.test.ts` | T-R3 with `P` (A2.10 residual 1). `seedSyntheticImport` fills the seven A1.6 columns and `audit_already_present_rows`. |
| `tests/integration/transfer/financial-parity.test.ts` | only the C.12 change (T-R11): the loaded-target `it.todo` becomes its test body |
| `packages/db/src/schema.ts`, `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts`, `packages/db/test/integration/p7-transfer-guards.test.ts` | only the 0150 lines (the next free id becomes 0151) and T-R9's extra cases for 0150 |
| `docs/api/openapi.yaml`, `apps/api/src/modules/transfer/import/service.ts`, `apps/api/test/integration/contract/p7-exercises-be-d.ts` | additive only: the A1.6 fields (BE-R1 gap 4), `auditAlreadyPresentRows`, and the nine `basis` values. `info.version` and the operation count are unchanged (T-R12). |
| `docs/architecture/data-dictionary.md`, `docs/architecture/erd.md`, `docs/handover/data/coverage.json`, `docs/handover/migration-catalogue.json`, the generated table of `docs/handover/upgrades.md` | the 0150 lines; regenerated with their tools, no override |
| `apps/api/scripts/register-snapshot.test.mjs` | T-R16 only. `register-snapshot.mjs` is **not** changed (A2.8). |

**Not BE-R2's:** the rewording of REQ-DLV-006 and REQ-DLV-023 in `docs/delivery/requirements.csv` (A2.8 item 1). It belongs to the requirements-analyst, through an orchestrator assignment. Until it lands, T-R16 fails and names the two rows. BE-R2 reports that and does not edit the register.

**Exact texts.** These add to C.5 and C.12. Every earlier line stays, except BE-R1's provisional collision line, which A2.7 replaces.

| Command | Exit | Line |
| --- | --- | --- |
| `import-migration` | 1 | `import-migration: failed: <n> carried audit events share their id with a target audit event but are not the same event; nothing was imported` |
| `import-migration` | 1 | then, at most 20 times: `import-migration: <id>: differs in <col>[, <col>…]` or `import-migration: <id>: not a migration baseline event on the <source\|target>` |
| `import-migration` | 1 | `import-migration: failed: audit_event loaded <n> rows, expected <e>` |
| `import-migration` | 0 | when `\|P\| > 0`, after the audit-history line: `import-migration: audit history: <p> carried events were already present as identical target migration events (same id and content); their source seq and time are recorded in migration.imported, and none was inserted twice` |
| `reconcile-migration` | 4 | after the C.5 mismatch line: `  audit_event: the reconstructed carried trail does not match the manifest (<n> rows, digest <d>)` |
| `reconcile-migration` | 4 | for `audited` and `children` tables, after the per-table line: at most 20 `    unexplained <added\|changed> <key>` and at most 20 `    expected but not <added\|changed> <key>` |
| `reconcile-migration` | 2 | `reconcile-migration: refused: invalid allowance file: <reason>`, with the A2.6 rule 6 reasons, plus A1.9 rule 7's |
| `table-digest` | 2 | `table-digest: refused: <t> is not an exported table` |
| `prepare-target.mjs` | 2 | `prepare-target: refused: --from <dir> is required` |

**Tests** (real PostgreSQL through `tests/qa/support/with-pg.sh`). T-R3–T-R12 are as in C.12, adjusted only by A2.10 residual 1. These are added:

| Test | File | Proves |
| --- | --- | --- |
| T-R13 | `transfer-load.test.ts` | On the demo plus P6 fixtures, export, reserved target, import exits 0. It checks that: `\|P\|` > 0 and equals the measured shared ids (the number is recorded in the handback); no `P` row was inserted (the target holds one row per shared id, the baseline one); the `already present` line is printed; `migration_import.audit_already_present_rows = \|P\|`; the delta row is `audit_already_present` with `rows_changed = \|P\|` and is allowed; `migration.imported` lists `P` sorted by id, with each `sourceSeq` and `sourceOccurredAt` equal to the package line; the reconstructed digest equals the manifest's; `pg_stat_xact_user_tables` for `audit_event` shows no update or delete; and both triggers are `O` at every step. |
| T-R14 | `transfer-load.test.ts` | A package whose shared-id line differs in `reason` (with its `fileSha256` and manifest recomputed by the fixture, so the package checks pass) exits 1 with both A2.7 lines naming `reason`. A package whose shared-id line has `source` `api` exits 1 with `not a migration baseline event on the source`. In both cases every table's count, the trail's md5 and the trigger states are unchanged, and no `migration_import` row exists. |
| T-R15 | `recheck.test.ts`, `transfer-recheck.test.ts` | Mode 2 with `audited` and `children`. A row changed through a journalled actor's audited mutation is explained. A row added by the owner, with an audit event written for a non-listed user, is `unexplained` and exits 4 with its key. A `mustInclude` key that was not changed gives `expected but not`. A child of an explained parent is explained, and a child of an unchanged parent is unexplained. Every A2.6 rule 6 refusal exits 2 with its line. An allowance with schema version `mth-recheck-allowance/1` is refused. |
| T-R16 | `apps/api/scripts/register-snapshot.test.mjs` | A2.8 item 2: the snapshot built from the tree's register has no T1 hit of R1, R2, R3, R5 or R6, and every R4 hit matches a T1 host entry of the allow-list. On a fixture register with a planted `/var/tmp/mth-run` path, it fails and names the row, the column and R2. |
| T-R17 | `transfer-recheck.test.ts` | `tableDigest` on an exported table equals the export's `contentDigest` for that table. Its `--rows` lines hash each encoded line, and the CLI refuses a non-exported table with its line. |
| T-R18 | `tools/migration/tests/` | `prepare-target.mjs` passes the child's exit code and lines through. `import.mjs --keep-reports <dir>` keeps the verify report, and without the flag no report file is left (also after a failed import). `reconcile.mjs --from` runs `verify` exactly when the import recorded attachments. |

**Requirement → clause → test** (this adds to C.10 and C.12):

| Requirement | Clause | Test(s) |
| --- | --- | --- |
| REQ-S19-016 | "audit history" | T-R13, T-R14 (shared migration events), T-R3 |
| REQ-S19-014 | M0362 "reconciliation" | T-R13 (reconstruction), T-R6, T-R7, T-R15 |
| REQ-S19-017 (B.8) | "records, jobs and approvals intact after a full restart" | T-R15 (mode 2), T-R17 (the digest D9 uses) |
| REQ-S19-019 | "no builder-hosted … in built assets" | T-R16 |

**What BE-R2 must know.**
- `P` is computed inside the load transaction after the `audit_event` lock, never before it.
- The 13 compared columns are A2.1's list, read from the catalogue minus `seq` and `occurred_at`. A test pins that the catalogue gives exactly 15 `audit_event` columns, so a future column added to `audit_event` fails the test and comes back to the architect.
- `RECHECK_OPERATIONAL_TABLES` may shrink by measurement. It never grows without the architect.
- Run before the handback: `node tools/gates/validate.mjs --historical --stage DG6` **first**; then `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test`; the integration files of C.12 plus `transfer-recheck.test.ts`; `node --test apps/api/scripts/register-snapshot.test.mjs` and the wrapper tests; `node tools/release/migration-catalogue.mjs --check`; the dictionary coverage tool; and the repository-wide prettier check.

### C.14 BE-R3: mode 2 rules and table-digest drain (backend-workflow; repair; after ARCH-R4)

**What this is.** The third repair task for the import and recheck, under p7-plan §5.3 (D-260). It builds ADR-0064 **Amendment 3**:

- the automation chain (A3.2);
- the `counter` basis (A3.3);
- allowance `mth-recheck-allowance/3` (A3.4);
- migration 0151 and the additive contract value (A3.5).

It also fixes DO-D3 Q1: `mth-db` cuts piped stdout at 64 KiB. C.12's and C.13's rows stand where Amendment 3 does not change them. Where they differ, Amendment 3 wins. The column counts of C.13 read as A3.7 corrects them (15 compared, 17 in total). BE-R2's code already does this and is not changed for it.

**Hard rules.**
- C.12's and C.13's hard rules stand.
- No table is added to `RECHECK_OPERATIONAL_TABLES`.
- No worker or API audit attribution changes (A3.2 option (b) is rejected).
- `jobActor` stays as it is.
- Nothing writes, updates or truncates `audit_event`.
- If a measurement contradicts Amendment 3, stop and report. It is a design question. For example: an outbox row and its mutation's audit event whose timestamps differ, or a counter call site that does not insert its coded row in the same transaction.

**Creates:**

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0151_p7_transfer_recheck_counter_basis.sql` (the next free id above the highest shipped file, D-245 O9) | A3.5: drop and re-add `migration_reconciliation_delta_basis_check` with ten values (A2.4's nine plus `counter`). The header states that nothing here touches `audit_event`. |
| `packages/db/src/transfer/recheck-automation.ts` (or a section of `recheck.ts`; BE-R3 chooses and names it in the handback) | `explainingEvents(tx, B, actors) → E`; `automationChain(tx, B, actors, package) → { events: E*, chain: AutomationLink[] }`, the A3.2 fixed point |
| `packages/db/test/integration/transfer-recheck-automation.test.ts` | T-R19, T-R20 |
| `packages/db/test/integration/cli-stdout-drain.test.ts` (or a case in an existing CLI test) | T-R23 |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `packages/db/src/transfer/recheck.ts` | `ALLOWANCE_SCHEMA_VERSION = "mth-recheck-allowance/3"`. `Allowance.counters`. `parseAllowance` requires the seven keys and refuses `/1` and `/2` (`unsupported schema version '<v>'`). `RECHECK_COUNTER_TABLES` (A3.3 item 1; `prefixes` and `unmapped`). `validateAllowance` adds the counter refusals of A3.4. `explainAudited` takes `E*` in place of `E`. New `explainCounters` (A3.3 items 3–7). `DeltaBasis` gains `counter`. |
| `packages/db/src/transfer/reconcile.ts` | Mode 2 order: `tables` → `audited` with `E*` → `children` → `counters` → `operational`. The `counter` delta. The JSON report gains `explainingEventsByActor`, `explainingEventsByAutomation`, `automationChain` (A3.2 "Report") and, per counter row, `{key, old, new, codes}`. |
| `packages/db/src/cli.ts` | **DO-D3 Q1.** `main(...).then((code) => { process.exitCode = code; })` in place of `process.exit(code)`, and the same in the two error branches (l.370–392 at the base). The `DemoRefused` branch then `return`s, so it keeps its own exit code and is not overwritten by the generic `1`. The process then ends when stdout has drained. No command may leave a handle open: a pool not closed is a bug, which T-R23 catches by timing out. Usage and header unchanged. |
| `packages/db/src/transfer/index.ts` | export lines (`RECHECK_COUNTER_TABLES`, `explainCounters`, the automation functions) |
| `packages/db/src/transfer/recheck.test.ts` | unit parts of T-R21 and T-R22's prefix pin |
| `packages/db/test/integration/transfer-recheck.test.ts` | the existing `/2` fixtures move to `/3` (add `"counters": []`) |
| `packages/db/src/schema.ts`, `packages/db/src/seed.test.ts`, `packages/db/test/integration/p7-transfer-guards.test.ts`, `packages/db/test/integration/catalogue.test.ts` | the 0151 lines (the next free id becomes 0152) and T-R9's cases for 0151 |
| `docs/api/openapi.yaml`, `apps/api/src/modules/transfer/import/service.ts`, `apps/api/test/integration/contract/p7-exercises-be-d.ts` | additive only: `counter` in the `basis` enum and its zod mirror. The exercise seeds one `counter` delta (T-R12). `info.version` and the operation count are unchanged. |
| `docs/architecture/data-dictionary.md`, `docs/architecture/erd.md`, `docs/handover/data/coverage.json`, `docs/handover/migration-catalogue.json`, the generated table of `docs/handover/upgrades.md` | the 0151 lines; regenerated with their tools, no override |

**Not BE-R3's:**
- the drill (`deploy/scripts/**`), which is DO-D4's (B.8);
- BE-R2's Q2 (the grouped load and `SET CONSTRAINTS ALL IMMEDIATE`), which stays with the orchestrator as BE-R2 raised it.

**Exact texts.** These add to C.5, C.12 and C.13. Every earlier line stays.

| Command | Exit | Line |
| --- | --- | --- |
| `reconcile-migration` | 2 | `reconcile-migration: refused: invalid allowance file: unsupported schema version 'mth-recheck-allowance/2'` (and `/1`) |
| `reconcile-migration` | 2 | `reconcile-migration: refused: invalid allowance file: missing key 'counters'` |
| `reconcile-migration` | 2 | `reconcile-migration: refused: invalid allowance file: counter table <t> is not in RECHECK_COUNTER_TABLES` |
| `reconcile-migration` | 4 | for a counter table, after the per-table line `  <table>: <a> added, <c> changed, <m> missing (counter)`: at most 20 lines `    counter <key>: moved <old> -> <new>, <n> new coded rows (<numbers, comma-separated, or none>)` |

**Tests** (real PostgreSQL through `tests/qa/support/with-pg.sh`, except where marked unit):

| Test | File | Proves |
| --- | --- | --- |
| T-R19 | `transfer-recheck-automation.test.ts` | Fixture: a target after import, with the API and the worker running in-process.<br>• A journalled actor creates a transformation through the route. Mode 2 with `automation_execution` and `automation_action_result` in `audited` explains both rows (`allowed`), and `automationChain` names the outbox row and the `transformation` event with equal timestamps.<br>• **Negative 1:** an owner-inserted `outbox_event` with the same aggregate but a `created_at` one microsecond off, triggering an execution, leaves that execution `unexplained`.<br>• **Negative 2:** a starter execution caused by a non-journalled user (the same route, signed in as a user not in `actors`) is `unexplained`, and so are the rows its job wrote.<br>• **Negative 3:** an execution with `initiating_user_id` or `trigger_payload.createdBy` not in `actors` is `unexplained`, even though its trigger link holds.<br>• **Negative 4:** a schedule-triggered execution is `unexplained`. |
| T-R20 | `transfer-recheck-automation.test.ts` | Mode 2 with `counters: ["record_code_counter"]`:<br>• one RAID issue created by a journalled actor gives `I` moved 0→1 (or n→n+1) and is explained;<br>• the counter moved by 2 for one row is `unexplained`, with the A3.3 line;<br>• a counter moved with no coded row is `unexplained`;<br>• a coded row added by an unexplained event leaves its counter step `unexplained`;<br>• an explained coded row whose counter did not move is reported (A3.3 item 5);<br>• an unmapped prefix that changed is `unexplained`;<br>• `D-`, `DEC-` and `DEP-` codes in one transformation are counted only under their own prefix. |
| T-R21 | `recheck.test.ts` (unit) and `transfer-recheck.test.ts` | `/3` is accepted with seven keys. `/1` and `/2` are refused with the line. `counters` missing is refused. An unknown counter table is refused. `record_code_counter` in both `counters` and `children` gives `listed more than once`. |
| T-R22 | `recheck.test.ts` (unit) | `RECHECK_COUNTER_TABLES.record_code_counter`'s `prefixes ∪ unmapped` equals the 24 prefixes of the 0055 CHECK, read from the migration file, and the two are disjoint. Each mapped table has `transformation_id` and its code column, checked against `SCHEMA_COLUMNS`. |
| T-R9 (0151) | `p7-transfer-guards.test.ts` | The basis CHECK accepts `counter` and still refuses an unknown basis. `audit_event` triggers and grants are unchanged. |
| T-R12 | contract | the `counter` value round-trips |
| T-R23 | `cli-stdout-drain.test.ts` | On a migrated seed-demo database, `node packages/db/dist/cli.js table-digest --table audit_event --rows` (built first) piped through a reader that counts bytes gives the same byte count and SHA-256 as the same command written to a file. The output must exceed 256 KiB; the test asserts that. The exit code is 0, and the process ends within 30 s. |

**Requirement → clause → test** (adds to C.10, C.12, C.13):

| Requirement | Clause | Test(s) |
| --- | --- | --- |
| REQ-S19-014 | M0362 "reconciliation" | T-R19, T-R20, T-R21, T-R22 |
| REQ-S19-017 (B.8) | "records, jobs and approvals intact after a full restart" | T-R19, T-R20 (mode 2 on automation and counters), T-R23 (the digest D9 uses, piped) |

**What BE-R3 must know.**
- The timestamp link compares `timestamptz` values exactly in SQL (`e.occurred_at = o.created_at`), never through text or JavaScript `Date`, which would lose microseconds.
- `E*` is computed once per recheck, inside its transaction, before any `audited` table is explained.
- The counter rule reads only rows that this run explained. Run it last.
- Run before the handback: `node tools/gates/validate.mjs --historical --stage DG6` **first**; then `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test`; the integration files of C.13 plus T-R19–T-R23; `node tools/release/migration-catalogue.mjs --check`; the dictionary coverage tool; and the repository-wide prettier check.

## §D. Slice D: configuration transfer bundle (T-DG7-ARCH-02; ADR-0065)

### D.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0065-p7-configuration-transfer-bundle-schema-version-drafts-publish-pipeline.md`.
- **Migration `0134_p7_config_bundles.sql`:** `config_bundle_export`, `config_bundle_import`, `config_bundle_import_item`, `config_bundle_import_commit`, with guards and grants; the permissions in `0135` (C.0).
- Kysely types, catalogue pins, the guard probe (C.0), lock 730405.
- **Contract:** 9 slice D operations (tag `transfer`), pending in `apps/api/test/support/p7-pending-be-f.ts`.
- **Inventory:** `config_bundle_import_commit.target_record_id` classified.

### D.1 BE-F: configuration bundles (backend-workflow; W5; after BE-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `packages/shared/src/transfer/config-bundle.ts` | `BUNDLE_SCHEMA_VERSION = "mth-config-bundle/1"`, the 12 kinds in ADR-0065 §1 order, canonical JSON and `contentSha256`, the envelope zod schema and one content schema per kind (its export line in `packages/shared/package.json` is an orchestrator merge on request, p7-plan §5.3) |
| `apps/api/src/modules/transfer/config-bundle/{routes,service,registry,plan}.ts` | the 9 operations, the `ConfigBundleKindAdapter` port and registry, the plan and commit (ADR-0065 §3–§6), lock 730405 |
| `apps/api/src/modules/methodology/config-bundle-adapter.ts` | the six Studio kinds and `config_review_policy`; the new "draft from content" service in the same file (ADR-0065 §5) |
| `apps/api/src/modules/automation/config-bundle-adapter.ts` | `automation_rule` (draft version) |
| `apps/api/src/modules/admin/config-bundle-adapters.ts` | `branding`, `upload_policy` |
| `apps/api/src/modules/tasks/config-bundle-adapter.ts` | `notification_policy` |
| `apps/api/src/modules/jobs/config-bundle-adapter.ts` | `job_schedule` (always applied disabled) |
| `apps/api/test/integration/transfer/config-bundle.test.ts`, `config-bundle-roundtrip.test.ts`, `apps/api/test/integration/contract/p7-exercises-be-f.ts` | T-D1…T-D9 |

**Modifies:** `apps/api/test/support/p7-pending-be-f.ts` (shrinks to empty); the registry wiring point BE-A creates (one registration line per adapter). If the bundle tables need a column, `0137`+ in the free range (none expected).

**Reads only:** each adapter's owning service (`methodology/review-policies.ts`, `automation/lifecycle.ts`, `admin/branding.ts`, `admin/upload-policy.ts`, `tasks/notification-policy.ts`, `jobs/schedules.ts`) and its permission constant. Editing an existing operation's request, response or behaviour is out of scope; if a kind needs it, stop and report (ADR-0065 residual 2).

### D.2 Exact texts

**Problem codes** (EN; AR provisional):

| Code | Status | English | Arabic (provisional) |
| --- | --- | --- | --- |
| `config_bundle.schema_version_unsupported` | 422 | This bundle uses schema version "{version}", which this release cannot read. Export it again from a compatible release. | تستخدم هذه الحزمة إصدار المخطط "{version}" الذي لا يستطيع هذا الإصدار قراءته. صدّرها مجددًا من إصدار متوافق. |
| `config_bundle.too_large` | 413 | The bundle is larger than 5 MiB. | حجم الحزمة أكبر من 5 ميغابايت. |
| `config_bundle.checksum_mismatch` | 422 | The bundle's checksum does not match its content. | لا يطابق مجموع التحقق الخاص بالحزمة محتواها. |
| `config_bundle.item_invalid` | 422 | An item of the bundle is not valid for its kind. | أحد عناصر الحزمة غير صالح لنوعه. |
| `config_bundle.nothing_published` | 422 | Nothing of the chosen kinds is published in this organization. | لا يوجد إصدار منشور من الأنواع المختارة في هذه الجهة. |
| `config_bundle.unportable_reference` | 422 | An item refers to a record that has no stable key, so it cannot be exported. | يشير أحد العناصر إلى سجل ليس له مفتاح ثابت، لذا لا يمكن تصديره. |
| `config_bundle.not_validatable` | 422 | This import cannot be validated in its current state. | لا يمكن التحقق من هذا الاستيراد في حالته الحالية. |
| `config_bundle.not_committable` | 422 | Only a validated import without conflicts or refused items can be committed. | لا يمكن اعتماد إلا استيراد تم التحقق منه بلا تعارضات أو عناصر مرفوضة. |
| `config_bundle.plan_changed` | 422 | The configuration changed since the last validation. Validate again. | تغيّرت الإعدادات منذ آخر تحقق. أعد التحقق. |
| `config_bundle.open_draft_exists` | (item) | An open draft of this item exists. It is never overwritten. | توجد مسودة مفتوحة لهذا العنصر، ولا يُكتب فوقها أبدًا. |
| `config_bundle.reference_missing` | (item) | This item refers to another item that is neither in the bundle nor in this installation. | يشير هذا العنصر إلى عنصر آخر غير موجود في الحزمة ولا في هذه المنصة. |
| `config_bundle.kind_not_permitted` | (item) | You do not have the right to change this kind of configuration. | ليست لديك صلاحية تعديل هذا النوع من الإعدادات. |
| `config_bundle.kind_unavailable` | (item) | This kind of configuration is not available in this installation. | هذا النوع من الإعدادات غير متاح في هذه المنصة. |

**Screen texts** (FE-B, `apps/web/src/i18n/{en,ar}/transfer.json`):

| Key | English | Arabic (provisional) |
| --- | --- | --- |
| `bundle.title` | Configuration transfer | نقل الإعدادات |
| `bundle.intro` | Export published configuration as a bundle, or import a bundle. An import creates drafts that go through the normal review and publishing; it never publishes anything. | صدّر الإعدادات المنشورة كحزمة، أو استورد حزمة. ينشئ الاستيراد مسودات تمر بالمراجعة والنشر المعتادين، ولا ينشر أي شيء. |
| `bundle.nonDraftNote` | Branding, the notification policy, review policies and the upload policy have no draft stage: committing applies them as a change. Job schedules are imported disabled. | لا توجد مرحلة مسودة للهوية البصرية وسياسة الإشعارات وسياسات المراجعة وسياسة الرفع: يؤدي الاعتماد إلى تطبيقها كتغيير. تُستورد جداول المهام معطّلة. |
| `bundle.export` / `upload` / `validate` / `commit` | Export bundle / Upload bundle / Validate / Commit as drafts | تصدير حزمة / رفع حزمة / تحقق / اعتماد كمسودات |
| `bundle.action.create_draft` / `new_draft` / `identical` / `conflict` / `refused` | New draft / New draft of an existing item / Identical, nothing to do / Conflict / Refused | مسودة جديدة / مسودة جديدة لعنصر موجود / مطابق، لا إجراء / تعارض / مرفوض |
| `bundle.status.uploaded` / `validated` / `invalid` / `committed` | Uploaded / Validated / Invalid / Committed | مرفوعة / تم التحقق / غير صالحة / معتمدة |

**Audit actions:** `config_bundle_export.created`, `config_bundle_import.uploaded`, `.validated`, `.committed`, plus each kind's own existing audit action for every written record.

### D.3 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-D1 | `config-bundle.test.ts` | `mth-config-bundle/2`, `""` and a missing `bundleSchemaVersion` are rejected with 422 `config_bundle.schema_version_unsupported`; no row and no object are written |
| T-D2 | `config-bundle.test.ts` | a changed `content` with the old `contentSha256` is 422 `config_bundle.checksum_mismatch`; an invalid item is 422 `config_bundle.item_invalid` with its pointer; 5 MiB + 1 byte is 413 |
| T-D3 | `config-bundle.test.ts` | the plan: each of the five actions on synthetic targets; an open draft is `conflict` and is not touched; `invalid` is terminal |
| T-D4 | `config-bundle.test.ts` | commit writes **drafts** for the seven drafting kinds (status draft, never published); job schedules arrive `enabled = false`; each write has its kind's audit event; `plan_changed` writes nothing |
| T-D5 | `config-bundle.test.ts` | permissions: ADM_TECH and ADM_METHOD only; AUD 403 on all 9; an item of a kind the caller cannot write is `refused` with `config_bundle.kind_not_permitted` |
| T-D6 | `config-bundle-roundtrip.test.ts` | demo → export all kinds → clean installation → upload, validate, commit, publish through the existing operations → every published content hash equals the source's `contentSha256`; a re-export has the same items and hashes |
| T-D7 | `config-bundle-roundtrip.test.ts` | publishing an imported methodology draft in an installation with a running transformation triggers the ADR-0040 migration and reapproval exactly as a hand-made publish (same records created); the pin is unchanged until then |
| T-D8 | `config-bundle.test.ts` | no source id appears in any bundle (every uuid in the file is `exportId`); an unportable reference is 422 at export |
| T-D9 | `p7-exercises-be-f.ts` | each of the 9 operations is exercised and validates against the contract |
| A06 replay | QA-B (`tests/qa/**`) | the A06 assertions pass on the target after T-D6's publish |

### D.4 Seams

| Seam | Rule |
| --- | --- |
| **Publish pipeline (seam 2)** | Read-only use of the existing publish, review and migration paths; one new "draft from content" function per drafting module (additive). Any change to an existing operation is a reopen question for the orchestrator. |
| **Slice C** | Bundles move configuration **by stable key** into an installation with its own records; migrations move whole installations **by id** into an empty one. A migration package carries the bundle tables as records (they are not excluded). |
| **Screens → FE-B** | Administration > Configuration transfer, texts in D.2. |
| **Transfer drill → DO-D** | The A18 drill exports a bundle from the demo and imports it into the clean installation (REQ-S19-008 lists A18). |

### D.5 Integration order

ARCH-02 merged → BE-A (W4: wiring point) → BE-F (W5) → FE-B (W9) → QA-B's A06 replay (W11) → DO-D (W10, the drill's bundle step).

### D.6 Requirement → clause → test → owner

| Requirement | Clause (acceptance text) | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S19-008 | "a bundle exported from the demo installation imports into a clean one" | T-D6; DO-D's A18 drill | BE-F; DO-D |
| REQ-S19-008 | "and its published versions behave identically" | T-D6 (content hashes), A06 replay, T-D7 (publish semantics unchanged) | BE-F; QA-B |
| REQ-S19-008 | "a bundle with an unknown schema version is rejected" | T-D1 | BE-F |
| REQ-S19-008 | M0356 "Workflow, methodology, forms, branding and automation configuration export/import with schema versions" | T-D4 (all 12 kinds written through their paths), T-D6 | BE-F |

### D.7 What the implementers must know

- **Never publish in a commit.** A drafting kind's import ends as a draft. T-D4 fails otherwise.
- **Never overwrite a draft.** An open draft is a `conflict`.
- **Job schedules arrive disabled.** Always.
- **No ids in a bundle.** Stable keys and codes only.
- **The kind's own right decides.** `config_bundle.import` alone never lets a user write a kind they could not write by hand.

## §E. Slice E: backup, restore, upgrades and retention (T-DG7-ARCH-03; ADR-0066, ADR-0067, ADR-0068)

### E.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0066-p7-backup-restore-backup-set-manifest-restore-checks-drill.md`, `ADR-0067-p7-retention-classes-archival-job-dry-run-purge-guard.md`, `ADR-0068-p7-upgrades-migration-dry-run-irreversible-catalogue-maintenance-window-rollback-by-restore.md`.
- **Migration `0143_p7_retention_classes.sql`:** `retention_class` (12 classes, all `retain`, period NULL), `retention_table_class` (one row per public base table, generated from the catalogue; explicit rows for audit, snapshot, system, derived and operational tables), the guard `retention_class_guard`.
- **Migration `0144_p7_retention_runs.sql`:** `retention_run`, `retention_archived_record`, `retention_run_action`; `retention_record_key()`, `retention_row_age()`, the purge function `retention_purge_record()` (SECURITY DEFINER), the read-only trigger on `inbox_notification` and `worker_heartbeat`.
- **Migration `0145_p7_backup_sets.sql`:** `backup_set` and `backup_set_record(jsonb)` (owner only).
- **Migration `0146_p7_retention_backup_permissions.sql`:** `retention.read`, `retention.configure`, `retention.run`, `backup.read` and their role defaults. `packages/shared/src/permissions.ts` `P7_RETENTION_PERMISSIONS`, `P7_RETENTION_ROLE_PERMISSIONS` (in `P7_PERMISSIONS`).
- **Kysely types** and `SCHEMA_COLUMNS` for the 6 tables. **Catalogue pins** (`catalogue.test.ts`): the 0143–0145 trigger test, "every public base table has exactly one retention class with its real primary key", the class-registry test, the mutable-table pin, the privilege pins, and one added line in the approved P6 `worker_heartbeat` trigger pin. **Seed parity:** the 0146 block; the numbering example moves to `0147`.
- **Guard probe:** `packages/db/test/integration/p7-retention-guards.test.ts` (15 tests, real PostgreSQL).
- **Advisory lock** 730410 `retentionRun` (registry, test, ADR-0016 §6); 730411–730415 reserved.
- **Contract:** 10 operations (tag `retention`), `p7-operations.ts` block, `p7-pending-arch-03.ts`, `p7-pending-be-g.ts`; the contract count pin is 961.
- **ERD, data dictionary and permissions matrix** sections for 0143–0146.
- **Free ids:** `0147`–`0149` for the slice E implementers (BE-G takes `0147`). Implementer migrations of `0136`–`0142` (slices C and D) are renumbered at merge if they land after `0143`–`0146` (the runner refuses an id below the highest applied one; D-245 O9).

### E.1 BE-G: retention module, job and backup status route (backend-workflow; W5; after BE-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/retention/classes/routes.ts` (+ `service.ts`) | `listRetentionClasses`, `getRetentionClass`, `updateRetentionClass` (If-Match; 730410; the 422 codes of E.5; audit `retention_class.updated` with before/after of action, period and reference) |
| `apps/api/src/modules/retention/runs/routes.ts` (+ `service.ts`) | `listRetentionRuns`, `createRetentionRun`, `createRetentionDryRun` (Idempotency-Key; 730410; 422 `retention.run_in_progress`; `as_of = now()`; enqueue `retention.archive` with singleton key = run id; audit `retention_run.requested`), `getRetentionRun`, `listRetentionRunActions`, `listRetentionArchivedRecords` |
| `apps/api/src/modules/retention/backups/routes.ts` | `listBackupSets` (`backup.read`) |
| `apps/worker/src/handlers/retention/archive.ts` | the job `retention.archive` (ADR-0067 §4–§6): `queued → running` once under 730410; per enabled class, candidates by age column (`record_age_at` read as text); the archive set under `retention/<runId>/` through the EvidenceStore with the ADR-0064 encoder (`packages/db/src/transfer/export.ts`, BE-C) **before** any marker; then batches of ≤ 500 rows per transaction: marker → `archived` action + audit → `retention_purge_record()` → `purged` or `skipped_referenced` action + audit; dry run: `would_*` actions only; `succeeded` with counts, or `failed` with the reason |
| `packages/db/migrations/0147_p7_retention_job.sql` | the `job:retention.archive` service identity (platform scope; declared and granted `retention.read`) and its `job_schedule` row (weekly, Monday 02:00, `Asia/Riyadh`), **disabled**; the `retention_table_class` row of every table BE-G adds (none expected) |
| `apps/api/test/integration/retention/{classes,runs,backups}.test.ts`, `apps/worker/test/integration/retention-archive.test.ts`, `apps/api/test/integration/contract/p7-exercises-be-g.ts` | T-E10…T-E22 |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `apps/api/src/modules/retention/index.ts` (BE-A's stub) | the three route registrations |
| `apps/worker/src/handlers/retention/index.ts` (BE-A's stub) | the handler registration |
| `apps/api/test/support/p7-pending-be-g.ts` | removes each entry as it is routed and exercised; empty at the end |
| `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts` | only the lines for `0147` (the numbering example moves to `0148`) |

**Reads only:** `retention_*`, `backup_set`, `apps/api/src/modules/evidence/store.ts` (the port), `packages/db/src/transfer/export.ts` (the encoder; BE-C).

### E.2 DO-F: backup, restore and the A19 drill (devops-engineer; W8; after ARCH-03 and BE-E)

**Creates:**

| File | Purpose |
| --- | --- |
| `deploy/scripts/backup.sh` | ADR-0066 §1–§4, §6: snapshot-consistent `pg_dump -Fc` and table counts, evidence copy-out through BE-E's CLI, retention sets, `config/` without secret values, manifest `mth-backup/1`, checks, `backup_set_record()` |
| `deploy/scripts/restore.sh` | ADR-0066 §7–§8: package checks, same major, fresh target only, `pg_restore --single-transaction --no-owner --role=mth_owner`, evidence copy-in, R1–R8, `restore-report.json` |
| `deploy/scripts/restore-drill.sh` | ADR-0066 §9: demo → backup → fresh project → restore → R1–R9 → `drill-report.json` with timings |
| `deploy/scripts/tests/backup-restore.test.mjs` (`node --test`, against `with-pg.sh`) | T-E1…T-E9 |
| `docs/handover/backup-restore.md` | scope, schedule example, set layout, restore steps, checks table R1–R9, measured drill timings, RPO/RTO "to agree with Mobily IT", secrets to provide by name, cross-major note |

**Modifies:** `deploy/compose/compose.yaml`: the `backup` service under `profiles: ["backup"]` on the pinned `postgres:18` image (no new image; `images.lock.json` unchanged).

**Needs from BE-E (handback O1):** `transfer-attachments copy-out --to <dir> --out <attachments.json>` beside `copy-in` and `verify`. If BE-E has merged without it, DO-F requests it; DO-F does not edit BE-E's files.

### E.3 DO-G: dry run, migration catalogue, upgrade guide (devops-engineer; W7; after ARCH-03; `cli.ts` after BE-D)

**Creates:** `packages/db/src/dry-run.ts` (ADR-0068 §1–§2), `packages/db/test/integration/dry-run.test.ts` (T-E30…T-E33), `tools/release/migration-catalogue.mjs` and `tools/release/migration-catalogue.overrides.json` (ADR-0068 §3), `tools/release/migration-catalogue.test.mjs` (T-E34…T-E36), the generated `docs/handover/migration-catalogue.json`, `docs/handover/upgrades.md` (ADR-0068 §4, with the generated catalogue table).

**Modifies:** `packages/db/src/cli.ts`: the `--dry-run` option of `migrate` and its usage line only.

### E.4 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-E1 | `backup-restore.test.mjs` | a set has exactly the ADR-0066 §1 layout; `schemaVersion` `mth-backup/1`; every listed file's SHA-256 matches |
| T-E2 | same | `table-counts.tsv` equals counts taken in the dump's snapshot (a row inserted during the dump is in neither) |
| T-E3 | same | `config/` contains no secret value (canary values in the environment file are absent; keys are present) |
| T-E4 | same | a changed byte in any file → restore exit 2 naming the file; the target stays empty |
| T-E5 | same | a manifest with another `server.major` → exit 2 with the E.5 line |
| T-E6 | same | a non-empty target database or evidence store → exit 2; nothing written |
| T-E7 | same | a restore into a fresh local cluster passes R1–R8 (same major) and writes `restore-report.json` with every step's seconds |
| T-E8 | same | a failing step records a `failed` set with its reason through `backup_set_record()` |
| T-E9 | same | the `backup_set_record()` argument has exactly the 19 keys of ADR-0066 §6 |
| T-E10 | `retention/classes.test.ts` | the list shows every class and every table exactly once; a class with no period shows `periodDays: null` |
| T-E11 | same | `updateRetentionClass`: each 422 code of E.5; 409 on a stale If-Match; 428 without one; audit with before/after |
| T-E12 | same | 403 for every role without `retention.configure` (AUD, ADM_ACCESS included); reads for ADM_TECH, ADM_ACCESS, AUD only |
| T-E13 | `retention/runs.test.ts` | 422 `retention.run_in_progress` while a run is queued or running; Idempotency-Key replay returns 200 with the same run |
| T-E14 | `retention-archive.test.ts` | **A19/A22:** with test periods on synthetic rows, a run archives **only** records past retention (rows 1 day younger than the period stay unmarked and live), and writes one action row and one audit event per action |
| T-E15 | same | a dry run writes `would_*` rows only: no archive set object, no marker, no delete, row counts unchanged |
| T-E16 | same | exactly once: the job delivered twice for one run archives each record once; a second run never re-archives a marked record |
| T-E17 | same | the archive set: `manifest.json` (`mth-retention-archive/1`), NDJSON per table in the ADR-0064 encoding, SHA-256 equal to `archive_set_sha256`; written before any marker (a store failure leaves no marker and fails the run) |
| T-E18 | same | `archive_then_purge` on `processed_message`: archived then deleted; an inbox item referenced by a delivery: `skipped_referenced`, kept, read-only |
| T-E19 | same | a class with action `retain` is never touched; business, audit and snapshot tables never appear in any action |
| T-E20 | `retention/backups.test.ts` | `listBackupSets`: newest first, no content field, 403 without `backup.read` |
| T-E21 | `p7-exercises-be-g.ts` | each of the 10 operations is exercised and validates against the contract |
| T-E22 | `retention-archive.test.ts` | the job's service identity is `job:retention.archive`; the shipped schedule is disabled |
| T-E23 | `apps/web/src/pages/admin/retention/*.test.tsx` | "Not set (IT to agree)" for a NULL period, never 0; the reference field is labelled as a reference, never as an approval |
| T-E24 | same | EN and AR texts of E.6; RTL layout in Arabic |
| T-E25 | `apps/web/e2e/p7-retention.spec.ts` (FE-D) | axe, keyboard, 360 px |
| T-E30 | `dry-run.test.ts` | on a restored DG6-level copy (0001–0130), the report lists exactly the later files with their catalogue class and seconds |
| T-E31 | same | the diff shows the P7 tables (`retention_class`, `backup_set`, …) and their grants |
| T-E32 | same | the copy's `schema_migration` is unchanged after the dry run, and the throw-away database is dropped (also after a failing migration) |
| T-E33 | same | a production-marked copy without the confirmation flag → exit 2, nothing created |
| T-E34 | `migration-catalogue.test.mjs` | every file `0001`–last has exactly one entry with its id and SHA-256; the committed output equals a fresh generation |
| T-E35 | same | scanner fixtures: each destructive and data-rewrite pattern classifies; an `UPDATE` inside a `$$` body does not |
| T-E36 | same | every override has a reason of at least 20 characters and never lowers a class |
| (done) | `p7-retention-guards.test.ts` | the database half of T-E14/T-E18/T-E19 and of ADR-0066 §6 (15 tests) |

### E.5 Exact texts

**Problem codes** (`apps/web/src/i18n/{en,ar}/problems.json`, keys with `.` written `__`; FE-A adds them; the Arabic is **provisional** until a qualified reviewer checks it, D-243 Q7):

| Code | Status | English | Arabic (provisional) |
| --- | --- | --- | --- |
| `retention.class_retain_only` | 422 | Records of this class are always kept. Only operational classes can be archived or purged. | تُحفظ سجلات هذه الفئة دائماً. لا يمكن أرشفة أو حذف إلا الفئات التشغيلية. |
| `retention.class_not_archivable` | 422 | This class cannot use this action: a table in it has no age date, or cannot be purged. | لا يمكن استخدام هذا الإجراء مع هذه الفئة: أحد جداولها بلا تاريخ عمر أو لا يمكن حذفه. |
| `retention.class_period_required` | 422 | Enter the retention period agreed with IT before enabling this action. | أدخل مدة الاحتفاظ المتفق عليها مع تقنية المعلومات قبل تفعيل هذا الإجراء. |
| `retention.class_reference_required` | 422 | Enter the reference of the IT approval (for example a change ticket) before enabling this action. | أدخل مرجع موافقة تقنية المعلومات (مثل رقم طلب التغيير) قبل تفعيل هذا الإجراء. |
| `retention.run_in_progress` | 422 | A retention run is already queued or running. Wait for it to finish. | توجد عملية احتفاظ قيد الانتظار أو التنفيذ. انتظر حتى تكتمل. |

**Audit actions:** `retention_class.updated`; `retention_run.requested`, `.started`, `.succeeded`, `.failed`; `retention.archived`, `retention.purged`, `retention.skipped` (one per action row); `backup.recorded` (written by `backup_set_record()`).

**Script lines** (operator-facing, English; the guide gives the Arabic summary, D-243 Q7):

| Script | Exit | Line |
| --- | --- | --- |
| `backup.sh` | 0 | `backup: set <label> succeeded: <bytes> database bytes, <n> evidence objects; manifest sha256 <hex>` |
| `backup.sh` | 1 | `backup: set <label> failed: <reason>` |
| `restore.sh` | 2 | `restore: refused: unsupported backup schema version '<v>'` |
| `restore.sh` | 2 | `restore: refused: checksum mismatch for <file>` |
| `restore.sh` | 2 | `restore: refused: backup is from PostgreSQL <m>, target is <n>; a cross-major restore is an upgrade (dump with the newer client), see upgrades.md` |
| `restore.sh` | 2 | `restore: refused: the target database is not empty` / `restore: refused: the target evidence store is not empty` |
| `restore.sh` | 1 | `restore: check <R#> failed: expected <x>, got <y>` |
| `restore.sh` | 0 | `restore: <label> restored and ready in <s> s; all checks passed` |
| `mth-db migrate --dry-run` | 0 | `mth-db migrate --dry-run: <n> pending migration(s) applied to a throw-away copy in <s> s; the source is unchanged` |
| `mth-db migrate --dry-run` | 1 | `mth-db migrate --dry-run: <name> failed: <error>; <k> not attempted; the source is unchanged` |
| `mth-db migrate --dry-run` | 2 | `mth-db migrate --dry-run: refused: this database is marked production; run it on a restored copy and pass --i-confirm-this-is-a-restored-copy` |

### E.6 Screen texts (FE-C; Administration > Retention; `apps/web/src/i18n/{en,ar}/retention.json`; the Arabic provisional)

| Key | English | Arabic (provisional) |
| --- | --- | --- |
| `title` | Retention | الاحتفاظ بالبيانات |
| `intro` | Each record class has a retention action. Every class starts as "Keep". Business records, audit and snapshots are always kept. Periods must be agreed with Mobily IT. | لكل فئة سجلات إجراء احتفاظ. تبدأ كل فئة بإجراء "الاحتفاظ". تُحفظ سجلات الأعمال وسجل التدقيق واللقطات دائماً. يجب الاتفاق على المدد مع تقنية المعلومات في موبايلي. |
| `action.retain` / `archive` / `archive_then_purge` | Keep / Archive / Archive, then delete | الاحتفاظ / الأرشفة / الأرشفة ثم الحذف |
| `period.notSet` | Not set (IT to agree) | غير محددة (يُتفق عليها مع تقنية المعلومات) |
| `period.days` | {{count}} days | {{count}} يوماً |
| `reference.label` | IT approval reference | مرجع موافقة تقنية المعلومات |
| `reference.help` | Record the reference of the approval Mobily IT gave outside this platform, for example a change ticket. Saving it does not approve anything. | سجّل مرجع الموافقة التي منحتها تقنية المعلومات في موبايلي خارج هذه المنصة، مثل رقم طلب التغيير. حفظه لا يعني الموافقة على أي شيء. |
| `managedByJob` | Removed automatically when expired | تُزال تلقائياً عند انتهاء صلاحيتها |
| `effect.inbox` | Archived read notifications can no longer be marked unread. With "Archive, then delete" they disappear from the inbox. | لا يمكن إعادة الإشعارات المقروءة المؤرشفة إلى غير مقروءة. ومع "الأرشفة ثم الحذف" تختفي من صندوق الوارد. |
| `run.dryRun` / `run.run` | Dry run / Run now | تشغيل تجريبي / تشغيل الآن |
| `run.dryRunHelp` | Shows what a run would archive or delete. Nothing is changed. | يعرض ما ستؤرشفه العملية أو تحذفه دون تغيير أي شيء. |
| `run.status.queued` / `running` / `succeeded` / `failed` | Queued / Running / Succeeded / Failed | في الانتظار / قيد التنفيذ / نجحت / فشلت |
| `actions.title` | Actions in this run | إجراءات هذه العملية |
| `archived.title` | Archived records | السجلات المؤرشفة |
| `archived.kept` | Kept (read-only) | محفوظ (للقراءة فقط) |
| `backups.title` | Backup sets | مجموعات النسخ الاحتياطي |
| `backups.readOnly` | Backups and restores are run by IT with the backup scripts. This list is read-only. | تنفّذ تقنية المعلومات النسخ الاحتياطي والاستعادة باستخدام نصوص النسخ. هذه القائمة للقراءة فقط. |
| `backups.none` | No backup set has been reported yet. | لم يُبلَّغ عن أي مجموعة نسخ احتياطي بعد. |

### E.7 Seams with other slices

| Seam | Rule |
| --- | --- |
| **Attachment manifest → C (BE-E)** | ADR-0066 reuses `attachments.json` (`mth-attachment-manifest/1`) and BE-E's CLI; it needs `copy-out` (O1). |
| **Encoder → C (BE-C)** | The archive set uses `packages/db/src/transfer/export.ts`'s row encoding; BE-G imports it, never copies it. |
| **Migration export ↔ retention** | `transfer_table_rule` gets no row from retention; the retention tables are exported like any business table (they are not in `transfer_table_rule`), so an import carries the run history. |
| **Every later migration** | A migration that creates a table adds its `retention_table_class` row in the same file (class `business_record` unless an ADR says otherwise), or the catalogue test fails. This applies to BE-C, BE-D, BE-F and every later stage. |
| **Module registry → BE-A** | BE-A registers the module `retention` with the stubs `retention/{classes,runs,backups}/routes.ts` and the worker stub `apps/worker/src/handlers/retention/index.ts`. `retention` imports no domain module except `evidence` (the port). |
| **Guides → H (DOC-A, DOC-B, DOC-C)** | DOC-A's admin guide covers the Retention screen (E.6) including the inbox effect; DOC-C's automation guide the job, identity and disabled schedule; DOC-B's index links `backup-restore.md` and `upgrades.md` (D-247 O5). |
| **A19 → QA-A, QA-C** | QA-A writes `tests/qa/integration/a19-*.test.ts` from the acceptance text (restore recovers database, evidence, audit, snapshots and job state; checks R1–R8; timings recorded); QA-C re-runs it and the orchestrator runs the container drill (D-243 Q1). |

### E.8 Integration order

1. ARCH-03 merged (this revision).
2. BE-A (W4): module `retention`, stubs.
3. BE-G (W5): `0147`, routes, job (after BE-C's encoder; if BE-C is not merged, BE-G lands the job with the archive writer behind an interface and switches to the encoder in the same wave, stated in its handback).
4. DO-G (W7): dry run (`cli.ts` after BE-D), catalogue, upgrade guide; QA-A (W7): A19 harness.
5. DO-F (W8): backup, restore, drill (after BE-E).
6. FE-C (W9), DOC-A/DOC-C (W8–W10), QA-C (W12).

### E.9 Requirement → clause → test → owner

| Requirement | Clause (acceptance text) | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S16-024 | "the retention configuration lists every record class" | catalogue "every public base table has exactly one retention class" (done); T-E10 | solution-architect; BE-G |
| REQ-S16-024 | "an archival job run on test data archives only records past retention" | T-E14, T-E19; probe "a record that is not past retention can never be marked archived" (done) | BE-G |
| REQ-S16-024 | "and logs each action" | T-E14 (one action row and one audit event per action), T-E15 (dry run logs `would_*`); probe "an unaudited action cannot commit" (done) | BE-G |
| REQ-S16-024 | "Retention periods must be agreed with Mobily IT; defaults are placeholders" / "Approver" | class registry test (all `retain`, period NULL; done); T-E23; T-E11 (period and reference required) | solution-architect; BE-G; FE-C |
| REQ-S16-024 | M0329 "soft deletion is not a substitute" / D-243 Q3 nothing purged in business, audit, snapshot | probe "business, audit and snapshot classes can never leave 'retain'", "purge refuses … any business table" (done); T-E19 | solution-architect; BE-G |
| REQ-S19-012 | "the restore drill recovers the database" | T-E7 (R2, R3), the A19 drill | DO-F; QA-C |
| REQ-S19-012 | "evidence" | T-E7 (R7), T-E4 | DO-F; BE-E |
| REQ-S19-012 | "audit" | T-E7 (R4) | DO-F |
| REQ-S19-012 | "snapshots" | T-E7 (R5) | DO-F |
| REQ-S19-012 | "and job state" | T-E7 (R6) | DO-F |
| REQ-S19-012 | "with documented checks and timings" | T-E7 (`restore-report.json`), `backup-restore.md` R1–R9 and drill timings | DO-F |
| REQ-S19-012 | M0360 "configuration" / "recovery objectives to be agreed with IT" | T-E3; the guide's RPO/RTO placeholders | DO-F |
| REQ-S19-013 | "a dry-run migration on a restored copy reports its changes" | T-E30, T-E31, T-E32 | DO-G |
| REQ-S19-013 | "the guide identifies each irreversible migration and its backup-based recovery" | T-E34, T-E35, T-E36; `upgrades.md` | DO-G |
| REQ-S19-013 | "tested by upgrading a restored copy from the previous release" | T-E30 then the real `migrate` on the copy (ADR-0068 §5) | DO-G |
| REQ-S20-019 | "Restore drill recovers database, evidence, audit, snapshots and job state with documented checks and timings" | `tests/qa/integration/a19-*.test.ts` (QA-A), re-run by QA-C; the orchestrator's container drill | QA-A; QA-C; orchestrator |

### E.10 What the implementers must know

- **Never** grant DELETE on any table to `mth_app`, and never call `EvidenceStore.delete`. The only delete path is `retention_purge_record()`.
- `record_age_at` must equal the row's age exactly: read it as text in SQL. A JavaScript `Date` drops microseconds and the marker is refused.
- No agent or test writes a real IT reference. Tests use texts beginning `TEST-ONLY`. No class is shipped enabled.
- A NULL period is shown as "Not set (IT to agree)", never as 0 or as a default number.
- Every new table needs its `retention_table_class` row in its own migration (E.7).
- Backups and restores run outside the API. No route starts one.

## §B. Slice B: clean deployment, offline runtime and the A18 transfer drill (T-DG7-ARCH-04; ADR-0069)

### B.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0069-p7-clean-deployment-base-url-readiness-transfer-offline-image-drills.md`.
- **No migration.** `0150`–`0152` stay free. None is expected from slice B's implementers either, because slice B adds no table. A migration a slice B implementer still needs takes the next free id above the highest shipped one (D-245 O9, D-248 O8).
- **No permission code.** `getDeploymentStatus` uses the P6 code `operations.read` (ADR-0069 §3; permissions matrix §32). `P7_PERMISSIONS` is unchanged.
- **Contract** (`docs/api/openapi.yaml`, `1.6.0-p7`, 962 operations):
  - the tag `deployment`;
  - `getReadiness` gains its description and the optional `checks.storage` (`ok|fail|unknown`) and `checks.worker` (`alive|stale|unknown`);
  - `GET /api/v1/admin/deployment` `getDeploymentStatus` with the schema `DeploymentStatus`.

  `pnpm openapi:lint` passes. Related files: the `p7-operations.ts` block, `p7-pending-arch-04.ts`, `p7-pending-be-b.ts` (`["getDeploymentStatus"]`), the aggregate `p7-pending.ts` import line, and the `contract.test.ts` count pin 962 with its comment line.
- **Advisory locks:** 730416–730417 reserved, none allocated (registry comment in `apps/api/src/modules/platform/advisory-locks.ts`, ADR-0016 §6 row).
- **ERD** §1ae, **data dictionary** "P7 slices B and F", **permissions matrix** §32.
- **Measured fact:** `bwrap --unshare-net` keeps loopback up; `unshare --net` does not, and `ip` is absent (`docs/delivery/handbacks/DG7/T-DG7-ARCH-04-evidence/netns-loopback.txt`). Every slice B drill uses `bwrap`.

### B.1 BE-B: readiness and the deployment status (backend-workflow; W6; after ARCH-04 and BE-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/evidence/readiness.ts` | `probeEvidenceStorage(db)`: resolve the effective store (ADR-0054 §2). **filesystem:** `stat` is a directory, `access(R_OK \| W_OK)`; **s3:** `head("mth-readiness-probe")` with a 2 000 ms timeout; a missing or incomplete setting gives `fail`. Returns `{ status: "ok" \| "fail", driver, source }` and never an endpoint or error text. The result is cached 5 s per process. No pool client is held during the S3 call. |
| `apps/api/src/modules/platform/deployment.ts` | `registerDeploymentRoutes(app, pool, files, probes)`: `getDeploymentStatus` (access `operations.read`; ADR-0069 §3). It builds the body from `config.appBaseUrl`, the API's `package.json` version (the worker's `appVersion()` rule), `info.version` of the served contract, `migrationStatus`, the readiness evaluation shared with `/readyz`, `deployment_environment` and the heartbeat reader. |
| `apps/api/test/integration/platform/readiness-storage-worker.test.ts` | T-B2 |
| `apps/api/test/integration/platform/deployment-status.test.ts` | T-B4, T-B5, T-B6 |
| `apps/api/test/integration/contract/p7-exercises-be-b.ts` | T-B7 |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `apps/api/src/modules/platform/health.ts` | `registerHealthRoutes(app, pool, files, probes)` with `probes: { storage(db), worker(db) }`. It evaluates `storage` and `worker` only when `database` is `ok` (otherwise both are `unknown`). Ready means `database`, `migrations` and `storage` are all `ok`. Both keys are always sent. One `warn` log line per storage state change (B.3). |
| `apps/api/src/modules/platform/health.test.ts` | T-B1 |
| `apps/api/src/modules/platform/index.ts` | the `registerDeploymentRoutes` export line |
| `apps/api/src/server.ts` | the `registerHealthRoutes` call (l.484) passes the two probes (`probeEvidenceStorage`, and the heartbeat status from `operations/heartbeat.ts` `readWorkerHeartbeat`); one `registerDeploymentRoutes` line; the sub-path warning (B.3) once at build when `config.appBaseUrl.pathname !== "/"` |
| `apps/api/src/server.test.ts` | T-B8 (only the readiness lines) |
| `apps/api/test/integration/contract/contract.test.ts` | the import and the `it(...)` hook for `p7-exercises-be-b.ts` (the P6 pattern) |
| `apps/api/test/support/p7-pending-be-b.ts` | removes `getDeploymentStatus` in the change that routes and exercises it; empty at the end |
| `docs/operations/health-readiness.md` | the `storage` and `worker` keys, which one gates, and the vocabulary (B.3 text) |

**Reads only:** `apps/api/src/modules/evidence/store.ts` and `stores/**` (the port and the adapters), `apps/api/src/modules/operations/heartbeat.ts`, `packages/db/src/migrate.ts`.

**Boundary:** `platform` imports no domain module (ADR-0002). The evidence and operations functions are passed in from `server.ts`. If `architecture.test.ts` refuses the `evidence/readiness.ts` → `evidence/store.ts` import, that is the module's own import and allowed; anything else goes to the orchestrator.

### B.2 DO-D: the transfer drill (devops-engineer; W10; after BE-B, BE-D, BE-E, BE-F, DOC-B)

**Creates:**

| File | Purpose |
| --- | --- |
| `deploy/scripts/transfer-drill.sh` | ADR-0069 §4 D0–D11. Enters one `bwrap --dev-bind / / --unshare-net` namespace, runs the probe first, takes ports from the pool, and uses the exit codes of §2 rule 4. |
| `deploy/scripts/drill/fake-idp-server.mjs` | starts the P6 fake OP (`apps/api/test/support/fake-idp.ts`) on `127.0.0.1` with a synthetic issuer, client and users. It prints its issuer and the users' subjects as JSON. Drill-only, never in the runtime tree. |
| `deploy/scripts/drill/journey.mjs` | the D8 journey in mode `oidc-drill` (follows the redirect to the drill IdP, then runs the A02 steps that write, the approval decision, the evidence downloads with SHA-256 comparison, the source-origin 403, and the deep-link open) |
| `deploy/scripts/drill/origin-scan.mjs` | D10: scans every `text`, `varchar` and `jsonb` column of every public table for the source origin; `audit_event` hits are listed, any other hit fails |
| `deploy/scripts/drill/config-trace.mjs` | D3: fills `.env.example` keys only from `deploy/scripts/drill/guide-keys.json` (key → `docs/handover/deployment.md` section anchor). An anchor missing from the guide, or a key the target needs that is not in the map, fails as an undocumented step |
| `deploy/scripts/drill/guide-keys.json` | the key → guide-section map (DOC-B's anchors) |
| `deploy/scripts/tests/transfer-drill.test.mjs` | T-B3, T-B9, T-B10 |

**Does not modify:** `deploy/scripts/smoke.mjs`, `clean-start-local.sh`, `compose.yaml`. The plan's `compose.transfer.yaml` overlay is **not** created: the container half of the transfer is not in D-243 Q1's orchestrator list, and the different origin is proven container-free. If the orchestrator wants a Compose overlay with another origin for its host run, DO-D writes it on request.

**Report:** `--out` = DO-D's handback evidence directory (`T-DG7-DO-D-evidence/transfer/`). It holds `transfer-drill-report.json`, `config-trace.json`, `reconcile-*.json`, `origin-scan.json` and `drill.log`.

### B.3 DO-E: the offline drill and the image bundle (devops-engineer; W11; after DO-D)

**Creates:** `deploy/scripts/offline-drill.sh` (ADR-0069 §5), `deploy/scripts/image-bundle.sh` (§6: `save`, `load`, `verify`), `deploy/scripts/tests/image-bundle.test.mjs` (T-B12, with a stub `docker` on `PATH`), and `deploy/scripts/tests/offline-drill.test.mjs` (T-B13's connection-log check on fixtures).

**Modifies:** `docs/operations/restricted-network.md` (the image half: `image-bundle.sh save` on a connected host, transfer, `load`, then `up --pull never`), and `docs/delivery/environment.md` (the P7 rows: the transfer, offline and image drills, and their split; p7-plan §5.3).

**Hands to the orchestrator:** the exact command list of ADR-0069 §6–§7 for its host run, in its handback.

### B.4 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-B1 | `health.test.ts` | storage `fail` → 503 `not_ready` with `storage: fail`; storage `ok` + worker `stale` or `unknown` → 200 `ready` (the worker never gates); database `fail` → `storage: unknown`, `worker: unknown`, no probe called; both keys are always present |
| T-B2 | `readiness-storage-worker.test.ts` (real PostgreSQL; the fake S3 of P6) | filesystem root missing or read-only → `fail`; S3 reachable → `ok`; fake S3 stopped → `fail` within 2 500 ms; an incomplete S3 setting → `fail`; two `/readyz` calls within 5 s → one probe; the body and the log line contain no endpoint, bucket, path or SecretRef name; heartbeat ≤ 90 s → `alive`, older → `stale`, none → `unknown` |
| T-B3 | `transfer-drill.test.mjs` | `origin-scan.mjs` on a fixture database: the origin in a `text` column fails; in a `jsonb` value fails; in `audit_event` only → listed, pass |
| T-B4 | `deployment-status.test.ts` | the body validates against `DeploymentStatus`; `origin` and `basePath` match `APP_BASE_URL`; `schema.latestApplied` equals the highest file; 200 for ADM_TECH, TO, KDS, TD and AUD; 403 for SP, TL, BO, WL, FIN, CM, SEC, ADM_METHOD and ADM_ACCESS; 401 without a session |
| T-B5 | same | with an S3 setting holding canary endpoint, bucket and SecretRef names, none of them appears in the body |
| T-B6 | same | `APP_BASE_URL=http://127.0.0.1:<p>/hub/` → the API starts, logs the B.5 warning exactly once, and reports `basePath: "/hub/"` |
| T-B7 | `p7-exercises-be-b.ts` | `getDeploymentStatus` is exercised and validated; `getReadiness` 200 and 503 bodies with the new keys validate (`response-validation.test.ts`) |
| T-B8 | `server.test.ts` | the server built by `buildServer` wires the real probes: a filesystem store in the test configuration → `storage: ok`; no beat → `worker: unknown`; 200 |
| T-B9 | `transfer-drill.test.mjs` | `config-trace.mjs`: a key outside the map, or an anchor absent from a fixture guide, fails with the B.5 line; without `bwrap` (stub `PATH`) → exit 3; a probe that connects → exit 1 with the B.5 line; the report has `schemaVersion` `mth-transfer-drill/1` and `result` `PASS` only when every step passed |
| T-B10 | same | the journey signs in through the drill IdP under `NODE_ENV=production`, `AUTH_MODE=oidc`; a write with the source origin in `Origin` is refused 403; an unbound user's sign-in is refused |
| T-B11 | the drill run (DO-D; QA-C re-run) | D0–D11 pass on the merged tree, in the namespace with no network |
| T-B12 | `image-bundle.test.mjs` | `save` lists every `images.lock.json` image plus the app image with tar SHA-256; `load` refuses a changed tar (exit 1, no `docker load` call); `verify` refuses an id mismatch; the stub records no `docker pull` in any path |
| T-B13 | `offline-drill.test.mjs`, then the offline run (DO-E; QA-C re-run) | a fixture log line with a non-loopback address fails the check; the run: the lifecycle specs pass in the namespace and `connections.ndjson` holds loopback and socket entries only |
| T-B14 | DOC-B (the guide check of ADR-0072) | `deployment.md` holds the HA statement, the sub-path limitation, the redirect URIs, the Compose service → role map, the external dependency "orchestration target", and every anchor that `guide-keys.json` names |

### B.5 Exact texts

Operator-facing log and script lines are English. The guides give the Arabic summary (D-243 Q7).

| Where | Exit or level | Line |
| --- | --- | --- |
| API start (`server.ts`) | warn | `config: APP_BASE_URL has the path '<path>'; serving under a sub-path is not supported, so the hub is served from the origin root (see the deployment guide)` |
| `/readyz` (`health.ts`) | warn, once per change | `readiness: evidence storage (<driver>) did not answer the probe: <error code>` |
| `/readyz` (`health.ts`) | info, once per change | `readiness: evidence storage (<driver>) answers again` |
| `transfer-drill.sh` | 3 | `transfer-drill: BLOCKED: no network namespace with loopback (bwrap unavailable)` / `transfer-drill: BLOCKED: PostgreSQL server binaries not found (set PGBIN)` |
| `transfer-drill.sh` | 1 | `transfer-drill: network isolation is not effective` |
| `transfer-drill.sh` | 1 | `transfer-drill: step <Dn> failed: <reason>` |
| `transfer-drill.sh` | 1 | `transfer-drill: undocumented step: the target needs <KEY>, which no section of docs/handover/deployment.md names` |
| `transfer-drill.sh` | 1 | `transfer-drill: the source origin <origin> was found in <table>.<column> (<n> rows)` |
| `transfer-drill.sh` | 0 | `transfer-drill: PASS in <s> s: <t> tables and <n> evidence files equal, origin <origin>, restart verified; report <path>` |
| `offline-drill.sh` | 3 | `offline-drill: BLOCKED: no installed Chromium for Playwright (it is never downloaded)` |
| `offline-drill.sh` | 1 | `offline-drill: connection outside loopback: <address>:<port> by <process>` |
| `image-bundle.sh` | 1 | `image-bundle: <image> does not match images.json (<field>)` |
| `image-bundle.sh` | 3 | `image-bundle: BLOCKED: docker daemon not reachable` |
| drill report | label | `synthetic drill IdP (not a corporate IdP)` |

**Guide texts** (DOC-B, `docs/handover/deployment.md` and its Arabic summary page; the Arabic is **provisional** until a qualified reviewer checks it, D-243 Q7):

| Key | English | Arabic (provisional) |
| --- | --- | --- |
| HA statement | Compose is a reproducible install and test configuration, not evidence of high-availability readiness. | إن Compose إعداد قابل للتكرار للتثبيت والاختبار، وليس دليلاً على الجاهزية للتوافر العالي. |
| Sub-path | The hub is served from the root of its origin. Serving it under a sub-path (for example https://host/hub/) is not supported in this release. | تُقدَّم المنصة من جذر نطاقها. تقديمها تحت مسار فرعي (مثل https://host/hub/) غير مدعوم في هذا الإصدار. |
| Origin change | After a move to another address, register the new sign-in redirect address with the identity provider: <origin>/api/v1/auth/callback. | بعد النقل إلى عنوان آخر، سجّل عنوان إعادة التوجيه الجديد لتسجيل الدخول لدى مزوّد الهوية: <origin>/api/v1/auth/callback. |
| Readiness | Readiness needs the database, the migrations and the evidence storage. The worker status is shown but does not stop the service from being ready. | تتطلب الجاهزية قاعدة البيانات والترحيلات وتخزين الأدلة. تُعرض حالة العامل الخلفي لكنها لا تمنع الخدمة من أن تكون جاهزة. |
| Orchestration target | Deployment configuration for Mobily's orchestration platform is to be written when IT names the target. This release ships no such configuration. | تُكتب إعدادات النشر لمنصة التشغيل في موبايلي عندما تحدد تقنية المعلومات المنصة المستهدفة. لا يتضمن هذا الإصدار مثل هذه الإعدادات. |

### B.6 Seams with other slices

| Seam | Rule |
| --- | --- |
| **Archive → A (DO-A)** | D0 uses `build-archive.mjs --verify` and `build-from-archive.sh` unchanged (ADR-0062 §4–§5). |
| **Migration package → C (BE-C, BE-D, BE-E)** | D2, D5, D6 call `tools/migration/{export,import,reconcile}.mjs`, `transfer-attachments copy-out|copy-in|verify` and `mth-db rebind-identity` as ADR-0064 and D-248 O1 fix them. DO-D changes none of them; a gap goes in its handback. |
| **Configuration → D (BE-F)** | Configuration moves inside the migration package in D5. The bundle path (REQ-S19-008) is QA-B's A06 replay, not this drill. |
| **Backup and dry run → E (DO-F, DO-G)** | Not used by the transfer drill. A19 is DO-F's drill. The deployment guide links both. |
| **Deployment guide → H (DOC-B)** | DOC-B owns the anchors that `guide-keys.json` cites. DO-D requests a missing anchor through its handback; it never edits the guide. |
| **Readiness → every drill** | D7 and D9 (transfer), the Compose healthcheck (orchestrator) and A19's R checks (DO-F) all read `/readyz` with the B.1 semantics. |
| **Heartbeat → P6 operations** | Read through `readWorkerHeartbeat` only; no change to `heartbeat.ts`. |
| **A18 → QA-A, QA-C** | QA-A writes `tests/qa/integration/a18-*.test.ts` from the acceptance texts: it runs `transfer-drill.sh` and asserts the report fields of B.4. QA-C re-runs it and the offline drill into `test-evidence/DG7/qa/{transfer,offline}/`. |
| **Container halves → orchestrator** | ADR-0069 §6–§7, on its host, logs under `test-evidence/DG7/orchestrator/`. |

### B.7 Integration order

1. ARCH-04 merged (this revision).
2. BE-B (W6): readiness, deployment status (after BE-A's registry).
3. QA-A (W7): the A18 harness, which fails until DO-D lands.
4. DOC-B (W9): the deployment guide with the anchors.
5. DO-D (W10): the transfer drill (after BE-D, BE-E, BE-F and DOC-B).
6. DO-E (W11): the offline drill and the image bundle; the orchestrator's host run follows.
7. QA-C (W12): the independent re-runs.

### B.8 Requirement → clause → test → owner (drill split per D-243 Q1: A = agent, O = orchestrator host)

| Requirement | Clause (acceptance text) | Test(s) | Where | Owner |
| --- | --- | --- | --- | --- |
| REQ-S01-001 | "the guided end-to-end scenario completes on a persisted database using only native workflows" | A02 re-run (QA-B); D1 and D8 journeys | A | QA-B; DO-D |
| REQ-S01-001 | "the package installs and runs in a clean environment without builder-hosted services" | T-B11 (D0 build from the archive, D3–D9 in the namespace with no network); §7 Compose up | A; O | DO-D; QA-C; orchestrator |
| REQ-S01-006 | "a clean environment with a different base URL starts from the package" | T-B11 D3, D7 (`getDeploymentStatus.origin`); T-B6 (`basePath`); T-B3 and D10 (no stored source origin) | A | DO-D; BE-B |
| REQ-S01-006 | "runs key workflows with outbound public internet disabled" | T-B11 D8 (inside `bwrap --unshare-net`, probe asserted); T-B13; the no-egress Compose run | A; O | DO-D; DO-E; orchestrator |
| REQ-S01-006 | "no builder or personal credentials configured" | T-B9 (`config-trace.json`: template keys only, synthetic generated secrets); ADR-0063 template check | A | DO-D; DO-B |
| REQ-S16-008 | "docker compose up on a clean host reaches ready health checks" | §7 Compose up with `--pull never --wait`, `docker compose ps` all healthy, `/readyz` body | O | orchestrator |
| REQ-S16-008 | "the docs state the HA limitation" | T-B14; `docs/operations/README.md` l.8 (exists) | A | DOC-B |
| REQ-S16-008 | title: "deployment configuration for the actual IT orchestration target when known" | T-B14 (the guide records it as an external dependency; D-243 Q12, no manifests) | A | DOC-B |
| REQ-S19-009 | "a clean deployment configured only from the template and guides starts successfully" | T-B9, T-B11 D3 and D7 | A | DO-D; DOC-B |
| REQ-S19-009 | "the template contains no secret values" | ADR-0063 template check (exists, DO-B); `generate-env-example.mjs --check` | A | DO-B |
| REQ-S19-010 | "on a clean VM the documented command reaches ready state" | T-B11 D7; §7 Compose healthcheck | A; O | DO-D; orchestrator |
| REQ-S19-010 | "the readiness endpoint reports database, storage and worker status" | T-B1, T-B2, T-B7, T-B8 | A | BE-B |
| REQ-S19-017 | "the drill report shows matching counts and checksums" | T-B11 D5 and D9 (reconciliation reports) | A | DO-D |
| REQ-S19-017 | "working evidence downloads under the new base URL" | T-B11 D8 (a) and D9 (every file, SHA-256 equal) | A | DO-D |
| REQ-S19-017 | "successful key workflows" | T-B10, T-B11 D8 (b)–(d) | A | DO-D |
| REQ-S19-017 | "records, jobs and approvals intact after a full restart" | T-B11 D9 | A | DO-D |
| REQ-S19-017 | title: "rebind identity" | T-B10 (unbound refused), T-B11 D6 | A | DO-D; BE-D |
| REQ-S19-018 | "the lifecycle e2e suite passes with egress blocked" | T-B13; the no-egress Compose run with the smoke egress assertion | A; O | DO-E; orchestrator |
| REQ-S19-018 | "the image set loads on a host without registry access" | T-B12 (script logic); §6 save, remove, load, `up --pull never` | A; O | DO-E; orchestrator |
| REQ-S20-018 | "Clean environment starts successfully" | T-B11 D7; §7 | A; O | DO-D; orchestrator |
| REQ-S20-018 | "restored records/files/configuration work" | T-B11 D5, D8, D9 (configuration moves in the package: published versions and pins are among the reconciled tables, and D8 runs workflows on them) | A | DO-D |
| REQ-S20-018 | "workflows run without the original builder or mandatory public SaaS" | T-B11 inside the namespace; the drill IdP is synthetic and loopback | A | DO-D |
| REQ-S20-018 | A18 executable test (test level "ops drill") | `tests/qa/integration/a18-*.test.ts` (QA-A), re-run by QA-C | A | QA-A; QA-C |

### B.9 What the implementers must know

- Use `bwrap --dev-bind / / --unshare-net`, never `unshare --net`, for anything that needs loopback.
- The worker never gates readiness, and `unknown` is never reported as `alive` or `ok`.
- `/readyz` is public. Never put a path, endpoint, bucket, error text or SecretRef name in it, and none in `getDeploymentStatus` either.
- The drill IdP and every credential in the drill are synthetic, and the report says so. No agent configures or claims a corporate IdP.
- A drill step that cannot run is BLOCKED (exit 3) with its reason, never skipped and never counted as passed.
- No Kubernetes or other target manifest is written (D-243 Q12).

### B.6 DO-D2: complete and run the transfer drill (devops-engineer; repair; after BE-R1)

**What this is.** The repair task for DO-D's §4 gaps 3–6 and Q3 (D-258). It uses ADR-0064 Amendment 1 as BE-R1 builds it: the reserved target, the mode 1 and mode 2 rechecks, and the attachment report. It also uses the `OIDC_ISSUER_URL` loopback exception (T-R10). Then it runs T-B11 for real. The drill's design stays ADR-0069 §4; this section only fills in what DO-D left open. The numbering clash with "B.6 Seams with other slices" above is noted in T-DG7-ARCH-R2's handback. This section is referred to as "B.6 DO-D2".

**Modifies:**

| File | Exactly what |
| --- | --- |
| `deploy/scripts/transfer-drill.sh` | **D2:** `tools/migration/export.mjs --out <pkg>` only. The export already writes `attachments/` and `attachments.json` (BE-C, ADR-0064 §1), so `copy-out` is dropped, and D2 asserts that `attachments.json`'s count equals S's rows with a `storage_key`. **D5:** a fresh cluster T and an empty evidence directory; `tools/migration/prepare-target.mjs --from <pkg>` (**not** plain `mth-db migrate`); `tools/migration/import.mjs --from <pkg> --keep-reports <out>`; then `tools/migration/reconcile.mjs --from <pkg>` in mode 1, recorded as `reconcile-d5.json`. **D6:** after the rebind, mode 1 again (`reconcile-d6.json`, with the `rebind` delta). **D9:** mode 2 with the allowance below (`reconcile-d9.json`) and the job checks below. **D7:** asserts `getDeploymentStatus.origin` equals T's origin and `environmentKind` equals the package's `sourceEnvironment`. Each step records the guide section it follows (`migration-import` for D5 and D6). |
| `deploy/scripts/drill/journey.mjs` | Builds the steps DO-D reported as FAIL (gap 4): **D1** uploads at least two synthetic evidence files through the API on S, so D8 (a) is never vacuous. **D8 (b)** creates a transformation, records a KPI value, creates a RAID item, submits a gate, and has a **rebound** approver decide it. **D8 (d)** opens a deep link issued on T under T's origin. Every create and change appends `{table, key, op: "added"\|"changed", via}` to `journal.json`, with the key taken from the API response. Rows the worker derives (for example the KPI evaluation) are read back through the API and journalled the same way. |
| `deploy/scripts/tests/transfer-drill.test.mjs` | T-B10 now runs under `NODE_ENV=production` (it fails until BE-R1's loopback exception is merged), plus T-B15 and T-B16 below |
| `docs/handover/deployment.md`, `docs/handover/deployment.ar-summary.md` | one new section `## Moving an installation {#migration-import}` (exact text below), and its summary line. DOC-B's other sections are unchanged. |

**Creates:**

| File | Purpose |
| --- | --- |
| `deploy/scripts/drill/allowance.mjs` | Builds `mth-recheck-allowance/1` (ADR-0064 A1.9) from `journal.json`. It adds the `user_identity` keys of the users who signed in, resolved by (issuer, subject) on T, and the `app_user` keys only if T-B16 measures that a sign-in changes `app_user`. It never lists a table of `RECHECK_NEVER_OPERATIONAL` as operational. Its `operational` list is the minimum the run needs, each with a reason in `allowance-reasons.json`. |
| `deploy/scripts/drill/job-check.mjs` | The D9 job checks (gap 5); see "D9 jobs" below |

**D9 jobs (gap 5).** In this order:
1. Stop T's worker.
2. Request one report export through the API (`export_job`, ADR-0046), so it stays `queued`.
3. Snapshot, through `psql`:
   - `job_run` (count and highest id);
   - the enabled `job_schedule` rows (the §2.3 encoding);
   - the pg-boss job rows by queue and state. DO-D2 measures the schema and table names on T and records them in the report.
4. Stop the API and PostgreSQL, then start PostgreSQL, the API and the worker.
5. Check:
   - every enabled `job_schedule` row is equal;
   - the earlier `job_run` rows are unchanged; new rows are counted, never required to be zero;
   - the queued export reaches `succeeded` within 120 s, and its file downloads.
6. The approval rows are equal before and after, including D8's: `gate_decision`, `approval`, `approval_decision`, compared by count and by the encoder's digest.

**Exact guide text** (`docs/handover/deployment.md#migration-import`; the Arabic is **provisional**, D-243 Q7):

- **EN:** "To move an installation, prepare the target from the migration package before anything else runs on it: run `mth-db migrate --reserve-audit-seq-for <package>` on a new, empty database (not `mth-db migrate` alone), then `tools/migration/import.mjs --from <package> --operator <name>`, then `mth-db rebind-identity`, and only then start the API and the worker. A target migrated without the reservation is refused; create a new empty database and prepare it again."
- **AR (provisional):** "لنقل منصة، جهّز المنصة الهدف من حزمة الترحيل قبل تشغيل أي شيء عليها: نفّذ `mth-db migrate --reserve-audit-seq-for <package>` على قاعدة بيانات جديدة فارغة (وليس `mth-db migrate` وحده)، ثم `tools/migration/import.mjs --from <package> --operator <name>`، ثم `mth-db rebind-identity`، وبعد ذلك فقط شغّل واجهة البرمجة والعامل الخلفي. تُرفض المنصة الهدف التي رُحّلت دون هذا الحجز؛ أنشئ قاعدة بيانات جديدة فارغة وجهّزها من جديد."

**Script lines.** These add to B.5:

| Where | Exit | Line |
| --- | --- | --- |
| `transfer-drill.sh` | 3 | `transfer-drill: BLOCKED: <n> MB free under <dir>; the run needs at least <m> MB` |
| `transfer-drill.sh` | 1 | `transfer-drill: step D9 failed: <table> changed outside the allowance` |
| `transfer-drill.sh` | 1 | `transfer-drill: step D9 failed: the export queued before the restart did not complete within 120 s` |

**Tests:**

| Test | File | Proves |
| --- | --- | --- |
| T-B10 | `transfer-drill.test.mjs` | as in B.4, now under `NODE_ENV=production`, `AUTH_MODE=oidc`, with the drill IdP at `http://127.0.0.1:<p>` |
| T-B15 | `transfer-drill.test.mjs` | `allowance.mjs` on a fixture journal writes a valid `mth-recheck-allowance/1`, which BE-R1's `parseAllowance` accepts (imported from `packages/db`). A journal entry for a `RECHECK_NEVER_OPERATIONAL` table goes in `tables`, never in `operational`. Duplicate keys are merged. |
| T-B16 | `transfer-drill.test.mjs` (PostgreSQL) | `job-check.mjs` on a fixture database: a changed enabled schedule fails, a removed `job_run` row fails, a new `job_run` row passes, and a missing pg-boss table reports BLOCKED, never PASS. It also measures whether a sign-in changes `app_user`, and records the answer for `allowance.mjs`. |
| T-B11 | the drill run | D0–D11 pass on the merged tree, in the namespace with no network. `reconcile-d5.json` and `reconcile-d6.json` are `matched` (mode 1). `reconcile-d9.json` is `matched after use` (mode 2), with the allowance and its reasons in the report. The download count equals the manifest count in D8 and D9. The report's `result` is `PASS`. |

**Q3: the real T-B11 run.**
1. Build the release archive from the **candidate commit** with `tools/release/build-archive.mjs` and a real BE-C demo export, and the pnpm store from the offline store.
2. **Measure free disk first** (`df -Pm`). The run needs the archive, the runtime tree, two clusters and the package.
3. If it does not fit, the drill exits 3 with the line above and the handback records BLOCKED with the numbers.
4. **Never make a second full checkout. Delete the work tree at the end unless `--keep` is given.**
5. The report goes to `docs/delivery/handbacks/DG7/T-DG7-DO-D2-evidence/transfer/` (ADR-0069 §4).

**Seams DO-D2 verifies, and reports in its handback with the evidence:**
- `seed-dev` after `seed-demo` on S;
- the smoke journey against the seeded users;
- that `export.mjs` writes the attachments, so no `copy-out` is needed.

If a seam fails, the drill records the step as FAIL with the reason. DO-D2 does not work around it in product code.

**Requirement → clause → test.** This sharpens B.8; the B.8 rows stand.

| Requirement | Clause | Test(s) |
| --- | --- | --- |
| REQ-S19-017 | "the drill report shows matching counts and checksums" | T-B11 D5 and D6 (mode 1), D9 (mode 2) |
| REQ-S19-017 | "working evidence downloads under the new base URL" | T-B11 D8 (a), D9 (D1 uploads guarantee files exist) |
| REQ-S19-017 | "successful key workflows" | T-B10, T-B11 D8 (b)–(d) |
| REQ-S19-017 | "records, jobs and approvals intact after a full restart" | T-B11 D9 (mode 2, job checks, approval rows), T-B16 |
| REQ-S19-017 | title: "rebind identity" | T-B10, T-B11 D6 |
| REQ-S01-006 | "a clean environment with a different base URL starts from the package" | T-B11 D7 (`getDeploymentStatus.origin`), D10 |
| REQ-S19-009 | "configured only from the template and guides" | T-B11 D3, and D5 citing `#migration-import` |

**What DO-D2 must know.**
- A drill step that cannot run is BLOCKED or FAIL with its reason, never skipped and never counted as passed.
- Keys in the allowance come from API responses and sign-ins. Never list keys by reading "whatever is new" from the target. That would make D9 prove nothing.
- Every IdP user, secret and origin is synthetic, and the report says so. Nothing here approves anything: no G1–G6, Finance or IT approval, and no DG gate.
- The CI wiring fragment (DO-D gap 7) remains the orchestrator's.
- Run before the handback: `node tools/gates/validate.mjs --historical --stage DG6` **first**, then the drill tests under `with-pg.sh`, `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, and the repository-wide prettier check.

### B.7 DO-D3: run the transfer drill to the end (devops-engineer; repair; after BE-R2)

**What this is.** The second repair task for the A18 drill (D-259). It does the following:

- moves the drill to Amendment 2: allowance `mth-recheck-allowance/2` (A2.6) and the job digest through the §2.3 encoder (`mth-db table-digest`, C.13);
- fixes any drill bug the real run finds;
- hands over the CI fragment;
- runs T-B11 from D0 to D11.

This section is referred to as "B.7 DO-D3". Its number clashes with "B.7 Integration order" above, as B.6 DO-D2 did (D-259). B.6 DO-D2's rules stand unless changed here.

**Preconditions (checked first, and reported as BLOCKED with the reason if they do not hold):**
- BE-R2 is merged;
- the A2.8 register rewording is merged, so `register-t1-scan` gives 0 hits.

**Modifies:**

| File | Exactly what |
| --- | --- |
| `deploy/scripts/drill/allowance.mjs` | Writes `/2`, with all six keys:<br>• `actors`: the T `app_user` ids of the journalled sign-ins, resolved by (issuer, subject);<br>• `tables`: journalled API keys for tables not in `audited`;<br>• `audited`: the tables of `D8_TOUCHED_AUDITED`, each with `mustInclude` set to the journalled keys of that table;<br>• `children`: `D8_TOUCHED_CHILDREN` (child, parent, fkey);<br>• `operational`: unchanged from B.6 DO-D2.<br>The two lists are constants in the file, each table with a reason in `allowance-reasons.json`, and both are pinned by T-B17. The constants come from `recheck.ts` only. The literal fallback of DO-D2 is removed, and a failing import is an error, not a fallback. |
| `deploy/scripts/drill/job-check.mjs` | The digests use `mth-db table-digest` (C.13), not `row::text`:<br>• the approval tables by `digest`;<br>• the enabled `job_schedule` rows and the earlier `job_run` rows by the `--rows` line hashes of their keys.<br>The pg-boss rows keep their measured form (they are outside the export plan). |
| `deploy/scripts/transfer-drill.sh` | only bug fixes found by the run, each named in the handback with the failing log line; and D9 passes `--allow` with the `/2` file |
| `deploy/scripts/tests/transfer-drill.test.mjs` | T-B15 against `parseAllowance` (`/2`, which must now pass), T-B16 on the encoder digest, and T-B17 |

**Creates:**

| File | Purpose |
| --- | --- |
| `deploy/scripts/ci/transfer-drill.job.yml` | The CI job fragment (§2 rule 9): `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs`. The orchestrator merges it and runs `check-ci-needs.mjs`. DO-D3 does not edit the CI files. |

**Tests:**

| Test | Proves |
| --- | --- |
| T-B15 | `allowance.mjs` on a fixture journal writes a `/2` file that `parseAllowance` accepts; never-operational tables appear only in `tables`, `audited` or `children`; duplicates are merged. |
| T-B16 | as in B.6 DO-D2, with the digests from `mth-db table-digest`. A changed approval row changes the encoder digest. |
| T-B17 (PostgreSQL) | **The two D8 lists are measured, not guessed.** It runs D8's write chain (`journey.mjs --steps writes,approve`) against a fixture installation, compares every exported table against a snapshot taken before, and checks that the changed tables minus `tables`, the operational list and `user_identity` equal `D8_TOUCHED_AUDITED ∪ D8_TOUCHED_CHILDREN`. It then runs mode 2 on that fixture with the generated allowance and expects exit 0. One extra owner-written row in an audited table, with an event by a non-journalled user, gives exit 4. |
| T-B11 | as in B.6 DO-D2: D0–D11 PASS in the no-network namespace, on an archive built from the merged candidate commit. `reconcile-d5.json` and `reconcile-d6.json` are `matched`, with an `audit_already_present` delta. `reconcile-d9.json` is `matched after use`. The report's `result` is `PASS`. |

**What DO-D3 must know.**
- A step that cannot run is BLOCKED or FAIL with its reason. A product defect found by the run is reported, never worked around in product code.
- Disk is tight. Measure first, never make a second full checkout, and delete the work tree unless `--keep` is given.
- `actors` come from sign-ins. Never derive actors or keys from "whatever is new" on T.
- Every IdP user, secret and origin is synthetic. Nothing here approves anything: no G1–G6, Finance or IT approval, and no DG gate.
- Run before the handback: `node tools/gates/validate.mjs --historical --stage DG6` **first**; then the drill tests under `with-pg.sh`, T-B11, `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and the repository-wide prettier check.

### B.8 DO-D4: run T-B11 to the end (devops-engineer; repair; after BE-R3 and AN-R1)

**What this is.** The third repair task for the A18 drill (D-260). This section is referred to as "B.8 DO-D4". Its number clashes with "B.8 Requirement → clause → test → owner" above, as B.6 DO-D2 and B.7 DO-D3 did (D-259, D-260). The rules of B.6 DO-D2 and B.7 DO-D3 stand unless changed here. It does the following:

- moves D8 to the ADR-0064 A3.6 gate chain;
- moves the allowance to `mth-recheck-allowance/3` with `counters`;
- remeasures the D8 lists on the full chain;
- runs T-B17 and T-B11 from D0 to D11.

**Preconditions** (checked first, and reported as BLOCKED with the reason if they do not hold):
- BE-R3 is merged (`ALLOWANCE_SCHEMA_VERSION` is `/3` and `RECHECK_COUNTER_TABLES` exists);
- AN-R1 is merged: `node --test apps/api/scripts/register-snapshot.test.mjs` (T-R16) exits 0.

**Modifies:**

| File | Exactly what |
| --- | --- |
| `deploy/scripts/drill/pick-actors.sql` | Adds the A3.6 actors: `V`, `W`, `O`, and `L` and `X` when needed. They are rebound users only, and each must differ where A3.6 says. A role that cannot be filled ends D8 before C0 with `D8 FAIL: no rebound user holds <permission>`. |
| `deploy/scripts/drill/journey.mjs` | The A3.6 steps C0–C6 and the remedy table, by operation id. Every call is made through the public API with the session cookie, the CSRF token and `If-Match` where required. Every key a response returns is journalled. The failure lines are exactly A3.6's. Every created text starts with `SYNTHETIC`. |
| `deploy/scripts/drill/allowance.mjs` | Writes `/3`: the six `/2` keys plus `counters` = `D8_TOUCHED_COUNTERS`. `automation_execution` and `automation_action_result` are in `D8_TOUCHED_AUDITED`. `D8_TOUCHED_AUDITED`, `D8_TOUCHED_CHILDREN` and `D8_TOUCHED_COUNTERS` are replaced by the T-B17 measurement on the **full** chain. Each entry has its reason in `allowance-reasons.json` (`mth-recheck-allowance-reasons/3`). The constants still come from `recheck.ts` only. |
| `deploy/scripts/transfer-drill.sh` | D8 passes the new actors. D9 passes the `/3` file. Bug fixes found by the run are each named in the handback with the failing log line. |
| `deploy/scripts/tests/transfer-drill.test.mjs` | T-B15 on `/3`, T-B17 on the full chain, and T-B18 |

**Tests:**

| Test | Proves |
| --- | --- |
| T-B15 | `allowance.mjs` writes a `/3` file that `parseAllowance` accepts. A counter table appears only in `counters`. |
| T-B17 (PostgreSQL) | As in B.7, on the **full** A3.6 chain (C0–C6): the journey reaches `decideGate` 201, and the changed tables minus `tables`, operational and `user_identity` equal `D8_TOUCHED_AUDITED ∪ D8_TOUCHED_CHILDREN ∪ D8_TOUCHED_COUNTERS`. Mode 2 with the generated `/3` file exits 0, and the report's `automationChain` is non-empty. The negative case of B.7 stays. |
| T-B18 (PostgreSQL) | The remedy table is closed: on a fixture where the chosen gate misses a code with no remedy row, the journey stops at C1 with `D8 FAIL: no API remedy for <code> at <pointer>` and writes nothing after it |
| T-B11 | As in B.6 DO-D2 and B.7: D0–D11 PASS in the no-network namespace, on an archive built from the merged candidate commit. `reconcile-d5.json` and `reconcile-d6.json` are `matched`, with an `audit_already_present` delta. `reconcile-d9.json` is `matched after use`. The report's `result` is `PASS`. |

**What DO-D4 must know.**
- A row that mode 2 calls unexplained is reported with its key, never allowed by editing the lists by hand. The lists come from T-B17's measurement only.
- A scheduled automation row that lands in the window (A3.9 residual 1) is a FAIL with its key and trigger code. Never pause, disable or reschedule a job to avoid it. Report it, and the orchestrator decides.
- `table-digest` output may be piped again once BE-R3's drain fix is merged. The file-based workaround of DO-D3 may stay.
- Wait at least 30 s after C6 (and after the gate routing in C4) before D9's snapshot, and record the wait. A worker job that ends later than that is a T-B17 measurement gap, reported as such.
- Every IdP user, secret, origin, KPI value, evidence note, deferral and gate decision is SYNTHETIC. Nothing here approves anything: no G1–G6, Finance or IT approval, and no DG gate.
- Disk is tight. Measure first, never make a second full checkout, and delete the work tree unless `--keep` is given.
- Run before the handback: `node tools/gates/validate.mjs --historical --stage DG6` **first**; then the drill tests under `with-pg.sh`, T-B11, `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and the repository-wide prettier check.

## §F. Slice F: schema, API and connector handover (T-DG7-ARCH-04; ADR-0070)

### F.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0070-p7-schema-api-connector-handover-dictionary-coverage-openapi-completeness.md`.
- The coverage rule written at the end of `docs/architecture/data-dictionary.md` ("P7 slices B and F") and in ERD §1ae.
- No migration, no table and no operation.

### F.1 DO-H: coverage tools and `docs/handover/{data,api}/` (devops-engineer; W9; after every ARCH task is merged)

**Creates:**

| File | Purpose |
| --- | --- |
| `tools/release/dictionary-coverage.mjs` | ADR-0070 §1 and §1.1. `--database-url <url> --out <file>`. Exit 0, 1, 2 or 3 (§2 rule 4). |
| `tools/release/openapi-coverage.mjs` | ADR-0070 §2. `--vitest-json <file> --out <file>` |
| `tools/release/connector-handover.mjs` | ADR-0070 §3. `--write` / `--check` |
| `tools/release/tests/{dictionary-coverage,openapi-coverage,connector-handover}.test.mjs` | T-F1…T-F7. The database tests use `tests/qa/support/pg-port.sh` ports and a disposable cluster, or BLOCKED. |
| `docs/handover/data/{README.md,pgboss.md,coverage.json}` | ADR-0070 §1.3 |
| `docs/handover/api/{README.md,authentication.md,connectors.md,openapi-coverage.json}` | ADR-0070 §2–§3 |

**Never edits:** `docs/architecture/{data-dictionary,erd}.md`, `docs/api/openapi.yaml` and the contract tests. A gap goes in the handback as a list, and the orchestrator or an ARCH repair closes it (p7-plan §5.3).

**Requests:** the two index lines in `docs/handover/README.md` (DOC-B).

### F.2 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-F1 | `dictionary-coverage.test.mjs` (disposable PostgreSQL, fixture dictionaries) | a missing table, a missing column, a wrong type, a duplicated heading, and a documented table or column that does not exist each fail and are listed; a complete fixture passes; nullability is compared only where the section has a `Null` column |
| T-F2 | same | a database that is not fully migrated → exit 2 with the F.3 line; an unreachable one → exit 2 |
| T-F3 | same | an ERD table name that does not exist fails; a table in no ERD section is reported and does not fail |
| T-F4 | `openapi-coverage.test.mjs` (fixture vitest JSON and fixture test sources) | a non-empty pending list, a `.skip`, `.todo` or `.only` in a contract test file, a count pin unequal to the document, and a failed required test each fail |
| T-F5 | the real run on the merged tree | `openapi-coverage.json`: operations = routed = exercised = the pinned count, and the pending lists are empty (this run belongs to the freeze; before it, the report shows the open pending entries and fails) |
| T-F6 | `connector-handover.test.mjs` | parity: every integration row of the `environment.md` residual table is in `connectors.md` and back, every adapter kind of `connectors.ts` appears, and `--check` equals a fresh generation |
| T-F7 | same | every enterprise connector reads "not verified"; credentials appear by name only (the ADR-0063 secret scan finds nothing in `docs/handover/api/`) |
| T-F8 | the real run of `dictionary-coverage.mjs` on a database migrated with every shipped migration (the merged tree) | exit 0 before the freeze, or a gap list the orchestrator closes first |

### F.3 Exact texts

| Tool | Exit | Line |
| --- | --- | --- |
| `dictionary-coverage.mjs` | 0 | `dictionary-coverage: PASS: <t> tables and <c> columns documented (<s> schemas); reported only: <i> indexes, <k> constraints, <g> triggers not named; ERD: <e> tables in no section` |
| `dictionary-coverage.mjs` | 1 | `dictionary-coverage: FAIL: <n> gaps` followed by one line per gap: `missing table <schema>.<table>` / `missing column <table>.<column> (<type>)` / `type mismatch <table>.<column>: documented <a>, database <b>` / `stale <table>[.<column>]: documented but not in the database` / `duplicate heading <table>` / `ERD names a table that does not exist: <table>` |
| `dictionary-coverage.mjs` | 2 | `dictionary-coverage: BLOCKED: the database is not fully migrated (<n> pending)` / `dictionary-coverage: BLOCKED: cannot connect to the database` |
| `openapi-coverage.mjs` | 0 | `openapi-coverage: PASS: <n> operations described, routed and exercised; no pending entry; no skipped contract test` |
| `openapi-coverage.mjs` | 1 | `openapi-coverage: FAIL: <reason>` (one line per reason: `pending operation <id> (<list file>)`, `skipped test in <file>:<line>`, `count pin <p> does not equal <n> operations`, `required test failed: <name>`) |
| `connector-handover.mjs` | 1 | `connector-handover: connectors.md differs from environment.md: <row>` |
| `connectors.md` live status | — | `Not verified: no authenticated test against a Mobily endpoint has been recorded.` (Arabic summary, provisional: `غير متحقق منه: لم يُسجَّل أي اختبار موثَّق مقابل نقطة اتصال لدى موبايلي.`) |

The product's own label stays the approved `integrations.json` key `not_verified` ("Not verified"), unchanged.

### F.4 Seams

| Seam | Rule |
| --- | --- |
| **Every ARCH task** | DO-H runs after all ARCH tasks merge (W9), so the schema and contract it covers are final except for repairs. A later migration means a re-run of T-F8 before the freeze. |
| **Contract suite** | DO-H reads its JSON output. The pending lists empty as each BE task lands. T-F5 can pass only at the freeze. |
| **Handover index → H (DOC-B)** | DOC-B links `docs/handover/data/` and `docs/handover/api/`. |
| **Known limitations → H (DOC-B)** | The same `environment.md` table feeds both. Neither copies the other. |
| **A17, A18 → QA-C** | QA-C's A17 re-run proves "not verified" in the product; A18 includes ADR-0069 D4 (production initialization). |

### F.5 Requirement → clause → test → owner

| Requirement | Clause (acceptance text) | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S19-005 | "the data dictionary covers every table and column in the final schema" | T-F1, T-F2, T-F8 | DO-H; orchestrator or ARCH repair for gaps |
| REQ-S19-005 | "production initialization on a clean database succeeds" | ADR-0069 D4 inside T-B11; `clean-start-local.sh` phase A | DO-D; QA-C |
| REQ-S19-005 | title: "ER diagram, validation rules, indexes" | T-F3 (ERD names); the reported-only counts in `coverage.json` | DO-H |
| REQ-S19-007 | "every endpoint … in the release is described" | T-F4, T-F5; `pnpm openapi:lint` | DO-H |
| REQ-S19-007 | "… and passes its contract test" | T-F5 (the contract suite with no pending entry and no skip) | DO-H; every BE task (its exercises) |
| REQ-S19-007 | "every … connector … passes its contract test" | the adapter contract suites (P6) re-run; T-F6 lists each adapter's test file | DO-H; QA-C |
| REQ-S19-007 | title: "authentication setup and connector contracts" | `authentication.md`, `connectors.md`; T-F6 | DO-H |
| REQ-S17-004 | "contract tests pass against the local adapters" | A17 re-run (QA-C); the P6 adapter suites | QA-C |
| REQ-S17-004 | "the integration status page shows 'not verified' for every enterprise connector without a recorded authenticated test" | A17 re-run (`a17-import-and-integration.test.ts` and its e2e); T-F7 for the handover text | QA-C; DO-H |
| REQ-S17-004 | procedure: "the handover lists required endpoints and credentials" | T-F6, T-F7 | DO-H |

### F.6 What the implementers must know

- Never rewrite an approved dictionary or ERD section. Gaps are listed, and new sections are added by the orchestrator or an ARCH repair.
- `NO_400_OPERATIONS` is not a skip list. Print it with its reason, and do not count it as an exclusion.
- A credential is named, never shown. `connectors.md` must pass the ADR-0063 secret scan.
- "Not verified" is the truth for every enterprise connector in this release. No text may say "live", "integrated with Mobily" or "tested against production".

## §I. Slice I: traceability, in-app register and honest completion (T-DG7-ARCH-05; ADR-0071)

### I.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0071-p7-traceability-register-snapshot-about-release-notes-release-blockers-protocol-audit.md`.
- **No migration.** `0153`–`0155` stay free. Slice I adds no table. A migration that a slice I or H implementer still needs takes the next free id above the highest shipped one (D-245 O9, D-248 O8).
- **No permission code.** All three operations use the P6 code `operations.read` (the D-250 O1 precedent; permissions matrix §33). `P7_PERMISSIONS` is unchanged.
- **Contract** (`docs/api/openapi.yaml`, `1.6.0-p7`, **965** operations):
  - the tag `release`;
  - `GET /api/v1/admin/requirements` `listRequirements`, `GET /api/v1/admin/requirements/{reqId}` `getRequirement`, `GET /api/v1/admin/about` `getReleaseAbout`;
  - the schemas `RequirementClass`, `RequirementStatus`, `RequirementArea`, `RequirementSummary`, `RequirementPage`, `Requirement`, `RegisterSnapshotInfo`, `ReleaseOpenItem`, `ExternalDependency` and `ReleaseAbout`.

  `pnpm openapi:lint` passes. Related files: the `p7-operations.ts` block, `p7-pending-arch-05.ts`, `p7-pending-be-h.ts` (all three operations), the aggregate `p7-pending.ts` import line, and the `contract.test.ts` count pin 965 with its comment line.
- **Advisory locks:** 730418–730419 reserved, none allocated (registry comment, ADR-0016 §6 row).
- **ERD** §1af, **data dictionary** "P7 slices I and H", **permissions matrix** §33.

### I.1 BE-H: the snapshot, the register and About (backend-workflow; W7; after BE-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `apps/api/scripts/register-snapshot.mjs` | ADR-0071 §2: strict parse, the output format `mth-register-snapshot/1`, `--check`, exit codes 0/1/2 (§2 rule 4). Exports `parseRegister(text)` and `buildSnapshot(...)` for the tests. Node built-ins only. |
| `apps/api/scripts/register-snapshot.test.mjs` | T-I1, T-I2, T-I3 (`node --test`; listed in BE-H's handback command) |
| `apps/api/src/modules/release/snapshot.ts` | `RegisterSnapshotSource` (`load(): Promise<Snapshot>`); the default source resolves `../../release/register-snapshot.json` relative to the compiled module (`dist/modules/release/snapshot.js` → `dist/release/register-snapshot.json`); the source-mode fallback resolves `apps/api/dist/release/register-snapshot.json` from the package root; lazy load, cache on success only, validation (G4) |
| `apps/api/src/modules/release/about.ts` | `buildAbout(snapshot \| null, versions)`: §4 of ADR-0071 (counts, `openItems`, `laterClauses` with the marker `completes-after-gate:`, `externalDependencies`) |
| `apps/api/src/modules/release/cursor.ts` | the opaque cursor (base64url of `{ after, filtersHash }`; a mismatch → 400) |
| `apps/api/test/integration/release/register.test.ts` | T-I4, T-I5, T-I6 (real PostgreSQL for the session and roles) |
| `apps/api/test/integration/release/about.test.ts` | T-I7 |
| `apps/api/test/integration/contract/p7-exercises-be-h.ts` | the three operations exercised and validated (the P6 pattern) |

**Modifies:**

| File | Exactly what |
| --- | --- |
| `apps/api/src/modules/release/routes.ts` | the three routes behind G1–G8 (ADR-0071 §3), `registerReleaseRoutes(app, deps, source = defaultRegisterSnapshotSource())` |
| `apps/api/src/modules/release/index.ts` | passes the source through; nothing else |
| `apps/api/src/modules/release/release.test.ts` | T-I8 and T-I9 (unit) |
| `apps/api/package.json` | the `build` script line of ADR-0071 §2.4 and nothing else |
| `.dockerignore` | one line `!docs/delivery/requirements.csv`, directly after `docs/delivery` |
| `apps/api/test/integration/contract/contract.test.ts` | the import and the `it(...)` hook for `p7-exercises-be-h.ts` |
| `apps/api/test/support/p7-pending-be-h.ts` | removes each operation in the change that routes and exercises it; empty at the end |

**Reads only:** `docs/delivery/requirements.csv` (the generator and its tests only, never the runtime), `docs/handover/external-dependencies.json` (when it exists; DOC-B creates it in W9), `apps/api/src/modules/platform/**` (the version helper of BE-B, if exported).

**Boundary:** `release` imports only `platform` plumbing and the policy function (ADR-0002; p7-plan §2). It never imports a domain module, never queries a product table, and never opens a file under `docs/`.

**Requests to FE-A (append-only merge, §5.3):**
- `problems.json` key `release.register_snapshot_unavailable` (I.3);
- the nav entries Administration > Requirement register (`/admin/requirements`) and Administration > About (`/admin/about`), visible with `operations.read`.

### I.2 FE-C: the two screens (frontend-ux; W9; after FE-A and BE-H)

**Creates:**
- `apps/web/src/pages/admin/requirements/**`: list with the four filters, URL-synced; table; detail panel; snapshot line.
- `apps/web/src/pages/admin/about/**`.
- `apps/web/src/i18n/{en,ar}/release.json`: the I.3 texts.
- Their unit tests: T-I15, T-I16.

The Arabic of `release.json` is registered as provisional (the `provisional-ar*.ts` pattern; FE-C adds its own `apps/web/src/i18n/provisional-ar-p7-release.ts`).

**Rules:**
- A `null` is shown as the Unavailable or Unknown text, never as 0, an empty table or a success colour.
- `openItems: []` alone shows the empty-state text.
- Register text (titles, notes) is shown as plain text in the register's language (English) inside a `dir="ltr"` `lang="en"` element on the Arabic screen, with the I.3 note.

### I.3 Exact texts

**Operator and tool lines** (English; §2 rule 4):

| Where | Exit or level | Line |
| --- | --- | --- |
| `register-snapshot.mjs` | 0 | `register-snapshot: wrote <out> (<n> rows, sha256 <first 12 hex>)` |
| `register-snapshot.mjs` | 1 | `register-snapshot: <line>: <reason>` (reasons: `header differs from the 19 register columns`, `expected 19 fields, found <k>`, `invalid req_id '<id>'`, `duplicate req_id '<id>'`, `invalid class '<v>'`, `invalid status '<v>'`, `invalid final_gate '<v>'`, `unterminated quoted field`, `byte order mark not allowed`) |
| `register-snapshot.mjs --check` | 1 | `register-snapshot: <snapshot> is stale: it was built from sha256 <a>, the register is sha256 <b>` |
| `register-snapshot.mjs` | 2 | `register-snapshot: BLOCKED: <path> not found` |
| API (`release/snapshot.ts`) | warn, once per process | `release: the register snapshot is unavailable (<reason>); the register and About show it as unavailable` |
| `release-notes.mjs` | 1 | `release-notes: <req_id> is <status> but names no missing dependency in notes` / `release-notes: <req_id> is IMPLEMENTED without evidence` / `release-notes: docs/handover/release-notes.md is out of date (run with --write)` |
| `release-notes.mjs` | 0 | `release-notes: <n> unfinished item(s), <m> later clause(s); wrote <out>` |

**Problem text** (`problems.json`, FE-A; the Arabic is provisional):

| Code | English | Arabic |
| --- | --- | --- |
| `release.register_snapshot_unavailable` | The requirement register of this release is not available. The build did not include its register snapshot. | سجل المتطلبات لهذا الإصدار غير متاح. لم يتضمن البناء لقطة السجل. |

**Screen texts** (`release.json`; the Arabic is provisional until a qualified reviewer checks it, D-243 Q7):

| Key | English | Arabic (provisional) |
| --- | --- | --- |
| `register.title` | Requirement register | سجل المتطلبات |
| `register.intro` | The requirements of this release and their delivery status, read-only. The register is maintained in the repository. | متطلبات هذا الإصدار وحالة تسليمها، للقراءة فقط. يُدار السجل في المستودع. |
| `register.snapshot` | Register snapshot: {rowCount} rows, SHA-256 {sha}… | لقطة السجل: {rowCount} صفًا، SHA-256 {sha}… |
| `register.filter.class` / `.status` / `.area` / `.finalGate` | Class / Status / Area / Final gate | الفئة / الحالة / المجال / البوابة النهائية |
| `register.col.id` / `.title` / `.increments` | Requirement / Title / Increments | المتطلب / العنوان / المراحل |
| `register.notEngineeringApproval` | These are engineering delivery states, not business approvals. | هذه حالات تسليم هندسية، وليست موافقات أعمال. |
| `register.englishOnly` | Register texts are kept in English, as in the repository. | تُحفظ نصوص السجل بالإنجليزية كما في المستودع. |
| `register.unavailable` | The register of this release is not available. | سجل هذا الإصدار غير متاح. |
| `register.empty` | No requirement matches these filters. | لا يوجد متطلب يطابق عوامل التصفية هذه. |
| `status.PLANNED` / `SPECIFIED` / `IMPLEMENTED` / `BLOCKED` | Planned / Specified / Implemented / Blocked | مخطط / محدد / منفذ / محظور |
| `about.title` | About this release | حول هذا الإصدار |
| `about.appVersion` / `about.contractVersion` | Application version / API contract version | إصدار التطبيق / إصدار عقد الواجهة البرمجية |
| `about.counts` | Requirements by status | المتطلبات حسب الحالة |
| `about.openItems` | Unfinished items | البنود غير المكتملة |
| `about.openItems.dependency` | Missing dependency | التبعية الناقصة |
| `about.openItems.none` | Every requirement of this release is implemented. | جميع متطلبات هذا الإصدار منفذة. |
| `about.laterClauses` | Clauses that complete after the engineering gate | بنود تكتمل بعد البوابة الهندسية |
| `about.externalDependencies` | Remaining external configuration dependencies | تبعيات الإعداد الخارجية المتبقية |
| `about.unknown` | Unknown: this build did not include the list. | غير معروف: لم يتضمن هذا البناء القائمة. |
| `about.unavailable` | Unavailable | غير متاح |

**Release-notes headings** (`release-notes.md`; the Arabic summary section is provisional):

| English | Arabic (provisional) |
| --- | --- |
| Release identity | هوية الإصدار |
| Requirements by status | المتطلبات حسب الحالة |
| Unfinished items and release blockers | البنود غير المكتملة وعوائق الإصدار |
| Clauses that complete after the engineering gate | بنود تكتمل بعد البوابة الهندسية |
| Remaining external configuration dependencies | تبعيات الإعداد الخارجية المتبقية |
| Provisional Arabic texts | النصوص العربية المؤقتة |
| None: every requirement of this release is implemented. | لا يوجد: جميع متطلبات هذا الإصدار منفذة. |

### I.4 Tests (each line states what it proves)

| Test | File | Proves |
| --- | --- | --- |
| T-I1 | `register-snapshot.test.mjs` | On the tree's `requirements.csv`: `rowCount` and the id list equal an independent count of records and ids. Every field of every row equals the file's field byte for byte (multi-line fields included). `sourceSha256` equals `sha256(file)`. |
| T-I2 | same | `--check` exits 0 on a fresh snapshot and 1 after one byte of the fixture register changes, with the I.3 line. |
| T-I3 | same | Each I.3 refusal on a fixture: header, field count, id, duplicate, class, status, gate, unterminated quote, BOM → exit 1. A missing `--csv` → exit 2. `--deps` absent → `externalDependencies: null` (never `[]`). An invalid dependency entry → exit 1. |
| T-I4 | `register.test.ts` | Unfiltered `listRequirements`, paged to the end, returns exactly the snapshot's ids in order, and their count equals `rowCount` (**the A01 clause**). Each filter alone and combined returns exactly the matching rows. A cursor reused with another filter → 400. `limit` 0 or 101 → 400. An unknown parameter → 400. |
| T-I5 | same | `getRequirement` returns every column verbatim for a multi-line row. An unknown id → 404. A bad id → 400. All three operations: 200 for ADM_TECH, TO, KDS, TD and AUD; 403 for SP, TL, BO, WL, FIN, CM, SEC, ADM_ACCESS and ADM_METHOD; 401 without a session (G1, G2). |
| T-I6 | same | With a missing or corrupt snapshot (wrong `schemaVersion`; `rowCount` ≠ rows): list and get → 503 `release.register_snapshot_unavailable`, never 200 with an empty page. After the file is fixed, the next request succeeds without a restart (G4). |
| T-I7 | `about.test.ts` | On a fixture snapshot with one SPECIFIED, one BLOCKED and one IMPLEMENTED row carrying `completes-after-gate:`: `statusCounts` holds every status and its sum equals `rowCount`; `openItems` lists exactly the two rows with their notes; `laterClauses` lists exactly the marked row. Snapshot missing → `register`, `statusCounts`, `openItems` and `laterClauses` are `null` and the response is 200. `externalDependencies` `null` stays `null`. `appVersion` and `contractVersion` equal `getDeploymentStatus`'s values once BE-B is merged (otherwise the test is skipped by name and listed in the handback, never counted as passed). |
| T-I8 | `release.test.ts` | `.dockerignore` contains `docs/delivery` followed by `!docs/delivery/requirements.csv`, and no other `!docs/delivery` line. `apps/api/package.json` `build` runs the generator into `dist/release/register-snapshot.json`. |
| T-I9 | same | With a spy on `node:fs` open and read calls during a full request cycle of the three operations, the only path read is the snapshot path (G7). |
| T-I10 | QA-D (freeze) | On the frozen candidate: `pnpm -r build` and then `assemble-runtime.sh` into a scratch directory; the runtime tree's `apps/api/dist/release/register-snapshot.json` has `sourceSha256` equal to the candidate's `requirements.csv` and `rowCount` equal to its record count (**D-243 Q11**). |
| T-I11 | `tools/release/tests/release-notes.test.mjs` (DO-J) | On fixtures and on the tree: the "Unfinished items and release blockers" section lists exactly the rows that are not `IMPLEMENTED` (set equality); a non-`IMPLEMENTED` row with empty notes → exit 1; `--check` drift → exit 1; no clock is read (two runs, identical bytes); the dependency list `null` → the Unknown line. |
| T-I12 | `tests/qa/integration/a24-register-rules.test.ts` (QA-D) | `checkRegister` (imported read-only from `tools/gates/lib/rules.mjs`) refuses a BLOCKED row with empty notes and an IMPLEMENTED row without evidence, each with its own message (**the A24 clause of REQ-S02-005**). |
| T-I13 | DO-J (fixture) and QA-D (frozen register) | The six D-243 Q19 rows (REQ-DLV-021, DLV-010, S20-023, DLV-039, DLV-041, S20-028) carry `completes-after-gate:` and appear in `laterClauses` and the release notes. |
| T-I14 | DOC-B (`check-handover.test.mjs`, ADR-0072 T-H9) | Every file under `docs/handover/` is in the candidate manifest, so the payload secret scan covers it. |
| T-I15 | FE-C (`pages/admin/requirements/*.test.tsx`) | Filters map to query parameters. A 503 shows `register.unavailable`, not the empty text. Notes render as text (no HTML). The Arabic view keeps the register text LTR. |
| T-I16 | FE-C (`pages/admin/about/*.test.tsx`) | `null` fields show `about.unknown` or `about.unavailable`; `openItems: []` shows `about.openItems.none`; no count is rendered as 0 when `statusCounts` is `null`. |
| T-I17 | FE-D (`apps/web/e2e/p7-*.spec.ts`) | axe, RTL/LTR, 360 px and keyboard over both screens. |

**The `release` module's guard table → test → owner** (ADR-0071 §3; D-251 item 3). BE-H copies the G1–G8 table into the header comment of `release/routes.ts`, replacing the stub's "no guard table here yet".

| Guard | Clause | Test(s) | Owner |
| --- | --- | --- | --- |
| G1 | no session → 401 | T-I5; the contract suite's 401 sweep (`p7-exercises-be-h.ts`) | BE-H |
| G2 | `operations.read` at installation scope → else 403; the five holders → 200 | T-I5 (all 14 roles) | BE-H |
| G3 | parameters by contract pattern and enum; cursor bound to filters → else 400 | T-I4, T-I5; `response-validation.test.ts` (uniform 400 body) | BE-H |
| G4 | missing or invalid snapshot → 503 (list, get) or `null` fields (About); retried, not cached | T-I6, T-I7 | BE-H |
| G5 | read-only: GET only, no audit, no version | the contract (three GETs); T-I9 (no write path opened); `route-inventory.test.ts` | BE-H |
| G6 | no sensitive data added; register text secret-scanned | ADR-0063 payload scan (DO-B, CI); `sensitive-reference-inventory.test.ts` stays green (no reference column read) | DO-B; BE-H |
| G7 | only the snapshot file is read at run time | T-I9 | BE-H |
| G8 | platform rate limit → 429 | the platform limiter tests (exist); `p7-exercises-be-h.ts` declares 429 like every read | BE-H |

### I.5 Seams with other slices

| Seam | Rule |
| --- | --- |
| **Register → AN-P7** | The analyst updates `requirements.csv` before the freeze, and writes the `completes-after-gate:` marker into the six Q19 rows' notes (ADR-0071 §5.3). The snapshot is never edited by hand. |
| **Archive → A (DO-A)** | `requirements.csv` and `docs/handover/**` are already in the archive (ADR-0062 §2). No change. |
| **Image build → orchestrator** | The `.dockerignore` exception is proven by the orchestrator's image build (D-243 Q1). Otherwise it is disclosed as BLOCKED (ADR-0071 Residual 2). |
| **Versions → B (BE-B)** | `appVersion` and `contractVersion` follow the `getDeploymentStatus` rule. If BE-B exports a helper from `platform/index.ts`, BE-H uses it. Otherwise BE-H reads the same sources, and T-I7 compares them. |
| **External dependencies → H (DOC-B)** | `external-dependencies.json` is DOC-B's (W9), after BE-H (W7). Until it exists, About and the release notes show Unknown. The freeze build includes it. |
| **Release notes → M (DO-J)** | DO-J builds `release-notes.mjs` from ADR-0071 §5. The seal (ADR-0073) re-checks the archive copy. |
| **Secret and claims scans → G (DO-B)** | Unchanged tools. The handover text is in their payload scope. |

### I.6 Requirement → clause → test → owner

| Requirement | Clause | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S02-003 | "the in-app view lists the same row count and IDs as docs/delivery/requirements.csv for the release" | T-I1, T-I4, T-I10 | BE-H; QA-D |
| REQ-S02-003 | "with filters by class, status and area" | T-I4, T-I15 | BE-H; FE-C |
| REQ-S02-003 | "view:ADM,AUD,TO; edit:none in-app" | T-I5 (the role set of matrix §33; open question O1); no write operation exists (contract) | BE-H |
| REQ-S02-003 | "the handover archive contains the register" | ADR-0062 archive manifest (DO-A, exists); A28 (ADR-0073) | DO-A; DO-J |
| REQ-S02-005 | "the validator rejects a BLOCKED row with empty notes and an IMPLEMENTED row without evidence" | T-I12 | QA-D |
| REQ-S02-005 | "release notes list every non-IMPLEMENTED row" | T-I11 | DO-J |
| REQ-S02-005 | "in-app 'About' list unfinished items as such" | T-I7, T-I16 | BE-H; FE-C |
| REQ-S02-005 | "no planned feature is labelled delivered" | T-I7 (status verbatim), T-I13, the claims scan (ADR-0063) | BE-H; DO-J; DO-B |
| REQ-S21-003 | "at DG7 no register row is below IMPLEMENTED, or it is listed as a release blocker" | T-I11 (the section equals the rows not IMPLEMENTED); QA-D's release-blocker check; the auditor | DO-J; QA-D |
| REQ-S21-003 | "the secret scan of the repository and the handover text finds no credentials" | `secret-scan.mjs --scope payload` and `--scope history` (DO-B, CI); T-I14 | DO-B; DOC-B |
| REQ-S21-003 | "preserve the full platform scope" | AN-P7 register pass; About `statusCounts` | analyst; BE-H |

### I.7 What the implementers must know

- Never trim, normalize or re-encode a register field. Verbatim is the A01 clause.
- `null` means unknown. Never send `[]` or `0` for something the build did not have.
- The runtime reads one file. A test (T-I9) holds you to it.
- No text calls a register status an approval, and none says the release "is approved".

## §H. Slice H: the handover documentation set (T-DG7-ARCH-05; ADR-0072)

### H.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0072-p7-handover-documentation-set-language-rule-deployment-guide-role-matrix-known-limitations.md`.
- No migration, permission or operation. The documents are not product rights (permissions matrix §33).

### H.1 Owners and files

| Task (wave) | Creates | Modifies | Reads only |
| --- | --- | --- | --- |
| **DOC-C** (backend-workflow; W8; after BE-G) | `tools/release/role-matrix.mjs`, `tools/release/tests/role-matrix.test.mjs` (T-H3), `docs/handover/role-matrix.md`, `docs/handover/automation-operations.md`, `docs/handover/automation-operations.ar-summary.md`, `tools/release/tests/automation-guide.test.mjs` (T-H6) | — | `packages/shared/src/permissions.ts`, `apps/worker/src/handlers/**`, ADR-0053, ADR-0067 |
| **DOC-B** (devops; W9; after ARCH-04, ARCH-05) | `docs/handover/README.md`, `deployment.md`, `deployment.ar-summary.md`, `operator-guide.md`, `operator-guide.ar-summary.md`, `known-limitations.md`, `known-limitations.ar-summary.md`, `external-dependencies.json`, `arabic-review.json` (`[]`), `tools/release/known-limitations.mjs`, `tools/release/check-handover.mjs`, `tools/release/tests/check-handover.test.mjs` (T-H1, T-H2, T-H4, T-H7, T-H8, T-H9, T-I14) | `docs/handover/security-controls.md`: the HR-01, HR-02, HR-04 and HR-06 guide links only (D-247 O5) | `docs/delivery/environment.md`, the protocol-audit JSON, `docs/operations/**`, `deploy/scripts/drill/guide-keys.json` |
| **DOC-A** (frontend-ux; W10; after FE-B, FE-C) | `docs/handover/guides/user/{en,ar}/*.md`, `docs/handover/guides/admin/{en,ar}/*.md` | — | the finished screens; `check-handover.mjs` (runs T-H5) |
| **DO-F**, **DO-G** | `backup-restore.md`, `upgrades.md` (§E) | — | — |
| **DO-J** | `release-notes.md` (ADR-0071 §5) | — | — |

- **Index.** Every task that adds a file under `docs/handover/` before DOC-B requests its index line in its handback (§2 rule 10). DOC-B adds the lines for every file listed in ADR-0072 §1, including `security-controls.md` (D-247 O3).
- **Order.** DOC-C (W8) precedes DOC-B (W9) precedes DOC-A (W10). DOC-B's `check-handover.mjs` must accept a tree without the `guides/` directory until DOC-A lands: T-H5 reports "no guides yet" as BLOCKED (exit 2), never as a pass. At the freeze it must pass.

### H.2 Seams

| Seam | Rule |
| --- | --- |
| **Deployment guide → B (DO-D)** | DOC-B owns the anchors that `guide-keys.json` cites. A missing anchor is requested in DO-D's handback (B.6). |
| **B.5 guide texts** | DOC-B uses ADR-0069's B.5 texts (HA, sub-path, origin change, readiness, orchestration target) verbatim, in English and in the Arabic summary. |
| **Security-controls matrix → G (DO-B)** | Only the link cells change. DO-B's matrix test must still pass (T-H8). |
| **Known limitations → J (DO-I)** | Generated from the report that the orchestrator produces at the freeze (`protocol-audit.mjs --all --json`). The DO-I fixture is `T-DG7-DO-I-evidence/protocol-audit-all.json`. |
| **External dependencies → I (BE-H, DO-J)** | `external-dependencies.json` feeds the snapshot (About) and the release notes. The block in `known-limitations.md` is generated from the same table. |
| **Role matrix → seeds** | `permissions.ts` is the one source. `seed.test.ts` already pins it to the migrations. |

### H.3 Exact texts (the Arabic is provisional, D-243 Q7)

| Key | English | Arabic (provisional) |
| --- | --- | --- |
| Provisional marker (every Arabic file or section) | Arabic text: provisional. It has not been checked by a qualified Arabic reviewer. | النص العربي مؤقت. لم يراجعه مراجع عربي مؤهل. |
| Summary-page header | This page summarizes the English guide <title>. The English guide is the complete text. | تلخص هذه الصفحة الدليل الإنجليزي <title>. الدليل الإنجليزي هو النص الكامل. |
| Role matrix header | These roles and permissions are the platform's configurable starting point, not a Mobily-approved access policy. | هذه الأدوار والصلاحيات هي نقطة البداية القابلة للتهيئة في المنصة، وليست سياسة وصول معتمدة من موبايلي. |
| Handover acceptance | Accepting this handover is a decision of Mobily IT, made outside the platform. This package is engineering evidence, not that acceptance. | قبول هذا التسليم قرار تتخذه تقنية المعلومات في موبايلي خارج المنصة. هذه الحزمة دليل هندسي وليست ذلك القبول. |
| Protocol-audit disclosure (known limitations) | The delivery records of gates DG0–DG6 contain the historic protocol observations listed below, found by the protocol audit. None changed product behaviour. They are disclosed here, and no gate was reopened (decision D-249). | تتضمن سجلات التسليم للبوابات DG0–DG6 الملاحظات التاريخية المتعلقة بالبروتوكول المذكورة أدناه، والتي كشفها تدقيق البروتوكول. لم تغيّر أي منها سلوك المنتج. يُفصح عنها هنا، ولم يُعَد فتح أي بوابة (القرار D-249). |
| External dependency, not verified | Not verified in this release. Mobily IT must supply and test it. | لم يُتحقق منه في هذا الإصدار. يجب أن توفره تقنية المعلومات في موبايلي وتختبره. |
| Corporate IdP | Sign-in has been tested only with a synthetic identity provider. Connecting the corporate identity provider is an external dependency. | اختُبر تسجيل الدخول باستخدام مزوّد هوية اصطناعي فقط. ربط مزوّد الهوية المؤسسي تبعية خارجية. |

### H.4 Tests

T-H1–T-H9 as ADR-0072 §8 states them. Command: `node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs tools/release/tests/automation-guide.test.mjs` (§2 rule 3: files, not a directory).

### H.5 Requirement → clause → test → owner

| Requirement | Clause | Test(s) | Owner |
| --- | --- | --- | --- |
| REQ-S19-011 | "the guide covers all seven topics" | T-H2 | DOC-B |
| REQ-S19-011 | "the clean-environment transfer follows it without undocumented steps" | DO-D `config-trace.mjs` (T-B9, T-B11 D3); T-B14 | DO-D; DOC-B |
| REQ-S19-011 | "accept:Mobily IT (external)" | the H.3 acceptance text; never claimed | DOC-B |
| REQ-S19-015 | "the package contains all seven items" | T-H1 (the seven items mapped to files); A28 archive listing (ADR-0073) | DOC-B; DO-J |
| REQ-S19-015 | "the coverage register equals docs/delivery/requirements.csv at the DG7 candidate" | identity: the archive ships the file (ADR-0062 §2); A28 byte check (ADR-0073); T-I10 for the in-app copy | DO-A; DO-J; QA-D |
| REQ-S19-015 | "Guides are written in English and Arabic where user-facing" | T-H5, T-H7 (D-243 Q7) | DOC-A; DOC-B |
| REQ-S19-015 | role matrix, automation guide, known limitations, release notes | T-H3, T-H6, T-H4, T-I11 | DOC-C; DOC-B; DO-J |

### H.6 What the implementers must know

- Every Arabic text is provisional, and says so. No agent adds an `arabic-review.json` entry.
- Generated blocks are never edited by hand. Use `--write`, and let `--check` hold the line.
- No guide says "certified", "compliant", "approved by Mobily" or "production-ready". Every external item reads "not verified in this release" (claims scan, §2 rule 8).

## §J. Slice J: the gate protocol obligations through DG7 (16 rows; tooling recorded by T-DG7-ARCH-05; ADR-0071 §7)

### J.0 What exists

- `tools/release/protocol-audit.mjs` 1.0.0 (DO-I, D-249): checks C1–C9, 25 fixture tests.
- The validator (`tools/gates/validate.mjs`: `--stage`, `--historical`, `--pipeline`, `--reconcile`), the gate records DG0–DG6, and `stages.json`.
- The real run over DG0–DG6 reported the historic hits H1–H11, which the user decided to disclose, not reopen (D-249).
- No new tool is specified here. The orchestrator owns the gate-time runs; tools under `tools/gates/**` are not changed by any P7 implementer.

### J.1 How each row is evidenced

"At the freeze" means run by the orchestrator on the DG7 candidate, with the log in `test-evidence/DG7/orchestrator/`. "Disclosure" means the D-249 block of `known-limitations.md` (ADR-0072 §5.2) plus the row's notes (AN-P7).

| Row | Clause in short | Evidence | Who | Disclosure |
| --- | --- | --- | --- | --- |
| REQ-DLV-005 | a reviewer who authored the scope is refused | validator A23 test (exists) re-run; `validate --stage DG7` | orchestrator; auditor | — |
| REQ-DLV-008 | no two concurrently active assignments share a writable file | protocol-audit **C4** `--all` at the freeze | orchestrator; auditor | H6/H7 (declared, not actual, shares; D-249 Q2) |
| REQ-DLV-009 | at most four overlapping runs | **C1** `--all` | orchestrator | H1/H2 (five runs, twice in DG5 and once in DG6; 36 DG6 run directories without `meta.json`) |
| REQ-DLV-010 | three specialist PASS and an audit per gate | gate records DG0–DG6; the DG7 gate (D-243 Q19: `completes-after-gate:`) | auditor | — |
| REQ-DLV-011 | every assignment holds the ten elements | **C2** `--all` | orchestrator | H3 (elements missing by the tool's reading), H4 (one DG6 hash not recoverable) |
| REQ-DLV-012 | five handback sections; no task with gaps reported complete | **C3**, **C6** `--all`; the auditor reads `progress.md` | orchestrator; auditor | H5 (headings), H9 (DG0 T-DG0-AN-01) |
| REQ-DLV-014 | stage history through BUILDING, REVIEWING, VERIFYING, APPROVED | `validate --stage DG7`; **C9** | orchestrator | F-DG6-952 as its accepted observation |
| REQ-DLV-018 | three failed fixes have a blocker entry | **C7** `--all` | orchestrator | H11 (F-DG3-100; D-085/D-086 recorded the closure criterion) |
| REQ-DLV-021 | `gates/DG0.json`–`DG7.json` exist | the DG7 gate record; A28 (D-243 Q19: `completes-after-gate:`) | auditor; DO-J | — |
| REQ-DLV-024 | `--historical` logged in test evidence before the first implementation run | **C5** `--all`; the DG7 `--historical` log placed in test evidence (D-249 H8) | orchestrator | H8 (DG0–DG6 runs stated in records without a log in test evidence) |
| REQ-DLV-027 | automatic continuation; no approval claim | **C8**, **C9** `--all` | orchestrator; auditor | — (C8 clean over DG0–DG6) |
| REQ-DLV-028 | six-element progress update per gate, matching candidate id | **C6** `--all` | orchestrator | H10 (closed by the added capability line, D-249) |
| REQ-DLV-030 | resumption from `progress.md`; stale review flagged | the A27 drill (K, ADR-0073), `validate --reconcile` | orchestrator | — |
| REQ-DLV-040 | the pipeline does not pass a gate that is not APPROVED | `validate --pipeline` after DG7; the A24 pipeline test re-run | orchestrator | — |
| REQ-S20-023 | separate review and audit evidence (A23) | the DG7 gate (D-243 Q19: `completes-after-gate:`) | auditor | — |
| REQ-S21-002 | end-to-end per gate in en and ar with audit; reopens recorded | the DG7 gate; `stages.json`; D-250 O2 (the `/readyz` change record, DG1 not reopened) | orchestrator; auditor | — |

**16 rows.** A hit of C1–C9 **in DG7** is a DG7 finding through the normal process. It is not a disclosure, and it blocks the gate if it is High or Critical.

### J.2 Tests for slice J

- `node --test tools/release/tests/protocol-audit.test.mjs` (DO-I; exists, 25 fixtures).
- `node tools/release/protocol-audit.mjs --all --json <evidence>`: at the freeze, exit status recorded as it is. Exit 1 is expected while the DG0–DG6 hits are disclosed. Each hit must be in the D-249 list or be a new DG7 finding.
- `node --test tools/gates/tests/*.test.mjs` (the validator tests, orchestrator).
- `node tools/gates/validate.mjs --stage DG7`, `--pipeline`, `--reconcile`.

### J.3 What the implementers must know

- No implementer edits `tools/gates/**`, a gate record, a review or `stages.json`. The protocol tooling reads; it never fixes a record (D-243 Q13).
- A disclosed historic hit is never described as fixed.

## §M. Slice M: release sealing (A28) and the final delivery report (T-DG7-ARCH-06; ADR-0073)

### M.0 Already delivered by the architect (do not re-create)

- `docs/architecture/adr/ADR-0073-p7-release-envelope-a28-sealing-verify-final-report-a26-a27-drills.md`: the two-step of l.621 (§1), the artefacts and paths (§2), the envelope list and manifest (§3), `seal.mjs` (§4), `verify-seal.mjs` (§5), the gate-system rules L1–L5 (§6), the final-report template and check (§7), the rehearsal (§8), outcomes (§9), the A26 and A27 drills (§10, §11).
- **No migration.** `0156`–`0157` stay free and are retired, never filled (D-245 O9).
- **No operation, no permission.** The contract stays at 965 operations. `apps/api/test/support/p7-pending.ts` is **finalized**: ARCH-06 adds no list, and the aggregate is frozen (p7-plan §5.3). Each implementer edits only its own `p7-pending-<task>.ts`.
- **Advisory locks:** 730420–730421 reserved, none allocated (registry comment, ADR-0016 §6 row).
- No ERD, data-dictionary or permissions-matrix change (slice M has no table and no permission).

### M.1 DO-J: seal, verify-seal, release notes and the final-report template (devops-engineer; W8; after ARCH-06 and DO-A)

**Creates:**

| File | Purpose |
| --- | --- |
| `tools/release/seal.mjs` | ADR-0073 §4: CLI and steps S1–S12, the seal report, exit codes and texts of §4.4. **Module API:** `seal(options) → Promise<{ ok, exit, report, envelopePath, payloadArchivePath }>` |
| `tools/release/verify-seal.mjs` | ADR-0073 §5: archive, repository and final-report modes, checks V1–V18, the verify report, the lines of §5.3. **Module API:** `verifySeal({ envelope, expectSha256, repo, finalReport, rehearsal }) → Promise<{ verdict: "PASS" \| "REHEARSAL-PASS" \| "FAIL" \| "BLOCKED", checks: { id, ok, status, detail }[] }>` |
| `tools/release/lib/envelope.mjs` | the §3.1 list from the gate records (no folder walk), the §3.4 manifest writer (key order, sorting), the §3.5 layout and the §3.6 README text as `ENVELOPE_README_TEXT` with `<version>` and `<payload hash>` placeholders |
| `tools/release/lib/gate-labels.mjs` | rules L1–L5 of ADR-0073 §6 as data plus `checkGateLabels({ gates, manifest, texts, demoTables })` |
| `tools/release/lib/final-report.mjs` | the §7.2 line patterns, the CAP-01…CAP-12 list, `checkFinalReport(text, { template, sealReport, isListed })` (V18) |
| `tools/release/release-notes.mjs` | ADR-0071 §5 (generator, `--check`, refusals), unchanged from that ADR |
| `docs/handover/final-report.template.md` | ADR-0073 §7.1, exact |
| `docs/handover/release-notes.md` | generated by `release-notes.mjs --write` from the register at DO-J's base; re-generated by AN-P7's run before the freeze (the register changes then); `--check` in the freeze verification |
| `tools/release/tests/seal.test.mjs` | T-M1–T-M8, T-M13 (the rehearsal cases R0–R13) |
| `tools/release/tests/verify-seal.test.mjs` | T-M9–T-M12 |
| `tools/release/tests/release-notes.test.mjs` | T-I11, T-I13 (fixture half) |
| `tools/release/tests/fixtures/seal/**` | synthetic fixtures: a demo-data table file with product gate rows (`gate_code` `G1`…), a synthetic gate-record set, a final report filled with synthetic values. Every fixture file carries `SYNTHETIC` in a field or first line |

**Modifies:** nothing outside the list. No `.gitignore` change (D-244 O6). No `deploy/ci/ci.yml` change: if DO-J wants a CI job for the seal tests, it hands over `tools/release/ci/seal-tests.job.yml` for the orchestrator to merge (§2 rule 9).

**Reads only:** `tools/release/{build-archive,secret-scan,claims-scan}.mjs`, `tools/release/lib/tar.mjs`, `apps/api/scripts/register-snapshot.mjs` (`parseRegister`, `parseDependencies`), `tools/gates/lib/candidate.mjs` (read-only import), `docs/delivery/gates/DG0.json`–`DG6.json` (T-M9's real-record run only, never written), `docs/delivery/requirements.csv`, `docs/handover/external-dependencies.json` (when DOC-B has created it; the Unknown line otherwise).

**Requests (handback):** the `docs/handover/README.md` index lines for `release-notes.md` and `final-report.template.md` (DOC-B owns the index, §2 rule 10).

**Boundary:** the tools never write under `docs/delivery/**` in the repository, never commit, and never read a delivery folder except through the gate records' named paths (D-138). Every run of the rehearsal happens in a sparse scratch clone under `$TMPDIR` (ADR-0073 §8.1), deleted at the end.

### M.2 Exact texts

All texts are the ADR's, quoted here so implementers copy one source:

| Tool | Exit | Line |
| --- | --- | --- |
| `seal.mjs` | 0 | `seal: sealed payload <hash>; payload archive sha256 <hex>; envelope archive sha256 <hex>` |
| `seal.mjs` | 0 | `seal: run verify-seal next; delivery is not complete until it passes` |
| `seal.mjs` | 1 | `seal: --candidate <id> is not the approved DG7 candidate <id>` |
| `seal.mjs` | 1 | `seal: the files at <commit> hash to <id>, not the approved <id>` |
| `seal.mjs` | 1 | `seal: the working tree payload differs from the approved candidate (<c> changed, <a> added, <r> removed); a payload change requires a new candidate and new reviews (master prompt l.621)` |
| `seal.mjs` | 1 | `seal: demo-data input hashes to <hex>, not the recorded <hex>` |
| `seal.mjs` | 1 | `seal: <scan> scan found <n> hit(s)` |
| `seal.mjs` | 1 | `seal: a release seal refuses a synthetic gate record: <path>` |
| `seal.mjs` | 1 | `seal: a rehearsal requires a synthetic DG7 gate record` |
| `seal.mjs` | 2 | `seal: BLOCKED: docs/delivery/gates/DG7.json does not exist; DG7 is not approved` |
| `seal.mjs` | 2 | `seal: BLOCKED: DG7 decision is <value>, not APPROVED` |
| `seal.mjs` | 2 | `seal: BLOCKED: missing <group> file <path>` |
| `seal.mjs` | 2 | `seal: BLOCKED: <path> is not committed or differs from HEAD` |
| `seal.mjs` | 2 | `seal: BLOCKED: missing --evidence <key>` |
| `seal.mjs` | 2 | `seal: BLOCKED: --evidence <key> must be a file under docs/delivery/test-evidence/DG7/` |
| `seal.mjs` | 2 | `seal: refused output path <path>: it would change the payload hash` |
| `seal.mjs` | 2 | `seal: BLOCKED: <out>/seal-report-<n>.json exists; a re-seal needs --reseal-reason` |
| `verify-seal.mjs` | 0 | `verify-seal: PASS` |
| `verify-seal.mjs` | 0 | `verify-seal: REHEARSAL-PASS (not a release verification; DG7 historical validation skipped: synthetic gate record)` |
| `verify-seal.mjs` | 1 | `verify-seal: <id> FAIL <detail>` (one per failed check), then `verify-seal: FAIL (<n> checks)` |
| `verify-seal.mjs` | 2 | `verify-seal: BLOCKED: <reason>` |
| `verify-seal.mjs` | 2 | `verify-seal: refused output path <path>: it would change the payload hash` |

**The statement** (seal report, verify report, envelope README, final report; ADR-0073 §4.6), exact:

> Sealing and its verification are engineering packaging checks. They grant no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6.

**The synthetic gate record's `notes` prefix** (rehearsal only), exact: `SYNTHETIC REHEARSAL RECORD: not a gate decision. Written by the DG7 seal rehearsal in a scratch clone; it approves nothing.`

**The final-report template:** ADR-0073 §7.1, byte for byte. Its section 2 is M0074 verbatim.

**The envelope README:** ADR-0073 §3.6, byte for byte.

### M.3 Tests (each line states what it proves; all `node --test`, run as `node --test tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs`)

| Id | File | Proves |
| --- | --- | --- |
| T-M1 | `seal.test.mjs` | The sparse scratch clone (ADR-0073 §8.1) has the same `candidate.mjs --stage DG7` id as the repository at that commit. |
| T-M2 | `seal.test.mjs` | R0: a rehearsal seal and verify on the synthetic DG7 record exit 0, the verify line is `REHEARSAL-PASS`, V16 records DG7 `SKIPPED`, and the repository's `git status --porcelain` is unchanged by the whole test. |
| T-M3 | `seal.test.mjs` | The envelope `.tar` bytes are identical across two seals of the same inputs (no clock in the manifest), and `ENVELOPE-MANIFEST.json` has the §3.4 key order and sorted arrays. |
| T-M4 | `seal.test.mjs` | R8, R9, S1 missing record, S1 not APPROVED, missing `--evidence` key, evidence outside `test-evidence/DG7/`, uncommitted envelope file: each exits with its §M.2 line and code. |
| T-M5 | `seal.test.mjs` | R11 and the re-seal rule: a payload output path exits 2; an existing seal report without `--reseal-reason` exits 2; with it, sequence `n+1` is written and the earlier report is unchanged. |
| T-M6 | `seal.test.mjs` | S5/V14: a release seal refuses a synthetic record; a rehearsal seal refuses a missing synthetic marker on DG7 and a marker on DG0–DG6. |
| T-M7 | `seal.test.mjs` | S7: a demo-data input with one changed byte is refused with the §M.2 line. |
| T-M8 | `seal.test.mjs` | S10: a planted secret (assembled at run time from fragments, §2 rule 6) in an envelope-listed file and a planted claim in the payload `docs/` each fail the seal. |
| T-M9 | `verify-seal.test.mjs` | L1–L4 pass on the real `docs/delivery/gates/DG0.json`–`DG6.json` (read-only). A hit is reported in the handback, not fixed (D-243 Q13). |
| T-M10 | `verify-seal.test.mjs` | R1–R7 and R10: each tampering case fails exactly the checks the ADR names, with the recorded `--expect-sha256` kept; a variant that recomputes the checksum still fails the content checks. |
| T-M11 | `verify-seal.test.mjs` | V16 spawns `validate.mjs --historical` per gate and records exit codes; a non-zero exit fails V16; it is never reported PASS when it did not run (BLOCKED with the reason). |
| T-M12 | `verify-seal.test.mjs` | R12 and V18: every §7.3 rule has a failing fixture (placeholder left, section 2 altered, CAP missing, CAP twice, evidence missing, evidence a directory, evidence not listed, checksum mismatch, seven gate lines, L4 hit); the filled synthetic report passes; the template's section 8 guide paths exist in the tree (a missing guide fails and is reported to the orchestrator). |
| T-M13 | `seal.test.mjs` | R13: after a rehearsal seal, `candidate.mjs --stage DG7` in the clone prints the unchanged id. |
| T-M14 | the handback | `git --version` and a `git sparse-checkout set --no-cone` run, with exit codes, so the drills' and rehearsal's git features are shown to exist on this host. |
| T-I11, T-I13 | `release-notes.test.mjs` | ADR-0071 §9 (fixture half of T-I13). |

### M.4 Seams with other slices

| Seam | Rule |
| --- | --- |
| **A (DO-A)** | `seal.mjs` calls `buildArchive` and `verifyArchive`, never re-implements them; the tar of the envelope uses `lib/tar.mjs`. A defect in them found by DO-J goes to the handback, not into DO-A's files. |
| **G (DO-B)** | `scanSecrets({ scope: "envelope", list })` gets the manifest's path list as a JSON array (`readList`); `scanClaims({ roots })` gets the extracted payload `docs/`. Allow-list entries for envelope-only files are DO-B's file; DO-J requests them in its handback. |
| **C (BE-C)** | The sealing input is the ADR-0064 export (`sourceEnvironment` `demo`), kept per ADR-0073 §3.3. L5 reads `demo-data/tables/*.ndjson` rows. |
| **I/H (BE-H, DOC-B)** | `parseRegister` from `register-snapshot.mjs`; `release-notes.md` feeds the final report's sections 6 and 7; the template names the DOC-B guides. |
| **J (DO-I)** | The `protocol-audit` evidence key is the orchestrator's DG7 run at the freeze (D-249). |
| **K, L** | The `A26`, `A27`, `A18`, `A19` and `test-level-index` evidence keys are the drill and QA reports of §K and §L. |

### M.5 Integration order

1. ARCH-06 (this) is merged.
2. DO-J (W8) builds the tools, the template and the release notes, and runs the rehearsal in a sparse scratch clone.
3. AN-P7 (W12) re-generates `release-notes.md` with `--write` after its register update; the freeze verification runs `release-notes.mjs --check`.
4. Freeze verification (orchestrator): the demo-data sealing input and its record (ADR-0073 §3.3); `protocol-audit --all --json`.
5. DG7 reviews and audit. Then the seal, verify and final report (ADR-0073 §1 steps 4–6).

### M.6 Requirement → clause → test → owner

| Requirement | Clause | Test or check | Owner |
| --- | --- | --- | --- |
| REQ-DLV-041 | "all eight gate records … present and match their checksums" | V3, V6; T-M10 (R2) | DO-J; orchestrator (real run) |
| REQ-DLV-041 | "the ten agent definitions" | V8; T-M10 (R3) | DO-J; orchestrator |
| REQ-DLV-041 | "the register and the findings" | V9, V10; T-M10 (R4) | DO-J; orchestrator |
| REQ-DLV-041 | "the payload hash equals the DG7 candidate ID" | S3, V4, V5; T-M4 (R9), T-M10 (R1) | DO-J; orchestrator |
| REQ-DLV-041 | "no DG record is confused with G1-G6" | V12 (L1–L5); T-M9, T-M10 (R5–R7) | DO-J; orchestrator |
| REQ-DLV-041 | "record the payload hash and archive checksum separately" | seal report fields `payloadHash`, `envelopeArchive.archiveSha256`; V1, V17; T-M3 | DO-J; orchestrator |
| REQ-DLV-041 | "a sealing failure blocks delivery and a payload change requires new candidate reviews" | S4/S12 l.621 text; ADR-0073 §9; T-M4 (R8), T-M13 | DO-J; orchestrator |
| REQ-DLV-041 | "completes-after-gate:" (D-243 Q19) | the real seal and `verify-seal: PASS` after approval | orchestrator |
| REQ-S20-028 | "seal the handover with all eight gate records, agent definitions, requirement coverage and findings" | S6, S9; V3, V6, V8, V9, V10 | DO-J; orchestrator |
| REQ-S20-028 | "verify package integrity" | V1–V4, V13 | DO-J; orchestrator |
| REQ-S20-028 | "keep these records distinct from product gates G1–G6" | V12; the §4.6 statement in every output | DO-J |
| REQ-S20-028 | "must pass before delivery is declared complete" | ADR-0073 §9.3 (declaration only after `verify-seal: PASS`) | orchestrator |
| REQ-DLV-031 | "the final delivery report contains the limitation statement" | V18 rule 2 (section 2 byte-equal, M0074 verbatim); T-M12 | DO-J; orchestrator |
| REQ-DLV-031 | "links each claimed capability to an executed check" | V18 rules 3–5; T-M12 | DO-J; orchestrator |
| REQ-S20-026 | A26 drill | §K.1 procedure; `drill-report.md` | orchestrator |
| REQ-S20-027 | A27 drill | §K.2 procedure; `drill-report.md` | orchestrator |

### M.7 What the implementers must know

- The rehearsal **never** writes `docs/delivery/gates/` or any delivery record of the repository. Its DG7 record is synthetic, labelled, and exists only in the scratch clone.
- `REHEARSAL-PASS` is not `PASS`. A rehearsal never counts as A28.
- A check that could not run is BLOCKED with its reason (for example V16 in the sparse clone, ADR-0073 Residual 2), never PASS.
- Sealing grants nothing. No output of these tools may state or imply a business, Finance or IT approval (L4 applies to the tools' own texts).
- Disk is tight: use only sparse clones (ADR-0073 §8.1) and delete them in the test's `after` hook.

## §K. Slice K: the A26 and A27 drills and the test-level index (T-DG7-ARCH-06; ADR-0073 §10–§11)

### K.0 Who runs what

- **A26 and A27 are orchestrator drills** (p7-plan §1.2, D-243 Q18). No implementer task owns them. The agent runs inside A26 are scheduled in the four-run budget of D-004.
- **REQ-S20-031's test-level index** is QA-D's (p7-plan §5.1), in `docs/delivery/test-evidence/DG7/qa/`. It is the seal's `--evidence test-level-index=` input.
- Evidence for A26 and A27 goes to `docs/delivery/test-evidence/DG7/orchestrator/{a26,a27}/` (orchestrator-writable only). `drill-report.md` in each is the seal's `--evidence A26=` / `A27=` input.

### K.1 The A26 procedure (REQ-S20-026)

ADR-0073 §10, steps K1–K8. In short:

1. K1 branch `drill/dg7-a26` at the recorded base, in a sparse worktree outside the repository directory.
2. K2 defect card written; **only its SHA-256** goes to `progress.md` before any reviewer run.
3. K3 one neutral-message commit plants a minimal server-side defect (recommended: a mutation route checks a read permission instead of its write permission); drill candidate id computed without `--freeze`.
4. K4 at least code-security-reviewer and qa-verifier run with `--cwd <worktree>`; findings go to drill-local `drill-findings.json` in their own evidence directories, never `findings.json`.
5. K5 card published and its hash checked; pass only if a finding names the defect's file and behaviour; a miss is recorded and the drill repeated.
6. K6 an implementer of the owning role fixes it with a regression test that fails on the defect and passes on the fix.
7. K7 a K4 reviewer re-runs the test and records the verification.
8. K8 `drill-report.md`; worktree removed; branch kept, never merged.

**Precondition P-K1:** before K4 the orchestrator checks where `run-agent.sh` copies staged review records back to, and where it auto-commits, when `--cwd` is a worktree (`tools/agents/agent_sandbox.py` `prepare`/`finish`). If the target is the main repository's `docs/delivery/reviews/DG7/`, K4 waits for an orchestrator tooling decision.

### K.2 The A27 procedure (REQ-S20-027, REQ-DLV-030)

ADR-0073 §11, steps K9–K15, on the real checkpoint `d8868b2a5c074b13c04693a88644c25ef2792583` (DG6 `FIXING`, frozen `sha256:5e819f7a579dbf98eb78f7f8e326a7ad57d939ed6a0762e3bea912f6dc735ed6`, rounds 5–6 recorded, working tree changed by D-240):

| Step | Command or action | Expected |
| --- | --- | --- |
| K9 | sparse scratch clone at the checkpoint | candidate id of the clone printed |
| K10 | `node tools/gates/validate.mjs --reconcile` | `active stage: DG6 (FIXING)`; `working tree: … (differs: …)`; every round-5 and round-6 record `(STALE for current content)` |
| K11 | reconstruction from `progress.md`, `stages.json`, assignments without handbacks, open findings | the next action equals the one taken (round 7 on the new candidate) |
| K12 | `node tools/gates/validate.mjs --stage DG6`; `--pipeline` | the first exits non-zero; the second shows no stage past DG5 approved |
| K13 | session ids of the runs after the checkpoint | each new, none reused |
| K14 | `node --test tools/gates/tests/validator.test.mjs` on the DG7 tree | exit 0 |
| K15 | `drill-report.md` mapping A27's four clauses to K10–K14; clone deleted | — |

### K.3 Requirement → clause → evidence

| Requirement | Clause | Evidence | Owner |
| --- | --- | --- | --- |
| REQ-S20-026 | "Introduce a known defect in a controlled test branch" | K1–K3; the defect-card hash in `progress.md` before K4 | orchestrator |
| REQ-S20-026 | "independent reviewers identify it" | K4–K5; reviewer drill-local findings | orchestrator; code-security-reviewer, qa-verifier |
| REQ-S20-026 | "the implementer fixes it" | K6; handback | the owning implementer role |
| REQ-S20-026 | "independent rechecks/regression tests prove closure" | K6 (fail on defect, pass on fix), K7 | a K4 reviewer |
| REQ-S20-027 | "Resume from a checkpoint; reconstruct current stage/tasks/evidence" | K9, K11 | orchestrator |
| REQ-S20-027 | "reject stale reviews" | K10 | orchestrator |
| REQ-S20-027 | "continue without inventing approvals or requiring routine user confirmation" | K12, K13, K15 | orchestrator |
| REQ-DLV-030 | "the reconcile report flags a review whose candidate no longer matches, work continues from progress.md, and no approval appears without a review record" | K10, K11, K12 | orchestrator |
| REQ-S20-031 | "for each gate, test-evidence contains unit, integration, e2e and visual results … and no check is reported passed without an executed command" | QA-D's index (`test-evidence/DG7/qa/`) | qa-verifier (QA-D) |

## §L. Slice L: final verification and its inputs to the seal (T-DG7-ARCH-06)

### L.0 Scope

Slice L is what DG7 approves (p7-plan §1.1): A01–A27 on the DG7 candidate (QA-B, QA-C, QA-D), the offline clean-environment demonstration (slice B drills), and the release-blocker list (ADR-0071 §6). This section only fixes how those results become seal inputs. It adds no test.

### L.1 What the seal takes from slice L

| Evidence key | Source | Path rule |
| --- | --- | --- |
| `A18` | QA-C's independent re-run of the transfer and offline drills | a file under `docs/delivery/test-evidence/DG7/qa/` named by QA-C's record |
| `A19` | QA-C's independent re-run of the backup and restore drill, with timings | as above |
| `test-level-index` | QA-D's per-gate index (REQ-S20-031) | as above |
| `A26`, `A27` | §K drill reports | `docs/delivery/test-evidence/DG7/orchestrator/{a26,a27}/drill-report.md` |
| `protocol-audit` | the orchestrator's `protocol-audit --all --json` at the freeze (D-249) | `docs/delivery/test-evidence/DG7/orchestrator/` |

A required key with no report refuses the seal (exit 2). An evidence report whose check did not pass may still be sealed (it is evidence), but the corresponding CAP line of the final report then goes to "not claimed" with its reason (ADR-0073 §7.2), and an unmet mandatory criterion is a release blocker (l.627).

### L.2 Requirement → clause → evidence

| Requirement | Clause | Evidence | Owner |
| --- | --- | --- | --- |
| REQ-DLV-039 | "all eight gate reports are included" | V6, V7 of the seal (ADR-0073 §5.2); `completes-after-gate:` | orchestrator |
| REQ-DLV-039 | the release-blocker list | the release notes' section (ADR-0071 §6); the final report's section 6 | DO-J; orchestrator |
| REQ-S21-004 | A02, A06, A18, A23 on the DG7 candidate | QA-B, QA-C records; CAP-01, CAP-04, CAP-11 | qa-verifier |
