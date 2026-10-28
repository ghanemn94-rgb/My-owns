// P6 slice C (T-DG6-BE-I; ADR-0054 §3 "Test target"; D-195 Q7): an in-process SMTP server for the email adapter's
// contract test. It records envelopes and messages, offers STARTTLS when given a certificate, accepts or refuses AUTH
// (PLAIN and LOGIN), and can drop the connection in the middle of DATA. It is a test double, not a mail server: it
// never relays. Every address and credential it sees in the tests is synthetic. Live mail is a residual (D-195 Q7).
// Port: a free port from MTH_PORT_POOL when it is set (the harness range, p6-work-split §2 rule 8), else an OS-assigned
// port on 127.0.0.1 (the FakeIdp precedent).
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { TLSSocket, createSecureContext } from "node:tls";

export interface FakeSmtpMessage {
  readonly mailFrom: string;
  readonly rcptTo: readonly string[];
  /** The DATA section with dot-stuffing removed and the terminating line excluded. */
  readonly data: string;
  readonly authUser: string | null;
  readonly tls: boolean;
}

export interface FakeSmtpOptions {
  /** PEM key and certificate: the server advertises STARTTLS (and requires TLS before AUTH when `requireTls`). */
  readonly starttls?: { readonly key: string; readonly cert: string };
  /** Accepted credentials; with `"reject"` every AUTH attempt fails with 535. Absent = AUTH not advertised. */
  readonly auth?: { readonly user: string; readonly pass: string } | "reject";
  /** Close the connection after this many DATA bytes of a message (simulates a drop mid-DATA). */
  readonly dropDuringDataAfterBytes?: number;
  /** Reply to RCPT TO with this code (for example 550 or 451) instead of 250. */
  readonly rcptReply?: number;
}

function poolPorts(): number[] {
  const pool = process.env["MTH_PORT_POOL"];
  const m = pool ? /^(\d+)-(\d+)$/.exec(pool) : null;
  if (!m) return [];
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!(lo > 0 && hi >= lo && hi < 32768)) return [];
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, 25);
}

function listenOn(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      server.off("listening", onListening);
      resolve(false);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export class FakeSmtp {
  readonly messages: FakeSmtpMessage[] = [];
  /** AUTH attempts that were refused. */
  authFailures = 0;
  /** Connections accepted (each send opens one). */
  connections = 0;
  port = 0;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private options: FakeSmtpOptions;

  constructor(options: FakeSmtpOptions = {}) {
    this.options = options;
    this.server = createServer((socket) => this.session(socket));
  }

  /** Replaces the behaviour for the next connections (the recorded messages stay). */
  configure(options: FakeSmtpOptions): void {
    this.options = options;
  }

  async start(): Promise<this> {
    for (const port of poolPorts()) {
      if (await listenOn(this.server, port)) {
        this.port = (this.server.address() as AddressInfo).port;
        return this;
      }
    }
    if (!(await listenOn(this.server, 0))) throw new Error("fake SMTP: could not listen");
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private session(raw: Socket): void {
    this.connections += 1;
    this.sockets.add(raw);
    raw.on("close", () => this.sockets.delete(raw));
    raw.on("error", () => undefined);
    const opts = this.options;
    let socket: Socket = raw;
    let secure = false;
    let buffer = "";
    let mode: "command" | "data" | "auth_login_user" | "auth_login_pass" = "command";
    let loginUser = "";
    let authUser: string | null = null;
    let mailFrom: string | null = null;
    let rcptTo: string[] = [];
    let dataLines: string[] = [];
    let dataBytes = 0;

    const write = (line: string) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };
    const checkAuth = (user: string, pass: string) => {
      if (opts.auth && opts.auth !== "reject" && user === opts.auth.user && pass === opts.auth.pass) {
        authUser = user;
        write("235 2.7.0 Authentication successful");
      } else {
        this.authFailures += 1;
        write("535 5.7.8 Authentication credentials invalid");
      }
    };
    const ehlo = () => {
      const ext: string[] = ["250-fake-smtp.test", "250-8BITMIME", "250-SMTPUTF8", "250-PIPELINING"];
      if (opts.starttls && !secure) ext.push("250-STARTTLS");
      if (opts.auth) ext.push("250-AUTH PLAIN LOGIN");
      ext.push("250 SIZE 10485760");
      for (const e of ext) write(e);
    };

    const onLine = (line: string): boolean => {
      if (mode === "data") {
        if (line === ".") {
          mode = "command";
          this.messages.push({
            mailFrom: mailFrom ?? "",
            rcptTo: [...rcptTo],
            data: dataLines.join("\r\n"),
            authUser,
            tls: secure,
          });
          mailFrom = null;
          rcptTo = [];
          dataLines = [];
          write("250 2.0.0 Ok: queued");
          return true;
        }
        dataBytes += line.length + 2;
        if (opts.dropDuringDataAfterBytes !== undefined && dataBytes >= opts.dropDuringDataAfterBytes) {
          socket.destroy();
          return false;
        }
        dataLines.push(line.startsWith("..") ? line.slice(1) : line);
        return true;
      }
      if (mode === "auth_login_user") {
        loginUser = Buffer.from(line, "base64").toString("utf8");
        mode = "auth_login_pass";
        write(`334 ${Buffer.from("Password:").toString("base64")}`);
        return true;
      }
      if (mode === "auth_login_pass") {
        mode = "command";
        checkAuth(loginUser, Buffer.from(line, "base64").toString("utf8"));
        return true;
      }
      const [verb = "", ...rest] = line.split(" ");
      const arg = rest.join(" ");
      switch (verb.toUpperCase()) {
        case "EHLO":
          ehlo();
          return true;
        case "HELO":
          write("250 fake-smtp.test");
          return true;
        case "STARTTLS": {
          if (!opts.starttls || secure) {
            write("502 5.5.1 STARTTLS not available");
            return true;
          }
          write("220 2.0.0 Ready to start TLS");
          const context = createSecureContext({ key: opts.starttls.key, cert: opts.starttls.cert });
          raw.removeAllListeners("data");
          const tlsSocket = new TLSSocket(raw, { isServer: true, secureContext: context });
          tlsSocket.on("error", () => undefined);
          tlsSocket.on("secure", () => {
            secure = true;
          });
          socket = tlsSocket;
          buffer = "";
          tlsSocket.on("data", onData);
          return false;
        }
        case "AUTH": {
          if (!opts.auth) {
            write("502 5.5.1 AUTH not available");
            return true;
          }
          const [mech = "", initial] = arg.split(" ");
          if (mech.toUpperCase() === "PLAIN") {
            if (!initial) {
              write("334 ");
              mode = "command";
              return true;
            }
            const parts = Buffer.from(initial, "base64").toString("utf8").split("\u0000");
            checkAuth(parts[1] ?? "", parts[2] ?? "");
            return true;
          }
          if (mech.toUpperCase() === "LOGIN") {
            if (initial) {
              loginUser = Buffer.from(initial, "base64").toString("utf8");
              mode = "auth_login_pass";
              write(`334 ${Buffer.from("Password:").toString("base64")}`);
            } else {
              mode = "auth_login_user";
              write(`334 ${Buffer.from("Username:").toString("base64")}`);
            }
            return true;
          }
          write("504 5.5.4 Unrecognized authentication type");
          return true;
        }
        case "MAIL": {
          const m = /^FROM:\s*<([^>]*)>/i.exec(arg);
          if (!m) {
            write("501 5.5.4 Syntax error");
            return true;
          }
          mailFrom = m[1]!;
          rcptTo = [];
          write("250 2.1.0 Ok");
          return true;
        }
        case "RCPT": {
          const m = /^TO:\s*<([^>]*)>/i.exec(arg);
          if (!m || mailFrom === null) {
            write("503 5.5.1 Bad sequence");
            return true;
          }
          if (opts.rcptReply !== undefined && opts.rcptReply !== 250) {
            write(`${opts.rcptReply} ${opts.rcptReply >= 500 ? "5" : "4"}.1.1 Recipient refused`);
            return true;
          }
          rcptTo.push(m[1]!);
          write("250 2.1.5 Ok");
          return true;
        }
        case "DATA":
          if (mailFrom === null || rcptTo.length === 0) {
            write("503 5.5.1 Bad sequence");
            return true;
          }
          mode = "data";
          dataBytes = 0;
          write("354 End data with <CR><LF>.<CR><LF>");
          return true;
        case "RSET":
          mailFrom = null;
          rcptTo = [];
          write("250 2.0.0 Ok");
          return true;
        case "NOOP":
          write("250 2.0.0 Ok");
          return true;
        case "QUIT":
          write("221 2.0.0 Bye");
          socket.end();
          return false;
        default:
          write("500 5.5.2 Command not recognized");
          return true;
      }
    };

    function onData(chunk: Buffer): void {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (!onLine(line)) return;
      }
    }

    raw.on("data", onData);
    write("220 fake-smtp.test ESMTP (synthetic test server)");
  }
}

/** Decodes a quoted-printable or base64 body part enough to find text in a recorded message. */
export function decodedBody(data: string): string {
  const [headers = "", ...bodyParts] = data.split("\r\n\r\n");
  const body = bodyParts.join("\r\n\r\n");
  if (/content-transfer-encoding:\s*base64/i.test(headers))
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
    const soft = body.replace(/=\r\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < soft.length; i++) {
      if (soft[i] === "=" && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) {
        bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(...Buffer.from(soft[i]!, "utf8"));
    }
    return Buffer.from(bytes).toString("utf8");
  }
  return body;
}

/** The decoded Subject header of a recorded message (RFC 2047 encoded words, B and Q). */
export function decodedSubject(data: string): string {
  const headers = data.split("\r\n\r\n")[0] ?? "";
  const m = /^Subject:(.*(?:\r\n[ \t].*)*)/im.exec(headers);
  if (!m) return "";
  const raw = m[1]!.replace(/\r\n[ \t]/g, " ").trim();
  return raw
    .replace(/=\?utf-8\?([BQ])\?([^?]*)\?=\s*(?==\?)/gi, "=?utf-8?$1?$2?=")
    .replace(/=\?utf-8\?([BQ])\?([^?]*)\?=/gi, (_w, enc: string, text: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : Buffer.from(
            text
              .replace(/_/g, " ")
              .replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
            "latin1",
          ).toString("utf8"),
    );
}
