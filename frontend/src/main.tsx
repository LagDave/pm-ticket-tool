/**
 * SPA entry. Mounts React 19's root and renders App under StrictMode.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { readStoredTheme } from "./lib/theme";
import "./index.css";

// Apply the persisted theme before first paint so there's no flash of the wrong
// palette before React mounts the ThemeProvider.
document.documentElement.dataset.theme = readStoredTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
