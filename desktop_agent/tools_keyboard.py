"""
Keyboard automation: type, press, and hotkey with modifier handling and Unicode support.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Union

from .registry import ToolError, register
from .tools_clipboard import paste_clipboard

# Key normalization map
KEY_MAP = {
    "enter": "enter",
    "return": "enter",
    "esc": "esc",
    "escape": "esc",
    "tab": "tab",
    "space": "space",
    "backspace": "backspace",
    "delete": "delete",
    "del": "delete",
    "shift": "shift",
    "ctrl": "ctrl",
    "control": "ctrl",
    "alt": "alt",
    "win": "win",
    "windows": "win",
    "command": "win",
    "cmd": "win",
    "arrow_up": "up",
    "arrowup": "up",
    "up": "up",
    "arrow_down": "down",
    "arrowdown": "down",
    "down": "down",
    "arrow_left": "left",
    "arrowleft": "left",
    "left": "left",
    "arrow_right": "right",
    "arrowright": "right",
    "right": "right",
    "home": "home",
    "end": "end",
    "page_up": "pageup",
    "pageup": "pageup",
    "page_down": "pagedown",
    "pagedown": "pagedown",
}
for i in range(1, 13):
    KEY_MAP[f"f{i}"] = f"f{i}"


def _get_pyautogui():
    try:
        import pyautogui

        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.05
        return pyautogui
    except Exception as e:
        raise ToolError(f"pyautogui is not available on this system: {e}")


def _normalize_key(key: str) -> str:
    k = key.strip().lower()
    return KEY_MAP.get(k, k)


@register("keyboardType")
@register("keyboard.type")
def keyboard_type(args: Dict[str, Any]) -> Dict[str, Any]:
    text = args.get("text") or args.get("value") or ""
    if not text:
        return {"result": "No text provided to type."}

    # For multi-line, long strings, or complex Unicode, clipboard paste is fast and lossless
    if len(str(text)) > 50 or "\n" in str(text) or any(ord(c) > 127 for c in str(text)):
        return paste_clipboard({"text": text})

    ag = _get_pyautogui()
    try:
        ag.write(str(text), interval=0.01)
        return {"result": f"Typed text ({len(str(text))} chars).", "text": str(text)}
    except Exception:
        return paste_clipboard({"text": text})


@register("pressEnter")
@register("enterKey")
@register("pressReturn")
def press_enter(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Press the Enter/Return key in the active window."""
    try:
        import ctypes
        VK_RETURN = 0x0D
        KEYEVENTF_KEYUP = 0x0002
        ctypes.windll.user32.keybd_event(VK_RETURN, 0, 0, 0)
        time.sleep(0.02)
        ctypes.windll.user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
    except Exception:
        pass

    try:
        ag = _get_pyautogui()
        ag.press("enter")
    except Exception:
        pass

    return {"result": "Pressed Enter key."}


@register("keyboardPress")
@register("keyboard.press")
@register("pressKey")
def keyboard_press(args: Dict[str, Any] = None) -> Dict[str, Any]:
    args = args or {}
    key = args.get("key") or args.get("value") or args.get("target") or "enter"
    norm = _normalize_key(str(key))
    if norm == "enter":
        return press_enter(args)

    ag = _get_pyautogui()
    ag.press(norm)
    return {"result": f"Pressed key: {norm.upper()}."}


@register("keyboardHotkey")
@register("keyboard.hotkey")
def keyboard_hotkey(args: Dict[str, Any]) -> Dict[str, Any]:
    raw_keys = args.get("keys") or args.get("combo") or args.get("value") or []
    if isinstance(raw_keys, str):
        # e.g. "CTRL+SHIFT+P" or "ctrl+c"
        keys_list = [k.strip() for k in raw_keys.replace("-", "+").split("+") if k.strip()]
    elif isinstance(raw_keys, list):
        keys_list = [str(k).strip() for k in raw_keys if str(k).strip()]
    else:
        raise ToolError("Parameter 'keys' must be a string combo or array of keys.")

    normalized = [_normalize_key(k) for k in keys_list]
    if not normalized:
        raise ToolError("No valid keys provided for hotkey.")

    ag = _get_pyautogui()
    ag.hotkey(*normalized)
    combo_str = "+".join(k.upper() for k in normalized)
    return {"result": f"Executed hotkey combination: {combo_str}.", "combo": combo_str}


# --- Browser Tab & Navigation Keystroke Automations ---


@register("previousTab")
@register("prevTab")
@register("switchToPreviousTab")
def previous_tab(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Switch to the previous tab in the active browser (Ctrl+Shift+Tab / Ctrl+PageUp)."""
    ag = _get_pyautogui()
    try:
        ag.hotkey("ctrl", "shift", "tab")
    except Exception:
        ag.hotkey("ctrl", "pageup")
    return {"result": "Switched to previous browser tab (Ctrl+Shift+Tab)."}


@register("nextTab")
@register("switchToNextTab")
def next_tab(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Switch to the next tab in the active browser (Ctrl+Tab / Ctrl+PageDown)."""
    ag = _get_pyautogui()
    try:
        ag.hotkey("ctrl", "tab")
    except Exception:
        ag.hotkey("ctrl", "pagedown")
    return {"result": "Switched to next browser tab (Ctrl+Tab)."}


@register("browserBack")
@register("browserGoBack")
def browser_go_back(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Go back in browser history (Alt+Left)."""
    ag = _get_pyautogui()
    ag.hotkey("alt", "left")
    return {"result": "Navigated back in browser history (Alt+Left)."}


@register("browserForward")
@register("browserGoForward")
def browser_go_forward(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Go forward in browser history (Alt+Right)."""
    ag = _get_pyautogui()
    ag.hotkey("alt", "right")
    return {"result": "Navigated forward in browser history (Alt+Right)."}


@register("newTab")
@register("browserNewTab")
def browser_new_tab(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Open a new browser tab (Ctrl+T)."""
    ag = _get_pyautogui()
    ag.hotkey("ctrl", "t")
    return {"result": "Opened new browser tab (Ctrl+T)."}


@register("closeTab")
@register("browserCloseTab")
def browser_close_tab(args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Close the active browser tab (Ctrl+W)."""
    ag = _get_pyautogui()
    ag.hotkey("ctrl", "w")
    return {"result": "Closed active browser tab (Ctrl+W)."}

