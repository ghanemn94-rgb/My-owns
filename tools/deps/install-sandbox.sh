#!/usr/bin/env bash
# Sandboxed dependency installation (REQ-DLV-042, D-027/D-046, threat-model residual 3).
#
# Agent shells have no network (D-025), so dependency installation is an ORCHESTRATOR step. The orchestrator must never
# run a package manager with its own unconfined privileges: a malicious or compromised dependency's install/build
# script would then run against the real filesystem and secrets. This wrapper runs the package manager inside
# bubblewrap, and — the key control (F-DG1-113/F-DG1-114) — the real repository is bound READ-ONLY and is NEVER
# writable inside the sandbox:
#   - `create`/`frozen` run the package manager inside a DISPOSABLE, writable COPY of the source tree (no node_modules,
#     no .git). A dependency build script can therefore write only that throwaway copy and the package store; it cannot
#     touch the installer, the gate/agent tooling, git, CI config, the sources or any agent-config surface in the real
#     repo. Afterwards the orchestrator copies back ONLY node_modules (and, in `create`, pnpm-lock.yaml) — nothing else;
#   - `run` executes an arbitrary command with the real repo bound READ-ONLY (used by the tests and the escape probes);
#   - the root filesystem is read-only; package lifecycle scripts are DISABLED unless a package is on the reviewed
#     allow-list in the root package.json `pnpm.onlyBuiltDependencies`;
#   - the process runs with ALL capabilities dropped and from a CLEARED environment (only PATH/HOME/XDG/PNPM/registry and
#     the proxy's TLS vars are set), so the orchestrator's own environment — which may hold credentials — never crosses
#     in (F-DG1-102);
#   - the lockfile is enforced: `frozen` fails if the lockfile is absent or would change; `create` is the only mode that
#     writes a new lockfile;
#   - a missing bubblewrap makes the wrapper exit non-zero (BLOCKED) — it never falls back to an unsandboxed install.
#
# Network: the sandbox shares the host network so the package manager can reach the registry. Egress is bounded by the
# environment's own outbound network policy (the managed proxy allow-list) and by pnpm's registry-only config; bubblewrap
# cannot itself filter egress by host without privileges this container does not grant (D-027 / threat-model residual 3).
#
# Usage:
#   tools/deps/install-sandbox.sh create         # first install: resolve and write pnpm-lock.yaml, then populate node_modules
#   tools/deps/install-sandbox.sh frozen          # CI/repeat install: --frozen-lockfile (default; fails if the lockfile is absent or would change)
#   tools/deps/install-sandbox.sh run -- <cmd…>   # run an arbitrary command with the real repo read-only (used by the tests)
#
# Exit codes: 0 ok; 65 bubblewrap unavailable (BLOCKED); 64 usage; other = the package manager's own non-zero.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Optional --root <dir>: operate on another tree (the acceptance tests use disposable scratch projects). Only the
# orchestrator invokes this wrapper, so the override is not an escalation; it never widens what is writable.
if [ "${1:-}" = "--root" ]; then REPO_ROOT="$(cd "$2" && pwd)"; shift 2; fi
MODE="${1:-frozen}"
shift || true

fail()  { echo "install-sandbox: $*" >&2; exit 1; }
block() { echo "install-sandbox: BLOCKED: $*" >&2; exit 65; }

command -v bwrap >/dev/null 2>&1 || block "bubblewrap (bwrap) is not installed; refusing an unsandboxed install"
command -v pnpm  >/dev/null 2>&1 || fail  "pnpm is not on PATH"

PNPM_STORE="$(pnpm store path 2>/dev/null | tail -1)"
[ -n "$PNPM_STORE" ] || fail "cannot resolve the pnpm store path"
mkdir -p "$PNPM_STORE"

# A private, writable cache/state area for pnpm and node; a fresh tmpfs is mounted over /tmp inside the sandbox.
SBX_TMP="/tmp/mth-install.$$"

# Lifecycle-script policy (REQ-DLV-042). A DEPENDENCY's install/build script runs only if the package is on the reviewed
# allow-list `pnpm.onlyBuiltDependencies` in package.json; pnpm 10 blocks every other dependency's scripts by default, so
# no global `ignore-scripts` is set (that would also block allow-listed ones, defeating the "unless allow-listed" rule).
# `enable-pre-post-scripts=false` additionally stops the project's OWN pre/post lifecycle scripts from running on install.
pnpm_args=(--config.enable-pre-post-scripts=false)
case "$MODE" in
  create)
    # `--config.frozen-lockfile=false` is required because CI=1 (set below) otherwise defaults pnpm to a frozen install.
    pnpm_args+=(install --config.frozen-lockfile=false --config.confirmModulesPurge=false)
    ;;
  frozen)
    [ -f "$REPO_ROOT/pnpm-lock.yaml" ] || fail "no committed pnpm-lock.yaml; use 'create' for the first install"
    pnpm_args+=(install --frozen-lockfile)
    ;;
  run)
    [ "${1:-}" = "--" ] && shift
    [ "$#" -gt 0 ] || fail "usage: install-sandbox.sh run -- <command...>"
    ;;
  *) echo "usage: $0 {create|frozen|run -- <cmd...>}" >&2; exit 64 ;;
esac

# bubblewrap base: read-only root; private /tmp, /dev, /proc, /run; own ipc/pid/uts/cgroup namespaces; all capabilities
# dropped; a cleared environment with only what the install needs; host network shared (registry reachability, bounded
# by the env policy). The pnpm store is the only host-persistent writable path. No --unshare-user (the container has no
# unprivileged user namespaces), but bwrap runs fine as root here and --cap-drop ALL confines the process (D-030).
base_args=(
  --ro-bind / /
  --dev /dev
  --proc /proc
  --tmpfs /tmp
  --tmpfs /run
  --bind "$PNPM_STORE" "$PNPM_STORE"
  --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup
  --cap-drop ALL
  --die-with-parent
  --new-session
  --clearenv
  --setenv PATH "$PATH"
  --setenv HOME "$SBX_TMP"
  --setenv XDG_CACHE_HOME "$SBX_TMP/cache"
  --setenv XDG_STATE_HOME "$SBX_TMP/state"
  --setenv XDG_DATA_HOME "$SBX_TMP/data"
  --setenv PNPM_HOME "$SBX_TMP/pnpm"
  --setenv npm_config_store_dir "$PNPM_STORE"
  --setenv npm_config_registry "https://registry.npmjs.org/"
  --setenv CI "1"
)
# Pass through ONLY the network/TLS variables needed to reach the registry through the managed proxy (if the environment
# sets them); nothing else — no credentials — crosses in. Each is forwarded only when non-empty.
for v in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy \
         NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR; do
  [ -n "${!v:-}" ] && base_args+=(--setenv "$v" "${!v}")
done
prelude='mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$PNPM_HOME";'

# ---- run: an arbitrary command with the REAL repo read-only (escape probes, misc checks) -------------------------
if [ "$MODE" = "run" ]; then
  exec bwrap "${base_args[@]}" --chdir "$REPO_ROOT" -- /usr/bin/env bash -c "$prelude exec \"\$@\"" bash "$@"
fi

# ---- create / frozen: run pnpm in a DISPOSABLE writable COPY of the source; copy back only node_modules (+ lockfile) --
WS="$(mktemp -d "${TMPDIR:-/var/tmp}/mth-ws.XXXXXX")"
cleanup() { rm -rf "$WS"; }
trap cleanup EXIT
# Copy the source tree into the throwaway workspace, excluding node_modules (rebuilt here) and .git (never needed and
# must stay out of the dependency manager's reach).
tar -C "$REPO_ROOT" --exclude='./.git' --exclude=node_modules -cf - . | tar -C "$WS" -xf -
[ -f "$WS/package.json" ] || fail "no package.json in $REPO_ROOT"

bwrap "${base_args[@]}" --bind "$WS" "$WS" --chdir "$WS" -- /usr/bin/env bash -c "$prelude exec pnpm \"\$@\"" bash "${pnpm_args[@]}"
rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

# Lockfile: create writes it; frozen must not change it.
if [ "$MODE" = "create" ]; then
  [ -f "$WS/pnpm-lock.yaml" ] || fail "'create' produced no pnpm-lock.yaml"
  cp "$WS/pnpm-lock.yaml" "$REPO_ROOT/pnpm-lock.yaml"
elif [ "$MODE" = "frozen" ]; then
  if ! cmp -s "$WS/pnpm-lock.yaml" "$REPO_ROOT/pnpm-lock.yaml"; then
    fail "the lockfile changed under a frozen install — refusing"
  fi
fi

# Copy back node_modules ONLY at the real repository's own workspace-member directories — the root and every committed
# package.json directory. The member list is enumerated from the REAL (trusted) tree, NEVER from the disposable copy, so
# a dependency build script that plants a directory named `node_modules` at any other path (e.g. tools/gates/, .git/) —
# or with a crafted name — is never copied into the real repo (F-DG1-118). Every destination is a path under
# $REPO_ROOT derived from a trusted member directory, and the iteration is NUL-delimited, so a hostile file name cannot
# make `rm -rf`/`cp` act on a path outside the repo. The source must be a real directory, not a symlink.
while IFS= read -r -d '' pj; do
  member="$(dirname "$pj")"
  rel="${member#"$REPO_ROOT"}"; rel="${rel#/}"
  wsnm="$WS${rel:+/$rel}/node_modules"
  dest="$member/node_modules"
  if [ -d "$wsnm" ] && [ ! -L "$wsnm" ]; then
    rm -rf "$dest"
    cp -a "$wsnm" "$dest"
  fi
done < <(find "$REPO_ROOT" -maxdepth 4 -name package.json -not -path '*/node_modules/*' -print0)

exit 0
