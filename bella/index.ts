/**
 * BELLA 6.0 — Central capability registry.
 *
 * Aggregates every capability module into one Gemini function-declaration set
 * plus a single async dispatcher. server.ts wires this into the Live session
 * with ONE integration point; background services (scheduler ticker, clipboard
 * watcher) start from here too.
 */
import type { FunctionDeclaration } from "@google/genai";
import type { BellaToolContext, ToolModule } from "./types";

import { personasModule } from "./personas";
import { schedulerModule, startSchedulerTicker } from "./scheduler";
import { macrosModule } from "./macros";
import { documentsModule } from "./documents";
import { agentsModule } from "./agents";
import { emailModule, whatsappModule, expensesModule } from "./comms";
import { phonelinkModule } from "./phonelink";
import { creatorModule } from "./creator";
import { extrasModule, startClipboardWatcher } from "./extras";
import { skillsModule } from "./skills";
import { guardianModule } from "./guardian";
import { updaterModule } from "./updater";
import { whiteboardModule } from "./whiteboard";
import { setDispatcher } from "./runtime";
import { recordStep, isRecording } from "./macros";

const MODULES: ToolModule[] = [
  personasModule,
  schedulerModule,
  macrosModule,
  documentsModule,
  agentsModule,
  emailModule,
  whatsappModule,
  expensesModule,
  phonelinkModule,
  creatorModule,
  extrasModule,
  skillsModule,
  guardianModule,
  updaterModule,
  whiteboardModule,
];

export const bellaDeclarations: FunctionDeclaration[] =
  MODULES.flatMap(m => m.declarations as FunctionDeclaration[]);

export const bellaToolCount = bellaDeclarations.length;

export function isBellaTool(name: string): boolean {
  return MODULES.some(m => m.declarations.some(d => (d as { name?: string }).name === name));
}

/** Execute a registered BELLA tool and capture it into macro recordings. */
export async function executeBellaTool(
  name: string,
  args: Record<string, any>,
  ctx: BellaToolContext,
): Promise<unknown> {
  for (const m of MODULES) {
    if (m.declarations.some(d => (d as { name?: string }).name === name)) {
      const result = await m.execute(name, args || {}, ctx);
      if (isRecording()) recordStep(name, args || {});
      return result;
    }
  }
  throw new Error(`Unknown BELLA tool: ${name}`);
}

// ---------------------------------------------------------------------------
// Background dispatcher — lets macros/scheduler/agents run ANY tool even when
// no live session exists. server.ts can register a richer executor that also
// covers the desktop-agent toolset.
// ---------------------------------------------------------------------------
type FullExecutor = (name: string, args: Record<string, any>) => Promise<unknown>;
let fullExecutor: FullExecutor | null = null;
let lastCtx: BellaToolContext = {
  apiKey: "",
  clientWs: null,
  sessionId: "background",
};

export function registerFullExecutor(fn: FullExecutor): void {
  fullExecutor = fn;
}
export function updateBellaCtx(ctx: Partial<BellaToolContext>): void {
  lastCtx = { ...lastCtx, ...ctx };
}

setDispatcher(async (name, args) => {
  if (fullExecutor && !isBellaTool(name)) return fullExecutor(name, args);
  return executeBellaTool(name, args, lastCtx);
});

/** Start periodic background engines. Called once by server.ts on boot. */
export function startBellaServices(): void {
  startSchedulerTicker();
  startClipboardWatcher();
}
