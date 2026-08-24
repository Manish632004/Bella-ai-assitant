/**
 * BELLA 6.0 — One-click in-app updates.
 *
 * Checks GitHub releases for a configured repository, compares versions,
 * downloads the installer and launches it. Configure once:
 * "Bella, set update repo to owner/bella-app".
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { Type } from "@google/genai";
import { readJson, writeJson, dataFilePath, fetchJson } from "./util";
import type { ToolModule } from "./types";

interface UpdateConfig {
  repo?: string;            // "owner/repo"
  autoCheckHours?: number;
  lastCheckedAt?: string;
}
const CONFIG_FILE = dataFilePath("updater.json");
const loadCfg = () => readJson<UpdateConfig>(CONFIG_FILE, {});
const saveCfg = (patch: Partial<UpdateConfig>) => writeJson(CONFIG_FILE, { ...loadCfg(), ...patch });

function currentVersion(): string {
  // Works in dev (cwd = repo root) and in the esbuild bundle (__dirname = dist),
  // plus packaged installs where package.json ships next to the bundle.
  const candidates = [
    path.join(process.cwd(), "package.json"),
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (pkg?.version && pkg.name === "BELLA") return String(pkg.version);
      if (pkg?.version) return String(pkg.version);
    } catch { /* try next */ }
  }
  return "0.0.0";
}

function normalizeVer(v: string): number[] {
  return v.replace(/^v/i, "").split(/[.-]/).map(n => parseInt(n, 10) || 0);
}

function isNewer(remote: string, local: string): boolean {
  const r = normalizeVer(remote), l = normalizeVer(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

interface ReleaseInfo {
  tagName: string;
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  downloadUrl?: string;
  assetName?: string;
}

async function latestRelease(): Promise<ReleaseInfo> {
  const cfg = loadCfg();
  if (!cfg.repo) throw new Error("Update source not configured. Say 'set update repo to <github owner/repo>' first.");
  const rel = await fetchJson<{
    tag_name?: string; name?: string; body?: string; published_at?: string; html_url?: string;
    assets: { name: string; browser_download_url: string }[];
  }>(`https://api.github.com/repos/${cfg.repo}/releases/latest`, 20000, {
    headers: { "User-Agent": "BELLA-Updater", Accept: "application/vnd.github+json" },
  });
  const installer = (rel.assets || []).find(a => /\.(exe|msi)$/i.test(a.name));
  return {
    tagName: rel.tag_name || "",
    version: (rel.tag_name || "").replace(/^v/i, ""),
    name: rel.name || rel.tag_name || "",
    notes: (rel.body || "").slice(0, 600),
    publishedAt: rel.published_at || "",
    downloadUrl: installer?.browser_download_url,
    assetName: installer?.name,
  };
}

let downloading = false;

export const updaterModule: ToolModule = {
  name: "updater",
  declarations: [
    {
      name: "checkForUpdates",
      description: "Check BELLA's release channel for a newer version and report what's new.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "installUpdate",
      description: "Download the newest BELLA release and launch its installer (one-click in-app update).",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "setUpdateRepo",
      description: "Configure the GitHub repository BELLA checks for updates ('owner/repo').",
      parameters: { type: Type.OBJECT, properties: { repo: { type: Type.STRING } }, required: ["repo"] },
    },
  ],
  async execute(name, args) {
    switch (name) {
      case "setUpdateRepo": {
        const repo = String(args.repo || "").replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Repo must look like 'owner/repo'.");
        saveCfg({ repo });
        return { result: `Update channel set to github.com/${repo}.` };
      }
      case "checkForUpdates": {
        const rel = await latestRelease();
        saveCfg({ lastCheckedAt: new Date().toISOString() });
        const local = currentVersion();
        if (!isNewer(rel.version, local)) {
          return { result: `You're up to date — BELLA ${local} is the latest release.` };
        }
        return {
          result: `BELLA ${rel.version} is available (you have ${local}). What's new: ${rel.notes.slice(0, 300)}. Say 'install update' to get it.`,
          version: rel.version,
        };
      }
      case "installUpdate": {
        const rel = await latestRelease();
        if (!isNewer(rel.version, currentVersion())) return { result: `Already on the latest version (${currentVersion()}).` };
        if (!rel.downloadUrl) throw new Error("No installer asset attached to the latest release.");
        if (downloading) return { result: "An update download is already running." };
        downloading = true;
        // Kick off download+install in background; report immediately.
        void (async () => {
          try {
            const dest = path.join(os.tmpdir(), rel.assetName || "bella-update.exe");
            const res = await fetch(rel.downloadUrl!);
            if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(dest, buf);
            // Launch installer detached (NSIS /S silent flag works for most builds).
            spawn(dest, ["/S"], { detached: true, stdio: "ignore" }).unref();
          } catch (err) {
            console.error("[Updater] install failed:", err);
          } finally {
            downloading = false;
          }
        })();
        return { result: `Downloading BELLA ${rel.version}… the installer will launch when it lands. Keep this session open.` };
      }
    }
    throw new Error(`Unknown updater tool: ${name}`);
  },
};
