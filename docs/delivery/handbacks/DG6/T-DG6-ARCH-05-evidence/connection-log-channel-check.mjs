import dc from "node:diagnostics_channel";
import net from "node:net";
const seen = [];
dc.subscribe("net.client.socket", ({ socket }) => { seen.push("net.client.socket"); socket.once("connect", () => seen.push(`connect ${socket.remoteAddress}:${socket.remotePort}`)); });
dc.subscribe("undici:client:beforeConnect", ({ connectParams }) => seen.push(`undici beforeConnect ${connectParams.hostname}:${connectParams.port}`));
const srv = net.createServer((s) => s.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")).listen(0, "127.0.0.1", async () => {
  const port = srv.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/`); await r.text();
  await new Promise((res) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); res(); }); });
  srv.close(); console.log(process.version, JSON.stringify(seen));
});
