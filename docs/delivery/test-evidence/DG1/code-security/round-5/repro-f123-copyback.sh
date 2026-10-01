#!/usr/bin/env bash
# F-DG1-123 re-test (code-security-reviewer, DG1 round 5). Runs the UNCHANGED candidate installer
# tools/deps/install-sandbox.sh --root <scratch workspace> against disposable workspaces under $TMPDIR.
# Offline (the reviewer sandbox has no registry access): every dependency is a local `file:` package (as in the suite's
# AC-9), plus an .npmrc `offline=true`, so pnpm resolves without registry metadata.
# Usage: repro-f123-copyback.sh <candidate clone>
set -uo pipefail
C="$1"; WRAP="$C/tools/deps/install-sandbox.sh"
B="$(mktemp -d "$TMPDIR/f123.XXXXXX")"

# mkws <dir> <workspace-yaml-body>
#   members by the yaml: root, apps/a, packages/b (each with a package.json and a local dependency), apps/legacy (a
#   package.json, no deps), packages/c (matches packages/* but has NO package.json);
#   tools/x: a stray package.json at depth 2 that is NOT a workspace member (the round-4 enumerator, package.json at
#   depth <= 4, would have treated it as a destination).
#   The allow-listed local fixture's postinstall plants node_modules/PWNED at tools/x, packages/c and apps/legacy
#   INSIDE the disposable copy.
mkws() {
  local d="$1" yaml="$2"
  mkdir -p "$d/apps/a" "$d/apps/legacy" "$d/packages/b" "$d/packages/c" "$d/tools/x" "$d/fixture" "$d/localdep"
  printf 'offline=true\n' > "$d/.npmrc"
  printf '%s\n' "$yaml" > "$d/pnpm-workspace.yaml"
  cat > "$d/package.json" <<'JSON'
{ "name": "ws-root", "version": "1.0.0", "private": true,
  "dependencies": { "localdep": "file:./localdep", "f123-fixture": "file:./fixture" },
  "pnpm": { "onlyBuiltDependencies": ["f123-fixture"] } }
JSON
  echo '{ "name": "localdep", "version": "1.0.0" }' > "$d/localdep/package.json"
  echo 'module.exports = 1;' > "$d/localdep/index.js"
  echo '{ "name": "a", "version": "1.0.0", "private": true, "dependencies": { "localdep": "file:../../localdep" } }' > "$d/apps/a/package.json"
  echo '{ "name": "legacy", "version": "1.0.0", "private": true }' > "$d/apps/legacy/package.json"
  echo '{ "name": "b", "version": "1.0.0", "private": true, "dependencies": { "localdep": "file:../../localdep" } }' > "$d/packages/b/package.json"
  echo '{ "name": "stray-tool", "version": "1.0.0", "private": true }' > "$d/tools/x/package.json"
  cat > "$d/fixture/package.json" <<'JSON'
{ "name": "f123-fixture", "version": "1.0.0",
  "scripts": { "postinstall": "node -e \"const fs=require('fs');for(const p of ['tools/x','packages/c','apps/legacy']){const d=process.env.INIT_CWD+'/'+p+'/node_modules';fs.mkdirSync(d,{recursive:true});fs.writeFileSync(d+'/PWNED','1')}\"" } }
JSON
}
report() {
  local d="$1"
  for p in . apps/a packages/b tools/x packages/c apps/legacy; do
    if [ -e "$d/$p/node_modules" ]; then
      echo "  $p/node_modules: PRESENT [$(ls -A "$d/$p/node_modules" | tr '\n' ' ')]"
    else echo "  $p/node_modules: absent"; fi
  done
}
resolver_members() { # the installer's own resolver, extracted verbatim from the candidate script and run read-only
  local d="$1"
  local js; js="$(sed -n "/^node -e '$/,/^' \"\$REPO_ROOT\"/p" "$WRAP" | sed '1d;$d')"
  node -e "$js" "$d" | sed "s#^$d#  <root>#"
}

echo "=== Case A: create, then frozen; yaml packages: [apps/*, packages/*]"
echo "    expected: node_modules at root, apps/a, packages/b; apps/legacy is a member (apps/*) so its planted node_modules"
echo "    is copied (it is a real member); tools/x (stray package.json, not a member) and packages/c (no package.json) NOT"
A="$B/A"; mkws "$A" $'packages:\n  - "apps/*"\n  - "packages/*"'
echo "  resolver members:"; resolver_members "$A"
"$WRAP" --root "$A" create >"$B/A.create.log" 2>&1; echo "create exit=$?"; tail -3 "$B/A.create.log"
report "$A"
echo "  lockfile written by create: $( [ -f "$A/pnpm-lock.yaml" ] && echo yes || echo no )"
rm -rf "$A/node_modules" "$A/apps/a/node_modules" "$A/packages/b/node_modules" "$A/apps/legacy/node_modules"
"$WRAP" --root "$A" frozen >"$B/A.frozen.log" 2>&1; echo "frozen exit=$?"; tail -3 "$B/A.frozen.log"
report "$A"

echo
echo "=== Case B: yaml with a NEGATED pattern (!apps/legacy) and an unrelated list key (publicHoistPattern) whose item is"
echo "    a directory path. pnpm excludes apps/legacy; a correct resolver of the packages: globs would not list"
echo "    apps/legacy or tools/x."
B2="$B/B"; mkws "$B2" $'packages:\n  - "apps/*"\n  - "packages/*"\n  - "!apps/legacy"\npublicHoistPattern:\n  - "tools/x"'
echo "  resolver members:"; resolver_members "$B2"
"$WRAP" --root "$B2" create >"$B/B.create.log" 2>&1; echo "create exit=$?"; grep -E "workspace projects|Done|ERR" "$B/B.create.log" | head -3
report "$B2"

echo
echo "=== Case C: fault injection - a cp that fails on the node_modules copy-back (PATH shim; frozen mode calls cp only there)"
Cc="$B/C"; mkws "$Cc" $'packages:\n  - "apps/*"\n  - "packages/*"'
"$WRAP" --root "$Cc" create >/dev/null 2>&1; echo "seed create exit=$?"
SHIM="$B/shim-cp"; mkdir -p "$SHIM"
cat > "$SHIM/cp" <<'EOF'
#!/bin/bash
for a in "$@"; do case "$a" in */node_modules) echo "shim-cp: injected ENOSPC-like failure for $a" >&2; exit 1;; esac; done
exec /bin/cp "$@"
EOF
chmod +x "$SHIM/cp"
PATH="$SHIM:$PATH" "$WRAP" --root "$Cc" frozen >"$B/C.log" 2>&1; rc=$?; grep -E "shim|install-sandbox" "$B/C.log"; echo "frozen with failing cp exit=$rc (expected non-zero)"

echo
echo "=== Case D: fault injection - an rm that fails on the destination node_modules"
SHIM2="$B/shim-rm"; mkdir -p "$SHIM2"
cat > "$SHIM2/rm" <<'EOF'
#!/bin/bash
for a in "$@"; do case "$a" in */node_modules) echo "shim-rm: injected failure for $a" >&2; exit 1;; esac; done
exec /bin/rm "$@"
EOF
chmod +x "$SHIM2/rm"
PATH="$SHIM2:$PATH" "$WRAP" --root "$Cc" frozen >"$B/D.log" 2>&1; rc=$?; grep -E "shim|install-sandbox" "$B/D.log"; echo "frozen with failing rm exit=$rc (expected non-zero)"

echo
echo "=== Case E (control): the same frozen install without a shim succeeds"
"$WRAP" --root "$Cc" frozen >"$B/E.log" 2>&1; echo "frozen exit=$?"
report "$Cc"
rm -rf "$B"
