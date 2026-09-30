// Command line for the token pipeline (ADR-0009). Runs on plain Node (>= 22.18 strips TypeScript types).
//   node src/cli.ts check              contrast gate: exits 1 if any declared pair fails WCAG AA (REQ-S15-003)
//   node src/cli.ts generate [file]    writes the CSS custom properties (default dist/tokens.css)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContrast, formatContrastReport, generateTokensCss } from "./index.ts";

const [command, target] = process.argv.slice(2);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (command === "check") {
  const report = checkContrast();
  console.log(formatContrastReport(report));
  if (report.failures.length > 0) {
    console.error(`\nFAIL contrast: ${report.failures.length} problem(s)`);
    for (const f of report.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `\nPASS contrast: ${report.pairs.length} pairs meet WCAG AA; ${report.prohibited.length} prohibited pairs fail as documented`,
  );
} else if (command === "generate") {
  const file = resolve(packageDir, target ?? "dist/tokens.css");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, generateTokensCss());
  console.log(`generated ${file}`);
} else {
  console.error("usage: node src/cli.ts check | generate [file]");
  process.exit(2);
}
