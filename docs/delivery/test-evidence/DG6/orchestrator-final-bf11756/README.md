# DG6 orchestrator final verification V14 on bf11756

Source commit `bf11756db` (after BE-Z15), clean detached checkout. All 15 steps exit 0 (`summary.txt`).

- integration: 4354 passed, 1 skipped, 1 todo
- e2e: 556 passed with the locale unset and 556 with C.UTF-8
- root: 288 passed
- demo: 10 passed

A container restart during the root step stopped only the orchestrator's waiter; `run.sh` and its steps ran to completion.
