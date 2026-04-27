const crypto = require('crypto');
const { shell } = require('electron');
const axios = require('axios');
const { getStore } = require('./store');

const SCOPES = [
  'user-library-read',
  'user-read-recently-played',
  'user-top-read',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-private',
].join(' ');

let pendingVerifier = null;
let authTimeoutTimer = null;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function getCredentials() {
  const store = getStore();
  return store.get('credentials.spotify');
}

function buildAuthUrl(challenge) {
  const creds = getCredentials();
  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: 'code',
    redirect_uri: creds.redirectUri,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCode(code, verifier) {
  const creds = getCredentials();
  const resp = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: creds.redirectUri,
      client_id: creds.clientId,
      code_verifier: verifier,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return resp.data;
}

async function refreshAccessToken() {
  const store = getStore();
  const tokens = store.get('tokens');
  if (!tokens || !tokens.refresh_token) return null;
  const creds = getCredentials();
  const resp = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: creds.clientId,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const data = resp.data;
  const newTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  store.set('tokens', newTokens);
  return newTokens;
}

async function checkAndRefreshToken(mainWindow) {
  const store = getStore();
  const tokens = store.get('tokens');
  if (!tokens || !tokens.access_token) return;
  if (Date.now() >= (tokens.expires_at || 0) - 60000) {
    try {
      const refreshed = await refreshAccessToken();
      if (refreshed && mainWindow) {
        const profile = await fetchProfile(refreshed.access_token);
        mainWindow.webContents.send('auth-success', { displayName: profile.display_name });
      }
    } catch (err) {
      console.error('Token refresh failed on launch:', err.message);
    }
  } else if (mainWindow) {
    try {
      const profile = await fetchProfile(tokens.access_token);
      mainWindow.webContents.send('auth-success', { displayName: profile.display_name });
    } catch (_) {}
  }
}

async function fetchProfile(accessToken) {
  const resp = await axios.get('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return resp.data;
}

function startOAuth(mainWindow) {
  const { verifier, challenge } = generatePKCE();
  pendingVerifier = verifier;
  const url = buildAuthUrl(challenge);
  shell.openExternal(url);

  if (authTimeoutTimer) clearTimeout(authTimeoutTimer);
  authTimeoutTimer = setTimeout(() => {
    pendingVerifier = null;
    mainWindow && mainWindow.webContents.send('auth-error', 'Auth timed out — try again');
  }, 3 * 60 * 1000);
}

async function handleProtocolCallback(url, mainWindow) {
  if (authTimeoutTimer) { clearTimeout(authTimeoutTimer); authTimeoutTimer = null; }

  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    if (error) {
      mainWindow && mainWindow.webContents.send('auth-error', `Spotify auth error: ${error}`);
      return;
    }
    if (!code || !pendingVerifier) {
      mainWindow && mainWindow.webContents.send('auth-error', 'Invalid callback — missing code or verifier');
      return;
    }

    const tokenData = await exchangeCode(code, pendingVerifier);
    pendingVerifier = null;

    const store = getStore();
    store.set('tokens', {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    });

    const profile = await fetchProfile(tokenData.access_token);
    mainWindow && mainWindow.webContents.send('auth-success', { displayName: profile.display_name });
  } catch (err) {
    pendingVerifier = null;
    mainWindow && mainWindow.webContents.send('auth-error', err.message);
  }
}

function getValidAccessToken() {
  const store = getStore();
  const tokens = store.get('tokens');
  if (!tokens || !tokens.access_token) return null;
  return tokens.access_token;
}

async function getValidAccessTokenOrRefresh() {
  const store = getStore();
  const tokens = store.get('tokens');
  if (!tokens || !tokens.access_token) return null;
  if (Date.now() >= (tokens.expires_at || 0) - 60000) {
    const refreshed = await refreshAccessToken();
    return refreshed ? refreshed.access_token : null;
  }
  return tokens.access_token;
}

function clearTokens() {
  const store = getStore();
  store.set('tokens', {});
}

module.exports = {
  startOAuth,
  handleProtocolCallback,
  checkAndRefreshToken,
  getValidAccessToken,
  getValidAccessTokenOrRefresh,
  clearTokens,
};
