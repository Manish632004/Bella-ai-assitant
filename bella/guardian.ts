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
import { readJson, writeJson, dataFilePath, readSecretJson, writeSecretJson } from "./util";
import type { ToolModule } from "./types";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
interface GuardianStore {
  format?: number;             // fingerprint algorithm version
  prints: number[][];          // enrolled owner voiceprints (fast local pre-check)
  ownerRef?: string;           // base64 WAV @16k mono — reference clip for verification
  ownerF0?: number | null;     // owner's median fundamental frequency (Hz)
  ownerF0Std?: number | null;  // owner's natural pitch spread across takes (Hz)
  armed: boolean;              // guest-restriction mode on/off
  threshold: number;           // cosine similarity threshold (calibrated at enroll time)
  recognitions: { time: string; identity: string; score: number }[];
}
const PRINT_FORMAT = 3;
const STORE_FILE = dataFilePath("guardian.json");
const loadStore = (): GuardianStore => {
  const s = readSecretJson<GuardianStore>(STORE_FILE, { prints: [], armed: false, threshold: 0.9, recognitions: [] });
  // Prints from an older fingerprint algorithm are meaningless now.
  if (s.format !== PRINT_FORMAT && s.prints.length) {
    s.prints = [];
    s.armed = false;
    s.threshold = 0.9;
  }
  s.format = PRINT_FORMAT;
  return s;
};
const saveStore = (s: GuardianStore) => { s.format = PRINT_FORMAT; writeSecretJson(STORE_FILE, s); };

// Session identity state (set by server.ts after wake-check verification)
let lastSpeaker: "owner" | "guest" | "unknown" = "unknown";
let guestStrikes = 0;                 // hysteresis: don't flip to guest on one clip
let lastGuestStrikeAt = 0;
export function getLastSpeaker(): string { return lastSpeaker; }
export function isGuestMode(): boolean {
  const s = loadStore();
  return s.armed && s.prints.length > 0 && lastSpeaker === "guest";
}

/** Reference clip for Gemini-based verification (null until enrolled). */
export function getOwnerReference(): string | null {
  const s = loadStore();
  return s.ownerRef || null;
}

/** Owner's enrolled median pitch in Hz (null when unknown). */
export function getOwnerF0(): number | null | undefined {
  return loadStore().ownerF0;
}

/** Owner's natural pitch spread (Hz) — sizes the accept tolerance. */
export function getOwnerF0Std(): number | null {
  return loadStore().ownerF0Std ?? null;
}

export interface F0Stats { mean: number; std: number; hits: number }

/**
 * Fundamental-frequency statistics of a WAV clip via autocorrelation.
 * Pitch is the single most reliable speaker cue available without ML —
 * it cleanly separates most household members (male↔female especially).
 */
export function analyzeF0(base64Wav: string): F0Stats | null {
  const decoded = decodeWav(base64Wav);
  if (!decoded || decoded.samples.length < decoded.sampleRate / 2) return null;
  const { samples, sampleRate } = decoded;

  const emphasized = new Float32Array(samples.length);
  emphasized[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    emphasized[i] = samples[i] - 0.97 * samples[i - 1];
  }

  const frameSize = Math.round(0.032 * sampleRate);
  const hop = Math.round(0.010 * sampleRate);
  const minLag = Math.floor(sampleRate / 400); // ≤400 Hz
  const maxLag = Math.min(frameSize - 1, Math.floor(sampleRate / 70)); // ≥70 Hz

  const win = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const frame = new Float32Array(frameSize);
  const f0s: number[] = [];
  for (let start = 0; start + frameSize <= emphasized.length; start += hop) {
    let rms = 0;
    for (let i = 0; i < frameSize; i++) {
      frame[i] = emphasized[start + i] * win[i];
      rms += frame[i] * frame[i];
    }
    rms = Math.sqrt(rms / frameSize);
    if (rms < 0.006) continue;

    let energy = 0;
    for (let i = 0; i < frameSize; i++) energy += frame[i] * frame[i];
    if (energy <= 1e-9) continue;
    let bestLag = -1, bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < frameSize - lag; i++) corr += frame[i] * frame[i + lag];
      corr /= energy;
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.30) f0s.push(sampleRate / bestLag);
  }

  if (f0s.length < 5) return null;
  // Trim outliers (octave jumps), then take median & spread.
  const sorted = [...f0s].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const inliers = f0s.filter(v => Math.abs(v - med) < med * 0.25);
  const mean = inliers.reduce((s, v) => s + v, 0) / Math.max(1, inliers.length);
  const stdv = Math.sqrt(inliers.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, inliers.length - 1));
  return { mean, std: stdv, hits: f0s.length };
}

/**
 * Speaker decision from pitch alone. Tolerance adapts to the owner's own
 * measured spread so natural variation never locks the real user out.
 * Returns null when either side lacks usable pitch data.
 */
export function pitchVerdict(
  probeF0: { mean: number; std?: number } | null,
  ownerF0: number | null | undefined,
  ownerStd = 8,
): "owner" | "guest" | null {
  if (!probeF0 || !ownerF0) return null;
  const diff = Math.abs(probeF0.mean - ownerF0);
  const tolerance = Math.max(18, ownerF0 * 0.12, (ownerStd || 8) * 1.8);
  return diff <= tolerance ? "owner" : "guest";
}

/** Log a Gemini speaker verdict into session state + recognition history. */
export function noteGuardianVerdict(verdict: "owner" | "guest" | "unsure", score = -1): "owner" | "guest" | "unknown" {
  if (verdict === "owner") {
    markSpeaker("owner");
    pushRecognition("owner", score);
    return "owner";
  }
  if (verdict === "guest") {
    markSpeaker("guest");
    if (lastSpeaker === "guest") {
      pushRecognition("guest", score);
      return "guest";
    }
    return "unknown"; // hysteresis: not yet flipped
  }
  return "unknown";
}

function pushRecognition(identity: string, score: number): void {
  const s = loadStore();
  s.recognitions.push({ time: new Date().toISOString(), identity, score });
  s.recognitions = s.recognitions.slice(-50);
  saveStore(s);
}
export function markSpeaker(identity: "owner" | "guest" | "unknown"): void {
  if (identity === lastSpeaker) return;
  if (identity === "guest") {
    // One borderline clip must never lock the real user out: require two
    // guest readings within 90 seconds before switching modes.
    const now = Date.now();
    if (!(lastGuestStrikeAt && now - lastGuestStrikeAt < 90_000)) guestStrikes = 0;
    lastGuestStrikeAt = now;
    if (++guestStrikes < 2) return;
  } else {
    guestStrikes = 0;
  }
  lastSpeaker = identity;
  const s = loadStore();
  s.recognitions.push({ time: new Date().toISOString(), identity, score: -1 });
  s.recognitions = s.recognitions.slice(-50);
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
// Audio → voiceprint
//
// Mel-filterbank log energies with per-utterance mean subtraction (CMN).
// Plain spectra are dominated by the PHRASE being said, so everyone saying
// "Hey Bella" looks alike. Mel bands + cepstral-mean removal strip the
// channel/phrase bias and keep what actually varies between speakers.
// ---------------------------------------------------------------------------

/** Triangular mel filterbank, 24 bands, 250–3800 Hz (voice band). */
const MEL_BANDS = 24;
const FMIN = 250, FMAX = 3800;

const hz2mel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const mel2hz = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

function buildFilterbank(sampleRate: number, fftSize: number): { lo: number; hi: number; w: Float32Array }[] {
  const nyq = sampleRate / 2;
  const fminM = hz2mel(FMIN), fmaxM = hz2mel(Math.min(FMAX, nyq - 100));
  const centers: number[] = [];
  for (let i = 0; i < MEL_BANDS + 2; i++) {
    centers.push(mel2hz(fminM + ((fmaxM - fminM) * i) / (MEL_BANDS + 1)));
  }
  const binHz = sampleRate / fftSize;
  const banks: { lo: number; hi: number; w: Float32Array }[] = [];
  for (let b = 0; b < MEL_BANDS; b++) {
    const lo = centers[b], mid = centers[b + 1], hi = centers[b + 2];
    const loBin = Math.max(0, Math.floor(lo / binHz));
    const hiBin = Math.min(fftSize / 2 - 1, Math.ceil(hi / binHz));
    const w = new Float32Array(Math.max(1, hiBin - loBin + 1));
    for (let k = loBin; k <= hiBin; k++) {
      const f = k * binHz;
      let v = 0;
      if (f >= lo && f <= mid) v = (f - lo) / Math.max(1e-9, mid - lo);
      else if (f > mid && f <= hi) v = (hi - f) / Math.max(1e-9, hi - mid);
      w[k - loBin] = v;
    }
    banks.push({ lo: loBin, hi: hiBin, w });
  }
  return banks;
}

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

export function extractPrint(base64Wav: string): number[] | null {
  const decoded = decodeWav(base64Wav);
  if (!decoded || decoded.samples.length < decoded.sampleRate / 2) return null;
  const { samples, sampleRate } = decoded;

  // Pre-emphasis sharpens vocal-tract detail and de-emphasizes boominess.
  const emphasized = new Float32Array(samples.length);
  emphasized[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    emphasized[i] = samples[i] - 0.97 * samples[i - 1];
  }

  const frameSize = Math.round(0.032 * sampleRate);   // 32 ms
  const hop = Math.round(0.010 * sampleRate);          // 10 ms
  const fftSize = 1 << Math.ceil(Math.log2(frameSize));

  // Hamming window (precomputed)
  const win = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  // Power spectrum via Goertzel over the needed bins only — no FFT dep,
  // and we only need bins up to ~4 kHz anyway.
  const maxBin = Math.min(fftSize >> 1, Math.ceil((FMAX * 2.2) / (sampleRate / fftSize)));
  const specFreqs: number[] = [];
  for (let k = 1; k <= maxBin; k++) specFreqs.push((k * sampleRate) / fftSize);

  const banks = buildFilterbank(sampleRate, fftSize);
  const framesE: number[][] = [];
  let voicedFrames = 0;

  // Pitch (F0) tracking via normalized autocorrelation — the strongest
  // speaker cue available without ML models.
  const minLag = Math.floor(sampleRate / 400);  // ≤400 Hz
  const maxLag = Math.min(frameSize - 1, Math.floor(sampleRate / 70)); // ≥70 Hz
  const f0s: number[] = [];
  let centroidSum = 0;

  const frame = new Float32Array(frameSize);
  for (let start = 0; start + frameSize <= emphasized.length; start += hop) {
    let rms = 0;
    for (let i = 0; i < frameSize; i++) {
      frame[i] = emphasized[start + i] * win[i];
      rms += frame[i] * frame[i];
    }
    rms = Math.sqrt(rms / frameSize);
    if (rms < 0.006) continue; // skip silence

    // --- F0 via autocorrelation on this voiced frame ---
    {
      let energy = 0;
      for (let i = 0; i < frameSize; i++) energy += frame[i] * frame[i];
      if (energy > 1e-9) {
        let bestLag = -1, bestCorr = 0;
        for (let lag = minLag; lag <= maxLag; lag++) {
          let corr = 0;
          for (let i = 0; i < frameSize - lag; i++) corr += frame[i] * frame[i + lag];
          corr /= energy;
          if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
        }
        if (bestLag > 0 && bestCorr > 0.35) f0s.push(sampleRate / bestLag);
      }
    }

    // --- power spectrum at the selected bins ---
    const pow = new Float64Array(maxBin + 1);
    for (let k = 1; k <= maxBin; k++) {
      const freq = specFreqs[k - 1];
      const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < frameSize; i++) {
        const s0 = frame[i] + coeff * s1 - s2;
        s2 = s1; s1 = s0;
      }
      pow[k] = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    }

    // spectral centroid (voice brightness — secondary speaker cue)
    {
      let num = 0, den = 0;
      for (let k = 1; k <= maxBin; k++) { num += k * pow[k]; den += pow[k]; }
      if (den > 1e-12) centroidSum += (num / den) * (sampleRate / fftSize);
    }

    // mel filterbank energies → log
    const melE = new Array<number>(MEL_BANDS);
    for (let b = 0; b < MEL_BANDS; b++) {
      const bank = banks[b];
      let e = 0;
      for (let k = bank.lo; k <= bank.hi && k <= maxBin; k++) e += bank.w[k - bank.lo] * pow[k];
      melE[b] = Math.log(e + 1e-9);
    }
    framesE.push(melE);
    voicedFrames++;
  }

  if (voicedFrames < 5) return null;

  if (process.env.BELLA_F0_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[f0dbg] voiced=${voicedFrames} f0hits=${f0s.length} first=${f0s.slice(0, 5).map(v => v.toFixed(1)).join(",")}`);
  }

  // Speaker print = [mean log-mel, std log-mel, pitch stats, brightness].
  // No cepstral-mean subtraction on purpose: enrollment and wake-check run
  // through the SAME microphone, so keeping absolute band energies preserves
  // the vocal-timbre differences that separate speakers.
  const mean = new Float64Array(MEL_BANDS);
  for (const fr of framesE) for (let b = 0; b < MEL_BANDS; b++) mean[b] += fr[b];
  for (let b = 0; b < MEL_BANDS; b++) mean[b] /= voicedFrames;

  const std = new Float64Array(MEL_BANDS);
  for (const fr of framesE) {
    for (let b = 0; b < MEL_BANDS; b++) {
      const d = fr[b] - mean[b];
      std[b] += d * d;
    }
  }
  const vec: number[] = [];
  // Block-normalized assembly: each cue group gets its own unit-norm before
  // weighting, so no block can be diluted into irrelevance by the others.
  const l2 = (arr: number[]) => {
    const n = Math.sqrt(arr.reduce((s, v) => s + v * v, 0)) || 1;
    return arr.map(v => v / n);
  };

  const melMeanN = l2(Array.from(mean));
  const melStdArr: number[] = [];
  for (let b = 0; b < MEL_BANDS; b++) {
    melStdArr.push(Math.sqrt(std[b] / Math.max(1, voicedFrames - 1)));
  }
  const melStdN = l2(melStdArr);

  // Pitch block: mean F0 (centered/scaled), spread, voiced fraction.
  const pitchRaw = [0, 0, 0];
  if (f0s.length >= 3) {
    const fMean = f0s.reduce((s, v) => s + v, 0) / f0s.length;
    const fStd = Math.sqrt(f0s.reduce((s, v) => s + (v - fMean) * (v - fMean), 0) / f0s.length);
    pitchRaw[0] = (fMean - 130) / 45;      // adult-range centered
    pitchRaw[1] = Math.min(3, fStd / 18);
    pitchRaw[2] = f0s.length / voicedFrames;
  }
  const pitchN = l2(pitchRaw);

  const centroidAvg = centroidSum / Math.max(1, voicedFrames);
  const brightN = l2([(centroidAvg - 900) / 350]);

  // Weights: timbre base, dynamics support, pitch is the heavy hitter.
  vec.push(...melMeanN);
  vec.push(...melStdN.map(v => v * 0.85));
  vec.push(...pitchN.map(v => v * 1.5));
  vec.push(...brightN.map(v => v * 0.6));

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

/** Mean-centered copy of a print — isolates relative band patterns. */
export function centeredPrint(p: number[]): number[] {
  const mu = p.reduce((s, v) => s + v, 0) / p.length;
  const c = p.map(v => v - mu);
  const norm = Math.sqrt(c.reduce((s, v) => s + v * v, 0)) || 1;
  return c.map(v => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both unit vectors
}

/**
 * Fused similarity: raw print cosine (timbre/level) blended with
 * centered-print cosine (relative formant pattern). Either alone lets a
 * similar-sounding speaker through; the blend is noticeably tighter.
 */
export function similarity(a: number[], b: number[]): number {
  const ALPHA = 0.3;
  return ALPHA * cosine(a, b) + (1 - ALPHA) * cosine(centeredPrint(a), centeredPrint(b));
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
  for (const p of store.prints) best = Math.max(best, similarity(probe, p));
  const thr = store.threshold;
  const identity = best >= thr ? "owner" : best >= thr - 0.04 ? "guest" : "unknown";
  if (identity !== "unknown") markSpeaker(identity as "owner" | "guest");
  // Re-load so we don't clobber whatever markSpeaker just persisted.
  const fresh = loadStore();
  fresh.recognitions.push({ time: new Date().toISOString(), identity, score: Math.round(best * 1000) / 1000 });
  fresh.recognitions = fresh.recognitions.slice(-50);
  saveStore(fresh);
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

  // Split each take into halves → multiple prints per recording. Real
  // intra-speaker variation then lives IN the print set, which lifts the
  // genuine owner under max-over-prints scoring far more than impostors.
  const rawTakes: string[] = [];
  const prints: number[][] = [];
  for (const s of samples.slice(0, 6)) {
    rawTakes.push(String(s));
    const full = extractPrint(String(s));
    if (full) prints.push(full);
    for (const part of splitWavBase64(String(s))) {
      const p = extractPrint(part);
      if (p) prints.push(p);
    }
  }
  const unique = prints.slice(0, 16);
  if (prints.length < 4) return res.status(400).json({ error: "Samples were too quiet or too short. Try again closer to the mic." });

  // Same-voice consistency across enrollment prints.
  let sum = 0, pairs = 0;
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      sum += similarity(unique[i], unique[j]);
      pairs++;
    }
  }
  const avgIntra = pairs ? sum / pairs : 0.9;

  // Pseudo-impostors: pitch-shifted copies of the owner's own takes behave
  // like "same phrase, similar-but-different voice". Their best-match scores
  // tell us where the IMPOSTOR distribution starts — something intra-only
  // calibration can never know.
  let pseudoSum = 0, pseudoN = 0, pseudoMax = 0;
  for (const take of rawTakes.slice(0, 3)) {
    for (const factor of [0.9, 0.95, 1.05, 1.1]) {
      const shifted = resampleWavBase64(take, factor);
      if (!shifted) continue;
      const p = extractPrint(shifted);
      if (!p) continue;
      let best = -1;
      for (const q of unique) best = Math.max(best, similarity(p, q));
      pseudoSum += best; pseudoN++;
      pseudoMax = Math.max(pseudoMax, best);
    }
  }

  let threshold: number;
  if (pseudoN >= 2) {
    const pseudoAvg = pseudoSum / pseudoN;
    // Park the bar midway between "you" and "pitch-shifted you", biased low
    // so borderline guests land outside rather than inside.
    threshold = Math.max(0.5, Math.min(0.95, (avgIntra + pseudoAvg) / 2 - 0.02));
    console.log(`[Voice Guardian] intra ${avgIntra.toFixed(3)} · pseudo-impostor avg ${pseudoAvg.toFixed(3)} max ${pseudoMax.toFixed(3)} · threshold ${threshold.toFixed(3)}`);
  } else {
    threshold = Math.min(0.95, Math.max(0.5, avgIntra - 0.06));
    console.log(`[Voice Guardian] Enrolled ${unique.length} prints · intra ${avgIntra.toFixed(3)} · threshold(fallback) ${threshold.toFixed(3)}`);
  }

  const store = loadStore();
  store.prints = unique;
  store.threshold = threshold;
  // Keep one full take (downsampled to 16 kHz mono) as the reference clip
  // for speaker verification, plus aggregated pitch across ALL takes so
  // the owner's natural variation is captured, not one sample's value.
  const ref = downsampleTo16kMono(rawTakes[0]);
  if (ref) store.ownerRef = ref;
  const f0stats = rawTakes.slice(0, 6)
    .map(t => analyzeF0(downsampleTo16kMono(t) || ""))
    .filter((s): s is F0Stats => !!s);
  if (f0stats.length) {
    const means = f0stats.map(s => s.mean).sort((a, b) => a - b);
    store.ownerF0 = Math.round(means[Math.floor(means.length / 2)] * 10) / 10;
    const stds = f0stats.map(s => s.std).sort((a, b) => a - b);
    store.ownerF0Std = Math.round(stds[Math.floor(stds.length / 2)] * 10) / 10;
  }
  saveStore(store);
  res.json({ ok: true, enrolled: unique.length, threshold, reference: Boolean(ref), ownerF0: store.ownerF0 ?? null });
});

/** Decode → linear resample to 16 kHz mono WAV (for the Gemini reference). */
function downsampleTo16kMono(base64: string): string | null {
  try {
    const decoded = decodeWav(base64);
    if (!decoded) return null;
    const { samples, sampleRate } = decoded;
    const factor = sampleRate / 16000;
    const outLen = Math.floor(samples.length / factor);
    if (outLen < 4000) return null;
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * factor;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = samples[Math.min(i0, samples.length - 1)];
      const b = samples[Math.min(i0 + 1, samples.length - 1)];
      out[i] = a + (b - a) * frac;
    }
    const buf = Buffer.alloc(44 + out.length * 2);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36 + out.length * 2, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write("data", 36, "ascii"); buf.writeUInt32LE(out.length * 2, 40);
    for (let i = 0; i < out.length; i++) {
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
    }
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/** Resample (linear interp) — doubles as a pitch/voice-shift for calibration. */
function resampleWavBase64(base64: string, factor: number): string | null {
  try {
    const decoded = decodeWav(base64);
    if (!decoded) return null;
    const { samples, sampleRate } = decoded;
    const newLen = Math.floor(samples.length / factor);
    if (newLen < sampleRate / 2) return null;
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const pos = i * factor;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = samples[Math.min(i0, samples.length - 1)];
      const b = samples[Math.min(i0 + 1, samples.length - 1)];
      out[i] = a + (b - a) * frac;
    }
    // re-encode as mono PCM16 WAV
    const buf = Buffer.alloc(44 + out.length * 2);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36 + out.length * 2, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write("data", 36, "ascii"); buf.writeUInt32LE(out.length * 2, 40);
    for (let i = 0; i < out.length; i++) {
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
    }
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/** Split a base64 WAV's data chunk into two halves (each a valid WAV). */
function splitWavBase64(base64: string): string[] {
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return [];
    let pos = 12, dataStart = -1, dataLen = 0, fmtEnd = 12;
    while (pos + 8 <= buf.length) {
      const id = buf.toString("ascii", pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      if (id === "data") { dataStart = pos + 8; dataLen = Math.min(size, buf.length - dataStart); break; }
      pos += 8 + size + (size % 2);
      fmtEnd = pos;
    }
    if (dataStart < 0 || dataLen < 8000) return [];
    const header = buf.subarray(0, fmtEnd);
    const mid = dataStart + Math.floor(dataLen / 2);
    const mk = (start: number, end: number) => {
      const out = Buffer.alloc(header.length + 8 + (end - start));
      header.copy(out);
      out.write("data", header.length, "ascii");
      out.writeUInt32LE(end - start, header.length + 4);
      buf.copy(out, header.length + 8, start, end);
      return out.toString("base64");
    };
    return [mk(dataStart, mid), mk(mid, dataStart + dataLen)];
  } catch {
    return [];
  }
}

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


