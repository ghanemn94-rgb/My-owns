// code-security-reviewer DG5 round 7 probe (NOT product code; run only in a disposable clone, copied to
// apps/web/src/api/zz-sec-r7-all-transformations-cancel.test.tsx). Synthetic data only.
//
// D-181 fetchAllTransformations / useAllTransformations: cancellation actually STOPS the cursor loop (the shipped H5 only
// checks that the signal is passed). A scripted fetch answers page 1 at once (nextCursor "c1") and holds page 2 until
// its signal aborts, then rejects with an AbortError, as a browser does.
//   C1  fetchAllTransformations: abort while page 2 is in flight -> the promise rejects (AbortError), no page 3 request,
//       no partial array returned.
//   C2  fetchAllTransformations with an already-aborted signal -> rejects, and at most the one aborted request is made.
//   C3  useAllTransformations: the component unmounts while page 2 is in flight -> TanStack cancels the query, page 2's
//       signal is aborted, and no further page is requested afterwards.
//   C4  a server that hands out a fresh cursor every time (never null, never repeated) -> bounded: an error after
//       exactly ALL_TRANSFORMATIONS_MAX_PAGES requests, never an endless loop and never a shortened list.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_TRANSFORMATIONS_MAX_PAGES, fetchAllTransformations, useAllTransformations } from "./queries.ts";
import { makeTransformation } from "../test/fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const abortError = () => new DOMException("The operation was aborted.", "AbortError");

function scripted() {
  const urls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let page2Started!: () => void;
  const page2 = new Promise<void>((r) => (page2Started = r));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const signal = init?.signal ?? undefined;
    if (!/\/api\/v1\/transformations\?/.test(url)) return Promise.resolve(json({}));
    urls.push(url);
    signals.push(signal);
    if (signal?.aborted) return Promise.reject(abortError());
    const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
    if (!cursor) return Promise.resolve(json({ items: [makeTransformation({ id: "01920000-0000-7000-a1b2-000000000001" })], nextCursor: "c1" }));
    page2Started();
    return new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(abortError())));
  });
  return { urls, signals, page2 };
}

describe("D-181 hook cancellation and bound (code-security r7)", () => {
  it("C1 abort while page 2 is in flight: rejects with AbortError, no page 3", async () => {
    const s = scripted();
    const ctl = new AbortController();
    const p = fetchAllTransformations({ sort: "code:asc" }, ctl.signal);
    await s.page2;
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((r) => setTimeout(r, 50));
    expect(s.urls).toHaveLength(2);
  });

  it("C2 an already-aborted signal: rejects, at most one request", async () => {
    const s = scripted();
    const ctl = new AbortController();
    ctl.abort();
    await expect(fetchAllTransformations({ sort: "code:asc" }, ctl.signal)).rejects.toBeTruthy();
    expect(s.urls.length).toBeLessThanOrEqual(1);
  });

  it("C3 unmount during page 2: the query is cancelled and no further page is requested", async () => {
    const s = scripted();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useAllTransformations({ sort: "code:asc" }), { wrapper });
    await s.page2;
    unmount();
    await waitFor(() => expect(s.signals[1]?.aborted).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.urls).toHaveLength(2);
    expect(client.getQueryData(["transformations", "all", { sort: "code:asc" }])).toBeUndefined();
  });

  it("C4 an endless chain of fresh cursors is bounded and is an error", async () => {
    let n = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!/\/api\/v1\/transformations\?/.test(url)) return Promise.resolve(json({}));
      n++;
      return Promise.resolve(json({ items: [], nextCursor: `fresh-${n}` }));
    });
    await expect(fetchAllTransformations({ sort: "code:asc" })).rejects.toThrow(/more than 1000 pages/);
    expect(n).toBe(ALL_TRANSFORMATIONS_MAX_PAGES);
  }, 60_000);
});
