#!/usr/bin/env bash
# qa-verifier DG7 round 3: secret scans of the candidate in a disposable shared clone ($TMPDIR/ss, full checkout of the
# source commit, no install needed), then the new history allow-list entry judged: the history scan again with ONLY
# that entry removed from a disposable copy of tools/release/secret-allowlist.json must report exactly one S2 hit at
# docs/delivery/handbacks/DG7/T-DG7-SA-ADR72-evidence/06-secret-scan-added-lines.log with value sha256 be9da0855ec3…
set -u
. "$(dirname "$0")/env.sh"
D="$TMPDIR/ss"; rm -rf "$D"
git clone -q --shared --no-checkout /home/user/My-owns "$D" && git -C "$D" sparse-checkout set --no-cone '/*' '!/trading_agent/' && git -C "$D" checkout -q $COMMIT || exit 2
cd "$D"; echo "clone HEAD $(git rev-parse HEAD)"
echo "## payload"; node tools/release/secret-scan.mjs --scope payload 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
echo "## history (as shipped)"; node tools/release/secret-scan.mjs --scope history 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
echo "## the new entry"; node -e 'const a=JSON.parse(require("fs").readFileSync("tools/release/secret-allowlist.json"));const e=a.entries||a.allow||Object.values(a).find(Array.isArray);const x=e.filter(z=>z.path&&z.path.includes("SA-ADR72"));console.log(JSON.stringify(x,null,1))'
node -e 'const f="tools/release/secret-allowlist.json",fs=require("fs");const a=JSON.parse(fs.readFileSync(f));for(const k of Object.keys(a))if(Array.isArray(a[k]))a[k]=a[k].filter(z=>!(z.path&&z.path.includes("SA-ADR72")));fs.writeFileSync(f,JSON.stringify(a,null,2)+"\n")'
echo "## history with only that entry removed (expected: exactly that one S2 hit)"; node tools/release/secret-scan.mjs --scope history 2>&1 | tail -4 | sed 's#'"$D"'#<clone>#g'; echo "exit=${PIPESTATUS[0]}"
git checkout -q -- tools/release/secret-allowlist.json
echo "## the quoted line in the scan log (masked by the scanner that wrote it)"; grep -n 'postgres://mth_app' docs/delivery/handbacks/DG7/T-DG7-SA-ADR72-evidence/06-secret-scan-added-lines.log | cut -c1-220
echo "## is the file in the payload scope? (payload exit above was 0 with the entry scoped history-only)"
cd /; rm -rf "$D"; echo "clone removed"
