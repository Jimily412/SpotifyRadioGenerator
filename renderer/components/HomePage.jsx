import React, { useEffect, useState } from 'react';

export default function HomePage({ spotifyStatus, setPage }) {
  const [lastPlaylist, setLastPlaylist] = useState(null);

  useEffect(() => {
    window.electronAPI.getLastPlaylist().then(setLastPlaylist);
  }, []);

  return (
    <div>
      <h1>Welcome to TasteEngine</h1>
      <p style={{ marginBottom: 24 }}>Your personal AI playlist generator powered by your Spotify listening DNA.</p>

      <div className="home-stats">
        <div className="stat-card">
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Spotify</div>
          {spotifyStatus.connected ? (
            <>
              <span className="status-chip status-connected"><span className="dot" /> Connected</span>
              <div style={{ fontSize: 13, color: '#aaa', marginTop: 8 }}>{spotifyStatus.displayName}</div>
            </>
          ) : (
            <span className="status-chip status-disconnected"><span className="dot" /> Not connected</span>
          )}
        </div>

        <div className="stat-card">
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last.fm</div>
          <span className="status-chip status-connected"><span className="dot" /> JimJeffords</span>
        </div>

        {lastPlaylist && (
          <div className="stat-card">
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last Playlist</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{lastPlaylist.playlistName}</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              {lastPlaylist.trackCount} tracks · {new Date(lastPlaylist.date).toLocaleDateString()}
            </div>
            {lastPlaylist.playlistUrl && (
              <button className="btn btn-secondary btn-sm" onClick={() => window.electronAPI.openExternal(lastPlaylist.playlistUrl)}>
                Open in Spotify
              </button>
            )}
          </div>
        )}
      </div>

      {!spotifyStatus.connected && (
        <div className="notice notice-warn">
          Connect your Spotify account to get started. Go to Settings ⚙ and click "Re-authorize Spotify", or the button will appear here once the app loads your credentials.
        </div>
      )}

      <div className="card">
        <h2>How it works</h2>
        <ol style={{ color: '#aaa', paddingLeft: 20, lineHeight: 2 }}>
          <li>Load your Spotify data export on the <strong style={{ color: '#e8e8e8' }}>Analyze</strong> page</li>
          <li>Run taste analysis — TasteEngine builds your audio fingerprint</li>
          <li>Go to <strong style={{ color: '#e8e8e8' }}>Generate</strong> and create a discovery playlist</li>
        </ol>
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={() => setPage('analyze')}>Go to Analyze →</button>
        </div>
      </div>
    </div>
  );
}
