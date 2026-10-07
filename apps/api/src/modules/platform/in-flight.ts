// T-DG2-BE18A (F-DG2-460): graceful shutdown waits for in-flight request handlers to SETTLE, including their
// catch/finally cleanup, before the database pool is destroyed and the process exits.
//
// Why: `app.close()` resolves once every connection is gone. The shutdown grace (connection-hygiene.ts) destroys the
// connections still open after DEFAULT_SHUTDOWN_GRACE_MS, which makes a handler that is still reading its request body
// (the evidence upload's phase 2, `store.receive`) fail and clean up its temporary object asynchronously: close the
// file handle, then remove the `.part` file. Before BE17 that handler held a pooled connection, so `db.destroy()` waited
// for it by accident. Since BE17 it holds none, and `process.exit()` ran before the removal: the `.part` file stayed.
// Now every route handler's promise is tracked (an `onRoute` hook wraps the handler; the returned promise is the
// handler's own, unchanged), and so is other asynchronous work that runs outside a handler and must finish before the
// pool closes (the failed-mutation audit hook, the evidence store's start-up sweep). main.ts awaits `settled()` between
// `app.close()` and `db.destroy()`.
import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface InFlight {
  /** Operations started and not yet settled. */
  readonly pending: number;
  /** Tracks `work` until it settles (fulfilled or rejected) and returns the SAME promise. */
  track<T>(work: Promise<T>): Promise<T>;
  /**
   * Resolves true once nothing is pending (re-checked after a macrotask, so work that a settling handler starts
   * synchronously, such as Fastify's onError hooks, is seen too), or false when `timeoutMs` elapses first.
   */
  settled(timeoutMs: number): Promise<boolean>;
}

declare module "fastify" {
  interface FastifyInstance {
    /** The instance's in-flight tracker (registerInFlightTracking). */
    inFlight: InFlight;
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createInFlight(): InFlight {
  const pending = new Set<Promise<unknown>>();
  return {
    get pending() {
      return pending.size;
    },
    track<T>(work: Promise<T>): Promise<T> {
      const entry: Promise<unknown> = work.then(
        () => pending.delete(entry),
        () => pending.delete(entry),
      );
      pending.add(entry);
      return work;
    },
    async settled(timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (pending.size === 0) {
          await tick();
          if (pending.size === 0) return true;
          continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled([...pending]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, remaining);
          }),
        ]);
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Decorates the instance with an in-flight tracker and wraps every route handler registered AFTER this call (register
 * it before the modules). A handler that returns a promise is tracked until that promise settles; the wrapper returns
 * the handler's own result, so Fastify's handling of it is unchanged.
 */
export function registerInFlightTracking(app: FastifyInstance): InFlight {
  const inFlight = createInFlight();
  app.decorate("inFlight", inFlight);
  app.addHook("onRoute", (route) => {
    const handler = route.handler;
    const tracked: RouteHandlerMethod = function trackedHandler(this: FastifyInstance, request, reply) {
      const result: unknown = handler.call(this, request, reply);
      if (result instanceof Promise) inFlight.track(result);
      return result as ReturnType<RouteHandlerMethod>;
    };
    route.handler = tracked;
  });
  return inFlight;
}
