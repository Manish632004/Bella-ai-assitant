/**
 * BELLA 6.0 — Macros: teach by doing.
 *
 * Hit record, let Bella perform the task once (every executed tool call is
 * captured), say stop — the steps are kept as a named macro that can be
 * replayed, edited step-by-step, duplicated, scheduled, exported or imported.
 */
import fs from "fs";
import path from "path";
import { dataFile } from "../server_paths";
import { readJson, writeJson, ensureDir, HOME, announce } from "./util";
import { runtime, dispatchTool } from "./runtime";
import { addReminder, describeWhen, parseWhenText } from "./scheduler";
import type { ToolModule } from "./types";
import { Type } from "@google/genai";

export interface MacroStep { tool: string; args: Record<string, any>; }
export interface Macro {
  name: string;
  description?: string;
  steps: MacroStep[];
  createdAt: string;
  updatedAt: string;
}

const MACROS_DIR = ensureDir(dataFile("macros"));
const macroPath = (name: string) => path.join(MACROS_DIR, `${sanitize(name)}.json`);

function sanitize(name: string): string {
  return String(name || "macro").trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "macro";
}

const loadMacros = (): Record<string, Macro> => {
  const out: Record<string, Macro> = {};
  try {
    for (const f of fs.readdirSync(MACROS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const m = readJson<Macro | null>(path.join(MACROS_DIR, f), null);
      if (m?.name) out[m.name.toLowerCase()] = m;
    }
  } catch {}
  return out;
};

// --- Recording buffer ---
let buffer: MacroStep[] = [];
let recordingName = "";

/** Called by the central registry after each successful tool execution. */
export function recordStep(tool: string, args: Record<string, any>): void {
  if (!runtime.recordingMacro) return;
  if (tool === "startMacroRecording" || tool === "stopMacroRecording") return;
  buffer.push({ tool, args });
}

export function isRecording(): boolean { return runtime.recordingMacro; }
export function currentRecordingName(): string { return recordingName; }

async function runMacroSteps(steps: MacroStep[]): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    try {
      await dispatchTool(s.tool, s.args);
      results.push(`step ${i + 1}: ${s.tool} ok`);
    } catch (err: any) {
      results.push(`step ${i + 1}: ${s.tool} FAILED (${err?.message || err})`);
    }
  }
  return results;
}

export const macrosModule: ToolModule = {
  name: "macros",
  declarations: [
    {
      name: "startMacroRecording",
      description: "Start recording a macro. Every tool BELLA executes from now on is captured as a step until stopMacroRecording.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING, description: "Optional name; asked at stop time if omitted." } },
      },
    },
    {
      name: "stopMacroRecording",
      description: "Stop recording and save the captured steps as a named macro.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Name for the macro, e.g. 'morning setup'." },
          description: { type: Type.STRING },
        },
        required: ["name"],
      },
    },
    {
      name: "runMacro",
      description: "Replay a saved macro by name, executing its recorded steps in order.",
      parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
    },
    {
      name: "listMacros",
      description: "List all saved macros with their step counts.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "deleteMacro",
      description: "Delete a saved macro.",
      parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
    },
    {
      name: "duplicateMacro",
      description: "Duplicate a macro under a new name.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, newName: { type: Type.STRING } },
        required: ["name", "newName"],
      },
    },
    {
      name: "editMacroStep",
      description: "Edit one recorded step of a macro: replace the tool and/or arguments, or remove the step.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          index: { type: Type.INTEGER, description: "1-based step number." },
          tool: { type: Type.STRING },
          args: { type: Type.OBJECT, description: "Replacement args object.", properties: {} },
          remove: { type: Type.BOOLEAN, description: "true to delete the step." },
        },
        required: ["name", "index"],
      },
    },
    {
      name: "scheduleMacro",
      description: "Schedule a macro to run automatically — e.g. every day at 9am. Uses natural-language time ('every day at 9', 'weekdays at 08:45').",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, whenText: { type: Type.STRING } },
        required: ["name", "whenText"],
      },
    },
    {
      name: "exportMacro",
      description: "Export a macro as JSON to ~/BellaMacros/<name>.json so it can be shared.",
      parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
    },
    {
      name: "importMacro",
      description: "Import a macro from an exported JSON file path.",
      parameters: { type: Type.OBJECT, properties: { filePath: { type: Type.STRING } }, required: ["filePath"] },
    },
  ],
  async execute(name, args, ctx) {
    if (name === "startMacroRecording") {
      buffer = [];
      recordingName = String(args?.name || "");
      runtime.recordingMacro = true;
      ctx.clientWs?.send(JSON.stringify({ type: "macro_recording", active: true }));
      return { result: `Recording started${recordingName ? ` for "${recordingName}"` : ""}. Every action I take is being captured. Say 'stop recording' when done.` };
    }
    if (name === "stopMacroRecording") {
      if (!runtime.recordingMacro) return { result: "No macro recording is active." };
      runtime.recordingMacro = false;
      const macroName = String(args.name || recordingName || "").trim();
      ctx.clientWs?.send(JSON.stringify({ type: "macro_recording", active: false }));
      if (!macroName) return { result: `Recording discarded — no name given. Captured ${buffer.length} steps.` };
      const macro: Macro = {
        name: sanitize(macroName),
        description: args.description,
        steps: buffer,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeJson(macroPath(macro.name), macro);
      buffer = [];
      return { result: `Macro "${macro.name}" saved with ${macro.steps.length} steps. Say "run macro ${macro.name}" anytime, or schedule it.` };
    }
    if (name === "runMacro") {
      const m = loadMacros()[String(args.name || "").toLowerCase()];
      if (!m) return { result: `No macro named "${args.name}" found.` };
      announce(`Running macro ${m.name} now.`);
      const results = await runMacroSteps(m.steps);
      return { result: `Macro "${m.name}" finished. ${results.join("; ")}` };
    }
    if (name === "listMacros") {
      const all = Object.values(loadMacros());
      if (!all.length) return { result: "No macros saved yet. Record one by saying 'record a macro'." };
      return { result: all.map(m => `- ${m.name}: ${m.steps.length} steps`).join("\n"), count: all.length };
    }
    if (name === "deleteMacro") {
      const p = macroPath(String(args.name));
      if (!fs.existsSync(p)) return { result: `No macro named "${args.name}".` };
      fs.unlinkSync(p);
      return { result: `Deleted macro "${args.name}".` };
    }
    if (name === "duplicateMacro") {
      const m = loadMacros()[String(args.name).toLowerCase()];
      if (!m) return { result: `No macro named "${args.name}".` };
      const copy: Macro = { ...m, name: sanitize(String(args.newName)), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      writeJson(macroPath(copy.name), copy);
      return { result: `Duplicated to "${copy.name}".` };
    }
    if (name === "editMacroStep") {
      const m = loadMacros()[String(args.name).toLowerCase()];
      if (!m) return { result: `No macro named "${args.name}".` };
      const idx = Number(args.index) - 1;
      if (idx < 0 || idx >= m.steps.length) return { result: `Invalid step index. "${m.name}" has ${m.steps.length} steps.` };
      if (args.remove) {
        m.steps.splice(idx, 1);
      } else {
        if (args.tool) m.steps[idx].tool = String(args.tool);
        if (args.args && typeof args.args === "object") m.steps[idx].args = args.args;
      }
      m.updatedAt = new Date().toISOString();
      writeJson(macroPath(m.name), m);
      return { result: `Updated "${m.name}" — now ${m.steps.length} steps.` };
    }
    if (name === "scheduleMacro") {
      const r = addReminder({
        text: `Run macro "${args.name}"`,
        when: undefined,
        whenText: String(args.whenText),
        action: { kind: "macro", macroName: String(args.name) },
      });
      return { result: `Macro "${args.name}" scheduled to run ${describeWhen(r)}.` };
    }
    if (name === "exportMacro") {
      const m = loadMacros()[String(args.name).toLowerCase()];
      if (!m) return { result: `No macro named "${args.name}".` };
      const dir = ensureDir(path.join(HOME(), "BellaMacros"));
      const dest = path.join(dir, `${m.name}.json`);
      fs.copyFileSync(macroPath(m.name), dest);
      return { result: `Exported to ${dest}.` };
    }
    if (name === "importMacro") {
      const src = String(args.filePath || "").replace(/^~/, HOME());
      if (!fs.existsSync(src)) return { result: `File not found: ${src}` };
      const m = JSON.parse(fs.readFileSync(src, "utf-8")) as Macro;
      if (!m.name || !Array.isArray(m.steps)) throw new Error("Not a valid BELLA macro file.");
      m.updatedAt = new Date().toISOString();
      writeJson(macroPath(sanitize(m.name)), m);
      return { result: `Imported macro "${m.name}" with ${m.steps.length} steps.` };
    }
    throw new Error(`Unknown macros tool: ${name}`);
  },
};
