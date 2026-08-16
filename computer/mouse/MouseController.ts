/**
 * High-Precision Mouse Controller
 * Supports move, click (left, right, double), drag, and scroll with scaling.
 */

import { Coordinates, DragCoordinates, ActionResult, ComputerAction } from "../types";
import { DesktopBridge } from "../actions/DesktopBridge";

export class MouseController {
  public static async move(x: number, y: number): Promise<ActionResult> {
    const action: ComputerAction = { type: "mouse.move", coordinates: { x, y } };
    const res = await DesktopBridge.call("mouseMove", { x, y });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return { success: true, action, message: `Mouse moved to (${x}, ${y})`, metadata: res.result };
  }

  public static async click(x?: number, y?: number, button: "left" | "right" | "middle" = "left"): Promise<ActionResult> {
    const action: ComputerAction = {
      type: button === "right" ? "mouse.rightClick" : "mouse.click",
      coordinates: x !== undefined && y !== undefined ? { x, y } : undefined,
    };
    const tool = button === "right" ? "mouseRightClick" : "mouseClick";
    const res = await DesktopBridge.call(tool, { x, y, button });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return { success: true, action, message: `Mouse ${button}-clicked at (${x ?? "current"}, ${y ?? "current"})`, metadata: res.result };
  }

  public static async doubleClick(x?: number, y?: number): Promise<ActionResult> {
    const action: ComputerAction = {
      type: "mouse.doubleClick",
      coordinates: x !== undefined && y !== undefined ? { x, y } : undefined,
    };
    const res = await DesktopBridge.call("mouseDoubleClick", { x, y });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return { success: true, action, message: `Mouse double-clicked at (${x ?? "current"}, ${y ?? "current"})`, metadata: res.result };
  }

  public static async rightClick(x?: number, y?: number): Promise<ActionResult> {
    return this.click(x, y, "right");
  }

  public static async drag(coords: DragCoordinates, duration = 0.5): Promise<ActionResult> {
    const action: ComputerAction = {
      type: "mouse.drag",
      parameters: { ...coords, duration },
    };
    const res = await DesktopBridge.call("mouseDrag", { ...coords, duration });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Mouse dragged from (${coords.startX}, ${coords.startY}) to (${coords.endX}, ${coords.endY})`,
      metadata: res.result,
    };
  }

  public static async scroll(direction: "up" | "down" = "down", amount = 300): Promise<ActionResult> {
    const action: ComputerAction = {
      type: "mouse.scroll",
      parameters: { direction, amount },
    };
    const res = await DesktopBridge.call("mouseScroll", { direction, amount });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Mouse scrolled ${direction} by ${amount} units`,
      metadata: res.result,
    };
  }
}
