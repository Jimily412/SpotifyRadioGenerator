import React from 'react';
import { useApp } from '../App';

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
  </svg>
);
const AnalyzeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 3v18h18V3H3zm14 14H7V7h10v10zM9 9h6v6H9z"/>
  </svg>
);
const GenerateIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
  </svg>
);
const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54a7.03 7.03 0 0 0-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>
  </svg>
);

const NAV = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'analyze', label: 'Analyze', Icon: AnalyzeIcon },
  { id: 'generate', label: 'Generate', Icon: GenerateIcon }
];

export default function Sidebar() {
  const { state, navigate } = useApp();
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <h1>TasteEngine</h1>
        <p>AI Playlist Generator</p>
      </div>
      <div className="nav">
        {NAV.map(({ id, label, Icon }) => (
          <div
            key={id}
            className={`nav-item${state.page === id ? ' active' : ''}`}
            onClick={() => navigate(id)}
          >
            <Icon />
            {label}
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div
          className={`nav-item${state.page === 'settings' ? ' active' : ''}`}
          onClick={() => navigate('settings')}
        >
          <SettingsIcon />
          Settings
        </div>
      </div>
    </nav>
  );
}
