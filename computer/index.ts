/**
 * Computer Action Engine — Public API
 */

export * from "./types";
export { ActionValidator } from "./validation/ActionValidator";
export { ActionVerifier } from "./verification/ActionVerifier";
export { MouseController } from "./mouse/MouseController";
export { KeyboardController } from "./keyboard/KeyboardController";
export { AppRegistry } from "./windows/AppRegistry";
export { WindowController } from "./windows/WindowController";
export { BrowserController } from "./browser/BrowserController";
export { DesktopBridge } from "./actions/DesktopBridge";
export { ActionExecutor } from "./actions/ActionExecutor";

import { ActionExecutor } from "./actions/ActionExecutor";

// Singleton engine instance
export const computerActionEngine = new ActionExecutor();
