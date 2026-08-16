/**
 * Unified Computer Action Engine Type Definitions
 */

export type ActionType =
  // Mouse actions
  | "mouse.move"
  | "mouse.click"
  | "mouse.doubleClick"
  | "mouse.rightClick"
  | "mouse.drag"
  | "mouse.scroll"
  // Keyboard actions
  | "keyboard.type"
  | "keyboard.press"
  | "keyboard.hotkey"
  // Application & Window actions
  | "app.open"
  | "app.close"
  | "window.minimize"
  | "window.maximize"
  | "window.restore"
  | "window.focus"
  | "window.switch"
  | "window.resize"
  | "window.move"
  // Browser automation actions
  | "browser.navigate"
  | "browser.click"
  | "browser.type"
  | "browser.select"
  | "browser.submit"
  | "browser.wait"
  | "browser.inspect"
  | "browser.read"
  | "browser.download"
  | "browser.screenshot";

export interface Coordinates {
  x: number;
  y: number;
}

export interface DragCoordinates {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface SemanticSelector {
  role?: string;
  name?: string;
  label?: string;
  testId?: string;
  id?: string;
  css?: string;
  text?: string;
  xpath?: string;
  coordinates?: Coordinates;
}

export interface ComputerAction {
  type: ActionType;
  target?: string | SemanticSelector;
  value?: string;
  coordinates?: Coordinates;
  parameters?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  action: ComputerAction;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ComputerActionExecutor {
  execute(action: ComputerAction): Promise<ActionResult>;
  executeBatch(actions: ComputerAction[], options?: { stopOnError?: boolean }): Promise<ActionResult[]>;
}

export interface ApplicationDefinition {
  id: string;
  name: string;
  executable: string;
  aliases: string[];
  protocol?: string;
  category?: string;
}

export interface WindowInfo {
  hwnd?: number | string;
  title: string;
  processName?: string;
  pid?: number;
  isActive?: boolean;
}

export interface PageContentSummary {
  url: string;
  title: string;
  headings: string[];
  text: string;
  links: { text: string; href: string }[];
  inputs?: { label?: string; name?: string; type?: string; value?: string }[];
  buttons?: string[];
}

export interface DOMInspectionResult {
  url: string;
  title: string;
  interactiveElements: {
    role: string;
    name?: string;
    text?: string;
    selector?: string;
    id?: string;
  }[];
}
