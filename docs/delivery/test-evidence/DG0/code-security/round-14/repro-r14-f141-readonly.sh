#!/usr/bin/env bash
# F-DG0-141 re-verification without touching any shared directory (code-security-reviewer, DG0 round 14).
# Runs sandbox-run.sh (old 6c61f2e vs fixed 1e64eb0) inside an OUTER bubblewrap in which the ENTIRE filesystem,
# including /tmp and /tmp/claude-0 (the agent-shared $TMPDIR), is read-only. If the wrapper succeeds there, it created
# no clone, work directory or file anywhere another process could see or modify: everything happened on the private
# tmpfs of its own inner sandbox. The inner command also verifies it sees an exact checkout of the commit.
#   usage: repro-r14-f141-readonly.sh [<src-repo>]
set -uo pipefail
SRC="${1:-/home/user/My-owns}"
W="$(mktemp -d "${TMPDIR:-/tmp}/r14-ro.XXXX")"; trap 'rm -rf "$W"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
for C in 6c61f2e1aa07fa6acfc52f20a8ee9fbb554904ac 1e64eb02caf8a8c8c5d59d0c6aad390c70e5b7c5; do
  R="$W/repo-${C:0:7}"; git clone -q "$SRC" "$R"; git -C "$R" checkout -q "$C"
  echo "== commit $C (sandbox-run.sh sha256 $(sha256sum "$R/tools/gates/sandbox-run.sh" | cut -c1-16))"
  bwrap --ro-bind / / --dev /dev --proc /proc --unshare-pid --die-with-parent -- \
    "$R/tools/gates/sandbox-run.sh" HEAD -- bash -c 'echo "inner: cwd=$(pwd) HEAD=$(git rev-parse HEAD) status=[$(git status --porcelain | wc -l) changes] candidate=$(node tools/gates/candidate.mjs --stage DG0 --ref HEAD | python3 -c "import json,sys;print(json.load(sys.stdin)[\"candidate_id\"][:23])")"; touch /home/probe 2>/dev/null && echo "inner: / writable (BAD)" || echo "inner: / read-only"; (echo x > /tmp/src.git/probe) 2>/dev/null && echo "inner: src.git writable (BAD)" || echo "inner: src.git read-only"'
  echo "exit status: $?"
done
