import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    splitLink({
      // Route subscriptions through SSE (httpSubscriptionLink)
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: "/api/trpc",
        transformer: superjson,
        eventSourceOptions: {
          withCredentials: true,
        },
      }),
      // Route queries/mutations through batched HTTP
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
