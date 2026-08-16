"""
Window management: minimize / maximize / close the active window or switch apps.

Uses win32gui for the foreground window and pygetwindow for title-based lookups,
with graceful degradation if a backend isn't present.
"""

from __future__ import annotations

import platform
import subprocess
import time
from typing import Any, Dict, Optional

from .registry import ToolError, register

SW_MINIMIZE = 6
SW_MAXIMIZE = 3
SW_RESTORE = 9
SW_HIDE = 0


def _get_foreground_window():
    if platform.system() != "Windows":
        return None
    try:
        import win32gui

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        return hwnd
    except Exception:
        return None


def _window_title(hwnd) -> str:
    try:
        import win32gui

        return win32gui.GetWindowText(hwnd)
    except Exception:
        return ""


def _show_window(hwnd, cmd) -> None:
    try:
        import win32gui

        win32gui.ShowWindow(hwnd, cmd)
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not change window state: {e}")


def _close_window_hwnd(hwnd) -> None:
    try:
        import win32con
        import win32gui

        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not close window: {e}")


def _find_window_by_title(query: str):
    """Return the hwnd of the first window whose title contains query."""
    if platform.system() != "Windows":
        return None
    try:
        import win32gui

        matches = []

        def cb(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title and query.lower() in title.lower():
                    matches.append(hwnd)
            return True

        win32gui.EnumWindows(cb, None)
        return matches[0] if matches else None
    except Exception:
        return None


def _focus(hwnd) -> None:
    try:
        import win32gui

        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        # Restore first, then try again
        _show_window(hwnd, SW_RESTORE)
        time.sleep(0.1)
        try:
            import win32gui

            win32gui.SetForegroundWindow(hwnd)
        except Exception as e:  # noqa: BLE001
            raise ToolError(f"Could not focus window: {e}")


def _resolve_target(args: Dict[str, Any]):
    """Pick the hwnd to operate on: explicit title, or the foreground window."""
    title: Optional[str] = args.get("title") or args.get("application")
    if title:
        hwnd = _find_window_by_title(str(title))
        if not hwnd:
            raise ToolError(f"No visible window with title containing '{title}'.")
        return hwnd, str(title)
    hwnd = _get_foreground_window()
    if not hwnd:
        raise ToolError("No active window found.")
    return hwnd, _window_title(hwnd)


@register("minimizeWindow")
def minimize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _show_window(hwnd, SW_MINIMIZE)
    return {"result": f"Minimized window: {title or 'active window'}."}


@register("maximizeWindow")
def maximize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _show_window(hwnd, SW_MAXIMIZE)
    return {"result": f"Maximized window: {title or 'active window'}."}


@register("closeWindow")
def close_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _close_window_hwnd(hwnd)
    return {"result": f"Closed window: {title or 'active window'}."}


@register("switchApplication")
def switch_application(args: Dict[str, Any]) -> Dict[str, Any]:
    """Focus a window by title, or cycle windows (Alt+Tab) if no title given."""
    title = args.get("title") or args.get("application")
    if title:
        hwnd = _find_window_by_title(str(title))
        if not hwnd:
            raise ToolError(f"No visible window matching '{title}'.")
        _show_window(hwnd, SW_RESTORE)
        _focus(hwnd)
        return {"result": f"Switched to: {str(title)}."}

    # No specific title -> Alt+Tab cycle.
    try:
        import pyautogui

        pyautogui.hotkey("alt", "tab")
        return {"result": "Cycled to the next window."}
    except Exception:
        # Fallback: cycle by enumerating windows and focusing the next one.
        if platform.system() == "Windows":
            try:
                import win32gui

                order = []

                def cb(hwnd, _):
                    if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                        order.append(hwnd)
                    return True

                win32gui.EnumWindows(cb, None)
                fg = win32gui.GetForegroundWindow()
                if order:
                    idx = order.index(fg) if fg in order else -1
                    nxt = order[(idx + 1) % len(order)]
                    _focus(nxt)
                    return {"result": f"Switched to: {win32gui.GetWindowText(nxt)}."}
            except Exception:
                pass
        raise ToolError("Could not switch applications.")


@register("restoreWindow")
def restore_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _show_window(hwnd, SW_RESTORE)
    return {"result": f"Restored window: {title or 'active window'}."}


@register("focusWindow")
def focus_window(args: Dict[str, Any]) -> Dict[str, Any]:
    return switch_application(args)


@register("resizeWindow")
def resize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    width = int(args.get("width", 1280))
    height = int(args.get("height", 800))
    try:
        import win32gui
        rect = win32gui.GetWindowRect(hwnd)
        x, y = rect[0], rect[1]
        win32gui.MoveWindow(hwnd, x, y, width, height, True)
        return {"result": f"Resized window '{title}' to {width}x{height}."}
    except Exception as e:
        raise ToolError(f"Could not resize window: {e}")


@register("moveWindow")
def move_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    x = int(args.get("x", 0))
    y = int(args.get("y", 0))
    try:
        import win32gui
        rect = win32gui.GetWindowRect(hwnd)
        w, h = rect[2] - rect[0], rect[3] - rect[1]
        win32gui.MoveWindow(hwnd, x, y, w, h, True)
        return {"result": f"Moved window '{title}' to ({x}, {y})."}
    except Exception as e:
        raise ToolError(f"Could not move window: {e}")


__all__ = [
    "minimize_window",
    "maximize_window",
    "restore_window",
    "focus_window",
    "close_window",
    "switch_application",
    "resize_window",
    "move_window",
]
