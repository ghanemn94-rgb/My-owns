// code-security-reviewer DG2 round-7: which error does Fastify 5.6.1 raise for a JSON body with invalid UTF-8 bytes?
// Run from apps/api of the disposable probe clone (so `fastify` resolves to the candidate's locked 5.6.1). SYNTHETIC.
import Fastify from "fastify";
const app = Fastify({ logger: false });
app.setErrorHandler((err, _req, reply) => reply.code(599).send({ code: err.code, statusCode: err.statusCode, message: err.message }));
app.post("/x", async (req) => ({ got: req.body }));
for (const [name, bytes] of [["control-0x41", [0x41]], ["cesu-ED-A0-80", [0xed, 0xa0, 0x80]], ["0xFF", [0xff]], ["0xC3", [0xc3]]]) {
  const payload = Buffer.concat([Buffer.from('{"t":"a'), Buffer.from(bytes), Buffer.from('b"}')]);
  const r = await app.inject({ method: "POST", url: "/x", headers: { "content-type": "application/json" }, payload });
  console.log(JSON.stringify({ name, contentLength: payload.length, status: r.statusCode, body: r.json() }));
}
