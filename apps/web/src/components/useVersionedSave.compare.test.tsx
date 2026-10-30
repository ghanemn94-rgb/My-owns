// The compare-and-reapply lines of useVersionedSave (T-DG6-FE-D2; ADR-0057 §7; REQ-S16-026 A14). SYNTHETIC record.
//  - a 409 loads the latest record; `compareSides` returns B (as loaded), M (the user's values) and C (the latest);
//  - `reapply(values, keys)` sends only the chosen fields with If-Match of the latest version; a field only the
//    other user changed is never sent, so their change stays.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSessionStateForTests } from "../api/client.ts";
import { mockApi, route } from "../test/fixtures.tsx";
import { useVersionedSave } from "./useVersionedSave.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Rec {
  id: string;
  version: number;
  name: string;
  objective: string;
}
type V = Pick<Rec, "name" | "objective">;
const B: Rec = { id: "01920006-0000-7000-8000-0000000000a1", version: 2, name: "Synthetic", objective: "Grow" };
const C: Rec = { ...B, version: 3, objective: "Grow safely" };

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  </MemoryRouter>
);

describe("useVersionedSave compare and reapply (ADR-0057 §7)", () => {
  it("sends only my chosen fields on the latest version after a 409", async () => {
    resetSessionStateForTests();
    let patches = 0;
    const api = mockApi(
      route("PATCH", /\/api\/v1\/records\//, (req) => {
        patches += 1;
        if (patches === 1)
          return {
            status: 409,
            body: {
              type: "urn:mth:problem:version-conflict",
              title: "Conflict",
              status: 409,
              code: "version_conflict",
              currentVersion: 3,
            },
          };
        return { status: 200, body: { ...C, ...(req.body as object), version: 4 } };
      }),
      route("GET", /\/api\/v1\/records\//, () => ({ status: 200, body: C })),
    );
    const onSaved = vi.fn();
    const { result } = renderHook(
      () =>
        useVersionedSave<Rec, V>({
          initial: B,
          url: (r) => `/api/v1/records/${r.id}`,
          toValues: (r) => ({ name: r.name, objective: r.objective }),
          diff: (base, values) =>
            Object.fromEntries(
              (Object.keys(values) as (keyof V)[]).filter((k) => values[k] !== base[k]).map((k) => [k, values[k]]),
            ),
          onSaved,
        }),
      { wrapper },
    );
    const mine: V = { name: "Synthetic (mine)", objective: "Grow fast" };
    await act(async () => {
      expect((await result.current.save(mine)).outcome).toBe("conflict");
    });
    await waitFor(() => expect(result.current.conflict?.currentVersion).toBe(3));
    expect(result.current.compareSides(mine)).toEqual({
      base: { name: "Synthetic", objective: "Grow" },
      mine,
      current: { name: "Synthetic", objective: "Grow safely" },
    });
    // The user keeps their name and keeps the other user's objective.
    await act(async () => {
      expect((await result.current.reapply(mine, ["name"])).outcome).toBe("saved");
    });
    const sent = api.requests.filter((r) => r.method === "PATCH");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers["if-match"]).toBe('"3"');
    expect(sent[1]!.body).toEqual({ name: "Synthetic (mine)" });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(result.current.compareSides(mine)).toBeNull();
  });
});
