// P6 (ADR-0059 §2; p6-work-split §D.1; T-DG6-BE-T): an in-process fake chat-completions server for the assistant's HTTP
// adapter contract suite. No dependency. It records every request (method, path, headers it needs, the parsed JSON
// body) and answers in the `openai_chat_completions` wire format, or fails the way a real endpoint fails: a valid
// envelope, plain text content, an HTTP status (500), an oversized body, a redirect, a stall (no response at all) or a
// body that stalls after its first bytes.
// Port: a free port from MTH_PORT_POOL when it is set (the harness range, p6-work-split §2 rule 8), else an
// OS-assigned port on 127.0.0.1 (the FakeHttpSource precedent). Loopback only: this is NOT a model, NOT an IT endpoint
// and nothing proven against it is "live" (p6-plan R3, p6-work-split §2 rule 14). Every value is SYNTHETIC.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeModelBehaviour =
  | { readonly kind: "envelope"; readonly answer: string; readonly citations?: unknown; readonly suggestions?: unknown }
  | { readonly kind: "text"; readonly content: string }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "raw"; readonly body: string }
  | { readonly kind: "oversized"; readonly bytes: number }
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "stall" }
  | { readonly kind: "stall_body" };

export interface FakeModelRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  /** The parsed JSON body (null when it was not JSON). */
  readonly body: Record<string, unknown> | null;
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

export class FakeModel {
  private readonly server: Server;
  private readonly open = new Set<ServerResponse>();
  private behaviour: FakeModelBehaviour = { kind: "envelope", answer: "Synthetic fake answer.", citations: [] };
  readonly requests: FakeModelRequest[] = [];
  port = 0;

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
    // No keep-alive reuse across tests: every request opens its own connection (the connection-log test counts them).
    this.server.keepAliveTimeout = 1;
  }

  /** The chat-completions URL of this fake (http on loopback; tests use NODE_ENV=test). */
  get url(): string {
    return `http://127.0.0.1:${this.port}/v1/chat/completions`;
  }

  configure(behaviour: FakeModelBehaviour): void {
    this.behaviour = behaviour;
  }

  /** How many requests reached the fake. */
  get requestCount(): number {
    return this.requests.length;
  }

  async start(): Promise<this> {
    for (const port of poolPorts()) {
      if (await listenOn(this.server, port)) {
        this.port = (this.server.address() as AddressInfo).port;
        return this;
      }
    }
    if (!(await listenOn(this.server, 0))) throw new Error("fake model: cannot listen on 127.0.0.1");
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    for (const res of this.open) res.destroy();
    this.open.clear();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        body = null;
      }
      this.requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: req.headers.authorization ?? null,
        contentType: req.headers["content-type"] ?? null,
        body,
      });
      this.respond(res);
    });
  }

  private respond(res: ServerResponse): void {
    const b = this.behaviour;
    const completion = (content: string) =>
      JSON.stringify({
        id: "synthetic-completion",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      });
    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", connection: "close", ...headers });
      res.end(body);
    };
    switch (b.kind) {
      case "envelope":
        return send(
          200,
          completion(
            JSON.stringify({ answer: b.answer, citations: b.citations ?? [], suggestions: b.suggestions ?? [] }),
          ),
        );
      case "text":
        return send(200, completion(b.content));
      case "status":
        return send(b.status, JSON.stringify({ error: { message: "synthetic failure" } }));
      case "raw":
        return send(200, b.body);
      case "oversized": {
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let left = b.bytes;
        this.open.add(res);
        const pump = () => {
          while (left > 0) {
            const n = Math.min(left, chunk.length);
            left -= n;
            if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return void res.once("drain", pump);
          }
          this.open.delete(res);
          res.end();
        };
        res.on("close", () => this.open.delete(res));
        return pump();
      }
      case "redirect":
        return send(307, "", { location: b.location });
      case "stall":
        this.open.add(res);
        return;
      case "stall_body":
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.write('{"choices":[');
        this.open.add(res);
        return;
    }
  }
}
