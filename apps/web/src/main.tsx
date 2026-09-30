// Entry point (ADR-0009). Styles: generated design tokens (one token source), locally bundled OFL fonts (no CDN;
// only the needed weights and subsets), then the application CSS written with logical properties.
import "virtual:mth-tokens.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { createI18n } from "./i18n/index.ts";

const i18n = createI18n();
const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing from index.html");
createRoot(root).render(
  <StrictMode>
    <App i18n={i18n} />
  </StrictMode>,
);
