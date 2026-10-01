#!/usr/bin/env bash
# Acceptance tests for the sandboxed dependency installer (REQ-DLV-042, A18/A23/A24).
# Proves, under tools/deps/install-sandbox.sh, that:
#   AC-1  a write outside the target tree and the package store fails with a read-only filesystem error;
#   AC-2  a dependency lifecycle script NOT on the allow-list does not run, while an allow-listed one does;
#   AC-3  an install without a committed lockfile, or one that would change the lockfile, fails non-zero;
#   AC-4  a missing bubblewrap makes the wrapper exit non-zero (BLOCKED), never an unsandboxed install.
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

# ---- AC-1: write outside the target tree fails read-only ----------------------------------------------------------
out="$("$WRAP" run -- bash -c 'echo x > /etc/mth-ac1-probe 2>&1; echo rc=$?' 2>&1)"
if printf '%s' "$out" | grep -qiE "read-only file system" && printf '%s' "$out" | grep -q "rc=1"; then
  ok "AC-1 write to /etc is refused read-only under the sandbox"
else bad "AC-1 expected a read-only failure writing /etc; got: $out"; fi
# positive control: a write inside the target tree succeeds
if "$WRAP" run -- bash -c 'echo x > "'"$ROOT"'/.mth-ac1-inside" && rm -f "'"$ROOT"'/.mth-ac1-inside"' >/dev/null 2>&1; then
  ok "AC-1 (control) a write inside the target tree succeeds"
else bad "AC-1 (control) a write inside the target tree should succeed"; fi

# ---- AC-2: lifecycle scripts off unless allow-listed --------------------------------------------------------------
# A scratch project depending on a local package whose postinstall writes a marker into the project root.
mkdir -p "$WORK/ac2/fixture/"
cat > "$WORK/ac2/fixture/package.json" <<'JSON'
{ "name": "ac2-fixture", "version": "1.0.0",
  "scripts": { "postinstall": "node -e \"require('fs').writeFileSync(process.env.INIT_CWD + '/AC2_RAN','1')\"" } }
JSON
mk_ac2() { # $1 = onlyBuiltDependencies JSON array
  cat > "$WORK/ac2/package.json" <<JSON
{ "name": "ac2-root", "version": "1.0.0", "private": true,
  "dependencies": { "ac2-fixture": "file:./fixture" },
  "pnpm": { "onlyBuiltDependencies": $1 } }
JSON
  rm -f "$WORK/ac2/AC2_RAN"; rm -rf "$WORK/ac2/node_modules" "$WORK/ac2/pnpm-lock.yaml"
}
# not allow-listed -> the postinstall must NOT run
mk_ac2 "[]"
"$WRAP" --root "$WORK/ac2" create >/dev/null 2>&1
if [ ! -f "$WORK/ac2/AC2_RAN" ]; then ok "AC-2 a non-allow-listed dependency's postinstall did not run"
else bad "AC-2 a non-allow-listed postinstall ran (marker present)"; fi
# allow-listed -> the postinstall must run
mk_ac2 "[\"ac2-fixture\"]"
"$WRAP" --root "$WORK/ac2" create >/dev/null 2>&1
if [ -f "$WORK/ac2/AC2_RAN" ]; then ok "AC-2 an allow-listed dependency's postinstall did run"
else bad "AC-2 an allow-listed postinstall did not run (marker absent)"; fi

# ---- AC-3: lockfile enforcement ----------------------------------------------------------------------------------
mkdir -p "$WORK/ac3"
cat > "$WORK/ac3/package.json" <<'JSON'
{ "name": "ac3-root", "version": "1.0.0", "private": true }
JSON
rm -f "$WORK/ac3/pnpm-lock.yaml"
# no committed lockfile -> frozen must fail non-zero
if "$WRAP" --root "$WORK/ac3" frozen >/dev/null 2>&1; then bad "AC-3 frozen install without a lockfile should fail"
else ok "AC-3 frozen install without a committed lockfile fails non-zero"; fi
# create a lockfile, then make package.json diverge -> frozen must fail (would change the lockfile)
"$WRAP" --root "$WORK/ac3" create >/dev/null 2>&1
cat > "$WORK/ac3/package.json" <<'JSON'
{ "name": "ac3-root", "version": "1.0.0", "private": true, "dependencies": { "is-number": "7.0.0" } }
JSON
if "$WRAP" --root "$WORK/ac3" frozen >/dev/null 2>&1; then bad "AC-3 frozen install that would change the lockfile should fail"
else ok "AC-3 frozen install that would change the lockfile fails non-zero"; fi

# ---- AC-4: missing bubblewrap -> BLOCKED (exit 65), never an unsandboxed install ---------------------------------
NOBW="$WORK/nobwrap-bin"; mkdir -p "$NOBW"
for t in dirname bash env; do p="$(command -v "$t" 2>/dev/null)"; [ -n "$p" ] && ln -sf "$p" "$NOBW/$t"; done
PATH="$NOBW" bash "$WRAP" frozen >/dev/null 2>&1; rc=$?
if [ "$rc" = "65" ]; then ok "AC-4 a missing bubblewrap exits 65 (BLOCKED), never an unsandboxed install"
else bad "AC-4 expected exit 65 with bwrap absent; got $rc"; fi

echo "install-sandbox acceptance: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
