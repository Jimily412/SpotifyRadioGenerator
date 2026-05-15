import React, { useEffect, useRef } from 'react';

export default function ProgressLog({ lines }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div className="progress-log" ref={ref}>
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1;
        const isError = /error|failed|fail/i.test(line);
        const cls = isError ? 'log-line log-error' : isLast ? 'log-line log-latest' : 'log-line';
        return <div key={i} className={cls}>{line}</div>;
      })}
    </div>
  );
}
