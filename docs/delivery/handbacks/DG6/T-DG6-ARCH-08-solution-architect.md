# Handback T-DG6-ARCH-08: P6 architecture, pre-freeze ADR records of the last repairs (solution-architect)

- **Stage:** P6, gate DG6 (BUILDING). Branch `claude/mobily-transformation-platform-dg5-regate2`, main checkout.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-08-solution-architect-20261031T063833Z-d0a0c8e6","session_id":"d0a0c8e6-36cc-43e4-82b7-7f1dc355698e"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-08.md`, sha256 `57a30ce6a73f221e6f46f3e15a6401d659dde8f9de1150b1a837d9d696dd249b`. I checked it with `sha256sum` before starting, and it matched.
- **Base:** `HEAD` = `acf6a61bd6c0801bbcc9552c515fed66b72f7e38` at the start and at the end. The tree was clean at the start, apart from this run's own `docs/delivery/runs/…` folder. **Every change is uncommitted**, as the assignment asks.
- **Time (`date -u`):** start `Sat Oct 31 06:38:45 UTC 2026`; end: §6.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` with **exit 0**. It ran first, before any write. That output is in the session only, because I didn't save the first run to a file. The closing run at the end also exited 0, and it is saved (`validate-dg5-end.log`).
- **Engineering only.** Nothing here grants, records or implies a G1–G6 business approval, a Finance validation or an IT approval. Product G6 never implies DG7.
- **Scope.** I changed documents only: five ADRs. No product code, test, `openapi.yaml`, delivery record or `tools/**` file was edited. Harness ports were not used, because no server or database was started.
- **What I checked the text against.** Every "as shipped" sentence was checked against the code at `HEAD`, not only against the handback:
  - `operations/exceptions.ts` `linkedKpiStatus` (lines 341–420);
  - `apps/worker/src/handlers/operations.ts` `kpiFreshness` (lines 164–183);
  - `assistant/conversations.ts` (lines 545–600) and `assistant/suggestions.ts` (it does not read the setting);
  - `docs/api/openapi.yaml` `AssistantConversationPage`;
  - `apps/api/src/server.ts` (lines 284–345, 407–408, 535–560, 645–680);
  - `apps/worker/src/main.ts` (lines 20–35, 60–75);
  - `packages/config/src/connection-log.ts` (lines 98–135);
  - `e2e/a20-s15-014-term-scan.spec.ts` (lines 140–170).

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0053-p6-operations-service-identities-exceptions-logs-heartbeat.md` | §2, a new paragraph, "Which period the linked-KPI status reads". It records BE-X4's rule (the latest open or closed period whose evaluation has a value), why it changed, what does not hide the value, and the open freshness-scan observation (BE-X4 §5). |
| `docs/architecture/adr/ADR-0059-p6-optional-assistant-provider-port-retrieval-citations-guardrails.md` | §3: a saved setting is never deleted, so it stays `configured: true` (QA-G Q-1). §6: where suggestions are offered. §9: `assistantEnabled` (BE-X5). §10: a bullet saying a non-configurer learns the on/off state from `assistantEnabled` alone. §12: the requested-destination fields and their residual, plus the composition calls (connection log, `setAssistantSecretProviders`, `holdAssistantPorts`). |
| `docs/architecture/adr/ADR-0054-p6-identity-storage-notification-channels.md` | A new §8, "Composition": one `SecretProvider` registry per process; who receives it in the API (evidence store, storage admin, notification admin, integrations, assistant) and in the worker (channel sends); the connection log in both roots. |
| `docs/architecture/adr/ADR-0007-api-conventions.md` | §4a, the assistant line: the page carries `assistantEnabled`, and pagination is unchanged (BE-X5 §6, optional item). |
| `docs/architecture/adr/ADR-0061-p6-ux-hardening-contrast-greyscale-layout-keyboard-axe-localization-explanations.md` | §8: an "As built" amendment. The forced 500 is browser-side interception, not an API test route (QA-F §6 item 3). |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-08-evidence/*.log` | The logs of §3. |
| this file | The handback. |

None of the edits adds a row to an ADR table. Ten or more web unit suites read the P6 ADR refusal tables verbatim and pin their row counts (ARCH-07 note A). The parser in `problems-all.test.ts` matches only `| 4xx | \`code\`` table lines. Every addition here is prose or bullets, and no new problem code was needed.

## 2. Items, one by one (applied or declined)

### 2.1 Assignment item 1: BE-X5 (`assistantEnabled`)

| # | Source | Item | Result |
|---|---|---|---|
| 1 | BE-X5 §6 | Record the contract change in ADR-0059 §9 | **Applied** in ADR-0059 §9, in a new paragraph, "`assistantEnabled` on the list". It covers the meaning (the `providerFor` check), the false cases, "the only setting information an `assistant.use` holder receives", that no network call is made, the web slot's new read with Unknown kept hidden, AUD, and what is unchanged. I checked it against `conversations.ts:593` and the `openapi.yaml` schema description. |
| 2 | BE-X5 §6 | Record it in ADR-0059 §10 | **Applied** as a new bullet below the permission table, "Whether the assistant is on, for users". The table is not changed: no permission changed. |
| 3 | Assignment | Record it in ADR-0059 §6 | **Applied** in a new paragraph, "Where suggestions are offered": the panel, with its suggestions and Take to draft, appears only while `assistantEnabled` is true. I also stated, from the code, that `takeAssistantSuggestionToDraft` does not read the setting (`suggestions.ts` has no `providerFor`/`disabled` check). |
| 4 | BE-X5 §6 | Optional: ADR-0007 §4a assistant line | **Applied** (one sentence). |
| 5 | BE-X5 §3 "Pins" | The operation count "stays 931" | **Not copied into the ADR.** At `HEAD`, `pnpm openapi:lint` reports **932** operations, and `contract.test.ts:1215` pins 932. The ADR therefore says "No operation was added" and gives no number. For the orchestrator: BE-X5's "931" refers to its own base, not to `HEAD`. |
| 6 | BE-X5 §3a | The `admin/security.test.ts` webhook-class pin; the load-sensitive contract cases | **Declined:** test ownership, not ADR text. BE-X4, BE-X3B and FE-X1B report the same pin. It is routed to the orchestrator. |

### 2.2 Assignment item 2: BE-X4 (linked-KPI period), BE-X2 (`kpiLinks`)

| # | Source | Item | Result |
|---|---|---|---|
| 7 | BE-X4 §2 | The linked-KPI status reads the KPI's latest period with a value | **Applied** in ADR-0053 §2, in the new paragraph "Which period the linked-KPI status reads". It gives the exact period selection (`open`/`closed`, frequency, organization, evaluation scope, `value_basis`, highest run seq, non-null value, latest `period_end`), the read-time freshness, `lastValueAt`, the reason (M0239 and the contract's "Last known accepted value"), what does not hide or replace the value, and what is unchanged. |
| 8 | BE-X4 §5 | The worker freshness scan still reads only the newest period | **Applied as a recorded open item** in the same paragraph, and checked against `handlers/operations.ts:164–171` (`orderBy period_end desc limit 1`). **Not decided:** whether the scan should adopt the last-known-value rule is for the BE-K2 owner and the orchestrator. It is a product behaviour change. |
| 9 | BE-X2 §5 | `kpiLinks` on `connector.run_failed` | **Already applied by ARCH-07** (ADR-0053 §2, ADR-0053 §3 payload, ADR-0055 §2 step 4). I checked that both ADR-0053 places are present at `HEAD`. Nothing to add. |

### 2.3 Assignment item 3: composition calls (BE-X2, BE-X3/BE-X3B) and connection-log fields

| # | Source | Item | Result |
|---|---|---|---|
| 10 | BE-X3B §2.1 | `setAssistantSecretProviders(secrets)` | **Applied** in ADR-0059 §12 ("Composition") and ADR-0054 §8. |
| 11 | BE-X2 | `setConnectorSecretProviders(secrets)` | **Applied** in ADR-0054 §8 (the API consumer list). |
| 12 | BE-X3B §2.2 | `installConnectionLog` in the API (`holdApiConnectionLog`, held per app, removed by the last `onClose`) and in the worker (after `installConsoleRedaction()`, before the first DB connection) | **Applied** in ADR-0059 §12 and ADR-0054 §8. The §12 line "One call each in `server.ts` and `main.ts`" stays true and is now explained. |
| 13 | BE-X3B §2.3 | The connection log's requested-destination fields | **Applied** in ADR-0059 §12: `host` = the `lookup` name, else the IP literal's attempt address; `address`/`port` = the connected remote, else the latest `connectionAttempt`. A line is written on `connect`, or on `close` if the socket never connected. I checked this against `connection-log.ts:111–133`, which overwrites the attempt each time, so "latest" is the accurate word, not "first". |
| 14 | BE-X3B §2.3 | Residual: a failed DNS lookup logs no address or port | **Applied** in ADR-0059 §12, as a residual. The A21 checker fails on an unknown destination, so this cannot become a false pass. |
| 15 | BE-X3B §2.4 | `holdAssistantPorts` (per-app retrieval ports) | **Applied** in ADR-0059 §12 ("The retrieval ports"). |
| 16 | BE-X3B §6 item 5 | The QA-D preload is redundant and doubles the lines | **Applied as a recorded consequence** in ADR-0059 §12. Removing `e2e/support/connection-log-preload.mjs` is QA's change: routed. |
| 17 | BE-X3B §3 | Seven setters with no composition call | **Declined:** BE-X3B showed that each is a test seam or is called by its own module, and nothing in an ADR contradicts that. |
| 18 | BE-X3B §6 item 6 | `p6-work-split.md` has no "pre-freeze repair" subsection | **Declined:** an assignment-wording issue for the orchestrator. No ADR or work-split rule depends on it. |

### 2.4 Assignment item 4: the other handbacks

| # | Source | Item | Result |
|---|---|---|---|
| 19 | BE-X4 §6 | `adminP6.json` `exceptionsIntro` is now true | **No change needed.** It agrees with ADR-0053 §2 as amended. |
| 20 | FE-X1B §6 | Contract, schema, migration or dependency needs | **None.** FE-X1B lists none. The identity-screen rule (secrets shown only as "configured") already matches ADR-0054 §1. `/my-work/drafts` in `P6_AXE_ROUTES` follows ADR-0061 §7.2's rule (every P6 router path), which the ADR states as a rule without listing paths, so no text changes. |
| 21 | QA-EB §5 P-1, P-2 | REQ-S12-019 and REQ-S17-007 defects | **Covered by items 7 and 1–3.** These are the defects BE-X4 and BE-X5 repaired, now recorded. Closing them is for a non-author reviewer. |
| 22 | QA-EB §7 Q-1 / QA-G §1 Q-1, §7 | A12 leaves the stack "configured, off"; no route deletes a saved setting | **Applied** in ADR-0059 §3, as a new bullet, "A saved setting is never deleted". It records the append-only history with `ON DELETE RESTRICT` (`0111`), that `configured: true` is permanent after the first save, and that fresh-install states are tested with `e2e/support/fresh-install.ts`, never a database delete. **No delete route is proposed:** that would be a product feature and an audit-history question for the orchestrator. |
| 23 | QA-EB §7 Q-2 / QA-G Q-2 | `a20-p6-ux` keyboard test order dependence | **Declined:** a test-precondition fix (QA-G), not an architecture item. |
| 24 | QA-EB §7 Q-3 | `QA_A17_WEBHOOK_SIGNING_SECRET` not exported | **Declined:** a run-configuration item for QA. |
| 25 | QA-EB §8 item 3 | DO-G: `getWorkstreamDashboard` not measured; patched `generate.mjs` | **Declined (again; ARCH-07 item 58).** `decisions.md` still ends at D-201, so no decision is recorded. The choice is the orchestrator's: either the generator adds workstreams, or ADR-0058 §3 drops the operation. |
| 26 | QA-F §6 item 3 | ADR-0061 §8 says the forced 500 comes "from a test route in the e2e stack" | **Applied** as an "As built" amendment in ADR-0061 §8. It records browser-side interception (`page.route` … `fulfill` 500, outside `/api/v1/me` and `/api/v1/auth/*`), the real-500 coverage in the integration test, and that no fault route exists. The original sentence is kept, and the amendment follows it, so the history stays readable. A server-side fault route would be a product task: routed. |
| 27 | QA-F §6 item 2 | No 500/503/`default` response declared on `listTransformations`, `getTransformation`, `createTransformation`, `devLogin` | **Declined, routed.** It is an additive `openapi.yaml` change, and this assignment changes ADR documents only. Recommendation for the orchestrator: a shared `default` Problem response is the smaller change, but it affects the contract pins (`contract.test.ts`), so it needs its own task. |
| 28 | QA-F §6 item 1 / QA-G §6 | The A17 failure | **Covered by item 7** (BE-X4 is merged at `HEAD`). |
| 29 | QA-G §8 | REQ-S16-007 Keycloak still BLOCKED | **Declined:** no ADR change. ADR-0054 §1 already records the Keycloak image as BLOCKED (D-049). |

## 3. Checks actually run

Environment: main checkout, Node 24.21.0 (the repository toolchain), offline. Logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-08-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, before any write) | 0 | `PASS gate DG5 (historical)` | session only (not saved) |
| 2 | `pnpm format:check` (after all ADR edits) | 0 | "All matched files use Prettier code style!" | `format-check.log` |
| 3 | `pnpm openapi:lint` (contract unchanged) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.log` |
| 4 | `cd apps/web && npx vitest run` on the 12 web unit files that read ADR text (`six-states`, `productivity-i18n`, `assistant-i18n`, `assistant.test.tsx`, `fed`, `fef`, `integrations-i18n`, `fee`, `problems-p5`, `problems-slices-hijk`, `problems-all`, `problems-p6`) | 0 | 12 files, 160 tests passed | `unit-web-adr-readers.log` |
| 5 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-end.log` |

Check 2 ran before the last two one-line `sed` edits to ADR-0059 and ADR-0054 (the "latest `connectionAttempt`" wording and the removal of the operation count). §6 records a re-run after this handback was written.

**Not run:** the full `pnpm test` and `pnpm test:integration`. No code changed, and the assignment's acceptance names only `format:check` and `openapi:lint`. Check 4 covers the suites that read ADR text.

## 4. Known gaps / not done

- **Routed, not decided by me:**
  - whether the worker freshness scan adopts the last-known-value rule (item 8);
  - a delete or reset for the assistant setting (item 22, not proposed);
  - a shared `default`/500 Problem response in the contract (item 27);
  - the `getWorkstreamDashboard` load-dataset choice (item 25);
  - the `admin/security.test.ts` webhook pin (item 6);
  - removing QA-D's connection-log preload (item 16).
- **The operation count:** BE-X5 states 931, while `HEAD` lints and pins 932 (item 5). I recorded no number. The orchestrator may want to check which task added the 932nd operation, if that is not already known.
- The start run of the DG5 validator printed PASS with exit 0, but I didn't save its log.

## 5. Merge instructions

- Documents only. No migration, no ordering constraint and no contract change.
- A conflict is possible only if another task edits the same paragraphs: ADR-0053 §2 after "D-197 item 3", ADR-0059 §3/§6/§9/§10/§12, the end of ADR-0054 §7, the ADR-0007 §4a assistant line, or the ADR-0061 §8 term-scan bullet.
- Leave this handback and the `T-DG6-ARCH-08-evidence/` folder in place with the ADR edits.

## 6. End

- Final `pnpm format:check`, after this handback and every ADR edit: exit 0, "All matched files use Prettier code style!" (`format-check-final.log`). `pnpm openapi:lint` was re-run at the same time: exit 0, 932 operations.
- End time: `Sat Oct 31 06:49:23 UTC 2026` (`end-time.txt`), about 11 minutes after the start. `HEAD` is still `acf6a61bd6c0801bbcc9552c515fed66b72f7e38`.
