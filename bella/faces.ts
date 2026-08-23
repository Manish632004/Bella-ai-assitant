/**
 * BELLA 6.0 — Camera & faces.
 *
 * "Look through the webcam, describe what she sees, capture a photo, and
 * recognise people she's been introduced to."
 *
 * Enrollment stores reference frames per person; identification compares the
 * live frame against references with the vision model. The HUD captures
 * camera frames on demand via the face_capture WS event and posts them back,
 * so tool calls stay synchronous from Bella's point of view.
 */
import crypto from "crypto";
import express from "express";
import fs from "fs";
import path from "path";
import { Type } from "@google/genai";
import {
  readSecretJson, writeSecretJson, analyzeImages, getCurrentApiKey, HOME, ensureDir,
  dataFilePath,
} from "./util";
import type { ToolModule, BellaToolContext } from "./types";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
interface KnownPerson { name: string; frames: string[]; addedAt: string; }
interface FacesStore { people: KnownPerson[]; }
const FACES_FILE = dataFilePath("faces.json");
const loadFaces = (): FacesStore => readSecretJson<FacesStore>(FACES_FILE, { people: [] });
const saveFaces = (s: FacesStore) => writeSecretJson(FACES_FILE, s);

const SNAP_DIR = ensureDir(path.join(HOME(), "Pictures", "BellaFaces"));

// ---------------------------------------------------------------------------
// Pending capture requests (tool → client → REST callback)
// ---------------------------------------------------------------------------
const pendingCaptures = new Map<string, (frames: string[]) => void>();

function requestCameraFrames(ctx: BellaToolContext, count: number, purpose: string, timeoutMs = 30000): Promise<string[]> {
  const requestId = crypto.randomBytes(6).toString("hex");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingCaptures.has(requestId)) {
        pendingCaptures.delete(requestId);
        resolve([]);
      }
    }, timeoutMs);
    pendingCaptures.set(requestId, (frames) => {
      clearTimeout(timer);
      pendingCaptures.delete(requestId);
      resolve(frames);
    });
    ctx.clientWs?.send(JSON.stringify({ type: "face_capture", requestId, count, purpose }));
  });
}

// ---------------------------------------------------------------------------
// Vision matching
// ---------------------------------------------------------------------------
async function identifyFrame(apiKey: string, probe: string): Promise<{ name: string | null; note: string }> {
  const store = loadFaces();
  if (!store.people.length) return { name: null, note: "no one is enrolled yet" };

  let best: { name: string; score: number } | null = null;
  for (const person of store.people.slice(0, 8)) {
    const refs = person.frames.slice(0, 3);
    if (!refs.length) continue;
    const raw = await analyzeImages(
      apiKey,
      [probe, ...refs],
      `Image 1 shows a person seen right now. Images 2-${refs.length + 1} are reference photos of "${person.name}".
Is the person in image 1 the same person as in the references? Judge by face structure — ignore lighting/angle/clothing.
Reply ONLY JSON: {"same":true|false,"confidence":0.0-1.0}`,
    );
    try {
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      if (parsed.same && typeof parsed.confidence === "number") {
        if (!best || parsed.confidence > best.score) best = { name: person.name, score: parsed.confidence };
      }
    } catch { /* skip malformed */ }
  }

  if (best && best.score >= 0.6) return { name: best.name, note: `confidence ${(best.score * 100).toFixed(0)}%` };
  return { name: null, note: best ? `closest was ${best.name} at ${(best.score * 100).toFixed(0)}%` : "no strong match" };
}

// ---------------------------------------------------------------------------
// REST router — /api/bella/faces/*
// ---------------------------------------------------------------------------
export const facesRouter = express.Router();

facesRouter.post("/capture-result", express.json({ limit: "30mb" }), (req, res) => {
  const { requestId, frames } = req.body || {};
  const resolver = pendingCaptures.get(String(requestId || ""));
  if (!resolver) return res.status(404).json({ ok: false, error: "Unknown or expired capture request." });
  resolver(Array.isArray(frames) ? frames.map(String) : []);
  res.json({ ok: true });
});

facesRouter.get("/people", (_req, res) => {
  const store = loadFaces();
  res.json({
    people: store.people.map(p => ({ name: p.name, photos: p.frames.length, addedAt: p.addedAt })),
  });
});

facesRouter.delete("/people/:name", (req, res) => {
  const store = loadFaces();
  const before = store.people.length;
  store.people = store.people.filter(p => p.name.toLowerCase() !== String(req.params.name).toLowerCase());
  saveFaces(store);
  res.json({ ok: true, removed: before - store.people.length });
});

// ---------------------------------------------------------------------------
// Tool module
// ---------------------------------------------------------------------------
export const facesModule: ToolModule = {
  name: "faces",
  declarations: [
    {
      name: "introducePerson",
      description: "Meet someone new: captures a few webcam frames of the person in front of the camera and remembers their face by name. 'This is Priya, remember her.'",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING } },
        required: ["name"],
      },
    },
    {
      name: "whoIsThis",
      description: "Look through the webcam and identify the person currently visible — matches against everyone you've been introduced to.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "listKnownPeople",
      description: "List everyone whose face you have been introduced to.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "forgetPerson",
      description: "Delete a person's stored face references.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING } },
        required: ["name"],
      },
    },
  ],
  async execute(name, args, ctx) {
    switch (name) {
      case "introducePerson": {
        const personName = String(args.name || "").trim();
        if (!personName) throw new Error("I need a name to remember.");
        const frames = await requestCameraFrames(ctx, 3, `enroll:${personName}`);
        if (!frames.length) {
          return { result: `I couldn't see the camera just now. Turn on camera vision and make sure ${personName} is visible, then introduce them again.` };
        }
        const store = loadFaces();
        const existing = store.people.find(p => p.name.toLowerCase() === personName.toLowerCase());
        if (existing) {
          existing.frames = [...existing.frames, ...frames].slice(-5);
          existing.addedAt = new Date().toISOString();
        } else {
          store.people.push({ name: personName, frames: frames.slice(0, 3), addedAt: new Date().toISOString() });
        }
        saveFaces(store);
        // Keep a local copy of the first frame for records.
        try {
          fs.writeFileSync(path.join(SNAP_DIR, `${personName.replace(/[^\w-]+/g, "_")}.jpg`), Buffer.from(frames[0], "base64"));
        } catch {}
        return { result: `Nice to meet you, ${personName}! I've memorized your face (${frames.length} reference frames). I'll recognize you next time.` };
      }
      case "whoIsThis": {
        const frames = await requestCameraFrames(ctx, 1, "identify");
        if (!frames.length) {
          return { result: "The camera isn't showing me anything. Enable camera vision and try again." };
        }
        const apiKey = ctx.apiKey || getCurrentApiKey();
        const verdict = await identifyFrame(apiKey, frames[0]);
        if (verdict.name) {
          return { result: `That's ${verdict.name}! (${verdict.note})`, person: verdict.name };
        }
        return { result: `I don't recognize this person yet (${verdict.note}). Introduce them by saying "this is <name>, remember her/him".` };
      }
      case "listKnownPeople": {
        const people = loadFaces().people;
        return {
          result: people.length
            ? `I know: ${people.map(p => p.name).join(", ")}.`
            : "I haven't been introduced to anyone yet.",
        };
      }
      case "forgetPerson": {
        const target = String(args.name || "").toLowerCase();
        const store = loadFaces();
        const before = store.people.length;
        store.people = store.people.filter(p => p.name.toLowerCase() !== target);
        saveFaces(store);
        return store.people.length < before
          ? { result: `Forgot ${args.name}.` }
          : { result: `I don't know anyone called "${args.name}".` };
      }
    }
    throw new Error(`Unknown faces tool: ${name}`);
  },
};
