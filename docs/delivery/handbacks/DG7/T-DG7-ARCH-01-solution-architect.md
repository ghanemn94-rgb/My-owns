# Handback: T-DG7-ARCH-01 (solution-architect): slices A + G

- **Stage:** P7 / DG7 (BUILDING). **Branch:** `claude/mobily-transformation-platform-dg6-regate`. **Base:** `fe690c01768fb65370c257c80ac8a55e807f9525`. `git status` at the start showed only this run's own `docs/delivery/runs/DG7/…17c855f0/`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-01.md`. Its SHA-256 `c2dadeb567753408685efec3b6b4613535017e47f265a9d75f9b8f13b664306f` was verified with `sha256sum` before starting.
- **Invocation:** run `DG7-T-DG7-ARCH-01-solution-architect-20261112T125502Z-17c855f0`, session `17c855f0-9d1d-4a09-b9fb-f2375006954f`.
- **Time:** `date -u` gave 2026-11-12T12:58:14Z at the start, and 13:21:31Z after the final check. About 23 minutes, well inside the 2-hour budget. Nothing was cut for time.

## 1. `--historical` result (run before any write)

`node tools/gates/validate.mjs --historical --stage DG6` printed `PASS gate DG6 (historical)` and **exited 0**. Evidence: `docs/delivery/handbacks/DG7/T-DG7-ARCH-01-evidence/historical-DG6.txt`.

## 2. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0062-p7-release-archive-reproducible-offline-build-sbom-procurement-asset-scan.md` | **ADR-0062**: the release artefacts; the archive layout by artefact (D-243 Q2); the deterministic tar and gzip; `SHA256SUMS`, `ARCHIVE-MANIFEST.json` and `--verify`; the build from the archive inside a network namespace; the offline store (mirror plan); the service list and its Compose check; the procurement flag and the direct-dependency check; the asset scan (rules R1–R6 × targets T1–T3, allow-list, self-test); tests T-A1…T-A11; residuals; version evidence (no new dependency) |
| `docs/architecture/adr/ADR-0063-p7-secret-hygiene-claims-scan-security-controls-evidence.md` | **ADR-0063**: the secret scan (scopes payload, history, path and envelope; rules S1–S6; allow-list with protected paths); the placeholder-only template rule; the claims scan (K1 = the DG5 PMI rule reused; K2–K4 with negation; protected paths); the controls matrix format (Section 1 product controls SC-01…17 with tests, Section 2 hosting responsibilities HR-01…07 for TLS, encryption and network); tests T-G1…T-G9; residuals |
| `docs/architecture/p7-work-split.md` | **New file**: the common header, §1 how to read, §2 shared P7 rules (10), §A (DO-A) and §G (DO-B): exact file ownership, module APIs, seams, exact texts and messages, test lists, integration order, and requirement → clause → test → owner tables for all seven requirements |
| `tools/release/lib/patterns.mjs` | The shared key-shape list (`KEY_SHAPES`, `keyShapeRegExps`, `mask`). Delivered by the architect so that DO-A and DO-B, who run concurrently in W2, share no writable file (REQ-DLV-008). Frozen after ARCH-01 |
| `tools/release/tests/patterns.test.mjs` | Self-test of `patterns.mjs`: 5 tests. Planted values are built from fragments, and the module's own source is checked to contain no key shape |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-01-evidence/{historical-DG6,release-tests,prettier}.txt` | Command logs for §1 and §4 |
| this handback | — |

**Not changed**, as the assignment asked:

- no migration: `0131`–`0132` are reserved and unused;
- no advisory lock: 730400–730401 are reserved and unused;
- no operation in `docs/api/openapi.yaml`;
- no permission, i18n key or product module;
- no runtime or development dependency.

## 3. Behaviour delivered, per requirement

This is architecture: specifications plus one shared seam module. **No requirement is implemented by this task.** Each one is specified, mapped clause by clause to a test, and given an owner (work split §A.6 and §G.6).

| Requirement | Specified in | Clauses → tests | Owner |
| --- | --- | --- | --- |
| REQ-S19-001 | ADR-0062 §1–§4 | checksum matches → T-A2 (+ A28 at seal); separate app/infra/docs/demo-data → T-A2, T-A3; archive from the approved commit → T-A1, T-A4 | DO-A; DO-J/orchestrator |
| REQ-S19-002 | ADR-0062 §5 | clean build from the archive with no network → T-A5, then re-run by DO-D and QA-C | DO-A; DO-D; QA-C |
| REQ-S19-003 | ADR-0062 §6, §7 | SBOM lists every runtime dependency with licence → T-A7; service list matches Compose → T-A6 | DO-A |
| REQ-S16-009 | ADR-0062 §7 | every direct dependency pinned and listed with its licence → T-A8; procurement flagged → T-A9 | DO-A |
| REQ-S19-019 | ADR-0062 §8 | asset and configuration scan → T-A10, T-A11; offline e2e → DO-E (ADR-0069) | DO-A; DO-E |
| REQ-S16-031 | ADR-0063 §1, §2, §4.3 | no secrets in the repository → T-G1, T-G2 (payload and history); template placeholders only → T-G3; CI blocking → job fragment plus `check-ci-needs` (static); TLS and encryption → matrix §2 plus DOC-B's link | DO-B; orchestrator; DOC-B |
| REQ-S16-033 | ADR-0063 §3, §4 | no compliance or certification claim in docs and UI strings → T-G4, T-G5, T-G6 (+ A28 at seal); matrix links each control to a test → T-G7, T-G8 | DO-B; DO-J/orchestrator |

## 4. Checks actually run

Environment: agent sandbox, offline, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm 10.33.0, GNU tar 1.35, bubblewrap 0.9.0, util-linux 2.39.3.

| Command | Result |
| --- | --- |
| `sha256sum docs/delivery/assignments/DG7/T-DG7-ARCH-01.md` | `c2dadeb5…664306f`, equal to the assignment's value |
| `node tools/gates/validate.mjs --historical --stage DG6` | `PASS gate DG6 (historical)`, **exit 0** |
| `node --test tools/release/tests/*.test.mjs` | 5 tests, 5 pass, 0 fail, **exit 0** (`release-tests.txt`) |
| `node --test tools/release/tests/` (a directory argument) | **exit 1**, "test failed". Node 24 does not run a directory argument. Recorded to justify the glob form now written in ADR-0062 §9.1 and work split §2 rule 3 |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | "All matched files use Prettier code style!" for every batch, **exit 0** (`prettier.txt`). **Disclosure:** `.prettierignore` lists `docs/` and `tools/`, so the new ADRs, the work split, this handback and `tools/release/**` are ignored by this check, not format-verified by it. A direct `npx prettier --check` on the five new files also printed "All matched files use Prettier code style!" (exit 0), but the same ignore file applies there too. Re-run on the final tree at 2026-11-12T13:21Z: exit 0 |
| Network-namespace feasibility for ADR-0062 §5.1: `unshare --user --map-root-user --net node -e '…connect 1.1.1.1:443…'` and `bwrap --dev-bind / / --unshare-net node -e '…'` | Both printed `ENETUNREACH`, so both mechanisms work here. The agent sandbox has no network anyway, so this proves feasibility, not isolation |
| `node -e` gzip header probe | Header `1f8b0800000000000203` (mtime 0, OS byte 3), zlib `1.3.2.1-motley-8002e91`. This is the basis for ADR-0062 §3 setting the OS byte to 255 |
| A key-shape self-scan of the two ADRs and the work split with `patterns.mjs` | 0 hits |
| An ad-hoc grep of the same files for claim phrasing (K1 PMI pattern and K2/K4-like phrases) | Three un-negated PMI phrasings in ADR-0063 were found and rephrased. Every remaining hit is negated. **This is not T-G6.** The real claims scan does not exist yet (DO-B) |

**Not run:** none of T-A1…T-A11 or T-G1…T-G9. The tools they test are DO-A's and DO-B's deliverables. No `pnpm lint` was run, because no linted product file changed.

## 5. Known gaps and open questions

Nothing assigned is undone. The questions below need an orchestrator decision or another ARCH task, and each quotes its source.

- **O1. The directory name `source/` vs the acceptance text "app".**
  - REQ-S19-001's acceptance reads: "the archive contains separate app, infra, docs and demo-data directories". The adopted plan (p7-plan §6 Q2, D-243 "Q2 archive by artefact") names the directory `source/`.
  - ADR-0062 keeps `source/` and records `role: "app"` in the manifest. The verifier checks roles.
  - If the orchestrator or a reviewer prefers the literal name, renaming it to `app/` is a one-constant change in DO-A's `build-archive.mjs`, with no other consequence. Please decide before DO-A starts.
- **O2. `demo-data/` and ADR-0064 (ARCH-02).** ADR-0062 §2.1 needs two things from the migration-manifest format:
  - the name of the environment-marker field (DO-A's fixture uses `sourceEnvironment`, which must equal `demo`);
  - the ADR-0050 demo checksum carried in the manifest (`demoChecksum`), because the seed writes `now()` timestamps (ADR-0050 §4: the checksum leaves out "every column whose default is `now()`"), so the bytes of two exports differ.

  Please pass both to ARCH-02's assignment.
- **O3. Where the sealed `demo-data/` input is kept (ARCH-06).** The payload archive is "a pure function" of the candidate **and** the `demo-data` input (ADR-0062 §3). The seal must use the input recorded at the freeze, identified by its `inputSha256`. Where that directory lives between the freeze and the seal (it is large and not in the candidate) is for ADR-0073.
- **O4. Same-wave CI edits.** p7-plan §5.3 says DO-A and DO-B edit the CI files "sequential by wave", but §5.2 puts both in W2. The work split resolves it: DO-A owns `deploy/ci/ci.yml` and `.github/workflows/ci.yml` in W2, and DO-B hands over `tools/release/ci/secret-scan.job.yml` for the orchestrator to merge. Please confirm, or run DO-B after DO-A.
- **O5. HR-02 database TLS.** No product code configures database TLS. `DATABASE_URL` is passed to the driver as given (ADR-0063 Context 6). T-G9 tests the `sslmode` integration point against a scratch TLS cluster, or reports BLOCKED. If it is BLOCKED, REQ-S16-031's "integrate TLS and database/storage encryption with the hosting environment" rests on documentation for the database leg. That is disclosed, not claimed.
- **O6. The plan's `.gitignore` line for `dist/release/`** (p7-plan §5.1, DO-J) is unnecessary, because `.gitignore` already has `dist/`. The work split tells implementers not to add it. Please drop it from DO-J's assignment.
- **O7. `REQ-S16-0xx` in matrix row SC-01.** Its register id is left to DO-B to fill from the register. T-G7 fails on an id that does not exist, so it cannot stay a placeholder.

## 6. Merge instructions

- **No migrations, no ordering constraints, and no conflicts expected.** All files are new.
- **`docs/architecture/p7-work-split.md` is a shared file** (p7-plan §5.3). Later ARCH tasks append their own sections (§C/D, §E, §B/F, §I/H, §M) and must not edit §1, §2, §A or §G without the orchestrator.
- **`tools/release/lib/patterns.mjs` is frozen after this merge.** DO-A and DO-B import it and do not edit it.
- **DO-A and DO-B can start in W2 once this is merged,** after the orchestrator answers O1 and O4.
