# DG1 round 10: qa-verifier review

- **Candidate:** `sha256:18fee1617d617cfd719aeaebe3c37904bd116c47eaafb5be52e7bd779c6e8807`
- **Source:** `265af7e`. HEAD `241a377` adds only candidate-excluded metadata. The ID recomputes identically in a full clone and was unchanged after the runner's mid-run auto-commits of the other reviewers' records, which I did not open.
- **Task:** T-DG1-REV-QA-R10
- **Run:** `DG1-T-DG1-REV-QA-R10-qa-verifier-20261001T143212Z-25b2ea33`

## Verdict: FAIL

| Finding | Severity | Mandatory | Requirement | Status after this round |
|---|---|---|---|---|
| F-DG1-130 (verify) | Low | no | REQ-S16-003 | **CLOSED_VERIFIED** (written-name route) |
| **F-DG1-214** (new) | **Medium** | no | REQ-DLV-033 | OPEN. `pnpm test` is red on Node 24, the ADR-0001 target and a CI matrix leg |
| **F-DG1-215** (new) | Low | no | REQ-S16-003 | OPEN. Enumerating `node:crypto` reaches `setEngine` with 0 violations |

Every check the assignment lists passes on Node 22.22.2. I return FAIL because of F-DG1-214. ADR-0001 makes Node 24 LTS the target in every container, `.nvmrc` says 24, and `ci.yml` runs `pnpm test` in a `verify` matrix of `["24", "22"]`, with `integration` and `e2e` depending on `verify`. On Node 24 the required unit check is deterministically red, so the delivered CI (part of REQ-DLV-033's "repo/build/CI") cannot go green on its own target leg.

I rate it Medium, not High. On Node 24 the product itself is fine: integration passes 200/200 and the real-browser e2e passes 22/22 in EN and AR. The defect is confined to the jsdom unit harness and the CI deliverable. The orchestrator or auditor may regrade it, but a required check that is green only on the floor runtime is not something I can sign as PASS.

## Environment event (important for reading the evidence)

A Node **v24.21.0** binary (`/opt/nvm/versions/node/v24.21.0`, undici 7.29.1, OpenSSL 3.5.8) appeared at the front of PATH during my run. The `/opt/nvm` directory was created at 14:43:16Z. I did not cause this: my sandbox cannot write `/opt`.

- Checks 00–12 ran on Node v22.22.2, and the logs record the version.
- 14b ran unpinned and happened to use Node 24. I kept it, with a header note.
- Everything after that is pinned explicitly: `PATH=/opt/node22/bin:$PATH` for the assignment's checks, and `/opt/nvm/.../v24.21.0/bin` for the supplementary target-runtime checks (15–19).

Every earlier DG1 round recorded Node 24 as unavailable. That includes F-DG1-130's own "Not checked on Node 24 … BLOCKED".

## F-DG1-130: verified

The fix (74c9e4a) adds `setEngine` to rule-1 `BANNED_PRIMITIVES` ("native loader") and scopes the default-deny explicitly to modules rather than members. The testkit header also records a member audit.

- **Candidate self-checks:** S1/S2/S3 and the positive control pass, and `architecture.test.ts` is 105/105, including the real module-tree check (10).
- **Independent probe** (`qa/tests/dg1-r10-setengine-probe.test.ts`, 30/30):
  - All 18 written-name spellings are flagged: named, aliased, namespace, default, `ns.default`, `?.`, string, template, unicode-escaped string and identifier, three destructuring forms, two export-from forms, dynamic import, `then()` destructuring, and `in`.
  - Six positive controls stay clean, covering `randomUUID`, `createHash`, `createHmac`, `timingSafeEqual`, `getFips`, `fs`, `path`, `url`, `os`, `util` and `fs/promises` (11c).
- **Negative control:** on the pre-fix testkit, exactly those 18 forms and S1–S3 fail (14).
- **Member audit, independent and on both runtimes:** `setEngine` is the only loader member on Node 22 and on Node 24. Node 24's new members (`argon2*`, `encapsulate`/`decapsulate`, `randomUUIDv7`, `Utf8Stream`, `mkdtempDisposable*`, `URLPattern`, `convertProcessSignalToExitCode`) load no code (15). The header records only the Node 22 audit, but its conclusion holds on the production target too.
- **Scope of the change:** it is test-only. The code-path diff is the two lint files, the testkit is excluded from the build, and no product code uses `setEngine` (13). Unit, integration and e2e are unaffected.

## F-DG1-215: a route around the name ban (Low)

A name ban cannot see a name that is never written. `setEngine` is an enumerable export of an allow-listed module, so module source can recover it without writing the name:

```ts
new Map(Object.entries(c)).get("set".concat("Engine"))
```

`Object.values` with `.name ===`, and regex selection, work the same way. Rule 2 even endorses `Map` lookups.

- All four forms give 0 violations on Node 22 and on Node 24.
- With a real planted module file, the module-tree check stays green, and a marker `.so` prints `QA-R10-NATIVE-CONSTRUCTOR-RAN` in-process (12, 16).
- With the literal name in the same plant, the check turns red.
- No stated residual covers this: (a) is third-party data flow, (b) is fs write plus literal import, and (c) is WebAssembly.

The severity matches the class (Low, non-mandatory): this is static defence-in-depth over human-reviewed code. Suggested fix directions are in the findings sidecar. Note that real module source already uses `new Map(Object.entries(x)).get(name)` (identity/routes.ts:35), so a blanket `Object.entries` ban would be brittle.

## F-DG1-214: unit-web is red on Node 24 (Medium)

- **Result:** `pnpm test` gives 12 failed / 286 passed. All failures are in unit-web (app.test.tsx ×3, transformations.test.tsx ×9, including the F-DG1-004 and F-DG1-210 regressions), and vitest also reports 11 unhandled errors.
- **Reproduction:** a fresh clone installed, built and tested entirely under Node 24 gives the same result in two full runs and in a unit-web-only run. unit-node is 188/188 (17, 18).
- **Cause:** `TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal` at `new Request` ← `createClientSideRequest` ← `startNavigation` (react-router 7.9.0). In jsdom, react-router builds the signal from jsdom's `AbortController`, and Node 24's undici 7 brand-checks it.
- **Comparison:** Node 22.22.2 (undici 6.24.1) passes 298/298 with no unhandled errors.
- **Not checked:** other 24.x patch releases, and GitHub Actions itself (QA10-25 BLOCKED).

## Assignment checks on Node 22.22.2 (all green)

- **Static:** typecheck, build, lint (0 warnings), OpenAPI 3.1.1 with **33 operations**, no-CDN, format, contrast (50 AA pairs).
- **Unit:** **298/298**.
- **Integration:** **200/200 in 4 runs**, exit 0, 8 migrations. **0 57P01** in both captured server logs (F-DG1-009 holds).
- **Audit trigger:** UPDATE, DELETE and TRUNCATE are rejected for superuser and owner, and the app role is denied.
- **Contract:** 9/9, including `getBrandingTokens`.
- **e2e:** **22/22 in EN and AR**, including the BU-Lead create → Edit/Archive without reload. My independent F-DG1-210 spec is green in both locales with `documentLoads after form=0`.
- **Acceptance suites:** A12, A13 and A14 are green inside integration. **A18** clean start PASS. **A20** token propagation PASS.
- **REQ-DLV-042:** the cited installer log is still the 14-case run (14 PASS / 0 FAIL, unchanged since cc0198e), and `tools/deps` is unchanged. The suite re-run gives 13/14. AC-1 (effect) is **BLOCKED** for lack of registry network and passes in its offline equivalent, with a lockfile identical to round 9.
- **Validators:** `--register DG1`, `--pipeline` and `--reconcile` all PASS.
- **Register:** all 12 rows are IMPLEMENTED with no missing evidence.

## Not checked / BLOCKED

- AC-1 (effect) against the live registry (no network).
- The GitHub Actions CI itself.
- Node 24 patch releases other than 24.21.0.

No product file was modified. All execution happened in disposable clones under `$TMPDIR`. The planted files, the marker `.so` and the probe copies existed only there. No secrets appear in the evidence (scanned).
