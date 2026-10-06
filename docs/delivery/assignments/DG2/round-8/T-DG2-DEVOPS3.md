# Assignment T-DG2-DEVOPS3: disposable-cluster harnesses start deterministically (devops-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Sequencing:** no other agent runs at the same time. backend-workflow-engineer T-DG2-BE13 runs **after** you and will use your harness changes.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`.
- **Do not edit:** product code under `apps/**/src` and `packages/**/src`, `docs/api/openapi.yaml`, migrations, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Finding to repair
**F-DG2-310 (Low, REQ-DLV-034).** The disposable-PostgreSQL harnesses use default ports that lie inside the Linux ephemeral range, and the per-run ports reviewers pass in do too. `ip_local_port_range` here is 32768-60999. The defaults are:
- `tests/qa/support/with-pg.sh`: 54351
- `apps/web/e2e/support/with-stack.sh`: 54331
- `e2e/support/qa-stack.sh`: 54361
- `e2e/clean-start/a18-clean-start.sh`: 54371
- `deploy/scripts/clean-start-local.sh`: 54340

A client socket left in TIME_WAIT on that ephemeral port makes postgres fail to bind (EADDRINUSE), even with SO_REUSEADDR. The run then fails closed with `BLOCKED: disposable PostgreSQL did not start` (exit 3). qa reproduced it twice in 12 runs, and the mechanism in isolation. The repro is in `docs/delivery/test-evidence/DG2/qa/round-7/11-port-collision-repro.py`. Each of the e2e harnesses also starts an API on a port, for example 3000 or `E2E_API_PORT`. Check whether that port has the same exposure.

## Required
1. **Deterministic start.** Every disposable-cluster harness must start reliably whatever the ephemeral-port state:
   - **Defaults outside the ephemeral range.** Choose default ports below 32768, distinct per harness, and document them.
   - **Retry on bind failure.** If postgres or the API fails to bind with EADDRINUSE, retry automatically on another free port from a range outside the ephemeral range, a bounded number of times, logging each retry. Do this whether the port came from the default or from the environment. Treat an explicitly requested port as the starting point, not a hard requirement, unless a `*_STRICT_PORT=1` flag is set. Any other failure still exits 3 with `BLOCKED: …`, never a silent pass.
   - The URLs the harness exports (`DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`, `APP_BASE_URL`/port, and so on) reflect the port actually used.
2. **Shared helper.** Use one shared shell helper where practical, for example `tests/qa/support/pg-port.sh` sourced by all harnesses, so the logic cannot drift between them. Keep each harness's existing environment variables working.
3. **Docs.** Update the harness headers and `docs/operations/clean-start.md` (or the QA/testing doc) with the port policy.
4. **Tests and evidence.**
   - Add a small automated check, a shell or node script under `tests/qa/support/` or `scripts/`, that reproduces the TIME_WAIT collision on a chosen port. Show that the harness still starts, by retrying, while the old harness fails. Run it as a negative control.
   - Run the full integration suite through `with-pg.sh` **6 times** (3 per locale setting: `env -u LANG -u LC_ALL` and `LANG=C.UTF-8`), plus the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar once per locale. Keep every run's full log.
   - Run `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0).
   - Run `pnpm lint` and `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-DEVOPS3-devops-engineer.md` with the policy, the files changed, the repro and negative-control results, and every check's real output. Keep evidence to logs only.
