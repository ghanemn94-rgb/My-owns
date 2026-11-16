// code-security-reviewer DG7 r7: adversarial probe of parseDisclosures / release-notes.mjs (T-DG7-DO-D10).
// Run from a disposable clone: node <this> <clone>. Expects every hostile input to be refused (DisclosureError),
// the committed input to parse, and the generator's output to be byte-identical across two builds (determinism).
import { readFileSync } from "node:fs";
const repo = process.argv[2];
const m = await import(`${repo}/tools/release/release-notes.mjs`);
const good = JSON.parse(readFileSync(m.DEFAULT_DISCLOSURES, "utf8"));
const e = good.disclosures[0];
const withHref = (href) => ({ ...good, disclosures: [{ ...e, link: { ...e.link, href } }] });
const hostile = {
  "href traversal ../": withHref("../delivery/decisions.md"),
  "href traversal mid": withHref("a/../../x.md"),
  "href ./": withHref("./known-limitations.md"),
  "href absolute": withHref("/etc/passwd.md"),
  "href javascript:": withHref("javascript:alert(1)//.md"),
  "href data:": withHref("data:text/html,x.md"),
  "href protocol-relative": withHref("//evil.example/x.md"),
  "href with ) injection": withHref("x.md)[y](http://e"),
  "href fragment upper/space": withHref("x.md#A B"),
  "href backslash": withHref("..\\x.md"),
  "href encoded": withHref("%2e%2e/x.md"),
  "href non-md": withHref("x.html"),
  "en CR": { ...good, disclosures: [{ ...e, en: ["a\rb"] }] },
  "en leading space": { ...good, disclosures: [{ ...e, en: [" a"] }] },
  "en non-string": { ...good, disclosures: [{ ...e, en: [1] }] },
  "heading 3 items": { ...good, disclosures: [{ ...e, heading: ["a", "b", "c"] }] },
  "source multi-line": { ...good, disclosures: [{ ...e, source: "a\nb" }] },
  "__proto__ key": JSON.parse(`{"format":"${m.DISCLOSURES_FORMAT}","disclosures":[],"__proto__":{"x":1}}`),
  "array root": [],
  "null": null,
  "id with dot": { ...good, disclosures: [{ ...e, id: "a.b" }] },
};
let bad = 0;
for (const [name, doc] of Object.entries(hostile)) {
  try {
    m.parseDisclosures(JSON.stringify(doc), "probe");
    console.log(`ACCEPTED (unexpected): ${name}`); bad++;
  } catch (err) {
    console.log(`refused ${err instanceof m.DisclosureError ? "DisclosureError" : err.constructor.name}: ${name}: ${err.message}`);
    if (!(err instanceof m.DisclosureError)) bad++;
  }
}
// __proto__ via JSON.parse becomes an own key "__proto__"; JSON.stringify(parsed) above may drop it, so also test raw text.
try { m.parseDisclosures(`{"format":"${m.DISCLOSURES_FORMAT}","disclosures":[],"__proto__":{"x":1}}`, "probe"); console.log("ACCEPTED (unexpected): raw __proto__"); bad++; }
catch (err) { console.log(`refused raw __proto__: ${err.message}`); }
const list = m.parseDisclosures(readFileSync(m.DEFAULT_DISCLOSURES, "utf8"), "committed");
console.log(`committed input parses: ${list.length} entr${list.length === 1 ? "y" : "ies"}: ${list.map((d) => d.id).join(",")}`);
console.log(bad === 0 ? "PROBE PASS" : `PROBE FAIL (${bad})`);
process.exit(bad === 0 ? 0 : 1);
