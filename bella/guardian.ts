/**
 * BELLA 6.0 — Voice Guardian.
 *
 * Bella learns your voiceprint from a few "Hey Bella" samples. Arm her and
 * guests get a restricted toolset — no file deletion, no terminal-level power
 * actions, no personal memory. She also keeps a log of who spoke while you
 * were away ("who spoke while I was gone?").
 *
 * Zero dependencies: WAV parsing + Goertzel-based spectral voiceprint.
 */
import express from "express";
import { Type } from "@google/genai";
import { readJson, writeJson, dataFilePath } from "./util";
import type { ToolModule } from "./types";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
interface GuardianStore {
  prints: number[][];          // enrolled owner voiceprints
  armed: boolean;              // guest-restriction mode on/off
  threshold: number;           // cosine similarity threshold (default 0.90)
  recognitions: { time: string; identity: string; score: number }[];
}
const STORE_FILE = dataFilePath("guardian.json");
const loadStore = (): GuardianStore =>
  readJson<GuardianStore>(STORE_FILE, { prints: [], armed: false, threshold: 0.9, recognitions: [] });
const saveStore = (s: GuardianStore) => writeJson(STORE_FILE, s);

// Session identity state (set by server.ts after wake-check verification)
let lastSpeaker: "owner" | "guest" | "unknown" = "unknown";
export function getLastSpeaker(): string { return lastSpeaker; }
export function isGuestMode(): boolean {
  const s = loadStore();
  return s.armed && s.prints.length > 0 && lastSpeaker === "guest";
}
export function markSpeaker(identity: "owner" | "guest" | "unknown"): void {
  if (identity === lastSpeaker) return;
  lastSpeaker = identity;
  const s = loadStore();
  s.recognitions.push({ time: new Date().toISOString(), identity, score: -1 });
  saveStore(s);
}

/** Tools guests may never touch. */
const GUARDIAN_BLOCKED = new Set([
  "deleteFile", "requestPowerAction", "executePowerAction",
  "cleanTempFiles", "batchRename", "sortFolderByType", "unzipArchive",
  "configureEmail", "clearJunkFolder", "replyToLatest", "sendEmail",
  "saveCustomMemory", "rememberVisualContext", "confirmPersonalMemory",
  "learnSkill", "deleteSkill", "loadPlugin", "runSkill",
  "startHermesMission", "startCodingMission", "delegateTask", "delegateParallel",
  "scheduleAction", "setReminder", "cancelReminder", "startMacroRecording", "runMacro",
]);

/** Filter declarations for guest sessions. */
export function filterDeclarationsForGuest<T extends { name?: string }>(decls: T[]): T[] {
  if (!isGuestMode()) return decls;
  return decls.filter(d => !d.name || !GUARDIAN_BLOCKED.has(d.name));
}

// ---------------------------------------------------------------------------
// Audio → voiceprint (WAV PCM16 → Goertzel spectral fingerprint)
// ---------------------------------------------------------------------------
function decodeWav(base64: string): { samples: Float32Array; sampleRate: number } | null {
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
    // walk chunks
    let pos = 12;
    let channels = 1, sampleRate = 16000, bitsPerSample = 16;
    let dataStart = -1, dataLen = 0;
    while (pos + 8 <= buf.length) {
      const id = buf.toString("ascii", pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      if (id === "fmt ") {
        channels = buf.readUInt16LE(pos + 10);
        sampleRate = buf.readUInt32LE(pos + 12);
        bitsPerSample = buf.readUInt16LE(pos + 22);
      } else if (id === "data") {
        dataStart = pos + 8;
        dataLen = Math.min(size, buf.length - dataStart);
        break;
      }
      pos += 8 + size + (size % 2);
    }
    if (dataStart < 0 || bitsPerSample !== 16) return null;

    const bytesPerSample = bitsPerSample / 8;
    const framesCount = Math.floor(dataLen / (bytesPerSample * channels));
    const mono = new Float32Array(framesCount);
    for (let i = 0; i < framesCount; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const off = dataStart + (i * channels + ch) * bytesPerSample;
        sum += buf.readInt16LE(off) / 32768;
      }
      mono[i] = sum / channels;
    }
    return { samples: mono, sampleRate };
  } catch {
    return null;
  }
}

const BINS = Array.from({ length: 24 }, (_, i) =>
  Math.round(250 * Math.pow(3400 / 250, i / 23)));

function goertzel(frame: Float32Array, freq: number, sampleRate: number): number {
  const k = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(k);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < frame.length; i++) {
    s0 = frame[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

function extractPrint(base64Wav: string): number[] | null {
  const decoded = decodeWav(base64Wav);
  if (!decoded || decoded.samples.length < decoded.sampleRate / 2) return null;
  const { samples, sampleRate } = decoded;

  const frameSize = Math.round(0.032 * sampleRate);   // 32 ms
  const hop = Math.round(0.010 * sampleRate);          // 10 ms
  const acc = new Float64Array(BINS.length);
  let voicedFrames = 0;

  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameSize);
    let rms = 0;
    for (let i = 0; i < frame.length; i++) rms += frame[i] * frame[i];
    rms = Math.sqrt(rms / frame.length);
    if (rms < 0.01) continue; // skip silence
    voicedFrames++;
    for (let b = 0; b < BINS.length; b++) acc[b] += goertzel(frame, BINS[b], sampleRate);
  }
  if (voicedFrames < 5) return null;

  // log-compress, average over frames, L2-normalize
  const vec = Array.from(acc, v => Math.log10(v / voicedFrames + 1e-9));
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both unit vectors
}

/**
 * Identify the speaker of a base64 WAV against enrolled prints.
 * Returns "owner" | "guest" | "unknown".
 */
export function identifySpeaker(base64Wav: string): { identity: "owner" | "guest" | "unknown"; score: number } {
  const store = loadStore();
  if (!store.prints.length) return { identity: "unknown", score: 0 };
  const probe = extractPrint(base64Wav);
  if (!probe) return { identity: "unknown", score: 0 };
  let best = -1;
  for (const p of store.prints) best = Math.max(best, cosine(probe, p));
  const identity = best >= store.threshold ? "owner" : best >= store.threshold - 0.06 ? "guest" : "unknown";
  if (identity !== "unknown") markSpeaker(identity as "owner" | "guest");
  store.recognitions.push({ time: new Date().toISOString(), identity, score: Math.round(best * 1000) / 1000 });
  store.recognitions = store.recognitions.slice(-50);
  saveStore(store);
  return { identity, score: Math.round(best * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------
export const guardianRouter = express.Router();

guardianRouter.get("/status", (_req, res) => {
  const s = loadStore();
  res.json({
    enrolled: s.prints.length > 0,
    printCount: s.prints.length,
    armed: s.armed,
    threshold: s.threshold,
    lastSpeaker,
  });
});

guardianRouter.post("/enroll", (req, res) => {
  const { samples } = req.body || {};
  if (!Array.isArray(samples) || samples.length < 2) {
    return res.status(400).json({ error: "Need at least 2 recorded samples." });
  }
  const prints: number[][] = [];
  for (const s of samples.slice(0, 6)) {
    const p = extractPrint(String(s));
    if (p) prints.push(p);
  }
  if (prints.length < 2) return res.status(400).json({ error: "Samples were too quiet or too short. Try again closer to the mic." });
  const store = loadStore();
  store.prints = prints;
  saveStore(store);
  res.json({ ok: true, enrolled: prints.length });
});

guardianRouter.delete("/enroll", (_req, res) => {
  const store = loadStore();
  store.prints = [];
  saveStore(store);
  res.json({ ok: true });
});

guardianRouter.post("/settings", (req, res) => {
  const { armed, threshold } = req.body || {};
  const store = loadStore();
  if (typeof armed === "boolean") store.armed = armed;
  if (typeof threshold === "number") store.threshold = Math.min(0.99, Math.max(0.7, threshold));
  saveStore(store);
  res.json({ ok: true, armed: store.armed, threshold: store.threshold });
});

guardianRouter.post("/verify", (req, res) => {
  const { audio } = req.body || {};
  if (!audio) return res.status(400).json({ error: "No audio provided." });
  res.json(identifySpeaker(String(audio)));
});

// ---------------------------------------------------------------------------
// Tool module
// ---------------------------------------------------------------------------
export const guardianModule: ToolModule = {
  name: "guardian",
  declarations: [
    {
      name: "enrollVoiceprint",
      description: "Start voiceprint enrollment: the HUD records the owner saying 'Hey Bella' a few times and learns their voice.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "forgetVoiceprint",
      description: "Delete the stored owner voiceprint entirely.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "armVoiceGuardian",
      description: "Arm or disarm voice security. When ARMED with an enrolled voiceprint, unrecognized speakers get a restricted toolset — no file deletion, no power actions, no personal memory.",
      parameters: { type: Type.OBJECT, properties: { enabled: { type: Type.BOOLEAN } }, required: ["enabled"] },
    },
    {
      name: "whoSpokeRecently",
      description: "Report who spoke while the owner was away — recent speaker identifications.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
  async execute(name, args, ctx) {
    switch (name) {
      case "enrollVoiceprint": {
        ctx.clientWs?.send(JSON.stringify({ type: "guardian_enroll" }));
        return { result: "Starting enrollment — say 'Hey Bella' clearly three times when the recorder appears." };
      }
      case "forgetVoiceprint": {
        const s = loadStore();
        s.prints = [];
        s.armed = false;
        saveStore(s);
        return { result: "Voiceprint deleted. Voice security disarmed." };
      }
      case "armVoiceGuardian": {
        const s = loadStore();
        if (!s.prints.length) return { result: "I need to learn your voice first — run enrollment before arming." };
        s.armed = !!args.enabled;
        saveStore(s);
        return { result: s.armed ? "Voice Guardian armed. Guests get restricted access; I'll note who speaks while you're away." : "Voice Guardian disarmed." };
      }
      case "whoSpokeRecently": {
        const recs = loadStore().recognitions.slice(-10).reverse();
        if (!recs.length) return { result: "No speaker events logged yet." };
        return {
          result: recs.map(r => `${new Date(r.time).toLocaleString()} — ${r.identity}`).join("\n"),
        };
      }
    }
    throw new Error(`Unknown guardian tool: ${name}`);
  },
};
