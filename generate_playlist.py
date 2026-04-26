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
import random
import time
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

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
REDIRECT_URI = "http://localhost:8888/callback"
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
) -> Tuple[Dict[str, float], Dict[str, int]]:
    """
    Read all StreamingHistory_music_*.json files from a directory or zip archive.
    Handles both old (artistName/trackName/msPlayed) and new (master_metadata_*/ms_played)
    Spotify export formats.

    Returns:
        play_scores  – log-scaled listening score per track key
        play_counts  – raw play count per track key (for heavy-play detection)
    """
    # Collect the list of matching filenames from whichever source we have
    if zf is not None:
        history_names = sorted(
            os.path.basename(e)
            for e in zf.namelist()
            if fnmatch.fnmatch(os.path.basename(e), "StreamingHistory_music_*.json")
        )
    else:
        history_names = sorted(p.name for p in data_dir.glob("StreamingHistory_music_*.json"))

    if not history_names:
        LOG.warning("No StreamingHistory_music_*.json files found")
        return {}, {}

    play_ms: Dict[str, float] = defaultdict(float)
    play_counts: Dict[str, int] = defaultdict(int)

    for name in history_names:
        LOG.debug(f"Loading {name}")
        with _open_data_file(name, data_dir, zf) as f:
            entries = json.load(f)

        for entry in entries:
            # Old format uses "artistName"/"trackName"/"msPlayed"
            # New extended format uses master_metadata_* / "ms_played"
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
                # Skip rows with missing data or tracks played for less than 30 s
                # (short plays are almost certainly skips, not genuine listens)
                continue

            key = f"{artist.lower()}||{track.lower()}"
            play_ms[key] += ms
            play_counts[key] += 1

    play_scores = {k: math.log1p(v / 60_000) for k, v in play_ms.items()}
    LOG.info(
        f"Streaming history: {len(play_scores)} unique tracks, "
        f"{sum(play_counts.values())} total qualifying plays"
    )
    return play_scores, play_counts


def build_weighted_tracks(
    liked: Dict[str, dict],
    play_scores: Dict[str, float],
    play_counts: Dict[str, int],
    top_n: int = 500,
) -> Tuple[List[dict], Set[str]]:
    """
    Merge liked library and play history.
    final_weight = liked_base (3.0 if liked, else 0) + log_play_score

    Returns:
        tracks         – top_n entries sorted descending by weight
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
        tracks.append(
            {
                "key": key,
                "artist": artist,
                "track": trk,
                "uri": base.get("uri", ""),
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
    """Authenticate via OAuth Authorization Code flow. Returns (client, user_id)."""
    auth = SpotifyOAuth(
        client_id=config["client_id"],
        client_secret=config["client_secret"],
        redirect_uri=REDIRECT_URI,
        scope=SCOPE,
        cache_path=CACHE_FILE,
        open_browser=True,
    )
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
    """Fetch audio features in 100-track batches (Spotify API maximum)."""
    features_map: Dict[str, dict] = {}
    batch_size = 100
    n_batches = math.ceil(len(track_ids) / batch_size)

    LOG.info(f"Fetching audio features for {len(track_ids)} tracks ({n_batches} batches)...")
    for i in range(n_batches):
        batch = track_ids[i * batch_size : (i + 1) * batch_size]
        LOG.debug(f"  Batch {i + 1}/{n_batches}")
        results = spotify_retry(sp.audio_features, batch) or []
        for feat in results:
            if feat:
                features_map[feat["id"]] = feat
        time.sleep(0.15)

    LOG.info(f"Audio features: {len(features_map)}/{len(track_ids)} tracks resolved")
    return features_map


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
# Entry point
# ══════════════════════════════════════════════════════════════════════════════

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a large personalized Spotify cross-genre discovery playlist."
    )
    parser.add_argument(
        "--data-dir",
        default="./my_spotify_data",
        help=(
            "Path to your Spotify data export — either an extracted folder "
            "or the original .zip file (default: ./my_spotify_data)"
        ),
    )
    parser.add_argument(
        "--size",
        type=int,
        default=175,
        help="Target number of tracks in the playlist (default: 175)",
    )
    parser.add_argument(
        "--clusters",
        type=int,
        default=6,
        help="Number of taste-mood clusters (default: 6)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        default=True,
        help="Verbose debug logging (default: on)",
    )
    args = parser.parse_args()

    if args.verbose:
        LOG.setLevel(logging.DEBUG)

    data_path = Path(args.data_dir)
    LOG.info("=== Spotify Radio Generator ===")
    LOG.info(f"Target: {args.size} tracks | Clusters: {args.clusters} | Data: {data_path.resolve()}")

    # ── 1. Load & weight data ────────────────────────────────────────────────
    LOG.info("\n[1/6] Parsing Spotify data export...")

    # Accept either a directory or a .zip file — no extraction required
    zf: Optional[zipfile.ZipFile] = None
    data_dir = data_path  # used only when not reading from a zip
    if data_path.suffix.lower() == ".zip":
        if not data_path.exists():
            LOG.error(f"Zip file not found: {data_path}")
            return 1
        LOG.info(f"Reading directly from zip: {data_path.name}")
        zf = zipfile.ZipFile(data_path, "r")
    elif not data_path.is_dir():
        LOG.error(f"--data-dir must be a folder or a .zip file: {data_path}")
        return 1

    try:
        liked = load_liked_tracks(data_dir, zf)
        play_scores, play_counts = load_streaming_history(data_dir, zf)
    finally:
        if zf is not None:
            zf.close()

    tracks, heavy_keys = build_weighted_tracks(liked, play_scores, play_counts, top_n=500)

    if not tracks:
        LOG.error("No tracks found. Make sure --data-dir points to your Spotify data export.")
        return 1

    # ── 2. Auth ──────────────────────────────────────────────────────────────
    LOG.info("\n[2/6] Authenticating with Spotify...")
    config = load_or_create_config()
    sp, user_id = create_spotify_client(config)

    # ── 3. Resolve IDs, features, cluster ───────────────────────────────────
    LOG.info("\n[3/6] Resolving track IDs and clustering audio fingerprints...")
    resolved = resolve_tracks_to_ids(sp, tracks)
    all_ids = [t["spotify_id"] for t in resolved]

    feat_map = fetch_audio_features(sp, all_ids)
    matrix, valid_tracks = build_feature_matrix(resolved, feat_map)
    LOG.info(f"Tracks with audio features: {len(valid_tracks)}")

    if len(valid_tracks) < args.clusters * 2:
        LOG.error("Too few tracks with audio features for clustering. Try a larger --data-dir.")
        return 1

    labels, _ = cluster_tracks(valid_tracks, matrix, args.clusters)
    n_actual_clusters = len(set(labels))
    profiles = build_cluster_profiles(valid_tracks, matrix, labels, n_actual_clusters)

    # Build the exclusion set: liked tracks + heavily-played tracks
    liked_ids: Set[str] = {
        t["spotify_id"] for t in valid_tracks if t.get("is_liked") and t.get("spotify_id")
    }
    heavy_ids: Set[str] = {
        t["spotify_id"] for t in valid_tracks if t["key"] in heavy_keys and t.get("spotify_id")
    }
    exclude_ids = liked_ids | heavy_ids
    LOG.info(f"Excluding {len(exclude_ids)} already-known tracks from recommendations")

    # ── 4. Harvest recommendations ───────────────────────────────────────────
    LOG.info("\n[4/6] Harvesting recommendations from each cluster...")
    quotas = compute_quotas(profiles, args.size)
    LOG.info(f"Quotas per cluster: {quotas}  (total={sum(quotas)})")

    all_candidates: List[dict] = []
    for profile, quota in zip(profiles, quotas):
        LOG.info(f"  → Cluster {profile['id']} [{profile['description']}] quota={quota}")
        cands = harvest_recommendations(sp, profile, quota, exclude_ids)
        all_candidates.extend(cands)

    LOG.info(f"Total raw candidates collected: {len(all_candidates)}")

    if not all_candidates:
        LOG.error(
            "No recommendation candidates collected.\n"
            "  The Spotify recommendations endpoint requires Extended Quota Mode.\n"
            "  Visit https://developer.spotify.com/dashboard → your app → Request Extension."
        )
        return 1

    # ── 5. Score and select ──────────────────────────────────────────────────
    LOG.info("\n[5/6] Scoring candidates and selecting final tracks...")
    final_tracks = score_and_select(sp, all_candidates, profiles, quotas, args.size)
    LOG.info(f"Final selection: {len(final_tracks)} tracks")

    # ── 6. Create playlist ───────────────────────────────────────────────────
    LOG.info("\n[6/6] Creating Spotify playlist...")
    playlist_name = f"All Stations Mix — {datetime.now().strftime('%Y-%m-%d')}"
    url = create_playlist(sp, user_id, final_tracks, playlist_name)

    print_summary(final_tracks, profiles, url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
