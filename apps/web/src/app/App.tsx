import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./providers";
import { router } from "./router";
import { NonProductionBanner } from "../ui";

export function App() {
  return (
    <AppProviders>
      <a href="#main" className="ogc-skip-link">
        Skip to content
      </a>
      <NonProductionBanner />
      <RouterProvider router={router} />
    </AppProviders>
  );
}
