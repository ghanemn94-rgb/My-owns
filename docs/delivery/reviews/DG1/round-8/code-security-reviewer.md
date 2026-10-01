# DG1 round 8 — code-security-reviewer

**Candidate:** `sha256:e27eaf5f…7544876`, freeze commit `11bc4c4` (HEAD `6cb3813` adds only metadata; the ID matches at both commits).
**Verdict: PASS.** One new Low, non-mandatory finding (F-DG1-129, proposed ID).

## F-DG1-128: CLOSED_VERIFIED
- The fix is in `architecture.testkit.ts`:
  - line 96: `"test"` is in `LOADER_BUILTINS`, giving both `test` and `node:test`;
  - line 122: `"execve"` is in `PROCESS_LOADERS`;
  - rule 3 applies `PROCESS_LOADERS` at line 336.
- Re-proved in a disposable clone (`01-lint-probes.log`):
  - R1 gives `imports package node:test`;
  - R2 gives `module loader via process.execve`;
  - these variants are also caught: `(process as any).execve`, `globalThis.process.execve`, `import {execve} from "node:process"` and bare `test`.
  - `node:test/reporters` stays allowed. That is correct: it only exports reporter streams and loads no files.
- `architecture.test.ts` passes 80/80, including R1/R2 and the P12/X6–X8/A1 guards. The real module tree has 0 violations.

## D-054 exhaustiveness: does not hold (F-DG1-129, Low)
I swept Node 22.22.2 independently (`04-node22-builtin-process-sweep.log`). Every built-in and every `process.*` member is either banned, a stated residual, or not a loader, with one exception.

**The open route.** Either `process.kill(process.pid, "SIGUSR1")` or `process._debugProcess(process.pid)` starts the V8 inspector on 127.0.0.1:9229. That is the same capability as the banned `node:inspector`. From there:
1. Global `fetch` reads `/json/list` to get the debugger URL.
2. Global `WebSocket` connects to it and sends `Runtime.evaluate`.
3. The evaluated code runs anything; the proof ran `child_process` and printed `uid=0` (`02-n1-runtime.log`).

**Lint result.** 0 violations for both plants (N1 and N2).

**Production exposure.** The image starts `node` without `--disable-sigusr1` (`deploy/docker/entrypoint.sh:30-31`), so the route also exists in the shipped runtime.

**Suggested fixes.**
- Add `kill`, `_kill`, `_debugProcess` and `_debugEnd` to `PROCESS_LOADERS`. No module uses them.
- And/or run the shipped processes with `--disable-sigusr1`. With that flag the inspector never listens (`03-n1-remedy-probe.log`).
- Or drop the word "exhaustive" from the header and D-054, and name this route as an accepted residual.

**Why Low.** As with F-DG1-125/127/128, this lint is static defence-in-depth over human-reviewed code, not a runtime boundary. The route needs a loopback socket and visibly logs "Debugger listening". No module uses it.

## Node version observation (BLOCKED, no separate finding)
The header calls 22.x "the pinned Node version". However, ADR-0001, the production image (`Dockerfile:24`, `node:24`), `.nvmrc` and the CI matrix all target **24**; 22.18 is only the floor. No Node 24 binary is available here, so I could not sweep 24 (check SEC-R8-03 is BLOCKED). The header should name both lines.

## Checks
| Check | Result |
|---|---|
| typecheck, build, lint, openapi (33 ops), no-cdn, format | all exit 0 |
| unit tests | 273/273 |
| integration on throwaway PostgreSQL 16.13, port 5491 | 200/200, twice |
| gates/agents tests | 105/105 |
| deploy tests | 59/59 |
| installer suite | 13/14; AC-1 (effect) and real-repo install BLOCKED (no registry); AC-2/3/9/10 pass offline with a private store copy |
| SBOM check | OK |
| DG0 historical | PASS |
| ci.yml copies | byte-identical |

All 8 assigned requirements are IMPLEMENTED, and every evidence path they cite exists.
