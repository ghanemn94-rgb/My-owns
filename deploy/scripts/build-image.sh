#!/usr/bin/env bash
# Build the mth-app image from the repository root and verify it (ADR-0011; acceptance check 1).
#
#   deploy/scripts/build-image.sh [--tag mth-app:local] [--node-image REF] [--npm-registry URL] [--build-ca FILE]
#
#   --node-image    base image (default: deploy/images.lock.json node-runtime, ref:tag@digest when pinned)
#   --npm-registry  IT's npm mirror for a restricted network (also serves pnpm to Corepack)
#   --build-ca      extra CA bundle for a TLS-intercepting proxy or mirror. Passed as a BuildKit SECRET: it is
#                   available only to the install step and is never written to any image layer. Also read from
#                   MTH_BUILD_CA_FILE. The runtime image never needs it.
# After the build it verifies: the image user is non-root (10001), the entrypoint exposes api/worker/migrate, no
# npm/npx/corepack/pnpm in the runtime image, NODE_ENV=production and AUTH_MODE=oidc baked in.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAG="mth-app:local"
NODE_IMAGE=""
NPM_REGISTRY=""
BUILD_CA="${MTH_BUILD_CA_FILE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift ;;
    --node-image) NODE_IMAGE="$2"; shift ;;
    --npm-registry) NPM_REGISTRY="$2"; shift ;;
    --build-ca) BUILD_CA="$2"; shift ;;
    *) echo "usage: $0 [--tag T] [--node-image REF] [--npm-registry URL] [--build-ca FILE]" >&2; exit 64 ;;
  esac
  shift
done
docker info >/dev/null 2>&1 || { echo "BLOCKED: no Docker daemon reachable (docker info failed)" >&2; exit 3; }

if [ -z "$NODE_IMAGE" ]; then
  NODE_IMAGE="$(node -e 'const l=require(process.argv[1]).images.find(i=>i.id==="node-runtime");
    console.log(l.digest?`${l.ref}:${l.tag}@${l.digest}`:`${l.ref}:${l.tag}`)' "$REPO/deploy/images.lock.json")"
  case "$NODE_IMAGE" in *@sha256:*) ;; *) echo "WARNING: base image $NODE_IMAGE is NOT pinned by digest (deploy/images.lock.json)" >&2 ;; esac
fi

ARGS=(build -f "$REPO/deploy/docker/Dockerfile" -t "$TAG" --build-arg "NODE_IMAGE=$NODE_IMAGE"
  --label "org.opencontainers.image.revision=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)")
[ -n "$NPM_REGISTRY" ] && ARGS+=(--build-arg "NPM_REGISTRY=$NPM_REGISTRY")
[ -n "$BUILD_CA" ] && ARGS+=(--secret "id=build_ca,src=$BUILD_CA")

t0=$(date +%s)
DOCKER_BUILDKIT=1 docker "${ARGS[@]}" "$REPO"
echo "build: $(( $(date +%s) - t0 )) s"

echo "== verifying $TAG"
user="$(docker image inspect -f '{{.Config.User}}' "$TAG")"
[ "$user" = "10001:10001" ] || { echo "FAIL: image user is '$user', expected 10001:10001" >&2; exit 1; }
uid="$(docker run --rm --entrypoint id "$TAG" -u)"
[ "$uid" = "10001" ] || { echo "FAIL: runs as uid $uid" >&2; exit 1; }
echo "  non-root: Config.User=$user, id -u=$uid"
envs="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$TAG")"
grep -qx 'NODE_ENV=production' <<<"$envs" && grep -qx 'AUTH_MODE=oidc' <<<"$envs" \
  || { echo "FAIL: NODE_ENV=production and AUTH_MODE=oidc must be baked in" >&2; exit 1; }
echo "  env: NODE_ENV=production AUTH_MODE=oidc"
for tool in npm npx corepack pnpm yarn; do
  if docker run --rm --entrypoint sh "$TAG" -c "command -v $tool" >/dev/null 2>&1; then echo "FAIL: $tool present at runtime" >&2; exit 1; fi
done
echo "  no npm/npx/corepack/pnpm/yarn at runtime"
docker run --rm "$TAG" version
docker run --rm "$TAG" help 2>&1 | grep -q 'api | worker | migrate' || { echo "FAIL: entrypoint usage" >&2; exit 1; }
[ "$(docker run --rm "$TAG" db seed-dev >/dev/null 2>&1; echo $?)" = 64 ] || { echo "FAIL: seed-dev must be refused" >&2; exit 1; }
echo "  commands: api | worker | migrate | db | health | version; seed-dev refused"
docker run --rm --entrypoint sh "$TAG" -c 'test -f /app/licenses/THIRD-PARTY-NOTICES.md && test -f /app/licenses/sbom.cdx.json' \
  || { echo "FAIL: /app/licenses incomplete" >&2; exit 1; }
echo "  /app/licenses: THIRD-PARTY-NOTICES.md, sbom.cdx.json"
docker image inspect -f 'image {{.Id}} size {{.Size}} bytes' "$TAG"
echo "BUILD+VERIFY: PASS ($TAG)"
