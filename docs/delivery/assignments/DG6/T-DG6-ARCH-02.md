# Assignment T-DG6-ARCH-02: P6 architecture, slice(s) J + C (solution-architect)

## Stage and base

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING), on branch `claude/mobily-transformation-platform-dg5-regate2`, at the current `HEAD`.
- **Preceding gate:** DG5 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG5` and report the result. It must exit 0.
- **The plan is binding:**
  - `docs/architecture/p6-plan.md` (T-DG6-ARCH-00), adopted by **D-195**;
  - the decisions on its open questions Q1–Q14 and reopen candidates, in D-195 in `docs/delivery/decisions.md`. Read D-193, D-194 and D-195 verbatim.
- **You run alone on the shared contract files** (p6-plan §5.3). Implementer runs may be active in their own git worktrees, but they do not touch your files.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Your slice (p6-plan §4, row T-DG6-ARCH-02)

- **Slices:** J + C. Read p6-plan §1.1 and §1.2 for their rows, §2 for the dependencies, §3 for the seams and §6 for the risks and questions.
- **ADRs:** **ADR-0053** operations and service identities: service identity per job code and connector (declared scope, `ReadScope` reads, parity), operational exceptions (one per source and failure class, dedup key, open/acknowledged/resolved, link to stale KPIs), the catalogue triggers of §3 row 8, structured logs, the redaction list (secrets from `SecretProvider`, storage keys and URLs, tokens), the post-suite log scan, worker heartbeat and error alerts, Administration > Operations. **ADR-0054** identity, storage and channels: issuer and audience rejection, the Keycloak test realm and its image (D-049, Q5), the SAML broker document, Administration > Identity; the S3-compatible `EvidenceStore` adapter, one contract suite for both adapters, the test store (Q6), Administration > Storage; the `NotificationChannel` port, in-app always, the optional email adapter (Q7), outbox fan-out, idempotency, Administration > Notifications. Each dependency is verified against official documentation, support window and licence before pinning.
- **Migration range:** 0104–0108. Write from the low end. The numbers you leave free are for your slice's implementers, in the order your work-split section names. Never use a retired P5 gap id.
- **OpenAPI area:** `admin/operations/exceptions` (list, get, acknowledge, resolve), `admin/operations/heartbeat`, `admin/service-identities` (list, get, put), `admin/identity` (get), `admin/storage` (get, put, test), `admin/notification-channels` (list, get, put, test) (≈ 18)
- **Advisory-lock classes:** 730305 operational exception upsert (per source and class); 730306 channel delivery (per notification and channel); 730307 storage migration/test (one key); 730308–730309 reserved

## Requirements in scope (5 rows, final gate DG6)

Their `acceptance` texts in `docs/delivery/requirements.csv` are binding, and reviewers test them literally. Read each row's `increments`: P1–P5 already deliver part of most rows (p6-plan §1.2 says what is missing).

- **REQ-S12-019** (-): Starter automation: when a connector or job fails or data becomes stale, create a visible operational exception and retain last known values with freshness labels
- **REQ-S16-029** (-): Give each connector and background job a constrained service identity, and never expose secrets or private evidence URLs in client code or logs
- **REQ-S12-023** (-): Always provide an in-app inbox; treat email and enterprise messaging as optional IT-configured adapters whose absence never breaks workflows
- **REQ-S16-006** (-): Provide an evidence-storage adapter with a private filesystem option and an optional IT-approved object-store adapter
- **REQ-S16-007** (-): Integrate enterprise identity through OIDC, document a SAML broker/adapter where needed, and use a self-hosted identity provider such as Keycloak for portable integration tests

## Inputs

- **The master prompt** (`docs/source/master-prompt-v2.0.md`, with the anchors in `master-prompt.anchored.md`): the sections p6-plan cites for your slices.
- **The playbook** (`docs/source/playbook.md`): the template blocks for your slices. Cite `B0xxx`.
- **What exists:**
  - ADR-0001 to ADR-0050 with their dated amendments, plus the P6 ADRs already written;
  - migrations `0001`→ latest;
  - the erd and the data dictionary;
  - `openapi.yaml`;
  - `apps/api/src/modules/**`;
  - `packages/shared/src/{calc.ts,formula/**}`;
  - p4/p5 plans and work-splits, p6-plan, and p6-work-split if it exists.

## Deliverables, in this order

The critical path is deliverables 1–3. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback, listing exactly what remains for a continuation task. Never leave a half-written file.

1. **ADRs.** Write them in the existing Context / Decision / Alternatives / Consequences / Verification format. Every claim must be **enumerated and exactly true, never absolute** (D-088 §2, D-141, D-193; F-DG3-100). Where a design point has a source text, quote it, and cite the master-prompt anchors `M0xxx` and the playbook blocks `B0xxx`. For each requirement in scope, the ADR must name:
   - the entity and the fields;
   - the state machine, if any;
   - the exact refusal codes and their English texts, taken from the acceptance texts;
   - the authorization: permission, role defaults, AUD read-only, and SoD where it applies;
   - the decimal and Unknown semantics.
2. **Migrations and schema types.**
   - Write your range's migrations, forward-only, with the P2 guard pattern on every new mutable table:
     - `p2_attach_guards`;
     - version stepping by 1;
     - the deferred audit-coverage constraint;
     - append-only history;
     - `timestamptz`;
     - `numeric` for money, rates and FTE;
     - CHECK constraints for the closed sets.
   - Include any seeds the acceptance texts require. Mark source seeds verbatim and bilingual, with the provisional-Arabic label where needed.
   - Update `packages/db/src/schema.ts` (Kysely), the catalogue and seed test pins, and `packages/shared/src/permissions.ts` (`P6_PERMISSIONS`; technical-admin roles never get business-approval rights, S10-003).
   - Register your advisory-lock classes in `apps/api/src/modules/platform/advisory-locks.ts` and the ADR-0016 §6 registry, and keep the distinct-classes test green.
3. **Probe (real output, in the handback).** On a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, your port range):
   - apply `0001`→ your last migration to an empty DB, and also over a DB populated by `0001`–`0097`;
   - prove that each new guard fires: missing audit fails at COMMIT, a non-stepping version fails, UPDATE/DELETE on history fails, and every database invariant your ADR claims holds.
4. **ERD and data dictionary.** Extend `docs/architecture/erd.md` and `data-dictionary.md` with every new table, matching the migrations exactly.
5. **Contract.** Extend `docs/api/openapi.yaml` (OpenAPI 3.1) with your slice's operations.
   - Set `info.version` to `1.5.0-p6`.
   - Keep every P1–P5 path byte-stable except the extensions D-195 accepts.
   - Every operation declares the ADR-0007 §5b statuses, its request media type (= the route's future `config.consumes`), problem+json, `If-Match`/ETag and cursor pagination.
   - Add your operations to a new `apps/api/test/support/p6-pending-<your task>.ts` list, so `contract.test.ts` stays green until the implementers route them (the P3/P4 `p*-pending-*` precedent). Update `contract.test.ts`'s pins only as that pattern requires, and report the new counts.
   - `pnpm openapi:lint` must pass.
6. **Permissions matrix and work split.**
   - Add your entities' rights to `docs/analysis/permissions-matrix.md`, with AUD read-only everywhere.
   - Write your slice's section of `docs/architecture/p6-work-split.md`, following `p5-work-split.md` and p6-plan §5. Include:
     - the implementer tasks for your slice, each sized at about 60–75 minutes;
     - exact, non-overlapping file ownership;
     - the contracts each task consumes;
     - the integration order;
     - a requirement → owner table for your rows.
   - If the file does not exist yet, create it with the shared rules section (§2, the numbered lessons below) and your slice's section.

## Lessons from DG2–DG5 that P6 builds in (state them as implementer rules)

1. **Free text** uses the shared `freeText`/`hasText`/`hasInvalidCharacter`/`truncateText` rules.
2. **Strict UTF-8** JSON and query parsing applies to every route.
3. **`config.consumes`** equals the operation's request media type.
4. **Every mutation needs:**
   - authorization re-checked at commit time;
   - validation;
   - `If-Match` (409/428);
   - an audit event;
   - no remote I/O inside a transaction;
   - a test for each.
5. **Decimal only** for money, rates, FTE and KPI values. Unknown, Stale or Not computable is never shown as 0 or green.
6. **Bilingual text,** Arabic RTL and English LTR, translated at render time. Problem codes are translated too.
7. **Web forms** have one form-level alert; actions are session-bound (`auth/sessionBound.ts`); the AUD user sees read-only views; the label is "business approval", never DG0–DG7.
8. **Ports** stay below 32768, and verification runs with the locale unset and with `C.UTF-8`.
9. **The formula engine** (`packages/shared/src/formula/**`) is reused unchanged. Any change to it is a reopen candidate.
10. **Exactly once.** Jobs and automations use the advisory-lock registry, unique backstops and idempotency keys; a replay creates nothing (DG4 S12-021 pattern).
11. **Value bases are never mixed** (D-117, D-119, D-122), and every number states its unit kind (ADR-0037 N5).
12. **User-facing text is true for the release it ships in** (F-DG4-160): when a P6 feature ships, the texts that called it planned are updated; texts for P7 features stay.
13. **Tests are deterministic under load** (F-DG4-143 to F-DG4-148) and never read growing delivery folders (D-138).
14. **Honest live-integration status:** an adapter that cannot be exercised live here (enterprise IdP, object store, SMTP, an external AI endpoint, corporate sources) ships with its port, a test adapter and a documented residual, never claimed live (p6-plan R3).
15. **e2e budgets are measured** (F-DG5-145/146/151 class): every new spec states a budget from a loaded measurement.

## Environment and constraints

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`. Run offline. Never run `playwright install`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.
- **No dependencies, secrets or CDNs.** Add no dependency without an orchestrator decision; a dependency you need goes in your handback with its official documentation, support window and licence (D-195). No secrets and no public CDNs.
- **Brand and naming.** `#0078FF` is provisional. Never call the product an official PMI standard or a certified product.
- **Gates.** Product gates G1–G6 are business approvals, separate from the engineering gates DG0–DG7. No agent grants a real business, Finance or IT approval.
- **Clones.** Never run `git worktree add`; use a `git clone` under `$TMPDIR` if you need a clean copy (D-082).

## Acceptance (your self-check; reviewers verify independently)

1. These commands pass:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.
3. Your migrations apply on a fresh DB and over a P5-populated DB, and the guard probe fires as specified.
4. `pnpm test` passes with the locale unset and with `C.UTF-8`. The integration suite passes on a disposable PostgreSQL: `QA_PG_PORT=<your range> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`. Report the counts and any pinned-count change.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or timeout in the logs you cite. Never report a check as passed that did not run. A missing tool makes the check BLOCKED.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-ARCH-02-solution-architect.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/`. It contains:
- `date -u` at the start and at the end;
- the `validate --historical --stage DG5` result;
- the migration-apply and guard-probe output;
- the check outputs and counts;
- the deliverables, and anything left for a continuation;
- every DG1–DG5 artifact you changed and why, citing D-195;
- what the implementers of your slice must know.
