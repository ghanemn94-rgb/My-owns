# DG2 round 15: code-security-reviewer

- **Candidate:** sha256:3f01c610… (561 files), source ed80b23, HEAD 9236a9f.
- **Task:** T-DG2-REV-SEC-R15.
- **Verdict:** **PASS**, with one new Low finding that is not a mandatory violation (F-DG2-530).

## F-DG2-500: verified CLOSED

FE13 moves the session-scoped cache reset into the API client:

- `endSession()` runs the reset hook that `createQueryClient` registers, synchronously and before the phase is announced. Clearing no longer depends on `<RequireSession>` being mounted.
- `fetchMe` compares the org, user and session (CSRF) identity before storing the answer. On a change it cancels and removes every query except `me`, and clears the mutation cache.
- The signed-in subtree is keyed by person.

My round-14 probe ran unchanged and passes 26/26 on Node 22 and Node 24:

- W5 and W5b: B no longer sees A's row.
- W1–W4 and W6 (returnTo, 403, bounded requests, Back) still pass.

The class probe (`zz-sec-r15-web-probe`) also passes:

- **X2:** Back and Forward after an identity change.
- **X4:** A's in-flight query, answered late, never reaches B.
- **X3b:** a late write after a session end in this tab is removed at B's `/me`.
- **X7:** a 403 csrf on a PATCH is not a session end.

## New: F-DG2-530 (Low, not mandatory)

**Mechanism.** Some page success handlers call `queryClient.setQueryData` after an awaited `api.send`: the transformation edit page and its conflict path, archive, and the organization, business-unit and user admin pages. They are plain async continuations, not TanStack mutations, so the identity-change reset (cancelQueries, removeQueries, mutation-cache clear) doesn't stop them.

**Reproduction (X3, Node 22 and Node 24).**
1. A's PATCH is in flight.
2. B's identity arrives through a refocus `/me`, after A signed out and B signed in in another tab.
3. A's PATCH is then answered.
4. The edit page writes A's record into the cache and navigates B to it.

B sees `A-PATCHED-SECRET`, and still sees it after B's own GET answers 404.

**Why Low.** Server-side authorisation is intact. The exposure needs a write to stay in flight across a sign-out and another user's sign-in in another tab.

**Suggested fix.** Add a per-identity generation counter in `apiRequest`, and refuse any answer to a request sent under a previous identity.

## Observation (not raised)

X6: within the 60 s `staleTime` of `/me`, refocusing the tab refetches page queries with the new cookie but doesn't refetch `/me`. The tab briefly shows A's name next to B's own rows. That is the cookie holder's own data, not A's, so nothing leaks to B. Mutations get 403 csrf until `/me` is fetched again.

## Checks

| Check | Result |
|---|---|
| typecheck, build, lint, openapi:lint (161 ops), no-cdn, format | all exit 0 |
| Unit tests on Node 22, Node 24 and under load (load average up to 9.5 on 4 vCPU) | 866/866 each |
| Integration, LANG unset (SQL_ASCII) | 612/612 |
| Integration, LANG=C.UTF-8 (UTF8) | 612/612 |
| Every named suite | 0 failures |
| AUD-403 sweep | 146/146 |
| Migrations 0001–0019 | pass |
| `validate.mjs --historical`, DG0 and DG1 | PASS |
| Environmental residuals (D-057, D-058, D-049) | PASS on the offline/config surface; residuals noted |

**Disclosed log content:**
- The class probe exits 1 by design, with exactly one failing assertion (X3).
- A Fastify FSTDEP022 deprecation warning appears in the unit logs.
- Vite prints a chunk-size advisory in the build log.
- Two pnpm "Failed to create bin" warnings appear before the build. They are resolved by `install2`.
- The load generator's own output was discarded by design.

**Scope note.** The assignment's diff range `fe22d759..cbdb4f68` is the round-10/11 range. I reviewed the actual change since round 14, `ea9051b..ed80b23`, and recorded both stats in `diff-scan.log`.
