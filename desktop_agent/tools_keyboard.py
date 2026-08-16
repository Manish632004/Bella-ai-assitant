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


@register("keyboardPress")
@register("keyboard.press")
def keyboard_press(args: Dict[str, Any]) -> Dict[str, Any]:
    key = args.get("key") or args.get("value") or args.get("target") or "enter"
    norm = _normalize_key(str(key))
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
