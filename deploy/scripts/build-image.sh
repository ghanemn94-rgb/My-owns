#!/usr/bin/env bash
# Build the mth-app image from the repository root and verify it (ADR-0011; acceptance check 1).
#
#   deploy/scripts/build-image.sh [--tag mth-app:local] [--node-image REF] [--npm-registry URL] [--build-ca FILE]
#                                 [--network MODE] [--proxy-from-env] [--dry-run]
#
#   --node-image    base image (default: deploy/images.lock.json node-runtime, ref:tag@digest when pinned)
#   --npm-registry  IT's npm mirror for a restricted network (also serves pnpm to Corepack)
#   --build-ca      extra CA bundle for a TLS-intercepting proxy or mirror. Passed as a BuildKit SECRET: it is
#                   available only to the install step and is never written to any image layer. Also read from
#                   MTH_BUILD_CA_FILE. The runtime image never needs it.
#   --network       OPTIONAL build-time network mode for the RUN steps (`docker build --network MODE`, e.g. `host` on a
#                   build host whose proxy listens on loopback). Also read from MTH_BUILD_NETWORK. Not part of the image.
#   --proxy-from-env OPTIONAL: pass the host's standard proxy variables (HTTP_PROXY, HTTPS_PROXY, NO_PROXY, ALL_PROXY and
#                   their lower-case forms) that are SET in the environment to the build as `--build-arg NAME` (the value
#                   comes from the environment, so it never appears on the command line or in this script's output).
#                   These are Docker's predefined proxy build args: no ARG/ENV in the Dockerfile uses them, so they are
#                   not baked into the image config or kept in `docker history`. The verification below fails if any
#                   *_PROXY variable is present in the image's Env. Also enabled by MTH_BUILD_PROXY_FROM_ENV=1.
#   --dry-run       print the `docker build` argument vector (proxy values never included) and exit 0 without Docker.
# After the build it verifies: the image user is non-root (10001), the entrypoint exposes api/worker/migrate, no
# npm/npx/corepack/pnpm in the runtime image, NODE_ENV=production and AUTH_MODE=oidc baked in.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAG="mth-app:local"
NODE_IMAGE=""
NPM_REGISTRY=""
BUILD_CA="${MTH_BUILD_CA_FILE:-}"
NETWORK="${MTH_BUILD_NETWORK:-}"
PROXY_FROM_ENV="${MTH_BUILD_PROXY_FROM_ENV:-0}"
DRY_RUN=0
USAGE="usage: $0 [--tag T] [--node-image REF] [--npm-registry URL] [--build-ca FILE] [--network MODE] [--proxy-from-env] [--dry-run]"
need() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "$USAGE" >&2; echo "BLOCKED: $1 needs a value" >&2; exit 64; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) need "$@"; TAG="$2"; shift ;;
    --node-image) need "$@"; NODE_IMAGE="$2"; shift ;;
    --npm-registry) need "$@"; NPM_REGISTRY="$2"; shift ;;
    --build-ca) need "$@"; BUILD_CA="$2"; shift ;;
    --network) need "$@"; NETWORK="$2"; shift ;;
    --proxy-from-env) PROXY_FROM_ENV=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "$USAGE" >&2; exit 64 ;;
  esac
  shift
done
case "$NETWORK" in ''|default|host|none) ;; *) echo "BLOCKED: --network must be default, host or none (got '$NETWORK')" >&2; exit 64 ;; esac
[ -z "$BUILD_CA" ] || [ -s "$BUILD_CA" ] || { echo "BLOCKED: --build-ca file '$BUILD_CA' is missing or empty" >&2; exit 64; }
[ "$DRY_RUN" = 1 ] || docker info >/dev/null 2>&1 || { echo "BLOCKED: no Docker daemon reachable (docker info failed)" >&2; exit 3; }

if [ -z "$NODE_IMAGE" ]; then
  NODE_IMAGE="$(node -e 'const l=require(process.argv[1]).images.find(i=>i.id==="node-runtime");
    console.log(l.digest?`${l.ref}:${l.tag}@${l.digest}`:`${l.ref}:${l.tag}`)' "$REPO/deploy/images.lock.json")"
  case "$NODE_IMAGE" in *@sha256:*) ;; *) echo "WARNING: base image $NODE_IMAGE is NOT pinned by digest (deploy/images.lock.json)" >&2 ;; esac
fi

ARGS=(build -f "$REPO/deploy/docker/Dockerfile" -t "$TAG" --build-arg "NODE_IMAGE=$NODE_IMAGE"
  --label "org.opencontainers.image.revision=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)")
[ -n "$NPM_REGISTRY" ] && ARGS+=(--build-arg "NPM_REGISTRY=$NPM_REGISTRY")
[ -n "$BUILD_CA" ] && ARGS+=(--secret "id=build_ca,src=$BUILD_CA")
[ -n "$NETWORK" ] && ARGS+=(--network "$NETWORK")
PROXY_VARS=(HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy)
passed=()
if [ "$PROXY_FROM_ENV" = 1 ]; then
  for v in "${PROXY_VARS[@]}"; do
    # NAME only: docker reads the value from this process's environment (it is never printed or put on the argv).
    if [ -n "${!v:-}" ]; then ARGS+=(--build-arg "$v"); passed+=("$v"); fi
  done
  echo "proxy build args passed from the environment: ${passed[*]:-(none set)}"
fi

if [ "$DRY_RUN" = 1 ]; then
  printf 'docker'; printf ' %q' "${ARGS[@]}" "$REPO"; printf '\n'
  echo "DRY-RUN: no build performed"
  exit 0
fi

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
if grep -qiE '^(HTTP|HTTPS|NO|ALL)_PROXY=' <<<"$envs"; then
  echo "FAIL: a proxy variable is baked into the image Env (names: $(grep -ioE '^(HTTP|HTTPS|NO|ALL)_PROXY' <<<"$envs" | tr '\n' ' '))" >&2; exit 1
fi
echo "  env: no *_PROXY variable in the image"
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
