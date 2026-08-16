/**
 * Keyboard Controller
 * Supports text typing, key presses, and hotkey combinations with modifiers.
 */

import { ActionResult, ComputerAction } from "../types";
import { DesktopBridge } from "../actions/DesktopBridge";

export class KeyboardController {
  public static async type(text: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "keyboard.type", value: text };
    const res = await DesktopBridge.call("keyboardType", { text });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Typed text: "${text.length > 50 ? text.slice(0, 50) + "..." : text}"`,
      metadata: res.result,
    };
  }

  public static async press(key: string): Promise<ActionResult> {
    const action: ComputerAction = { type: "keyboard.press", value: key };
    const res = await DesktopBridge.call("keyboardPress", { key });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Pressed key: ${key.toUpperCase()}`,
      metadata: res.result,
    };
  }

  public static async hotkey(keys: string[] | string): Promise<ActionResult> {
    const keysArray = typeof keys === "string" ? keys.split("+").map((k) => k.trim()) : keys;
    const action: ComputerAction = {
      type: "keyboard.hotkey",
      parameters: { keys: keysArray },
      value: keysArray.join("+"),
    };
    const res = await DesktopBridge.call("keyboardHotkey", { keys: keysArray });
    if (!res.ok) {
      return { success: false, action, error: res.error };
    }
    return {
      success: true,
      action,
      message: `Executed hotkey: ${keysArray.join("+").toUpperCase()}`,
      metadata: res.result,
    };
  }
}
