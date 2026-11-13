// The provisional-Arabic label of the `transfer` namespace (T-DG7-FE-B; p7-work-split §C.8, §D.2: "the Arabic
// provisional"; D-243 Q7). The catalogue is JSON and cannot carry comments, so the label lives here as data that
// pages/admin/migration/transfer-i18n.test.ts checks: every Arabic leaf of `transfer` is listed, and each entry marked
// "work-split" equals that text of p7-work-split.md exactly. Every text is PROVISIONAL until a qualified reviewer checks
// it; when a reviewed translation replaces a text, remove its entry here in the same change.
//  - "work-split": the Arabic is the work split's own cell (§C.8 or §D.2), used exactly;
//  - "fe-b": the work split gives no Arabic for this text (a column, a hint or a state of the screens); the Arabic was
//    written by T-DG7-FE-B.
import ar from "./ar/transfer.json" with { type: "json" };

export type P7TransferArabicSource = "work-split" | "fe-b";

/** The `transfer.*` keys whose Arabic is the work split's own text (§C.8, §D.2). */
export const TRANSFER_WORK_SPLIT_KEYS: readonly string[] = [
  "export.title",
  "export.intro",
  "export.request",
  "export.reason",
  "export.status.queued",
  "export.status.running",
  "export.status.succeeded",
  "export.status.failed",
  "export.environment.demo",
  "export.downloadManifest",
  "export.downloadAttachments",
  "import.title",
  "import.cliOnly",
  "import.result.matched",
  "import.result.mismatched",
  "rebind.title",
  "rebind.state.unbound",
  "rebind.state.rebound",
  "rebind.state.retained",
  "bundle.title",
  "bundle.intro",
  "bundle.nonDraftNote",
  "bundle.export",
  "bundle.upload",
  "bundle.validate",
  "bundle.commit",
  "bundle.action.create_draft",
  "bundle.action.new_draft",
  "bundle.action.identical",
  "bundle.action.conflict",
  "bundle.action.refused",
  "bundle.status.uploaded",
  "bundle.status.validated",
  "bundle.status.invalid",
  "bundle.status.committed",
];

type Tree = { readonly [k: string]: string | Tree };
function leaves(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`),
  );
}

/** `transfer.<key>` -> the source of its provisional Arabic. Every leaf of ar/transfer.json is provisional. */
export const P7_TRANSFER_PROVISIONAL_ARABIC: Readonly<Record<string, P7TransferArabicSource>> = Object.fromEntries(
  leaves(ar as Tree).map((k) => [`transfer.${k}`, TRANSFER_WORK_SPLIT_KEYS.includes(k) ? "work-split" : "fe-b"]),
);
