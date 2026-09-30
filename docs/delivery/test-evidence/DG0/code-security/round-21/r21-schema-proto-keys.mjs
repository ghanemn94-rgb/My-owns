// code-security-reviewer, DG0 round 21: additionalProperties:false vs Object.prototype-named keys in tools/gates/lib/schema.mjs.
import { validate } from "../../../../../../tools/gates/lib/schema.mjs";
import { readFileSync } from "node:fs";
const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: false };
for (const txt of ['{"a":"x","zzz":1}', '{"a":"x","constructor":1}', '{"a":"x","toString":{"any":"thing"}}', '{"a":"x","__proto__":{"b":2}}', '{"a":"x","hasOwnProperty":[1,2]}']) {
  const e = validate(schema, JSON.parse(txt));
  console.log(`${txt.padEnd(42)} -> ${e.length ? e.join("; ") : "VALID (unexpected key not reported)"}`);
}
// Real schema: a review record with an extra 'constructor' key.
const rev = JSON.parse(readFileSync(new URL("../../../../../../tools/gates/schemas/review.schema.json", import.meta.url)));
console.log("review.schema additionalProperties:", rev.additionalProperties);
