# Assignment T-DG6-BE-Z2B: continuation of T-DG6-BE-Z2 after a container restart (backend-workflow-engineer)


## Why

Run `DG6-T-DG6-BE-Z2-backend-workflow-engineer-20261104T004405Z-de1d011b` was killed by a container restart before it finished: its handback `docs/delivery/handbacks/DG6/T-DG6-BE-Z2-backend-workflow-engineer.md` still has `CHECKS_TABLE_PLACEHOLDER` (§5) and `REMAINS_PLACEHOLDER` (§8), and it is not known whether its logs ran on the final bytes. Its uncommitted changes are in your working tree.

## What to do

The assignment `docs/delivery/assignments/DG6/T-DG6-BE-Z2.md` stays binding (scope, write guard, ports 29000–29049, acceptance, evidence honesty). Do not redesign. In this order:

1. Read the partial handback and `git status`/`git diff`. Check that every item of the ARCH-14 brief §4.1–§4.3 and §5 is done; finish anything missing.
2. Re-run, on the current bytes, every acceptance check of T-DG6-BE-Z2 (validate DG5 historical, typecheck, build, lint, prettier, openapi:lint, `pnpm test` in both locales, every touched integration file, QA a17, the e2e specs that configure a connector, the email channel or webhooks). Write logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z2-evidence/` with a `z2b-` prefix; keep the earlier logs and say which ones the final table relies on.
3. Fill §5 (the checks table: command, exit, counts, log) and §8 (what remains), and add a note that the handback was completed by this continuation run, naming both run ids.

Leave all changes uncommitted.
