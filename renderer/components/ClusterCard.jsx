import React from 'react';

const CLUSTER_COLORS = [
  '#ff6b35', // Hype — orange
  '#74b9ff', // Chill — blue
  '#55efc4', // Feel Good — mint
  '#a29bfe', // Dark / Moody — violet
  '#fdcb6e', // Focus / Instrumental — amber
  '#1DB954', // Mixed — green (Spotify)
];

export default function ClusterCard({ cluster }) {
  const color = CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length];
  const totalPct = cluster.pct != null ? Math.round(cluster.pct * 100) : null;

  return (
    <div className="cluster-card">
      <div className="cluster-card-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="cluster-label" style={{ color }}>{cluster.label}</div>
            <div className="cluster-meta">
              {cluster.trackCount?.toLocaleString()} tracks
              {totalPct != null && <> · {totalPct}% of your taste</>}
            </div>
          </div>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: `${color}22`, border: `2px solid ${color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, flexShrink: 0,
          }}>
            {['🔥','🌊','✨','🌑','🎹','🎵'][cluster.id % 6]}
          </div>
        </div>
        {totalPct != null && (
          <div className="cluster-bar-wrap">
            <div className="cluster-bar-bg">
              <div className="cluster-bar" style={{ width: `${totalPct}%`, background: color }} />
            </div>
          </div>
        )}
      </div>

      {cluster.topTracks?.length > 0 && (
        <ul className="cluster-tracks">
          {cluster.topTracks.slice(0, 4).map((t, i) => (
            <li key={i}>
              <span className="t-name">{t.name}</span>
              <span className="t-artist">{t.artistName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
