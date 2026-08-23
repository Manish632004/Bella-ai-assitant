/**
 * BELLA 6.0 — Phone Link: one session, two devices.
 *
 * Scan a QR code (or open the pairing link) once and your Android phone joins
 * the same BELLA session. From the desktop you can ask your phone a question
 * and hear the answer here, push notes to the phone, or wake BELLA from across
 * the house. Nothing routes through a third-party relay — the phone talks to
 * this PC directly over your LAN.
 */
import os from "os";
import crypto from "crypto";
import path from "path";
import express from "express";
import { Type } from "@google/genai";
import { readJson, writeJson, dataFilePath, readSecretJson, writeSecretJson } from "./util";
import type { ToolModule } from "./types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface PhoneDevice {
  id: string;
  name: string;
  token: string;
  registeredAt: string;
  lastSeen: string;
}
interface PendingCommand {
  id: string;
  deviceId: string;
  kind: "ask" | "notify";
  text: string;
  createdAt: number;
  answer?: string;
}

const DEVICES_FILE = dataFilePath("phone_devices.json");
const loadDevices = (): PhoneDevice[] => readSecretJson<PhoneDevice[]>(DEVICES_FILE, []);
const saveDevices = (list: PhoneDevice[]) => writeSecretJson(DEVICES_FILE, list);

let pairToken = "";
function newPairToken(): string {
  pairToken = crypto.randomBytes(4).toString("hex");
  return pairToken;
}
newPairToken();

const pending = new Map<string, PendingCommand>();
const answerWaiters = new Map<string, (answer: string | null) => void>();
let wakeRequested = false;

/** Rolling history of everything pushed to each device (latest last, cap 50). */
interface HistoryItem { deviceId: string; text: string; t: string; }
const history = new Map<string, HistoryItem[]>();
function pushHistory(deviceId: string, text: string): void {
  const list = history.get(deviceId) || [];
  list.push({ deviceId, text, t: new Date().toISOString() });
  history.set(deviceId, list.slice(-50));
}

function lanAddress(): string {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

export function getPairUrl(): string {
  return `http://${lanAddress()}:${process.env.PORT || 3000}/api/phone/link?t=${pairToken}`;
}

// ---------------------------------------------------------------------------
// Pairing web page served straight from the router
// ---------------------------------------------------------------------------
const LINK_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BELLA — Phone Link</title>
<style>
 body{font-family:system-ui;background:#0a0e1a;color:#e8ecf5;margin:0;padding:24px;max-width:480px;margin-inline:auto}
 h1{font-size:1.4rem} .card{background:#131a2e;border-radius:14px;padding:16px;margin:12px 0}
 input,button{font-size:1rem;border-radius:10px;padding:12px;width:100%;box-sizing:border-box;border:1px solid #2a3557;background:#0d1425;color:#fff}
 button{background:#5b6cff;border:none;margin-top:10px;font-weight:600}
 #log div{padding:8px;border-bottom:1px solid #222c4d}
</style></head><body>
<h1>🔔 BELLA Phone Link</h1>
<div class="card" id="setup">
 <p>Give this device a name to pair it with BELLA on your PC.</p>
 <input id="name" placeholder="e.g. Manish's Phone"/>
 <button onclick="register()">Pair device</button>
</div>
<div id="main" style="display:none">
 <div class="card"><b id="devname"></b> paired ✓</div>
 <div class="card"><input id="wake" readonly value="Tap to wake BELLA on your PC"/><button onclick="wake()">Wake BELLA</button></div>
 <div class="card"><h3>Inbox from BELLA</h3><div id="log"></div></div>
 <div class="card" id="askbox" style="display:none"><b id="askq"></b><input id="ans" placeholder="Type your answer…"/><button onclick="sendAnswer()">Answer</button></div>
</div>
<script>
const T=new URLSearchParams(location.search).get('t');
let dev=JSON.parse(localStorage.getItem('bella_phone')||'null');
async function api(p,body){const r=await fetch('/api/phone/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
async function register(){const name=document.getElementById('name').value.trim();if(!name)return;
 const res=await api('register',{pairToken:T,name});
 if(res.deviceId){dev=res;localStorage.setItem('bella_phone',JSON.stringify(dev));show();loadHistory();}}
function show(){document.getElementById('setup').style.display='none';document.getElementById('main').style.display='block';
 document.getElementById('devname').textContent=dev.name;}
async function wake(){await api('wake',{deviceId:dev.id,deviceToken:dev.token});alert('BELLA is waking up on your PC!');}
async function sendAnswer(){const a=document.getElementById('ans').value;if(!a||!window._cmd)return;
 await api('answer',{deviceId:dev.id,deviceToken:dev.token,commandId:window._cmd.id,answer:a});
 window._cmd=null;document.getElementById('askbox').style.display='none';poll();}
async function loadHistory(){try{
 const r=await fetch('/api/phone/history?deviceId='+dev.id+'&deviceToken='+dev.token);
 if(r.status===200){const j=await r.json();(j.history||[]).forEach(h=>addLog('🔔 '+h.text));}
}catch(e){}}
function addLog(t){const d=document.createElement('div');d.textContent=t;document.getElementById('log').prepend(d);}
async function poll(){if(!dev)return;try{
 const r=await fetch('/api/phone/poll?deviceId='+dev.id+'&deviceToken='+dev.token);
 if(r.status===200){const c=await r.json();
  if(c.kind==='notify'){addLog('🔔 '+c.text);}
  else if(c.kind==='ask'){window._cmd=c;document.getElementById('askq').textContent=c.text;
   document.getElementById('askbox').style.display='block';addLog('❓ '+c.text);}}
}catch(e){}}
setInterval(poll,3000);
(async()=>{if(dev){const ok=await fetch('/api/phone/poll?deviceId='+dev.id+'&deviceToken='+dev.token);if(ok.status!==401)show();else dev=null;}})();
</script></body></html>`;

// ---------------------------------------------------------------------------
// REST router — mounted at /api/phone by server.ts
// ---------------------------------------------------------------------------
export const phonelinkRouter = express.Router();

phonelinkRouter.get("/link", (_req, res) => res.send(LINK_PAGE));

phonelinkRouter.get("/pair-info", (_req, res) => {
  res.json({ pairUrl: getPairUrl(), devices: loadDevices().map(d => ({ id: d.id, name: d.name, lastSeen: d.lastSeen })) });
});

phonelinkRouter.post("/register", (req, res) => {
  const { pairToken: t, name } = req.body || {};
  if (!t || t !== pairToken) return res.status(403).json({ error: "Invalid pairing token." });
  const device: PhoneDevice = {
    id: crypto.randomBytes(6).toString("hex"),
    name: String(name || "Phone").slice(0, 40),
    token: crypto.randomBytes(16).toString("hex"),
    registeredAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  const devices = loadDevices().filter(d => d.name !== device.name);
  devices.push(device);
  saveDevices(devices);
  newPairToken(); // consume pairing token
  res.json({ deviceId: device.id, token: device.token, name: device.name });
});

function authDevice(req: express.Request): PhoneDevice | null {
  const { deviceId, deviceToken } = req.query.deviceId ? req.query : req.body || {};
  if (!deviceId || !deviceToken) return null;
  const dev = loadDevices().find(d => d.id === deviceId && d.token === deviceToken);
  if (dev) {
    dev.lastSeen = new Date().toISOString();
    saveDevices(loadDevices().map(d => (d.id === dev.id ? dev : d)));
  }
  return dev || null;
}

phonelinkRouter.get("/poll", (req, res) => {
  const dev = authDevice(req);
  if (!dev) return res.status(401).json({ error: "Unknown device." });
  const next = Array.from(pending.values()).find(c => c.deviceId === dev.id);
  if (!next) return res.status(204).end();
  if (next.kind === "ask" && next.answer !== undefined) {
    pending.delete(next.id);
    return res.status(204).end();
  }
  res.json({ id: next.id, kind: next.kind, text: next.text });
});

phonelinkRouter.post("/answer", (req, res) => {
  const dev = authDevice(req);
  if (!dev) return res.status(401).json({ error: "Unknown device." });
  const { commandId, answer } = req.body || {};
  const cmd = pending.get(String(commandId));
  if (cmd && cmd.deviceId === dev.id) {
    cmd.answer = String(answer || "");
    const waiter = answerWaiters.get(cmd.id);
    if (waiter) { waiter(cmd.answer); answerWaiters.delete(cmd.id); }
  }
  res.json({ ok: true });
});

phonelinkRouter.post("/wake", (req, res) => {
  const dev = authDevice(req);
  if (!dev) return res.status(401).json({ error: "Unknown device." });
  wakeRequested = true;
  res.json({ ok: true });
});

/** HUD polls this while in standby so the phone can wake BELLA. */
phonelinkRouter.get("/wake-request", (_req, res) => {
  const wasSet = wakeRequested;
  wakeRequested = false;
  res.json({ wake: wasSet });
});

/** Message history for a device so the companion page can catch up. */
phonelinkRouter.get("/history", (req, res) => {
  const dev = authDevice(req);
  if (!dev) return res.status(401).json({ error: "Unknown device." });
  res.json({ history: history.get(dev.id)?.slice(-30) || [] });
});

// ---------------------------------------------------------------------------
// Tool module
// ---------------------------------------------------------------------------
function pickDevice(name?: string): PhoneDevice | null {
  const devices = loadDevices();
  if (!devices.length) return null;
  if (name) {
    const q = String(name).toLowerCase();
    return devices.find(d => d.name.toLowerCase().includes(q) || d.id === name) || null;
  }
  return devices.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
}

export const phonelinkModule: ToolModule = {
  name: "phonelink",
  declarations: [
    {
      name: "getPhonePairing",
      description: "Get the QR/link used to pair an Android phone with this BELLA session, plus currently paired devices.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "askPhone",
      description: "Ask the paired phone a question out loud ('Ask my phone if I got an OTP', 'Ask my phone if the delivery arrived') and wait for the typed answer.",
      parameters: {
        type: Type.OBJECT,
        properties: { question: { type: Type.STRING }, device: { type: Type.STRING } },
        required: ["question"],
      },
    },
    {
      name: "sendToPhone",
      description: "Push a note/notification to the paired phone.",
      parameters: {
        type: Type.OBJECT,
        properties: { text: { type: Type.STRING }, device: { type: Type.STRING } },
        required: ["text"],
      },
    },
    {
      name: "listPairedPhones",
      description: "List phones currently paired with this BELLA session.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "getPhonePairing": {
        return {
          result: `Pairing link: ${getPairUrl()} — show it as a QR code in Settings → Phone Link, scan it with the phone and give it a name.`,
          devices: loadDevices().map(d => d.name),
        };
      }
      case "askPhone": {
        const dev = pickDevice(args.device ? String(args.device) : undefined);
        if (!dev) throw new Error("No phone is paired yet. Use getPhonePairing first.");
        const cmd: PendingCommand = {
          id: crypto.randomBytes(6).toString("hex"),
          deviceId: dev.id,
          kind: "ask",
          text: String(args.question),
          createdAt: Date.now(),
        };
        pending.set(cmd.id, cmd);
        pushHistory(dev.id, `❓ ${String(args.question)}`);
        const answer = await new Promise<string | null>((resolve) => {
          answerWaiters.set(cmd.id, resolve);
          setTimeout(() => {
            if (answerWaiters.has(cmd.id)) {
              answerWaiters.delete(cmd.id);
              resolve(null);
            }
          }, 120000);
        });
        pending.delete(cmd.id);
        return answer
          ? { result: `${dev.name} answered: "${answer}"` }
          : { result: `${dev.name} didn't respond within two minutes.` };
      }
      case "sendToPhone": {
        const dev = pickDevice(args.device ? String(args.device) : undefined);
        if (!dev) throw new Error("No phone paired yet.");
        const id = `n${Date.now()}`;
        pending.set(id, {
          id,
          deviceId: dev.id,
          kind: "notify",
          text: String(args.text),
          createdAt: Date.now(),
        });
        pushHistory(dev.id, String(args.text));
        return { result: `Sent to ${dev.name}.` };
      }
      case "listPairedPhones": {
        const devs = loadDevices();
        return { result: devs.length ? devs.map(d => `- ${d.name} (last seen ${new Date(d.lastSeen).toLocaleString()})`).join("\n") : "No phones paired yet." };
      }
    }
    throw new Error(`Unknown phonelink tool: ${name}`);
  },
};
