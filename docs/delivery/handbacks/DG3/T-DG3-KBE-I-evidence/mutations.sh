#!/usr/bin/env bash
# T-DG3-KBE-I (F-DG3-280): mutation runs in a DISPOSABLE copy of the working tree ($TMPDIR/kbe-i-mut), never the tree.
# M1: remove "ForOfStatement[await=true], " from the async selector in eslint.config.js.
# M2: remove "PrivateIdentifier[name=/^(then|catch|finally|fromAsync|asyncIterator)$/], " from the round-6 name selector.
# Each mutation must make fuzz.test.ts fail; the file is restored after each, and a clean run must pass.
SRC=$(pwd); C=$TMPDIR/kbe-i-mut; F=packages/shared/src/formula/fuzz.test.ts
rm -rf "$C"; mkdir -p "$C"
# The tree root holds sandbox-mounted dotfiles (.bashrc, .mcp.json, …) that cannot be recreated; they are not needed.
tar -C "$SRC" --exclude=./.git --exclude=./trading_agent -cf - . 2>/dev/null | tar -C "$C" -xf - 2>/dev/null
cd "$C" || exit 2
echo "# node $(node -v); copy of $SRC at $(git -C "$SRC" rev-parse HEAD) + uncommitted changes; $(date -u +%FT%TZ)"
cp eslint.config.js eslint.config.js.orig
# The tail of the vitest output: the failing test, its assertion message (the probe row) and the counts.
run() { pnpm exec vitest run --project unit-node $F > "$TMPDIR/run.out" 2>&1; local rc=$?
  grep -E "^ *(×|FAIL)|AssertionError|Tests  |Test Files" "$TMPDIR/run.out" | head -20; return $rc; }
for m in "ForOfStatement[await=true], " 'PrivateIdentifier[name=/^(then|catch|finally|fromAsync|asyncIterator)$/], '; do
  cp eslint.config.js.orig eslint.config.js
  python3 -c "import sys;p='eslint.config.js';s=open(p).read();m=sys.argv[1];assert s.count(m)==1,m;open(p,'w').write(s.replace(m,''))" "$m" || exit 3
  echo "## MUTATION: removed '$m' (occurrences now: $(grep -cF "$m" eslint.config.js))"
  run; rc=$?; echo "## exit_status: $rc (expected non-zero)"
done
cp eslint.config.js.orig eslint.config.js; rm eslint.config.js.orig
echo "## RESTORED: diff against the tree: $(diff -q eslint.config.js "$SRC/eslint.config.js" && echo identical)"
run; rc=$?; echo "## clean exit_status: $rc (expected 0)"
cd /; rm -rf "$C"; echo "# copy removed; $(date -u +%FT%TZ)"
