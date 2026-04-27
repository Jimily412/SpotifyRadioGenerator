const crypto = require('crypto');
const axios = require('axios');
const { store } = require('./store');

const SCOPES = [
  'user-library-read',
  'user-read-recently-played',
  'user-top-read',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-private'
].join(' ');

function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeVerifier() {
  return base64url(crypto.randomBytes(64));
}

function generateCodeChallenge(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64url(hash);
}

function getAuthUrl() {
  const creds = store.get('credentials.spotify');
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  store.set('auth.codeVerifier', verifier);

  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: 'code',
    redirect_uri: creds.redirectUri,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: crypto.randomBytes(16).toString('hex')
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const creds = store.get('credentials.spotify');
  const verifier = store.get('auth.codeVerifier');
  if (!verifier) throw new Error('No code verifier stored — restart auth flow');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: creds.redirectUri,
    client_id: creds.clientId,
    code_verifier: verifier
  });

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;
  store.set('auth.accessToken', access_token);
  store.set('auth.refreshToken', refresh_token);
  store.set('auth.expiresAt', Date.now() + (expires_in - 60) * 1000);
  store.set('auth.codeVerifier', null);
  return access_token;
}

async function refreshAccessToken() {
  const creds = store.get('credentials.spotify');
  const refreshToken = store.get('auth.refreshToken');
  if (!refreshToken) throw new Error('No refresh token stored');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.clientId
  });

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;
  store.set('auth.accessToken', access_token);
  if (refresh_token) store.set('auth.refreshToken', refresh_token);
  store.set('auth.expiresAt', Date.now() + (expires_in - 60) * 1000);
  return access_token;
}

async function getValidToken() {
  const accessToken = store.get('auth.accessToken');
  if (!accessToken) return null;

  const expiresAt = store.get('auth.expiresAt', 0);
  if (Date.now() >= expiresAt) {
    try {
      return await refreshAccessToken();
    } catch {
      store.set('auth.accessToken', null);
      store.set('auth.refreshToken', null);
      store.set('auth.expiresAt', 0);
      return null;
    }
  }

  return accessToken;
}

function clearAuth() {
  store.set('auth.accessToken', null);
  store.set('auth.refreshToken', null);
  store.set('auth.expiresAt', 0);
  store.set('auth.displayName', null);
  store.set('auth.userId', null);
  store.set('auth.codeVerifier', null);
}

async function handleOAuthCallback(url, mainWindow) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    if (error || !code) {
      mainWindow?.webContents.send('auth:status', {
        type: 'error',
        message: error || 'No authorization code received'
      });
      return;
    }

    await exchangeCodeForTokens(code);

    const SpotifyWebApi = require('spotify-web-api-node');
    const api = new SpotifyWebApi();
    api.setAccessToken(store.get('auth.accessToken'));
    const me = await api.getMe();
    const displayName = me.body.display_name || me.body.id;
    store.set('auth.displayName', displayName);
    store.set('auth.userId', me.body.id);

    mainWindow?.webContents.send('auth:status', {
      type: 'connected',
      displayName
    });
  } catch (err) {
    mainWindow?.webContents.send('auth:status', {
      type: 'error',
      message: err.message
    });
  }
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getValidToken,
  clearAuth,
  refreshAccessToken
};
