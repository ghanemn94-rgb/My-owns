import { checkWriteOnce } from "./tools/gates/lib/rules.mjs";
const errors = []; checkWriteOnce(process.cwd(), "DG4", errors);
console.log("checkWriteOnce(DG4) errors:", errors.length); for (const e of errors.slice(0, 20)) console.log(" ", e);
