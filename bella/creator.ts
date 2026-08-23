/**
 * BELLA 6.0 — Creator suite.
 *
 * - Screen recording: start/pause/resume/stop on command; capture runs inside
 *   the HUD renderer (getDisplayMedia + MediaRecorder) and lands in
 *   ~/Videos/BellaRecordings.
 * - Live commentary: turn commentary mode on and BELLA watches your screen,
 *   reacting out loud as you play, code or demo — a co-host who actually knows
 *   what's happening on screen.
 * - YouTube analytics: subscriber/view counts, recent uploads, growth against
 *   your last snapshot, audience sentiment mined from a video's comments.
 */
import fs from "fs";
import path from "path";
import { Type } from "@google/genai";
import {
  readJson, writeJson, dataFilePath, announce, analyzeImage, generateText, runCommand,
  readSecretJson, writeSecretJson,
} from "./util";
import { getCurrentApiKey } from "./util";
import type { ToolModule } from "./types";

// ===========================================================================
// Screen recording (client-executed)
// ===========================================================================
export const recorderState = {
  active: false,
  paused: false,
  startedAt: null as string | null,
};

function sendRecorder(ctx: { clientWs: { send: (d: string) => void } | null }, event: string, extra: Record<string, unknown> = {}): void {
  ctx.clientWs?.send(JSON.stringify({ type: event, ...extra }));
}

// ===========================================================================
// Live commentary
// ===========================================================================
interface CommentaryState {
  active: boolean;
  style: string;
  lastAnalyzedAt: number;
  analyzing: boolean;
}
const commentary: CommentaryState = { active: false, style: "hype", lastAnalyzedAt: 0, analyzing: false };

/** Wired by server.ts to read the newest streamed video frame. */
let lastFrameProvider: (() => string | null) | null = null;
export function setFrameProvider(fn: () => string | null): void {
  lastFrameProvider = fn;
}

const COMMENTARY_INTERVAL_MS = 16000;

const STYLE_PROMPTS: Record<string, string> = {
  hype: "You are a high-energy stream co-host. React with excitement, short punchy lines.",
  roast: "You are a playful co-host roasting what you see on screen. Tease mercilessly but keep it fun and never cruel about the person.",
  calm: "You are a calm analytical commentator describing what is happening on screen with useful insight.",
};

/** Called from server.ts every time a video frame arrives. */
export async function noteFrame(apiKey: string): Promise<void> {
  if (!commentary.active || commentary.analyzing) return;
  const now = Date.now();
  if (now - commentary.lastAnalyzedAt < COMMENTARY_INTERVAL_MS) return;

  const frame = lastFrameProvider?.();
  if (!frame || frame.length < 500) return;

  commentary.analyzing = true;
  commentary.lastAnalyzedAt = now;
  try {
    const reaction = await analyzeImage(
      apiKey,
      frame,
      `${STYLE_PROMPTS[commentary.style] || STYLE_PROMPTS.hype}\nThis is a live frame of the user's screen during a stream/demo. Give ONE short spoken reaction (max 2 sentences) about what you see right now.`,
    );
    if (reaction) announce(`(live commentary) ${reaction}`);
  } catch (err) {
    console.warn("[Commentary] analysis failed:", err);
  } finally {
    commentary.analyzing = false;
  }
}

// ===========================================================================
// YouTube analytics
// ===========================================================================
interface YtConfig {
  apiKey?: string;
  channelId?: string;
  handle?: string;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: number;
  };
}
const YT_FILE = dataFilePath("youtube.json");
const loadYt = () => readSecretJson<YtConfig>(YT_FILE, {});
const saveYt = (patch: Partial<YtConfig>) => writeSecretJson(YT_FILE, { ...loadYt(), ...patch });


async function ytApi<T>(pathName: string, params: Record<string, string>): Promise<T> {
  const cfg = loadYt();
  if (!cfg.apiKey) throw new Error("YouTube Data API key not configured. Say 'set my YouTube API key' first (free at console.cloud.google.com).");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathName}`);
  url.searchParams.set("key", cfg.apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function resolveChannelId(input?: string): Promise<string> {
  const cfg = loadYt();
  let target = String(input || "").trim() || cfg.channelId || cfg.handle || "";
  if (!target) throw new Error("No channel configured. Provide a channel handle (@name), channel ID, or run configureYouTube.");
  if (/^UC[\w-]{20,}$/.test(target)) return target;
  if (!target.startsWith("@")) target = "@" + target.replace(/^https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/)?/, "").replace(/\/$/, "");
  try {
    const r = await ytApi<{ items?: { id: { channelId: string } }[] }>("channels", { part: "id", forHandle: target });
    if (r.items?.length) return r.items[0].id.channelId;
  } catch {}
  const s = await ytApi<{ items?: { snippet: { channelId: string } }[] }>("search", { part: "snippet", q: target.slice(1), type: "channel", maxResults: "1" });
  if (s.items?.length) return s.items[0].snippet.channelId;
  throw new Error(`Channel "${input}" not found.`);
}

interface GrowthSnapshot { date: string; subs: number; views: number; videos: number; }

// ---------------------------------------------------------------------------
// YouTube OAuth (loopback flow) + resumable uploads
// ---------------------------------------------------------------------------
const YT_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
import os from "os";

async function ytAccessToken(): Promise<string> {
  const cfg = loadYt();
  const oauth = cfg.oauth;
  if (!oauth?.clientId || !oauth?.clientSecret || !oauth?.refreshToken) {
    throw new Error("YouTube account not linked. Say 'link my YouTube account' first — you'll sign in with Google in your browser.");
  }
  if (oauth.accessToken && oauth.expiresAt && Date.now() < oauth.expiresAt - 60000) {
    return oauth.accessToken;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${(await res.text()).slice(0, 200)}`);
  const tok = await res.json() as { access_token: string; expires_in: number };
  saveYt({ oauth: { ...oauth, accessToken: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 } });
  return tok.access_token;
}

async function uploadVideoToYouTube(opts: {
  filePath: string; title: string; description?: string; tags?: string[]; privacy?: string;
}): Promise<string> {
  const p = path.resolve(String(opts.filePath).replace(/^~/, os.homedir()));
  if (!fs.existsSync(p)) throw new Error(`Video file not found: ${p}`);
  const buf = fs.readFileSync(p);
  const token = await ytAccessToken();

  const meta = {
    snippet: {
      title: String(opts.title || path.basename(p)).slice(0, 100),
      description: String(opts.description || "").slice(0, 5000),
      tags: (opts.tags || []).slice(0, 15),
      categoryId: "22",
    },
    status: {
      privacyStatus: ["public", "unlisted", "private"].includes(String(opts.privacy)) ? String(opts.privacy) : "private",
      selfDeclaredMadeForKids: false,
    },
  };

  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(buf.length),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(meta),
    },
  );
  if (!init.ok) throw new Error(`Upload init failed HTTP ${init.status}: ${(await init.text()).slice(0, 200)}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("Upload session URL missing.");

  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Length": String(buf.length), "Content-Type": "video/mp4" },
    body: buf,
  });
  if (!put.ok) throw new Error(`Upload failed HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
  const done = await put.json() as { id?: string };
  return done.id || "(uploaded)";
}

/** Loopback OAuth sign-in — opens the browser and captures the redirect code. */
async function youtubeLoopbackSignIn(): Promise<{ ok: boolean; message: string }> {
  const cfg = loadYt();
  const oauth = cfg.oauth;
  if (!oauth?.clientId || !oauth?.clientSecret) {
    return { ok: false, message: "Set your Google Cloud OAuth Client ID & Secret first via configureYouTubeOAuth." };
  }
  const http = await import("http");
  return new Promise((resolve) => {
    let port = 0;
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(err
          ? `<h2>Sign-in failed: ${err}</h2><script>setTimeout(()=>close(),1500)</script>`
          : `<h2>&#10003; BELLA is linked to your channel. You can close this tab.</h2><script>setTimeout(()=>close(),1200)</script>`);
        if (!code) {
          server.close();
          resolve({ ok: false, message: `Sign-in was cancelled (${err}).` });
          return;
        }
        const exchange = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: oauth.clientId!,
            client_secret: oauth.clientSecret!,
            redirect_uri: `http://127.0.0.1:${port}`,
            grant_type: "authorization_code",
          }),
        });
        const tok = await exchange.json() as { refresh_token?: string; error_description?: string };
        server.close();
        if (!tok.refresh_token) {
          resolve({ ok: false, message: `No refresh token granted (${tok.error_description || "unknown"}). Revoke BELLA at myaccount.google.com/permissions and retry so consent shows.` });
          return;
        }
        saveYt({ oauth: { ...oauth, refreshToken: tok.refresh_token } });
        resolve({ ok: true, message: "YouTube linked! Uploads are unlocked." });
      } catch (e: any) {
        try { server.close(); } catch {}
        resolve({ ok: false, message: e.message });
      }
    });
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as any).port;
      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(oauth.clientId!)}` +
        `&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}`)}&response_type=code` +
        `&scope=${encodeURIComponent(YT_SCOPE)}&access_type=offline&prompt=consent`;
      void runCommand(`start "" "${authUrl}"`, undefined, 8000);
      console.log("[YouTube] Waiting for OAuth redirect on port", port);
      setTimeout(() => { try { server.close(); } catch {} resolve({ ok: false, message: "Sign-in timed out after three minutes." }); }, 180000);
    });
  });
}

// ===========================================================================
// Tool module
// ===========================================================================
export const creatorModule: ToolModule = {
  name: "creator",
  declarations: [
    // --- screen recording ---
    {
      name: "startScreenRecording",
      description: "Start recording the screen to a video file in ~/Videos/BellaRecordings.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "pauseScreenRecording",
      description: "Pause the running screen recording without stopping it.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "resumeScreenRecording",
      description: "Resume a paused screen recording.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "stopScreenRecording",
      description: "Stop the screen recording and finalize/save the video file.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "recordingStatus",
      description: "Check whether a screen recording is currently running, paused, duration so far.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    // --- live commentary ---
    {
      name: "setLiveCommentary",
      description: "Turn live commentary mode ON or OFF: BELLA watches your screen continuously and reacts out loud while you play, code or demo. Styles: hype, roast, calm.",
      parameters: {
        type: Type.OBJECT,
        properties: { enabled: { type: Type.BOOLEAN }, style: { type: Type.STRING, description: "hype | roast | calm" } },
        required: ["enabled"],
      },
    },
    // --- youtube analytics ---
    {
      name: "configureYouTube",
      description: "Save the YouTube Data API key and default channel handle/ID used by all analytics tools.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          apiKey: { type: Type.STRING },
          channel: { type: Type.STRING, description: "@handle or UC… channel ID." },
        },
        required: ["apiKey"],
      },
    },
    {
      name: "ytChannelStats",
      description: "Subscriber count, total views and video count for a YouTube channel (defaults to configured channel).",
      parameters: { type: Type.OBJECT, properties: { channel: { type: Type.STRING } } },
    },
    {
      name: "ytRecentUploads",
      description: "List the most recent uploads of a channel with view counts.",
      parameters: {
        type: Type.OBJECT,
        properties: { channel: { type: Type.STRING }, limit: { type: Type.INTEGER } },
      },
    },
    {
      name: "ytAudienceSentiment",
      description: "Mine a video's comments and summarize audience sentiment — positive/negative ratio, themes, notable quotes. Video can be an ID, URL, or title search on the configured channel.",
      parameters: { type: Type.OBJECT, properties: { video: { type: Type.STRING } }, required: ["video"] },
    },
    {
      name: "ytGrowthSnapshot",
      description: "Take a growth snapshot (subs/views now) and compare against the previous snapshot automatically.",
      parameters: { type: Type.OBJECT, properties: { channel: { type: Type.STRING } } },
    },
    // --- youtube uploads (OAuth) ---
    {
      name: "configureYouTubeOAuth",
      description: "Store Google Cloud OAuth Client ID & Secret used to link the user's channel for uploads.",
      parameters: {
        type: Type.OBJECT,
        properties: { clientId: { type: Type.STRING }, clientSecret: { type: Type.STRING } },
        required: ["clientId", "clientSecret"],
      },
    },
    {
      name: "linkUpYouTubeAccount",
      description: "Open a Google sign-in window and link the user's YouTube channel for uploads (one-time consent).",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "uploadVideoToYouTube",
      description: "Upload a finished video file to the linked YouTube channel with title, description and tags.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          filePath: { type: Type.STRING },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          privacy: { type: Type.STRING, description: "private (default) | unlisted | public" },
        },
        required: ["filePath", "title"],
      },
    },
  ],
  async execute(name, args, ctx) {
    switch (name) {
      // --- recorder ---
      case "startScreenRecording":
        if (recorderState.active) return { result: "A recording is already running." };
        sendRecorder(ctx, "recorder_start");
        recorderState.active = true;
        recorderState.paused = false;
        recorderState.startedAt = new Date().toISOString();
        return { result: "Recording started — capturing the screen now." };
      case "pauseScreenRecording":
        if (!recorderState.active) return { result: "Nothing is recording." };
        recorderState.paused = true;
        sendRecorder(ctx, "recorder_pause");
        return { result: "Recording paused." };
      case "resumeScreenRecording":
        if (!recorderState.active) return { result: "Nothing is recording." };
        recorderState.paused = false;
        sendRecorder(ctx, "recorder_resume");
        return { result: "Recording resumed." };
      case "stopScreenRecording": {
        if (!recorderState.active) return { result: "Nothing is recording." };
        recorderState.active = false;
        recorderState.paused = false;
        sendRecorder(ctx, "recorder_stop");
        return { result: "Recording stopped and saved into ~/Videos/BellaRecordings." };
      }
      case "recordingStatus":
        if (!recorderState.active) return { result: "No recording active." };
        return {
          result: `Recording ${recorderState.paused ? "PAUSED" : "RUNNING"} since ${recorderState.startedAt}.`,
        };

      // --- commentary ---
      case "setLiveCommentary": {
        commentary.active = !!args.enabled;
        if (args.style && ["hype", "roast", "calm"].includes(String(args.style))) commentary.style = String(args.style);
        commentary.lastAnalyzedAt = 0;
        if (commentary.active) announce("Live commentary mode engaged — I'll react as things happen on screen.");
        else announce("Live commentary mode off.");
        return { result: `Live commentary ${commentary.active ? "ON" : "OFF"}${commentary.active ? ` (${commentary.style})` : ""}.` };
      }

      // --- youtube ---
      case "configureYouTube": {
        saveYt({ apiKey: String(args.apiKey), ...(args.channel ? { handle: String(args.channel) } : {}) });
        return { result: "YouTube API key saved. Analytics unlocked." };
      }
      case "ytChannelStats": {
        const id = await resolveChannelId(args.channel as string | undefined);
        const r = await ytApi<{ items: { snippet: { title: string }; statistics: Record<string, string> }[] }>("channels", { part: "snippet,statistics", id });
        const ch = r.items?.[0];
        if (!ch) throw new Error("Channel not found.");
        return {
          result: `${ch.snippet.title}: ${Number(ch.statistics.subscriberCount || 0).toLocaleString()} subscribers, ${Number(ch.statistics.viewCount || 0).toLocaleString()} total views, ${ch.statistics.videoCount} videos.`,
        };
      }
      case "ytRecentUploads": {
        const id = await resolveChannelId(args.channel as string | undefined);
        const limit = String(Number(args.limit || 5));
        const s = await ytApi<{ items: { id: { videoId: string }; snippet: { title: string; publishedAt: string } }[] }>(
          "search", { part: "snippet", channelId: id, order: "date", type: "video", maxResults: limit });
        if (!s.items?.length) return { result: "No uploads found." };
        const vids = await ytApi<{ items: { id: string; statistics?: Record<string, string> }[] }>(
          "videos", { part: "statistics", id: s.items.map(i => i.id.videoId).join(",") });
        const viewsById = new Map(vids.items?.map(v => [v.id, v.statistics?.viewCount || "?"]));
        return {
          result: s.items.map(i => `- "${i.snippet.title}" (${new Date(i.snippet.publishedAt).toLocaleDateString()}) — ${Number(viewsById.get(i.id.videoId) || 0).toLocaleString()} views`).join("\n"),
        };
      }
      case "ytAudienceSentiment": {
        let videoId = String(args.video || "");
        const urlMatch = videoId.match(/[?&]v=([\w-]{6,})/);
        if (urlMatch) videoId = urlMatch[1];
        if (!/^[\w-]{10,}$/.test(videoId)) {
          const channelId = await resolveChannelId(undefined);
          const s = await ytApi<{ items?: { id: { videoId: string } }[] }>("search", { part: "snippet", channelId, q: videoId, type: "video", maxResults: "1" });
          videoId = s.items?.[0]?.id.videoId || "";
          if (!videoId) throw new Error(`Couldn't find a video matching "${args.video}".`);
        }
        const t = await ytApi<{ items: { snippet: { topLevelComment: { snippet: { textDisplay: string } } } }[] }>(
          "commentThreads", { part: "snippet", videoId, order: "relevance", maxResults: "50", textFormat: "plainText" });
        const comments = t.items?.map(i => i.snippet.topLevelComment.snippet.textDisplay).slice(0, 60) || [];
        if (!comments.length) return { result: "That video has no comments yet." };
        const apiKey = getCurrentApiKey();
        const sentiment = await generateText(
          apiKey,
          `Analyze these YouTube comments. Reply with: overall sentiment %, top 3 recurring themes, 2 representative quotes.\n\n${comments.join("\n- ")}`,
          "You are an audience-sentiment analyst.",
        );
        return { result: sentiment };
      }
      case "ytGrowthSnapshot": {
        const id = await resolveChannelId(args.channel as string | undefined);
        const r = await ytApi<{ items: { statistics: Record<string, string> }[] }>("channels", { part: "statistics", id });
        const st = r.items?.[0]?.statistics;
        if (!st) throw new Error("Channel not found.");
        const snapFile = dataFilePath("yt_growth.json");
        const history = readJson<GrowthSnapshot[]>(snapFile, []);
        const current: GrowthSnapshot = {
          date: new Date().toISOString(),
          subs: Number(st.subscriberCount || 0),
          views: Number(st.viewCount || 0),
          videos: Number(st.videoCount || 0),
        };
        const prev = history[history.length - 1];
        history.push(current);
        writeJson(snapFile, history.slice(-90));
        if (!prev) return { result: `Snapshot saved: ${current.subs.toLocaleString()} subs, ${current.views.toLocaleString()} views.` };
        const dSubs = current.subs - prev.subs;
        const dViews = current.views - prev.views;
        const days = Math.max(1, Math.round((Date.now() - new Date(prev.date).getTime()) / 86400000));
        return {
          result: `Since ${new Date(prev.date).toLocaleDateString()} (${days}d): ${dSubs >= 0 ? "+" : ""}${dSubs.toLocaleString()} subscribers, ${dViews >= 0 ? "+" : ""}${dViews.toLocaleString()} views. Now at ${current.subs.toLocaleString()} subs.`,
        };
      }

      // --- uploads (OAuth) ---
      case "configureYouTubeOAuth": {
        saveYt({ oauth: { ...loadYt().oauth, clientId: String(args.clientId), clientSecret: String(args.clientSecret) } });
        return { result: "OAuth client saved. Next step: 'link my YouTube account'." };
      }
      case "linkUpYouTubeAccount": {
        const out = await youtubeLoopbackSignIn();
        if (out.ok) announce(out.message);
        return { result: out.message, ok: out.ok };
      }
      case "uploadVideoToYouTube": {
        announce(`Uploading "${args.title}" to YouTube — I'll confirm when it lands.`);
        const videoId = await uploadVideoToYouTube({
          filePath: String(args.filePath),
          title: String(args.title),
          description: args.description as string | undefined,
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
          privacy: args.privacy as string | undefined,
        });
        return { result: `Upload complete! Video ID ${videoId} (${args.privacy || "private"}). Watch at youtu.be/${videoId}` };
      }
    }
    throw new Error(`Unknown creator tool: ${name}`);
  },
};
