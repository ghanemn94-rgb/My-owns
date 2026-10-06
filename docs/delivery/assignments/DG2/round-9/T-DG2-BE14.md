# Assignment T-DG2-BE14: every operation accepts only its declared request media types (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Concurrency:** no other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline.
- **Browser:** use the pre-installed Chromium and never run `playwright install`.
- **Ports:** below 32768 (the harnesses retry on collision).
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Finding:** full text in `docs/delivery/findings.json`; the reviewer's repro is under `docs/delivery/test-evidence/DG2/code-security/round-8/`. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair
**F-DG2-320 (Low, REQ-DLV-034).** `uploadEvidenceContent` declares only `application/octet-stream`, yet the route accepts other media types:
- A chunked `text/plain` upload is stored with its invalid UTF-8 bytes rewritten to U+FFFD (Fastify's built-in text/plain parser decodes it). The response is 200, and the stored sha256 is computed over the rewritten bytes.
- An `application/json` object or array body produces an **undeclared 500**.
- A JSON string body stores its decoded text.

This is the faithfulness rule of F-DG2-290 applied to evidence: client bytes are never silently rewritten and never answered with an undeclared status.

## Required: fix the class
1. **Declared media types only, for every operation.**
   - Each route accepts only the request media types its operation declares in `docs/api/openapi.yaml`: 86 operations use `application/json` and 2 use `application/octet-stream`. Any other declared or undeclared media type is refused with the existing 400 problem `validation.content_type`, before anything is read into a handler or stored. It must never be a 500.
   - Remove Fastify's built-in `text/plain` parser, unless some operation declares `text/plain`; it does not.
   - Restrict the octet-stream parser to the operations that declare it, so that a JSON operation sent `application/octet-stream` also gets the declared 400.
   - Implement the restriction once (for example a route-level `consumes` set derived from the contract, enforced in a central hook), not as a per-route patch.
2. **Evidence upload.** The bytes stored are exactly the bytes the client sent: the sha256 covers the raw bytes, and size limits still apply. Behaviour for valid `application/octet-stream` uploads is unchanged.
3. **Sweep.**
   - List every operation with a request body and its accepted media types, before and after.
   - Confirm that bodiless operations (GET, archive with an empty body, and so on) still behave as today, including the empty-body rules.
4. **Tests.**
   - **Integration:**
     - `uploadEvidenceContent` with `text/plain` (Content-Length and chunked) and with `application/json` (object, array, string) → 400 `validation.content_type`, nothing stored, no audit row.
     - A JSON operation sent `text/plain` or `application/octet-stream` → 400.
     - A valid octet-stream upload still stores the exact bytes (sha256 matches the raw input).
     - A valid JSON request still works.
   - **Contract:** add a check that every operation refuses an undeclared media type with a declared 400.
   - **Negative control:** the new tests fail on the old code.

## Self-verification (real output in the handback)
Run all of these in **both locale settings** (`env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`):
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite, **twice per locale setting**, including `contract.test.ts`, `invalid-utf8.test.ts` and the evidence tests
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`); the evidence upload journey must still pass
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE14-backend-workflow-engineer.md` with the fix, the media-type sweep table and every check's real output. Keep evidence to logs only.
