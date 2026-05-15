import React, { useEffect, useState } from 'react';

export default function HomePage({ spotifyStatus, settings, setPage }) {
  const [lastPlaylist, setLastPlaylist] = useState(null);

  useEffect(() => {
    window.electronAPI.getLastPlaylist().then(setLastPlaylist);
  }, []);

  const lastfmUser = settings?.credentials?.lastfm?.username;

  return (
    <div>
      <div className="home-hero">
        <div className="home-hero-title">
          {spotifyStatus.connected && spotifyStatus.displayName
            ? `Hey, ${spotifyStatus.displayName.split(' ')[0]}.`
            : 'Welcome back.'}
        </div>
        <div className="home-hero-sub">
          Discovery playlists built from your complete listening history — not just what you played last week.
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setPage('generate')}>Generate Playlist →</button>
          <button className="btn btn-secondary" onClick={() => setPage('analyze')}>Analyze My Taste</button>
        </div>
      </div>

      <div className="home-stats">
        <div className="stat-card">
          <div className="stat-card-label">Spotify</div>
          {spotifyStatus.connected ? (
            <>
              <span className="status-chip status-connected"><span className="dot" /> Connected</span>
              {spotifyStatus.displayName && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{spotifyStatus.displayName}</div>
              )}
            </>
          ) : (
            <>
              <span className="status-chip status-disconnected"><span className="dot" /> Not connected</span>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Open Settings → Re-authorize Spotify</div>
            </>
          )}
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Last.fm</div>
          {lastfmUser ? (
            <>
              <span className="status-chip status-connected"><span className="dot" /> {lastfmUser}</span>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Scrobble data active</div>
            </>
          ) : (
            <>
              <span className="status-chip status-warning"><span className="dot" /> Not configured</span>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Open Settings to add Last.fm for better results.</div>
            </>
          )}
        </div>

        {lastPlaylist && (
          <div className="stat-card">
            <div className="stat-card-label">Last Playlist</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1, marginBottom: 4 }}>
              {lastPlaylist.trackCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              tracks · {new Date(lastPlaylist.date).toLocaleDateString()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lastPlaylist.playlistName}
            </div>
            {lastPlaylist.playlistUrl && (
              <button className="btn btn-secondary btn-sm" onClick={() => window.electronAPI.openExternal(lastPlaylist.playlistUrl)}>
                Open in Spotify ↗
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 20 }}>How it works</h3>
        {[
          ['Load your Spotify data export', 'Request your data at spotify.com/account/privacy. Load the .zip on the Analyze page once it arrives.'],
          ['Build your taste fingerprint', 'TasteEngine merges your full history, live top tracks, and Last.fm scrobbles into weighted clusters.'],
          ["Generate a discovery playlist", "Finds artists similar to your taste clusters and builds a playlist of tracks you haven't heard yet."],
        ].map(([title, desc], i) => (
          <div key={i} className="how-step">
            <div className="step-num">{i + 1}</div>
            <div>
              <div className="step-title">{title}</div>
              <div className="step-desc">{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
