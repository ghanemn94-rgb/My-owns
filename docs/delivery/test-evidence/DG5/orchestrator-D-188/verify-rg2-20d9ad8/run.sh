S=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg5/verify-RG2; cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
step(){ n=$1; shift; [ -f $S/$n.rc ] && return; "$@" > $S/$n.log 2>&1; echo $? > $S/$n.rc; }
step hist node tools/gates/validate.mjs --historical --stage DG4
step install pnpm install --frozen-lockfile --offline
step typecheck pnpm -r typecheck
step build pnpm -r build
step lint pnpm lint
step format pnpm format:check
step openapi pnpm openapi:lint
step contrast pnpm --filter @mth/design-tokens run check:contrast
step unit-unset env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
step unit-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
step integration env QA_PG_PORT=26700 MTH_PORT_POOL=26701-26740 tests/qa/support/with-pg.sh pnpm test:integration
step e2e-unset env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=26750 E2E_API_PORT=26751 MTH_PORT_POOL=26752-26790 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
step e2e-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 QA_PG_PORT=26750 E2E_API_PORT=26751 MTH_PORT_POOL=26752-26790 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
step root bash -c 'QA_PG_PORT=26760 E2E_API_PORT=26761 MTH_PORT_POOL=26762-26790 apps/web/e2e/support/with-stack.sh npx playwright test $(ls e2e/*.spec.ts | grep -v /a02-) --workers=1'
step demo bash -c 'QA_PG_PORT=26800 E2E_API_PORT=26801 MTH_PORT_POOL=26802-26830 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-*.spec.ts --workers=1'
touch $S/done
