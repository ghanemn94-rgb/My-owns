# Handback T-DG7-ARCH-04 (solution-architect): slices B + F (clean deployment, offline runtime, transfer drill; schema, API and connector handover)

- **Stage:** P7 / DG7 (BUILDING). **Branch:** `claude/mobily-transformation-platform-dg6-regate`. **Base:** `a5e67854ca2296d1385040f2786d46afe963e596` (`git rev-parse HEAD` at start; `git status` clean except this run's own `runs/` directory).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-04.md`, SHA-256 `d374b397cac62ae8468cc7fba3f38d1312e2aa92e416f407a0803dc652b99be2` (re-hashed at start; equal).
- **Invocation:** run `DG7-T-DG7-ARCH-04-solution-architect-20261112T183108Z-a91293b2`, session `a91293b2-549e-4e6a-97ed-277be7214e6b`.
- **Time:** `date -u` at start 2026-11-12T18:34:03Z. The last check finished at 18:56:08Z, and this handback was written after that. About 25 minutes, well inside the 2-hour budget.
- **Historical validator at start:** `node tools/gates/validate.mjs --historical --stage DG6` printed `PASS gate DG6 (historical)` and exited **0** at 18:34Z, before any write. It was re-run mid-task with the same result (`T-DG7-ARCH-04-evidence/validate-historical-DG6-midrun.log`), and again at the end (§3.8).
- **Two gate systems.** Nothing here grants or records a business, Finance or IT approval. Product gate G6 is not DG7.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0069-p7-clean-deployment-base-url-readiness-transfer-offline-image-drills.md` (new) | Slice B: base-URL rules (origin change; no stored hub URL; sub-path not supported, measured), readiness `storage` (gates) and `worker` (reported), `getDeploymentStatus`, the transfer drill D0–D11, the offline drill, the image bundle, Compose up, no target manifests, the per-clause agent/orchestrator split, residuals |
| `docs/architecture/adr/ADR-0070-p7-schema-api-connector-handover-dictionary-coverage-openapi-completeness.md` (new) | Slice F: dictionary coverage rule against a migrated database, ERD scope, OpenAPI completeness with no skip list, generated connector handover with a parity test, `docs/handover/{data,api}/` layout |
| `docs/architecture/p7-work-split.md` | Appended **§B** and **§F** only (owners, files, seams, exact EN/AR texts, tests T-B1…T-B14 and T-F1…T-F8, requirement → clause → test → owner tables). §1, §2, §A, §G, §C, §D and §E are untouched. |
| `docs/api/openapi.yaml` | Tag `deployment`; `getReadiness` description and the optional `checks.storage` / `checks.worker`; `GET /api/v1/admin/deployment` `getDeploymentStatus` with the schema `DeploymentStatus`. 961 → **962** operations. |
| `apps/api/test/support/p7-operations.ts` | the ARCH-04 block (`getDeploymentStatus`) |
| `apps/api/test/support/p7-pending-arch-04.ts` (new), `p7-pending-be-b.ts` (new), `p7-pending.ts` (one import, one spread) | the D-245 shared-file pattern; BE-B's list is `["getDeploymentStatus"]` |
| `apps/api/test/integration/contract/contract.test.ts` | count pin 961 → 962, with its comment line (the ARCH-02/03 precedent) |
| `apps/api/src/modules/platform/advisory-locks.ts` | comment: 730416–730417 reserved, none allocated |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 row 730416–730417 (reserved) and the block note |
| `docs/architecture/erd.md` | §1ae "P7 slices B and F: no new entity" |
| `docs/architecture/data-dictionary.md` | appended "P7 slices B and F (no migration)": the coverage rule and the tables slice B reads |
| `docs/analysis/permissions-matrix.md` | §32 (readiness public; `getDeploymentStatus` → `operations.read`; no new code) |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-04-evidence/*` | `netns-loopback.txt` (measurement behind ADR-0069 Context 5), `integration-targeted.log`, `typecheck.log`, `lint.log`, `openapi-lint.log`, `validate-historical-DG6-midrun.log` |

**Not changed, and why:**

- **No migration.** The `0150`–`0152` range is unused (the assignment said "none expected"). Slices B and F add no table.
- **No `P7_PERMISSIONS` addition** (§4 O1).
- **No Kysely types or catalogue pins.** No schema changed.
- **No guard probe.** There is no new guard to probe. The existing guard probes (`p7-retention-guards`, `p7-transfer-guards`, `protection`, `catalogue`) ran green on the disposable cluster (§3.4).

## 2. Behaviour delivered, per requirement

These are architecture deliverables: decisions, the contract and test plans. **No product behaviour is implemented in this task.** BE-B, DO-D, DO-E, DO-H, DOC-B, QA-A and QA-C implement it.

| Requirement | Delivered here |
| --- | --- |
| REQ-S01-001 | ADR-0069 §4 (D0 build from the archive, D1–D11) and §7; work split B.8 rows |
| REQ-S01-006 | ADR-0069 §1 (origin rules, T-B3 scan, sub-path limitation), §4 D3/D7/D8 inside `bwrap --unshare-net` |
| REQ-S16-008 | ADR-0069 §7 (orchestrator Compose up, HA statement, Q12 no target manifests) |
| REQ-S19-009 | ADR-0069 §4 D3 (`config-trace.json`: template plus guide sections only; synthetic secrets) |
| REQ-S19-010 | ADR-0069 §2 and the contract change (`storage` gates; `worker` reported, P6 vocabulary); `getDeploymentStatus` |
| REQ-S19-017 | ADR-0069 §4 D5–D10 (counts and checksums, evidence downloads under the new origin, workflows, rebind, full restart) |
| REQ-S19-018 | ADR-0069 §5 (offline lifecycle e2e with the connection log) and §6 (image bundle, `--pull never`) |
| REQ-S20-018 | ADR-0069 §4; B.6 A18 seam for QA-A/QA-C |
| REQ-S19-005 | ADR-0070 §1 (coverage rule), §1.2 (bootstrap re-proved in D4, Q15) |
| REQ-S19-007 | ADR-0070 §2 (OpenAPI completeness: no pending entry, no `.skip`/`.todo`/`.only`, count pin) and §3 (`authentication.md`, `connectors.md`) |
| REQ-S17-004 | ADR-0070 §3 (generated endpoint and credential list, parity with `environment.md`, "not verified") |

## 3. Checks actually run

**Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm, offline. Disposable PostgreSQL **16.15** through `tests/qa/support/with-pg.sh` (port 25411, UTF8, C locale). `LC_ALL= LANG=` for the vitest run.

### 3.1 Historical validator

`node tools/gates/validate.mjs --historical --stage DG6` → `PASS gate DG6 (historical)`, **exit 0**, at start, mid-run and at the end.

### 3.2 OpenAPI lint

```text
$ pnpm openapi:lint
PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 962 operations
EXIT=0
```

### 3.3 Typecheck and lint

| Command | Exit | Tail |
| --- | --- | --- |
| `pnpm -r typecheck` | **0** | `apps/api typecheck: Done` (`typecheck.log`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | **0** | no output after the header (`lint.log`) |

### 3.4 Integration on a disposable PostgreSQL (migrations and contract)

The command was:

```text
LC_ALL= LANG= QA_PG_PORT=25411 tests/qa/support/with-pg.sh npx vitest run --project integration \
  packages/db/test/integration apps/api/test/integration/contract \
  apps/api/test/integration/aud-write-deny.test.ts apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts \
  apps/api/test/integration/access/sensitive-reference-inventory.test.ts \
  apps/api/test/integration/access/sensitive-reach-sweep.test.ts \
  apps/api/test/integration/text-scan/seeded-texts.test.ts apps/api/test/integration/identity.test.ts \
  apps/api/test/integration/hardening/route-inventory.test.ts apps/api/test/integration/hardening/integrity-sweep.test.ts
```

It exited **0** on the first run: `Test Files 28 passed (28)`, `Tests 705 passed (705)` (`integration-targeted.log`). This includes:

- `migrate.test.ts` (every shipped migration on a fresh database) and `catalogue.test.ts` (47);
- `p7-retention-guards.test.ts` (15) and `p7-transfer-guards.test.ts` (11);
- `contract.test.ts` (105 tests, count **962**);
- `response-validation.test.ts`: "932 of 932 live operations (30 pending excluded)", meaning 962 − 30 pending (19 + 10 + 1);
- the AUD sweeps.

### 3.5 Prettier

`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: the result is in §3.8. It was run after this handback was written.

### 3.6 Claims and secret scans over the new texts

| Command | Exit | Output |
| --- | --- | --- |
| `node tools/release/claims-scan.mjs` (repository scope) | **0** | `claims-scan: PASS (814 files; D 110, U 704; negated 26; allowed 19)` |
| `node tools/release/claims-scan.mjs --root $TMPDIR/cs` (copies of ADR-0069, ADR-0070 and `p7-work-split.md`) | **1** | one hit: `p7-work-split.md:66` "No P7 document … states or implies conformity to a standard, a certification …". That is ARCH-01's §2 rule 8, allow-listed by its repository path (D-247 O2), so the allow-list cannot match in a temporary copy. **No hit in ADR-0069, ADR-0070 or §B/§F.** |
| `node tools/release/secret-scan.mjs --path <ADR-0069> --path <ADR-0070> --path docs/architecture/p7-work-split.md --path docs/api/openapi.yaml` | **0** | `secret-scan: PASS (path; 4 files; allowed 0; canary (documented) 0)` |

### 3.7 Measurement behind ADR-0069 Context 5

`netns-loopback.txt`:

- `bwrap --dev-bind / / --unshare-net`: egress to `1.1.1.1:443` gives `ENETUNREACH`, and loopback works. Exit 0.
- `unshare --user --map-root-user --net`: loopback gives `ENETUNREACH`. Exit 1.
- `ip` is not installed.

### 3.8 End-of-task checks

See the appended lines at the end of this file. They are written after the commands run, with their real exits.

## 4. Open questions (with sources) and decisions taken inside the assignment

- **O1. Permission for `getDeploymentStatus`.** I reused `operations.read` (ADM_TECH, TO, KDS, TD, AUD) instead of adding a code.
  - Why: a new code needs a seed migration. A file `0150` would force the pending implementer migrations of slices C, D and E (`0136`–`0149`) to renumber above it (D-245 O9: "the runner refuses an id below the highest applied one"; D-248 O8).
  - The assignment says "migrations from your range `0150`–`0152` (none expected)".
  - **Decision needed** only if the orchestrator wants a dedicated `deployment.read` (ADM_TECH, AUD). That would be an orchestrator repair migration after slices C–E have landed.
- **O2. DG1 reopen record (seam 1).** Gating readiness on storage changes DG1-approved behaviour (p7-plan §3 seam 1: "Making readiness fail on storage … is a reopen candidate (DG1)"), and D-243 Q6 decided it. ADR-0069 §2 states the reason. **The orchestrator records the reopen in DG1's history** (REQ-S21-002); `stages.json` is outside my write scope.
- **O3. Worker vocabulary.** The plan suggested `ok`/`stale`. I used P6's `alive|stale|unknown` (`WorkerHeartbeatStatus`), so the same state has one name, and `unknown` (no beat ever) is never green.
- **O4. `compose.transfer.yaml` is not planned.** p7-plan §5.1 gives DO-D "`deploy/compose/compose.transfer.yaml` overlay with a different base URL". D-243 Q1 lists the orchestrator's container halves as "Compose up on a clean host, image load without a registry, Keycloak e2e", which does not include the transfer. The different origin is proven container-free (ADR-0069 §4). B.2 says DO-D writes the overlay only if the orchestrator asks for it.
- **O5. The drill IdP.** The transfer drill signs in with the P6 fake OpenID Provider (`apps/api/test/support/fake-idp.ts`), loopback-only and labelled synthetic. Under production semantics, this is the only way to run "key workflows" without a corporate IdP (the dev login is refused in production: `clean-start-local.sh` A3). Please confirm that it is acceptable evidence for the A18 clause "no builder or personal credentials configured". The corporate IdP stays a residual.
- **O6. Register text for AN-P7** (D-243 Q9/Q10):
  - REQ-S19-009 `screen_api` names `deploy/.env.example`; the file is the root `.env.example`;
  - REQ-S19-010 `screen_api` names `/health, /ready`; the endpoints are `/healthz` and `/readyz`;
  - REQ-S19-017 and REQ-S19-018 name `test-evidence/DG7/{transfer,offline}/`; drill reports go to DO-D/DO-E handback evidence and QA-C's `test-evidence/DG7/qa/{transfer,offline}/`.
- **O7. Dictionary format.** `data-dictionary.md` has 349 `## <name>` headings and 362 `| Column | Type |` tables (counted with `grep -c`). Older sections (for example `schema_migration`) have no `Null` column. ADR-0070 §1 compares nullability only where that column exists. DO-H's first run (T-F8) may still list parse gaps, which the orchestrator or an ARCH repair closes before the freeze (p7-plan §5.3).
- **O8. Shared files I edited** (the assignment says "You are the only run editing the shared contract files in this wave"): `openapi.yaml`, `p7-pending.ts`, `p7-operations.ts`, the `contract.test.ts` count pin, `erd.md`, `data-dictionary.md`, `permissions-matrix.md`, `p7-work-split.md`, ADR-0016 §6 and the `advisory-locks.ts` comment. BE-A runs in the same wave (W4). None of these files is in BE-A's p7-plan §5.1 list, but `server.ts` will be: BE-B (W6) edits the `registerHealthRoutes` call there after BE-A.

## 5. Merge instructions

- **No migration** to run. The ranges `0150`–`0152` stay free. Advisory locks 730416–730417 are reserved.
- **Contract:** 962 operations. The pending aggregate now includes `P7_PENDING_ARCH_04` (one entry, BE-B). Expect conflicts only if another run touched `p7-pending.ts`, `p7-operations.ts` or the `contract.test.ts` count line in the meantime. Each of my changes there is one line or one block.
- **Order for implementers:** BE-B after BE-A (W6) → QA-A (W7) → DOC-B (W9, the guide anchors) and DO-H (W9, after all ARCH merges) → DO-D (W10) → DO-E (W11) → QA-C (W12), then the orchestrator's host run of ADR-0069 §6–§7.
- **Orchestrator actions:** the DG1 reopen record (O2), and the decisions on O1, O4 and O5.

## 6. Not done

- Nothing in the assignment's deliverable list is undone. The only gaps are the deliberate non-changes, each with its reason in §1 and §4: no migration, no permission, no guard probe, no Kysely or catalogue change.
- The product implementation and every drill run belong to the implementers named in §5. None ran here.

## 3.8 End-of-task checks (appended after they ran)

| Command | Exit | Output |
| --- | --- | --- |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `All matched files use Prettier code style!` (`T-DG7-ARCH-04-evidence/prettier-check.log`; run once, before this section was appended) |
| `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`) |
| `date -u` | — | Thu Nov 12 19:00:08 UTC 2026 (about 26 minutes after the start) |

Temporary files: my scratch directories under `$TMPDIR` (the claims-scan copies and the integration tests' evidence directories) were deleted. No extra checkout was made. Disk: 3.8 GB free, unchanged.
