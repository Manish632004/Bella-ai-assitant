/**
 * Action Validator Layer
 * Ensures type safety, bounds checks, whitelisted applications, and URL validity.
 */

import { ComputerAction, ActionResult } from "../types";
import { AppRegistry } from "../windows/AppRegistry";

export class ActionValidator {
  public static validate(action: ComputerAction): { valid: boolean; error?: string } {
    if (!action || !action.type) {
      return { valid: false, error: "Missing action type." };
    }

    switch (action.type) {
      case "mouse.move":
      case "mouse.click":
      case "mouse.doubleClick":
      case "mouse.rightClick": {
        if (action.coordinates) {
          const { x, y } = action.coordinates;
          if (typeof x !== "number" || typeof y !== "number" || isNaN(x) || isNaN(y)) {
            return { valid: false, error: `Invalid mouse coordinates: (${x}, ${y})` };
          }
          if (x < 0 || y < 0 || x > 10000 || y > 10000) {
            return { valid: false, error: `Coordinates out of realistic screen bounds: (${x}, ${y})` };
          }
        }
        return { valid: true };
      }

      case "mouse.drag": {
        const p = action.parameters as any;
        if (!p || typeof p.startX !== "number" || typeof p.startY !== "number" || typeof p.endX !== "number" || typeof p.endY !== "number") {
          return { valid: false, error: "mouse.drag requires startX, startY, endX, and endY numeric parameters." };
        }
        return { valid: true };
      }

      case "mouse.scroll": {
        const p = action.parameters as any;
        const amount = p?.amount !== undefined ? p.amount : action.value;
        if (amount !== undefined && isNaN(Number(amount))) {
          return { valid: false, error: "mouse.scroll requires a valid numeric amount." };
        }
        return { valid: true };
      }

      case "keyboard.type": {
        const text = action.value ?? (typeof action.target === "string" ? action.target : "");
        if (typeof text !== "string") {
          return { valid: false, error: "keyboard.type requires text string value." };
        }
        return { valid: true };
      }

      case "keyboard.press": {
        const key = action.value ?? (typeof action.target === "string" ? action.target : "");
        if (!key || typeof key !== "string") {
          return { valid: false, error: "keyboard.press requires a target key string (e.g. ENTER, ESC, TAB)." };
        }
        return { valid: true };
      }

      case "keyboard.hotkey": {
        const keys = (action.parameters as any)?.keys ?? action.value;
        if (!keys) {
          return { valid: false, error: "keyboard.hotkey requires an array of keys or combo string." };
        }
        return { valid: true };
      }

      case "app.open": {
        const appName = typeof action.target === "string" ? action.target : action.value;
        if (!appName || typeof appName !== "string") {
          return { valid: false, error: "app.open requires an application name." };
        }
        const resolved = AppRegistry.resolve(appName);
        if (!resolved) {
          return {
            valid: false,
            error: `Application "${appName}" is not recognized in the safe application registry. Available: ${AppRegistry.getAll().map((a) => a.name).join(", ")}`,
          };
        }
        return { valid: true };
      }

      case "app.close": {
        const appName = typeof action.target === "string" ? action.target : action.value;
        if (!appName || typeof appName !== "string") {
          return { valid: false, error: "app.close requires target application name." };
        }
        return { valid: true };
      }

      case "window.focus":
      case "window.minimize":
      case "window.maximize":
      case "window.restore":
      case "window.switch": {
        return { valid: true };
      }

      case "browser.navigate": {
        const url = (typeof action.target === "string" ? action.target : action.value) || "";
        if (!url || typeof url !== "string") {
          return { valid: false, error: "browser.navigate requires a valid URL." };
        }
        try {
          const parsed = new URL(url.includes("://") ? url : `https://${url}`);
          if (!["http:", "https:", "about:"].includes(parsed.protocol)) {
            return { valid: false, error: `Disallowed URL protocol: ${parsed.protocol}` };
          }
        } catch {
          return { valid: false, error: `Malformed URL: ${url}` };
        }
        return { valid: true };
      }

      case "browser.click":
      case "browser.type":
      case "browser.select":
      case "browser.submit":
      case "browser.wait":
      case "browser.inspect":
      case "browser.read":
      case "browser.download":
      case "browser.screenshot": {
        return { valid: true };
      }

      default:
        return { valid: false, error: `Unknown action type: ${(action as any).type}` };
    }
  }
}
