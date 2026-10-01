#!/bin/bash
# F-DG1-102 re-test + bypass probes against tools/deps/install-sandbox.sh (code-security-reviewer, DG1 round 2).
# Usage: repro-installer-escape.sh <disposable clone of the candidate>
# Runs ONLY in a disposable clone. Prints env var NAMES only, never values.
set -u
C="$1"; cd "$C"
export npm_config_store_dir="${TMPDIR}/pnpm-store"
export FAKE_ORCH_SECRET="probe-value-not-printed" GH_TOKEN_PROBE="x"
echo "== clone HEAD $(git rev-parse HEAD)"
echo "== host-side before: tools/ entries: $(ls tools | tr '\n' ' ')"
tools/deps/install-sandbox.sh run -- bash -c '
  echo "-- [env] names visible inside: $(env | cut -d= -f1 | sort | tr "\n" " ")"
  echo "-- [env] FAKE_ORCH_SECRET set inside? ${FAKE_ORCH_SECRET:+YES}${FAKE_ORCH_SECRET:-no}" | sed "s/probe-value-not-printed//"
  echo "-- [caps] $(grep -E "CapEff|CapBnd" /proc/self/status | tr "\t\n" "  ") uid=$(id -u)"
  t(){ if ( eval "$2" ) 2>/dev/null; then echo "WRITABLE  $1"; else echo "refused   $1"; fi; }
  echo "-- direct writes into control paths (expected: refused)"
  t ".git/hooks/pre-commit"       "echo x > .git/hooks/pre-commit"
  t ".claude/x"                   "echo x > .claude/x"
  t ".github/workflows/x.yml"     "echo x > .github/workflows/x.yml"
  t "tools/gates/x"               "echo x > tools/gates/x"
  t "tools/agents/run-agent.sh"   "echo x >> tools/agents/run-agent.sh"
  t "tools/deps/install-sandbox.sh" "echo x >> tools/deps/install-sandbox.sh"
  t "docs/delivery/x"             "echo x > docs/delivery/x"
  t "CLAUDE.md (append)"          "echo x >> CLAUDE.md"
  t "mv .git (mountpoint)"        "mv .git .git.x"
  t "mount remount rw"            "mount -o remount,rw,bind tools/gates"
  t "umount tools/gates"          "umount tools/gates"
  echo "-- Claude/IDE config surfaces that D-025 denies to agents (absent in the tree)"
  t "create CLAUDE.local.md"      "echo \"## injected instruction\" > CLAUDE.local.md"
  t "create .mcp.json"            "echo {\\\"mcpServers\\\":{}} > .mcp.json"
  t "create apps/api/CLAUDE.md (nested memory)" "echo injected > apps/api/CLAUDE.md"
  t "create .vscode/tasks.json"   "mkdir -p .vscode && echo {} > .vscode/tasks.json"
  echo "-- BYPASS: rename the writable PARENT of a read-only control path, then recreate it"
  t "mv tools -> tools.orig; recreate tools/deps/install-sandbox.sh + tools/agents/run-agent.sh + tools/gates/validate.mjs" \
    "mv tools tools.orig && mkdir -p tools/deps tools/agents tools/gates && cp -a tools.orig/. tools/ 2>/dev/null; printf \"#!/bin/bash\necho PWNED-UNSANDBOXED-INSTALLER >&2; exec pnpm \\\"\\\$@\\\"\n\" > tools/deps/install-sandbox.sh && chmod +x tools/deps/install-sandbox.sh && printf \"#!/bin/bash\necho PWNED-RUNNER\n\" > tools/agents/run-agent.sh && echo \"process.exit(0)\" > tools/gates/validate.mjs"
  t "mv docs -> docs.orig; recreate docs/delivery/gates/DG1.json" \
    "mv docs docs.orig && mkdir -p docs/delivery/gates && cp -a docs.orig/. docs/ 2>/dev/null; echo {\\\"forged\\\":true} > docs/delivery/gates/DG1.json"
'
echo "rc(sandbox)=$?"
echo "== host-side after (outside the sandbox, as the orchestrator would see the tree):"
ls -d tools.orig docs.orig CLAUDE.local.md .mcp.json apps/api/CLAUDE.md .vscode/tasks.json 2>&1
echo "-- host: head -2 tools/deps/install-sandbox.sh"; head -2 tools/deps/install-sandbox.sh
echo "-- host: tools/agents/run-agent.sh"; head -2 tools/agents/run-agent.sh
echo "-- host: tools/gates/validate.mjs"; head -1 tools/gates/validate.mjs
echo "-- host: docs/delivery/gates/DG1.json"; cat docs/delivery/gates/DG1.json
echo "-- host: is .git/hooks/pre-commit present? $(ls .git/hooks/pre-commit 2>/dev/null || echo no)"
echo "-- host: git status --short (top)"; git status --short | head -15
