#!/usr/bin/env bash
# qa-verifier DG7 round 4, sequence C2: a second disposable clone ($TMPDIR/rv2, shared objects, sparse like rv) at the
# source commit, offline install and build, then the root acceptance e2e (61; A21 connection log; MTH_PORT_POOL set
# from the start, which the a21 degradation spec needs), the demo e2e (62) and the offline drill (63), both
# Playwright projects (chromium-en LTR, chromium-ar RTL), one worker.
# The A17 webhook signing secret is a random SYNTHETIC value generated for this run only (never stored).
set -u
. "$(dirname "$0")/env.sh"
C2="$TMPDIR/rv2"
step() { # step <name> <command...>: log + rc in the evidence directory, run in rv2
  local n="$1"; shift
  { echo "### $n start $(date -u +%FT%TZ) node $(node -v) clone $C2 HEAD $(git -C "$C2" rev-parse HEAD) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset} free=$(df -Pm "$TMPDIR" | awk 'NR==2{print $4}')MB"; echo "### \$ $*"; } > "$E/$n.log"
  (cd "$C2" && "$@") >> "$E/$n.log" 2>&1; local rc=$?
  echo "### $n end $(date -u +%FT%TZ) exit=$rc free=$(df -Pm "$TMPDIR" | awk 'NR==2{print $4}')MB" >> "$E/$n.log"; echo "$rc" > "$E/$n.rc"; return $rc
}
rm -rf "$C2"
git clone -q --shared --no-checkout /home/user/My-owns "$C2" && git -C "$C2" sparse-checkout set --no-cone '/*' \
  '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git -C "$C2" checkout -q $COMMIT || exit 2
step 59a-rv2-install pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/store/v10"
step 59b-rv2-build pnpm build
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="qa-synthetic-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET
mapfile -t ROOTSPECS < <(cd "$C2" && find e2e -maxdepth 1 -name '*.spec.ts' ! -name 'a02-*' | LC_ALL=C sort)
mkdir -p "$TMPDIR/qa-conn"
export MTH_PORT_POOL=32570-32599 E2E_PG_PORT=32550 E2E_API_PORT=32551 QA_CONNECTION_LOG="$TMPDIR/qa-conn/connection-log.jsonl"
step 61-e2e-root e2e/support/a21-connection-log-run.sh npx playwright test --workers=1 --trace=off --reporter=list "${ROOTSPECS[@]}"
[ -f "$QA_CONNECTION_LOG" ] && gzip -c "$QA_CONNECTION_LOG" > "$E/61-e2e-root.connection-log.jsonl.gz"
rm -rf "$TMPDIR/qa-conn"
unset MTH_PORT_POOL QA_CONNECTION_LOG
export E2E_PG_PORT=32552 E2E_API_PORT=32553
step 62-e2e-demo e2e/support/with-demo-stack.sh npx playwright test --workers=1 --trace=off --reporter=list e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-guided-walkthrough.spec.ts
mkdir -p "$E/offline"
step 63-offline-drill deploy/scripts/offline-drill.sh --out "$E/offline"
echo "seqC2 done $(date -u +%FT%TZ)"
