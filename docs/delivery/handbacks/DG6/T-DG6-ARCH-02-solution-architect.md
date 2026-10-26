# Handback: T-DG6-ARCH-02 — P6 architecture, slices J + C (solution-architect)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-02-solution-architect-20261026T164001Z-7203495f","session_id":"7203495f-ca4d-412c-a71c-accc4b5b750c"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-02.md`, sha256 `423880ea1ef3cb0c269fd49fbb47422fef5033073b88ff94dd73b129297c9798` (verified with `sha256sum` at the start).
- **Base:** branch `claude/mobily-transformation-platform-dg5-regate2`, `HEAD` `702a6bb4851a34d9d3a6b0311cdd542ec44f55a9`. Nothing committed (the orchestrator commits).
- **Start:** `date -u` → `Mon Oct 26 16:40:17 UTC 2026`. **End:** `Mon Oct 26 18:01:43 UTC 2026` (§8).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. No business, Finance or IT approval was granted. Product G6 never implies DG7.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` (Node 24.21.0), run first, before any write: `PASS gate DG5 (historical)`, exit 0 (`T-DG6-ARCH-02-evidence/validate-historical-DG5.log`; the exit code was captured with `set -o pipefail` and appended to the log). It was re-run at the end (§8).

## 2. Deliverables

### 2.1 ADRs (deliverable 1)

| File | Content |
|---|---|
| `docs/architecture/adr/ADR-0053-p6-operations-service-identities-exceptions-logs-heartbeat.md` | §1 service identity per job queue and connector: entity, fields, 6 database invariants with probe ids, who writes declarations (migrations / connector creation) vs grants (admins narrow only), reads through a service principal (`ReadScope` worker twin, `requireServiceRead`), `sensitive_access` none/aggregate_only, the acceptance proof and the parity rule. §2 operational exceptions: the source/class table, the state machine, dedup (one active per organization and key, `NULLS NOT DISTINCT`, lock 730305), automatic recovery, the stale-KPI links and the acceptance fixture, visibility, 7 refusal codes with English and provisional Arabic texts. §3 catalogue triggers (`connector.run_failed`, `data.stale`; starter 16 version 2). §4 structured logs and the redaction list. §5 the post-suite log scan. §6 heartbeat, status, watch, error alerts. §7 Administration > Operations. §8 locks. §9 authorization. §10 decimal and Unknown. |
| `docs/architecture/adr/ADR-0054-p6-identity-storage-notification-channels.md` | §1 identity: the issuer, audience and `azp` checks on the existing `token_invalid` path, the 3-case other-realm proof, **the Keycloak image evidence** (below), the SAML broker document, Administration > Identity (read-only). §2 storage: the unchanged `EvidenceStore` port, S3 adapter semantics, never public or pre-signed, `evidence_content.storage_driver`, `storage_setting` with `SecretRef`s only, test-before-save, one contract suite for both adapters, the in-process SigV4-verifying fake, the S3 client dependency options with evidence. §3 channels: the `NotificationChannel` port, in-app always, email optional, enterprise messaging port only, fan-out after commit exactly once (5 steps), the SMTP library options with evidence, the fake SMTP, Administration > Notifications. §4 9 refusal codes (en + provisional ar). §5 authorization. §6 locks. §7 decimal and Unknown. |

Every claim is enumerated (tables, fields, constraint names, codes, texts, roles, files). Sources quoted: M0239, M0240, M0241, M0311, M0312, M0314, M0330, M0331, M0381, M0386, M0390, M0391, and the five acceptance texts. The playbook names no operational, identity, storage or channel control. The ADRs say so and cite only Template 2 (B0049/B0050, the KPI "Owner" column) as context.

**Dependency evidence (fetched by this task on 2026-10-26 through the sandbox proxy; files in the evidence folder):**

| Candidate | Official evidence | Result |
|---|---|---|
| Keycloak image (D-049, D-195 Q5) | keycloak.org Downloads links the container image only to `quay.io/repository/keycloak/keycloak`; "Running Keycloak in a container" uses only `quay.io/keycloak/keycloak`. Docker Hub `keycloak/keycloak:26.4` has the **same** manifest-list digest as quay.io's `26.4` (`sha256:9409c59b…6007`); quay.io `26.8.1` = `sha256:a78d6b79…dd6b`. quay.io answered HTTP 200 today. | The Q5 condition (official documentation names Docker Hub) **failed**. Recommendation: pin quay.io by digest (`pin-images.mjs --resolve keycloak`), moving 26.4 → 26.8.1. No Docker daemon here, so the e2e stays **BLOCKED** in this sandbox. `keycloak-image-evidence.txt` |
| `@aws-sdk/client-s3` | npm: 3.1156.0 (2026-10-22), Apache-2.0, node >=20, 11 direct deps. AWS version-support matrix: "SDK for JavaScript 3.x General Availability 12/15/2020"; maintenance policy: GA supported at least 24 months, 6 months' notice before maintenance, maintenance 12 months by default. | Not added. Option A (pin) or B (in-house SigV4) is for the orchestrator. `npm-dependency-evidence.txt`, `support-window-evidence.txt` |
| `nodemailer` | npm: 10.2.1 (2026-10-22), MIT-0, node >=20, 0 deps. No support window found (the `nodemailer.com/about/` fetch matched no statement). | Not added. Support window **[UNVERIFIED]**. D-195 Q7: pin only if the registry is provisioned; else in-house client. |

### 2.2 Migrations, schema types, permissions, locks (deliverable 2)

| File | Purpose |
|---|---|
| `packages/db/migrations/0101_p6_operations_service_identities.sql` | `service_identity` (+ trigger-written `service_identity_change`), `operational_exception` (+ `operational_exception_event`, append-only `operational_exception_kpi`), `worker_heartbeat` (row guard, not audited). Guards: `p2_attach_guards(…, true)` on the audited tables, column-level UPDATE grant on `service_identity`, state-machine triggers, closed-set CHECKs, `timestamptz`. |
| `packages/db/migrations/0102_p6_storage_notification_channels.sql` | `p6_secret_ref_valid(jsonb)`, `storage_setting` (singleton) + `storage_setting_change`, `evidence_content.storage_driver` (NOT NULL DEFAULT `filesystem`), `notification_channel` + `notification_channel_change`, `notification_delivery` (state machine, once per notification and channel). |
| `packages/db/migrations/0103_p6_operations_channels_permissions.sql` | 6 permission codes and 13 role links (TO, KDS, TD, AUD, ADM_TECH, ADM_ACCESS); no approval code. |
| `packages/db/src/schema.ts` | 11 table interfaces + `SCHEMA_COLUMNS`; `EvidenceContentTable.storage_driver`. |
| `packages/db/test/integration/catalogue.test.ts` | New test "0101-0102: the P6 slice J/C guards are attached" (30 triggers); 6 tables added to the mutable-table pin; 11 privilege pins. |
| `packages/db/src/seed.test.ts` | "0103 seed equals the P6 part of permissions.ts (slices J and C)" (3 tests); the free-id example of the numbering test 0101 → 0104 (0101 is now shipped). |
| `packages/shared/src/permissions.ts` | `P6_OPERATIONS_CHANNELS_PERMISSIONS`, its role defaults, added to `P6_PERMISSIONS` and to the 6 roles. |
| `apps/api/src/modules/platform/advisory-locks.ts`, `.test.ts` | `operationalExceptionUpsert` 730305, `channelDelivery` 730306, `storageSetting` 730307; 730308–730309 reserved; the pin (44 classes). |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 rows 730305–730309 and the P6 block sentence. |

Migration ids: 0101–0103 directly above the shipped 0100, per D-196 and the assignment; no gap, no retired id. Hashes: `migration-sha256.txt`.

### 2.3 ERD, data dictionary (deliverable 4)

- `docs/architecture/erd.md` §1u (diagram, the connector FK note, the entity register).
- `docs/architecture/data-dictionary.md` "P6 tables, slices J and C (migrations 0101–0103, DG6)". The 11 table sections were **generated from the catalogue of a freshly migrated database** (`gen-dictionary.ts`, output `dictionary-section.md`, exit 0). The section also lists the added column, the 10 functions and the column-level grant note.

### 2.4 Contract (deliverable 5)

- `docs/api/openapi.yaml`: `info.version` stays `1.5.0-p6` (set by ARCH-01). 2 new tags (`operations`, `platform-admin`), 17 operations appended, with 3 parameters and 28 schemas: `listOperationalExceptions`, `getOperationalException`, `acknowledgeOperationalException`, `resolveOperationalException`, `getWorkerHeartbeat`, `listServiceIdentities`, `getServiceIdentity`, `putServiceIdentity`, `getIdentitySettings`, `getStorageSetting`, `putStorageSetting`, `testStorageSetting`, `listNotificationChannels`, `getNotificationChannel`, `putNotificationChannel`, `testNotificationChannel`, `listNotificationDeliveries`.
  - Every operation declares 400, 401, 403, 404 and 429. Mutations also declare 409, 422 and 428 with `IfMatch` (`IfMatchOrZero` where a PUT creates the row). The two tests declare 422 and no If-Match, because they change no versioned record.
  - Bodies are `application/json`. Problem+json comes through the shared responses. GETs and PUTs carry ETag headers (`ETagOrZero` where no row may exist). The 4 lists use cursor pagination.
- **The one change to an existing schema:** the response-only `PermissionCode` enum gains the 6 `0103` codes (additive, as ARCH-01 did for `0100`; without it `getMe` fails validation).
  - `diff` against the pre-task file removes **0 lines** and adds 783.
  - The edit was made by `T-DG6-ARCH-02-evidence/openapi-p6-arch02.py`. Its first run failed lint (`Token "Permission" does not exist`). I fixed the schema name and re-ran the script on a restored copy of the pre-task file; the current file is that second run's output.
- **Pending seams:**
  - `p6-pending-arch-02.ts` (slice aggregate), `p6-pending-be-g.ts` (1), `p6-pending-be-h2.ts` (3), `p6-pending-be-i.ts` (4), `p6-pending-be-i2.ts` (1), `p6-pending-be-j.ts` (3), `p6-pending-be-k.ts` (5);
  - one import line in `p6-pending.ts`; `p6-operations.ts` +17 ids (keeps the P2-scoped AUD sweeps on their scope);
  - `contract.test.ts`: operation count **859 → 876** (the only pin changed; the comment lists the pending files).
- `pnpm openapi:lint` → `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 876 operations`, exit 0 (`openapi-lint.log`).

### 2.5 Permissions matrix and work split (deliverable 6)

- `docs/analysis/permissions-matrix.md` §25: codes, per-entity rights for all 14 roles, AUD read-only, system writers, technical admins, SoD.
- `docs/architecture/p6-work-split.md` §J/C (17 subsections), appended after §E/F; §1–§2 unchanged:
  - what the architect delivered;
  - BE-J, BE-J2, BE-J3, BE-K, BE-K2, DO-D, BE-G, DO-B, BE-H, BE-H2, BE-I, BE-I2, DO-C, each with exact files, operations, consumed contracts and tests;
  - FE-A/FE-B items;
  - migrations left and their order;
  - integration order, including the sequential-edit order of `kit.ts`, `admin/notification-channels.ts` and `operations/routes.ts`;
  - requirement → owner;
  - 9 points the implementers must know.
- The exact `db-errors.ts` mappings for the J/C constraints are listed for BE-K.

## 3. Requirements in scope

| Requirement | Architect delivered | Remaining owner(s) |
|---|---|---|
| REQ-S12-019 | `0101` (exceptions, events, KPI links), `0103`; ADR-0053 §2, §3, §6; probe OE/OEK | BE-K, BE-K2, BE-J, FE-B; ARCH-03/BE-L raise the connector classes; QA-A/QA-E prove A17/A22 |
| REQ-S16-029 | `0101` (identities), `0103`; ADR-0053 §1, §4, §5; probe SI | BE-J, BE-J2, BE-J3, DO-D |
| REQ-S12-023 | `0102` (channels, deliveries), `0103`; ADR-0054 §3; probe NC/ND | BE-I, BE-I2, FE-B |
| REQ-S16-006 | `0102` (setting, `storage_driver`), `0103`; ADR-0054 §2; probe ST | BE-H, BE-H2, DO-C, FE-B |
| REQ-S16-007 | ADR-0054 §1; `0103` (`identity.read`) | BE-G, DO-B, FE-B |

No requirement is complete yet: every row needs its implementer work. This is an architecture task.

## 4. Checks actually run (Node 24.21.0; PostgreSQL 16.13 disposable clusters on ports 23701–23749)

### 4.1 Migration apply and guard probe

`QA_PG_PORT=23701 MTH_PORT_POOL=23702-23709 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/probe.ts` → **81/81 PASS, exit 0** (`probe-output.txt`).

- G00: 0101–0103 present directly above 0100; nothing above 0103.
- G01: fresh database, 0001 → 0103 applied (95 files).
- G02–G04: 0001–0097 applied; then a synthetic transformation instantiated by the DG3 function, 2 KPI definitions in 2 organizations, a pre-P6 evidence file and 2 notifications; then 0098–0103 applied on top (6 files). Every existing row is unchanged: the pre-P6 file is on `filesystem`, no identity, exception, heartbeat, storage, channel or delivery row exists, and the KPI is still at version 1.
- **Guards fire:**
  - missing audit fails at COMMIT: SI07, SI14, OE06, ST03, NC04, ND04;
  - a non-stepping version fails: SI13, OE09, WH03, ST06, NC08;
  - UPDATE/DELETE on history fails: SI15, SI16, OE18, OE19, OEK04, ST08, NC09; the application cannot write history (SI17);
  - every database claim of the ADRs holds:
    - permission categories and migration-only job identities;
    - the column-level grant;
    - grant ⊆ declaration;
    - one active exception per key, including platform rows;
    - the exception, delivery and heartbeat state machines;
    - same-organization links;
    - `SecretRef` without values;
    - the singleton, the channel rules;
    - one delivery per notification and channel;
    - the `storage_driver` CHECK;
    - the permission seeds; AUD read-only; the technical-admin SoD trigger (PM01–PM04).

**Disclosed earlier run:** `probe-run1-exit2-fixture-error.txt`, exit 2 before any probe ran. My other-organization transformation fixture lacked `business_unit_id` (NOT NULL). Fixed the fixture, and replaced the permission code `kpi.read` (which does not exist) by `transformation.read`/`organization.read`/`user.read` in the probe data. The migrations were not changed between that run and the final one.

### 4.2 Static checks

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `format.log` ("All matched files use Prettier code style!") |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` (876 operations) |

### 4.3 Unit tests

| Command | Exit | Result | Log |
|---|---|---|---|
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 147 files / 2372 tests; unit-web 94 / 1746; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts | `unit-c-utf8.log` |

Pinned-count change: unit-node 2369 → 2372 (ARCH-01's count), from the 3 new `seed.test.ts` tests (0103 block). The 2 skipped tests are in `packages/shared/src/formula/fuzz.test.ts`, which I did not touch.

### 4.4 Integration tests

- **Targeted run 1:** `QA_PG_PORT=23711 MTH_PORT_POOL=23712-23720 tests/qa/support/with-pg.sh npx vitest run --project integration <catalogue, migrate, contract, identity, aud-write-deny>` → **exit 0, 5 files, 264/264** (`integration-targeted-run1.log`). The `identity.test.ts` pin of TO's permissions gained `operations.read` (0103) before this run.
- **Targeted run 2**, after I split the pending lists to the final owners (BE-H → BE-H2, plus BE-I2): `QA_PG_PORT=23703 … contract.test.ts catalogue.test.ts` → **exit 0, 114/114** (`integration-targeted-run2-after-pending-split.log`).
- **Full suite:** `QA_PG_PORT=23721 MTH_PORT_POOL=23722-23749 tests/qa/support/with-pg.sh pnpm test:integration`, started 17:08 UTC. Result: §4.5.

### 4.5 Full integration result

`QA_PG_PORT=23721 MTH_PORT_POOL=23722-23749 tests/qa/support/with-pg.sh pnpm test:integration`, 17:08 → 18:01 UTC: **exit 0: 321/321 files, 3089 passed, 1 skipped (3090 tests)**, 3110 s (`integration-full-run1.log`; start time in `integration-full-run1.start`).

- **Pinned-count change:** ARCH-01's final run had 3088 passed + 1 skipped (3089). The +1 is my new catalogue test "0101-0102: the P6 slice J/C guards are attached". The 17 new operations add no generated case to the P2-scoped AUD sweeps, because `p6-operations.ts` excludes them.
- **Disclosure:** about 10 minutes into this run I split the pending lists (`p6-pending-be-h.ts` → `p6-pending-be-h2.ts`, and the new `p6-pending-be-i2.ts`; the same 17 operations). The full run's contract test had already executed on the earlier layout. The final layout was then verified by targeted run 2 (114/114, §4.4). The same change edited one comment line in `contract.test.ts` (the list of pending file names). Apart from these, no source, test or migration file changed after the full run started; only documentation (`docs/**`) changed.

## 5. Raised to the orchestrator (decisions needed; nothing decided by me)

1. **Keycloak image (D-195 Q5).** The official-documentation condition for Docker Hub failed. Docker Hub's 26.4 digest is identical to quay.io's, and quay.io is reachable now. Options:
   - (a) the orchestrator runs `pin-images.mjs --resolve keycloak` on quay.io (recommended), and moves the tag 26.4 → 26.8.1;
   - (b) keep the D-049 BLOCKED residual.
   In either case the e2e needs a container runtime, and this sandbox has no Docker daemon.
2. **Dependencies:** `@aws-sdk/client-s3@3.1156.0` (Option A) vs in-house SigV4 (Option B), and `nodemailer@10.2.1` vs an in-house SMTP client (D-195 Q7). The evidence is in §2.1. BE-H/BE-I can start before the decision.
3. **Connector exceptions and KPI freshness (ADR-0053 §2).** Should an active connector exception force `stale` on a linked KPI whose last actual is still inside `staleAfterDays`? Doing so changes the DG4 freshness rule (a DG4 reopen candidate). I have not designed it in. The A17/A22 fixture uses an actual older than `staleAfterDays`, so the acceptance holds under the unchanged rule.
4. **Task splits:** BE-J/J2/J3, BE-K/K2, BE-H/H2, BE-I/I2 (+5 runs over p6-plan §5.1) need wave slots. The pending lists already follow the split.
5. **Shared-file merge with BE-A (running concurrently):** I added one import line to `apps/api/test/support/p6-pending.ts` and changed the operation-count pin and its comment in `contract.test.ts`. BE-A owns both files (p6-plan §5.1), so expect a small textual conflict at merge.
6. **Stale text in ARCH-01's section (not mine to edit):** `p6-work-split.md` §E/F.9 and the `0099` header comment still say "T-DG6-ARCH-02 … 0104+" and "BE-D's migration 0101". D-196 superseded both, and 0101–0103 are now taken by this task. A frozen migration comment stays as written; §E/F.9 can be corrected by the orchestrator.

## 6. DG1–DG5 artifacts changed, and why (D-195: additive changes)

| Artifact | Change | Why |
|---|---|---|
| `docs/api/openapi.yaml` | 2 tags, 17 appended operations, `PermissionCode` +6 values | Deliverable 5; the enum addition is response-only and additive (needed for `getMe`). 0 lines removed. |
| `packages/db/src/schema.ts` | 11 tables; `EvidenceContentTable.storage_driver` | Mirrors `0101`/`0102` (catalogue test). |
| `packages/db/test/integration/catalogue.test.ts` | new trigger test; mutable-table and privilege pins extended | P6 tables, established pattern. |
| `packages/db/src/seed.test.ts` | 0103 block; free-id example 0101 → 0104 | `0103` equality; 0101 is now shipped. |
| `packages/shared/src/permissions.ts` | P6 J/C block and role wiring | `0103` equality; no existing grant removed. |
| `apps/api/src/modules/platform/advisory-locks.ts`, `.test.ts`; ADR-0016 §6 | 3 classes, 2 reserved; pin 41 → 44 | Registry rule. |
| `apps/api/test/support/p6-pending.ts`, `p6-operations.ts`, `contract.test.ts` | P6 J/C import; +17 ids; count 859 → 876 | The P3–P6 pending precedent. |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list +`operations.read` | The `0103` role defaults. |
| `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md`, `docs/architecture/p6-work-split.md` | appended P6 J/C sections | Deliverables 4 and 6. |

No DG1–DG5 behaviour changes in this task. The one new column on an existing table (`evidence_content.storage_driver`) defaults to the only store DG2 uses. With no new row, every response is as at DG5 (probe G04).

Untracked files `.zshrc` and `CLAUDE.local.md` (and the dot-files at the repository top level) appeared in `git status` but were not created by this task. I left them untouched.

## 7. What the implementers of this slice must know

In `p6-work-split.md` §J/C.17 and §2. The main points:

- Declarations of service identities are migration-only; the API narrows grants only (column privileges).
- The worker reads through the `service-scope.ts` twin, never the API module.
- Exceptions are update-or-insert under lock 730305, never blind inserts.
- No KPI value or freshness rule changes.
- Error messages are redacted before they are stored.
- No evidence URL ever leaves the API.
- Credentials are `SecretRef`s.
- In-app first; channels fan out after commit.
- The live IdP, SAML, object store, SMTP and enterprise messaging are residuals.

## 8. End

- `date -u` at the end: `Mon Oct 26 18:01:43 UTC 2026` (1 h 21 min).
- `node tools/gates/validate.mjs --historical --stage DG5` at the end → `PASS gate DG5 (historical)`, exit 0 (`validate-historical-DG5-end.log`).
- **Deliverables 1–6: complete.** Nothing is left for a continuation task. The open items are the decisions of §5.

### Merge instructions

- Apply as one change. The migrations are `0101`, `0102`, `0103`, forward-only, and apply on top of `0100` (probe G03).
- Expect the BE-A conflict of §5 item 5 in `p6-pending.ts`/`contract.test.ts`; keep both sides' lines.
- After merge: `pnpm test`, `pnpm test:integration` (full), `pnpm openapi:lint`, `node tools/gates/validate.mjs --historical --stage DG5`.
- Evidence: `docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/` (probe script and outputs including the disclosed run, dictionary generator and output, contract script, dependency evidence, check logs).
