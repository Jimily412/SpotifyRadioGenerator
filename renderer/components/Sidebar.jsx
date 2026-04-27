import React from 'react';

const NAV = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'analyze', label: 'Analyze', icon: '◈' },
  { key: 'generate', label: 'Generate', icon: '⬡' },
];

export default function Sidebar({ page, setPage, setShowSettings }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">TasteEngine</div>
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
      <div className="sidebar-settings">
        <div className="nav-item" onClick={() => setShowSettings(true)}>
          <span className="nav-icon">⚙</span>
          Settings
        </div>
      </div>
    </aside>
  );
}
