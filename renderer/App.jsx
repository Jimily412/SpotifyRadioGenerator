import React, { useState, useEffect } from 'react';
import './styles/main.css';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import AnalyzePage from './components/AnalyzePage';
import GeneratePage from './components/GeneratePage';
import SettingsPage from './components/SettingsPage';

export default function App() {
  const [page, setPage] = useState('home');
  const [showSettings, setShowSettings] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState({ connected: false });
  const [updateState, setUpdateState] = useState(null); // 'available' | 'downloaded'
  const [connectingSpotify, setConnectingSpotify] = useState(false);

  useEffect(() => {
    // Check Spotify status on load
    window.electronAPI.getSpotifyStatus().then(setSpotifyStatus);

    // Listen for auth events
    window.electronAPI.onAuthSuccess(data => {
      setSpotifyStatus({ connected: true, displayName: data.displayName });
      setConnectingSpotify(false);
    });
    window.electronAPI.onAuthError(err => {
      console.error('Auth error:', err);
      setConnectingSpotify(false);
      alert(`Spotify auth failed: ${err}`);
    });

    // Auto-update events
    window.electronAPI.onUpdateAvailable(() => setUpdateState('available'));
    window.electronAPI.onUpdateDownloaded(() => setUpdateState('downloaded'));
  }, []);

  async function handleConnectSpotify() {
    setConnectingSpotify(true);
    await window.electronAPI.connectSpotify();
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} setShowSettings={setShowSettings} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {updateState === 'downloaded' && (
          <div className="update-banner">
            <span>Update ready to install</span>
            <button onClick={() => window.electronAPI.installUpdate()}>Restart & Update</button>
          </div>
        )}
        {updateState === 'available' && (
          <div className="update-banner" style={{ background: '#2a2a2a', color: '#e8e8e8' }}>
            <span>Update downloading in background...</span>
            <button onClick={() => setUpdateState(null)} style={{ color: '#e8e8e8' }}>✕</button>
          </div>
        )}

        <div className="content">
          {!spotifyStatus.connected && page !== 'settings' && (
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="status-chip status-disconnected"><span className="dot" /> Spotify not connected</span>
              <button className="btn btn-primary btn-sm" onClick={handleConnectSpotify} disabled={connectingSpotify}>
                {connectingSpotify ? 'Connecting...' : 'Connect Spotify'}
              </button>
            </div>
          )}

          {page === 'home' && <HomePage spotifyStatus={spotifyStatus} setPage={setPage} />}
          {page === 'analyze' && <AnalyzePage />}
          {page === 'generate' && <GeneratePage />}
        </div>
      </div>

      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
    </div>
  );
}
