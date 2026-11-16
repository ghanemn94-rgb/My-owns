# Handback T-DG7-DO-E4 (devops-engineer): keep image names through bundle save/load; pin-images C2

- Stage DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` `576424f1a`.
- Assignment `docs/delivery/assignments/DG7/T-DG7-DO-E4.md`, sha256 `e5826234…0ebf`.
- Invocation: run `DG7-T-DG7-DO-E4-devops-engineer-20261114T174631Z-1231e26b`, session `1231e26b-be67-49a3-aff6-97f33f7cad27`.
- Started 2026-11-14T17:46:44Z, checks finished 18:10:13Z (about 25 minutes).
- Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no network, **no Docker daemon** (D-243 Q1). Everything Docker-related below ran against a **stub** `docker`. A stub is not a Docker engine.

## 1. Files changed

| File | Purpose | sha256 after |
|---|---|---|
| `deploy/scripts/image-bundle.sh` | `save` checks that each pinned image's local id is its lock digest, tags it as `<ref>:<tag>` and saves by that name. `images.json` gains `savedAs`. `load`/`verify` check both the Compose name and `savedAs`. `save` now also needs the containerd store. | `b8b5dfc1…a1ee41c` |
| `deploy/scripts/tests/image-bundle.test.mjs` | T-B12: a stateful stub `docker` that models the containerd store's naming on `load` (host run 2), plus 6 new cases. Existing cases were moved onto realistic store states. | `d7cd5c11…20a8ff1` |
| `deploy/scripts/tests/pin-images.test.mjs` | C2: per-file count of changed reference lines (compose is now 3). It asserts that the third compose line is the `backup` service on `postgres:18`. | `7509a2ec…6a0ecb13` |
| `docs/operations/restricted-network.md` | The operator text for save (tagging, refusals, `savedAs`), load (both names checked), exit 3 on save, and what the stub does and does not prove. | `3ede56ec…a7d8202` |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E4-evidence/*.log` | Logs of every check below. | — |

No `apps/api/test/support/p7-pending*.ts` entry relates to this task (grep for `image-bundle`/`pin-images`: 0 in every file), so none was removed. No product mutation was touched, so there are no new authorization, audit or concurrency obligations.

## 2. Behaviour delivered

**(1) The image bundle keeps image names (REQ-S19-018 image clause; ADR-0069 §6, A1.2, A1.3; host run 2 steps 04–09)**

Root cause, confirmed from `test-evidence/DG7/orchestrator/host/host-run.log`:
- `save` passed `postgres:18@sha256:5a5a…` and `quay.io/keycloak/keycloak:26.8.1@sha256:a78d…` to `docker save`.
- On the containerd store those entries loaded as `Loaded image ID: sha256:…` with no name.
- So the digest references did not resolve: `verify` reported `(present)` and `up --pull never` failed with `No such image`.

New `save`, for each lock image that a Compose file runs:
1. After `need_daemon`, it calls `need_containerd_store` (exit 3 on the classic store). On the classic store the image id is not the registry digest, so the next check could not pass anyway.
2. **Pass 1 (no change to the host):**
   - It reads the id of `<ref>:<tag>@<digest>`. If that id ≠ the lock digest, it exits 1 with `image-bundle: <name> does not match images.lock.json (local image id … is not the lock digest …)`.
   - If `<ref>:<tag>` already names a **different** image, it exits 1 with `… already names image …; this script never moves an existing tag …`.
   - An image that is not present is BLOCKED (exit 2), as before. Nothing is tagged until every image passes.
3. **Pass 2:**
   - It runs `docker tag <ref>:<tag>@<digest> <ref>:<tag>` and re-inspects `<ref>:<tag>`. If the id is not the lock digest, it exits 1.
   - It logs `tagged <ref>:<tag> (image id …); saved as <ref>:<tag>`.
4. One `docker save` with `<ref>:<tag>` for each lock image, plus the app image under its own name (never re-tagged).
5. `images.json` (still `mth-image-bundle/1`; the field is additive): `name` stays the Compose reference, and the new `savedAs` is the name in the archive.

`load`/`verify` (`check_ids`):
- They check that every `name` (each `<ref>:<tag>@<digest>` that Compose uses) and every `savedAs` resolve to the recorded `imageId`.
- A bundle without `savedAs` (written by the old `save`) gets only the name check, and it fails exactly as in host run 2.
- They never tag. No path rewrites an `image:` line or calls pull, login or push (the existing test still asserts this).
- Each `docker image inspect` inside a read loop now has `</dev/null`, so it cannot consume the loop's input.

New T-B12 cases (stub `docker` with a JSON image store; `load` restores no name for an entry saved under a digest name, as host run 2 observed):
- save tags every pinned image as `<ref>:<tag>` before the single `docker save`; the tags resolve to the lock digests; the app image is not tagged.
- **save → remove everything → load → verify:** `Loaded image: postgres:18` and the keycloak line, no `Loaded image ID:`, every `ref:tag@digest`, `ref:tag` and the app name resolve.
- load of an archive saved under digest names (the old format) exits 1 with `… does not match images.json (present)` for each pinned name.
- save refuses a local id ≠ lock digest (exit 1, no tag, no save).
- save refuses a taken `<ref>:<tag>` (exit 1, the tag is left as it was).
- save exits 3 on the classic store (no tag, no save).

**These tests fail on the old behaviour:**
- I ran the new test file against `git show HEAD:deploy/scripts/image-bundle.sh` in a scratch copy: exit 1, with 7 cases failing, including the round trip.
- The stub's output in that run reproduces host run 2 line for line: `Loaded image ID: sha256:5a5a…`, `Loaded image ID: sha256:a78d…`, `Loaded image: mth-app:local`, `postgres:18@sha256:5a5a… does not match images.json (present)`.
- Log: `image-bundle-test-on-OLD-script.log`.

**(2) pin-images C2**
- `deploy/compose/compose.yaml` has 3 pinned image lines: `db` (l.43), `keycloak` (l.139) and `backup` (l.258).
- The third line is intended. T-DG7-DO-F (`bd2daeffe`) added the `backup` profile service. ADR-0066 §5 places it "on the **already pinned** `postgres:18` image (same digest; no new image)", and `images.lock.json` already lists `deploy/compose/compose.yaml` in `postgres.usedIn`.
- C2 used to assert a total of 9. It now asserts per-file counts `{Dockerfile: 1, compose.yaml: 3, .github/workflows/ci.yml: 3, deploy/ci/ci.yml: 3}` (the total is now 10).
- It also asserts that the compose lines belong to the services `["db", "keycloak", "backup"]` with the bases `postgres:18`, `<keycloak ref:tag>`, `postgres:18`. A future extra image line therefore fails with its service named.

## 3. Checks run (real exit codes; logs in `docs/delivery/handbacks/DG7/T-DG7-DO-E4-evidence/`)

| Command | Result | Log |
|---|---|---|
| `node --test deploy/scripts/tests/image-bundle.test.mjs` | exit 0, 19/19 | `image-bundle-test.log` |
| Same test file against the HEAD (old) `image-bundle.sh` in `$TMPDIR` | exit 1, 7 failing (expected: proves the regression) | `image-bundle-test-on-OLD-script.log` |
| `node --test deploy/scripts/tests/pin-images.test.mjs` | exit 0, 13/13 (C2 failed before: `actual: 10, expected: 9`) | `pin-images-test.log` |
| `node --test deploy/scripts/tests/*.test.mjs` (all, no database) | exit 1: 148 pass, 33 fail | `deploy-node-tests.log` |
| Same suite without `backup-restore`/`transfer-drill` | exit 0, 125/125 | `deploy-node-tests-no-pg.log` |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0 | `openapi-lint.log` |
| `pnpm test` | exit 0, 415 s: unit-node 205 files / 3022 tests; unit-web 130 / 2175; nocodegen 3 / 259 (+2 skipped) | `pnpm-test.log` |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, 111/111, 111 s | `contract-integration.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |

About the 33 failures in the full deploy suite:
- All are in `backup-restore.test.mjs` (9) and `transfer-drill.test.mjs` (24).
- Each fails with `BLOCKED: TEST_DATABASE_ADMIN_URL is not set (run under tests/qa/support/with-pg.sh)`.
- They need a database and do not touch the files of this task. I did not re-run them under `with-pg.sh`.

**Not run:**
- Any real `docker save`/`tag`/`load` or `compose up --pull never`. No daemon is available here: **BLOCKED** for this run, and it belongs to the orchestrator's host run.

## 4. Known gaps

1. **Not proven on a real engine.** The fix follows the orchestrator's manual check (tag `ref:tag`, save by `ref:tag`, `ref:tag@digest` resolves after load). Only the stub has run it here. Host run 3 (steps 04–09) has to show:
   - `Loaded image: postgres:18` and the keycloak line;
   - load and verify exit 0;
   - `up --pull never --wait` reaches healthy, in both the default and the no-egress stack.
2. **ADR text conflict, to be decided by the architect.** ADR-0069 A1.2 rule 3 and §6 say "the bundle never re-tags images", and A1.2 says save uses the `<ref>:<tag>@<digest>` names. `save` now tags on the **connected** host. The target host is never re-tagged, and the digest pins and `image:` lines are unchanged, which was the reason alternative (a) was rejected. I cannot edit ADRs. A1.2 needs an amendment, or a decision entry, that records this.
3. **Side effect on the connected host.** After `save`, `postgres:18` and `quay.io/keycloak/keycloak:26.8.1` exist as local tags pointing to the pinned digests. The save never moves an existing tag that points elsewhere: it refuses with exit 1. On a host that pulled `postgres:18` by tag at another digest, the operator must remove or rename that tag first. The guide says so.
4. **`save` on the classic store** now exits 3. Before, it wrote a bundle that could never verify. This change is deliberate; it is disclosed here in case another script relied on the old behaviour (none found by grep).
5. ADR-0069 residual 8 ("not confirmed by a run here") in `restricted-network.md` is left unchanged. Host run 2 has since observed the containerd load behaviour. Updating that line belongs to whoever records the host run.
6. **Protocol deviation:** I ran the DG6 `--historical` validator at the end, not before implementing. It passed (exit 0).

## 5. Open questions / merge instructions

- **Q1 (architect):** amend ADR-0069 A1.2 rule 3 / §6 ("never re-tags") to: "save tags the pinned image `<ref>:<tag>` on the connected host, after an id = lock-digest check, and saves by that name; load/verify never tag". Or decide a different approach.
- **Q2 (orchestrator):** should a stale `postgres:18` tag on the connected host be removed automatically? Currently `save` refuses, which is the conservative choice.
- **Merge:** no migrations and no ordering constraints. The `images.json` `savedAs` field is additive under `mth-image-bundle/1`. Bundles written before this change must be re-saved: their load fails as in host run 2. Then re-run host run steps 04–09.
- This is a local Compose and stub demonstration, not evidence of high-availability production readiness. No business, Finance or IT approval is implied, and nothing here bears on product gates G1–G6 or on DG7 passing.
