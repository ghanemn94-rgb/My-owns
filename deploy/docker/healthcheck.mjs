// Container health probe (the slim image has no curl/wget). Exit 0 only for a 2xx from the local API.
// Usage: node /app/healthcheck.mjs [/healthz|/readyz]   (default /readyz). Loopback only; never leaves the container.
const path = process.argv[2] ?? "/readyz";
if (path !== "/healthz" && path !== "/readyz") {
  console.error("healthcheck: path must be /healthz or /readyz");
  process.exit(64);
}
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
try {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) });
  const body = await res.text();
  if (!res.ok) console.error(`healthcheck ${path}: HTTP ${res.status} ${body.slice(0, 300)}`);
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error(`healthcheck ${path}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
