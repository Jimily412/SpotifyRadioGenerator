import React, { useState, useEffect } from 'react';
import './styles/main.css';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import AnalyzePage from './components/AnalyzePage';
import GeneratePage from './components/GeneratePage';
import PlaylistsPage from './components/PlaylistsPage';
import GuidePage from './components/GuidePage';
import SettingsPage from './components/SettingsPage';
import OnboardingPage from './components/OnboardingPage';

export default function App() {
  const [page, setPage] = useState('home');
  const [showSettings, setShowSettings] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState({ connected: false });
  const [updateState, setUpdateState] = useState(null);
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(null);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    window.electronAPI.getOnboardingState().then(state => {
      setOnboardingDone(state.completed);
    });

    window.electronAPI.getSettings().then(setSettings);

    window.electronAPI.getSpotifyStatus().then(setSpotifyStatus);

    window.electronAPI.onAuthSuccess(data => {
      setSpotifyStatus({ connected: true, displayName: data.displayName });
      setConnectingSpotify(false);
    });
    window.electronAPI.onAuthError(err => {
      console.error('Auth error:', err);
      setConnectingSpotify(false);
    });

    window.electronAPI.onUpdateAvailable(() => setUpdateState('available'));
    window.electronAPI.onUpdateDownloaded(() => setUpdateState('downloaded'));
  }, []);

  function handleOnboardingComplete() {
    setOnboardingDone(true);
    window.electronAPI.getSpotifyStatus().then(setSpotifyStatus);
    window.electronAPI.getSettings().then(setSettings);
  }

  async function handleConnectSpotify() {
    setConnectingSpotify(true);
    await window.electronAPI.connectSpotify();
  }

  // Still loading onboarding state
  if (onboardingDone === null) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</span>
      </div>
    );
  }

  if (!onboardingDone) {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} setShowSettings={setShowSettings} version={settings?.version} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {updateState === 'downloaded' && (
          <div className="update-banner">
            <span>Update ready to install</span>
            <button onClick={() => window.electronAPI.installUpdate()}>Restart &amp; Update</button>
          </div>
        )}
        {updateState === 'available' && (
          <div className="update-banner update-banner-subtle">
            <span>Update downloading in background...</span>
            <button onClick={() => setUpdateState(null)}>✕</button>
          </div>
        )}

        <div className="content">
          {!spotifyStatus.connected && (
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="status-chip status-disconnected"><span className="dot" /> Spotify not connected</span>
              <button className="btn btn-primary btn-sm" onClick={handleConnectSpotify} disabled={connectingSpotify}>
                {connectingSpotify ? 'Connecting...' : 'Connect Spotify'}
              </button>
            </div>
          )}

          {page === 'home' && <HomePage spotifyStatus={spotifyStatus} settings={settings} setPage={setPage} />}
          {page === 'analyze' && <AnalyzePage />}
          {page === 'generate' && <GeneratePage />}
          {page === 'playlists' && <PlaylistsPage />}
          {page === 'guide' && <GuidePage />}
        </div>
      </div>

      {showSettings && <SettingsPage onClose={() => { setShowSettings(false); window.electronAPI.getSettings().then(setSettings); }} />}
    </div>
  );
}
