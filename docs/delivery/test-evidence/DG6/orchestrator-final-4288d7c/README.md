# DG6 orchestrator final verification V15 on 4288d7c

Source commit `4288d7c0b` (after FE-Z16), clean detached checkout. All 15 steps exit 0 (`summary.txt`).

- integration: 4354 passed, 1 skipped, 1 todo
- e2e: 556 passed with the locale unset and 556 with C.UTF-8
- root: 288 passed
- demo: 10 passed

A container restart interrupted the e2e-cutf8 step. Its partial log is kept as `e2e-cutf8.interrupted.log` (it wrote no `.rc`). `run.sh` was restarted unchanged: steps with an `.rc` file were skipped, and e2e-cutf8, root and demo ran in full from the start.
