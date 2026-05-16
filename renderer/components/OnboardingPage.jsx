import React, { useState, useEffect } from 'react';

const TOTAL_STEPS = 4;

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
    </svg>
  );
}

export default function OnboardingPage({ onComplete }) {
  const [step, setStep] = useState(0);
  const [lastfmUser, setLastfmUser] = useState('');
  const [connectState, setConnectState] = useState(null); // null | 'connecting' | 'success' | 'error'
  const [connectError, setConnectError] = useState('');

  // Register auth listeners once on mount
  useEffect(() => {
    window.electronAPI.onAuthSuccess(() => {
      setConnectState('success');
      setTimeout(() => setStep(2), 900);
    });
    window.electronAPI.onAuthError(err => {
      setConnectState('error');
      setConnectError(String(err));
    });
  }, []);

  function pip(i) {
    if (i < step) return 'onboarding-pip done';
    if (i === step) return 'onboarding-pip active';
    return 'onboarding-pip';
  }

  async function connectSpotify() {
    setConnectState('connecting');
    setConnectError('');
    await window.electronAPI.connectSpotify();
  }

  async function saveLastfm() {
    if (lastfmUser.trim()) {
      await window.electronAPI.saveSettings({
        credentials: { lastfm: { username: lastfmUser.trim() } },
      });
    }
    setStep(3);
  }

  async function finish() {
    await window.electronAPI.completeOnboarding();
    onComplete();
  }

  const hero = [
    { title: 'Welcome to TasteEngine', sub: "Your personal music taste engine. Let's get you set up in under 2 minutes." },
    { title: 'Connect Your Spotify', sub: 'Authorize TasteEngine to read your listening data and manage playlists.' },
    { title: 'Add Last.fm (Optional)', sub: 'Last.fm scrobble history dramatically improves recommendation quality.' },
    { title: 'Get Your Listening History', sub: 'One optional step to unlock the full power of TasteEngine.' },
  ];

  return (
    <div className="onboarding-root">
      <div className="onboarding-card">

        <div className="onboarding-hero">
          <div className="onboarding-logo-mark"><LogoMark /></div>
          <div className="onboarding-hero-title">{hero[step].title}</div>
          <div className="onboarding-hero-sub">{hero[step].sub}</div>
        </div>

        <div className="onboarding-body">
          <div className="onboarding-progress">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div key={i} className={pip(i)} />
            ))}
          </div>

          {/* Step 0 — Welcome */}
          {step === 0 && (
            <>
              <div className="onboarding-features">
                {[
                  { icon: '📊', title: 'Your full listening history', desc: "Loads your Spotify data export — years of plays — not just what you listened to last week." },
                  { icon: '🔴', title: 'Live Spotify + Last.fm data', desc: 'Merges your top tracks, recent plays, and Last.fm scrobbles for a complete taste picture.' },
                  { icon: '🎯', title: 'Real discovery', desc: "Finds artists you haven't heard yet using Last.fm similarity data — no stale recommendations." },
                ].map(f => (
                  <div key={f.title} className="onboarding-feature">
                    <div className="onboarding-feature-icon">{f.icon}</div>
                    <div>
                      <div className="onboarding-feature-title">{f.title}</div>
                      <div className="onboarding-feature-desc">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="onboarding-nav">
                <span />
                <button className="btn btn-primary" onClick={() => setStep(1)}>Get Started →</button>
              </div>
            </>
          )}

          {/* Step 1 — Connect Spotify */}
          {step === 1 && (
            <>
              <div style={{ marginBottom: 24 }}>
                <p style={{ marginBottom: 20 }}>
                  Click below to open Spotify in your browser. Sign in and click <strong style={{ color: 'var(--text)' }}>Agree</strong> — then come back here.
                </p>

                {connectState === null && (
                  <button
                    className="btn btn-primary btn-full btn-lg"
                    onClick={connectSpotify}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{ flexShrink: 0 }}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                    </svg>
                    Connect with Spotify
                  </button>
                )}

                {connectState === 'connecting' && (
                  <div className="connect-status">
                    <div className="spinner" />
                    Waiting for Spotify authorization in your browser…
                  </div>
                )}
                {connectState === 'success' && (
                  <div className="connect-status success">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                    Connected! Moving to next step…
                  </div>
                )}
                {connectState === 'error' && (
                  <>
                    <div className="connect-status error">
                      ✕ {connectError || 'Authorization failed. Please try again.'}
                    </div>
                    <button className="btn btn-primary btn-full" style={{ marginTop: 12 }} onClick={connectSpotify}>
                      Try Again
                    </button>
                  </>
                )}
              </div>

              <div className="notice notice-info">
                TasteEngine only reads your listening history and creates playlists — it never modifies your library or existing playlists.
              </div>

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>← Back</button>
                <span />
              </div>
            </>
          )}

          {/* Step 2 — Last.fm */}
          {step === 2 && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <button
                  className="btn-link"
                  style={{ flex: 1, justifyContent: 'center', borderRadius: 8 }}
                  onClick={() => window.electronAPI.openExternal('https://www.last.fm/join')}
                >
                  Create Last.fm account ↗
                </button>
                <button
                  className="btn-link btn-link-accent"
                  style={{ flex: 1, justifyContent: 'center', borderRadius: 8 }}
                  onClick={() => window.electronAPI.openExternal('https://www.last.fm/settings/applications')}
                >
                  Enable Spotify scrobbling ↗
                </button>
              </div>

              <ol className="onboarding-steps-list">
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">1</div>
                  <div className="onboarding-step-text">Create a free Last.fm account if you don't have one.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">2</div>
                  <div className="onboarding-step-text">In Last.fm Settings → Applications, connect your Spotify account to start scrobbling.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">3</div>
                  <div className="onboarding-step-text">Enter your Last.fm username below.</div>
                </li>
              </ol>

              <div className="form-group">
                <label className="form-label">Last.fm Username</label>
                <input
                  className="form-input"
                  placeholder="Your Last.fm username"
                  value={lastfmUser}
                  onChange={e => setLastfmUser(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveLastfm()}
                  autoFocus
                />
              </div>

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(3)}>Skip for now</button>
                <button className="btn btn-primary" onClick={saveLastfm}>
                  {lastfmUser.trim() ? 'Save & Continue →' : 'Skip →'}
                </button>
              </div>
            </>
          )}

          {/* Step 3 — Spotify data export */}
          {step === 3 && (
            <>
              <button
                className="btn-link btn-link-accent"
                style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 14, marginBottom: 20, borderRadius: 8 }}
                onClick={() => window.electronAPI.openExternal('https://www.spotify.com/account/privacy/')}
              >
                Open Spotify Privacy Settings ↗
              </button>

              <ol className="onboarding-steps-list">
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">1</div>
                  <div className="onboarding-step-text">Log in and scroll to <strong>Download your data</strong>.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">2</div>
                  <div className="onboarding-step-text">Click <strong>Request data</strong>. Spotify will email you a download link within a few days.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">3</div>
                  <div className="onboarding-step-text">Once you have the file, load it on the <strong>Analyze</strong> page for much better results.</div>
                </li>
              </ol>

              <div className="notice notice-info" style={{ marginBottom: 24 }}>
                You can start generating playlists right now using your live Spotify data. The export just makes everything better.
              </div>

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(2)}>← Back</button>
                <button className="btn btn-primary btn-lg" onClick={finish}>Launch TasteEngine →</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
