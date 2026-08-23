/**
 * BELLA 6.0 capability modules — shared types.
 *
 * Every capability area (personas, scheduler, macros, documents, agents,
 * comms, creator suite, skills, guardian …) is a ToolModule that exports
 * Gemini function declarations plus an async execute() dispatcher. The
 * central registry in index.ts aggregates them; server.ts wires them into
 * the Live session with one integration point.
 */
import type { FunctionDeclaration } from "@google/genai";

export interface BellaToolContext {
  /** Active Gemini API key (key-pool aware) for one-shot text/vision calls. */
  apiKey: string;
  /** The connected HUD websocket, if any. */
  clientWs: { send: (data: string) => void } | null;
  /** Current live session id ("default_bella_session" fallback). */
  sessionId: string;
}

export interface ToolModule {
  name: string;
  declarations: FunctionDeclaration[];
  execute(name: string, args: Record<string, any>, ctx: BellaToolContext): Promise<unknown>;
}

export function decl(d: FunctionDeclaration): FunctionDeclaration {
  return d;
}
