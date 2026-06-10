#!/usr/bin/env python3
"""Detect audio playback sources on Linux (PulseAudio/PipeWire/ALSA/mpv).

Usage:
  python3 music.py              # show all active audio sources
  python3 music.py --watch      # continuously monitor
  python3 music.py --json       # output as JSON
"""

import subprocess
import json
import sys
import time
import os
import socket


def run(cmd: str, timeout: int = 5) -> str:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def detect_pulseaudio() -> list[dict]:
    sources = []
    out = run("pactl list sink-inputs")
    if not out:
        return sources

    current: dict = {}
    for line in out.split("\n"):
        line = line.strip()
        if line.startswith("Sink Input #"):
            if current:
                sources.append(current)
            current = {"type": "pulseaudio", "id": line.split("#")[-1]}
        elif ":" in line and current:
            key, _, val = line.partition(":")
            key = key.strip().lower()
            val = val.strip()
            if key == "media.name":
                current["media_name"] = val.strip('"')
            elif key == "application.name":
                current["app"] = val.strip('"')
            elif key == "application.process.binary":
                current["binary"] = val.strip('"')
            elif key == "state":
                current["state"] = val
    if current:
        sources.append(current)
    return sources


def detect_pipewire() -> list[dict]:
    sources = []
    out = run("pw-cli ls Node 2>/dev/null | grep -i stream")
    if out:
        for line in out.split("\n"):
            if line.strip():
                sources.append({"type": "pipewire", "info": line.strip()})

    out2 = run("pw-cli info all 2>/dev/null | grep -A2 'media.name'")
    if out2:
        for line in out2.split("\n"):
            if "media.name" in line:
                sources.append({"type": "pipewire", "media_name": line.split("=")[-1].strip().strip('"')})
    return sources


def detect_alsa() -> list[dict]:
    sources = []
    out = run("cat /proc/asound/cards 2>/dev/null")
    if out:
        sources.append({"type": "alsa_cards", "info": out})

    out2 = run("aplay -l 2>/dev/null")
    if out2:
        for line in out2.split("\n"):
            if "card" in line.lower():
                sources.append({"type": "alsa", "device": line.strip()})

    pcm = run("cat /proc/asound/pcm 2>/dev/null")
    if pcm:
        for line in pcm.split("\n"):
            if line.strip():
                sources.append({"type": "alsa_pcm", "info": line.strip()})
    return sources


def detect_mpv_socket() -> dict | None:
    socket_path = "/tmp/aurix-mpv-socket"
    if not os.path.exists(socket_path):
        return None

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2)
        sock.connect(socket_path)
        sock.sendall(b'{"command": ["get_property", "media-title"]}\n')
        resp = sock.recv(4096).decode()
        sock.close()
        data = json.loads(resp)
        title = data.get("data", "Unknown")

        sock2 = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock2.settimeout(2)
        sock2.connect(socket_path)
        sock2.sendall(b'{"command": ["get_property", "time-pos"]}\n')
        resp2 = sock2.recv(4096).decode()
        sock2.close()
        pos_data = json.loads(resp2)
        pos = pos_data.get("data", 0)

        sock3 = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock3.settimeout(2)
        sock3.connect(socket_path)
        sock3.sendall(b'{"command": ["get_property", "duration"]}\n')
        resp3 = sock3.recv(4096).decode()
        sock3.close()
        dur_data = json.loads(resp3)
        dur = dur_data.get("data", 0)

        def fmt_time(s):
            if not isinstance(s, (int, float)):
                return "?"
            m, s = divmod(int(s), 60)
            h, m = divmod(m, 60)
            return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

        return {
            "type": "mpv",
            "title": title,
            "position": fmt_time(pos),
            "duration": fmt_time(dur),
            "socket": socket_path,
        }
    except Exception:
        return {"type": "mpv", "status": "socket exists but not responding"}


def detect_ytdlp_processes() -> list[dict]:
    sources = []
    out = run("ps aux | grep -E '(yt-dlp|mpv|ffmpeg)' | grep -v grep")
    if out:
        for line in out.split("\n"):
            parts = line.split(None, 10)
            if len(parts) >= 11:
                sources.append({
                    "type": "process",
                    "pid": parts[1],
                    "cpu": parts[2],
                    "mem": parts[3],
                    "cmd": parts[10][:120],
                })
    return sources


def detect_audio_hardware() -> list[dict]:
    sources = []
    out = run("lspci 2>/dev/null | grep -i audio")
    if out:
        for line in out.split("\n"):
            sources.append({"type": "hw_pci", "device": line.strip()})

    usb = run("lsusb 2>/dev/null | grep -i audio")
    if usb:
        for line in usb.split("\n"):
            sources.append({"type": "hw_usb", "device": line.strip()})

    return sources


def detect_all() -> dict:
    mpv = detect_mpv_socket()
    return {
        "mpv_player": mpv,
        "pulseaudio": detect_pulseaudio(),
        "pipewire": detect_pipewire(),
        "alsa": detect_alsa(),
        "processes": detect_ytdlp_processes(),
        "hardware": detect_audio_hardware(),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def format_report(data: dict) -> str:
    lines = [f"=== Audio Detection [{data['timestamp']}] ===", ""]

    if data["mpv_player"]:
        mpv = data["mpv_player"]
        lines.append("[mpv / AURIX Music]")
        if "title" in mpv:
            lines.append(f"  Now playing: {mpv['title']}")
            lines.append(f"  Position:    {mpv['position']} / {mpv['duration']}")
        else:
            lines.append(f"  Status: {mpv.get('status', 'unknown')}")
        lines.append("")

    if data["pulseaudio"]:
        lines.append("[PulseAudio Streams]")
        for s in data["pulseaudio"]:
            name = s.get("media_name", s.get("info", "unknown"))
            app = s.get("app", "")
            state = s.get("state", "")
            lines.append(f"  #{s.get('id', '?')}: {name}")
            if app:
                lines.append(f"    App: {app}")
            if state:
                lines.append(f"    State: {state}")
        lines.append("")

    if data["pipewire"]:
        lines.append("[PipeWire]")
        for s in data["pipewire"]:
            lines.append(f"  {s.get('media_name', s.get('info', 'stream'))}")
        lines.append("")

    if data["processes"]:
        lines.append("[Audio Processes]")
        for p in data["processes"]:
            lines.append(f"  PID {p['pid']} ({p['cpu']}% CPU): {p['cmd']}")
        lines.append("")

    if data["alsa"]:
        lines.append("[ALSA]")
        for s in data["alsa"]:
            lines.append(f"  {s.get('device', s.get('info', ''))}")
        lines.append("")

    if data["hardware"]:
        lines.append("[Audio Hardware]")
        for h in data["hardware"]:
            lines.append(f"  {h['device']}")
        lines.append("")

    is_playing = (
        data["mpv_player"] is not None
        or len(data["pulseaudio"]) > 0
        or len(data["processes"]) > 0
    )
    lines.append(f"Audio playing: {'YES' if is_playing else 'NO'}")
    return "\n".join(lines)


if __name__ == "__main__":
    as_json = "--json" in sys.argv
    watch = "--watch" in sys.argv

    if watch:
        try:
            while True:
                data = detect_all()
                if as_json:
                    print(json.dumps(data, indent=2))
                else:
                    print(format_report(data))
                print("\n" + "=" * 50 + "\n")
                time.sleep(3)
        except KeyboardInterrupt:
            print("\nStopped.")
    else:
        data = detect_all()
        if as_json:
            print(json.dumps(data, indent=2))
        else:
            print(format_report(data))
