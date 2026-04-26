#!/usr/bin/env python3
"""
Spotify Radio Generator

Generates a large (150-200 track) personalized cross-genre discovery playlist
by clustering your listening history into audio-feature-based "taste moods" and
seeding Spotify recommendations from each cluster proportionally.

Usage:
    python generate_playlist.py --data-dir ./my_spotify_data --size 175
    python generate_playlist.py --data-dir ./my_spotify_data.zip --size 175
    python generate_playlist.py --data-dir ./my_spotify_data --size 200 --clusters 8
"""

import argparse
import fnmatch
import json
import logging
import math
import os
import queue
import random
import requests
import sys
import threading
import time
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlparse

import numpy as np
import spotipy
from sklearn.cluster import KMeans
from spotipy.oauth2 import SpotifyOAuth

# ── Constants ──────────────────────────────────────────────────────────────────

# Feature order is fixed; the same order is used throughout for vectors/centroids.
AUDIO_FEATURES = [
    "danceability",
    "energy",
    "valence",
    "tempo",            # stored normalized 0-1 everywhere except API calls
    "acousticness",
    "instrumentalness",
    "speechiness",
]

# Tempo normalization bounds (covers >99% of popular music)
TEMPO_MIN = 60.0
TEMPO_MAX = 200.0
TEMPO_RANGE = TEMPO_MAX - TEMPO_MIN

CONFIG_FILE = "config.json"
CACHE_FILE = ".spotify_cache"
# 127.0.0.1 avoids Chrome/Edge HSTS upgrades that break http://localhost redirects
REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPE = (
    "user-library-read "
    "playlist-modify-private "
    "playlist-modify-public "
    "user-top-read"
)


# ── Logging ────────────────────────────────────────────────────────────────────

def _build_logger() -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    # Keep third-party loggers quiet
    for noisy in ("spotipy", "urllib3", "requests"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return logging.getLogger("radio_gen")


LOG = _build_logger()


# ── Queue log handler (used by run_pipeline to route logs to the GUI) ──────────

class _QueueLogHandler(logging.Handler):
    """Forwards log records into a queue.Queue so the GUI thread can consume them."""
    def __init__(self, q: queue.Queue) -> None:
        super().__init__()
        self.q = q

    def emit(self, record: logging.LogRecord) -> None:
        self.q.put(("log", record.levelname, self.format(record)))


# ── Features cache (avoids re-fetching audio features on every run) ────────────

_FEATURES_CACHE_FILE = ".audio_features_cache.json"


def _load_features_cache() -> Dict[str, dict]:
    if os.path.exists(_FEATURES_CACHE_FILE):
        try:
            with open(_FEATURES_CACHE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_features_cache(cache: Dict[str, dict]) -> None:
    with open(_FEATURES_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f)


# ── Config ────────────────────────────────────────────────────────────────────

def load_or_create_config() -> dict:
    """Load credentials from config.json, or prompt user and save them."""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        if cfg.get("client_id") and cfg.get("client_secret"):
            return cfg

    print("\n=== Spotify API Configuration ===")
    cfg = {
        "client_id": input("Spotify Client ID: ").strip(),
        "client_secret": input("Spotify Client Secret: ").strip(),
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print(f"Saved to {CONFIG_FILE}\n")
    return cfg


def _make_auth(config: dict) -> SpotifyOAuth:
    return SpotifyOAuth(
        client_id=config["client_id"],
        client_secret=config["client_secret"],
        redirect_uri=REDIRECT_URI,
        scope=SCOPE,
        cache_path=CACHE_FILE,
        open_browser=False,
    )


def check_token(config: dict) -> bool:
    """Return True if a valid (or auto-refreshable) token exists in the cache."""
    auth = _make_auth(config)
    return auth.validate_token(auth.cache_handler.get_cached_token()) is not None


def get_auth_url(config: dict) -> str:
    """Return the Spotify OAuth authorization URL for the manual-paste flow."""
    return _make_auth(config).get_authorize_url()


def complete_auth(config: dict, redirect_url: str) -> None:
    """Exchange a redirect URL (containing ?code=…) for an access token."""
    code = parse_qs(urlparse(redirect_url).query).get("code", [None])[0]
    if not code:
        raise ValueError(
            "No authorization code found in that URL. "
            "Make sure you copied the full redirect URL from the browser address bar."
        )
    _make_auth(config).get_access_token(code)


# ── Resilient Spotify calls ───────────────────────────────────────────────────

def spotify_retry(fn, *args, max_retries: int = 6, **kwargs):
    """
    Call fn(*args, **kwargs) with exponential backoff on 429/5xx errors.
    Respects Spotify's Retry-After header when present.
    """
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
        except spotipy.exceptions.SpotifyException as exc:
            if exc.http_status == 429:
                # Honour the header; fall back to exponential backoff
                retry_after = int(
                    (getattr(exc, "headers", None) or {}).get("Retry-After", 2 ** attempt)
                )
                LOG.warning(f"Rate limited — sleeping {retry_after}s (attempt {attempt + 1})")
                time.sleep(retry_after)
            elif exc.http_status in (500, 502, 503, 504):
                wait = 2 ** attempt
                LOG.warning(f"Spotify {exc.http_status} — retrying in {wait}s")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Spotify API call failed after {max_retries} retries")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Parse & weight listening data
# ══════════════════════════════════════════════════════════════════════════════

def _open_data_file(name: str, data_dir: Path, zf: Optional[zipfile.ZipFile]):
    """
    Open a JSON data file from either a directory or a zip archive.
    For zips, matches on the filename alone (ignoring any subdirectory prefix
    Spotify may include in the archive).
    Returns a file-like object, or raises FileNotFoundError.
    """
    if zf is not None:
        # Match by basename so subdirectory structure inside the zip doesn't matter
        matches = [e for e in zf.namelist() if os.path.basename(e) == name]
        if not matches:
            raise FileNotFoundError(f"{name} not found in zip")
        return zf.open(matches[0])
    path = data_dir / name
    if not path.exists():
        raise FileNotFoundError(f"{path} not found")
    return open(path, encoding="utf-8")


def load_liked_tracks(
    data_dir: Path, zf: Optional[zipfile.ZipFile] = None
) -> Dict[str, dict]:
    """
    Read YourLibrary.json from a directory or zip archive.
    Returns a dict keyed by lowercase 'artist||track' strings.
    Each entry carries a base weight of 3.0 for being explicitly liked.
    """
    try:
        f = _open_data_file("YourLibrary.json", data_dir, zf)
    except FileNotFoundError as exc:
        LOG.warning(str(exc))
        return {}

    with f:
        data = json.load(f)

    liked: Dict[str, dict] = {}
    for t in data.get("tracks", []):
        artist = (t.get("artist") or "").strip()
        track = (t.get("track") or "").strip()
        uri = (t.get("uri") or "").strip()
        if not artist or not track:
            continue
        key = f"{artist.lower()}||{track.lower()}"
        liked[key] = {"artist": artist, "track": track, "uri": uri, "weight": 3.0}

    LOG.info(f"Loaded {len(liked)} liked tracks from YourLibrary.json")
    return liked


def load_streaming_history(
    data_dir: Path, zf: Optional[zipfile.ZipFile] = None
) -> Tuple[Dict[str, float], Dict[str, int], Dict[str, str]]:
    """
    Read all streaming history JSON files from a directory or zip archive.

    Supports three Spotify export variants:
      • Standard account export:  StreamingHistory_music_*.json
      • Extended streaming history: Streaming_History_Audio_*.json
        (includes spotify_track_uri — lets us skip the Search API entirely)

    Video/podcast files (Streaming_History_Video_*.json) are intentionally excluded.

    Returns:
        play_scores – log-scaled listening score per 'artist||track' key
        play_counts – raw play count per key (for heavy-play detection)
        track_uris  – spotify:track: URI per key, when available from the export
    """
    def _is_history_file(name: str) -> bool:
        return (
            fnmatch.fnmatch(name, "StreamingHistory_music_*.json")
            or fnmatch.fnmatch(name, "Streaming_History_Audio_*.json")
        )

    if zf is not None:
        history_names = sorted(
            os.path.basename(e) for e in zf.namelist() if _is_history_file(os.path.basename(e))
        )
    else:
        history_names = sorted(
            p.name
            for p in data_dir.iterdir()
            if p.is_file() and _is_history_file(p.name)
        )

    if not history_names:
        LOG.warning("No streaming history JSON files found in the export")
        return {}, {}, {}

    LOG.info(f"Found {len(history_names)} streaming history file(s)")

    play_ms: Dict[str, float] = defaultdict(float)
    play_counts: Dict[str, int] = defaultdict(int)
    track_uris: Dict[str, str] = {}

    for name in history_names:
        LOG.debug(f"Loading {name}")
        with _open_data_file(name, data_dir, zf) as f:
            entries = json.load(f)

        for entry in entries:
            # Standard export:  artistName / trackName / msPlayed
            # Extended export:  master_metadata_album_artist_name / master_metadata_track_name / ms_played
            artist = (
                entry.get("artistName")
                or entry.get("master_metadata_album_artist_name")
                or ""
            ).strip()
            track = (
                entry.get("trackName")
                or entry.get("master_metadata_track_name")
                or ""
            ).strip()
            ms = entry.get("msPlayed") or entry.get("ms_played") or 0

            if not artist or not track or ms < 30_000:
                # Skip missing data and tracks played < 30 s (almost certainly skips)
                continue

            key = f"{artist.lower()}||{track.lower()}"
            play_ms[key] += ms
            play_counts[key] += 1

            # Extended export includes the track URI — grab it once per key
            if key not in track_uris:
                uri = (entry.get("spotify_track_uri") or "").strip()
                if uri.startswith("spotify:track:"):
                    track_uris[key] = uri

    play_scores = {k: math.log1p(v / 60_000) for k, v in play_ms.items()}
    LOG.info(
        f"Streaming history: {len(play_scores)} unique tracks, "
        f"{sum(play_counts.values())} qualifying plays, "
        f"{len(track_uris)} with direct Spotify URIs"
    )
    return play_scores, play_counts, track_uris


def build_weighted_tracks(
    liked: Dict[str, dict],
    play_scores: Dict[str, float],
    play_counts: Dict[str, int],
    track_uris: Dict[str, str],
    top_n: int = 500,
) -> Tuple[List[dict], Set[str]]:
    """
    Merge liked library and play history.
    final_weight = liked_base (3.0 if liked, else 0) + log_play_score

    track_uris carries URIs harvested directly from Extended Streaming History
    entries; these let resolve_tracks_to_ids skip the Search API for those tracks.

    Returns:
        tracks          – top_n entries sorted descending by weight
        heavy_play_keys – keys of tracks played >10 times (excluded from recs)
    """
    all_keys = set(liked) | set(play_scores)
    heavy_play_keys = {k for k, n in play_counts.items() if n > 10}

    tracks = []
    for key in all_keys:
        base = liked.get(key, {})
        score = play_scores.get(key, 0.0)
        parts = key.split("||", 1)
        artist = base.get("artist") or (parts[0].title() if parts else "")
        trk = base.get("track") or (parts[1].title() if len(parts) > 1 else "")
        # Prefer the URI from the liked library; fall back to one from streaming history
        uri = base.get("uri") or track_uris.get(key, "")
        tracks.append(
            {
                "key": key,
                "artist": artist,
                "track": trk,
                "uri": uri,
                "weight": base.get("weight", 0.0) + score,
                "is_liked": key in liked,
                "play_count": play_counts.get(key, 0),
            }
        )

    tracks.sort(key=lambda x: x["weight"], reverse=True)
    top = tracks[:top_n]
    LOG.info(
        f"Weighted track list: {len(top)} tracks (from {len(all_keys)} unique). "
        f"Heavy-play exclusions: {len(heavy_play_keys)}"
    )
    return top, heavy_play_keys


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Spotify auth
# ══════════════════════════════════════════════════════════════════════════════

def create_spotify_client(config: dict) -> Tuple[spotipy.Spotify, str]:
    """
    Create an authenticated Spotify client from a cached token.

    Auth must already be completed (via check_token / complete_auth, or by
    the CLI flow in main()).  Spotipy will auto-refresh the token if it has
    expired but the refresh token is still valid.
    """
    auth = _make_auth(config)
    sp = spotipy.Spotify(auth_manager=auth, requests_timeout=30)
    me = spotify_retry(sp.current_user)
    LOG.info(f"Authenticated as: {me['display_name']} ({me['id']})")
    return sp, me["id"]


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Resolve track IDs, fetch audio features, cluster
# ══════════════════════════════════════════════════════════════════════════════

def resolve_tracks_to_ids(sp: spotipy.Spotify, tracks: List[dict]) -> List[dict]:
    """
    Attach a spotify_id to each track.

    Liked tracks with a valid spotify:track: URI are resolved instantly (no API call).
    Everything else is searched. We cap searches at 200 to keep runtime reasonable;
    liked tracks (which have URIs) are always resolved first, so the cap mainly
    affects history-only tracks at the tail of the weight-sorted list.
    """
    resolved: List[dict] = []
    needs_search: List[dict] = []

    for t in tracks:
        uri = t.get("uri", "")
        if uri.startswith("spotify:track:"):
            t = t.copy()
            t["spotify_id"] = uri.split(":")[-1]
            resolved.append(t)
        else:
            needs_search.append(t)

    LOG.info(
        f"ID resolution: {len(resolved)} from URI, searching for up to "
        f"{min(len(needs_search), 200)} more..."
    )

    search_cap = min(len(needs_search), 200)
    for i, t in enumerate(needs_search[:search_cap]):
        if i % 50 == 0:
            LOG.debug(f"  Search progress: {i}/{search_cap}")

        # Quoted-field search gives more precise matches than a plain query string
        query = f'track:"{t["track"]}" artist:"{t["artist"]}"'
        try:
            result = spotify_retry(sp.search, q=query, type="track", limit=1)
            items = result["tracks"]["items"]
            if items:
                t = t.copy()
                t["spotify_id"] = items[0]["id"]
                t["uri"] = items[0]["uri"]
                resolved.append(t)
        except Exception as exc:
            LOG.debug(f"  Search miss for '{t['track']}' by '{t['artist']}': {exc}")

        if i % 5 == 4:
            time.sleep(0.1)  # gentle pacing, well under rate limits

    LOG.info(f"Total tracks with Spotify IDs: {len(resolved)}")
    return resolved


def fetch_audio_features(
    sp: spotipy.Spotify, track_ids: List[str]
) -> Dict[str, dict]:
    """
    Fetch audio features in 100-track batches with disk caching.
    Returns an empty dict (without raising) if the endpoint returns 403,
    signalling the caller to switch to the genre-based fallback path.
    """
    cache = _load_features_cache()
    uncached = [tid for tid in track_ids if tid not in cache]

    if not uncached:
        LOG.info(f"Audio features: all {len(track_ids)} tracks served from cache")
        return {tid: cache[tid] for tid in track_ids if tid in cache}

    batch_size = 100
    n_batches = math.ceil(len(uncached) / batch_size)
    LOG.info(
        f"Fetching audio features: {len(uncached)} new tracks "
        f"({len(track_ids) - len(uncached)} cached, {n_batches} batches)..."
    )
    try:
        for i in range(n_batches):
            batch = uncached[i * batch_size : (i + 1) * batch_size]
            LOG.debug(f"  Batch {i + 1}/{n_batches}")
            results = spotify_retry(sp.audio_features, batch) or []
            for feat in results:
                if feat:
                    cache[feat["id"]] = feat
            time.sleep(0.15)
        _save_features_cache(cache)
    except spotipy.exceptions.SpotifyException as exc:
        if exc.http_status == 403:
            LOG.warning(
                "audio-features returned 403 — endpoint requires Extended Quota Mode. "
                "Switching to genre-based clustering (no extra permissions needed)."
            )
            return {}   # empty dict signals the caller to use the fallback
        raise

    return {tid: cache[tid] for tid in track_ids if tid in cache}


# ── Genre-based fallback (used when audio-features / recommendations are blocked) ─

def fetch_track_details(sp: spotipy.Spotify, track_ids: List[str]) -> Dict[str, dict]:
    """Batch-fetch full track objects (unrestricted endpoint). Gives us artist IDs."""
    result: Dict[str, dict] = {}
    batch_size = 50
    n = math.ceil(len(track_ids) / batch_size)
    LOG.info(f"Fetching track details for {len(track_ids)} tracks ({n} batches)...")
    for i in range(n):
        batch = track_ids[i * batch_size : (i + 1) * batch_size]
        data = spotify_retry(sp.tracks, batch) or {}
        for t in data.get("tracks", []) or []:
            if t:
                result[t["id"]] = t
        time.sleep(0.1)
    return result


def fetch_artist_genres(
    sp: spotipy.Spotify, artist_ids: List[str]
) -> Dict[str, dict]:
    """Batch-fetch artist objects (unrestricted). Each artist has a 'genres' list."""
    result: Dict[str, dict] = {}
    batch_size = 50
    n = math.ceil(len(artist_ids) / batch_size)
    LOG.info(f"Fetching artist info for {len(artist_ids)} artists ({n} batches)...")
    for i in range(n):
        batch = artist_ids[i * batch_size : (i + 1) * batch_size]
        data = spotify_retry(sp.artists, batch) or {}
        for a in data.get("artists", []) or []:
            if a:
                result[a["id"]] = {
                    "name": a.get("name", ""),
                    "genres": a.get("genres", []),
                    "popularity": a.get("popularity", 50),
                }
        time.sleep(0.1)
    LOG.info(f"Got artist info for {len(result)}/{len(artist_ids)} artists")
    return result


def build_genre_matrix(
    tracks: List[dict],
    artist_genres: Dict[str, dict],
    top_n_genres: int = 70,
) -> Tuple[np.ndarray, List[dict]]:
    """
    Build a genre-based feature matrix for K-Means clustering.
    Expects each track to already have 'artist_id' set.
    The matrix has one column per top-N genre (binary) plus one for artist popularity.
    """
    genre_freq: Dict[str, float] = defaultdict(float)
    for t in tracks:
        aid = t.get("artist_id", "")
        if aid:
            for g in artist_genres.get(aid, {}).get("genres", []):
                genre_freq[g] += t.get("weight", 1.0)

    vocab = sorted(genre_freq, key=genre_freq.get, reverse=True)[:top_n_genres]  # type: ignore[arg-type]
    vocab_idx = {g: i for i, g in enumerate(vocab)}

    valid_tracks: List[dict] = []
    rows: List[List[float]] = []
    for t in tracks:
        aid = t.get("artist_id", "")
        if not aid:
            continue
        a_info = artist_genres.get(aid, {})
        pop = a_info.get("popularity", 50) / 100.0
        vec = [0.0] * (len(vocab) + 1)
        for g in a_info.get("genres", []):
            if g in vocab_idx:
                vec[vocab_idx[g]] = 1.0
        vec[-1] = pop
        rows.append(vec)
        valid_tracks.append(t)

    if not rows:
        return np.zeros((0, len(vocab) + 1)), valid_tracks
    return np.array(rows, dtype=float), valid_tracks


# ── Taste fingerprint ─────────────────────────────────────────────────────────

def build_taste_fingerprint(
    tracks: List[dict], artist_genres: Dict[str, dict]
) -> dict:
    """
    Aggregate weighted genre and artist frequencies from the user's listening history.
    Returns normalized dicts so scores are comparable across runs.
    """
    genre_freq: Dict[str, float] = defaultdict(float)
    artist_freq: Dict[str, float] = defaultdict(float)
    for t in tracks:
        w = t.get("weight", 1.0)
        aid = t.get("artist_id", "")
        if aid:
            artist_freq[aid] += w
            for g in artist_genres.get(aid, {}).get("genres", []):
                genre_freq[g] += w
    total_g = sum(genre_freq.values()) or 1.0
    total_a = sum(artist_freq.values()) or 1.0
    return {
        "genres":  {g: v / total_g for g, v in genre_freq.items()},
        "artists": {a: v / total_a for a, v in artist_freq.items()},
    }


# ── Last.fm optional enrichment ───────────────────────────────────────────────
# Add "lastfm_api_key": "<key>" to config.json for better discovery.
# Free key at: https://www.last.fm/api/account/create

_LASTFM_CACHE_FILE = ".lastfm_cache.json"


def _load_lastfm_cache() -> dict:
    if os.path.exists(_LASTFM_CACHE_FILE):
        try:
            with open(_LASTFM_CACHE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_lastfm_cache(cache: dict) -> None:
    with open(_LASTFM_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f)


def fetch_lastfm_similar_artists(
    artist_names: List[str],
    api_key: str,
    limit: int = 10,
) -> Dict[str, List[str]]:
    """
    Fetch similar artists for each name via Last.fm artist.getSimilar.
    Returns {artist_name: [similar_names]}. Results are disk-cached.
    Returns empty list per artist on any failure — never raises.
    """
    cache = _load_lastfm_cache()
    result: Dict[str, List[str]] = {}
    changed = False
    for name in artist_names:
        key = f"sim:{name.lower()}"
        if key in cache:
            result[name] = cache[key]
            continue
        try:
            resp = requests.get(
                "https://ws.audioscrobbler.com/2.0/",
                params={
                    "method": "artist.getSimilar",
                    "artist": name,
                    "api_key": api_key,
                    "format": "json",
                    "limit": limit,
                },
                timeout=10,
            )
            data = resp.json()
            similar = [
                a["name"]
                for a in data.get("similarartists", {}).get("artist", [])
            ]
            cache[key] = similar
            result[name] = similar
            changed = True
        except Exception as exc:
            LOG.debug(f"Last.fm getSimilar failed for '{name}': {exc}")
            result[name] = []
        time.sleep(0.05)
    if changed:
        _save_lastfm_cache(cache)
    return result


def harvest_via_lastfm(
    sp: spotipy.Spotify,
    profile: dict,
    quota: int,
    exclude_ids: Set[str],
    lastfm_api_key: str,
) -> List[dict]:
    """
    Discover tracks: Last.fm similar artists → Spotify artist search → top tracks.
    Returns empty list silently on failure so callers fall through to other methods.
    """
    seed_names = list({
        t.get("artist", "") for t in profile["top_tracks"] if t.get("artist")
    })[:5]
    if not seed_names:
        return []

    similar_map = fetch_lastfm_similar_artists(seed_names, lastfm_api_key, limit=8)
    seen_names: Set[str] = {n.lower() for n in seed_names}
    similar_names: List[str] = []
    for similars in similar_map.values():
        for n in similars:
            if n.lower() not in seen_names:
                similar_names.append(n)
                seen_names.add(n.lower())

    candidates: List[dict] = []
    seen_ids: Set[str] = set()
    want = quota * 4

    for artist_name in similar_names[:20]:
        if len(candidates) >= want:
            break
        try:
            res = spotify_retry(
                sp.search, q=f'artist:"{artist_name}"', type="artist", limit=1
            )
            items = (res.get("artists") or {}).get("items", [])
            if not items:
                continue
            a = items[0]
            top = spotify_retry(sp.artist_top_tracks, a["id"], country="US")
            for t in top.get("tracks", [])[:6]:
                tid = t["id"]
                if tid in seen_ids or tid in exclude_ids:
                    continue
                candidates.append({
                    "spotify_id": tid,
                    "name": t["name"],
                    "artist": t["artists"][0]["name"] if t.get("artists") else artist_name,
                    "uri": t["uri"],
                    "cluster_id": profile["id"],
                    "rel_genres": a.get("genres", []),
                    "rel_popularity": a.get("popularity", 50),
                })
                seen_ids.add(tid)
        except Exception as exc:
            LOG.debug(f"Last.fm harvest failed for '{artist_name}': {exc}")
        time.sleep(0.1)

    LOG.debug(
        f"  Cluster {profile['id']}: {len(candidates)} candidates via Last.fm (quota={quota})"
    )
    return candidates


# ── Genre-search fallback ─────────────────────────────────────────────────────

def _cluster_top_genres(profile: dict, top_n: int = 6) -> List[str]:
    """Derive top genre strings from a cluster profile's top_tracks."""
    freq: Dict[str, float] = defaultdict(float)
    for t in profile.get("top_tracks", []):
        for g in t.get("_genres", []):
            freq[g] += t.get("weight", 1.0)
    return sorted(freq, key=freq.get, reverse=True)[:top_n]  # type: ignore[arg-type]


def _harvest_via_genre_search(
    sp: spotipy.Spotify,
    genres: List[str],
    quota: int,
    exclude_ids: Set[str],
    cluster_id: int,
) -> List[dict]:
    """Last-resort discovery using Spotify genre search queries."""
    candidates: List[dict] = []
    seen: Set[str] = set()
    want = quota * 4

    for genre in genres[:6]:
        if len(candidates) >= want:
            break
        try:
            results = spotify_retry(
                sp.search, q=f'genre:"{genre}"', type="track", limit=50
            )
            for t in (results.get("tracks") or {}).get("items", []):
                tid = t["id"]
                if tid in seen or tid in exclude_ids:
                    continue
                candidates.append({
                    "spotify_id": tid,
                    "name": t["name"],
                    "artist": t["artists"][0]["name"] if t.get("artists") else "Unknown",
                    "uri": t["uri"],
                    "cluster_id": cluster_id,
                    "rel_genres": [genre],
                    "rel_popularity": t.get("popularity", 50),
                })
                seen.add(tid)
        except Exception as exc:
            LOG.debug(f"Genre search '{genre}': {exc}")
        time.sleep(0.1)

    return candidates


def harvest_via_related_artists(
    sp: spotipy.Spotify,
    profile: dict,
    quota: int,
    exclude_ids: Set[str],
) -> List[dict]:
    """
    Discovery via related-artists → top-tracks (unrestricted endpoints).
    404s are treated as non-fatal: if all seeds 404, or too few candidates are
    gathered, automatically supplements with genre-search so the pipeline
    always produces results.
    """
    seed_artist_ids = list({
        t.get("artist_id", "") for t in profile["top_tracks"] if t.get("artist_id")
    })[:6]

    if not seed_artist_ids:
        LOG.info(f"  Cluster {profile['id']}: no seed artist IDs — using genre search")
        return _harvest_via_genre_search(
            sp, _cluster_top_genres(profile), quota, exclude_ids, profile["id"]
        )

    candidates: List[dict] = []
    seen: Set[str] = set()
    want = quota * 4
    n_404 = 0

    for seed_id in seed_artist_ids:
        if len(candidates) >= want:
            break
        try:
            related = spotify_retry(sp.artist_related_artists, seed_id)
            related_artists = related.get("artists", [])[:8]
        except spotipy.exceptions.SpotifyException as exc:
            if exc.http_status == 404:
                n_404 += 1
                continue
            LOG.debug(f"  related-artists failed for {seed_id}: {exc}")
            continue
        except Exception as exc:
            LOG.debug(f"  related-artists failed for {seed_id}: {exc}")
            continue

        for rel in related_artists:
            if len(candidates) >= want:
                break
            rel_id = rel["id"]
            try:
                top = spotify_retry(sp.artist_top_tracks, rel_id, country="US")
                top_tracks = top.get("tracks", [])
            except Exception as exc:
                LOG.debug(f"  top-tracks failed for {rel_id}: {exc}")
                continue

            for t in top_tracks[:6]:
                tid = t["id"]
                if tid in seen or tid in exclude_ids:
                    continue
                candidates.append({
                    "spotify_id": tid,
                    "name": t["name"],
                    "artist": t["artists"][0]["name"] if t.get("artists") else "Unknown",
                    "uri": t["uri"],
                    "cluster_id": profile["id"],
                    "rel_genres": rel.get("genres", []),
                    "rel_popularity": rel.get("popularity", 50),
                })
                seen.add(tid)

            time.sleep(0.05)
        time.sleep(0.1)

    # Supplement with genre search if related-artists produced too few results
    if len(candidates) < quota:
        if n_404:
            LOG.info(
                f"  Cluster {profile['id']}: related-artists returned 404 for "
                f"{n_404}/{len(seed_artist_ids)} seeds — supplementing with genre search"
            )
        extra = _harvest_via_genre_search(
            sp, _cluster_top_genres(profile),
            max(quota - len(candidates), quota),  # always gather a full quota's worth
            exclude_ids, profile["id"],
        )
        # Merge without duplicating IDs already in candidates
        existing_ids = {c["spotify_id"] for c in candidates}
        candidates.extend(c for c in extra if c["spotify_id"] not in existing_ids)

    LOG.debug(
        f"  Cluster {profile['id']} [{profile['description']}]: "
        f"{len(candidates)} candidates via related artists (quota={quota})"
    )
    return candidates


def score_and_select_by_genre(
    candidates: List[dict],
    profiles: List[dict],
    quotas: List[int],
    total_size: int,
    fingerprint: Optional[dict] = None,
) -> List[dict]:
    """
    Select final tracks using genre overlap scoring (no audio features needed).

    When a taste fingerprint is provided, genre overlap uses the user's weighted
    genre preferences instead of binary cluster-top-genre membership — this rewards
    candidates whose genres appear frequently in the user's own listening history.
    Popularity is used as a 20% secondary signal.
    """
    profile_top_genres: Dict[int, Set[str]] = {}
    for p in profiles:
        freq: Dict[str, float] = defaultdict(float)
        for t in p.get("top_tracks", []):
            for g in t.get("_genres", []):
                freq[g] += t.get("weight", 1.0)
        profile_top_genres[p["id"]] = set(
            sorted(freq, key=freq.get, reverse=True)[:15]  # type: ignore[arg-type]
        )

    fp_genres = (fingerprint or {}).get("genres", {})

    seen: Set[str] = set()
    unique: List[dict] = []
    for c in candidates:
        if c["spotify_id"] not in seen:
            unique.append(c)
            seen.add(c["spotify_id"])

    by_cluster: Dict[int, List[dict]] = defaultdict(list)
    for c in unique:
        cid = c["cluster_id"]
        top_genres = profile_top_genres.get(cid, set())
        cand_genres = set(c.get("rel_genres", []))

        if fp_genres and top_genres:
            # Weighted: sum of user's normalized preference for each matching genre
            overlap = sum(fp_genres.get(g, 0.0) for g in cand_genres) / max(len(top_genres), 1)
        else:
            overlap = len(cand_genres & top_genres) / max(len(top_genres), 1)

        pop = c.get("rel_popularity", 50) / 100.0
        c = c.copy()
        c["fit_score"] = overlap * 0.80 + pop * 0.20
        by_cluster[cid].append(c)

    final: List[dict] = []
    for profile, quota in zip(profiles, quotas):
        pool = sorted(
            by_cluster.get(profile["id"], []),
            key=lambda x: x.get("fit_score", 0.0),
            reverse=True,
        )
        selected = pool[:quota]
        final.extend(selected)
        LOG.info(
            f"  Cluster {profile['id']} [{profile['description']}]: "
            f"selected {len(selected)}/{quota}"
        )

    random.shuffle(final)
    return final[:total_size]


def _normalize_tempo(bpm: float) -> float:
    return max(0.0, min(1.0, (bpm - TEMPO_MIN) / TEMPO_RANGE))


def _denormalize_tempo(val: float) -> float:
    return val * TEMPO_RANGE + TEMPO_MIN


def build_feature_matrix(
    tracks: List[dict], features_map: Dict[str, dict]
) -> Tuple[np.ndarray, List[dict]]:
    """
    Attach audio features to tracks and build a normalized (0-1) feature matrix.
    Only tracks with available features are included.
    Returns (matrix, valid_tracks) — both in the same order.
    """
    valid: List[dict] = []
    rows: List[List[float]] = []

    for t in tracks:
        tid = t.get("spotify_id")
        if not tid or tid not in features_map:
            continue
        f = features_map[tid]
        rows.append(
            [
                f.get("danceability", 0.0),
                f.get("energy", 0.0),
                f.get("valence", 0.0),
                _normalize_tempo(f.get("tempo", 120.0)),
                f.get("acousticness", 0.0),
                f.get("instrumentalness", 0.0),
                f.get("speechiness", 0.0),
            ]
        )
        t = t.copy()
        t["features"] = f
        valid.append(t)

    return np.array(rows, dtype=float), valid


def _describe_cluster(centroid_norm: np.ndarray) -> str:
    """Human-readable mood label derived from a normalized centroid vector."""
    if len(centroid_norm) != 7:
        # Genre-mode centroids are not 7-dimensional; description is set later.
        return "Mixed"
    d, e, v, t, a, ins, sp_val = centroid_norm
    parts: List[str] = []

    if e > 0.65:
        parts.append("High Energy")
    elif e < 0.35:
        parts.append("Low Energy")
    else:
        parts.append("Mid Energy")

    if v > 0.65:
        parts.append("Upbeat")
    elif v < 0.35:
        parts.append("Moody")

    if d > 0.70:
        parts.append("Danceable")

    if a > 0.50:
        parts.append("Acoustic")

    if ins > 0.45:
        parts.append("Instrumental")

    if t > 0.65:
        parts.append("Fast")
    elif t < 0.30:
        parts.append("Slow")

    return " / ".join(parts) if parts else "Eclectic"


def cluster_tracks(
    tracks: List[dict], matrix: np.ndarray, n_clusters: int
) -> Tuple[np.ndarray, KMeans]:
    """Fit K-Means; returns (per-track label array, fitted model)."""
    # Guard against requesting more clusters than half the data points
    k = min(n_clusters, len(matrix) // 2)
    if k != n_clusters:
        LOG.warning(f"Reduced clusters from {n_clusters} to {k} (too few tracks)")
    LOG.info(f"Running K-Means (k={k}) on {len(matrix)} tracks...")
    km = KMeans(n_clusters=k, n_init=15, random_state=42)
    labels = km.fit_predict(matrix)
    return labels, km


def build_cluster_profiles(
    tracks: List[dict],
    matrix: np.ndarray,
    labels: np.ndarray,
    n_clusters: int,
) -> List[dict]:
    """
    Build a profile dict for each cluster containing:
    - centroid_norm: normalized centroid (for distance scoring)
    - centroid_api:  denormalized centroid + BPM tempo (for recommendations API)
    - std_api:       denormalized std devs (for min/max tolerance calculation)
    - top_tracks:    top-20 seed candidates sorted by weight
    - total_weight:  sum of member weights (for proportional quota calculation)
    """
    profiles: List[dict] = []

    for cid in range(n_clusters):
        mask = labels == cid
        c_matrix = matrix[mask]
        c_tracks = [t for t, m in zip(tracks, mask) if m]

        centroid_norm = c_matrix.mean(axis=0)
        std_norm = c_matrix.std(axis=0)

        # Build the API-ready centroid (tempo in BPM, all others 0-1)
        centroid_api = dict(zip(AUDIO_FEATURES, centroid_norm.tolist()))
        centroid_api["tempo"] = _denormalize_tempo(centroid_api["tempo"])

        std_api = dict(zip(AUDIO_FEATURES, std_norm.tolist()))
        std_api["tempo"] = float(std_norm[3]) * TEMPO_RANGE

        c_tracks.sort(key=lambda x: x.get("weight", 0), reverse=True)
        total_weight = sum(t.get("weight", 0) for t in c_tracks)

        profile = {
            "id": cid,
            "description": _describe_cluster(centroid_norm),
            "centroid_norm": centroid_norm,
            "centroid_api": centroid_api,
            "std_api": std_api,
            "total_weight": total_weight,
            "track_count": len(c_tracks),
            "top_tracks": c_tracks[:20],
            "all_ids": {t["spotify_id"] for t in c_tracks if t.get("spotify_id")},
        }
        LOG.info(
            f"  Cluster {cid} [{profile['description']}]: "
            f"{len(c_tracks)} tracks, weight={total_weight:.1f}"
        )
        profiles.append(profile)

    return profiles


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Recommendation harvesting
# ══════════════════════════════════════════════════════════════════════════════

def compute_quotas(
    profiles: List[dict], total_size: int, min_per_cluster: int = 15
) -> List[int]:
    """
    Distribute total_size tracks across clusters proportional to each cluster's
    total_weight, with a minimum floor of min_per_cluster per cluster.
    """
    total_weight = sum(p["total_weight"] for p in profiles)
    n = len(profiles)
    floor_total = min_per_cluster * n
    extra = max(0, total_size - floor_total)

    quotas = [
        min_per_cluster + int((p["total_weight"] / total_weight if total_weight else 1 / n) * extra)
        for p in profiles
    ]

    # Correct any rounding drift to hit the exact target
    diff = total_size - sum(quotas)
    for i in range(abs(diff)):
        idx = i % n
        if diff > 0:
            quotas[idx] += 1
        elif quotas[idx] > min_per_cluster:
            quotas[idx] -= 1

    return quotas


def harvest_recommendations(
    sp: spotipy.Spotify,
    profile: dict,
    quota: int,
    exclude_ids: Set[str],
) -> List[dict]:
    """
    Gather recommendation candidates for one cluster.

    Strategy:
    - Seeds: top weighted tracks in the cluster, rotated across calls (5 per call)
    - Targets: cluster centroid values
    - Min/max: centroid ± max(0.6 * std, 0.05)  →  tight but not impossibly narrow
    - Collect ~5× quota, then let scoring trim to the best
    """
    centroid = profile["centroid_api"]
    std = profile["std_api"]
    seed_pool = [t["spotify_id"] for t in profile["top_tracks"] if t.get("spotify_id")]

    if not seed_pool:
        LOG.warning(f"Cluster {profile['id']}: no seed tracks available, skipping")
        return []

    want = quota * 5
    candidates: List[dict] = []
    seen: Set[str] = set()
    max_attempts = 25

    for attempt in range(max_attempts):
        if len(candidates) >= want:
            break

        # Rotate the 5-seed window through the pool so each call varies
        offset = (attempt * 3) % len(seed_pool)
        seeds = (seed_pool[offset:] + seed_pool[:offset])[:5]

        params: dict = {"seed_tracks": seeds, "limit": 20}

        # Set target/min/max for each continuous audio feature
        for feat in ["danceability", "energy", "valence",
                     "acousticness", "instrumentalness", "speechiness"]:
            val = centroid[feat]
            tol = max(std.get(feat, 0.15) * 0.6, 0.05)
            params[f"target_{feat}"] = round(val, 3)
            params[f"min_{feat}"]    = round(max(0.0, val - tol), 3)
            params[f"max_{feat}"]    = round(min(1.0, val + tol), 3)

        tempo = centroid["tempo"]
        tempo_tol = max(std.get("tempo", 20.0) * 0.6, 10.0)
        params["target_tempo"] = round(tempo, 1)
        params["min_tempo"]    = round(max(40.0, tempo - tempo_tol), 1)
        params["max_tempo"]    = round(min(220.0, tempo + tempo_tol), 1)

        try:
            result = spotify_retry(sp.recommendations, **params)
        except spotipy.exceptions.SpotifyException as exc:
            if exc.http_status == 403:
                # Spotify restricted recommendations to apps with extended quota mode
                # in late 2023.  Visit developer.spotify.com → your app → Request Extension.
                LOG.error(
                    "Recommendations endpoint returned 403 (access denied).\n"
                    "  Spotify now requires 'Extended Quota Mode' for this endpoint.\n"
                    "  Go to https://developer.spotify.com/dashboard, open your app,\n"
                    "  and request extended access under 'Quota Extensions'."
                )
                return candidates
            LOG.warning(f"Rec call failed (cluster {profile['id']}, attempt {attempt}): {exc}")
            time.sleep(1)
            continue

        for t in result.get("tracks", []):
            tid = t["id"]
            if tid in seen or tid in exclude_ids:
                continue
            candidates.append(
                {
                    "spotify_id": tid,
                    "name": t["name"],
                    "artist": t["artists"][0]["name"] if t["artists"] else "Unknown",
                    "uri": t["uri"],
                    "cluster_id": profile["id"],
                }
            )
            seen.add(tid)

        time.sleep(0.15)

    LOG.debug(
        f"  Cluster {profile['id']} [{profile['description']}]: "
        f"{len(candidates)} candidates gathered (quota={quota})"
    )
    return candidates


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Score, deduplicate, select
# ══════════════════════════════════════════════════════════════════════════════

def score_and_select(
    sp: spotipy.Spotify,
    candidates: List[dict],
    profiles: List[dict],
    quotas: List[int],
    total_size: int,
) -> List[dict]:
    """
    1. Fetch audio features for all candidates.
    2. Score each by Euclidean distance to its cluster's centroid (lower = better fit).
    3. Normalize scores 0-1 per cluster, invert so 1 = best fit.
    4. Select top-quota tracks per cluster.
    5. Shuffle so taste moods interleave rather than block.
    """
    LOG.info(f"Scoring {len(candidates)} candidates...")

    # Deduplicate by ID before the bulk feature fetch
    deduped: Dict[str, dict] = {}
    for c in candidates:
        deduped.setdefault(c["spotify_id"], c)
    unique_candidates = list(deduped.values())

    feat_map = fetch_audio_features(sp, [c["spotify_id"] for c in unique_candidates])
    profile_by_id = {p["id"]: p for p in profiles}

    scored: List[dict] = []
    for c in unique_candidates:
        feat = feat_map.get(c["spotify_id"])
        if not feat:
            continue
        profile = profile_by_id.get(c["cluster_id"])
        if not profile:
            continue

        vec = np.array(
            [
                feat.get("danceability", 0.0),
                feat.get("energy", 0.0),
                feat.get("valence", 0.0),
                _normalize_tempo(feat.get("tempo", 120.0)),
                feat.get("acousticness", 0.0),
                feat.get("instrumentalness", 0.0),
                feat.get("speechiness", 0.0),
            ]
        )
        c = c.copy()
        c["distance"] = float(np.linalg.norm(vec - profile["centroid_norm"]))
        scored.append(c)

    # Per-cluster score normalization: map [min_dist, max_dist] → [1, 0]
    by_cluster: Dict[int, List[dict]] = defaultdict(list)
    for c in scored:
        by_cluster[c["cluster_id"]].append(c)

    for pool in by_cluster.values():
        dists = [c["distance"] for c in pool]
        lo, hi = min(dists), max(dists)
        span = hi - lo if hi != lo else 1.0
        for c in pool:
            c["fit_score"] = 1.0 - (c["distance"] - lo) / span

    # Select top quota per cluster, then shuffle
    final: List[dict] = []
    for profile, quota in zip(profiles, quotas):
        pool = sorted(
            by_cluster.get(profile["id"], []),
            key=lambda x: x.get("fit_score", 0.0),
            reverse=True,
        )
        selected = pool[:quota]
        final.extend(selected)
        LOG.info(
            f"  Cluster {profile['id']} [{profile['description']}]: "
            f"selected {len(selected)}/{quota}"
        )

    random.shuffle(final)
    return final[:total_size]


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Playlist creation
# ══════════════════════════════════════════════════════════════════════════════

def _radio_order(tracks: List[dict]) -> List[dict]:
    """
    Reorder tracks so taste clusters interleave rather than block together.
    Round-robins across clusters in a shuffled order so the playlist feels like
    continuous radio rather than back-to-back same-genre sections.
    """
    by_cluster: Dict[int, List[dict]] = defaultdict(list)
    for t in tracks:
        by_cluster[t["cluster_id"]].append(t)

    cluster_ids = list(by_cluster.keys())
    random.shuffle(cluster_ids)

    result: List[dict] = []
    while any(by_cluster[cid] for cid in cluster_ids):
        for cid in cluster_ids:
            if by_cluster[cid]:
                result.append(by_cluster[cid].pop(0))
    return result


def create_playlist(
    sp: spotipy.Spotify,
    user_id: str,
    tracks: List[dict],
    name: str,
) -> str:
    """Create a private playlist and add all tracks in 100-item batches. Returns URL."""
    pl = spotify_retry(
        sp.user_playlist_create,
        user=user_id,
        name=name,
        public=False,
        description=(
            f"Cross-genre discovery mix · {len(tracks)} songs · "
            "generated by Spotify Radio Generator"
        ),
    )
    pl_id = pl["id"]
    url = pl["external_urls"]["spotify"]

    uris = [t["uri"] for t in tracks if t.get("uri")]
    for i in range(0, len(uris), 100):
        spotify_retry(sp.playlist_add_items, pl_id, uris[i : i + 100])
        LOG.debug(f"Added tracks {i + 1}–{min(i + 100, len(uris))}/{len(uris)}")
        time.sleep(0.1)

    return url


def print_summary(tracks: List[dict], profiles: List[dict], url: str) -> None:
    cluster_counts: Dict[int, int] = defaultdict(int)
    for t in tracks:
        cluster_counts[t["cluster_id"]] += 1

    artist_counts: Dict[str, int] = defaultdict(int)
    for t in tracks:
        artist_counts[t.get("artist", "Unknown")] += 1

    top3 = sorted(artist_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    line = "=" * 64
    print(f"\n{line}")
    print(f"  PLAYLIST READY")
    print(f"  {url}")
    print(line)
    print(f"  Total tracks added: {len(tracks)}\n")
    print("  Taste Mood Breakdown:")
    for p in profiles:
        count = cluster_counts.get(p["id"], 0)
        print(f"    [{p['id']}] {p['description']:<40} {count:>3} tracks")
    print("\n  Top Artists in Mix:")
    for artist, count in top3:
        print(f"    {artist:<45} {count:>3} tracks")
    print(f"{line}\n")


# ══════════════════════════════════════════════════════════════════════════════
# Pipeline (shared by CLI and GUI)
# ══════════════════════════════════════════════════════════════════════════════

def run_pipeline(
    settings: dict,
    msg_queue: queue.Queue,
    stop_event: threading.Event,
) -> None:
    """
    Run the full playlist generation pipeline in a background thread.

    settings keys:
        data_dir  – path to the Spotify data export (folder or .zip)
        size      – target playlist track count
        clusters  – number of taste-mood clusters

    Messages placed into msg_queue:
        ("log",   levelname, text)                 – log line
        ("step",  n, total, description)           – major step started
        ("track", name, artist, cluster_desc)      – track selected for playlist
        ("done",  playlist_url, summary_dict)      – success
        ("error", message)                         – fatal failure
    """
    def put(msg: tuple) -> None:
        msg_queue.put(msg)

    def check_stop() -> None:
        if stop_event.is_set():
            raise InterruptedError("Stopped by user")

    # Route all LOG.* calls into the queue for this run
    handler = _QueueLogHandler(msg_queue)
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOG.addHandler(handler)

    try:
        data_path = Path(settings["data_dir"])
        target_size = int(settings.get("size", 175))
        n_clusters = int(settings.get("clusters", 6))

        # ── Step 1: parse data ───────────────────────────────────────
        put(("step", 1, 6, "Parsing Spotify data export…"))
        check_stop()

        zf: Optional[zipfile.ZipFile] = None
        data_dir = data_path
        if data_path.suffix.lower() == ".zip":
            if not data_path.exists():
                put(("error", f"Zip not found: {data_path}"))
                return
            zf = zipfile.ZipFile(data_path, "r")
        elif not data_path.is_dir():
            put(("error", f"Data path must be a folder or .zip: {data_path}"))
            return

        try:
            liked = load_liked_tracks(data_dir, zf)
            play_scores, play_counts, track_uris = load_streaming_history(data_dir, zf)
        finally:
            if zf:
                zf.close()

        tracks, heavy_keys = build_weighted_tracks(
            liked, play_scores, play_counts, track_uris, top_n=500
        )
        if not tracks:
            put(("error", "No tracks found in the data export."))
            return

        check_stop()

        # ── Step 2: connect to Spotify ───────────────────────────────
        put(("step", 2, 6, "Connecting to Spotify…"))
        config = load_or_create_config()
        sp, user_id = create_spotify_client(config)
        check_stop()

        # ── Step 3: resolve IDs, try audio features, cluster ─────────
        put(("step", 3, 6, "Resolving track IDs and clustering…"))
        resolved = resolve_tracks_to_ids(sp, tracks)
        feat_map = fetch_audio_features(sp, [t["spotify_id"] for t in resolved])
        lastfm_key = config.get("lastfm_api_key", "").strip()
        fingerprint: Optional[dict] = None

        if feat_map:
            # ── Audio-features path ───────────────────────────────────
            LOG.info("Using audio-features clustering (Extended Quota Mode available)")
            matrix, valid_tracks = build_feature_matrix(resolved, feat_map)
            LOG.info(f"Tracks with audio features: {len(valid_tracks)}")
            if len(valid_tracks) < n_clusters * 2:
                put(("error", "Too few tracks with audio features for clustering."))
                return
            labels, _ = cluster_tracks(valid_tracks, matrix, n_clusters)
            profiles = build_cluster_profiles(valid_tracks, matrix, labels, len(set(labels)))
        else:
            # ── Genre-based fallback path (no Extended Quota Mode needed) ──
            LOG.info("Audio-features blocked (403) — falling back to genre-based clustering")
            put(("step", 3, 6, "Clustering by genre (audio-features endpoint unavailable)…"))

            track_ids = [t["spotify_id"] for t in resolved]
            track_details = fetch_track_details(sp, track_ids)
            for t in resolved:
                td = track_details.get(t["spotify_id"], {})
                artists_field = td.get("artists") or []
                t["artist_id"] = artists_field[0]["id"] if artists_field else ""

            artist_ids = list({t["artist_id"] for t in resolved if t.get("artist_id")})
            artist_genres = fetch_artist_genres(sp, artist_ids)

            matrix, valid_tracks = build_genre_matrix(resolved, artist_genres)
            LOG.info(f"Tracks with genre data: {len(valid_tracks)}")
            if len(valid_tracks) < n_clusters * 2:
                put(("error", "Too few tracks with genre data for clustering."))
                return

            labels, _ = cluster_tracks(valid_tracks, matrix, n_clusters)
            profiles = build_cluster_profiles(valid_tracks, matrix, labels, len(set(labels)))

            for p in profiles:
                freq: Dict[str, float] = defaultdict(float)
                for t in p["top_tracks"]:
                    for g in artist_genres.get(t.get("artist_id", ""), {}).get("genres", []):
                        freq[g] += t.get("weight", 1.0)
                top_genres = sorted(freq, key=freq.get, reverse=True)[:3]  # type: ignore[arg-type]
                p["description"] = (
                    " / ".join(g.title() for g in top_genres)
                    if top_genres else f"Cluster {p['id']}"
                )

            for p in profiles:
                for t in p["top_tracks"]:
                    t["_genres"] = artist_genres.get(t.get("artist_id", ""), {}).get("genres", [])

            fingerprint = build_taste_fingerprint(valid_tracks, artist_genres)
            LOG.info(
                f"Taste fingerprint: {len(fingerprint['genres'])} genre weights, "
                f"{len(fingerprint['artists'])} artist weights"
            )
            if lastfm_key:
                LOG.info("Last.fm API key found — will use for discovery")
            else:
                LOG.info(
                    "No Last.fm API key in config — using related-artists + genre search. "
                    "Add \"lastfm_api_key\": \"<key>\" to config.json for better discovery "
                    "(free key at https://www.last.fm/api/account/create)"
                )

        liked_ids: Set[str] = {
            t["spotify_id"] for t in valid_tracks if t.get("is_liked") and t.get("spotify_id")
        }
        heavy_ids: Set[str] = {
            t["spotify_id"] for t in valid_tracks if t["key"] in heavy_keys and t.get("spotify_id")
        }
        exclude_ids = liked_ids | heavy_ids
        LOG.info(f"Excluding {len(exclude_ids)} already-known tracks from recommendations")
        check_stop()

        # ── Step 4: harvest candidates ───────────────────────────────
        put(("step", 4, 6, "Harvesting discovery candidates from each cluster…"))
        quotas = compute_quotas(profiles, target_size)
        LOG.info(f"Cluster quotas: {quotas} (total={sum(quotas)})")

        all_candidates: List[dict] = []
        for profile, quota in zip(profiles, quotas):
            check_stop()
            LOG.info(f"  → Cluster {profile['id']} [{profile['description']}] quota={quota}")
            if feat_map:
                all_candidates.extend(harvest_recommendations(sp, profile, quota, exclude_ids))
            elif lastfm_key:
                # Last.fm collaborative filtering → Spotify top tracks
                cluster_cands = harvest_via_lastfm(sp, profile, quota, exclude_ids, lastfm_key)
                if len(cluster_cands) < quota // 2:
                    # Supplement if Last.fm didn't produce enough
                    cluster_cands.extend(
                        harvest_via_related_artists(
                            sp, profile, quota - len(cluster_cands), exclude_ids
                        )
                    )
                all_candidates.extend(cluster_cands)
            else:
                # related-artists with automatic genre-search cascade on 404
                all_candidates.extend(harvest_via_related_artists(sp, profile, quota, exclude_ids))

        LOG.info(f"Total raw candidates: {len(all_candidates)}")
        if not all_candidates:
            put(("error",
                 "No discovery candidates found.\n"
                 "Check your network connection and Spotify app settings."))
            return

        check_stop()

        # ── Step 5: score, deduplicate, select ───────────────────────
        put(("step", 5, 6, "Scoring and selecting final tracks…"))
        if feat_map:
            final_tracks = score_and_select(sp, all_candidates, profiles, quotas, target_size)
        else:
            final_tracks = score_and_select_by_genre(
                all_candidates, profiles, quotas, target_size, fingerprint=fingerprint
            )
        final_tracks = _radio_order(final_tracks)
        LOG.info(f"Final selection: {len(final_tracks)} tracks")

        profile_lookup = {p["id"]: p for p in profiles}
        for t in final_tracks:
            mood = profile_lookup.get(t["cluster_id"], {}).get("description", "")
            put(("track", t.get("name", ""), t.get("artist", ""), mood))

        check_stop()

        # ── Step 6: create playlist ──────────────────────────────────
        put(("step", 6, 6, "Creating Spotify playlist…"))
        playlist_name = f"All Stations Mix — {datetime.now().strftime('%Y-%m-%d')}"
        url = create_playlist(sp, user_id, final_tracks, playlist_name)

        artist_counts: Dict[str, int] = defaultdict(int)
        mood_counts: Dict[str, int] = defaultdict(int)
        for t in final_tracks:
            artist_counts[t.get("artist", "Unknown")] += 1
            mood_counts[profile_lookup.get(t["cluster_id"], {}).get("description", "?")] += 1

        put(("done", url, {
            "total": len(final_tracks),
            "mood_counts": dict(sorted(mood_counts.items(), key=lambda x: x[1], reverse=True)),
            "top_artists": [a for a, _ in sorted(artist_counts.items(), key=lambda x: x[1], reverse=True)[:3]],
        }))

    except InterruptedError:
        put(("error", "Generation stopped by user."))
    except Exception as exc:
        import traceback
        put(("error", f"{exc}\n\n{traceback.format_exc()}"))
    finally:
        LOG.removeHandler(handler)


# ══════════════════════════════════════════════════════════════════════════════
# Entry point (CLI)
# ══════════════════════════════════════════════════════════════════════════════

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a large personalized Spotify cross-genre discovery playlist."
    )
    parser.add_argument(
        "--data-dir", default="./my_spotify_data",
        help="Path to your Spotify data export — folder or .zip (default: ./my_spotify_data)",
    )
    parser.add_argument("--size", type=int, default=175,
                        help="Target playlist track count (default: 175)")
    parser.add_argument("--clusters", type=int, default=6,
                        help="Number of taste-mood clusters (default: 6)")
    parser.add_argument("--verbose", action="store_true", default=True)
    args = parser.parse_args()

    if args.verbose:
        LOG.setLevel(logging.DEBUG)

    print("=== Spotify Radio Generator ===")

    # ── Auth (before spawning pipeline thread) ──────────────────────────────
    config = load_or_create_config()
    if not check_token(config):
        print(
            f"\nIMPORTANT: Add this Redirect URI to your Spotify app first:\n"
            f"  {REDIRECT_URI}\n"
            f"(dashboard.spotify.com → your app → Edit Settings → Redirect URIs)\n"
        )
        # SpotifyOAuth with open_browser=True starts a local server on 127.0.0.1
        # that captures the redirect automatically — no copy-paste needed.
        auth = SpotifyOAuth(
            client_id=config["client_id"],
            client_secret=config["client_secret"],
            redirect_uri=REDIRECT_URI,
            scope=SCOPE,
            cache_path=CACHE_FILE,
            open_browser=True,
        )
        print("Opening Spotify login in your browser…")
        # Calling current_user() triggers the full interactive auth flow
        tmp_sp = spotipy.Spotify(auth_manager=auth)
        tmp_sp.current_user()
        print("Login successful.\n")

    # ── Run pipeline, printing messages to stdout ───────────────────────────
    settings = {"data_dir": args.data_dir, "size": args.size, "clusters": args.clusters}
    msg_q: queue.Queue = queue.Queue()
    stop_ev = threading.Event()

    t = threading.Thread(target=run_pipeline, args=(settings, msg_q, stop_ev), daemon=True)
    t.start()

    while t.is_alive() or not msg_q.empty():
        try:
            msg = msg_q.get(timeout=0.1)
        except queue.Empty:
            continue

        kind = msg[0]
        if kind == "log":
            if msg[1] != "DEBUG" or args.verbose:
                print(msg[2])
        elif kind == "step":
            print(f"\n[{msg[1]}/6] {msg[3]}")
        elif kind == "track":
            print(f"  ♫  {msg[1]} — {msg[2]}")
        elif kind == "done":
            _, url, summary = msg
            print(f"\n{'='*62}")
            print(f"  Playlist: {url}")
            print(f"  Tracks:   {summary['total']}")
            for mood, count in summary["mood_counts"].items():
                print(f"    {mood}: {count}")
            print(f"  Top artists: {', '.join(summary['top_artists'])}")
            print(f"{'='*62}\n")
            return 0
        elif kind == "error":
            print(f"\nERROR: {msg[1]}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
