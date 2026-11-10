R=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/tests/round-12/run.sh
$R 01-typecheck 24 unset -- pnpm -r typecheck
$R 01-lint 24 unset -- pnpm lint
$R 01-openapi 24 unset -- pnpm openapi:lint
$R 01-nocdn 24 unset -- pnpm check:no-cdn
$R 01-format 24 unset -- pnpm format:check
$R 01-contrast 24 unset -- pnpm --filter @mth/design-tokens run check:contrast
$R 02-unit-node24-unset 24 unset -- pnpm test
$R 02-unit-node24-C.UTF-8 24 C.UTF-8 -- pnpm test
$R 02-unit-node22-unset 22 unset -- pnpm test
$R 02-unit-node22-C.UTF-8 22 C.UTF-8 -- pnpm test
