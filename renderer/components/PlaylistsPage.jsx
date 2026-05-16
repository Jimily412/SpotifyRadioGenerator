import React, { useState, useEffect } from 'react';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState(null);

  useEffect(() => {
    window.electronAPI.getPlaylists().then(setPlaylists);
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">My Playlists</div>
        <div className="page-subtitle">
          {playlists ? `${playlists.length} playlist${playlists.length !== 1 ? 's' : ''} created with TasteEngine` : 'Loading…'}
        </div>
      </div>

      {playlists?.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">♫</div>
          <div className="empty-state-title">No playlists yet</div>
          <div className="empty-state-sub">Head to Generate to build your first playlist.</div>
        </div>
      )}

      {playlists?.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {playlists.map((p, i) => (
            <div key={i} className="playlist-row">
              <div className="playlist-row-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>
                </svg>
              </div>
              <div className="playlist-row-info">
                <div className="playlist-row-name">{p.playlistName}</div>
                <div className="playlist-row-meta">{p.trackCount} tracks · {formatDate(p.date)}</div>
              </div>
              {p.playlistUrl && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => window.electronAPI.openExternal(p.playlistUrl)}
                >
                  Open in Spotify ↗
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
