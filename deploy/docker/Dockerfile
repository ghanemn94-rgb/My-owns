# Mobily Transformation Hub: the single application image `mth-app` (ADR-0011, T-DG1-DEVOPS).
#
# One image, three commands (see deploy/docker/entrypoint.sh):
#   api      HTTP API; also serves the built SPA from /app/apps/web/dist (same origin: cookies, CSP, CSRF)
#   worker   background worker (outbox relay, pg-boss handlers)
#   migrate  one-shot `mth-db migrate` as the owner role (DATABASE_OWNER_URL); `db <cmd>` exposes status/bootstrap
#
# Build from the repository root:
#   deploy/scripts/build-image.sh                  (wraps the command below)
#   docker build -f deploy/docker/Dockerfile -t mth-app:local .
#
# Restricted networks (§19 item 7, docs/operations/restricted-network.md):
#   --build-arg NODE_IMAGE=<IT mirror>/node:24-bookworm-slim@sha256:...   base image from IT's registry mirror
#   --build-arg NPM_REGISTRY=https://<IT npm mirror>/                      packages (and pnpm itself) from IT's mirror
#   --secret id=build_ca,src=/path/to/ca.pem                               OPTIONAL: extra CA for a TLS-intercepting
#                                                                          proxy/mirror. BUILD-TIME ONLY; never copied
#                                                                          into any layer, and the runtime never needs it.
# The lockfile's integrity hashes guarantee identical packages whichever registry serves them.
#
# There is deliberately NO `# syntax=` directive: that would pull the docker/dockerfile frontend image from Docker Hub
# at build time. `RUN --mount=type=secret` is supported by the Dockerfile frontend built into BuildKit (Docker 23+).
#
# Base image: pinned by digest through deploy/images.lock.json (`node deploy/scripts/pin-images.mjs --check`).
ARG NODE_IMAGE=node:24-bookworm-slim

# --------------------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=""
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /src

# 1) Dependencies only (cached until a manifest or the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=secret,id=build_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    if [ -n "$NPM_REGISTRY" ]; then export npm_config_registry="$NPM_REGISTRY" COREPACK_NPM_REGISTRY="$NPM_REGISTRY"; fi; \
    corepack enable --install-directory /pnpm; \
    pnpm --version; \
    pnpm install --frozen-lockfile

# 2) Sources (filtered by /.dockerignore: no node_modules, dist, .git, delivery records or local secrets).
COPY . .
RUN pnpm -r build

# 3) Runtime tree: licence notices + SBOM, OFFLINE production prune from the same frozen lockfile, copy only what
#    api/worker/migrate need, verify the layout. The local clean start runs the very same script
#    (docs/operations/clean-start.md), so the image layout is testable without Docker.
RUN bash deploy/scripts/assemble-runtime.sh /src /out/app

# --------------------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="mth-app" \
      org.opencontainers.image.description="Mobily Transformation Hub (api | worker | migrate). Not an official PMI product." \
      org.opencontainers.image.licenses="UNLICENSED"

# No package managers or build tools at runtime (ADR-0011): drop npm, npx, corepack and yarn from the base image.
# A dedicated non-root user (uid/gid 10001) runs every command; the application files stay root-owned (read-only).
RUN set -eu; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-*; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg; \
    groupadd --system --gid 10001 mth; \
    useradd --system --uid 10001 --gid mth --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin mth; \
    mkdir -p /var/lib/mth/evidence; \
    chown mth:mth /var/lib/mth/evidence; \
    chmod 0700 /var/lib/mth/evidence

ENV NODE_ENV=production \
    AUTH_MODE=oidc \
    PORT=3000 \
    EVIDENCE_STORAGE_DRIVER=filesystem \
    EVIDENCE_STORAGE_PATH=/var/lib/mth/evidence

COPY --from=build /out/app /app
COPY deploy/docker/entrypoint.sh /usr/local/bin/mth
COPY deploy/docker/healthcheck.mjs /app/healthcheck.mjs
RUN chmod 0555 /usr/local/bin/mth && chmod 0444 /app/healthcheck.mjs

WORKDIR /app
USER 10001:10001
EXPOSE 3000
VOLUME ["/var/lib/mth/evidence"]
ENTRYPOINT ["/usr/local/bin/mth"]
CMD ["api"]
