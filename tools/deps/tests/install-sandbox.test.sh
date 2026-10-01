#!/usr/bin/env bash
# Acceptance tests for the sandboxed dependency installer (REQ-DLV-042, D-046, F-DG1-102/113/114; A18/A23/A24).
# Proves, under tools/deps/install-sandbox.sh, that:
#   AC-1  a write OUTSIDE the target tree fails read-only; and `create` still populates node_modules in the target tree;
#   AC-2  a dependency lifecycle script NOT on the allow-list does not run, while an allow-listed one does;
#   AC-3  an install without a committed lockfile, or one that would change the lockfile, fails non-zero;
#   AC-4  a missing bubblewrap makes the wrapper exit non-zero (BLOCKED), never an unsandboxed install;
#   AC-5  the repo's control paths (.git, tools/gates, …) are read-only inside the sandbox;
#   AC-6  the orchestrator's environment (secrets) does not cross into the sandbox; PATH is still set;
#   AC-7  the control-path ESCAPE is closed (F-DG1-113): renaming the writable parent of a protected subtree, appending
#         to the installer itself, and writing a delivery record are all refused, and the real repo is unchanged;
#   AC-8  agent-config surfaces that do not exist yet (CLAUDE.local.md, .mcp.json, nested CLAUDE.md, .vscode) cannot be
#         created inside the sandbox (F-DG1-114);
#   AC-9  a dependency build script that plants a dir named node_modules at a NON-member path is not copied back into
#         the target tree (F-DG1-118);
#   AC-10 the copy-back destinations are exactly pnpm's own workspace members: a `!`-excluded package pattern and a
#         non-`packages:` list-valued setting (publicHoistPattern) that name real directories with a package.json are
#         NOT members and never receive node_modules, while a real member (the root) still does (F-DG1-126).
# The negative cases (AC-2 not-allow-listed, AC-3 would-change, AC-9/AC-10 planted-but-not-copied) first assert their
# setup install SUCCEEDED (and, for AC-10, that the build script actually RAN), so they can never pass vacuously
# because the install failed or the attack never fired (F-DG1-111/F-DG1-206).
# Usage: tools/deps/tests/install-sandbox.test.sh   (exit 0 = all pass; non-zero = a failure)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WRAP="$ROOT/tools/deps/install-sandbox.sh"
PASS=0 FAIL=0
ok()   { echo "PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL  $1"; FAIL=$((FAIL+1)); }

command -v bwrap >/dev/null 2>&1 || { echo "BLOCKED: bubblewrap not installed; cannot run the install-sandbox acceptance tests"; exit 65; }
command -v pnpm  >/dev/null 2>&1 || { echo "BLOCKED: pnpm not on PATH"; exit 65; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-instest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- AC-1: a write OUTSIDE the target tree fails read-only; create populates node_modules in the target tree --------
out="$("$WRAP" run -- bash -c 'echo x > /etc/mth-ac1-probe 2>&1; echo rc=$?' 2>&1)"
if printf '%s' "$out" | grep -qiE "read-only file system" && printf '%s' "$out" | grep -q "rc=1"; then
  ok "AC-1 write to /etc is refused read-only under the sandbox"
else bad "AC-1 expected a read-only failure writing /etc; got: $out"; fi
mkdir -p "$WORK/ac1"
cat > "$WORK/ac1/package.json" <<'JSON'
{ "name": "ac1-root", "version": "1.0.0", "private": true, "dependencies": { "is-number": "7.0.0" } }
JSON
if "$WRAP" --root "$WORK/ac1" create >/dev/null 2>&1 && [ -d "$WORK/ac1/node_modules/is-number" ]; then
  ok "AC-1 (effect) create populates node_modules in the target tree"
else bad "AC-1 (effect) create did not populate node_modules in the target tree"; fi

# ---- AC-2: lifecycle scripts off unless allow-listed --------------------------------------------------------------
# A scratch project depending on a local package whose postinstall writes a marker UNDER node_modules (the only part of
# the workspace copied back from the sandbox), so the test can observe whether the script ran.
mkdir -p "$WORK/ac2/fixture/"
cat > "$WORK/ac2/fixture/package.json" <<'JSON'
{ "name": "ac2-fixture", "version": "1.0.0",
  "scripts": { "postinstall": "node -e \"require('fs').writeFileSync(process.env.INIT_CWD + '/node_modules/AC2_RAN','1')\"" } }
JSON
mk_ac2() { # $1 = onlyBuiltDependencies JSON array
  cat > "$WORK/ac2/package.json" <<JSON
{ "name": "ac2-root", "version": "1.0.0", "private": true,
  "dependencies": { "ac2-fixture": "file:./fixture" },
  "pnpm": { "onlyBuiltDependencies": $1 } }
JSON
  rm -f "$WORK/ac2/node_modules/AC2_RAN"; rm -rf "$WORK/ac2/node_modules" "$WORK/ac2/pnpm-lock.yaml"
}
# not allow-listed -> the postinstall must NOT run (but the install itself MUST succeed, else the case is vacuous)
mk_ac2 "[]"
if "$WRAP" --root "$WORK/ac2" create >/dev/null 2>&1; then
  if [ ! -f "$WORK/ac2/node_modules/AC2_RAN" ]; then ok "AC-2 a non-allow-listed dependency's postinstall did not run"
  else bad "AC-2 a non-allow-listed postinstall ran (marker present)"; fi
else bad "AC-2 (setup) the non-allow-listed install failed, so the negative case would be vacuous"; fi
# allow-listed -> the postinstall must run
mk_ac2 "[\"ac2-fixture\"]"
if "$WRAP" --root "$WORK/ac2" create >/dev/null 2>&1; then
  if [ -f "$WORK/ac2/node_modules/AC2_RAN" ]; then ok "AC-2 an allow-listed dependency's postinstall did run"
  else bad "AC-2 an allow-listed postinstall did not run (marker absent)"; fi
else bad "AC-2 (setup) the allow-listed install itself failed"; fi

# ---- AC-3: lockfile enforcement ----------------------------------------------------------------------------------
mkdir -p "$WORK/ac3"
cat > "$WORK/ac3/package.json" <<'JSON'
{ "name": "ac3-root", "version": "1.0.0", "private": true }
JSON
rm -f "$WORK/ac3/pnpm-lock.yaml"
# no committed lockfile -> frozen must fail non-zero
if "$WRAP" --root "$WORK/ac3" frozen >/dev/null 2>&1; then bad "AC-3 frozen install without a lockfile should fail"
else ok "AC-3 frozen install without a committed lockfile fails non-zero"; fi
# create a lockfile (MUST succeed, else the would-change case is vacuous), then diverge package.json -> frozen must fail
if "$WRAP" --root "$WORK/ac3" create >/dev/null 2>&1 && [ -f "$WORK/ac3/pnpm-lock.yaml" ]; then
  cat > "$WORK/ac3/package.json" <<'JSON'
{ "name": "ac3-root", "version": "1.0.0", "private": true, "dependencies": { "is-number": "7.0.0" } }
JSON
  if "$WRAP" --root "$WORK/ac3" frozen >/dev/null 2>&1; then bad "AC-3 frozen install that would change the lockfile should fail"
  else ok "AC-3 frozen install that would change the lockfile fails non-zero"; fi
else bad "AC-3 (setup) seeding a lockfile via create failed, so the would-change case would be vacuous"; fi

# ---- AC-4: missing bubblewrap -> BLOCKED (exit 65), never an unsandboxed install ---------------------------------
NOBW="$WORK/nobwrap-bin"; mkdir -p "$NOBW"
for t in dirname bash env; do p="$(command -v "$t" 2>/dev/null)"; [ -n "$p" ] && ln -sf "$p" "$NOBW/$t"; done
PATH="$NOBW" bash "$WRAP" frozen >/dev/null 2>&1; rc=$?
if [ "$rc" = "65" ]; then ok "AC-4 a missing bubblewrap exits 65 (BLOCKED), never an unsandboxed install"
else bad "AC-4 expected exit 65 with bwrap absent; got $rc"; fi

# ---- AC-5: control paths inside the real repo are read-only (F-DG1-102) ------------------------------------------
ctrl_ro=1
for probe in ".git/mth-ac5-probe" "tools/gates/mth-ac5-probe"; do
  out="$("$WRAP" run -- bash -c 'echo x > "'"$ROOT/$probe"'" 2>&1; echo rc=$?' 2>&1)"
  rm -f "$ROOT/$probe" 2>/dev/null
  printf '%s' "$out" | grep -qiE "read-only file system" && printf '%s' "$out" | grep -q "rc=1" || { ctrl_ro=0; echo "    ($probe writable: $out)"; }
done
if [ "$ctrl_ro" = 1 ]; then ok "AC-5 control paths (.git, tools/gates) are read-only inside the sandbox"
else bad "AC-5 a control path was writable inside the sandbox"; fi

# ---- AC-6: the orchestrator's environment (secrets) does not cross in; PATH stays set (F-DG1-102) -----------------
leak="$(MTH_FAKE_SECRET="leak-probe-$$" "$WRAP" run -- bash -c 'printf "%s" "${MTH_FAKE_SECRET:-<unset>}"' 2>&1)"
if [ "$leak" = "<unset>" ]; then ok "AC-6 a host environment variable (secret) does not cross into the sandbox"
else bad "AC-6 host env leaked into the sandbox: MTH_FAKE_SECRET=$leak"; fi
havepath="$("$WRAP" run -- bash -c 'case "${PATH:-}" in */*) echo yes;; *) echo no;; esac' 2>&1)"
if [ "$havepath" = "yes" ]; then ok "AC-6 (control) PATH is set inside the sandbox (install is usable)"
else bad "AC-6 (control) PATH missing inside the sandbox: $havepath"; fi

# ---- AC-7: the control-path ESCAPE is closed (F-DG1-113); the real repo is unchanged -----------------------------
before="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l)"
esc="$("$WRAP" run -- bash -c '
  w(){ if ( eval "$2" ) 2>/dev/null; then echo "WRITABLE $1"; else echo "refused $1"; fi; }
  w rename-parent "mv tools tools.mth-ac7"
  w installer-append "echo x >> tools/deps/install-sandbox.sh"
  w delivery-record "echo x > docs/delivery/mth-ac7-probe"
' 2>&1)"
# clean up anything that unexpectedly leaked (defence in depth; none should)
[ -d "$ROOT/tools.mth-ac7" ] && mv "$ROOT/tools.mth-ac7" "$ROOT/tools" 2>/dev/null
rm -f "$ROOT/docs/delivery/mth-ac7-probe" 2>/dev/null
after="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l)"
if ! printf '%s' "$esc" | grep -q "WRITABLE" && [ "$before" = "$after" ]; then
  ok "AC-7 control-path escape (parent-rename, installer append, delivery write) is refused; real repo unchanged"
else bad "AC-7 an escape succeeded or the real repo changed: $esc (before=$before after=$after)"; fi

# ---- AC-8: agent-config surfaces that do not yet exist cannot be created (F-DG1-114) -----------------------------
# NON-DESTRUCTIVE (F-DG1-122): a developer may legitimately have .vscode/ or CLAUDE.local.md etc. in their working
# tree. Snapshot which probe paths pre-exist, and only ever remove a path the probe NEWLY created (there should be
# none — the repo is read-only); never delete a pre-existing developer file.
AC8_PATHS=(CLAUDE.local.md .mcp.json apps/api/CLAUDE.md .vscode/tasks.json)
ac8_pre=""
for p in "${AC8_PATHS[@]}"; do [ -e "$ROOT/$p" ] && ac8_pre="$ac8_pre|$p|"; done
cfg="$("$WRAP" run -- bash -c '
  w(){ if ( eval "$2" ) 2>/dev/null; then echo "WRITABLE $1"; else echo "refused $1"; fi; }
  w CLAUDE.local.md "echo x > CLAUDE.local.md"
  w .mcp.json "echo x > .mcp.json"
  w nested-CLAUDE.md "echo x > apps/api/CLAUDE.md"
  w .vscode "mkdir -p .vscode && echo x > .vscode/tasks.json"
' 2>&1)"
ac8_created=0
for p in "${AC8_PATHS[@]}"; do
  if [ -e "$ROOT/$p" ] && [ "${ac8_pre#*"|$p|"}" = "$ac8_pre" ]; then ac8_created=1; rm -rf "$ROOT/$p" 2>/dev/null; fi
done
if ! printf '%s' "$cfg" | grep -q "WRITABLE" && [ "$ac8_created" = 0 ]; then
  ok "AC-8 agent-config surfaces (CLAUDE.local.md, .mcp.json, nested CLAUDE.md, .vscode) cannot be created"
else bad "AC-8 an agent-config surface was creatable or newly created (writable=$(printf '%s' "$cfg" | grep -c WRITABLE), created=$ac8_created)"; fi

# ---- AC-9: copy-back only touches real workspace-member node_modules (F-DG1-118) -------------------------------
# An allow-listed build script that plants a dir named node_modules at a NON-member path (a control-path-like subdir)
# must NOT be copied back into the target tree.
mkdir -p "$WORK/ac9/fixture"
cat > "$WORK/ac9/fixture/package.json" <<'JSON'
{ "name": "ac9-fixture", "version": "1.0.0",
  "scripts": { "postinstall": "node -e \"const fs=require('fs');const d=process.env.INIT_CWD+'/evil-ctrl/node_modules';fs.mkdirSync(d,{recursive:true});fs.writeFileSync(d+'/PWNED','1')\"" } }
JSON
cat > "$WORK/ac9/package.json" <<'JSON'
{ "name": "ac9-root", "version": "1.0.0", "private": true,
  "dependencies": { "ac9-fixture": "file:./fixture" },
  "pnpm": { "onlyBuiltDependencies": ["ac9-fixture"] } }
JSON
rm -rf "$WORK/ac9/node_modules" "$WORK/ac9/pnpm-lock.yaml" "$WORK/ac9/evil-ctrl"
if "$WRAP" --root "$WORK/ac9" create >/dev/null 2>&1; then
  if [ ! -e "$WORK/ac9/evil-ctrl" ]; then ok "AC-9 a planted non-member node_modules (evil-ctrl/node_modules) is not copied back"
  else bad "AC-9 a planted non-member node_modules was copied into the target tree ($WORK/ac9/evil-ctrl present)"; fi
else bad "AC-9 (setup) the allow-listed install failed, so the case would be vacuous"; fi

# ---- AC-10: copy-back members are pnpm's OWN resolution; '!' exclusions and non-`packages:` list keys are NOT members
# (F-DG1-126) -------------------------------------------------------------------------------------------------------
# A workspace whose pnpm-workspace.yaml has a negated package pattern (!packages/legacy) AND an unrelated list-valued
# setting (publicHoistPattern) naming a real directory with a package.json (tools/x). An allow-listed build script
# plants node_modules/AC10_RAN at the ROOT (a real member, so it MUST be copied back — proving the script ran) and
# node_modules/PWNED at both packages/legacy (excluded) and tools/x (not a `packages:` member), neither of which may be
# copied back.
mkdir -p "$WORK/ac10/fixture" "$WORK/ac10/packages/real" "$WORK/ac10/packages/legacy" "$WORK/ac10/tools/x"
cat > "$WORK/ac10/pnpm-workspace.yaml" <<'YAML'
packages:
  - "packages/*"
  - "!packages/legacy"
publicHoistPattern:
  - "tools/x"
YAML
cat > "$WORK/ac10/fixture/package.json" <<'JSON'
{ "name": "ac10-fixture", "version": "1.0.0",
  "scripts": { "postinstall": "node -e \"const fs=require('fs');const r=process.env.INIT_CWD;fs.mkdirSync(r+'/node_modules',{recursive:true});fs.writeFileSync(r+'/node_modules/AC10_RAN','1');for(const d of ['packages/legacy','tools/x']){const p=r+'/'+d+'/node_modules';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'/PWNED','1')}\"" } }
JSON
cat > "$WORK/ac10/packages/real/package.json" <<'JSON'
{ "name": "ac10-real", "version": "1.0.0", "private": true }
JSON
cat > "$WORK/ac10/packages/legacy/package.json" <<'JSON'
{ "name": "ac10-legacy", "version": "1.0.0", "private": true }
JSON
cat > "$WORK/ac10/tools/x/package.json" <<'JSON'
{ "name": "ac10-toolsx", "version": "1.0.0", "private": true }
JSON
cat > "$WORK/ac10/package.json" <<'JSON'
{ "name": "ac10-root", "version": "1.0.0", "private": true,
  "dependencies": { "ac10-fixture": "file:./fixture" },
  "pnpm": { "onlyBuiltDependencies": ["ac10-fixture"] } }
JSON
rm -rf "$WORK/ac10/node_modules" "$WORK/ac10/pnpm-lock.yaml"
if "$WRAP" --root "$WORK/ac10" create >/dev/null 2>&1; then
  if [ -f "$WORK/ac10/node_modules/AC10_RAN" ]; then
    if [ ! -e "$WORK/ac10/packages/legacy/node_modules" ] && [ ! -e "$WORK/ac10/tools/x/node_modules" ]; then
      ok "AC-10 a '!'-excluded package and a non-\`packages:\` list entry are not copy-back destinations"
    else bad "AC-10 a non-member directory received node_modules (legacy=$([ -e "$WORK/ac10/packages/legacy/node_modules" ] && echo yes || echo no), toolsx=$([ -e "$WORK/ac10/tools/x/node_modules" ] && echo yes || echo no))"; fi
  else bad "AC-10 (setup) the allow-listed build script did not run (root AC10_RAN absent), so the case would be vacuous"; fi
else bad "AC-10 (setup) the allow-listed workspace install failed, so the case would be vacuous"; fi

echo "install-sandbox acceptance: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
