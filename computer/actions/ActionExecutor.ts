/**
 * Unified Computer Action Executor
 * Orchestrates Validation -> Execution -> Verification -> Result Formatting.
 */

import {
  ComputerAction,
  ActionResult,
  ComputerActionExecutor,
  SemanticSelector,
  DragCoordinates,
} from "../types";
import { ActionValidator } from "../validation/ActionValidator";
import { ActionVerifier } from "../verification/ActionVerifier";
import { MouseController } from "../mouse/MouseController";
import { KeyboardController } from "../keyboard/KeyboardController";
import { WindowController } from "../windows/WindowController";
import { BrowserController } from "../browser/BrowserController";

export class ActionExecutor implements ComputerActionExecutor {
  public async execute(action: ComputerAction): Promise<ActionResult> {
    // 1. Validation phase
    const validation = ActionValidator.validate(action);
    if (!validation.valid) {
      return {
        success: false,
        action,
        error: `Validation rejected action: ${validation.error}`,
      };
    }

    try {
      let result: ActionResult;

      // 2. Dispatch to domain controller
      switch (action.type) {
        // === MOUSE ACTIONS ===
        case "mouse.move": {
          const coords = action.coordinates || (action.parameters as any) || { x: 0, y: 0 };
          result = await MouseController.move(coords.x, coords.y);
          break;
        }

        case "mouse.click": {
          const coords = action.coordinates || (action.parameters as any);
          result = await MouseController.click(coords?.x, coords?.y, "left");
          break;
        }

        case "mouse.doubleClick": {
          const coords = action.coordinates || (action.parameters as any);
          result = await MouseController.doubleClick(coords?.x, coords?.y);
          break;
        }

        case "mouse.rightClick": {
          const coords = action.coordinates || (action.parameters as any);
          result = await MouseController.rightClick(coords?.x, coords?.y);
          break;
        }

        case "mouse.drag": {
          const p = action.parameters as any;
          const coords: DragCoordinates = {
            startX: p.startX,
            startY: p.startY,
            endX: p.endX,
            endY: p.endY,
          };
          result = await MouseController.drag(coords, p.duration);
          break;
        }

        case "mouse.scroll": {
          const p = (action.parameters as any) || {};
          const direction = p.direction || (Number(action.value) < 0 ? "down" : "up") || "down";
          const amount = p.amount !== undefined ? p.amount : Math.abs(Number(action.value) || 300);
          result = await MouseController.scroll(direction, amount);
          break;
        }

        // === KEYBOARD ACTIONS ===
        case "keyboard.type": {
          const text = action.value ?? (typeof action.target === "string" ? action.target : "");
          result = await KeyboardController.type(text);
          break;
        }

        case "keyboard.press": {
          const key = action.value ?? (typeof action.target === "string" ? action.target : "enter");
          result = await KeyboardController.press(key);
          break;
        }

        case "keyboard.hotkey": {
          const keys = (action.parameters as any)?.keys ?? action.value ?? [];
          result = await KeyboardController.hotkey(keys);
          break;
        }

        // === WINDOWS APPLICATION ACTIONS ===
        case "app.open": {
          const appName = typeof action.target === "string" ? action.target : (action.value || "");
          result = await WindowController.openApp(appName);
          break;
        }

        case "app.close": {
          const appName = typeof action.target === "string" ? action.target : (action.value || "");
          result = await WindowController.closeApp(appName);
          break;
        }

        case "window.minimize": {
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.minimize(target);
          break;
        }

        case "window.maximize": {
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.maximize(target);
          break;
        }

        case "window.restore": {
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.restore(target);
          break;
        }

        case "window.focus": {
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.focus(target);
          break;
        }

        case "window.switch": {
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.switch(target);
          break;
        }

        case "window.resize": {
          const p = (action.parameters as any) || {};
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.resize(p.width || 1280, p.height || 800, target);
          break;
        }

        case "window.move": {
          const coords = action.coordinates || { x: 0, y: 0 };
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await WindowController.move(coords.x, coords.y, target);
          break;
        }

        // === BROWSER ACTIONS ===
        case "browser.navigate": {
          const url = (typeof action.target === "string" ? action.target : action.value) || "";
          result = await BrowserController.navigate(url);
          break;
        }

        case "browser.click": {
          const target = action.target || "";
          result = await BrowserController.click(target as string | SemanticSelector, action.coordinates);
          break;
        }

        case "browser.type": {
          const target = action.target || "";
          const text = action.value || "";
          result = await BrowserController.type(target as string | SemanticSelector, text);
          break;
        }

        case "browser.select": {
          const target = action.target || "";
          const value = action.value || "";
          result = await BrowserController.select(target as string | SemanticSelector, value);
          break;
        }

        case "browser.submit": {
          result = await BrowserController.submit(action.target as string | SemanticSelector);
          break;
        }

        case "browser.wait": {
          const p = (action.parameters as any) || {};
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await BrowserController.wait(p.waitType, target, p.timeoutMs);
          break;
        }

        case "browser.inspect": {
          result = await BrowserController.inspect();
          break;
        }

        case "browser.read": {
          result = await BrowserController.read();
          break;
        }

        case "browser.download": {
          const url = (typeof action.target === "string" ? action.target : action.value) || "";
          result = await BrowserController.download(url);
          break;
        }

        case "browser.screenshot": {
          const target = typeof action.target === "string" ? action.target : undefined;
          result = await BrowserController.screenshot(target);
          break;
        }

        default:
          return {
            success: false,
            action,
            error: `Unsupported action type: ${(action as any).type}`,
          };
      }

      // 3. Verification phase
      if (result.success) {
        const verification = await ActionVerifier.verify(action, null, result.metadata);
        if (!verification.verified) {
          result.success = false;
          result.error = `Verification warning: ${verification.message}`;
        }
      }

      return result;
    } catch (err: any) {
      return {
        success: false,
        action,
        error: `Action execution exception: ${err.message || err}`,
      };
    }
  }

  public async executeBatch(
    actions: ComputerAction[],
    options: { stopOnError?: boolean } = { stopOnError: true }
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const action of actions) {
      const res = await this.execute(action);
      results.push(res);

      if (!res.success && options.stopOnError) {
        break;
      }
    }

    return results;
  }
}
