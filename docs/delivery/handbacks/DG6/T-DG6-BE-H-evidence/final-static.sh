#!/usr/bin/env bash
cd /home/user/wt/dg6-be-h
E=docs/delivery/handbacks/DG6/T-DG6-BE-H-evidence
find . -path ./node_modules -prune -o -type d -name .cc-writes -empty -print | grep -v node_modules | xargs -r rmdir
run() { local name=$1; shift; { echo "\$ $*"; date -u; } > $E/$name.log; "$@" >> $E/$name.log 2>&1; local s=$?; { date -u; echo "EXIT=$s"; } >> $E/$name.log; }
run lint-final pnpm lint
run typecheck-final pnpm -r typecheck
run build-final pnpm -r build
{ echo '$ git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown'; date -u; git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown; s=$?; date -u; echo "EXIT=$s"; } > $E/prettier-final.log 2>&1
run openapi-lint-final pnpm openapi:lint
