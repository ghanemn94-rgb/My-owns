/**
 * Only same-origin paths are accepted as a post-login destination (no open redirect — SEC-P1-05). Control characters and
 * whitespace are rejected outright (URL parsers strip tab/newline, turning "/\t/host" into "//host"), and the value must
 * resolve to this origin.
 */
export function safeNext(next: string | null, origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'): string {
  if (!next || next.length > 2048 || !next.startsWith('/') || /[\u0000-\u001f\u007f\s\\]/.test(next)) return '/';
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin || url.pathname.startsWith('//') || url.pathname.startsWith('/login')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
