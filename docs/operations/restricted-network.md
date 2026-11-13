# Restricted networks: build and run without outbound internet (§19 item 7, REQ-S19-019; P1 increment)

## Runtime: no outbound internet needed

A default installation needs exactly two services, both inside company infrastructure:

- **PostgreSQL**, used by `api`, `worker` and `migrate`;
- the **corporate OIDC IdP**, used by `api` only. A SAML-only IdP sits behind an OIDC broker that IT runs
  ([identity-saml-broker.md](identity-saml-broker.md)). The hub still talks only OIDC, to the configured issuer.

The application uses no telemetry, analytics, CDN, remote fonts (IBM Plex is bundled) or update checks. The
assistant setting's `telemetryEnabled` is the constant `false`.

### Optional outbound destinations (P6): each off unless IT configures it

This release also ships the integrations below. **Each is off in a fresh install** and makes no connection until an
administrator configures it with values Mobily IT supplies. None of them has a builder-hosted or public default.
Each is proven only against a local fake in this release, and none is claimed to be connected to a Mobily system.

| Destination | Off until | Process that connects | Where it is set | Guide |
|---|---|---|---|---|
| **SMTP relay** (the email channel) | an email channel is configured and enabled for an organization | `worker` (notifications) and `api` (the "test to me" message) | Administration > Notifications, per organization: host and port | [notifications.md](notifications.md) §2, §7 |
| **Connector source endpoint** (`http_pull` adapter) | an `http_pull` connector is created and enabled, or tested | `api` only: the test, and the run watch that executes due runs. The worker only queues the scheduled slots. | Administration > Integrations, per organization: the connector's `endpointUrl` | ADR-0055 §1, §3 |
| **S3-compatible object store** | a candidate `s3` setting is tested, or the storage setting is switched to `s3`. With no `storage_setting` row the environment default applies, `filesystem` in every shipped profile. | `api` only. Export files stay on the filesystem driver, and the worker makes no object-store connection. | Administration > Storage, installation-wide: the endpoint | [storage.md](storage.md) §3, §7 |
| **Assistant model endpoint** (`http_endpoint` provider) | the assistant setting is enabled with `http_endpoint`. With it disabled, no provider is built. | `api` only. The worker has no assistant code. | Administration > AI assistant, installation-wide: `endpointUrl` (https required in production) | ADR-0059 §2, §3 |

They are **not** outbound destinations:

- **Webhooks** are inbound only: a sender IT authorizes posts to `POST /api/v1/webhooks/{endpointKey}` on the API.
  The hub never calls the sender, and the signing secret is never sent anywhere.
- **Outbound writes** run only on the local `test_adapter` in this release (migration 0104 refuses outbound actions
  on other adapter kinds), so they open no connection. The `http_pull` adapter answers them `rejected` without any I/O.

**Where they may connect is controlled in two places:**

1. **The secret binding's `hosts`** ([configuration.md](configuration.md), "The binding", D-209). Each secret that one
   of these settings names must be bound by IT in `SECRET_BINDINGS_FILE`, to one consumer (`smtp`, `connector`,
   `storage` or `assistant`), one scope and 1–16 hosts. A setting pointed at a host not listed is refused when it is
   saved or tested (`validation.secret_ref_host_not_bound`), and a secret is resolved for a use only when that use's
   host matches. This control limits where a **secret** can be sent. It does not stop a setting that names no secret
   (an SMTP relay without AUTH, an `http_pull` connector or an assistant endpoint without a credential) from
   connecting to the host an administrator enters.
2. **The deployment's network egress policy** (firewall, Kubernetes `NetworkPolicy`, proxy allow-list). It is the
   control for where the `api` and `worker` processes may connect **at all**. Allow only PostgreSQL, the IdP and the
   destinations IT actually configures above, from the processes listed. The product has no egress allow-list of its
   own for credential-less endpoints.

For a test run, setting `MTH_CONNECTION_LOG` to a file path makes the `api` and `worker` processes log every outbound
connection attempt (host, address and port only). It is a test instrument: it is ignored, with a warning, when
`NODE_ENV=production`, and it does not replace a network capture.

How the default installation is proven to need no outbound internet:

1. **Compose no-egress variant.** `deploy/compose/compose.no-egress.yaml` marks the project network
   `internal: true`. The containers can reach each other but have no route off the host, and published ports are
   removed. The `smoke` service runs inside that network: it signs in through Keycloak, creates and reads a
   transformation, and asserts that a TCP connection to a public address (`MTH_EGRESS_PROBE`, default
   `1.1.1.1:443`) and a public DNS lookup (`MTH_EGRESS_DNS_PROBE`, default `registry.npmjs.org`) both **fail**.

   ```bash
   docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.no-egress.yaml --profile test-idp up -d
   docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.no-egress.yaml run --rm migrate db bootstrap …
   docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.no-egress.yaml \
     --profile test-idp --profile smoke run --rm smoke
   ```

   `deploy/scripts/verify-stack.sh` runs this automatically.
2. **Static scans:** `pnpm check:no-cdn` over apps and packages; `.env.example` has no values.

## Images to mirror

IT's registry must hold these images (`deploy/images.lock.json` is the source of truth; pin them **by digest**):

| Image | Tag | Role |
|---|---|---|
| `node` | `24-bookworm-slim` | base of `mth-app` (build and runtime stages) |
| `postgres` | `18` | database (Compose, CI) |
| `quay.io/keycloak/keycloak` | `26.8.1` | **test** IdP only |
| `mcr.microsoft.com/playwright` | `v1.56.1-noble` | CI e2e only (browsers baked in; `playwright install` is never run) |
| `mth-app` | built | the application |

`node deploy/scripts/pin-images.mjs --resolve` records each digest and its `verifiedAt` time, and needs registry
access. `--apply` rewrites the Dockerfile, Compose and CI references. `--check` (offline, in CI) fails while anything
is unpinned. All four images above carry a recorded digest in `deploy/images.lock.json`; an image without one is
**[UNVERIFIED]** and is never bundled (below).

To use mirrored images:

- base image: `deploy/scripts/build-image.sh --node-image <mirror>/node:24-bookworm-slim@sha256:…`;
- Compose: edit the `image:` lines to point at the mirror (keep the digests), or re-tag the mirrored images locally.

## Moving the images to a host without registry access (image bundle)

When the target host cannot reach any registry, not even IT's mirror, the images travel as files
(`deploy/scripts/image-bundle.sh`, ADR-0069 §6). The script never runs `docker pull`, `docker login` or `docker push`.

1. **On a connected host** that already holds every image: the four images of `deploy/images.lock.json` at their pinned
   `<ref>:<tag>@<digest>` (for example after `docker compose -f deploy/compose/compose.yaml pull`), and the application
   image built with `deploy/scripts/build-image.sh`:

   ```bash
   deploy/scripts/image-bundle.sh save --out <bundle dir> [--app-image mth-app:local]
   ```

   It writes `images.tar` (one `docker save` archive) and `images.json` (`mth-image-bundle/1`). For each image,
   `images.json` records its name, its lock digest, its image id, its size and the tar's SHA-256. An image that is not
   present locally, or a lock entry without a digest, stops the save (exit 2). Pull or build it first.
2. **Transfer** the bundle directory by IT's approved means. Compare the SHA-256 of `images.tar` with `images.json`
   (`tar.sha256`) on arrival.
3. **On the target host:**

   ```bash
   deploy/scripts/image-bundle.sh load --from <bundle dir>
   ```

   It checks the size and SHA-256 of `images.tar` against `images.json` **before** calling Docker. A changed tar exits 1
   (`image-bundle: images.tar does not match images.json (sha256)`), and `docker load` is not run. It then loads the tar
   and compares each image id with `images.json`. `image-bundle.sh verify --from <bundle dir>` repeats both checks
   without loading.
4. **Start without pulling:**

   ```bash
   docker compose -f deploy/compose/compose.yaml up -d --pull never --wait
   ```

   `--pull never` makes Compose fail if any image is missing locally, so a start that reaches `healthy` used only the
   loaded images.

Exit codes: 0 PASS, 1 a mismatch, 2 a usage error or missing input, 3 `image-bundle: BLOCKED: docker daemon not
reachable`.

**What has been shown, and what has not.**

- The script's manifest, checksum and refusal logic is tested with a stub `docker` (T-B12,
  `deploy/scripts/tests/image-bundle.test.mjs`).
- A real save, removal, load and `up --pull never` needs a Docker daemon. It is the orchestrator's host run (ADR-0069
  §6–§7); that run is recorded under the DG7 orchestrator evidence when it has happened.
- A load on a host that otherwise has registry access is **not** a physically air-gapped host (ADR-0069 residual 5).
- A Compose start is a reproducible install and test configuration, not evidence of high-availability readiness.

**Lifecycle e2e with no outbound network.** `deploy/scripts/offline-drill.sh --out <dir>` runs the A02 and A21 e2e
specs inside a network namespace with no route off the host (`bwrap --unshare-net`, loopback only). It first proves
that a TCP connection to `1.1.1.1:443` and a DNS lookup of `registry.npmjs.org` both fail. Every Node process of the
run writes the product's connection log, and the drill fails on any connection outside loopback (ADR-0069 §5). It uses
the Chromium already installed for Playwright and never downloads one (exit 3 without it). It needs no Docker daemon.
It covers the Node processes, not the browser, the database server or the operating system: those are covered by the
namespace itself. It is a connection log, not a packet capture.

## Building in a restricted network

The image build installs npm packages once, from the committed lockfile, whose integrity hashes guarantee identical
packages from any registry:

```bash
deploy/scripts/build-image.sh \
  --node-image <mirror>/node:24-bookworm-slim@sha256:… \
  --npm-registry https://<IT npm mirror>/ \
  --build-ca /path/to/it-proxy-ca.pem        # only if a TLS-intercepting proxy or mirror is in the path
```

- `--npm-registry` also serves pnpm 10.33.0 itself to Corepack (`COREPACK_NPM_REGISTRY`). If the mirror cannot serve
  npm's registry signing keys, Corepack's signature verification may need `COREPACK_INTEGRITY_KEYS` configured by IT.
  This is **[UNVERIFIED]**, not exercised here.
- `--build-ca` is passed as a **BuildKit secret**. It is visible only to the install steps and is **never written to an
  image layer**. The runtime image never needs it.
- The Dockerfile deliberately has no `# syntax=` line, which would pull a frontend image from Docker Hub. Docker 23+
  has `RUN --mount=type=secret` built in.
- After the install, every further step is offline. The production prune runs
  `pnpm install --frozen-lockfile --prod --offline`, so nothing is resolved twice or differently.

**Without Docker** (for example to prepare artefacts on a connected machine): `pnpm fetch` fills a pnpm store from the
lockfile. Copy the store, then run `MTH_PNPM_STORE=<store> MTH_PNPM_OFFLINE=1 deploy/scripts/clean-start-local.sh`,
which installs and builds with no network (measured in [clean-start.md](clean-start.md)).

**From the release archive, with no network at all** (ADR-0062 §5). The release archive
(`mth-transformation-hub-<version>.tar.gz`, built by `tools/release/build-archive.mjs`) holds the source, deployment
files, documentation and synthetic demo data. The npm packages come from one of two sources inside company
infrastructure. Their integrity is fixed by the lockfile's SHA-512 hashes either way:

1. **IT's npm mirror:** `pnpm fetch --frozen-lockfile` against the mirror fills a store;
2. **the store artefact:** on a connected preparation machine, run `pnpm fetch --frozen-lockfile --store-dir <dir>`,
   then `node tools/release/build-archive.mjs --pack-store <dir> --out dist/release/`. That writes
   `mth-transformation-hub-<version>-pnpm-store.tar.gz` and its `.sha256`. Copy both into the restricted network and
   unpack the store there.

The build host needs Node 24.x, pnpm 10.33.0, GNU tar and `unshare` (util-linux) or `bwrap` (bubblewrap), all
installed by IT from its own mirror. Then:

```bash
tools/release/build-from-archive.sh mth-transformation-hub-<version>.tar.gz \
  --sha256 "$(cut -c1-64 mth-transformation-hub-<version>.tar.gz.sha256)" --store <pnpm store dir>
```

The script checks the archive checksum before unpacking, unpacks into an empty work directory and asserts there is
no `.git`. Inside a network namespace with no interfaces it first asserts that a TCP connection to `1.1.1.1:443`
and a DNS lookup of `registry.npmjs.org` both fail. It then runs the offline frozen install, `pnpm -r build`,
`deploy/scripts/assemble-runtime.sh`, `check-no-cdn` and `tools/release/scan-assets.mjs`, and prints each step with
its duration and exit status. Exit 3 means BLOCKED: no network namespace is available, and the script never builds
with the network on. The image build from the unpacked `source/` (`deploy/scripts/build-image.sh` against IT's
mirror) needs a Docker daemon and is a separate step. A successful local build shows the build needs nothing beyond
the archive and the store. It does not show that IT's mirror serves the store, and it is not a production-readiness
test.

## Inventory for IT review

- `licenses/sbom.cdx.json` (CycloneDX 1.6) and `licenses/inventory.csv`: every lockfile package with version,
  licence, SHA-512 integrity and scope (`runtime` = shipped in the image, `bundled` = compiled into the web app,
  `development` = never shipped), plus the container images. Regenerate with `node licenses/generate-sbom.mjs`.
  `--check` fails when it is stale.
- `/app/licenses/THIRD-PARTY-NOTICES.md` in the image: licence texts of every shipped package, including the OFL
  licences of the bundled IBM Plex fonts.
