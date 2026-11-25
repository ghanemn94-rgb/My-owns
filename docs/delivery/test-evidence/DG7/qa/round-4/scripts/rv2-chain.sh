#!/usr/bin/env bash
# qa-verifier DG7 round 4: second disposable clone $TMPDIR/rv2 (shared objects, sparse like rv) at the source commit,
# offline install and build (59a/59b), then w1-e2e-root.sh (61) and w2-rv2.sh (62 demo e2e, 63 offline drill,
# 64 keyboard walkthrough), both Playwright projects (chromium-en LTR, chromium-ar RTL), one worker.
set -u
. "$(dirname "$0")/env.sh"
export QA_CLONE="$TMPDIR/rv2"
rm -rf "$QA_CLONE"
git clone -q --shared --no-checkout /home/user/My-owns "$QA_CLONE" && git -C "$QA_CLONE" sparse-checkout set --no-cone '/*' \
  '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git -C "$QA_CLONE" checkout -q $COMMIT || exit 2
bash $S/run.sh 59a-rv2-install pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/store/v10"
bash $S/run.sh 59b-rv2-build pnpm build || exit 3
bash $S/w1-e2e-root.sh
bash $S/w2-rv2.sh
echo "rv2-chain done $(date -u +%FT%TZ)"
