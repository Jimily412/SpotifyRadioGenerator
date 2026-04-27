import React from 'react';

export default function ClusterCard({ cluster }) {
  const { label, emoji, trackCount, weightPercent, topTracks } = cluster;
  return (
    <div className="cluster-card">
      <div className="cluster-header">
        <span className="cluster-emoji">{emoji}</span>
        <div>
          <div className="cluster-name">{label}</div>
          <div className="cluster-meta">{trackCount} tracks &middot; {weightPercent}% of taste weight</div>
        </div>
      </div>
      <div className="cluster-weight-bar">
        <div className="cluster-weight-fill" style={{ width: `${weightPercent}%` }} />
      </div>
      <div className="cluster-tracks">
        {(topTracks || []).map((t, i) => (
          <div key={i} className="cluster-track">
            <span className="cluster-track-name">{t.track}</span>
            <span className="cluster-track-artist text-muted">{t.artist}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
