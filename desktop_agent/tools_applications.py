"""
Application control: launch and close common Windows applications.

Launch strategy is layered for robustness:
  1. Try a known executable / shell verb (fastest, most reliable).
  2. Fall back to the Windows "where"/App Paths lookup via `start`.

Closing uses taskkill on the matching process image name, with a graceful
grace period so apps can save work.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import time
from typing import Any, Dict

from .registry import ToolError, register

KNOWN_APPS: Dict[str, Dict[str, str]] = {
    "notion": {"uri": "notion://", "exe": os.path.expandvars(r"%LOCALAPPDATA%\Programs\Notion\Notion.exe"), "image": "Notion.exe", "label": "Notion"},
    "edge": {"uri": "microsoft-edge:http://", "exe": "msedge.exe", "image": "msedge.exe", "label": "Microsoft Edge"},
    "microsoft edge": {"uri": "microsoft-edge:http://", "exe": "msedge.exe", "image": "msedge.exe", "label": "Microsoft Edge"},
    "msedge": {"uri": "microsoft-edge:http://", "exe": "msedge.exe", "image": "msedge.exe", "label": "Microsoft Edge"},
    "spotify": {"uri": "spotify://", "exe": os.path.expandvars(r"%APPDATA%\Spotify\Spotify.exe"), "image": "Spotify.exe", "label": "Spotify"},
    "discord": {"uri": "discord://", "exe": "Discord.exe", "image": "Discord.exe", "label": "Discord"},
    "chrome": {"exe": "chrome.exe", "image": "chrome.exe", "label": "Google Chrome"},
    "google chrome": {"exe": "chrome.exe", "image": "chrome.exe", "label": "Google Chrome"},
    "brave": {"exe": "brave.exe", "image": "brave.exe", "label": "Brave Browser"},
    "notepad": {"exe": "notepad.exe", "image": "notepad.exe", "label": "Notepad"},
    "vscode": {"exe": "code", "image": "Code.exe", "label": "Visual Studio Code"},
    "code": {"exe": "code", "image": "Code.exe", "label": "Visual Studio Code"},
    "vs code": {"exe": "code", "image": "Code.exe", "label": "Visual Studio Code"},
    "calculator": {"shell": "calc", "image": "CalculatorApp.exe", "label": "Calculator"},
    "calc": {"shell": "calc", "image": "CalculatorApp.exe", "label": "Calculator"},
    "file explorer": {"shell": "explorer", "image": "explorer.exe", "label": "File Explorer"},
    "explorer": {"shell": "explorer", "image": "explorer.exe", "label": "File Explorer"},
    "task manager": {"shell": "taskmgr", "image": "Taskmgr.exe", "label": "Task Manager"},
    "taskmanager": {"shell": "taskmgr", "image": "Taskmgr.exe", "label": "Task Manager"},
    "settings": {"uwp": "ms-settings:", "image": "SystemSettings.exe", "label": "Settings"},
    "cmd": {"exe": "cmd.exe", "image": "cmd.exe", "label": "Command Prompt"},
    "powershell": {"exe": "powershell.exe", "image": "powershell.exe", "label": "PowerShell"},
    "paint": {"shell": "mspaint", "image": "mspaint.exe", "label": "Paint"},
    "whatsapp": {"uri": "whatsapp:", "image": "WhatsApp.exe", "label": "WhatsApp"},
    "telegram": {"uri": "tg://", "image": "Telegram.exe", "label": "Telegram"},
    "obsidian": {"uri": "obsidian://", "image": "Obsidian.exe", "label": "Obsidian"},
}


def _find_start_menu_shortcut(app_name: str) -> str | None:
    search_dirs = [
        os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs"),
        os.path.expandvars(r"%ProgramData%\Microsoft\Windows\Start Menu\Programs"),
    ]
    app_lower = app_name.lower()
    for sdir in search_dirs:
        if not os.path.exists(sdir):
            continue
        for root, _, files in os.walk(sdir):
            for f in files:
                if f.lower().endswith(".lnk") and app_lower in f.lower():
                    return os.path.join(root, f)
    return None


def _find_installed_exe(app_name: str) -> str | None:
    search_dirs = [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs"),
        os.path.expandvars(r"%ProgramFiles%"),
        os.path.expandvars(r"%ProgramFiles(x86)%"),
    ]
    app_lower = app_name.lower()
    for sdir in search_dirs:
        if not os.path.exists(sdir):
            continue
        for root, _, files in os.walk(sdir):
            # Limit depth for performance
            rel = os.path.relpath(root, sdir)
            if rel.count(os.sep) > 3:
                continue
            for f in files:
                if f.lower().endswith(".exe") and app_lower in f.lower():
                    if not any(bad in f.lower() for bad in ["unins", "helper", "crash", "update"]):
                        return os.path.join(root, f)
    return None


def _launch_universal(name: str) -> str:
    norm = name.strip().lower()

    # 1. Check known presets
    if norm in KNOWN_APPS:
        app = KNOWN_APPS[norm]
        if "uri" in app:
            try:
                subprocess.Popen(f'start "" "{app["uri"]}"', shell=True)
                return app["label"]
            except Exception:
                pass
        if "exe" in app:
            exe_target = app["exe"]
            if os.path.exists(exe_target) or shutil.which(exe_target):
                subprocess.Popen(f'start "" "{exe_target}"', shell=True)
                return app["label"]
        if "shell" in app:
            subprocess.Popen(f'start "" {app["shell"]}', shell=True)
            return app["label"]
        if "uwp" in app:
            subprocess.Popen(f'start "" {app["uwp"]}', shell=True)
            return app["label"]

    # 2. Check Start Menu .lnk shortcut
    shortcut = _find_start_menu_shortcut(norm)
    if shortcut:
        subprocess.Popen(f'start "" "{shortcut}"', shell=True)
        return os.path.splitext(os.path.basename(shortcut))[0]

    # 3. Check AppData / Program Files
    exe_path = _find_installed_exe(norm)
    if exe_path:
        subprocess.Popen(f'start "" "{exe_path}"', shell=True)
        return os.path.splitext(os.path.basename(exe_path))[0]

    # 4. Direct shell fallback
    try:
        subprocess.Popen(f'start "" "{name}"', shell=True)
        return name
    except Exception as e:
        raise ToolError(f"Could not open application '{name}': {e}") from e


@register("openApplication")
def open_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name") or args.get("application") or args.get("app")
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    label = _launch_universal(str(name))
    return {"result": f"{label} opened."}


@register("closeApplication")
def close_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name") or args.get("application")
    force = bool(args.get("force", False))
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    spec = _resolve_app(str(name))
    image = spec["image"]
    # Graceful close first (WM_CLOSE via taskkill), then force if requested.
    graceful_flag = "" if force else ""
    force_flag = " /F" if force else ""
    try:
        # taskkill returns non-zero if the process isn't running — that's fine.
        subprocess.run(
            f'taskkill /IM "{image}"{graceful_flag}{force_flag}',
            shell=True,
            capture_output=True,
            timeout=10,
        )
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not close {spec['label']}: {e}") from e
    # Give the OS a moment to actually tear it down.
    time.sleep(0.2)
    return {"result": f"Closed {spec['label']}."}


__all__ = ["open_application", "close_application", "APP_COMMANDS"]
