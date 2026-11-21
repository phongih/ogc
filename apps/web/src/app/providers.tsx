import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { SessionProvider } from "./session";
import { IiosContextProvider } from "./iiosGate";

export function AppProviders({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 0 } } }));
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <IiosContextProvider>{children}</IiosContextProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
