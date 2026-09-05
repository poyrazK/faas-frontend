'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import {
  Account, getAccount, login as apiLogin, signup as apiSignup, logout as apiLogout, ApiError,
  OrgWithRole, listOrgs, getOrgMe,
} from './api';

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
  activeOrg: OrgWithRole | null;
  orgs: OrgWithRole[];
  loading: boolean;
  authFailure: AuthFailure | null;
  /**
   * Signs in with email + password. The backend sets the faas_sid session
   * cookie synchronously, so this resolves with the authenticated account
   * (or null if the cookie could not be established).
   */
  signIn: (email: string, password: string) => Promise<Account | null>;
  /** Creates the account and signs in, in one call. */
  signUp: (email: string, password: string) => Promise<Account | null>;
  signOut: () => Promise<void>;
  refresh: (options?: { throwOnFailure?: boolean }) => Promise<Account | null>;
  switchOrg: (slug: string | null) => void;
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
  const [orgs, setOrgs] = useState<OrgWithRole[]>([]);
  const [activeOrg, setActiveOrg] = useState<OrgWithRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [authFailure, setAuthFailure] = useState<AuthFailure | null>(null);

  const refresh = useCallback(async (options: { throwOnFailure?: boolean } = {}) => {
    try {
      const [acct, orgRes, meRes] = await Promise.all([
        getAccount(),
        listOrgs().catch(() => ({ orgs: [] })),
        getOrgMe().catch(() => ({ org: null })),
      ]);
      const orgList = orgRes.orgs;
      setAccount(acct);
      setOrgs(orgList);
      setAuthFailure(null);
      
      const storedSlug = typeof window !== 'undefined' ? localStorage.getItem('faas_active_org') : null;
      const matched = meRes.org || null;
      setActiveOrg(matched);
      if (storedSlug && !matched && typeof window !== 'undefined') {
        localStorage.removeItem('faas_active_org');
      }
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
        setOrgs([]);
        setActiveOrg(null);
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

  const signUp = useCallback(
    async (email: string, password: string) => {
      await apiSignup(email, password);
      return refresh({ throwOnFailure: true });
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setAccount(null);
      setOrgs([]);
      setActiveOrg(null);
      setAuthFailure(null);
    }
  }, []);

  const switchOrg = useCallback((slug: string | null) => {
    if (typeof window === 'undefined') return;
    if (slug) {
      localStorage.setItem('faas_active_org', slug);
    } else {
      localStorage.removeItem('faas_active_org');
    }
    // Hard reload to clear all caches and reset the dashboard state to the new org
    window.location.href = '/dashboard';
  }, []);

  return (
    <AuthContext.Provider value={{ account, activeOrg, orgs, loading, authFailure, signIn, signUp, signOut, refresh, switchOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
