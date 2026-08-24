/**
 * BELLA 6.0 — Phone Companion: a full installable app served by this PC.
 *
 * Everything lives here: the PWA shell (manifest + service worker + icons),
 * a text/talk chat brain with complete BELLA tool access, real Web-Push
 * notifications, a PC remote-control surface, photo/file drop, Android share
 * receiving, find-my-phone, briefing/reminders on the go — plus the voice
 * tools that let desktop BELLA reach back ("find my phone").
 *
 * Transport note: the companion prefers HTTPS on :4443 (local CA from
 * ./phonecerts). A secure context is what unlocks microphone, push,
 * geolocation and app-install on Android Chrome; HTTP keeps working for
 * everything else.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import webpush from "web-push";
import https from "https";
import { Type } from "@google/genai";
import {
  readSecretJson, writeSecretJson, dataFilePath, ensureDir,
  getCurrentApiKey, makeClient, HOME,
} from "./util";
import type { ToolModule } from "./types";
import { loadDevices, pickDevice, queueNotification, onPhoneNotify } from "./phonelink";
import { loadReminders, addReminder, describeWhen } from "./scheduler";
import { buildBriefing } from "./briefing";
import { ensureCerts, tlsOptions, caCertPem, HTTPS_PORT } from "./phonecerts";

// ---------------------------------------------------------------------------
// Secrets & small stores
// ---------------------------------------------------------------------------
const VAPID_FILE = dataFilePath("webpush_vapid.json");
const SUBS_FILE = dataFilePath("webpush_subs.json");
const SHARE_FILE = dataFilePath("phone_share_secret.json");
const LOCATION_FILE = dataFilePath("phone_last_seen.json");

interface PhoneStatusReport {
  lat?: number; lng?: number; acc?: number;
  battery?: number; charging?: boolean;
  t: string;
}

function getShareSecret(): string {
  let s = readSecretJson<{ secret?: string }>(SHARE_FILE, {}).secret;
  if (!s) {
    s = crypto.randomBytes(12).toString("hex");
    writeSecretJson(SHARE_FILE, { secret: s });
  }
  return s;
}

function getVapid(): { publicKey: string; privateKey: string } {
  let keys = readSecretJson<{ publicKey: string; privateKey: string } | null>(VAPID_FILE, null);
  if (!keys?.publicKey) {
    keys = webpush.generateVAPIDKeys();
    writeSecretJson(VAPID_FILE, keys);
    console.log("[Phone Push] Generated VAPID keys.");
  }
  webpush.setVapidDetails("mailto:bella@local.app", keys.publicKey, keys.privateKey);
  return keys;
}

function getSubs(): Record<string, unknown[]> {
  return readSecretJson<Record<string, unknown[]>>(SUBS_FILE, {});
}

async function sendPush(deviceId: string, title: string, body: string): Promise<void> {
  try {
    getVapid();
    const subs = getSubs();
    const list = (subs[deviceId] || []) as { endpoint: string }[];
    if (!list.length) return;
    const keep: unknown[] = [];
    await Promise.all(list.map(async sub => {
      try {
        await webpush.sendNotification(sub as never, JSON.stringify({
          title, body, url: "/api/phone/app",
        }));
        keep.push(sub);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status !== 404 && status !== 410) keep.push(sub); // transient — retry next time
      }
    }));
    if (keep.length !== list.length) {
      subs[deviceId] = keep;
      writeSecretJson(SUBS_FILE, subs);
    }
  } catch (err) {
    console.warn("[Phone Push] send failed:", err?.message || err);
  }
}

// Wire the push sender into BELLA-side sendToPhone / queueNotification.
onPhoneNotify((deviceId, text) => { void sendPush(deviceId, "BELLA", text); });

// ---------------------------------------------------------------------------
// Auth helper (same device registry as phonelink)
// ---------------------------------------------------------------------------
function authDevice(req: express.Request): { id: string; name: string } | null {
  const body = (req.body || {}) as Record<string, unknown>;
  const q = req.query as Record<string, string>;
  const deviceId = String(body.deviceId || q.deviceId || "");
  const token = String(body.deviceToken || q.deviceToken || "");
  if (!deviceId || !token) return null;
  const dev = loadDevices().find(d => d.id === deviceId && d.token === token);
  return dev ? { id: dev.id, name: dev.name } : null;
}

// ---------------------------------------------------------------------------
// Chat brain — full BELLA tool access from the phone
// ---------------------------------------------------------------------------
type ExecToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;
let execTool: ExecToolFn = async () => { throw new Error("Executor not registered."); };
let toolDeclarations: unknown[] = [];

/** Called by server.ts with the full desktop+bella dispatcher and declarations. */
export function registerPhoneExecutor(fn: ExecToolFn, declarations: unknown[]): void {
  execTool = fn;
  toolDeclarations = declarations;
}

const MODEL_CANDIDATES = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-001"];
let cachedModel: string | null = null;

async function withModelFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  const order = cachedModel ? [cachedModel, ...MODEL_CANDIDATES.filter(m => m !== cachedModel)] : MODEL_CANDIDATES;
  let lastErr: unknown;
  for (const model of order) {
    try {
      const out = await fn(model);
      cachedModel = model;
      return out;
    } catch (err: unknown) {
      lastErr = err;
      if (!/404|not found|NOT_FOUND|is no longer available/i.test(String((err as Error)?.message))) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type Content = { role: "user" | "model"; parts: { text?: string; functionCall?: { name: string; args?: object }; functionResponse?: { name: string; response: object } }[] };

const conversations = new Map<string, Content[]>();

const PHONE_SYSTEM = `You are BELLA, the user's voice-first desktop assistant, answering from their PHONE as a companion chat.
The person texting you is the owner of the PC you live on. Today they may be away from the desk.
Style: warm, sharp, brief. Chat answers should sound natural when read aloud — usually one to three sentences unless detail was requested.
You have the PC's complete tool belt available. Use tools whenever they help: controlling the PC, files, music, reminders, research, agents, documents, anything.
When you perform an action, confirm plainly what you did. Never invent tool results.`;

async function runBrain(deviceId: string, userText: string): Promise<string> {
  const apiKey = getCurrentApiKey();
  if (!apiKey) throw new Error("BELLA has no API key configured yet — set one in Settings on the PC.");

  const history = conversations.get(deviceId) || [];
  history.push({ role: "user", parts: [{ text: userText }] });

  const ai = makeClient(apiKey);
  let finalText = "";
  for (let hop = 0; hop < 7; hop++) {
    const response = await withModelFallback(model => ai.models.generateContent({
      model,
      contents: history.slice(-40) as never,
      config: {
        systemInstruction: PHONE_SYSTEM,
        tools: [{ functionDeclarations: toolDeclarations as never }],
      },
    }));

    const calls = response.functionCalls || [];
    const textParts: string[] = (response.candidates?.[0]?.content?.parts || [])
      .map(p => (p as { text?: string }).text || "")
      .filter(Boolean);

    if (!calls.length) {
      finalText = textParts.join("\n").trim() || "(empty reply)";
      history.push({ role: "model", parts: [{ text: finalText }] });
      break;
    }

    // Surface any narration that came with the calls, then execute each call.
    const modelParts: Content["parts"] = [
      ...textParts.map(t => ({ text: t })),
      ...calls.map(c => ({ functionCall: { name: c.name!, args: (c.args || {}) as object } })),
    ];
    history.push({ role: "model", parts: modelParts });

    const results = await Promise.all(calls.map(async c => {
      try {
        const out = await execTool(c.name!, (c.args || {}) as Record<string, unknown>);
        const summarized = typeof out === "string" ? out : JSON.stringify(out);
        return { functionResponse: { name: c.name!, response: { result: String(summarized).slice(0, 4000) } } };
      } catch (err: unknown) {
        return { functionResponse: { name: c.name!, response: { error: String((err as Error)?.message || err).slice(0, 500) } } };
      }
    }));
    history.push({ role: "user" as "user" | "model", parts: results });
    finalText = ""; // loop continues until a pure-text turn arrives
  }

  while (history.length > 40) history.shift();
  conversations.set(deviceId, history);
  return finalText || "Done.";
}

async function transcribeAudio(base64Audio: string): Promise<string> {
  const apiKey = getCurrentApiKey();
  if (!apiKey) throw new Error("No API key configured.");
  const ai = makeClient(apiKey);
  return withModelFallback(async model => {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { role: "user", parts: [
          { inlineData: { mimeType: "audio/webm", data: base64Audio } as never },
          { text: "Transcribe this speech exactly. Output ONLY the transcript text." },
        ] },
      ],
    });
    return (response.text || "").trim();
  });
}

// ---------------------------------------------------------------------------
// Direct PC actions that don't need the desktop agent
// ---------------------------------------------------------------------------
async function powerAction(kind: string): Promise<unknown> {
  switch (kind) {
    case "lock":
      await import("child_process").then(cp => cp.exec("rundll32.exe user32.dll,LockWorkStation"));
      return "PC locked.";
    case "sleep": {
      const { runCommand } = await import("./util");
      await runCommand("rundll32.exe powrprof.dll,SetSuspendState 0,1,0", undefined, 15000);
      return "PC going to sleep.";
    }
    case "restart":
      await import("child_process").then(cp => cp.exec("shutdown /r /t 20"));
      return "Restarting in 20 seconds.";
    case "shutdown":
      await import("child_process").then(cp => cp.exec("shutdown /s /t 30"));
      return "Shutting down in 30 seconds.";
    case "cancelShutdown":
      await import("child_process").then(cp => cp.exec("shutdown /a"));
      return "Pending shutdown cancelled.";
    default:
      throw new Error(`Unknown power action: ${kind}`);
  }
}

async function setBrightness(percent: number): Promise<string> {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const { runCommand } = await import("./util");
  const r = await runCommand(
    `powershell -NoProfile -NonInteractive -Command "(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${p})"`,
    undefined, 20000,
  );
  if (!r.ok) throw new Error("This display doesn't support software brightness control.");
  return `Brightness ${p}%.`;
}

/** Dig a base64 JPEG out of whatever the desktop agent returned for screenshots. */
function extractImage(result: unknown): string | null {
  const scan = (v: unknown, depth = 0): string | null => {
    if (depth > 4 || v == null) return null;
    if (typeof v === "string") {
      const m = v.match(/^data:image\/[a-z]+;base64,(.+)$/) || (/^[A-Za-z0-9+/=\s]{500,}$/.test(v) ? [null, v] : null);
      return m ? m[1].replace(/\s/g, "") : null;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (/image|screen|shot|data|base64|jpeg|png/i.test(k)) {
          const hit = scan(val, depth + 1);
          if (hit) return hit;
        }
      }
      for (const val of Object.values(v as Record<string, unknown>)) {
        const hit = scan(val, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return scan(result);
}

// ---------------------------------------------------------------------------
// Assets: service worker, manifest, icons, app page
// ---------------------------------------------------------------------------
const ICONS_DIR = path.join(process.cwd(), "public", "phone");

const SW_JS = `
const SHELL = ['/api/phone/app','/api/phone/manifest.webmanifest',
 '/api/phone/icons/icon-192.png','/api/phone/icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open('bella-v1').then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== 'bella-v1').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && SHELL.some(u => e.request.url.endsWith(u.split('/').pop()))) {
        const copy = r.clone(); caches.open('bella-v1').then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch(_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'BELLA', {
    body: d.body || '', icon: '/api/phone/icons/icon-192.png', badge: '/api/phone/icons/maskable-192.png',
    tag: 'bella-' + Date.now(), data: { url: d.url || '/api/phone/app' }, vibrate: [80, 40, 80]
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes('/api/phone/')) return c.focus();
    return clients.openWindow(e.notification.data && e.notification.data.url || '/api/phone/app');
  }));
});
`;

function manifestJson(): string {
  return JSON.stringify({
    name: "BELLA Companion",
    short_name: "BELLA",
    description: "Your PC's assistant, in your pocket.",
    start_url: "/api/phone/app",
    scope: "/api/phone/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [
      { src: "/api/phone/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/api/phone/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/api/phone/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/api/phone/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: `/api/phone/share/${getShareSecret()}`,
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  }, null, 2);
}

// NOTE: the app page deliberately avoids template literals inside so the
// outer server-side template stays simple — client code uses concatenation.
const APP_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="theme-color" content="#0a0e1a"/>
<link rel="manifest" href="/api/phone/manifest.webmanifest"/>
<link rel="icon" href="/api/phone/icons/icon-192.png"/>
<link rel="apple-touch-icon" href="/api/phone/icons/icon-192.png"/>
<title>BELLA Companion</title>
<style>
:root{--bg:#0a0e1a;--card:#131a2e;--card2:#0d1425;--line:#222c4d;--ink:#e8ecf5;--dim:#8b95b3;--acc:#5b6cff}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui;background:var(--bg);color:var(--ink);margin:0;padding-bottom:76px}
header{padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
header img{width:28px;height:28px;border-radius:8px}
header b{font-size:1.05rem} header .st{margin-left:auto;font-size:.72rem;color:var(--dim)}
main{padding:12px;max-width:520px;margin-inline:auto}
.card{background:var(--card);border-radius:14px;padding:14px;margin:10px 0}
input,textarea{font-size:1rem;border-radius:10px;padding:11px;width:100%;border:1px solid #2a3557;background:var(--card2);color:#fff;margin-top:6px}
button{font-size:.95rem;border-radius:10px;padding:11px 14px;border:1px solid #2a3557;background:#232c4d;color:#fff;font-weight:600}
button.primary{background:var(--acc);border-color:var(--acc)}
button.wide{width:100%;margin-top:8px}
button.icon{width:auto;padding:11px 13px;margin:0}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.grid button{padding:13px 4px;font-size:.85rem}
h3{margin:4px 0 8px;font-size:.95rem;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
#chatlist{display:flex;flex-direction:column;gap:8px;min-height:120px}
.msg{max-width:86%;padding:10px 13px;border-radius:16px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.me{align-self:flex-end;background:var(--acc);border-bottom-right-radius:4px}
.bella{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:4px}
.sys{align-self:center;color:var(--dim);font-size:.78rem}
nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:#0d1425;border-top:1px solid var(--line);padding:8px 8px calc(8px + env(safe-area-inset-bottom))}
nav button{flex:1;border:none;background:none;color:var(--dim);font-size:.72rem;display:flex;flex-direction:column;gap:3px;align-items:center;padding:6px 2px}
nav button.on{color:var(--acc)}
nav span{font-size:1.25rem;line-height:1}
.tab{display:none}.tab.on{display:block}
#banner{background:#3a2f10;border:1px solid #7a651f;border-radius:12px;padding:12px;margin:10px 0;font-size:.85rem;display:none}
#banner button{margin-top:8px}
.micbtn{width:52px;height:52px;border-radius:50%;background:var(--acc);border:none;color:#fff;font-size:1.35rem;flex:none}
.micbtn.rec{background:#e04848;animation:pulse 1s infinite}
@keyframes pulse{50%{opacity:.6}}
.chatin{display:flex;gap:8px;align-items:flex-end;margin-top:10px}
.chatin .txt{flex:1}
.slider{width:100%;accent-color:var(--acc)}
.small{font-size:.8rem;color:var(--dim)}
.inboxitem{padding:9px;border-bottom:1px solid var(--line);font-size:.92rem}
.badge{display:inline-block;background:#1d2749;color:var(--dim);border-radius:999px;padding:2px 10px;font-size:.72rem;margin-left:6px}
dialog{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:14px;max-width:94vw}
dialog img{max-width:100%;border-radius:8px}
.switchrow{display:flex;align-items:center;justify-content:space-between;padding:6px 0}
</style></head><body>
<header><img src="/api/phone/icons/icon-192.png"/><b>BELLA</b><span class="st" id="connstate">connecting…</span></header>
<div id="banner">
 ⚠️ Running over plain HTTP — voice input, push notifications, location and app-install are disabled by the browser.
 <div><button onclick="location='/api/phone/ca.crt'">Download BELLA certificate</button></div>
 <span class="small">Install it via Android Settings → Security → Install a CA certificate, then reopen this page over https.</span>
</div>
<main>
<section class="tab" id="tab-chat">
  <div id="chatlist"></div>
  <div class="chatin">
    <textarea id="chatin" class="txt" rows="1" placeholder="Message BELLA…"></textarea>
    <button class="micbtn" id="mic" title="Hold to talk">🎙</button>
    <button class="primary icon" onclick="sendChat()" title="Send">➤</button>
  </div>
  <div class="row">
    <button class="icon" id="ttlb" onclick="toggleTts()">🔇 Voice off</button>
    <button class="icon" onclick="resetChat()">🧹 New chat</button>
  </div>
</section>

<section class="tab" id="tab-control">
  <div class="card"><h3>Sound</h3>
    <input type="range" class="slider" id="vol" min="0" max="100" value="50" oninput="pc('setVolume',{percent:+this.value},true)"/>
    <div class="row">
      <button onclick="pc('volumeUp')">🔊 +</button><button onclick="pc('volumeDown')">🔉 −</button><button onclick="pc('muteToggle')">🔇 Mute</button>
    </div>
  </div>
  <div class="card"><h3>Media</h3>
    <div class="row">
      <button onclick="pc('mediaPrevTrack')">⏮</button><button onclick="pc('mediaPlayPause')">⏯</button><button onclick="pc('mediaNextTrack')">⏭</button><button onclick="pc('mediaStop')">⏹</button>
    </div>
    <input id="song" placeholder="Play a song…"/><button class="wide" onclick="pc('changeSong',{query:v('song')})">▶ Play on PC</button>
  </div>
  <div class="card"><h3>Screen & keyboard</h3>
    <div class="row"><button onclick="shot()">📸 Screenshot</button><button onclick="clip()">📋 Clipboard</button></div>
    <textarea id="typetxt" rows="2" placeholder="Type on the PC…"></textarea>
    <div class="row">
      <button onclick="pc('typeText',{text:v('typetxt')})">⌨️ Type</button><button onclick="pc('pressEnter')">↵ Enter</button><button onclick="pc('pressKey',{key:'escape'})">Esc</button>
    </div>
    <div class="row">
      <button onclick="pc('browserBack')">← Back</button><button onclick="pc('nextTab')">Next tab ▸</button><button onclick="pc('newTab')">New tab</button>
    </div>
  </div>
  <div class="card"><h3>Open on PC</h3>
    <input id="urlgo" placeholder="https://…"/><button class="wide" onclick="openUrl()">🌐 Open website</button>
  </div>
  <div class="card"><h3>Power</h3>
    <div class="row">
      <button onclick="power('lock')">🔒 Lock</button><button onclick="power('sleep')">🌙 Sleep</button>
      <button onclick="if(confirm('Restart the PC?'))power('restart')">♻️ Restart</button>
      <button onclick="if(confirm('Shut the PC down?'))power('shutdown')">⏻ Shut down</button>
    </div>
  </div>
  <div class="card"><h3>Display brightness</h3>
    <input type="range" class="slider" id="bri" min="10" max="100" value="80" onchange="setBri(+this.value)"/>
  </div>
</section>

<section class="tab" id="tab-inbox">
  <div class="card">
    <div class="switchrow"><b>Wake BELLA on the PC</b><button class="primary" onclick="wake()">🔔 Wake</button></div>
  </div>
  <div class="card" id="askbox" style="display:none">
    <h3>BELLA asks</h3><b id="askq"></b>
    <input id="ans" placeholder="Type your answer…"/><button class="primary wide" onclick="sendAnswer()">Answer</button>
  </div>
  <div class="card"><h3>Inbox</h3><div id="inbox"></div></div>
</section>

<section class="tab" id="tab-more">
  <div class="card"><div class="switchrow"><b id="devname">Not paired</b><span class="badge" id="securebadge"></span></div>
    <input id="pairname" placeholder="Pairing name…" style="display:none"/>
    <input id="pairtoken" placeholder="Pairing code (from PC QR)" style="display:none"/>
    <button class="primary wide" id="pairbtn" style="display:none" onclick="registerManual()">Pair device</button>
    <button class="wide" onclick="unpair()" style="display:none" id="unpairbtn">Unpair this phone</button>
  </div>
  <div class="card"><h3>App</h3>
    <div class="row"><button class="primary" id="installbtn" style="display:none">📲 Install as app</button>
    <button id="notifbtn">🔔 Enable notifications</button></div>
    <p class="small">Notifications reach your lock screen even when BELLA isn't open — requires the https setup above.</p>
  </div>
  <div class="card"><h3>Find my phone</h3>
    <div class="switchrow"><span class="small">Report this phone's location to BELLA while the app is open.</span>
      <input type="checkbox" id="geotoggle" onchange="toggleGeo(this.checked)" style="width:22px;height:22px"/></div>
    <div class="small" id="geostate">off</div>
  </div>
  <div class="card"><h3>Send to PC</h3>
    <div class="row">
      <label class="primary" style="border-radius:10px;padding:11px 14px;background:var(--acc);font-weight:600">📷 Photo
        <input type="file" accept="image/*" capture="environment" style="display:none" onchange="sendPhoto(this.files[0])"/></label>
      <label style="border-radius:10px;padding:11px 14px;background:#232c4d;font-weight:600">📎 File
        <input type="file" style="display:none" onchange="sendFile(this.files[0])"/></label>
    </div>
    <p class="small">Photos land in Pictures\\BellaFromPhone, other files in Documents\\BellaFromPhone. Tip: share links straight from other apps via Android's Share → BELLA.</p>
  </div>
  <div class="card"><h3>Daily briefing</h3><button class="wide primary" onclick="loadBriefing()">Read today's briefing</button><div id="briefing" class="small" style="white-space:pre-wrap;margin-top:8px"></div></div>
  <div class="card"><h3>Reminders</h3>
    <input id="remtext" placeholder="Remind me to… (e.g. in 10 minutes / Monday 9am)"/>
    <button class="primary wide" onclick="addReminder()">Add reminder</button>
    <div id="remlist" style="margin-top:8px"></div>
  </div>
  <p class="small" style="text-align:center;margin:18px 0">BELLA Companion · runs entirely on your PC</p>
</section>
</main>

<nav>
  <button class="on" data-t="tab-chat" onclick="showTab(this)"><span>💬</span>Chat</button>
  <button data-t="tab-control" onclick="showTab(this)"><span>🖥</span>Control</button>
  <button data-t="tab-inbox" onclick="showTab(this)"><span>📥</span>Inbox</button>
  <button data-t="tab-more" onclick="showTab(this)"><span>⚙️</span>More</button>
</nav>

<dialog id="shotdlg"><img id="shotimg"/><form method="dialog" style="margin-top:10px;text-align:right"><button>Close</button></form></dialog>

<script>
'use strict';
var dev=null, tts=false, geoWatch=null, lastGeoPost=0, deferredPrompt=null, currentCmd=null;
var $=function(id){return document.getElementById(id)};
var api=function(p,body){return fetch('/api/phone/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()})};
var v=function(id){return $(id).value};
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}

/* ---------- tabs ---------- */
function showTab(btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('on')});
  document.querySelectorAll('nav button').forEach(function(b){b.classList.remove('on')});
  $(btn.dataset.t).classList.add('on');btn.classList.add('on');
  if(btn.dataset.t==='tab-inbox'){loadInbox()}
  if(btn.dataset.t==='tab-more'){loadRemindersUI()}
}
$('tab-chat').classList.add('on');

/* ---------- pairing ---------- */
(async function init(){
  /* Native companion hands us credentials in the URL — adopt them once,
     then strip them so they never linger in the address bar or history. */
  var qs=new URLSearchParams(location.search);
  if(qs.get('deviceId')&&qs.get('deviceToken')){
    dev={id:qs.get('deviceId'),token:qs.get('deviceToken'),name:qs.get('name')||'My Phone'};
    localStorage.setItem('bella_phone',JSON.stringify(dev));
    history.replaceState(null,'','/api/phone/app');
  }
  try{dev=JSON.parse(localStorage.getItem('bella_phone')||'null')}catch(e){dev=null}
  if(dev){
    var r=await fetch('/api/phone/poll?deviceId='+encodeURIComponent(dev.id)+'&deviceToken='+encodeURIComponent(dev.token));
    if(r.status===401){dev=null;localStorage.removeItem('bella_phone')}
  }
  paintPairState();
  if(!window.isSecureContext){$('banner').style.display='block'}
  $('securebadge').textContent=window.isSecureContext?'secure ✓':'http only';
  startPolling();restoreChat();registerSW();
})();
function paintPairState(){
  if(dev){
    $('devname').textContent=dev.name+' paired';
    $('unpairbtn').style.display='block';
    $('connstate').textContent='paired · '+dev.name;
  }else{
    $('pairname').style.display='block';$('pairtoken').style.display='block';$('pairbtn').style.display='block';
    $('connstate').textContent='not paired';
  }
}
function registerManual(){
  var name=$('pairname').value.trim(),t=$('pairtoken').value.trim();
  if(!name||!t)return alert('Need both a name and the pairing code from the PC.');
  api('register',{pairToken:t,name:name}).then(function(res){
    if(!res.deviceId)return alert('Pairing failed: '+(res.error||'bad code'));
    dev=res;localStorage.setItem('bella_phone',JSON.stringify(dev));
    ['pairname','pairtoken'].forEach(function(i){$(i).style.display='none'});$('pairbtn').style.display='none';
    paintPairState();loadInbox();
  });
}
function unpair(){
  if(!dev||!confirm('Unpair '+dev.name+'?'))return;
  api('unpair',{deviceId:dev.id,deviceToken:dev.token});
  localStorage.removeItem('bella_phone');location.reload();
}

/* ---------- chat ---------- */
function bubble(cls,text){
  var d=document.createElement('div');d.className='msg '+cls;d.textContent=text;
  $('chatlist').appendChild(d);window.scrollTo(0,document.body.scrollHeight);return d;
}
function restoreChat(){
  var saved=[];try{saved=JSON.parse(localStorage.getItem('bella_chat')||'[]')}catch(e){}
  saved.forEach(function(m){bubble(m.cls,m.text)});
}
function persistChat(cls,text){
  var saved=[];try{saved=JSON.parse(localStorage.getItem('bella_chat')||'[]')}catch(e){}
  saved.push({cls:cls,text:text});localStorage.setItem('bella_chat',JSON.stringify(saved.slice(-80)));
}
function resetChat(){localStorage.removeItem('bella_chat');$('chatlist').innerHTML='';if(dev)api('chat',{deviceId:dev.id,deviceToken:dev.token,reset:true});}
async function sendChat(){
  if(!dev)return alert('Pair the phone first (More tab).');
  var text=$('chatin').value.trim();if(!text)return;
  $('chatin').value='';bubble('me',text);persistChat('me',text);
  var thinking=bubble('sys','…');
  try{
    var res=await api('chat',{deviceId:dev.id,deviceToken:dev.token,message:text});
    thinking.remove();
    var reply=res.reply||('⚠️ '+(res.error||'No reply.'));
    bubble('bella',reply);persistChat('bella',reply);speak(reply);
  }catch(e){thinking.remove();bubble('sys','Connection error: '+e.message)}
}
$('chatin').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}});

/* ---------- hold-to-talk ---------- */
var mediaRec=null,chunks=[];
var mic=$('mic');
mic.addEventListener('pointerdown',async function(){
  if(!dev)return alert('Pair first.');
  if(!navigator.mediaDevices)return alert('Mic needs the https setup (banner at top).');
  try{
    var stream=await navigator.mediaDevices.getUserMedia({audio:true});
    chunks=[];
    mediaRec=new MediaRecorder(stream);
    mediaRec.ondataavailable=function(e){chunks.push(e.data)};
    mediaRec.onstop=async function(){
      stream.getTracks().forEach(function(t){t.stop()});
      var blob=new Blob(chunks,{type:mediaRec.mimeType||'audio/webm'});
      if(blob.size<800)return;
      mic.classList.remove('rec');mic.textContent='🎙';
      var thinking=bubble('sys','listening…');
      var b64=await new Promise(function(res){var fr=new FileReader();fr.onload=function(){res(fr.result.split(',')[1])};fr.readAsDataURL(blob)});
      try{
        var res=await api('talk',{deviceId:dev.id,deviceToken:dev.token,audio:b64});
        thinking.remove();
        if(res.transcript){bubble('me',res.transcript);persistChat('me',res.transcript)}
        var reply=res.reply||res.error||'(nothing heard)';
        bubble('bella',reply);persistChat('bella',reply);speak(reply);
      }catch(e){thinking.remove();bubble('sys','Talk failed: '+e.message)}
    };
    mediaRec.start();mic.classList.add('rec');mic.textContent='⏺';
  }catch(e){alert('Microphone blocked: '+e.message)}
});
mic.addEventListener('pointerup',function(){if(mediaRec&&mediaRec.state==='recording')mediaRec.stop()});
mic.addEventListener('pointerleave',function(){if(mediaRec&&mediaRec.state==='recording')mediaRec.stop()});

/* ---------- speech ---------- */
function speak(text){
  if(!tts||!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  var u=new SpeechSynthesisUtterance(text.replace(/[*_#]/g,''));
  u.rate=1.02;speechSynthesis.speak(u);
}
function toggleTts(){tts=!tts;$('ttlb').textContent=tts?'🔊 Voice on':'🔇 Voice off';if(tts)speak('Voice replies on.')}

/* ---------- PC control ---------- */
async function pc(action,args,silent){
  if(!dev)return;
  try{
    var res=await api('pc',{deviceId:dev.id,deviceToken:dev.token,action:action,args:args||{}});
    if(!silent&&!res.ok)toast('⚠️ '+(res.error||'failed'));
  }catch(e){if(!silent)toast('Connection error')}
}
function openUrl(){var u=v('urlgo').trim();if(u){pc('openWebsite',{url:u});$('urlgo').value=''}}
function setBri(p){pc('brightness',{percent:p})}
async function shot(){
  toast('Capturing…');
  var res=await fetch('/api/phone/pc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:dev.id,deviceToken:dev.token,action:'takeScreenshot',args:{include_image:true,max_dim:1100}})});
  var j=await res.json();
  if(j.image){$('shotimg').src=j.image;if(typeof $('shotdlg').showModal==='function')$('shotdlg').showModal()}
  else toast('Screenshot failed');
}
async function clip(){
  var res=await fetch('/api/phone/pc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:dev.id,deviceToken:dev.token,action:'getClipboard',args:{}})});
  var j=await res.json();
  var txt=(j.result&&(j.result.text||j.result.result||''))||'';txt=String(txt).slice(0,600);
  toast(txt?('📋 '+txt):'Clipboard empty');if(txt)speak(txt);
}
function power(kind){
  if(!dev)return;api('pc',{deviceId:dev.id,deviceToken:dev.token,action:kind,args:{}}).then(function(r){toast(r.result||r.error||'done')});
}
function toast(msg){bubble('sys',msg)}

/* ---------- inbox & polling ---------- */
async function wake(){if(!dev)return;await api('wake',{deviceId:dev.id,deviceToken:dev.token});toast('🔔 BELLA is waking up on your PC')}
async function loadInbox(){
  if(!dev)return;
  var r=await fetch('/api/phone/history?deviceId='+encodeURIComponent(dev.id)+'&deviceToken='+encodeURIComponent(dev.token));
  if(r.status!==200)return;var j=await r.json();
  $('inbox').innerHTML=(j.history||[]).slice().reverse().map(function(h){return '<div class="inboxitem">'+esc(h.text)+'<div class="small">'+esc(new Date(h.t).toLocaleTimeString())+'</div></div>'}).join('')||'<div class="small">Nothing yet.</div>';
}
async function pollOnce(){
  if(!dev)return;
  var r;
  try{r=await fetch('/api/phone/poll?deviceId='+encodeURIComponent(dev.id)+'&deviceToken='+encodeURIComponent(dev.token))}
  catch(e){$('connstate').textContent='offline';return}
  $('connstate').textContent='paired · '+dev.name;
  if(r.status===204){reportHeartbeat();return}
  if(r.status===401){dev=null;localStorage.removeItem('bella_phone');paintPairState();return}
  if(r.status!==200)return;
  var c=await r.json();
  if(c.kind==='notify'){
    $('inbox').insertAdjacentHTML('afterbegin','<div class="inboxitem">'+esc(c.text)+'</div>');
    if(document.hidden&&window.Notification&&Notification.permission==='granted'){
      navigator.serviceWorker&&navigator.serviceWorker.ready.then(function(reg){reg.showNotification('BELLA',{body:c.text,icon:'/api/phone/icons/icon-192.png'})});
    }
  }else if(c.kind==='ask'){
    currentCmd=c;$('askq').textContent=c.text;$('askbox').style.display='block';
    if(window.Notification&&Notification.permission==='granted'){new Notification('BELLA asks',{body:c.text})}
    speak(c.text);
  }else if(c.kind==='locate'&&navigator.geolocation){
    navigator.geolocation.getCurrentPosition(function(pos){
      api('location',{deviceId:dev.id,deviceToken:dev.token,lat:pos.coords.latitude,lng:pos.coords.longitude,acc:pos.coords.accuracy});
    },function(){},{enableHighAccuracy:true,timeout:8000});
  }
  reportHeartbeat();
}
async function reportHeartbeat(){
  if(!dev||!navigator.getBattery)return;
  var b=await navigator.getBattery().catch(function(){return null});
  if(b)api('device-status',{deviceId:dev.id,deviceToken:dev.token,battery:Math.round(b.level*100),charging:b.charging});
}
async function sendAnswer(){
  var a=$('ans').value.trim();if(!a||!currentCmd)return;
  await api('answer',{deviceId:dev.id,deviceToken:dev.token,commandId:currentCmd.id,answer:a});
  currentCmd=null;$('askbox').style.display='none';$('ans').value='';
}
function startPolling(){pollOnce();setInterval(pollOnce,3000)}

/* ---------- PWA install + push + geo ---------- */
function registerSW(){
  if(!('serviceWorker' in navigator)){maybeInstallBtn(false);return}
  navigator.serviceWorker.register('/api/phone/sw.js').then(function(){
    maybeInstallBtn(true);
  }).catch(function(){maybeInstallBtn(false)});
}
function maybeInstallBtn(swOk){
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();deferredPrompt=e;$('installbtn').style.display='inline-block';
  });
}
$('installbtn').addEventListener('click',function(){
  if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null;$('installbtn').style.display='none'}
});
$('notifbtn').addEventListener('click',async function(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return alert('Notifications need the https setup (banner at top).');
  var perm=await Notification.requestPermission();
  if(perm!=='granted')return alert('Permission denied.');
  var reg=await navigator.serviceWorker.ready;
  var keyRes=await fetch('/api/phone/vapid-key');var key=(await keyRes.json()).publicKey;
  var sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8(key)});
  await api('push-subscribe',{deviceId:dev.id,deviceToken:dev.token,subscription:sub.toJSON()});
  toast('🔔 Notifications on — test with "send a note to my phone".');
});
function urlB64ToUint8(base64){
  var pad='='.repeat((4-base64.length%4)%4);var b64=(base64+pad).replace(/-/g,'+').replace(/_/g,'/');
  var raw=atob(b64);var arr=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr;
}
function toggleGeo(on){
  $('geostate').textContent=on?'starting…':'off';
  if(!on){if(geoWatch){navigator.geolocation.clearWatch(geoWatch);geoWatch=null}return}
  if(!navigator.geolocation)return alert('Geolocation unavailable.');
  geoWatch=navigator.geolocation.watchPosition(function(pos){
    $('geostate').textContent=pos.coords.latitude.toFixed(4)+', '+pos.coords.longitude.toFixed(4)+' ±'+Math.round(pos.coords.accuracy)+'m';
    if(Date.now()-lastGeoPost>120000&&dev){
      lastGeoPost=Date.now();
      api('location',{deviceId:dev.id,deviceToken:dev.token,lat:pos.coords.latitude,lng:pos.coords.longitude,acc:pos.coords.accuracy});
    }
  },function(err){$('geostate').textContent='error: '+err.message},{enableHighAccuracy:true,maximumAge:30000});
}

/* ---------- senders ---------- */
async function upload(file,kind,captionIt){
  if(!dev)return alert('Pair first.');
  if(!file)return;
  if(file.size>20*1024*1024)return alert('Max 20 MB.');
  toast('Sending '+file.name+'…');
  var b64=await new Promise(function(res){var fr=new FileReader();fr.onload=function(){res(fr.result.split(',')[1])};fr.readAsDataURL(file)});
  var res=await api(kind,{deviceId:dev.id,deviceToken:dev.token,name:file.name,data:b64,analyze:!!captionIt});
  toast(res.saved?('✅ '+res.saved):(res.error||'Upload failed'));if(res.caption)toast('👁 '+res.caption);
}
function sendPhoto(f){upload(f,'photo',confirm('Should BELLA describe this photo?'))}
function sendFile(f){upload(f,'file',false)}

/* ---------- briefing & reminders ---------- */
async function loadBriefing(){
  if(!dev)return;
  $('briefing').textContent='…';
  var r=await fetch('/api/phone/briefing?deviceId='+encodeURIComponent(dev.id)+'&deviceToken='+encodeURIComponent(dev.token));
  var j=await r.json();$('briefing').textContent=j.briefing||j.error||'Nothing scheduled.';speak($('briefing').textContent);
}
async function loadRemindersUI(){
  if(!dev)return;
  var r=await fetch('/api/phone/reminders?deviceId='+encodeURIComponent(dev.id)+'&deviceToken='+encodeURIComponent(dev.token));
  var j=await r.json();
  $('remlist').innerHTML=(j.reminders||[]).map(function(x){return '<div class="inboxitem">⏰ '+esc(x.text)+' <span class="small">'+esc(x.when)+'</span></div>'}).join('')||'<div class="small">None set.</div>';
}
async function addReminder(){
  var t=$('remtext').value.trim();if(!t||!dev)return;
  await api('reminders',{deviceId:dev.id,deviceToken:dev.token,text:t});
  $('remtext').value='';loadRemindersUI();
}
</script></body></html>`;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function createPhoneAppRouter(): express.Router {
  const router = express.Router();

  // ---- public asset routes -------------------------------------------------
  router.get("/app", (_req, res) => {
    res.type("html").send(APP_PAGE);
  });
  // The native Android companion — built by scripts/build-apk.ps1.
  router.get("/app.apk", (_req, res) => {
    const file = path.join(ICONS_DIR, "bella.apk");
    if (!fs.existsSync(file)) {
      return res.status(404).type("text").send(
        "BELLA's Android app isn't built yet. Run scripts/build-apk.ps1 on the PC.");
    }
    res.set("Content-Type", "application/vnd.android.package-archive")
      .set("Content-Disposition", 'attachment; filename="bella.apk"')
      .sendFile(file);
  });
  router.get("/manifest.webmanifest", (_req, res) => {
    res.type("application/manifest+json").send(manifestJson());
  });
  router.get("/sw.js", (_req, res) => {
    res.type("application/javascript").send(SW_JS);
  });
  router.get("/vapid-key", (_req, res) => {
    try { res.json({ publicKey: getVapid().publicKey }); }
    catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
  });
  router.get("/ca.crt", (_req, res) => {
    const pem = caCertPem();
    if (!pem) return res.status(404).send("No local CA yet.");
    res.type("application/x-x509-ca-cert")
      .set("Content-Disposition", 'attachment; filename="bella-local-ca.crt"')
      .send(Buffer.from(pem));
  });
  router.get("/icons/:name", (req, res) => {
    const name = String(req.params.name);
    if (!/^[\w-]+\.png$/.test(name)) return res.status(400).end();
    const file = path.join(ICONS_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.type("png").sendFile(file);
  });

  // ---- pairing / lifecycle -------------------------------------------------
  router.post("/unpair", express.json(), (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    writeSecretJson(dataFilePath("phone_devices.json"),
      loadDevices().filter(d => d.id !== dev!.id));
    const subs = getSubs(); delete subs[dev.id]; writeSecretJson(SUBS_FILE, subs);
    res.json({ ok: true });
  });

  router.post("/push-subscribe", express.json({ limit: "64kb" }), (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const sub = (req.body as { subscription?: unknown }).subscription;
    if (!sub) return res.status(400).json({ error: "Missing subscription." });
    getVapid();
    const subs = getSubs();
    const list = (subs[dev.id] || []) as unknown[];
    const endpoint = (sub as { endpoint?: string }).endpoint;
    subs[dev.id] = [...list.filter(s => (s as { endpoint?: string }).endpoint !== endpoint), sub];
    writeSecretJson(SUBS_FILE, subs);
    res.json({ ok: true });
  });

  router.post("/device-status", express.json(), (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const b = (req.body || {}) as Record<string, unknown>;
    const prev = readSecretJson<Record<string, PhoneStatusReport>>(LOCATION_FILE, {});
    prev[dev.id] = {
      ...prev[dev.id],
      battery: typeof b.battery === "number" ? b.battery : undefined,
      charging: typeof b.charging === "boolean" ? b.charging : undefined,
      t: new Date().toISOString(),
    };
    writeSecretJson(LOCATION_FILE, prev);
    res.json({ ok: true });
  });

  router.post("/location", express.json(), (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const b = (req.body || {}) as Record<string, number | boolean>;
    const prev = readSecretJson<Record<string, PhoneStatusReport>>(LOCATION_FILE, {});
    prev[dev.id] = {
      lat: Number(b.lat), lng: Number(b.lng), acc: Number(b.acc) || undefined,
      battery: prev[dev.id]?.battery, charging: prev[dev.id]?.charging,
      t: new Date().toISOString(),
    };
    writeSecretJson(LOCATION_FILE, prev);
    res.json({ ok: true });
  });

  // ---- chat / talk ---------------------------------------------------------
  router.post("/chat", express.json({ limit: "128kb" }), async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const body = req.body as { message?: string; reset?: boolean };
    if (body.reset) { conversations.delete(dev.id); return res.json({ ok: true }); }
    const message = String(body.message || "").slice(0, 4000).trim();
    if (!message) return res.status(400).json({ error: "Empty message." });
    try {
      const reply = await runBrain(dev.id, message);
      res.json({ reply });
    } catch (err: unknown) {
      res.status(500).json({ error: String((err as Error)?.message || err) });
    }
  });

  router.post("/talk", express.json({ limit: "12mb" }), async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const audio = String((req.body as { audio?: string }).audio || "");
    if (!audio) return res.status(400).json({ error: "No audio." });
    try {
      const transcript = await transcribeAudio(audio);
      if (!transcript) return res.json({ transcript: "", reply: "I didn't catch that — try again?" });
      const reply = await runBrain(dev.id, transcript);
      res.json({ transcript, reply });
    } catch (err: unknown) {
      res.status(500).json({ error: String((err as Error)?.message || err) });
    }
  });

  // ---- curated PC remote ---------------------------------------------------
  router.post("/pc", express.json(), async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const { action, args } = (req.body || {}) as { action: string; args?: Record<string, unknown> };
    try {
      switch (action) {
        case "lock": case "sleep": case "restart": case "shutdown": case "cancelShutdown":
          return res.json({ ok: true, result: await powerAction(action) });
        case "brightness":
          return res.json({ ok: true, result: await setBrightness(Number(args?.percent ?? 80)) });
        case "takeScreenshot": {
          const result = await execTool("takeScreenshot", { include_image: true, max_dim: 1100 });
          const img = extractImage(result);
          if (!img) return res.json({ ok: false, error: "Desktop agent returned no image.", result });
          return res.json({ ok: true, image: `data:image/jpeg;base64,${img}` });
        }
        default: {
          const ALLOWED = new Set([
            "volumeUp", "volumeDown", "setVolume", "muteToggle",
            "mediaPlayPause", "mediaNextTrack", "mediaPrevTrack", "mediaStop",
            "changeSong", "skipSong", "openApplication", "openWebsite",
            "typeText", "pasteClipboard", "pressEnter", "pressKey",
            "nextTab", "previousTab", "newTab", "closeTab", "browserBack", "browserForward",
            "getClipboard",
          ]);
          if (!ALLOWED.has(action)) return res.status(400).json({ ok: false, error: `Action "${action}" not allowed from the phone.` });
          const result = await execTool(action, args || {});
          return res.json({ ok: true, result });
        }
      }
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: String((err as Error)?.message || err) });
    }
  });

  // ---- uploads ---------------------------------------------------------------
  router.post("/photo", express.json({ limit: "25mb" }), async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const { name, data, analyze } = (req.body || {}) as { name?: string; data?: string; analyze?: boolean };
    if (!data) return res.status(400).json({ error: "Missing image data." });
    try {
      const dir = ensureDir(path.join(HOME(), "Pictures", "BellaFromPhone"));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(dir, `${stamp}-${(name || "photo.jpg").replace(/[^\w.-]+/g, "_")}`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      let caption: string | undefined;
      if (analyze) {
        const apiKey = getCurrentApiKey();
        if (apiKey) {
          const ai = makeClient(apiKey);
          const ext = path.extname(file).toLowerCase();
          const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
          caption = await withModelFallback(async model => {
            const r = await ai.models.generateContent({
              model,
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: mime, data } as never },
                { text: "Describe this photo concisely in two sentences." },
              ] }],
            });
            return (r.text || "").trim();
          });
        }
      }
      res.json({ saved: path.basename(file), ...(caption ? { caption } : {}) });
    } catch (err: unknown) {
      res.status(500).json({ error: String((err as Error)?.message || err) });
    }
  });

  router.post("/file", express.json({ limit: "25mb" }), async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const { name, data } = (req.body || {}) as { name?: string; data?: string };
    if (!data) return res.status(400).json({ error: "Missing file data." });
    try {
      const dir = ensureDir(path.join(HOME(), "Documents", "BellaFromPhone"));
      const safe = (name || "file.bin").replace(/[^\w .()-]+/g, "_");
      const file = path.join(dir, `${Date.now()}-${safe}`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      res.json({ saved: path.basename(file) });
    } catch (err: unknown) {
      res.status(500).json({ error: String((err as Error)?.message || err) });
    }
  });

  // ---- Android share target (no auth possible — fixed secret in the path) ---
  router.post("/share/:secret", express.urlencoded({ extended: false }), (req, res) => {
    if (req.params.secret !== getShareSecret()) return res.status(403).end();
    const { title, text, url } = (req.body || {}) as Record<string, string>;
    const parts = [title, text, url].filter(Boolean);
    if (!parts.length) return res.redirect("/api/phone/app");
    const note = `Shared from phone: ${parts.join(" — ")}`.slice(0, 500);
    for (const d of loadDevices()) queueNotification(d, note);
    res.redirect("/api/phone/app");
  });

  // ---- briefing / reminders -------------------------------------------------
  router.get("/briefing", async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    try {
      const lines = await buildBriefing();
      res.json({ briefing: lines.join("\n") || "All quiet — nothing on the agenda." });
    } catch (err: unknown) {
      res.status(500).json({ error: String((err as Error)?.message || err) });
    }
  });

  router.get("/reminders", async (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const list = loadReminders()
      .filter(r => r.active)
      .sort((a, b) => String(a.when ?? "9999").localeCompare(String(b.when ?? "9999")))
      .slice(0, 15)
      .map(r => ({ text: r.text, when: describeWhen(r) }));
    res.json({ reminders: list });
  });

  router.post("/reminders", express.json(), (req, res) => {
    const dev = authDevice(req);
    if (!dev) return res.status(401).json({ error: "Unknown device." });
    const text = String((req.body as { text?: string })?.text || "").slice(0, 300);
    if (!text) return res.status(400).json({ error: "Missing text." });
    const r = addReminder({ text });
    res.json({ ok: true, reminder: { text: r.text, when: describeWhen(r) } });
  });

  return router;
}

// ---------------------------------------------------------------------------
// HTTPS listener for the LAN secure context
// ---------------------------------------------------------------------------
export async function startPhoneHttps(app: express.Express): Promise<boolean> {
  const certs = await ensureCerts();
  const tls = certs ? tlsOptions() : null;
  if (!tls) return false;
  return new Promise(resolve => {
    try {
      const listener = app as unknown as (req: unknown, res: unknown) => void;
      const server = https.createServer(tls, listener);
      server.on("error", err => {
        console.warn(`[Phone HTTPS] Port ${HTTPS_PORT} unavailable (${(err as Error).message}) — continuing HTTP-only.`);
        resolve(false);
      });
      server.listen(HTTPS_PORT, "0.0.0.0", () => {
        console.log(`[Phone HTTPS] Secure companion listening on https://<this-pc>:${HTTPS_PORT}/api/phone/app`);
        resolve(true);
      });
    } catch (err) {
      console.warn("[Phone HTTPS] Failed to start:", (err as Error).message);
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Voice tools so desktop BELLA can reach back
// ---------------------------------------------------------------------------
export const phoneAppModule: ToolModule = {
  name: "phoneapp",
  declarations: [
    {
      name: "findMyPhone",
      description: "Locate the paired phone using its last reported GPS position, battery level and last check-in time. Use for 'where is my phone'.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "pingMyPhoneLocation",
      description: "Ask the paired phone to report fresh location on its next check-in. Useful when the stored position is stale.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "phoneStatus",
      description: "Battery level, charging state and last-seen time of the paired phone.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
  async execute(name) {
    const reports = readSecretJson<Record<string, PhoneStatusReport>>(LOCATION_FILE, {});
    const latest = Object.values(reports)
      .filter(Boolean)
      .sort((a, b) => String(b.t).localeCompare(String(a.t)))[0];
    switch (name) {
      case "findMyPhone": {
        if (!latest?.lat) throw new Error("The phone hasn't reported a location yet — open the companion app or use pingMyPhoneLocation.");
        const ageMin = Math.round((Date.now() - new Date(latest.t).getTime()) / 60000);
        const maps = `https://maps.google.com/?q=${latest.lat},${latest.lng}`;
        return {
          result: `Phone last seen ${ageMin === 0 ? "just now" : `${ageMin} min ago`} at ${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)} (±${Math.round(latest.acc || 0)} m). Map: ${maps}`,
          lat: latest.lat, lng: latest.lng, mapsLink: maps,
        };
      }
      case "pingMyPhoneLocation": {
        const dev = pickDevice(undefined);
        if (!dev) throw new Error("No phone is paired yet.");
        queueNotification(dev, "Please send a fresh location check-in.", "locate");
        return { result: `Asked ${dev.name} to check in with its location — it reports when the companion app next syncs.` };
      }
      case "phoneStatus": {
        if (!latest) throw new Error("The phone hasn't checked in yet.");
        const ageMin = Math.round((Date.now() - new Date(latest.t).getTime()) / 60000);
        return { result: `Battery ${latest.battery != null ? `${latest.battery}%${latest.charging ? " (charging)" : ""}` : "unknown"}, last check-in ${ageMin === 0 ? "just now" : `${ageMin} min ago`}.` };
      }
    }
    throw new Error(`Unknown phoneapp tool: ${name}`);
  },
};
