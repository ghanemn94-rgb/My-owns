# syntax=docker/dockerfile:1
# =====================================================================================================================
# Transformation Hub — web image (Next.js 16, `output: 'standalone'`).
#
# Build (context = transformation-hub/):
#   docker build -f apps/web/Dockerfile \
#     --build-arg NODE_BASE=<private-registry>/library/node:22.22.2-bookworm-slim@sha256:<digest> \
#     --build-arg NPM_REGISTRY=https://<private-npm-mirror>/ \
#     --build-arg HUB_API_URL=http://<release>-api:4000 \
#     --build-arg APP_VERSION=0.1.0 --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
#     -t <private-registry>/transformation-hub/web:0.1.0 .
#
# HUB_API_URL: Next.js evaluates `rewrites()` during `next build` and stores the result in the routes manifest, so
# the API address used by the /api/* rewrite is fixed at BUILD time. In Kubernetes the ingress/route sends /api/* to
# the API service directly (same origin), so the rewrite is only a fallback; build with the in-cluster service name.
# Private mode: telemetry disabled at build and run time; fonts are bundled from @fontsource (no CDN) — checked by
# scripts/ops/egress-check.sh on the build output.
# Layout: requires `outputFileTracingRoot` = monorepo root (apps/web/next.config.ts) → standalone/apps/web/server.js.
# Runs as UID 10001 / GID 0; with readOnlyRootFilesystem mount writable volumes at /tmp and /app/apps/web/.next/cache.
# NOT EXECUTED in the build environment (no Docker daemon).
# =====================================================================================================================
ARG NODE_BASE=docker.io/library/node:22.22.2-bookworm-slim@sha256:REPLACE_WITH_DIGEST_OF_THE_MIRRORED_IMAGE
ARG PNPM_VERSION=10.33.0

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

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
RUN pnpm fetch --frozen-lockfile

FROM deps AS build
ARG HUB_API_URL=http://hub-api:4000
ENV HUB_API_URL=${HUB_API_URL} \
    NODE_ENV=production
COPY apps/api/package.json ./apps/api/package.json
COPY e2e/package.json ./e2e/package.json
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --offline --frozen-lockfile --filter "@hub/web..." \
 && pnpm --filter @hub/domain run build \
 && pnpm --filter @hub/contracts run build \
 && pnpm --filter @hub/web run build \
 && test -f apps/web/.next/standalone/apps/web/server.js \
      || { echo "standalone server not found at .next/standalone/apps/web/server.js — check output:'standalone' and outputFileTracingRoot" >&2; exit 1; } \
 && mkdir -p /out \
 && cp -a apps/web/.next/standalone/. /out/ \
 && cp -a apps/web/.next/static /out/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -a apps/web/public /out/apps/web/public; fi \
 && rm -rf /out/apps/web/.next/cache

FROM ${NODE_BASE} AS web
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="transformation-hub-web" \
      org.opencontainers.image.description="Transformation & Transactions Hub web client (Next.js standalone)" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      io.k8s.display-name="transformation-hub-web"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HOME=/tmp \
    TMPDIR=/tmp \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=build /out /app
# Next.js writes its image/fetch cache here at runtime; everything else stays read-only.
RUN mkdir -p /app/apps/web/.next/cache && chown 10001:0 /app/apps/web/.next/cache && chmod 0770 /app/apps/web/.next/cache
WORKDIR /app
USER 10001:0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const h=require('node:http');h.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/',agent:new h.Agent(),timeout:4000},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
