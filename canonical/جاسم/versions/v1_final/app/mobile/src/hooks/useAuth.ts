/**
 * useAuth - Authentication Hook
 * /خطاف المصادقة
 *
 * Manages user authentication state, login, register, logout
 * Supports JWT tokens, biometric auth, and phone-based auth
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

// ============================================
// TYPES
// ============================================

interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
  role: 'consumer' | 'merchant' | 'admin';
  tier: 'new' | 'bronze' | 'silver' | 'gold' | 'platinum';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  biometricLogin: () => Promise<boolean>;
  updateUser: (updates: Partial<User>) => void;
}

// ============================================
// CONTEXT
// ============================================

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Load auth state from storage on mount
  useEffect(() => {
    const loadAuth = async () => {
      try {
        // In production: AsyncStorage.getItem('auth_token')
        // For now, simulate no stored session
        setState(prev => ({ ...prev, isLoading: false }));
      } catch {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    };
    loadAuth();
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    // Simulate API call to tRPC auth.login
    // In production: await trpc.auth.login.useMutation()

    await new Promise(resolve => setTimeout(resolve, 800));

    const mockUser: User = {
      id: `user_${Date.now()}`,
      name: 'أحمد محمد',
      phone,
      role: 'consumer',
      tier: 'gold',
    };
    const mockToken = `jwt_${Date.now()}`;

    setState({
      user: mockUser,
      token: mockToken,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  const register = useCallback(async (name: string, phone: string, password: string) => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const mockUser: User = {
      id: `user_${Date.now()}`,
      name,
      phone,
      role: 'consumer',
      tier: 'new',
    };
    const mockToken = `jwt_${Date.now()}`;

    setState({
      user: mockUser,
      token: mockToken,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  const logout = useCallback(async () => {
    // Clear stored session
    setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const biometricLogin = useCallback(async (): Promise<boolean> => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) return false;

      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) return false;

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'سجل دخولك بالبصمة / Authenticate',
        fallbackLabel: 'استخدم كلمة المرور',
        cancelLabel: 'إلغاء',
      });

      if (result.success) {
        // Auto-login with stored credentials
        await login('+96550001111', 'biometric_pass');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [login]);

  const updateUser = useCallback((updates: Partial<User>) => {
    setState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...updates } : null,
    }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        biometricLogin,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// Named export for the provider
export { AuthContext };
