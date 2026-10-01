#!/usr/bin/env bash
# CI dependency install (REQ-DLV-042, F-DG1-104, D-046). EVERY CI job installs dependencies through this script, which
# runs the sandboxed installer `tools/deps/install-sandbox.sh frozen` (bubblewrap: read-only root, cleared environment,
# all capabilities dropped, lifecycle scripts only for the reviewed allow-list, lockfile frozen and re-checked).
# deploy/scripts/check-ci-needs.mjs fails any workflow step that installs dependencies any other way.
#
#   deploy/scripts/ci-install-deps.sh
#
# There is NO fallback to a plain `pnpm install`: if bubblewrap is missing, or present but unable to create its sandbox
# on this runner (user namespaces / mount restricted), the install is BLOCKED (exit 65) and the job fails.
# pnpm must be a real binary on PATH (not a Corepack shim): the sandbox clears HOME, so a shim would have no cache.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
blocked() { echo "ci-install-deps: BLOCKED: $*" >&2; exit 65; }

command -v bwrap >/dev/null 2>&1 || blocked "bubblewrap (bwrap) is not installed on this runner; refusing an unsandboxed install"
# Probe with the same namespaces, mounts and capability drop as the installer, so an unusable bwrap is reported as
# BLOCKED here, with the reason, rather than as a confusing package-manager failure.
probe_err="$(bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /run \
  --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup --cap-drop ALL --die-with-parent --new-session \
  -- /bin/true 2>&1)" || blocked "bubblewrap cannot create its sandbox on this runner: ${probe_err:-unknown error}"
echo "ci-install-deps: $(bwrap --version); sandbox probe OK"
echo "ci-install-deps: node $(node --version); pnpm $(pnpm --version) at $(command -v pnpm)"
echo "ci-install-deps: lockfile sha256 $(sha256sum "$REPO/pnpm-lock.yaml" | cut -d' ' -f1)"

"$REPO/tools/deps/install-sandbox.sh" frozen

# Belt and braces on top of the installer's own before/after hash: the committed lockfile is unchanged.
if command -v git >/dev/null 2>&1 && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$REPO" diff --exit-code --quiet -- pnpm-lock.yaml ||
    { echo "ci-install-deps: pnpm-lock.yaml changed during a frozen install" >&2; exit 1; }
fi
echo "ci-install-deps: OK (sandboxed, frozen lockfile)"
