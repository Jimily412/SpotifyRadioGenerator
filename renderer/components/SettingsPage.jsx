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
    await window.electronAPI.saveSettings({
      credentials: settings.credentials,
      settings: settings.settings,
    });
    setSaved(true);
  }

  async function clearCache(type) {
    await window.electronAPI.clearCache(type);
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

  if (!settings) return <div style={{ padding: 32, color: '#888' }}>Loading settings...</div>;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, width: 560, maxHeight: '85vh', overflow: 'auto', padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        <h3>Spotify Credentials</h3>
        <div className="form-group">
          <label className="form-label">Client ID</label>
          <input className="form-input" value={settings.credentials?.spotify?.clientId || ''} onChange={e => set('credentials.spotify.clientId', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Client Secret</label>
          <input className="form-input" value={settings.credentials?.spotify?.clientSecret || ''} onChange={e => set('credentials.spotify.clientSecret', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Redirect URI (read-only — must be tasteengine://callback)</label>
          <input className="form-input" value="tasteengine://callback" readOnly />
        </div>

        <h3 style={{ marginTop: 20 }}>Last.fm Credentials</h3>
        <div className="form-group">
          <label className="form-label">API Key</label>
          <input className="form-input" value={settings.credentials?.lastfm?.apiKey || ''} onChange={e => set('credentials.lastfm.apiKey', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Shared Secret</label>
          <input className="form-input" value={settings.credentials?.lastfm?.secret || ''} onChange={e => set('credentials.lastfm.secret', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input className="form-input" value={settings.credentials?.lastfm?.username || ''} onChange={e => set('credentials.lastfm.username', e.target.value)} />
        </div>

        <h3 style={{ marginTop: 20 }}>Defaults</h3>
        <div className="form-group">
          <label className="form-label">Default Playlist Size</label>
          <div className="slider-wrapper">
            <input type="range" className="slider" min={50} max={500} step={25}
              value={settings.settings?.defaultPlaylistSize || 150}
              onChange={e => set('settings.defaultPlaylistSize', Number(e.target.value))} />
            <span className="slider-value">{settings.settings?.defaultPlaylistSize || 150}</span>
          </div>
        </div>

        <div style={{ marginTop: 20, marginBottom: 8 }}>
          <button className="btn btn-primary" onClick={save} style={{ marginRight: 8 }}>
            {saved ? '✓ Saved' : 'Save Settings'}
          </button>
        </div>

        <h3 style={{ marginTop: 24 }}>Cache</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => clearCache('trackIds')}>Clear Track ID Cache</button>
          <button className="btn btn-secondary btn-sm" onClick={() => clearCache('audioFeatures')}>Clear Audio Features Cache</button>
          <button className="btn btn-secondary btn-sm" onClick={() => clearCache('recommendations')}>Clear Recommendation Cache</button>
        </div>

        <h3 style={{ marginTop: 24 }}>Auth & Updates</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn btn-danger btn-sm" onClick={reauthorize}>Re-authorize Spotify</button>
          <button className="btn btn-secondary btn-sm" onClick={checkUpdates}>Check for Updates</button>
        </div>
        {updateStatus && (
          <div style={{ marginTop: 10, fontSize: 13, padding: '8px 12px', borderRadius: 6,
            background: updateStatus.state === 'error' ? 'rgba(231,76,60,0.1)' : 'rgba(29,185,84,0.08)',
            border: `1px solid ${updateStatus.state === 'error' ? 'rgba(231,76,60,0.3)' : 'rgba(29,185,84,0.2)'}`,
            color: updateStatus.state === 'error' ? '#e74c3c' : '#1DB954' }}>
            {updateStatus.state === 'checking' && 'Checking for updates...'}
            {updateStatus.state === 'up-to-date' && '✓ You are on the latest version.'}
            {updateStatus.state === 'available' && `Update v${updateStatus.version} found — downloading...`}
            {updateStatus.state === 'downloaded' && `✓ v${updateStatus.version} ready — restart to apply.`}
            {updateStatus.state === 'error' && `Update check failed: ${updateStatus.message}`}
          </div>
        )}
        <div style={{ marginTop: 20, fontSize: 12, color: '#555' }}>
          Version: {settings.version || '—'}
        </div>
      </div>
    </div>
  );
}
