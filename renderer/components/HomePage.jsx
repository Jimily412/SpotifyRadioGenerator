import React, { useEffect, useState } from 'react';

export default function HomePage({ spotifyStatus, settings, setPage }) {
  const [lastPlaylist, setLastPlaylist] = useState(null);

  useEffect(() => {
    window.electronAPI.getLastPlaylist().then(setLastPlaylist);
  }, []);

  const lastfmUser = settings?.credentials?.lastfm?.username;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Welcome back</div>
        <div className="page-subtitle">Your personal music taste engine — powered by your full listening history.</div>
      </div>

      <div className="home-stats">
        <div className="stat-card">
          <div className="section-eyebrow">Spotify</div>
          {spotifyStatus.connected ? (
            <>
              <span className="status-chip status-connected"><span className="dot" /> Connected</span>
              {spotifyStatus.displayName && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{spotifyStatus.displayName}</div>
              )}
            </>
          ) : (
            <span className="status-chip status-disconnected"><span className="dot" /> Not connected</span>
          )}
        </div>

        <div className="stat-card">
          <div className="section-eyebrow">Last.fm</div>
          {lastfmUser ? (
            <span className="status-chip status-connected"><span className="dot" /> {lastfmUser}</span>
          ) : (
            <span className="status-chip status-warning"><span className="dot" /> Not configured</span>
          )}
        </div>

        {lastPlaylist && (
          <div className="stat-card">
            <div className="section-eyebrow">Last Playlist</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3, color: 'var(--text)' }}>
              {lastPlaylist.trackCount} tracks
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              {lastPlaylist.playlistName} · {new Date(lastPlaylist.date).toLocaleDateString()}
            </div>
            {lastPlaylist.playlistUrl && (
              <button className="btn btn-secondary btn-sm" onClick={() => window.electronAPI.openExternal(lastPlaylist.playlistUrl)}>
                Open in Spotify ↗
              </button>
            )}
          </div>
        )}
      </div>

      {!spotifyStatus.connected && (
        <div className="notice notice-warn">
          Connect your Spotify account to get started. Open Settings and click "Re-authorize Spotify."
        </div>
      )}

      <div className="card">
        <h2>How it works</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          {[
            ['1', 'Load your Spotify data export', 'Request your data at spotify.com/account/privacy and load it on the Analyze page.'],
            ['2', 'Build your taste fingerprint', 'TasteEngine merges your full history, live Spotify data, and Last.fm scrobbles into weighted taste clusters.'],
            ['3', 'Generate a discovery playlist', 'Finds artists similar to your clusters and creates a playlist of tracks you haven\'t heard yet.'],
          ].map(([num, title, desc]) => (
            <div key={num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div className="step-badge">{num}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setPage('analyze')}>
          Start Analyzing →
        </button>
      </div>
    </div>
  );
}
