import React, { useRef, useEffect, useState } from 'react';

const FEATURES = [
  { key: 'energy', label: 'Energy' },
  { key: 'danceability', label: 'Dance' },
  { key: 'valence', label: 'Valence' },
  { key: 'acousticness', label: 'Acoustic' },
  { key: 'instrumentalness', label: 'Instrumental' },
  { key: 'liveness', label: 'Liveness' },
  { key: 'speechiness', label: 'Speech' },
  { key: 'loudness', label: 'Loudness' },
  { key: 'tempo', label: 'Tempo' },
];

export default function RadarChart({ avg = {}, std = {} }) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const n = FEATURES.length;
  const SIZE = 260;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = 100;

  function getPoint(idx, value) {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return {
      x: cx + R * value * Math.cos(angle),
      y: cy + R * value * Math.sin(angle),
    };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Grid rings
    for (let ring = 1; ring <= 5; ring++) {
      const r = (R * ring) / 5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Spokes
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(angle), cy + R * Math.sin(angle));
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Data polygon
    const points = FEATURES.map((f, i) => getPoint(i, avg[f.key] || 0));
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(29,185,84,0.2)';
    ctx.fill();
    ctx.strokeStyle = '#1DB954';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1DB954';
      ctx.fill();
    }

    // Labels
    ctx.fillStyle = 'rgba(200,200,200,0.7)';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const lx = cx + (R + 18) * Math.cos(angle);
      const ly = cy + (R + 18) * Math.sin(angle);
      ctx.fillText(FEATURES[i].label, lx, ly);
    }
  }, [avg]);

  function handleMouseMove(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: e.clientX, y: e.clientY });

    let closest = null;
    let minDist = 20;
    FEATURES.forEach((f, i) => {
      const p = getPoint(i, avg[f.key] || 0);
      const d = Math.hypot(mx - p.x, my - p.y);
      if (d < minDist) { minDist = d; closest = { ...f, value: avg[f.key], std: std[f.key] }; }
    });
    setHovered(closest);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        style={{ cursor: 'crosshair' }}
      />
      {hovered && (
        <div style={{
          position: 'fixed',
          left: mousePos.x + 14,
          top: mousePos.y - 10,
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 12,
          pointerEvents: 'none',
          zIndex: 200,
        }}>
          <strong>{hovered.label}</strong>: {(hovered.value || 0).toFixed(3)}
          {hovered.std != null && <div style={{ color: '#888' }}>±{(hovered.std || 0).toFixed(3)}</div>}
        </div>
      )}
    </div>
  );
}
