# Assignment T-DG6-FE-Z1B: continuation of T-DG6-FE-Z1 after a container restart (frontend-ux-engineer)

## Why

Run `DG6-T-DG6-FE-Z1-frontend-ux-engineer-*` (see `docs/delivery/runs/DG6/`) was killed by a container restart before it wrote its handback. Its uncommitted spec changes and its logs (`docs/delivery/handbacks/DG6/T-DG6-FE-Z1-evidence/`, including `run1-*`) are in your working tree. It is not known whether those logs ran on the final bytes.

## What to do

The assignment `docs/delivery/assignments/DG6/T-DG6-FE-Z1.md` stays binding (scope, write guard, ports 29100–29149, acceptance, evidence honesty). In this order:

1. Read `git status`/`git diff` and the existing logs. Check every item of T-DG6-FE-Z1 is done (the full sweep, the three named tests, a measurement comment for every budget); finish anything missing, without changing any assertion or wait other than the budget.
2. Re-run on the current bytes every acceptance check of T-DG6-FE-Z1, including the full product e2e in both locale settings under load. Write new logs with a `z1b-` prefix; keep the earlier ones and say which ones the final table relies on.
3. Write the handback `docs/delivery/handbacks/DG6/T-DG6-FE-Z1-frontend-ux-engineer.md` as T-DG6-FE-Z1 requires, naming both run ids.

Leave all changes uncommitted.
