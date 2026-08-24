/**
 * BELLA 6.0 — Extra tool categories.
 *
 * - Weather: current conditions + forecast wherever you actually are.
 * - Finance: live stock quotes, ticker search and price history.
 * - Files & folders: temp-file cleanup, zip/unzip archives, sort a messy
 *   folder by extension, batch-rename hundreds of files.
 * - Clipboard: history you can browse by voice ("what did I copy three items
 *   ago?") plus copy-back.
 * - HUD control: move/hide BELLA's own window with your voice.
 */
import fs from "fs";
import path from "path";
import { Type } from "@google/genai";
import {
  readJson, writeJson, dataFilePath, runPowerShell, runCommand,
  fetchJson, resolveUserPath, HOME,
} from "./util";
import type { ToolModule } from "./types";

// ===========================================================================
// Weather (wttr.in — keyless)
// ===========================================================================
async function detectLocation(): Promise<string> {
  try {
    const geo = await fetchJson<{ city?: string; regionName?: string }>("/http://ip-api.com/json/".replace(/^\//, "http://"), 6000);
    if (geo.city) return `${geo.city}${geo.regionName ? ", " + geo.regionName : ""}`;
  } catch {}
  return "";
}

interface WttrCurrent {
  temp_C: string; FeelsLikeC: string; humidity: string;
  weatherDesc: { value: string }[]; windspeedKmph: string; winddir16Point: string;
}
interface WttrResponse {
  current_condition: WttrCurrent[];
  nearest_area: { areaName: { value: string }[]; country: { value: string }[] }[];
  weather: { date: string; mintempC: string; maxtempC: string; hourly: { weatherDesc: { value: string }[]; time: string }[] }[];
}

// ===========================================================================
// Finance (Yahoo public endpoints)
// ===========================================================================
const UA = { headers: { "User-Agent": "Mozilla/5.0 BELLA/6.0" } };

interface YahooChartResult {
  meta: { symbol: string; currency: string; regularMarketPrice: number; chartPreviousClose?: number; previousClose?: number; longName?: string };
  timestamp?: number[];
  indicators: { quote: { close: (number | null)[] }[] };
}
interface YahooChart {
  chart: {
    result?: YahooChartResult[];
    error?: unknown;
  };
}

function summarizeHistory(c: YahooChartResult | undefined): string {
  const closes = c?.indicators?.quote?.[0]?.close?.filter((x): x is number => x != null) || [];
  if (!closes.length) return "No price history available.";
  const first = closes[0], last = closes[closes.length - 1];
  const min = Math.min(...closes), max = Math.max(...closes);
  const pct = ((last - first) / first) * 100;
  return `start ${first.toFixed(2)} → now ${last.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%), range ${min.toFixed(2)}–${max.toFixed(2)}.`;
}

// ===========================================================================
// Clipboard history
// ===========================================================================
interface ClipEntry { text: string; time: string; }
let clipHistory: ClipEntry[] = [];
let clipWatcherStarted = false;
let lastClip = "";

async function readClipboard(): Promise<string> {
  const r = await runCommand(`powershell -NoProfile -NonInteractive -Command "Get-Clipboard"`, undefined, 8000);
  return r.stdout.replace(/\r?\n$/, "");
}

export function startClipboardWatcher(): void {
  if (clipWatcherStarted) return;
  clipWatcherStarted = true;
  setInterval(async () => {
    try {
      const text = await readClipboard();
      if (text && text !== lastClip && text.length < 4000) {
        lastClip = text;
        clipHistory.push({ text, time: new Date().toISOString() });
        if (clipHistory.length > 50) clipHistory = clipHistory.slice(-50);
      }
    } catch { /* ignore */ }
  }, 12000);
}

// ===========================================================================
// Tool module
// ===========================================================================
export const extrasModule: ToolModule = {
  name: "extras",
  declarations: [
    {
      name: "getWeather",
      description: "Current conditions and forecast for a location — or wherever you actually are when no city is given.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: { type: Type.STRING, description: "City name; omit to auto-detect." },
          days: { type: Type.INTEGER, description: "Forecast days 1-3 (default includes tomorrow)." },
        },
      },
    },
    {
      name: "getStockQuote",
      description: "Live stock price for a ticker (e.g. AAPL, TSLA.NSE style symbols work). Answers 'what's [company] trading at?'",
      parameters: { type: Type.OBJECT, properties: { ticker: { type: Type.STRING } }, required: ["ticker"] },
    },
    {
      name: "searchTicker",
      description: "Search stock tickers by company name.",
      parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] },
    },
    {
      name: "getPriceHistory",
      description: "Price history read aloud for a ticker. Range: 1d, 5d, 1mo, 6mo, 1y.",
      parameters: {
        type: Type.OBJECT,
        properties: { ticker: { type: Type.STRING }, range: { type: Type.STRING } },
        required: ["ticker"],
      },
    },
    {
      name: "cleanTempFiles",
      description: "Clean Windows temp files (%TEMP% and C:\\Windows\\Temp) older than 24 hours to free disk space.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "zipFolder",
      description: "Zip a file or folder into an archive.",
      parameters: {
        type: Type.OBJECT,
        properties: { sourcePath: { type: Type.STRING }, destZipPath: { type: Type.STRING, description: "Optional destination .zip." } },
        required: ["sourcePath"],
      },
    },
    {
      name: "unzipArchive",
      description: "Extract a zip archive into a folder.",
      parameters: {
        type: Type.OBJECT,
        properties: { zipPath: { type: Type.STRING }, destFolder: { type: Type.STRING } },
        required: ["zipPath"],
      },
    },
    {
      name: "sortFolderByType",
      description: "Sort a messy folder by moving every file into subfolders by type (Images, Documents, Videos, Audio, Archives, Code, Other).",
      parameters: { type: Type.OBJECT, properties: { folderPath: { type: Type.STRING } }, required: ["folderPath"] },
    },
    {
      name: "batchRename",
      description: "Batch-rename all matching files in a folder to pattern-001.ext style names.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          folderPath: { type: Type.STRING },
          pattern: { type: Type.STRING, description: "Base name, e.g. 'trip' → trip-001.jpg" },
          extensionFilter: { type: Type.STRING, description: "Only rename files with this extension, e.g. jpg." },
        },
        required: ["folderPath", "pattern"],
      },
    },
    {
      name: "browseClipboardHistory",
      description: "Show recent clipboard items so the user can ask 'what did I copy three items ago?' Index 1 = most recent.",
      parameters: { type: Type.OBJECT, properties: { limit: { type: Type.INTEGER } } },
    },
    {
      name: "copyFromClipboardHistory",
      description: "Re-copy an item from clipboard history back to the active clipboard by its index (1 = most recent).",
      parameters: { type: Type.OBJECT, properties: { index: { type: Type.INTEGER } }, required: ["index"] },
    },
    {
      name: "fuzzyFindAndOpen",
      description: "Fuzzy-search a file by partial name across Desktop/Downloads/Documents and OPEN the best match. Use when the user says 'find my invoice pdf and open it'.",
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING }, extension: { type: Type.STRING, description: "Optional filter like pdf/docx/jpg." } },
        required: ["query"],
      },
    },
    {
      name: "sleepNow",
      description: "Put BELLA to sleep immediately (ends the live session; wake word stays armed). Used for 'so jao' / 'go to sleep'.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "moveHud",
      description: "Move BELLA's own window by voice: direction ('left','right','up','down') or corner ('bottom-left','top-right','center' etc.). Also accepts 'mini'/'restore'.",
      parameters: {
        type: Type.OBJECT,
        properties: { where: { type: Type.STRING } },
        required: ["where"],
      },
    },
    {
      name: "setHudVisibility",
      description: "Hide or show BELLA's HUD window by voice.",
      parameters: { type: Type.OBJECT, properties: { visible: { type: Type.BOOLEAN } }, required: ["visible"] },
    },
  ],
  async execute(name, args, ctx) {
    switch (name) {
      case "getWeather": {
        let loc = String(args.location || "").trim();
        let autoDetected = false;
        if (!loc) { loc = await detectLocation(); autoDetected = true; }
        const w = await fetchJson<WttrResponse>(`https://wttr.in/${encodeURIComponent(loc)}?format=j1`, 12000);
        const cur = w.current_condition?.[0];
        if (!cur) throw new Error("Weather service returned nothing.");
        const area = w.nearest_area?.[0]?.areaName?.[0]?.value || loc || "your location";
        let out = `In ${area}: ${cur.weatherDesc[0].value}, ${cur.temp_C}°C (feels like ${cur.FeelsLikeC}°C), humidity ${cur.humidity}%, wind ${cur.windspeedKmph} km/h ${cur.winddir16Point}.`;
        const days = Number(args.days ?? 2);
        if (days >= 2 && w.weather?.length) {
          const tmrw = w.weather[Math.min(1, w.weather.length - 1)];
          out += ` Tomorrow: ${tmrw.mintempC}–${tmrw.maxtempC}°C.`;
        }
        return { result: out, autoDetected };
      }

      case "getStockQuote": {
        const ticker = encodeURIComponent(String(args.ticker).toUpperCase().trim());
        const data = await fetchJson<YahooChart>(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=5m`, 12000, UA);
        const meta = data.chart.result?.[0]?.meta;
        if (!meta) throw new Error(`No quote found for "${args.ticker}".`);
        const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
        const change = meta.regularMarketPrice - prev;
        const pct = prev ? (change / prev) * 100 : 0;
        return {
          result: `${meta.longName || meta.symbol}: ${meta.regularMarketPrice} ${meta.currency} (${change >= 0 ? "+" : ""}${change.toFixed(2)}, ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% today).`,
        };
      }
      case "searchTicker": {
        const r = await fetchJson<{ quotes: { symbol: string; shortname?: string; exchange?: string }[] }>(
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(String(args.query))}&quotesCount=6`, 12000, UA);
        return {
          result: r.quotes?.length ? r.quotes.map(q => `- ${q.symbol} (${q.shortname || "?"}${q.exchange ? ", " + q.exchange : ""})`).join("\n") : `No tickers matched "${args.query}".`,
        };
      }
      case "getPriceHistory": {
        const ticker = encodeURIComponent(String(args.ticker).toUpperCase().trim());
        const range = ["1d", "5d", "1mo", "6mo", "1y"].includes(String(args.range)) ? String(args.range) : "1mo";
        const interval = range === "1d" ? "5m" : "1d";
        const data = await fetchJson<YahooChart>(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`, 12000, UA);
        return { result: `${args.ticker} over ${range}: ${summarizeHistory(data.chart.result?.[0])}` };
      }

      case "cleanTempFiles": {
        const beforeFree = await freeDiskBytes("C:");
        const script =
          `$cutoff=(Get-Date).AddHours(-24); ` +
          `Get-ChildItem $env:TEMP -Force -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt $cutoff} | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; ` +
          `Get-ChildItem 'C:\\Windows\\Temp' -Force -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt $cutoff} | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`;
        await runPowerShell(script, 120000);
        const afterFree = await freeDiskBytes("C:");
        const freedMB = Math.max(0, (afterFree - beforeFree) / (1024 * 1024));
        return { result: `Temp cleanup done${freedMB > 1 ? ` — about ${Math.round(freedMB)} MB freed` : ""}. Free space now ${Math.round(afterFree / 1073741824 * 10) / 10} GB.` };
      }

      case "zipFolder": {
        const src = resolveUserPath(String(args.sourcePath));
        if (!fs.existsSync(src)) throw new Error(`Not found: ${src}`);
        const dest = args.destZipPath ? resolveUserPath(String(args.destZipPath)) : src + ".zip";
        const finalDest = dest.toLowerCase().endsWith(".zip") ? dest : dest + ".zip";
        const r = await runPowerShell(
          `Compress-Archive -Path '${src.replace(/'/g, "''")}' -DestinationPath '${finalDest.replace(/'/g, "''")}' -Force`,
          300000,
        );
        if (!r.ok) throw new Error(r.stderr.slice(0, 200));
        return { result: `Created archive ${finalDest}.` };
      }
      case "unzipArchive": {
        const zip = resolveUserPath(String(args.zipPath));
        if (!fs.existsSync(zip)) throw new Error(`Not found: ${zip}`);
        const dest = args.destFolder ? resolveUserPath(String(args.destFolder)) : zip.replace(/\.zip$/i, "");
        const r = await runPowerShell(
          `Expand-Archive -Path '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
          300000,
        );
        if (!r.ok) throw new Error(r.stderr.slice(0, 200));
        return { result: `Extracted into ${dest}.` };
      }

      case "sortFolderByType": {
        const dir = resolveUserPath(String(args.folderPath));
        if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
        const CATS: Record<string, string> = {};
        const add = (cat: string, exts: string[]) => exts.forEach(e => CATS[e] = cat);
        add("Images", ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "ico"]);
        add("Documents", ["pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "ppt", "pptx", "csv", "rtf", "odt"]);
        add("Videos", ["mp4", "mkv", "avi", "mov", "webm", "flv"]);
        add("Audio", ["mp3", "wav", "flac", "aac", "ogg", "m4a"]);
        add("Archives", ["zip", "rar", "7z", "tar", "gz"]);
        add("Code", ["py", "js", "ts", "html", "css", "json", "java", "cpp", "c", "cs", "sh", "bat", "ps1"]);
        add("Executables", ["exe", "msi", "apk"]);
        let moved = 0;
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          const ext = path.extname(f.name).slice(1).toLowerCase() || "other";
          const cat = CATS[ext] || "Other";
          const targetDir = path.join(dir, cat);
          fs.mkdirSync(targetDir, { recursive: true });
          let destName = f.name;
          let n = 1;
          while (fs.existsSync(path.join(targetDir, destName))) {
            const parsed = path.parse(f.name);
            destName = `${parsed.name}-${n++}${parsed.ext}`;
          }
          fs.renameSync(path.join(dir, f.name), path.join(targetDir, destName));
          moved++;
        }
        return { result: moved ? `Sorted ${moved} files in ${dir} by type.` : "That folder is already tidy — no loose files." };
      }

      case "batchRename": {
        const dir = resolveUserPath(String(args.folderPath));
        const pattern = String(args.pattern).replace(/[\\/:*?"<>|]/g, "-").trim() || "file";
        const extFilter = args.extensionFilter ? String(args.extensionFilter).replace(".", "").toLowerCase() : null;
        const files = fs.readdirSync(dir, { withFileTypes: true })
          .filter(f => f.isFile())
          .filter(f => !extFilter || path.extname(f.name).slice(1).toLowerCase() === extFilter)
          .map(f => f.name)
          .sort();
        files.forEach((name, i) => {
          const ext = path.extname(name);
          fs.renameSync(path.join(dir, name), path.join(dir, `${pattern}-${String(i + 1).padStart(3, "0")}${ext}`));
        });
        return { result: `Renamed ${files.length} files to ${pattern}-001…${pattern}-${String(files.length).padStart(3, "0")}.` };
      }

      case "browseClipboardHistory": {
        const limit = Number(args.limit || 5);
        const recent = clipHistory.slice(-limit).reverse();
        return {
          result: recent.length
            ? recent.map((c, i) => `${i + 1}. (${new Date(c.time).toLocaleTimeString()}) ${c.text.slice(0, 80).replace(/\n/g, " ")}`).join("\n")
            : "Clipboard history is empty so far.",
        };
      }
      case "copyFromClipboardHistory": {
        const idx = Number(args.index || 1);
        const entry = clipHistory.slice(-idx)[0];
        if (!entry) throw new Error(`No clipboard history item #${idx}.`);
        // Base64 payload — slicing after quote-doubling can leave unbalanced
        // quotes, and raw newlines break cmd parsing entirely.
        const b64 = Buffer.from(entry.text.slice(0, 800), "utf8").toString("base64");
        await runCommand(
          `powershell -NoProfile -NonInteractive -Command "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))"`,
          undefined, 8000,
        );
        return { result: `Copied back to clipboard: "${entry.text.slice(0, 60)}"` };
      }

      case "fuzzyFindAndOpen": {
        const q = String(args.query || "").toLowerCase();
        const ext = args.extension ? `.${String(args.extension).replace(/\./g, "")}` : "";
        const roots = ["Desktop", "Downloads", "Documents", "Pictures", "Videos"].map(d => path.join(HOME(), d));
        const tokens = q.split(/\s+/).filter(Boolean);
        const results: { file: string; score: number }[] = [];
        const scan = (dir: string, depth: number): void => {
          if (depth > 4) return;
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              if (!["node_modules", ".git"].includes(e.name)) scan(full, depth + 1);
              continue;
            }
            if (ext && !e.name.toLowerCase().endsWith(ext)) continue;
            const name = e.name.toLowerCase();
            let score = 0;
            for (const t of tokens) if (name.includes(t)) score += t.length * 2;
            if (score > 0) results.push({ file: full, score });
          }
        };
        for (const root of roots) scan(root, 0);
        if (!results.length) return { result: `Couldn't find anything matching "${args.query}" in your common folders.` };
        results.sort((a, b) => b.score - a.score);
        const best = results.slice(0, 3).map(r => r.file);
        await runCommand(`start "" "${best[0].replace(/"/g, "")}"`, undefined, 10000);
        return { result: `Opened ${path.basename(best[0])}${results.length > 1 ? ` (best of ${results.length} matches — others: ${best.slice(1).map(f => path.basename(f)).join(", ")})` : ""}.` };
      }
      case "sleepNow": {
        ctx.clientWs?.send(JSON.stringify({ type: "force_sleep" }));
        return { result: "Going to sleep. Say 'Hey Bella' when you need me." };
      }

      case "moveHud": {
        const where = String(args.where || "").toLowerCase().trim();
        ctx.clientWs?.send(JSON.stringify({ type: "hud_move", where }));
        return { result: `Moving my window ${where}.` };
      }
      case "setHudVisibility": {
        const visible = !!args.visible;
        ctx.clientWs?.send(JSON.stringify({ type: "hud_visibility", visible }));
        return { result: visible ? "I'm back on screen." : "Hiding my window — say 'show yourself' when you need me." };
      }
    }
    throw new Error(`Unknown extras tool: ${name}`);
  },
};

async function freeDiskBytes(drive: string): Promise<number> {
  const r = await runPowerShell(`(Get-PSDrive ${drive.replace(":", "")}).Free`, 10000);
  return parseInt(r.stdout.trim(), 10) || 0;
}
