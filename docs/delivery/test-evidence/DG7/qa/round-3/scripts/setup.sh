#!/usr/bin/env bash
# qa-verifier DG7 round 3: disposable shared sparse clone $TMPDIR/rv at the source commit 3e8f5bce2, a writable copy of
# the pnpm store in $TMPDIR/store, offline frozen install. Sparse: no docs/delivery/{runs,handbacks,test-evidence},
# no trading_agent (outside the candidate; the shared scratch disk has about 1 GB free).
set -u
. "$(dirname "$0")/env.sh"
{
rm -rf "$C"
git clone -q --shared --no-checkout /home/user/My-owns "$C" && git -C "$C" sparse-checkout set --no-cone '/*' \
  '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git -C "$C" checkout -q $COMMIT || { echo "clone FAIL"; exit 2; }
echo "clone HEAD: $(git -C "$C" rev-parse HEAD)"
mkdir -p "$TMPDIR/store" && cp -a /root/.local/share/pnpm/store/v10 "$TMPDIR/store/" && echo "store copied: $(du -sh "$TMPDIR/store" | cut -f1)"
cd "$C" && node -v && pnpm -v && time pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/store/v10"
echo "exit=$?"
df -h "$TMPDIR" | tail -1
} > "$E/03-install.log" 2>&1
