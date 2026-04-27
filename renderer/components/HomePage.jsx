import React from 'react';
import { useApp } from '../App';

export default function HomePage() {
  const { state, navigate } = useApp();
  const { auth, lastPlaylist, lastfmLastSync } = state;

  const handleConnect = async () => {
    window.api.spotify.connect();
  };

  const handleDisconnect = async () => {
    await window.api.spotify.disconnect();
    window.location.reload();
  };

  const lastfmCreds = state.analysis?.liveDataSummary || {};
  const syncTime = lastfmLastSync ? new Date(lastfmLastSync).toLocaleString() : 'Never';

  return (
    <>
      <h1 className="page-title">Home</h1>
      <p className="page-subtitle">Welcome to TasteEngine — your personal music taste engine.</p>

      <div className="card">
        <div className="card-title">Spotify Connection</div>
        {auth.status === 'connected' ? (
          <div>
            <div className="status-row" style={{ marginBottom: 12 }}>
              <div className="dot green" />
              <span>Connected as <strong>{auth.displayName}</strong></span>
            </div>
            <button className="btn-secondary" onClick={handleDisconnect}>Disconnect</button>
          </div>
        ) : auth.status === 'connecting' ? (
          <div className="status-row">
            <div className="dot yellow" />
            <span>Waiting for authorization in browser...</span>
          </div>
        ) : auth.status === 'error' ? (
          <div>
            <div className="notice error" style={{ marginBottom: 10 }}>Auth error — try again</div>
            <button className="btn-primary" onClick={handleConnect}>Connect Spotify</button>
          </div>
        ) : auth.status === 'timeout' ? (
          <div>
            <div className="notice warn" style={{ marginBottom: 10 }}>Auth timed out — try again</div>
            <button className="btn-primary" onClick={handleConnect}>Connect Spotify</button>
          </div>
        ) : (
          <div>
            <div className="status-row" style={{ marginBottom: 12 }}>
              <div className="dot red" />
              <span className="text-muted">Not connected</span>
            </div>
            <button className="btn-primary" onClick={handleConnect}>Connect Spotify</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Last.fm Integration</div>
        <div className="status-row">
          <div className="dot green" />
          <span>Configured for <strong>JimJeffords</strong></span>
        </div>
        <div className="text-muted text-sm mt-8">Last synced: {syncTime}</div>
      </div>

      <div className="card">
        <div className="card-title">Last Generated Playlist</div>
        {lastPlaylist ? (
          <div className="last-playlist">
            <div className="last-playlist-name">{lastPlaylist.name}</div>
            <div className="last-playlist-meta">
              {lastPlaylist.trackCount} tracks &middot; {new Date(lastPlaylist.createdAt).toLocaleDateString()}
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                className="btn-primary"
                onClick={() => window.api.openExternal(lastPlaylist.url)}
              >
                Open in Spotify
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-muted text-sm" style={{ marginBottom: 12 }}>No playlist generated yet.</p>
            {auth.status === 'connected' ? (
              <button className="btn-secondary" onClick={() => navigate('analyze')}>Get Started →</button>
            ) : (
              <button className="btn-secondary" onClick={handleConnect}>Connect Spotify to Begin</button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
