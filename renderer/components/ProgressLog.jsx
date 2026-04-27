import React, { useEffect, useRef } from 'react';

export default function ProgressLog({ lines }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="progress-log">
      {lines.length === 0 && <span style={{ color: '#555' }}>Progress will appear here...</span>}
      {lines.map((line, i) => (
        <div key={i} className="log-line">{line}</div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
