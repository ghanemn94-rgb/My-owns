S=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg5/verify-AA
cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
R=$(ls e2e/*.spec.ts | grep -v '/a02-'); 
QA_PG_PORT=26760 E2E_API_PORT=26761 MTH_PORT_POOL=26762-26790 apps/web/e2e/support/with-stack.sh npx playwright test $R --workers=1 > $S/root.log 2>&1; echo $? > $S/root.rc
QA_PG_PORT=26800 E2E_API_PORT=26801 MTH_PORT_POOL=26802-26830 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-*.spec.ts --workers=1 > $S/demo.log 2>&1; echo $? > $S/demo.rc
touch $S/root.done
