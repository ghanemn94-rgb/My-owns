// Errors that Fastify or Node answer BEFORE any route, hook or error handler runs (T-DG2-BE12). Without these handlers
// they are plain `application/json` bodies (`{"error":"Bad Request","code":"FST_ERR_BAD_URL",...}`) with no security
// headers and no X-Request-Id, which breaks the contract: every operation declares 400 as the shared ValidationError
// (`application/problem+json`, a Problem body).
//
//   1. `frameworkErrors` (Fastify server option): router-level errors for a request Node has parsed
//      - FST_ERR_BAD_URL: a path with an undecodable percent escape (`%ZZ`, CESU-8 `%ED%A0%80`) -> 400 validation.format;
//      - FST_ERR_ASYNC_CONSTRAINT: an async route-constraint strategy failed (none is registered today) -> 500 internal;
//      - any other code -> the same generic mapping as `setErrorHandler` (`problemForError`), never a plain body.
//      Fastify runs it in a bare context: no onRequest/onSend hook (helmet, X-Request-Id) runs, so the handler sets the
//      security headers and X-Request-Id itself.
//   2. `clientErrorHandler` (Fastify server option, Node's `clientError`): the HTTP parser refused the request before a
//      request object exists (header block or request line over Node's limit, malformed request, request timeout).
//      The answer is written to the socket as a problem with the same security headers and a generated request id.
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { closeIfBodyUnconsumed } from "./connection-hygiene.ts";
import { problemForError, sendProblem } from "./hooks.ts";
import type { RouteConsumesSource } from "./media-types.ts";
import { problems, type HttpProblem } from "./problem.ts";

/** Static response headers that the security plugin (helmet) adds to every routed response. */
export type SecurityHeaders = Readonly<Record<string, string>>;

export const BAD_URL_DETAIL = "The request URL contains an invalid percent-encoding.";

/** The problem for a router-level (framework) error. */
export function frameworkProblem(error: FastifyError, request: RouteConsumesSource): HttpProblem {
  switch (error.code) {
    case "FST_ERR_BAD_URL":
      return problems.badRequest("validation.format", BAD_URL_DETAIL);
    case "FST_ERR_ASYNC_CONSTRAINT":
      return problems.internal();
    default:
      return problemForError(error, request);
  }
}

/** Fastify `frameworkErrors`: answers every router-level error as an RFC 9457 problem (no internals, with requestId). */
export function createFrameworkErrorHandler(
  securityHeaders: SecurityHeaders,
): (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => void {
  return (error, request, reply) => {
    const problem = frameworkProblem(error, request);
    if (problem.status >= 500) request.log.error({ err: error }, "router-level error");
    else request.log.info({ code: error.code }, "request refused by the router");
    // The bare framework context runs no onRequest/onSend hooks: set what they would have set.
    reply.headers(securityHeaders);
    reply.header("X-Request-Id", request.id);
    // T-DG2-BE16: nor the connection-hygiene onSend hook: an unread body is never drained into the server.
    closeIfBodyUnconsumed(request, reply);
    void sendProblem(reply, request, problem);
  };
}

/** The problem for a connection-level parser error (Node `clientError`). */
export function clientErrorProblem(code: string | undefined): HttpProblem {
  switch (code) {
    case "HPE_HEADER_OVERFLOW":
      // Node counts the request line (method + URL) and the headers against one limit, so a URL that is too long
      // lands here too. Answered as the declared 400 (like an oversized body, validation.body_too_large), not 431.
      return problems.badRequest("validation.headers_too_large", "The request URL or headers are too large.");
    case "ERR_HTTP_REQUEST_TIMEOUT":
      return problems.requestTimeout();
    default:
      return problems.badRequest("validation.malformed_request", "The request is not a valid HTTP request.");
  }
}

interface ConnectionErrorLike extends Error {
  code?: string;
}

/** The part of a net.Socket this handler uses (structural, so the module needs no extra node: built-in). */
interface ClientSocket {
  readonly destroyed: boolean;
  readonly writable: boolean;
  write(data: string): unknown;
  destroy(error?: Error): unknown;
}

/** Reason phrases for the statuses `clientErrorProblem` can return. */
function reasonPhrase(status: number): string {
  if (status === 408) return "Request Timeout";
  if (status === 400) return "Bad Request";
  return "Error";
}

/**
 * Fastify `clientErrorHandler`. Mirrors Fastify's default (no answer on a reset or destroyed socket; never write into a
 * response that has already started), but the body is a problem with security headers and a request id.
 */
export function createClientErrorHandler(
  securityHeaders: SecurityHeaders,
  log: (requestId: string, code: string | undefined) => void = () => undefined,
): (error: ConnectionErrorLike, socket: ClientSocket) => void {
  return (error, socket) => {
    if (error.code === "ECONNRESET" || socket.destroyed) return;
    const inFlight = (socket as ClientSocket & { _httpMessage?: { headersSent?: boolean } })._httpMessage;
    if (socket.writable && !inFlight?.headersSent) {
      const requestId = uuidv7();
      log(requestId, error.code);
      const problem = clientErrorProblem(error.code);
      const body = JSON.stringify(problem.toBody(requestId));
      const headers: Record<string, string> = {
        ...securityHeaders,
        "x-request-id": requestId,
        "content-type": "application/problem+json; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
        connection: "close",
      };
      const head = Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      socket.write(`HTTP/1.1 ${problem.status} ${reasonPhrase(problem.status)}\r\n${head}\r\n\r\n${body}`);
    }
    socket.destroy(error);
  };
}
