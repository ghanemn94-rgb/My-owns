# DG3 round 3: code-security-reviewer (re-run T-DG3-REV-SEC-R3B)

- **Candidate:** `sha256:f2b4c77a026c6825d323cdc89782d63410ec9ead05666e06d90a4d51988d1d1d` (757 files, source `ce988e20`).
- **Verdict:** FAIL. F-DG3-100 (Low, non-mandatory, REQ-PB-056) does not verify closed.
- **New findings:** none.
- **Critical, High or mandatory issues:** none.

Engineering review only. Nothing here grants or implies any G1–G6 business approval, and DG3 is not approved by this record.

## F-DG3-100: what the second repair achieves

| Layer | Result on this candidate |
|---|---|
| ESLint (two formula blocks) | Refuses all 18 round-1/2 forms (O1–O6, N1–N12). |
| Source scan (`fuzz.test.ts`) | Refuses all 18. |
| Run time (`unit-formula-nocodegen`, `--disallow-code-generation-from-strings`) | Refuses every code-from-string form (O1, O2, O4–O6, N1–N7) with `EvalError`, as 20 flag-only test failures each. vm, inspector and repl (O3, N9–N11) are outside the flag by design, as the ADR says. |

The run-time layer is **mechanically sound** (`runtime-layer-attack.log`):
- the flag is in every fork (8 distinct pids);
- a jsdom environment keeps it;
- `--pool=vmForks`, `threads` or `vmThreads`, or a per-project vmForks config, each make the canary fail;
- the preload re-enables nothing;
- `pnpm test` exits 1 without the flag;
- a non-matching file filter exits 1;
- a wildcard project fails safe;
- combining it with another project is refused;
- unit-node and unit-web do not inherit the flag.

The ADR's CSP claim is true on the emitted headers of the real built bundle (`sec-r3-csp.test.ts`), and its mechanics claims are true on Node 22 and 24.

## Why it is still open

ADR-0024 §6 makes two statements that do not hold. Each has a reproduction that passes **all three** layers.

1. **"Any engine path that generates code from a string fails the engine's tests, provided a test exercises it."**
   - `validateFormula` and `evaluateFormula` catch every error as `formula.syntax` (`reason: internal`, offset 0).
   - `fuzz.test.ts` and the offset-0 rows of `formula.test.ts` accept that code.
   - **S1:** code generation in `tokenize.ts` `describe()` for U+00C0–U+1FFF. **S3:** evaluation-time code generation when `m = '50'`.
   - Under the flag, the fuzz test's own seeded inputs hit these paths 2,805 times and 41 times. Every `EvalError` is swallowed, and all 190 tests pass (`exercised-probe.log`).
2. **"vm, inspector, getBuiltinModule … Layers 1–2 refuse those, through the import allowlist."**
   - The allowlist admits `../value.ts`, which no formula rule covers: no `no-eval`, `no-new-func` or import restriction applies, and the scan reads only `formula/`.
   - **V1:** `node:vm` imported in `value.ts` and called from `checkDecimal` passes lint, the scan and the run-time layer.

The shipped engine and `value.ts` contain no dynamic code. This is a guard and documentation gap, not an exploit.

Suggested direction (not prescriptive):
- make an `internal` engine problem fail the engine's tests;
- bring `../value.ts` under the engine-source rules and the scan, or remove it from the allowlist;
- correct §6 to match.

## Everything else (full re-review): PASS

| Area | Result |
|---|---|
| typecheck, build, lint, openapi (270 operations), no-cdn, format | All exit 0. |
| `pnpm test`, both invocations | Node 22: 1587 + 190. Node 24: 1587 + 190 on the re-run (see below). |
| Integration, twice | 793/793 each (SQL_ASCII and UTF8), 27 migrations, contract 270 live, every p3-pending list empty. |
| `validate --historical` | DG2 PASS, DG1 PASS. |
| Probes, both locale settings | A (AUD sweep) 66/66; B (SoD, G1 guard, cycle races, decimals, audit shape) 16/16; D (inherited approval) 5/5; C (formula fuzz and oracle) 65/65 in unit-node and 71/71 in unit-formula-nocodegen. |
| T-DG3-FE-G | An additive, opt-in `.status-chip--wrap`, used only by the badge. The base chip is unchanged. |
| KBE-E test infrastructure | Weakens nothing: 1565 → 1587 is one renamed test plus 22 new scan rows, and no test is lost. |

## Disclosures

- **The first Node 24 `pnpm test` failed (exit 1).**
  - The failing test is one DG2 unit-web test, `session-identity.test.tsx`, F-DG2-500 (ar). It was a `findByText` timeout while my own probes loaded the machine.
  - Because of the `&&`, the no-codegen invocation did not run.
  - The re-run passed. The KBE-E handback saw the same flake on Node 22.
- **My first two three-layer probe runs are invalid.**
  - `pkill -f` matched my own shell, so the first run was never stopped. It kept editing `evaluate.ts` in the clone the second run used.
  - Both logs are kept, labelled `-CONTAMINATED`, and not cited.
  - The clean run used a fresh clone.
- **I did not run the Playwright e2e suite.** It belongs to qa-verifier.
- **I formed this verdict before reading any other round-3 review.**
