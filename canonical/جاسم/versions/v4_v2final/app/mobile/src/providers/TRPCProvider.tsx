/**
 * TRPCProvider - tRPC Provider for React Native
 * /موفر تي-آر-بي-سي
 *
 * Wraps the app with tRPC and React Query providers
 * Connects to the same backend as the web application
 */

import React, { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { createTRPCReact } from '@trpc/react-query';

// ============================================
// CREATE tRPC CLIENT
// ============================================

export const trpc = createTRPCReact<any>();

// ============================================
// API URL CONFIGURATION
// ============================================

const getApiUrl = (): string => {
  // Expo development
  if (__DEV__) {
    // Use the development server URL
    // For physical device, use your computer's IP
    // For emulator, use 10.0.2.2 (Android) or localhost (iOS)
    return process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
  }
  // Production
  return process.env.EXPO_PUBLIC_API_URL || 'https://jasim.app';
};

// ============================================
// QUERY CLIENT
// ============================================

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        gcTime: 1000 * 60 * 30, // 30 minutes (replaces cacheTime in v5)
        retry: 2,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

// ============================================
// PROVIDER COMPONENT
// ============================================

interface TRPCProviderProps {
  children: React.ReactNode;
  authToken?: string | null;
}

export function TRPCProvider({ children, authToken }: TRPCProviderProps) {
  const queryClient = useMemo(() => createQueryClient(), []);

  const trpcClient = useMemo(() => {
    return trpc.createClient({
      transformer: superjson,
      links: [
        httpBatchLink({
          url: `${getApiUrl()}/api/trpc`,
          headers() {
            const headers: Record<string, string> = {
              'x-client-type': 'mobile',
              'x-app-version': '4.0.0',
              'x-platform': PlatformInfo,
            };

            if (authToken) {
              headers.authorization = `Bearer ${authToken}`;
            }

            return headers;
          },
        }),
      ],
    });
  }, [authToken]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}

// ============================================
// PLATFORM INFO
// ============================================

const PlatformInfo = (() => {
  try {
    // Will be resolved by Expo
    const { Platform } = require('react-native');
    return `${Platform.OS}-${Platform.Version}`;
  } catch {
    return 'unknown';
  }
})();

// ============================================
// EXPORTS
// ============================================

export { trpc };
export default TRPCProvider;
