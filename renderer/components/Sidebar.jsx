import React from 'react';

const NAV = [
  { key: 'home',     label: 'Home',     icon: '⌂' },
  { key: 'analyze',  label: 'Analyze',  icon: '◈' },
  { key: 'generate', label: 'Generate', icon: '▶' },
];

export default function Sidebar({ page, setPage, setShowSettings, version }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-name">TasteEngine</div>
        <div className="sidebar-brand-tagline">Playlist Generator</div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(item => (
          <div
            key={item.key}
            className={`nav-item${page === item.key ? ' active' : ''}`}
            onClick={() => setPage(item.key)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="nav-item" onClick={() => setShowSettings(true)}>
          <span className="nav-icon">⚙</span>
          Settings
        </div>
        {version && <div className="sidebar-version">v{version}</div>}
      </div>
    </aside>
  );
}
