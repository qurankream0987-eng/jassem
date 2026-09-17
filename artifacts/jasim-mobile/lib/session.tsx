import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import {
  setCallToken,
  setRuntimeUnauthorizedHandler,
} from '@/lib/runtime-trpc';
import { palette, fonts } from '@/constants/colors';

const STORAGE_KEY = 'jasim.runtime.session';

let currentToken: string | null = null;
setAuthTokenGetter(() => currentToken);

function applyToken(token: string | null) {
  currentToken = token;
  setCallToken(token);
}

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

/**
 * Fired by the global React Query caches when any request is rejected with
 * 401 (expired/invalid bearer). The provider replaces the handler so the
 * stored credential is wiped and a fresh session is bootstrapped.
 */
export const sessionEvents = {
  onUnauthorized: () => {},
};

async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(STORAGE_KEY);
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function storeToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(STORAGE_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, token);
}

async function clearStoredToken(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

async function requestSessionToken(): Promise<string> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('EXPO_PUBLIC_DOMAIN is not configured.');
  // The canonical contract takes no caller-supplied fields, and an explicit
  // empty object is how "no input" is stated. Sending a declared, zero-field
  // body also keeps the request shape identical across every fetch
  // implementation, rather than depending on how one serializes "nothing".
  const response = await fetch(`https://${domain}/api/runtime/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('تعذر إنشاء جلسة آمنة مع خادم جاسم.');
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error('استجابة الجلسة غير صالحة.');
  return body.token;
}

interface SessionContextValue {
  ready: boolean;
  error: string | null;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue>({
  ready: false,
  error: null,
  retry: () => {},
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        let token = await getStoredToken();
        if (!token) {
          token = await requestSessionToken();
          await storeToken(token);
        }
        if (cancelled) return;
        applyToken(token);
        setReady(true);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : 'تعذر الاتصال بخادم جاسم.',
        );
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const handleUnauthorized = () => {
      applyToken(null);
      void clearStoredToken().catch(() => {});
      setReady(false);
      setAttempt((value) => value + 1);
    };
    sessionEvents.onUnauthorized = handleUnauthorized;
    setRuntimeUnauthorizedHandler(handleUnauthorized);
    return () => {
      sessionEvents.onUnauthorized = () => {};
      setRuntimeUnauthorizedHandler(() => {});
    };
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const value = useMemo(
    () => ({ ready, error, retry }),
    [ready, error, retry],
  );

  if (!ready) {
    return (
      <View style={styles.gate}>
        {error ? (
          <>
            <Text style={styles.gateTitle}>تعذر الاتصال</Text>
            <Text style={styles.gateMessage}>{error}</Text>
            <Text style={styles.gateRetry} onPress={retry}>
              إعادة المحاولة
            </Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={palette.cyan} size="large" />
            <Text style={styles.gateMessage}>جارٍ تجهيز جلسة جاسم…</Text>
          </>
        )}
      </View>
    );
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    backgroundColor: palette.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  gateTitle: {
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 18,
  },
  gateMessage: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  gateRetry: {
    color: palette.cyan,
    fontFamily: fonts.semiBold,
    fontSize: 15,
    marginTop: 8,
  },
});
