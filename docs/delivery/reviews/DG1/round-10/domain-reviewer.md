# DG1 round 10 — domain-reviewer narrative

- **Candidate:** `sha256:18fee1617d617cfd719aeaebe3c37904bd116c47eaafb5be52e7bd779c6e8807`
- **Freeze commit:** `265af7e`. HEAD `241a377` adds only META_EXCLUDES metadata.
- **Run:** `DG1-T-DG1-REV-DOM-R10-domain-reviewer-20261001T143212Z-e2a85e66`
- **Verdict:** PASS, with one new Low, non-mandatory finding (proposed F-DG1-011).

## Owned finding
- **F-DG1-131: verified closed (CLOSED_VERIFIED).** The false sentence in D-055 ("the only built-ins … are the seven listed and the only process members are the four listed") has been replaced.
  - D-055 now says module source imports 4 of the 7 built-ins (`crypto`, `fs`, `path`, `url`) and uses none of the 4 process members.
  - It says the rest is "reviewed safe headroom … NOT claimed as current usage".
  - My independent TypeScript-AST inventory gives exactly that: crypto ×5, path ×3, fs ×1, url ×1, and zero `process` identifiers.

## F-DG1-130: over-reach only (the finding is code-security's)
- **No over-reach.**
  - The real module tree has zero violations.
  - Eleven positive controls stay clean, including ordinary `node:crypto` use (`randomUUID`, `createHash`, `createHmac`, `randomBytes`, `timingSafeEqual`, `webcrypto`, `getHashes`) and identifiers that merely contain "Engine".
  - The full unit suite passes 298/298 and the architecture suite 105/105.
- **The ban works.** All ten `setEngine` forms I wrote are denied: named, aliased, namespace, string key, destructured, renamed destructure, constructed key, template key, re-export and dynamic import.
- **The member audit holds on Node 22.22.2.** A name scan of the seven built-ins finds no loader member other than `setEngine`. The hits the header doesn't name are harmless: `os.constants.dlopen` is a set of RTLD_* numbers, `getFips` is a query, `openAsBlob` reads a file, and `ENGINE_METHOD_*` are numbers.
- **Observation:** the ban is name-based (like `require`/`eval`), so a module function named exactly `setEngine` would be flagged. No module has one, and the fix would be a rename.

## No regression
- The only product-tree change is the two build-excluded test files. The contract, data model, i18n, tokens and register are unchanged.
- **Integration:** 200/200, twice, on fresh PostgreSQL 16 clusters, with 0 57P01 errors.
- **Live AR/EN stack:** 108/108.
  - A transformation can't be closed by a status edit: the API returns 422 and cites G6.
  - Scoped access, identity, cursor pagination over six sorts, provisional branding, Unknown states (never 0 or green), and no off-origin requests all pass.
- I looked at the screens myself:
  - `ar-02-edit-no-closed.png`: RTL, the مؤقت (provisional) badge, only نشط/معلّق offered, the G6 hint, SAR and Asia/Riyadh.
  - `en-03-detail-audit.png`: LTR, the Provisional badge, Planned markers, Unknown indicators and a localized audit trail.
- The round-9 domain closures (001/002/003/004/005/006/105/007/008/207/009/210) hold.
- There are no open Critical, High or mandatory DG1 findings.

## New finding: proposed F-DG1-011 (Low, non-mandatory, owner delivery-orchestrator)
D-055 still doesn't fully describe its own evidence. This is the F-DG1-010 pattern again.
1. It calls the member audit "exhaustive" and says it is re-run "when the Node floor/target changes", but it never says the audit ran only on Node v22.22.2. The testkit header and the T-DG1-BE11 handback do say this, and the handback records Node 24, the production target, as **BLOCKED**. So the target has never been audited.
2. It keeps "closes the whole loader/exec class at once … prevents further adjacent-route findings". F-DG1-130 is exactly such an adjacent finding, and a later sentence in the same row now limits default-deny to modules, not members.
3. Minor: the Evidence column still cites the round-9 counts (101/101, 294/294).

There is no capability or runtime impact. The finding is a reasonable ACCEPTED_OBSERVATION once D-055 names the audited runtime and records Node 24 as not yet audited.

## Not checked (BLOCKED)
Neither the lint nor the member scan ran on Node 24. This sandbox has only Node 20, 21 and 22 and no network.
