#!/usr/bin/env python3
"""
Spotify Radio Generator — GUI
Run this file for the graphical interface.
    python gui.py
"""
import json
import os
import queue
import threading
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext

import spotipy
from spotipy.oauth2 import SpotifyOAuth

import generate_playlist as core

CONFIG_FILE = "config.json"


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Spotify Radio Generator")
        self.root.geometry("860x740")
        self.root.minsize(720, 600)
        self.root.columnconfigure(0, weight=1)

        self._q: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._running = False
        self._config: dict = {}
        self._song_count = 0
        self._playlist_url = ""

        self._apply_style()
        self._build_settings()
        self._build_auto_update()
        self._build_controls()
        self._build_activity()
        self._build_statusbar()

        self._load_config()
        self._poll(schedule=True)
        # Defer auto-update check so the window is fully drawn first
        self.root.after(2000, self._check_auto_update)

    # ── Style ──────────────────────────────────────────────────────────────────

    def _apply_style(self) -> None:
        s = ttk.Style(self.root)
        try:
            s.theme_use("clam")
        except Exception:
            pass
        s.configure("TLabelframe.Label", font=("Segoe UI", 9, "bold"))
        s.configure("TButton", padding=(10, 4))
        s.configure("TSpinbox", padding=(4, 2))
        s.configure("Generate.TButton",
                    foreground="white", background="#1DB954",
                    font=("Segoe UI", 10, "bold"), padding=(16, 7))
        s.map("Generate.TButton",
              background=[("active", "#18a349"), ("disabled", "#999999")],
              foreground=[("disabled", "#cccccc")])
        s.configure("Treeview", rowheight=24, font=("Segoe UI", 9))
        s.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))
        s.configure("TNotebook.Tab", padding=(12, 5))

    # ── Settings ───────────────────────────────────────────────────────────────

    def _build_settings(self) -> None:
        sf = ttk.LabelFrame(self.root, text="Settings", padding=(12, 8))
        sf.grid(row=0, column=0, padx=12, pady=(12, 4), sticky="ew")
        sf.columnconfigure(1, weight=1)

        ttk.Label(sf, text="Spotify Data:").grid(row=0, column=0, sticky="w")
        self._data_var = tk.StringVar()
        ttk.Entry(sf, textvariable=self._data_var,
                  font=("Consolas", 9)).grid(row=0, column=1, padx=6, sticky="ew")

        btn_frame = ttk.Frame(sf)
        btn_frame.grid(row=0, column=2)
        ttk.Button(btn_frame, text="ZIP…",    width=6,  command=self._browse_zip).pack(side="left", padx=(0, 2))
        ttk.Button(btn_frame, text="Folder…", width=7,  command=self._browse_folder).pack(side="left")

        ttk.Label(sf, text="  Accepts .zip or an extracted folder",
                  foreground="#888888", font=("Segoe UI", 8)).grid(
            row=1, column=1, sticky="w", padx=6)

        pf = ttk.Frame(sf)
        pf.grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 2))
        ttk.Label(pf, text="Playlist Size:").pack(side="left")
        self._size_var = tk.IntVar(value=175)
        ttk.Spinbox(pf, from_=50, to=500, textvariable=self._size_var,
                    width=6).pack(side="left", padx=(4, 2))
        ttk.Label(pf, text="tracks          Taste Clusters:").pack(side="left")
        self._clusters_var = tk.IntVar(value=6)
        ttk.Spinbox(pf, from_=2, to=12, textvariable=self._clusters_var,
                    width=5).pack(side="left", padx=(4, 2))
        ttk.Label(pf, text="mood groups").pack(side="left")

    # ── Auto-update ────────────────────────────────────────────────────────────

    def _build_auto_update(self) -> None:
        af = ttk.LabelFrame(self.root, text="Auto-Update", padding=(12, 8))
        af.grid(row=1, column=0, padx=12, pady=4, sticky="ew")
        af.columnconfigure(4, weight=1)

        self._auto_var = tk.BooleanVar()
        ttk.Checkbutton(af, text="Regenerate every",
                        variable=self._auto_var).grid(row=0, column=0, sticky="w")
        self._days_var = tk.IntVar(value=7)
        ttk.Spinbox(af, from_=1, to=30, textvariable=self._days_var,
                    width=4).grid(row=0, column=1, padx=(4, 2))
        ttk.Label(af, text="days").grid(row=0, column=2, sticky="w")

        self._sched_lbl = ttk.Label(af, text="Last run: never",
                                     foreground="#888888", font=("Segoe UI", 8))
        self._sched_lbl.grid(row=0, column=4, sticky="e", padx=(0, 4))

    # ── Controls ───────────────────────────────────────────────────────────────

    def _build_controls(self) -> None:
        cf = ttk.Frame(self.root, padding=(12, 6))
        cf.grid(row=2, column=0, sticky="ew")
        cf.columnconfigure(3, weight=1)

        self._gen_btn = ttk.Button(cf, text="▶   Generate Playlist",
                                    style="Generate.TButton", command=self._on_generate)
        self._gen_btn.grid(row=0, column=0)

        self._stop_btn = ttk.Button(cf, text="■  Stop",
                                     command=self._on_stop, state="disabled")
        self._stop_btn.grid(row=0, column=1, padx=(8, 0))

        right = ttk.Frame(cf)
        right.grid(row=0, column=3, sticky="e")
        self._step_lbl = ttk.Label(right, text="", foreground="#666666",
                                    font=("Segoe UI", 9))
        self._step_lbl.pack(side="left", padx=(0, 10))
        self._progress = ttk.Progressbar(right, mode="determinate", maximum=6, length=200)
        self._progress.pack(side="right")

    # ── Activity notebook ──────────────────────────────────────────────────────

    def _build_activity(self) -> None:
        self.root.rowconfigure(3, weight=1)
        nb = ttk.Notebook(self.root)
        nb.grid(row=3, column=0, padx=12, pady=4, sticky="nsew")
        self._nb = nb

        # ── Log tab ─────────────────────────────────────────────────
        lf = ttk.Frame(nb)
        lf.columnconfigure(0, weight=1)
        lf.rowconfigure(0, weight=1)
        nb.add(lf, text="  Log  ")

        self._log = scrolledtext.ScrolledText(
            lf, state="disabled",
            font=("Consolas", 9),
            background="#1a1a2e", foreground="#e0e0e0",
            insertbackground="white", relief="flat", wrap="word",
        )
        self._log.grid(sticky="nsew")
        self._log.tag_configure("DEBUG",   foreground="#777777")
        self._log.tag_configure("INFO",    foreground="#d0d0d0")
        self._log.tag_configure("WARNING", foreground="#f0ad4e")
        self._log.tag_configure("ERROR",   foreground="#ef5350")
        self._log.tag_configure("STEP",    foreground="#1DB954",
                                 font=("Consolas", 9, "bold"))

        # ── Songs tab ───────────────────────────────────────────────
        sf = ttk.Frame(nb)
        sf.columnconfigure(0, weight=1)
        sf.rowconfigure(0, weight=1)
        nb.add(sf, text="  Songs Added (0)  ")
        self._songs_tab_idx = 1

        cols = ("№", "Song", "Artist", "Mood")
        self._tree = ttk.Treeview(sf, columns=cols, show="headings")
        for col, w, anc, stretch in zip(
            cols, [38, 300, 200, 190], ["center", "w", "w", "w"], [False, True, False, False]
        ):
            self._tree.heading(col, text=col)
            self._tree.column(col, width=w, anchor=anc, stretch=stretch)
        self._tree.tag_configure("even", background="#f4f4f4")
        self._tree.tag_configure("odd",  background="#ffffff")

        vsb = ttk.Scrollbar(sf, orient="vertical", command=self._tree.yview)
        self._tree.configure(yscrollcommand=vsb.set)
        self._tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")

    # ── Status bar ─────────────────────────────────────────────────────────────

    def _build_statusbar(self) -> None:
        sb = ttk.Frame(self.root, relief="sunken")
        sb.grid(row=4, column=0, sticky="ew")
        sb.columnconfigure(0, weight=1)

        self._status_var = tk.StringVar(value="Ready")
        ttk.Label(sb, textvariable=self._status_var,
                  anchor="w", padding=(8, 3)).grid(row=0, column=0, sticky="ew")

        self._link_lbl = ttk.Label(
            sb, text="", foreground="#1DB954", cursor="hand2",
            font=("Segoe UI", 9, "underline"), padding=(8, 3),
        )
        self._link_lbl.grid(row=0, column=1, sticky="e")
        self._link_lbl.bind(
            "<Button-1>",
            lambda _: webbrowser.open(self._playlist_url) if self._playlist_url else None,
        )

    # ── Config persistence ─────────────────────────────────────────────────────

    def _load_config(self) -> None:
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, encoding="utf-8") as f:
                    self._config = json.load(f)
            except Exception:
                self._config = {}
        self._data_var.set(self._config.get("data_dir", ""))
        self._size_var.set(self._config.get("size", 175))
        self._clusters_var.set(self._config.get("clusters", 6))
        self._auto_var.set(self._config.get("auto_update_enabled", False))
        self._days_var.set(self._config.get("auto_update_days", 7))
        self._refresh_sched_label()

    def _save_config(self) -> None:
        self._config.update({
            "data_dir": self._data_var.get().strip(),
            "size": self._size_var.get(),
            "clusters": self._clusters_var.get(),
            "auto_update_enabled": self._auto_var.get(),
            "auto_update_days": self._days_var.get(),
        })
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(self._config, f, indent=2)

    def _refresh_sched_label(self) -> None:
        last = self._config.get("last_run")
        if not last:
            self._sched_lbl.config(text="Last run: never")
            return
        last_dt = datetime.fromisoformat(last)
        text = f"Last: {last_dt.strftime('%Y-%m-%d %H:%M')}"
        if self._auto_var.get():
            nxt = last_dt + timedelta(days=self._days_var.get())
            text += f"   Next: {nxt.strftime('%Y-%m-%d')}"
        self._sched_lbl.config(text=text)

    # ── Auto-update ────────────────────────────────────────────────────────────

    def _check_auto_update(self) -> None:
        if not self._running and self._auto_var.get():
            last = self._config.get("last_run")
            if last:
                due = datetime.fromisoformat(last) + timedelta(days=self._days_var.get())
                if datetime.now() >= due:
                    self._append_log("Auto-update due — starting generation…", "STEP")
                    self._on_generate()
        self.root.after(3_600_000, self._check_auto_update)  # re-check every hour

    # ── File browsers ──────────────────────────────────────────────────────────

    def _browse_zip(self) -> None:
        p = filedialog.askopenfilename(
            title="Select your Spotify data export ZIP",
            filetypes=[("ZIP archive", "*.zip"), ("All files", "*")],
        )
        if p:
            self._data_var.set(p)

    def _browse_folder(self) -> None:
        p = filedialog.askdirectory(title="Select extracted Spotify data folder")
        if p:
            self._data_var.set(p)

    # ── Generate / Stop ────────────────────────────────────────────────────────

    def _on_generate(self) -> None:
        if self._running:
            return
        data = self._data_var.get().strip()
        if not data:
            messagebox.showwarning("No data selected",
                                   "Please enter the path to your Spotify data export.")
            return

        self._save_config()

        # Auth must happen on the main thread
        try:
            config = core.load_or_create_config()
            if not core.check_token(config):
                if not self._do_auth(config):
                    return
        except Exception as exc:
            messagebox.showerror("Authentication error", str(exc))
            return

        self._clear_results()
        self._set_running(True)
        self._stop.clear()
        threading.Thread(
            target=core.run_pipeline,
            args=(
                {"data_dir": data, "size": self._size_var.get(),
                 "clusters": self._clusters_var.get()},
                self._q,
                self._stop,
            ),
            daemon=True,
        ).start()

    def _on_stop(self) -> None:
        self._stop.set()
        self._status_var.set("Stopping…")

    # ── OAuth dialog ───────────────────────────────────────────────────────────

    def _do_auth(self, config: dict) -> bool:
        """
        Authenticate with Spotify.

        Strategy: open the browser to the Spotify login page and start a local
        HTTP server on 127.0.0.1:8888 (via spotipy) that captures the redirect
        automatically.  This works because browsers don't apply HSTS to IP
        addresses, unlike 'localhost'.  The dialog stays open until auth
        completes or the user cancels.
        """
        result: list = [None]  # True = success, str = error message

        dlg = tk.Toplevel(self.root)
        dlg.title("Spotify Login")
        dlg.geometry("520x240")
        dlg.resizable(False, False)
        dlg.transient(self.root)
        dlg.grab_set()

        ttk.Label(dlg, text="Connecting to Spotify…",
                  font=("Segoe UI", 12, "bold")).pack(pady=(22, 6))
        ttk.Label(
            dlg,
            text=(
                "Your browser will open the Spotify login page.\n"
                "Log in and click Agree — the app will finish automatically.\n\n"
                "First time only: make sure you've added\n"
                f"  {core.REDIRECT_URI}\n"
                "to your Spotify app's Redirect URIs in the Developer Dashboard."
            ),
            justify="center", font=("Segoe UI", 9),
        ).pack(padx=24)

        spinner_lbl = ttk.Label(dlg, text="Waiting for browser login…",
                                 foreground="#1DB954")
        spinner_lbl.pack(pady=(12, 0))

        cancel_btn = ttk.Button(dlg, text="Cancel", command=dlg.destroy)
        cancel_btn.pack(pady=8)

        def auth_worker() -> None:
            try:
                # SpotifyOAuth with open_browser=True:
                #  1. Opens the browser to the Spotify login page
                #  2. Starts a local HTTP server on 127.0.0.1:8888 to catch the redirect
                #  3. Blocks until the redirect arrives
                # Using 127.0.0.1 (not localhost) avoids Chrome/Edge HSTS upgrades.
                auth = SpotifyOAuth(
                    client_id=config["client_id"],
                    client_secret=config["client_secret"],
                    redirect_uri=core.REDIRECT_URI,
                    scope=core.SCOPE,
                    cache_path=core.CACHE_FILE,
                    open_browser=True,
                )
                sp = spotipy.Spotify(auth_manager=auth)
                sp.current_user()  # triggers the full interactive flow
                result[0] = True
            except Exception as exc:
                result[0] = str(exc)
            finally:
                # Schedule dialog close on the main thread
                self.root.after(0, dlg.destroy)

        threading.Thread(target=auth_worker, daemon=True).start()
        dlg.wait_window()

        if result[0] is True:
            return True
        if result[0] is not None:  # error string
            messagebox.showerror("Login failed", str(result[0]))
        return False

    # ── UI helpers ─────────────────────────────────────────────────────────────

    def _set_running(self, state: bool) -> None:
        self._running = state
        self._gen_btn.config(state="disabled" if state else "normal")
        self._stop_btn.config(state="normal" if state else "disabled")
        if not state:
            self._progress["value"] = 0

    def _clear_results(self) -> None:
        self._log.config(state="normal")
        self._log.delete("1.0", "end")
        self._log.config(state="disabled")
        self._tree.delete(*self._tree.get_children())
        self._song_count = 0
        self._nb.tab(self._songs_tab_idx, text="  Songs Added (0)  ")
        self._link_lbl.config(text="")
        self._playlist_url = ""
        self._progress["value"] = 0
        self._step_lbl.config(text="")
        self._status_var.set("")

    def _append_log(self, text: str, tag: str = "INFO") -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        self._log.config(state="normal")
        self._log.insert("end", f"{ts}  {text}\n", tag)
        self._log.see("end")
        self._log.config(state="disabled")

    def _add_song(self, name: str, artist: str, mood: str) -> None:
        self._song_count += 1
        tag = "even" if self._song_count % 2 == 0 else "odd"
        self._tree.insert("", "end",
                           values=(self._song_count, name, artist, mood), tags=(tag,))
        self._tree.yview_moveto(1)
        self._nb.tab(self._songs_tab_idx,
                      text=f"  Songs Added ({self._song_count})  ")

    # ── Queue polling ──────────────────────────────────────────────────────────

    def _poll(self, schedule: bool = False) -> None:
        try:
            while True:
                msg = self._q.get_nowait()
                kind = msg[0]

                if kind == "log":
                    _, level, text = msg
                    self._append_log(text, level)

                elif kind == "step":
                    _, n, total, desc = msg
                    self._progress["value"] = n
                    self._step_lbl.config(text=f"Step {n}/{total}")
                    self._status_var.set(desc)
                    self._append_log(f"── {desc}", "STEP")

                elif kind == "track":
                    _, name, artist, mood = msg
                    self._add_song(name, artist, mood)

                elif kind == "done":
                    _, url, summary = msg
                    self._playlist_url = url
                    top = ", ".join(summary.get("top_artists", []))
                    self._status_var.set(
                        f"✓  {summary['total']} tracks added   Top: {top}"
                    )
                    self._link_lbl.config(text="▶  Open playlist in Spotify →")
                    self._progress["value"] = 6
                    self._step_lbl.config(text="Complete ✓")
                    self._set_running(False)
                    self._config["last_run"] = datetime.now().isoformat()
                    self._save_config()
                    self._refresh_sched_label()
                    self._nb.select(self._songs_tab_idx)

                elif kind == "error":
                    self._append_log(msg[1], "ERROR")
                    self._status_var.set("Error — see Log tab for details")
                    self._set_running(False)
                    # Show only first 300 chars in the popup
                    messagebox.showerror("Generation failed", msg[1][:300])

        except queue.Empty:
            pass

        if schedule:
            self.root.after(80, lambda: self._poll(schedule=True))


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
