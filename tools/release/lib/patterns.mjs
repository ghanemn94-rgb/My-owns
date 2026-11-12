// Shared key-shape patterns of the P7 release scans (ADR-0062 §8 rule R3, ADR-0063 §1.2 rule S1).
//
// Delivered by the architect (T-DG7-ARCH-01) so that DO-A (scan-assets.mjs) and DO-B (secret-scan.mjs), which run in
// the same wave, both import ONE list and neither edits a file the other owns (REQ-DLV-008). This file is frozen after
// ARCH-01: a change goes through the orchestrator, and both scans' self-tests must pass afterwards.
//
// The patterns are written so that this file itself contains no value of the shapes they detect (each quantifier is
// spelled as a character class with a count), so the repository secret scan of ADR-0063 stays clean without an
// allow-list entry for this file. Dependency-free; no network.

/**
 * Key shapes: [class, source]. Compile with `keyShapeRegExps()`; the sources are kept as strings so a scan can combine
 * them or report the class without re-declaring the list.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const KEY_SHAPES = Object.freeze([
  ["anthropic-api-key", String.raw`sk-ant-[A-Za-z0-9_-]{20,}`],
  ["openai-style-api-key", String.raw`(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{32,}`],
  ["aws-access-key-id", String.raw`(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`],
  ["github-token", String.raw`(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{36}(?![A-Za-z0-9])`],
  ["github-fine-grained-token", String.raw`github_pat_[A-Za-z0-9_]{60,}`],
  ["slack-token", String.raw`(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}`],
  ["google-api-key", String.raw`(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])`],
  ["private-key-block", String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`],
  ["jwt", String.raw`eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*`],
]);

/** Fresh global RegExp objects for every key shape (a global RegExp is stateful, so never share one between scans). */
export function keyShapeRegExps() {
  return KEY_SHAPES.map(([cls, source]) => [cls, new RegExp(source, "g")]);
}

/**
 * Masks a matched value for output (ADR-0062 §8, ADR-0063 §1.4): the rule class and at most the first four characters.
 * The full value is never printed.
 * @param {string} rule
 * @param {string} value
 */
export function mask(rule, value) {
  return `[${rule}:${value.slice(0, 4)}…]`;
}
