import React, { useEffect, useRef } from 'react';

export default function ProgressLog({ lines }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="progress-log">
      {lines.length === 0 && <span>Waiting...</span>}
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1;
        const isError = /error|failed|fail/i.test(line);
        const cls = isError ? 'log-line log-error' : isLast ? 'log-line log-latest' : 'log-line';
        return <div key={i} className={cls}>{line}</div>;
      })}
      <div ref={endRef} />
    </div>
  );
}
