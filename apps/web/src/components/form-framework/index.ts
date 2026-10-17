// The common form framework (T-DG5-FE-C; ADR-0041 §5): history, comments, attachments, drafts, export, the recoverable
// conflict and the extension badge, for every native form.
export { ExportButton, ExportDialog } from "./ExportDialog.tsx";
export { ExtensionBadge, ExtensionNote, EXTENSION_RECORD_TYPES, type ExtensionRecordType } from "./ExtensionBadge.tsx";
export { FormFramework, type FormFrameworkProps, type SourceFieldSpec } from "./FormFramework.tsx";
export { FormToolsButton } from "./FormToolsButton.tsx";
export {
  ExtensionValues,
  extensionToolsColumn,
  extensionValueText,
  RecordExtensionTools,
  useExtensionCreate,
  useExtensionEntry,
  type ExtensionEntry,
} from "./ExtensionEntry.tsx";
