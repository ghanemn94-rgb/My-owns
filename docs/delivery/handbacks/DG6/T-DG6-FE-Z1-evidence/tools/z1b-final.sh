#!/usr/bin/env bash
# T-DG6-FE-Z1B: the static checks, the build and pnpm test (both locale settings) on the final bytes. Repository root.
set -u
E="$1"
run() { local log=$1; shift; { echo "\$ $* ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"; "$@"; echo "EXIT $? ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"; } > "$E/$log" 2>&1; }
run z1b-30-validate-historical-DG5.log node tools/gates/validate.mjs --historical --stage DG5
run z1b-31-typecheck.log pnpm -r typecheck
run z1b-32-lint.log pnpm lint
run z1b-33-prettier.log sh -c 'git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown'
run z1b-34-openapi-lint.log pnpm openapi:lint
run z1b-35-build.log pnpm -r build
run z1b-36-unit-unset.log env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test
run z1b-37-unit-cutf8.log env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
grep -H '^EXIT' "$E"/z1b-3*.log
