// T-DG2-BE16 unit tests of the connection-hygiene policy (no network; the real-socket behaviour is covered by
// apps/api/test/integration/connection-hygiene.test.ts).
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bodyUnconsumed,
  closeIfBodyUnconsumed,
  LINGER_CAP_MS,
  lingerOnClose,
  registerConnectionHygiene,
  RST_AVOIDANCE_DELAY_MS,
} from "./connection-hygiene.ts";

/** A minimal once/emit emitter (the platform's tests import no extra node: built-in). */
class FakeSocket {
  private readonly listeners: Array<{ event: string; fn: () => void }> = [];
  once(event: string, fn: () => void) {
    this.listeners.push({ event, fn });
    return this;
  }
  emit(event: string) {
    const due = this.listeners.filter((l) => l.event === event);
    for (const l of due) this.listeners.splice(this.listeners.indexOf(l), 1);
    for (const l of due) l.fn();
  }
  writable = true;
  writableFinished = false;
  destroyed = false;
  ended = 0;
  destroyedAt: number | null = null;
  originalDestroySoonCalls = 0;
  end() {
    this.ended += 1;
    this.writable = false;
  }
  destroy() {
    this.destroyed = true;
    this.destroyedAt = Date.now();
    this.emit("close");
  }
  destroySoon() {
    this.originalDestroySoonCalls += 1;
    this.destroy();
  }
}

describe("lingerOnClose: Node's close-after-response becomes a bounded lingering close", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("half-closes at once and destroys RST_AVOIDANCE_DELAY_MS after the response is flushed", () => {
    const s = new FakeSocket();
    s.writableFinished = true;
    lingerOnClose(s);
    const t0 = Date.now();
    s.destroySoon();
    expect(s.ended).toBe(1);
    expect(s.destroyed).toBe(false);
    expect(s.originalDestroySoonCalls).toBe(0);
    vi.advanceTimersByTime(RST_AVOIDANCE_DELAY_MS - 1);
    expect(s.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(s.destroyed).toBe(true);
    expect(s.destroyedAt! - t0).toBe(RST_AVOIDANCE_DELAY_MS);
  });

  it("waits for the flush, but never longer than LINGER_CAP_MS (a client that reads nothing)", () => {
    const flushed = new FakeSocket();
    lingerOnClose(flushed);
    flushed.destroySoon();
    vi.advanceTimersByTime(100);
    flushed.writableFinished = true;
    flushed.emit("finish");
    vi.advanceTimersByTime(RST_AVOIDANCE_DELAY_MS);
    expect(flushed.destroyed).toBe(true);

    const stuck = new FakeSocket();
    lingerOnClose(stuck);
    stuck.destroySoon();
    vi.advanceTimersByTime(LINGER_CAP_MS - 1);
    expect(stuck.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(stuck.destroyed).toBe(true);
  });

  it("is idempotent and ignores a missing or destroyed socket", () => {
    const s = new FakeSocket();
    lingerOnClose(s);
    const patched = s.destroySoon;
    lingerOnClose(s);
    expect(s.destroySoon).toBe(patched);
    expect(() => lingerOnClose(null)).not.toThrow();
    const gone = new FakeSocket();
    gone.destroyed = true;
    const before = gone.destroySoon;
    lingerOnClose(gone);
    expect(gone.destroySoon).toBe(before);
  });
});

describe("bodyUnconsumed / closeIfBodyUnconsumed", () => {
  it("only an IncomingMessage with complete === false counts (light-my-request has no `complete`)", () => {
    expect(bodyUnconsumed({ raw: { complete: false } } as never)).toBe(true);
    expect(bodyUnconsumed({ raw: { complete: true } } as never)).toBe(false);
    expect(bodyUnconsumed({ raw: {} } as never)).toBe(false);
  });

  it("sets Connection: close and arms the lingering close on the response's socket", () => {
    const socket = new FakeSocket();
    const headers = new Map<string, string>();
    const reply = {
      raw: { headersSent: false, socket },
      header: (k: string, v: string) => headers.set(k, v),
    };
    expect(closeIfBodyUnconsumed({ raw: { complete: false, socket: null } } as never, reply as never)).toBe(true);
    expect([...headers]).toEqual([["connection", "close"]]);
    expect(socket.destroySoon.name).toBe("lingeringClose");
    expect(closeIfBodyUnconsumed({ raw: { complete: true } } as never, reply as never)).toBe(false);
  });
});

describe("registerConnectionHygiene", () => {
  it("an inject (no socket) response keeps its headers; once closing, responses carry Connection: close", async () => {
    const app = Fastify({ logger: false });
    registerConnectionHygiene(app, { shutdownGraceMs: 50 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    app.get("/ok", async () => ({ ok: true }));
    app.get("/slow", async () => {
      await gate;
      return { ok: true };
    });
    await app.ready();
    const ok = await app.inject({ method: "GET", url: "/ok" });
    expect(ok.headers["connection"]).not.toBe("close");
    const slow = app.inject({ method: "GET", url: "/slow" });
    await new Promise((r) => setTimeout(r, 10));
    const closing = app.close();
    await new Promise((r) => setTimeout(r, 30)); // close() has run its preClose hooks
    release();
    const res = await slow;
    await closing;
    expect(res.statusCode).toBe(200);
    expect(res.headers["connection"]).toBe("close");
  });
});
