// PostgreSQL C-ctype character classes for the two text-rule mirrors (T-DG5-BE-R2; ADR-0049 §7, ADR-0003).
// Under the C ctype of the pinned test and demo clusters, PostgreSQL's `\s` matches only the six ASCII whitespace
// characters (space, \t, \n, \v, \f, \r) and `\S` everything else; JavaScript's `\s` also matches Unicode spaces such
// as U+00A0. `postgresCClasses` rewrites a verbatim SQL pattern so JavaScript applies the C-ctype rule: `\s` becomes
// that ASCII set (inside a bracket expression the set's members are inlined) and `\S` its complement. No other escape
// of the two patterns needs rewriting. The rewrite is a pure string transform over the fixed patterns of 0089, checked
// by the unit test and by the SQL/TypeScript agreement test.

const SPACE_MEMBERS = String.raw`\t\n\v\f\r `;

/** Rewrites `\s` and `\S` of a PostgreSQL ARE pattern into the C-ctype ASCII whitespace classes. */
export function postgresCClasses(pattern: string): string {
  let out = "";
  let inBracket = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern.charAt(i);
    if (ch === "\\" && i + 1 < pattern.length) {
      const next = pattern.charAt(i + 1);
      i += 1;
      if (next === "s") out += inBracket ? SPACE_MEMBERS : `[${SPACE_MEMBERS}]`;
      else if (next === "S") {
        if (inBracket) throw new Error("\\S inside a bracket expression is not supported");
        out += `[^${SPACE_MEMBERS}]`;
      } else out += `\\${next}`;
      continue;
    }
    if (ch === "[" && !inBracket) inBracket = true;
    else if (ch === "]" && inBracket) inBracket = false;
    out += ch;
  }
  return out;
}
