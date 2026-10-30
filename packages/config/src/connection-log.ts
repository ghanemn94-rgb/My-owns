// The A21 connection log (ADR-0059 §12; D-195 Q8 "a connection log, not a packet capture"; REQ-S17-009, REQ-S17-010;
// T-DG6-BE-T). When MTH_CONNECTION_LOG names a file and NODE_ENV is not `production`, `installConnectionLog` subscribes
// to two Node diagnostics channels and appends one JSON line per outbound connection attempt of this process:
//   - `undici:client:beforeConnect`: every connection `fetch` (undici) opens: the host name and port it connects to;
//   - `net.client.socket`: every outbound TCP socket (net.connect, http, pg, SMTP...): the remote address and port,
//     written when the socket connects (or, for an attempt that never connects, when it closes, with what is known).
// Each line is `{at, process, channel, host, address, port}`; nothing else (no path, header, body or credential).
// In production the variable is ignored and one warning is emitted: the log is a test instrument (QA-D's A21 check,
// e2e/support/connection-log-check.ts), never a production feature. What it does NOT see: connections made outside
// this Node process (the browser, the database server, the operating system); a full packet capture is DG7's A18.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { appendFileSync } from "node:fs";
import type { Socket } from "node:net";

/** The environment variable that turns the log on (a file path). */
export const CONNECTION_LOG_VARIABLE = "MTH_CONNECTION_LOG";
/** The two channels (ADR-0059 §12; both published by Node 22 and 24: connection-log-channel-check.txt). */
export const CONNECTION_LOG_CHANNELS = ["undici:client:beforeConnect", "net.client.socket"] as const;
export type ConnectionLogChannel = (typeof CONNECTION_LOG_CHANNELS)[number];

/** One line of the log. */
export interface ConnectionLogLine {
  readonly at: string;
  readonly process: string;
  readonly channel: ConnectionLogChannel;
  /** The host name asked for (fetch: the URL's host; a socket: the name it looked up), else null. */
  readonly host: string | null;
  /** The remote IP address of a connected socket, else null (fetch lines are written before the address is known). */
  readonly address: string | null;
  readonly port: number | null;
}

export interface ConnectionLogOptions {
  /** The environment to read (default process.env). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the production warning goes (default process.emitWarning). */
  readonly warn?: (message: string) => void;
}

/** An installed log; `uninstall` removes both subscriptions (tests, and a clean shutdown). */
export interface ConnectionLogHandle {
  readonly file: string;
  uninstall(): void;
}

const PRODUCTION_WARNING =
  "MTH_CONNECTION_LOG is ignored in production: the connection log is a test instrument (ADR-0059 §12).";

function portOf(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : null;
}

/**
 * Installs the connection log for this process (`processName`: "api", "worker"...). Returns null, and writes nothing,
 * when the variable is unset or empty, or when NODE_ENV is production (then with one warning).
 */
export function installConnectionLog(
  processName: string,
  options: ConnectionLogOptions = {},
): ConnectionLogHandle | null {
  const env = options.env ?? process.env;
  const file = env[CONNECTION_LOG_VARIABLE];
  if (file === undefined || file === "") return null;
  if (env["NODE_ENV"] === "production") {
    (options.warn ?? ((m: string) => process.emitWarning(m)))(PRODUCTION_WARNING);
    return null;
  }

  const write = (channel: ConnectionLogChannel, host: string | null, address: string | null, port: number | null) => {
    const line: ConnectionLogLine = {
      at: new Date().toISOString(),
      process: processName,
      channel,
      host,
      address,
      port,
    };
    try {
      appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch {
      // A test instrument must never break the process it observes; a missing line fails the A21 checker instead.
    }
  };

  const onFetchConnect = (message: unknown) => {
    const params = (message as { connectParams?: { hostname?: unknown; host?: unknown; port?: unknown } })
      .connectParams;
    const host = typeof params?.hostname === "string" ? params.hostname : null;
    write("undici:client:beforeConnect", host, null, portOf(params?.port));
  };

  const onSocket = (message: unknown) => {
    const socket = (message as { socket?: Socket }).socket;
    if (socket === undefined) return;
    let host: string | null = null;
    let written = false;
    socket.once("lookup", (_err: Error | null, _address: string, _family: unknown, name: string) => {
      host = typeof name === "string" ? name : null;
    });
    socket.once("connect", () => {
      written = true;
      write("net.client.socket", host, socket.remoteAddress ?? null, portOf(socket.remotePort));
    });
    // An attempt that never connected (refused, unreachable, aborted) is still an attempt: logged with what is known.
    socket.once("close", () => {
      if (!written) write("net.client.socket", host, socket.remoteAddress ?? null, portOf(socket.remotePort));
    });
  };

  subscribe("undici:client:beforeConnect", onFetchConnect);
  subscribe("net.client.socket", onSocket);
  return {
    file,
    uninstall() {
      unsubscribe("undici:client:beforeConnect", onFetchConnect);
      unsubscribe("net.client.socket", onSocket);
    },
  };
}
