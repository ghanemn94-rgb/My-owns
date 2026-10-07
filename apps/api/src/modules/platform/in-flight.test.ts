// T-DG2-BE18A unit tests of the in-flight tracker (no network; the real-process shutdown behaviour is covered by
// apps/api/test/integration/shutdown-cleanup.test.ts).
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createInFlight, registerInFlightTracking } from "./in-flight.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createInFlight", () => {
  it("tracks work until it settles (fulfilled or rejected) and returns the same promise", async () => {
    const t = createInFlight();
    let release!: () => void;
    const work = new Promise<string>((r) => (release = () => r("done")));
    expect(t.track(work)).toBe(work);
    const failing = Promise.reject(new Error("cleanup failed"));
    t.track(failing).catch(() => undefined);
    expect(t.pending).toBe(2);
    await sleep(0);
    expect(t.pending).toBe(1); // the rejected one settled
    release();
    expect(await t.settled(1_000)).toBe(true);
    expect(t.pending).toBe(0);
  });

  it("settled() answers false when the timeout elapses first, and true at once when nothing is pending", async () => {
    const t = createInFlight();
    expect(await t.settled(0)).toBe(true);
    t.track(new Promise(() => undefined));
    const t0 = Date.now();
    expect(await t.settled(100)).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });

  it("settled() also waits for work started synchronously when a tracked operation settles (e.g. an onError hook)", async () => {
    const t = createInFlight();
    let late = false;
    const first = sleep(20);
    t.track(first);
    void first.then(() => t.track(sleep(50).then(() => (late = true))));
    expect(await t.settled(1_000)).toBe(true);
    expect(late).toBe(true);
  });
});

describe("registerInFlightTracking", () => {
  it("wraps every route handler registered after it: async handlers are tracked until their cleanup ran; results are unchanged", async () => {
    const app = Fastify({ logger: false });
    const inFlight = registerInFlightTracking(app);
    expect(app.inFlight).toBe(inFlight);
    const cleaned: string[] = [];
    app.get("/async", async () => {
      try {
        await sleep(30);
        throw new Error("cut");
      } finally {
        await sleep(30);
        cleaned.push("async");
      }
    });
    app.get("/sync", (_request, reply) => {
      void reply.send({ ok: true });
    });
    app.get("/value", async () => ({ value: 1 }));
    await app.ready();
    const pending = app.inject({ method: "GET", url: "/async" });
    await sleep(10);
    expect(inFlight.pending).toBe(1);
    expect(await inFlight.settled(1_000)).toBe(true);
    expect(cleaned).toEqual(["async"]);
    expect((await pending).statusCode).toBe(500);
    expect((await app.inject({ method: "GET", url: "/sync" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/value" })).json()).toEqual({ value: 1 });
    expect(inFlight.pending).toBe(0);
    await app.close();
  });
});
