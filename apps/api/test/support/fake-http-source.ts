// P6 (ADR-0055 §1, §3; p6-work-split §B/A.2; T-DG6-BE-L2): an in-process fake HTTP source for the `http_pull` adapter's
// contract suite. No dependency. It answers GET with the documented pull body ({rows, rowCount, controlTotal}) and can
// be told to fail the way a real source fails: an HTTP status, a hang (timeout), a malformed body, a non-string cell, an
// oversized body, or a required bearer token it does not receive.
// Port: a free port from MTH_PORT_POOL when it is set (the harness range, p6-work-split §2 rule 8), else an
// OS-assigned port on 127.0.0.1 (the FakeSmtp precedent). Loopback only; nothing here is a corporate source, and nothing
// here is "live" (p6-plan R3). Every value is SYNTHETIC.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeHttpSourceBehaviour =
  | {
      readonly kind: "rows";
      readonly rows: readonly Record<string, unknown>[];
      readonly rowCount?: number | null;
      readonly controlTotal?: string | null;
    }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "hang" }
  | { readonly kind: "raw"; readonly body: string; readonly contentType?: string }
  | { readonly kind: "oversized"; readonly bytes: number };

export interface FakeHttpSourceRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly authorization: string | null;
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

export class FakeHttpSource {
  private readonly server: Server;
  private readonly hanging = new Set<ServerResponse>();
  private behaviour: FakeHttpSourceBehaviour = { kind: "rows", rows: [] };
  /** When set, a request without `Authorization: Bearer <token>` is answered 401. */
  private bearer: string | null = null;
  readonly requests: FakeHttpSourceRequest[] = [];
  port = 0;

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  /** The base URL the transport maps the configured https endpoint to. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  configure(behaviour: FakeHttpSourceBehaviour, options: { bearer?: string | null } = {}): void {
    this.behaviour = behaviour;
    this.bearer = options.bearer ?? null;
  }

  async start(): Promise<this> {
    for (const port of poolPorts()) {
      if (await listenOn(this.server, port)) {
        this.port = (this.server.address() as AddressInfo).port;
        return this;
      }
    }
    if (!(await listenOn(this.server, 0))) throw new Error("fake HTTP source: could not listen");
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    for (const res of this.hanging) res.destroy();
    this.hanging.clear();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://fake.invalid");
    const auth = req.headers["authorization"];
    this.requests.push({
      method: req.method ?? "",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: typeof auth === "string" ? auth : null,
    });
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (this.bearer !== null && auth !== `Bearer ${this.bearer}`) {
      res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
      return;
    }
    const b = this.behaviour;
    switch (b.kind) {
      case "rows": {
        const body = JSON.stringify({
          rows: b.rows,
          rowCount: b.rowCount === undefined ? b.rows.length : b.rowCount,
          controlTotal: b.controlTotal ?? null,
        });
        res.writeHead(200, { "content-type": "application/json" }).end(body);
        return;
      }
      case "status":
        res.writeHead(b.status, { "content-type": "application/json" }).end('{"error":"synthetic"}');
        return;
      case "hang":
        this.hanging.add(res);
        res.on("close", () => this.hanging.delete(res));
        return;
      case "raw":
        res.writeHead(200, { "content-type": b.contentType ?? "application/json" }).end(b.body);
        return;
      case "oversized": {
        res.writeHead(200, { "content-type": "application/json" });
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        let left = b.bytes;
        const write = () => {
          while (left > 0) {
            const n = Math.min(left, chunk.length);
            left -= n;
            if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) {
              res.once("drain", write);
              return;
            }
          }
          res.end();
        };
        res.on("error", () => undefined);
        write();
        return;
      }
    }
  }
}
