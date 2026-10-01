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
#         created inside the sandbox (F-DG1-114).
# The negative cases (AC-2 not-allow-listed, AC-3 would-change) first assert their setup install SUCCEEDED, so they can
# never pass vacuously because the install failed for an unrelated reason (F-DG1-111/F-DG1-206).
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
cfg="$("$WRAP" run -- bash -c '
  w(){ if ( eval "$2" ) 2>/dev/null; then echo "WRITABLE $1"; else echo "refused $1"; fi; }
  w CLAUDE.local.md "echo x > CLAUDE.local.md"
  w .mcp.json "echo x > .mcp.json"
  w nested-CLAUDE.md "echo x > apps/api/CLAUDE.md"
  w .vscode "mkdir -p .vscode && echo x > .vscode/tasks.json"
' 2>&1)"
for p in CLAUDE.local.md .mcp.json apps/api/CLAUDE.md .vscode; do rm -rf "$ROOT/$p" 2>/dev/null; done
if ! printf '%s' "$cfg" | grep -q "WRITABLE"; then
  ok "AC-8 agent-config surfaces (CLAUDE.local.md, .mcp.json, nested CLAUDE.md, .vscode) cannot be created"
else bad "AC-8 an agent-config surface was creatable: $cfg"; fi

echo "install-sandbox acceptance: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
