import React from 'react';

const MOOD_COLOR = {
  'Hype': '#ff6b35',
  'Chill': '#74b9ff',
  'Feel Good': '#fdcb6e',
  'Dark / Moody': '#a29bfe',
  'Focus / Instrumental': '#00b894',
  'Mixed': '#636e72',
  'Top Picks': '#1DB954',
  'Heavy Rotation': '#00cec9',
  'Regular Plays': '#6c5ce7',
  'Occasional Plays': '#fd79a8',
  'Light Plays': '#fab1a0',
  'Discovery Seeds': '#55efc4',
};

export default function ClusterCard({ cluster }) {
  const pct = parseFloat(cluster.weightPct) || 0;
  const color = MOOD_COLOR[cluster.label] || '#1DB954';

  return (
    <div className="cluster-card">
      <div className="cluster-header">
        <span className="cluster-label" style={{ color }}>{cluster.label}</span>
        <span className="cluster-pct">{pct.toFixed(1)}%</span>
      </div>
      <div className="cluster-bar-bg">
        <div className="cluster-bar" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <div className="cluster-track-count">{cluster.trackCount} tracks</div>
      <ul className="cluster-tracks">
        {(cluster.topTracks || []).map((t, i) => (
          <li key={i}>
            {t.trackName}<span> — {t.artistName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
