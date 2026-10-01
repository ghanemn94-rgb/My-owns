# DG1 round 16: code-security-reviewer narrative

- **Candidate:** `sha256:56f3eb885c6cf3db406e280d232e48ebcefddad173107a744bb9b8ca74fc2b4c` (base `13418b8`, freeze `aa7d9a8`; 391 files). The ID was recomputed in the real repo and in a full disposable clone.
- **Run:** `DG1-T-DG1-REV-SEC-R16-code-security-reviewer-20261001T181001Z-8a789466`
- **Verdict:** **PASS**

## Scope of change
`git diff f27b5a6f..13418b8d` over the source paths touches two files, both test-only. There is no product, runtime, API, data-model, config or i18n change.
- `apps/api/src/architecture.testkit.ts` (+22/-8)
- `apps/api/src/architecture.test.ts` (+53)

## Fix review (F-DG1-137 / F-DG1-218)
**The change in `architecture.testkit.ts`:**
- `:452` `isDeclarationFileName()` reads the public `SourceFile.isDeclarationFile` from an empty in-memory parse. The parser derives that flag from the file name only: there is no I/O and no evaluation.
- `:492` `syntaxErrors()` uses it in place of the removed regex. A repo-wide grep finds 0 `DECLARATION_FILE` references.
- `:466-481` Every TypeScript declaration name goes to the no-emit `declarationSyntaxErrors()`. It builds a one-file program with `noLib`, `noResolve`, `types:[]` and a no-op `writeFile`, and calls `getSyntacticDiagnostics` only.
- `:494` Only non-declaration names reach `transpileModule`.
- `scanSource` still runs on every file.

**Security view.** This narrows nothing:
- Declaration files keep the full boundary scan.
- The branch change cannot be used to skip a file. The routing affects only how syntax diagnostics are produced, and both branches fail closed on syntax errors.
- A non-declaration name never takes the declaration branch. Over 31 names, the public flag and the `@internal ts.isDeclarationFileName` agree.

**Re-proof** (disposable clone; the pre-fix testkit from `873f48e` loaded next to the candidate's; Node 22 and Node 24, 8/8 on each):
- **Root cause:** for `styles.d.css.ts`, `data.d.json.ts` and `x.d.ts.ts`, `ts.transpileModule` throws `Debug Failure. Output generation failed`, and so does the pre-fix `fileViolations`.
- **After the fix:** the same names give `[]` with no throw. A broken body gives a named `unparseable source: Type expected. (line 1)`, never `Debug Failure`.
- **Still scanned:** a deep `access/internal` type import, an undeclared `kpi` re-export, a package type import and `typeof import('../workflows')` are all still flagged. That holds for `.d.ts`, `.d.mts`, `.d.cts` and the arbitrary-extension names.
- **No emit, no write, no execution:**
  - `transpileModule` always throws for these names, yet `fileViolations` never throws, so it is never called.
  - The temp dir stays empty.
  - An assignment to `globalThis` inside the body never runs.
- **Fuzz:** 19 `CODE_FILE` names × 4 bodies, 0 throws.

**End to end:** I planted `modules/transformations/zz-r16.d.css.ts` in the clone's real module tree:
- a valid body stays green (132/132);
- a deep import gives the named `only access/index.ts is public` violation;
- a broken body gives the named `unparseable source` violation.

**Mutation:** restoring the old regex makes exactly the 2 new self-checks fail with `Debug Failure`.

## Checks
Every check in the table below passed. The install-sandbox suite (AC-1..AC-10) is the one exception: 13 of 14 cases passed and one is BLOCKED (next section).

| Check | Node 22 | Node 24 |
|---|---|---|
| `pnpm -r typecheck` | exit 0 | not run |
| `pnpm -r build` | exit 0 | not run |
| `pnpm lint` | exit 0 | not run |
| `pnpm openapi:lint` (3.1.1, 33 ops) | exit 0 | not run |
| `pnpm check:no-cdn` | exit 0 | not run |
| `pnpm format:check` | exit 0 | not run |
| `pnpm test` | 325/325 | 325/325 |
| `architecture.test.ts` | 132/132 | 132/132 |
| Integration on disposable PostgreSQL 16.13 at :5491 | 200/200, runs 1 and 2 | 200/200, run 3 |
| Gate and agent tooling tests | 105/105 | not run |
| Deploy script tests | 59/59 | not run |
| `check-ci-needs` | OK | not run |
| SBOM `--check` | OK | not run |
| DG0 historical | PASS | not run |
| Three `ci.yml` copies | byte-identical | not applicable |
| Install-sandbox AC-1..AC-10 | 13/14 PASS, 1 BLOCKED | not run |

## BLOCKED
- **What:** AC-1 (effect) and the real-repo online install.
  - `create` resolves `is-number@7.0.0` from the public registry, and this sandbox has no egress (curl exit 7).
- **Not affected:** every sandbox security property in AC-1..AC-10 passed.
- **Stand-in:** a sandboxed frozen install from the offline store into a second clone.
  - It exited 0 and left the lockfile unchanged.
- **Same as before:** this matches the round-15 treatment, and the assignment anticipated it.

## Findings
- I raise no new findings.
- F-DG1-137 and F-DG1-218 are `CLOSED_VERIFIED` in `code-security-reviewer.verifications.json`.

## Independence
- I authored no DG1 implementation and not the repair `f7d9707`.
- HEAD advanced during my run to `925a48b`, the runner's auto-commit of the domain reviewer's run.
  - I saw only the file names in a diffstat and did not open any of them.
  - The candidate ID is unchanged.
- I formed this verdict before reading any other round-16 record.
