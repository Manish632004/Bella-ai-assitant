/**
 * BELLA 6.0 — shared utilities for capability modules.
 * Zero-dependency: zip (store/deflate) reader+writer, minimal PDF writer,
 * JSON persistence, Gemini one-shot helpers and mid-session announcements.
 */
import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";
import { GoogleGenAI } from "@google/genai";
import { dataFile } from "../server_paths";

// ---------------------------------------------------------------------------
// JSON file persistence
// ---------------------------------------------------------------------------
export function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch { /* corrupt — fall through */ }
  return fallback;
}

export function writeJson(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[Bella Util] Failed writing ${file}:`, err);
  }
}

export const dataFilePath = dataFile;

// ---------------------------------------------------------------------------
// Minimal ZIP implementation (write: deflate; read: stored + deflate).
// Enough to build/parse OOXML packages (.docx / .xlsx) without dependencies.
// ---------------------------------------------------------------------------
interface ZipEntry { name: string; data: Buffer; }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function createZip(entries: Record<string, string | Buffer>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [nameRaw, contentRaw] of Object.entries(entries)) {
    const name = Buffer.from(nameRaw.replace(/\\/g, "/"), "utf-8");
    const data = Buffer.isBuffer(contentRaw) ? contentRaw : Buffer.from(contentRaw, "utf-8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x2821, 12); // date (2000-01-01, deterministic)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, payload);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x2821, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    // extra/comment/disk/attrs = 0
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

export function readZip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  // Locate End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip archive.");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf-8", ptr + 46, ptr + 46 + nameLen);
    // Local header
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out[name.replace(/\\/g, "/")] =
      method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function readZipFile(zipPath: string): Record<string, Buffer> {
  return readZip(fs.readFileSync(zipPath));
}

// ---------------------------------------------------------------------------
// XML escaping helper for OOXML
// ---------------------------------------------------------------------------
export function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// ---------------------------------------------------------------------------
// Minimal PDF writer (Helvetica, word-wrapped multi-page)
// ---------------------------------------------------------------------------
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Wrap plain text into lines that fit ~90 chars per page width. */
function wrapText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of String(text || "").split(/\r?\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > maxChars) {
        if (line) out.push(line.trim());
        line = word;
      } else {
        line = (line ? line + " " : "") + word;
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

/**
 * Create a simple, valid multi-page PDF from a title and sections.
 * Returns the PDF bytes.
 */
export function createPdfBytes(title: string, sections: { heading?: string; body: string }[]): Buffer {
  const pages: string[][] = [];
  const LINES_PER_PAGE = 44;
  let current: string[] = [];
  const pushLine = (l: string) => {
    current.push(l);
    if (current.length >= LINES_PER_PAGE) { pages.push(current); current = []; }
  };
  pushLine(title.toUpperCase());
  pushLine("");
  for (const sec of sections) {
    if (sec.heading) { pushLine(""); pushLine(sec.heading); }
    for (const line of wrapText(sec.body, 92)) pushLine(line);
  }
  if (current.length) pages.push(current);

  const objects: string[] = [];
  const pageObjIds: number[] = [];
  // 1: catalog, 2: pages, 3: font regular, 4: font bold
  let nextId = 5;
  const contentIds: number[] = [];
  for (let p = 0; p < pages.length; p++) {
    contentIds.push(nextId++);
  }
  for (let p = 0; p < pages.length; p++) pageObjIds.push(nextId++);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((lines, idx) => {
    let stream = "BT /F2 16 Tf 50 792 Td\n";
    lines.forEach((line, li) => {
      if (li === 0 && idx === 0) {
        stream += `(${pdfEscape(line)}) Tj\n`;
      } else {
        stream += `0 -14 Td /F1 10 Tf (${pdfEscape(line)}) Tj\n`;
      }
    });
    stream += "ET";
    const cid = contentIds[idx];
    const pid = pageObjIds[idx];
    objects[cid] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objects[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < nextId; id++) {
    offsets[id] = Buffer.byteLength(pdf);
    if (!objects[id]) continue;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextId; id++) {
    pdf += `${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ---------------------------------------------------------------------------
// Gemini one-shot helpers
// ---------------------------------------------------------------------------
const FLASH_MODEL = process.env.BELLA_FLASH_MODEL || "gemini-flash-latest";

/**
 * Pool-resolved API key snapshot. server.ts refreshes this on every live
 * connection (updateBellaCtx) so background engines (agents, scheduler,
 * skills) always have a working key without circular imports.
 */
let currentApiKey = "";
export function setCurrentApiKey(key: string): void { currentApiKey = key || currentApiKey; }
export function getCurrentApiKey(): string {
  return currentApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

export function makeClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

export async function generateText(apiKey: string, prompt: string, system?: string): Promise<string> {
  const ai = makeClient(apiKey);
  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    ...(system ? { config: { systemInstruction: system } } : {}),
  });
  return (response.text || "").trim();
}

/** Ask Gemini for strict JSON; extracts the first JSON object found. */
export async function generateJson<T>(apiKey: string, prompt: string, system?: string): Promise<T> {
  const sys = (system ? system + "\n\n" : "") +
    "IMPORTANT: Reply with ONLY a single valid JSON value. No markdown fences, no commentary.";
  const raw = await generateText(apiKey, prompt, sys);
  const start = raw.search(/[[{]/);
  const endBrace = raw.lastIndexOf("}");
  const endBracket = raw.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (start < 0 || end <= start) throw new Error("Model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/** Analyze an image frame with the vision-capable flash model. */
export async function analyzeImage(apiKey: string, jpegBase64: string, prompt: string): Promise<string> {
  const ai = makeClient(apiKey);
  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: jpegBase64 } },
      prompt,
    ],
  });
  return (response.text || "").trim();
}

// ---------------------------------------------------------------------------
// Live-session registry: lets modules announce things mid-conversation.
// server.ts registers/unregisters active sessions here on connect/close.
// ---------------------------------------------------------------------------
export interface LiveSessionHandle {
  sessionId: string;
  sendRealtimeInput: (input: { text: string }) => void;
  sendToolResponse: (resp: unknown) => void;
  clientWs: { send: (data: string) => void } | null;
}

const liveSessions = new Map<string, LiveSessionHandle>();

export function registerLiveSession(handle: LiveSessionHandle): void {
  liveSessions.set(handle.sessionId, handle);
}
export function unregisterLiveSession(sessionId: string): void {
  liveSessions.delete(sessionId);
}
export function getLiveSession(sessionId?: string): LiveSessionHandle | null {
  if (sessionId && liveSessions.has(sessionId)) return liveSessions.get(sessionId)!;
  for (const s of liveSessions.values()) return s;
  return null;
}

export function getLiveSessionCount(): number {
  return liveSessions.size;
}

/**
 * Whisper something into the live conversation — Bella speaks it aloud.
 * Used by reminders firing, background agents reporting back, etc.
 */
export function announce(text: string, sessionId?: string): boolean {
  const handle = getLiveSession(sessionId);
  if (!handle) {
    console.log(`[Bella Announce] (no live session) ${text}`);
    return false;
  }
  try {
    handle.sendRealtimeInput({
      text: `[SYSTEM EVENT — report this to the user naturally, in your own voice, briefly]: ${text}`,
    });
    try {
      handle.clientWs?.send(JSON.stringify({ type: "transcription", role: "system-event", text }));
    } catch {}
    return true;
  } catch (err) {
    console.error("[Bella Announce] failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
export const HOME = () => os.homedir();
export function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function resolveUserPath(p: string): string {
  if (!p) return p;
  let out = String(p).trim().replace(/^["']|["']$/g, "");
  if (out.startsWith("~")) out = path.join(os.homedir(), out.slice(1));
  if (/^(Desktop|Documents|Downloads|Pictures|Music|Videos)$/i.test(out)) {
    out = path.join(os.homedir(), out);
  }
  return path.resolve(out);
}

export async function runPowerShell(script: string, timeoutMs = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const { exec } = await import("child_process");
  return new Promise((resolve) => {
    const child = exec(
      `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout?.toString() || "", stderr: stderr?.toString() || err?.message || "" }),
    );
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: e.message }));
  });
}

export async function runCommand(cmd: string, cwd?: string, timeoutMs = 60000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const { exec } = await import("child_process");
  return new Promise((resolve) => {
    const child = exec(cmd, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout?.toString() || "", stderr: stderr?.toString() || err?.message || "" }));
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: e.message }));
  });
}

/** Fetch with timeout that returns text; throws on HTTP errors. */
export async function fetchText(url: string, timeoutMs = 15000, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 15000, init?: RequestInit): Promise<T> {
  const txt = await fetchText(url, timeoutMs, init);
  return JSON.parse(txt) as T;
}
