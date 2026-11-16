# ADR-0071: P7 traceability and honest completion: the build-time register snapshot, the in-app requirement register, Administration > About, the release notes, the release-blocker rule, and the protocol-audit checks of the gate obligations

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-05), 2026-11-12. Base `7f2d984a077886c703a6db31329b873dbcf8e06f` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements:**
  - slice I of `docs/architecture/p7-plan.md`: REQ-S02-003, REQ-S02-005, REQ-S21-003;
  - the tooling and evidence of the 16 slice J rows (§7). Each J row stays in slice J (p7-plan §4).
  - The handover documentation set (slice H) is ADR-0072.
- **Sources (quoted where a design point has one):**
  - Acceptance texts (binding, `docs/delivery/requirements.csv`):
    - REQ-S02-003: "A01;A28: the in-app view lists the same row count and IDs as docs/delivery/requirements.csv for the release; the handover archive contains the register". Procedure: "imported at release into an Administration view with filters by class, status and area, and included in the handover archive". Permissions: "view:ADM,AUD,TO; edit:none in-app (register is maintained in the repository)".
    - REQ-S02-005: "A24;A28: the validator rejects a BLOCKED row with empty notes and an IMPLEMENTED row without evidence; release notes list every non-IMPLEMENTED row". Procedure: "release notes and in-app 'About' list unfinished items as such".
    - REQ-S21-003: "A28;A18: at DG7 no register row is below IMPLEMENTED, or it is listed as a release blocker; the secret scan of the repository and the handover text finds no credentials".
  - Master prompt M0088 (§2 source fidelity and completion), M0414 (§21 release behaviour: "remaining external configuration dependencies").
  - Playbook: no block concerns the requirement register or release notes. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q11** "build-time register snapshot": "a build step snapshots the file into the image. AN-P7 updates the register before the freeze, so the snapshot in the frozen payload equals the candidate's register, and a test checks the equality".
  - D-243 **Q13** "approved records never rewritten, hits reported".
  - D-243 **Q19** (user): "rows whose last clause completes with the DG7 gate record or the post-approval seal (REQ-DLV-021, DLV-010, S20-023, DLV-039, DLV-041, S20-028) are recorded IMPLEMENTED with the tooling, the rehearsal and DG0–DG6 evidence; their notes name the clause that completes later".
  - D-243 **Q20**: REQ-S02-003 listed a P5 increment that was not built; it completes at DG7.
  - **D-249** (user decision): the protocol-audit hits over DG0–DG6 are "recorded as disclosed observations in the DG7 records and the handover's known-limitations", with no gate reopened.
  - **D-250 O1:** a P7 read view reuses `operations.read`, so it needs no new permission code or migration.
  - **D-251** item 3: "The `release` module stays a bare stub until ARCH-05 designs slice I".
- **Builds on:**
  - ADR-0002 (modules and the dependency rule);
  - ADR-0006 (one policy function);
  - ADR-0011 (configuration and image build);
  - ADR-0062 (the archive's `docs/` holds `docs/delivery/requirements.csv`, §2 layout table; reproducible build);
  - ADR-0063 (secret scan payload scope, claims scan);
  - ADR-0069 §3 (`getDeploymentStatus`, the version rules);
  - ADR-0072 (the handover tree, `external-dependencies.json`, the known-limitations guide).
- **Two gate systems.**
  - A register status is an engineering delivery state. It is not a DG0–DG7 gate decision and not a G1–G6 business approval.
  - The product shows the register. It never edits it, never reads a delivery record at run time, and never reads or writes a gate, review or stage record.
  - The release tools read delivery records at build or release time only, and write none.

## Context

1. **Nothing of slice I runs today.**
   - The `release` module is a stub: `apps/api/src/modules/release/routes.ts` registers no route (T-DG7-BE-A, D-251).
   - No operation reads the register. `/admin/coverage` is the methodology coverage view (REQ-PB rows), not the register.
2. **The register.** `docs/delivery/requirements.csv` has 19 columns and 412 rows (counted on this base): 93 SOURCE, 131 ENGINEERING and 188 USER; 358 IMPLEMENTED and 54 SPECIFIED.
   - It uses RFC 4180 quoting: commas, quotes and line breaks occur inside fields.
   - The longest `notes` value is 22 495 characters and the longest `evidence` value 6 033.
   - The id areas are `PB`, `DLV` and `S01`–`S21`.
3. **The validator already guards the statuses.** `tools/gates/lib/rules.mjs` `checkRegister` l.217 refuses "BLOCKED without the missing dependency in notes", and l.222 refuses "IMPLEMENTED for <gate> without evidence".
   - No test in `tools/gates/tests/validator.test.mjs` names either message (`grep` for "BLOCKED without" and "without evidence" finds none). The A24 test at l.406 covers evidence paths and coverage gaps.
   - `tools/gates/**` is implementer-protected, so §6 adds the test outside it.
4. **The image build cannot see the register.**
   - `.dockerignore` excludes `docs/delivery` (and `docs/source`).
   - The Dockerfile runs `COPY . .` and then `pnpm -r build`.
   - The release archive, by contrast, ships `docs/delivery/requirements.csv` under `docs/` (ADR-0062 §2), and `build-from-archive.sh` builds from it.
5. **The protocol audit exists.** DO-I built `tools/release/protocol-audit.mjs` (D-249): nine checks C1–C9, 25 fixture tests.
   - Its real run over DG0–DG6 reports historic hits H1–H11, which the user decided to disclose without reopening (D-249).
   - This ADR records that tool for slice J (§7). It does not re-specify it.

## Decision

### 1. What the product may read

1. **One source: the register file of the release.** The product shows `docs/delivery/requirements.csv` **as it was when the release was built**, through a snapshot file generated by the build (§2).
2. **No run-time read of a delivery record.** At run time the `release` module reads its snapshot file only: no file under `docs/`, no database table, and no network. This keeps the plan's rule ("nothing in the product runtime reads them", p7-work-split §1 "Two gate systems").
3. **No edit.** No operation, job or CLI command changes the register. Its statuses are set by the delivery orchestrator and verified by independent reviewers in the repository (REQ-S02-005 permissions).

### 2. The build-time register snapshot (D-243 Q11)

1. **Generator:** `apps/api/scripts/register-snapshot.mjs` (BE-H). Node 24 ES module, no dependency, no network. Usage:

   ```text
   node apps/api/scripts/register-snapshot.mjs --csv <requirements.csv> [--deps <external-dependencies.json>] --out <snapshot.json>
   node apps/api/scripts/register-snapshot.mjs --check <snapshot.json> --csv <requirements.csv>
   ```

2. **Parsing (strict).**
   - The file is UTF-8, without a BOM.
   - Records follow RFC 4180: quoted fields, doubled quotes, and LF or CRLF line ends. A line break inside a quoted field is kept as `\n`.
   - The header must equal the 19 register columns exactly and in order: `req_id,class,title,source_ref,source_heading,template_id,input_fields,procedure,output,owner_roles,permissions,automation,screen_api,acceptance,increments,final_gate,status,evidence,notes`.
   - Every record must have 19 fields.
   - Each `req_id` matches `^REQ-[A-Z0-9]+-[0-9]{3}$` and is unique, and its area (the middle part) matches `^(PB|DLV|S(0[1-9]|1[0-9]|2[01]))$`.
   - `class` is one of `SOURCE`, `USER`, `ENGINEERING`.
   - `status` is one of `PLANNED`, `SPECIFIED`, `IMPLEMENTED`, `BLOCKED`.
   - `final_gate` matches `^DG[0-7]$`.
   - Any violation exits **1** with `register-snapshot: <line>: <reason>`. A missing input exits **2** (p7-work-split §2 rule 4).
   - **Field values are never trimmed, normalized or re-encoded**, so `getRequirement` returns the register's text byte for byte, after UTF-8 decoding.
3. **Output** (strict UTF-8 JSON, keys in this order):

   ```json
   {
     "schemaVersion": "mth-register-snapshot/1",
     "sourcePath": "docs/delivery/requirements.csv",
     "sourceSha256": "<64 hex of the file bytes>",
     "rowCount": 412,
     "generatedAt": "<RFC 3339 UTC>",
     "columns": ["req_id", "…", "notes"],
     "rows": [["REQ-…", "…"], …],
     "externalDependencies": [ … ] | null
   }
   ```

   - `rows` keep the file's order.
   - `generatedAt` is `SOURCE_DATE_EPOCH` when it is set (the ADR-0062 rule), and the build time otherwise.
   - `externalDependencies` is the array in `docs/handover/external-dependencies.json` (ADR-0072 §5), validated against the `ExternalDependency` contract schema. It is `null` when `--deps` is absent or the file does not exist. It is never `[]` by default: an empty array would claim "no external dependency".
4. **Wiring into the build.**
   - The API package's `build` script becomes `tsc -p tsconfig.build.json && node scripts/register-snapshot.mjs --csv ../../docs/delivery/requirements.csv --deps ../../docs/handover/external-dependencies.json --out dist/release/register-snapshot.json`.
   - `deploy/scripts/assemble-runtime.sh` already copies each package's `dist/` whole (l.96), so the snapshot reaches the runtime tree and the image with no change there.
5. **The image build sees exactly one delivery file.** `.dockerignore` gains one exception line directly after `docs/delivery`: `!docs/delivery/requirements.csv`.
   - The rest of `docs/delivery/**` stays out of the build context.
   - This is an additive change to a DG1-approved packaging file: no file leaves the context, and one file is added.
   - The register is engineering text that is already in the release archive, and the ADR-0063 secret scan and the claims scan cover it.
6. **A missing register fails the build.** If `--csv` names no file, the generator exits 2 and `pnpm -r build` fails, so a release image without its register cannot be built.
7. **Parity is tested, never assumed.**
   - **T-I1:** the snapshot generated from the tree's register has the file's SHA-256, row count, ids in order and every field verbatim. Each check compares against an independent parse of the same file.
   - **T-I2:** `--check` exits 1 when the register changed after the snapshot was generated.
   - **T-I10 (freeze, QA-D):** the snapshot in the assembled runtime tree of the candidate has `sourceSha256` equal to the SHA-256 of the candidate's `docs/delivery/requirements.csv`. AN-P7 updates the register before the freeze (Q11), so the check is made on the frozen payload. A28 (ADR-0073) repeats it on the sealed archive.

### 3. The register operations (REQ-S02-003)

| Operation | Behaviour |
| --- | --- |
| `listRequirements` `GET /api/v1/admin/requirements` | Summary rows (`RequirementSummary`), ordered by `reqId` ascending in code-point order. Filters are exact matches and combine with AND: `class`, `status`, `area` and `finalGate`. Cursor pagination: `limit` defaults to 25 (maximum 100), and the opaque cursor binds the last `reqId` and the filters, so reusing it with other filters gives 400 (the `Cursor` parameter rule). The page carries `snapshot` (`RegisterSnapshotInfo`), so every view shows which register it is. |
| `getRequirement` `GET /api/v1/admin/requirements/{reqId}` | Every column verbatim plus `area` and `snapshot`. An id that is not in the snapshot gives 404 `not_found`. |
| `getReleaseAbout` `GET /api/v1/admin/about` | §4. |

**The guard table of the `release` module** (D-251 item 3). Each clause is mapped to a test and an owner in p7-work-split §I.4 and §I.6.

| # | Clause | All three operations |
| --- | --- | --- |
| G1 | Authentication | No session → 401 `unauthenticated` (the platform hook, as for every `/api/v1` route). |
| G2 | Authorization | `operations.read` at installation scope, through the one policy function (ADR-0006). Without it → 403 `forbidden`. The default holders are ADM_TECH, TO, KDS, TD and AUD (permissions matrix §33). |
| G3 | Validation | Query and path parameters are parsed with the contract's patterns and enums. An unknown query parameter, a bad enum, an id that does not match its pattern, a bad `limit`, or a cursor that does not decode or does not match the filters → 400 `validation`, with field errors. |
| G4 | Snapshot availability | A missing snapshot file, unparseable JSON, a wrong `schemaVersion`, or a `rowCount` different from `rows.length` → `listRequirements` and `getRequirement` answer 503 `release.register_snapshot_unavailable` (type `urn:mth:problem:unavailable`), never an empty page. `getReleaseAbout` answers 200 with `register`, `statusCounts`, `openItems` and `laterClauses` all `null`. The API logs one `warn` line per process (§I.3 texts). The API still starts: readiness does not depend on the snapshot. |
| G5 | Read-only | GET only. No mutation, so there is no `If-Match`, no version and no audit event (reads of non-sensitive data are not audited; ADR-0004). No operation of the module writes. |
| G6 | No sensitive data | The register holds no business record, no personal data and no secret. The ADR-0063 secret scan covers the source file, and the module adds nothing to the rows. No sensitivity filtering applies, and none is needed. |
| G7 | No delivery-record read at run time | The module reads only its snapshot path (§2.4), resolved relative to its own compiled file (`dist/release/register-snapshot.json`). T-I9 asserts that no other path under `docs/` is opened. |
| G8 | Rate limit | The platform limiter, as for every `/api/v1` read → 429. |

**Loading.**
- The snapshot is read **once per process**, lazily on the first request, then cached in memory.
- A failed load is not cached: the next request retries, so a fixed file is picked up without a restart.
- The parsed rows are frozen, and every response is built from them.
- The loader is injectable (`registerReleaseRoutes(app, deps, snapshotSource)`), so tests run on a generated snapshot. `server.ts` passes the default source.

### 4. Administration > About (REQ-S02-005, REQ-S21-003)

`getReleaseAbout` (`ReleaseAbout`):

| Field | Source and rule |
| --- | --- |
| `appVersion` | The API's `package.json` version, or `unknown` when it cannot be read (the `getDeploymentStatus` rule, ADR-0069 §3). T-I7 asserts both operations give the same value. |
| `contractVersion` | `info.version` of the served contract (the same rule). |
| `register` | `RegisterSnapshotInfo`, or `null` (G4). |
| `statusCounts` | Rows per status, every status present (0 when none), or `null` (G4). The sum equals `register.rowCount`. |
| `openItems` | **Every** row whose status is not `IMPLEMENTED`, ordered by `reqId`, with its notes verbatim (the missing dependency, REQ-S02-005), or `null` (G4). Never truncated and never paginated: at most 412 rows today. |
| `laterClauses` | Every `IMPLEMENTED` row whose notes contain the marker `completes-after-gate:` (§5.3), with its notes, or `null` (G4). |
| `externalDependencies` | The snapshot's `externalDependencies` (§2.3): an array, or `null` when the build had none. `null` is shown as "Unknown" and never as "none". |
| `checkedAt` | The response time. |

**The screens** (FE-C; texts in p7-work-split §I.3):
- **Administration > Requirement register:**
  - filters for class, status, area and final gate;
  - a table with id, class, title, status, final gate and increments;
  - a detail panel with every column;
  - the snapshot line "Register snapshot: <rowCount> rows, SHA-256 <first 12 hex>…".
- **Administration > About:**
  - versions, the snapshot line and the counts by status;
  - "Unfinished items" (`openItems`), with the empty-state text that shows only when `openItems` is `[]`;
  - "Clauses that complete after the engineering gate" (`laterClauses`);
  - "Remaining external configuration dependencies".
  - Every `null` is shown as the Unavailable or Unknown text, never as 0, never as an empty table, and never as green.

Both screens live inside the existing Administration area (seam 15), and both show the line "These are engineering delivery states, not business approvals."

### 5. The release notes (REQ-S02-005, REQ-S21-003; generator built by DO-J)

1. **Generator:** `tools/release/release-notes.mjs` (DO-J; p7-plan §5.1). Dependency-free, it follows p7-work-split §2 rules 3–4. Usage:

   ```text
   node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md
   node tools/release/release-notes.mjs … --check
   ```

   It reads the register (a named file, never a walk, D-138), the dependency list and the provisional Arabic files (`apps/web/src/i18n/provisional-ar*.ts` and the `provisional-ar.ts` files the plan lists in §1.4). It reads nothing else.
2. **Content of `docs/handover/release-notes.md`.** The output is deterministic: no clock is read, so `--check` compares bytes. Sections:
   1. the release identity: `@mth/api` version, contract version, the register's SHA-256 and row count;
   2. counts by status;
   3. **"Unfinished items and release blockers"**: **every** row whose status is not `IMPLEMENTED`, with id, title, status, final gate and its notes as "missing dependency";
   4. "Clauses that complete after the engineering gate": every `laterClauses` row (§5.3);
   5. "Remaining external configuration dependencies", or the Unknown line when the file is missing;
   6. "Provisional Arabic texts": the count of provisional keys per file;
   7. an Arabic summary page section (ADR-0072 §2, D-243 Q7), marked provisional.
3. **The later-clause marker (D-243 Q19).** AN-P7 writes `completes-after-gate: <clause>` into the notes of each Q19 row (REQ-DLV-021, DLV-010, S20-023, DLV-039, DLV-041, S20-028). The marker is the only machine-readable link between such a row and the About and release-notes sections. The six rows are named here so that T-I13 can check that each carries it at the freeze.
4. **Refusals** (exit 1, with the B-style lines of §I.3):
   - a row that is not `IMPLEMENTED` with empty notes (REQ-S02-005: "every incomplete or externally blocked item names the exact missing dependency"; the validator's l.217 rule, extended to every status that is not `IMPLEMENTED`);
   - an `IMPLEMENTED` row without evidence (l.222);
   - `--check` drift.
5. **A28.** The archive's `docs/` carries `docs/handover/release-notes.md` (ADR-0062 §2). T-I11 asserts that its unfinished list equals the register's rows that are not `IMPLEMENTED`, exactly (the same set and no other).

### 6. The release-blocker rule and the handover secret scan (REQ-S21-003)

1. **Unfinished means blocker at DG7.** Every DG7-final row that is not `IMPLEMENTED` at the freeze is, by definition, in the "Unfinished items and release blockers" section of the release notes and in About's `openItems`.
   - No separate list is kept, so the two cannot drift.
   - QA-D's release-blocker check (p7-plan §5.1) compares the section with the register and the gate's open findings. The release-auditor reads it.
2. **The validator's register rules get a test outside the protected tree.** `tests/qa/integration/a24-register-rules.test.ts` (QA-D) imports `checkRegister` from `tools/gates/lib/rules.mjs` read-only. On fixture registers it proves "BLOCKED without the missing dependency in notes" and "IMPLEMENTED … without evidence" (T-I12).
   - The orchestrator may instead add the test to `tools/gates/tests/` (open question O2 of the handback).
3. **The secret scan of the handover text** is DO-B's `tools/release/secret-scan.mjs`, which already exists.
   - Its `payload` scope is the candidate manifest, which includes `docs/handover/**`, the generated release notes and `docs/delivery/requirements.csv`.
   - Its CI job runs on every change (D-247).
   - T-I14 (DOC-B, in the ADR-0072 checks) asserts that every file under `docs/handover/` is in the payload scope, so a handover file kept outside the manifest would fail.
   - The claims scan (ADR-0063 T-G6) covers the same texts.

### 7. Slice J: the protocol-audit checks and the gate obligations (16 rows)

DO-I's `tools/release/protocol-audit.mjs` (version 1.0.0; D-249) is the tool of record for the obligations no other tool computes. This ADR records its checks and does not re-specify them.

| Check | Requirement and clause (as the tool states it) |
| --- | --- |
| C1 concurrency | REQ-DLV-009 "overlapping run intervals … never exceed four (D-004)" |
| C2 assignment-contract | REQ-DLV-011 "… an assignment file containing all ten contract elements" |
| C3 handback-sections | REQ-DLV-012 "every implementation task in a gate has a handback with the five sections" |
| C4 file-ownership | REQ-DLV-008 "no two concurrently active assignments share a writable file" |
| C5 historical-first | REQ-DLV-024 "test-evidence contains a passing --historical run for the previous gate, dated before the stage's first implementation run" |
| C6 progress-updates | REQ-DLV-028 (six elements, candidate id); REQ-DLV-012 (no task with open gaps reported complete) |
| C7 three-failed-fixes | REQ-DLV-018 |
| C8 approval-claims | REQ-DLV-027 "no record claims a business, Finance, IT or production approval" |
| C9 stage-continuation | REQ-DLV-027, REQ-DLV-040 (F-DG6-952 reported as its accepted observation) |

**The disclosure (D-249).**
- The historic hits H1–H11 are not fixed in approved records. They are disclosed, generated from the tool's JSON report, in `docs/handover/known-limitations.md` (ADR-0072 §5.2). The rows' notes name the disclosure.
- The DG7 run is made by the orchestrator at the freeze, with `--all --json`. Its report is the input of that generated section. A DG7 hit is a DG7 finding, not a disclosure.

The rows without a protocol-audit check are evidenced by the validator, the gate records and the K drills. The full row → evidence table is p7-work-split §J.

### 8. Advisory locks

Classes 730418–730419 are reserved for this block and not allocated, because no operation of slices I and H writes. The registry comment is in `apps/api/src/modules/platform/advisory-locks.ts`, with the ADR-0016 §6 row.

### 9. Who builds it, and how it is tested

| Task | Builds | Tests |
| --- | --- | --- |
| **ARCH-05** (this) | This ADR and ADR-0072; the contract (3 operations, tag `release`, 10 schemas); `p7-pending-arch-05.ts`, `p7-pending-be-h.ts`; the `p7-operations.ts` block; the count pin 965; lock reservation; ERD §1af, dictionary, matrix §33; p7-work-split §I, §H, §J | `pnpm openapi:lint`; the contract suite (965, the three operations pending) |
| **BE-H** | `register-snapshot.mjs`, the `build` line, the `.dockerignore` line, the `release` routes and loader, `p7-exercises-be-h.ts` | T-I1–T-I9 |
| **FE-C** | `apps/web/src/pages/admin/{requirements,about}/**` and their texts | T-I15, T-I16; FE-D T-I17 |
| **DO-J** | `release-notes.mjs` and its tests | T-I11, T-I13 (fixture half) |
| **QA-D** | the release-blocker check, `a24-register-rules.test.ts`, the freeze parity | T-I10, T-I12, T-I13 (on the frozen register) |
| **DOC-B** | `external-dependencies.json`, the known-limitations disclosure | ADR-0072 T-H tests, T-I14 |

## Consequences

- The in-app register is exactly the release's register, by construction and by test. It cannot drift at run time, because nothing at run time reads the repository.
- A register change after the image is built is not visible in that image, by design: a release shows its own register. A new build shows the new one.
- The `.dockerignore` exception makes one delivery file part of the image build context.
- Unfinished work has one source (the register) and three views (About, the release notes, the release-blocker check). None of them keeps a list of its own.

## Residuals (honest)

1. **Role set.** "view:ADM,AUD,TO" is met as ADM_TECH, AUD and TO. KDS and TD can also read; ADM_ACCESS and ADM_METHOD cannot (permissions matrix §33). An exact set needs a new code and a migration (handback O1).
2. **The `.dockerignore` exception is proven only by a real image build.** The agent sandbox has no Docker daemon (ADR-0069 Context 4). T-I8 checks the file's lines and the documented negation semantics. The image half is checked on the orchestrator's host build (D-243 Q1), or it stays a disclosed BLOCKED item.
3. **The marker is a convention.** `laterClauses` and the release-notes section depend on AN-P7 writing `completes-after-gate:` into the six rows. T-I13 checks the six rows at the freeze; a row added later without the marker is not detected.
4. **No validator test exists today for the l.217/l.222 messages.** T-I12 adds one outside `tools/gates/**`.
5. **Historic protocol hits stay in the approved records** (D-249). They are disclosed, not corrected.

## Alternatives considered

- **Read `requirements.csv` at run time.** Rejected: it breaks "nothing in the product runtime reads delivery records". It also needs the file in the image at a fixed path, and a deployed image would show whatever file sits next to it.
- **Commit the snapshot under `apps/api/src/`.** Rejected: every register change by the analyst would also need a code change by another role, and a stale committed snapshot could ship. Q11 says "a build step".
- **Load the register into a database table by migration.** Rejected: a table makes the register editable data, and its content would depend on when the migration ran.
- **A dedicated permission code `requirement_register.read`.** Deferred: it needs a seed migration inside a wave where implementers are adding migrations (D-245 O9, D-248 O8). See Residual 1.
- **A separate release-blocker list file.** Rejected: two lists can drift. The register is the only source.

## Version evidence (M0314)

No new runtime or build dependency. The generator and the loader use Node built-ins (`node:fs`, `node:crypto`, `node:path`, `node:url`) on the pinned Node 24.21.0. No version is pinned or changed by this ADR.
