import React, { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [creds, setCreds] = useState({ spotify: {}, lastfm: {} });
  const [settings, setSettings] = useState({ defaultPlaylistSize: 150, defaultPlaylistNameTemplate: '' });
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState('');

  useEffect(() => {
    (async () => {
      const c = await window.api.store.get('credentials');
      const s = await window.api.store.get('settings');
      setCreds(c || { spotify: {}, lastfm: {} });
      setSettings(s || {});
      const pkg = await window.api.store.get('__version__') || '';
      setVersion(pkg);
      // Try to get version from a known location
      try {
        const r = await window.api.store.get('_appVersion');
        if (r) setVersion(r);
      } catch {}
    })();
  }, []);

  const save = async () => {
    await window.api.store.set('credentials', creds);
    await window.api.store.set('settings', settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearCache = async (type) => {
    await window.api.cache.clear(type);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const reauth = async () => {
    await window.api.spotify.disconnect();
    await window.api.spotify.connect();
  };

  const setSpotify = (k, v) => setCreds(c => ({ ...c, spotify: { ...c.spotify, [k]: v } }));
  const setLastfm = (k, v) => setCreds(c => ({ ...c, lastfm: { ...c.lastfm, [k]: v } }));

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Configure credentials and preferences.</p>

      {saved && <div className="notice info">Saved!</div>}

      <div className="settings-section">
        <div className="settings-section-title">Spotify Credentials</div>

        <div className="field">
          <label>Client ID</label>
          <input type="text" value={creds.spotify?.clientId || ''} onChange={e => setSpotify('clientId', e.target.value)} />
        </div>
        <div className="field">
          <label>Client Secret</label>
          <input type="password" value={creds.spotify?.clientSecret || ''} onChange={e => setSpotify('clientSecret', e.target.value)} />
        </div>
        <div className="field">
          <label>Redirect URI <span className="text-muted text-sm">(read-only — must match Spotify Dashboard)</span></label>
          <input type="text" value={creds.spotify?.redirectUri || 'tasteengine://callback'} readOnly />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Last.fm Credentials</div>
        <div className="field">
          <label>API Key</label>
          <input type="text" value={creds.lastfm?.apiKey || ''} onChange={e => setLastfm('apiKey', e.target.value)} />
        </div>
        <div className="field">
          <label>Shared Secret</label>
          <input type="password" value={creds.lastfm?.secret || ''} onChange={e => setLastfm('secret', e.target.value)} />
        </div>
        <div className="field">
          <label>Username</label>
          <input type="text" value={creds.lastfm?.username || ''} onChange={e => setLastfm('username', e.target.value)} />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Playlist Defaults</div>
        <div className="settings-row">
          <label>Default Size</label>
          <input
            type="number" min={50} max={500} step={25}
            value={settings.defaultPlaylistSize || 150}
            onChange={e => setSettings(s => ({ ...s, defaultPlaylistSize: Number(e.target.value) }))}
            style={{ width: 100 }}
          />
        </div>
        <div className="field">
          <label>Name Template</label>
          <input
            type="text"
            value={settings.defaultPlaylistNameTemplate || ''}
            onChange={e => setSettings(s => ({ ...s, defaultPlaylistNameTemplate: e.target.value }))}
            placeholder="TasteEngine Mix — {date}"
          />
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <button className="btn-primary w-full" onClick={save}>Save Settings</button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Cache Management</div>
        <div className="cache-buttons">
          <button className="btn-secondary" onClick={() => clearCache('trackIds')}>Clear Track ID Cache</button>
          <button className="btn-secondary" onClick={() => clearCache('audioFeatures')}>Clear Audio Features Cache</button>
          <button className="btn-secondary" onClick={() => clearCache('recommendations')}>Clear Recommendation Cache</button>
          <button className="btn-secondary" onClick={() => clearCache('all')}>Clear All Caches</button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Account</div>
        <div className="settings-row">
          <span className="text-muted">Re-authorize Spotify (clears tokens and re-opens browser)</span>
          <button className="btn-danger" onClick={reauth}>Re-authorize</button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">App Info</div>
        <div className="app-version">
          TasteEngine &nbsp;·&nbsp; Electron app
        </div>
      </div>
    </>
  );
}
