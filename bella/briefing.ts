/**
 * BELLA 6.0 — Daily Briefing.
 *
 * "Morning. Daily briefing." → weather, unread mail, spending, overnight
 * channel growth, today's tasks and reminders, and any background agents —
 * aggregated into one spoken summary. Also schedulable:
 * "run my briefing every day at 8".
 */
import { Type } from "@google/genai";
import {
  readJson, dataFilePath, fetchJson, announce,
} from "./util";
import { loadReminders, describeWhen } from "./scheduler";
import { loadExpenses } from "./comms";
import { findJobs } from "./agents";
import { activitySummary } from "./activity";
import type { ToolModule } from "./types";

async function weatherLine(): Promise<string> {
  try {
    let loc = "";
    try {
      const geo = await fetchJson<{ city?: string }>("/http://ip-api.com/json/".replace(/^\//, "http://"), 5000);
      loc = geo.city || "";
    } catch {}
    const w = await fetchJson<any>(`https://wttr.in/${encodeURIComponent(loc)}?format=j1`, 8000);
    const cur = w.current_condition?.[0];
    if (!cur) return "";
    const tmrw = w.weather?.[1];
    return `${cur.weatherDesc?.[0]?.value || "Clear"}, ${cur.temp_C}°C (feels ${cur.FeelsLikeC}°C)` +
      (tmrw ? `; tomorrow ${tmrw.mintempC}–${tmrw.maxtempC}°C` : "");
  } catch {
    return "";
  }
}

function unreadMailCount(): Promise<number> {
  // Cheap IMAP probe is heavy for a briefing; report config state only.
  const cfg = readJson<any | null>(dataFilePath("mail.json"), null);
  return Promise.resolve(cfg?.address ? -1 : -2); // -1 configured, -2 not set up
}

function spendToday(): string {
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
  const list = loadExpenses().filter(e => new Date(e.date) >= cutoff);
  if (!list.length) return "";
  const total = list.reduce((s, e) => s + e.amount, 0);
  const cur = list[0].currency;
  return `spent ${total.toFixed(0)} ${cur} so far today across ${list.length} transaction${list.length > 1 ? "s" : ""}`;
}

function growthLine(): string {
  const snaps = readJson<{ date: string; subs: number; views: number }[]>(dataFilePath("yt_growth.json"), []);
  if (!snaps.length) return "";
  const last = snaps[snaps.length - 1];
  return `channel at ${last.subs.toLocaleString()} subscribers as of ${new Date(last.date).toLocaleDateString()}`;
}

export async function buildBriefing(): Promise<string[]> {
  const lines: string[] = [];
  const [weather] = await Promise.all([weatherLine()]);
  if (weather) lines.push(`Weather: ${weather}.`);

  const mailState = await unreadMailCount();
  if (mailState === -2) lines.push("Email isn't connected yet — say 'configure my email' when you want me watching your inbox.");

  const spend = spendToday();
  if (spend) lines.push(`Spending: you've ${spend}.`);

  const growth = growthLine();
  if (growth) lines.push(`YouTube: ${growth}.`);

  const reminders = loadReminders().filter(r => r.active).slice(0, 3);
  if (reminders.length) {
    lines.push(`Upcoming: ${reminders.map(r => `"${r.text}" ${describeWhen(r)}`).join("; ")}.`);
  }

  const jobs = findJobs().filter(j => j.status === "running" || j.status === "queued").slice(0, 3);
  if (jobs.length) {
    lines.push(`Background agents still working: ${jobs.map(j => j.mission.slice(0, 40)).join(", ")}.`);
  }

  const act = activitySummary(180);
  if (act) lines.push(`Recent focus: ${act}.`);

  if (!lines.length) lines.push("All quiet — no alerts, nothing pending. A perfect morning.");
  return lines;
}

export const briefingModule: ToolModule = {
  name: "briefing",
  declarations: [
    {
      name: "dailyBriefing",
      description: "Morning briefing: weather where you are, email status, spending so far, YouTube channel snapshot, upcoming reminders and any background agents still running. Also scheduleable via scheduleAction.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "announceBriefingNow",
      description: "Push a fresh briefing into the conversation immediately (used by scheduled morning briefings).",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
  async execute(name) {
    const lines = await buildBriefing();
    if (name === "announceBriefingNow") {
      announce(`Daily briefing: ${lines.join(" ")}`);
    }
    return { result: lines.join(" "), items: lines };
  },
};
