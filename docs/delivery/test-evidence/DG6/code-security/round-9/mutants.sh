#!/usr/bin/env bash
# code-security-reviewer, DG6 round 9 (T-DG6-REV-CS-R9): mutants that revert parts of the F-DG6-540 repair (BE-Z13,
# BE-Z13B) and the F-DG6-541 repair (BE-Z13, BE-Z13C), run in the disposable clone $TMPDIR/r/w1 (shared clone at
# d974011f, node_modules copied; never the candidate tree) AFTER its integration shards finished (no concurrent run).
# Each mutant edits product source in w1 only, runs the tests that should catch it (in-tree repair tests and, where
# useful, my round-8 reproduction), and restores the file (git checkout). A CAUGHT mutant = non-zero exit.
# Usage: mutants.sh <M0|M1|M2|M3|M4|M5>   Logs: 5x-mutant-*.log, each ends "exit=<n>" then "restored: ...".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-9
W=${W:-$TMPDIR/r/w1}
export PATH=/opt/node22/bin:$PATH MTH_PORT_POOL=30870-30879 QA_PG_PORT=30870
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
unset LANG LC_ALL
cd "$W" || exit 2
INBOX=apps/api/test/integration/tasks/inbox-restricted-z13.test.ts
FANOUT=apps/api/test/integration/tasks/channel-fanout-restricted-z13b.test.ts
TOKENS=apps/api/test/integration/access/automation-restricted-tokens-z13.test.ts
vt() { tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"; }
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(a) == 1, f"anchor not found exactly once in {p}: {a!r}"
open(p, "w").write(s.replace(a, b, 1))
PY
}
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  node=$(node -v)  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "## mutation (git diff of w1, product paths):"
    git diff --stat -- apps packages
    git diff -- apps packages
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)"
  } >"$E/$name.log" 2>&1
  git checkout -q -- apps packages
  rm -f tests/qa/integration/zz-cs-*.test.ts
  echo "restored: $(git status --short | wc -l) changed paths" >>"$E/$name.log"
  tail -2 "$E/$name.log"
}
case "$1" in
  M0)
    run 59-control-unmutated vt "$INBOX" "$FANOUT" "$TOKENS"
    ;;
  M1)
    # F-DG6-540: markInboxNotificationRead no longer redacts its response.
    mutate apps/api/src/modules/tasks/routes.ts '      return notificationFor(row, restricted === true);' '      void restricted; return notificationFor(row, false);'
    cp "$E/repro/zz-cs-r8-inbox-text.test.ts" tests/qa/integration/
    run 50-mutant-M1-mark-read-unredacted vt "$INBOX" tests/qa/integration/zz-cs-r8-inbox-text.test.ts
    ;;
  M2)
    # F-DG6-540: restrictedNotifications ignores ids of child sources (Finance validation, overlap) in link/params/target.
    mutate apps/api/src/modules/tasks/deep-links.ts '      [...idsOf.at(i)!].some((id) => hidden.has(id)) ||' '      (false as boolean) ||'
    run 51-mutant-M2-inbox-child-ids-ignored vt "$INBOX"
    ;;
  M3)
    # F-DG6-540 (D-227 (2)): the worker's channel fan-out checks only the stored target again (not link or params).
    mutate apps/worker/src/handlers/notifications.ts '  const ids = uuidsInValue([n.link_path, n.message_params, n.target_record_id]);' '  const ids = uuidsInValue([n.target_record_id]);'
    run 52-mutant-M3-channel-link-params-ignored vt "$FANOUT"
    ;;
  M4)
    # F-DG6-541: an unknown token or the bare marker is stored as a literal instead of refused.
    mutate apps/api/src/modules/automation/versions.ts '    if (literal === undefined) throw automationRefusals.restrictedMarkerUnknown(at);' '    if (literal === undefined) return v;'
    run 53-mutant-M4-unknown-marker-stored vt "$TOKENS"
    ;;
  M5)
    # F-DG6-541 / D-228 (1): the token ordinal counts only the reader's hidden literals (the pre-D-228 numbering).
    mutate apps/api/src/modules/automation/versions.ts '      const token = automationRestrictedToken(k);' '      void k; const token = automationRestrictedToken(tokens.size + 1);'
    cp "$E/repro/zz-cs-r8-automation-resave.test.ts" tests/qa/integration/
    run 54-mutant-M5-hidden-only-ordinal vt "$TOKENS" tests/qa/integration/zz-cs-r8-automation-resave.test.ts
    ;;
esac
