import express from "express";
import { spawn, exec } from "child_process";
import http from "http";
import path from "path";
import * as os from "os";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type, LiveServerMessage } from "@google/genai";
import dotenv from "dotenv";
import * as fs from "fs";
import { 
  loadMemories, 
  saveMemories, 
  formatSystemInstructionsWithMemories, 
  formatSystemInstructions,
  SessionContinuityContext,
  processConversationSlice 
} from "./server_memory";
import { Memory } from "./src/lib/memoryTypes";
import {
  DATA_DIR,
  dataFile,
  getGeminiApiKey,
  hasGeminiApiKey,
  setGeminiApiKey,
} from "./server_paths";
import { geminiKeyPool } from "./GeminiKeyPoolManager";
import { getProactiveEngine } from "./proactive/ProactiveEngine";
import { computerActionEngine, AppRegistry } from "./computer";
import {
  personalIntelligence,
  contextPermissionManager,
  contextEngine as piContextEngine,
  curiosityEngine,
  recommendationEngine,
  memoryManager as piMemoryManager,
  interactionTiming,
  feedbackEngine,
  ExplainabilityEngine,
  PrivacyController
} from "./personal-intelligence";
import { temporalMemoryManager } from "./temporal-memory";
// BELLA 6.0 capability modules
import {
  bellaDeclarations,
  isBellaTool,
  executeBellaTool,
  registerFullExecutor,
  updateBellaCtx,
  startBellaServices,
  bellaToolCount,
} from "./bella";
import { getActivePersona, resolveVoice, listPersonas, setActivePersona } from "./bella/personas";
import { readJson } from "./bella/util";
import { promptSkillsBlock } from "./bella/skills";
import {
  identifySpeaker,
  filterDeclarationsForGuest,
  isGuestMode,
  markSpeaker,
  getLastSpeaker,
} from "./bella/guardian";
import { noteFrame, setFrameProvider, recorderState } from "./bella/creator";
import { registerLiveSession, unregisterLiveSession, analyzeImage, getLiveSession, getLiveSessionCount } from "./bella/util";
import { recordStep } from "./bella/macros";
import { activityContextBlock } from "./bella/activity";
import { guardianRouter } from "./bella/guardian";
import { phonelinkRouter } from "./bella/phonelink";
import { createPhoneAppRouter, registerPhoneExecutor, startPhoneHttps } from "./bella/phoneapp";
import { facesRouter } from "./bella/faces";
import { loadReminders, describeWhen } from "./bella/scheduler";
import { loadExpenses } from "./bella/comms";

dotenv.config();

// ---------------------------------------------------------------------------
// BELLA V2 — Session Continuity Store
// Maintains conversation context across wake/sleep toggles within the running app
// ---------------------------------------------------------------------------
interface ActiveSessionState {
  sessionId: string;
  activationCount: number;
  dialogueHistory: { role: string; text: string }[];
  lastConnectedAt: number;
  lastDisconnectedAt: number;
  lastVideoFrameTime?: number;
}

const activeSessions = new Map<string, ActiveSessionState>();

/** Newest streamed video frame (base64 JPEG) for live-commentary analysis. */
let latestFrameBase64: string | null = null;

// Periodic session cleanup for sessions inactive for over 24 hours
setInterval(() => {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  for (const [id, session] of activeSessions.entries()) {
    if (now - (session.lastDisconnectedAt || session.lastConnectedAt) > ONE_DAY) {
      activeSessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// BELLA V2 â€” Logging (Feature 7).
// Appends timestamped lines to logs/{commands,startup,errors}.log.
// Never throws; logging failures are swallowed so they can't break the app.
// ---------------------------------------------------------------------------
const LOGS_DIR = path.join(DATA_DIR, "logs");
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { /* already exists */ }

function appendLog(fileName: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFile(path.join(LOGS_DIR, fileName), line, () => {});
  } catch {
    /* logging is best-effort */
  }
}
const logCommand = (m: string) => appendLog("commands.log", m);
const logStartup = (m: string) => appendLog("startup.log", m);
const logError = (m: string) => appendLog("errors.log", m);

// ---------------------------------------------------------------------------
// BELLA Desktop Control Agent â€” HTTP bridge to the Python FastAPI backend.
// ---------------------------------------------------------------------------
const DESKTOP_AGENT_URL = process.env.DESKTOP_AGENT_URL || "http://127.0.0.1:8765";
const agentPort = new URL(DESKTOP_AGENT_URL).port || "8765";
const DESKTOP_AGENT_TIMEOUT = 25_000; // ms

/**
 * The complete set of tool names routed to the Python desktop agent.
 * Kept in sync with desktop_agent/registry.py DESKTOP_TOOL_NAMES.
 */
const DESKTOP_TOOLS: ReadonlySet<string> = new Set([
  // applications / websites / search
  "openApplication", "closeApplication", "openApp", "closeApp", "openWebsite", "openUrl",
  "searchWeb", "searchYouTube", "searchGoogle", "searchGitHub",
  // files
  "createFile", "readFile", "renameFile", "deleteFile", "moveFile", "copyFile", "getFileProperties",
  "openFolder", "listFiles", "searchFiles",
  // pc control (volume + media playback + gated power)
  "volumeUp", "volumeDown", "muteToggle", "setVolume",
  "mediaNextTrack", "mediaPrevTrack", "mediaPlayPause", "mediaStop",
  "skipSong", "nextSong", "previousSong", "playPauseMedia",
  "changeSong", "playSong", "pauseSong", "resumeSong",
  "requestPowerAction", "executePowerAction",
  // windows
  "minimizeWindow", "maximizeWindow", "restoreWindow", "focusWindow", "closeWindow", "switchApplication", "resizeWindow", "moveWindow",
  // typing and keyboard
  "typeText", "pasteClipboard", "copySelected", "getClipboard", "clearClipboard",
  "keyboardPress", "keyboardType", "keyboardHotkey", "pressEnter", "pressKey",
  // browser tabs and navigation
  "previousTab", "nextTab", "browserBack", "browserForward", "newTab", "closeTab",
  // mouse control
  "mouseMove", "mouseClick", "leftClick", "rightClick", "doubleClick", "clickMouse", "mouseDoubleClick", "mouseRightClick", "mouseDrag", "mouseScroll",
  // screenshot / screen reading
  "takeScreenshot", "saveScreenshot", "analyzeScreenshot", "readScreen",
  // browser automation (Playwright — desktop-owned, separate from holographic UI)
  "desktopBrowserOpen", "desktopBrowserNavigate", "desktopBrowserOpenTab",
  "desktopBrowserCloseTab", "desktopBrowserSearch", "desktopBrowserClick",
  "desktopBrowserType", "desktopBrowserFillForm", "desktopBrowserGoBack",
  "desktopBrowserGoForward", "desktopBrowserScroll",
  // coding assistance
  "createPythonFile", "runPythonScript", "createProjectFolder", "writeCodeFile",
  // system information
  "systemInfo", "gpuInfo", "temperatureInfo",
  // brightness control (V2)
  "brightnessUp", "brightnessDown", "setBrightness",
  // Windows auto-start management (V2)
  "enableAutoStart", "disableAutoStart", "getAutoStartStatus",
]);

/**
 * Call the Python desktop agent.  Returns the parsed JSON response.
 * If the agent is unreachable, returns a user-friendly error payload.
 */
/**
 * Whether the desktop agent has been confirmed alive in this process lifetime.
 * If false, callDesktopAgent will probe /health and attempt an auto-spawn.
 */
let desktopAgentVerified = false;
// BELLA 6.0 — the stale-agent upgrade is destructive (kills whatever listens on
// the agent port). Run it at most ONCE per server process so a persistent
// mismatch can't cause a kill/respawn churn on every tool call.
let agentUpgradeAttempted = false;

/**
 * Auto-spawn the Python desktop agent as a detached child process if it is not
 * already listening. Looks for the project's bundled Python interpreter first,
 * falling back to `python` / `python3` on PATH. Runs detached so it survives
 * even if BELLA's node process is killed.
 */
function spawnDesktopAgent(): void {
  const agentEnv = {
    ...process.env,
    BELLA_AGENT_HOST: "127.0.0.1",
    BELLA_AGENT_PORT: agentPort,
  };

  // Development preference: run the SOURCE agent (it tracks this repo's tool
  // set) whenever the sources are present. The frozen exe shipped with older
  // installs lacks newer tools (keyboard/mouse/tabs/media), so in dev we only
  // use it as a last resort.
  const devMain = path.join(process.cwd(), "desktop_agent", "main.py");
  if (fs.existsSync(devMain)) {
    const candidates = [
      process.env.BELLA_PYTHON,
      "python",
      "python3",
    ].filter(Boolean) as string[];
    for (const py of candidates) {
      try {
        require("child_process").execSync(`"${py}" -c "import uvicorn"`, { stdio: "ignore" });
        const child = spawn(py, ["-m", "uvicorn", "desktop_agent.main:app", "--host", "127.0.0.1", "--port", agentPort], {
          cwd: process.cwd(), // repo root so `desktop_agent` is importable as a package
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: agentEnv,
        });
        child.unref();
        logStartup(`AGENT_SPAWN dev-source pid=${child.pid} python=${py}`);
        console.log(`[Desktop Agent] Launched development agent from source (PID ${child.pid}).`);
        return;
      } catch { /* try next candidate */ }
    }
  }

  // Preferred path (packaged app): a PyInstaller-frozen agent exe that embeds
  // its own Python runtime. Set by the Electron main process via BELLA_AGENT_EXE.
  const frozenExe = process.env.BELLA_AGENT_EXE;
  if (frozenExe && fs.existsSync(frozenExe)) {
    try {
      const child = spawn(frozenExe, [], {
        cwd: path.dirname(frozenExe),
        detached: true,
        stdio: "ignore",
        windowsHide: true, // never flash a console window
        env: agentEnv,
      });
      child.unref();
      logStartup(`AGENT_SPAWN frozen exe pid=${child.pid} path=${frozenExe}`);
      console.log(`[Desktop Agent] Launched frozen agent (PID ${child.pid}).`);
      return;
    } catch (e: any) {
      logError(`AGENT_SPAWN_FROZEN_FAILED: ${e?.message || e}`);
      // fall through to the Python path below
    }
  }

  // Development fallback: run the agent from source using a local Python.
  const candidates = [
    process.env.BELLA_PYTHON,
    "C:\\Users\\MSI\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    "python",
    "python3",
  ].filter(Boolean) as string[];
  const py = candidates.find((p) => {
    try {
      require("child_process").execSync(`"${p}" -c "import uvicorn"`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!py) {
    console.warn("[Desktop Agent] No frozen agent and no Python interpreter found; desktop control unavailable.");
    logError("AGENT_SPAWN_NO_RUNTIME: neither BELLA_AGENT_EXE nor Python available");
    return;
  }
  try {
    const child = spawn(
      py,
      ["-m", "uvicorn", "desktop_agent.main:app", "--host", "127.0.0.1", "--port", agentPort],
      { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true, env: agentEnv }
    );
    child.unref();
    logStartup(`AGENT_SPAWN python pid=${child.pid}`);
    console.log(`[Desktop Agent] Auto-spawned via Python (PID ${child.pid}).`);
  } catch (e: any) {
    console.warn(`[Desktop Agent] Auto-spawn failed: ${e?.message || e}`);
    logError(`AGENT_SPAWN_PYTHON_FAILED: ${e?.message || e}`);
  }
}

/**
 * Probe the desktop agent /health endpoint. Returns true if it responds 200.
 */
async function isDesktopAgentAlive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure the desktop agent is running. If not verified yet, probe health; if
 * down, auto-spawn and poll until it is ready (or timeout).
 */
async function ensureDesktopAgent(): Promise<void> {
  if (desktopAgentVerified) return;
  if (await isDesktopAgentAlive()) {
    // BELLA 6.0 — stale-agent upgrade: in development, if the running agent
    // exposes fewer tools than this build declares, replace it with the
    // source-based agent so keyboard/mouse/tabs/media tools actually exist.
    const devMain = path.join(process.cwd(), "desktop_agent", "main.py");
    try {
      const res = await fetch(`${DESKTOP_AGENT_URL}/tools`, { signal: AbortSignal.timeout(4000) });
      const data: any = await res.json();
      const count = Number(data?.tool_count || 0);
      if (!agentUpgradeAttempted && fs.existsSync(devMain) && count > 0 && count < 100) {
        agentUpgradeAttempted = true;
        console.log(`[Desktop Agent] Stale build detected (${count} tools) — upgrading to source agent…`);
        // Kill whatever currently owns the agent port — that covers both the
        // frozen bella-agent.exe and a stray uvicorn/python from an older run.
        await new Promise<void>((resolve) => exec(
          `powershell -NoProfile -NonInteractive -Command "$c = Get-NetTCPConnection -LocalPort ${agentPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
          () => resolve(),
        ));
        await new Promise((r) => setTimeout(r, 800));
        desktopAgentVerified = false;
        spawnDesktopAgent();
        for (let i = 1; i <= 25; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const retry = await fetch(`${DESKTOP_AGENT_URL}/tools`, { signal: AbortSignal.timeout(3000) })
            .then(x => x.json()).catch(() => null);
          if (retry && Number(retry.tool_count || 0) >= 100 && Number(retry.tool_count || 0) > count) {
            desktopAgentVerified = true;
            console.log(`[Desktop Agent] Upgraded — ${retry.tool_count} tools available.`);
            return;
          }
        }
        console.warn("[Desktop Agent] Upgrade incomplete; continuing with available agent.");
      }
    } catch { /* tools endpoint unavailable — keep current agent */ }
    desktopAgentVerified = true;
    console.log("[Desktop Agent] Already running.");
    return;
  }
  console.log("[Desktop Agent] Not detected. Auto-starting...");
  spawnDesktopAgent();
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDesktopAgentAlive()) {
      desktopAgentVerified = true;
      console.log(`[Desktop Agent] Online after ${i}s.`);
      return;
    }
  }
  console.warn("[Desktop Agent] Did not come online within 20s. Desktop control will be unavailable.");
}

function resolveSafePath(filePath: string): string {
  const home = os.homedir();
  if (!filePath || filePath.trim() === "") return path.join(home, "Desktop", "document.txt");

  let p = filePath.trim();
  // Bare known-folder names ("downloads", "Desktop", "documents"…) map to home.
  const KNOWN_FOLDERS: Record<string, string> = {
    desktop: "Desktop", documents: "Documents", docs: "Documents",
    downloads: "Downloads", pictures: "Pictures", music: "Music", videos: "Videos",
  };
  const bare = p.replace(/[\\/]+$/, "").toLowerCase();
  if (KNOWN_FOLDERS[bare]) return path.join(home, KNOWN_FOLDERS[bare]);

  if (p.toLowerCase().startsWith("desktop/") || p.toLowerCase().startsWith("desktop\\")) {
    p = path.join(home, "Desktop", p.substring(8));
  } else if (p.toLowerCase().startsWith("documents/") || p.toLowerCase().startsWith("documents\\")) {
    p = path.join(home, "Documents", p.substring(10));
  } else if (p.toLowerCase().startsWith("downloads/") || p.toLowerCase().startsWith("downloads\\")) {
    p = path.join(home, "Downloads", p.substring(10));
  } else if (p.startsWith("~")) {
    p = path.join(home, p.substring(1));
  } else if (/^[a-zA-Z]:[^\\/]/.test(p)) {
    // Drive-relative form ("C:notes.txt") would produce an invalid Windows path
    // when joined — treat it as a plain filename on the Desktop.
    p = path.join(home, "Desktop", p.substring(2));
  } else if (!path.isAbsolute(p)) {
    p = path.join(home, "Desktop", p);
  }
  return p;
}

const KNOWN_WEB_SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  gmail: "https://mail.google.com",
  google: "https://www.google.com",
  github: "https://github.com",
  chatgpt: "https://chatgpt.com",
  openai: "https://chatgpt.com",
  claude: "https://claude.ai",
  wikipedia: "https://www.wikipedia.org",
  wiki: "https://www.wikipedia.org",
  facebook: "https://www.facebook.com",
  fb: "https://www.facebook.com",
  instagram: "https://www.instagram.com",
  insta: "https://www.instagram.com",
  twitter: "https://x.com",
  x: "https://x.com",
  reddit: "https://www.reddit.com",
  linkedin: "https://www.linkedin.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.com",
  spotify: "https://open.spotify.com",
  twitch: "https://www.twitch.tv",
  tiktok: "https://www.tiktok.com",
  pinterest: "https://www.pinterest.com",
  quora: "https://www.quora.com",
  medium: "https://medium.com",
  canva: "https://www.canva.com",
  figma: "https://www.figma.com",
  notion: "https://www.notion.so",
  discord: "https://discord.com/app",
  stackoverflow: "https://stackoverflow.com",
  "stack overflow": "https://stackoverflow.com",
  huggingface: "https://huggingface.co",
  maps: "https://maps.google.com",
  "google maps": "https://maps.google.com",
  drive: "https://drive.google.com",
  "google drive": "https://drive.google.com",
  photos: "https://photos.google.com",
  translate: "https://translate.google.com",
  weather: "https://weather.com",
  zoom: "https://zoom.us",
};

function resolveWebUrl(raw: string): string {
  if (!raw || !raw.trim()) return "https://www.google.com";
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (KNOWN_WEB_SITES[lower]) {
    return KNOWN_WEB_SITES[lower];
  }

  // If already a valid URL
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // If looks like a domain name (e.g. facebook.com, en.wikipedia.org)
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // If single word without spaces (e.g. "wikipedia", "facebook", "espn")
  if (/^[a-zA-Z0-9-]+$/i.test(trimmed)) {
    return `https://www.${trimmed}.com`;
  }

  // Otherwise, treat as search query on Google
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function openUrlInDefaultBrowser(url: string): void {
  const safeUrl = resolveWebUrl(url);
  console.log(`[Native OS] Launching in default browser: ${safeUrl}`);
  if (process.platform === "win32") {
    const escaped = safeUrl.replace(/'/g, "''");
    exec(`powershell -NoProfile -NonInteractive -Command "Start-Process '${escaped}'"`, (err) => {
      if (err) {
        console.warn("[Native OS] PowerShell launch failed, fallback to cmd start:", err);
        const cmdEscaped = safeUrl.replace(/"/g, '""');
        exec(`start "" "${cmdEscaped}"`);
      }
    });
  } else if (process.platform === "darwin") {
    exec(`open "${safeUrl}"`);
  } else {
    exec(`xdg-open "${safeUrl}"`);
  }
}

/** Locate an installed desktop app's executable (App Paths registry + PATH). */
function findInstalledExe(appRaw: string): string | null {
  const aliases: Record<string, string> = {
    vscode: "code", "vs code": "code", "visual studio code": "code",
    "google chrome": "chrome", edge: "msedge", "microsoft edge": "msedge",
    "brave browser": "brave",
  };
  const name = (aliases[appRaw] || appRaw).replace(/\s+/g, "").toLowerCase();
  const exeName = `${name}.exe`;
  const hives = [
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
  ];
  for (const hive of hives) {
    try {
      const out = require("child_process").execSync(`reg query "${hive}\\${exeName}" /ve`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"],
      });
      const m = String(out).match(/(?:REG_SZ|REG_EXPAND_SZ)\s+(.+)\s*$/i);
      const p = m?.[1]?.trim();
      if (p && fs.existsSync(p)) return p;
    } catch { /* not registered */ }
  }
  try {
    const out = require("child_process").execSync(`where ${exeName}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const first = String(out).trim().split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {}
  return null;
}

function launchAppNative(appName: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const raw = appName.trim().toLowerCase();
    console.log(`[Native OS] Attempting to open application: ${appName}`);

    // If appName is an existing local file or absolute path, open it directly with default Windows program
    if (fs.existsSync(appName) || /^[a-zA-Z]:[/\\]/.test(appName) || /\.(png|jpg|jpeg|pdf|txt|docx|xlsx|csv|mp3|mp4|wav)$/i.test(appName)) {
      console.log(`[Native OS] Opening file/path with default shell: ${appName}`);
      const esc = appName.replace(/'/g, "''");
      exec(`powershell -NoProfile -NonInteractive -Command "Start-Process '${esc}'"`, (err) => {
        if (!err) return resolve({ ok: true, result: { status: "opened", file: appName } });
        // PowerShell failed — never leave the promise pending.
        exec(`start "" "${appName.replace(/"/g, "")}"`, () => {});
        return resolve({ ok: true, result: { status: "opened", file: appName, method: "cmd_start" } });
      });
      return;
    }

    // BELLA 6.0 — prefer the INSTALLED desktop app over its website twin.
    const installedExe = findInstalledExe(raw);
    if (installedExe) {
      console.log(`[Native OS] Found installed app executable: ${installedExe}`);
      exec(`start "" "${installedExe}"`);
      return resolve({ ok: true, result: { status: "opened", app: appName, exe: installedExe } });
    }

    const uriSchemes: Record<string, string> = {
      notion: "notion://",
      spotify: "spotify://",
      discord: "discord://",
      slack: "slack://",
      vscode: "vscode://",
      code: "vscode://",
      calculator: "calculator:",
      settings: "ms-settings:",
      whatsapp: "whatsapp:",
      telegram: "tg://",
      obsidian: "obsidian://",
      store: "ms-windows-store:",
      "microsoft store": "ms-windows-store:",
    };

    // Apps whose desktop client usually registers a URI handler — try the real
    // app BEFORE routing to the website twin, and fall back to the web if the
    // protocol isn't registered.
    if (uriSchemes[raw]) {
      exec(`powershell -NoProfile -NonInteractive -Command "try { Start-Process '${uriSchemes[raw]}' -ErrorAction Stop; exit 0 } catch { exit 1 }"`, (err) => {
        if (!err) {
          console.log(`[Native OS] Launched ${appName} via URI scheme: ${uriSchemes[raw]}`);
          return resolve({ ok: true, result: { status: "launched", app: appName, method: "uri" } });
        }
        if (KNOWN_WEB_SITES[raw]) {
          const webUrl = KNOWN_WEB_SITES[raw];
          openUrlInDefaultBrowser(webUrl);
          return resolve({ ok: true, result: { status: "launched", app: appName, method: "web", url: webUrl } });
        }
        return resolve({ ok: false, error: `Couldn't launch ${appName}.` });
      });
      return;
    }

    // If it's a known web app/site and not a native-only tool, launch directly in browser
    if (KNOWN_WEB_SITES[raw]) {
      const webUrl = KNOWN_WEB_SITES[raw];
      console.log(`[Native OS] Routing web app '${appName}' to default browser: ${webUrl}`);
      openUrlInDefaultBrowser(webUrl);
      return resolve({ ok: true, result: { status: "launched", app: appName, method: "web", url: webUrl } });
    }

    const msEdgeAliases: Record<string, string> = {
      edge: "microsoft-edge:http://", "microsoft edge": "microsoft-edge:http://", msedge: "microsoft-edge:http://",
    };

    if (msEdgeAliases[raw]) {
      exec(`powershell -NoProfile -NonInteractive -Command "try { Start-Process '${msEdgeAliases[raw]}' -ErrorAction Stop; exit 0 } catch { exit 1 }"`, (err) => {
        if (!err) return resolve({ ok: true, result: { status: "launched", app: appName, method: "uri" } });
        openUrlInDefaultBrowser("http://");
        return resolve({ ok: true, result: { status: "launched", app: appName, method: "web", url: "http://" } });
      });
      return;
    }

    const psScript = `
$appName = '${raw.replace(/'/g, "''")}';
$wshell = New-Object -ComObject WScript.Shell;

try {
  $activated = $wshell.AppActivate($appName);
  if ($activated) {
    Write-Output "ACTIVATED_EXISTING";
    exit 0;
  }
} catch {}

$knownExe = @{
  "notion" = "$env:LOCALAPPDATA\\Programs\\Notion\\Notion.exe";
  "spotify" = "$env:APPDATA\\Spotify\\Spotify.exe";
  "discord" = "$env:LOCALAPPDATA\\Discord\\Update.exe --processStart Discord.exe";
  "chrome" = "chrome";
  "google chrome" = "chrome";
  "brave" = "brave";
  "edge" = "msedge";
  "microsoft edge" = "msedge";
  "msedge" = "msedge";
  "code" = "code";
  "vscode" = "code";
  "vs code" = "code";
  "notepad" = "notepad";
  "calc" = "calc";
  "calculator" = "calc";
  "paint" = "mspaint";
  "explorer" = "explorer";
  "file explorer" = "explorer";
  "taskmgr" = "taskmgr";
  "task manager" = "taskmgr";
  "antigravity" = "$env:LOCALAPPDATA\\Programs\\Antigravity IDE\\Antigravity IDE.exe";
  "antigravity ide" = "$env:LOCALAPPDATA\\Programs\\Antigravity IDE\\Antigravity IDE.exe";
  "anitgravity" = "$env:LOCALAPPDATA\\Programs\\Antigravity IDE\\Antigravity IDE.exe";
  "whatsapp" = "whatsapp:";
  "cmd" = "cmd";
  "terminal" = "wt";
  "powershell" = "powershell";
};

if ($knownExe.ContainsKey($appName)) {
  $target = $knownExe[$appName];
  try {
    Start-Process $target -ErrorAction Stop;
    Write-Output "LAUNCHED_KNOWN";
    exit 0;
  } catch {}
}

$shortcuts = Get-ChildItem -Path @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs") -Filter "*$appName*.lnk" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1;
if ($shortcuts) {
  try {
    Start-Process $shortcuts.FullName -ErrorAction Stop;
    Write-Output "LAUNCHED_SHORTCUT";
    exit 0;
  } catch {}
}

$exes = Get-ChildItem -Path @("$env:LOCALAPPDATA\\Programs", "$env:ProgramFiles", "\${env:ProgramFiles(x86)}", "$env:LOCALAPPDATA") -Filter "*$appName*.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "unins|helper|crash|update" } | Select-Object -First 1;
if ($exes) {
  try {
    Start-Process $exes.FullName -ErrorAction Stop;
    Write-Output "LAUNCHED_EXE";
    exit 0;
  } catch {}
}

try {
  Start-Process $appName -ErrorAction Stop;
  Write-Output "LAUNCHED_DIRECT";
  exit 0;
} catch {
  Write-Error $_.Exception.Message;
  exit 1;
}
`;

    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[Native OS] Local app not found for '${appName}', opening in default browser:`, stderr || err.message);
        const webUrl = resolveWebUrl(appName);
        openUrlInDefaultBrowser(webUrl);
        return resolve({ ok: true, result: { status: "launched", app: appName, method: "browser_fallback", url: webUrl } });
      }
      console.log(`[Native OS] Launched ${appName}:`, stdout.trim());
      resolve({ ok: true, result: { status: "launched", app: appName, detail: stdout.trim() } });
    });
  });
}

function closeAppNative(appName: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const raw = appName.trim().toLowerCase();
    console.log(`[Native OS] Closing application: ${appName}`);

    const knownImages: Record<string, string[]> = {
      edge: ["msedge.exe", "msedge"],
      "microsoft edge": ["msedge.exe", "msedge"],
      msedge: ["msedge.exe", "msedge"],
      settings: ["SystemSettings.exe", "SystemSettings"],
      "windows settings": ["SystemSettings.exe", "SystemSettings"],
      vlc: ["vlc.exe", "vlc"],
      "vlc media player": ["vlc.exe", "vlc"],
      "media player": ["Microsoft.Media.Player.exe", "wmplayer.exe", "vlc.exe"],
      "windows media player": ["wmplayer.exe"],
      notepad: ["notepad.exe", "notepad"],
      calc: ["CalculatorApp.exe", "Calculator.exe", "calc.exe"],
      calculator: ["CalculatorApp.exe", "Calculator.exe", "calc.exe"],
      notion: ["Notion.exe", "Notion"],
      spotify: ["Spotify.exe", "Spotify"],
      discord: ["Discord.exe", "Discord"],
      chrome: ["chrome.exe", "chrome"],
      "google chrome": ["chrome.exe", "chrome"],
      brave: ["brave.exe", "brave"],
      firefox: ["firefox.exe", "firefox"],
      "mozilla firefox": ["firefox.exe", "firefox"],
      code: ["Code.exe", "Code"],
      vscode: ["Code.exe", "Code"],
      "vs code": ["Code.exe", "Code"],
      "visual studio code": ["Code.exe", "Code"],
      paint: ["mspaint.exe", "mspaint", "PaintApp.exe"],
      taskmgr: ["Taskmgr.exe", "Taskmgr"],
      "task manager": ["Taskmgr.exe", "Taskmgr"],
      cmd: ["cmd.exe", "cmd"],
      powershell: ["powershell.exe", "powershell", "pwsh.exe"],
      terminal: ["WindowsTerminal.exe", "WindowsTerminal"],
      "windows terminal": ["WindowsTerminal.exe", "WindowsTerminal"],
      whatsapp: ["WhatsApp.Root.exe", "WhatsApp.exe", "WhatsApp"],
      antigravity: ["Antigravity IDE.exe", "Antigravity IDE", "Antigravity.exe", "Antigravity"],
      "antigravity ide": ["Antigravity IDE.exe", "Antigravity IDE", "Antigravity.exe", "Antigravity"],
      anitgravity: ["Antigravity IDE.exe", "Antigravity IDE", "Antigravity.exe", "Antigravity"],
      telegram: ["Telegram.exe", "Telegram"],
      obsidian: ["Obsidian.exe", "Obsidian"],
      word: ["WINWORD.EXE", "WINWORD", "winword.exe"],
      "microsoft word": ["WINWORD.EXE", "WINWORD", "winword.exe"],
      excel: ["EXCEL.EXE", "EXCEL", "excel.exe"],
      "microsoft excel": ["EXCEL.EXE", "EXCEL", "excel.exe"],
      powerpoint: ["POWERPNT.EXE", "POWERPNT", "powerpnt.exe"],
      "microsoft powerpoint": ["POWERPNT.EXE", "POWERPNT", "powerpnt.exe"],
      steam: ["steam.exe", "steam"],
      slack: ["slack.exe", "slack"],
    };

    const targetList = knownImages[raw] || [raw, `${raw}.exe`, `${raw.replace(/\s+/g, "")}.exe`];
    for (const img of targetList) {
      exec(`taskkill /IM "${img}" /F /T 2>nul`);
    }

    const safeName = raw.replace(/'/g, "''").replace(/[^a-zA-Z0-9_\-]/g, "");
    const psScript = `
$q = '${safeName}';
if ($q.Length -gt 1) {
  if ($q.Length -ge 4) {
    Get-Process | Where-Object { $_.ProcessName -like "*$q*" -or ($_.MainWindowTitle -and $_.MainWindowTitle -like "*$q*") } | Stop-Process -Force -ErrorAction SilentlyContinue;
  } else {
    Get-Process | Where-Object { $_.ProcessName -like "*$q*" } | Stop-Process -Force -ErrorAction SilentlyContinue;
  }
}
`;
    exec(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, " ")}"`, () => {
      resolve({ ok: true, result: { status: "closed", app: appName } });
    });
  });
}

function typeTextNative(text: string): Promise<{ ok: boolean; result?: unknown }> {
  return new Promise((resolve) => {
    console.log(`[Native OS] Typing text into active window (${text.length} chars)`);
    // Base64 keeps arbitrary user text (quotes, here-string terminators, newlines)
    // from being interpreted by PowerShell.
    const b64text = Buffer.from(text, "utf8").toString("base64");
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms;
$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64text}'));
Set-Clipboard -Value $t;
Start-Sleep -Milliseconds 150;
[System.Windows.Forms.SendKeys]::SendWait('^v');
`;
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, (err) => {
      if (err) console.warn("[Native OS] Typing text failed:", err);
      resolve({ ok: true, result: { status: "typed", length: text.length } });
    });
  });
}

function getFilePropertiesNative(filePath: string): { ok: boolean; result?: unknown; error?: string } {
  const targetPath = resolveSafePath(filePath);
  if (!fs.existsSync(targetPath)) {
    return { ok: false, error: `File not found: ${targetPath}` };
  }
  const stat = fs.statSync(targetPath);
  const ext = path.extname(targetPath);
  const sizeBytes = stat.size;
  const sizeFormatted = sizeBytes < 1024 ? `${sizeBytes} B` : sizeBytes < 1048576 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${(sizeBytes / 1048576).toFixed(2)} MB`;

  return {
    ok: true,
    result: {
      name: path.basename(targetPath),
      path: targetPath,
      extension: ext || "none",
      isDirectory: stat.isDirectory(),
      size: sizeFormatted,
      sizeBytes: stat.size,
      created: stat.birthtime.toLocaleString(),
      modified: stat.mtime.toLocaleString(),
      accessed: stat.atime.toLocaleString(),
    }
  };
}

function copyFileNative(src: string, dest: string): { ok: boolean; result?: unknown; error?: string } {
  const s = resolveSafePath(src);
  let d = resolveSafePath(dest);
  if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
    d = path.join(d, path.basename(s));
  }
  if (!fs.existsSync(s)) return { ok: false, error: `Source file does not exist: ${s}` };
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
  console.log(`[Native OS] Copied ${s} -> ${d}`);
  return { ok: true, result: { status: "copied", from: s, to: d } };
}

function moveFileNative(src: string, dest: string): { ok: boolean; result?: unknown; error?: string } {
  const s = resolveSafePath(src);
  let d = resolveSafePath(dest);
  if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
    d = path.join(d, path.basename(s));
  }
  if (!fs.existsSync(s)) return { ok: false, error: `Source file does not exist: ${s}` };
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.renameSync(s, d);
  console.log(`[Native OS] Moved ${s} -> ${d}`);
  return { ok: true, result: { status: "moved", from: s, to: d } };
}

function searchFilesNative(query: string, folderPath?: string): { ok: boolean; result?: unknown } {
  const root = resolveSafePath(folderPath || "Desktop");
  const results: Array<{ name: string; path: string; size: string }> = [];

  function walk(dir: string, depth = 0) {
    if (depth > 4 || results.length >= 25) return;
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.name.toLowerCase().includes(query.toLowerCase())) {
          const sz = item.isFile() ? `${(fs.statSync(fullPath).size / 1024).toFixed(1)} KB` : "directory";
          results.push({ name: item.name, path: fullPath, size: sz });
        }
        if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules") {
          walk(fullPath, depth + 1);
        }
      }
    } catch {}
  }

  walk(root);
  if (results.length < 5 && (!folderPath || folderPath === "Desktop")) {
    walk(path.join(os.homedir(), "Downloads"));
    walk(path.join(os.homedir(), "Documents"));
  }

  return { ok: true, result: { matches: results, count: results.length } };
}

async function executeNativeFallback(
  tool: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; result?: unknown; error?: string } | null> {
  try {
    // ── Application Launching & Closing ──
    if (tool === "openApplication" || tool === "openApp") {
      const appName = (args.name || args.app || args.application || "") as string;
      return await launchAppNative(appName);
    }

    if (tool === "closeApplication" || tool === "closeApp") {
      const appName = (args.name || args.app || args.application || "") as string;
      return await closeAppNative(appName);
    }

    // ── Typing text into active application ──
    if (tool === "typeText" || tool === "pasteClipboard") {
      const text = (args.text || args.content || "") as string;
      if (tool === "pasteClipboard" && !text) {
        // No explicit text → paste whatever is ALREADY on the clipboard
        // (never wipe the user's clipboard with an empty overwrite).
        exec(`powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait('^v')"`);
        return { ok: true, result: { status: "pasted", source: "clipboard" } };
      }
      if (!text) return { ok: false, error: "No text provided to type." };
      return await typeTextNative(text);
    }

    // ── File Properties & Inspection ──
    if (tool === "getFileProperties" || tool === "fileProperties") {
      const filePath = (args.path || args.file || "") as string;
      return getFilePropertiesNative(filePath);
    }

    // ── Copy & Move Files ──
    if (tool === "copyFile") {
      const src = (args.source || args.path || args.from || "") as string;
      const dest = (args.destination || args.target || args.to || "") as string;
      return copyFileNative(src, dest);
    }

    if (tool === "moveFile" || tool === "renameFile") {
      const src = (args.source || args.path || args.from || "") as string;
      const dest = (args.destination || args.target || args.to || args.new_name || "") as string;
      return moveFileNative(src, dest);
    }

    // ── Search & List Files ──
    if (tool === "searchFiles" || tool === "listFiles") {
      const q = (args.query || args.name || args.pattern || "") as string;
      const folder = (args.folder || args.path || "") as string;
      return searchFilesNative(q, folder);
    }

    // ── File creation (emails, notes, code, documents) ──
    if (tool === "createFile" || tool === "writeCodeFile" || tool === "createPythonFile") {
      const rawPath = (args.path || args.filename || args.name || "notes.txt") as string;
      const content = (args.content || "") as string;
      const targetPath = resolveSafePath(rawPath);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, { encoding: "utf-8" });
      console.log(`[Native OS] Created text file: ${targetPath} (${content.length} characters)`);

      // Open the created file for the user to view in Notepad
      if (process.platform === "win32") {
        exec(`powershell -NoProfile -NonInteractive -Command "Start-Process '${targetPath.replace(/'/g, "''")}'"`);
      }
      return { ok: true, result: { status: "created", path: targetPath, size: content.length } };
    }

    if (tool === "readFile") {
      const rawPath = (args.path || "") as string;
      const targetPath = resolveSafePath(rawPath);
      if (fs.existsSync(targetPath)) {
        const text = fs.readFileSync(targetPath, { encoding: "utf-8" });
        return { ok: true, result: { text: text.substring(0, 8000), path: targetPath } };
      }
      return { ok: false, error: `File not found: ${targetPath}` };
    }

    if (tool === "deleteFile") {
      const rawPath = (args.path || "") as string;
      const targetPath = resolveSafePath(rawPath);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        return { ok: true, result: { status: "deleted", path: targetPath } };
      }
      return { ok: false, error: `File not found: ${targetPath}` };
    }

    if (tool === "searchYouTube") {
      const q = (args.query || "") as string;
      (async () => {
        try {
          const searchRes = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/youtube-search?q=${encodeURIComponent(q)}`);
          if (searchRes.ok) {
            const data = await searchRes.json();
            const firstId = data.results?.[0]?.videoId;
            if (firstId) {
              const directWatchUrl = `https://www.youtube.com/watch?v=${firstId}`;
              openUrlInDefaultBrowser(directWatchUrl);
              return;
            }
          }
        } catch {}
        openUrlInDefaultBrowser(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
      })();
      return { ok: true, result: { status: "opened", query: q } };
    }

    if (tool === "openWebsite" || tool === "openUrl") {
      const raw = (args.url || args.site || args.name || args.query || args.app || args.website || "") as string;
      const target = resolveWebUrl(raw);
      openUrlInDefaultBrowser(target);
      return { ok: true, result: { status: "opened", url: target, raw } };
    }

    if (tool === "searchGoogle" || tool === "searchWeb") {
      const q = (args.query || "") as string;
      const engine = (args.engine || "google") as string;
      let target = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      if (engine === "youtube") target = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      else if (engine === "github") target = `https://github.com/search?q=${encodeURIComponent(q)}`;
      else if (engine === "duckduckgo") target = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
      openUrlInDefaultBrowser(target);
      return { ok: true, result: { status: "opened", query: q, url: target } };
    }

    if (tool === "searchGitHub") {
      const q = (args.query || "") as string;
      const target = `https://github.com/search?q=${encodeURIComponent(q)}`;
      openUrlInDefaultBrowser(target);
      return { ok: true, result: { status: "opened", query: q, url: target } };
    }

    if (tool === "openFolder") {
      const folder = resolveSafePath((args.path || args.folder || "Desktop") as string);
      exec(`explorer "${folder}"`);
      return { ok: true, result: { status: "opened", path: folder } };
    }

    // ── Volume & Mute control fallback ──
    if (tool === "volumeUp") {
      const amount = args.amount !== undefined ? Number(args.amount) : 0.1;
      const steps = Math.max(1, Math.min(25, Math.round(amount > 1 ? amount / 2 : amount * 50)));
      exec(`powershell -NoProfile -NonInteractive -Command "1..${steps} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`);
      return { ok: true, result: { status: "success", result: "Volume increased." } };
    }
    if (tool === "volumeDown") {
      const amount = args.amount !== undefined ? Number(args.amount) : 0.1;
      const steps = Math.max(1, Math.min(25, Math.round(amount > 1 ? amount / 2 : amount * 50)));
      exec(`powershell -NoProfile -NonInteractive -Command "1..${steps} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }"`);
      return { ok: true, result: { status: "success", result: "Volume decreased." } };
    }
    if (tool === "muteToggle") {
      exec(`powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`);
      return { ok: true, result: { status: "success", result: "Mute toggled." } };
    }
    if (tool === "setVolume") {
      const pct = Math.max(0, Math.min(100, Math.round(Number(args.percent ?? args.level ?? 50))));
      const steps = Math.round(pct / 2);
      exec(`powershell -NoProfile -NonInteractive -Command "1..50 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }; 1..${steps} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`);
      return { ok: true, result: { status: "success", volume: pct, result: `Volume set to ${pct}%.` } };
    }

    // ── Keyboard / tabs / media-key fallbacks (WScript SendKeys + VK codes) ──
    // These keep core control working even when the desktop agent is the old
    // frozen build without keyboard tools.
    const sendKeysPs = (keys: string) =>
      exec(`powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject WScript.Shell).SendKeys('${keys.replace(/'/g, "''")}')"`, (err) => {
        if (err) console.warn(`[Native OS] SendKeys failed for '${keys}':`, err.message);
      });
    const vkKeyPs = (vk: number) =>
      exec(`powershell -NoProfile -NonInteractive -Command "Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern void keybd_event(byte b,byte s,uint f,int e);' -Name K -Namespace W; [W.K]::keybd_event(${vk},0,0,0); Start-Sleep -Milliseconds 60; [W.K]::keybd_event(${vk},0,2,0)"`, (err) => {
        if (err) console.warn(`[Native OS] keybd_event failed for VK ${vk}:`, err.message);
      });

    if (tool === "pressEnter") {
      sendKeysPs("{ENTER}");
      return { ok: true, result: { status: "success", result: "Pressed Enter." } };
    }
    if (tool === "pressKey") {
      const map: Record<string, string> = {
        enter: "{ENTER}", escape: "{ESC}", esc: "{ESC}", tab: "{TAB}", space: " ", spacebar: " ",
        backspace: "{BACKSPACE}", delete: "{DELETE}", del: "{DELETE}",
        up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
        arrowup: "{UP}", arrowdown: "{DOWN}", arrowleft: "{LEFT}", arrowright: "{RIGHT}",
        home: "{HOME}", end: "{END}",
        pageup: "{PGUP}", pagedown: "{PGDN}", pgup: "{PGUP}", pgdn: "{PGDN}",
        insert: "{INS}", printscreen: "{PRTSC}",
        capslock: "{CAPSLOCK}", numlock: "{NUMLOCK}", scrolllock: "{SCROLLLOCK}",
        f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f6: "{F6}",
        f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
      };
      const k = String(args.key || args.name || "").toLowerCase().trim();
      const seq = map[k] ?? (k.length === 1 ? k.toUpperCase() : "");
      if (!seq) {
        return { ok: false, error: `Unsupported key: ${args.key}` };
      }
      sendKeysPs(seq);
      return { ok: true, result: { status: "success", result: `Pressed ${k}.` } };
    }
    if (tool === "keyboardHotkey" || tool === "keyboardShortcut") {
      // keys like "ctrl+v", "ctrl shift tab", "win+d"
      const raw = String(args.keys || args.hotkey || "").toLowerCase();
      let seq = raw.split(/[\s+]+/).filter(Boolean).map(k => {
        switch (k) {
          case "ctrl": case "control": return "^";
          case "shift": return "+";
          case "alt": return "%";
          case "win": case "windows": return "#";
          case "enter": return "{ENTER}";
          case "escape": case "esc": return "{ESC}";
          case "tab": return "{TAB}";
          case "pageup": case "pgup": return "{PGUP}";
          case "pagedown": case "pgdn": return "{PGDN}";
          default:
            return k.length === 1 ? k.toUpperCase() : `{${k.toUpperCase()}}`;
        }
      }).join("");
      if (!seq) {
        return { ok: false, error: `Unrecognized hotkey: ${raw}` };
      }
      sendKeysPs(seq);
      return { ok: true, result: { status: "success", result: `Sent ${raw}.` } };
    }
    if (tool === "newTab") { sendKeysPs("^t"); return { ok: true, result: { status: "success", result: "New tab opened." } }; }
    if (tool === "closeTab") { sendKeysPs("^w"); return { ok: true, result: { status: "success", result: "Tab closed." } }; }
    if (tool === "nextTab") { sendKeysPs("^{TAB}"); return { ok: true, result: { status: "success", result: "Switched to next tab." } }; }
    if (tool === "previousTab") { sendKeysPs("^+{TAB}"); return { ok: true, result: { status: "success", result: "Switched to previous tab." } }; }
    if (tool === "browserBack") { sendKeysPs("%{LEFT}"); return { ok: true, result: { status: "success", result: "Navigated back." } }; }
    if (tool === "browserForward") { sendKeysPs("%{RIGHT}"); return { ok: true, result: { status: "success", result: "Navigated forward." } }; }
    if (tool === "mediaNextTrack" || tool === "nextSong" || tool === "skipSong") { vkKeyPs(0xB6); return { ok: true, result: { status: "success", result: "Next track." } }; }
    if (tool === "mediaPrevTrack" || tool === "previousSong") { vkKeyPs(0xB5); return { ok: true, result: { status: "success", result: "Previous track." } }; }
    if (tool === "mediaPlayPause" || tool === "playPauseMedia" || tool === "playSong" || tool === "pauseSong" || tool === "resumeSong") { vkKeyPs(0xB3); return { ok: true, result: { status: "success", result: "Play/pause toggled." } }; }
    if (tool === "mediaStop") { vkKeyPs(0xB4); return { ok: true, result: { status: "success", result: "Playback stopped." } }; }

    // ── Mouse fallbacks (user32 mouse_event / SetCursorPos) ──
    if (["leftClick", "rightClick", "doubleClick", "mouseDoubleClick", "mouseRightClick", "mouseScroll", "mouseMove"].includes(tool)) {
      const mousePs = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);}';
`;
      const click = (fDown: number, fUp: number) => `[M]::mouse_event(${fDown},0,0,0,0); Start-Sleep -Milliseconds 40; [M]::mouse_event(${fUp},0,0,0,0);`;
      const hasXY = args.x !== undefined && args.y !== undefined && Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y));
      const moveTo = hasXY ? `[M]::SetCursorPos(${Math.round(Number(args.x))},${Math.round(Number(args.y))}); Start-Sleep -Milliseconds 60;` : "";
      let body = "";
      if (tool === "leftClick") body = `${moveTo} ${click(2, 4)}`;
      else if (tool === "doubleClick" || tool === "mouseDoubleClick") body = `${moveTo} ${click(2, 4)} Start-Sleep -Milliseconds 60; ${click(2, 4)}`;
      else if (tool === "rightClick" || tool === "mouseRightClick") body = `${moveTo} ${click(8, 16)}`;
      else if (tool === "mouseScroll") {
        // Accept either wheel notches ("3") or pixel-ish units ("300") from the model.
        let amount = Number(args.amount || 3);
        if (!Number.isFinite(amount) || amount <= 0) amount = 3;
        if (amount > 30) amount = amount / 120;
        const clicks = Math.max(1, Math.min(15, Math.round(amount)));
        const dir = String(args.direction || "down").toLowerCase() === "up" ? 1 : -1;
        body = `for($i=0;$i -lt ${clicks};$i++){ [M]::mouse_event(0x800,0,0,${dir * 120},0); Start-Sleep -Milliseconds 50 }`;
      } else if (tool === "mouseMove") {
        body = `[M]::SetCursorPos(${Number(args.x ?? 640)},${Number(args.y ?? 360)});`;
      }
      await new Promise<void>((resolve) => exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(mousePs + body, "utf16le").toString("base64")}`,
        (err) => resolve(),
      ));
      return { ok: true, result: { status: "success", result: `${tool} done.` } };
    }

    // ── Screenshot fallback ──
    if (tool === "saveScreenshot" || tool === "takeScreenshot") {
      const rawName = ((args.name || args.filename || "") as string).trim().replace(/\.png$/i, "").replace(/[<>:"/\\|?*]/g, "_");
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const filename = rawName ? `${rawName}.png` : `screenshot-${stamp}.png`;
      const downloadsDir = path.join(os.homedir(), "Downloads");
      const outPath = path.join(downloadsDir, filename);

      const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${outPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
`;
      const b64 = Buffer.from(ps, "utf16le").toString("base64");
      await new Promise<void>((resolve) => {
        exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`, () => resolve());
      });
      if (!fs.existsSync(outPath)) {
        return { ok: false, error: "Screenshot capture failed — file was not created." };
      }
      return { ok: true, result: { status: "saved", filename, path: outPath, result: `Screenshot '${filename}' saved to Downloads folder (${outPath}).` } };
    }
  } catch (e: any) {
    console.error(`[Native OS] Error executing fallback for ${tool}:`, e);
  }
  return null;
}

const DIRECT_NATIVE_TOOLS = new Set([
  "openApplication", "closeApplication", "openApp", "closeApp",
  "saveScreenshot", "takeScreenshot",
  "createFile", "writeCodeFile", "createPythonFile", "readFile", "deleteFile",
  "copyFile", "moveFile", "renameFile", "searchFiles", "listFiles",
  "typeText", "pasteClipboard", "getFileProperties", "fileProperties",
  "searchYouTube", "openWebsite", "openUrl", "searchGoogle", "searchWeb", "searchGitHub", "openFolder",
  // BELLA 6.0 — native keyboard/mouse/tabs/media fallbacks (old-agent-proof)
  "pressEnter", "pressKey", "keyboardHotkey", "keyboardShortcut",
  "newTab", "closeTab", "nextTab", "previousTab", "browserBack", "browserForward",
  "leftClick", "rightClick", "doubleClick", "mouseDoubleClick", "mouseRightClick",
  "mouseScroll", "mouseMove",
  "mediaNextTrack", "mediaPrevTrack", "mediaPlayPause", "mediaStop",
  "nextSong", "previousSong", "skipSong", "playPauseMedia", "playSong", "pauseSong", "resumeSong",
]);

const recentToolCalls = new Map<string, { time: number; result: { ok: boolean; result?: unknown; error?: string } }>();

async function callDesktopAgent(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  // Prevent duplicate execution if the exact same tool call was triggered within 1500ms.
  // Stateful tools (volume/media/scroll/clicks) are exempt — repeating them is the point.
  const STATEFUL = new Set([
    "volumeUp", "volumeDown", "setVolume", "muteVolume", "unmuteVolume", "toggleMute",
    "mediaNextTrack", "mediaPrevTrack", "nextSong", "previousSong", "skipSong",
    "mediaPlayPause", "playPauseMedia", "playSong", "pauseSong", "resumeSong", "mediaStop",
    "mouseScroll", "leftClick", "rightClick", "doubleClick",
    "pressEnter", "pressKey", "keyboardHotkey", "keyboardShortcut", "typeText", "pasteClipboard",
  ]);
  const debounced = !STATEFUL.has(tool);
  const callKey = `${tool}:${JSON.stringify(args || {})}`;
  const now = Date.now();
  if (debounced) {
    const recent = recentToolCalls.get(callKey);
    if (recent && recent.result.ok !== false && now - recent.time < 1500) {
      console.log(`[Desktop Agent] Debounced duplicate tool execution: ${tool}`);
      return recent.result;
    }
  }

  const recordResult = (res: { ok: boolean; result?: unknown; error?: string }) => {
    recentToolCalls.set(callKey, { time: Date.now(), result: res });
    if (recentToolCalls.size > 50) {
      const cutoff = Date.now() - 10000;
      for (const [k, v] of recentToolCalls.entries()) {
        if (v.time < cutoff) recentToolCalls.delete(k);
      }
    }
    return res;
  };

  // Always execute high-priority native Windows operations first (apps, files, typing, search, folders)
  if (DIRECT_NATIVE_TOOLS.has(tool)) {
    const nativeDirect = await executeNativeFallback(tool, args);
    if (nativeDirect && nativeDirect.ok) {
      return recordResult(nativeDirect);
    }
  }

  // If desktop agent is not running, check for native Windows fallback
  if (!desktopAgentVerified) {
    await ensureDesktopAgent();
  }

  try {
    logCommand(`EXECUTE ${tool} ${JSON.stringify(args)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DESKTOP_AGENT_TIMEOUT);

    const res = await fetch(`${DESKTOP_AGENT_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const fallback = await executeNativeFallback(tool, args);
      if (fallback) return recordResult(fallback);
      const text = await res.text().catch(() => "");
      logError(`AGENT_HTTP_${res.status} ${tool}: ${text.substring(0,200)}`);
      return recordResult({ ok: false, error: `Desktop agent HTTP ${res.status}: ${text}` });
    }
    const data: any = await res.json();
    if (!data || data.ok === false || data.error) {
      const fallback = await executeNativeFallback(tool, args);
      if (fallback && fallback.ok) return recordResult(fallback);
    }
    return recordResult(data);
  } catch (err: any) {
    desktopAgentVerified = false; // mark stale so next call retries the spawn
    const fallback = await executeNativeFallback(tool, args);
    if (fallback) return recordResult(fallback);
    const msg = err?.name === "AbortError"
      ? "Desktop agent timed out."
      : "Desktop agent is not running.";
    logError(`AGENT_UNREACHABLE ${tool}: ${msg}`);
    return recordResult({ ok: false, error: msg });
  }
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10) || 3000;
  
  // 30mb so companion uploads (voice clips, photos) survive the global parser.
  app.use(express.json({ limit: "30mb" }));

  // Memory REST API Endpoints
  app.get("/api/memories", async (req, res) => {
    try {
      const memories = await loadMemories();
      res.json(memories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/memories", async (req, res) => {
    try {
      const { category, text } = req.body;
      if (!category || !text) {
        return res.status(400).json({ error: "Category and text parameters are required." });
      }
      const memories = await loadMemories();
      const timestamp = new Date().toISOString();
      const newMemory: Memory = {
        id: Math.random().toString(36).substring(2, 11),
        category,
        text,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      memories.push(newMemory);
      await saveMemories(memories);
      res.status(201).json(newMemory);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let memories = await loadMemories();
      memories = memories.filter(m => m.id !== id);
      await saveMemories(memories);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // V2: Settings API â€” mirrors the memory persistence pattern.
  // Reads/writes settings.json so the Python agent can also check auto-start.
  // ---------------------------------------------------------------------------
  const SETTINGS_FILE = dataFile("settings.json");

  function loadSettingsFile(): Record<string, unknown> {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      }
    } catch { /* corrupt file â€” return defaults */ }
    return {};
  }

  function saveSettingsFile(data: Record<string, unknown>): void {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  app.get("/api/settings", async (_req, res) => {
    try {
      res.json(loadSettingsFile());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object." });
      }
      const current = loadSettingsFile();
      const next = { ...current, ...patch };
      saveSettingsFile(next);

      // If auto-start toggled, relay to the desktop agent so the registry key
      // is flipped immediately (don't wait for a voice command).
      if ("autoStart" in patch) {
        callDesktopAgent(patch.autoStart ? "enableAutoStart" : "disableAutoStart", {})
          .catch(() => {});
      }

      logCommand(`SETTINGS_UPDATED ${JSON.stringify(patch)}`);
      res.json(next);
    } catch (e: any) {
      logError(`SETTINGS_SAVE_ERROR: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Config / API-key onboarding.
  // The Gemini key is never shipped; each user supplies their own on first run.
  // GET reports only whether a key exists â€” the key itself is never returned.
  // ---------------------------------------------------------------------------
  app.get("/api/config", (_req, res) => {
    res.json({ hasApiKey: hasGeminiApiKey() });
  });

  app.post("/api/config/apikey", async (req, res) => {
    try {
      const key: string = (req.body?.apiKey ?? "").toString().trim();
      if (!key) {
        return res.status(400).json({ error: "API key is required." });
      }
      // Validate the key by listing models â€” this checks authentication only,
      // without depending on any single model's availability or per-model
      // quota (a 429 on one model must NOT read as an invalid key). We only
      // reject on genuine auth failures; transient/network errors still save,
      // since the live connection will surface any real problem later.
      try {
        const test = new GoogleGenAI({ apiKey: key });
        const pager = await test.models.list();
        await pager[Symbol.asyncIterator]().next(); // force the first request
      } catch (e: any) {
        const msg = String(e?.message || e);
        const isAuthError =
          /API[_ ]?KEY|PERMISSION_DENIED|UNAUTHENTICATED|invalid|401|403/i.test(msg);
        if (isAuthError) {
          logError(`APIKEY_VALIDATION_REJECTED: ${msg}`);
          return res.status(400).json({
            error: "That key was rejected by Google. Check it and try again.",
          });
        }
        logError(`APIKEY_VALIDATION_SOFT_FAIL (saving anyway): ${msg}`);
      }
      setGeminiApiKey(key);
      logCommand("APIKEY_SAVED");
      res.json({ ok: true, hasApiKey: true });
    } catch (e: any) {
      logError(`APIKEY_SAVE_ERROR: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "Failed to save API key." });
    }
  });

  // V2: Agent health proxy (for the Settings panel â€” avoids direct :8765 call
  // which may fail due to CORS when served on a different origin).
  app.get("/api/agent-health", async (_req, res) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        res.json({ online: true, tool_count: d.tool_count });
      } else {
        res.json({ online: false });
      }
    } catch {
      res.json({ online: false });
    }
  });

  // V2: Logs API â€” returns recent log entries (last 100 lines) for display.
  app.get("/api/logs/:file", async (req, res) => {
    try {
      const fileName = String(req.params.file);
      // Whitelist to prevent directory traversal.
      if (!["commands", "startup", "errors"].includes(fileName)) {
        return res.status(400).json({ error: "Invalid log file. Use: commands, startup, or errors." });
      }
      const logPath = path.join(LOGS_DIR, `${fileName}.log`);
      if (!fs.existsSync(logPath)) {
        return res.json({ lines: [], file: fileName });
      }
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter(Boolean).slice(-100);
      res.json({ lines, file: fileName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================================================================
  // COMPUTER ACTION ENGINE — REST API Endpoints
  // ===========================================================================

  // BELLA 6.0 — GDI screen-frame fallback for the HUD vision loop.
  // Windows blocks WebRTC capture (WGC/DXGI) for elevated processes; GDI
  // screenshots keep Bella's vision working regardless.
  app.get("/api/screen-frame", async (_req, res) => {
    // 1) Preferred: Python desktop agent (PIL ImageGrab → compact JPEG).
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(`${DESKTOP_AGENT_URL}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "takeScreenshot", args: {} }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        const data: any = await r.json();
        const b64 = data?.result?.image_base64 || data?.result?.result?.image_base64 || data?.image_base64;
        if (data && data.ok !== false && typeof b64 === "string" && b64.length > 200) {
          return res.json({ ok: true, jpegBase64: b64 });
        }
      }
    } catch { /* agent offline — fall through */ }

    // 2) Fallback: inline PowerShell GDI capture → half-scale JPEG → base64.
    try {
      const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$g.Dispose()
$small = New-Object System.Drawing.Bitmap ([int]($bmp.Width / 2)), ([int]($bmp.Height / 2))
$g2 = [System.Drawing.Graphics]::FromImage($small)
$g2.DrawImage($bmp, 0, 0, $small.Width, $small.Height)
$ms = New-Object System.IO.MemoryStream
$small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())
`;
      const encoded = Buffer.from(ps, "utf16le").toString("base64");
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { timeout: 12000, windowsHide: true, maxBuffer: 24 * 1024 * 1024 },
        (err, stdout) => {
          const out = (stdout || "").trim();
          if (!err && out.length > 500 && /^[A-Za-z0-9+/=\r\n]+$/.test(out.slice(0, 200))) {
            return res.json({ ok: true, jpegBase64: out });
          }
          return res.status(502).json({ ok: false, error: "No screen-capture backend available." });
        },
      );
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });
  app.post("/api/computer/execute", async (req, res) => {
    try {
      const action = req.body;
      if (!action || typeof action !== "object") {
        return res.status(400).json({ error: "Missing or invalid action object." });
      }
      const result = await computerActionEngine.execute(action);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Direct tool invocation used by the HUD's proactive-suggestion actions.
  app.post("/api/execute", async (req, res) => {
    try {
      const { tool, args } = req.body || {};
      if (!tool || typeof tool !== "string") {
        return res.status(400).json({ error: "Missing 'tool' string." });
      }
      const result = await callDesktopAgent(tool, args || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/computer/batch", async (req, res) => {
    try {
      const { actions, stopOnError } = req.body || {};
      if (!Array.isArray(actions)) {
        return res.status(400).json({ error: "Expected 'actions' to be an array of ComputerActions." });
      }
      const results = await computerActionEngine.executeBatch(actions, { stopOnError: stopOnError ?? true });
      res.json({ success: results.every(r => r.success), results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/computer/apps", (_req, res) => {
    res.json({ applications: AppRegistry.getAll() });
  });

  app.get("/api/computer/status", async (_req, res) => {
    res.json({ status: "ready", engine: "ComputerActionEngine", version: "1.0.0" });
  });

  // Safe Server-Side Scraper & HTML Proxy endpoint
  app.get("/api/proxy", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter." });
      }

      console.log(`[Proxy Scraper] Fetching external content for: ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Scraper failed to load page: status ${response.status}`);
      }

      const html = await response.text();

      // Simple regex-based HTML parsers for standard items
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extract high-level headings (h1, h2, h3)
      const headings: string[] = [];
      const headingMatches = html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi);
      for (const match of headingMatches) {
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 3 && text.length < 120 && !headings.includes(text)) {
          headings.push(text);
        }
      }

      // Extract organic anchor links
      const links: { text: string; href: string }[] = [];
      const linkMatches = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
      for (const match of linkMatches) {
        let href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        
        if (text && text.length > 2 && text.length < 100) {
          if (href.startsWith("/")) {
            try {
              const u = new URL(url);
              href = `${u.protocol}//${u.host}${href}`;
            } catch {}
          }
          if (href.startsWith("http://") || href.startsWith("https://")) {
            links.push({ text, href });
          }
        }
      }

      // Extract general copy paragraphs
      const paragraphs: string[] = [];
      const paragraphMatches = html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi);
      for (const match of paragraphMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 25 && text.length < 600 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      }

      // Extract button elements
      const buttons: string[] = [];
      const buttonMatches = html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gi);
      for (const match of buttonMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 1 && text.length < 60 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }

      res.json({
        url,
        title,
        headings: headings.slice(0, 15),
        links: links.filter(l => !l.href.includes("javascript:")).slice(0, 30),
        buttons: buttons.slice(0, 15),
        paragraphs: paragraphs.slice(0, 12)
      });

    } catch (err: any) {
      console.error(`[Proxy Scraper] Error fetching ${req.query.url}:`, err.message);
      res.status(500).json({ error: `Scraper error: ${err.message}` });
    }
  });

  // High-fidelity fully functional HTML Proxy which circumvents CSP and X-Frame-Options
  app.get("/api/web-proxy", async (req, res) => {
    let targetUrl = "";
    try {
      const urlParam = req.query.url as string;
      if (!urlParam) {
        return res.status(400).send("Bella Web Proxy Error: Missing target 'url' parameter");
      }

      targetUrl = urlParam.trim();
      
      // Prevent relative paths from requesting on same-origin
      if (targetUrl.startsWith("/")) {
        return res.status(400).send(`Bella Web Proxy Error: Relative paths are not supported directly (${targetUrl}).`);
      }

      // Check protocol and hostname format
      try {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = "https://" + targetUrl;
        }
        const parsed = new URL(targetUrl);
        if (!parsed.hostname || !parsed.hostname.includes(".")) {
          throw new Error("Missing or invalid domain name extension (e.g. .com, .org, .net).");
        }
      } catch (err: any) {
        return res.status(400).send(`Bella Web Proxy Error: Invalid URL specified: "${urlParam}". Make sure you enter a valid domain name.`);
      }

      console.log(`[Web Proxy] Routing connection through proxy: ${targetUrl}`);
      
      let response;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
          }
        });
      } catch (fetchErr: any) {
        console.warn(`[Web Proxy Failed Fetch] Target: ${targetUrl} Error:`, fetchErr.message);
        return res.status(502).send(`Bella Web Proxy Error: Unable to fetch the website "${targetUrl}". The site might be offline, or the URL address is spelled incorrectly. Details: ${fetchErr.message}`);
      }

      if (!response.ok) {
        return res.status(response.status).send(`Bella Web Proxy Error: Failed loading remote website. Server returned status: ${response.status} (${response.statusText})`);
      }

      const contentType = response.headers.get("content-type") || "";
      
      // If it is not HTML (e.g. stylesheet, script, or image loaded directly), proxy it as binary
      if (!contentType.includes("text/html")) {
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", contentType);
        return res.send(Buffer.from(arrayBuffer));
      }

      let htmlContents = await response.text();

      // Inject base tag to resolve relative paths and direct parent communication scripts
      const baseUrlTag = `<base href="${targetUrl}" />`;
      const interceptorScript = `
        <script>
          (function() {
            // Hijack link interactions safely
            document.addEventListener('click', function(e) {
              var anchor = e.target.closest('a');
              if (anchor) {
                var href = anchor.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  try {
                    var resolvedUrl = new URL(href, window.location.href).href;
                    window.parent.postMessage({ type: 'NAVIGATE', url: resolvedUrl }, '*');
                  } catch (err) {
                    console.error("[Proxy Interceptor] Failed resolving link:", err);
                  }
                }
              }
            }, true);

            // Hijack search form submits
            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form) {
                e.preventDefault();
                try {
                  var formData = new FormData(form);
                  var params = new URLSearchParams();
                  formData.forEach(function(value, key) {
                    if (typeof value === 'string') {
                      params.append(key, value);
                    }
                  });
                  var actionAttr = form.getAttribute('action') || '';
                  var actionUrl = new URL(actionAttr, window.location.href).href;
                  if (form.method.toLowerCase() === 'get') {
                    actionUrl += (actionUrl.indexOf('?') !== -1 ? '&' : '?') + params.toString();
                  }
                  window.parent.postMessage({ type: 'NAVIGATE', url: actionUrl }, '*');
                } catch (err) {
                  console.error("[Proxy Interceptor] Failed submitting form:", err);
                }
              }
            }, true);

            // Neutralize parent context locks (frame-busters)
            window.alert = function(msg) { console.log("[Bella Browser alert bypassed]:", msg); };
            window.confirm = function(msg) { console.log("[Bella Browser confirm bypassed]:", msg); return true; };
            window.open = function(url) { window.parent.postMessage({ type: 'NAVIGATE', url: url }, '*'); return null; };
          })();
        </script>
      `;

      // Inject into <head> or prepend
      if (htmlContents.includes("<head>")) {
        htmlContents = htmlContents.replace("<head>", `<head>\n${baseUrlTag}\n${interceptorScript}`);
      } else if (htmlContents.includes("<HEAD>")) {
        htmlContents = htmlContents.replace("<HEAD>", `<HEAD>\n${baseUrlTag}\n${interceptorScript}`);
      } else {
        htmlContents = baseUrlTag + "\n" + interceptorScript + "\n" + htmlContents;
      }

      // Neutralize security headers to allow displaying in an iframe on same-origin
      res.setHeader("Content-Type", "text/html");
      res.setHeader("X-Bella-Proxied", "true");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("content-security-policy");
      res.removeHeader("x-frame-options");
      
      res.status(200).send(htmlContents);
    } catch (e: any) {
      console.warn("[Web Proxy Exception] Handled internal error:", e.message);
      res.status(500).send(`Bella Web Proxy Error: Internal error occurred proxying URL "${targetUrl || "unknown"}". Details: ${e.message}`);
    }
  });

  // Real-time live YouTube search proxy endpoint
  app.get("/api/youtube-search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Missing query q" });
      }

      console.log(`[YouTube Proxy Search] Searching real YouTube for: "${query}"`);
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&sp=EgIQAQ%253D%253D`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();

      const videoList: any[] = [];
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
          if (contents && Array.isArray(contents)) {
            for (const item of contents) {
              if (item.videoRenderer) {
                const vr = item.videoRenderer;
                const vId = vr.videoId;
                if (vId) {
                  videoList.push({
                    videoId: vId,
                    title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || "YouTube Video",
                    thumbnail: `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
                    author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || "Unknown Channel",
                    duration: vr.lengthText?.simpleText || "N/A",
                    views: vr.viewCountText?.simpleText || "N/A",
                    published: vr.publishedTimeText?.simpleText || ""
                  });
                }
              }
            }
          }
        } catch (e: any) {
          console.error("[YouTube Parser Engine] JSON parse error, falling back:", e.message);
        }
      }

      // Regex fallback if JSON extraction gets blocked or is empty
      if (videoList.length === 0) {
        const videoRegex = /"videoId":"([^"]+)"/g;
        let match;
        const ids: string[] = [];
        while ((match = videoRegex.exec(html)) !== null && ids.length < 15) {
          const id = match[1];
          if (id && !ids.includes(id)) {
            ids.push(id);
          }
        }

        for (const id of ids) {
          videoList.push({
            videoId: id,
            title: `Live Stream: ${id}`,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author: "YouTube Creator",
            duration: "N/A",
            views: "Available Now"
          });
        }
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({ results: videoList.slice(0, 15) });
    } catch (err: any) {
      console.error("[YouTube Search Error]:", err.message);
      res.status(500).json({ error: err.message, results: [] });
    }
  });

  // ---------------------------------------------------------------------------
  // Wake-Phrase AI Verification Endpoint (ultra-fast Gemini Flash audio check)
  // ---------------------------------------------------------------------------
  app.post("/api/wake-check", express.json({ limit: "5mb" }), async (req, res) => {
    try {
      const { audioBase64, phrase } = req.body;
      if (!audioBase64) {
        return res.json({ wake: false });
      }

      const apiKey = getGeminiApiKey();
      if (!apiKey) {
        return res.json({ wake: false, error: "Missing API key" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const targetPhrase = (phrase || "hey bella").toLowerCase();

      let isWake = false;
      const modelsToTry = ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3-flash-preview"];

      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: audioBase64
                    }
                  },
                  {
                    text: `Listen to this short audio clip. Did the speaker say "${targetPhrase}", "Bella", "Hey Bella", "Wake up Bella", or call Bella directly?
Reply ONLY with "YES" if they said the wake phrase or called Bella, or "NO" if it is silence, room noise, or talking about something else.`
                  }
                ]
              }
            ]
          });

          const reply = (response.text || "").trim().toUpperCase();
          isWake = reply.includes("YES");
          console.log(`[Wake-Check API (${modelName})] Speech clip analyzed. Model reply: "${reply}". Wake: ${isWake}`);
          break; // Succeeded
        } catch (modelErr: any) {
          console.warn(`[Wake-Check API] Model ${modelName} failed (${modelErr.message}), trying next...`);
        }
      }

      // Voice Guardian: identify WHO spoke (owner vs guest) when enrolled.
      let speaker: string = "unknown";
      try {
        const identification = identifySpeaker(audioBase64);
        speaker = identification.identity;
        if (speaker !== "unknown") {
          console.log(`[Voice Guardian] Speaker identified as ${speaker} (score ${identification.score}).`);
        }
      } catch (e) {
        console.warn("[Voice Guardian] identification failed:", e);
      }

      res.json({ wake: isWake, speaker });
    } catch (err: any) {
      console.warn("[Wake-Check API] Validation error:", err.message);
      res.json({ wake: false });
    }
  });

  // ---------------------------------------------------------------------------
  // BELLA 6.0 — Guardian (voice security) & Phone Link REST APIs
  // ---------------------------------------------------------------------------
  app.use("/api/guardian", express.json({ limit: "20mb" }), guardianRouter);
  app.use("/api/phone", express.json(), phonelinkRouter);
  // BELLA Companion PWA — full phone app (chat brain, PC remote, push, uploads).
  registerPhoneExecutor(async (name, args) => {
    if (isBellaTool(name)) {
      return executeBellaTool(name, args as Record<string, unknown>, {
        apiKey: getGeminiApiKey() || "",
        clientWs: null,
        sessionId: "phone",
      });
    }
    const r = await callDesktopAgent(name, args);
    if (!r.ok) throw new Error(r.error || "Tool failed.");
    return r.result ?? "done";
  }, bellaDeclarations as unknown[]);
  app.use("/api/phone", createPhoneAppRouter());
  app.use("/api/bella/faces", express.json({ limit: "30mb" }), facesRouter);
  app.get("/api/bella/stats", (_req, res) => {
    res.json({
      tools: bellaToolCount,
      guestMode: isGuestMode(),
      lastSpeaker: getLastSpeaker(),
      liveSessions: getLiveSessionCount(),
    });
  });

  // --- BELLA 6.0 Settings-panel endpoints ---

  // Diagnostic: push a sample drawing straight to the connected HUD so the
  // whiteboard render path can be verified independently of the AI.
  app.post("/api/bella/whiteboard-demo", express.json(), async (req, res) => {
    const handle = getLiveSession();
    if (!handle?.clientWs) return res.status(503).json({ ok: false, error: "No live HUD session connected." });
    const els: any[] = [
      { type: "text", x: 300, y: 30, text: "Whiteboard self-test", color: "#7dd3fc" },
      { type: "rect", x: 120, y: 220, w: 260, h: 160, color: "#38bdf8", width: 4 },
      { type: "text", x: 170, y: 285, text: "Input", color: "#ffffff" },
      { type: "arrow", x: 390, y: 300, x2: 590, y2: 300, color: "#fbbf24", width: 5 },
      { type: "circle", x: 700, y: 300, r: 110, color: "#a78bfa", width: 4 },
      { type: "text", x: 655, y: 290, text: "Output", color: "#ffffff" },
    ];
    handle.clientWs.send(JSON.stringify({ type: "whiteboard_open", topic: "Self-test" }));
    for (const el of els) {
      handle.clientWs.send(JSON.stringify({ type: "whiteboard_draw", element: el }));
      await new Promise(r => setTimeout(r, 250));
    }
    res.json({ ok: true, sent: els.length });
  });

  app.get("/api/bella/personas", (_req, res) => {
    try {
      const active = getActivePersona();
      res.json({
        active: active.id,
        personas: listPersonas().map(p => ({ id: p.id, name: p.name, theme: p.theme, voice: resolveVoice(p) })),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/bella/persona", express.json(), async (req, res) => {
    try {
      const persona = setActivePersona(String(req.body?.persona || "bella"));
      res.json({ ok: true, persona: persona.id, name: persona.name, voice: resolveVoice(persona), theme: (persona as any).theme });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/bella/reminders", (_req, res) => {
    try {
      const list = loadReminders().filter(r => r.active).map(r => ({
        id: r.id, text: r.text, when: describeWhen(r),
      }));
      res.json({ reminders: list });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/bella/expenses", (req, res) => {
    try {
      const limit = Math.min(50, parseInt(String(req.query.limit || "10"), 10) || 10);
      const list = loadExpenses().slice(-limit).reverse();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todays = loadExpenses().filter(e => new Date(e.date) >= today);
      res.json({
        transactions: list,
        todayTotal: todays.reduce((s, e) => s + e.amount, 0).toFixed(2),
        currency: todays[0]?.currency || "",
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/skills", async (_req, res) => {
    try {
      const out = await executeBellaTool("listInstalledSkills", {}, { apiKey: getGeminiApiKey() || "", clientWs: null, sessionId: "settings" }) as any;
      res.json(out);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/skills/install", express.json(), async (req, res) => {
    try {
      const out = await executeBellaTool("installMarketplaceSkill", { id: String(req.body?.id || "") }, { apiKey: getGeminiApiKey() || "", clientWs: null, sessionId: "settings" }) as any;
      res.json(out);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/bella/check-updates", async (_req, res) => {
    try {
      const out = await executeBellaTool("checkForUpdates", {}, { apiKey: getGeminiApiKey() || "", clientWs: null, sessionId: "settings" }) as any;
      res.json(out);
    } catch (e: any) { res.json({ result: `Update check failed: ${e.message}` }); }
  });

  app.post("/api/bella/install-update", async (_req, res) => {
    try {
      const out = await executeBellaTool("installUpdate", {}, { apiKey: getGeminiApiKey() || "", clientWs: null, sessionId: "settings" }) as any;
      res.json(out);
    } catch (e: any) { res.json({ result: `Install failed: ${e.message}` }); }
  });

  app.get("/api/email/status", (_req, res) => {    try {
      const cfg = readJson<any | null>(dataFile("mail.json"), null);
      res.json({ configured: !!cfg?.address, address: cfg?.address || "" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/email/configure", express.json(), async (req, res) => {
    try {
      const output = await executeBellaTool("configureEmail", {
        email: String(req.body?.email || ""),
        appPassword: String(req.body?.appPassword || ""),
      }, { apiKey: getGeminiApiKey() || "", clientWs: null, sessionId: "settings" });
      res.json(output as any);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // --- BELLA 6.0 Settings-panel endpoints end ---

  // ---------------------------------------------------------------------------
  // Gemini API Key Pool & Automatic Failover Endpoints
  // ---------------------------------------------------------------------------
  app.get("/api/keys/gemini", (_req, res) => {
    try {
      const keys = geminiKeyPool.getAllKeys();
      res.json({ keys });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/keys/gemini", express.json(), (req, res) => {
    try {
      const { name, key, priority } = req.body;
      if (!key) return res.status(400).json({ error: "Key is required" });
      const added = geminiKeyPool.addKey(name, key, priority);
      res.json({ key: added });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/keys/gemini/:id", (req, res) => {
    try {
      const ok = geminiKeyPool.removeKey(req.params.id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/keys/gemini/:id", express.json(), (req, res) => {
    try {
      const updated = geminiKeyPool.updateKey(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Key not found" });
      res.json({ key: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/keys/gemini/:id/test", async (req, res) => {
    try {
      const result = await geminiKeyPool.testKey(req.params.id);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, status: "error", message: e.message });
    }
  });

  app.post("/api/keys/gemini/test-raw", express.json(), async (req, res) => {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ error: "Key is required" });
      const result = await geminiKeyPool.testKey(key);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, status: "error", message: e.message });
    }
  });

  app.post("/api/keys/gemini/reorder", express.json(), (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds array is required" });
      const reordered = geminiKeyPool.reorderKeys(orderedIds);
      res.json({ keys: reordered });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Proactive Intelligence System Endpoints
  // ---------------------------------------------------------------------------
  const proactiveEngine = getProactiveEngine();
  proactiveEngine.init().catch((err) => console.error("[Server] Proactive engine init error:", err));

  app.get("/api/proactive/settings", async (_req, res) => {
    try {
      const settings = await proactiveEngine.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proactive/settings", express.json(), async (req, res) => {
    try {
      const updated = await proactiveEngine.updateSettings(req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/proactive/suggestions", async (_req, res) => {
    try {
      const active = proactiveEngine.getActiveSuggestions();
      res.json({ suggestions: active });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proactive/feedback", express.json(), async (req, res) => {
    try {
      const { suggestionId, action } = req.body;
      if (suggestionId && action) {
        await proactiveEngine.recordFeedback({ suggestionId, action });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/proactive/briefing", async (_req, res) => {
    try {
      const briefing = await proactiveEngine.getDailyBriefing();
      res.json(briefing);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proactive/trigger-eval", async (_req, res) => {
    try {
      const delivered = await proactiveEngine.runEvaluationCycle();
      res.json({ triggered: delivered.length, suggestions: delivered });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Personal AI Dashboard Endpoints
  // ---------------------------------------------------------------------------
  const contextEngine = proactiveEngine.getContextEngine();

  // Full dashboard aggregated payload
  app.get("/api/dashboard/summary", async (_req, res) => {
    try {
      const summary = await contextEngine.getDashboardSummary("Manish");
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Tasks API
  app.get("/api/tasks", async (_req, res) => {
    try {
      res.json(contextEngine.getTasks());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/tasks", express.json(), async (req, res) => {
    try {
      const { title, category, priority, estimatedMinutes, dueDate, projectId } = req.body;
      if (!title) return res.status(400).json({ error: "Missing title" });
      const task = await contextEngine.addTask({
        title,
        category: category || "Inbox",
        priority: priority || "medium",
        status: "pending",
        estimatedMinutes: estimatedMinutes || 30,
        dueDate,
        projectId,
      });
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/tasks/:id", express.json(), async (req, res) => {
    try {
      const updated = await contextEngine.updateTask(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Task not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const ok = await contextEngine.deleteTask(req.params.id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Projects API
  app.get("/api/projects", async (_req, res) => {
    try {
      res.json(contextEngine.getProjects());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/projects", express.json(), async (req, res) => {
    try {
      const { name, description, status, progressPercent, currentMilestone, nextTask, deadline } = req.body;
      if (!name) return res.status(400).json({ error: "Missing project name" });
      const proj = await contextEngine.addProject({
        name,
        description: description || "",
        status: status || "Active",
        progressPercent: progressPercent || 0,
        currentMilestone,
        nextTask,
        deadline,
        tasksCount: 0,
        openTasksCount: 0,
      });
      res.json(proj);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/projects/:id", express.json(), async (req, res) => {
    try {
      const updated = await contextEngine.updateProject(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Project not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const ok = await contextEngine.deleteProject(req.params.id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Learning & Revision API
  app.get("/api/learning/topics", async (_req, res) => {
    try {
      res.json({
        topics: contextEngine.getLearningTopics(),
        cybersecurityProficiency: contextEngine.getCybersecurityProficiency(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/learning/review", express.json(), async (req, res) => {
    try {
      const { topic } = req.body;
      if (!topic) return res.status(400).json({ error: "Missing topic name" });
      await contextEngine.recordLearningReview(topic);
      res.json({ success: true, message: `Review recorded for ${topic}` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Quick Capture API
  app.post("/api/quick-capture", express.json(), async (req, res) => {
    try {
      const { text, type } = req.body;
      if (!text) return res.status(400).json({ error: "Missing text" });
      const result = await contextEngine.processQuickCapture(text, type);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Universal Search API
  app.get("/api/search", async (req, res) => {
    try {
      const q = (req.query.q as string) || "";
      const results = await contextEngine.searchAll(q);
      res.json({ results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Activity Stream API
  app.get("/api/activity", async (req, res) => {
    try {
      const filter = (req.query.type as string) || "all";
      const activities = contextEngine.getActivityList(filter);
      res.json({ activities });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  // ---------------------------------------------------------------------------
  // Personal Intelligence & Context-Aware Companion Endpoints
  // ---------------------------------------------------------------------------
  personalIntelligence.init().catch(err => console.error("[Server] Personal Intelligence init error:", err));

  // Context & Privacy Permissions API
  app.get("/api/intelligence/permissions", (_req, res) => {
    res.json(contextPermissionManager.getPermissions());
  });

  app.post("/api/intelligence/permissions", express.json(), async (req, res) => {
    try {
      const updated = await contextPermissionManager.setAll(req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Current Permitted Context Snapshot
  app.get("/api/intelligence/context", (_req, res) => {
    res.json(piContextEngine.getSnapshot());
  });

  // Curiosity Questions Evaluation
  app.get("/api/intelligence/curiosity", async (_req, res) => {
    try {
      const context = piContextEngine.getSnapshot();
      const question = await curiosityEngine.evaluateBestQuestion(context, 0.50);
      res.json({ question });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Personalized Recommendations
  app.get("/api/intelligence/recommendations", async (_req, res) => {
    try {
      const context = piContextEngine.getSnapshot();
      const recs = await recommendationEngine.generateRecommendations(context);
      res.json({ recommendations: recs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Transparent Explainability ("Why did you ask this?")
  app.post("/api/intelligence/explain", express.json(), (req, res) => {
    try {
      const explanation = ExplainabilityEngine.explainAction(req.body);
      res.json({ explanation });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // User Feedback (Accepted, Dismissed, Snoozed, Never Ask Again)
  app.post("/api/intelligence/feedback", express.json(), async (req, res) => {
    try {
      const record = await feedbackEngine.recordFeedback(req.body);
      res.json({ ok: true, record });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Personal Memories with Confidence & Confirmation
  app.get("/api/intelligence/memories", async (req, res) => {
    try {
      const cat = req.query.category as any;
      const mems = await piMemoryManager.getMemories(cat);
      res.json({ memories: mems });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/intelligence/memories/confirm", express.json(), async (req, res) => {
    try {
      const { memoryId } = req.body;
      if (!memoryId) return res.status(400).json({ error: "Missing memoryId" });
      const confirmed = await piMemoryManager.confirmMemory(memoryId);
      res.json({ memory: confirmed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/intelligence/memories/:id", async (req, res) => {
    try {
      const deleted = await piMemoryManager.deleteMemory(req.params.id);
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Total Privacy Wipe
  app.post("/api/intelligence/wipe", async (_req, res) => {
    try {
      const result = await PrivacyController.wipeAllPersonalData();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Temporal Session Memory System Endpoints
  // ---------------------------------------------------------------------------
  temporalMemoryManager.init().catch(err => console.error("[Server] Temporal Memory init error:", err));

  // Recent Timeline (Active Context + Session + Previous 7 Days)
  app.get("/api/temporal/timeline", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string, 10) || 7;
      const timeline = await temporalMemoryManager.getTimeline(days);
      const activeContext = temporalMemoryManager.getSessionManager().getActiveContext();
      const workingState = temporalMemoryManager.getSessionManager().getSessionWorkingState();
      res.json({ timeline, activeContext, workingState });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Natural Language Relative Time Query
  app.get("/api/temporal/query", async (req, res) => {
    try {
      const q = (req.query.q as string) || "";
      const project = req.query.project as string | undefined;
      const result = await temporalMemoryManager.queryTemporalMemory(q, project);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Consolidate Current Session
  app.post("/api/temporal/summarize", express.json(), async (req, res) => {
    try {
      const project = req.body?.project;
      const summary = await temporalMemoryManager.consolidateCurrentSession(project);
      res.json({ summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  // Custom server running with http.createServer so we can upgrade for WebSocket on port 3000
  const server = http.createServer(app);
  
  // Setup WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Handle client WebSocket Connection
  wss.on("connection", async (clientWs, request) => {
    const reqUrl = new URL(request?.url || "/live", "http://localhost");
    const sessionId = reqUrl.searchParams.get("sessionId") || "default_bella_session";

    let sessionState = activeSessions.get(sessionId);
    if (!sessionState) {
      sessionState = {
        sessionId,
        activationCount: 1,
        dialogueHistory: [],
        lastConnectedAt: Date.now(),
        lastDisconnectedAt: 0,
      };
      activeSessions.set(sessionId, sessionState);
    } else {
      sessionState.activationCount++;
      sessionState.lastConnectedAt = Date.now();
    }

    const isFirstActivation = sessionState.activationCount === 1;
    console.log(`[Bella Live] Client connected (sessionId="${sessionId}", activation #${sessionState.activationCount}, isFirstActivation=${isFirstActivation}, historyTurns=${sessionState.dialogueHistory.length})`);

    const activeKeyObj = geminiKeyPool.getActiveKey();
    const apiKey = activeKeyObj?.key || getGeminiApiKey();

    if (!apiKey) {
      console.error("No Gemini API key configured in key pool.");
      clientWs.send(JSON.stringify({
        type: "error",
        error: "NO_API_KEY: Add your Gemini API key in Settings to start talking to BELLA."
      }));
      clientWs.close();
      return;
    }

    if (activeKeyObj) {
      console.log(`[Bella Live] Using key "${activeKeyObj.name}" (${activeKeyObj.id}) from secure Key Pool.`);
    }
    
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connecting_gemini" }));

      // Load persistent recollections card
      const memories = await loadMemories();

      // BELLA 6.0 — active persona drives personality + voice
      const persona = getActivePersona();
      const baseInstructions =
        persona.core +
        "CONVERSATIONAL DISCIPLINE (applies to every persona):\n" +
        "- Behave like a real companion on a voice call—stay connected naturally, do not wait for wake words, and avoid customer-service template phrases (never say 'how may I assist you', 'completed', or 'as an AI').\n" +
        "- DO NOT ANSWER EVERY PAUSE OR BACKGROUND SOUND: Allow natural pauses inside the conversation.\n" +
        "- BACKCHANNEL ACTIONS: Sometimes acknowledge with very short phrases like 'Hmm...', 'Ah, I see...', or 'Let me check...'. Never repeat the same backchannel over and over.\n" +
        "7. PLAYING MUSIC, CONTROLLING SONGS & OPENING WEBSITES ON USER'S COMPUTER (DEFAULT BROWSER):\n" +
        "   - When MANISH asks you to 'open YouTube and play [song]', 'play [song] on YouTube', 'open [website]', or 'search Google for [query]', ALWAYS use your desktop tools to open it in their REAL DEFAULT BROWSER (Brave, Chrome, Edge, etc.) on their PC!\n" +
        "   - Use 'searchYouTube' with the query (e.g. searchYouTube(query='Barbaad song')) — this immediately opens YouTube search and the song in their PC's default browser window.\n" +
        "   - CONTROLLING ACTIVE MUSIC / SONGS (SKIP, NEXT, PREVIOUS, PLAY/PAUSE):\n" +
        "     * When MANISH says 'skip the song', 'next song', 'play next song', 'skip track', or 'change the song': CALL 'mediaNextTrack' immediately! This uses real Windows media keys to skip to the next video or track in YouTube, Spotify, or any active browser tab. Respond naturally: 'Skipping to the next song for you now!'\n" +
        "     * When MANISH says 'previous song' or 'go back a song': CALL 'mediaPrevTrack'.\n" +
        "     * When MANISH says 'pause the music', 'pause song', 'resume song', or 'play song': CALL 'mediaPlayPause'.\n" +
        "     * If MANISH asks to change to a DIFFERENT SPECIFIC song (e.g. 'change the song to Levitating by Dua Lipa'): CALL searchYouTube(query='Levitating Dua Lipa') so it opens and plays in his default browser!\n" +
        "     * NEVER use 'browserMediaControl' or open the in-app projector for these commands. Always use 'mediaNextTrack', 'mediaPlayPause', 'mediaPrevTrack', or 'searchYouTube'.\n" +
        "   - Use 'openWebsite' for opening any site or URL (e.g. openWebsite(url='youtube.com') or openWebsite(url='github.com')) in their default browser.\n" +
        "   - Use 'searchGoogle' or 'searchWeb' for searching Google or other engines in their default browser.\n" +
        "   - Respond naturally with your voice: 'Sure thing, playing that for you right now!'\n" +
        "8. IN-APP HOLOGRAPHIC BROWSER (SECONDARY / ON EXPLICIT REQUEST ONLY):\n" +
        "   - The 'in-app projector' / 'holographic browser' is an embedded preview window inside Bella's UI. DO NOT use 'browserOpen' or 'browserMediaControl' unless MANISH explicitly asks for 'in-app projector' or 'holographic preview'. For all real browsing, songs, and media playback on MANISH's PC, always use 'searchYouTube', 'openWebsite', 'mediaNextTrack', 'mediaPlayPause', etc.\n" +
        "   - Use 'browserClick', 'browserScroll', 'browserType', 'browserTabAction', 'browserMediaControl' ONLY to interact with the in-app projector when it is already actively open on screen.\n" +
        "   - Use 'changeBackground' to shift your theme and 'saveCustomMemory' to memorize facts.\n" +
        "9. REAL-TIME SCREEN SHARING & MULTIMODAL SCREEN VISION SYSTEM:\n" +
        "   - You now have native, actual Multimodal Screen Vision! When screen sharing is active, you will receive real-time, highly compressed image frames of MANISH's desktop, application window, or browser tab.\n" +
        "   - STARTING & STOPPING SCREEN SHARING VIA VOICE:\n" +
        "     * When MANISH asks you to 'start screen share', 'share my screen', 'can you see my screen?', 'look at my screen', 'start screen vision', or 'turn on screen sharing': CALL 'startScreenShare()' immediately! Respond warmly: 'Starting screen sharing for you now! Let me take a look at what you\\'re working on.'\n" +
        "     * When MANISH says 'stop screen sharing', 'stop sharing', or 'turn off screen share': CALL 'stopScreenShare()'.\n" +
        "   - You can see exactly what is on their screen. Use this live visual stream to analyze terminal errors, write/explain/troubleshoot code, explain YouTube/social analytics interfaces, read layout text, summarize full web page details, review design mockups or thumbnails, and provide deep context-aware companion chat!\n" +
        "   - When the user asks 'What is on my screen?', 'What website am I on?', 'Do you see any errors?', 'Explain this code', 'Summarize this page', 'Read the visible text', 'How is this thumbnail?', or 'Analyze my YouTube analytics', immediately examine the latest incoming visual frame to diagnose issues, and answer with expert, friendly empathy like a close caller. Speak with direct, confident visual description reference!\n" +
        "10. JARVIS-STYLE DESKTOP CONTROL POWERS (Native Windows & Desktop Control):\n" +
        "   - You have full real-time control of MANISH's Windows PC. When the user asks you to perform an action on their computer, DO IT immediately and naturally — like a true JARVIS-class companion.\n" +
        "   - KEYBOARD & TYPING:\n" +
        "     * When MANISH asks to press Enter (e.g. 'press enter', 'hit enter', 'click enter', 'press return'): CALL 'pressEnter()' immediately! Respond warmly: 'Pressed Enter for you.'\n" +
        "     * When MANISH asks to press a key (e.g. 'press escape', 'press tab', 'press space', 'press backspace'): CALL 'pressKey(key=\"...\")'.\n" +
        "     * Use 'typeText' or 'pasteClipboard' to type or write text into the active application window! Example: If MANISH says 'Open Notion and write a todo list' -> first call openApplication(name='Notion'), then call typeText(text='- Task 1\\n- Task 2') -> respond naturally: 'Notion is open and I\\'ve written your todo list!'\n" +
        "   - MOUSE & CURSOR CONTROL:\n" +
        "     * When MANISH asks to click (e.g. 'left click', 'click here', 'click on screen'): CALL 'leftClick()' immediately! Respond: 'Left clicked.'\n" +
        "     * When MANISH asks to right click (e.g. 'right click', 'show context menu'): CALL 'rightClick()' immediately! Respond: 'Right clicked.'\n" +
        "     * When MANISH asks to double click: CALL 'doubleClick()'.\n" +
        "     * When MANISH asks to move cursor or scroll: CALL 'mouseMove' or 'mouseScroll'.\n" +
        "   - BROWSER TABS & NAVIGATION:\n" +
        "     * When MANISH asks to go back to previous tab or next tab (e.g. 'go back to previous tab', 'previous tab', 'switch tab', 'next tab'): CALL 'previousTab()' or 'nextTab()' immediately! Respond warmly: 'Switched to the previous tab for you.'\n" +
        "     * When MANISH asks to go back in browser history (e.g. 'go back in browser', 'browser back', 'previous page'): CALL 'browserBack()'.\n" +
        "     * When MANISH asks to open a new tab or close tab (e.g. 'open new tab', 'open a new tab', 'close this tab'): CALL 'newTab()' or 'closeTab()' immediately! Respond: 'Opened a new tab for you.'\n" +
        "   - WEBSITE & SEARCH CONTROL: Use 'openWebsite' for named sites (youtube, gmail, google, github, chatgpt) or any URL. Use 'searchWeb', 'searchYouTube', 'searchGoogle', 'searchGitHub' to open search results in the default browser. Example: 'Search YouTube for AI News' -> searchYouTube(query='AI News').\n" +
        "   - FILE EXPLORER & MANAGEMENT: Use 'openFolder' to open File Explorer (e.g. openFolder(name='downloads')), 'searchFiles' to find files, 'getFileProperties' to inspect a file's size, created/modified date and type, 'copyFile' to copy files, 'moveFile' to move files, 'renameFile' to rename, 'deleteFile' to delete, and 'createFile' to create new files.\n" +
        "   - FILE PROPERTIES & INSPECTION: When MANISH asks 'What is the size of my resume?' or 'Tell me about notes.txt', call getFileProperties(path='Desktop/notes.txt') and read back its formatted size and modified date naturally.\n" +
        "   - PC CONTROL: Use 'volumeUp', 'volumeDown', 'setVolume', 'muteToggle' for audio. For DANGEROUS actions (shutdown/restart/sleep/lock) you MUST use the two-step flow: first call 'requestPowerAction' to get a confirmation token, then ASK THE USER OUT LOUD to confirm (e.g. 'Are you sure you want me to shut down your PC?'). Only if they say yes, call 'executePowerAction' with the token. Never run a power action without explicit verbal confirmation.\n" +
        "   - WINDOW MANAGEMENT: Use 'minimizeWindow', 'maximizeWindow', 'closeWindow', 'switchApplication' to control the active or named window.\n" +
        "   - SCREENSHOT & SCREEN READING: When MANISH asks you to take a screenshot (e.g. 'take a screenshot', 'capture my screen'):\n" +
        "     * If MANISH hasn't specified a name for the screenshot yet, ask him what name he would like to save it as (e.g., 'Sure! What name should I save the screenshot as?').\n" +
        "     * When he gives the name (or if he already specified one like 'take a screenshot called my_notes'), call 'saveScreenshot(name=\"...\")'. It will automatically save directly into MANISH's Downloads folder as a PNG file!\n" +
        "     * Confirm warmly after saving (e.g., 'I\\'ve taken the screenshot and saved it as [name].png in your Downloads folder!').\n" +
        "     * Use 'analyzeScreenshot' (OCR of the screen) or 'readScreen' (OCR of the active window) to answer 'What error is showing on my screen?' or 'Read the visible text'.\n" +
        "   - CODING ASSISTANCE: Use 'createPythonFile', 'writeCodeFile' (any language), 'createProjectFolder' (with subfolders), 'runPythonScript' (captures output). Example: 'Create and run a hello world Python script' -> createPythonFile then runPythonScript, then read back the output naturally.\n" +
        "   - SYSTEM INFORMATION: Use 'systemInfo' (CPU/RAM/disk/uptime), 'gpuInfo' (NVIDIA stats), 'temperatureInfo' to answer 'How is my CPU usage?' or 'What's my GPU temperature?'.\n" +
        "   - CRITICAL: Always describe what you're doing in your warm, in-character voice WHILE the tool runs. Chain multi-step desktop plans naturally without waiting between steps.\n" +
        "11. BRIGHTNESS & AUTO-START (V2):\n" +
        "   - BRIGHTNESS: Use 'brightnessUp', 'brightnessDown', 'setBrightness' when the user asks to change screen brightness. Respond naturally: 'Alright, I've turned up the brightness for you.'\n" +
        "   - AUTO-START: Use 'enableAutoStart' when the user wants BELLA to start with Windows, 'disableAutoStart' to remove it, 'getAutoStartStatus' to check. Explain what you're doing.\n" +
        "   - SETTINGS: The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "12. PROACTIVE INTELLIGENCE & TIMELY ASSISTANCE:\n" +
        "   - You have a Proactive Intelligence engine that monitors tasks, projects, learning retention, and goals.\n" +
        "   - When having natural conversations with MANISH, you can occasionally and humbly offer thoughtful suggestions or timely reminders (e.g. 'I noticed you studied SQL injection a while back, want a quick 5-minute refresher?').\n" +
        "   - Always stay humble, friendly, and non-intrusive ('I noticed...', 'Would you like me to...', 'You may want to...'). Never be bossy or pretend certainty.\n" +
        "13. DASHBOARD MANAGEMENT (PROJECTS & PRIORITY TASKS):\n" +
        "   - You have direct, real-time control over MANISH's Personal AI Dashboard!\n" +
        "   - MANAGING ACTIVE PROJECTS:\n" +
        "     * When MANISH asks to add/create a project (e.g. 'Add a new project called Red Team Toolkit', 'Add project X to active projects'): CALL 'dashboardAddProject(name=\"...\", description=\"...\", status=\"Active\", progressPercent=10)'. Confirm warmly: 'I\\'ve added [Project Name] to your active projects on the dashboard!'\n" +
        "     * When MANISH asks to remove or delete a project (e.g. 'Remove project X', 'Delete the AI Assistant project'): CALL 'dashboardDeleteProject(project_query=\"...\")'. Confirm: 'I\\'ve removed [Project Name] from your dashboard projects.'\n" +
        "     * When MANISH updates a project (e.g. 'Set project X progress to 80%', 'Mark project X as completed'): CALL 'dashboardUpdateProject(project_query=\"...\", progressPercent=80, status=\"Completed\")'.\n" +
        "   - MANAGING PRIORITY TASKS:\n" +
        "     * When MANISH asks to add a priority task (e.g. 'Add high priority task: study buffer overflow for 45 minutes', 'Add a task to review SQLi'): CALL 'dashboardAddTask(title=\"...\", priority=\"high\", estimatedMinutes=45, category=\"Cybersecurity\")'.\n" +
        "     * When MANISH asks to complete/finish a task (e.g. 'Mark SQL injection task as done', 'Complete task X'): CALL 'dashboardUpdateTask(task_query=\"...\", status=\"completed\")'.\n" +
        "     * When MANISH asks to change priority (e.g. 'Change task X priority to critical', 'Set priority of task X to low'): CALL 'dashboardUpdateTask(task_query=\"...\", priority=\"critical\")'.\n" +
        "     * When MANISH asks to remove/delete a task (e.g. 'Remove task X from my priority list'): CALL 'dashboardDeleteTask(task_query=\"...\")'.\n" +
        "     * When MANISH asks 'What are my priorities today?' or 'What projects am I working on?': CALL 'dashboardGetSummary()'.\n" +
        "14. REAL-TIME MULTIMODAL CAMERA & OBJECT VISION INTELLIGENCE:\n" +
        "   - You receive real-time camera video frames and visual snapshots streamed directly from MANISH's camera feed.\n" +
        "   - When MANISH asks questions about what he is showing to the camera:\n" +
        "     * 'What is this?', 'Tell me about this', 'What am I looking at?': Look closely at the current visual frame and immediately identify the physical object, device, book, gadget, or item with precision.\n" +
        "     * 'What does this text say?', 'Read this document': Perform optical character recognition on the text visible in the frame and summarize or read it aloud clearly.\n" +
        "     * 'Explain this diagram', 'What is this chart?': Identify the components, arrows, data flow, architecture, or topology in the diagram and explain it step-by-step.\n" +
        "     * 'What is this device?', 'How does this work?': Recognize electronics, microcontrollers (e.g. Raspberry Pi, ESP32, Arduino), network hardware (routers, switches, cables, adapters), PC peripherals, and tools.\n" +
        "     * 'Remember this': Call 'rememberVisualContext(summary=\"...\")' to persist a concise description of what was shown in the camera into your memory core.\n" +
        "     * 'Compare these two objects': Compare the visual features, models, ports, or text of both items in view.\n" +
        "   - Always speak directly and naturally about what you SEE in the live camera frames without hesitation or generic disclaimers.\n" +
        "15. WHITEBOARD & STUDY MODE (drawings, diagrams, teaching):\n" +
        "   - When MANISH asks you to 'draw', 'explain on the whiteboard', 'teach me X visually', 'show a diagram of X', 'sketch', or asks to understand a concept visually: CALL 'explainWithWhiteboard(topic=\"...\")' IMMEDIATELY! It plans a clean diagram and draws it element-by-element while you narrate.\n" +
        "   - NEVER just describe a diagram verbally when he asked you to DRAW — always invoke 'explainWithWhiteboard' (it auto-opens the board). Use 'openWhiteboard' alone ONLY when he wants a blank board.\n" +
        "   - While the drawing streams in, narrate what each part shows ('Now I'm labeling the encoder stack…').\n" +
        "   - Extra elements mid-lesson: 'drawOnWhiteboard'. Wipe: 'clearWhiteboard'. When he says save/export the board: 'saveWhiteboard(name=\"...\")' — saved as PNG in Pictures/BellaBoards. Close with 'closeWhiteboard' when done teaching.\n" +
        "   - Great triggers: 'explain how a transformer works, draw it', 'diagram the water cycle', 'teach me sorting with a whiteboard'.\n";

      const activeProactiveSuggestions = proactiveEngine.getActiveSuggestions();
      let proactiveContextBlock = "";
      if (activeProactiveSuggestions.length > 0) {
        proactiveContextBlock = "\n\n=== ACTIVE PROACTIVE SUGGESTIONS (CONTEXT ONLY) ===\n" +
          activeProactiveSuggestions.map(s => `- [${s.category.toUpperCase()}] ${s.title}: ${s.message} (Why: ${s.explanation})`).join("\n") +
          "\n(Mention these only if naturally relevant to the current conversation)\n===================================================\n";
      }

      const finalInstructions = formatSystemInstructions(
        baseInstructions +
        promptSkillsBlock() +
        activityContextBlock() +
        (isGuestMode()
          ? "\n\n=== CURRENT SITUATION: GUEST SESSION ===\nThe person speaking right now is NOT MANISH — your Voice Guardian identified them as a guest. Stay polite and helpful with GENERAL tasks, but do not share personal memories, private data or perform sensitive actions (those tools are already restricted for this session).\n=== END GUEST NOTICE ==="
          : "") +
        proactiveContextBlock,
        memories,
        {
          isFirstActivation,
          activationCount: sessionState.activationCount,
          dialogueHistory: sessionState.dialogueHistory
        },
      );

      let currentModelResponseText = "";

      const functionDeclarations = [
                {
                  name: "browserOpen",
                  description: "Opens a designated website URL or interface tab inside Bella's web agent console.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: {
                        type: Type.STRING,
                        description: "The destination website address or path, e.g. youtube.com, google.com, instagram.com, wikipedia.org."
                      }
                    },
                    required: ["url"]
                  }
                },
                {
                  name: "browserSearch",
                  description: "Enters a query search term inside the active website's search box (Google Search or YouTube Search).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: {
                        type: Type.STRING,
                        description: "The text query term to search for."
                      }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "browserClick",
                  description: "Traces computer cursor and clicks on a target button, link, or video cell ID inside the active webpage viewport.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      selector: {
                        type: Type.STRING,
                        description: "The selector target ID, e.g. 'video-mWRsgZjdfQI' for a video, 'search-result-0' for Google link index, or 'play-button', 'pause-button'."
                      },
                      description: {
                        type: Type.STRING,
                        description: "A short, friendly label description of the item being clicked, e.g. 'Imagine Dragons - Believer video element'."
                      }
                    },
                    required: ["selector"]
                  }
                },
                {
                  name: "browserMediaControl",
                  description: "Controls ongoing video/audio stream media properties on YouTube, like play, pause, volume, mute, skip, and fullscreen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "The media controller command operation.",
                        enum: ["play", "pause", "volume", "fullscreen", "exit_fullscreen", "mute", "unmute", "skip"]
                      },
                      value: {
                        type: Type.INTEGER,
                        description: "The value parameter; only relevant for set volume level, e.g. 50 for fifty percent."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "browserScroll",
                  description: "Scrolls the currently active webpage vertically up or down.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      direction: {
                        type: Type.STRING,
                        description: "The scroll vector movement.",
                        enum: ["up", "down"]
                      },
                      amount: {
                        type: Type.INTEGER,
                        description: "The distance height parameter in pixels (defaults to 300)."
                      }
                    }
                  }
                },
                {
                  name: "browserType",
                  description: "Enters typed letters/commands inside the active input container.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      text: {
                        type: Type.STRING,
                        description: "The exact letters to type in."
                      }
                    },
                    required: ["text"]
                  }
                },
                {
                  name: "browserGoBack",
                  description: "Navigates back to the previous webpage inside the current tab memory history.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "browserTabAction",
                  description: "Performs standard browser-tab actions: open new tab, close a tab, or switch index values.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "Tab action instruction.",
                        enum: ["new", "close", "switch"]
                      },
                      tabId: {
                        type: Type.STRING,
                        description: "The tab identifier string if closing or switching."
                      },
                      url: {
                        type: Type.STRING,
                        description: "The initial starting URL if creating a new tab."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "changeBackground",
                  description: "Changes the visual theme or atmospheric glow color of Bella's interface.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      color: {
                        type: Type.STRING,
                        description: "The theme color name (violet, crimson, emerald, celestial, gold, rose, charcoal)"
                      }
                    },
                    required: ["color"]
                  }
                },
                {
                  name: "saveCustomMemory",
                  description: "Allows Bella to immediately save a piece of critical user information to her persistent memory core.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: "The memory category.",
                        enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                      },
                      text: {
                        type: Type.STRING,
                        description: "Precise third-person statement."
                      }
                    },
                    required: ["category", "text"]
                  }
                },
                {
                  name: "startScreenShare",
                  description: "Trigger and start real-time screen sharing so Bella can see the user's screen in real time through multimodal vision.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "stopScreenShare",
                  description: "Stop ongoing screen sharing.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // ======== PERSONAL INTELLIGENCE & CONTEXT COMPANION TOOLS ========
                {
                  name: "explainProactiveReasoning",
                  description: "Explain transparently to MANISH why you asked a question, made a recommendation, or initiated a topic.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      topic: { type: Type.STRING, description: "The topic or action being explained." },
                      explanation: { type: Type.STRING, description: "Clear explanation of the contextual trigger." }
                    },
                    required: ["explanation"]
                  }
                },
                {
                  name: "confirmPersonalMemory",
                  description: "Ask MANISH to confirm saving an important preference, goal, habit, or workflow into memory.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      category: { type: Type.STRING, description: "Memory category.", enum: ["preference", "interest", "goal", "habit", "workflow"] },
                      text: { type: Type.STRING, description: "The preference statement." }
                    },
                    required: ["category", "text"]
                  }
                },
                {
                  name: "requestPersonalRecommendation",
                  description: "Generate an uncertainty-aware recommendation for anime, media, tools, study topics, or project steps based on MANISH's preferences.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: "Type: 'anime', 'media', 'tool', 'learning_resource', 'project_step'." }
                    }
                  }
                },
                {
                  name: "dismissProactiveTopic",
                  description: "Dismiss or mute a proactive topic if MANISH indicates he is not interested or asks not to talk about it.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      topicTag: { type: Type.STRING, description: "The topic tag to mute." }
                    },
                    required: ["topicTag"]
                  }
                },
                {
                  name: "queryTemporalMemory",
                  description: "Look up what MANISH and you worked on an hour ago, earlier today, yesterday, past days, or retrieve previous decisions, completed milestones, and encountered problems.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "Natural query (e.g. 'what did we do an hour ago', 'what were we working on yesterday', 'continue where we stopped', 'what did we decide earlier', 'what problems did we encounter')." },
                      project: { type: Type.STRING, description: "Optional project name filter." }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "setCameraVisionMode",
                  description: "Control user's camera vision mode: 'OFF', 'SNAPSHOT', 'CONVERSATION', or 'REAL-TIME'. Use when user asks to turn on/off camera, inspect an object, or enter continuous vision mode.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      mode: { type: Type.STRING, description: "Vision mode: 'OFF', 'SNAPSHOT', 'CONVERSATION', 'REAL-TIME'.", enum: ["OFF", "SNAPSHOT", "CONVERSATION", "REAL-TIME"] }
                    },
                    required: ["mode"]
                  }
                },
                {
                  name: "rememberVisualContext",
                  description: "Store a structured textual summary of what the user showed to the camera into conversational visual memory without saving raw video files. Use when user says 'Remember this' or asks you to remember an object/document.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      summary: { type: Type.STRING, description: "Concise summary of the visual subject (e.g. 'User is assembling a Raspberry Pi 4 network bridge with dual NICs')." },
                      subject: { type: Type.STRING, description: "Subject category (e.g. 'device', 'diagram', 'document', 'cybersecurity', 'code_error')." }
                    },
                    required: ["summary"]
                  }
                },
                {
                  name: "analyzeVisualDiagram",
                  description: "Focus visual analysis on explaining diagrams, architecture charts, network topologies, or code error screenshots.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      diagramType: { type: Type.STRING, description: "Type: 'network_topology', 'architecture', 'flowchart', 'code_error', 'hardware_schematic'." },
                      question: { type: Type.STRING, description: "User's specific inquiry about the diagram." }
                    },
                    required: ["diagramType"]
                  }
                },

                // ======== PERSONAL AI DASHBOARD MANAGEMENT TOOLS ========
                {
                  name: "dashboardAddTask",
                  description: "Add a priority task or todo item to the user's dashboard and focus list.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING, description: "Title or summary of the task to add." },
                      category: { type: Type.STRING, description: "Category name (e.g. 'Cybersecurity', 'Coding', 'Study', 'Personal', 'Inbox')." },
                      priority: { type: Type.STRING, description: "Priority level: 'critical', 'high', 'medium', or 'low'.", enum: ["critical", "high", "medium", "low"] },
                      estimatedMinutes: { type: Type.INTEGER, description: "Estimated duration in minutes (e.g. 15, 30, 45, 60, 90)." }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "dashboardUpdateTask",
                  description: "Update an existing task in the dashboard (e.g. change priority, mark completed/done, change status, or edit title).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      task_query: { type: Type.STRING, description: "Task title keywords or ID to locate the task." },
                      status: { type: Type.STRING, description: "Status: 'completed' or 'pending'.", enum: ["completed", "pending"] },
                      priority: { type: Type.STRING, description: "New priority: 'critical', 'high', 'medium', 'low'.", enum: ["critical", "high", "medium", "low"] },
                      title: { type: Type.STRING, description: "Updated task title." },
                      category: { type: Type.STRING, description: "Updated task category." }
                    },
                    required: ["task_query"]
                  }
                },
                {
                  name: "dashboardDeleteTask",
                  description: "Remove / delete a task from the user's dashboard priorities.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      task_query: { type: Type.STRING, description: "Task title keywords or ID to remove." }
                    },
                    required: ["task_query"]
                  }
                },
                {
                  name: "dashboardAddProject",
                  description: "Add a new active project to the user's dashboard and projects tracker.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "Project name." },
                      description: { type: Type.STRING, description: "Project description and scope." },
                      status: { type: Type.STRING, description: "Project status.", enum: ["Active", "On Track", "At Risk", "Blocked", "Completed", "Paused"] },
                      progressPercent: { type: Type.INTEGER, description: "Initial completion percentage 0-100." },
                      currentMilestone: { type: Type.STRING, description: "Current milestone or next deliverable." },
                      deadline: { type: Type.STRING, description: "Target deadline string." }
                    },
                    required: ["name"]
                  }
                },
                {
                  name: "dashboardUpdateProject",
                  description: "Update an active project in the dashboard (change progress percentage, update status, change milestone).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      project_query: { type: Type.STRING, description: "Project name keywords or ID to locate." },
                      progressPercent: { type: Type.INTEGER, description: "New progress percentage 0-100." },
                      status: { type: Type.STRING, description: "New status.", enum: ["Active", "On Track", "At Risk", "Blocked", "Completed", "Paused"] },
                      currentMilestone: { type: Type.STRING, description: "Updated current milestone." },
                      nextTask: { type: Type.STRING, description: "Updated next task deliverable." }
                    },
                    required: ["project_query"]
                  }
                },
                {
                  name: "dashboardDeleteProject",
                  description: "Remove / delete an active project from the dashboard.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      project_query: { type: Type.STRING, description: "Project name keywords or ID to remove." }
                    },
                    required: ["project_query"]
                  }
                },
                {
                  name: "dashboardGetSummary",
                  description: "Retrieve current priorities, active projects, and learning status from the dashboard.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },

                // ======== DESKTOP CONTROL TOOLS (routed to Python agent) ========
                // ======== DESKTOP CONTROL TOOLS (Native Windows & Desktop Control) ========
                {
                  name: "openApplication",
                  description: "Open any desktop application installed on the PC (e.g. Notion, Spotify, Discord, VS Code, Chrome, Brave, Notepad, Calculator, WhatsApp, File Explorer, Telegram, Word, Excel, Terminal).",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name, e.g. 'Notion', 'Spotify', 'Notepad', 'VS Code', 'Discord', 'Calculator', 'Chrome'." } }, required: ["name"] }
                },
                {
                  name: "closeApplication",
                  description: "Close a running desktop application by name (e.g. 'Notion', 'Spotify', 'Notepad').",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name." }, force: { type: Type.BOOLEAN, description: "Force close (default false)." } }, required: ["name"] }
                },
                {
                  name: "openWebsite",
                  description: "Open any website, URL, or web service (e.g. 'wikipedia', 'facebook', 'instagram', 'twitter', 'reddit', 'youtube', 'github', 'chatgpt', 'netflix', 'amazon', 'gmail', etc.) in the user's default browser.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "Website or service name (e.g. 'wikipedia', 'facebook', 'instagram', 'twitter', 'reddit')." },
                      url: { type: Type.STRING, description: "Full URL or domain (e.g. 'https://wikipedia.org' or 'facebook.com')." }
                    }
                  }
                },
                {
                  name: "searchWeb",
                  description: "Search a website engine (google, youtube, github, duckduckgo, bing) and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine name (default 'google')." } }, required: ["query"] }
                },
                {
                  name: "searchYouTube",
                  description: "Search YouTube and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGoogle",
                  description: "Search Google and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGitHub",
                  description: "Search GitHub repositories and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "createFile",
                  description: "Create a new text file or email/note document with plain text content. Automatically saves to Desktop by default.",
                  parameters: { 
                    type: Type.OBJECT, 
                    properties: { 
                      path: { type: Type.STRING, description: "File path (e.g. 'Desktop/email.txt' or 'email.txt')." }, 
                      content: { type: Type.STRING, description: "The plain readable text content to write (e.g. the email body, letter text, or notes). Must be plain readable text, NEVER base64, audio data, or binary tokens." }, 
                      overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists (default true)." } 
                    }, 
                    required: ["path", "content"] 
                  }
                },
                {
                  name: "readFile",
                  description: "Read the contents of a text file.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, max_chars: { type: Type.INTEGER, description: "Max chars to return (default 8000)." } }, required: ["path"] }
                },
                {
                  name: "getFileProperties",
                  description: "Get file properties & details (file size formatted, created date, modified date, extension, path, isDirectory).",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Path or name of the file." } }, required: ["path"] }
                },
                {
                  name: "copyFile",
                  description: "Copy a file from one path/folder to another destination.",
                  parameters: { type: Type.OBJECT, properties: { source: { type: Type.STRING, description: "Source file path." }, destination: { type: Type.STRING, description: "Destination file path or folder." } }, required: ["source", "destination"] }
                },
                {
                  name: "renameFile",
                  description: "Rename a file.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Current file path." }, new_name: { type: Type.STRING, description: "New file name." } }, required: ["path", "new_name"] }
                },
                {
                  name: "deleteFile",
                  description: "Delete a file. Sends to Recycle Bin by default (safe). Use permanent=true for hard delete.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, permanent: { type: Type.BOOLEAN, description: "Permanently delete (default false)." } }, required: ["path"] }
                },
                {
                  name: "moveFile",
                  description: "Move a file to a new location.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Source file path." }, destination: { type: Type.STRING, description: "Destination path or folder." } }, required: ["path", "destination"] }
                },
                {
                  name: "openFolder",
                  description: "Open a folder in File Explorer. Supports aliases: desktop, documents, downloads, pictures, music, videos, home, or any path.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Folder name or alias (e.g. 'desktop', 'downloads', 'documents')." }, path: { type: Type.STRING, description: "Full path if custom." } } }
                },
                {
                  name: "listFiles",
                  description: "List files in a folder.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Folder name or alias." }, path: { type: Type.STRING, description: "Full path." }, pattern: { type: Type.STRING, description: "Glob pattern (default '*')." } } }
                },
                {
                  name: "searchFiles",
                  description: "Search for files by name or query across Desktop, Downloads, and Documents.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Filename search query or keyword." }, folder: { type: Type.STRING, description: "Folder to search (default Desktop)." } }, required: ["query"] }
                },
                {
                  name: "typeText",
                  description: "Type/write text directly into the currently active/focused window (e.g. write into Notion, Notepad, browser, document).",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "The plain text to type into the active window." } }, required: ["text"] }
                },
                {
                  name: "pasteClipboard",
                  description: "Paste text into the active input. Writes text to clipboard then sends Ctrl+V.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to paste. If omitted, pastes current clipboard." } } }
                },
                {
                  name: "volumeUp",
                  description: "Increase system volume.",
                  parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "volumeDown",
                  description: "Decrease system volume.",
                  parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "setVolume",
                  description: "Set system volume to a specific percentage.",
                  parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER, description: "Volume percentage 0-100." } }, required: ["percent"] }
                },
                {
                  name: "muteToggle",
                  description: "Toggle mute/unmute on the system volume.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "changeSong",
                  description: "Change the currently playing song in the browser, play a new song on YouTube, or skip to the next track. If query is provided, searches and plays that song on YouTube in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Song name, artist, or music title to play (e.g. 'Arijit Singh song', 'Kesariya', 'Levitating'). Optional if skipping." } } }
                },
                {
                  name: "skipSong",
                  description: "Skip to the next song or track in YouTube or Spotify playing in the browser or PC.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "mediaNextTrack",
                  description: "Skip to the next song, video, or track in YouTube, Spotify, or the active browser media player.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "mediaPrevTrack",
                  description: "Go back to the previous song, video, or track in YouTube, Spotify, or the active browser media player.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "mediaPlayPause",
                  description: "Toggle play/pause for the active song, music, or video playing in the browser or media player.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "mediaStop",
                  description: "Stop media playback on the PC.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "leftClick",
                  description: "Perform a left mouse click at the current cursor position or optional (x, y) coordinates on screen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER, description: "Optional X coordinate on screen." },
                      y: { type: Type.NUMBER, description: "Optional Y coordinate on screen." }
                    }
                  }
                },
                {
                  name: "rightClick",
                  description: "Perform a right mouse click (context menu) at current cursor position or optional (x, y) coordinates on screen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER, description: "Optional X coordinate on screen." },
                      y: { type: Type.NUMBER, description: "Optional Y coordinate on screen." }
                    }
                  }
                },
                {
                  name: "doubleClick",
                  description: "Perform a double left click at current cursor position or optional (x, y) coordinates.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER, description: "Optional X coordinate." },
                      y: { type: Type.NUMBER, description: "Optional Y coordinate." }
                    }
                  }
                },
                {
                  name: "mouseMove",
                  description: "Move the mouse cursor to specific (x, y) coordinates.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER, description: "Target X screen coordinate." },
                      y: { type: Type.NUMBER, description: "Target Y screen coordinate." }
                    },
                    required: ["x", "y"]
                  }
                },
                {
                  name: "mouseScroll",
                  description: "Scroll the mouse wheel up or down.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      direction: { type: Type.STRING, description: "'up' or 'down'" },
                      amount: { type: Type.NUMBER, description: "Amount of scroll units (default 300)." }
                    }
                  }
                },
                {
                  name: "pressEnter",
                  description: "Press the Enter / Return key in the currently active window or browser input.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "pressKey",
                  description: "Press a specific key on the keyboard (e.g. 'enter', 'esc', 'tab', 'space', 'backspace', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'f1'-'f12').",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      key: { type: Type.STRING, description: "The key name to press." }
                    },
                    required: ["key"]
                  }
                },
                {
                  name: "previousTab",
                  description: "Switch to the previous tab in the active web browser (Ctrl+Shift+Tab / Ctrl+PageUp).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "nextTab",
                  description: "Switch to the next tab in the active web browser (Ctrl+Tab / Ctrl+PageDown).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "browserBack",
                  description: "Go back to the previous page in browser history (Alt+Left).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "browserForward",
                  description: "Go forward to the next page in browser history (Alt+Right).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "newTab",
                  description: "Open a new browser tab (Ctrl+T).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "closeTab",
                  description: "Close the currently active browser tab (Ctrl+W).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "executeComputerAction",
                  description: "Execute a structured computer action (mouse, keyboard, window, or semantic browser automation).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      type: {
                        type: Type.STRING,
                        description: "Action type: mouse.move, mouse.click, mouse.doubleClick, mouse.rightClick, mouse.drag, mouse.scroll, keyboard.type, keyboard.press, keyboard.hotkey, app.open, app.close, window.minimize, window.maximize, window.restore, window.focus, window.switch, browser.navigate, browser.click, browser.type, browser.select, browser.submit, browser.wait, browser.inspect, browser.read, browser.screenshot."
                      },
                      target: { type: Type.STRING, description: "Target selector, application name, key, or URL." },
                      value: { type: Type.STRING, description: "Text value, key name, or dropdown option value." },
                      x: { type: Type.NUMBER, description: "Optional X coordinate for mouse actions." },
                      y: { type: Type.NUMBER, description: "Optional Y coordinate for mouse actions." }
                    },
                    required: ["type"]
                  }
                },
                {
                  name: "batchComputerActions",
                  description: "Execute a sequence of computer actions sequentially with error handling.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      actions: {
                        type: Type.ARRAY,
                        items: { type: Type.OBJECT },
                        description: "Array of ComputerAction objects to execute in sequence."
                      }
                    },
                    required: ["actions"]
                  }
                },
                {
                  name: "requestPowerAction",
                  description: "FIRST STEP for dangerous power actions. Generates a confirmation token. Tell the user verbally, then call executePowerAction with the token if they confirm. Actions: shutdown, restart, sleep, lock.",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "Power action: shutdown, restart, sleep, lock." } }, required: ["action"] }
                },
                {
                  name: "executePowerAction",
                  description: "SECOND STEP: execute a previously-confirmed power action. Requires a valid execute_token from requestPowerAction. Single-use, expires in 60 seconds.",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "The confirmed power action." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestPowerAction." } }, required: ["action", "execute_token"] }
                },
                {
                  name: "minimizeWindow",
                  description: "Minimize the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match (optional, defaults to active window)." } } }
                },
                {
                  name: "maximizeWindow",
                  description: "Maximize the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "closeWindow",
                  description: "Close the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "switchApplication",
                  description: "Switch to a named application window, or cycle Alt+Tab if no title given.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to switch to." } } }
                },
                {
                  name: "copySelected",
                  description: "Copy selected text: sends Ctrl+C and reads the clipboard.",
                  parameters: { type: Type.OBJECT, properties: { wait: { type: Type.NUMBER, description: "Seconds to wait after Ctrl+C (default 0.35)." } } }
                },
                {
                  name: "getClipboard",
                  description: "Read the current clipboard text content.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max chars (default 1000)." } } }
                },
                {
                  name: "clearClipboard",
                  description: "Empty the clipboard.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "takeScreenshot",
                  description: "Capture the full screen. Optionally include base64 image data.",
                  parameters: { type: Type.OBJECT, properties: { include_image: { type: Type.BOOLEAN, description: "Include base64 JPEG image (default false)." }, max_dim: { type: Type.INTEGER, description: "Max image dimension (default 1280)." } } }
                },
                {
                  name: "saveScreenshot",
                  description: "Save a full screen capture directly as a PNG file into the user's Downloads folder. If the user asks for a screenshot without giving a name, ask them what name to save it as, or pass their chosen name.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "The filename (e.g. 'dashboard', 'error_log', 'notes') to save in the Downloads folder." } } }
                },
                {
                  name: "analyzeScreenshot",
                  description: "Take a screenshot and run OCR to extract visible text from the screen.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "readScreen",
                  description: "OCR the active window and return its title plus visible text.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "desktopBrowserOpen",
                  description: "Open a URL in the desktop Playwright automation browser (real Chromium, separate from holographic UI).",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL to open." } }, required: ["url"] }
                },
                {
                  name: "desktopBrowserSearch",
                  description: "Search within the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine: google, youtube, github, duckduckgo, bing." } }, required: ["query"] }
                },
                {
                  name: "desktopBrowserClick",
                  description: "Click an element in the desktop automation browser by CSS selector or text.",
                  parameters: { type: Type.OBJECT, properties: { selector: { type: Type.STRING, description: "CSS selector." }, text: { type: Type.STRING, description: "Text to find and click." } } }
                },
                {
                  name: "desktopBrowserType",
                  description: "Type text into the active element in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to type." }, selector: { type: Type.STRING, description: "Optional CSS selector for a specific input." }, clear: { type: Type.BOOLEAN, description: "Clear before typing (default true)." } }, required: ["text"] }
                },
                {
                  name: "desktopBrowserFillForm",
                  description: "Fill multiple form fields and optionally submit in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { fields: { type: Type.OBJECT, description: "Object of selector -> value pairs." }, submit: { type: Type.STRING, description: "Optional submit button selector." } }, required: ["fields"] }
                },
                {
                  name: "desktopBrowserOpenTab",
                  description: "Open a new tab in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL for the new tab." } } }
                },
                {
                  name: "desktopBrowserCloseTab",
                  description: "Close the active tab in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoBack",
                  description: "Navigate back in the desktop automation browser history.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoForward",
                  description: "Navigate forward in the desktop automation browser history.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserScroll",
                  description: "Scroll the desktop automation browser page.",
                  parameters: { type: Type.OBJECT, properties: { direction: { type: Type.STRING, description: "Scroll direction: up or down." }, amount: { type: Type.INTEGER, description: "Pixels to scroll (default 500)." } } }
                },
                {
                  name: "createPythonFile",
                  description: "Create a Python (.py) file with plain Python code content.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "Plain text Python source code." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path", "content"] }
                },
                {
                  name: "writeCodeFile",
                  description: "Create a code file in any language with plain text code content.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "Plain text code content." }, language: { type: Type.STRING, description: "Language name (e.g. 'python', 'javascript', 'html')." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path", "content"] }
                },
                {
                  name: "createProjectFolder",
                  description: "Create a project folder structure with optional subfolders and starter files.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Project root folder path." }, subfolders: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of subfolder names." }, scaffold_standard: { type: Type.BOOLEAN, description: "Create src, tests, docs subfolders." }, files: { type: Type.OBJECT, description: "Object of relative-path -> content for starter files." } }, required: ["path"] }
                },
                {
                  name: "runPythonScript",
                  description: "Execute a Python script and capture stdout, stderr, and exit code. Has a configurable timeout.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Script path." }, args: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Script arguments." }, timeout: { type: Type.INTEGER, description: "Timeout in seconds (default 30)." } }, required: ["path"] }
                },
                {
                  name: "systemInfo",
                  description: "Get system resource usage: CPU %, RAM %, disk usage, uptime, OS info.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "gpuInfo",
                  description: "Get NVIDIA GPU stats: utilization %, VRAM usage, temperature. Graceful fallback if no NVIDIA GPU.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "temperatureInfo",
                  description: "Get available temperature readings (CPU, GPU, etc.). Best-effort on Windows.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // --- V2: Brightness control ---
                {
                  name: "brightnessUp",
                  description: "Increase screen brightness by a step (default 10%). Use when user says 'increase brightness' or 'make screen brighter'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER, description: "Percentage to increase (default 10)." }
                    }
                  }
                },
                {
                  name: "brightnessDown",
                  description: "Decrease screen brightness by a step (default 10%). Use when user says 'decrease brightness' or 'dim screen'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER, description: "Percentage to decrease (default 10)." }
                    }
                  }
                },
                {
                  name: "setBrightness",
                  description: "Set screen brightness to an exact level. Use when user says 'set brightness to 50%' or 'brightness 80'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      percent: { type: Type.NUMBER, description: "Target brightness 0-100." }
                    },
                    required: ["percent"]
                  }
                },
                // --- V2: Windows auto-start management ---
                {
                  name: "enableAutoStart",
                  description: "Enable BELLA to launch automatically when Windows starts. Creates a silent startup entry.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "disableAutoStart",
                  description: "Disable BELLA auto-start on Windows login. Removes the startup entry.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "getAutoStartStatus",
                  description: "Check whether BELLA is currently configured to auto-start on Windows login.",
                  parameters: { type: Type.OBJECT, properties: {} }
                }
      ];

      // Voice Guardian: guests get a restricted toolset while armed.
      const effectiveDeclarations = filterDeclarationsForGuest([
        ...(functionDeclarations as any[]),
        ...bellaDeclarations,
      ]);

      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: resolveVoice(persona) } },
          },
          systemInstruction: finalInstructions,
          tools: [
            {
              functionDeclarations: effectiveDeclarations as any,
            }
          ]
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Audio Stream Chunks & Model Transcription (iterates through all parts)
            const modelParts = message.serverContent?.modelTurn?.parts;
            if (Array.isArray(modelParts)) {
              for (const part of modelParts) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
                }
                if (part.text) {
                  clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: part.text }));
                  currentModelResponseText += part.text;
                }
              }
            }
            
            // Interruption flag
            if (message.serverContent?.interrupted) {
              console.log("[Bella Interrupted!]");
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
            
            // Turn Complete
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
              
              if (currentModelResponseText.trim()) {
                sessionState.dialogueHistory.push({ role: "model", text: currentModelResponseText });
                temporalMemoryManager.recordConversationTurn("model", currentModelResponseText);
                currentModelResponseText = "";
                // Cap running history in memory to last 60 turns
                if (sessionState.dialogueHistory.length > 60) {
                  sessionState.dialogueHistory = sessionState.dialogueHistory.slice(-40);
                }
              }

              // Fire asynchronous memory extraction & temporal session consolidation
              if (sessionState.dialogueHistory.length >= 2) {
                (async () => {
                  try {
                    const updated = await processConversationSlice(apiKey, sessionState.dialogueHistory);
                    if (updated) {
                      console.log("[Memory Sync] Sending refreshed memory list to client.");
                      clientWs.send(JSON.stringify({ type: "memory_sync", memories: updated }));
                    }
                    await temporalMemoryManager.consolidateCurrentSession();
                  } catch (err) {
                    console.error("[Memory Sync] Error running background consolidation:", err);
                  }
                })();
              }
            }
            
            // User input transcription (user speech text translated by Gemini)
            const userParts = (message.serverContent as any)?.userTurn?.parts;
            if (Array.isArray(userParts)) {
              for (const part of userParts) {
                if (part.text) {
                  clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: part.text }));
                  sessionState.dialogueHistory.push({ role: "user", text: part.text });
                  temporalMemoryManager.recordConversationTurn("user", part.text);
                  if (sessionState.dialogueHistory.length > 60) {
                    sessionState.dialogueHistory = sessionState.dialogueHistory.slice(-40);
                  }
                }
              }
            }
            
            // Function Calls (Gemini requesting server/client tool execution)
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                console.log(`[Function Call]: ${fc.name}`, fc.args);
                
                if (fc.name === "saveCustomMemory") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const category = args.category;
                      const text = args.text;
                      if (category && text) {
                        const mList = await loadMemories();
                        const timestamp = new Date().toISOString();
                        const newMemory: Memory = {
                          id: Math.random().toString(36).substring(2, 11),
                          category,
                          text,
                          createdAt: timestamp,
                          updatedAt: timestamp
                        };
                        mList.push(newMemory);
                        await saveMemories(mList);
                        
                        // Sync immediately with the React client
                        clientWs.send(JSON.stringify({ type: "memory_sync", memories: mList }));
                        
                        // Send success code back to live link
                        session.sendToolResponse({
                          functionResponses: [
                            {
                              name: fc.name,
                              response: { output: { result: "Memory successfully captured and persisted in connections core." } },
                              id: fc.id
                            }
                          ]
                        });
                      }
                    } catch (err: any) {
                      console.error("saveCustomMemory execution failure:", err);
                    }
                  })();
                } else if (fc.name === "startScreenShare") {
                  (async () => {
                    try {
                      console.log("[Server] Sending start_screen_share command to client UI...");
                      clientWs.send(JSON.stringify({ type: "start_screen_share" }));
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: { result: "Screen sharing stream started. Visual frames are now streaming directly to vision model." } },
                            id: fc.id
                          }
                        ]
                      });
                    } catch (err: any) {
                      console.error("startScreenShare error:", err);
                    }
                  })();
                } else if (fc.name === "stopScreenShare") {
                  (async () => {
                    try {
                      console.log("[Server] Sending stop_screen_share command to client UI...");
                      clientWs.send(JSON.stringify({ type: "stop_screen_share" }));
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: { result: "Screen sharing stopped." } },
                            id: fc.id
                          }
                        ]
                      });
                    } catch (err: any) {
                      console.error("stopScreenShare error:", err);
                    }
                  })();
                } else if (fc.name === "explainProactiveReasoning") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const explanation = ExplainabilityEngine.explainAction({
                        type: "question",
                        contextSnippet: args.topic,
                        explanation: args.explanation
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { explanation } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("explainProactiveReasoning error:", err);
                    }
                  })();
                } else if (fc.name === "confirmPersonalMemory") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const memory = await piMemoryManager.addMemory({
                        category: args.category || "preference",
                        text: args.text,
                        confirmedByUser: true
                      });
                      clientWs.send(JSON.stringify({ type: "memory_sync", memories: await loadMemories() }));
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Remembered preference with confirmed status: "${memory.text}"`, memory } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("confirmPersonalMemory error:", err);
                    }
                  })();
                } else if (fc.name === "requestPersonalRecommendation") {
                  (async () => {
                    try {
                      const context = piContextEngine.getSnapshot();
                      const recs = await recommendationEngine.generateRecommendations(context, 2);
                      const top = recs[0];
                      const result = top
                        ? { title: top.title, reasoning: top.reasoning, description: top.description, disclaimer: top.uncertaintyDisclaimer }
                        : { result: "No specific match found right now, but exploring your interests!" };
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: result },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("requestPersonalRecommendation error:", err);
                    }
                  })();
                } else if (fc.name === "dismissProactiveTopic") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      await feedbackEngine.recordFeedback({
                        actionId: `act_${Date.now()}`,
                        actionType: "question",
                        topicTag: args.topicTag,
                        feedback: "never_ask_again"
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Got it! I won't bring up ${args.topicTag} again.` } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("dismissProactiveTopic error:", err);
                    }
                  })();
                } else if (fc.name === "queryTemporalMemory") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const memoryResult = await temporalMemoryManager.queryTemporalMemory(args.query || "", args.project);
                      const topAnswer = memoryResult.answers[0];
                      const output = topAnswer
                        ? {
                            found: true,
                            matchedDate: topAnswer.item.date,
                            reason: topAnswer.matchedReason,
                            title: topAnswer.item.title,
                            summary: topAnswer.item.summary,
                            decisions: topAnswer.item.decisions,
                            completedTasks: topAnswer.item.tasksCompleted,
                            problems: topAnswer.item.problemsEncountered,
                            activeProject: topAnswer.item.activeProject
                          }
                        : {
                            found: false,
                            result: "No specific past session match found for that timeframe or topic."
                          };

                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("queryTemporalMemory error:", err);
                    }
                  })();
                } else if (fc.name === "setCameraVisionMode") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const mode = args.mode || "CONVERSATION";
                      // Inform frontend client to change camera state
                      clientWs.send(JSON.stringify({ type: "camera_mode", mode }));
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Camera vision mode transitioned to ${mode}.` } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("setCameraVisionMode error:", err);
                    }
                  })();
                } else if (fc.name === "rememberVisualContext") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const summary = args.summary;
                      if (summary) {
                        const mList = await loadMemories();
                        const timestamp = new Date().toISOString();
                        const newMemory: Memory = {
                          id: Math.random().toString(36).substring(2, 11),
                          category: "preference",
                          text: `[Visual Memory]: ${summary}`,
                          createdAt: timestamp,
                          updatedAt: timestamp
                        };
                        mList.push(newMemory);
                        await saveMemories(mList);
                        clientWs.send(JSON.stringify({ type: "memory_sync", memories: mList }));
                      }
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: "Visual observation permanently remembered in connection memory." } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("rememberVisualContext error:", err);
                    }
                  })();
                } else if (fc.name === "analyzeVisualDiagram") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const frame = latestFrameBase64;
                      if (!frame) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "I can't see anything right now — start screen share or camera vision first, then ask me again." } },
                            id: fc.id
                          }]
                        });
                        return;
                      }
                      const analysis = await analyzeImage(
                        apiKey,
                        frame,
                        `Analyze this ${args.diagramType || "visual"} in detail: identify components, labels, arrows/data flow and explain what it shows step by step.`,
                      );
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: analysis || "I looked at it but couldn't extract details — try bringing it closer or increasing brightness." } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error("analyzeVisualDiagram error:", err);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Diagram analysis failed: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fc.name === "executeComputerAction") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const actionObj = {
                        type: args.type,
                        target: args.target,
                        value: args.value,
                        coordinates: (args.x !== undefined && args.y !== undefined) ? { x: args.x, y: args.y } : undefined,
                        parameters: args.parameters || (args.keys ? { keys: args.keys } : {})
                      };
                      const actionResult = await computerActionEngine.execute(actionObj);
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: actionResult },
                            id: fc.id
                          }
                        ]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: { success: false, error: err.message } },
                            id: fc.id
                          }
                        ]
                      });
                    }
                  })();
                } else if (fc.name === "batchComputerActions") {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const actionsList = Array.isArray(args.actions) ? args.actions : [];
                      const batchResults = await computerActionEngine.executeBatch(actionsList);
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: { success: batchResults.every(r => r.success), results: batchResults } },
                            id: fc.id
                          }
                        ]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: { success: false, error: err.message } },
                            id: fc.id
                          }
                        ]
                      });
                    }
                  })();
                } else if (fc.name.startsWith("dashboard")) {
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      let toolResultOutput: any = { result: "Done." };

                      if (fc.name === "dashboardAddTask") {
                        const newTask = await contextEngine.addTask({
                          title: args.title,
                          category: args.category || "Inbox",
                          priority: args.priority || "medium",
                          status: "pending",
                          estimatedMinutes: args.estimatedMinutes || 30,
                        });
                        toolResultOutput = { result: `Task "${newTask.title}" added to dashboard priorities with priority ${newTask.priority}.`, task: newTask };
                      } else if (fc.name === "dashboardUpdateTask") {
                        const taskToUpdate = contextEngine.findTaskByQuery(args.task_query || "");
                        if (taskToUpdate) {
                          const patch: any = {};
                          if (args.status) patch.status = args.status;
                          if (args.priority) patch.priority = args.priority;
                          if (args.title) patch.title = args.title;
                          if (args.category) patch.category = args.category;
                          const updated = await contextEngine.updateTask(taskToUpdate.id, patch);
                          toolResultOutput = { result: `Updated task "${updated?.title}": priority is now ${updated?.priority}, status is ${updated?.status}.`, task: updated };
                        } else {
                          toolResultOutput = { result: `Could not find a task matching "${args.task_query}".` };
                        }
                      } else if (fc.name === "dashboardDeleteTask") {
                        const taskToDelete = contextEngine.findTaskByQuery(args.task_query || "");
                        if (taskToDelete) {
                          await contextEngine.deleteTask(taskToDelete.id);
                          toolResultOutput = { result: `Removed task "${taskToDelete.title}" from dashboard priorities.` };
                        } else {
                          toolResultOutput = { result: `Could not find a task matching "${args.task_query}" to delete.` };
                        }
                      } else if (fc.name === "dashboardAddProject") {
                        const newProject = await contextEngine.addProject({
                          name: args.name,
                          description: args.description || "",
                          status: args.status || "Active",
                          progressPercent: args.progressPercent !== undefined ? args.progressPercent : 10,
                          currentMilestone: args.currentMilestone,
                          deadline: args.deadline,
                          tasksCount: 0,
                          openTasksCount: 0,
                        });
                        toolResultOutput = { result: `Created project "${newProject.name}" with status ${newProject.status} and ${newProject.progressPercent}% progress.`, project: newProject };
                      } else if (fc.name === "dashboardUpdateProject") {
                        const projToUpdate = contextEngine.findProjectByQuery(args.project_query || "");
                        if (projToUpdate) {
                          const patch: any = {};
                          if (args.status) patch.status = args.status;
                          if (args.progressPercent !== undefined) patch.progressPercent = args.progressPercent;
                          if (args.currentMilestone) patch.currentMilestone = args.currentMilestone;
                          if (args.nextTask) patch.nextTask = args.nextTask;
                          const updated = await contextEngine.updateProject(projToUpdate.id, patch);
                          toolResultOutput = { result: `Updated project "${updated?.name}": progress is now ${updated?.progressPercent}%, status is ${updated?.status}.`, project: updated };
                        } else {
                          toolResultOutput = { result: `Could not find a project matching "${args.project_query}".` };
                        }
                      } else if (fc.name === "dashboardDeleteProject") {
                        const projToDelete = contextEngine.findProjectByQuery(args.project_query || "");
                        if (projToDelete) {
                          await contextEngine.deleteProject(projToDelete.id);
                          toolResultOutput = { result: `Removed project "${projToDelete.name}" from active projects.` };
                        } else {
                          toolResultOutput = { result: `Could not find a project matching "${args.project_query}" to delete.` };
                        }
                      } else if (fc.name === "dashboardGetSummary") {
                        const summary = await contextEngine.getDashboardSummary("Manish");
                        toolResultOutput = {
                          greeting: summary.greeting,
                          briefing: summary.aiBriefing.summary,
                          activeProjectsCount: summary.activeProjects.length,
                          projects: summary.activeProjects.map(p => `${p.name} (${p.status}, ${p.progressPercent}%)`),
                          tasks: summary.todayFocus.map(t => `${t.title} [${t.priority}, ${t.status}]`),
                        };
                      }

                      // Emit real-time sync event to client UI
                      try {
                        clientWs.send(JSON.stringify({ type: "dashboard_sync" }));
                      } catch {}

                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: toolResultOutput },
                            id: fc.id
                          }
                        ]
                      });
                    } catch (err: any) {
                      console.error(`Error in ${fc.name}:`, err);
                      session.sendToolResponse({
                        functionResponses: [
                          {
                            name: fc.name,
                            response: { output: { error: err?.message || String(err) } },
                            id: fc.id
                          }
                        ]
                      });
                    }
                  })();
                } else if (isBellaTool(fc.name)) {
                  // ── BELLA 6.0 capability modules (personas, scheduler, macros,
                  //    documents, agents, comms, creator, skills, guardian…) ──
                  (async () => {
                    try {
                      const output = await executeBellaTool(fc.name, (fc.args || {}) as Record<string, unknown>, {
                        apiKey,
                        clientWs: clientWs as any,
                        sessionId,
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      console.error(`[Bella 6.0] ${fc.name} failed:`, err);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `That didn't work: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (DESKTOP_TOOLS.has(fc.name)) {
                  // ── Desktop control tools: route to Python agent ──
                  (async () => {
                    console.log(`[Desktop Agent] Routing ${fc.name} to Python backend...`);
                    const agentResult = await callDesktopAgent(fc.name, fc.args as Record<string, unknown>);

                    if (agentResult.ok) {
                      if (fc.name === "openApplication" || fc.name === "openWebsite" || fc.name === "searchYouTube") {
                        try {
                          clientWs.send(JSON.stringify({ type: "mini_mode", enabled: true }));
                        } catch {}
                      }
                      recordStep(fc.name, (fc.args as Record<string, unknown>) || {}); // macro capture
                      const output = agentResult.result ?? { result: "Done." };
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output },
                          id: fc.id
                        }]
                      });
                    } else {
                      const errMsg = agentResult.error || "Desktop agent error.";
                      console.error(`[Desktop Agent] Error for ${fc.name}:`, errMsg);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Desktop control error: ${errMsg}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else {
                  // ── SERVER-SIDE GUARDRAIL: intercept browserOpen("youtube.com") ──
                  // YouTube blocks iframes. If Bella tries to open youtube.com root,
                  // silently rewrite it as a browserSearch so the embed player works.
                  let dispatchName = fc.name;
                  let dispatchArgs: any = fc.args;

                  if (fc.name === "browserOpen") {
                    const rawUrl: string = (fc.args as any)?.url || "";
                    try {
                      const parsed = new URL(rawUrl);
                      const isYtRoot = parsed.hostname.includes("youtube.com") &&
                        !parsed.searchParams.has("v") &&
                        (parsed.pathname === "/" || parsed.pathname === "" ||
                         parsed.pathname === "/feed/subscriptions" ||
                         parsed.pathname === "/feed/trending");

                      if (isYtRoot) {
                        // Extract song/query hint from recent user speech
                        const recentUserLines = sessionState.dialogueHistory
                          .filter(d => d.role === "user")
                          .slice(-3)
                          .map(d => d.text)
                          .join(" ");

                        // Strip common intent words to isolate the song name
                        const songHint = recentUserLines
                          .replace(/open|play|start|launch|youtube|song|music|video|please|can you|i want|on/gi, "")
                          .replace(/\s+/g, " ")
                          .trim();

                        console.log(`[YouTube Intercept] Rewriting browserOpen → browserSearch, query="${songHint || "top songs"}"`);
                        dispatchName = "browserSearch";
                        dispatchArgs = { query: (songHint || "top songs") + " youtube" };
                      }
                    } catch { /* non-URL, pass through */ }
                  }

                  clientWs.send(JSON.stringify({
                    type: "toolCall",
                    callId: fc.id,
                    name: dispatchName,
                    args: dispatchArgs
                  }));
                }
              }
            }
          },
          onerror: (err: any) => {
            console.error("[Gemini Live Session Error]:", err);
            if (activeKeyObj) {
              const failover = geminiKeyPool.reportFailure(activeKeyObj.id, err);
              if (failover.switched && failover.nextKey) {
                console.log(`[KeyPool Failover] Switched from "${activeKeyObj.name}" to "${failover.nextKey.name}".`);
                clientWs.send(JSON.stringify({
                  type: "key_failover",
                  fromKey: activeKeyObj.name,
                  toKey: failover.nextKey.name
                }));
              }
            }
            clientWs.send(JSON.stringify({ type: "error", error: err?.message || String(err) }));
          },
          onclose: (e: any) => {
            const reason = e?.reason || e || "Normal closure";
            console.log("[Gemini Live Session Closed]:", reason);
            const rStr = String(reason).toLowerCase();
            if (activeKeyObj && (rStr.includes("quota") || rStr.includes("rate limit") || rStr.includes("429") || rStr.includes("resource_exhausted"))) {
              const failover = geminiKeyPool.reportFailure(activeKeyObj.id, reason);
              if (failover.switched && failover.nextKey) {
                console.log(`[KeyPool Failover] Quota reached on "${activeKeyObj.name}". Next key: "${failover.nextKey.name}".`);
                clientWs.send(JSON.stringify({
                  type: "key_failover",
                  fromKey: activeKeyObj.name,
                  toKey: failover.nextKey.name
                }));
              }
            }
            clientWs.send(JSON.stringify({ type: "status", status: "session_closed" }));
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connected" }));
      clientWs.send(JSON.stringify({
        type: "persona_info",
        persona: persona.id,
        name: persona.name,
        voice: resolveVoice(persona),
        theme: (persona as any).theme,
      }));

      // BELLA 6.0 — register this live session so background engines
      // (scheduler, agent fleet) can speak through the conversation.
      updateBellaCtx({ apiKey, clientWs: clientWs as any, sessionId });
      registerLiveSession({
        sessionId,
        sendRealtimeInput: (input) => { try { session.sendRealtimeInput(input); } catch {} },
        sendToolResponse: (resp) => { try { session.sendToolResponse(resp as any); } catch {} },
        clientWs: clientWs as any,
      });

      
      // Proactive Intelligence init sync
      (async () => {
        try {
          const pSettings = await proactiveEngine.getSettings();
          const pActive = proactiveEngine.getActiveSuggestions();
          clientWs.send(JSON.stringify({
            type: "proactive_init",
            settings: pSettings,
            suggestions: pActive,
          }));
        } catch (e) {
          console.warn("[Proactive WS] Error sending init state:", e);
        }
      })();

      // Stream proactive suggestions in real-time
      const unsubscribeProactive = proactiveEngine.onSuggestion((suggestion) => {
        try {
          if (clientWs.readyState === 1) { // OPEN
            clientWs.send(JSON.stringify({
              type: "proactive_suggestion",
              suggestion,
            }));
          }
        } catch (e) {
          console.warn("[Proactive WS] Error forwarding suggestion:", e);
        }
      });
      
      clientWs.on("message", (rawMsg) => {
        try {
          const msg = JSON.parse(rawMsg.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
            });
          } else if (msg.type === "video" && msg.video) {
            try {
              const rawVideo = typeof msg.video === "string" ? msg.video : "";
              const cleanBase64 = rawVideo.includes(",") ? rawVideo.split(",")[1] : rawVideo;
              if (cleanBase64 && cleanBase64.length > 50) {
                const now = Date.now();
                // Keep the newest frame for live commentary analysis
                latestFrameBase64 = cleanBase64;
                if (!sessionState.lastVideoFrameTime || now - sessionState.lastVideoFrameTime >= 700) {
                  sessionState.lastVideoFrameTime = now;
                  session.sendRealtimeInput({
                    video: { data: cleanBase64, mimeType: "image/jpeg" }
                  });
                  void noteFrame(apiKey); // creator suite: live commentary loop
                }
              }
            } catch (err) {
              console.warn("[Gemini Live Video Frame] Error sending frame to session:", err);
            }
          } else if (msg.type === "toolResponse") {
            session.sendToolResponse({
              functionResponses: [
                {
                  name: msg.name,
                  response: { output: msg.output },
                  id: msg.id
                }
              ]
            });
          } else if (msg.type === "proactive_feedback") {
            const { suggestionId, action } = msg;
            if (suggestionId && action) {
              void proactiveEngine.recordFeedback({ suggestionId, action });
            }
          } else if (msg.type === "proactive_update_settings") {
            if (msg.patch) {
              void proactiveEngine.updateSettings(msg.patch);
            }
          }
        } catch (e) {
          console.error("Error editing/forwarding client frame message:", e);
        }
      });
      
      clientWs.on("close", () => {
        unsubscribeProactive();
        unregisterLiveSession(sessionId);
        recorderState.active = false;
        console.log(`[Bella Session ${sessionId}] Client disconnected (session preserved with ${sessionState.dialogueHistory.length} turns)`);
        sessionState.lastDisconnectedAt = Date.now();
        try {
          session.close();
        } catch (e) {}
      });
      
    } catch (err: any) {
      console.error("Error connecting to Gemini Live API:", err);
      clientWs.send(JSON.stringify({ 
        type: "error", 
        error: `Could not connect to Gemini: ${err.message || err}` 
      }));
      clientWs.close();
    }
  });

  // Serve custom static assets folder
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));

  // Express Static assets / Vite Dev Middleware configuration
  if (process.env.NODE_ENV !== "production") {
    // Loaded lazily so the production bundle never requires vite (a dev-only
    // dependency that is not shipped with the packaged app).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    logStartup(`BELLA V2 server started on http://localhost:${PORT}`);
    console.log(`[Server] Running on http://localhost:${PORT}`);
    // Companion HTTPS listener (local CA) — best effort; HTTP keeps working.
    startPhoneHttps(app).catch((e) =>
      console.warn(`[Phone HTTPS] startup error: ${e?.message || e}`)
    );
    // Kick off the desktop agent (probe + auto-spawn) immediately on boot.
    ensureDesktopAgent().catch((e) =>
      console.warn(`[Desktop Agent] Boot probe failed: ${e?.message || e}`)
    );

    // BELLA 6.0 — capability layer boot
    setFrameProvider(() => latestFrameBase64);
    registerFullExecutor(async (name, args) => {
      const result = await callDesktopAgent(name, args);
      if (!result.ok) throw new Error(result.error || "Desktop agent error.");
      return result.result ?? { result: "Done." };
    });
    startBellaServices();
    console.log(`[Bella 6.0] Capability layer online — ${bellaToolCount} new voice tools registered.`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server startup sequence:", error);
});
