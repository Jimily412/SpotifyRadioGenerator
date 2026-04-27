import React, { useState } from 'react';
import { useApp } from '../App';
import RadarChart from './RadarChart';
import ClusterCard from './ClusterCard';
import ProgressLog from './ProgressLog';

export default function AnalyzePage() {
  const { state, dispatch } = useApp();
  const { analysis, auth } = state;
  const [analyzeProgress, setAnalyzeProgress] = useState([]);

  const handlePickFolder = async () => {
    const folderPath = await window.api.data.pickFolder();
    if (!folderPath) return;

    dispatch({ type: 'SET_ANALYSIS', payload: { status: 'loading', error: null, warning: null } });
    const result = await window.api.data.loadFolder(folderPath);
    if (result.success) {
      dispatch({
        type: 'SET_ANALYSIS',
        payload: {
          status: 'loaded',
          folderPath,
          mode: result.mode,
          trackCount: result.trackCount,
          dateRange: result.dateRange,
          likedCount: result.likedCount || 0,
          warning: result.warning || null,
          fingerprint: null,
          clusters: null
        }
      });
    } else {
      dispatch({ type: 'SET_ANALYSIS', payload: { status: 'error', error: result.error } });
    }
  };

  const handleAnalyze = async () => {
    if (auth.status !== 'connected') {
      dispatch({ type: 'SET_ANALYSIS', payload: { error: 'Please connect Spotify first', status: 'loaded' } });
      return;
    }

    setAnalyzeProgress([]);
    dispatch({ type: 'SET_ANALYSIS', payload: { status: 'analyzing', error: null } });

    window.api.onProgress((data) => {
      setAnalyzeProgress(prev => [...prev, data]);
    });

    const result = await window.api.data.analyze();

    if (result.success) {
      dispatch({
        type: 'SET_ANALYSIS',
        payload: {
          status: 'ready',
          fingerprint: result.fingerprint,
          clusters: result.clusters,
          liveDataSummary: result.liveDataSummary,
          error: null
        }
      });
    } else {
      dispatch({ type: 'SET_ANALYSIS', payload: { status: 'error', error: result.error } });
    }
  };

  const isLoaded = analysis.status === 'loaded' || analysis.status === 'analyzing' || analysis.status === 'ready';
  const isAnalyzing = analysis.status === 'analyzing';
  const hasResults = analysis.status === 'ready' && analysis.fingerprint;

  return (
    <>
      <h1 className="page-title">Analyze</h1>
      <p className="page-subtitle">Load your Spotify data export and build your music fingerprint.</p>

      {analysis.error && <div className="notice error">{analysis.error}</div>}

      <div className="card analyze-section">
        <div className="card-title">Step 1 — Load Spotify Export</div>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
          Request your Spotify data at spotify.com/account/privacy. Select the folder containing
          StreamingHistory_music_*.json and/or YourLibrary.json files.
        </p>
        {analysis.folderPath && (
          <div className="folder-display">{analysis.folderPath}</div>
        )}
        {analysis.warning && <div className="notice warn">{analysis.warning}</div>}
        {isLoaded && (
          <div style={{ marginBottom: 12 }}>
            <span className="mode-badge">
              {analysis.mode === 'full' ? 'Full Export' : 'Streaming History Only'}
            </span>
            <div className="data-stats">
              <div className="data-stat">
                <span className="data-stat-val">{analysis.trackCount?.toLocaleString()}</span>
                <span className="data-stat-label"> weighted tracks</span>
              </div>
              {analysis.likedCount > 0 && (
                <div className="data-stat">
                  <span className="data-stat-val">{analysis.likedCount?.toLocaleString()}</span>
                  <span className="data-stat-label"> liked songs</span>
                </div>
              )}
              {analysis.dateRange && (
                <div className="data-stat">
                  <span className="data-stat-val">
                    {new Date(analysis.dateRange.from).getFullYear()}–{new Date(analysis.dateRange.to).getFullYear()}
                  </span>
                  <span className="data-stat-label"> history</span>
                </div>
              )}
            </div>
          </div>
        )}
        <button className="btn-secondary" onClick={handlePickFolder} disabled={isAnalyzing}>
          {analysis.folderPath ? 'Change Folder' : 'Load My Spotify Data'}
        </button>
      </div>

      <div className="card analyze-section">
        <div className="card-title">Step 2 — Analyze My Taste</div>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
          Resolves tracks, fetches audio features, merges live Spotify & Last.fm data, then runs K-means clustering.
        </p>
        {isAnalyzing && (
          <div style={{ marginBottom: 12 }}>
            <ProgressLog entries={analyzeProgress} />
          </div>
        )}
        <button
          className="btn-primary"
          onClick={handleAnalyze}
          disabled={!isLoaded || isAnalyzing || auth.status !== 'connected'}
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze My Taste'}
        </button>
        {auth.status !== 'connected' && (
          <p className="text-muted text-sm mt-8">Requires Spotify connection.</p>
        )}
      </div>

      {hasResults && (
        <>
          <div className="card">
            <div className="card-title">Music Fingerprint</div>
            <div className="fingerprint-panel">
              <div className="card taste-score-box">
                <div className="taste-score-val">{analysis.fingerprint.tasteScore}</div>
                <div className="taste-score-label">Taste Score</div>
                <div className="taste-score-legend">
                  <div><span>Energy</span><span>×30</span></div>
                  <div><span>Danceability</span><span>×25</span></div>
                  <div><span>Valence</span><span>×20</span></div>
                  <div><span>Acousticness</span><span>×15</span></div>
                  <div><span>Instrumental</span><span>×10</span></div>
                </div>
              </div>
              <div className="radar-wrapper">
                <RadarChart data={analysis.fingerprint.avg} size={280} />
              </div>
            </div>
          </div>

          {analysis.liveDataSummary && (
            <div className="card">
              <div className="card-title">Live Data Merged</div>
              <div className="live-summary">
                <div className="live-chip">Spotify top tracks: <span>{analysis.liveDataSummary.spotifyTopCount}</span></div>
                <div className="live-chip">Last.fm tracks: <span>{analysis.liveDataSummary.lastfmCount}</span></div>
                {analysis.liveDataSummary.lastfmError && (
                  <div className="notice warn">Last.fm: {analysis.liveDataSummary.lastfmError}</div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="card-title" style={{ marginBottom: 14 }}>Taste Clusters</div>
            <div className="cluster-grid">
              {analysis.clusters.map(c => <ClusterCard key={c.id} cluster={c} />)}
            </div>
          </div>
        </>
      )}
    </>
  );
}
