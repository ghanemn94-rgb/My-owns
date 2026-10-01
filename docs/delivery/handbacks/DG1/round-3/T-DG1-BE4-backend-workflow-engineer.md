# Handback T-DG1-BE4: backend round-3 repairs (backend-workflow-engineer)

- **Stage:** DG1, round-3 repair. **Assignment:** `docs/delivery/assignments/DG1/round-3/T-DG1-BE4.md` (sha256 `b012560f…0d550669`, verified).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE4-backend-workflow-engineer-20261001T090247Z-5231c834","session_id":"5231c834-f1fd-455e-8d59-8297f080fda1"}`.
- **Base revision:** `e7a7084` (branch `dg1r3-be4` in worktree `/home/user/mth-wt-be4`; ≥ `45d0297` as required). Working tree was clean apart from untracked runner dotfiles.
- **Findings addressed:** F-DG1-115 (Medium, mandatory) and F-DG1-117 (Low). Nothing else is in scope.
- **Engineering only:** no G1–G6, Finance or IT approval was granted or simulated. All test data is synthetic.
- **Not committed:** the worktree's git index is read-only in this sandbox (`git checkout` failed with `index.lock: Read-only file system`). The changes are left in the working tree for the runner/orchestrator to commit.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/assignments.ts` | F-DG1-115 fix: `grantCreatorTransformationRoles` locks the source grant rows `FOR SHARE OF a` and re-checks them inside the create transaction. If every authorizing grant was revoked concurrently and no other grant authorizes the create, the create fails with an audited 403 and rolls back. |
| `apps/api/src/modules/access/policy.ts` | `denialOf` is exported (no behaviour change), so the 403 above carries the same denial details as every other failed mutation authorization (audited by `denials.ts`). |
| `apps/api/test/integration/access-derived-race.test.ts` (new) | F-DG1-115 integration test on real PostgreSQL. Four deterministic interleavings (A–D), described in §2. |
| `apps/api/test/support/harness.ts` | `startApi({ database })`: an optional scratch database of the same disposable cluster, for suites that add timing hooks or change shared data (see §4, finding 1). The default behaviour is unchanged. |
| `apps/api/src/architecture.testkit.ts` | F-DG1-117: the static AST lint also rejects obfuscated loaders (rules in §2). |
| `apps/api/src/architecture.test.ts` | F-DG1-117: 16 new planted cases (L–L7, M–M9) and 5 new "must stay clean" forms. |
| `docs/delivery/handbacks/DG1/round-3/T-DG1-BE4-evidence/*` | Real output logs of every check below, plus `withpg.sh`, the scratch wrapper that created the disposable PostgreSQL (not part of the product). |

**Migrations added:** none. Migration `0008_scoped_assignment_derived_from.sql` is unchanged. The fix is a query and locking change only.
**API endpoints added:** none. `POST /api/v1/transformations` can now answer **403** in the race described below. 403 is already declared for `createTransformation` in the OpenAPI contract, and the contract-checking harness accepted it.

## 2. Behaviour delivered

### F-DG1-115: the derived creator assignment can no longer outlive a concurrent revocation (REQ-S16-003)

**Fix** (`assignments.ts`, `grantCreatorTransformationRoles`). Previously the source grants were filtered with an *unlocked* `revoked_at IS NULL` read. The fix:

1. **Locks the source rows.** It runs `SELECT a.id, a.role_id, a.effective_to, a.revoked_at, r.code, r.kind FROM scoped_assignment a JOIN role r … WHERE a.id IN (<sources>) ORDER BY a.id FOR SHARE OF a`. The lock order is sorted, and only assignment rows are locked, never role rows.
2. **Serializes against the revoke.** `FOR SHARE` conflicts with the revoke's `SELECT … FOR UPDATE` and `UPDATE`, which gives exactly two outcomes:
   - **Revoke first:** the derive waits. After the revoke commits, READ COMMITTED re-reads the locked row in its latest version, so `revoked_at` is set and the derive skips that source.
   - **Derive first:** the revoke waits until the create commits. Its cascade `UPDATE … WHERE derived_from_assignment_id = <src>` runs with a new statement snapshot, so it sees and revokes the new derived row.
3. **Surfaces the create.** Three cases:
   - Some sources are still active: derive only from those.
   - **Every** source was revoked meanwhile **and no other grant of the principal authorizes `transformation.create` on that BU**: the create is no longer authorized. It throws `403 forbidden` with denial details, the whole create transaction rolls back (no transformation, no derived row), and the denial is audited as `authorization.denied` by `denials.ts`.
   - Another (non-source) grant still authorizes the create: the create succeeds and derives nothing.
4. **Preserves the existing F-DG1-106 behaviour:** normal create gives an audited derived assignment, revoke cascades, approval roles are never carried over, and a TO creator gets no derived row. The full `access-scope.test.ts` passes unchanged.

**Test.** `apps/api/test/integration/access-derived-race.test.ts` runs through the real API on a real disposable PostgreSQL 16.13.

- **How the interleaving is forced:** a test-only trigger parks a transaction on an advisory lock held by the test. It changes no data. The test polls `pg_locks` until the *other* request is really blocked on a row lock, and only then releases the parked one. There are no sleeps, so the interleaving is deterministic.
- **Isolation:** the suite runs on its own scratch database (created, migrated with the real migrations via `migrate()`, and dropped).

| Case | Interleaving | Assertion | Before fix | After fix |
|---|---|---|---|---|
| A | The revoke has updated the source (uncommitted) when the create derives; this is the reviewer's interleaving. | Create → **403**. The lead has no active assignment and no derived row, no transformation was persisted, and exactly one `authorization.denied` event on BU a1. | **FAIL** `expected 201 to be 403` (the create succeeded and left the active derived row) | PASS |
| B | The create has inserted the derived row (uncommitted) when the revoke starts. | Create 201, revoke 200. The derived row is **revoked** by the cascade, and the re-signed-in lead gets 404. | PASS (this ordering was already serialized by the FK lock; it is kept as a guard) | PASS |
| C | Two sources (TL plus WL temporarily given `transformation.create`); the TL source is revoked concurrently. | Create 201, exactly one derived row, from the surviving WL source; the lead can read. | **FAIL** (2 derived rows: one from the revoked source) | PASS |
| D | The only source (TL) is revoked concurrently; SP (holds `gate.decide`, given `transformation.create` temporarily) still authorizes the create but is never carried over. | Create 201 with **no** derived row. | **FAIL** (a derived row from the revoked source) | PASS |

### F-DG1-117: dependency-lint catches obfuscated loaders (REQ-S16-003)

It is still a purely static AST walk in `architecture.testkit.ts`; nothing is executed. New rules:

- **Loader names:** `createRequire`, `getBuiltinModule`, `mainModule`, `_load` are rejected as identifiers, property names, or string member keys (`x["getBuiltinModule"]`).
- **Computed members of runtime roots:** any element access on `process`, `globalThis` or `global` (`process["get"+"BuiltinModule"]`, `(globalThis as any)["pro"+"cess"]`), with `as`, `!` and parentheses unwrapped.
- **Runtime roots as values:** a runtime root used other than as `root.member` (aliased, passed or destructured: `const p = process`, `const {…} = process`). Also `globalThis.process`, `.Function`, `.eval`, `.require` and `.module`.
- **Code evaluation:**
  - `Function` and `eval` in any value position (`new Function("s","return import(s)")`, `Function(…)()`, `const F = Function`);
  - `.constructor(…)` and `new x.constructor(…)` calls (the AsyncFunction constructor);
  - `x["constructor"]`, `x["Function"]` and `x["eval"]` keys.
- **Built-ins that evaluate code:** `vm` / `node:vm` and `worker_threads` / `node:worker_threads` are rejected like `node:module`.
- **Kept clean (planted negative cases):** `process.env.TZ`, `(process as NodeJS.Process).pid`, object keys or properties named `process`/`eval`/`Function`, `typeof process.env` in types, and ordinary class constructors. The real module tree has zero violations.
- **Limitation (stated plainly):** a static lint cannot follow data flow through third-party code that hands out a loader. The rules close every syntactic route in module code.

## 3. Checks actually run

**Environment:**

- Worktree `/home/user/mth-wt-be4` at base `e7a7084` plus the changes above; offline, no `pnpm install`.
- **PostgreSQL 16.13**, created fresh for every integration command by `docs/delivery/handbacks/DG1/round-3/T-DG1-BE4-evidence/withpg.sh`: `initdb` under `$TMPDIR`, run with `unshare --user --map-user=1000` because the sandbox is uid 0, TCP only on `127.0.0.1:5460`, and destroyed afterwards.
- `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:5460/postgres`, `QA_E2E_PG_PORT=5460`. The global setup applied **8 migrations** to a fresh database.
- `--configLoader runner` is used because `node_modules/.vite-temp` is read-only in this sandbox.

| # | Command | Result | Evidence |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --stage DG0 --historical` | `PASS gate DG0 (historical)`. **Note:** I ran this after implementing, not before as the protocol asks. | (console) |
| 2 | `pnpm -r typecheck` | exit 0 | `evidence/typecheck.log` |
| 3 | `pnpm -r build` | exit 0; `find apps/api/dist -name '*testkit*'` → 0 files | `evidence/build.log` |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | `evidence/lint.log` |
| 5 | `pnpm test` (unit-node + unit-web) | exit 0, `Test Files 21 passed (21)`, `Tests 226 passed (226)` | `evidence/unit.log` |
| 6 | `withpg.sh 'vitest run --project integration'` (full integration suite) | exit 0, `Test Files 18 passed (18)`, `Tests 197 passed (197)` | `evidence/integration.log` |
| 7 | `withpg.sh 'vitest run --project integration apps/api/test/integration/access-derived-race.test.ts'` ×3 | exit 0 each, `Tests 4 passed (4)` ×3 | `evidence/race-run{1,2,3}.log` |
| 8 | Same as #7 with the `assignments.ts` fix reversed (`patch -R`), then reapplied | exit 1, `Tests 3 failed \| 1 passed (4)`: A `expected 201 to be 403`, C 2 derived rows instead of 1, D 1 derived row instead of 0 | `evidence/race-before-fix.log` |
| 9 | `vitest run --project unit-node apps/api/src/architecture.test.ts` with the **old** `architecture.testkit.ts` (base `e7a7084`) and the new test | exit 1, `Tests 15 failed \| 31 passed (46)`: every new L/M plant missed. M9 (`worker_threads`) was already caught as an unknown package. | `evidence/f117-before.log` |
| 10 | Same as #9 with the new testkit | exit 0, `Tests 46 passed (46)` | `evidence/f117-after.log` |
| 11 | Replay of the reviewer's two F-DG1-117 plants from `plant-f109.sh` into `kpi/index.ts` (restored byte-identical afterwards) | control clean; `getBuiltinModule (line 28) bypasses…` **CAUGHT**; `code evaluation via Function (line 28) bypasses…` **CAUGHT** | `evidence/f117-plant-replay.log` |
| 12 | `prettier --check` on every changed file | `All matched files use Prettier code style!` | (console) |
| 13 | `pnpm format:check` (repo-wide) | exit 2 **only** for `deploy/images.lock.json`, a pre-existing file I did not touch (`git diff --quiet HEAD -- deploy/images.lock.json` → unchanged). Outside my scope; flagged for its owner. | (console) |

Output tails (the full logs are in the evidence directory):

```
race-before-fix.log
   × … A. revoke first: … is refused (nothing persists)   → expected 201 to be 403 // Object.is equality
   ✓ … B. create first: the revoke waits for the create and its cascade revokes the new derived assignment
   × … C. one of two source grants revoked concurrently … → expected [ [ …(3) ], [ …(3) ] ] to deeply equal [ [ …(3) ] ]
   × … D. the only source revoked concurrently …          → expected [ { …(6) } ] to deeply equal []
      Tests  3 failed | 1 passed (4)
race-run1.log / race-run2.log / race-run3.log
      Tests  4 passed (4)
integration.log
[integration] PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1); database mth_test_mupbqe2r_07e36325; applied 8 migrations to a fresh database
 Test Files  18 passed (18)
      Tests  197 passed (197)
f117-before.log
      Tests  15 failed | 31 passed (46)
f117-after.log
      Tests  46 passed (46)
```

## 4. Known gaps, observations, not done

1. **Observation (pre-existing test-harness risk, outside my write scope).** The project-level `fileParallelism: false` in the root `vitest.config.ts` does **not** serialize the integration files. Integration files of one run execute concurrently against the shared per-run database.
   - **Evidence:** my first version of C/D (temporarily granting `transformation.create` to WL/SP in the shared database) made `admin.test.ts > role and permission catalogue` fail in the full suite. That suite passes alone and with `--no-file-parallelism`, and the cleanup itself was verified (`deleted 1`, seed intact).
   - **What I changed:** I moved my suite to its own scratch database (`startApi({ database })`).
   - **Still exposed:** the existing F-DG1-106 test in `access-scope.test.ts`, which temporarily adds `gate.decide` to TL in the shared database, has the same latent race with `admin.test.ts`; it did not trigger in my runs.
   - **Recommendation for the owner of `vitest.config.ts`:** set `fileParallelism: false` at the root (or `poolOptions.forks.singleFork`) for the integration project.
2. `pnpm format:check` fails repo-wide only on the pre-existing `deploy/images.lock.json`, which is outside my scope.
3. The DG0 historical validation was run after implementation, not before (it passed).
4. F-DG1-117's lint is static by design. Loaders handed out by third-party code through data flow cannot be detected statically (see §2).
5. Finding status: both findings are **FIXED_PENDING_VERIFICATION** by a non-author reviewer. I do not close my own findings.
6. **Dependency requests:** none.

## 5. Merge instructions

- No migrations and no dependency or lockfile changes. Apply the working-tree changes in one commit.
- **Expected conflicts:** `apps/api/test/support/harness.ts` (additive `database` option plus a `roleUrl` import from `packages/db/test/helpers.ts`) if another round-3 task edits `startApi`. Also `apps/api/src/modules/access/policy.ts` (only `denialOf` is exported).
- Reviewers re-running the race test need a disposable cluster the same way. The test is self-contained: it creates and drops its own scratch database and leaves the shared run database untouched.
