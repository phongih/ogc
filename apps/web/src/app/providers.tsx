import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { followOtherTabs } from "../lib/adapters/persist";
import { SessionProvider } from "./session";
import { IiosContextProvider } from "./iiosGate";

export function AppProviders({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 0 } } }));
  // Another tab saved demo data → reload the stores (done) and refetch what this tab shows.
  useEffect(() => followOtherTabs(() => void qc.invalidateQueries()), [qc]);
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <IiosContextProvider>{children}</IiosContextProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
