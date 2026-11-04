import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./providers";
import { router } from "./router";
import { ErrorBoundary } from "./ErrorBoundary";
import { NonProductionBanner } from "../ui";

export function App() {
  return (
    <AppProviders>
      <a href="#main" className="ogc-skip-link">
        Skip to content
      </a>
      <NonProductionBanner />
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </AppProviders>
  );
}
