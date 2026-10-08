#!/usr/bin/env bash
# T-DG3-KBE-I acceptance checks 1 and 4, run in the working tree on Node 24.21.0. Each log ends with its exit status.
EV=docs/delivery/handbacks/DG3/T-DG3-KBE-I-evidence
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
find . -path ./node_modules -prune -o -path ./.git -prune -o -type d -name .cc-writes -empty -print -exec rmdir {} + 2>/dev/null
c() { local name=$1; shift; { echo "# $*; node $(node -v); $(date -u +%FT%TZ)"; bash -c "$*" 2>&1; rc=$?; echo "# exit_status: $rc"; } > "$EV/$name.log"; echo "$name: $rc"; }
c typecheck "pnpm -r typecheck"
c build "pnpm -r build"
c lint "pnpm lint"
c prettier "git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown"
c eslint-formula "npx eslint packages/shared/src/formula/ packages/shared/src/value.ts"
c validate-historical-DG2 "node tools/gates/validate.mjs --historical --stage DG2"
