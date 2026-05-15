import React, { useState } from 'react';
import RadarChart from './RadarChart';
import ClusterCard from './ClusterCard';
import ProgressLog from './ProgressLog';

const FEATURE_NAMES = ['energy', 'danceability', 'valence', 'acousticness', 'instrumentalness', 'liveness', 'speechiness', 'loudness', 'tempo'];

export default function AnalyzePage() {
  const [folderPath, setFolderPath] = useState('');
  const [parseResult, setParseResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [logLines, setLogLines] = useState([]);

  async function loadPath(apiCall) {
    const result = await apiCall();
    if (result.canceled) return;
    setFolderPath(result.path);
    setParseResult(null);
    setAnalysisResult(null);
    const parsed = await window.electronAPI.parseExport(result.path);
    setParseResult(parsed);
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setLogLines([]);
    setAnalysisResult(null);

    window.electronAPI.removeProgressLog();
    window.electronAPI.onProgressLog(line => setLogLines(prev => [...prev, line]));

    const result = await window.electronAPI.analyzeFingerprint();
    setAnalyzing(false);
    setAnalysisResult(result);
  }

  return (
    <div>
      <h1>Analyze Your Taste</h1>
      <p style={{ marginBottom: 24 }}>Load your Spotify data export to build your audio fingerprint.</p>

      <div className="card">
        <h2>Step 1 — Load Spotify Export</h2>
        <p style={{ marginBottom: 16 }}>
          Select your Spotify data export — either the unzipped folder or the original .zip file.
          The app will search all subfolders automatically.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => loadPath(window.electronAPI.pickFolder)}>
            📁 Choose Folder
          </button>
          <button className="btn btn-secondary" onClick={() => loadPath(window.electronAPI.pickZip)}>
            🗜 Choose .zip File
          </button>
        </div>
        {folderPath && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{folderPath}</div>
        )}

        {parseResult && !parseResult.error && (
          <div style={{ marginTop: 16 }}>
            <div className="notice notice-info">
              Detected: <strong>{parseResult.mode}</strong> · {parseResult.trackCount} weighted tracks
              {parseResult.likedCount > 0 && ` · ${parseResult.likedCount} liked songs`}
              {parseResult.dateRange && ` · ${new Date(parseResult.dateRange.from).toLocaleDateString()} – ${new Date(parseResult.dateRange.to).toLocaleDateString()}`}
            </div>
            {parseResult.warning && <div className="notice notice-warn">{parseResult.warning}</div>}
          </div>
        )}
        {parseResult?.error && <div className="notice notice-error" style={{ marginTop: 12 }}>{parseResult.error}</div>}
      </div>

      <div className="card">
        <h2>Step 2 — Analyze My Taste</h2>
        <p style={{ marginBottom: 16 }}>Fetches live Spotify + Last.fm data, resolves track IDs, fetches audio features, and runs K-means clustering.</p>
        <button
          className="btn btn-primary"
          disabled={analyzing || (!parseResult && !folderPath)}
          onClick={runAnalysis}
        >
          {analyzing ? '⏳ Analyzing...' : '▶ Analyze My Taste'}
        </button>

        {(analyzing || logLines.length > 0) && (
          <div style={{ marginTop: 16 }}>
            <ProgressLog lines={logLines} />
          </div>
        )}
      </div>

      {analysisResult?.ok && (
        <>
          <div className="card">
            <h2>Your Music Fingerprint</h2>

            {!analysisResult.audioFeaturesAvailable ? (
              <>
                <div className="notice notice-warn" style={{ marginBottom: 16 }}>
                  Spotify's audio features endpoint (energy, danceability, etc.) is restricted for this app —
                  this is a Spotify API policy for newer apps. Playlists still generate using your listening
                  history. The radar chart requires a Spotify app with extended API access.
                </div>
                <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tracks Analysed</div>
                    <div className="taste-score">{analysisResult.clusters?.reduce((s, c) => s + c.trackCount, 0)}</div>
                    <div className="taste-score-label">from your history</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Artists</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[...new Set(
                        (analysisResult.clusters?.[0]?.topTracks || []).map(t => t.artistName)
                      )].slice(0, 5).map((a, i) => (
                        <div key={i} style={{ fontSize: 13, color: '#ccc' }}>{a}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="fingerprint-panel">
                <div>
                  <div className="taste-score">{analysisResult.fingerprint?.tasteScore}</div>
                  <div className="taste-score-label">Taste Score</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4, maxWidth: 200 }}>
                    Energy×30 + Dance×25 + Valence×20 + Acoustic×15 + Instrumental×10
                  </div>
                </div>
                <RadarChart avg={analysisResult.fingerprint?.avg || {}} std={analysisResult.fingerprint?.std || {}} />
                <div style={{ flex: 1 }}>
                  <div className="feature-list">
                    {FEATURE_NAMES.map(f => {
                      const val = analysisResult.fingerprint?.avg?.[f] || 0;
                      return (
                        <div key={f} className="feature-row">
                          <span className="feature-name" style={{ textTransform: 'capitalize' }}>{f}</span>
                          <div className="feature-bar-bg">
                            <div className="feature-bar-fill" style={{ width: `${val * 100}%` }} />
                          </div>
                          <span className="feature-val">{val.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {analysisResult.liveDataSummary && (
              <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
                Live data merged: {analysisResult.liveDataSummary.spotifyTopTracks} Spotify top tracks,{' '}
                {analysisResult.liveDataSummary.spotifyRecent} recently played,{' '}
                {analysisResult.liveDataSummary.lastfmTracks} Last.fm tracks
              </div>
            )}
          </div>

          <h2>Taste Clusters</h2>
          <div className="card-grid">
            {(analysisResult.clusters || []).map(cluster => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        </>
      )}

      {analysisResult && !analysisResult.ok && (
        <div className="notice notice-error">{analysisResult.error}</div>
      )}
    </div>
  );
}
