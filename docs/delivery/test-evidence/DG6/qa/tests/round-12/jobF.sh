cd /home/user/My-owns
R=docs/delivery/test-evidence/DG6/qa/tests/round-12/run.sh
E=docs/delivery/test-evidence/DG6/qa/round-12
until grep -q "^exit=" $E/02-unit-node22-C.UTF-8.log 2>/dev/null; do sleep 20; done
$R 02b-unit-node-rerun-node24-C.UTF-8 24 C.UTF-8 -- 'echo "rerun of the unit-node project after the Vitest RPC timeout (onTaskUpdate) in 02-unit-node24-C.UTF-8"; npx vitest run --configLoader runner --project unit-node'
$R 02b-unit-node-rerun-node22-unset 22 unset -- 'echo "rerun of the unit-node project after the Vitest RPC timeout (onTaskUpdate) in 02-unit-node22-unset"; npx vitest run --configLoader runner --project unit-node'
grep -q "onTaskUpdate\|Unhandled Error" $E/02-unit-node22-C.UTF-8.log && $R 02b-unit-node-rerun-node22-C.UTF-8 22 C.UTF-8 -- 'echo "rerun of the unit-node project after an unhandled error in 02-unit-node22-C.UTF-8"; npx vitest run --configLoader runner --project unit-node'
true
