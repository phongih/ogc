import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./index.css";
import { App } from "./app/App";
import { restoreDemoState, saveDemoState } from "./lib/adapters/persist";

// Synthetic demo data saved in this browser survives a reload (adapters registered via App's imports).
restoreDemoState();
window.addEventListener("pagehide", saveDemoState);

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
