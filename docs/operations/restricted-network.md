# Restricted networks: build and run without outbound internet (§19 item 7, REQ-S19-019; P1 increment)

## Runtime: no outbound internet needed

The `api`, `worker` and `migrate` processes need exactly two services, both inside company infrastructure:
**PostgreSQL** and the **corporate OIDC IdP**. The application makes no other outbound calls. It uses no telemetry,
analytics, CDN, remote fonts (IBM Plex is bundled) or update checks.

Later, optional integrations (SMTP, connectors, an AI endpoint) will be off by default and configured by IT. Each one
will be listed here when it exists.

How this is proven:

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
| `quay.io/keycloak/keycloak` | `26.4` | **test** IdP only |
| `mcr.microsoft.com/playwright` | `v1.56.1-noble` | CI e2e only (browsers baked in; `playwright install` is never run) |
| `mth-app` | built | the application |

Tags and support windows are **[UNVERIFIED]** until `node deploy/scripts/pin-images.mjs --resolve` records digests,
which needs registry access. `--apply` rewrites the Dockerfile, Compose and CI references. `--check` (offline, in CI)
fails while anything is unpinned. **As of this increment no digest is recorded**; see the T-DG1-DEVOPS handback.

To use mirrored images:

- base image: `deploy/scripts/build-image.sh --node-image <mirror>/node:24-bookworm-slim@sha256:…`;
- Compose: edit the `image:` lines to point at the mirror (keep the digests), or re-tag the mirrored images locally.

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

## Inventory for IT review

- `licenses/sbom.cdx.json` (CycloneDX 1.6) and `licenses/inventory.csv`: every lockfile package with version,
  licence, SHA-512 integrity and scope (`runtime` = shipped in the image, `bundled` = compiled into the web app,
  `development` = never shipped), plus the container images. Regenerate with `node licenses/generate-sbom.mjs`.
  `--check` fails when it is stale.
- `/app/licenses/THIRD-PARTY-NOTICES.md` in the image: licence texts of every shipped package, including the OFL
  licences of the bundled IBM Plex fonts.
