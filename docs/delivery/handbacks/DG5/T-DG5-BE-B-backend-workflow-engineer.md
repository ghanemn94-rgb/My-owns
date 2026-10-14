# Handback T-DG5-BE-B (backend-workflow-engineer): p5-work-split §A.2: element edits, invariants, diff, affected records, compatibility, preview

- **Stage:** P5, gate DG5 (BUILDING). Wave W3.
- **Invocation:** `DG5-T-DG5-BE-B-backend-workflow-engineer-20261014T022815Z-f51bf74c`, session `f51bf74c-4ff3-4681-9c3c-41259c81090a`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-B.md` (sha256 `b298da0d…e255ea`, verified at the start).
- **Working tree:** worktree `/home/user/wt/dg5-be-b`, branch `dg5/be-b`, base `HEAD` `a8185879df98425573557460959752edc23788da`. The changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-14T02:28:26Z`, end `2026-10-14T03:37:56Z`. About 70 minutes.
- **Two gate systems:** nothing here reads or writes DG0–DG7 records. A check run or a Studio edit is configuration, not a G1–G6 business approval. No agent, seed or test grants a business, Finance or IT approval. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/elements.ts` (was a BE-A stub) | Routes `putConfigElement` and `removeConfigElement`. Commit-time authorization (`methodology.configure`), Zod validation, `If-Match` on the draft, lock 730250, element row write, hash recompute, draft step back to `editing`, and one audit event per row written. |
| `apps/api/src/modules/methodology/invariants.ts` (new) | The ADR-0039 §2 refusals before the database guards: kind/type, identity, fixed sets, admin/AUD approvers and the attribute shape. Also `elementRowFindings`, which re-runs those rules over the stored rows for preview and compatibility. |
| `apps/api/src/modules/methodology/diff.ts` (new) | Diff of the resolved elements (catalogue overridden by rows), with field-level from/to. Adds the provider's `diffRows`. |
| `apps/api/src/modules/methodology/affected-records.ts` (new) | Finds the transformations of the lineage in the caller's organization and gathers live counts per record type through the provider. Unknown is `null` plus a reason key, never 0. |
| `apps/api/src/modules/methodology/compatibility.ts` (new) | The ADR-0039 §5 classification (pass/warn/fail), plus row invariants and the provider's findings. |
| `apps/api/src/modules/methodology/compatibility.test.ts` (new) | Unit tests of `classifyChange`. |
| `apps/api/src/modules/methodology/preview.ts` (new) | The sandbox: a READ ONLY transaction that is always rolled back. It runs the invariants and the provider's preview hook. |
| `apps/api/src/modules/methodology/checks.ts` (was a BE-A stub) | Routes `getConfigVersionDiff`, `getConfigAffectedRecords`, `listConfigCheckRuns`, `runConfigCompatibilityCheck` and `runConfigPreview`. |
| `apps/api/src/modules/methodology/providers/methodology-kind.ts` (new) | The `methodology` kind's hooks: `validateElement` (DG2 gate approver set), `compatibility` (unknown references), `affectedRecords` (counters) and `preview` (formula and submission samples). |
| `packages/shared/src/schemas/studio-checks.ts` (was a stub) | Zod mirrors: `configElementPut`, `configCheckRun`, `configCheckRunPage`, `configCheckRunListQuery`, `configPreviewRequest`, `configDiffEntry`, `configVersionDiff`, `configDiffQuery`, `configAffectedRecords`. |
| `apps/api/test/integration/methodology/studio-checks.test.ts` (new) | 17 integration tests on a real PostgreSQL (§2). |
| `apps/api/test/integration/contract/p5-exercises-be-b.ts` | Exercises the 7 operations through the validating client, plus their mirrors. |
| `apps/api/test/support/p5-pending-be-b.ts` | 7 → 0 pending. |
| `apps/api/test/integration/contract/contract.test.ts` | **Outside my nominal ownership; see §5.1.** Pinned media-type triple `[325, 324, 1]` → `[327, 326, 1]`, with a comment line. |
| `apps/api/src/modules/methodology/methodology.test.ts` | **BE-A's unit test; see §5.1.** The route/access pin now lists the 7 BE-B routes. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-B-evidence/*` | Check logs (§3). |

No migration, no new dependency, no OpenAPI change, and no i18n change.

## 2. Behaviour delivered, per requirement row

### REQ-S06-006 (owner: BE-B; complete for slice A)

Acceptance: *"A06;A12: renaming the label of G3 succeeds; changing its stable ID, deleting a TOM dimension or configuring ADM as an automatic approver is rejected"*. Procedure: *"Studio refuses changes that would break invariants: deleting seeded source elements, changing IDs, removing audit, allowing self-approval where prohibited, or making ADM an automatic business approver"*.

- **Renaming G3's label succeeds.** `PUT …/elements/gate/G3 {attributes:{labelEn}}` returns 200. It writes one `source` element row. The resolved label changes while the catalogue `gate_definition` stays untouched, and the other attributes resolve to the catalogue values. Test: "renaming G3's label succeeds…".
- **Changing its stable ID is rejected** with 422 `config_version.stable_id_change` and the exact §13 text. This covers:
  - an identity field in the attributes that differs from the path (`stableKey`, `code`, `key`, `elementType`);
  - a changed origin of an admin element;
  - a new position for a fixed source element (G3 is the third gate).
- **Adding a seventh gate, or claiming G3 as admin-authored,** is refused with 422 `config_version.source_element_protected`.
- **Deleting a TOM dimension, a phase or a gate** is refused with 422 `config_version.source_element_protected`, and nothing is written.
- **ADM as an approver is rejected.** `ADM_METHOD`, `ADM_TECH`, `ADM_ACCESS` (role kind `technical_admin`) and `AUD` are refused with 422 `config_version.admin_approver_forbidden`. This applies to a gate default approver and to an approver route.
- **A gate approver outside the DG2 allowed set** is refused with 422 `config_version.approver_not_allowed`. For example, G3 → `TO`, or route `gate.G1` → `BO`.
- **"Deleting seeded source elements":** deleting T13 (a template) is *recorded* in the draft, as ADR-0039 §2 rules. BE-B2's coverage check then fails it, and BE-B3's publish gate blocks it.
- **"Removing audit" and "allowing self-approval":** no element type of the methodology kind carries an audit or self-approval switch (ADR-0039 §2 attribute shapes), so neither is configurable through these routes. Audit stays enforced by the deferred database guard on every row. Separation of duties is configured in slice E (ADR-0044).

### REQ-S06-007 (owners: BE-B for preview, diff, compatibility and affected records; BE-B3 for review, publish and immutability)

Acceptance: *"A06: publish without required review is rejected; editing a published version returns 409; the diff lists the added field"*. Procedure: *"The admin previews and tests the draft in a sandbox view, sees a side-by-side diff and affected records, passes compatibility checks, obtains review if configured and publishes; published versions cannot be edited"*.

- **Editing a published version returns 409.** `putConfigElement`, `removeConfigElement`, `runConfigCompatibilityCheck` and `runConfigPreview` on a published version all return 409 `config_version.not_editable` with the exact text. Test: "a published version is not editable".
- **The diff lists added, removed and changed elements.**
  - Each changed element has field-level `from`/`to`; for example, G3 `defaultApproverRoleCode` SP → BO and `labelEn`.
  - Removed: T13. Added: an admin checklist item.
  - It also reports `titleChanged` and `definitionChanged`.
  - The default is against the base. A diff against itself is empty.
  - *"The diff lists the added field"* (a T13 form field) completes with slice B's `diffRows` hook (ADR-0041). The hook point exists and is called.
- **Preview/test sandbox.** Samples run in a READ ONLY transaction that is always rolled back: formulas through `evaluateFormula` (engine unchanged), and submissions routed through the draft's approver routes or the gate default via `ConfigResolver.withDraft`. One `config_check_run` is then recorded in a separate write transaction.
  - On `pass`, the stage moves `editing → preview` (one audited version step).
  - On `fail`, the stage stays in `editing`.
  - The test checks that the element rows are byte-equal before and after, and that there is exactly one run and only the expected audit events.
- **Compatibility.**
  - Label-only changes → `pass`.
  - A changed approver → `warn` (`compatibility.approver_changed`), listing the pinned transformations.
  - A removed element, or an added mandatory element → `warn`.
  - An unknown role (reminder `recipientRoleCode`) → `fail` (`compatibility.unknown_reference`).
- **Affected records.** For each transformation pinned to the lineage (in the caller's organization), there are live counts: `gate_instance` (gate or gate route), `tom_canvas_cell`, `gate_submission_criterion` and `phase_step`. A change without a counter (for example, template T13) is `count: null` with `unknownReason: "affected_records.no_counter"`, never 0. A caller from another organization sees none of org A's transformations.
- **Not delivered here:** publish without the required review → 422 is BE-B3's (§A.4).

### REQ-S06-004 (owners: BE-A, BE-B for draft edits and the gate approver route, BE-C for the gate reader; completes with slices B and E and FE-B)

Acceptance: *"A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish, with no deployment or application-code change, a new T13 record stores the new field, the changed rule rejects a value it previously accepted, and a submission is routed to the new approver"*.

- **BE-B's part:**
  - A methodology admin can edit every slice A element type in a draft through the API: methodology text, phases, gates, criteria, mandatory artifacts, checklists, templates, labels and help, approver routes, reminders, escalation rules, dashboards and report layouts.
  - The approver route is validated.
  - The preview shows where a sample submission would be routed in the draft (for example, `t13.submission` → SP, BO, sequential).
- **Not delivered by BE-B:**
  - T13 field and validation: slice B.
  - Routing of real submissions: BE-C (gate reader) and slice E.
  - Publish: BE-B3.
  - The UI: FE-B.

## 3. Checks run (real exit codes; logs under `docs/delivery/handbacks/DG5/T-DG5-BE-B-evidence/`)

| # | Command | Environment | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | Node 24.21.0 | `PASS gate DG4 (historical)`, **exit 0** |
| 1 | `pnpm -r typecheck` | Node 24.21.0, offline | **exit 0** (`typecheck.log`; re-run on the final tree, `typecheck-final.log`) |
| 1 | `pnpm -r build` | same | **exit 0** (`build.log`) |
| 1 | `pnpm lint` | same | **exit 0** (`lint.log`; re-run on the final tree, `lint-final.log`) |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | same | **exit 0** (re-run on the final tree, `prettier-final.log`) |
| 1 | `pnpm openapi:lint` | same | **exit 0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 724 operations` (`openapi-lint.log`) |
| 2 | `pnpm test` with LANG/LC_ALL/LC_CTYPE/LANGUAGE unset | same | **exit 0**: unit-node 1621/1621, unit-web 1358/1358, unit-formula-nocodegen 259 passed + 2 skipped (by design, D-144) (`unit-locale-unset.log`) |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | same | **exit 0**: 1621/1621, 1358/1358, 259 + 2 skipped (`unit-c-utf8.log`) |
| 3 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | disposable PostgreSQL (with-pg.sh) | **exit 0**: 211 files, **2048/2048** (the 2031 baseline from D-144 + 17 new). Contract test 72/72; `studio-checks.test.ts` 17/17 (`integration.log`) |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | Node 24.21.0 | **exit 0** (`validate-dg4-end.log`) |

**Non-zero exits along the way, disclosed:**

- **First unit run, both locales: exit 1** (`unit-locale-unset.run1-failed.log`, `unit-c-utf8.run1-failed.log`). One failing test, `methodology.test.ts` "registers … the P5 Studio routes of BE-A". It is BE-A's pin of every registered route and its access, and my 7 new routes were not listed (`expected {…(15)} to deeply equal {…(8)}`). I added them (§5.1) and re-ran both locales: exit 0, as shown above. It was deterministic, not a flake.
- **First targeted contract-test run: exit 1.** The media-type triple pin was `[327, 326, 1]` vs `[325, 324, 1]`, the exact +2 for `putConfigElement` and `runConfigPreview`. I updated the pin (§5.1); the targeted re-run was 72/72, and the full suite above includes it.
- **Not failures:** the first targeted run of `studio-checks.test.ts` was 17/17, exit 0. Before every test run I removed the empty `.claude/.cc-writes` folders that the harness leaves under `apps/api/` and `apps/api/src/modules/methodology/`.
- **No timeout or flaky test.** The unit command was moved to the background by the tool's 600 s foreground limit while it ran; it finished normally, and its exit codes are above.

## 4. Operations routed (delta to `p5-pending-be-b.ts`)

`P5_PENDING_BE_B`: **7 → 0**. Each operation below is now routed and exercised in `p5-exercises-be-b.ts`, with its mirror listed:

| Operation | Route | Permission | Exercised refusals |
|---|---|---|---|
| `putConfigElement` | `PUT /api/v1/admin/methodology-versions/{versionId}/elements/{elementType}/{stableKey}` | `methodology.configure` | 400, 403, 404, 409, 422 ×5 (stable_id_change, source_element_protected, admin_approver_forbidden, approver_not_allowed, unknown_element), 428 |
| `removeConfigElement` | `POST …/elements/{elementType}/{stableKey}/remove` (bodiless) | `methodology.configure` | 400, 403, 404, 409, 422, 428 |
| `getConfigVersionDiff` | `GET …/{versionId}/diff?against=` | `methodology.read` | 400, 403, 404 |
| `getConfigAffectedRecords` | `GET …/{versionId}/affected-records` | `methodology.read` | 400, 403, 404 |
| `listConfigCheckRuns` | `GET …/{versionId}/check-runs?checkKind=&cursor=&limit=` | `methodology.read` | 400, 403, 404 |
| `runConfigCompatibilityCheck` | `POST …/{versionId}/compatibility-checks` (bodiless; 201 + `Location`) | `methodology.publish` | 403, 404, 409, 428 |
| `runConfigPreview` | `POST …/{versionId}/preview` (`application/json`; 201 + `Location`) | `methodology.publish` | 400, 403, 404, 409, 428 |

- **Unreached 422s:** neither `runConfigCompatibilityCheck` nor `runConfigPreview` has a reachable 422; a failing check is a recorded `fail` run (201), not a refusal. `getConfigVersionDiff` declares 422, but I answer "against a version of another configuration" with 404 (§5.2).
- **`config.consumes`** equals the contract on each route: JSON for the two body routes, none for the bodiless ones.
- **Pinned counts (rule 14):** the media-type triple goes from `[325, 324, 1]` to `[327, 326, 1]`. The rate-limit floor is unchanged (the contract test passed without touching it). The operation count is unchanged (724).

## 5. For the orchestrator: contract, schema, ownership and dependency points

### 5.1 Two files outside my nominal ownership

Acceptance items 2–3 need green suites. Both edits are additive pin lines with a comment, and you may re-apply or reconcile them:

1. **`contract.test.ts`:** the triple pin and its comment (rule 14 says the orchestrator reconciles pins). Assignment acceptance 3 asks for a green integration run "and any pinned-count change". BE-A updated the same pin in W2. If ARCH-03 also moves this line, keep the larger sum: **+2 JSON bodies from BE-B**.
2. **`methodology/methodology.test.ts`** (BE-A's unit test): the 7 BE-B routes and their access (`methodology.configure` ×2, `methodology.read` ×3, `methodology.publish` ×2) are added to the route pin.

### 5.2 Refusal codes: ADR-0039 §13 has no exact code for two cases

I did not invent a problem code. I used the closest existing one, and I propose a dedicated code for each:

- **An approver role code that does not exist** (a gate default or an approver route; the database guard refuses it too). I answer 422 `config_version.unknown_element`. Proposed code: `config_version.unknown_role`, "This role does not exist. Choose an existing business role."
- **`getConfigVersionDiff?against=` naming a version of another kind or key.** I answer **404** (not found in this configuration's lineage). Proposed code, if a 422 is preferred: `config_version.diff_target_invalid`, "Only versions of the same configuration can be compared."

### 5.3 Report keys (not problem codes)

The FE-A/FE-B translation needs these keys. They appear inside check-run reports and affected-records:

- `compatibility.element_removed`
- `compatibility.required_element_added`
- `compatibility.approver_changed`
- `compatibility.behaviour_changed`
- `compatibility.unknown_reference` (params `reference` ∈ role|phase|gate, `value`)
- `preview.not_available`
- `preview.sample_not_supported`
- `preview.sample_invalid`
- `preview.route_unknown`
- `affected_records.no_counter`
- `affected_records.not_available`
- `affected_records.not_countable`
- `validation.attributes`

Formula problems use the DG3 `formula.*` codes, and invariant findings reuse the §13 codes.

### 5.4 Schema mismatch (ARCH-02 / BE-D)

OpenAPI `ConfigElementType` includes `form` and `form_field`, but `@mth/shared` `CONFIG_ELEMENT_TYPES` (BE-A's `studio.ts`) does not yet. So the `{elementType}` path parameter answers 400 for `form`/`form_field` until slice B widens the shared enum, its attribute schemas and `ELEMENT_TYPES_BY_KIND.form_schema`. Elements, diff and compatibility then work through the generic code plus the form_schema provider hooks.

### 5.5 Provider registration and dependencies

- **Provider registration:** the `methodology` provider is registered by `registerConfigElementRoutes` (my file, called from the composition wiring in `routes.ts`). Idempotent. `server.ts` is not edited.
- **No dependency** is needed, and **no migration** was written (none in §A.7 for BE-B).

### 5.6 Design choices for review

- **Removing an already-removed element** is a no-op: 200 with the unchanged version, nothing written and no audit event.
- **A put on a removed element** restores it.
- **A compatibility run** does not step the version row. It is checked against `If-Match` under lock 730250 and records an audited run.
- **The preview's write transaction** refuses with 409 when the draft's hash changed between the sandbox and the record.
- **Check-run `Location`** is the version's `check-runs` list, because the contract has no single-run GET.
- **Affected records and the compatibility run's `affectedTransformations`** list transformations of the caller's organization only, because versions are global and records are not.

## 6. User-facing texts

- **Searched:** the en/ar strings that call the Studio "planned" (`apps/web/src/i18n/{en,ar}/*.json`). The only one is `admin.plannedSections` ("Methodology, forms, workflows, automation and branding settings are planned for later releases.").
- **Still true:** this task ships API routes only, and the Studio screens ship with FE-B. The BE-A handback made the same observation.
- **Changed:** no string. **For FE-B:** update `admin.plannedSections` in both languages when the screens ship.

## 7. What remains

- **Nothing in §A.2 remains open.** All 7 operations are routed and exercised. The §A.2 test list is covered literally:
  - G3 rename;
  - stable key → 422;
  - TOM delete → 422;
  - ADM_METHOD approver → 422;
  - outside the DG2 set → 422;
  - T13 deletion recorded;
  - the diff's added, removed and changed elements;
  - preview writes nothing but its run;
  - compatibility `warn` for a changed approver and `fail` for an unknown role.
- **Every mutation's** authorization (positive, AUD/TO/BO 403, commit-time 403), `If-Match` 428/409 and audit are tested.
- **Completes elsewhere (owners per §A.9):**
  - REQ-S06-007: review, publish and "publish without required review" (BE-B3); "the diff lists the added field" (slice B's `diffRows`).
  - REQ-S06-004: slices B and E, BE-C and FE-B.
  - The source-coverage `fail` for a deleted T13: BE-B2.
- **Merge instructions:** no migrations and no ordering constraints. Expect a possible conflict only on the `contract.test.ts` triple pin (§5.1).
