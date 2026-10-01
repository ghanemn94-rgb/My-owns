# DG1 round 12: domain-reviewer narrative

- **Candidate:** `sha256:619d74ffa4e668933960fc14aa5d8c4c31850a2772972bceb647561be2efdfac`
- **Freeze commit:** `987ae02`
- **HEAD:** `e77be1a`, which adds only metadata the candidate excludes.
- **Run:** `DG1-T-DG1-REV-DOM-R12-domain-reviewer-20261001T160109Z-ba2fda48`

**Verdict: PASS. No new findings.**

## F-DG1-133 (Low, documentation accuracy): verified, CLOSED_VERIFIED

The testkit header has been corrected:

- The phrase "not closable statically" is gone.
- It no longer cites `identity/routes.ts` or `access/rules.ts` as code that rule 5 would break.
- The member audit now says the `node:crypto` enumeration route is closed by rule 5.
- Rule 5 is documented with every form it flags.

Residual (a) now describes only data flow over plain objects and third-party readers. That is accurate: the cited call sites enumerate `request.cookies` and `PERMISSIONS`, which are plain objects.

## Rule 5 scope

My probe (reviewer-authored, run in a disposable clone, 32/32 on Node 22.22.2 and on Node 24.21.0) showed:

- **Every namespace or default binding of `node:crypto` is flagged.** This includes `{ "default" as c }`, a template-literal `import()`, `import().then(enumerate)` and a bare `crypto` specifier.
- **Named crypto imports are unaffected.**
- **The other allow-listed built-ins are unaffected.** Namespace and default imports of fs, fs/promises, os, path, url and util still pass.
- **Plain-object enumeration is unaffected.**
- **The real module tree is clean.** All 13 real modules have zero violations, and all 13 `node:crypto` imports in source are named imports.

## No regression

The diff since round 11 touches only the two test-only lint files, and `tsconfig.build.json` keeps both out of the build. The table lists the test results:

| Suite | Node 22 | Node 24 |
|---|---|---|
| Unit | 315/315 | 315/315 |
| Architecture | 122/122 | 122/122 |
| Integration (throwaway PostgreSQL 16) | 200/200 | 200/200 |
| Live AR/EN scenario | not run | 108/108 |

The live scenario confirmed these behaviours:

- **Closure:** refused with 422 citing G6, and the record is unchanged.
- **Branding:** provenance is provisional.
- **Pagination:** cursor pagination works over all six sorts, and misused or tampered cursors get 400.
- **Access:** lists are scoped.
- **Identity:** cookie and session handling is correct.
- **Rendered screens:**
  - Arabic is RTL and English is LTR.
  - The wordmark is labelled Provisional.
  - Missing data shows Unknown, never zero.

The register is unchanged. All 12 DG1-final rows are IMPLEMENTED with their evidence present. The 29 P1-increment rows for later gates stay SPECIFIED. The prior domain closures still hold. No Critical, High or mandatory finding is open.

## Environment note

`pnpm install --offline` in the clone failed with EROFS, because the sandbox's pnpm store is read-only. I copied the workspace `node_modules` trees into the clone instead. The lockfile is identical.

I grant no business, Finance or IT approval. Product gate G6 is not engineering gate DG7.
