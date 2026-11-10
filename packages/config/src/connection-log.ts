// The A21 connection log (ADR-0059 §12; D-195 Q8 "a connection log, not a packet capture"; REQ-S17-009, REQ-S17-010;
// T-DG6-BE-T). When MTH_CONNECTION_LOG names a file and NODE_ENV is not `production`, `installConnectionLog` subscribes
// to two Node diagnostics channels and appends one JSON line per outbound connection attempt of this process:
//   - `undici:client:beforeConnect`: every connection `fetch` (undici) opens: the host name and port it connects to;
//   - `net.client.socket`: every outbound TCP socket (net.connect, http, pg, SMTP...): the remote address and port,
//     written when the socket connects (or, for an attempt that never connects, when it closes, with what is known:
//     the host asked for, and the address and port dialled once an attempt started; T-DG6-BE-X3, QA-D-2).
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
  /**
   * The host name asked for (fetch: the URL's host; a socket: the name it looked up, or for an IP literal the address
   * it dialled), else null (a local IPC socket, or a socket destroyed before its first attempt).
   */
  readonly host: string | null;
  /**
   * The remote IP address of a connected socket, else the address its last attempt dialled, else null (fetch lines are
   * written before the address is known; a failed lookup dials nothing).
   */
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
    // What is known about the destination (T-DG6-BE-X3, QA-D-2: a socket that never connects is no longer logged with
    // nulls). Node publishes this message inside `socket.connect(...)` before it looks the host up, so every source
    // below is a public socket event of that same call:
    //  - `lookup`: the host name asked for (emitted also when the lookup fails; Node skips it for an IP literal);
    //  - `connectionAttempt` (Node 22 and 24): the address and port each attempt dials. For an IP literal that address
    //    IS the requested host, so it is the host when no lookup happened;
    //  - `connect`: the remote address and port of the connected socket.
    // A lookup that fails dials nothing, so its line has the host and a null port: no TCP attempt was made.
    let lookedUp: string | null = null;
    let attempt: { address: string | null; port: number | null } = { address: null, port: null };
    let written = false;
    socket.once("lookup", (_err: Error | null, _address: string, _family: unknown, name: string) => {
      lookedUp = typeof name === "string" && name !== "" ? name : null;
    });
    socket.on("connectionAttempt", (address: unknown, port: unknown) => {
      attempt = { address: typeof address === "string" && address !== "" ? address : null, port: portOf(port) };
    });
    const line = () =>
      write(
        "net.client.socket",
        lookedUp ?? attempt.address,
        socket.remoteAddress ?? attempt.address,
        portOf(socket.remotePort) ?? attempt.port,
      );
    socket.once("connect", () => {
      written = true;
      line();
    });
    // An attempt that never connected (refused, unreachable, aborted) is still an attempt: logged with what is known.
    socket.once("close", () => {
      if (!written) line();
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
