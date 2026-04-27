import React, { useRef, useEffect, useState } from 'react';

const FEATURES = [
  { key: 'energy', label: 'Energy' },
  { key: 'danceability', label: 'Dance' },
  { key: 'valence', label: 'Valence' },
  { key: 'acousticness', label: 'Acoustic' },
  { key: 'instrumentalness', label: 'Instrumental' },
  { key: 'liveness', label: 'Liveness' },
  { key: 'speechiness', label: 'Speech' },
  { key: 'tempo', label: 'Tempo' },
  { key: 'loudness', label: 'Loudness' }
];

const N = FEATURES.length;
const LEVELS = 5;

function polarToXY(angle, r, cx, cy) {
  return [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];
}

export default function RadarChart({ data = {}, size = 280 }) {
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const labelR = radius + 22;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Grid
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    for (let lv = 1; lv <= LEVELS; lv++) {
      const r = (radius * lv) / LEVELS;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const angle = (2 * Math.PI * i) / N;
        const [x, y] = polarToXY(angle, r, cx, cy);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Axis lines
    for (let i = 0; i < N; i++) {
      const angle = (2 * Math.PI * i) / N;
      const [x, y] = polarToXY(angle, radius, cx, cy);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = '#888';
    ctx.font = `10px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      const angle = (2 * Math.PI * i) / N;
      const [x, y] = polarToXY(angle, labelR, cx, cy);
      ctx.fillText(FEATURES[i].label, x, y);
    }

    // Data polygon
    const hasData = FEATURES.some(f => data[f.key] != null && data[f.key] > 0);
    if (!hasData) return;

    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const val = data[FEATURES[i].key] ?? 0;
      const r = val * radius;
      const angle = (2 * Math.PI * i) / N;
      const [x, y] = polarToXY(angle, r, cx, cy);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(29, 185, 84, 0.18)';
    ctx.fill();
    ctx.strokeStyle = '#1DB954';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Data points
    for (let i = 0; i < N; i++) {
      const val = data[FEATURES[i].key] ?? 0;
      const r = val * radius;
      const angle = (2 * Math.PI * i) / N;
      const [x, y] = polarToXY(angle, r, cx, cy);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#1DB954';
      ctx.fill();
    }
  }, [data, size]);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (let i = 0; i < N; i++) {
      const val = data[FEATURES[i].key] ?? 0;
      const r = val * radius;
      const angle = (2 * Math.PI * i) / N;
      const [px, py] = polarToXY(angle, r, cx, cy);
      if (Math.hypot(mx - px, my - py) < 10) {
        setTooltip({ x: e.clientX - rect.left + 10, y: e.clientY - rect.top - 10, label: FEATURES[i].label, val: val.toFixed(3) });
        return;
      }
    }
    setTooltip(null);
  };

  return (
    <div className="radar-container" style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: 'block' }}
      />
      {tooltip && (
        <div className="radar-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.label}: {tooltip.val}
        </div>
      )}
    </div>
  );
}
