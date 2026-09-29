# syntax=docker/dockerfile:1
# =====================================================================================================================
# Transformation Hub — API image. ONE image, several commands (ADR-0001), selected by the container args:
#   api (default) · worker · migrate · seed-demo · openapi [file] · healthcheck [api|worker]   (deploy/docker/api-entrypoint.cjs)
#
# Build (context = transformation-hub/):
#   docker build -f apps/api/Dockerfile --target api \
#     --build-arg NODE_BASE=<private-registry>/library/node:22.22.2-bookworm-slim@sha256:<digest> \
#     --build-arg NPM_REGISTRY=https://<private-npm-mirror>/ \
#     --build-arg APP_VERSION=0.1.0 --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
#     -t <private-registry>/transformation-hub/api:0.1.0 .
#   Optional PDF variant (Playwright-compatible Chromium):  --target api-chromium  -t …/api-chromium:0.1.0
#
# Security properties: multi-stage (no compilers, sources or package managers in the runtime image); runs as numeric
# UID 10001 with GID 0 and no writable application files, so it also runs under OpenShift's arbitrary UIDs
# (restricted-v2 SCC); works with readOnlyRootFilesystem — only /tmp (and /data/objects for the dev-only local storage
# driver) must be writable volumes; no secrets are baked in (all configuration is runtime environment).
# Base image: the default below carries a DIGEST PLACEHOLDER on purpose — a release build must pass the digest of the
# image mirrored into Mobily's registry (docs/deployment/supply-chain.md). Development builds may pass a tag only.
# NOT EXECUTED in the build environment (no Docker daemon); the RUN steps were exercised locally without Docker.
# =====================================================================================================================
ARG NODE_BASE=docker.io/library/node:22.22.2-bookworm-slim@sha256:REPLACE_WITH_DIGEST_OF_THE_MIRRORED_IMAGE
ARG PNPM_VERSION=10.33.0

# ---------------------------------------------------------------------------------------------------------------------
FROM ${NODE_BASE} AS base
ARG PNPM_VERSION
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_registry=${NPM_REGISTRY} \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate && pnpm config set store-dir /pnpm/store
WORKDIR /src

# Dependencies are fetched from the lockfile alone, so this layer is reused until pnpm-lock.yaml changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
RUN pnpm fetch --frozen-lockfile

# ---------------------------------------------------------------------------------------------------------------------
FROM deps AS build
# Workspace manifests of projects not built here keep the workspace consistent with the lockfile.
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
COPY packages ./packages
COPY apps/api ./apps/api
COPY deploy/docker/api-entrypoint.cjs ./deploy/docker/api-entrypoint.cjs
# `deploy --legacy` re-resolves the production tree and needs registry METADATA, which `pnpm fetch` does not cache, so it
# runs --prefer-offline (package tarballs still come from the fetched store; only metadata goes to NPM_REGISTRY).
RUN pnpm install --offline --frozen-lockfile --filter "@hub/api..." \
 && pnpm --filter @hub/domain run build \
 && pnpm --filter @hub/contracts run build \
 && pnpm --filter @hub/db run build \
 && pnpm --filter @hub/api run build \
 && pnpm --filter @hub/api deploy --prod --prefer-offline --legacy /out \
 && rm -rf /out/src /out/test /out/Dockerfile /out/tsconfig.json /out/tsconfig.build.json /out/vitest.config.mts \
 && cp deploy/docker/api-entrypoint.cjs /out/hub-entrypoint.cjs \
 && test -f /out/dist/main.js && test -f /out/dist/worker.js \
 && test -d /out/node_modules/@hub/db/migrations && test -f /out/node_modules/@hub/db/sql/post-migrate.sql

# ---------------------------------------------------------------------------------------------------------------------
FROM ${NODE_BASE} AS api
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="transformation-hub-api" \
      org.opencontainers.image.description="Transformation & Transactions Hub API / worker / migrations (one image)" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      io.openshift.non-scalable="false" \
      io.k8s.display-name="transformation-hub-api"
ENV NODE_ENV=production \
    HOME=/tmp \
    TMPDIR=/tmp \
    PORT=4000 \
    HUB_STORAGE_LOCAL_DIR=/data/objects \
    HUB_APP_VERSION=${APP_VERSION} \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1
# No package managers in the runtime image (threat model C-38). Writable locations: /tmp and /data/objects only,
# owned by UID 10001 / GID 0 with group permissions equal to the owner's (OpenShift arbitrary-UID convention).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data/objects \
 && chown -R 10001:0 /data && chmod -R 0770 /data
COPY --from=build /out /app
WORKDIR /app
USER 10001:0
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD ["node", "/app/hub-entrypoint.cjs", "healthcheck"]
ENTRYPOINT ["node", "/app/hub-entrypoint.cjs"]
CMD ["api"]

# ---------------------------------------------------------------------------------------------------------------------
# OPTIONAL variant for PDF rendering (ADR-0011): adds the Chromium build matching playwright-core (1.56.1) plus
# Arabic-capable fallback fonts and tini (reaps browser child processes). The API finds it via HUB_CHROMIUM_PATH.
# Browser download source: Playwright's CDN by default; in private builds point PLAYWRIGHT_DOWNLOAD_HOST at an
# approved internal mirror and configure the apt mirror of the base image. Larger image (~+400 MB), larger CVE surface.
FROM api AS api-chromium
USER 0
ARG PLAYWRIGHT_DOWNLOAD_HOST=
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN if [ -n "${PLAYWRIGHT_DOWNLOAD_HOST}" ]; then export PLAYWRIGHT_DOWNLOAD_HOST; fi \
 && apt-get update \
 && node /app/node_modules/playwright-core/cli.js install --with-deps chromium \
 && apt-get install -y --no-install-recommends tini fonts-noto-core \
 && CHROME="$(find /ms-playwright -type f -name chrome -path '*chrome-linux*' | head -n 1)" \
 && test -x "$CHROME" && ln -s "$CHROME" /usr/local/bin/hub-chromium \
 && chmod -R a+rX /ms-playwright \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV HUB_CHROMIUM_PATH=/usr/local/bin/hub-chromium
USER 10001:0
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/hub-entrypoint.cjs"]
CMD ["api"]
