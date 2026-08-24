"""
PC control: system volume and (gated) power actions.

Volume:
  Uses pycaw + comtypes for precise scalar control on Windows when available,
  with a graceful media-key fallback (VK_VOLUME_UP/DOWN/MUTE via keybd_event)
  through pyautogui.

Power:
  shutdown / restart / sleep / lock are DANGEROUS and require the two-step
  confirmation flow (tools_confirmation). `executePowerAction` consumes the
  token before running anything destructive.
"""

from __future__ import annotations

import ctypes
import os
import platform
import subprocess
import time
from typing import Any, Dict, Optional

from .registry import ToolError, register
from .tools_confirmation import ACTION_LABEL, consume_token


# --- Volume backend (lazy) ----------------------------------------------------

_vol_backend = None  # one of "pycaw" | "media_keys" | None


def _get_pycaw_endpoint():
    if platform.system() != "Windows":
        return None
    try:
        import comtypes
        try:
            comtypes.CoInitialize()
        except Exception:
            pass

        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

        devices = AudioUtilities.GetSpeakers()
        if devices is None:
            return None

        # Modern pycaw (2024+): EndpointVolume is available directly on AudioDevice
        vol = getattr(devices, "EndpointVolume", None)
        if vol is not None:
            return vol

        # Legacy pycaw: devices is MMDevice with .Activate()
        from ctypes import cast, POINTER

        if hasattr(devices, "Activate"):
            interface = devices.Activate(IAudioEndpointVolume._iid_, comtypes.CLSCTX_ALL, None)
            return cast(interface, POINTER(IAudioEndpointVolume))
        if hasattr(devices, "_dev") and hasattr(devices._dev, "Activate"):
            interface = devices._dev.Activate(IAudioEndpointVolume._iid_, comtypes.CLSCTX_ALL, None)
            return cast(interface, POINTER(IAudioEndpointVolume))
        return None
    except Exception:
        return None


def _current_volume() -> float:
    """Returns current master volume in 0.0..1.0 (best effort)."""
    endpoint = _get_pycaw_endpoint()
    if endpoint is not None:
        try:
            return float(endpoint.GetMasterVolumeLevelScalar())
        except Exception:
            pass
    return 0.5  # unknown


def _set_volume_scalar(value: float) -> None:
    value = max(0.0, min(1.0, float(value)))
    endpoint = _get_pycaw_endpoint()
    if endpoint is not None:
        try:
            endpoint.SetMasterVolumeLevelScalar(value, None)
            return
        except Exception:
            pass  # fall through to media keys
    _set_volume_via_keys(value)


# VK codes for media keys
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002


def _press_vk(vk: int) -> None:
    try:
        # On Windows, hardware media keys (0xAD - 0xB3) require KEYEVENTF_EXTENDEDKEY flag
        b_scan = ctypes.windll.user32.MapVirtualKeyW(vk, 0)
        ctypes.windll.user32.keybd_event(vk, b_scan, KEYEVENTF_EXTENDEDKEY, 0)
        time.sleep(0.02)
        ctypes.windll.user32.keybd_event(vk, b_scan, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
    except Exception:
        pass

    # pyautogui fallback
    try:
        import pyautogui

        if vk == VK_VOLUME_UP:
            pyautogui.press("volumeup")
        elif vk == VK_VOLUME_DOWN:
            pyautogui.press("volumedown")
        elif vk == VK_VOLUME_MUTE:
            pyautogui.press("volumemute")
        elif vk == VK_MEDIA_NEXT_TRACK:
            pyautogui.press("nexttrack")
        elif vk == VK_MEDIA_PREV_TRACK:
            pyautogui.press("prevtrack")
        elif vk == VK_MEDIA_PLAY_PAUSE:
            pyautogui.press("playpause")
        elif vk == VK_MEDIA_STOP:
            pyautogui.press("stop")
    except Exception:
        pass


def _set_volume_via_keys(target: float) -> None:
    """Set volume via media keys accurately."""
    target = max(0.0, min(1.0, float(target)))
    if target >= 0.99:
        for _ in range(50):
            _press_vk(VK_VOLUME_UP)
            time.sleep(0.005)
        return
    if target <= 0.01:
        for _ in range(50):
            _press_vk(VK_VOLUME_DOWN)
            time.sleep(0.005)
        return

    # Calibrate by zeroing out first, then stepping up
    steps = int(round(target * 50))
    for _ in range(50):
        _press_vk(VK_VOLUME_DOWN)
        time.sleep(0.005)
    for _ in range(steps):
        _press_vk(VK_VOLUME_UP)
        time.sleep(0.005)


def _toggle_mute_pycaw() -> bool:
    endpoint = _get_pycaw_endpoint()
    if endpoint is not None:
        try:
            current_mute = bool(endpoint.GetMute())
            new_mute = 0 if current_mute else 1
            endpoint.SetMute(new_mute, None)
            return bool(new_mute)
        except Exception:
            pass
    _press_vk(VK_VOLUME_MUTE)
    time.sleep(0.05)
    return False


# --- Tool handlers -----------------------------------------------------------


@register("volumeUp")
def volume_up(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount", 0.10))
    if step > 1.0:
        step = step / 100.0
    new = min(1.0, _current_volume() + step)
    _set_volume_scalar(new)
    return {"result": f"Volume increased to {int(round(new * 100))}%.", "volume": int(round(new * 100))}


@register("volumeDown")
def volume_down(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount", 0.10))
    if step > 1.0:
        step = step / 100.0
    new = max(0.0, _current_volume() - step)
    _set_volume_scalar(new)
    return {"result": f"Volume decreased to {int(round(new * 100))}%.", "volume": int(round(new * 100))}


@register("setVolume")
def set_volume(args: Dict[str, Any]) -> Dict[str, Any]:
    if "percent" in args:
        pct = float(args["percent"])
    elif "level" in args:
        pct = float(args["level"])
    elif "amount" in args:
        pct = float(args["amount"])
    else:
        raise ToolError("Parameter 'percent' (0-100) is required.")
    if 0.0 < pct <= 1.0 and ("level" in args or "amount" in args):
        pct = pct * 100.0
    pct = max(0.0, min(100.0, pct))
    _set_volume_scalar(pct / 100.0)
    return {"result": f"Volume set to {int(round(pct))}%.", "volume": int(round(pct))}


@register("muteToggle")
def mute_toggle(args: Dict[str, Any]) -> Dict[str, Any]:
    muted = _toggle_mute_pycaw()
    return {"result": "Muted." if muted else "Unmuted."}


# --- Media playback controls (YouTube, Spotify, Windows Media, Browser) ------


_SMTC_PS1 = os.path.join(os.environ.get("TEMP", "."), "bella_smtc.ps1")


def _smtc_action(action: str, app_filter: str | None = None) -> str | None:
    """
    Drive Windows System Media Transport Controls directly â€” per-app,
    deterministic, zero focus games. Returns the app that handled it.

    action: "next" | "prev" | "playpause" | "stop"
    app_filter: optional substring to target a specific player ("spotify").
    Priority: matching+Playing > any Playing > matching > any.
    """
    if platform.system() != "Windows":
        return None
    method = {
        "next": "TrySkipNextAsync",
        "prev": "TryPreviousAsync",
        "playpause": "TryTogglePlayPauseAsync",
        "stop": "TryStopAsync",
    }.get(action)
    if not method:
        return None

    ps = r"""
param([string]$Action, [string]$AppFilter)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
function Await-WinRt($op, $t) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $net = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $net.Wait(-1) | Out-Null
  return $net.Result
}
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mgr = Await-WinRt ($mgrType::RequestAsync()) $mgrType
$sessions = @($mgr.GetSessions())
if ($sessions.Count -eq 0) { Write-Output 'NONE'; exit }
if ($AppFilter) { $sessions = @($sessions | Where-Object { $_.SourceAppUserModelId -like ('*' + $AppFilter + '*') }) }
if ($sessions.Count -eq 0) { Write-Output 'NO-MATCH'; exit }
# Prefer a playing session, else fall through to any remaining.
$ordered = @($sessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' }) + @($sessions)
$methodMap = @{ next='TrySkipNextAsync'; prev='TryPreviousAsync'; playpause='TryTogglePlayPauseAsync'; stop='TryStopAsync' }
$mName = $methodMap[$Action]
foreach ($s in $ordered) {
  try {
    $r = Await-WinRt ($s.$mName()) ([System.Boolean])
    if ($r) { Write-Output ("OK|" + $s.SourceAppUserModelId); exit }
  } catch {}
}
Write-Output 'NONE'
"""
    try:
        os.makedirs(os.path.dirname(_SMTC_PS1), exist_ok=True)
        with open(_SMTC_PS1, "w", encoding="utf-8") as f:
            f.write(ps)
        args = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", _SMTC_PS1, "-Action", action]
        if app_filter:
            args += ["-AppFilter", app_filter]
        out = subprocess.run(args, capture_output=True, text=True, timeout=12)
        line = (out.stdout or "").strip().splitlines()
        if line and line[-1].startswith("OK|"):
            return line[-1][3:]
        if line and line[-1] == "NO-MATCH":
            # Requested app has no session; retry without filter.
            return _smtc_action(action, None)
    except Exception:
        pass
    return None


def _send_youtube_shortcut(action: str) -> bool:
    """
    Send YouTube shortcuts ONLY when a YouTube tab's window is ALREADY in the
    foreground. We never steal focus for media keys â€” blind hotkeys into a
    wrong/foregrounded app caused skipped-and-typed chaos (Shift+N opens an
    incognito window in Chromium browsers!).
    """
    if platform.system() != "Windows":
        return False
    try:
        import win32gui
        import win32con

        fg = win32gui.GetForegroundWindow()
        fg_title = (win32gui.GetWindowText(fg) or "").lower()
        if "youtube" not in fg_title and "spotify" not in fg_title:
            return False  # not playing in the focused window â€” do nothing

        try:
            import pyautogui
            if action == "next":
                pyautogui.hotkey("shift", "n")
            elif action == "prev":
                pyautogui.hotkey("shift", "p")
            elif action == "playpause":
                pyautogui.press("k")
            return True
        except Exception:
            pass
    except Exception:
        pass
    return False


@register("changeSong")
@register("playSong")
def change_song(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Change the currently playing song or play a requested song on YouTube in the user's default browser."""
    args = args or {}
    query = args.get("query") or args.get("song") or args.get("name") or args.get("title")
    if query:
        from .tools_websites import _build_search_url, open_url
        url = _build_search_url("youtube", str(query))
        resolved = open_url(url)
        return {"result": f"Changed song: playing '{query}' on YouTube ({resolved})."}

    # If no specific query given, skip to the next track
    return media_next_track(args)


@register("mediaNextTrack")
@register("skipSong")
@register("nextSong")
def media_next_track(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Skip to the next song or track in the browser (YouTube/Spotify) or desktop media player."""
    args = args or {}
    query = args.get("query") or args.get("song") or args.get("name") or args.get("title")
    if query:
        from .tools_websites import _build_search_url, open_url
        url = _build_search_url("youtube", str(query))
        resolved = open_url(url)
        return {"result": f"Playing '{query}' on YouTube ({resolved})."}

    # 1. Preferred: per-app SMTC command â€” works even when unfocused,
    #    never steals focus, targets the right player automatically.
    app = _smtc_action("next", (args or {}).get("app") or (args or {}).get("target"))
    if app:
        return {"result": f"Skipped to the next track ({app})."}

    # 2. Global hardware media key (Windows routes it to the active player).
    _press_vk(VK_MEDIA_NEXT_TRACK)

    # 3. YouTube in-page shortcut, but only if a YouTube window is focused.
    yt_handled = _send_youtube_shortcut("next")

    if yt_handled:
        return {"result": "Skipped to the next video/song on YouTube."}
    return {"result": "Skipped to the next song/track."}


@register("mediaPrevTrack")
@register("previousSong")
def media_prev_track(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Go back to the previous song or track."""
    app = _smtc_action("prev", (args or {}).get("app") or (args or {}).get("target"))
    if app:
        return {"result": f"Went back to the previous track ({app})."}
    _press_vk(VK_MEDIA_PREV_TRACK)
    _send_youtube_shortcut("prev")
    return {"result": "Returned to the previous song/track."}


@register("mediaPlayPause")
@register("playPauseMedia")
@register("pauseSong")
@register("resumeSong")
def media_play_pause(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Toggle play / pause for the currently active song, music, or video playback."""
    app = _smtc_action("playpause", (args or {}).get("app") or (args or {}).get("target"))
    if app:
        return {"result": f"Toggled play/pause ({app})."}
    _press_vk(VK_MEDIA_PLAY_PAUSE)
    _send_youtube_shortcut("playpause")
    return {"result": "Toggled play/pause for active song/video."}


@register("mediaStop")
def media_stop(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Stop ongoing media playback."""
    app = _smtc_action("stop", (args or {}).get("app") or (args or {}).get("target"))
    if app:
        return {"result": f"Playback stopped ({app})."}
    _press_vk(VK_MEDIA_STOP)
    return {"result": "Media playback stopped."}


# --- Gated power actions -----------------------------------------------------


def _run_power(action: str) -> str:
    """Execute the actual OS power command. Caller must have confirmed first."""
    system = platform.system()
    if action == "lock":
        if system == "Windows":
            ctypes.windll.user32.LockWorkStation()
            return "Computer locked."
        return "Lock is only configured for Windows."
    if action == "sleep":
        if system == "Windows":
            # suspend: standby
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
            return "Computer going to sleep."
        subprocess.run(["systemctl", "suspend"], check=False)
        return "Computer going to sleep."
    if action == "restart":
        if system == "Windows":
            subprocess.run(["shutdown", "/r", "/t", "5"], check=False)
            return "Computer restarting in 5 seconds."
        subprocess.run(["shutdown", "-r", "now"], check=False)
        return "Computer restarting."
    if action == "shutdown":
        if system == "Windows":
            subprocess.run(["shutdown", "/s", "/t", "10"], check=False)
            return "Computer shutting down in 10 seconds."
        subprocess.run(["shutdown", "-h", "now"], check=False)
        return "Computer shutting down."
    raise ToolError(f"Unknown power action '{action}'.")


@register("executePowerAction")
def execute_power_action(args: Dict[str, Any]) -> Dict[str, Any]:
    action = (args.get("action") or "").strip().lower()
    token: Optional[str] = args.get("execute_token")

    # Locking is comparatively safe but still gated per the user's spec
    # (all four dangerous actions require confirmation).
    from .tools_confirmation import DANGEROUS_ACTIONS

    if action not in DANGEROUS_ACTIONS:
        raise ToolError(
            f"Unknown power action '{action}'. Valid: {', '.join(sorted(DANGEROUS_ACTIONS))}."
        )

    consume_token(action, token)  # raises if invalid/missing/expired
    msg = _run_power(action)
    return {"result": msg, "action": action}


# Helper for shell-level abort of a pending Windows shutdown/restart timer.
@register("_cancelPowerTimer")
def _cancel(args: Dict[str, Any]) -> Dict[str, Any]:  # pragma: no cover
    subprocess.run(["shutdown", "/a"], check=False)
    return {"result": "Cancelled pending shutdown/restart timer."}


# --- Brightness control ------------------------------------------------------
# Uses screen_brightness_control when available (Windows/macOS). Degrades to a
# WMI / powershell fallback on Windows, and to a clear "unsupported" message
# otherwise. Lazy import so the agent still boots if the optional dep is missing.

_sbc = None  # cached module handle

def _brightness_backend():
    """Return the screen_brightness_control module, or None if unavailable."""
    global _sbc
    if _sbc is not None:
        return _sbc if _sbc is not False else None
    try:
        import screen_brightness_control as sbc  # type: ignore[import-not-found]

        _sbc = sbc
        return sbc
    except Exception:  # noqa: BLE001 - optional dependency
        _sbc = False
        return None


def _current_brightness() -> int:
    sbc = _brightness_backend()
    if sbc is not None:
        try:
            vals = sbc.get_brightness()
            if isinstance(vals, list) and vals:
                first = vals[0]
                if isinstance(first, (int, float)):
                    return int(round(sum(vals) / len(vals)))
                if isinstance(first, dict) and "brightness" in first:
                    return int(first["brightness"])
            elif isinstance(vals, (int, float)):
                return int(vals)
        except Exception:  # noqa: BLE001
            pass
    # Windows CIM fallback via PowerShell (Get-CimInstance is reliable across Windows versions).
    if platform.system() == "Windows":
        try:
            out = subprocess.check_output(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness",
                ],
                text=True,
                timeout=8,
            ).strip()
            if out:
                return int(out.splitlines()[-1].strip())
        except Exception:  # noqa: BLE001
            pass
    raise ToolError("Brightness control is not supported on this device.")


def _set_brightness(pct: float) -> int:
    pct = max(0.0, min(100.0, pct))
    sbc = _brightness_backend()
    if sbc is not None:
        try:
            sbc.set_brightness(int(pct))
            return int(pct)
        except Exception:  # noqa: BLE001
            pass
    if platform.system() == "Windows":
        # CIM method call via PowerShell
        try:
            subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    (
                        "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | "
                        f"Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout = 1; Brightness = {int(pct)}}}"
                    ),
                ],
                check=False,
                timeout=8,
            )
            return int(pct)
        except Exception as e:  # noqa: BLE001
            raise ToolError(f"Could not set brightness: {e}") from e
    raise ToolError("Brightness control is not supported on this device.")


@register("brightnessUp")
def brightness_up(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount", 10))
    current = _current_brightness()
    new = _set_brightness(current + step)
    return {"result": f"Brightness increased to {new}%.", "brightness": new}


@register("brightnessDown")
def brightness_down(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount", 10))
    current = _current_brightness()
    new = _set_brightness(current - step)
    return {"result": f"Brightness decreased to {new}%.", "brightness": new}


@register("setBrightness")
def set_brightness(args: Dict[str, Any]) -> Dict[str, Any]:
    if "percent" in args:
        pct = float(args["percent"])
    elif "level" in args:
        pct = float(args["level"])
    else:
        raise ToolError("Parameter 'percent' (0-100) is required.")
    new = _set_brightness(pct)
    return {"result": f"Brightness set to {new}%.", "brightness": new}


__all__ = [
    "volume_up",
    "volume_down",
    "set_volume",
    "mute_toggle",
    "execute_power_action",
    "ACTION_LABEL",
    "brightness_up",
    "brightness_down",
    "set_brightness",
]

