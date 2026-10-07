// T-DG2-BE16: a request body the server answered before consuming never holds a connection, and shutdown is bounded.
//
// Root cause (audit round 10, blocking condition 2). When a handler stops reading a request body early (the evidence
// upload's streaming size limit throws inside `for await (const chunk of request.body)`), the async iterator's
// `return()` calls Node's stream `destroyer()`. For a server IncomingMessage that sets `req.socket = null` FIRST (so
// the response can still be written) and then destroys the request. The socket survives, but the HTTP parser is still
// in the middle of the body: the next body chunk is pushed into the destroyed request, `push()` returns false and the
// parser calls `readStop()` on the socket. Nothing ever calls `_read()` again, so the socket stays PAUSED for good.
//   - The response is sent with `Connection: keep-alive` (Node does not know the body was abandoned).
//   - A paused socket never reads the client's FIN/RST, so a client that goes away is not noticed.
//   - The connection is not idle (its request never completed), so `server.close()` / Fastify's default
//     `forceCloseConnections: "idle"` leave it alone, and Fastify's `requestTimeout` default 0 never expires it.
//   - Only the keep-alive socket timeout that Node arms after the response (Fastify `keepAliveTimeout` default 72 s)
//     destroys it: the ~65 s the auditor saw after the client's 8 s wait. `app.close()` (and SIGTERM in main.ts) waited
//     for exactly that.
// The sibling case, a response sent BEFORE the body is read (401/403/404/409/428/400 on the upload route), is not
// paused but drained: Node's `resOnFinish` calls `req._dump()`, which reads and discards the whole body, however large
// or slow, and keeps the connection alive.
//
// Policy (one place for every path):
//   1. A response sent while the request body is incomplete (`request.raw.complete === false`) carries
//      `Connection: close`. Node then ends the connection after the response instead of draining or holding it.
//   2. That close is a bounded "lingering close" (RFC 9112 §9.6): the response is flushed, the write side is shut
//      down (FIN), and the socket is destroyed RST_AVOIDANCE_DELAY_MS later (at most LINGER_CAP_MS after the close
//      starts, even if the client never reads). The delay lets the client read the response before the reset that
//      closing with unread body bytes causes. The unread body is never drained.
//   3. Requests whose body was fully received keep their keep-alive connection (normal 2xx and small refusals).
//   4. Shutdown: `app.close()` stops accepting connections and closes idle keep-alive ones at once (Fastify's
//      `forceCloseConnections: "idle"`). Responses sent while closing carry `Connection: close`. In-flight requests get
//      `shutdownGraceMs` to finish; after it every remaining connection is destroyed (`server.closeAllConnections()`),
//      so a stalled upload can delay shutdown by at most the grace period.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Delay between the half-close (FIN) and the destroy of a connection closed with an unread body (Go uses 500 ms). */
export const RST_AVOIDANCE_DELAY_MS = 500;
/** Upper bound of a lingering close, from its start, even when the client reads nothing. */
export const LINGER_CAP_MS = 2_000;
/** Time in-flight requests get to finish after `app.close()` before every remaining connection is destroyed. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
/**
 * Node `requestTimeout`: the longest time a request (headers AND body) may take to arrive; then Node answers 408 and
 * closes the connection (platform/framework-errors.ts). Fastify's default 0 disables it, which let a stalled body hold
 * its connection (and, on the upload route, a pooled database connection) indefinitely. 300 s is Node's own default and
 * fits a 25 MiB evidence upload at about 0.7 Mbit/s.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/** The part of a net.Socket used here (structural, so the platform module imports no node: built-in). */
interface LingerSocket {
  readonly writable: boolean;
  readonly writableFinished: boolean;
  readonly destroyed: boolean;
  end(): unknown;
  destroy(): unknown;
  once(event: "finish" | "close", listener: () => void): unknown;
  destroySoon?: () => void;
}

/** Sockets whose close is already a lingering close. */
const lingering = new WeakSet<object>();

/**
 * Makes Node's close-after-response for this socket a bounded lingering close. Node calls `socket.destroySoon()` after
 * a response that carried `Connection: close` (`_http_server` resOnFinish); its default ends the socket and destroys
 * it as soon as the response is flushed. Exported for tests.
 */
export function lingerOnClose(socket: LingerSocket | null | undefined): void {
  if (!socket || socket.destroyed || typeof socket.destroySoon !== "function") return;
  if (lingering.has(socket)) return;
  lingering.add(socket);
  socket.destroySoon = function lingeringClose(this: LingerSocket): void {
    const destroy = () => {
      if (!this.destroyed) this.destroy();
    };
    const cap = setTimeout(destroy, LINGER_CAP_MS);
    cap.unref();
    const afterFlush = () => setTimeout(destroy, RST_AVOIDANCE_DELAY_MS).unref();
    this.once("close", () => clearTimeout(cap));
    if (this.writable) this.end();
    if (this.writableFinished) afterFlush();
    else this.once("finish", afterFlush);
  };
}

/** The request body has not been received completely (light-my-request has no `complete`: never "unconsumed"). */
export function bodyUnconsumed(request: Pick<FastifyRequest, "raw">): boolean {
  return (request.raw as { complete?: unknown }).complete === false;
}

/** Sets `Connection: close` and the lingering close on a reply whose request body is unread. Returns whether it did. */
export function closeIfBodyUnconsumed(request: Pick<FastifyRequest, "raw">, reply: FastifyReply): boolean {
  if (!bodyUnconsumed(request)) return false;
  closeAfterResponse(request, reply);
  return true;
}

function closeAfterResponse(request: Pick<FastifyRequest, "raw">, reply: FastifyReply): void {
  if (!reply.raw.headersSent) reply.header("connection", "close");
  // The request's socket reference is null once a body iterator destroyed the request; the response keeps it.
  lingerOnClose((reply.raw.socket ?? request.raw.socket) as unknown as LingerSocket | null);
}

export interface ConnectionHygieneOptions {
  /** See DEFAULT_SHUTDOWN_GRACE_MS. */
  readonly shutdownGraceMs?: number;
}

/**
 * Registers the policy on the root instance (every route and the not-found handler inherit the onSend hook). The
 * router-level `frameworkErrors` handler runs no onSend hook and applies `closeIfBodyUnconsumed` itself.
 */
export function registerConnectionHygiene(app: FastifyInstance, options: ConnectionHygieneOptions = {}): void {
  const graceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  let closing = false;

  app.addHook("onSend", async (request, reply, payload) => {
    if (closing) closeAfterResponse(request, reply);
    else closeIfBodyUnconsumed(request, reply);
    return payload;
  });

  app.addHook("preClose", (done) => {
    closing = true;
    const server = app.server;
    if (server.listening) {
      const deadline = setTimeout(() => {
        server.getConnections((_err, open) => {
          if (open > 0)
            app.log.warn({ open, graceMs }, "shutdown grace period elapsed: closing the remaining connections");
          server.closeAllConnections();
        });
      }, graceMs);
      deadline.unref();
      server.once("close", () => clearTimeout(deadline));
    }
    done();
  });
}
