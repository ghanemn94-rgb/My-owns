// Parses docs/source/playbook.md into its 165 anchored blocks (T-DG5-BE-Q). A text block ends with " <!-- Bxxxx -->"
// (the anchor and its one preceding space are not part of the text); a table block starts with "<!-- Bxxxx table -->"
// and is the contiguous Markdown rows that follow. Blocks are separated by blank lines.
import { readFileSync } from "node:fs";

export function parsePlaybook(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const blocks = [];
  let pending = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^<!-- (Extracted|footer)/.test(line)) continue;
    const table = /^<!-- (B0\d{3}) table -->$/.exec(line);
    if (table) {
      if (pending.some((l) => l.trim() !== "")) throw new Error(`stray text before ${table[1]}`);
      const rows = [];
      while (i + 1 < lines.length && lines[i + 1].startsWith("|")) rows.push(lines[++i]);
      blocks.push({ ref: table[1], kind: "table", text: rows.join("\n") });
      pending = [];
      continue;
    }
    const end = / <!-- (B0\d{3}) -->$/.exec(line);
    if (end) {
      pending.push(line.slice(0, end.index));
      while (pending.length && pending[0].trim() === "") pending.shift();
      blocks.push({ ref: end[1], kind: "text", text: pending.join("\n") });
      pending = [];
      continue;
    }
    if (line.includes("<!--")) throw new Error(`unexpected comment at line ${i + 1}`);
    pending.push(line);
  }
  if (pending.some((l) => l.trim() !== "")) throw new Error("trailing text after the last anchor");
  blocks.forEach((b, n) => {
    if (b.ref !== `B${String(n + 1).padStart(4, "0")}`) throw new Error(`out of order at ${b.ref}`);
  });
  return blocks;
}
