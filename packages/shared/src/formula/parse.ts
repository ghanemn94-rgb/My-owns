// Recursive-descent parser of the T09 formula language (ADR-0024 §6). Owner: kpi-benefits-engineer.
//
//   formula  = ws , expr , ws ;
//   expr     = term , { ws , ( "+" | "-" ) , ws , term } ;
//   term     = unary , { ws , ( "*" | "×" | "/" | "÷" ) , ws , unary } ;
//   unary    = [ "-" , ws ] , primary ;
//   primary  = number | call | identifier | "(" , ws , expr , ws , ")" ;
//   call     = function , ws , "(" , ws , [ expr , { ws , "," , ws , arg } ] , ws , ")" ;
//   arg      = expr | period ;
//   function = "to_period" | "min" | "max" | "abs" ;     period = "month" | "quarter" | "year" ;
//
// Arity (checked here, so a wrong call is a syntax error at the call): to_period(expr, period); abs(expr);
// min/max(expr, expr, …) with at least two arguments, none of them a period. A period name is only valid as the
// second argument of to_period; a function name must be followed by "(".
// Limits: 200 nodes and depth 32 are enforced while parsing (before any deep recursion), so no input can exhaust the
// stack. Binary chains are built iteratively (left-associative) and do not add depth.
import { syntaxError, tokenize, type Token } from "./tokenize.ts";
import {
  FORMULA_FUNCTIONS,
  FORMULA_LIMITS,
  type CallNode,
  type ExprNode,
  type FormulaAst,
  type FormulaFunction,
  type FormulaProblem,
  type PeriodName,
  type PeriodNode,
} from "./types.ts";

export type ParseResult =
  | { readonly ok: true; readonly ast: FormulaAst }
  | { readonly ok: false; readonly error: FormulaProblem };

const PERIOD_NAMES: readonly string[] = ["month", "quarter", "year"];
const isFunctionName = (s: string): s is FormulaFunction => (FORMULA_FUNCTIONS as readonly string[]).includes(s);
const isPeriodName = (s: string): s is PeriodName => PERIOD_NAMES.includes(s);

/** Words that are never variable names (functions and periods). */
export const RESERVED_WORDS: readonly string[] = [...FORMULA_FUNCTIONS, ...PERIOD_NAMES];

class ParseFailure {
  readonly problem: FormulaProblem;
  constructor(problem: FormulaProblem) {
    this.problem = problem;
  }
}

export function parseFormula(expression: unknown): ParseResult {
  const t = tokenize(expression);
  if (!t.ok) return { ok: false, error: t.error };
  const p = new Parser(t.tokens);
  try {
    if (p.peek().type === "end") throw new ParseFailure(syntaxError(p.peek().start, "expected an expression", "empty"));
    const root = p.expr(1);
    const last = p.peek();
    if (last.type !== "end") throw new ParseFailure(syntaxError(last.start, `unexpected ${describeToken(last)}`));
    return {
      ok: true,
      ast: Object.freeze({
        root,
        source: t.chars.join(""),
        nodeCount: p.nodes,
        maxDepth: p.deepest,
        variables: Object.freeze([...p.variables]),
      }),
    };
  } catch (e) {
    // ADR-0024 §6 (F-DG3-100 round 5): the first statement of every catch in the engine's import closure (lint and scan
    // enforce it). It changes nothing here: anything that is not a ParseFailure was already rethrown.
    if (e instanceof EvalError) throw e;
    if (e instanceof ParseFailure) return { ok: false, error: e.problem };
    throw e;
  }
}

function describeToken(t: Token): string {
  switch (t.type) {
    case "end":
      return "end of formula";
    case "number":
      return `number ${t.text}`;
    case "identifier":
      return `name ${t.text}`;
    default:
      return `'${t.text}'`;
  }
}

class Parser {
  private pos = 0;
  nodes = 0;
  deepest = 1;
  readonly variables = new Set<string>();

  private readonly tokens: readonly Token[];
  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    const t = this.tokens[this.pos]!;
    if (t.type !== "end") this.pos++;
    return t;
  }
  private fail(t: Token, detail: string, reason = "unexpected"): never {
    throw new ParseFailure(syntaxError(t.start, detail, reason));
  }
  private count(at: Token): void {
    this.nodes++;
    if (this.nodes > FORMULA_LIMITS.maxNodes) {
      throw new ParseFailure({
        code: "formula.syntax",
        message: `Syntax error at offset ${at.start}: the formula has more than ${FORMULA_LIMITS.maxNodes} elements`,
        offset: at.start,
        params: { offset: String(at.start), reason: "too_many_nodes", limit: String(FORMULA_LIMITS.maxNodes) },
      });
    }
  }
  private enter(at: Token, depth: number): void {
    if (depth > FORMULA_LIMITS.maxDepth) {
      throw new ParseFailure({
        code: "formula.syntax",
        message: `Syntax error at offset ${at.start}: the formula nests deeper than ${FORMULA_LIMITS.maxDepth} levels`,
        offset: at.start,
        params: { offset: String(at.start), reason: "too_deep", limit: String(FORMULA_LIMITS.maxDepth) },
      });
    }
    if (depth > this.deepest) this.deepest = depth;
  }

  expr(depth: number): ExprNode {
    let left = this.term(depth);
    for (;;) {
      const t = this.peek();
      if (t.type !== "op" || (t.text !== "+" && t.text !== "-")) return left;
      this.next();
      this.count(t);
      const right = this.term(depth);
      left = { type: "binary", op: t.text, left, right, start: left.start, end: right.end };
    }
  }

  private term(depth: number): ExprNode {
    let left = this.unary(depth);
    for (;;) {
      const t = this.peek();
      if (t.type !== "op" || (t.text !== "*" && t.text !== "/")) return left;
      this.next();
      this.count(t);
      const right = this.unary(depth);
      left = { type: "binary", op: t.text, left, right, start: left.start, end: right.end };
    }
  }

  private unary(depth: number): ExprNode {
    const t = this.peek();
    if (t.type === "op" && t.text === "-") {
      this.next();
      this.count(t);
      this.enter(t, depth + 1);
      const after = this.peek();
      if (after.type === "op") this.fail(after, `unexpected '${after.text}' after '-'`);
      const operand = this.primary(depth + 1);
      return { type: "unary", op: "-", operand, start: t.start, end: operand.end };
    }
    return this.primary(depth);
  }

  private primary(depth: number): ExprNode {
    const t = this.next();
    switch (t.type) {
      case "number":
        this.count(t);
        return { type: "number", value: t.text, start: t.start, end: t.end };
      case "lparen": {
        this.enter(t, depth + 1);
        const inner = this.expr(depth + 1);
        const close = this.next();
        if (close.type !== "rparen") this.fail(close, `expected ')' but found ${describeToken(close)}`);
        // Parentheses only group (no node of their own); the node's span widens to include them, so a quoted
        // sub-expression such as "(a - b) * c" stays well-formed.
        return { ...inner, start: t.start, end: close.end };
      }
      case "identifier": {
        if (isFunctionName(t.text)) return this.call(t, t.text, depth);
        if (isPeriodName(t.text))
          this.fail(t, `the period '${t.text}' is only allowed as the second argument of to_period`, "period");
        if (this.peek().type === "lparen") this.fail(t, `unknown function '${t.text}'`, "unknown_function");
        this.count(t);
        this.variables.add(t.text);
        return { type: "variable", name: t.text, start: t.start, end: t.end };
      }
      case "end":
        return this.fail(t, "unexpected end of formula, expected a value", "end");
      default:
        return this.fail(t, `unexpected ${describeToken(t)}, expected a value`);
    }
  }

  private call(nameToken: Token, fn: FormulaFunction, depth: number): CallNode {
    this.count(nameToken);
    this.enter(nameToken, depth + 1);
    const open = this.next();
    if (open.type !== "lparen") this.fail(open, `expected '(' after ${fn}`, "call");
    const args: (ExprNode | PeriodNode)[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.expr(depth + 1));
      while (this.peek().type === "comma") {
        this.next();
        args.push(this.arg(depth + 1));
      }
    }
    const close = this.next();
    if (close.type !== "rparen") this.fail(close, `expected ',' or ')' but found ${describeToken(close)}`);
    const node: CallNode = { type: "call", fn, args, start: nameToken.start, end: close.end };
    this.checkArity(node, nameToken);
    return node;
  }

  private arg(depth: number): ExprNode | PeriodNode {
    const t = this.peek();
    if (t.type === "identifier" && isPeriodName(t.text)) {
      const after = this.tokens[this.pos + 1];
      if (after && (after.type === "comma" || after.type === "rparen")) {
        this.next();
        this.count(t);
        return { type: "period", period: t.text, start: t.start, end: t.end };
      }
    }
    return this.expr(depth);
  }

  private checkArity(node: CallNode, at: Token): void {
    const n = node.args.length;
    const periods = node.args.filter((a) => a.type === "period").length;
    if (node.fn === "to_period") {
      if (n !== 2 || node.args[1]?.type !== "period") {
        this.fail(at, "to_period takes a value and a period: to_period(x, month|quarter|year)", "arity");
      }
      return;
    }
    if (periods > 0) this.fail(at, `${node.fn} does not take a period argument`, "arity");
    if (node.fn === "abs" && n !== 1) this.fail(at, "abs takes exactly one argument", "arity");
    if ((node.fn === "min" || node.fn === "max") && n < 2)
      this.fail(at, `${node.fn} takes at least two arguments`, "arity");
  }
}
