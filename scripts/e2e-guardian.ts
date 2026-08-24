/**
 * End-to-end HTTP test against the RUNNING server:
 *   enroll owner takes -> status -> verify(owner)=owner, verify(impostor)!=owner
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
  // peak-normalize to avoid synthetic clipping
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) { const g = 0.45 / peak; for (let i = 0; i < n; i++) out[i] *= g; }
  return out;
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// fresh slate
await fetch(BASE + "/api/guardian/enroll", { method: "DELETE" });

// enroll: 3 owner takes @16k (like HUD records @48k, but mixed rates are fine)
const ownerTakes = [
  makeWav(synthVoice(16000, 1.8, 118, [700, 1220, 2600], 42)),
  makeWav(synthVoice(16000, 1.8, 118, [700, 1220, 2600], 97)),
  makeWav(synthVoice(48000, 1.8, 118, [700, 1220, 2600], 7)),
];
const enr = await post("/api/guardian/enroll", { samples: ownerTakes });
console.log("enroll:", enr.status, JSON.stringify(enr.json));

const st = await (await fetch(BASE + "/api/guardian/status")).json();
console.log("status:", JSON.stringify(st));

// verify owner take (fresh noise)
const vOwn = await post("/api/guardian/verify", { audio: makeWav(synthVoice(16000, 1.5, 118, [700, 1220, 2600], 555)) });
console.log("verify owner-take:", JSON.stringify(vOwn.json));

// verify impostors
for (const [name, clip] of Object.entries({
  g1: makeWav(synthVoice(16000, 1.5, 165, [420, 1900, 2900], 11)),
  g2: makeWav(synthVoice(16000, 1.5, 96, [300, 900, 2400], 23)),
  g3: makeWav(synthVoice(16000, 1.5, 140, [550, 1500, 2200], 31)),
})) {
  const r = await post("/api/guardian/verify", { audio: clip });
  console.log(`verify ${name}:`, JSON.stringify(r.json));
}

// arm + guest-tool filter sanity via settings endpoint
const arm = await post("/api/guardian/settings", { armed: true });
console.log("arm:", JSON.stringify(arm.json));

console.log("\nEXPECT: enrolled>=6, threshold<1, verify owner-take=owner, impostors!=owner");

