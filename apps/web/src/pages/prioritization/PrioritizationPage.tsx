// SEAM STUB (T-DG3-FE-A0): the route, export name and namespace are fixed; FE-B replaces this file with the real
// screen (docs/architecture/p3-work-split.md §4). It shows an honest "being built in this stage" state and no data.
// The write permissions are a provisional hint for the read-only note; the owning task sets the final list.
import { useTranslation } from "react-i18next";
import { BeingBuiltState } from "../../components/States.tsx";
import { WorkspaceFrame } from "../../components/Workspace.tsx";

export function PrioritizationPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="prioritization"
      title={t("prioritization.title")}
      writePermissions={["prioritization.score", "prioritization.edit", "prioritization.approve"]}
    >
      <BeingBuiltState title={t("prioritization.stub.title")} body={t("prioritization.stub.body")} />
    </WorkspaceFrame>
  );
}
