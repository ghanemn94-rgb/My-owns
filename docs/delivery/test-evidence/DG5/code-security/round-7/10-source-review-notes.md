# DG5 round 7: code-security source review notes

Reviewer: code-security-reviewer, session a327c535 (T-DG5-REV-SEC-R7). Candidate `sha256:33188e9e…` (2194 files), source `12dc33e`, freeze commit `1932faa`. Line numbers are at `12dc33e`.

## 1. Scope of the round-7 delta

`git diff ad52a56..12dc33e` (round-6 source to round-7 source) touches product code **only in `apps/web`** (21 files, +839/−218; `01-repair-diff.patch`).

- `packages/**`, `apps/api/**`, `apps/worker/**`, the migrations and `docs/api/**` are byte-identical to the round-6 candidate (`04-structure.log`: 0 changed files outside `apps/web`, 0 in `docs/api`).
- The DG5 register rows are unchanged since round 6 (`git diff ad52a56..12dc33e -- docs/delivery/requirements.csv`: no REQ row changed).

My round-6 source review of everything else (`round-6/10-source-review-notes.md` and rounds 1–5) therefore applies unchanged. I re-confirmed it by running the full suites and all eight probes on this candidate (sections 4 and 5).

The delta has two parts:

- **Wave AB (FE-AB1, F-DG5-148/149):** CSS (`.record-name { overflow-wrap:anywhere }`, `.outcome-tree > .outcome-node { min-inline-size:0 }`), a `<span className="record-name">` wrapper in `traceability/ui.tsx` and `ModularPage.tsx`, and the Define Good-outcome table moved into `TableScrollRegion`. This is presentation only: no data flow, no new HTML sink. User text is still rendered as React text nodes. The scan of the added lines finds no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `window.open`, `href={`, storage or external URL; the one storage hit is `localStorage.clear()` in a test.
- **Wave AB2 (D-181):** the shared hook and the 12 picker screens (section 2).

## 2. The D-181 hook: `apps/web/src/api/queries.ts:230-283`

`fetchAllTransformations(params, signal)` (`:245`) follows `nextCursor` of `GET /api/v1/transformations` with `limit = PAGINATION.maxLimit` (100). `useAllTransformations(params, enabled)` (`:276`) wraps it in `useQuery` under the key `["transformations","all",params]`.

### Termination

There are three independent bounds:

1. **Normal exit.** `if (!page.nextCursor) return out;` (`:264`).
2. **Repeated cursor.** A `seen` set throws on any repeated cursor (`:265`).
3. **Page cap.** A hard cap of `ALL_TRANSFORMATIONS_MAX_PAGES = 1000` pages (`:237`) throws `more than 1000 pages` (`:269`). It is never a silently shortened list.

On the server, the keyset is strictly monotonic. The list route (`apps/api/src/modules/transformations/routes.ts:95-142`) orders by `(sort col, t.id)` and pages with a strict row comparison `(col, id) < / > (cursor)` (`:131-134`, `:136-139`; `paginate`, `platform/cursor.ts:61-70`). So a correct server always advances, and `nextCursor` is null once fewer than `limit+1` rows remain (`paginate`).

The cursor is bound to the filter hash (`decodeCursor(query.cursor, hash, 2)`, `:101`). A cursor replayed with another filter or sort, or mangled, is refused with 400 (probe S4).

Probe C4 shows that a hostile or buggy server that hands out fresh cursors forever is stopped at exactly 1000 requests, with an error. Mutant M3 removes the repeated-cursor guard: H4 then fails, and the loop still ends at the cap.

### Cancellation

The TanStack signal goes to every page request (`queryFn: ({ signal }) => …`, `:279` → `api.get(…, signal)`, `:261` → `fetch(…, { signal })`, `client.ts:410`). An `AbortError` is rethrown unchanged (`client.ts:412`).

- **C1:** an abort while page 2 is in flight rejects the promise with `AbortError`, and no page 3 is requested.
- **C3:** unmounting the component while page 2 is in flight makes TanStack abort page 2's signal. No further page is requested, and no data is cached.
- **Mutant M2** stops passing the signal. C1, C2, C3 and the shipped H5 all fail.

### Error handling

Any failed page rejects the whole `queryFn`, so there is never partial data: shipped H3 and P2, plus mutant M1.

`QueryState` (`components/States.tsx:196-230`) shows the following states:

- loading while pending (`:214`);
- no-permission for 403/404 (`:217`);
- an error with retry when there is no data;
- a stale banner over the previous complete list on a refetch error (`:223`).

Every consumer either renders its picker inside `QueryState` (RulesPage, RulePage, MyProceduresPage, BlockPage, WalkthroughPage, launch-plan, AreaPages, Dashboards, Reports, MigrationsEntry) or puts a `QueryState` next to the select (AssignmentsPage, Delegations).

Session binding: the client checks the session generation on every request (`client.ts:387, :414, :422`). If the identity changes between two pages, the next page throws `SessionChangedError`, so the list fails as a whole and is reloaded under the new identity (`QueryState` F-DG2-530 path). Two identities' pages are never concatenated.

### Authorization scope of what it lists

The hook adds no endpoint and no filter of its own. It only repeats the existing, scoped list operation:

- `scopeFilter(principal, "transformation.read", { level: "transformation", … })` (`routes.ts:114`) is applied to every page, server-side.
- The cursor encodes a position only (sort key, id) and carries no grant.

The probe `picker-cursor-scope.r7.test.ts` checks this over 2 to 3 pages of 100:

| Probe | Caller | Result |
|---|---|---|
| S1 | TO @ BU a1 | all 250 of a1 + a1x, none of a2, org B or the archived one; no duplicates; codes sorted |
| S2 | TO @ org A | all 290 of org A; none of org B |
| S3 | org B office, replaying org A's cursor | only org B rows |
| S5 | ADM-only (ADM_ACCESS + ADM_TECH) and a non-inheriting TL @ BU | 200 with an empty list on one page, for both sorts |
| S6 | — | archived rows only with `includeArchived` |

Lists are filtered rather than refused (ADR-0006). `scopeFilter` returns `FALSE` without a grant, so the S5 callers see nothing transformation-scoped, as before.

### Observations (not defects)

- With `sort=updatedAt:desc`, a keyset walk can miss a transformation whose `updated_at` changes while the walk is in progress: it moves ahead of the cursor. It reappears on the next fetch or invalidation (mutations invalidate the `["transformations"]` prefix). This is inherent to keyset paging and pre-existing for any paged list. It cannot produce duplicates, because an updated row's new key lies on the already-read side of the cursor.
- The memory bound is 1000 × 100 rows. This is a client-side bound only. The server's own `limit ≤ 100` per request is unchanged, so there is no new server load amplification beyond what a user can do with the existing paged list.

### Consumers

- **RulesPage/RulePage.** The rule editor is gated behind the transformation query. Because the list is filtered, an editor without `transformation.read` gets 200 with an empty list, not a blocked editor. There is no regression.
- **RulesPage create.** The organization of a transformation-scoped rule is still taken from the selected transformation (`items.find(…)?.organizationId`). The server re-authorizes the create (unchanged since round 6).
- **AssignmentsPage.** The query is enabled only when `canAnywhere(me, "transformation.read")` (`AssignmentsPage.tsx:404-405`). Otherwise the page shows the free-text id input, as before.

## 3. D-182's unexplained e2e failure

The failure is `p5-launch-health-kpi.spec.ts:159`, chromium-ar: the `submitted` status was not visible within 5 s.

The hook is mounted only on the health-check **entry** page (`HealthCheckEntryPage` → `TransformationPicker`, `HealthCheckPage.tsx:48-57`). The assertion fails on the assessment page, which neither uses the hook nor invalidates the transformations prefix. TanStack's default invalidation refetches only active queries, so the unmounted picker query is not re-run there.

From the code, I find no path by which the D-181 change affects that step. The cause remains not established, as D-182 discloses. qa is assigned to examine it. I did not run the web e2e suite: it is qa's scope, and the load is very high with three reviews running. I judge D-182's disclosure accurate and complete for what it claims.

## 4. Unchanged security surfaces re-confirmed this round (by execution)

| Surface | Result |
|---|---|
| AUD/ADM sweep | 90 AUD P5 mutations: 403 × 73, 400 × 11, 404 × 6; 0 × 2xx; business audit 321 → 321. 40 ADM-only transformation-scoped reads: 404 × 37, 403 × 3; 0 × 2xx. Navigation as in round 6. Identical to round 6. |
| Studio | co-author review separation and contributor paths |
| 0096 | the intake identity guard |
| Demo guards | portfolio and key deliverables; `seedDemo` refused in production |
| Demo export label | F-DG5-124 |

Static source spot checks (unchanged code):

- **Relay.** It records a failing event and skips it (`apps/worker/src/relay.ts:99-124`). It retries only up to `maxPublishAttempts`, and later events are never stalled for good.
- **Enqueued event types.** All 12 literal enqueued event types are among the 27 keys of `OUTBOX_EVENT_SCHEMAS` (`packages/shared/src/schemas/events.ts:176`).
