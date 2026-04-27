import React, { useState, useEffect } from 'react';
import { useApp } from '../App';
import ProgressLog from './ProgressLog';

export default function GeneratePage() {
  const { state, dispatch } = useApp();
  const { analysis, generate, auth } = state;

  const defaultName = `TasteEngine Mix — ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
  const [playlistName, setPlaylistName] = useState(defaultName);
  const [targetSize, setTargetSize] = useState(150);
  const [includeFamiliar, setIncludeFamiliar] = useState(false);
  const [clusterBias, setClusterBias] = useState({});
  const [estimate, setEstimate] = useState(null);

  useEffect(() => {
    window.api.generate.estimate({ targetSize }).then(res => setEstimate(res?.estimated));
  }, [targetSize]);

  useEffect(() => {
    window.api.onProgress((data) => {
      dispatch({ type: 'ADD_PROGRESS', entry: data });
    });
  }, []);

  const hasAnalysis = analysis.status === 'ready' && analysis.clusters;
  const isRunning = generate.status === 'running';

  const handleGenerate = async () => {
    if (!hasAnalysis) return;
    dispatch({ type: 'SET_GENERATE', payload: { status: 'running', progress: [], result: null, error: null } });

    const result = await window.api.generate.run({
      playlistName: playlistName.trim() || defaultName,
      targetSize,
      includeFamiliar,
      clusterBias
    });

    if (result.success) {
      dispatch({ type: 'SET_GENERATE', payload: { status: 'done', result } });
      const lastPlaylist = await window.api.store.get('lastPlaylist');
      dispatch({ type: 'SET_MISC', payload: { lastPlaylist } });
    } else {
      dispatch({ type: 'SET_GENERATE', payload: { status: 'error', error: result.error } });
    }
  };

  const setBias = (id, val) => setClusterBias(prev => ({ ...prev, [id]: parseFloat(val) }));

  return (
    <>
      <h1 className="page-title">Generate</h1>
      <p className="page-subtitle">Configure and create your personalized discovery playlist.</p>

      {!hasAnalysis && (
        <div className="notice warn">
          Run <strong>Analyze</strong> first to build your taste profile before generating.
        </div>
      )}

      {generate.error && <div className="notice error">{generate.error}</div>}

      <div className="card">
        <div className="card-title">Playlist Options</div>
        <div className="generate-form">
          <div className="field">
            <label>Playlist Name</label>
            <input
              type="text"
              value={playlistName}
              onChange={e => setPlaylistName(e.target.value)}
              disabled={isRunning}
              placeholder={defaultName}
            />
          </div>

          <div className="field">
            <label>Song Count</label>
            <div className="slider-row">
              <input
                type="range"
                min={50} max={500} step={25}
                value={targetSize}
                onChange={e => setTargetSize(Number(e.target.value))}
                disabled={isRunning}
                style={{ flex: 1 }}
              />
              <span className="slider-val">{targetSize}</span>
            </div>
          </div>

          <div className="field">
            <div className="toggle-row">
              <span>Include Familiar Songs</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={includeFamiliar}
                  onChange={e => setIncludeFamiliar(e.target.checked)}
                  disabled={isRunning}
                />
                <div className="toggle-track" />
                <div className="toggle-thumb" />
              </label>
            </div>
            <p className="text-muted text-sm mt-8">Off = skip songs already in your liked library</p>
          </div>

          {estimate != null && (
            <div className="budget-estimate">
              Estimated API calls: <span>~{estimate}</span>
            </div>
          )}
        </div>
      </div>

      {hasAnalysis && analysis.clusters && (
        <div className="card">
          <div className="card-title">Mood Bias (optional)</div>
          <p className="text-muted text-sm" style={{ marginBottom: 14 }}>Drag to weight clusters heavier (right) or lighter (left).</p>
          <div className="bias-grid">
            {analysis.clusters.map(c => (
              <div className="field bias-item" key={c.id}>
                <label>{c.emoji} {c.label}</label>
                <div className="slider-row">
                  <input
                    type="range"
                    min={0.1} max={3.0} step={0.1}
                    value={clusterBias[c.id] ?? 1.0}
                    onChange={e => setBias(c.id, e.target.value)}
                    disabled={isRunning}
                    style={{ flex: 1 }}
                  />
                  <span className="slider-val" style={{ fontSize: 12 }}>
                    {(clusterBias[c.id] ?? 1.0).toFixed(1)}×
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Progress</div>
        <ProgressLog entries={generate.progress} />
        <div style={{ marginTop: 14 }}>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={!hasAnalysis || isRunning || auth.status !== 'connected'}
          >
            {isRunning ? 'Generating...' : 'Generate Playlist'}
          </button>
          {auth.status !== 'connected' && (
            <span className="text-muted text-sm" style={{ marginLeft: 12 }}>Requires Spotify connection.</span>
          )}
        </div>
      </div>

      {generate.status === 'done' && generate.result && (
        <div className="card result-panel">
          <div className="card-title">Result</div>
          <div className="result-playlist-name">{generate.result.playlistName}</div>
          <div className="result-track-count">{generate.result.trackCount} tracks added</div>

          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Mood</th><th>Quota</th><th>Filled</th>
              </tr>
            </thead>
            <tbody>
              {generate.result.breakdown?.map(row => (
                <tr key={row.clusterId}>
                  <td>{row.emoji} {row.label}</td>
                  <td>{row.quota}</td>
                  <td>{row.filled}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {generate.result.topArtists?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="card-title">Top Discovered Artists</div>
              <div className="artists-list">
                {generate.result.topArtists.map(a => (
                  <div key={a.name} className="artist-chip">{a.name}</div>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn-primary"
            onClick={() => window.api.openExternal(generate.result.playlistUrl)}
          >
            Open in Spotify
          </button>
        </div>
      )}
    </>
  );
}
