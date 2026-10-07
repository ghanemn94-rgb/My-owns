// Hand-written tokenizer of the T09 formula language (ADR-0024 §6 EBNF). Owner: kpi-benefits-engineer.
//
// Accepted characters: a–z, 0–9, "_", ".", "+", "-", "*", "×", "/", "÷", "(", ")", ",", space and tab. Anything else
// (upper case, quotes, ";", brackets, newlines, "**" is caught by the parser, non-ASCII letters, control characters)
// is `formula.syntax` with the code-point offset of the offending character. Offsets are code points, so an emoji
// counts as one character, like the JSON Schema `maxLength` of the expression.
import { FORMULA_LIMITS, type FormulaProblem } from "./types.ts";

export type TokenType = "number" | "identifier" | "op" | "lparen" | "rparen" | "comma" | "end";

export interface Token {
  readonly type: TokenType;
  /** The token text; for "op" one of + - * / (× and ÷ normalised). */
  readonly text: string;
  /** Code-point offset of the token's first character. */
  readonly start: number;
  /** Code-point offset just after the token. */
  readonly end: number;
}

export type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[]; readonly chars: readonly string[] }
  | { readonly ok: false; readonly error: FormulaProblem };

export function syntaxError(offset: number, detail: string, reason = "unexpected"): FormulaProblem {
  return {
    code: "formula.syntax",
    message: `Syntax error at offset ${offset}: ${detail}`,
    offset,
    params: { offset: String(offset), reason, detail },
  };
}

const isDigit = (c: string) => c >= "0" && c <= "9";
const isLower = (c: string) => c >= "a" && c <= "z";

/** Printable description of a character for messages (never echoes control characters raw). */
function describe(c: string): string {
  const cp = c.codePointAt(0) ?? 0;
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  return cp >= 0x21 && cp <= 0x7e ? `'${c}' (${hex})` : hex;
}

export function tokenize(expression: unknown): TokenizeResult {
  if (typeof expression !== "string")
    return { ok: false, error: syntaxError(0, "the formula must be text", "not_text") };
  // A string longer than 2 × maxLength UTF-16 units has more than maxLength code points: refuse before splitting.
  if (expression.length > 2 * FORMULA_LIMITS.maxLength) {
    return { ok: false, error: tooLong(FORMULA_LIMITS.maxLength) };
  }
  const chars = Array.from(expression);
  if (chars.length > FORMULA_LIMITS.maxLength) return { ok: false, error: tooLong(FORMULA_LIMITS.maxLength) };

  const tokens: Token[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      while (i < chars.length && isDigit(chars[i]!)) i++;
      if (chars[i] === ".") {
        i++;
        if (i >= chars.length || !isDigit(chars[i]!)) {
          return { ok: false, error: syntaxError(i, "a digit must follow the decimal point", "number") };
        }
        while (i < chars.length && isDigit(chars[i]!)) i++;
      }
      const text = chars.slice(start, i).join("");
      const significant = text.replace(".", "").replace(/^0+/, "");
      if (significant.length > FORMULA_LIMITS.maxLiteralDigits) {
        return {
          ok: false,
          error: syntaxError(
            start,
            `a number has at most ${FORMULA_LIMITS.maxLiteralDigits} significant digits`,
            "number_digits",
          ),
        };
      }
      tokens.push({ type: "number", text, start, end: i });
      continue;
    }
    if (isLower(c)) {
      while (i < chars.length && (isLower(chars[i]!) || isDigit(chars[i]!) || chars[i] === "_")) i++;
      const text = chars.slice(start, i).join("");
      if (text.length > FORMULA_LIMITS.maxIdentifierLength) {
        return {
          ok: false,
          error: syntaxError(
            start,
            `a name has at most ${FORMULA_LIMITS.maxIdentifierLength} characters`,
            "identifier_length",
          ),
        };
      }
      tokens.push({ type: "identifier", text, start, end: i });
      continue;
    }
    switch (c) {
      case "+":
      case "-":
      case "*":
      case "/":
        tokens.push({ type: "op", text: c, start, end: i + 1 });
        break;
      case "×":
        tokens.push({ type: "op", text: "*", start, end: i + 1 });
        break;
      case "÷":
        tokens.push({ type: "op", text: "/", start, end: i + 1 });
        break;
      case "(":
        tokens.push({ type: "lparen", text: c, start, end: i + 1 });
        break;
      case ")":
        tokens.push({ type: "rparen", text: c, start, end: i + 1 });
        break;
      case ",":
        tokens.push({ type: "comma", text: c, start, end: i + 1 });
        break;
      case ".":
        return { ok: false, error: syntaxError(i, "a number must start with a digit", "number") };
      default:
        return { ok: false, error: syntaxError(i, `character ${describe(c)} is not allowed`, "character") };
    }
    i++;
  }
  tokens.push({ type: "end", text: "", start: chars.length, end: chars.length });
  return { ok: true, tokens, chars };
}

function tooLong(max: number): FormulaProblem {
  return {
    code: "formula.syntax",
    message: `Syntax error at offset ${max}: the formula has more than ${max} characters`,
    offset: max,
    params: { offset: String(max), reason: "too_long", limit: String(max) },
  };
}
