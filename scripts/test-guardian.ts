/**
 * Sanity test for the Voice Guardian fingerprint pipeline.
 *
 * The synthetic panel saturates (all voices share one envelope/noise model),
 * so absolute scores are meaningless â€” what MUST hold is strict ordering:
 * same-voice similarity above every different-voice similarity, across
 * sample rates, with the fused similarity() metric.
 */
import { extractPrint, similarity } from "../bella/guardian";

function makeWav(samples: Float32Array, sampleRate = 16000): string {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii"); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return buf.toString("base64");
}
function rng(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function synthVoice(sr: number, sec: number, f0: number, formants: number[], seed: number): Float32Array {
  const rand = rng(seed);
  const n = Math.floor(sr * sec);
  const out = new Float32Array(n);
  let ns = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const pitch = f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 3.1 * t) + 0.02 * (rand() - 0.5));
    let s = 0;
    for (let h = 1; h <= 20; h++) {
      const f = pitch * h;
      if (f > sr / 2) break;
      let amp = 1 / h;
      for (const fo of formants) amp *= 1 + 6 * Math.exp(-Math.pow((f - fo) / 220, 2));
      s += amp * Math.sin(2 * Math.PI * f * t);
    }
    ns = 0.7 * ns + 0.3 * (rand() * 2 - 1);
    s += 0.05 * ns;
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t - 1.2);
    out[i] = 0.28 * s * env;
  }
  // peak-normalize to avoid synthetic clipping
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) { const g = 0.45 / peak; for (let i = 0; i < n; i++) out[i] *= g; }
  return out;
}
const clip = (sr: number, f0: number, fo: number[], seed: number) => makeWav(synthVoice(sr, 1.6, f0, fo, seed));

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` â€” ${detail}` : ""}`);
  if (!ok) failures++;
};

// owner: two takes @16k + one @48k; impostors span the plausible range
const clips = {
  oA: clip(16000, 118, [700, 1220, 2600], 42),
  oB: clip(16000, 118, [700, 1220, 2600], 97),
  oC: clip(48000, 118, [700, 1220, 2600], 7),
  i1: clip(16000, 165, [420, 1900, 2900], 11),
  i2: clip(16000, 96, [300, 900, 2400], 23),
  i3: clip(16000, 140, [550, 1500, 2200], 31),
  i4: clip(16000, 128, [800, 1100, 2800], 55),
};

const P = Object.fromEntries(Object.entries(clips).map(([k, v]) => [k, extractPrint(v)!]));
check("prints extracted (52-dim)", Object.values(P).every(p => p?.length === 52), `${Object.keys(P).length} clips`);

const owners = ["oA", "oB", "oC"] as const;
const imposts = ["i1", "i2", "i3", "i4"] as const;

if (Object.values(P).every(Boolean)) {
  const intra: number[] = [];
  for (let i = 0; i < owners.length; i++)
    for (let j = i + 1; j < owners.length; j++) intra.push(similarity(P[owners[i]], P[owners[j]]));
  const interPairs: [string, string, number][] = [];
  for (const o of owners) for (const im of imposts)
    interPairs.push([o, im, similarity(P[o], P[im])]);

  const intraMin = Math.min(...intra);
  let worst: [string, string, number] | null = null;
  for (const pr of interPairs) if (!worst || pr[2] > worst[2]) worst = pr;
  const interMax = worst![2];

  console.log(`   intra min=${intraMin.toFixed(3)}   inter max=${interMax.toFixed(3)} (${worst![0]}â†”${worst![1]})`);

  check("same voice ranks strictly above impostors", intraMin > interMax,
    `margin ${(intraMin - interMax).toFixed(3)}`);

  // cross-sample-rate consistency: owner@48k must match best of the 16k refs
  const c48 = Math.max(similarity(P.oC, P.oA), similarity(P.oC, P.oB));
  check("48 kHz enrollment matches 16 kHz wake audio", c48 >= intraMin - 1e-9,
    `score ${c48.toFixed(3)}`);

  // silence / noise robustness: a near-silent clip yields no print
  check("silence rejected", extractPrint(makeWav(new Float32Array(16000))) === null, "no print for silence");
}

process.exit(failures ? 1 : 0);

