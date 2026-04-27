import React, { useEffect, useRef } from 'react';

export default function ProgressLog({ entries = [] }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);

  return (
    <div className="progress-log" ref={ref}>
      {entries.map((e, i) => (
        <div key={i} className={`progress-line${i === entries.length - 1 ? ' done' : ''}`}>
          <span className="ts">{e.ts}</span>
          {e.message}
        </div>
      ))}
    </div>
  );
}
