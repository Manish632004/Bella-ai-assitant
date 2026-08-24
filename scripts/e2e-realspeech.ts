/** Live voice-guardian test with REAL TTS speech through the actual server. */
import fs from "fs";

const BASE = "http://localhost:3000";
const b64 = (p: string) => fs.readFileSync(p).toString("base64");
const D = process.env.TEMP + "\\opencode";
const post = async (path: string, body: unknown) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};

await fetch(BASE + "/api/guardian/enroll", { method: "DELETE" });
const enr = await post("/api/guardian/enroll", {
  samples: [b64(D + "\\own1.wav"), b64(D + "\\own2.wav"), b64(D + "\\own3.wav")],
});
console.log("enroll:", JSON.stringify(enr));

const st = await (await fetch(BASE + "/api/guardian/status")).json();
console.log("status:", JSON.stringify(st));

// impostor first (David) — expect wake YES, voice DIFFERENT → guest strike 1 (hysteresis → unknown)
const imp = await post("/api/wake-check", { audioBase64: b64(D + "\\imp.wav"), phrase: "hey bella" });
console.log("wake-check IMPOSTOR (David):", JSON.stringify(imp));

// second impostor hit should flip hysteresis to guest
const imp2 = await post("/api/wake-check", { audioBase64: b64(D + "\\imp.wav"), phrase: "hey bella" });
console.log("wake-check IMPOSTOR again  :", JSON.stringify(imp2));

// real owner take — expect wake YES, voice OWNER
const own = await post("/api/wake-check", { audioBase64: b64(D + "\\own_test.wav"), phrase: "hey bella" });
console.log("wake-check OWNER (Zira)    :", JSON.stringify(own));

const st2 = await (await fetch(BASE + "/api/guardian/status")).json();
console.log("final status:", JSON.stringify(st2));
