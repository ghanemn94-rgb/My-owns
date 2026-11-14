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

`deploy/scripts/offline-drill.sh --out <dir>` runs the **lifecycle e2e suite** (the A02 walkthrough specs and A21's, `e2e/a02-*.spec.ts` and `e2e/a21-*.spec.ts` where present, in both Playwright projects, **on the stack that each spec's header names**: `e2e/support/with-demo-stack.sh` or `apps/web/e2e/support/with-stack.sh`) inside one `bwrap --unshare-net` namespace, after the same network probe. _Amended by Amendment 1 (A1.1): the original text said "through `deploy/scripts/ci-e2e-stack.mjs`"; that is the CI launcher and cannot run in the namespace._

- **Connection log (A21, closes the REQ-S17-009 residual "the A18 capture is DG7's"):** the stack runs with `MTH_CONNECTION_LOG=<out>/connections.ndjson` (non-production mode, because the log writes nothing under `NODE_ENV=production`). The drill fails if any logged connection has an address outside `127.0.0.0/8`, `::1` or the PostgreSQL socket directory. The DNS-port residual of REQ-S17-009 (a failed DNS lookup logs no port) is carried, not fixed.
- **Browsers:** Playwright uses the Chromium already installed for the e2e suite. If none is installed, the drill exits 3 (BLOCKED), and never downloads one.
- **Result:** `offline-drill-report.json` (`mth-offline-drill/1`): the probe results, the spec list with their outcomes, the connection-log summary, seconds.

### 6. The image bundle (REQ-S19-018 second half; DO-E; container half run by the orchestrator)

`deploy/scripts/image-bundle.sh save --out <dir>` / `load --from <dir>` / `verify --from <dir>`:

- **save:** for every image of `deploy/images.lock.json` (by digest) **that a Compose file runs** (its `usedIn` names a file under `deploy/compose/`), and the locally built application image (`build-image.sh`), run `docker save`. Write `images.tar` and `images.json` (name, lock digest, image id, size, tar SHA-256). _Amended by Amendment 1 (A1.3): the original text said "every image"; the CI-only Playwright image is not part of the deployable image set._
- **Image store (Amendment 1, A1.2):** the load host uses Docker's **containerd image store**, so the digest-pinned `image:` lines of Compose resolve after `load`. A host on the classic store records the image clause BLOCKED with that reason. The bundle never rewrites `image:` lines. _Amended by Amendment 2 (A2.1): the original text also said "the bundle never re-tags images". `save` now tags each pinned image `<ref>:<tag>` on the **connected** host, after an id check, and saves by that name. `load` and `verify` never tag._
- **load:** check `images.tar` against `images.json`, run `docker load -i images.tar`, then check each `docker image inspect` id against `images.json`. A mismatch exits 1.
- **The registry-free proof:** before `load`, the orchestrator removes the images (`docker image rm`). After `load`, it runs `docker compose … up --pull never --wait`, which fails if any image is missing locally. So a successful start shows that nothing was pulled. The log records `docker info` (registry mirrors), the commands and the exits.
- **The agent half (container-free):** the script's logic is tested with a **stub `docker`** on `PATH` that records calls and serves fixture outputs (T-B12). This proves the manifest, checksum and refusal logic, not a real load.

### 7. Compose up on a clean host and the drill split (REQ-S16-008; D-243 Q1, Q12)

- **Compose up (orchestrator):** on its host, with a fresh project name and no prior volumes, using the images loaded in §6: `docker compose -f deploy/compose/compose.yaml up -d --pull never --wait`. The run records `docker compose ps` with every service `healthy` (the API's healthcheck is `mth health /readyz`, so it includes `storage`), and the `/readyz` body with all four keys. Then the same with `compose.no-egress.yaml` and the `test-idp` profile, where the smoke service asserts that egress is blocked. Then the Keycloak e2e (`e2e/identity/keycloak-login.spec.ts`; REQ-S16-007, the D-049 residual). _Amended by Amendment 2 (A2.2): the Keycloak e2e runs on the default stack with the `test-idp` profile, not on the no-egress stack, and its test process runs without the host's proxy variables._
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

## Amendment 1 (2026-11-14, T-DG7-ARCH-R6): the offline drill's stacks, the image store for digest references, and the bundle's image set

- **Author:** solution-architect (T-DG7-ARCH-R6). Base `85f6ebe9fb6b7136bd3cbb1670400be449b8dfc8` on `claude/mobily-transformation-platform-dg6-regate`.
- **Why.** D-265 sends DO-E's open questions to the architect before the freeze (`docs/delivery/handbacks/DG7/T-DG7-DO-E-devops-engineer.md` §5):
  - **Q1:** §5 names `ci-e2e-stack.mjs`, and the shipped drill uses the stacks the spec headers name;
  - **Q2:** after `docker load` on a host with the classic image store, Compose's digest-pinned `image:` lines may not resolve under `--pull never`;
  - **Q3:** whether `save` bundles the CI-only Playwright image.
- **What it replaces.** The first sentence of §5 and the `save` bullet of §6, both edited in place with a pointer here. Everything else in this ADR stands, including the connection-log rule, the browser rule, the report format `mth-offline-drill/1`, the registry-free proof of §6 and the split of §7.
- **Contracts.** No API, schema, migration, permission or advisory-lock change. `mth-offline-drill/1` is unchanged. `mth-image-bundle/1` gains one **optional** key (A1.3), so a manifest written before it stays valid.

### A1.1 The offline drill runs on the specs' own stacks (Q1: the ADR changes, the drill does not)

The drill is right and the ADR text was wrong. The rule is now:

1. **Specs.** Every `e2e/a02-*.spec.ts` and `e2e/a21-*.spec.ts` present, or the `--spec` list, in both projects (`chromium-en`, `chromium-ar`).
2. **Stack per spec.** A spec whose first 25 lines name `e2e/support/with-demo-stack.sh` runs on that stack (`mth-db seed-demo`). Every other spec runs on `apps/web/e2e/support/with-stack.sh`. These are the stacks the specs were written and reviewed against (DG5 A02, DG6 A21).
3. **Same properties as the original rule.** Both stacks start a disposable PostgreSQL cluster inside the namespace and the **built** API serving the **built** SPA. They run with `NODE_ENV` development or test, which the connection log needs (§5, first bullet). Ports come from the pool 25000–31999 (`MTH_PORT_POOL`).

**Why not `ci-e2e-stack.mjs`.** Measured in DO-E's handback, gap 2, and confirmed by reading the launcher (`deploy/scripts/ci-e2e-stack.mjs` l.1–20 at the base):

- it needs `TEST_DATABASE_ADMIN_URL`, a PostgreSQL service that is already running. In CI that is the job's service container, and the namespace has none (exit 3 without it);
- it seeds only `seed-dev`, and the A02 specs need `seed-demo` (their headers say so);
- it starts one API on `:3000`. The A21 degradation spec also starts its own fresh-install API from the port pool.

Changing the drill to use it would mean a second PostgreSQL bootstrap inside the namespace and a demo seed path in a CI launcher, for no gain in what the drill proves.

**What stays.** `ci-e2e-stack.mjs` remains the CI launcher of the `e2e` job (ADR-0012). The drill does not depend on it.

**Disclosure.** The drill groups the specs by a header grep. A future A02 or A21 spec whose header does not name its stack runs on the plain stack. If it needs demo data it fails, so it is never a false pass.

### A1.2 Digest references after `load`: the containerd image store is a precondition (Q2)

**The problem.**

- Compose pins its images by digest: `postgres:18@sha256:5a5a…9722` and `quay.io/keycloak/keycloak:26.8.1@sha256:a78d…dd6b` in `deploy/compose/compose.yaml`. `image-bundle.sh` saves and checks the same `<ref>:<tag>@<digest>` names.
- A digest reference resolves locally only if the engine knows the image's registry manifest digest.
- With the **classic** image store (graph drivers such as `overlay2`), that digest is recorded as `RepoDigests` on pull and is **not restored by `docker load`**. So after a remove-and-load, `docker image inspect <ref>:<tag>@<digest>` and `up --pull never` can both fail with "no such image".
- With the **containerd** image store, `docker save` writes the image's manifests and index and `load` restores them, so the digest reference resolves.

**Decided:**

1. **The load host uses the containerd image store.** The orchestrator records `docker info` before step 2 of DO-E's command list. The store is the containerd one when `docker info` shows the storage driver `overlayfs` with `driver-type: io.containerd.snapshotter.v1`; `overlay2` is the classic store.
   - P1's host already recorded `overlayfs` (`docs/delivery/environment.md`, Docker Engine row). That is a strong hint, not a proof: the DG7 run records its own `docker info`.
2. **A classic-store host is BLOCKED, never worked around.**
   - On such a host the image clause of REQ-S19-018 is recorded BLOCKED: "the load host uses the classic image store; digest-pinned references do not resolve after load (ADR-0069 A1.2)". That is a release blocker under REQ-S21-003, never a pass.
   - The orchestrator may switch that host to the containerd store (`"features": {"containerd-snapshotter": true}` in `daemon.json`, then restart the daemon) and rerun from step 1. Switching stores hides the images already present, so step 1 pulls them again.
3. **No re-tag and no rewritten `image:` lines.** _Amended by Amendment 2 (A2.1): host run 2 showed that a bundle saved under digest names loses its names on load, even on the containerd store. `save` now tags `<ref>:<tag>` on the connected host. The rejection of (a) and (b) below stands, because neither of them is that change._ Rejected alternatives:
   - (a) re-tagging the loaded images to tag-only names plus a Compose override without digests. It removes the digest pin at start time, which is exactly what `images.lock.json` exists to guarantee (ADR-0011). It also needs an override file that nothing else tests.
   - (b) a Compose override naming images by image id. It is unreadable for IT and differs per build of the app image.
   - The bundle's own check stays as it is: `load` and `verify` inspect the digest name. On a classic store they fail with `image-bundle: <name> does not match images.json (present)` (exit 1). A1.2 rule 1 turns that into a precondition, so the failure explains itself before the run.
4. **Follow-up for DO-E (code, not done here).** `image-bundle.sh load|verify` should report the store before loading and exit 3 on the classic store with this line: `image-bundle: BLOCKED: the classic image store cannot resolve digest references after load (ADR-0069 A1.2); enable the containerd image store`. It should be tested with the stub `docker` (a T-B12 case). Until then, the orchestrator's `docker info` record carries the check.

**Not verified here.** The agent sandbox has no network and no Docker daemon (D-243 Q1). So the behaviour above comes from the engine's documented store model as I know it, and it was **not** checked against current official Docker documentation or by a run.

- The orchestrator's host run is the proof. If a classic store resolves the digest names after `load`, or a containerd store does not, the run's result decides, and this section is reopened.
- M0314's evidence for the store behaviour is therefore **pending**. It is not claimed.

### A1.3 The bundle holds the image set that Compose runs (Q3)

1. **Decided.** `save` bundles every lock image whose `usedIn` names a file under `deploy/compose/`, plus the application image. On the current lock that is `postgres` and `keycloak` (the `test-idp` profile, which step 6 of the orchestrator's list runs), plus `mth-app`.
   - `playwright` (`scope: test-ci`, `usedIn` only `.github/workflows/ci.yml`) is **not** bundled. No Compose service runs it, and the Keycloak e2e (step 7) runs Playwright on the host with its installed Chromium. Bundling it adds an estimated 1–2 GB (DO-E's estimate, not measured) to every transfer for no clause of REQ-S19-018 ("the image set loads on a host without registry access").
2. **`node-runtime`** is **not** bundled separately either. Its `usedIn` is `deploy/docker/Dockerfile`, not a Compose file. Its layers already travel inside the app image, which is bundled whole, and the target never builds the app image. A target that needs to rebuild uses the release archive's offline build (ADR-0062), not the image bundle.
3. **The manifest says what was left out.** `images.json` gains an optional `excluded` array, `[{ "lockId", "reason" }]`, with the reason `not run by any Compose file (usedIn: <files>)`. `check_tar` ignores it. A reader sees that the Playwright image was left out on purpose, not lost.
4. **T-B12 changes** (p7-work-split §B.4): `save` lists every lock image that a Compose file runs, plus the app image; the Playwright fixture appears in `excluded` and in no `docker save` argument.
5. **Follow-up for DO-E (code, not done here).** The selection in `save`, the `excluded` key and the T-B12 case. **Until it lands**, the shipped script still saves every lock image. The orchestrator then pulls the Playwright image in step 1, as DO-E's list already does ("if Q3 keeps it"). The bundle is larger but correct, so the host run need not wait for the follow-up.

### A1.4 Residuals added

8. **Image store.** The digest-reference behaviour of A1.2 is unverified until the orchestrator's host run (A1.2, "Not verified here").
9. **Header grouping.** The offline drill picks a spec's stack by a header grep (A1.1, Disclosure).

## Amendment 2 (2026-11-14, T-DG7-ARCH-R7): the bundle tags on the connected host; where and how the Keycloak e2e runs

- **Author:** solution-architect (T-DG7-ARCH-R7). Base `f0b09b34760e4bf8389b6eeb1f9f39a18b21c08c` on `claude/mobily-transformation-platform-dg6-regate`.
- **Why.** D-267 sends two questions to the architect before the freeze:
  - DO-E4 Q1 (`docs/delivery/handbacks/DG7/T-DG7-DO-E4-devops-engineer.md` §5): A1.2 rule 3 and §6 say "the bundle never re-tags images", and DO-E4's `save` tags each pinned image on the connected host;
  - the Keycloak e2e of §7 passed only when its test process ran without the host's proxy variables (host run 3c).
- **Evidence.** These are the orchestrator's host runs, all under `docs/delivery/test-evidence/DG7/orchestrator/host/`. All ran on Docker Engine 29.9.2 (client and server), Compose v5.6.1 and the containerd image store (`docker info`: `Storage Driver: overlayfs`, `driver-type: io.containerd.snapshotter.v1`; `host-run.log` l.21–23).
  - **Host run 2** (`host-run-2-bundle-names-lost.log`). This is the old `save`, which passed `<ref>:<tag>@<digest>` to `docker save`:
    - `load` printed `Loaded image ID: sha256:5a5a…` and `Loaded image ID: sha256:a78d…`, with no name (l.656–657);
    - `verify` reported `… does not match images.json (present)` (l.659–660, step 06 exit 1);
    - `up --pull never` failed with `No such image: postgres:18@sha256:5a5a…` (l.677–680, step 07 exit 1).
  - **Host run 3** (`host-run.log`). This is DO-E4's `save`:
    - it logged `tagged postgres:18 …; saved as postgres:18` and the same for Keycloak (l.555–556, step 04 exit 0);
    - after `docker image rm` (step 05), `load` printed `Loaded image: postgres:18`, `Loaded image: quay.io/keycloak/keycloak:26.8.1` and `Loaded image: mth-app:local` (l.624–626);
    - every `<ref>:<tag>@<digest>`, `<ref>:<tag>` and app name resolved to its recorded id in `load` and `verify` (step 06 exit 0);
    - `up -d --pull never --wait` succeeded, with `/readyz` `{"status":"ready","checks":{"database":"ok","migrations":"ok","storage":"ok","worker":"alive"}}` (step 07 exit 0);
    - the no-egress stack with `test-idp` became healthy (step 09 exit 0);
    - the Keycloak e2e on the no-egress stack failed with `net::ERR_CONNECTION_REFUSED at http://localhost:3000/login` in all 4 tests (step 11 exit 1).
  - **Host run 3b** (`host-run-3b.log`):
    - the no-egress smoke passed: `{"smoke":"PASS","mode":"oidc",…,"steps":15,"passed":15,…}` (b03 exit 0);
    - the Keycloak e2e on the default `test-idp` stack timed out at `page.waitForURL` for the IdP origin in all 4 tests (b07 exit 1, 247 s).
  - **Host run 3c** (`host-run-3c.log`): the same stack and the same command as 3b b07, with the proxy variables removed (`env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u ALL_PROXY -u all_proxy …`). Result: `4 passed (10.3s)` (b07 exit 0).
- **What it replaces:**
  - in A1.2, the "no re-tag" half of rule 3, and the store-model statement in the problem description, as far as host run 2 contradicts it (A2.1 item 4);
  - in §6, the sentence "The bundle never re-tags images";
  - in §7, where the Keycloak e2e runs (A2.2).

  Each replaced place carries a pointer here. Everything else stands: A1.2 rules 1, 2 and 4, A1.3, the registry-free proof of §6, and the split table of §7.
- **Contracts.** No API, schema, migration, permission or advisory-lock change. `mth-image-bundle/1` gains one more **optional** key, `savedAs` (already shipped by DO-E4). A manifest written before it still parses, but such a bundle fails to load on a real engine (A2.1 item 6).

### A2.1 `save` tags the pinned image on the connected host; `load` and `verify` never tag (DO-E4 Q1)

1. **Decided: DO-E4's approach, as shipped in `deploy/scripts/image-bundle.sh`.** For each lock image that a Compose file runs (A1.3), `save` does the following:
   1. It requires the containerd store (exit 3 otherwise, the A1.2 rule 4 line).
   2. **Pass 1, which changes nothing on the host:**
      - it reads the local id of `<ref>:<tag>@<digest>`, and refuses with exit 1 if that id is not the lock digest;
      - it refuses with exit 1 if `<ref>:<tag>` already names a **different** image;
      - an image that is not present is BLOCKED (exit 2).

      Nothing is tagged until every image has passed.
   3. **Pass 2:**
      - it runs `docker tag <ref>:<tag>@<digest> <ref>:<tag>`;
      - it re-inspects `<ref>:<tag>`, and exits 1 if the id is not the lock digest;
      - it saves all images in one `docker save`, by `<ref>:<tag>` for each lock image and by its own name for the app image (which is never tagged).
   4. `images.json` records `name`, the reference Compose uses, and `savedAs`, the name inside the archive.
2. **`load` and `verify` never tag, and nothing rewrites an `image:` line.** They check that every `name` **and** every `savedAs` resolves to the recorded `imageId`. On the target host the `<ref>:<tag>` name arrives inside the archive. No command of the bundle creates or moves a tag there.
3. **Why this is not the alternative rejected in A1.2 rule 3 (a).** Alternative (a) re-tagged the loaded images to tag-only names on the **target**, and started Compose from an override **without digests**. That removed the digest pin at start time. This change keeps it:
   - Compose's `image:` lines still read `<ref>:<tag>@<digest>`, unchanged;
   - `up --pull never` starts only an image whose digest is the pinned one (host run 3 step 07);
   - the tag is only the name the archive carries, and `save` checks the id behind it twice: before tagging, and after.
4. **What host run 2 corrects in A1.2.** A1.2 said that with the containerd store, `docker save` writes the manifests and index and `load` restores them, "so the digest reference resolves". On this engine, an image passed to `docker save` under a digest reference came back from `load` with **no name** (host run 2). Under a `<ref>:<tag>` name, it came back with that name, and its digest reference resolved (host run 3). So the precondition of A1.2 rule 1 stays, and it is not sufficient on its own: the archive must carry `<ref>:<tag>` names.
   - I read the cause as `docker save` recording only tag references as names in the archive. That is an inference from the two runs. It was **not** checked against current official Docker documentation (the agent sandbox has no network).
5. **Side effect on the connected host, and DO-E4 Q2.**
   - After `save`, the connected host has the local tags `postgres:18` and `quay.io/keycloak/keycloak:26.8.1`, pointing at the pinned digests.
   - If such a tag already names another image (for example `postgres:18` pulled by tag at a later digest), `save` refuses and changes nothing. The operator removes or renames that tag, then saves again. `docs/operations/restricted-network.md` says so.
   - **Architectural recommendation on DO-E4 Q2** (the orchestrator decides): keep the refusal. Never remove or move an operator's tag automatically. A script that silently repoints `postgres:18` on a shared host would change what other workloads on that host start.
6. **Older bundles.** A bundle written without `savedAs` gets only the `name` check. On a real engine it fails as host run 2 did. Such a bundle must be saved again; it is never "repaired" by tagging at load.
7. **Tests.** T-B12 (p7-work-split §B.4) covers this with the stateful stub `docker` of DO-E4: tagging before the single `docker save`, the round trip, an old-format archive failing, the two refusals and exit 3 on the classic store. Host run 3 steps 04–09 are the real-engine proof on one host.

### A2.2 The Keycloak e2e: on the default `test-idp` stack, with the host's proxy variables removed (§7)

1. **Stack.** The Keycloak e2e runs on the **default** stack with the `test-idp` profile: `docker compose -f deploy/compose/compose.yaml --profile test-idp up -d --pull never --wait`, then the `db bootstrap` of `e2e/support/keycloak-login.ts`, then the spec.
   - It does **not** run on the no-egress stack. `compose.no-egress.yaml` makes the network `internal: true` and resets every published port (its l.6–19), so no browser on the host can reach the API (host run 3 step 11: `ERR_CONNECTION_REFUSED`, exit 1, kept as evidence).
   - What each run proves:
     - the egress clause of §7 is proven by the no-egress stack becoming healthy plus its smoke service (host run 3 step 09, host run 3b b03, 15/15, egress probe refused);
     - the Keycloak e2e proves REQ-S16-007: sign-in through realm `mth-test`, and the refusal of realm `mth-other`. That needs no egress block.
   - §7's order ("then the Keycloak e2e") is read as: after the no-egress run, on a fresh default `test-idp` project.
2. **The test process runs without the host's proxy variables.** The Playwright process is started with `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and their lower-case forms **unset**, as in host run 3c. Adding the IdP host name to `NO_PROXY` is the equivalent alternative.
   - Why: the IdP origin is `https://keycloak:8443` (Compose's `KC_HOSTNAME`), and the spec maps the name `keycloak` to 127.0.0.1 inside Chromium. The host's `NO_PROXY` (`00-env.log` l.53) lists `localhost` and `127.0.0.0/8`, but not `keycloak`. With the proxy variables set, the navigation to the IdP did not complete (host run 3b, 60 s timeout ×4). Without them, all 4 tests passed (host run 3c). The two runs differ only in those variables.
   - **Mechanism, inferred and not verified:** Chromium hands a host that is not in its bypass list to the proxy, which resolves `keycloak` itself and cannot reach the local container.
   - **What this changes, and what it does not.** This is a property of the **test host**: an agent build proxy that has no route to the host's containers. It changes no product code, no Compose file and no TLS rule. The API validates the IdP inside the Compose network and never uses the host's proxy. A target installation configures its own IdP origin (ADR-0054 §1). Its proxy rules are IT's (`docs/operations/restricted-network.md`).
3. **Follow-up (not done here; it is not the architect's file).** The run instructions in the header of `e2e/support/keycloak-login.ts` (l.11–19) should say: "run the spec with the HTTP(S)/ALL proxy variables unset, or with the IdP host in `NO_PROXY`". The orchestrator routes this to the e2e helper's owner. Until it lands, this amendment and host run 3c carry the instruction.
4. **Status.** REQ-S16-007's Keycloak e2e: 4/4, `chromium-en` and `chromium-ar` (host run 3c b07 exit 0). Host run 3 step 11 and host run 3b b07 are failed runs, kept and disclosed (D-267).

### A2.3 Residuals changed

- **Residual 1 (container halves depend on the orchestrator's host):** the host halves ran in the orchestrator's container, with a Docker daemon it started (D-266 (a), D-267). One host only. An independent rerun is the reopen condition of D-267.
- **Residual 5 (not air-gapped):** it stands. The host had registry access through a proxy. "Without registry access" is shown by `docker image rm` followed by `--pull never` (host run 3 steps 05–07).
- **Residual 8 (image store):** narrowed. On the containerd store, the A2.1 bundle loads and its digest references resolve. Host run 3 observed this on one engine, 29.9.2. No classic-store host was run, so the classic-store BLOCKED rule (A1.2 rule 2; `save`, `load` and `verify` exit 3) is tested with the stub `docker` only. M0314's documentary evidence for the store behaviour is still **pending**: no current official Docker documentation was consulted.
- **New residual 10 (test-host proxy):** the Keycloak e2e depends on the test process bypassing the host's proxy for the IdP host (A2.2 item 2). A host whose proxy settings cannot be changed records that e2e BLOCKED with this reason. It is never recorded as a pass.
- **Version evidence.** The host runs used Docker Engine 29.9.2 and Compose v5.6.1, not the 29.3.1 and v5.1.1 that this ADR's version-evidence section cites from P1's `environment.md`. No new feature is used: `docker tag` is as old as `docker save`.
