// Skeleton entry point (T-DG1-ARCH-01). frontend-ux-engineer replaces this with the bilingual shell
// (router, i18n, query client, tokens, fonts, provisional wordmark) per ADR-0009.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULTS } from "@mth/shared";

function SkeletonApp() {
  return <main>{DEFAULTS.productName}</main>;
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing from index.html");
createRoot(root).render(
  <StrictMode>
    <SkeletonApp />
  </StrictMode>,
);
