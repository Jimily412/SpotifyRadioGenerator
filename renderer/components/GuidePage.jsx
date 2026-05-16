import React, { useState } from 'react';

function Section({ title, icon, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="guide-section">
      <div className="guide-section-header" onClick={() => setOpen(o => !o)}>
        <span className="guide-section-icon">{icon}</span>
        <span className="guide-section-title">{title}</span>
        <span className="guide-section-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </div>
      {open && <div className="guide-section-body">{children}</div>}
    </div>
  );
}

function Step({ num, children }) {
  return (
    <div className="guide-step">
      <div className="guide-step-num">{num}</div>
      <div className="guide-step-text">{children}</div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div>
      <div className="page-header">
        <div className="page-title">Guide</div>
        <div className="page-subtitle">How to get the most out of TasteEngine.</div>
      </div>

      <Section title="How TasteEngine Works" icon="⚙️">
        <p style={{ marginBottom: 16 }}>
          TasteEngine builds a taste fingerprint from your listening history, groups your music into mood clusters,
          then uses Last.fm similarity data to find artists and tracks you haven't heard yet.
        </p>
        <div className="guide-flow">
          {[
            { step: '1', label: 'Analyze', desc: 'Pulls your top tracks, recent plays, Last.fm scrobbles, and optional Spotify export data.' },
            { step: '2', label: 'Cluster', desc: 'Groups your music into up to 6 mood clusters: Hype, Chill, Feel Good, Dark/Moody, Focus, and Mixed.' },
            { step: '3', label: 'Harvest', desc: 'For each cluster, finds similar artists via Last.fm and fetches their top tracks.' },
            { step: '4', label: 'Preview', desc: 'Shows you the full track list. Remove anything you don\'t want before pushing.' },
            { step: '5', label: 'Push', desc: 'Creates the playlist in your Spotify account with one click.' },
          ].map(f => (
            <div key={f.step} className="guide-flow-step">
              <div className="guide-flow-num">{f.step}</div>
              <div>
                <div className="guide-flow-label">{f.label}</div>
                <div className="guide-flow-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Setting Up Last.fm" icon="🔴">
        <div className="notice notice-info" style={{ marginBottom: 20 }}>
          Last.fm is the single biggest improvement you can make to recommendation quality.
          It gives TasteEngine access to a massive similarity graph — without it, discovery is limited to Spotify's data alone.
        </div>

        <Step num={1}>
          Create a free account at{' '}
          <button className="guide-link" onClick={() => window.electronAPI.openExternal('https://www.last.fm/join')}>
            last.fm/join ↗
          </button>
          . It only takes 30 seconds.
        </Step>
        <Step num={2}>
          Go to{' '}
          <button className="guide-link" onClick={() => window.electronAPI.openExternal('https://www.last.fm/settings/applications')}>
            Last.fm → Settings → Applications ↗
          </button>
          {' '}and connect your Spotify account. This enables "scrobbling" — Last.fm will automatically log every song
          you play on Spotify. The longer you scrobble, the better TasteEngine gets.
        </Step>
        <Step num={3}>
          Open TasteEngine → Settings and enter your Last.fm username. That's it.
        </Step>
        <Step num={4}>
          Run <strong>Analyze</strong> again after connecting. TasteEngine will merge your Last.fm history with your
          Spotify data on the next run.
        </Step>

        <div className="notice notice-info" style={{ marginTop: 20 }}>
          <strong>Already have an old Last.fm account?</strong> Connect it — even years of old scrobbles from other
          services count and significantly improve clustering accuracy.
        </div>
      </Section>

      <Section title="Spotify Data Export" icon="📦">
        <p style={{ marginBottom: 20 }}>
          Spotify can export your personal data as a ZIP file. TasteEngine reads this to access listening history
          that the Spotify API doesn't expose. There are two packages you can request — they're very different:
        </p>

        <div className="guide-package-grid">
          <div className="guide-package">
            <div className="guide-package-label">Basic Account Data</div>
            <div className="guide-package-time">Ready in 2–5 days</div>
            <ul className="guide-package-list">
              <li>Last ~12 months of streaming history</li>
              <li>Your playlists and saved albums</li>
              <li>Profile and account info</li>
              <li>Followed artists</li>
            </ul>
            <div className="guide-package-verdict verdict-good">Good starting point</div>
          </div>
          <div className="guide-package guide-package-featured">
            <div className="guide-package-label">Extended Streaming History</div>
            <div className="guide-package-time">Takes up to 30 days</div>
            <ul className="guide-package-list">
              <li><strong>Complete history since account creation</strong></li>
              <li>Every play ever logged (multiple files)</li>
              <li>Platform, skip data, shuffle status</li>
              <li>All of the above plus more detail</li>
            </ul>
            <div className="guide-package-verdict verdict-best">Best results — request this one</div>
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 24 }}>How to request your data</div>
        <Step num={1}>
          Go to{' '}
          <button className="guide-link" onClick={() => window.electronAPI.openExternal('https://www.spotify.com/account/privacy/')}>
            Spotify Privacy Settings ↗
          </button>
          {' '}(you'll need to log in to Spotify in your browser).
        </Step>
        <Step num={2}>
          Scroll down to <strong>Download your data</strong>. You'll see two checkboxes.
          Check <strong>Extended streaming history</strong> for the full dataset (recommended),
          or just the first checkbox for the basic package.
        </Step>
        <Step num={3}>
          Click <strong>Request data</strong> and confirm via the email Spotify sends you.
          Spotify will email you a download link when your data is ready.
        </Step>
        <Step num={4}>
          Download the ZIP file and keep it somewhere you can find it. Do <em>not</em> unzip it —
          TasteEngine reads the ZIP directly.
        </Step>
        <Step num={5}>
          In TasteEngine, go to <strong>Analyze → Load Spotify Export</strong> and select the ZIP file.
          Then run Analyze again to incorporate the data.
        </Step>

        <div className="notice notice-info" style={{ marginTop: 16 }}>
          <strong>Already requested but only got basic data?</strong> You can request the extended history separately
          at any time from the same page. Both can coexist — TasteEngine merges them automatically.
        </div>
      </Section>

      <Section title="Tips for Better Playlists" icon="💡">
        <div className="guide-tip-list">
          {[
            {
              title: 'Use the Mood Bias sliders',
              desc: 'On the Generate page, drag cluster weights to customize the vibe. Want a workout playlist? Boost Hype to 3× and drop Chill to 0×.',
            },
            {
              title: 'Run Analyze before generating',
              desc: 'Analyze caches your data for the session. If it\'s been a few days or you\'ve added new Last.fm scrobbles, run it again to refresh.',
            },
            {
              title: 'Use the preview to curate',
              desc: 'After building, scroll the track list and remove anything that doesn\'t fit the vibe before pushing to Spotify.',
            },
            {
              title: 'Try "Include familiar songs" for comfort playlists',
              desc: 'By default, TasteEngine excludes tracks already in your library. Toggle this on if you want a mix of favorites and new discoveries.',
            },
            {
              title: 'Longer Last.fm history = better clusters',
              desc: 'The more scrobbles you have, the more accurately TasteEngine can separate your listening into distinct moods.',
            },
          ].map((tip, i) => (
            <div key={i} className="guide-tip">
              <div className="guide-tip-title">{tip.title}</div>
              <div className="guide-tip-desc">{tip.desc}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
