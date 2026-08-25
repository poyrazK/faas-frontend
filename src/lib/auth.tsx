'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import {
  Account, getAccount, login as apiLogin, signup as apiSignup, logout as apiLogout, ApiError,
  OrgWithRole, listOrgs, getOrgMe,
} from './api';

interface AuthState {
  account: Account | null;
  activeOrg: OrgWithRole | null;
  orgs: OrgWithRole[];
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
  switchOrg: (slug: string | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [orgs, setOrgs] = useState<OrgWithRole[]>([]);
  const [activeOrg, setActiveOrg] = useState<OrgWithRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [acct, orgRes, meRes] = await Promise.all([
        getAccount(),
        listOrgs().catch(() => ({ orgs: [] })),
        getOrgMe().catch(() => ({ org: null })),
      ]);
      const orgList = orgRes.orgs;
      setAccount(acct);
      setOrgs(orgList);
      
      const storedSlug = typeof window !== 'undefined' ? localStorage.getItem('faas_active_org') : null;
      const matched = meRes.org || null;
      setActiveOrg(matched);
      if (storedSlug && !matched && typeof window !== 'undefined') {
        localStorage.removeItem('faas_active_org');
      }
      return acct;
    } catch (err) {
      // 401 simply means "not signed in" — anything else we also treat as
      // logged-out for the UI, but only 401 is expected.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.warn('auth.refresh failed:', err);
      }
      setAccount(null);
      setOrgs([]);
      setActiveOrg(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
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
    setOrgs([]);
    setActiveOrg(null);
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
    <AuthContext.Provider value={{ account, activeOrg, orgs, loading, signIn, signUp, signOut, refresh, switchOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
