#!/usr/bin/env bash
# code-security-reviewer DG5 RG2 round 2: the sequential driver of the remaining runs (one at a time: the machine is shared
# by three concurrent reviews). Copies of checks.sh / mutants-e2e.sh are executed from $TMPDIR so no script is edited while
# bash reads it (the cause of the static wrapper's exit 2, 10-15-static-wrapper.log).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-2
cp "$E/checks.sh" "$TMPDIR/checks.run.sh"
cp "$E/mutants-e2e.sh" "$TMPDIR/mutants-e2e.run.sh"
cd "$TMPDIR/rv" || exit 2
# 1. Node 22 unit-node project alone (its first run had one vitest RPC timeout under load; 20-unit-node22.log).
(
  export PATH=/opt/node22/bin:$PATH
  unset LANG LC_ALL
  L=$E/20b-unit-node22-rerun-unit-node.log
  {
    echo "# 20b-unit-node22-rerun-unit-node  started $(date -u +%FT%TZ)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "\$ npx vitest run --project unit-node"
    npx vitest run --project unit-node
    echo "exit=$?  finished $(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } >"$L" 2>&1
)
# 2. F-DG5-100 e2e mutants (restores the two files afterwards).
bash "$TMPDIR/mutants-e2e.run.sh"
echo "git status after mutants: $(git status --porcelain | wc -l) changed paths" >>"$E/46d-ooxml-e2e-mutants.log"
# 3. The P5 role sweep and database probes (round-1 probe, unchanged).
bash "$TMPDIR/checks.run.sh" sweep
# 4. The integration suite twice.
bash "$TMPDIR/checks.run.sh" int-unset
bash "$TMPDIR/checks.run.sh" int-cutf8
echo "drive done $(date -u +%FT%TZ)"
