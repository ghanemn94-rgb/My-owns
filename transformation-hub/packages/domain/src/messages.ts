/**
 * Server-computed sentences as stable codes + parameters (QA-P1-14, REQ-UX-001/002).
 *
 * Rules and services that explain a computed state (status dimensions, gate blockers …) return, next to the English
 * sentence they always produced (kept for audit rows, record history and AI context), the same content as a list of
 * `ServerMessage`s. Clients translate each code with their own catalogue (web: `gates.messages.<code>` in en + ar) and
 * interpolate the parameters; the server never sends translated prose. Parameters are numbers, record codes/keys, or
 * enum values (translated by the client).
 */
export interface ServerMessage {
  code: string;
  params: Record<string, string | number>;
}

export const serverMessage = (code: string, params: Record<string, string | number> = {}): ServerMessage => ({ code, params });

/** Interpolates `{name}` placeholders; unknown placeholders are left visible (never silently dropped). */
export function formatMessage(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/**
 * English rendering of a message list with a code → template table. A code missing from the table is a programming
 * error (every code a rule emits must have its English template next to the rule).
 */
export function renderMessagesEn(messages: readonly ServerMessage[], templates: Readonly<Record<string, string>>): string {
  return messages
    .map((m) => {
      const t = templates[m.code];
      if (t === undefined) throw new Error(`No English template for message code ${m.code}`);
      return formatMessage(t, m.params);
    })
    .join(' ');
}

/** English rendering of ONE message (convenience for writers that persist a single sentence). */
export function renderMessageEn(code: string, params: Record<string, string | number>, templates: Readonly<Record<string, string>>): string {
  return renderMessagesEn([serverMessage(code, params)], templates);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const literalLength = (template: string) => template.replace(/\{\w+\}/g, '').length;
type Matcher = { code: string; names: string[]; re: RegExp };
const matcherCache = new WeakMap<Readonly<Record<string, string>>, Map<string, Matcher[]>>();

/**
 * Recovers the code + parameters of a sentence that was PERSISTED AS TEXT after being rendered from one of `templates`
 * (QA-P34-01: record-history reasons and system escalation texts live in plain text columns shared by every module, so
 * their codes are not stored). Writers render these sentences with {@link renderMessageEn} from the same table, so a stored
 * sentence matches exactly one template; templates with more literal text are tried first (a more specific sentence
 * wins over a generic one such as `{a} ({b})`). Returns null when nothing matches — text written before the template
 * existed, or free text — and the caller then shows the stored sentence as-is.
 * `tokens` names the parameters that are record codes, enum values, keys, numbers or dates: they match one token (no white
 * space, parentheses or commas), so the free text next to them may contain the template's punctuation. A free-text
 * parameter takes the shortest text up to the next literal, so a template never puts two free-text parameters side by
 * side and a free-text parameter is followed by a literal that does not occur in that data (or by the end).
 */
export function parseRenderedMessage(text: string | null | undefined, templates: Readonly<Record<string, string>>, tokens: readonly string[] = []): ServerMessage | null {
  if (!text) return null;
  const tokenKey = [...tokens].sort().join(',');
  let byTokens = matcherCache.get(templates);
  if (!byTokens) matcherCache.set(templates, (byTokens = new Map()));
  let matchers = byTokens.get(tokenKey);
  if (!matchers) {
    matchers = Object.entries(templates)
      .sort(([, a], [, b]) => literalLength(b) - literalLength(a))
      .map(([code, template]) => {
        const names: string[] = [];
        const source = template
          .split(/(\{\w+\})/)
          .map((part) => {
            const m = /^\{(\w+)\}$/.exec(part);
            if (!m) return escapeRegExp(part);
            names.push(m[1]!);
            return tokens.includes(m[1]!) ? '([^\\s(),]+)' : '([\\s\\S]*?)';
          })
          .join('');
        return { code, names, re: new RegExp(`^${source}$`) };
      });
    byTokens.set(tokenKey, matchers);
  }
  for (const { code, names, re } of matchers) {
    const m = re.exec(text);
    if (m) return serverMessage(code, Object.fromEntries(names.map((n, i) => [n, m[i + 1] ?? ''])));
  }
  return null;
}
