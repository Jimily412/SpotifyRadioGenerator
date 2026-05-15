import React, { useEffect, useState } from 'react';

export default function SettingsPage({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
    window.electronAPI.onUpdateStatus(data => setUpdateStatus(data));
  }, []);

  function set(path, val) {
    setSettings(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = val;
      return next;
    });
    setSaved(false);
  }

  async function save() {
    await window.electronAPI.saveSettings({ credentials: settings.credentials, settings: settings.settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function reauthorize() {
    await window.electronAPI.reauthorizeSpotify();
    onClose();
  }

  async function checkUpdates() {
    setUpdateStatus({ state: 'checking' });
    const result = await window.electronAPI.checkForUpdates();
    if (!result.ok) setUpdateStatus({ state: 'error', message: result.message });
  }

  async function resetOnboarding() {
    await window.electronAPI.resetOnboarding();
    onClose();
    window.location.reload();
  }

  if (!settings) {
    return (
      <div className="settings-overlay">
        <div className="settings-modal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>Settings</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <h3>Spotify Credentials</h3>
        <div className="form-group">
          <label className="form-label">Client ID</label>
          <input className="form-input" value={settings.credentials?.spotify?.clientId || ''}
            onChange={e => set('credentials.spotify.clientId', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Client Secret</label>
          <input className="form-input" type="password" value={settings.credentials?.spotify?.clientSecret || ''}
            onChange={e => set('credentials.spotify.clientSecret', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Redirect URI</label>
          <input className="form-input" value="tasteengine://callback" readOnly />
        </div>

        <div className="divider" />

        <h3>Last.fm Credentials</h3>
        <div className="form-group">
          <label className="form-label">API Key</label>
          <input className="form-input" value={settings.credentials?.lastfm?.apiKey || ''}
            onChange={e => set('credentials.lastfm.apiKey', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input className="form-input" value={settings.credentials?.lastfm?.username || ''}
            onChange={e => set('credentials.lastfm.username', e.target.value)} />
        </div>

        <div className="divider" />

        <h3>Defaults</h3>
        <div className="form-group">
          <label className="form-label">Default Playlist Size</label>
          <div className="slider-wrapper">
            <input type="range" className="slider" min={50} max={500} step={25}
              value={settings.settings?.defaultPlaylistSize || 150}
              onChange={e => set('settings.defaultPlaylistSize', Number(e.target.value))} />
            <span className="slider-value">{settings.settings?.defaultPlaylistSize || 150}</span>
          </div>
        </div>

        <button className="btn btn-primary" onClick={save} style={{ marginBottom: 24, width: '100%' }}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>

        <div className="divider" />

        <h3 style={{ marginBottom: 12 }}>Cache</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['trackIds', 'Track IDs'], ['audioFeatures', 'Audio Features'], ['recommendations', 'Recommendations']].map(([key, label]) => (
            <button key={key} className="btn btn-secondary btn-sm" onClick={() => window.electronAPI.clearCache(key)}>
              Clear {label}
            </button>
          ))}
        </div>

        <div className="divider" />

        <h3 style={{ marginBottom: 12 }}>Auth &amp; Updates</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-danger btn-sm" onClick={reauthorize}>Re-authorize Spotify</button>
          <button className="btn btn-secondary btn-sm" onClick={checkUpdates}>Check for Updates</button>
          <button className="btn btn-ghost btn-sm" onClick={resetOnboarding}>Run Setup Wizard</button>
        </div>

        {updateStatus && (
          <div className={`notice ${updateStatus.state === 'error' ? 'notice-error' : 'notice-info'}`} style={{ marginTop: 14 }}>
            {updateStatus.state === 'checking' && 'Checking for updates…'}
            {updateStatus.state === 'up-to-date' && '✓ You are on the latest version.'}
            {updateStatus.state === 'available' && `Update v${updateStatus.version} available — downloading…`}
            {updateStatus.state === 'downloaded' && `✓ v${updateStatus.version} ready — restart to install.`}
            {updateStatus.state === 'error' && `Update check failed: ${updateStatus.message}`}
          </div>
        )}

        <div className="divider" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Version {settings.version || '—'}</div>
      </div>
    </div>
  );
}
