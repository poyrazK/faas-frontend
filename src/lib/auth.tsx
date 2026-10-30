'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { Account, getAccount, login as apiLogin, logout as apiLogout, ApiError } from './api';

export type AuthFailureKind = 'mfa_required' | 'forbidden' | 'unavailable';

export interface AuthFailure {
  kind: AuthFailureKind;
  status: number;
  message: string;
}

/** Raised only when a caller needs to distinguish a refresh failure. */
export class AuthRefreshError extends Error {
  readonly kind: AuthFailureKind;
  readonly status: number;

  constructor(failure: AuthFailure) {
    super(failure.message);
    this.name = 'AuthRefreshError';
    this.kind = failure.kind;
    this.status = failure.status;
  }
}

interface AuthState {
  account: Account | null;
  loading: boolean;
  authFailure: AuthFailure | null;
  /**
   * Signs in with email + password. The backend sets the faas_sid session
   * cookie synchronously, so this resolves with the authenticated account
   * (or null if the cookie could not be established).
   */
  signIn: (email: string, password: string) => Promise<Account | null>;
  /** Resolves false when the server session could not be revoked (local state is cleared regardless). */
  signOut: () => Promise<boolean>;
  refresh: (options?: { throwOnFailure?: boolean }) => Promise<Account | null>;
}

const AuthContext = createContext<AuthState | null>(null);

function classifyAuthFailure(error: unknown): AuthFailure {
  if (error instanceof ApiError && error.status === 403 && error.code === 'mfa_required') {
    return {
      kind: 'mfa_required',
      status: error.status,
      message: 'Multi-factor authentication is required for this operator account. Complete MFA setup, then try again.',
    };
  }

  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: 'forbidden',
      status: error.status,
      message: 'This account is authenticated but is not authorized for operator access.',
    };
  }

  return {
    kind: 'unavailable',
    status: error instanceof ApiError ? error.status : 0,
    message: 'The control plane could not verify the operator session. Please try again shortly.',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [authFailure, setAuthFailure] = useState<AuthFailure | null>(null);

  const refresh = useCallback(async (options: { throwOnFailure?: boolean } = {}) => {
    try {
      const acct = await getAccount();
      setAccount(acct);
      setAuthFailure(null);
      return acct;
    } catch (err) {
      // 401 simply means "not signed in". Preserve other failures so the UI
      // can distinguish MFA, authorization, and temporary control-plane
      // problems instead of reporting all of them as a missing cookie.
      if (err instanceof ApiError && err.status === 401) {
        setAuthFailure(null);
      } else {
        const failure = classifyAuthFailure(err);
        setAuthFailure(failure);
        setAccount(null);
        if (options.throwOnFailure) throw new AuthRefreshError(failure);
        console.warn('auth.refresh failed:', err);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh().catch(() => undefined);
    });
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await apiLogin(email, password);
      return refresh({ throwOnFailure: true });
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
      return true;
    } catch (err) {
      console.warn('Sign-out did not end the server session', err);
      return false;
    } finally {
      setAccount(null);
      setAuthFailure(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ account, loading, authFailure, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
