/**
 * BELLA 6.0 — The Agent Fleet.
 *
 * "She doesn't do the big jobs herself. She sends someone."
 *
 * - Sub-agents: hand over one big multi-step job (or many at once) and each
 *   gets its own background agent that plans, executes real actions, and
 *   reports back mid-conversation when it lands. Nothing blocks the chat.
 * - Research agent: plans a deep dive, visits and cross-checks sources,
 *   hands back a structured, cited report (markdown + optional Word doc).
 * - Coding agent: ships real software into ~/BellaProjects — engine switchable
 *   between the built-in ManishCode loop and Claude Code CLI. Every task
 *   deposits a "lesson learned" recalled on the next run.
 * - Hermes agent: bridges Nous Research's Hermes runtime when installed,
 *   running open-ended missions inside a sandboxed working directory.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Type } from "@google/genai";
import {
  generateText, generateJson, fetchText, fetchJson, runCommand, announce,
  HOME, ensureDir, readJson, writeJson, dataFilePath,
} from "./util";
import { dispatchTool } from "./runtime";
import type { ToolModule } from "./types";

// ---------------------------------------------------------------------------
// Job store
// ---------------------------------------------------------------------------
export type AgentType =
  | "research" | "coding" | "document" | "generic"
  | "browser" | "desktop" | "hermes" | "skill-author";

export interface AgentJob {
  id: string;
  type: AgentType;
  mission: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: { time: string; text: string }[];
  result?: string;
  startedAt: string;
  finishedAt?: string;
}

const JOBS_FILE = dataFilePath("agents.json");
const jobs = new Map<string, AgentJob>();

function persistJobs(): void {
  writeJson(JOBS_FILE, Array.from(jobs.values()));
}

// Load previous run's jobs; anything still marked running was interrupted.
(function loadJobs() {
  for (const j of readJson<AgentJob[]>(JOBS_FILE, [])) {
    if (j.status === "running" || j.status === "queued") j.status = "failed";
    jobs.set(j.id, j);
  }
})();

const MAX_PARALLEL = 6;
let runningCount = 0;
const queue: (() => void)[] = [];

function schedule(job: AgentJob, fn: () => Promise<void>): void {
  const run = () => {
    runningCount++;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    step(job, "Agent started.");
    fn()
      .catch((err) => {
        job.status = "failed";
        job.finishedAt = new Date().toISOString();
        step(job, `Failed: ${err?.message || err}`);
        announce(`Background ${job.type} agent failed on "${short(job.mission)}": ${err?.message || err}`);
      })
      .finally(() => {
        runningCount--;
        persistJobs();
        const next = queue.shift();
        if (next) next();
      });
  };
  if (runningCount >= MAX_PARALLEL) queue.push(run);
  else run();
}

function short(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function step(job: AgentJob, text: string): void {
  job.progress.push({ time: new Date().toISOString(), text });
  console.log(`[Agent ${job.id} ${job.type}] ${text}`);
  persistJobs();
}

function finishJob(job: AgentJob, result: string): void {
  job.status = "done";
  job.result = result;
  job.finishedAt = new Date().toISOString();
  step(job, `Done. ${short(result, 120)}`);
  persistJobs();
  announce(`Background ${job.type} agent finished — ${short(result, 180)}`);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

// ---------------------------------------------------------------------------
// Shared helpers for agent loops
// ---------------------------------------------------------------------------
const DANGEROUS = /(\brm\s+-rf\s+[/\\]\s*$)|(\bformat\b\s*[a-z]:)|(\bshutdown\b)|(\bdel\s+\/[sq]\s+C:\\)/i;

async function safeRunCommand(cmd: string, cwd?: string, timeoutMs = 120000) {
  if (DANGEROUS.test(cmd)) return { ok: false, stdout: "", stderr: "Blocked by BELLA safety filter." };
  return runCommand(cmd, cwd, timeoutMs);
}

/** Strip HTML to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface SearchResult { title: string; url: string; snippet: string; }

async function webSearch(query: string): Promise<SearchResult[]> {
  try {
    const html = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, 15000);
    const results: SearchResult[] = [];
    const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class='result-snippet'>([\s\S]*?)<\/td>)?/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) && results.length < 5) {
      let url = m[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      results.push({ url, title: htmlToText(m[2]).slice(0, 120), snippet: m[3] ? htmlToText(m[3]).slice(0, 200) : "" });
    }
    if (results.length) return results;
  } catch (err) {
    console.warn("[Research] DDG search failed:", err);
  }
  // Fallback: Wikipedia search API (keyless).
  try {
    const wiki = await fetchJson<{ query?: { search: { title: string; snippet: string }[] } }>(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=4`, 12000);
    return (wiki.query?.search || []).map(r => ({
      title: r.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
      snippet: htmlToText(r.snippet),
    }));
  } catch {
    return [];
  }
}

async function fetchPageText(url: string, maxChars = 5000): Promise<string> {
  try {
    const html = await fetchText(url, 20000);
    return htmlToText(html).slice(0, maxChars);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Generic sub-agent loop — plans, then executes real actions until done.
// ---------------------------------------------------------------------------
const AGENT_SYSTEM = `You are BELLA's autonomous background sub-agent. You complete the user's mission step-by-step using actions.

Available actions (reply with EXACTLY ONE JSON object):
{"action":"tool","tool":"<registered BELLA tool name>","args":{...},"why":"..."}   — execute any registered BELLA tool (openApplication, createFile, readFile, listFiles, searchFiles, copyFile, moveFile, renameFile, deleteFile, createWordDocument, createPdf, createExcelWorkbook, excelAddRow, excelSetCell, indexFolder, askDocuments, setReminder, openWebsite, searchWeb, desktopBrowserOpen, desktopBrowserClick, desktopBrowserType, takeScreenshot, analyzeScreenshot, systemInfo ...)
{"action":"write_file","path":"<absolute or ~ path>","content":"<full file content>","why":"..."}
{"action":"run_command","command":"<shell command>","cwd":"<optional dir>","why":"..."}   — Windows PowerShell/cmd available; use sparingly.
{"action":"web_fetch","url":"<url>","why":"..."}
{"action":"finish","summary":"<one-paragraph final report of what was accomplished>"}

Rules:
- Work autonomously; nobody will answer questions. Make reasonable assumptions.
- Prefer BELLA tools over raw commands. Keep commands safe and non-destructive.
- After each action you'll see its RESULT. If something fails, adjust and retry differently.
- Reply ONLY with the JSON object.`;

async function runGenericAgent(job: AgentJob, extraContext = ""): Promise<void> {
  const MAX_STEPS = 12;
  let transcript = "";
  for (let i = 0; i < MAX_STEPS; i++) {
    const apiKey = require("../server_paths").getGeminiApiKey();
    const decision = await generateJson<{
      action: string; tool?: string; args?: Record<string, unknown>;
      path?: string; content?: string; command?: string; cwd?: string; url?: string;
      why?: string; summary?: string;
    }>(
      apiKey,
      `MISSION: ${job.mission}\n\n${extraContext}\nPROGRESS SO FAR:\n${transcript || "(nothing yet — start planning and acting)"}\n\nDecide the next single action.`,
      AGENT_SYSTEM,
    );

    if (decision.action === "finish") {
      finishJob(job, decision.summary || "Mission completed.");
      return;
    }
    step(job, `${decision.why || decision.action}${decision.tool ? ` → ${decision.tool}` : decision.path ? ` → ${decision.path}` : decision.url ? ` → ${decision.url}` : decision.command ? ` → ${decision.command}` : ""}`);

    let outcome = "";
    try {
      if (decision.action === "tool" && decision.tool) {
        const res = await dispatchTool(decision.tool, decision.args || {});
        outcome = JSON.stringify(res).slice(0, 1200);
      } else if (decision.action === "write_file" && decision.path) {
        const p = decision.path.replace(/^~/, HOME());
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, decision.content || "");
        outcome = `Wrote ${p} (${Buffer.byteLength(decision.content || "")} bytes).`;
      } else if (decision.action === "run_command" && decision.command) {
        const r = await safeRunCommand(decision.command, decision.cwd?.replace(/^~/, HOME()));
        outcome = `exit=${r.ok ? 0 : 1} stdout=${r.stdout.slice(0, 800)} stderr=${r.stderr.slice(0, 400)}`;
      } else if (decision.action === "web_fetch" && decision.url) {
        outcome = (await fetchPageText(decision.url, 3000)) || "(empty page)";
      } else {
        outcome = "Unknown action ignored.";
      }
    } catch (err: any) {
      outcome = `ACTION FAILED: ${err?.message || err}`;
    }
    transcript += `\nStep ${i + 1}: ${JSON.stringify(decision).slice(0, 300)}\nRESULT: ${outcome.slice(0, 900)}\n`;
  }
  finishJob(job, `Ran ${MAX_STEPS} steps without explicit finish. Last progress: ${short(transcript, 300)}`);
}

// ---------------------------------------------------------------------------
// Research deep dive
// ---------------------------------------------------------------------------
async function runResearchAgent(job: AgentJob, exportDocx: boolean): Promise<void> {
  const apiKey = require("../server_paths").getGeminiApiKey();

  step(job, "Planning research strategy…");
  const plan = await generateJson<{ queries: string[]; outline: string[] }>(
    apiKey,
    `Plan a deep research dive on: "${job.mission}"\nReturn JSON: {"queries":["3-5 diverse web search queries"],"outline":["report section headings"]}`,
    "You are a rigorous research planner.",
  );
  step(job, `Planned ${plan.queries.length} searches across ${plan.outline.length} sections.`);

  const sources: { title: string; url: string; text: string }[] = [];
  for (const q of plan.queries) {
    const results = await webSearch(q);
    step(job, `Search "${q}" → ${results.length} candidates.`);
    for (const r of results.slice(0, 2)) {
      if (sources.some(s => s.url === r.url)) continue;
      const text = await fetchPageText(r.url, 4500);
      if (text.length > 300) sources.push({ title: r.title, url: r.url, text });
    }
  }
  step(job, `Fetched ${sources.length} full sources. Cross-checking and writing report…`);

  const corpus = sources
    .map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text}`)
    .join("\n\n---\n\n")
    .slice(0, 60000);

  const report = await generateText(
    apiKey,
    `Write a structured research report on "${job.mission}".\nUse this outline:\n${plan.outline.map(h => "- " + h).join("\n")}\n\nCite sources inline as [n] matching this numbered corpus:\n\n${corpus}`,
    "You are a senior research analyst. Be factual, cross-check claims between sources, note disagreements, end with a Sources section listing every citation as 'n. Title — URL'.",
  );

  const slug = job.mission.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "research";
  const reportsDir = ensureDir(path.join(HOME(), "BellaReports"));
  const mdPath = path.join(reportsDir, `${slug}.md`);
  fs.writeFileSync(mdPath, report);

  let docxNote = "";
  if (exportDocx) {
    try {
      const res = await dispatchTool("createWordDocument", {
        filePath: path.join(reportsDir, `${slug}.docx`),
        title: job.mission,
        content: report.replace(/^#+ /gm, ""),
      });
      docxNote = ` Word version: ${(res as any)?.result || ""}`;
    } catch (e) { console.warn("[Research] docx export failed:", e); }
  }

  finishJob(job, `Report saved to ${mdPath}.${docxNote} Based on ${sources.length} sources.`);
}

// ---------------------------------------------------------------------------
// Coding agent — ManishCode engine + Claude Code engine
// ---------------------------------------------------------------------------
const ENGINE_FILE = dataFilePath("coding_engine.json");
export function getCodingEngine(): string {
  return readJson<{ engine: string }>(ENGINE_FILE, { engine: "claude-code" }).engine;
}
export function setCodingEngine(engine: string): void {
  if (!["claude-code", "manishcode"].includes(engine)) throw new Error("Engine must be 'claude-code' or 'manishcode'.");
  writeJson(ENGINE_FILE, { engine });
}

const LESSONS_FILE = dataFilePath("coding_lessons.json");
const loadLessons = (): string[] => readJson<string[]>(LESSONS_FILE, []);
function appendLesson(text: string): void {
  const lessons = loadLessons();
  lessons.push(`[${new Date().toISOString().slice(0, 10)}] ${text}`);
  writeJson(LESSONS_FILE, lessons.slice(-100));
}

async function hasCli(cmd: string): Promise<boolean> {
  const r = await runCommand(`where ${cmd}`, undefined, 8000);
  return r.ok && r.stdout.trim().length > 0;
}

async function runLongCapture(cmd: string, cwd: string, onLine: (l: string) => void, timeoutMs = 10 * 60000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd, windowsHide: true });
    let output = "";
    const onData = (d: Buffer) => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      for (const l of lines) { output += l + "\n"; onLine(l); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 0, output }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: 1, output: output + "\n" + err.message }); });
  });
}

interface CodeFile { path: string; content: string; }

async function manishCodeBuild(job: AgentJob, spec: string, projectNameHint?: string): Promise<string> {
  const apiKey = require("../server_paths").getGeminiApiKey();
  const projectsRoot = ensureDir(path.join(HOME(), "BellaProjects"));

  const lessons = loadLessons();
  const lessonBlock = lessons.length
    ? `\nLESSONS LEARNED FROM PREVIOUS BUILDS (apply them, don't repeat these mistakes):\n${lessons.slice(-12).map(l => "- " + l).join("\n")}`
    : "";

  step(job, "Planning project structure…");
  const plan = await generateJson<{
    projectName: string; stack: string; summary: string;
    files: CodeFile[]; installCommand?: string; buildOrRunCommand?: string;
  }>(
    apiKey,
    `Spec: ${spec}\nProject name hint: ${projectNameHint || "(choose)"}
Design a COMPLETE working project. Return JSON:
{"projectName":"kebab-case-name","stack":"...","summary":"what it does",
 "files":[{"path":"relative/path","content":"FULL file content"}],
 "installCommand":"npm install / pip install -r requirements.txt (omit if none)",
 "buildOrRunCommand":"single command that proves it builds/runs (e.g. npm run build, python main.py)"}${lessonBlock}
Every file must be complete and production-quality. No placeholders.`,
    "You are ManishCode, an expert software engineer agent. Output ONLY JSON.",
  );

  const projDir = path.join(projectsRoot, plan.projectName.replace(/[^\w.-]+/g, "-"));
  fs.mkdirSync(projDir, { recursive: true });
  job.mission = `${plan.projectName}: ${spec}`;
  step(job, `Stack: ${plan.stack}. Writing ${plan.files.length} files to ${projDir}…`);

  for (const f of plan.files) {
    const dest = path.join(projDir, f.path.replace(/^[\\/]/, ""));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }

  let lastOutput = "";
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt === 0 && plan.installCommand) {
      step(job, `Installing dependencies (${plan.installCommand})…`);
      const inst = await safeRunCommand(plan.installCommand, projDir, 5 * 60000);
      lastOutput = (inst.stderr || "") + (inst.stdout || "");
      if (!inst.ok) step(job, `Install issues: ${short(lastOutput, 200)}`);
    }
    if (!plan.buildOrRunCommand) break;
    step(job, `Attempt ${attempt + 1}: running "${plan.buildOrRunCommand}"…`);
    const runRes = await safeRunCommand(plan.buildOrRunCommand, projDir, 3 * 60000);
    lastOutput = (runRes.stderr || "") + "\n" + (runRes.stdout || "");
    if (runRes.ok && !/error|failed|exception/i.test(lastOutput.slice(0, 2000))) break;

    if (attempt === 3) {
      appendLesson(`${plan.projectName}: could not get clean build after fixes. Last error: ${short(lastOutput, 200)}`);
      throw new Error(`Build still failing after self-fix attempts. Last output: ${short(lastOutput, 300)}`);
    }
    step(job, "Errors detected — entering self-fix loop…");
    const fix = await generateJson<{ explanation: string; files: CodeFile[] }>(
      apiKey,
      `The project "${plan.projectName}" fails with this output:\n${lastOutput.slice(0, 6000)}\n\nHere are ALL current files (paths only):\n${plan.files.map(f => f.path).join("\n")}\n\nReturn JSON {"explanation":"what was wrong","files":[{"path":"...","content":"COMPLETE corrected file"}]} — include every file that needs changes.`,
      "You are ManishCode in SELF-FIX mode. Read the errors carefully and correct them. Output ONLY JSON.",
    );
    step(job, `Fix #${attempt + 1}: ${fix.explanation}`);
    for (const f of fix.files || []) {
      const dest = path.join(projDir, f.path.replace(/^[\\/]/, ""));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
    }
  }

  appendLesson(`${plan.projectName} (${plan.stack}): built successfully. Stack notes: ${short(plan.summary, 140)}`);
  return `Project "${plan.projectName}" is ready at ${projDir}. Stack: ${plan.stack}. ${plan.summary}`;
}

async function claudeCodeBuild(job: AgentJob, spec: string, projectNameHint?: string): Promise<string> {
  if (!(await hasCli("claude"))) {
    step(job, "Claude Code CLI not found — falling back to ManishCode engine.");
    return manishCodeBuild(job, spec, projectNameHint);
  }
  const slug = (projectNameHint || spec)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bella-project";
  const projDir = ensureDir(path.join(HOME(), "BellaProjects", slug));
  step(job, `Delegating to Claude Code CLI in ${projDir}…`);
  const prompt = `${spec}\n\nWork fully autonomously in this directory. Build the complete project, install dependencies, make sure it runs/builds cleanly.`;
  const { output } = await runLongCapture(
    `claude -p ${JSON.stringify(prompt)} --dangerously-skip-permissions`,
    projDir,
    (l) => step(job, short(l, 160)),
  );
  appendLesson(`ClaudeCode job "${slug}": completed. Output tail: ${short(output, 160)}`);
  return `Claude Code finished the project at ${projDir}. Summary tail: ${short(output, 400)}`;
}

async function runCodingAgent(job: AgentJob, visibleMode: boolean): Promise<void> {
  const spec = job.mission;
  if (visibleMode) {
    dispatchTool("openApplication", { name: "VS Code", path: path.join(HOME(), "BellaProjects") }).catch(() => {});
  }
  const engine = getCodingEngine();
  step(job, `Coding engine: ${engine}.`);
  const result = engine === "claude-code"
    ? await claudeCodeBuild(job, spec)
    : await manishCodeBuild(job, spec);
  finishJob(job, result);
}

// ---------------------------------------------------------------------------
// Hermes bridge (Nous Research)
// ---------------------------------------------------------------------------
async function runHermesAgent(job: AgentJob): Promise<void> {
  if (!(await hasCli("hermes"))) {
    throw new Error(
      "Hermes runtime is not installed. Install the Nous Research Hermes agent CLI ('npm i -g @nousresearch/hermes' or per its docs), sign in with your Claude Pro/Max or ChatGPT Plus subscription, then retry."
    );
  }
  const sandbox = ensureDir(path.join(HOME(), "BellaHermes", job.id));
  step(job, `Sandboxed runtime: ${sandbox}. Launching Hermes…`);
  const { output } = await runLongCapture(
    `hermes -p ${JSON.stringify(job.mission)} --auto-approve`,
    sandbox,
    (l) => step(job, short(l, 160)),
    20 * 60000,
  );
  finishJob(job, `Hermes completed its mission in ${sandbox}. Output tail: ${short(output, 400)}`);
}

// ---------------------------------------------------------------------------
// Spawner
// ---------------------------------------------------------------------------
export function spawnJob(type: AgentType, mission: string, opts?: { exportDocx?: boolean; visibleMode?: boolean }): AgentJob {
  const job: AgentJob = {
    id: newId(type.slice(0, 4)),
    type,
    mission,
    status: "queued",
    progress: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  persistJobs();

  schedule(job, async () => {
    switch (type) {
      case "research":
        await runResearchAgent(job, opts?.exportDocx ?? false);
        break;
      case "coding":
        await runCodingAgent(job, opts?.visibleMode ?? false);
        break;
      case "hermes":
        await runHermesAgent(job);
        break;
      default:
        await runGenericAgent(job);
    }
  });
  return job;
}

export function findJobs(query?: string): AgentJob[] {
  const all = Array.from(jobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!query) return all.slice(0, 10);
  const q = query.toLowerCase();
  return all.filter(j =>
    j.id.toLowerCase() === q ||
    j.mission.toLowerCase().includes(q) ||
    j.type === q).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tool module
// ---------------------------------------------------------------------------
export const agentsModule: ToolModule = {
  name: "agents",
  declarations: [
    {
      name: "delegateTask",
      description: "Hand a big multi-step job to a background sub-agent so the conversation keeps flowing. Bella picks the right specialist unless named: generic (terminal/files/web/tools), research (deep dive with cited report), coding (builds real software), document (multi-file docs), hermes (Nous Research autonomous agent).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mission: { type: Type.STRING, description: "Full description of the job." },
          agent: { type: Type.STRING, description: "Optional: generic|research|coding|document|hermes. Omit to auto-pick." },
          exportDocx: { type: Type.BOOLEAN, description: "For research missions: also export the report as Word." },
          visibleMode: { type: Type.BOOLEAN, description: "For coding missions: open VS Code visibly." },
        },
        required: ["mission"],
      },
    },
    {
      name: "delegateParallel",
      description: "Spawn SEVERAL independent background agents at once — e.g. five reports in parallel. Each mission gets its own agent.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          missions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of independent missions." },
          agent: { type: Type.STRING },
        },
        required: ["missions"],
      },
    },
    {
      name: "agentStatus",
      description: "Report what every background agent is doing RIGHT NOW — used for 'kaam kahan tak pahuncha?' / 'how far along is that job?'.",
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING, description: "Optional filter: agent id, type, or mission keywords." } },
      },
    },
    {
      name: "cancelAgent",
      description: "Mark a background agent's job as cancelled (stops being tracked; running step finishes).",
      parameters: { type: Type.OBJECT, properties: { jobId: { type: Type.STRING } }, required: ["jobId"] },
    },
    {
      name: "startResearchMission",
      description: "Dedicated research deep-dive: plans queries, visits and cross-checks sources, writes a structured cited report saved under ~/BellaReports.",
      parameters: {
        type: Type.OBJECT,
        properties: { topic: { type: Type.STRING }, exportDocx: { type: Type.BOOLEAN } },
        required: ["topic"],
      },
    },
    {
      name: "startCodingMission",
      description: "Start the coding agent: scaffolds and ships a real project into ~/BellaProjects, self-fixes build errors, remembers lessons learned.",
      parameters: {
        type: Type.OBJECT,
        properties: { spec: { type: Type.STRING }, projectName: { type: Type.STRING }, visibleMode: { type: Type.BOOLEAN } },
        required: ["spec"],
      },
    },
    {
      name: "setCodingEngine",
      description: "Switch the coding engine: 'claude-code' (default, uses installed Claude Code CLI) or 'manishcode' (built-in engine).",
      parameters: { type: Type.OBJECT, properties: { engine: { type: Type.STRING } }, required: ["engine"] },
    },
    {
      name: "startHermesMission",
      description: "Give an open-ended mission to the Hermes autonomous agent (Nous Research) running in its own sandboxed runtime. Requires Hermes CLI installed.",
      parameters: { type: Type.OBJECT, properties: { mission: { type: Type.STRING } }, required: ["mission"] },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "delegateTask": {
        const mission = String(args.mission || "");
        let type = String(args.agent || "") as AgentType;
        const mLower = mission.toLowerCase();
        if (!type) {
          if (/research|deep dive|investigat|compare.*sources|write.*report/.test(mLower)) type = "research";
          else if (/build|code|app|project|api|website|flask|react|todo app|service/.test(mLower)) type = "coding";
          else if (/hermes/i.test(mission)) type = "hermes";
          else if (/document|docx|pdf report|spreadsheet/.test(mLower)) type = "document";
          else type = "generic";
        }
        const job = spawnJob(type, mission, { exportDocx: !!args.exportDocx, visibleMode: !!args.visibleMode });
        return { result: `Dispatched a ${type} agent (id ${job.id}). I'll keep chatting and interrupt myself when it lands. Ask 'how far along is that job?' anytime.` };
      }
      case "delegateParallel": {
        const missions = Array.isArray(args.missions) ? (args.missions as string[]) : [];
        if (!missions.length) throw new Error("No missions given.");
        const ids = missions.map(m => {
          const job = spawnJob((String(args.agent) || "generic") as AgentType, m);
          return `${job.id}: ${short(m, 50)}`;
        });
        return { result: `Spawned ${ids.length} parallel agents: ${ids.join(", ")}` };
      }
      case "agentStatus": {
        const list = findJobs(args.query ? String(args.query) : undefined);
        if (!list.length) return { result: "No background agents yet." };
        return {
          result: list.map(j => {
            const last = j.progress[j.progress.length - 1]?.text || "";
            const elapsedMin = Math.round((Date.now() - new Date(j.startedAt).getTime()) / 60000);
            return `- [${j.status.toUpperCase()}] ${j.type} agent "${short(j.mission, 70)}" (${elapsedMin} min, ${j.progress.length} steps) — ${short(last, 110)}`;
          }).join("\n"),
          count: list.length,
        };
      }
      case "cancelAgent": {
        const j = jobs.get(String(args.jobId));
        if (!j) return { result: `No agent with id ${args.jobId}.` };
        j.status = "cancelled";
        j.finishedAt = new Date().toISOString();
        persistJobs();
        return { result: `Agent ${j.id} cancelled.` };
      }
      case "startResearchMission": {
        const job = spawnJob("research", String(args.topic), { exportDocx: !!args.exportDocx });
        return { result: `Research agent dispatched (id ${job.id}). Report will land in ~/BellaReports.` };
      }
      case "startCodingMission": {
        const job = spawnJob("coding", String(args.spec), { visibleMode: !!args.visibleMode });
        return { result: `Coding agent dispatched (id ${job.id}) with engine ${getCodingEngine()}. Project will appear in ~/BellaProjects.` };
      }
      case "setCodingEngine": {
        setCodingEngine(String(args.engine));
        return { result: `Coding engine switched to ${args.engine}.` };
      }
      case "startHermesMission": {
        const job = spawnJob("hermes", String(args.mission));
        return { result: `Hermes agent dispatched (id ${job.id}) in its own sandboxed runtime.` };
      }
    }
    throw new Error(`Unknown agents tool: ${name}`);
  },
};
