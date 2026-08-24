/**
 * BELLA 6.0 — She grows: Skills engine, plugins & marketplaces.
 *
 * Most assistants ship with a fixed list of things they can do. BELLA extends
 * herself — writing, testing and installing brand-new Python skills at runtime,
 * versioning them, rolling bad ones back, plus a curated marketplace and
 * developer plugin loading (.py files that become voice commands).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Type } from "@google/genai";
import {
  readJson, writeJson, dataFilePath, ensureDir, runCommand, fetchText,
  generateJson, HOME,
} from "./util";
import { getCurrentApiKey } from "./util";
import type { ToolModule } from "./types";

const SKILLS_ROOT = ensureDir(dataFilePath("skills"));
const PLUGINS_ROOT = ensureDir(dataFilePath("plugins"));

export interface SkillManifest {
  name: string;
  description: string;
  type: "python" | "prompt";
  version: number;
  createdAt: string;
  updatedAt: string;
}

const skillDir = (name: string) => path.join(SKILLS_ROOT, name.replace(/[^\w.-]+/g, "-"));
const manifestPath = (name: string) => path.join(skillDir(name), "manifest.json");
const versionPath = (name: string, v: number, isPrompt: boolean) =>
  path.join(skillDir(name), isPrompt ? `v${v}.md` : `v${v}.py`);

function loadManifest(name: string): SkillManifest | null {
  return readJson<SkillManifest | null>(manifestPath(name), null);
}

function listAllSkills(): SkillManifest[] {
  const out: SkillManifest[] = [];
  try {
    for (const d of fs.readdirSync(SKILLS_ROOT)) {
      const m = loadManifest(d);
      if (m) out.push(m);
    }
  } catch {}
  return out;
}

// ---------------------------------------------------------------------------
// Code generation + sandbox testing
// ---------------------------------------------------------------------------
// The runner lives on disk instead of being passed through `python -c "..."` —
// inline code gets mangled by cmd.exe quoting on Windows (quotes stripped,
// spaces split argv), which made every skill install/run fail.
const RUNNER_SOURCE = `
import sys, json, io, contextlib, importlib.util
skill_path = sys.argv[1]
args_path = sys.argv[2]
fn_name = sys.argv[3] if len(sys.argv) > 3 else "run"
with open(args_path, "r", encoding="utf-8") as fh:
    args = json.load(fh)
spec = importlib.util.spec_from_file_location("bella_skill", skill_path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    fn = getattr(m, fn_name)
    result = fn(args)
out = str(result) if result is not None else ""
if buf.getvalue().strip():
    out = (out + chr(10) + buf.getvalue()).strip()
print(out[:4000])
`;

let pythonCache: string | null = null;
async function findPython(): Promise<string | null> {
  if (pythonCache) return pythonCache;
  for (const cmd of ["python", "py", "python3"]) {
    const r = await runCommand(`where ${cmd}`, undefined, 8000);
    if (r.ok && r.stdout.trim()) {
      pythonCache = r.stdout.trim().split(/\r?\n/)[0];
      return pythonCache;
    }
  }
  return null;
}

/** Execute a skill/plugin file's entry function with JSON args, via the file-based runner. */
async function execSkillPython(
  skillFile: string,
  args: Record<string, unknown>,
  fnName = "run",
  timeoutMs = 60000,
): Promise<{ ok: boolean; output: string }> {
  const py = await findPython();
  if (!py) return { ok: false, output: "Python interpreter not found on PATH. Install Python 3 to use code skills." };
  const runnerFile = path.join(os.tmpdir(), "bella_skill_runner.py");
  fs.writeFileSync(runnerFile, RUNNER_SOURCE);
  const argsFile = path.join(os.tmpdir(), `bella_skill_args_${process.pid}_${Date.now()}.json`);
  fs.writeFileSync(argsFile, JSON.stringify(args || {}));
  try {
    const r = await runCommand(
      `"${py}" "${runnerFile}" "${skillFile}" "${argsFile}" "${fnName}"`,
      undefined, timeoutMs,
    );
    const failed = !r.ok || /traceback/i.test(r.stderr);
    const combined = ((r.stdout || "") + (r.stderr ? `\n${r.stderr}` : "")).trim();
    return { ok: !failed, output: combined.slice(0, 1500) };
  } finally {
    try { fs.unlinkSync(argsFile); } catch {}
  }
}

async function sandboxTest(file: string): Promise<{ ok: boolean; output: string }> {
  return execSkillPython(file, {}, "run", 45000);
}

async function generateAndInstall(description: string, nameHint?: string, previousError?: string, forceKind?: "python" | "prompt"): Promise<{ manifest: SkillManifest; testOutput: string }> {
  const apiKey = getCurrentApiKey();
  for (let attempt = 0; attempt < 2; attempt++) {
    const gen = await generateJson<{ name: string; description: string; kind: "python" | "prompt"; content: string }>(
      apiKey,
      `Create a BELLA skill.\nRequested capability: ${description}\n${nameHint ? `Preferred name: ${nameHint}` : ""}\n${previousError ? `The previous attempt FAILED with:\n${previousError}\nFix it.` : ""}
Return JSON:
{"name":"kebab-case-name","description":"one line","kind":"python","content":"<full content>"}

If it can be done with pure Python stdlib, write a PYTHON skill. Content must be a complete .py file defining:
SKILL = {"name": "...", "description": "..."}
def run(args: dict) -> str:
    ...perform the task...
    return "human-readable result"
Use ONLY the Python standard library. Handle errors inside run() by returning a friendly message. Never input().`,
      "You are an expert Python developer writing voice-callable BELLA skills.",
    );

    const name = String(gen.name || nameHint || "skill").replace(/[^\w.-]+/g, "-").toLowerCase();
    const existing = loadManifest(name);
    const version = existing ? existing.version + 1 : 1;
    // Improvements must stay the same flavour — never silently flip a prompt
    // skill into a python skill (or vice versa).
    const kind = forceKind || gen.kind;

    if (kind === "prompt") {
      const manifest: SkillManifest = { name, description: gen.description || description, type: "prompt", version, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      ensureDir(skillDir(name));
      fs.writeFileSync(versionPath(name, version, true), String(gen.content));
      writeJson(manifestPath(name), manifest);
      return { manifest, testOutput: "Prompt skill installed (no sandbox needed)." };
    }

    // Python skill: write then sandbox-test BEFORE installing.
    ensureDir(skillDir(name));
    const tmpFile = versionPath(name, version, false) + ".testing";
    fs.writeFileSync(tmpFile, String(gen.content));
    const test = await sandboxTest(tmpFile);
    if (!test.ok && attempt === 0) {
      previousError = test.output;
      continue; // one retry with the error fed back
    }
    if (!test.ok) {
      try { fs.unlinkSync(tmpFile); } catch {}
      throw new Error(`Skill failed sandbox testing twice. Last output: ${test.output}`);
    }
    fs.renameSync(tmpFile, versionPath(name, version, false));
    const manifest: SkillManifest = { name, description: gen.description || description, type: "python", version, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeJson(manifestPath(name), manifest);
    return { manifest, testOutput: test.output.slice(0, 300) };
  }
  throw new Error("unreachable");
}

/** Prompt-skill block injected into the system instruction by server.ts. */
export function promptSkillsBlock(): string {
  const prompts = listAllSkills().filter(s => s.type === "prompt");
  if (!prompts.length) return "";
  let block = "\n\n=== INSTALLED PROMPT SKILLS (ways of thinking you have learned — apply when relevant) ===\n";
  for (const s of prompts) {
    const latest = fs.readFileSync(versionPath(s.name, s.version, true), "utf-8");
    block += `\n--- Skill: ${s.name} ---\n${latest.slice(0, 1200)}\n`;
  }
  return block + "\n=== END PROMPT SKILLS ===\n";
}

/** Execute an installed python skill. */
async function runSkillByName(name: string, args: Record<string, unknown>): Promise<unknown> {
  const manifest = loadManifest(String(name));
  if (!manifest) throw new Error(`No skill named "${name}".`);
  if (manifest.type === "prompt") {
    return { result: `"${name}" is a prompt skill — its instructions are always active in my thinking.` };
  }
  const file = versionPath(manifest.name, manifest.version, false);
  const r = await execSkillPython(file, args || {});
  const output = r.output.trim();
  return { result: output.slice(0, 2000) || "(no output)", ok: r.ok };
}

// ---------------------------------------------------------------------------
// Curated marketplace (bundled catalog — installs offline via the generator)
// ---------------------------------------------------------------------------
const MARKETPLACE: { id: string; name: string; description: string; spec: string }[] = [
  { id: "heic-to-jpeg", name: "HEIC → JPEG converter", description: "Convert iPhone HEIC photos to JPEG.", spec: "Convert every .heic/.HEIC photo in a given folder to JPEG using pure-Python approaches where possible; if HEIC decoding needs external tools fall back to clear guidance." },
  { id: "qr-generator", name: "QR code generator", description: "Generate a QR code PNG for any text/URL.", spec: "Generate a QR code PNG file for given text without third-party packages: implement QR generation algorithm (byte mode, error correction M) and save PNG via zlib+struct." },
  { id: "image-resize", name: "Bulk image resizer", description: "Resize all images in a folder to a max dimension.", spec: "Resize images in a folder to max width/height using only stdlib where feasible; support PNG via zlib-based minimal encoder, else produce clear step-by-step PowerShell fallback command as the returned string." },
  { id: "text-watermark", name: "PDF watermark helper", description: "Produce a PowerShell/pdftk command recipe to watermark PDFs.", spec: "Given folder + watermark text, return ready-to-run commands that stamp the watermark onto every PDF." },
  { id: "audio-extract", name: "Audio extractor guide", description: "Extract audio track from videos via ffmpeg recipes.", spec: "Given a video path, detect if ffmpeg exists and return/run the exact command to extract audio to mp3." },
  { id: "csv-cleaner", name: "CSV cleaner", description: "Clean messy CSVs: trim spaces, drop empty rows, fix headers.", spec: "Read a CSV path argument, clean common issues (BOM, whitespace, duplicate headers, empty rows), write cleaned CSV next to original, report what changed." },
  { id: "password-gen", name: "Strong password generator", description: "Generate secure random passwords/passphrases.", spec: "Generate N cryptographically-random passwords of given length with mixed classes using secrets module." },
  { id: "speed-test", name: "Internet speed probe", description: "Rough download speed measurement.", spec: "Measure approximate internet download speed by timing a fetch of a few public test files with urllib; return Mbps estimate." },
];

// ---------------------------------------------------------------------------
// Tool module
// ---------------------------------------------------------------------------
export const skillsModule: ToolModule = {
  name: "skills",
  declarations: [
    {
      name: "learnSkill",
      description: "Learn a NEW ability on the spot: writes the code, sandbox-tests it, versions and installs it. 'Bella, learn to convert HEIC photos to JPEG.'",
      parameters: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: "What the skill should do." },
          name: { type: Type.STRING, description: "Optional preferred name." },
        },
        required: ["description"],
      },
    },
    {
      name: "listInstalledSkills",
      description: "List installed skills (code + prompt skills) with versions.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "runSkill",
      description: "Execute an installed skill by name with optional arguments object.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, args: { type: Type.OBJECT, description: "Arguments for the skill.", properties: {} } },
        required: ["name"],
      },
    },
    {
      name: "improveSkill",
      description: "Improve an existing skill based on user feedback — generates a new tested version.",
      parameters: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, feedback: { type: Type.STRING } },
        required: ["name", "feedback"],
      },
    },
    {
      name: "rollbackSkill",
      description: "Roll a skill back to the last version that worked.",
      parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
    },
    {
      name: "deleteSkill",
      description: "Delete an installed skill entirely.",
      parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
    },
    {
      name: "browseSkillMarketplace",
      description: "Show the curated open-source skill marketplace catalog.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "installMarketplaceSkill",
      description: "Install a skill from the marketplace by id or name.",
      parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] },
    },
    {
      name: "installSkillFromFileOrUrl",
      description: "Install a skill from a local .py file or a raw GitHub/file URL.",
      parameters: { type: Type.OBJECT, properties: { source: { type: Type.STRING } }, required: ["source"] },
    },
    // --- plugins ---
    {
      name: "loadPlugin",
      description: "Load a developer plugin (a .py file containing a BELLA_PLUGIN dict) from a local path or GitHub URL. Its functions become voice-callable.",
      parameters: { type: Type.OBJECT, properties: { source: { type: Type.STRING } }, required: ["source"] },
    },
    {
      name: "listPlugins",
      description: "List loaded plugins and their callable functions.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "callPluginFunction",
      description: "Call a function provided by a loaded plugin.",
      parameters: {
        type: Type.OBJECT,
        properties: { plugin: { type: Type.STRING }, functionName: { type: Type.STRING }, args: { type: Type.OBJECT, properties: {} } },
        required: ["plugin", "functionName"],
      },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "learnSkill": {
        const { manifest, testOutput } = await generateAndInstall(String(args.description), args.name as string | undefined);
        return {
          result: `Learned new ${manifest.type} skill "${manifest.name}" (v${manifest.version}). ${manifest.description}${manifest.type === "python" ? ` Sandbox test passed: ${testOutput}` : ""}`,
        };
      }
      case "listInstalledSkills": {
        const all = listAllSkills();
        return {
          result: all.length ? all.map(s => `- ${s.name} v${s.version} [${s.type}] — ${s.description}`).join("\n") : "No custom skills yet. Ask me to learn one!",
          count: all.length,
        };
      }
      case "runSkill":
        return runSkillByName(String(args.name), (args.args as Record<string, unknown>) || {});
      case "improveSkill": {
        const old = loadManifest(String(args.name));
        if (!old) throw new Error(`No skill named "${args.name}".`);
        const currentContent = fs.readFileSync(versionPath(old.name, old.version, old.type === "prompt"), "utf-8");
        const { manifest, testOutput } = await generateAndInstall(
          `${old.description}\n\nIMPROVEMENT REQUEST: ${args.feedback}\n\nCurrent implementation to improve:\n${currentContent.slice(0, 4000)}`,
          old.name,
          undefined,
          old.type,
        );
        return { result: `Improved "${manifest.name}" to v${manifest.version}. ${testOutput}` };
      }
      case "rollbackSkill": {
        const m = loadManifest(String(args.name));
        if (!m) throw new Error(`No skill named "${args.name}".`);
        if (m.version <= 1) throw new Error("Already at first version.");
        m.version -= 1;
        m.updatedAt = new Date().toISOString();
        writeJson(manifestPath(m.name), m);
        return { result: `Rolled back "${m.name}" to v${m.version}.` };
      }
      case "deleteSkill": {
        const dir = skillDir(String(args.name));
        if (!fs.existsSync(dir)) throw new Error(`No skill named "${args.name}".`);
        fs.rmSync(dir, { recursive: true, force: true });
        return { result: `Deleted skill "${args.name}".` };
      }
      case "browseSkillMarketplace":
        return {
          result: "Skill Marketplace — curated catalog:\n" +
            MARKETPLACE.map(s => `- ${s.id}: ${s.name} — ${s.description}`).join("\n") +
            "\nSay 'install <id>' to add any of these.",
        };
      case "installMarketplaceSkill": {
        const entry = MARKETPLACE.find(s => s.id === String(args.id) || s.name.toLowerCase() === String(args.id).toLowerCase())
          || MARKETPLACE.find(s => s.id.includes(String(args.id)));
        if (!entry) throw new Error(`Marketplace has no skill matching "${args.id}".`);
        const { manifest } = await generateAndInstall(entry.spec, entry.id);
        return { result: `Installed marketplace skill "${manifest.name}" (v${manifest.version}).` };
      }
      case "installSkillFromFileOrUrl": {
        const src = String(args.source || "");
        let content: string;
        let baseName: string;
        if (/^https?:\/\//i.test(src)) {
          content = await fetchText(src, 30000);
          baseName = path.parse(new URL(src).pathname).name || "remote-skill";
        } else {
          const p = src.replace(/^~/, HOME());
          content = fs.readFileSync(p, "utf-8");
          baseName = path.parse(p).name;
        }
        const name = baseName.replace(/[^\w.-]+/g, "-").toLowerCase();
        ensureDir(skillDir(name));
        const existing = loadManifest(name);
        const version = existing ? existing.version + 1 : 1;
        const tmp = versionPath(name, version, false) + ".testing";
        fs.writeFileSync(tmp, content);
        const test = await sandboxTest(tmp);
        if (!test.ok) {
          try { fs.unlinkSync(tmp); } catch {}
          throw new Error(`Skill failed sandbox testing: ${test.output}`);
        }
        fs.renameSync(tmp, versionPath(name, version, false));
        const manifest: SkillManifest = { name, description: `Imported skill from ${src}`, type: "python", version, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
        writeJson(manifestPath(name), manifest);
        return { result: `Installed skill "${name}" v${version}. Sandbox test passed.` };
      }

      // ---- plugins ----
      case "loadPlugin": {
        const src = String(args.source || "");
        let content: string;
        let fileName: string;
        if (/^https?:\/\//i.test(src)) {
          content = await fetchText(src, 30000);
          fileName = path.parse(new URL(src).pathname).name + ".py";
        } else {
          const p = src.replace(/^~/, HOME());
          content = fs.readFileSync(p, "utf-8");
          fileName = path.basename(p);
        }
        if (!/BELLA_PLUGIN\s*=/.test(content)) {
          throw new Error("That file doesn't contain a BELLA_PLUGIN dict — see the plugin docs.");
        }
        fs.writeFileSync(path.join(PLUGINS_ROOT, fileName), content);
        return { result: `Plugin ${fileName} loaded. Its functions are now voice-callable via callPluginFunction.` };
      }
      case "listPlugins": {
        const files = fs.existsSync(PLUGINS_ROOT) ? fs.readdirSync(PLUGINS_ROOT).filter(f => f.endsWith(".py")) : [];
        return {
          result: files.length
            ? files.map(f => {
              const meta = readJson<{ name?: string; description?: string; functions?: Record<string, unknown> }>(
                path.join(PLUGINS_ROOT, f.replace(/\.py$/, ".plugin.json")), {});
              return `- ${f}${meta.name ? ` (${meta.name})` : ""}: ${Object.keys(meta.functions || {}).join(", ") || "functions discovered at call time"}`;
            }).join("\n")
            : "No plugins loaded yet. Drop a .py with a BELLA_PLUGIN dict via loadPlugin.",
        };
      }
      case "callPluginFunction": {
        const pluginName = String(args.plugin);
        const file = path.join(PLUGINS_ROOT, pluginName.endsWith(".py") ? pluginName : pluginName + ".py");
        if (!fs.existsSync(file)) throw new Error(`Plugin "${pluginName}" not found.`);
        const fn = String(args.functionName || "run");
        const r = await execSkillPython(file, (args.args as Record<string, unknown>) || {}, fn);
        return {
          result: r.ok
            ? (r.output.slice(0, 2000) || `(done: ${fn})`)
            : `Plugin call failed: ${r.output.slice(0, 500)}`,
          ok: r.ok,
        };
      }
    }
    throw new Error(`Unknown skills tool: ${name}`);
  },
};
