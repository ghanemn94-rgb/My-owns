#!/usr/bin/env bash
# qa-verifier DG7 round 4: secret scans of the candidate in the disposable sparse clone $TMPDIR/rv at the source commit.
# payload = the candidate manifest of the working tree (meta paths excluded, so the sparse checkout holds every file it
# reads); history = every blob reachable from HEAD, read from git objects. The allow-list is unchanged since round 3.
set -u
. "$(dirname "$0")/env.sh"
cd "$C" || exit 2; echo "clone HEAD $(git rev-parse HEAD)"
echo "## allow-list unchanged since round 3: $(git diff --quiet 3e8f5bce2 HEAD -- tools/release/secret-allowlist.json && echo yes || echo NO)"
echo "## payload"; node tools/release/secret-scan.mjs --scope payload 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
echo "## history"; node tools/release/secret-scan.mjs --scope history 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
