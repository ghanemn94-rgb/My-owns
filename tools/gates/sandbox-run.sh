#!/usr/bin/env bash
# Run a command against a committed revision inside an OS sandbox (bubblewrap), never in the working tree.
#
#   tools/gates/sandbox-run.sh <revision> -- <command> [args...]
#
# The orchestrator must not execute agent-writable code, or import from agent-writable paths, outside a sandbox
# (D-026; F-DG0-140, F-DG0-229). Everything after resolving <revision> to a commit id happens INSIDE bubblewrap
# (F-DG0-141): the clone, the checkout and the command. The work area is a tmpfs private to the sandbox's mount
# namespace, so no other process (in particular no agent sharing $TMPDIR or /tmp) can see, plant into, or change the
# clone while it is created or checked. Inside the sandbox:
#   - the whole filesystem is read-only, except the private /tmp (which holds the clone and HOME); the repository's
#     git directory is bound read-only at /tmp/src.git;
#   - there is no network, a separate PID namespace, and a clean environment (hermetic git, no Python bytecode or
#     safe-path gaps, git hooks off);
#   - the clone contains only committed content, so ignored or untracked files (for example planted bytecode) are absent.
# The command's exit status is returned.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REV="${1:?usage: sandbox-run.sh <revision> -- <command...>}"; shift
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "sandbox-run: no command" >&2; exit 64; }
command -v bwrap >/dev/null || { echo "sandbox-run: bubblewrap (bwrap) is required" >&2; exit 65; }
cd /
# Resolving a name to a commit reads only the repository's own .git, which agents cannot write (D-025). The git
# directory is then bound read-only into the sandbox, so the source is reachable even when the repository lives under /tmp.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify --end-of-options "$REV^{commit}")"
GIT_COMMON="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
# Inside an agent's process sandbox (a reviewer running the pre-freeze; D-030) a fresh procfs cannot be mounted, and
# that sandbox's /proc shows only its own processes, so it is bound instead and the marker is passed on (see
# nested_in_process_sandbox in tools/agents/agent_sandbox.py). At the top level a private procfs is always mounted.
PROC=(--proc /proc) NESTED=()
if [ "${MTH_PROCESS_SANDBOX:-}" = 1 ] && [ "$(cat /proc/1/comm 2>/dev/null)" = bwrap ]; then
  PROC=(--bind /proc /proc --unshare-user) NESTED=(MTH_PROCESS_SANDBOX=1)
fi
exec env -i PATH="/usr/local/bin:/usr/bin:/bin" HOME=/tmp/home LANG=C.UTF-8 TMPDIR=/tmp \
  PYTHONDONTWRITEBYTECODE=1 PYTHONSAFEPATH=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  MTH_COMMIT="$COMMIT" "${NESTED[@]}" \
  bwrap --ro-bind / / --dev /dev "${PROC[@]}" --tmpfs /tmp --ro-bind "$GIT_COMMON" /tmp/src.git \
        --unshare-net --unshare-pid --die-with-parent --new-session --chdir /tmp -- \
  bash -c 'set -eu
    mkdir /tmp/home
    git -c core.hooksPath=/dev/null clone -q --no-hardlinks --no-checkout -- /tmp/src.git /tmp/repo
    git -C /tmp/repo -c core.hooksPath=/dev/null -c advice.detachedHead=false checkout -q "$MTH_COMMIT"
    cd /tmp/repo
    unset MTH_COMMIT
    exec "$@"' sandbox-run "$@"
