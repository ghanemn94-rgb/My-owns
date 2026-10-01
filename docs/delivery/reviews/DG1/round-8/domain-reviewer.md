# DG1 round 8: domain-reviewer narrative

- **Candidate:** `sha256:e27eaf5fb5ada8640c4463b8e3c9d5f64e5aa629fa78b49cfd2861bdc7544876`
- **Freeze commit:** `11bc4c4`. HEAD `6cb3813` adds only round-8 assignments, the manifest and `stages.json`, and the candidate id is identical.
- **Verdict:** PASS, with one new Low, non-mandatory finding (F-DG1-010, proposed id).

## What changed
Since the round-7 candidate (`a6bdea0`), only `apps/api/src/architecture.test.ts` and `architecture.testkit.ts` changed. The build excludes both (`tsconfig.build.json`), and `dist` contains no architecture files. Nothing changed in the runtime or contract surfaces, the register or the i18n catalogues.

## F-DG1-128 over-reach (reviewer probe, differential against the round-7 testkit)
- Across 164 specifiers, the only verdict change is `node:test` (now rejected). The corpus covers every `builtinModules` entry, bare and `node:`, plus the prefix-only `node:test`, `node:sqlite` and `node:sea`. Bare `test` was already rejected.
  - Probe run 1 missed `node:test` because Node 22's `builtinModules` omits the prefix-only modules. That was a bug in my probe, not in the candidate. The run is kept as evidence.
- Across all 109 keys of the live `process` object, the only newly flagged member is `execve`. Ordinary members (`env`, `cwd`, `hrtime`, …) stay clean.
- None of the 47 legitimate specifiers is rejected, and the real module tree has 0 violations.

## No regression
- Unit tests: 273/273.
- Integration: 200/200 on two runs, each on a fresh throwaway PostgreSQL 16 cluster, with no leftovers.
- Live scenario: 108/108 in Arabic (RTL) and English (LTR). It covers:
  - closure refused with 422 citing G6, and no audit row written;
  - business-unit-scoped creator;
  - cursor pagination over every sort, plus binding and tamper refusal;
  - identity cookie handling and logout;
  - provisional tokens and wordmark;
  - Unknown shown instead of 0 or green;
  - localized audit;
  - no reload after a UI create.
- Static checks are clean: OpenAPI lint (33 operations), no-CDN, typecheck, eslint, prettier, provisional flags on all 34 colour tokens (`#0078FF` included), no unnegated official/certified claim, no DG gate in UI strings, no float columns.
- The 12 round-7 domain closures still hold.
- The 8 assigned rows are IMPLEMENTED with all evidence present, and the 29 P1-increment rows stay SPECIFIED at their later gates.

## F-DG1-010 (Low, not mandatory, REQ-S16-003)
D-054 and the testkit header declare the loader/exec enumeration exhaustive "for the PINNED Node version (22.x)". The repository pins Node **24** as its runtime:
- ADR-0001 sets the target runtime to Node 24 LTS;
- `.nvmrc` is `24`;
- the production image is `node:24-bookworm-slim@sha256:0e0ff40c…`;
- the CI matrix runs 24 and 22.

Node 22.18+ is only the floor and the build-sandbox version, and the validating sweep ran on Node 22.22.2 only. Residual (c) is narrowed to "a LATER Node version", so the current target runtime is covered neither by the claimed exhaustive set nor by the residual.

I demonstrated no route. I could not sweep Node 24: the sandbox has no Node 24 binary and no network.

Suggested fix: either state the claim for the version it was validated on and put Node 24 under residual (c) until it is swept, or run the same sweep on Node 24. An ACCEPTED_OBSERVATION with a wording fix in the next stage would be proportionate.

## Independence
I authored nothing in the DG1 scope. I formed this verdict before reading any other reviewer's round-8 record, and none was visible to me. I grant no business, Finance or IT approval. Product gate G6 is not engineering gate DG7.
