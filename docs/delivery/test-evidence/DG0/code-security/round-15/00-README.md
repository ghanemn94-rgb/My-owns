# DG0 round 15: code-security-reviewer evidence

Run `DG0-T-DG0-REV-SEC-R15-code-security-reviewer-20260928T232527Z-65015dd2` (session `65015dd2-5aa0-4fe8-a8ea-2f61e56bb126`).

Candidate `sha256:b7f60ed34dd77f93ca454edb545da1cee8e9cd7cdb649b5ad3895c454abddb5e`, commit `7fab49c5c6764721bbe2982aa621a34ea31cfdea`.

All code execution happened in disposable clones under this run's private `$TMPDIR` (`/var/tmp/mth-run.4aYowI/claude-0`):
- `dg0-sec` is the candidate;
- `dg0-old` is round-14 `1e64eb0`;
- `dg0-race` is a copy of the candidate used as the guarded repository in the offline race;
- `dg0-crlf` is an autocrlf checkout;
- `dg0-oldnewtests` is the old code with the new tests.

No other agent's files or scratch were read, scanned or targeted.

| File | What |
|---|---|
| 01-test-suites.log | `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` (76/76) and the Python unittest suite (17/17) in the candidate clone |
| 02-prefreeze.log | `tools/gates/prefreeze.sh DG0` in the fresh candidate clone: 11/11 PASS |
| repro-r15-f143-procroot.mjs, 03-f143-procroot.log | F-DG0-143 re-verification. On the old guard, the `/proc/<pid>/root` link is allowed and the write reaches the private tmpfs. On the candidate, that case and 5 further hostile variants (relative link, two-hop chain to `/proc/self/cwd`, `/dev/shm`, a loop, a dangling link) are blocked, and the benign cases are still allowed. |
| repro-r15-guard-toctou.mjs, 04-guard-toctou.log | **F-DG0-145**, offline. It drives the real hook entry point (`node guard-write.mjs <role>` with a JSON payload on stdin, as the CLI does) while a symlink in the attacker's scratch flips between a benign and a forbidden directory. 236 of 600 attempts wrote into a forbidden place after the hook said allow: another run's private TMPDIR, and protected `tools/gates/tests`. |
| 05-guard-toctou-live.log | **F-DG0-145**, live, with this session's real Claude Code Write tool and the candidate's guard. The static control was blocked. With a background flipper, attempt 9 of 11 passed the hook and landed in a repository directory outside my write scope. The probe directory was then removed. |
| 06-f144-sandbox-probe.log | F-DG0-144, shell side. `/tmp`, `/tmp/claude-0`, `/var/tmp` and `/var/tmp/mth-run.4aYowI` are read-only; only this run's `claude-0` is a rw mount. Other reviewers' evidence directories, reviews and runs are ro bind mounts (from `/proc/self/mountinfo`, no writes to them). |
| 08-f144-live-guard-writes.log | F-DG0-144, file-tool side, with the real Write tool. The shared `/tmp/claude-0`, `/var/tmp`, the qa evidence directory and the qa-verifier record are blocked; the own `MTH_RUN_TMP` is allowed. |
| 07-candidate-determinism.log | D-005: identical ID from `--ref`, from the clone under `LC_ALL=C` and `tr_TR`, and from an autocrlf checkout (80 CRLF files). The live repository gives a different working-tree ID only because of transient sandbox stub files (F-DG0-146, Low). |
| 09-new-tests-vs-old-code.log | The candidate's new F-DG0-143/144 tests fail on round-14 code: 4 Node tests fail, and 10 settings tests error because of the new stage argument. |
| 10-validator-modes.log | `validate.mjs` `--register`, `--pipeline`, `--reconcile`, `--stage DG0` (fails closed: no gate record yet) and a bad argument (exit 64) on the live repository |

## Why F-DG0-145 is High

The write guard is listed under "Mechanically prevented" in `threat-model.md`. Its symlink handling is check-then-use:
- the hook process resolves the path;
- the unsandboxed CLI writes afterwards;
- the agent's sandboxed shell can keep swapping a symlink in its own `$TMPDIR/claude-0` (or its own evidence directory, or any repository directory an implementer's shell can write).

Claude Code's own re-check ("parent-directory symlink resolution changed after permission was checked") narrows the window, but it doesn't close it: the live bypass succeeded in 1 of 11 attempts.

Undetected impact: writes into another concurrently running run's private `/var/tmp/mth-run.*`, which re-opens the F-DG0-144 threat for file tools. Detected impact: writes into protected repository paths, `.git/hooks`, `.git/config` and user Claude settings, which show up in git status or the runner's config scan (for implementer runs only as a warning).

## Housekeeping

The background flipper lived in its own PID namespace and stopped at its 15-minute cap. `$TMPDIR/live` was removed afterwards, and the runner removes the whole private TMPDIR at the end of the run.
