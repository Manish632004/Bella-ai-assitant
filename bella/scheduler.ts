/**
 * BELLA 6.0 — Reminders & Scheduling core.
 *
 * One-off, timed or recurring reminders that fire out loud, plus scheduled
 * ACTIONS: any BELLA tool (or macro) can be queued to run at a time —
 * "At 6 p.m., send Rohit the report."
 *
 * Persistence: reminders.json. Tick loop every 10 s. When a reminder fires it
 * is announced into the live session (Bella speaks it); if no session is live
 * a Windows toast + SAPI voice fallback is used.
 */
import path from "path";
import { dataFile } from "../server_paths";
import {
  readJson, writeJson, announce, runPowerShell,
} from "./util";
import { dispatchTool } from "./runtime";
import type { ToolModule } from "./types";
import { Type } from "@google/genai";

type Recurrence = "daily" | "weekly" | "weekdays" | "interval" | null;

interface ScheduledAction {
  kind: "tool" | "macro";
  tool?: string;
  args?: Record<string, unknown>;
  macroName?: string;
}

export interface Reminder {
  id: string;
  text: string;
  /** ISO timestamp of the next due occurrence (null = interval-only). */
  when: string | null;
  recurrence: Recurrence;
  recurrenceDay?: number;      // 0=Sun..6=Sat for weekly
  intervalMinutes?: number;    // for "interval"
  action?: ScheduledAction;
  active: boolean;
  createdAt: string;
  lastFiredAt?: string;
  firedCount: number;
}

const REMINDERS_FILE = dataFile("reminders.json");
const loadReminders = () => readJson<Reminder[]>(REMINDERS_FILE, []);
const saveReminders = (list: Reminder[]) => writeJson(REMINDERS_FILE, list);

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tuesday_s: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

// ---------------------------------------------------------------------------
// Natural-language time parsing (offline first, deterministic)
// ---------------------------------------------------------------------------
export function parseWhenText(input: string, now = new Date()): { when: Date | null; recurrence: Recurrence; day?: number; intervalMinutes?: number } {
  const text = input.toLowerCase().trim();
  const result: { when: Date | null; recurrence: Recurrence; day?: number; intervalMinutes?: number } = { when: null, recurrence: null };

  // "in 20 minutes / in 2 hours / in 90 seconds"
  const inMatch = text.match(/in\s+(\d+(?:\.\d+)?)\s*(second|sec|minute|min|hour|hr|day)s?/);
  if (inMatch) {
    const n = parseFloat(inMatch[1]);
    const unit = inMatch[2];
    const ms = unit.startsWith("sec") ? n * 1000
      : unit.startsWith("min") ? n * 60000
      : unit.startsWith("hour") || unit === "hr" ? n * 3600000
      : n * 86400000;
    result.when = new Date(now.getTime() + ms);
    return result;
  }

  // "every N minutes"
  const everyMin = text.match(/every\s+(\d+)\s*minutes?/);
  if (everyMin) {
    result.recurrence = "interval";
    result.intervalMinutes = parseInt(everyMin[1], 10);
    result.when = new Date(now.getTime() + result.intervalMinutes * 60000);
    return result;
  }

  // daily / everyday / every morning|evening|night
  const isDaily = /\b(every ?day|everyday|daily|each day)\b/.test(text);
  const weekdaysOnly = /\b(every )?weekdays?\b/.test(text);

  // weekly with day name: "every monday at 9"
  let day: number | undefined;
  for (const [name, idx] of Object.entries(DAY_NAMES)) {
    if (new RegExp(`(every|on)\\s+${name}\\b`).test(text)) { day = idx as number; break; }
  }

  // clock time: "at 9", "at 7am", "at 6 p.m.", "at 18:30"
  const timeMatch = text.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  let hours: number | null = null;
  let minutes = 0;
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    if (timeMatch[2]) minutes = parseInt(timeMatch[2], 10);
    const pm = /p\.?m/.test(timeMatch[3] || "");
    const am = /a\.?m/.test(timeMatch[3] || "");
    if (pm && hours < 12) hours += 12;
    if (am && hours === 12) hours = 0;
    if (!pm && !am && hours <= 7 && /(evening|night|tonight)/.test(text)) hours += 12;
  }

  const buildToday = (): Date => {
    const d = new Date(now);
    if (hours !== null) { d.setHours(hours, minutes, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); }
    else d.setMinutes(d.getMinutes() + 5);
    return d;
  };

  if (day !== undefined) {
    result.recurrence = "weekly";
    result.day = day;
    const d = buildToday();
    while (d.getDay() !== day) d.setDate(d.getDate() + 1);
    result.when = d;
    return result;
  }
  if (isDaily) {
    result.recurrence = "daily";
    result.when = buildToday();
    return result;
  }
  if (weekdaysOnly) {
    result.recurrence = "weekdays";
    result.when = buildToday();
    while (result.when.getDay() === 0 || result.when.getDay() === 6) result.when.setDate(result.when.getDate() + 1);
    return result;
  }

  // one-off: "tomorrow at 9am", "today at 6pm", bare "at 17:00"
  const base = buildToday();
  if (/\btomorrow\b/.test(text)) base.setDate(base.getDate() + 1);
  if (hours !== null || /\btomorrow\b|\btoday\b/.test(text)) {
    result.when = base;
    return result;
  }

  // ISO-ish passthrough
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) { result.when = parsed; return result; }

  return result;
}

function nextOccurrence(r: Reminder, from: Date): Date | null {
  if (r.recurrence === "interval" && r.intervalMinutes) {
    return new Date(from.getTime() + r.intervalMinutes * 60000);
  }
  if (!r.when) return null;
  const base = new Date(r.when);
  if (r.recurrence === "daily" || r.recurrence === "weekdays") {
    const d = new Date(base);
    do { d.setDate(d.getDate() + 1); } while (r.recurrence === "weekdays" && (d.getDay() === 0 || d.getDay() === 6));
    return d;
  }
  if (r.recurrence === "weekly" && r.recurrenceDay !== undefined) {
    const d = new Date(base);
    do { d.setDate(d.getDate() + 7); } while (false);
    return d;
  }
  return null; // one-off
}

async function fireReminder(r: Reminder): Promise<void> {
  console.log(`[Scheduler] Firing reminder "${r.text}" (${r.id})`);
  r.lastFiredAt = new Date().toISOString();
  r.firedCount++;

  const spoke = announce(`REMINDER: ${r.text}`);
  if (!spoke) {
    // No live voice session — Windows SAPI speaks + notification balloon.
    await runPowerShell(
      `(New-Object -ComObject SAPI.SpVoice).Speak(${JSON.stringify(r.text.replace(/"/g, ""))})`,
      15000,
    );
  }

  if (r.action?.kind === "macro" && r.action.macroName) {
    try { await dispatchTool("runMacro", { name: r.action.macroName }); } catch (e) {
      console.error("[Scheduler] Macro action failed:", e);
    }
  } else if (r.action?.kind === "tool" && r.action.tool) {
    try { await dispatchTool(r.action.tool, r.action.args || {}); } catch (e) {
      console.error("[Scheduler] Scheduled tool failed:", e);
    }
  }

  const list = loadReminders();
  const entry = list.find(x => x.id === r.id);
  if (!entry) return;
  if (entry.recurrence && entry.recurrence !== null) {
    const nxt = nextOccurrence(entry, entry.when ? new Date(entry.lastFiredAt || entry.when) : new Date());
    if (nxt) entry.when = nxt.toISOString();
  } else {
    entry.active = false;
  }
  saveReminders(list);
}

let tickerStarted = false;
export function startSchedulerTicker(): void {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    try {
      const now = Date.now();
      const list = loadReminders();
      let changed = false;
      for (const r of list) {
        if (!r.active) continue;
        if (!r.when) continue;
        const due = new Date(r.when).getTime();
        if (now >= due && now - due < 10 * 60000) { // skip stale (>10 min old) missed alarms
          void fireReminder(r);
          changed = true;
        }
      }
      if (changed) { /* fireReminder persists its own updates */ }
    } catch (err) {
      console.error("[Scheduler] tick error:", err);
    }
  }, 10000);
  console.log("[Scheduler] Reminder ticker started (10s).");
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function addReminder(opts: {
  text: string; whenText?: string; when?: Date | null; recurrence?: Recurrence;
  action?: ScheduledAction;
}): Reminder {
  const parsed = opts.when
    ? { when: opts.when, recurrence: (opts.recurrence ?? null) as Recurrence }
    : parseWhenText(opts.whenText || "");
  const list = loadReminders();
  const reminder: Reminder = {
    id: newId(),
    text: opts.text,
    when: parsed.when ? parsed.when.toISOString() : null,
    recurrence: opts.recurrence ?? parsed.recurrence ?? null,
    recurrenceDay: parsed.day,
    intervalMinutes: parsed.intervalMinutes,
    action: opts.action,
    active: true,
    createdAt: new Date().toISOString(),
    firedCount: 0,
  };
  list.push(reminder);
  saveReminders(list);
  return reminder;
}

export function describeWhen(r: Reminder): string {
  if (r.recurrence === "daily") return `every day at ${new Date(r.when!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (r.recurrence === "weekly") return `every ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][r.recurrenceDay ?? 1]} at ${new Date(r.when!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (r.recurrence === "interval") return `every ${r.intervalMinutes} minutes`;
  if (r.recurrence === "weekdays") return "every weekday";
  return r.when ? new Date(r.when).toLocaleString() : "unscheduled";
}

// ---------------------------------------------------------------------------
// Tool module
// ---------------------------------------------------------------------------
export const schedulerModule: ToolModule = {
  name: "scheduler",
  declarations: [
    {
      name: "setReminder",
      description: "Set a reminder that BELLA announces out loud. Supports one-off ('tomorrow at 7am', 'in 20 minutes') and recurring ('every Monday at 9', 'daily at 18:30', 'every 30 minutes').",
      parameters: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "What to remind about." },
          whenText: { type: Type.STRING, description: "Natural language time, e.g. 'tomorrow at 9am' or 'every monday at 9'. Omit only if user wants it listed without a time." },
        },
        required: ["text"],
      },
    },
    {
      name: "scheduleAction",
      description: "Schedule an actual ACTION to run later, not just a nudge — e.g. 'At 6 p.m., send Rohit the report' schedules the sendReport tool. Also used to schedule macros.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: "What will happen, announced when it fires." },
          whenText: { type: Type.STRING, description: "Natural-language time." },
          tool: { type: Type.STRING, description: "Registered BELLA tool to execute." },
          args: { type: Type.OBJECT, description: "Arguments object for the tool.", properties: {} },
          macroName: { type: Type.STRING, description: "Alternatively schedule an existing macro by name." },
        },
        required: ["description", "whenText"],
      },
    },
    {
      name: "listReminders",
      description: "List all active reminders and scheduled actions.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "cancelReminder",
      description: "Cancel/delete a reminder matching a query.",
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING, description: "Text to match the reminder against." } },
        required: ["query"],
      },
    },
  ],
  async execute(name, args) {
    if (name === "setReminder") {
      const r = addReminder({ text: String(args.text), whenText: args.whenText });
      return { result: `Reminder set: "${r.text}" — fires ${describeWhen(r)}.` , id: r.id };
    }
    if (name === "scheduleAction") {
      const action: ScheduledAction | undefined = args.macroName
        ? { kind: "macro", macroName: String(args.macroName) }
        : args.tool ? { kind: "tool", tool: String(args.tool), args: (args.args as Record<string, unknown>) || {} }
        : undefined;
      const r = addReminder({ text: String(args.description), whenText: args.whenText, action });
      return { result: `Scheduled action "${r.text}" to run ${describeWhen(r)}.`, id: r.id };
    }
    if (name === "listReminders") {
      const list = loadReminders().filter(r => r.active);
      if (!list.length) return { result: "No active reminders." };
      return {
        result: list.map(r => `- "${r.text}" (${describeWhen(r)})`).join("\n"),
        count: list.length,
      };
    }
    if (name === "cancelReminder") {
      const q = String(args.query || "").toLowerCase();
      const list = loadReminders();
      const match = list.find(r => r.active && r.text.toLowerCase().includes(q));
      if (!match) return { result: `No active reminder matches "${args.query}".` };
      match.active = false;
      saveReminders(list);
      return { result: `Cancelled reminder "${match.text}".` };
    }
    throw new Error(`Unknown scheduler tool: ${name}`);
  },
};

/** REST support (Settings UI): full CRUD access. */
export const schedulerRest = {
  file: REMINDERS_FILE,
  load: loadReminders,
  save: saveReminders,
  describe: describeWhen,
  parse: parseWhenText,
};

export const schedulerPaths = { REMINDERS_FILE, path };
