'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl, setAuthToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  
  // Form State
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [termsAgreed, setTermsAgreed] = useState(true);

  // Status & Feedback
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    if (mode === 'signup') {
      if (!fullName.trim()) {
        setStatus('error');
        setFeedbackMsg('Please enter your full name');
        return;
      }
      if (password.trim() && password !== confirmPassword) {
        setStatus('error');
        setFeedbackMsg('Passwords do not match. Please re-enter.');
        return;
      }
      if (!termsAgreed) {
        setStatus('error');
        setFeedbackMsg('You must agree to the Terms of Service & Privacy Policy to register.');
        return;
      }
    }

    setStatus('submitting');

    try {
      // POST to the backend's magic-link endpoint (proxied through Vercel rewrite)
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: email.trim() }).toString(),
        credentials: 'include',
        redirect: 'follow',
      });
      
      if (res.ok || res.redirected) {
        setStatus('success');
        setFeedbackMsg('✓ Magic login link sent! Check your inbox for a sign-in link.');
      } else {
        const text = await res.text();
        setStatus('error');
        setFeedbackMsg(`Login failed: ${text || `HTTP ${res.status}`}`);
      }
    } catch (err: any) {
      setStatus('error');
      setFeedbackMsg(`Connection error: ${err.message}`);
    }
  };

  const handleSocialAuth = (provider: 'github' | 'google') => {
    setStatus('submitting');
    // Redirect through the Vercel proxy rewrite — /v1/auth/google proxies
    // to the backend which redirects to Google's consent screen
    if (provider === 'github') {
      window.location.href = '/oauth/callback';
    } else {
      window.location.href = '/v1/auth/google';
    }
  };

  return (
    <div className="login-root-container">
      {/* Background Animated Gradients */}
      <div className="glow-orb orb-1"></div>
      <div className="glow-orb orb-2"></div>

      <div className="login-card-glass">
        {/* Brand Header */}
        <div className="login-header">
          <a href="/" className="brand-logo-link">
            <img 
              src="/gregale-logo-green-trans.png" 
              alt="Gregale" 
              className="brand-logo-img" 
            />
          </a>
          <h1 className="login-title">
            {mode === 'signin' ? 'Sign in to your account' : 'Create your Gregale account'}
          </h1>
          <p className="login-subtitle">
            Scale-to-zero Firecracker MicroVM Cloud
          </p>
        </div>

        {/* Sign In vs Sign Up Segmented Controls */}
        <div className="mode-segmented-tabs">
          <button 
            type="button" 
            className={`tab-btn ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => { setMode('signin'); setStatus('idle'); }}
          >
            Sign In
          </button>
          <button 
            type="button" 
            className={`tab-btn ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setStatus('idle'); }}
          >
            Create Account
          </button>
        </div>

        {/* Social Auth Providers (GitHub & Google) */}
        <div className="social-auth-grid">
          <button 
            type="button" 
            className="social-btn github-btn"
            onClick={() => handleSocialAuth('github')}
          >
            <svg className="social-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </button>

          <button 
            type="button" 
            className="social-btn google-btn"
            onClick={() => handleSocialAuth('google')}
          >
            <svg className="social-icon" width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Divider */}
        <div className="divider-bar">
          <span className="divider-text">OR CONTINUE WITH EMAIL</span>
        </div>

        {/* EMAIL & PASSWORD FORM */}
        <form onSubmit={handlePasswordSubmit} className="auth-form">
          {mode === 'signup' && (
            <>
              <div className="form-group">
                <label className="input-label">Full Name</label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    className="custom-input"
                    placeholder="Jane Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="input-label">Organization / Team Name (Optional)</label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    className="custom-input"
                    placeholder="Acme Corp or Personal"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="input-label">Work Email</label>
            <div className="input-wrapper">
              <input
                type="email"
                className="custom-input"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="input-label">Password</label>
              {mode === 'signin' && (
                <a href="#forgot" className="forgot-link" onClick={(e) => { e.preventDefault(); alert('Password reset link sent to your email'); }}>
                  Forgot password?
                </a>
              )}
            </div>
            <div className="input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                className="custom-input custom-input-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(prev => !prev)}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div className="form-group">
              <label className="input-label">Confirm Password</label>
              <div className="input-wrapper">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="custom-input custom-input-password"
                  placeholder="••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword(prev => !prev)}
                  title={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="form-options">
            {mode === 'signin' ? (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Remember me</span>
              </label>
            ) : (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  required
                />
                <span>I agree to the <a href="#" className="legal-link">Terms of Service</a> &amp; <a href="#" className="legal-link">Privacy Policy</a></span>
              </label>
            )}
          </div>

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="submit-btn-primary"
          >
            {status === 'submitting' ? (
              <span>Processing...</span>
            ) : (
              <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
            )}
          </button>
        </form>

        {/* Feedback Alert Toast */}
        {feedbackMsg && (
          <div className={`feedback-toast ${status}`}>
            {feedbackMsg}
          </div>
        )}

        {/* Footer info */}
        <div className="card-footer-info">
          By continuing, you agree to Gregale's <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}
