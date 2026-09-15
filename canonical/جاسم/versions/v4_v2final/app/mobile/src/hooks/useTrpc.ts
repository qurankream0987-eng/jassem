/**
 * useTrpc - tRPC Client Hook
 * /خطاف تي-آر-بي-سي
 *
 * Provides tRPC client for React Native with:
 * - httpBatchLink for efficient requests
 * - SuperJSON transformer
 * - Auth token injection
 * - Error handling
 */

import { useMemo } from 'react';
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import { QueryClient, QueryClientConfig } from '@tanstack/react-query';
import superjson from 'superjson';

// ============================================
// tRPC TYPES (mirrors backend AppRouter)
// ============================================

// We create a typed tRPC client based on the server's router shape
// In production, this would import the actual AppRouter type

export const trpc = createTRPCReact<any>();

// ============================================
// QUERY CLIENT CONFIG
// ============================================

const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
};

// ============================================
// tRPC CLIENT CONFIG
// ============================================

// Base URL - should be configured based on environment
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export function createTrpcClient(authToken?: string | null) {
  return trpc.createClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${API_BASE_URL}/api/trpc`,
        headers() {
          const headers: Record<string, string> = {};
          if (authToken) {
            headers.authorization = `Bearer ${authToken}`;
          }
          // Mobile app identifier
          headers['x-client-type'] = 'mobile';
          headers['x-app-version'] = '4.0.0';
          return headers;
        },
      }),
    ],
  });
}

// ============================================
// HOOKS
// ============================================

export function useTrpcClient(authToken?: string | null) {
  const client = useMemo(() => createTrpcClient(authToken), [authToken]);
  const queryClient = useMemo(() => new QueryClient(queryClientConfig), []);

  return { client, queryClient };
}

// Pre-configured tRPC hooks for each router
export function useTrpcQueries() {
  // Auth queries
  const authQueries = {
    useMe: () => trpc.auth.me.useQuery,
    useLogin: () => trpc.auth.login.useMutation,
    useRegister: () => trpc.auth.register.useMutation,
    useLogout: () => trpc.auth.logout.useMutation,
  };

  // Agent queries
  const agentQueries = {
    useParse: () => trpc.agents.parse.useMutation,
    useRoute: () => trpc.agents.route.useMutation,
    useGetStatus: () => trpc.agents.getStatus.useQuery,
  };

  // Product queries
  const productQueries = {
    useList: () => trpc.products.list.useQuery,
    useSearch: () => trpc.products.search.useQuery,
    useById: (id: string) => trpc.products.getById.useQuery({ id }),
  };

  // Order queries
  const orderQueries = {
    useList: () => trpc.orders.list.useQuery,
    useCreate: () => trpc.orders.create.useMutation,
    useUpdate: () => trpc.orders.update.useMutation,
  };

  // Cart queries
  const cartQueries = {
    useGet: () => trpc.cart.get.useQuery,
    useAdd: () => trpc.cart.add.useMutation,
    useRemove: () => trpc.cart.remove.useMutation,
    useCheckout: () => trpc.cart.checkout.useMutation,
  };

  // Payment queries
  const paymentQueries = {
    useCreate: () => trpc.payments.create.useMutation,
    useGetMethods: () => trpc.payments.getMethods.useQuery,
  };

  // Zakat queries
  const zakatQueries = {
    useCalculate: () => trpc.zakat.calculate.useMutation,
    useGetRates: () => trpc.zakat.getRates.useQuery,
  };

  return {
    authQueries,
    agentQueries,
    productQueries,
    orderQueries,
    cartQueries,
    paymentQueries,
    zakatQueries,
  };
}

// ============================================
// EXPORTS
// ============================================

export { QueryClient, queryClientConfig };
export default trpc;
