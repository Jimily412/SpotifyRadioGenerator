import React, { useState } from 'react';

const TOTAL_STEPS = 5;

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
    </svg>
  );
}

export default function OnboardingPage({ onComplete }) {
  const [step, setStep] = useState(0);
  const [spotifyId, setSpotifyId] = useState('');
  const [spotifySecret, setSpotifySecret] = useState('');
  const [lastfmKey, setLastfmKey] = useState('');
  const [lastfmUser, setLastfmUser] = useState('');
  const [connectState, setConnectState] = useState(null);
  const [connectError, setConnectError] = useState('');

  function pip(i) {
    if (i < step) return 'onboarding-pip done';
    if (i === step) return 'onboarding-pip active';
    return 'onboarding-pip';
  }

  function openLink(url) {
    window.electronAPI.openExternal(url);
  }

  async function connectSpotify() {
    if (!spotifyId.trim() || !spotifySecret.trim()) return;
    setConnectState('connecting');
    setConnectError('');
    await window.electronAPI.saveSettings({
      credentials: {
        spotify: {
          clientId: spotifyId.trim(),
          clientSecret: spotifySecret.trim(),
          redirectUri: 'tasteengine://callback',
        },
      },
    });
    window.electronAPI.onAuthSuccess(() => {
      setConnectState('success');
      setTimeout(() => setStep(3), 900);
    });
    window.electronAPI.onAuthError(err => {
      setConnectState('error');
      setConnectError(`${err}`);
    });
    await window.electronAPI.connectSpotify();
  }

  async function saveLastfm() {
    if (lastfmKey.trim() || lastfmUser.trim()) {
      await window.electronAPI.saveSettings({
        credentials: { lastfm: { apiKey: lastfmKey.trim(), username: lastfmUser.trim() } },
      });
    }
    setStep(4);
  }

  async function finish() {
    await window.electronAPI.completeOnboarding();
    onComplete();
  }

  const heroText = [
    { title: 'Welcome to TasteEngine', sub: "Your personal music taste engine. Let's get you set up in about 2 minutes." },
    { title: 'Create a Spotify App', sub: "TasteEngine needs its own Spotify developer app — it's free and takes 2 minutes." },
    { title: 'Connect Your Spotify', sub: 'Paste your app credentials to authorize TasteEngine.' },
    { title: 'Add Last.fm (Optional)', sub: 'Last.fm dramatically improves recommendations. Free to set up.' },
    { title: 'Get Your Listening History', sub: 'One last optional step for the best possible results.' },
  ];

  return (
    <div className="onboarding-root">
      <div className="onboarding-card">

        <div className="onboarding-hero">
          <div className="onboarding-logo-mark"><LogoMark /></div>
          <div className="onboarding-hero-title">{heroText[step].title}</div>
          <div className="onboarding-hero-sub">{heroText[step].sub}</div>
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
                  { icon: '📊', title: 'Your full listening history', desc: "Loads your Spotify data export to weight tracks across years of listening — not just last week." },
                  { icon: '🔴', title: 'Live Spotify + Last.fm data', desc: 'Merges your top tracks, recent plays, and Last.fm scrobbles for a complete taste picture.' },
                  { icon: '🎯', title: 'Real discovery', desc: "Finds artists you haven't heard yet using Last.fm similarity — no stale recommendations." },
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

          {/* Step 1 — Create Spotify App */}
          {step === 1 && (
            <>
              <div className="onboarding-cta">
                <button
                  className="btn-link btn-link-accent"
                  style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 14, marginBottom: 20, borderRadius: 8 }}
                  onClick={() => openLink('https://developer.spotify.com/dashboard')}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                  Open Spotify Developer Dashboard ↗
                </button>
              </div>

              <ol className="onboarding-steps-list">
                {[
                  'Log in with your Spotify account on the dashboard.',
                  <span>Click <strong>Create app</strong>. Give it any name (e.g. "My TasteEngine").</span>,
                  <span>Under <strong>Redirect URI</strong>, enter exactly: <span className="code-pill">tasteengine://callback</span></span>,
                  <span>Check <strong>Web API</strong> under APIs used. Accept the terms and click <strong>Save</strong>.</span>,
                  <span>Open your new app → <strong>Settings</strong> → copy your <strong>Client ID</strong> and <strong>Client Secret</strong>.</span>,
                ].map((text, i) => (
                  <li key={i} className="onboarding-step-item">
                    <div className="onboarding-step-num">{i + 1}</div>
                    <div className="onboarding-step-text">{text}</div>
                  </li>
                ))}
              </ol>

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>← Back</button>
                <button className="btn btn-primary" onClick={() => setStep(2)}>I have my credentials →</button>
              </div>
            </>
          )}

          {/* Step 2 — Enter credentials */}
          {step === 2 && (
            <>
              <div className="form-group">
                <label className="form-label">Client ID</label>
                <input
                  className="form-input"
                  placeholder="32-character hex string"
                  value={spotifyId}
                  onChange={e => { setSpotifyId(e.target.value); setConnectState(null); }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Client Secret</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="32-character hex string"
                  value={spotifySecret}
                  onChange={e => { setSpotifySecret(e.target.value); setConnectState(null); }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Redirect URI (pre-filled)</label>
                <input className="form-input" value="tasteengine://callback" readOnly />
              </div>

              {connectState === 'connecting' && (
                <div className="connect-status">
                  <div className="spinner" />
                  Opening Spotify in your browser — authorize and come back…
                </div>
              )}
              {connectState === 'success' && (
                <div className="connect-status success">
                  <CheckIcon /> Connected! Moving to next step…
                </div>
              )}
              {connectState === 'error' && (
                <div className="connect-status error">
                  ✕ {connectError || 'Authorization failed. Check your Client ID and Secret, then try again.'}
                </div>
              )}

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>← Back</button>
                <button
                  className="btn btn-primary"
                  disabled={!spotifyId.trim() || !spotifySecret.trim() || connectState === 'connecting' || connectState === 'success'}
                  onClick={connectSpotify}
                >
                  {connectState === 'connecting' ? 'Connecting…' : 'Connect Spotify →'}
                </button>
              </div>
            </>
          )}

          {/* Step 3 — Last.fm */}
          {step === 3 && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <button
                  className="btn-link"
                  style={{ flex: 1, justifyContent: 'center', borderRadius: 8 }}
                  onClick={() => openLink('https://www.last.fm/join')}
                >
                  Create Last.fm account ↗
                </button>
                <button
                  className="btn-link btn-link-accent"
                  style={{ flex: 1, justifyContent: 'center', borderRadius: 8 }}
                  onClick={() => openLink('https://www.last.fm/api/account/create')}
                >
                  Get API key ↗
                </button>
              </div>

              <ol className="onboarding-steps-list">
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">1</div>
                  <div className="onboarding-step-text">Create a free Last.fm account and enable Spotify scrobbling in your settings.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">2</div>
                  <div className="onboarding-step-text">Go to <strong>last.fm/api/account/create</strong>, fill in any app name, and copy your <strong>API Key</strong>.</div>
                </li>
              </ol>

              <div className="form-group">
                <label className="form-label">Last.fm API Key</label>
                <input className="form-input" placeholder="Paste your API key" value={lastfmKey} onChange={e => setLastfmKey(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Last.fm Username</label>
                <input className="form-input" placeholder="Your Last.fm username" value={lastfmUser} onChange={e => setLastfmUser(e.target.value)} />
              </div>

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(4)}>Skip for now</button>
                <button className="btn btn-primary" onClick={saveLastfm}>
                  {lastfmKey.trim() ? 'Save & Continue →' : 'Skip →'}
                </button>
              </div>
            </>
          )}

          {/* Step 4 — Spotify data export */}
          {step === 4 && (
            <>
              <div className="onboarding-cta">
                <button
                  className="btn-link btn-link-accent"
                  style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 14, marginBottom: 20, borderRadius: 8 }}
                  onClick={() => openLink('https://www.spotify.com/account/privacy/')}
                >
                  Open Spotify Privacy Settings ↗
                </button>
              </div>

              <ol className="onboarding-steps-list">
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">1</div>
                  <div className="onboarding-step-text">Log in and scroll to <strong>Download your data</strong>.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">2</div>
                  <div className="onboarding-step-text">Click <strong>Request data</strong>. Spotify emails you a download link within a few days.</div>
                </li>
                <li className="onboarding-step-item">
                  <div className="onboarding-step-num">3</div>
                  <div className="onboarding-step-text">Once you have it, go to the <strong>Analyze</strong> page and load the folder or .zip.</div>
                </li>
              </ol>

              <div className="notice notice-info" style={{ marginBottom: 24 }}>
                You can start generating playlists right now — TasteEngine uses your live Spotify data. Load the export later for much better results.
              </div>

              <div className="onboarding-nav">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(3)}>← Back</button>
                <button className="btn btn-primary btn-lg" onClick={finish}>Launch TasteEngine →</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
