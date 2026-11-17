// code-security-reviewer, DG7 round 2: share of random generated secrets that the candidate's S3 rule does NOT report.
// Usage: node s3-exemption-rates.mjs <candidate-clone-root> [samples]
// For each shape, draws N random values (node:crypto), and counts: exempt by isNonSecretValue (any reason), exempt
// because the entropy is below 3.5, exempt by isI18nKey, exempt by the "key NAME" rule /^[A-Z][A-Z0-9_]+$/.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repo = process.argv[2];
const n = Number(process.argv[3] ?? 2000);
const { isNonSecretValue, isI18nKey, entropy } = await import(pathToFileURL(join(repo, "tools/release/secret-scan.mjs")).href);
const alnumLower = "abcdefghijklmnopqrstuvwxyz0123456789";
const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const pick = (alphabet, len) => Array.from(randomBytes(len), (b) => alphabet[b % alphabet.length]).join("");
const shapes = [
  ["hex16 (openssl rand -hex 16, storage.md l.186 access_key_id)", "s3_access_key", () => randomBytes(16).toString("hex")],
  ["hex24 (openssl rand -hex 24, init-secrets.sh l.48)", "POSTGRES_PASSWORD", () => randomBytes(24).toString("hex")],
  ["hex32 (openssl rand -hex 32, storage.md l.187 secret_access_key)", "secret_access_key", () => randomBytes(32).toString("hex")],
  ["lower24 alphanumeric", "OIDC_CLIENT_SECRET", () => pick(alnumLower, 24)],
  ["UPPER hex24 (hex 24 upper-cased)", "OIDC_CLIENT_SECRET", () => randomBytes(24).toString("hex").toUpperCase()],
  ["base32 32 (TOTP-style seed)", "api_token", () => pick(base32, 32)],
  ["base64 24 bytes (openssl rand -base64 24)", "POSTGRES_PASSWORD", () => randomBytes(24).toString("base64")],
];
for (const [label, key, gen] of shapes) {
  let exempt = 0, lowEntropy = 0, i18n = 0, keyName = 0;
  for (let k = 0; k < n; k++) {
    const v = gen();
    if (isNonSecretValue(key, v)) exempt++;
    if (entropy(v) < 3.5) lowEntropy++;
    if (isI18nKey(v)) i18n++;
    if (/^[A-Z][A-Z0-9_]+$/.test(v)) keyName++;
  }
  const pct = (x) => `${((100 * x) / n).toFixed(1)}%`;
  console.log(`${label}: n=${n} not-reported=${pct(exempt)} entropy<3.5=${pct(lowEntropy)} i18nKey=${pct(i18n)} keyNameRule=${pct(keyName)}`);
}
