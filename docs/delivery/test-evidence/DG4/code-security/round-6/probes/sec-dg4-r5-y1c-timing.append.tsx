
// ---- code-security-reviewer DG4 round-5 reproduction (T-DG4-REV-SEC-R5), APPENDED to a disposable copy of
// apps/web/src/auth/session-bound.test.tsx in the probe clone ONLY (never in the candidate tree). It runs Y1c unchanged,
// except that the created record's detail GET is answered 2.2 s late (hold/release), i.e. what a loaded machine does.
// Expected by design (api/client.ts SESSION_RECHECK_MS = 2000): a page GET sent > 2 s after the last /me revalidates
// /me first, so the exact count of 2 in Y1c is a wall-clock-dependent assertion.
describe("SEC-DG4-R5 Y1c timing reproduction", () => {
  it(`Y1c with ${process.env.Y1C_HOLD ?? "the detail GET"} answered ${process.env.Y1C_HOLD_MS ?? 2200} ms late: count of /me after the POST`, async () => {
    const lang = "en" as const;
    const T = TEXT[lang];
    const s = server(lang);
    // Which answer is held (env Y1C_HOLD = a regex on "<METHOD> <url>", default: the created record's detail GET) and
    // for how long (env Y1C_HOLD_MS, default 2200); the hold starts once the POST has been sent.
    const pat = new RegExp(process.env.Y1C_HOLD ?? `GET .*/api/v1/transformations/${NEW_TR_ID}$`);
    const ms = Number(process.env.Y1C_HOLD_MS ?? 2200);
    let armed = false;
    const release = s.hold((url, method) => armed && pat.test(`${method} ${url}`));
    s.hold((url, method) => { if (method === "POST" && !armed) { armed = true; setTimeout(release, ms); } return false; });
    const { router } = renderApp("/transformations/new", { i18n: createI18n(lang) });
    await screen.findByText("Synthetic User A");
    await submitCreate(T);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_TR_ID}`), { timeout: 8000 });
    expect(await screen.findByText(T.transformations.created, {}, { timeout: 8000 })).toBeTruthy();
    expect((await screen.findAllByText("A-CREATED-SECRET-NAME", {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    await wait(300);
    const afterPost = s.requests.slice(s.requests.findIndex((r) => r.method === "POST"));
    console.log(`[SEC-R5 Y1c-timing] requests after POST: ${afterPost.map((r) => `${r.method} ${r.url.replace(/^.*\/api\/v1/, "")}`).join(" | ")}`);
    console.log(`[SEC-R5 Y1c-timing] /me after POST = ${afterPost.filter(isMe).length} (Y1c asserts exactly 2)`);
    expect(afterPost.filter(isMe)).toHaveLength(2); // the Y1c assertion, unchanged
  }, 20_000);
});
