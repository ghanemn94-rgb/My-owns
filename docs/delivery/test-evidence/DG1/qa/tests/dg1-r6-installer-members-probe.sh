#!/usr/bin/env bash
# QA round-6 independent probe for F-DG1-126 (qa-verifier, T-DG1-REV-QA-R6). Not part of the candidate.
# Run from a DISPOSABLE clone root:  npm_config_store_dir=<writable store> bash <this file>
# Scratch workspaces only (under $TMPDIR); offline (local file: fixtures, no registry).
#   Q1  a NON-ROOT member with its own dependency receives node_modules (copy-back to a member, not only the root);
#       a '!'-excluded package and a publicHoistPattern entry do not, even though a build script planted them.
#   Q2  a member whose directory name contains ']' and '"' (bracket-scanner robustness) still receives node_modules.
#   Q3  a nested glob (packages/**) member two levels deep receives node_modules.
#   Q4  a `packages:` pattern pointing OUTSIDE the root (../outside/*): the outside directory never receives
#       node_modules (either pnpm ignores it or the wrapper refuses it and fails the install).
set -uo pipefail
WRAP="$(pwd)/tools/deps/install-sandbox.sh"
W="$(mktemp -d "${TMPDIR:?}/qa-r6-members.XXXXXX")"
trap 'rm -rf "$W"' EXIT
P=0 F=0
ok()  { echo "PASS  $1"; P=$((P+1)); }
bad() { echo "FAIL  $1"; F=$((F+1)); }

mkfix() { # $1 dir, $2 name
  mkdir -p "$1"
  cat > "$1/package.json" <<JSON
{ "name": "$2", "version": "1.0.0" }
JSON
  echo "module.exports = '$2';" > "$1/index.js"
}

# ---- Q1 + Q2 + Q3 -------------------------------------------------------------------------------------------------
R="$W/ws"
mkdir -p "$R/fixture" "$R/packages/real" "$R/packages/legacy" "$R/tools/x" "$R/packages/we]ird\"name" "$R/packages/deep/inner"
mkfix "$R/dep" "qa-dep"
cat > "$R/pnpm-workspace.yaml" <<'YAML'
packages:
  - "packages/*"
  - "packages/deep/*"
  - "!packages/legacy"
publicHoistPattern:
  - "tools/x"
YAML
cat > "$R/fixture/package.json" <<'JSON'
{ "name": "qa-fixture", "version": "1.0.0",
  "scripts": { "postinstall": "node -e \"const fs=require('fs');let r=process.env.INIT_CWD;while(!fs.existsSync(r+'/pnpm-workspace.yaml'))r=require('path').dirname(r);fs.mkdirSync(r+'/node_modules',{recursive:true});fs.writeFileSync(r+'/node_modules/QA_RAN','1');for(const d of ['packages/legacy','tools/x']){const p=r+'/'+d+'/node_modules';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'/PWNED','1')}\"" } }
JSON
cat > "$R/package.json" <<'JSON'
{ "name": "qa-root", "version": "1.0.0", "private": true,
  "dependencies": { "qa-fixture": "file:./fixture" },
  "pnpm": { "onlyBuiltDependencies": ["qa-fixture"] } }
JSON
for d in "packages/real" "packages/we]ird\"name" "packages/deep/inner"; do
  n="qa-$(echo "$d" | tr -c 'a-z\n' '-')"
  cat > "$R/$d/package.json" <<JSON
{ "name": "$n", "version": "1.0.0", "private": true, "dependencies": { "qa-dep": "file:../../dep" } }
JSON
done
# deep/inner is one level further down
sed -i 's#file:../../dep#file:../../../dep#' "$R/packages/deep/inner/package.json"
echo '{ "name": "qa-legacy", "version": "1.0.0", "private": true }' > "$R/packages/legacy/package.json"
echo '{ "name": "qa-toolsx", "version": "1.0.0", "private": true }' > "$R/tools/x/package.json"
echo '{ "name": "qa-deep", "version": "1.0.0", "private": true }' > "$R/packages/deep/package.json"

echo "--- wrapper create on Q1-Q3 workspace"
( cd "$R" && pnpm -r ls --depth -1 --json 2>/dev/null | grep '"path"' | sed "s#$R#<ws>#" )
"$WRAP" --root "$R" create 2>&1 | tail -n 4
rc=${PIPESTATUS[0]}
echo "wrapper exit=$rc"
if [ "$rc" -eq 0 ] && [ -f "$R/node_modules/QA_RAN" ]; then
  [ -e "$R/packages/real/node_modules/qa-dep" ] && ok "Q1 non-root member packages/real received node_modules (qa-dep linked)" \
    || bad "Q1 non-root member packages/real has no node_modules/qa-dep"
  if [ ! -e "$R/packages/legacy/node_modules" ] && [ ! -e "$R/tools/x/node_modules" ]; then
    ok "Q1 '!'-excluded packages/legacy and publicHoistPattern tools/x received nothing (build script ran: root QA_RAN present)"
  else bad "Q1 non-member received node_modules (legacy=$([ -e "$R/packages/legacy/node_modules" ] && echo yes || echo no), toolsx=$([ -e "$R/tools/x/node_modules" ] && echo yes || echo no))"; fi
  [ -e "$R/packages/we]ird\"name/node_modules/qa-dep" ] && ok "Q2 member with ']' and '\"' in its name received node_modules" \
    || bad "Q2 member with ']' and '\"' in its name has no node_modules/qa-dep"
  [ -e "$R/packages/deep/inner/node_modules/qa-dep" ] && ok "Q3 nested member packages/deep/inner received node_modules" \
    || bad "Q3 nested member packages/deep/inner has no node_modules/qa-dep"
else
  bad "Q1-Q3 (setup) install failed or build script did not run (exit=$rc), cases would be vacuous"
fi

# ---- Q4: a packages: pattern outside the root ---------------------------------------------------------------------
O="$W/outside"; R4="$W/ws4"
mkdir -p "$O/pkg" "$R4/fixture"
echo '{ "name": "qa-outside", "version": "1.0.0", "private": true, "dependencies": { "qa-dep4": "file:../dep4" } }' > "$O/pkg/package.json"
mkfix "$O/dep4" "qa-dep4"
cat > "$R4/pnpm-workspace.yaml" <<'YAML'
packages:
  - "../outside/*"
YAML
echo '{ "name": "qa-root4", "version": "1.0.0", "private": true }' > "$R4/package.json"
echo "--- pnpm's own view of the ws4 members"
( cd "$R4" && pnpm -r ls --depth -1 --json 2>&1 | grep '"path"' | sed "s#$W#<scratch>#" )
echo "--- wrapper create on ws4"
"$WRAP" --root "$R4" create 2>&1 | sed "s#$W#<scratch>#" | tail -n 6
rc=${PIPESTATUS[0]}
echo "wrapper exit=$rc"
if [ ! -e "$O/pkg/node_modules" ]; then
  ok "Q4 the out-of-root directory received no node_modules (wrapper exit=$rc)"
else bad "Q4 the out-of-root directory ../outside/pkg received node_modules (wrapper exit=$rc)"; fi

echo "qa r6 installer member probe: $P passed, $F failed"
[ "$F" -eq 0 ]
