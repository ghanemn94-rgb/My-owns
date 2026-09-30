#!/usr/bin/env bash
# qa-verifier A20: "changing a design token propagates to the rendered CSS".
#
# Runs ONLY on a disposable copy of the tree under $TMPDIR, never on the candidate. Any other path is refused unless
# QA_ALLOW_OUTSIDE_TMPDIR=1; the script's own tree is always refused unless it lies under $TMPDIR.
# It changes one seeded token in the copy's packages/design-tokens/src/tokens.json (to a value different from the
# original), rebuilds the web bundle there, checks the new value is in the built CSS, starts the stack
# (e2e/support/qa-stack.sh) and runs the A20 token test, which asserts that the rendered CSS (:root variables, the
# navigation background and the header gradient) equals the CHANGED token source. The original tokens.json is restored
# in the copy afterwards and the web bundle rebuilt.
#
#   e2e/support/a20-token-propagation.sh <disposable-tree> [token=value]      (default brand.deep=#6B1D5C)
#
# The copy must already have node_modules and a `pnpm -r build`. brand.deep is used because no derived token depends
# on it (derived action shades follow brand.primary and are re-derived by a guard), while semantic tokens reference it
# (nav.background, header.gradient-start), so the test also covers ref propagation.
set -euo pipefail

TREE="$(cd "${1:?usage: $0 <disposable-tree> [token=value]}" && pwd)"
CHANGE="${2:-brand.deep=#6B1D5C}"
TOKEN="${CHANGE%%=*}"
VALUE="${CHANGE#*=}"
HERE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRATCH="$(cd "${TMPDIR:-/nonexistent}" 2>/dev/null && pwd || echo /nonexistent)"
case "$TREE/" in
  "$SCRATCH"/*) ;; # a disposable copy under $TMPDIR
  *)
    if [ "$TREE" = "$HERE_REPO" ] || [ "${QA_ALLOW_OUTSIDE_TMPDIR:-0}" != 1 ]; then
      echo "REFUSED: $TREE is not a disposable copy under \$TMPDIR; clone the candidate there first."
      exit 64
    fi
    ;;
esac
[ "$TOKEN" = "brand.deep" ] || { echo "only brand.deep is supported by the spec's expectation hook"; exit 64; }
FILE="$TREE/packages/design-tokens/src/tokens.json"
[ -f "$FILE" ] || { echo "BLOCKED: $FILE not found"; exit 3; }
cp "$FILE" "$FILE.qa-orig"
restore() { mv -f "$FILE.qa-orig" "$FILE"; }
trap restore EXIT

ORIGINAL="$(node -e 'const t=require(process.argv[1]);console.log(t.color[process.argv[2]].value)' "$FILE" "$TOKEN")"
echo "A20 token propagation: $TOKEN $ORIGINAL -> $VALUE (in $TREE)"
[ "$(echo "$ORIGINAL" | tr a-f A-F)" != "$(echo "$VALUE" | tr a-f A-F)" ] || { echo "the new value equals the original"; exit 64; }
node -e '
  const fs=require("fs"); const [f,k,v]=process.argv.slice(1);
  const t=JSON.parse(fs.readFileSync(f,"utf8")); t.color[k].value=v; fs.writeFileSync(f, JSON.stringify(t,null,2)+"\n");' \
  "$FILE" "$TOKEN" "$VALUE"

(cd "$TREE" && pnpm --filter @mth/web build >/dev/null)
echo "rebuilt apps/web; built CSS contains the new value: $(grep -rl -i -- "$VALUE" "$TREE/apps/web/dist/assets" | head -1 || true)"
grep -rqi -- "$VALUE" "$TREE/apps/web/dist/assets" || { echo "FAIL: new value not in the built CSS"; exit 1; }

cd "$TREE"
QA_EXPECT_BRAND_DEEP="$VALUE" e2e/support/qa-stack.sh npx playwright test e2e/a20-bilingual-shell.spec.ts \
  --grep "design tokens" --workers=1 --reporter=list
echo "A20 token propagation: PASS ($TOKEN rendered as $VALUE, original $ORIGINAL)"

# Rebuild with the original tokens so the copy is left as it was.
restore
trap - EXIT
(cd "$TREE" && pnpm --filter @mth/web build >/dev/null)
