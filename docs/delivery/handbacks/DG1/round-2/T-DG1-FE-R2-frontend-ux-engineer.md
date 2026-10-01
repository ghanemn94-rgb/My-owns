# Handback T-DG1-FE-R2 (frontend-ux-engineer), DG1 round-2 repair

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE-R2-frontend-ux-engineer-20261001T211413Z-1ea4b414","session_id":"1ea4b414-4a96-48f2-89c4-61cebebdc1ac"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-2/T-DG1-FE-R2.md` (sha256 verified `2f69b9df…519115`)
- **Branch / base:** `claude/mobily-transformation-platform-regate`. HEAD at start was `9fea78d00d3f2b60673e7e1e4ef2a31bb1290e37`. During the run HEAD moved to `e85769370a37e9dbf977798de9f889570bccdcdf`, which only touched `docs/delivery/decisions.md` (commit by someone else).
- **Finding:** F-DG1-144 (Low, REQ-DLV-033), a non-deterministic web unit test.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/transformations/transformations.test.tsx` | Test-only. Every wait that depends on the async create → navigate → GET /me refresh → detail/audit query chain now has an explicit 5 s timeout instead of Testing Library's default 1 s. The per-test timeouts are raised to cover the sum of those waits. No assertion was removed or weakened. |

No product code changed. No visible UI change, so there are no screenshots (none apply).

## 2. Behaviour delivered (F-DG1-144 / REQ-DLV-033)

- `"English: Edit, Archive and the audit trail appear after create, without a reload"`: the pathname `waitFor`, `findByRole("link", {name:"Edit"})` and `findByRole("heading", {name:"Audit trail"})` all use `{ timeout: 5_000 }`. The test timeout is now 20 s.
- Siblings with the same race, hardened the same way:
  - the Arabic RTL test (`تعديل` / `سجل التدقيق`);
  - the "does not over-grant" test (pathname, h1, draft-notice `findByText`);
  - the "failed /me refresh" test (its draft-notice `findByText`; its pathname wait already had `ME_REFRESH_TIMEOUT_MS + 1_000`).
- The shared `submitCreateForm` helper: its `findByLabelText` for the business-unit select (the form renders only after the business units load) also waits up to 5 s.
- Argument positions follow the bound `screen` signatures, `findByRole(role, options, waitForOptions)` and `findByText`/`findByLabelText(text, options, waitForOptions)`. An earlier draft of mine put `undefined` in the wrong position for `findByRole`. `tsc` caught it (TS2554) and I fixed it before the final runs below.
- Unchanged: the over-grant/fail-safe `queryBy… toBeNull()` checks still run after the page has visibly settled, and the "/me re-read after POST" and `dir` assertions are unchanged.

## 3. Checks actually run

Environment: Linux, 4 CPUs, offline, `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH` (Node v24.21.0). All results below are from the final edited file.

**Node 22: BLOCKED.** There is no Node 22 binary on this host: `/opt/nvm/versions/node/` contains only `v24.21.0`, and `/usr/local/bin/node` is v20.20.2. So the "5× on Node 22" runs could not be done. I ran the repeated and load runs on Node 24.21.0 instead (below). A reviewer with Node 22 (environment.md lists v22.22.2) should repeat them.

### Repeated runs, sequential: `pnpm vitest run apps/web/src/pages/transformations/transformations.test.tsx` ×5 (Node 24.21.0)
```
seq run 1 exit=0 Tests  21 passed (21)
seq run 2 exit=0 Tests  21 passed (21)
seq run 3 exit=0 Tests  21 passed (21)
seq run 4 exit=0 Tests  21 passed (21)
seq run 5 exit=0 Tests  21 passed (21)
```

### Under load: 6 parallel × `npx vitest run --project unit-web apps/web/src/pages/transformations/transformations.test.tsx`, two rounds (same procedure as `docs/delivery/test-evidence/DG1/code-security/round-1/web-flake-under-load.log`), Node 24.21.0
```
parallel round 1 instance 1 exit=0 Tests  21 passed (21)
parallel round 1 instance 2 exit=0 Tests  21 passed (21)
parallel round 1 instance 3 exit=0 Tests  21 passed (21)
parallel round 1 instance 4 exit=0 Tests  21 passed (21)
parallel round 1 instance 5 exit=0 Tests  21 passed (21)
parallel round 1 instance 6 exit=0 Tests  21 passed (21)
parallel round 2 instance 1 exit=0 Tests  21 passed (21)
parallel round 2 instance 2 exit=0 Tests  21 passed (21)
parallel round 2 instance 3 exit=0 Tests  21 passed (21)
parallel round 2 instance 4 exit=0 Tests  21 passed (21)
parallel round 2 instance 5 exit=0 Tests  21 passed (21)
parallel round 2 instance 6 exit=0 Tests  21 passed (21)
```

### Static checks
- `pnpm -r typecheck`: exit 0. The first attempt failed with TS2554 from my argument-position error, which is now fixed.
- `pnpm lint` (`eslint . --max-warnings=0`): exit 0.
- `pnpm exec prettier --check apps/web/src/pages/transformations/transformations.test.tsx`: exit 0 ("All matched files use Prettier code style!").

### Full suite: `pnpm test` (Node 24.21.0), exit 0
```
 ✓ |unit-node| apps/api/src/modules/admin/branding.test.ts (4 tests) 38ms
 ✓ |unit-node| apps/api/src/modules/transformations/transitions.test.ts (2 tests) 4ms

 Test Files  21 passed (21)
      Tests  325 passed (325)
   Start at  21:18:56
   Duration  8.94s (transform 1.32s, setup 0ms, collect 7.57s, tests 10.07s, environment 3.76s, prepare 1.55s)

```

## 4. Known gaps / not done

- **Node 22 repeated runs: BLOCKED** (no Node 22 on this host; see above).
- **Working tree shared with another agent:** while I worked, `apps/api/src/modules/organization/repository.ts` and `apps/api/src/modules/organization/routes.ts` showed uncommitted changes I did not make (probably a parallel agent). The typecheck, lint and full-suite runs above ran on that combined tree. My own diff is limited to the one test file.
- A raised timeout lowers the chance of a flake under load but does not guarantee it can't happen. 5 s is 5× the default, and the chain takes roughly 350–450 ms when the machine is idle.

## 5. Merge instructions

Test-only change to one file. No migrations, no ordering constraints, no expected conflicts. Commit only `apps/web/src/pages/transformations/transformations.test.tsx` for this task; the organization API files belong to someone else.

## Diff

```diff
diff --git a/apps/web/src/pages/transformations/transformations.test.tsx b/apps/web/src/pages/transformations/transformations.test.tsx
index 8104c5d..ee04962 100644
--- a/apps/web/src/pages/transformations/transformations.test.tsx
+++ b/apps/web/src/pages/transformations/transformations.test.tsx
@@ -73,7 +73,8 @@ const createRoute = route("POST", /\/api\/v1\/transformations$/, () => ({ status
 const auditEmpty = route("GET", /\/audit/, () => ({ status: 200, body: { items: [], nextCursor: null } }));
 
 async function submitCreateForm(labels: { unit: RegExp; name: RegExp; submit: string }) {
-  const unit = (await screen.findByLabelText(labels.unit)) as HTMLSelectElement;
+  // The form renders once the business units have loaded; wait generously for it under load (F-DG1-144).
+  const unit = (await screen.findByLabelText(labels.unit, undefined, { timeout: 5_000 })) as HTMLSelectElement;
   fireEvent.change(unit, { target: { value: BU_ID } });
   fireEvent.change(screen.getByLabelText(labels.name), { target: { value: "Synthetic new transformation" } });
   fireEvent.click(screen.getByRole("button", { name: labels.submit }));
@@ -520,46 +521,67 @@ describe("effective permissions refresh after create (F-DG1-210)", () => {
 
   const detailRoute = route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: created }));
 
-  it("English: Edit, Archive and the audit trail appear after create, without a reload", async () => {
-    const { meRoute: me, create } = scriptedMe("en", "derived");
-    const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
-    const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
-    await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
-    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`));
-    expect(await screen.findByRole("link", { name: "Edit" })).toBeTruthy();
-    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
-    expect(await screen.findByRole("heading", { name: "Audit trail" })).toBeTruthy();
-    // /me was re-read after the POST (the refreshed server answer), and the page was never reloaded (same router).
-    const postAt = requests.findIndex((r) => r.method === "POST");
-    expect(requests.slice(postAt + 1).some((r) => r.method === "GET" && r.url === "/api/v1/me")).toBe(true);
-    expect(document.documentElement.dir).toBe("ltr");
-  });
+  /**
+   * F-DG1-144: the controls below appear only after the async create, the navigation, the effective-permissions
+   * (GET /me) refresh and the detail/audit queries have all settled. Under CPU load that chain can exceed Testing
+   * Library's default 1 s, so every wait that depends on it gets an explicit, generous timeout. The assertions
+   * themselves are unchanged; the test timeout covers the sum of these waits.
+   */
+  const SETTLE = { timeout: 5_000 };
+  const SETTLED_TEST_TIMEOUT_MS = 20_000;
+
+  it(
+    "English: Edit, Archive and the audit trail appear after create, without a reload",
+    async () => {
+      const { meRoute: me, create } = scriptedMe("en", "derived");
+      const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
+      const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
+      await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
+      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), SETTLE);
+      expect(await screen.findByRole("link", { name: "Edit" }, SETTLE)).toBeTruthy();
+      expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
+      expect(await screen.findByRole("heading", { name: "Audit trail" }, SETTLE)).toBeTruthy();
+      // /me was re-read after the POST (the refreshed server answer), and the page was never reloaded (same router).
+      const postAt = requests.findIndex((r) => r.method === "POST");
+      expect(requests.slice(postAt + 1).some((r) => r.method === "GET" && r.url === "/api/v1/me")).toBe(true);
+      expect(document.documentElement.dir).toBe("ltr");
+    },
+    SETTLED_TEST_TIMEOUT_MS,
+  );
 
-  it("Arabic (RTL): the same controls and the audit trail appear after create, without a reload", async () => {
-    const { meRoute: me, create } = scriptedMe("ar", "derived");
-    mockApi(me, buRoute, create, detailRoute, auditEmpty);
-    const { router } = renderApp("/transformations/new", { i18n: createI18n("ar") });
-    await submitCreateForm({ unit: /^وحدة العمل/, name: /^الاسم/, submit: "إنشاء التحوّل" });
-    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`));
-    expect(await screen.findByRole("link", { name: "تعديل" })).toBeTruthy();
-    expect(screen.getByRole("button", { name: "أرشفة" })).toBeTruthy();
-    expect(await screen.findByRole("heading", { name: "سجل التدقيق" })).toBeTruthy();
-    expect(document.documentElement.dir).toBe("rtl");
-  });
+  it(
+    "Arabic (RTL): the same controls and the audit trail appear after create, without a reload",
+    async () => {
+      const { meRoute: me, create } = scriptedMe("ar", "derived");
+      mockApi(me, buRoute, create, detailRoute, auditEmpty);
+      const { router } = renderApp("/transformations/new", { i18n: createI18n("ar") });
+      await submitCreateForm({ unit: /^وحدة العمل/, name: /^الاسم/, submit: "إنشاء التحوّل" });
+      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), SETTLE);
+      expect(await screen.findByRole("link", { name: "تعديل" }, SETTLE)).toBeTruthy();
+      expect(screen.getByRole("button", { name: "أرشفة" })).toBeTruthy();
+      expect(await screen.findByRole("heading", { name: "سجل التدقيق" }, SETTLE)).toBeTruthy();
+      expect(document.documentElement.dir).toBe("rtl");
+    },
+    SETTLED_TEST_TIMEOUT_MS,
+  );
 
-  it("does not over-grant: if the refreshed server answer adds nothing, Archive and the audit trail stay hidden", async () => {
-    const { meRoute: me, create } = scriptedMe("en", "unchanged");
-    const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
-    const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
-    await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
-    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`));
-    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
-    await screen.findByText("Transformation created as a draft. It is not submitted or approved.");
-    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
-    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
-    expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
-    expect(requests.some((r) => r.url.includes("/audit"))).toBe(false);
-  });
+  it(
+    "does not over-grant: if the refreshed server answer adds nothing, Archive and the audit trail stay hidden",
+    async () => {
+      const { meRoute: me, create } = scriptedMe("en", "unchanged");
+      const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
+      const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
+      await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
+      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), SETTLE);
+      expect(await screen.findByRole("heading", { level: 1 }, SETTLE)).toBeTruthy();
+      await screen.findByText("Transformation created as a draft. It is not submitted or approved.", undefined, SETTLE);
+      expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
+      expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
+      expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
+      expect(requests.some((r) => r.url.includes("/audit"))).toBe(false);
+    },
+    SETTLED_TEST_TIMEOUT_MS,
+  );
 
   it("a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered)", async () => {
     const { meRoute: me, create } = scriptedMe("en", "error");
@@ -570,7 +592,7 @@ describe("effective permissions refresh after create (F-DG1-210)", () => {
     await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), {
       timeout: ME_REFRESH_TIMEOUT_MS + 1_000,
     });
-    await screen.findByText("Transformation created as a draft. It is not submitted or approved.");
+    await screen.findByText("Transformation created as a draft. It is not submitted or approved.", undefined, SETTLE);
     expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
     expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
   }, 15_000);
```
