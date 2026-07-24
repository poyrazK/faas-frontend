'use client';

import React, { useState, useEffect } from 'react';
import { getAccount, getAuthToken, clearAuthToken, AccountModel } from '@/lib/api';

interface NavbarProps {
  viewMode: 'landing' | 'console';
  setViewMode: (mode: 'landing' | 'console') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ viewMode, setViewMode }) => {
  const [account, setAccount] = useState<AccountModel | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && getAuthToken()) {
      getAccount().then(acct => {
        if (acct) setAccount(acct);
      });
    }
  }, []);

  const getInitial = (email?: string) => {
    if (!email) return 'U';
    return email.trim().charAt(0).toUpperCase();
  };

  const handleSignOut = () => {
    clearAuthToken();
    setAccount(null);
    window.location.href = '/login';
  };

  return (
    <header>
      <nav className="navbar">
        <div className="container">
          <a href="#" className="nav-brand" onClick={(e) => { e.preventDefault(); setViewMode('landing'); }}>
            <img 
              src="/gregale-logo-green-trans.png" 
              alt="Gregale" 
              className="nav-brand-logo-img" 
            />
          </a>

          <ul className="nav-links">
            <li>
              <a 
                href="#landing" 
                className="nav-link" 
                onClick={(e) => { e.preventDefault(); setViewMode('landing'); }}
              >
                Landing
              </a>
            </li>
            {viewMode === 'landing' && (
              <>
                <li><a href="#architecture" className="nav-link">Architecture</a></li>
                <li><a href="#benchmark" className="nav-link">Benchmark</a></li>
                <li><a href="#pricing" className="nav-link">Pricing</a></li>
              </>
            )}
            <li>
              <a 
                href="#console" 
                className="nav-link" 
                style={{ color: 'var(--gregale-green)', fontWeight: 700 }}
                onClick={(e) => {
                  e.preventDefault();
                  if (!getAuthToken()) {
                    window.location.href = '/login';
                  } else {
                    setViewMode('console');
                  }
                }}
              >
                Console
              </a>
            </li>
          </ul>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
            {account ? (
              <div style={{ position: 'relative' }}>
                {/* User Avatar Button */}
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(prev => !prev)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-dim)',
                    borderRadius: '24px',
                    padding: '0.3rem 0.75rem 0.3rem 0.35rem',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--gregale-green), #059669)',
                    color: '#FFF',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {getInitial(account.email)}
                  </div>
                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {account.email}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: '220px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-dim)',
                    borderRadius: '12px',
                    padding: '0.5rem',
                    boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
                    zIndex: 200,
                  }}>
                    <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-dim)', marginBottom: '0.35rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Signed in as</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{account.email}</div>
                    </div>

                    <a 
                      href="/profile" 
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        textDecoration: 'none',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                      }}
                    >
                      👤 Personal Profile Page
                    </a>

                    <button 
                      onClick={handleSignOut} 
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        color: '#EF4444',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        textAlign: 'left',
                        marginTop: '0.25rem',
                      }}
                    >
                      🚪 Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <a href="/login" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                  Sign In
                </a>
                <button 
                  className="btn btn-gregale" 
                  onClick={() => {
                    if (!getAuthToken()) {
                      window.location.href = '/login';
                    } else {
                      setViewMode(viewMode === 'landing' ? 'console' : 'landing');
                    }
                  }}
                >
                  {viewMode === 'landing' ? 'Open Console' : 'View Landing Page'}
                </button>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
};
