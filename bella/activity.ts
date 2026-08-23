/**
 * BELLA 6.0 — Activity awareness.
 *
 * A lightweight foreground-window watcher (PowerShell, ~every 45 s) feeds a
 * rolling local log of which apps MANISH is using. This powers:
 *   - proactive context injection (Bella knows you're deep in VS Code)
 *   - the daily briefing ("most of your morning went to Chrome")
 *   - the whatWereYouDoing / recentActivity tools
 *
 * Titles are truncated and nothing ever leaves the machine.
 */
import { Type } from "@google/genai";
import { runPowerShell, dataFilePath, readJson, writeJson } from "./util";
import type { ToolModule } from "./types";

interface ActivityEntry { t: string; app: string; title: string; }
const FILE = dataFilePath("activity.json");
const CAP = 240;

const loadLog = (): ActivityEntry[] => readJson<ActivityEntry[]>(FILE, []);
function append(entry: ActivityEntry): void {
  const log = loadLog();
  log.push(entry);
  writeJson(FILE, log.slice(-CAP));
}

const PS_SNIPPET = `
$ProgressPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid2);
}
"@
$h = [FG]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][FG]::GetWindowText($h, $sb, 256)
$procId = 0
[void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
$app = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { "unknown" }
Write-Output ("APPTITLE|" + $app + "|" + $sb.ToString())
`;

async function sampleForeground(): Promise<{ app: string; title: string } | null> {
  const r = await runPowerShell(PS_SNIPPET, 20000);
  // stdout may carry CLIXML/progress junk — scan every line for our marker.
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    if (!line.startsWith("APPTITLE|")) continue;
    const parts = line.split("|");
    if (parts.length >= 3) {
      return { app: parts[1].trim(), title: parts.slice(2).join("|").trim().slice(0, 80) };
    }
  }
  return null;
}
let trackerStarted = false;
export function startActivityTracker(intervalMs = 45000): void {
  if (trackerStarted) return;
  trackerStarted = true;
  console.log("[Activity] Foreground tracker started.");
  const tick = async () => {
    try {
      const cur = await sampleForeground();
      if (!cur || !cur.app || cur.app === "unknown") return;
      const log = loadLog();
      const last = log[log.length - 1];
      const SAME = last && last.app === cur.app && last.title === cur.title;
      const FRESH = last && Date.now() - new Date(last.t).getTime() < 5 * 60000;
      if (SAME && FRESH) return; // unchanged recently
      append({ t: new Date().toISOString(), ...cur });
    } catch { /* ignore tick errors */ }
  };
  void tick();
  setInterval(tick, intervalMs);
}

/** Human-readable summary of the last `minutes` of local activity. */
export function activitySummary(minutes = 90): string {
  const cutoff = Date.now() - minutes * 60000;
  const perApp = new Map<string, number>();
  let prev: number | null = null;
  for (const e of loadLog()) {
    const t = new Date(e.t).getTime();
    if (prev !== null && t > cutoff) {
      const delta = Math.min(t - prev, 10 * 60000); // cap gaps
      perApp.set(e.app, (perApp.get(e.app) || 0) + delta);
    }
    prev = t;
  }
  const top = [...perApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return "";
  const fmt = (ms: number) => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
  };
  return top.map(([app, ms]) => `${app} ${fmt(ms)}`).join(", ");
}

/** Compact block injected into the live system instruction by server.ts. */
export function activityContextBlock(): string {
  const sum = activitySummary(120);
  if (!sum) return "";
  return `\n\n=== RECENT USER ACTIVITY (local, last ~2h — reference only if relevant) ===\nTime split: ${sum}\n=== END ACTIVITY ===\n`;
}

export const activityModule: ToolModule = {
  name: "activity",
  declarations: [
    {
      name: "recentActivity",
      description: "Summarize what the user has been doing on the PC recently — time split across applications.",
      parameters: {
        type: Type.OBJECT,
        properties: { minutes: { type: Type.INTEGER, description: "Look-back window (default 90)." } },
      },
    },
  ],
  async execute(name, args) {
    if (name === "recentActivity") {
      const sum = activitySummary(Number(args.minutes || 90));
      return { result: sum ? `Recent focus: ${sum}.` : "I haven't observed enough activity yet." };
    }
    throw new Error(`Unknown activity tool: ${name}`);
  },
};
