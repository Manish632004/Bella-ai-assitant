/**
 * Live test of /api/wake-check with the new reference-voice comparison.
 * Uses synthetic voices: owner-enrolled clip vs impostor clip.
 * Requires BELLA running + API key configured.
 */
const BASE = "http://localhost:3000";

function makeWav(samples, sampleRate = 16000) {
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
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function synthVoice(sr, sec, f0, formants, seed) {
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
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) { const g = 0.45 / peak; for (let i = 0; i < n; i++) out[i] *= g; }
  return out;
}
async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

// fresh enrollment with 3 "owner" takes
await post("/api/guardian/enroll", { method: "DELETE" });
await fetch(BASE + "/api/guardian/enroll", { method: "DELETE" });
const enr = await post("/api/guardian/enroll", {
  samples: [
    makeWav(synthVoice(16000, 1.8, 118, [700, 1220, 2600], 42)),
    makeWav(synthVoice(16000, 1.8, 118, [700, 1220, 2600], 97)),
    makeWav(synthVoice(16000, 1.8, 118, [700, 1220, 2600], 7)),
  ],
});
console.log("enroll:", JSON.stringify(enr));

// owner says the wake phrase (different noise seed)
const own = await post("/api/wake-check", { audioBase64: makeWav(synthVoice(16000, 1.5, 118, [700, 1220, 2600], 555)), phrase: "hey bella" });
console.log("wake-check OWNER take:", JSON.stringify(own));

// impostor voice
const imp = await post("/api/wake-check", { audioBase64: makeWav(synthVoice(16000, 1.5, 165, [420, 1900, 2900], 11)), phrase: "hey bella" });
console.log("wake-check IMPOSTOR  :", JSON.stringify(imp));
