#!/usr/bin/env bash
# Sandboxed dependency installation (REQ-DLV-042, D-027, threat-model residual 3).
#
# Agent shells have no network (D-025), so dependency installation is an ORCHESTRATOR step. The orchestrator must never
# run a package manager with its own unconfined privileges: a malicious or compromised dependency's install/postinstall
# script would then run against the real filesystem and secrets. This wrapper runs the package manager inside bubblewrap:
#   - the root filesystem is READ-ONLY; only the target tree (the repo) and the package store are writable, and the
#     repo's control paths (.git, .claude, .github, tools/{gates,agents,deps,source}, docs/{source,delivery}, …) are
#     re-bound READ-ONLY so a dependency script cannot tamper with git internals, delivery controls or CI config;
#   - the process runs with ALL capabilities dropped and from a CLEARED environment (only PATH/HOME/XDG/PNPM/registry and
#     the proxy's TLS vars are set) so the orchestrator's own environment — which may hold credentials — never crosses in;
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
# Optional --root <dir>: operate on another tree (the acceptance tests use disposable scratch projects). Only the
# orchestrator invokes this wrapper, so the override is not an escalation; it never widens what is writable beyond the
# named tree and the package store.
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

# A private, writable cache/state area for pnpm and node, so the only host-persistent writable path is the store; a fresh
# tmpfs is mounted over it inside the sandbox, so nothing the install writes there survives or escapes the target tree.
SBX_TMP="/tmp/mth-install.$$"

# Lifecycle-script policy (REQ-DLV-042). A DEPENDENCY's install/build script runs only if the package is on the reviewed
# allow-list `pnpm.onlyBuiltDependencies` in package.json; pnpm 10 blocks every other dependency's scripts by default, so
# no global `ignore-scripts` is set (that would also block allow-listed ones, defeating the "unless allow-listed" rule).
# `enable-pre-post-scripts=false` additionally stops the project's OWN pre/post lifecycle scripts from running on install.
pnpm_args=(--config.enable-pre-post-scripts=false)
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
# ipc/pid/uts/cgroup namespaces; all capabilities dropped; host network shared (registry reachability, bounded by the env
# policy). The container has no unprivileged user namespaces for nesting (so no --unshare-user), but bwrap itself runs
# fine as root here and --cap-drop ALL confines the install's process (see D-030).
bwrap_args=(
  --ro-bind / /
  --dev /dev
  --proc /proc
  --tmpfs /tmp
  --tmpfs /run
  --bind "$REPO_ROOT" "$REPO_ROOT"
  --bind "$PNPM_STORE" "$PNPM_STORE"
)
# Re-bind the repository's control paths READ-ONLY on top of the writable target tree, so a dependency's install script
# cannot tamper with git internals, delivery controls, CI config or the sources even though the tree itself is writable
# (F-DG1-102). Only paths that actually exist are bound — the disposable scratch trees used under --root have none of
# them, so the loop is a no-op there.
for ctrl in .git .claude .github .gitignore .gitattributes CLAUDE.md CLAUDE.local.md \
            tools/gates tools/agents tools/deps tools/source docs/source docs/delivery; do
  [ -e "$REPO_ROOT/$ctrl" ] && bwrap_args+=(--ro-bind "$REPO_ROOT/$ctrl" "$REPO_ROOT/$ctrl")
done
bwrap_args+=(
  --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup
  --cap-drop ALL
  --die-with-parent
  --new-session
  --chdir "$REPO_ROOT"
  # Start from an EMPTY environment, then set only what the install needs: the orchestrator's own environment
  # (which may hold credentials/secrets) must not cross into code that runs a package manager (F-DG1-102).
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
  [ -n "${!v:-}" ] && bwrap_args+=(--setenv "$v" "${!v}")
done
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
