'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { Account, getAccount, login as apiLogin, logout as apiLogout, ApiError } from './api';

interface AuthState {
  account: Account | null;
  loading: boolean;
  /**
   * Signs in by email. The backend sets the faas_sid session cookie
   * synchronously, so this resolves with the authenticated account (or
   * null if the session cookie could not be established).
   */
  signIn: (email: string) => Promise<Account | null>;
  signOut: () => Promise<void>;
  refresh: () => Promise<Account | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const acct = await getAccount();
      setAccount(acct);
      return acct;
    } catch (err) {
      // 401 simply means "not signed in" — anything else we also treat as
      // logged-out for the UI, but only 401 is expected.
      if (!(err instanceof ApiError) || err.status !== 401) {
        // eslint-disable-next-line no-console
        console.warn('auth.refresh failed:', err);
      }
      setAccount(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string) => {
      await apiLogin(email);
      return refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setAccount(null);
  }, []);

  return (
    <AuthContext.Provider value={{ account, loading, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
