# DG2 round 4: code-security-reviewer narrative (T-DG2-REV-SEC-R4)

**Verdict: PASS.** Candidate `sha256:29ced0ed896ab9bf559e15dbdb39495b3da7a60c170989631ad9caf9a792ce58`. I recomputed it on the working tree and in a fresh clone at `e37f6ea4`: 521 files. HEAD `bb4dd9c` differs from the source commit only by excluded delivery metadata (3 round-4 assignments, the manifest, `stages.json`). I authored no DG2 implementation. I formed this verdict without reading any other reviewer's round-4 record.

## F-DG2-160: CLOSED_VERIFIED
- **One predicate.** A single shared predicate is now used everywhere: `VISIBLE_CONTENT = /[^\p{White_Space}\p{Cf}ᅟᅠㅤﾠ⠀]/u` (`packages/shared/src/schemas/common.ts:46`).
  - It sits behind `hasVisibleContent`, `hasText`, the `freeText` refine and the new `trimmedText`, which backs the shared `name` and `reason`.
  - `hasExclusions`, the G1 criterion and the thesis composer go through `hasText`.
  - The two former inline reason parsers use the shared `reasonRequest`.
  - No inline free-text `z.string()` parser remains in `apps/api/src`.
- **Round-3 repro.** It now passes 5/5 in two runs on a disposable PostgreSQL.
- **Matrix.** All 18 round-3 code points and 11 more Cf/filler cases are rejected by `freeText`, `name` and `reason`. Visible Arabic with RLM, emoji ZWJ sequences and a leading ZWSP are accepted verbatim.
- **ReDoS.** None: it is one negated character class, and 10^7 invisible code units take about 0.2 s.

## New findings (both Low, non-mandatory; they do not block the round)
- **F-DG2-180 (REQ-PB-031).** Unicode `Default_Ignorable_Code_Point` characters outside `\p{Cf}` still count as content. These are the variation selectors U+FE00–FE0F and U+E0100–E01EF, CGJ U+034F, Mongolian FVS and the Khmer inherent vowels.
  - An Out of scope of `"️"` gets 201, the B0041 pre-check reads `pass`, and G1 does not list it as missing.
  - An archive reason of three U+FE0F gets 200.
  - Suggested fix: add `\p{Default_Ignorable_Code_Point}` to the shared class.
  - I raised this separately rather than reopening F-DG2-160. F-DG2-160's reported set and its stated remedy are fully fixed, and this is a different Unicode category.
- **F-DG2-181 (REQ-S16-007).** `displayNameOf` checks `hasText` on the whole claim, then stores `slice(0, 200)`.
  - A name of 200 × U+200B followed by visible text gives an invisible JIT display name.
  - It is display only: identity (iss, sub), sessions and authorization are unaffected, as my probe test 1 confirms.

## Re-review of the changes since round 3 (`9e13947e..e37f6ea4`, product code)
- **OIDC.** The change only selects the display name at JIT insert. Binding, sessions and roles don't read it, and a JIT user gets 0 scoped assignments.
- **Admin issuer check.** It now refuses `"‏"`, `"⁠"` and `"\u0085"` as an empty issuer (400 `/identity/issuer`). The order is unchanged: body validation before `requireOrgPermission`, as before.
- **Register archive / evidence-link remove.** Probed on a disposable PG, twice:
  - authz runs first: the auditor gets 403 with one `authorization.denied` audit, even with a blank reason;
  - an outsider gets 404;
  - a missing If-Match gets 428 and a stale one 409;
  - 5 invisible reasons each get 400 `validation.blank` at `/reason`, with 0 audit rows and the record unchanged;
  - a valid reason is stored trimmed with exactly one audit event.
- **Web forms.** RecordForm, CharterPage, DefinePage, GateDetailPage, JourneysSection, RowActions, ReasonDialog and Form.tsx:
  - text is sent verbatim, and only "" means no value;
  - blank text is refused inline with the shared `hasText`;
  - server field errors land on the field.
  - The client is never the only guard: the server schemas refuse the same values (blank-text.test.ts 20/20 and my probes).
  - No assertion was removed from a test file. exclusions.test.ts was reformatted, plus additions.
- **Diff scan.** No secrets, CDN URLs, eval or HTML sinks. `.github`, `deploy`, `package.json` and `pnpm-lock.yaml` are unchanged since round 3.

## Checks run (all real output; logs in `docs/delivery/test-evidence/DG2/code-security/round-4/`)
- **Static checks:** build, typecheck, lint, openapi:lint (161 operations), check:no-cdn and format:check all exit 0.
- **Unit tests:** 616/616 on Node 22 and Node 24, and again 616/616 on both under concurrent build and probe load (loadavg 10–14 on 4 vCPU).
  - The slowest test was the architecture AST walk, at 4.4 s against its explicit 30 s timeout.
  - The new web `p2-blank-forms` tests peaked at 3.2 s against the default 5 s.
- **Integration:** run twice on fresh PostgreSQL 16.13 clusters (ports 55581 and 55582), 465/465 each time.
  - Covered: 19 migrations, contract 161 ops, blank-text 20, oidc 20, admin 11.
  - AUD-403 sweep: aud-write-deny 128 and kpi-aud-write-deny 18.
- **Validators:** `validate.mjs --historical` passes for DG0 and DG1.
- **Environmental residuals:** live registry (D-057), live CI (D-058) and Keycloak (D-049) are recorded as PASS on the offline/config surface. They were not exercised live.
