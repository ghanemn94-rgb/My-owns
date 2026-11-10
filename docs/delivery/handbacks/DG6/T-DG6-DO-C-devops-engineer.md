# Handback: T-DG6-DO-C (devops-engineer), the storage and notification documents and the environment residual rows

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Wave W7 (D-201).
- **Section:** `docs/architecture/p6-work-split.md` §J/C.12.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-DO-C.md` (sha256 `7acf99c58c0787518c1c822fb1e44dbb9292f26af5fb0a14e040e129d61afff2`).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-DO-C-devops-engineer-20261029T024307Z-70376a93","session_id":"70376a93-ca18-4121-aa47-dc0a74f6c996"}`.
- **Working tree:** `/home/user/wt/dg6-do-c`, branch `dg6/do-c`, base `HEAD` `135ff1db7c9a25314c4700460c02ce714823ec88`.
  At the start `git status` was clean. The changes are left **uncommitted**, as the assignment says.
- **Time:** started `2026-10-29T02:43:17Z`; finished `2026-10-29T03:58:48Z` (about 76 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0
  (`T-DG6-DO-C-evidence/validate-historical-dg5.log`).
- Engineering agent: no business, Finance or IT approval is granted or implied. Product gate G6 never implies DG7.

## 1. Changed files

| File | Change | Purpose |
|---|---|---|
| `docs/operations/storage.md` | new | The evidence-storage guide for IT. It covers:<br>• the two drivers, and that evidence is never served from a public URL;<br>• `storage_driver` per file, with new uploads only;<br>• what IT supplies, including an example least-privilege policy for the operations `stores/s3.ts` calls;<br>• switching, testing and saving through Administration > Storage, with the 15-minute and same-process rule and the refusal table;<br>• credentials as `SecretRef`s;<br>• export files;<br>• the licence-verified external test store (SeaweedFS 4.51, Apache-2.0; MinIO not bundled);<br>• restricted networks;<br>• a per-piece status table at `135ff1d`;<br>• backup implications. |
| `docs/operations/notifications.md` | new | The notifications guide for IT. It covers:<br>• in-app always, email optional, enterprise messaging port only;<br>• A21: with no channel, nothing breaks;<br>• what IT configures (relay, security mode, TLS trust, credential references, sender, routes, `APP_BASE_URL`);<br>• the operations and refusal table;<br>• fan-out after commit, exactly once, and the message content (deep link, restricted text, no body stored);<br>• the SMTP error codes with their retry class;<br>• restricted networks;<br>• a per-piece status table at `135ff1d`. |
| `docs/delivery/environment.md` | appended a section | "P6 residuals: live integrations not exercised in this environment". It has the environment facts and one row for each of: the corporate IdP, the Keycloak e2e (BLOCKED without a container runtime), brokered SAML, the IT object store, the SMTP relay, enterprise messaging, the corporate `http_pull` source (ADR-0055 names a DO-C row) and the AI model endpoint (ADR-0059 names a DO-C row). Earlier lines are unchanged. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-C-devops-engineer.md` | new | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-C-evidence/*` | new | Check logs, load samples, environment facts and the SeaweedFS licence evidence. |

No code, test, migration, contract, compose, image-lock, SBOM or dependency file was changed.

## 2. Behaviour delivered, per requirement row

My section assigns DO-C one row, **REQ-S16-006** (owners BE-H, BE-H2, DO-C, FE-B). Its acceptance text, quoted:
"A18;A12: contract tests pass for both adapters; evidence is never served from a public URL".

- **DO-C's part is documentation and residual rows.** p6-work-split §J/C.12 says "No compose profile is needed for
  the fakes: both are in-process (D-195 Q6/Q7)".
- The acceptance text is proven by BE-H's contract suite, BE-H2's no-redirect download test and QA's A12 check, not
  by this task. I did not re-run or re-claim those proofs.
- What this task makes true for the row:
  - `storage.md` §1 tells IT that evidence is never served from a public URL in either mode. It lists the
    adapter-level and route-level reasons, and states that the bucket must be private and that the browser never
    reaches the store.
  - `storage.md` §3 describes the `anonymous_read_refused` check of `testStorageSetting` as the operator's gate.
  - `storage.md` §6 documents the licence-reviewed external store D-195 Q6 asks for. **The licence was verified from
    official sources by this task**, as ADR-0054 §2 required ("That licence is [UNVERIFIED] by this task; DO-C verifies
    it from official sources before naming a version"):
    - `LICENSE` at the root of `github.com/seaweedfs/seaweedfs` is Apache License 2.0 (sha256
      `d789d433cc11da163273d1e39be2e8fa67642f9a58ef220d3f258fa9c14ef613`), and the README's License section says the
      same;
    - the version is 4.51 (`constants.go` on master; Docker Hub tag `4.51` of `chrislusf/seaweedfs`, pushed
      2026-10-26, digest `sha256:f7a49e3f…34b8`);
    - the GitHub release page could not be read (HTTP 403 from this session), and no support window was found, so the
      support window is **[UNVERIFIED]**;
    - MinIO stays not bundled (AGPL-3.0);
    - evidence: `T-DG6-DO-C-evidence/seaweedfs-licence-evidence.txt`.
- The other rows in my section's scope, documentation only (I am not a listed owner, so these are not claims of
  delivery):
  - REQ-S12-023 ("A21: with no email adapter configured all workflows complete and notifications appear in the
    inbox"): `notifications.md` §1 documents the A21 behaviour for IT.
  - REQ-S16-007: the residual rows for the IdP, the Keycloak e2e and SAML in `environment.md`.

## 3. Checks run (exact commands, exit codes, counts)

Environment: Node v24.21.0, pnpm 10.33.0, 4 vCPU, offline except the documented licence fetches. Harness ports
24200–24249. Before the tests: `find . -path ./node_modules -prune -o -type d -name .cc-writes -empty -print` found
no empty `.cc-writes` directory in a source folder.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `validate-historical-dg5.log` |
| 1 | `pnpm -r typecheck` | 0 | 172 s | `pnpm_r_typecheck.log` |
| 2 | `pnpm -r build` | 0 | 134 s | `pnpm_r_build.log` |
| 3 | `pnpm lint` | 0 | 33 s | `pnpm_lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (72 s; re-run after the handback was written: exit 0, 79 s) | `prettier-check.log`, `prettier-check-final.log` |
| 5 | `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations" | `pnpm_openapi_lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 162 files / 2501 tests passed; unit-web 96 / 1768 passed; unit-formula-nocodegen 3 files, 259 passed + 2 skipped (261) (276 s) | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts: 162/2501, 96/1768, 3 files 259 passed + 2 skipped (335 s) | `unit-locale-cutf8.log` |
| 8 | `QA_PG_PORT=24200 MTH_PORT_POOL=24201-24249 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **338 files: 2 failed, 336 passed; 3442 tests: 4 failed, 3436 passed, 1 skipped, 1 todo** (2742 s). See §3a. | `integration.log` |

Load during the unit runs (1-minute load average, sampled every 30 s): 1.91–7.51 over 21 samples, inside the envelope. Integration run: 1.89–8.32 over 92 samples (`load-integration.txt`); the one peak above 8 was during the contract files (`load-unit.txt`; envelope ≤ 8,
D-134).

The 2 skipped unit tests are in `packages/shared/src/formula/fuzz.test.ts` ("111 tests | 2 skipped"): conditional
skips in an unchanged package, the same in both locales.

### 3a. The integration failures (disclosed; none comes from this change)

**Acceptance item 3 is NOT met on this tree:** `pnpm test:integration` exits 1. My diff is documentation only (`git
diff --stat`: `docs/delivery/environment.md`, plus three new Markdown files and the evidence). No code, test, contract
or route changed, so none of the four failures can come from it. All four are in the two contract-test files:

| # | Test | Full run | Re-run of the 2 files alone | Diagnosis |
|---|---|---|---|---|
| 1 | `contract.test.ts` › "the contract: every route accepts exactly the request media types its operation declares" | FAIL: `expected [ 405, 404, 1 ] to deeply equal [ 403, 402, 1 ]` (`contract.test.ts:1070`) | **FAIL** (same) | **W7 merge seam on base `135ff1d`.** The JSON-body pin's comment counts BE-L's +6 (397 → 403), but BE-K's two JSON-body operations (`acknowledgeOperationalException` and `resolveOperationalException`, per §J/C.3) are not counted: 403 + 2 = 405 bodies, 404 JSON. "The orchestrator reconciles the parallel W7 deltas at merge" (the pin comment; D-079 precedent). This is a shared file that is not mine, so I did not edit it. **Needed:** pin `[405, 404, 1]` with a BE-K line in the comment. |
| 2 | `response-validation.test.ts` › the same pin test (it re-runs the contract file's cases) | FAIL (same assertion) | **FAIL** (same) | The same seam as #1. |
| 3 | `response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)" | FAIL: `expected [] to have a length of 1 but got +0` | **passed** | Load-dependent. It is the same test D-201 recorded for W5 ("the P5 BE-J length"; passed alone). |
| 4 | `response-validation.test.ts` › "every operation: an undeclared request media type is a declared 400 …" | FAIL: `Test timed out in 30000ms` | **passed** | Load-dependent: a 30 s timeout during the full run (D-201 records the same W5 timeout). |

The re-run command was `QA_PG_PORT=24210 MTH_PORT_POOL=24211-24249 tests/qa/support/with-pg.sh npx vitest run --project
integration apps/api/test/integration/contract/contract.test.ts
apps/api/test/integration/contract/response-validation.test.ts`. It exited 1 in 193 s, with 2 files failed and 2
tests failed / 208 passed (210). Both failures are the pin assertion. The log is `integration-contract-rerun.log`.

**Pinned counts:** this task changes none. This task routes no operation and changes no contract, so the operation count (932 in
`openapi:lint`), the media-type pins and the rate-limit floor are not touched.

## 4. Operations routed (pending-list delta)

None. DO-C owns no operation and has no `p6-pending-do-c.ts` or `p6-exercises-do-c.ts` (§J/C.12 lists documents
only). The pending-list delta is **0**.

## 5. Contract, schema, dependency and image needs (for the orchestrator)

- **No dependency, migration, contract or schema change.** No compose profile was added: the fakes are in-process
  (§J/C.12, D-195 Q6/Q7).
- **SeaweedFS is not bundled.** It is not in `images.lock.json`, the compose files or the SBOM. The digest in
  `storage.md` §6 is the value Docker Hub reported on 2026-10-29, offered as an IT test aid; nothing pins it. If the
  orchestrator wants a `test-s3` compose profile later (p6-plan's alternative to the in-process fake), it would need an
  `images.lock.json` entry resolved through `pin-images.mjs` and a container runtime to prove it. I did not add one.
- **Docs index (frozen file, not mine):** `docs/operations/README.md` does not yet list `storage.md` and
  `notifications.md`. I suggest two rows:
  - `storage.md`: "Evidence storage: filesystem and the optional S3-compatible store, Administration > Storage, the
    licence-reviewed test store";
  - `notifications.md`: "Notifications: the in-app inbox (always on), the optional SMTP channel, Administration >
    Notifications".

## 6. User-facing texts made untrue, and what I did

This task ships no product feature, so it makes no en/ar product string untrue. Operator-facing texts that are
already untrue, or will become untrue, when the slice-C features land:

| Text | Where | Becomes untrue when | Action |
|---|---|---|---|
| "The optional S3-compatible adapter is a later-stage item (P6)." | `docs/operations/configuration.md` "Evidence storage" (lines 129–131) | Already partly untrue: BE-H shipped the adapter. Fully untrue when BE-H2 ships the driver selection. | **Not edited: the file is outside DO-C's ownership.** Proposed replacement: "The optional S3-compatible object store is configured in Administration > Storage; see [storage.md](storage.md)." Owner: orchestrator or BE-H2. |
| "Current wiring: … The worker's registration is a planned P6 item (D-198, owner of slice J); until it lands, `SECRETS_DIR` has no effect in the worker process" | `docs/operations/configuration.md` "Secret providers" | Already untrue: `apps/worker/src/main.ts` registers the built-in providers (D-198, BE-J). | **Not edited (frozen file).** Proposed: "Both the API and the worker register the built-in providers at start." |
| "The S3-compatible evidence store is not available in this release (P6)." and the header comment "configuring it here makes every content operation 503" | `apps/api/src/modules/evidence/store.ts` | When BE-H2 lands | BE-H2's own item (§J/C.9: "the stale DG2 comment in `store.ts` (F-DG4-160)"). |
| "the s3 storage driver arrives in P6; export files need the filesystem driver" | `packages/reporting/src/storage.ts` | When BE-H2 lands | BE-H2's item (export-file storage port lines). |
| The "Status … at `135ff1d`" tables in `storage.md` §8 and `notifications.md` §8, the "not on `135ff1d`" and "planned" cells in `environment.md`, and the "not yet written" SAML guide | My files | When BE-H2, BE-I2, DO-B, BE-L2 and BE-T merge | **They are true now, and stated against a revision.** When those tasks merge, the orchestrator (or a DO follow-up) updates the status cells. They are written so that a stale cell reads as "at revision X", never as a false present-tense claim. |

## 7. What remains, and assumptions

- **Not done by design (residuals, disclosed in `environment.md`):**
  - a live IT object store, a live SMTP relay, a live corporate IdP, brokered SAML, enterprise messaging, a corporate
    source and an AI endpoint;
  - the SeaweedFS run itself: `docker info` exits 1 in this sandbox (socket permission denied), so no container was
    run.
- **Depends on later merges:**
  - `storage.md` §3–§5 describe BE-H2's behaviour as ADR-0054 §2 fixes it (not on this tree);
  - `notifications.md` §4 describes BE-I2's fan-out as ADR-0054 §3 fixes it (not on this tree);
  - when BE-H2 and BE-I2 merge, a reviewer should check four points against the merged code: the 15-minute and
    same-process test rule, whether export files follow the object store and whether the worker then needs the S3
    credentials, the 5-attempt retry, and the skip reasons.
- **For the orchestrator, from acceptance item 3:**
  - reconcile the JSON-body pin in `apps/api/test/integration/contract/contract.test.ts:1070` to `[405, 404, 1]`
    (BE-K +2), as §3a sets out;
  - then re-run `pnpm test:integration` on the merged W7 tree.
  - Items 1, 2 and 4 of the acceptance list exit 0.
- **Assumption:** the request for an AI endpoint residual row was to come through BE-T's handback (ADR-0059). BE-T
  has not run, so I wrote the row from ADR-0059 and marked it "to be confirmed by BE-T's handback". The same applies
  to `http_pull` (BE-L2, ADR-0055 §1).
- **Concurrency (D-004):** DO-C touches none of the shared files listed in the assignment (openapi.yaml, contract
  pins, schema.ts, catalogue.test.ts, p6-pending lists), so I expect no merge conflict with BE-K, BE-L or DO-D.
  `docs/delivery/environment.md` is DO-C's per p6-plan §5.3. DO-D owns `docs/operations/monitoring.md`, a separate
  file.

## 8. Merge instructions

Docs only. Merge in any order relative to DO-D. No migration, no install and no re-pin.
