#!/usr/bin/env bash
# DG1 round-4 code-security re-test of F-DG1-118 (T-DG1-REV-SEC-R4). Extends the round-3 reproduction
# (../round-3/repro-copyback-escape.sh) with additional vectors against the round-4 copy-back
# (tools/deps/install-sandbox.sh:144-153: members enumerated from the REAL tree with find -print0).
#
# A scratch git project (a pnpm workspace with ONE member packages/a) depends on an allow-listed local package `evil`
# whose postinstall runs INSIDE the sandbox and, in the disposable copy ($WS = INIT_CWD), plants:
#   V1  every round-3 vector: node_modules dirs under .claude/{rules,skills,commands,agents}, .git/hooks, tools/gates,
#       docs/delivery, .vscode, and the newline-name vector "h\n../victim/node_modules";
#   V2  a forged workspace member: tools/gates/package.json + tools/gates/node_modules/x (a member only in $WS);
#   V3  a newline-named directory containing a package.json + node_modules ("n\nl/package.json");
#   V4  a symlink inside the root node_modules pointing OUTSIDE the root (node_modules/zz-out -> $OUTSIDE), plus a
#       file written through nothing (cp -a must copy the link, not follow it);
#   V5  the member's node_modules replaced by a symlink to $OUTSIDE (must be skipped, not followed);
#   V6  a hard-link attempt from $WS to a file in the REAL root (must fail: the real root is read-only / other mount).
# Afterwards (host side) it lists every path under the REAL root that is new or changed and every change outside it.
#
# Usage: repro-copyback-escape-r4.sh <path-to-install-sandbox.sh>
#   Runs ONLY in a scratch project under $TMPDIR. Needs a writable pnpm store (npm_config_store_dir); no network.
set -uo pipefail
WRAP="${1:?usage: $0 <install-sandbox.sh>}"
S="$(mktemp -d "${TMPDIR:?}/cbx4.XXXXXX")"
ROOT="$S/repo"; VICTIM="$S/victim"; OUTSIDE="$S/outside"
mkdir -p "$ROOT/evil" "$ROOT/packages/a" "$ROOT/.claude/agents" "$ROOT/tools/gates" "$ROOT/docs/delivery" \
         "$VICTIM/node_modules" "$OUTSIDE"
echo keep > "$VICTIM/node_modules/keep.txt"
echo outside-original > "$OUTSIDE/sentinel.txt"
echo "# agent" > "$ROOT/.claude/agents/a.md"
echo "// gate" > "$ROOT/tools/gates/validate.mjs"
echo '{ "name": "a", "version": "1.0.0", "private": true }' > "$ROOT/packages/a/package.json"
printf 'packages:\n  - "packages/*"\n' > "$ROOT/pnpm-workspace.yaml"
cat > "$ROOT/evil/package.json" <<'JSON'
{ "name": "evil", "version": "1.0.0", "scripts": { "postinstall": "node plant.js" } }
JSON
cat > "$ROOT/evil/plant.js" <<JS
const fs = require('fs'), p = require('path'), W = process.env.INIT_CWD;
const OUTSIDE = ${OUTSIDE@Q};
const log = (m) => fs.appendFileSync(p.join(W, 'node_modules', 'PLANT_LOG'), m + '\n');
const plant = (rel, file, body) => { try { fs.mkdirSync(p.join(W, rel), { recursive: true }); fs.writeFileSync(p.join(W, rel, file), body); log('planted ' + JSON.stringify(rel + '/' + file)); } catch (e) { log('plant-failed ' + rel + ' ' + e.code); } };
// V1 (round-3 vectors)
plant('.claude/rules/node_modules',  'injected.md', 'PLANTED\n');
plant('.claude/skills/node_modules', 'SKILL.md',    'PLANTED\n');
plant('.claude/commands/node_modules','pwn.md',     'PLANTED\n');
plant('.claude/agents/node_modules', 'evil.md',     'PLANTED\n');
plant('.git/hooks/node_modules',     'x',           'PLANTED\n');
plant('tools/gates/node_modules',    'x',           'PLANTED\n');
plant('docs/delivery/node_modules',  'x',           'PLANTED\n');
plant('.vscode/node_modules',        'x',           'PLANTED\n');
plant('h\n../victim/node_modules',   'x',           'PLANTED\n');
// V2 forged member (exists only in the disposable copy)
plant('tools/gates', 'package.json', '{"name":"forged","version":"1.0.0"}');
// V3 newline-named forged member
plant('n\nl', 'package.json', '{"name":"nl","version":"1.0.0"}');
plant('n\nl/node_modules', 'x', 'PLANTED\n');
// V4 symlink inside root node_modules pointing outside the root
try { fs.symlinkSync(OUTSIDE, p.join(W, 'node_modules', 'zz-out')); log('symlink zz-out -> OUTSIDE'); } catch (e) { log('symlink-failed ' + e.code); }
// V5 member node_modules replaced by a symlink to OUTSIDE
try { fs.rmSync(p.join(W, 'packages/a/node_modules'), { recursive: true, force: true }); fs.symlinkSync(OUTSIDE, p.join(W, 'packages/a/node_modules')); log('packages/a/node_modules -> OUTSIDE'); } catch (e) { log('v5-failed ' + e.code); }
// V6 hard link from the copy to a file in the REAL root
try { fs.linkSync(${ROOT@Q} + '/tools/gates/validate.mjs', p.join(W, 'node_modules', 'zz-hardlink')); log('hardlink created'); } catch (e) { log('hardlink-failed ' + e.code); }
// control: direct write to the real root
try { fs.writeFileSync(${ROOT@Q} + '/tools/gates/direct', 'x'); log('DIRECT WRITE SUCCEEDED'); } catch (e) { log('direct-write-refused ' + e.code); }
JS
cat > "$ROOT/package.json" <<'JSON'
{ "name": "cbx-root", "version": "1.0.0", "private": true,
  "dependencies": { "evil": "file:./evil" },
  "pnpm": { "onlyBuiltDependencies": ["evil"] } }
JSON
git -C "$ROOT" init -q && printf 'node_modules/\n' > "$ROOT/.gitignore" && git -C "$ROOT" add -A && git -C "$ROOT" -c user.email=r@x -c user.name=r -c commit.gpgsign=false commit -qm base
( cd "$S" && find . -path ./repo -prune -o -print0 | sort -z | xargs -0 sha256sum 2>/dev/null ) > "$S/../cbx4-outside-before.$$"
( cd "$ROOT" && find . -path ./.git -prune -o -path ./node_modules -prune -o -path ./packages/a/node_modules -prune -o -print | sort ) > "$S/../cbx4-tree-before.$$"
echo "== installer: $WRAP"
( cd "$ROOT" && "$WRAP" --root "$ROOT" create >/dev/null 2>"$S/../cbx4-install.err.$$" ); echo "== installer create exit=$?"
sed 's/^/   stderr: /' "$S/../cbx4-install.err.$$" | tail -5
echo "== plant log (inside the sandbox, copied back as part of the root node_modules):"
sed 's/^/   /' "$ROOT/node_modules/PLANT_LOG" 2>/dev/null || echo "   (no PLANT_LOG — postinstall did not run?)"
echo "== V1 planted paths in the REAL root:"
for f in .claude/rules/node_modules .claude/skills/node_modules .claude/commands/node_modules .claude/agents/node_modules \
         .git/hooks/node_modules tools/gates/node_modules docs/delivery/node_modules .vscode/node_modules; do
  if [ -e "$ROOT/$f" ]; then echo "   PRESENT  $f"; else echo "   absent   $f"; fi
done
echo "== V2 forged member: tools/gates/package.json $( [ -e "$ROOT/tools/gates/package.json" ] && echo PRESENT || echo absent )"
echo "== V3 newline member: $(ls -A "$ROOT" | grep -c $'^n$' ) top-level 'n' entries; $(find "$ROOT" -name $'n\nl' | wc -l) newline dirs"
echo "== V4 root node_modules/zz-out: $( if [ -L "$ROOT/node_modules/zz-out" ]; then echo "symlink -> $(readlink "$ROOT/node_modules/zz-out") (copied as a link, not followed)"; elif [ -e "$ROOT/node_modules/zz-out" ]; then echo "REAL DIR/FILE"; else echo absent; fi )"
echo "== V5 packages/a/node_modules: $( if [ -L "$ROOT/packages/a/node_modules" ]; then echo "SYMLINK"; elif [ -d "$ROOT/packages/a/node_modules" ]; then echo dir; else echo "absent (symlink source skipped)"; fi )"
echo "== V6 hardlink: $( [ -e "$ROOT/node_modules/zz-hardlink" ] && echo "present (links=$(stat -c %h "$ROOT/node_modules/zz-hardlink"))" || echo absent )"
echo "== REAL root: paths new since before (excluding .git, root node_modules, packages/a/node_modules):"
( cd "$ROOT" && find . -path ./.git -prune -o -path ./node_modules -prune -o -path ./packages/a/node_modules -prune -o -print | sort ) > "$S/../cbx4-tree-after.$$"
diff "$S/../cbx4-tree-before.$$" "$S/../cbx4-tree-after.$$" | sed 's/^/   /'; echo "   (end of diff)"
echo "== git status after:"; git -C "$ROOT" status --porcelain --ignored | sed 's/^/   /'
echo "== outside the root (victim/, outside/, siblings): changes:"
( cd "$S" && find . -path ./repo -prune -o -print0 | sort -z | xargs -0 sha256sum 2>/dev/null ) > "$S/../cbx4-outside-after.$$"
if cmp -s "$S/../cbx4-outside-before.$$" "$S/../cbx4-outside-after.$$"; then echo "   NONE (byte-identical)"; else diff "$S/../cbx4-outside-before.$$" "$S/../cbx4-outside-after.$$" | sed 's/^/   /'; fi
echo "   victim: $(ls -A "$VICTIM/node_modules" 2>&1 | tr '\n' ' ')  outside: $(ls -A "$OUTSIDE" | tr '\n' ' ')"
rm -rf "$S" "$S/../cbx4-"*".$$"
