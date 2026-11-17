#!/usr/bin/env bash
# qa-verifier DG7 round 1, sequence C2: a second disposable clone ($TMPDIR/rv2, shared objects, sparse like rv) at the
# source commit, offline install and build, then the root acceptance e2e (61) and the demo e2e (62), both Playwright
# projects (chromium-en LTR, chromium-ar RTL), one worker. Moved out of seqC.sh (see the note there).
# The A17 webhook signing secret is a random SYNTHETIC value generated for this run only (never stored).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
C="$TMPDIR/rv2"
step() { # step <name> <command...>: log + rc in the evidence directory, run in rv2
  local n="$1"; shift
  { echo "### $n start $(date -u +%FT%TZ) node $(node -v) clone $C HEAD $(git -C "$C" rev-parse HEAD) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset}"; echo "### \$ $*"; } > "$E/$n.log"
  (cd "$C" && "$@") >> "$E/$n.log" 2>&1; local rc=$?
  echo "### $n end $(date -u +%FT%TZ) exit=$rc" >> "$E/$n.log"; echo "$rc" > "$E/$n.rc"; return $rc
}
rm -rf "$C"
git clone -q --shared --no-checkout /home/user/My-owns "$C" && git -C "$C" sparse-checkout set --no-cone '/*' \
  '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git -C "$C" checkout -q ddf42ccd2630f3d62f6aaf360ff401bbc2bde025 || exit 2
step 59a-rv2-install pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/store/v10"
step 59b-rv2-build pnpm build
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="qa-synthetic-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET
mapfile -t ROOTSPECS < <(cd "$C" && find e2e -maxdepth 1 -name '*.spec.ts' ! -name 'a02-*' | LC_ALL=C sort)
export E2E_PG_PORT=32550 E2E_API_PORT=32551 QA_CONNECTION_LOG="$TMPDIR/qa-conn/connection-log.jsonl"
step 61-e2e-root e2e/support/a21-connection-log-run.sh npx playwright test --workers=1 --trace=off --reporter=list "${ROOTSPECS[@]}"
[ -f "$QA_CONNECTION_LOG" ] && gzip -c "$QA_CONNECTION_LOG" > "$E/61-e2e-root.connection-log.jsonl.gz"
export E2E_PG_PORT=32552 E2E_API_PORT=32553
step 62-e2e-demo e2e/support/with-demo-stack.sh npx playwright test --workers=1 --trace=off --reporter=list e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-guided-walkthrough.spec.ts
echo "seqC2 done $(date -u +%FT%TZ)"
