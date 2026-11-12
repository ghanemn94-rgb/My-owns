# ADR-0069: P7 clean deployment and transfer: the base-URL rules, readiness with storage and worker, the deployment status operation, the transfer drill, the offline drill, the image bundle, no unknown-target manifests, and the drill split between the agent sandbox and the orchestrator's host

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-04), 2026-11-12. Base `a5e67854ca2296d1385040f2786d46afe963e596` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice B of `docs/architecture/p7-plan.md`):** REQ-S01-001, REQ-S01-006, REQ-S16-008, REQ-S19-009, REQ-S19-010, REQ-S19-017, REQ-S19-018, REQ-S20-018. Schema, API and connector handover (slice F) is ADR-0070.
- **Sources (quoted where a design point has one):**
  - Acceptance texts (binding, `docs/delivery/requirements.csv`):
    - REQ-S01-001: "A02;A18: the guided end-to-end scenario completes on a persisted database using only native workflows, and the package installs and runs in a clean environment without builder-hosted services".
    - REQ-S01-006: "A18: a clean environment with a different base URL starts from the package and runs key workflows with outbound public internet disabled and no builder or personal credentials configured".
    - REQ-S16-008: "A18: docker compose up on a clean host reaches ready health checks; the docs state the HA limitation"; title "… plus deployment configuration for the actual IT orchestration target when known, without presenting Compose as proof of high-availability readiness".
    - REQ-S19-009: "A18: a clean deployment configured only from the template and guides starts successfully; the template contains no secret values".
    - REQ-S19-010: "A18;A22: on a clean VM the documented command reaches ready state, and the readiness endpoint reports database, storage and worker status".
    - REQ-S19-017: "A18: the drill report shows matching counts and checksums, working evidence downloads under the new base URL, successful key workflows, and records, jobs and approvals intact after a full restart".
    - REQ-S19-018: "A18;A21: the lifecycle e2e suite passes with egress blocked, and the image set loads on a host without registry access".
    - REQ-S20-018 (A18, M0387): "Clean environment starts successfully, restored records/files/configuration work and workflows run without the original builder or mandatory public SaaS".
  - Playbook: no block concerns deployment. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q1** (user): "the container halves (Compose up on a clean host, image load without a registry, Keycloak e2e) are run by the orchestrator on its host, with logs committed as orchestrator evidence; agents build and test the container-free halves; reviewers re-run what they can and judge the rest".
  - D-243 **Q6**: "storage gates readiness, worker reported only". **Q9**: drill reports in handback evidence, the QA re-run under `test-evidence/DG7/qa/`. **Q10**: "root `.env.example` kept, register text corrected". **Q12**: "no unknown-target manifests". **Q15**: "bootstrap re-proved, no new code". **Q17**: "different origin proven, sub-path only if already supported".
  - D-245 (ADR-0064): the migration package, `tools/migration/{export,import,reconcile}.mjs`, `transfer-attachments copy-in|verify`, `mth-db rebind-identity`. D-248 (ADR-0066, ADR-0068): the backup set, `copy-out` (O1), the upgrade dry run on a restored copy. D-246/D-247 (ADR-0062): the release archive and `tools/release/build-from-archive.sh`.
- **Builds on:** ADR-0005 (OIDC, cookies, CSRF Origin check), ADR-0007 §1 (health), ADR-0011 (configuration, readiness, restricted network), ADR-0051 §3 (deep links), ADR-0053 §6 (worker heartbeat), ADR-0054 §2 (effective evidence store), ADR-0062 (archive, offline build), ADR-0064 (migration package), ADR-0066/0068 (backup, upgrade dry run).
- **Two gate systems.** A drill report is engineering evidence. Starting the package in a clean environment is not Mobily IT's acceptance of it, and nothing here is a business, Finance or IT approval. Nothing here reads or writes DG0–DG7.

## Context

1. **Clean start exists, transfer does not.** `deploy/scripts/clean-start-local.sh` phase A (production semantics, `mth-db bootstrap`) and phase B (synthetic dev users, `smoke.mjs`) start a clean install from a fresh clone. Nothing moves an installation's data, files and configuration into another environment and proves it there.
2. **Readiness checks two things.** `apps/api/src/modules/platform/health.ts` answers `/readyz` from `database` and `migrations` only. The worker heartbeat exists since P6 (`apps/api/src/modules/operations/heartbeat.ts`, `getWorkerHeartbeat`), but readiness does not report it, nor the evidence store.
3. **Base URL.** `APP_BASE_URL` is required by the API (`server.ts` l.363). Read at use time, it sets the OIDC `redirect_uri` (`identity/oidc.ts` l.71, origin + `/api/v1/auth/callback`), the session and login cookie names (`__Host-` on https), the CSRF Origin check (`identity/routes.ts` l.53–90), the deep-link URL of a channel message (`apps/worker/src/handlers/notifications.ts` l.612, `new URL(path, appBaseUrl)` at send time) and the test-message link (`admin/notification-channels.ts` l.609).
4. **No container runtime for agents.** `docker info` exits 1 inside the agent sandbox (`environment.md` l.91–93). The orchestrator's host has a daemon (D-243 Q1).
5. **Network namespaces.** Measured in this task's sandbox on 2026-11-12 (handback evidence `netns-loopback.txt`): `bwrap --dev-bind / / --unshare-net` gives a namespace where a TCP connect to `1.1.1.1:443` fails with `ENETUNREACH` **and loopback works** (a listener on 127.0.0.1 answered). `unshare --user --map-root-user --net` gives a namespace whose loopback is **down** (a connect to a 127.0.0.1 listener failed with `ENETUNREACH`), and `ip` is not installed to bring it up. ADR-0062 §5.1 uses either for the build, which needs no loopback. A drill that runs PostgreSQL, the API and the worker needs loopback, so it uses `bwrap` only.

## Decision

### 1. The base-URL rules (REQ-S01-006, REQ-S19-017; D-243 Q17)

1. **What changes in a transfer is the origin** (scheme, host, port). Every absolute URL of the hub is built **at use time** from `APP_BASE_URL`: the OIDC redirect URI, cookie names, the CSRF Origin comparison and channel deep links. P7 adds no code that stores an absolute URL of the hub.
2. **Stored URLs are never the hub's own.** The schema holds three URL columns, all external by meaning: `evidence.url` (a link-evidence target entered by a user, 0012), `connector_config_version.endpoint_url` (a corporate source, 0104) and `assistant_setting.endpoint_url` (an IT model endpoint, 0111). A deep link is stored as a token (`/links/<token>`, ADR-0051 §3), never as a URL. A message already sent by a channel keeps the old origin in the recipient's mailbox; that is outside the installation.
3. **The proof is a scan, not a claim** (T-B3). After the drill's import, the target database is scanned: every `text`, `varchar` and `jsonb` column of every public table, for the **source origin string**. A hit outside `audit_event` fails the drill. Hits inside `audit_event` are listed in the report and accepted: audit rows are imported verbatim (ADR-0064 §6, ADR-0004), and an audit row that recorded the old origin is history.
4. **Sub-path serving is not supported, and P7 does not claim it** (Q17: "sub-path only if already supported"). It is not supported today: the SPA is built without a Vite `base`, `createBrowserRouter` has no `basename` (`apps/web/src/app/router.tsx` l.845), cookies are set with `Path=/`, the contract's `servers` entry is `/`, and `new URL("/links/…", base)` drops any path. BE-B adds, as additive behaviour:
   - a start-time **warning** when `APP_BASE_URL` has a path other than `/`: `config: APP_BASE_URL has the path '<path>'; serving under a sub-path is not supported, so the hub is served from the origin root (see the deployment guide)`. It does not refuse to start, which would change DG1 behaviour;
   - `basePath` in `getDeploymentStatus` (§3).

   The deployment guide (DOC-B) and the known limitations (ADR-0072) state the limitation.
5. **The IdP side of an origin change is IT's.** The new redirect URI (`<new origin>/api/v1/auth/callback`) and the post-logout URI must be registered with the IdP client. The deployment guide lists them. In the drill (§4), the drill's synthetic IdP accepts the new URI by configuration.

### 2. Readiness reports storage and worker (REQ-S19-010; seam 1; D-243 Q6)

`GET /readyz` keeps its status codes, its `status` values and its two checks. `checks` gains two keys, declared **optional** in the `Readiness` schema so that a DG1–DG6 body stays valid. Every P7 build sends both.

| Key | Values | How it is decided | Gates readiness |
| --- | --- | --- | --- |
| `database` | `ok`, `fail` | unchanged | yes |
| `migrations` | `ok`, `pending`, `fail` | unchanged | yes |
| `storage` | `ok`, `fail`, `unknown` | Only evaluated when `database` is `ok`, because the effective store depends on the saved `storage_setting` row (ADR-0054 §2). Else `unknown`. **Filesystem:** the root exists, is a directory, and is readable and writable by the process (`fs.stat` and `fs.access(R_OK \| W_OK)`). **S3-compatible:** the adapter built from the effective setting answers `head("mth-readiness-probe")` within 2 000 ms. A `null` (no such key) or an object is `ok`, while an exception, a timeout or an incomplete setting (the adapter cannot be built) is `fail`. | **yes**: ready needs `ok` |
| `worker` | `alive`, `stale`, `unknown` | `readWorkerHeartbeat(db).status` of P6 (`alive` ≤ 90 s, `stale` older, `unknown` no beat ever). Read only when `database` is `ok`, else `unknown`. | **no**: reported only |

- **Why the worker does not gate:** a load balancer that polls `/readyz` would otherwise withdraw every API instance when the worker stops, turning a background-job outage into a full outage (D-243 Q6). Operators watch `worker` here and in Administration > Operations, where P6 already opens a `heartbeat_missed` exception.
- **The vocabulary is P6's:** `alive|stale|unknown` is the `WorkerHeartbeatStatus` enum, so the same state never has two names. `unknown` is never shown as alive (CLAUDE.md: missing data is Unknown, never green).
- **Probe cost:** the storage result (`ok` or `fail`) is cached for **5 s** per API process, so a poller causes at most one storage call per 5 s per instance. The worker read is one indexed `SELECT` per request.
- **No secret leaves:** `/readyz` is public. It shows only the two enums, never a path, endpoint, bucket or error text. The failure is logged once per state change, at `warn`: `readiness: evidence storage (<driver>) did not answer the probe: <error code>`. That line names no endpoint, path or credential.
- **No remote I/O while a database connection is held:** the S3 probe runs after the pool client has been released (the P6 rule, D-141).
- **Wiring:** the platform module imports no domain module (ADR-0002). `registerHealthRoutes` takes the two probes as parameters, and `server.ts` passes the evidence module's `probeEvidenceStorage` and the operations module's heartbeat reader (one wiring change, BE-B).
- **Reopen (seam 1):** gating readiness on storage changes a DG1-approved behaviour, because a DG1-ready instance with an unreachable store becomes not ready. D-243 Q6 decided it. The orchestrator records it in DG1's history as a P7 reopen with this reason (REQ-S21-002). In every shipped profile the store is a filesystem volume that exists, so no shipped configuration changes state.
- **Documentation:** `docs/operations/health-readiness.md` gains the two keys and their meaning (BE-B).

### 3. `GET /api/v1/admin/deployment` (`getDeploymentStatus`; one new operation)

The deployment status of this installation, for its technical operators and for the drill:

- the configured `baseUrl`, its `origin` and `basePath`;
- `release.appVersion` (the API's `package.json` version, `unknown` when unreadable: the worker's rule) and `release.contractVersion` (`info.version` of the served OpenAPI document);
- `schema` (status by the readiness rule, shipped, applied and pending counts, and the name of the highest applied migration);
- the full `readiness` body of §2;
- `storage` (status, effective driver and source);
- `worker` (status, newest beat, stale threshold);
- `environmentKind` (the `deployment_environment` marker of 0090, or `null` before initialization);
- `checkedAt`.

It carries no secret value, credential reference, storage endpoint, bucket or connection string.

- **Permission:** the P6 code `operations.read` (ADM_TECH, TO, KDS, TD, AUD). Those roles already read the worker heartbeat and the operational exceptions. A dedicated code would need a seed migration, and a migration in `0150` would force every pending implementer migration of slices C, D and E (`0136`–`0149`) to renumber above it (D-245 O9, D-248 O8). The information is no more sensitive than the heartbeat card. No `P7_PERMISSIONS` entry is added. If the orchestrator wants a dedicated code, that is open question O1 of the handback.
- **Who reads it:** the drills (§4 D7, D9) assert `origin` equals the target's origin and `readiness.status` is `ready`. ADR-0071 (Administration > About) may show the release fields. No new screen is required by slice B.
- **No audit event:** it is a read of non-business metadata, like `getWorkerHeartbeat`.

### 4. The transfer drill (REQ-S19-017, REQ-S01-006, REQ-S19-009, REQ-S20-018, REQ-S01-001; DO-D; agent-run)

`deploy/scripts/transfer-drill.sh --archive <release.tar.gz> --sha256 <hex> --store <pnpm store> --out <dir> [--keep]` is container-free. It runs **inside one `bwrap --unshare-net` namespace** (§Context 5), which it enters itself. Its first step is the network probe of ADR-0062 §5.1 (a TCP connect to `1.1.1.1:443` and a DNS lookup of `registry.npmjs.org` must both fail). Without `bwrap` or PostgreSQL server binaries it exits **3 (BLOCKED)** with the reason. Ports come from the pool 25000–31999.

| Step | What it does | Recorded |
| --- | --- | --- |
| D0 | Verify the archive (`build-archive.mjs --verify`), then build from it (`build-from-archive.sh`, ADR-0062 §5) into `<work>/runtime`. | archive SHA-256, build exit, seconds |
| D1 | **Source installation** S at origin `http://localhost:<pS>`: fresh cluster, `mth-db migrate`, `mth-db seed-demo` (synthetic), API and worker. Run the A02 journey (`smoke.mjs`) so S holds records created through workflows, with evidence files, a decided gate approval and completed jobs. | per-table counts, evidence count, journey exit |
| D2 | **Export** from S: `tools/migration/export.mjs --out <pkg>` and `transfer-attachments copy-out` (ADR-0064 §5, D-248 O1); stop S. | manifest SHA-256, attachment manifest SHA-256 |
| D3 | **Target configuration T, only from the template and the guides** (REQ-S19-009): copy the root `.env.example` (D-243 Q10), then fill only the keys that `docs/handover/deployment.md` names. Each filled key cites the guide section that tells IT to set it, in `config-trace.json`. A key the target needs that no guide section names is a drill **failure** ("undocumented step"). Origin `http://127.0.0.1:<pT>` (another host and port than S), `NODE_ENV=production`, `AUTH_MODE=oidc`. **No builder or personal credential:** the only credentials are synthetic values generated for the drill (database passwords, the OIDC client secret of the drill IdP), written to `*_FILE` secret files. The `.env.example` secret check of ADR-0063 runs on the template first. | `config-trace.json`, secret-check exit |
| D4 | **Production initialization re-proved** (D-243 Q15; REQ-S19-005): on a separate clean database of cluster T, `mth-db migrate` then `mth-db bootstrap` succeeds, and a second `bootstrap` refuses. That database is then dropped. | exits |
| D5 | **Import into the empty target:** fresh cluster T and an empty evidence directory, `mth-db migrate`, `tools/migration/import.mjs --from <pkg>` (which runs `copy-in`, `import-migration` and `verify`), then `tools/migration/reconcile.mjs`. | reconciliation report: per-table counts, content digests, attachment checksums, all equal |
| D6 | **Identity rebind:** a mapping file maps each source user's (issuer, subject) to the drill IdP's issuer, and includes one ADM_TECH user. `mth-db rebind-identity --mapping <file>` runs, and an unmapped user is shown to stay unbound (sign-in refused). | rebind exit, mapping SHA-256, refused sign-in |
| D7 | **Start T** (API and worker from the runtime tree). `/readyz` must reach 200 with `storage: ok` and `worker: alive` within 120 s. `getDeploymentStatus` must report `origin` = T's origin and `environmentKind` as imported. | readiness bodies, seconds |
| D8 | **Key workflows under the new base URL**, signed in through OIDC (production semantics) as rebound users: (a) download **every** evidence file over HTTP from T and compare its SHA-256 with the attachment manifest; (b) the A02 journey steps that create and change records (a transformation, a KPI value, a RAID item, a gate submission and an approval decision by a rebound approver); (c) a request with the **source** origin in `Origin` is refused 403 (CSRF), which proves T acts on its own origin; (d) a deep link `/links/<token>` issued on T opens under T's origin. | each step's exit; download count = manifest count |
| D9 | **Full restart:** stop the API, the worker and PostgreSQL, then start all three again. Then: reconcile again (the counts and digests of every imported table are unchanged; tables D8 wrote to show exactly D8's additions); approvals (`gate_decision`, `approval` and `approval_decision` rows, including D8's) intact; jobs: pg-boss job rows, `job_run` rows and the enabled `job_schedule` rows equal their pre-restart values, and a job queued before the stop completes after it; every evidence file downloads again with its SHA-256; `/readyz` 200. | before/after tables |
| D10 | **Old-origin scan** (§1 item 3, T-B3). | hits by table |
| D11 | Write `transfer-drill-report.json` (`schemaVersion` `mth-transfer-drill/1`): each step with id, guide section, command, exit, seconds and result; the archive, manifest and mapping checksums; the totals; and `result` `PASS` only if every step passed. | the report |

- **The drill IdP is synthetic and loopback-only.** `deploy/scripts/drill/fake-idp-server.mjs` (DO-D) starts the P6 fake OpenID Provider (`apps/api/test/support/fake-idp.ts`: discovery, JWKS, PKCE token endpoint, RS256 ID tokens; validated by the real `openid-client`) on `127.0.0.1` inside the namespace. Its issuer, client and users are synthetic. It stands in for Mobily's IdP, which no agent can reach. The real sign-in path through Keycloak is the orchestrator's e2e (§7). The report labels the IdP `synthetic drill IdP (not a corporate IdP)`.
- **The A02 journey runs against T in production mode.** `smoke.mjs` signs in with dev users today (`MTH_SMOKE_AUTH=dev`). DO-D adds an `oidc-drill` mode to the drill's own journey script (`deploy/scripts/drill/journey.mjs`), which follows the redirect to the drill IdP. It does not change `smoke.mjs`.
- **Where the report goes:** `--out` points at DO-D's handback evidence directory (D-243 Q9). QA-C's independent re-run writes to `test-evidence/DG7/qa/transfer/`.

### 5. The offline drill (REQ-S19-018 first half, REQ-S01-006; DO-E; agent-run)

`deploy/scripts/offline-drill.sh --out <dir>` runs the **lifecycle e2e suite** (the A02 walkthrough specs and A21's, `e2e/a02-*.spec.ts` and `e2e/a21-*.spec.ts` where present, through `deploy/scripts/ci-e2e-stack.mjs`) inside one `bwrap --unshare-net` namespace, after the same network probe.

- **Connection log (A21, closes the REQ-S17-009 residual "the A18 capture is DG7's"):** the stack runs with `MTH_CONNECTION_LOG=<out>/connections.ndjson` (non-production mode, because the log writes nothing under `NODE_ENV=production`). The drill fails if any logged connection has an address outside `127.0.0.0/8`, `::1` or the PostgreSQL socket directory. The DNS-port residual of REQ-S17-009 (a failed DNS lookup logs no port) is carried, not fixed.
- **Browsers:** Playwright uses the Chromium already installed for the e2e suite. If none is installed, the drill exits 3 (BLOCKED), and never downloads one.
- **Result:** `offline-drill-report.json` (`mth-offline-drill/1`): the probe results, the spec list with their outcomes, the connection-log summary, seconds.

### 6. The image bundle (REQ-S19-018 second half; DO-E; container half run by the orchestrator)

`deploy/scripts/image-bundle.sh save --out <dir>` / `load --from <dir>` / `verify --from <dir>`:

- **save:** for every image of `deploy/images.lock.json` (by digest) and the locally built application image (`build-image.sh`), run `docker save`. Write `images.tar` and `images.json` (name, lock digest, image id, size, tar SHA-256).
- **load:** check `images.tar` against `images.json`, run `docker load -i images.tar`, then check each `docker image inspect` id against `images.json`. A mismatch exits 1.
- **The registry-free proof:** before `load`, the orchestrator removes the images (`docker image rm`). After `load`, it runs `docker compose … up --pull never --wait`, which fails if any image is missing locally. So a successful start shows that nothing was pulled. The log records `docker info` (registry mirrors), the commands and the exits.
- **The agent half (container-free):** the script's logic is tested with a **stub `docker`** on `PATH` that records calls and serves fixture outputs (T-B12). This proves the manifest, checksum and refusal logic, not a real load.

### 7. Compose up on a clean host and the drill split (REQ-S16-008; D-243 Q1, Q12)

- **Compose up (orchestrator):** on its host, with a fresh project name and no prior volumes, using the images loaded in §6: `docker compose -f deploy/compose/compose.yaml up -d --pull never --wait`. The run records `docker compose ps` with every service `healthy` (the API's healthcheck is `mth health /readyz`, so it includes `storage`), and the `/readyz` body with all four keys. Then the same with `compose.no-egress.yaml` and the `test-idp` profile, where the smoke service asserts that egress is blocked. Then the Keycloak e2e (`e2e/identity/keycloak-login.spec.ts`; REQ-S16-007, the D-049 residual).
- **The HA statement already exists** (`docs/operations/README.md` l.8, `clean-start.md` l.7). The deployment guide (DOC-B) repeats it: "Compose is a reproducible install and test configuration, not evidence of high-availability readiness."
- **No orchestration-target manifests** (D-243 Q12). No Kubernetes, Helm or other target files are written, because no target is known and they would be untested claims. The deployment guide maps the Compose services to generic roles (database, API, worker, migration job, backup job, optional IdP for tests), lists what IT must supply, and records "deployment configuration for the IT orchestration target" as an external configuration dependency (M0414).

**The split, per clause.** "Agent" means an agent run inside its sandbox. "Orchestrator host" means the orchestrator, outside the agent sandbox, with its logs committed as orchestrator evidence under `test-evidence/DG7/orchestrator/`.

| Clause | Agent | Orchestrator host |
| --- | --- | --- |
| clean environment from the package, no builder-hosted services (S01-001, S20-018) | D0–D11 in a no-network namespace (DO-D, re-run by QA-C) | Compose up from the loaded images |
| different base URL (S01-006, S19-017) | D3, D7, D8 (c)(d), D10 | — |
| key workflows with egress disabled, no builder or personal credentials (S01-006) | D8 inside the namespace; the offline drill (§5) | Compose with `compose.no-egress.yaml` |
| template and guides only; no secret in the template (S19-009) | D3 `config-trace.json`; the ADR-0063 template check | — |
| documented command reaches ready; readiness reports database, storage and worker (S19-010) | BE-B tests T-B1, T-B2; D7 | Compose `healthy` with `mth health /readyz` |
| counts, checksums, evidence downloads, workflows, restart (S19-017, S20-018) | D5, D8, D9 | — |
| docker compose up on a clean host (S16-008) | — | §7 Compose up |
| lifecycle e2e with egress blocked (S19-018) | §5 offline drill | the no-egress Compose run |
| image set loads without a registry (S19-018) | T-B12 (script logic with a stub `docker`) | §6 save, remove, load, `--pull never` |
| HA limitation in the docs (S16-008) | DOC-B guide; T-B14 text check | — |
| Keycloak e2e (S16-007 residual) | — | §7 |

### 8. Advisory locks

None. The block 730416–730417 stays **reserved** (ADR-0016 §6): the readiness checks and `getDeploymentStatus` only read, and the drills run outside the API.

### 9. Who builds it, and how it is tested

| Task | Builds | Tests (ids of `p7-work-split.md` §B.4) |
| --- | --- | --- |
| BE-B | `health.ts` storage and worker checks, `probeEvidenceStorage`, the `server.ts` wiring, the sub-path warning, `getDeploymentStatus`, `health-readiness.md` | T-B1, T-B2, T-B4…T-B8 |
| DO-D | `transfer-drill.sh`, `drill/{fake-idp-server,journey,origin-scan}.mjs`, the report format | T-B3, T-B9, T-B10, T-B11 (the drill run) |
| DO-E | `offline-drill.sh`, `image-bundle.sh`, the image half of `restricted-network.md`, the P7 rows of `environment.md` | T-B12, T-B13 (the offline run) |
| DOC-B | `docs/handover/deployment.md` (the sections D3 cites; HA statement; sub-path limitation; service roles) | T-B14 |
| QA-A / QA-C | `tests/qa/integration/a18-*.test.ts` (test-first), then the independent re-run of D0–D11 and §5 | A18 |
| orchestrator | §6 and §7 on its host | logs under `test-evidence/DG7/orchestrator/` |

## Consequences

- Positive: one drill proves all of A18's container-free clauses in a namespace with no route off the host. It uses only shipped tools: the archive, the migration package, the rebind and the readiness endpoint.
- Positive: readiness now says whether the API can serve evidence, and shows the worker's state without letting it take the API down.
- Negative: storage gating is a DG1 reopen. It is recorded as one, and it changes no shipped profile's state.
- Negative: the drill's IdP is synthetic. Sign-in through a corporate IdP stays unproven here.

## Residuals (honest)

1. **Container halves depend on the orchestrator's host** (D-243 Q1). If that host cannot run them, the Compose, image-load and Keycloak clauses are recorded BLOCKED with the reason. That is a release blocker under REQ-S21-003, never a pass.
2. **"Clean VM"** is approximated by a fresh cluster, a fresh runtime tree and a namespace with no network in the agent sandbox, and by a fresh Compose project on the orchestrator's host. No separate virtual machine is provisioned.
3. **Sub-path serving** is not supported. It is a known limitation (§1 item 4).
4. **Corporate IdP, object store and mail** stay as the P6 residuals (`environment.md`). The drill uses the filesystem store and the synthetic IdP. The S3 storage probe is tested against the P6 fake S3 only.
5. **"Host without registry access"** is shown by `--pull never` after the images were removed, on a host that otherwise has registry access. It is not a physically air-gapped host.
6. **Already-sent messages** keep the source origin in recipients' mailboxes (§1 item 2).
7. **The DNS-port residual of REQ-S17-009** is carried (§5).

## Alternatives considered

1. **Gate readiness on the worker too.** Rejected (D-243 Q6): a worker outage would withdraw every API instance.
2. **A dedicated `deployment.read` permission.** Rejected for P7: it needs a seed migration that would force slices C–E to renumber their pending migrations, for data that the `operations.read` holders already see in part (§3). It stays open question O1.
3. **Refuse to start when `APP_BASE_URL` has a path.** Rejected: it would change DG1 behaviour for a configuration that serves from the root today. A warning plus the documented limitation is additive.
4. **Kubernetes manifests "for later".** Rejected (D-243 Q12): untested claims about an unknown target.
5. **`unshare --net` for the drill.** Rejected: its loopback is down and `ip` is absent (§Context 5). `bwrap --unshare-net` brings loopback up.
6. **Use the dev login (`AUTH_MODE=dev`) in the drill.** Rejected: it is refused in production (`clean-start-local.sh` A3), and the acceptance asks for the production configuration. The synthetic OIDC provider exercises the real sign-in code.

## Version evidence (M0314)

No new dependency and no new image. The drills use Node 24.21.0 built-ins, GNU tar, `bwrap` (bubblewrap 0.9.0, verified by ADR-0062 §5.1 and by this task's loopback measurement), the PostgreSQL 16 server binaries already used by `clean-start-local.sh`, the pinned images of `deploy/images.lock.json`, and the Chromium already used by the e2e suite. `docker save`, `docker load`, `docker compose up --pull never` and `--wait` are features of the Docker client 29.3.1 and Compose v5.1.1 recorded in `environment.md`. They run only on the orchestrator's host.
