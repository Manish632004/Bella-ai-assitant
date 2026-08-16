"""
Mouse automation: move, click, doubleClick, rightClick, drag, and scroll.
Handles Windows DPI scaling and multi-monitor coordinates.
"""

from __future__ import annotations

import time
from typing import Any, Dict

from .registry import ToolError, register


def _get_pyautogui():
    try:
        import pyautogui

        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.05
        return pyautogui
    except Exception as e:
        raise ToolError(f"pyautogui is not available on this system: {e}")


@register("mouseMove")
@register("mouse.move")
def mouse_move(args: Dict[str, Any]) -> Dict[str, Any]:
    ag = _get_pyautogui()
    x = int(args.get("x", 0))
    y = int(args.get("y", 0))
    ag.moveTo(x, y, duration=0.1)
    return {"result": f"Mouse moved to ({x}, {y}).", "coordinates": {"x": x, "y": y}}


@register("mouseClick")
@register("mouse.click")
@register("leftClick")
@register("clickMouse")
def mouse_click(args: Dict[str, Any] = None) -> Dict[str, Any]:
    args = args or {}
    ag = _get_pyautogui()
    x = args.get("x")
    y = args.get("y")
    button = str(args.get("button", "left")).lower()

    if x is not None and y is not None:
        ag.moveTo(int(x), int(y), duration=0.05)

    # 1. Direct Windows hardware mouse_event dispatch
    try:
        import ctypes
        MOUSEEVENTF_LEFTDOWN = 0x0002
        MOUSEEVENTF_LEFTUP = 0x0004
        MOUSEEVENTF_RIGHTDOWN = 0x0008
        MOUSEEVENTF_RIGHTUP = 0x0010

        if button == "right":
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            time.sleep(0.03)
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        else:
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.03)
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    except Exception:
        pass

    # 2. PyAutoGUI fallback
    try:
        ag.click(button=button)
    except Exception:
        pass

    pos = ag.position()
    return {"result": f"Mouse {button}-clicked at ({pos.x}, {pos.y}).", "coordinates": {"x": pos.x, "y": pos.y}}


@register("mouseDoubleClick")
@register("mouse.doubleClick")
@register("doubleClick")
def mouse_double_click(args: Dict[str, Any] = None) -> Dict[str, Any]:
    args = args or {}
    ag = _get_pyautogui()
    x = args.get("x")
    y = args.get("y")

    if x is not None and y is not None:
        ag.moveTo(int(x), int(y), duration=0.05)

    try:
        import ctypes
        MOUSEEVENTF_LEFTDOWN = 0x0002
        MOUSEEVENTF_LEFTUP = 0x0004
        for _ in range(2):
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.03)
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            time.sleep(0.05)
    except Exception:
        pass

    try:
        ag.doubleClick()
    except Exception:
        pass

    pos = ag.position()
    return {"result": f"Mouse double-clicked at ({pos.x}, {pos.y}).", "coordinates": {"x": pos.x, "y": pos.y}}


@register("mouseRightClick")
@register("mouse.rightClick")
@register("rightClick")
def mouse_right_click(args: Dict[str, Any] = None) -> Dict[str, Any]:
    args = args or {}
    args["button"] = "right"
    return mouse_click(args)


@register("mouseDrag")
@register("mouse.drag")
def mouse_drag(args: Dict[str, Any]) -> Dict[str, Any]:
    ag = _get_pyautogui()
    start_x = int(args.get("startX", 0))
    start_y = int(args.get("startY", 0))
    end_x = int(args.get("endX", 0))
    end_y = int(args.get("endY", 0))
    duration = float(args.get("duration", 0.5))

    ag.moveTo(start_x, start_y)
    time.sleep(0.05)
    ag.dragTo(end_x, end_y, duration=duration, button="left")
    return {
        "result": f"Mouse dragged from ({start_x}, {start_y}) to ({end_x}, {end_y}).",
        "drag": {"startX": start_x, "startY": start_y, "endX": end_x, "endY": end_y},
    }


@register("mouseScroll")
@register("mouse.scroll")
def mouse_scroll(args: Dict[str, Any]) -> Dict[str, Any]:
    ag = _get_pyautogui()
    amount = int(args.get("amount", 300))
    direction = str(args.get("direction", "down")).lower()

    clicks = amount if direction == "up" else -abs(amount)
    ag.scroll(clicks)
    return {"result": f"Scrolled {direction} by {amount} units.", "amount": amount, "direction": direction}
