/**
 * Windows Application & Window Controller
 * Manages apps (open/close) and windows (minimize, maximize, restore, focus, switch, resize, move).
 */

import { ActionResult, ComputerAction } from "../types";
import { AppRegistry } from "./AppRegistry";
import { DesktopBridge } from "../actions/DesktopBridge";

export class WindowController {
  public static async openApp(appName: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "app.open", target: appName };
    const resolved = AppRegistry.resolve(appName);
    if (!resolved) {
      return {
        success: false,
        action,
        error: `Application "${appName}" not found in safe registry.`,
      };
    }

    const res = await DesktopBridge.call("openApplication", { name: resolved.name });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Launched ${resolved.name} (${resolved.executable})`,
      metadata: { app: resolved, ...res.result },
    };
  }

  public static async closeApp(appName: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "app.close", target: appName };
    const resolved = AppRegistry.resolve(appName);
    const targetName = resolved ? resolved.name : appName;

    const res = await DesktopBridge.call("closeApplication", { name: targetName });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Closed application: ${targetName}`,
      metadata: res.result,
    };
  }

  public static async minimize(target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.minimize", target };
    const res = await DesktopBridge.call("minimizeWindow", { title: target });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Minimized window: ${target || "active window"}`, metadata: res.result };
  }

  public static async maximize(target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.maximize", target };
    const res = await DesktopBridge.call("maximizeWindow", { title: target });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Maximized window: ${target || "active window"}`, metadata: res.result };
  }

  public static async restore(target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.restore", target };
    const res = await DesktopBridge.call("restoreWindow", { title: target });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Restored window: ${target || "active window"}`, metadata: res.result };
  }

  public static async focus(target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.focus", target };
    const res = await DesktopBridge.call("switchApplication", { title: target });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Focused window: ${target || "next window"}`, metadata: res.result };
  }

  public static async switch(target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.switch", target };
    const res = await DesktopBridge.call("switchApplication", { title: target });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Switched window to: ${target || "next window"}`, metadata: res.result };
  }

  public static async resize(width: number, height: number, target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.resize", target, parameters: { width, height } };
    const res = await DesktopBridge.call("resizeWindow", { title: target, width, height });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Resized window ${target || "active"} to ${width}x${height}`, metadata: res.result };
  }

  public static async move(x: number, y: number, target?: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "window.move", target, coordinates: { x, y } };
    const res = await DesktopBridge.call("moveWindow", { title: target, x, y });
    if (!res.ok) return { success: false, action, error: res.error };
    return { success: true, action, message: `Moved window ${target || "active"} to (${x}, ${y})`, metadata: res.result };
  }
}
