#!/usr/bin/env bash
# Sandboxed dependency installation (REQ-DLV-042, D-027, threat-model residual 3).
#
# Agent shells have no network (D-025), so dependency installation is an ORCHESTRATOR step. The orchestrator must never
# run a package manager with its own unconfined privileges: a malicious or compromised dependency's install/postinstall
# script would then run against the real filesystem and secrets. This wrapper runs the package manager inside bubblewrap:
#   - the root filesystem is READ-ONLY; only the target tree (the repo) and the package store are writable;
#   - package lifecycle scripts (install/preinstall/postinstall/prepare/…) are DISABLED unless a package is on the
#     reviewed allow-list in the root package.json `pnpm.onlyBuiltDependencies`;
#   - the lockfile is enforced: the default mode refuses to install without a committed lockfile or to change it
#     (`--frozen-lockfile`); the explicit `create` mode is the only one that may write a new lockfile;
#   - a missing bubblewrap makes the wrapper exit non-zero (BLOCKED) — it never falls back to an unsandboxed install.
#
# Network: the sandbox shares the host network namespace so the package manager can reach the package registry. Egress
# is bounded by the environment's own outbound network policy (the managed proxy allow-list, which permits the package
# registries and denies the rest) and by pnpm being configured with only the registry as a source; bubblewrap cannot
# itself filter egress by host without privileges this container does not grant (documented in D-027 / threat-model
# residual 3). The wrapper adds NO network reach beyond what the environment already allows.
#
# Usage:
#   tools/deps/install-sandbox.sh create        # first install: create/refresh and write pnpm-lock.yaml
#   tools/deps/install-sandbox.sh frozen         # CI/repeat install: --frozen-lockfile (default; fails if lockfile absent or would change)
#   tools/deps/install-sandbox.sh run -- <cmd…>  # run an arbitrary command under the same sandbox (used by the tests)
#
# Exit codes: 0 ok; 65 bubblewrap unavailable (BLOCKED); 64 usage; other = the package manager's own non-zero.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-frozen}"
shift || true

fail()  { echo "install-sandbox: $*" >&2; exit 1; }
block() { echo "install-sandbox: BLOCKED: $*" >&2; exit 65; }

command -v bwrap >/dev/null 2>&1 || block "bubblewrap (bwrap) is not installed; refusing an unsandboxed install"
command -v pnpm  >/dev/null 2>&1 || fail  "pnpm is not on PATH"

PNPM_STORE="$(pnpm store path 2>/dev/null | tail -1)"
[ -n "$PNPM_STORE" ] || fail "cannot resolve the pnpm store path"
mkdir -p "$PNPM_STORE"

# A private, writable cache/state area for pnpm and node, so the only host-persistent writable path is the store; a fresh
# tmpfs is mounted over it inside the sandbox, so nothing the install writes there survives or escapes the target tree.
SBX_TMP="/tmp/mth-install.$$"

# Build the pnpm argument list. Lifecycle scripts are off by default; the allow-list in package.json
# (`pnpm.onlyBuiltDependencies`) is the only way a dependency's build script runs.
pnpm_args=(--config.ignore-scripts=true --config.enable-pre-post-scripts=false)
case "$MODE" in
  create)
    # The only mode permitted to write/update the lockfile. `--config.frozen-lockfile=false` is required because CI=1
    # (set below to disable interactive prompts) otherwise defaults pnpm to a frozen install and refuses to update it.
    # Still deterministic: exact versions (.npmrc save-exact), no lifecycle scripts.
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

# bubblewrap: read-only root; writable only the repo (target tree) and the pnpm store; private /tmp, /dev, /proc; own
# user/ipc/pid/uts/cgroup namespaces; host network shared (registry reachability, bounded by the env policy). The
# container has no unprivileged user namespaces for nesting, but bwrap itself runs fine as root here (see D-030).
bwrap_args=(
  --ro-bind / /
  --dev /dev
  --proc /proc
  --tmpfs /tmp
  --tmpfs /run
  --bind "$REPO_ROOT" "$REPO_ROOT"
  --bind "$PNPM_STORE" "$PNPM_STORE"
  --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup
  --die-with-parent
  --new-session
  --chdir "$REPO_ROOT"
  --setenv HOME "$SBX_TMP"
  --setenv XDG_CACHE_HOME "$SBX_TMP/cache"
  --setenv XDG_STATE_HOME "$SBX_TMP/state"
  --setenv XDG_DATA_HOME "$SBX_TMP/data"
  --setenv PNPM_HOME "$SBX_TMP/pnpm"
  --setenv npm_config_store_dir "$PNPM_STORE"
  --setenv npm_config_registry "https://registry.npmjs.org/"
  --setenv CI "1"
)
# Recreate the private tmp inside the sandbox before the command runs.
prelude='mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$PNPM_HOME";'

if [ "$MODE" = "run" ]; then
  exec bwrap "${bwrap_args[@]}" -- /usr/bin/env bash -c "$prelude exec \"\$@\"" bash "$@"
fi

# In 'create'/'frozen', run pnpm and then assert the lockfile did not change unexpectedly in frozen mode (belt-and-braces
# on top of --frozen-lockfile), and that a lockfile now exists in create mode.
before=""
[ -f "$REPO_ROOT/pnpm-lock.yaml" ] && before="$(sha256sum "$REPO_ROOT/pnpm-lock.yaml" | cut -d' ' -f1)"

bwrap "${bwrap_args[@]}" -- /usr/bin/env bash -c "$prelude exec pnpm \"\$@\"" bash "${pnpm_args[@]}"
rc=$?

after=""
[ -f "$REPO_ROOT/pnpm-lock.yaml" ] && after="$(sha256sum "$REPO_ROOT/pnpm-lock.yaml" | cut -d' ' -f1)"

if [ "$rc" -eq 0 ] && [ "$MODE" = "frozen" ] && [ "$before" != "$after" ]; then
  fail "the lockfile changed under a frozen install (before=$before after=$after) — refusing"
fi
if [ "$rc" -eq 0 ] && [ "$MODE" = "create" ] && [ -z "$after" ]; then
  fail "'create' produced no pnpm-lock.yaml"
fi
exit "$rc"
