import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/main.css';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import AnalyzePage from './components/AnalyzePage';
import GeneratePage from './components/GeneratePage';
import SettingsPage from './components/SettingsPage';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const initial = {
  page: 'home',
  auth: { status: 'unknown', displayName: null },
  analysis: {
    folderPath: null,
    mode: null,
    trackCount: 0,
    dateRange: null,
    likedCount: 0,
    fingerprint: null,
    clusters: null,
    liveDataSummary: null,
    status: 'idle',
    error: null,
    warning: null
  },
  generate: { status: 'idle', progress: [], result: null, error: null },
  update: { available: false, downloaded: false },
  lastfmLastSync: null,
  lastPlaylist: null
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_PAGE': return { ...state, page: action.page };
    case 'SET_AUTH': return { ...state, auth: { ...state.auth, ...action.payload } };
    case 'SET_ANALYSIS': return { ...state, analysis: { ...state.analysis, ...action.payload } };
    case 'SET_GENERATE': return { ...state, generate: { ...state.generate, ...action.payload } };
    case 'ADD_PROGRESS': return { ...state, generate: { ...state.generate, progress: [...state.generate.progress, action.entry] } };
    case 'SET_UPDATE': return { ...state, update: { ...state.update, ...action.payload } };
    case 'SET_MISC': return { ...state, ...action.payload };
    default: return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    (async () => {
      const status = await window.api.spotify.getStatus();
      dispatch({ type: 'SET_AUTH', payload: status.connected ? { status: 'connected', displayName: status.displayName } : { status: 'disconnected' } });

      const lastPlaylist = await window.api.store.get('lastPlaylist');
      const lastfmLastSync = await window.api.store.get('lastfmLastSync');
      dispatch({ type: 'SET_MISC', payload: { lastPlaylist, lastfmLastSync } });
    })();

    window.api.onAuthStatus((data) => {
      if (data.type === 'connected') {
        dispatch({ type: 'SET_AUTH', payload: { status: 'connected', displayName: data.displayName } });
      } else if (data.type === 'error') {
        dispatch({ type: 'SET_AUTH', payload: { status: 'error', error: data.message } });
      } else if (data.type === 'timeout') {
        dispatch({ type: 'SET_AUTH', payload: { status: 'timeout' } });
      }
    });

    window.api.onUpdateStatus((data) => {
      if (data.type === 'available') dispatch({ type: 'SET_UPDATE', payload: { available: true } });
      if (data.type === 'downloaded') dispatch({ type: 'SET_UPDATE', payload: { downloaded: true } });
    });

    window.api.onProgress((data) => {
      dispatch({ type: 'ADD_PROGRESS', entry: data });
    });
  }, []);

  const navigate = useCallback((page) => dispatch({ type: 'SET_PAGE', page }), []);

  const pages = { home: HomePage, analyze: AnalyzePage, generate: GeneratePage, settings: SettingsPage };
  const PageComponent = pages[state.page] || HomePage;

  return (
    <AppContext.Provider value={{ state, dispatch, navigate }}>
      <div className="app">
        <Sidebar />
        <main className="content">
          {state.update.downloaded && (
            <div className="update-banner">
              <span>Update ready to install</span>
              <button onClick={() => window.api.updates.install()}>Restart & Update</button>
            </div>
          )}
          {state.update.available && !state.update.downloaded && (
            <div className="update-banner">
              <span>Downloading update in background...</span>
            </div>
          )}
          <PageComponent />
        </main>
      </div>
    </AppContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
