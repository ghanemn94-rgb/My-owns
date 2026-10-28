# Handback T-DG6-BE-H (backend-workflow-engineer): fake S3, the contract suite, the S3 adapter

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section `docs/architecture/p6-work-split.md` §J/C.8.
- **Invocation:** `DG6-T-DG6-BE-H-backend-workflow-engineer-20261028T181139Z-0984dcc8`, session `0984dcc8-f4d2-4fd9-bd09-7d0444d37cd4`.
- **Working tree:** worktree `/home/user/wt/dg6-be-h`, branch `dg6/be-h`, base `HEAD` `80464fa` (full id in `git rev-parse HEAD` of the branch). Changes are **uncommitted**, as the assignment asks.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-H.md`, sha256 `b0389a5c…70e2` (verified at start).
- **Time:** start `2026-10-28T18:28:49Z`, end `2026-10-28T20:17:09Z` (`date -u`; about 110 minutes).
- **Two gate systems:** nothing here reads or writes DG0–DG7 records or any product G1–G6 approval. All bytes in the tests are SYNTHETIC. No live object store was used or is claimed (§2 rule 14). No task claims IT approved a store.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (run at start; `T-DG6-BE-H-evidence/validate-dg5-historical-start.txt`). Re-run at the end: `PASS gate DG5 (historical)`, **exit 0** (`validate-dg5-historical-end.txt`, 20:13–20:16Z).

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/evidence/store.ts` (modified) | Keeps the `EvidenceStore` port, errors, constants and `evidenceStoreFor` (unchanged). The filesystem class moves out to `stores/filesystem.ts` and is re-exported, so every importer (`routes.ts`, `preview.ts`, `evidence.test.ts`) is unchanged. A doc comment on the interface lines states the ADR-0054 §2 rule: no method returns a URL, and no adapter creates one or sets an ACL. |
| `apps/api/src/modules/evidence/stores/filesystem.ts` (new) | The filesystem adapter, moved **byte for byte** (diff against `HEAD`: identical; `filesystem-move-identical.txt`). |
| `apps/api/src/modules/evidence/stores/s3.ts` (new) | `S3EvidenceStore`, the S3-compatible adapter over `@aws-sdk/client-s3@3.1156.0` (Option A, D-197; already pinned, no dependency added). Also `S3_MULTIPART_THRESHOLD_BYTES`, `EvidenceObjectNotFound` and `anonymousReadRefused(key)` (for BE-H2's storage test). |
| `apps/api/src/modules/evidence/stores/contract.ts` (new) | `describeEvidenceStoreContract(name, makeStore, runner, { networkSurface })`: the one contract suite. It is framework-free (`node:assert`; the runner's `describe`/`it` are passed in), so no test framework is imported into the API build. |
| `apps/api/test/support/fake-s3.ts` (new) | `FakeS3`: an in-process S3-protocol fake that verifies SigV4 (path-style PutObject, GetObject, HeadObject, DeleteObject, CopyObject, ListObjectsV2, multipart create/part/complete/abort). It listens on a random port from `MTH_PORT_POOL` (default 25000–31999, below the ephemeral range) and never on port 0. `sigV4Signature()` is exported so the verifier can be checked against AWS's published example. |
| `apps/api/test/integration/evidence/store-contract.test.ts` (new) | The suite × 2 adapters, plus the S3-specific cases (§2). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-H-backend-workflow-engineer.md`, `…/T-DG6-BE-H-evidence/*` (new) | This handback and its logs. |

No migration, no contract (`openapi.yaml`) change, no zod change, no permission change, no dependency added, no i18n file touched.

## 2. Behaviour delivered

### REQ-S16-006, acceptance: "A18;A12: contract tests pass for both adapters; evidence is never served from a public URL"

BE-H's share (§J/C.16: BE-H, BE-H2, DO-C, FE-B):

- **Contract tests pass for both adapters.** `store-contract.test.ts` runs the one suite for the filesystem adapter (a fresh temporary directory per case) and for the S3 adapter (a fresh key prefix per case on the SigV4-verifying fake). It covers every ADR-0054 §2 contract case:
  - round-trip of bytes, SHA-256 and size (strings and byte chunks, an empty body, a single `Uint8Array`, and a 17 MiB body above the multipart threshold);
  - `maxBytes` enforced **while streaming**: `EvidenceTooLarge`, the body is not drained (3 chunks pulled of 100), nothing left behind. Also after a multipart part was already stored;
  - a body failing mid-stream (a client abort) is rethrown and leaves nothing;
  - a temporary object is never readable through `get` (and `head` is null) until `finalise`, which makes it readable and removes the temporary;
  - `discardUncommitted` is idempotent (on a temporary, a final object and a never-written key);
  - the sweep removes only temporaries older than the threshold. It leaves a fresh temporary (still finalisable), an old final object and an old non-UUID `.part` name alone, and reports `{removed: 1, keptFresh: 1}` with the relative key, size and age;
  - `head` of a missing key is null, and `get` of a missing key is refused as not-found, **never** `EvidenceStoreUnavailable` (the route keeps 404, not 503);
  - concurrent `receive` of two keys does not mix bytes;
  - keys that are not opaque relative identifiers are refused;
  - **an anonymous read is refused (s3: HTTP 403).** This case is registered only for a store with a network surface. The filesystem store has none (its files are never web-served, ADR-0010 §2), so the case is not claimed for it; it is not skipped silently;
  - **the adapter returns no URL anywhere:** no result, sweep callback payload or error message contains `scheme://`. For S3 they also never contain the endpoint, host, bucket or access-key id.
- **S3-specific proof** (same file, `S3 evidence store: adapter-specific behaviour`):
  - ≤ 8 MiB is one PutObject to `<prefix>/<key>.part`, then finalise = CopyObject + DeleteObject;
  - \> 8 MiB is multipart (20 MiB → create, 3 parts, complete), buffering one part at a time;
  - a body failing after a stored part is AbortMultipartUpload + DeleteObject, with no open upload left;
  - every request is SigV4-signed (the fake verified each) and **none carries `x-amz-acl`/`x-amz-grant-*` or a pre-signed `X-Amz-*` query**;
  - the fake refuses an anonymous GET, a pre-signed query and a one-character-tampered signature (403), and serves the correctly signed request (200);
  - a wrong secret key, an unknown access key or an unresolvable `SecretRef` is `EvidenceStoreUnavailable` (the route's existing 503 `unavailable`) on put, get and head, with no secret, URL or host in the message;
  - an unreachable store is `EvidenceStoreUnavailable` with no URL in the message;
  - the sweep follows ListObjectsV2 continuation tokens (page size 2, 5 temporaries) and never touches another prefix;
  - no prefix means keys at the bucket root;
  - invalid bucket names and key prefixes are refused at construction;
  - `anonymousReadRefused` is true against the fake and false (fails closed) against a deliberately public fake bucket, and on a 404.
- **The fake itself is checked:** `sigV4Signature` reproduces AWS's published S3 example signature (GET Object, single chunk: `f0e8bdb8…6bdb41`). A mutation check (signature comparison disabled) fails 2 tests and passes 37 (`mutation-check.txt`, including the disclosure that a first tamper test did not bite and was rewritten).
- **Never public, never pre-signed:** the adapter imports no presigner, creates no URL, sets no ACL. `get` streams the object through the caller (the API route that authorizes the parent record, ADR-0051 §4). Credentials are `SecretRef`s resolved through the ADR-0052 §5 registry at request time. `SecretValue.reveal()` is called only inside the SDK credential provider.
- **Not delivered by BE-H (BE-H2, §J/C.9):** "an S3-compatible adapter is configurable". Driver selection (`storage_setting` row, else environment), `evidence_content.storage_driver` on upload, Administration > Storage and the three storage operations are BE-H2's. **Until BE-H2 merges, `EVIDENCE_STORAGE_DRIVER=s3` still answers 503 exactly as at DG5**, and the row is therefore not complete with BE-H alone.

## 3. Checks (real exit codes; logs in `docs/delivery/handbacks/DG6/T-DG6-BE-H-evidence/`)

Environment: Node 24.21.0, offline, PostgreSQL 16.13 disposable cluster (`with-pg.sh`), harness ports 23850–23899 only.

**Read this first (evidence honesty).** The run passed the 100-minute mark while the full suites were still running on a heavily loaded host. Two real defects in my code were found by the first full `pnpm test` and fixed. That left the full suites on the final tree **not completed at handback time**. Every result below is labelled with the tree it ran on.

### 3.1 Results on the final tree (after the last code edit)

| Check | Command | Exit | Result |
|---|---|---|---|
| Lint | `pnpm lint` | **0** | `lint-final.log` |
| API typecheck (the only package changed) | `cd apps/api && npx tsc -p tsconfig.json` | **0** | Run after the last code edit (the `ContractAssert` annotation); no output. See also 3.3. |
| ADR-0002 module boundaries | `npx vitest run --project unit-node apps/api/src/architecture.test.ts` | **0** | 141/141 (`architecture-test-final.log`) |
| Evidence unit tests (unchanged file) | `npx vitest run --project unit-node apps/api/src/modules/evidence/evidence.test.ts` | 0 | 13/13, including "its declared boundary holds" |
| Store contract suite (integration project) | `QA_PG_PORT=23855 MTH_PORT_POOL=23856-23859 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/evidence/store-contract.test.ts` | **0** | **39/39** on the final tree (`store-contract-final.log`): filesystem 13 + s3 14 (the anonymous-read case is registered for s3 only) + 12 S3-specific. |
| SigV4 verifier mutation check | see `mutation-check.txt` | — | normal 39/39; mutant 2 failed / 37 passed; restored (cmp identical). Run before the 3.4/3.5 edits, which did not touch the verifier. |
| Filesystem move | diff against `HEAD` | 0 | IDENTICAL (`filesystem-move-identical.txt`) |
| Preceding gate | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` (start). End: exit 0 (`validate-dg5-historical-end.txt`). |

### 3.2 Full runs on the final tree: started, NOT complete at handback (not claimed)

Started at about 19:56Z by `final-static.sh` / `final-tests.sh` (copied verbatim into the evidence folder). Each writes `EXIT=<n>` as its last line when done:
- `build-final.log` (`pnpm -r build`), `prettier-final.log` (`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`), `openapi-lint-final.log` (`pnpm openapi:lint`);
- `test-locale-unset-final.log` (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test`), `integration-final.log` (`QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration`), `test-c-utf8-final.log` (`LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`).

**Update at 20:27Z:** the static lane finished on the final tree:
- `build-final.log` (`pnpm -r build`): **exit 0** (20:22:52Z);
- `prettier-final.log` (whole repo): **exit 0**, "All matched files use Prettier code style!" (20:26:43Z);
- `openapi-lint-final.log`: **exit 0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 931 operations`.

**Status at handback (about 20:16Z):**
- `build-final.log`: running, no `EXIT` yet.
- `prettier-final.log`, `openapi-lint-final.log`: not started (they follow the build).
- `test-locale-unset-final.log`: still running.
  - **unit-node finished: 3 failed / 2464 passed (2467), all three timeouts** in files I did not touch:
    - `architecture.test.ts` "apps/web never imports @mth/db or @mth/config" (30 s);
    - `server.test.ts` "declares access on every /api route…" (5 s);
    - `reporting/branding-layout.test.ts` "PDF > a configured branding…" (5 s).
  - In isolation on the same tree: `architecture.test.ts` 141/141 (`architecture-test-final.log`), and `server.test.ts` + `branding-layout.test.ts` 11/11 (`timeout-rerun-final.log`, exit 0). The timeouts are therefore load-induced on this host (several full suites running concurrently, including my superseded ones in 3.3). That is still a non-zero exit, and it is disclosed as one.
  - unit-web and unit-formula-nocodegen of this run: not finished.
- `integration-final.log`, `test-c-utf8-final.log`: not started (they follow the run above).

The orchestrator must read those `EXIT=` lines (or re-run the commands on the merged tree) before relying on acceptance items 1–3. **I do not report them as passed.**

### 3.3 Full runs on EARLIER trees (superseded; disclosed)

| Log | Tree | Exit | What happened |
|---|---|---|---|
| `typecheck.log` (`pnpm -r typecheck`, 18:59Z) | before the boundary fix | **0** | All packages. The packages other than `@mth/api` have not changed since. |
| `build.log`, `lint.log`, `prettier.log`, `openapi-lint.log` | before the boundary fix | 0, 0, 0, 0 | openapi: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 931 operations`; Prettier: all files. |
| `typecheck-final.log` (`pnpm -r typecheck`, 19:56–20:12Z) | final | **137** | **Killed by SIGKILL** in `@mth/api` `tsc` (memory pressure: four or more suites were running on the host). It printed 0 `error TS` lines, but it is **not a pass**. The direct API `tsc` in 3.1 is the final-tree proof. |
| `test-locale-unset.log` (`pnpm test`, locale unset) | before the boundary fix | **1** | unit-node: 2 failed / 2465 passed (2467): **my defects**, `architecture.test.ts` "every import respects dependsOn…" and `evidence.test.ts` "its declared boundary holds". `stores/contract.ts` imported `node:assert/strict` (not on the D-055 built-in allow-list), and `contract.ts`/`s3.ts` used three computed member accesses with non-literal keys. **Fixed** (3.4) and re-verified (3.1). unit-web: 2 failed / 1766 passed (1768): `raid.test.tsx` "action register…" and `traceability.test.tsx` "Portfolios and workstreams (ar)…" (`Unable to find role="button"`), plus 2 vitest-worker `onTaskUpdate` RPC timeouts. These are web files I did not touch; they look load-induced, not proven either way. unit-formula-nocodegen: 259 passed, 2 skipped. |
| `test-c-utf8.log` (`pnpm test`, C.UTF-8) | mixed: files changed during the run | — | 3 failed / 2464 passed in unit-node, all **timeouts** (`architecture.test.ts` dependency direction at 30 s; two `server.test.ts` route-registration tests at 5 s) under load. Superseded. |
| `integration.log`, `integration-full.log` (`pnpm test:integration`) | mixed: started before the fix | — | Superseded, not evidence for the final tree. I could not stop them: each shell runs in its own PID namespace, and I have no task-stop tool. They may still be running and writing. |

### 3.4 The fix after the first full run

- `stores/contract.ts`: `node:assert/strict` replaced by four local assertions (`ok`, `equal`, `deepEqual`, `rejects`) over `node:util`'s `isDeepStrictEqual`, typed through `ContractAssert`. `bytes[i] = …` became `bytes.writeUInt8(…, i)`.
- `stores/s3.ts`: `body[Symbol.asyncIterator]` became `Symbol.asyncIterator in body`, and `segments[KEY_DEPTH]` became `segments.at(KEY_DEPTH)`. No behaviour change.

### 3.5 An earlier misreading (disclosed)

At 18:40Z I read a background `tsc` as passing. Its exit code 0 was that of a trailing `| tail`, not of `tsc`. The full `pnpm -r typecheck` then showed 13 TS errors in my two test files (index-signature access, and a parameter property under `erasableSyntaxOnly`). They were fixed before every result in 3.1.


## 4. Operations routed (delta to my pending list)

None. §J/C.8 assigns BE-H no operation and there is no `p6-pending-be-h.ts`. `contract.test.ts` pinned counts are unchanged: operation count 931, media types, rate-limit floor and CSRF-exempt routes all untouched. The three storage operations stay in `p6-pending-be-h2.ts` for BE-H2.

## 5. For the orchestrator (contract, schema, dependency, ordering)

1. **No contract, schema, migration or dependency need.** `@aws-sdk/client-s3@3.1156.0` was already pinned in `apps/api/package.json` (D-197/D-200). Only `@aws-sdk/client-s3` is imported (no `@smithy/*` or `lib-storage` direct import). The request-handler timeouts use the SDK's options object.
2. **Remote I/O inside a transaction once S3 is selected (for BE-H2; §2 rule 4).** `evidence/routes.ts` (not my file; BE-D/BE-H2) calls `store.finalise(key)` **inside** the upload transaction (after the audit `record`, before commit). In filesystem mode that is a local rename. In S3 mode it is CopyObject + DeleteObject, which is remote I/O in a transaction. BE-H2 must reorder it when it wires the S3 driver. One option: `receive` → `finalise` → transaction (content row, audit) → on any error `discardUncommitted`, so the row commits only after the final object exists and a rollback removes it. That leaves a final object without a row if the process dies between `finalise` and the commit, which is the trade-off to decide. I did not change `routes.ts`, which my section does not own.
3. **Incomplete multipart uploads after a crash.** If the API process dies in the middle of a > 8 MiB `receive`, the store keeps an incomplete multipart upload. It is not an object, so `sweepStaleTemporaries` (ADR-0054 §2: lists `*.part` objects) cannot see it. Recommendation for DO-C's `docs/operations/storage.md`: IT sets the bucket lifecycle rule `AbortIncompleteMultipartUpload` (for example 1 day). Adding ListMultipartUploads to the sweep would need an ADR-0054 §2 amendment.
4. **Memory:** an S3 upload buffers at most one 8 MiB part (plus the current chunk). Concurrent uploads multiply that.
5. **Checksum mode:** the client sets `requestChecksumCalculation`/`responseChecksumValidation` to `WHEN_REQUIRED`, so bodies are plain signed single-chunk payloads. Without it, SDK ≥ 3.729 sends `aws-chunked` CRC trailers that many S3-compatible stores reject. Integrity is still the SHA-256 the adapter computes while streaming, which is stored in `evidence_content.sha256` and sent as the download `Digest`.
6. **ADR-0054 vs the work split on the store.ts header comment:** ADR-0054 "Consequences" says BE-H updates the DG2 comment ("configuring it here makes every content operation 503"). §J/C.9 assigns "the stale DG2 comment in store.ts" to BE-H2. After BE-H the comment is still **true** (no driver selection yet, `s3` still 503), so I left it for BE-H2, who makes it untrue.
7. **For BE-H2:** `new S3EvidenceStore({endpoint, region, bucket, keyPrefix, forcePathStyle, accessKeyRef, secretKeyRef, secrets})` takes the `storage_setting` columns directly. `secrets` is the server's `SecretProviderRegistry`. `anonymousReadRefused(key)` is the ADR-0054 §2 "unauthenticated GET of the probe key is refused" check. `destroy()` closes the SDK pool. `describeEvidenceStoreContract` can be reused for any further adapter.

## 6. User-facing texts made untrue

- **en/ar UI strings:** none. BE-H ships no UI, no route and no driver selection; `EVIDENCE_STORAGE_DRIVER=s3` still answers 503 (unchanged). The `storage.*` problem texts already exist (FE-A).
- **Operator documentation (not mine; for its owner, DO-C / BE-H2):** `docs/operations/configuration.md` §"Evidence storage" says "The optional S3-compatible adapter is a later-stage item (P6)." The adapter now exists in code but becomes selectable only with BE-H2. The sentence becomes untrue when BE-H2 merges and should be corrected then (DO-C's `storage.md` is the planned home).
- `evidence/store.ts` header comment: see §5.6 (BE-H2).

## 7. What remains

- **Code:** BE-H's §J/C.8 scope is complete: the fake, the suite × 2 adapters, the S3 adapter and the filesystem move.
- **Verification not completed on the final tree (the time limit was reached; see §3.2):**
  - acceptance 1: only `pnpm -r typecheck` is open (killed, 137; the direct API `tsc` is 0). Build, lint, Prettier and openapi:lint exit 0 on the final tree;
  - acceptance 2: `pnpm test` with the locale unset (unit-node 3 timeout failures, passing in isolation; the rest not finished) and with `C.UTF-8`;
  - acceptance 3: the full `pnpm test:integration`.

  The scripts are running and write their logs to the evidence folder. Acceptance 1–3 must be confirmed from their `EXIT=` lines, or by re-running them on the merged tree, before this task counts as verified.
- REQ-S16-006 as a whole still needs BE-H2 (driver selection, `storage_driver`, Administration > Storage, the export-file store, the "no redirect to the store" download test), DO-C (documents) and FE-B (page).
- Live IT object store: a residual (never claimed live). SeaweedFS licence verification is DO-C's.

## 8. Merge instructions

- No migration and no ordering constraint beyond §J/C.15: BE-H before BE-H2. BE-H2 edits `store.ts` (driver selection lines) and `routes.ts` after this.
- Expected conflicts: none. The only modified tracked file is `apps/api/src/modules/evidence/store.ts`.
- `pnpm test:integration` gains one file, `apps/api/test/integration/evidence/store-contract.test.ts` (39 tests; no pinned count changes, as far as I know: none in the repository counts integration tests). It uses no database but needs the integration project's harness port pool.
