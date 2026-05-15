import React, { useState } from 'react';

const TOTAL_STEPS = 5;

export default function OnboardingPage({ onComplete }) {
  const [step, setStep] = useState(0);
  const [spotifyId, setSpotifyId] = useState('');
  const [spotifySecret, setSpotifySecret] = useState('');
  const [lastfmKey, setLastfmKey] = useState('');
  const [lastfmUser, setLastfmUser] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  function pip(i) {
    if (i < step) return 'onboarding-pip done';
    if (i === step) return 'onboarding-pip active';
    return 'onboarding-pip';
  }

  async function saveSpotifyCredentials() {
    if (!spotifyId.trim() || !spotifySecret.trim()) return false;
    setSaving(true);
    await window.electronAPI.saveSettings({
      credentials: {
        spotify: {
          clientId: spotifyId.trim(),
          clientSecret: spotifySecret.trim(),
          redirectUri: 'tasteengine://callback',
        },
      },
    });
    setSaving(false);
    return true;
  }

  async function connectSpotify() {
    const ok = await saveSpotifyCredentials();
    if (!ok) return;
    setConnecting(true);
    setConnectError('');
    window.electronAPI.onAuthSuccess(() => {
      setConnecting(false);
      setStep(3);
    });
    window.electronAPI.onAuthError(err => {
      setConnecting(false);
      setConnectError(`Connection failed: ${err}. Check that your Client ID, Secret, and Redirect URI are correct.`);
    });
    await window.electronAPI.connectSpotify();
  }

  async function saveLastfm() {
    if (lastfmKey.trim() || lastfmUser.trim()) {
      await window.electronAPI.saveSettings({
        credentials: {
          lastfm: {
            apiKey: lastfmKey.trim(),
            username: lastfmUser.trim(),
          },
        },
      });
    }
    setStep(4);
  }

  async function finish() {
    await window.electronAPI.completeOnboarding();
    onComplete();
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        <div className="onboarding-logo">TasteEngine</div>

        <div className="onboarding-progress">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className={pip(i)} />
          ))}
        </div>

        {step === 0 && (
          <>
            <div className="onboarding-step-title">Welcome to TasteEngine</div>
            <div className="onboarding-step-sub">
              TasteEngine analyzes your complete Spotify listening history — years of it — and generates
              personalized discovery playlists based on your actual taste, not just what you played last week.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 4 }}>
              {[
                ['Your full history', 'Loads your Spotify data export to weight tracks across your entire listening lifetime.'],
                ['Live data', 'Merges Spotify top tracks and Last.fm scrobbles for a complete taste picture.'],
                ['Real discovery', 'Finds artists you haven\'t heard via Last.fm similarity — no stale recommendations.'],
              ].map(([title, desc]) => (
                <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent)', fontSize: 14, marginTop: 1 }}>◈</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
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

        {step === 1 && (
          <>
            <div className="onboarding-step-title">Create Your Spotify Developer App</div>
            <div className="onboarding-step-sub">
              TasteEngine needs your own Spotify developer app. This is free, takes 2 minutes,
              and gives you your own private API quota.
            </div>
            <ol className="instruction-steps">
              <li>
                Go to{' '}
                <span
                  style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => window.electronAPI.openExternal('https://developer.spotify.com/dashboard')}
                >
                  developer.spotify.com/dashboard
                </span>
                {' '}and log in with your Spotify account.
              </li>
              <li>Click <strong style={{ color: 'var(--text)' }}>Create app</strong>.</li>
              <li>
                Give it any name (e.g. "My TasteEngine"). For{' '}
                <strong style={{ color: 'var(--text)' }}>Redirect URI</strong>, enter exactly:{' '}
                <span className="code-inline">tasteengine://callback</span>
              </li>
              <li>
                Under <strong style={{ color: 'var(--text)' }}>APIs used</strong>, check{' '}
                <strong style={{ color: 'var(--text)' }}>Web API</strong>. Accept the terms and click Save.
              </li>
              <li>
                Open your new app, click <strong style={{ color: 'var(--text)' }}>Settings</strong>,
                and copy your <strong style={{ color: 'var(--text)' }}>Client ID</strong> and{' '}
                <strong style={{ color: 'var(--text)' }}>Client Secret</strong>.
              </li>
            </ol>
            <div className="onboarding-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>← Back</button>
              <button className="btn btn-primary" onClick={() => setStep(2)}>I have my credentials →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboarding-step-title">Enter Your Credentials</div>
            <div className="onboarding-step-sub">
              Paste your Spotify app credentials below. These are stored locally and never leave your device.
            </div>
            <div className="form-group">
              <label className="form-label">Client ID</label>
              <input className="form-input" placeholder="32-character hex string"
                value={spotifyId} onChange={e => setSpotifyId(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input className="form-input" type="password" placeholder="32-character hex string"
                value={spotifySecret} onChange={e => setSpotifySecret(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Redirect URI (pre-filled — do not change)</label>
              <input className="form-input" value="tasteengine://callback" readOnly />
            </div>
            {connectError && <div className="notice notice-error">{connectError}</div>}
            <div className="onboarding-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary"
                disabled={!spotifyId.trim() || !spotifySecret.trim() || connecting}
                onClick={connectSpotify}>
                {connecting ? 'Connecting...' : 'Connect Spotify →'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onboarding-step-title">Set Up Last.fm (Optional)</div>
            <div className="onboarding-step-sub">
              Last.fm dramatically improves recommendation quality by adding scrobble history and artist
              similarity data. It's free and optional, but highly recommended.
            </div>
            <ol className="instruction-steps">
              <li>
                Create a free account at{' '}
                <span style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => window.electronAPI.openExternal('https://www.last.fm/join')}>
                  last.fm
                </span>
                {' '}if you don't have one, and enable scrobbling from Spotify.
              </li>
              <li>
                Go to{' '}
                <span style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => window.electronAPI.openExternal('https://www.last.fm/api/account/create')}>
                  last.fm/api/account/create
                </span>
                {' '}and create a free API account. Copy your API key.
              </li>
            </ol>
            <div className="form-group">
              <label className="form-label">Last.fm API Key</label>
              <input className="form-input" placeholder="Paste your API key"
                value={lastfmKey} onChange={e => setLastfmKey(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Last.fm Username</label>
              <input className="form-input" placeholder="Your Last.fm username"
                value={lastfmUser} onChange={e => setLastfmUser(e.target.value)} />
            </div>
            <div className="onboarding-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(4)}>Skip for now</button>
              <button className="btn btn-primary" onClick={saveLastfm}>
                {lastfmKey.trim() ? 'Save & Continue →' : 'Skip →'}
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="onboarding-step-title">Get Your Spotify Data</div>
            <div className="onboarding-step-sub">
              TasteEngine works best with your full streaming history. Request it from Spotify — it usually
              arrives within a few days.
            </div>
            <ol className="instruction-steps">
              <li>
                Go to{' '}
                <span style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => window.electronAPI.openExternal('https://www.spotify.com/account/privacy/')}>
                  spotify.com/account/privacy
                </span>
                {' '}and log in.
              </li>
              <li>
                Scroll to <strong style={{ color: 'var(--text)' }}>Download your data</strong> and click{' '}
                <strong style={{ color: 'var(--text)' }}>Request data</strong>.
              </li>
              <li>
                Spotify will email you a download link within a few days. Download and unzip the file
                (or keep it as a .zip).
              </li>
              <li>
                On the <strong style={{ color: 'var(--text)' }}>Analyze</strong> page, load the folder or .zip.
              </li>
            </ol>
            <div className="notice notice-info">
              You can start using TasteEngine now — it will use your live Spotify data. Load the export
              later for much better results.
            </div>
            <div className="onboarding-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(3)}>← Back</button>
              <button className="btn btn-primary" onClick={finish}>Launch TasteEngine →</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
