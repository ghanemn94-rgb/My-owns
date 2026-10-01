// DG1 round-10 domain-reviewer: independent NAME scan of members of the 7 allow-listed built-ins (sanity check of the
// testkit header's F-DG1-130 member audit; not a capability proof). Run: node 05-member-name-scan.mjs
const mods = ["crypto", "fs", "fs/promises", "os", "path", "url", "util"];
const re = /load|engine|dlopen|exec|spawn|fork|eval|require|import|module|debug|native|binding|wasm|compile|script|inspect|worker|fips|open|run|plugin|extension|process/i;
const seen = new Set();
const walk = (label, obj, depth) => {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function") || seen.has(obj) || depth > 1) return;
  seen.add(obj);
  for (const k of Reflect.ownKeys(obj)) {
    if (typeof k !== "string") continue;
    if (re.test(k)) console.log(`${label}.${k}`);
    if (["promises", "posix", "win32", "types", "webcrypto", "subtle", "constants"].includes(k)) {
      try { walk(`${label}.${k}`, obj[k], depth + 1); } catch {}
    }
  }
};
console.log("node", process.version, "openssl", process.versions.openssl);
for (const m of mods) walk(`node:${m}`, await import(`node:${m}`), 0);
