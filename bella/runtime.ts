/**
 * BELLA 6.0 — cross-module runtime state.
 * The central registry injects the tool dispatcher here so capability modules
 * (scheduler firing scheduled actions, macros replaying steps, agents running
 * tools) can execute any registered tool programmatically.
 */
export type ToolDispatcher = (
  name: string,
  args: Record<string, any>,
  opts?: { record?: boolean },
) => Promise<unknown>;

let dispatcher: ToolDispatcher | null = null;

export function setDispatcher(fn: ToolDispatcher): void {
  dispatcher = fn;
}

/** Execute a registered BELLA tool by name. Throws if no dispatcher wired. */
export async function dispatchTool(
  name: string,
  args: Record<string, any> = {},
): Promise<unknown> {
  if (!dispatcher) throw new Error("BELLA tool dispatcher is not ready yet.");
  return dispatcher(name, args);
}

// --- Macro recording flag (macros.ts reads, registry sets) ---
export const runtime = {
  recordingMacro: false,
};
