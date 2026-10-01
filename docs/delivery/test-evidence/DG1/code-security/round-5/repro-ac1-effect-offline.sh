#!/usr/bin/env bash
# AC-1 (effect) offline equivalent (code-security-reviewer, DG1 round 5). The suite's AC-1 effect case installs
# is-number@7.0.0 and needs registry metadata; the reviewer sandbox has no network. Same property, unchanged wrapper:
# a scratch root depending on picocolors@1.1.1 (integrity from the candidate pnpm-lock.yaml), a fixture lockfile and an
# .npmrc `offline=true`, so pnpm resolves from the (private copy of the) store.
# Usage: repro-ac1-effect-offline.sh <candidate clone>
set -uo pipefail
C="$1"; WRAP="$C/tools/deps/install-sandbox.sh"
D="$(mktemp -d "$TMPDIR/ac1off.XXXXXX")"
printf 'offline=true\n' > "$D/.npmrc"
echo '{ "name": "ac1-root", "version": "1.0.0", "private": true, "dependencies": { "picocolors": "1.1.1" } }' > "$D/package.json"
cat > "$D/pnpm-lock.yaml" <<'YAML'
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      picocolors:
        specifier: 1.1.1
        version: 1.1.1

packages:

  picocolors@1.1.1:
    resolution: {integrity: sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==}

snapshots:

  picocolors@1.1.1: {}
YAML
"$WRAP" --root "$D" create; echo "create exit=$?"
if [ -f "$D/node_modules/picocolors/package.json" ]; then echo "AC-1 (effect, offline equivalent) PASS: create populated $D/node_modules/picocolors"
else echo "AC-1 (effect, offline equivalent) FAIL: node_modules/picocolors absent"; fi
rm -rf "$D/node_modules"
"$WRAP" --root "$D" frozen; echo "frozen exit=$?"
if [ -f "$D/node_modules/picocolors/package.json" ]; then echo "frozen populated node_modules/picocolors: yes"; else echo "frozen populated node_modules/picocolors: NO"; fi
rm -rf "$D"
