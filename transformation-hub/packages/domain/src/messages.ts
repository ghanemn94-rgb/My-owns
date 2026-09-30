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
