'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import {
  Account, getAccount, login as apiLogin, signup as apiSignup, logout as apiLogout, ApiError,
} from './api';

interface AuthState {
  account: Account | null;
  loading: boolean;
  /**
   * Signs in with email + password. The backend sets the faas_sid session
   * cookie synchronously, so this resolves with the authenticated account
   * (or null if the cookie could not be established).
   */
  signIn: (email: string, password: string) => Promise<Account | null>;
  /** Creates the account and signs in, in one call. */
  signUp: (email: string, password: string) => Promise<Account | null>;
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
    async (email: string, password: string) => {
      await apiLogin(email, password);
      return refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      await apiSignup(email, password);
      return refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setAccount(null);
  }, []);

  return (
    <AuthContext.Provider value={{ account, loading, signIn, signUp, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
