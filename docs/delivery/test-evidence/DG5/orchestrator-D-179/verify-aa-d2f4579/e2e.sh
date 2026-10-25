S=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg5/verify-AA; P=26700
cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
pnpm -r build > $S/e2e-build.log 2>&1
for loc in unset cutf8; do
 if [ $loc = unset ]; then E="env -u LANG -u LC_ALL -u LC_CTYPE"; else E="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
 [ -f $S/e2e-$loc.rc ] && continue
 $E QA_PG_PORT=$((P+50)) E2E_API_PORT=$((P+51)) MTH_PORT_POOL=$((P+52))-$((P+90)) apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 > $S/e2e-$loc.log 2>&1; echo $? > $S/e2e-$loc.rc
done
touch $S/e2e.done
