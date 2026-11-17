#!/usr/bin/env bash
# qa-verifier DG7 round 2: disposable shared sparse clone $TMPDIR/rv at the source commit 152db5b51, a writable copy of
# the pnpm store in $TMPDIR/store, offline frozen install. Sparse: no docs/delivery/{runs,handbacks,test-evidence}, no
# trading_agent (outside the candidate; the shared disk is small).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
C="$TMPDIR/rv"
{
rm -rf "$C"
git clone -q --shared --no-checkout /home/user/My-owns "$C" && git -C "$C" sparse-checkout set --no-cone '/*' \
  '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git -C "$C" checkout -q 152db5b51155282b28e82472629d07b8d87feb2a || { echo "clone FAIL"; exit 2; }
echo "clone HEAD: $(git -C "$C" rev-parse HEAD)"
mkdir -p "$TMPDIR/store" && cp -a /root/.local/share/pnpm/store/v10 "$TMPDIR/store/" && echo "store copied: $(du -sh "$TMPDIR/store" | cut -f1)"
cd "$C" && node -v && pnpm -v && time pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/store/v10"
echo "exit=$?"
} > "$E/03-install.log" 2>&1
