#!/usr/bin/env bash
# T-DG3-KBE-I acceptance check 2: `pnpm test` (two vitest invocations: unit-node + unit-web, then unit-formula-nocodegen)
# on Node 24.21.0 and Node 22.22.2, each with the locale unset and with LANG=C.UTF-8. Run in the working tree.
EV=docs/delivery/handbacks/DG3/T-DG3-KBE-I-evidence
find . -path ./node_modules -prune -o -path ./.git -prune -o -type d -name .cc-writes -empty -print -exec rmdir {} + 2>/dev/null
for nd in /opt/nvm/versions/node/v24.21.0/bin /opt/node22/bin; do
  for loc in unset C.UTF-8; do
    v=$(PATH=$nd:$PATH node -v); log="$EV/pnpm-test-node${v%%.*}-lang-${loc}.log"; log=${log/vv/v}
    { echo "# pnpm test; node $v; LANG=$loc; $(date -u +%FT%TZ)"
      if [ "$loc" = unset ]; then env -u LANG -u LC_ALL -u LANGUAGE PATH=$nd:$PATH pnpm test 2>&1; else env -u LC_ALL LANG=$loc PATH=$nd:$PATH pnpm test 2>&1; fi
      rc=$?; echo "# exit_status: $rc; $(date -u +%FT%TZ)"; } > "$log"
    echo "$(basename $log): exit $rc; $(grep -E '^ +Tests  ' "$log" | tr -s ' ' | paste -sd ';')"
  done
done
