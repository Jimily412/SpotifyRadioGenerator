# Spotify Radio Generator — Project Handoff Prompt

## Purpose of this document
This is a complete technical handoff for the **Spotify Radio Generator** project.
Use it to diagnose errors and draft a precise fix prompt to give to Claude Code
(the only agent that should touch the code). Do NOT modify the files yourself.

---

## Project goal
A Python desktop app that reads a user's Spotify data export (zip file), clusters
their listening history into taste-mood groups using K-Means, discovers new songs
via Spotify's API, and creates a 150–200 track playlist automatically.

---

## Repository
- **Path on disk:** `/home/user/SpotifyRadioGenerator`
- **Active branch:** `claude/spotify-playlist-generator-Iabgs`
- **Remote:** `jimily412/spotifyradiogenerator` (GitHub)
- **Last commit:** `43536d8` — "Wire genre-based fallback path into run_pipeline for 403-blocked endpoints"

---

## File inventory

| File | Purpose |
|---|---|
| `generate_playlist.py` | Full pipeline (~1400 lines): data parsing, Spotify auth, clustering, discovery, playlist creation |
| `gui.py` | tkinter GUI (~380 lines): settings panel, progress bar, live song list, auto-update scheduler |
| `config.json` | Spotify API credentials (`client_id`, `client_secret`) |
| `requirements.txt` | `spotipy>=2.23.0`, `scikit-learn>=1.3.0`, `numpy>=1.24.0`, `requests>=2.31.0` |
| `.spotify_cache` | Spotipy OAuth token cache (auto-created) |
| `.audio_features_cache.json` | Disk cache for audio features (auto-created, avoids re-fetching) |

---

## Credentials (in config.json)
```json
{"client_id": "715f159d73c8495eb739c0e6ed082355", "client_secret": "78643b0ab4e64f3ca79ce0ab45a8310b"}
```

---

## How to run
```bash
# GUI
python gui.py

# CLI
python generate_playlist.py --data-dir ./my_spotify_data.zip --size 175 --clusters 6
```

The user's data export is a zip file at:
`C:\Ayden\Chrome Downloads\my_spotify_data.zip`

---

## Architecture — generate_playlist.py

### Constants
```python
REDIRECT_URI = "http://127.0.0.1:8888/callback"   # NOT localhost — avoids Chrome HSTS upgrade
SCOPE = "user-library-read playlist-modify-private playlist-modify-public user-top-read"
CACHE_FILE = ".spotify_cache"
```

### Pipeline steps (run_pipeline function, ~line 1134)
```
Step 1  Parse data export (YourLibrary.json + Streaming_History_Audio_*.json)
Step 2  Connect to Spotify (SpotifyOAuth, cached token)
Step 3  Resolve track IDs → try audio-features → cluster (DUAL MODE — see below)
Step 4  Harvest discovery candidates per cluster (DUAL MODE)
Step 5  Score, deduplicate, select final tracks (DUAL MODE)
Step 6  Create Spotify playlist via API, return URL
```

### DUAL MODE (the most recently added logic)
Spotify restricted `/v1/audio-features` and `/v1/recommendations` to apps with
"Extended Quota Mode" in late 2023. The app handles this with two fully separate paths:

**Audio-features path** (if endpoint returns data):
- `build_feature_matrix` → 7-dim vector per track [danceability, energy, valence, tempo, acousticness, instrumentalness, speechiness]
- K-Means clustering
- `harvest_recommendations` (uses `/v1/recommendations`)
- `score_and_select` (Euclidean distance to cluster centroid)

**Genre fallback path** (if `/v1/audio-features` returns 403, `feat_map == {}`):
- `fetch_track_details` — `/v1/tracks` (50/batch) → gets artist IDs
- `fetch_artist_genres` — `/v1/artists` (50/batch) → genres + popularity per artist
- `build_genre_matrix` — one-hot genre vectors (top 70 genres) + popularity column
- K-Means clustering on genre matrix
- Cluster descriptions derived from top-3 genres per cluster
- `_genres` list attached to each `top_tracks` entry for scoring
- `harvest_via_related_artists` — `artist_related_artists` + `artist_top_tracks` (both unrestricted)
- `score_and_select_by_genre` — genre overlap (80%) + popularity (20%)

### Key functions and approximate line numbers
```
_make_auth(config)                  ~138   Builds SpotifyOAuth consistently
check_token(config)                 ~149   Returns True if cached token is valid
create_spotify_client(config)       ~395   Returns (sp, user_id)
spotify_retry(fn, ...)              ~173   Exponential backoff on 429/5xx
load_liked_tracks(...)              ~221   Reads YourLibrary.json
load_streaming_history(...)         ~252   Reads Streaming_History_Audio_*.json (extended format)
build_weighted_tracks(...)          ~340   Merges liked + history, sorts by weight
resolve_tracks_to_ids(sp, tracks)   ~414   URI-first, then search API for the rest
fetch_audio_features(sp, ids)       ~465   100/batch, disk-cached, returns {} on 403
fetch_track_details(sp, ids)        ~510   50/batch, gets full track objects
fetch_artist_genres(sp, ids)        ~526   50/batch, returns {id: {name, genres, popularity}}
build_genre_matrix(tracks, ...)     ~549   Returns (np.ndarray, valid_tracks)
harvest_via_related_artists(...)    ~590   related_artists → top_tracks for each cluster
score_and_select_by_genre(...)      ~659   Genre overlap scoring, quota per cluster
_describe_cluster(centroid_norm)    ~757   Returns "Mixed" if len != 7 (guards genre mode)
cluster_tracks(tracks, matrix, k)   ~791   K-Means, guards k <= len//2
build_cluster_profiles(...)         ~805   Builds centroid/top_tracks/weight per cluster
compute_quotas(profiles, total)     ~863   Proportional distribution with min floor=15
harvest_recommendations(...)        ~892   Uses /v1/recommendations (may 403)
score_and_select(sp, ...)           ~990   Audio-features scoring (uses fetch_audio_features again)
create_playlist(sp, ...)            ~1074  Creates playlist, adds tracks in 100/batch
run_pipeline(settings, queue, ev)   ~1134  Full pipeline, all steps, queue-based messaging
main()                              ~1295  CLI entry point
```

### Queue message protocol (run_pipeline → GUI/CLI)
```python
("log",   levelname, text)             # log line
("step",  n, total, description)       # major step started
("track", name, artist, cluster_desc)  # a track was selected
("done",  playlist_url, summary_dict)  # success
("error", message)                     # fatal failure
```

---

## Architecture — gui.py

### Key classes/methods
```
App.__init__          Builds all UI panels
App._apply_style      Spotify green #1DB954 theme
App._build_settings   Data path entry, ZIP/folder browse, size/clusters spinboxes
App._build_auto_update Checkbox + interval, calls _check_auto_update every hour
App._build_controls   Generate / Stop buttons, step label, progress bar
App._build_activity   Notebook: dark log tab + Songs treeview tab
App._do_auth(config)  Modal dialog; opens browser; auto-closes when auth completes
App._poll()           Called every 80ms; drains queue; updates all UI elements
App._add_song()       Inserts row to treeview, updates tab badge
```

Config keys persisted in `config.json`:
`client_id`, `client_secret`, `last_run`, `auto_update_enabled`, `auto_update_days`

---

## Data format notes

The user's export is **Extended Streaming History** format (not the standard export).

Files present in zip:
- `Streaming_History_Audio_YYYY-YY_N.json` — play history (NOT `StreamingHistory_music_*.json`)
- No `YourLibrary.json` present (liked songs file is missing from this export)

Extended history entry fields used:
```python
artist = entry.get("master_metadata_album_artist_name")
track  = entry.get("master_metadata_track_name")
ms     = entry.get("ms_played")
uri    = entry.get("spotify_track_uri")   # "spotify:track:XXXXX" — skips search API
```

Tracks played < 30 000 ms are skipped as skips.
Play score: `math.log1p(total_ms / 60_000)` (log-scale minutes)

---

## Known fixed issues (do not re-introduce)

1. **HSTS redirect failure** — Chrome upgrades `http://localhost` to HTTPS, breaking OAuth.
   Fix: use `http://127.0.0.1:8888/callback` (IP addresses bypass HSTS).

2. **File not found in zip** — Spotify's zip has a subdirectory prefix. Fix: match by
   `os.path.basename(e)` not full path when scanning `zf.namelist()`.

3. **Wrong history filename pattern** — Extended export uses `Streaming_History_Audio_*.json`,
   not `StreamingHistory_music_*.json`. Fix: `_is_history_file()` matches both patterns.

4. **403 on audio-features** — Spotify blocked this endpoint. Fix: `fetch_audio_features`
   catches 403 and returns `{}`. `run_pipeline` checks `if feat_map:` to branch paths.

5. **_describe_cluster crash in genre mode** — Centroid is 71-dim in genre mode but the
   function destructured exactly 7 values. Fix: guard `if len(centroid_norm) != 7: return "Mixed"`.

---

## What to tell Claude Code when providing a fix

Structure your prompt to Claude Code like this:

```
Branch: claude/spotify-playlist-generator-Iabgs
File to edit: generate_playlist.py (and/or gui.py if GUI-related)

[Paste the error traceback here]

The error occurs at [function name, approx line number].
Root cause: [your diagnosis from reading the traceback]

Fix needed:
- [specific change 1]
- [specific change 2]

Do NOT change: [anything unrelated to the fix]
After fixing, commit and push to the branch above.
```

---

## Errors to diagnose (paste new traceback below)

```
[PASTE THE ERROR TRACEBACK HERE]
```

---

## Diagnostic questions to answer before writing the fix prompt

1. Which function does the traceback point to? (look at the last few frames)
2. Is it in the audio-features path or genre fallback path?
   - Genre path is active when `feat_map == {}` (i.e. audio-features returned 403)
   - Look for calls to `fetch_track_details`, `fetch_artist_genres`, `build_genre_matrix`,
     `harvest_via_related_artists`, `score_and_select_by_genre`
3. Is it a KeyError / AttributeError / TypeError? (data shape mismatch)
4. Is it a SpotifyException? (check `exc.http_status`)
5. Is it in `resolve_tracks_to_ids`? That function modifies dicts with `.copy()` — any
   in-place mutation elsewhere could cause stale data issues.
6. Is it in `build_cluster_profiles`? Check whether `valid_tracks` is empty (would mean
   genre matrix had no rows, which means no artist IDs were resolved).
7. Is it in `score_and_select_by_genre`? Check whether `t.get("_genres")` is set on
   `top_tracks` — this is only set in the genre fallback branch of `run_pipeline`.

---

## Common data shapes to verify

```python
# resolved tracks (after resolve_tracks_to_ids + artist_id attachment)
{"key": "artist||track", "artist": str, "track": str, "uri": str,
 "weight": float, "is_liked": bool, "play_count": int,
 "spotify_id": str, "artist_id": str}   # artist_id only in genre path

# genre-path candidates (from harvest_via_related_artists)
{"spotify_id": str, "name": str, "artist": str, "uri": str,
 "cluster_id": int, "rel_genres": list, "rel_popularity": int}

# profile["top_tracks"] in genre path — must have _genres attached
{"_genres": list, "artist_id": str, "weight": float, ...}

# profile dict
{"id": int, "description": str, "centroid_norm": np.ndarray,
 "top_tracks": list, "total_weight": float, "track_count": int, "all_ids": set}
```
