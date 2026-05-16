import React from 'react';

const NAV = [
  {
    key: 'home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12 3L2 12h3v9h6v-5h2v5h6v-9h3L12 3z"/>
      </svg>
    ),
  },
  {
    key: 'analyze',
    label: 'Analyze',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M5 9h2v11H5zm4-4h2v15H9zm4 8h2v7h-2zm4-8h2v15h-2z"/>
      </svg>
    ),
  },
  {
    key: 'generate',
    label: 'Generate',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    ),
  },
  {
    key: 'playlists',
    label: 'My Playlists',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zm-4 4H3v2h8v-2zm9-1v8l-5-3 5-5z"/>
      </svg>
    ),
  },
  {
    key: 'guide',
    label: 'Guide',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
      </svg>
    ),
  },
];

export default function Sidebar({ page, setPage, setShowSettings, version }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo-area">
        <div className="sidebar-logo-mark">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
        </div>
        <div className="sidebar-appname">TasteEngine</div>
        <div className="sidebar-tagline">Your music, refined</div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(item => (
          <div
            key={item.key}
            className={`nav-item${page === item.key ? ' active' : ''}`}
            onClick={() => setPage(item.key)}
          >
            <div className="nav-icon-wrap">
              {item.icon}
              <span className="nav-dot" />
            </div>
            {item.label}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="nav-item" onClick={() => setShowSettings(true)}>
          <div className="nav-icon-wrap">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96a6.97 6.97 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </div>
          Settings
        </div>
        {version && <div className="sidebar-version">v{version}</div>}
      </div>
    </aside>
  );
}
