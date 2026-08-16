"""
Application control: launch and close common Windows applications.

Launch strategy is layered for robustness:
  1. Try a known executable / URI scheme / shell verb (fastest, most reliable).
  2. Search Start Menu .lnk shortcuts.
  3. Search AppData / Program Files.
  4. Fall back to Windows `start` command.

Closing strategy is robust and multi-tier:
  1. Map app name to known process images (e.g. Edge -> msedge.exe, Settings -> SystemSettings.exe, VLC -> vlc.exe).
  2. Terminate via taskkill.
  3. Search running processes by process name and window title via PowerShell / Win32 API.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from typing import Any, Dict, List

from .registry import ToolError, register

KNOWN_APPS: Dict[str, Dict[str, Any]] = {
    # Browsers
    "edge": {"uri": "microsoft-edge:http://", "exe": "msedge.exe", "images": ["msedge.exe", "msedge"], "label": "Microsoft Edge"},
    "microsoft edge": {"uri": "microsoft-edge:http://", "exe": "msedge.exe", "images": ["msedge.exe", "msedge"], "label": "Microsoft Edge"},
    "msedge": {"uri": "microsoft-edge:http://", "exe": "msedge.exe", "images": ["msedge.exe", "msedge"], "label": "Microsoft Edge"},
    "chrome": {"exe": "chrome.exe", "images": ["chrome.exe", "chrome"], "label": "Google Chrome"},
    "google chrome": {"exe": "chrome.exe", "images": ["chrome.exe", "chrome"], "label": "Google Chrome"},
    "brave": {"exe": "brave.exe", "images": ["brave.exe", "brave"], "label": "Brave Browser"},
    "firefox": {"exe": "firefox.exe", "images": ["firefox.exe", "firefox"], "label": "Mozilla Firefox"},
    "mozilla firefox": {"exe": "firefox.exe", "images": ["firefox.exe", "firefox"], "label": "Mozilla Firefox"},

    # Media & Entertainment
    "vlc": {"exe": "vlc.exe", "images": ["vlc.exe", "vlc"], "label": "VLC Media Player"},
    "vlc media player": {"exe": "vlc.exe", "images": ["vlc.exe", "vlc"], "label": "VLC Media Player"},
    "media player": {"images": ["Microsoft.Media.Player.exe", "wmplayer.exe", "vlc.exe"], "label": "Media Player"},
    "windows media player": {"exe": "wmplayer.exe", "images": ["wmplayer.exe"], "label": "Windows Media Player"},
    "spotify": {"uri": "spotify://", "exe": os.path.expandvars(r"%APPDATA%\Spotify\Spotify.exe"), "images": ["Spotify.exe", "Spotify"], "label": "Spotify"},

    # Windows System Tools & Settings
    "settings": {"uwp": "ms-settings:", "images": ["SystemSettings.exe", "SystemSettings"], "label": "Settings"},
    "windows settings": {"uwp": "ms-settings:", "images": ["SystemSettings.exe", "SystemSettings"], "label": "Settings"},
    "notepad": {"exe": "notepad.exe", "images": ["notepad.exe", "notepad"], "label": "Notepad"},
    "calculator": {"shell": "calc", "images": ["CalculatorApp.exe", "Calculator.exe", "calc.exe", "Calculator"], "label": "Calculator"},
    "calc": {"shell": "calc", "images": ["CalculatorApp.exe", "Calculator.exe", "calc.exe", "Calculator"], "label": "Calculator"},
    "paint": {"shell": "mspaint", "images": ["mspaint.exe", "mspaint", "PaintApp.exe"], "label": "Paint"},
    "file explorer": {"shell": "explorer", "images": ["explorer.exe"], "label": "File Explorer"},
    "explorer": {"shell": "explorer", "images": ["explorer.exe"], "label": "File Explorer"},
    "task manager": {"shell": "taskmgr", "images": ["Taskmgr.exe", "Taskmgr"], "label": "Task Manager"},
    "taskmanager": {"shell": "taskmgr", "images": ["Taskmgr.exe", "Taskmgr"], "label": "Task Manager"},
    "cmd": {"exe": "cmd.exe", "images": ["cmd.exe", "cmd"], "label": "Command Prompt"},
    "command prompt": {"exe": "cmd.exe", "images": ["cmd.exe", "cmd"], "label": "Command Prompt"},
    "powershell": {"exe": "powershell.exe", "images": ["powershell.exe", "powershell", "pwsh.exe", "pwsh"], "label": "PowerShell"},
    "terminal": {"shell": "wt", "images": ["WindowsTerminal.exe", "WindowsTerminal"], "label": "Windows Terminal"},
    "windows terminal": {"shell": "wt", "images": ["WindowsTerminal.exe", "WindowsTerminal"], "label": "Windows Terminal"},

    # Productivity & Communication
    "notion": {"uri": "notion://", "exe": os.path.expandvars(r"%LOCALAPPDATA%\Programs\Notion\Notion.exe"), "images": ["Notion.exe", "Notion"], "label": "Notion"},
    "discord": {"uri": "discord://", "exe": "Discord.exe", "images": ["Discord.exe", "Discord"], "label": "Discord"},
    "vscode": {"exe": "code", "images": ["Code.exe", "Code"], "label": "Visual Studio Code"},
    "code": {"exe": "code", "images": ["Code.exe", "Code"], "label": "Visual Studio Code"},
    "vs code": {"exe": "code", "images": ["Code.exe", "Code"], "label": "Visual Studio Code"},
    "visual studio code": {"exe": "code", "images": ["Code.exe", "Code"], "label": "Visual Studio Code"},
    "whatsapp": {"uri": "whatsapp:", "shell": "whatsapp:", "images": ["WhatsApp.Root.exe", "WhatsApp.exe", "WhatsApp"], "label": "WhatsApp"},
    "antigravity": {"exe": os.path.expandvars(r"%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"), "images": ["Antigravity IDE.exe", "Antigravity IDE", "Antigravity.exe", "Antigravity"], "label": "Antigravity IDE"},
    "antigravity ide": {"exe": os.path.expandvars(r"%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"), "images": ["Antigravity IDE.exe", "Antigravity IDE", "Antigravity.exe", "Antigravity"], "label": "Antigravity IDE"},
    "anitgravity": {"exe": os.path.expandvars(r"%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"), "images": ["Antigravity IDE.exe", "Antigravity IDE", "Antigravity.exe", "Antigravity"], "label": "Antigravity IDE"},
    "telegram": {"uri": "tg://", "images": ["Telegram.exe", "Telegram"], "label": "Telegram"},
    "obsidian": {"uri": "obsidian://", "images": ["Obsidian.exe", "Obsidian"], "label": "Obsidian"},
    "word": {"exe": "winword.exe", "images": ["WINWORD.EXE", "WINWORD", "winword.exe"], "label": "Microsoft Word"},
    "microsoft word": {"exe": "winword.exe", "images": ["WINWORD.EXE", "WINWORD", "winword.exe"], "label": "Microsoft Word"},
    "excel": {"exe": "excel.exe", "images": ["EXCEL.EXE", "EXCEL", "excel.exe"], "label": "Microsoft Excel"},
    "microsoft excel": {"exe": "excel.exe", "images": ["EXCEL.EXE", "EXCEL", "excel.exe"], "label": "Microsoft Excel"},
    "powerpoint": {"exe": "powerpnt.exe", "images": ["POWERPNT.EXE", "POWERPNT", "powerpnt.exe"], "label": "Microsoft PowerPoint"},
    "microsoft powerpoint": {"exe": "powerpnt.exe", "images": ["POWERPNT.EXE", "POWERPNT", "powerpnt.exe"], "label": "Microsoft PowerPoint"},
    "steam": {"uri": "steam://", "images": ["steam.exe", "Steam.exe", "steam"], "label": "Steam"},
    "slack": {"images": ["slack.exe", "Slack.exe", "slack"], "label": "Slack"},
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
        os.path.expandvars(r"%LOCALAPPDATA%"),
    ]
    app_lower = app_name.lower()
    for sdir in search_dirs:
        if not os.path.exists(sdir):
            continue
        for root, _, files in os.walk(sdir):
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
        elif "uwp" in app:
            try:
                subprocess.Popen(f'start "" {app["uwp"]}', shell=True)
                return app["label"]
            except Exception:
                pass
        elif "exe" in app:
            exe_target = app["exe"]
            if os.path.exists(exe_target) or shutil.which(exe_target):
                subprocess.Popen(f'start "" "{exe_target}"', shell=True)
                return app["label"]
        elif "shell" in app:
            subprocess.Popen(f'start "" {app["shell"]}', shell=True)
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


def _resolve_app_targets(name: str) -> tuple[str, List[str]]:
    norm = name.strip().lower()
    clean_name = norm.replace(".exe", "")

    images: List[str] = []
    label = name.strip()

    if norm in KNOWN_APPS:
        entry = KNOWN_APPS[norm]
        label = entry.get("label", name)
        images.extend(entry.get("images", []))
    elif clean_name in KNOWN_APPS:
        entry = KNOWN_APPS[clean_name]
        label = entry.get("label", name)
        images.extend(entry.get("images", []))

    # Add default candidate images
    if f"{clean_name}.exe" not in images:
        images.append(f"{clean_name}.exe")
    if clean_name not in images:
        images.append(clean_name)

    return label, images


def _close_universal(name: str, force: bool = True) -> str:
    norm = name.strip().lower()
    label, images = _resolve_app_targets(name)

    # 1. Kill by candidate image names using taskkill
    for img in images:
        try:
            flag = "/F" if force else ""
            subprocess.run(
                f'taskkill /IM "{img}" {flag} /T',
                shell=True,
                capture_output=True,
                timeout=5,
            )
        except Exception:
            pass

    # 2. Kill matching processes by process name or window title via PowerShell
    safe_name = norm.replace("'", "''").replace('"', '')
    clean_token = safe_name.replace(" ", "")
    
    ps_cmd = (
        f"$query = '{safe_name}'; "
        f"$clean = '{clean_token}'; "
        f"Get-Process | Where-Object {{ "
        f"$_.ProcessName -like ('*' + $query + '*') -or "
        f"$_.ProcessName -like ('*' + $clean + '*') -or "
        f"$_.MainWindowTitle -like ('*' + $query + '*') "
        f"}} | Stop-Process -Force -ErrorAction SilentlyContinue"
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
            capture_output=True,
            timeout=7,
        )
    except Exception:
        pass

    # 3. Optional Win32 close window post message fallback
    try:
        import win32con
        import win32gui

        def enum_cb(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title and norm in title.lower():
                    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            return True

        win32gui.EnumWindows(enum_cb, None)
    except Exception:
        pass

    time.sleep(0.2)
    return label


@register("openApplication")
def open_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name") or args.get("application") or args.get("app")
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    label = _launch_universal(str(name))
    return {"result": f"{label} opened."}


@register("openApp")
def open_app(args: Dict[str, Any]) -> Dict[str, Any]:
    return open_application(args)


@register("closeApplication")
def close_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name") or args.get("application") or args.get("app")
    force = bool(args.get("force", True))
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    label = _close_universal(str(name), force=force)
    return {"result": f"Closed {label}."}


@register("closeApp")
def close_app(args: Dict[str, Any]) -> Dict[str, Any]:
    return close_application(args)


__all__ = ["open_application", "open_app", "close_application", "close_app", "KNOWN_APPS"]
