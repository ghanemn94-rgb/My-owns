# DG1 round 11: code-security-reviewer

- **Candidate:** `sha256:e5cc6ef982ba7d53ed80138c0cbaa0119bcfe8dcaad4e324b5dafdb6431afeb8` (391 files). Freeze commit `32e6478`. HEAD at start was `d8eb695` (metadata only).
- **Verdict: PASS.**

## Candidate identity
I recomputed the ID in the real repo and in a full disposable clone, at both commits. It matches everywhere. The source delta since the round-10 candidate is exactly 5 files:
- the two lint files;
- three web test-harness files.

decisions.md (D-055) is the only other candidate change. HEAD later advanced to `d58454c`, the domain reviewer's run auto-commit. I checked that commit by file names only, and the ID is unchanged.

## F-DG1-132 ≡ F-DG1-215: accepted as an observation
I re-proved the lint on Node 22.22.2 and Node 24.21.0 (`01-lint-probes.log`).

| Probe | Result on both runtimes |
|---|---|
| 16 spelled and computed `setEngine` forms | All flagged |
| Enumeration forms: E1–E4 as pinned, plus E5 (`import()` then enumerate) | All give 0 violations, as residual (a) documents |
| Positive controls: `randomUUID`/`createHash`, namespace import alone, `Map(Object.entries(obj)).get` | Clean |
| Real 13-module tree | 0 violations |
| `architecture.test.ts` | 109/109 |

The "every form" overclaim is corrected to "every SPELLED form", and the enumeration reach is named and pinned. That is what I asked for in round 10. Both findings are Low and non-mandatory. I accept them as observations, and the auditor must also accept them.

## New finding F-DG1-133 (Low, non-mandatory): residual (a) rationale is inaccurate
The header says two things that don't hold:
- `testkit.ts:63` calls the route "not closable statically".
- `:72-74` and `test.ts:533` say a namespace ban "would break" `identity/routes.ts:35` and `access/rules.ts:55`.

Both of those call sites enumerate plain objects (`request.cookies`, `PERMISSIONS`), not a module namespace. A scan of all 41 module files finds `node:crypto` used only through named imports. So a narrow rule would close E1–E5 without breaking any current code: named imports only from `node:crypto`, with namespace/default import, `import()` and `export *` flagged.

Accepting the route is a valid choice, but the text should call it a choice. This finding does not block the gate.

## F-DG1-214: harness only (QA owns the runtime closure)
- **Scope:** only `apps/web/test/jsdom-native-abort-environment.ts`, `vitest.config.ts` and `tsconfig.json` changed. No product file changed, and the harness is not in `apps/web/dist`.
- **Negative control:** with the built-in `jsdom` env on Node 24, unit-web fails 13 tests with "Expected signal … instance of AbortSignal". That is the round-10 defect.
- **With the fix:** unit-web passes 111/111 with my probe, on both Node 24 and Node 22. Request accepts the signal, abort propagates, and the jsdom document and window are present.
- **Product exposure:** product code passes signals only to `fetch`.

## Checks
| Check | Result |
|---|---|
| typecheck, build, lint, openapi:lint, no-cdn, format:check (Node 22) | All exit 0 |
| Unit tests | 302/302 on Node 22 and 302/302 on Node 24 |
| Integration, disposable PG16 | 200/200 twice on Node 22, plus 200/200 on Node 24 |
| gates/agents tests | 105/105 |
| deploy/scripts tests | 59/59 |
| install-sandbox acceptance | 13/13 registry-free cases pass |
| AC-1 (effect) and real-repo install | **BLOCKED**: no registry access (ECONNREFUSED via the proxy) |
| SBOM check | OK |
| DG0 historical | PASS |
| ci.yml copies | All 3 byte-identical |

All 8 assigned requirements are IMPLEMENTED with DG1 as their final gate, and every evidence file exists.

## Mistakes in my own probes (logged, not hidden)
- The first abort probe asserted `[native code]`. That premise was wrong: Node's AbortSignal is a JS class.
- The first lint-probe runs iterated `API_MODULES` as an array (it is an object) and used the relative paths that `moduleFiles` returns.
- The first AC-1 reproduction left out the fixture `package.json`.

All three are corrected and re-run, and the final outputs are in the logs.
