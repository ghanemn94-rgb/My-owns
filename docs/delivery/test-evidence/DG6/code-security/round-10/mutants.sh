#!/usr/bin/env bash
# code-security-reviewer, DG6 round 10 (T-DG6-REV-CS-R10): mutants that revert parts of the F-DG6-540 repair (BE-Z13,
# BE-Z13B, BE-Z14 digest), the F-DG6-541 repair (BE-Z13, BE-Z13C) and the observation 600/601 (= F-DG6-580) repair
# (BE-Z14), run in the disposable clone $TMPDIR/r/w1 (shared clone at cde60365, node_modules copied; never the
# candidate tree), sequentially, with no other run in w1 at the same time.
# Each mutant edits product source in w1 only, runs the tests that should catch it (the in-tree repair tests and, where
# useful, my reproduction), and restores the file (git checkout). A CAUGHT mutant = non-zero exit.
# Usage: mutants.sh <M0|M0W|M1|M2|M3|M4|M5|M6|M7>   Logs: 5x-mutant-*.log, each ends "exit=<n>" then "restored: ...".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-10
W=${W:-$TMPDIR/r/w1}
export MTH_PORT_POOL=32070-32079 QA_PG_PORT=32070
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
unset LANG LC_ALL
cd "$W" || exit 2
INBOX=apps/api/test/integration/tasks/inbox-restricted-z13.test.ts
DIGEST=apps/api/test/integration/tasks/digest-restricted-z14.test.ts
TOKENS13=apps/api/test/integration/access/automation-restricted-tokens-z13.test.ts
TOKENS14=apps/api/test/integration/access/automation-restricted-tokens-z14.test.ts
SWEEP=apps/api/src/modules/tasks/notification-serializers.test.ts
EDITOR=apps/web/src/pages/automation/rule-editor-tokens-z14.test.tsx
vt() { PATH=/opt/node22/bin:$PATH tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"; }
vu() { PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH npx vitest run --configLoader runner --project unit-node "$@"; }
vw() { PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH npx vitest run --configLoader runner --project unit-web "$@"; }
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
    echo "# $name  started $(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "## mutation (git diff of w1, product paths):"
    git diff --stat -- apps packages
    git diff -- apps packages
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)"
  } >"$E/$name.log" 2>&1
  git checkout -q -- apps packages
  rm -f tests/qa/integration/zz-cs-*.test.ts apps/web/src/pages/automation/zz-cs-*.test.tsx
  echo "restored: $(git status --short | wc -l) changed paths" >>"$E/$name.log"
  tail -2 "$E/$name.log"
}
both() { "$@"; }
case "$1" in
  M0)
    run 59-control-unmutated-integration vt "$INBOX" "$DIGEST" "$TOKENS13" "$TOKENS14"
    ;;
  M0W)
    run 59-control-unmutated-unit both sh -c "PATH=/opt/nvm/versions/node/v24.21.0/bin:\$PATH npx vitest run --configLoader runner --project unit-node $SWEEP && PATH=/opt/nvm/versions/node/v24.21.0/bin:\$PATH npx vitest run --configLoader runner --project unit-web $EDITOR"
    ;;
  M1)
    # Observation 600 (F-DG6-540 class): the digest read no longer redacts its items (decision computed, not applied).
    mutate apps/api/src/modules/tasks/digests.ts '          restricted.at(i) === true,' '          (void restricted, false),'
    cp "$E/repro/zz-cs-r10-digest.test.ts" tests/qa/integration/
    run 50-mutant-M1-digest-unredacted vt "$DIGEST" tests/qa/integration/zz-cs-r10-digest.test.ts
    ;;
  M2)
    # Observation 601 / F-DG6-580: the version check of a token is removed (a token of another version is resolved
    # against the current positions, the round-9 behaviour).
    mutate apps/api/src/modules/automation/versions.ts '    if (Number(m[1]) !== stored.version) throw automationRefusals.restrictedTokenStale(at);' '    void automationRefusals.restrictedTokenStale;'
    cp "$E/repro/zz-cs-r10-token-stale.test.ts" tests/qa/integration/
    run 51-mutant-M2-token-version-unchecked vt "$TOKENS14" tests/qa/integration/zz-cs-r10-token-stale.test.ts
    ;;
  M3)
    # F-DG6-541: an unknown token is stored as a literal instead of refused.
    mutate apps/api/src/modules/automation/versions.ts '    if (literal === undefined) throw automationRefusals.restrictedMarkerUnknown(at);' '    if (literal === undefined) return v;'
    cp "$E/repro/zz-cs-r8-automation-resave.test.ts" tests/qa/integration/
    run 52-mutant-M3-unknown-token-stored vt "$TOKENS13" "$TOKENS14" tests/qa/integration/zz-cs-r8-automation-resave.test.ts
    ;;
  M4)
    # F-DG6-540: markInboxNotificationRead no longer redacts its response.
    mutate apps/api/src/modules/tasks/routes.ts '      return notificationFor(row, restricted === true);' '      void restricted; return notificationFor(row, false);'
    cp "$E/repro/zz-cs-r8-inbox-text.test.ts" tests/qa/integration/
    run 53-mutant-M4-mark-read-unredacted vt "$INBOX" tests/qa/integration/zz-cs-r8-inbox-text.test.ts
    ;;
  M5)
    # F-DG6-580 (web): the editor no longer reloads its form from the saved version (the round-9 behaviour).
    mutate apps/web/src/pages/automation/RulePage.tsx '            if (saved !== null) setForm({ from: saved.version, draft: loadDraft(saved) });' '            void saved;'
    cp "$E/repro/zz-cs-r10-editor-stale-token.test.tsx" apps/web/src/pages/automation/
    run 54-mutant-M5-editor-no-reload vw "$EDITOR" apps/web/src/pages/automation/zz-cs-r10-editor-stale-token.test.tsx
    ;;
  M6)
    # Observation 600 guard: a NEW API module serializes notifications without the redaction (the round-9 digests.ts
    # shape). The serializer sweep must fail.
    mkdir -p apps/api/src/modules/tasks
    cat >apps/api/src/modules/tasks/zz-cs-export.ts <<'TS'
import type { NotificationDigestItem } from "@mth/shared/schemas";
import type { DbOrTx } from "@mth/db";
export async function exportMine(db: DbOrTx, userId: string): Promise<NotificationDigestItem[]> {
  const rows = await db.selectFrom("inbox_notification").selectAll().where("recipient_user_id", "=", userId).execute();
  return rows.map((n) => ({ notificationId: n.id, messageKey: n.message_key, messageParams: {}, linkPath: n.link_path, createdAt: "" }));
}
TS
    run 55-mutant-M6-new-unredacted-serializer sh -c "git add -N apps/api/src/modules/tasks/zz-cs-export.ts; PATH=/opt/nvm/versions/node/v24.21.0/bin:\$PATH npx vitest run --configLoader runner --project unit-node $SWEEP; r=\$?; git reset -q apps/api/src/modules/tasks/zz-cs-export.ts; rm -f apps/api/src/modules/tasks/zz-cs-export.ts; exit \$r"
    ;;
  M6B)
    # Limit of the textual sweep (observation, not a regression anyone would write by accident): the digest keeps the
    # helper NAMES but they are shadowed by no-ops. The sweep is expected NOT to catch this; the digest integration test
    # must.
    mutate apps/api/src/modules/tasks/digests.ts 'import { restrictedNotifications, restrictedNotificationView } from "./deep-links.ts";' 'const restrictedNotifications = async (..._a: unknown[]) => [] as boolean[]; const restrictedNotificationView = <T,>(v: T, ..._a: unknown[]) => v;'
    run 57-mutant-M6B-shadowed-helpers sh -c "PATH=/opt/nvm/versions/node/v24.21.0/bin:\$PATH npx vitest run --configLoader runner --project unit-node $SWEEP; echo sweep-exit=\$?; PATH=/opt/node22/bin:\$PATH tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $DIGEST"
    ;;
  M7)
    # F-DG6-580 (web): after a 409 the editor keeps the stale form instead of reloading the current version.
    mutate apps/web/src/pages/automation/RulePage.tsx '      await reloadCurrent().catch(() => undefined);' '      void reloadCurrent;'
    run 56-mutant-M7-editor-no-reload-after-409 vw "$EDITOR"
    ;;
esac
