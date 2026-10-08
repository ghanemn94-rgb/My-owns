#!/usr/bin/env bash
# T-DG3-KBE-H: `pnpm test` (both invocations: unit-node + unit-web, then unit-formula-nocodegen) on Node 24.21.0 and
# Node 22.22.2, each with the locale unset and with LANG=LC_ALL=C.UTF-8. Run in the working tree.
cd /home/user/wt/dg3-kbe-h
EV=docs/delivery/handbacks/DG3/T-DG3-KBE-H-evidence
for nodebin in /opt/nvm/versions/node/v24.21.0/bin /opt/node22/bin; do
  for loc in unset C.UTF-8; do
    v=$($nodebin/node -v); tag="unit-node${v%%.*}-${loc}"; tag=${tag/v/}
    find packages apps -path '*/.claude/.cc-writes' -type d -empty -delete 2>/dev/null
    if [ "$loc" = unset ]; then
      { echo "# pnpm test; node $v; LANG/LC_* unset; started $(date -u +%FT%TZ)"
        env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE PATH=$nodebin:$PATH pnpm test; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/$tag.log 2>&1
    else
      { echo "# pnpm test; node $v; LANG=LC_ALL=C.UTF-8; started $(date -u +%FT%TZ)"
        env LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH=$nodebin:$PATH pnpm test; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/$tag.log 2>&1
    fi
    echo "$tag: $(grep -E '^\s+Tests\s' $EV/$tag.log | tr -s ' ' | tr '\n' ';') $(tail -1 $EV/$tag.log)"
  done
done
