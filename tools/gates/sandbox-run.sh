#!/usr/bin/env bash
# Run a command against a committed revision inside an OS sandbox (bubblewrap), never in the working tree.
#
#   tools/gates/sandbox-run.sh <revision> -- <command> [args...]
#
# The orchestrator must not execute agent-writable code, or import from agent-writable paths, outside a sandbox
# (F-DG0-140, F-DG0-229). This script clones <revision> into a fresh directory, so ignored or untracked files in the
# working tree (for example planted bytecode) are absent. It then runs the command with:
#   - the whole filesystem read-only, except the clone and a private /tmp;
#   - no network, a separate PID namespace, and a clean environment (hermetic git, no Python bytecode or safe-path gaps).
# The clone is removed afterwards. The command's exit status is returned.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REV="${1:?usage: sandbox-run.sh <revision> -- <command...>}"; shift
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "sandbox-run: no command" >&2; exit 64; }
command -v bwrap >/dev/null || { echo "sandbox-run: bubblewrap (bwrap) is required" >&2; exit 65; }
cd /
WORK="$(mktemp -d /tmp/claude-0/sbxrun.XXXXXX 2>/dev/null || mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$REPO_ROOT" -c core.hooksPath=/dev/null clone -q --no-hardlinks --no-checkout "$REPO_ROOT" "$WORK/repo"
git -C "$WORK/repo" -c core.hooksPath=/dev/null -c advice.detachedHead=false checkout -q "$(git -C "$REPO_ROOT" rev-parse --verify "$REV^{commit}")"
mkdir -p "$WORK/home"
set +e
env -i PATH="/usr/local/bin:/usr/bin:/bin" HOME="$WORK/home" LANG=C.UTF-8 TMPDIR=/tmp \
  PYTHONDONTWRITEBYTECODE=1 PYTHONSAFEPATH=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind "$WORK" "$WORK" \
        --unshare-net --unshare-pid --die-with-parent --new-session --chdir "$WORK/repo" -- "$@"
RC=$?
set -e
exit $RC
