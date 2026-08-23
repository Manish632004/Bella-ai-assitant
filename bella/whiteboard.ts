/**
 * BELLA 6.0 — Whiteboard & study engine.
 *
 * Bella opens a full-screen whiteboard and draws while she explains —
 * diagrams, equations, flowcharts. The board can be saved as a PNG when the
 * lesson's done. Built for learning, not just note-taking.
 */
import { Type } from "@google/genai";
import { generateJson } from "./util";
import { getCurrentApiKey } from "./util";
import type { ToolModule, BellaToolContext } from "./types";

export interface WbElement {
  type: "line" | "arrow" | "rect" | "circle" | "text" | "path";
  /** Normalized coordinates 0..1000 on a virtual canvas. */
  x?: number; y?: number; x2?: number; y2?: number;
  w?: number; h?: number; r?: number;
  /** For path: array of [x,y] points. */
  points?: [number, number][];
  text?: string;
  color?: string;
  width?: number;
}

function send(ctx: BellaToolContext, event: Record<string, unknown>): void {
  ctx.clientWs?.send(JSON.stringify(event));
}

const EXPLAIN_SYSTEM = `You are a study-visualizer. Given a concept, produce a whiteboard drawing plan.
Return ONLY JSON: {"elements":[ ... ], "narration":"2-4 sentence spoken explanation of the diagram"}
Element types (virtual canvas coordinates x,y from 0 to 1000):
{"type":"rect","x":..,"y":..,"w":..,"h":..,"color":"#38bdf8","width":3}
{"type":"circle","x":..,"y":..,"r":..,"color":"#a78bfa","width":3}
{"type":"line","x":..,"y":..,"x2":..,"y2":..,"color":"#e2e8f0","width":3}
{"type":"arrow","x":..,"y":..,"x2":..,"y2":..,"color":"#fbbf24","width":3}
{"type":"path","points":[[x,y],[x,y],...],"color":"#34d399","width":4}
{"type":"text","x":..,"y":..,"text":"short label (max 24 chars)","color":"#ffffff"}
Rules: keep it clean and readable — max 14 elements; label every box/circle;
use arrows for flow; spread elements out; title via a large text element at top.`;

export const whiteboardModule: ToolModule = {
  name: "whiteboard",
  declarations: [
    {
      name: "openWhiteboard",
      description: "Open the full-screen whiteboard overlay so you can teach or draw on it.",
      parameters: {
        type: Type.OBJECT,
        properties: { topic: { type: Type.STRING, description: "Optional lesson title shown on the board." } },
      },
    },
    {
      name: "explainWithWhiteboard",
      description: "Teach a concept on the whiteboard: plans a clean diagram (boxes, arrows, labels), draws it step by step while explaining aloud. 'Explain how a transformer works. Draw it.'",
      parameters: {
        type: Type.OBJECT,
        properties: { topic: { type: Type.STRING }, openIfClosed: { type: Type.BOOLEAN } },
        required: ["topic"],
      },
    },
    {
      name: "drawOnWhiteboard",
      description: "Draw specific elements on the whiteboard (line/arrow/rect/circle/text/path with 0-1000 canvas coords).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          elements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, description: "line|arrow|rect|circle|text|path" },
                x: { type: Type.NUMBER }, y: { type: Type.NUMBER },
                x2: { type: Type.NUMBER }, y2: { type: Type.NUMBER },
                w: { type: Type.NUMBER }, h: { type: Type.NUMBER }, r: { type: Type.NUMBER },
                text: { type: Type.STRING }, color: { type: Type.STRING }, width: { type: Type.NUMBER },
              },
            },
            description: "List of elements to add.",
          },
        },
        required: ["elements"],
      },
    },
    {
      name: "clearWhiteboard",
      description: "Erase everything on the whiteboard.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "saveWhiteboard",
      description: "Save the current whiteboard as a PNG into ~/Pictures/BellaBoards.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING } },
      },
    },
    {
      name: "closeWhiteboard",
      description: "Close the whiteboard overlay.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
  async execute(name, args, ctx) {
    switch (name) {
      case "openWhiteboard":
        send(ctx, { type: "whiteboard_open", topic: args.topic || "" });
        return { result: `Whiteboard is up${args.topic ? ` — titled "${args.topic}"` : ""}.` };

      case "explainWithWhiteboard": {
        const topic = String(args.topic);
        if (args.openIfClosed !== false) send(ctx, { type: "whiteboard_open", topic });
        let plan: { elements: WbElement[]; narration?: string };
        try {
          const apiKey = ctx.apiKey || getCurrentApiKey() || "";
          plan = await generateJson<{ elements: WbElement[]; narration?: string }>(
            apiKey,
            `Concept to visualize on a whiteboard: "${topic}"`,
            EXPLAIN_SYSTEM,
          );
        } catch (err: any) {
          throw new Error(`Couldn't plan the drawing: ${err?.message || err}`);
        }
        // Draw element-by-element with small pacing so it feels hand-drawn live.
        const elements = Array.isArray(plan.elements) ? plan.elements.slice(0, 16) : [];
        for (const el of elements) {
          send(ctx, { type: "whiteboard_draw", element: el });
          await new Promise(r => setTimeout(r, 350));
        }
        return {
          result: `Drew ${elements.length} elements explaining "${topic}". ${plan.narration || ""}`.trim(),
        };
      }

      case "drawOnWhiteboard": {
        const els = Array.isArray(args.elements) ? (args.elements as WbElement[]) : [];
        if (!els.length) throw new Error("No elements provided.");
        for (const el of els) send(ctx, { type: "whiteboard_draw", element: el });
        return { result: `Added ${els.length} element(s) to the board.` };
      }

      case "clearWhiteboard":
        send(ctx, { type: "whiteboard_clear" });
        return { result: "Board wiped clean." };

      case "saveWhiteboard": {
        const saveName = String(args.name || `whiteboard-${Date.now()}`);
        send(ctx, { type: "whiteboard_save", name: saveName });
        return { result: `Saving the board as PNG in ~/Pictures/BellaBoards (${saveName}).` };
      }

      case "closeWhiteboard":
        send(ctx, { type: "whiteboard_close" });
        return { result: "Whiteboard closed." };
    }
    throw new Error(`Unknown whiteboard tool: ${name}`);
  },
};
