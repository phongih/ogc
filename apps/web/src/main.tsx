import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./index.css";
import { App } from "./app/App";
import { restoreDemoState, saveDemoState } from "./lib/adapters/persist";
// Every mock adapter registers its store with persist.ts when imported. Pages are code-split, so
// import them all here, before restoring the demo save (22/11).
import "./lib/api";

// Synthetic demo data saved in this browser survives a reload.
restoreDemoState();
window.addEventListener("pagehide", saveDemoState);

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
