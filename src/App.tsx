import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { BellaAudioSession, LiveState } from "./lib/audio";
import { BellaCoreVisualizer, BellaEmotion } from "./components/BellaCoreVisualizer";
import { BrowserAgent } from "./components/BrowserAgent";
import { 
  Power, 
  Volume2, 
  Info, 
  Sparkles, 
  Globe, 
  Maximize2, 
  Minimize2,
  MessageSquareOff, 
  Compass, 
  CircleAlert,
  MicOff,
  Mic,
  X,
  Brain,
  Monitor,
  Play,
  Pause,
  Square,
  RefreshCw,
  PictureInPicture2,
  Minus,
  Settings as SettingsIcon,
  LayoutDashboard,
  Search,
  Camera,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Memory, MemoryCategory } from "./lib/memoryTypes";
import { MemoryDashboard } from "./components/MemoryDashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { BellaSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from "./lib/settingsStore";
import { BellaWakeWordDetector } from "./lib/wakeWord";
import { ProactiveSuggestionCard } from "./components/ProactiveSuggestionCard";
import { ProactiveSettings, ProactiveSuggestion } from "../proactive/types";
import { PersonalAIDashboard } from "./components/dashboard/PersonalAIDashboard";
import { CommandPalette } from "./components/dashboard/CommandPalette";
import { CameraVisionWidget } from "./components/vision/CameraVisionWidget";
import { Whiteboard, type WbElement } from "./components/Whiteboard";

export default function App() {
  const [state, setState] = useState<LiveState>("disconnected");
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showCameraVision, setShowCameraVision] = useState<boolean>(false);

  // Real-time Screen Sharing states
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isScreenSharingPaused, setIsScreenSharingPaused] = useState<boolean>(false);
  const [screenVisionMode, setScreenVisionMode] = useState<boolean>(true);

  // References to preserve state across intervals
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenIntervalRef = useRef<any>(null);

  const isPausedRef = useRef<boolean>(false);
  const screenVisionRef = useRef<boolean>(true);
  const stateRef = useRef<LiveState>("disconnected");

  // Sync state changes with refs to totally prevent stale closures in callbacks
  useEffect(() => {
    isPausedRef.current = isScreenSharingPaused;
  }, [isScreenSharingPaused]);

  useEffect(() => {
    screenVisionRef.current = screenVisionMode;
  }, [screenVisionMode]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Clean up streaming intervals on unmount
  useEffect(() => {
    return () => {
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
    };
  }, []);

  const captureFrameAndSend = () => {
    const video = screenVideoRef.current;
    if (!video || isPausedRef.current || !screenVisionRef.current) {
      return;
    }

    // Only send frames when actively connected and interacting
    if (stateRef.current !== "listening" && stateRef.current !== "speaking") {
      return;
    }

    try {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.videoWidth < 10 || video.videoHeight < 10) {
        return;
      }

      if (!screenCanvasRef.current) {
        screenCanvasRef.current = document.createElement("canvas");
      }
      const canvas = screenCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // 768px maximum resolution keeps latency minimal and ensures reliable Gemini Live vision processing
      const maxDim = 768;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(video, 0, 0, width, height);

      // Lightweight 0.50 JPEG encoding ensures lightning-fast transmission without socket saturation
      const dataUrl = canvas.toDataURL("image/jpeg", 0.50);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";

      if (base64 && base64.length > 50 && sessionRef.current && stateRef.current !== "disconnected") {
        sessionRef.current.sendVideoFrame(base64);
      }
    } catch (err) {
      console.error("[Screen Capture] Failed drawing frame to canvas:", err);
    }
  };

  // BELLA 6.0 — GDI fallback: when Windows denies WebRTC capture (elevated
  // process / driver policy), poll the server's GDI screenshot endpoint so
  // Bella's vision keeps working.
  const gdiFrameTimerRef = useRef<any>(null);
  const [isGdiCapture, setIsGdiCapture] = useState<boolean>(false);
  const [gdiPreviewSrc, setGdiPreviewSrc] = useState<string>("");

  const startGdiFrameFallback = () => {
    console.log("[Screen Sharing] WebRTC capture unavailable — engaging GDI fallback via desktop agent.");
    setIsGdiCapture(true);
    setIsScreenSharing(true);
    setIsScreenSharingPaused(false);

    if (stateRef.current === "disconnected") {
      setSleepReason("none");
      sessionRef.current?.connect();
    }

    if (gdiFrameTimerRef.current) clearInterval(gdiFrameTimerRef.current);
    gdiFrameTimerRef.current = setInterval(async () => {
      if (isPausedRef.current || !screenVisionRef.current) return;
      try {
        const res = await fetch("/api/screen-frame");
        const data = await res.json();
        if (data.ok && data.jpegBase64 && sessionRef.current && stateRef.current !== "disconnected") {
          sessionRef.current.sendVideoFrame(data.jpegBase64);
          setGdiPreviewSrc(`data:image/jpeg;base64,${data.jpegBase64}`);
        }
      } catch { /* agent offline — retry next tick */ }
    }, 2000);
  };

  const startScreenSharing = async () => {
    setErrorText(null);
    try {
      let stream: MediaStream | null = null;

      // In Electron desktop environment, try standard getDisplayMedia or desktopSources fallback
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 5 }
            },
            audio: false
          });
        } catch (displayMediaErr: any) {
          console.warn("[Screen Sharing] getDisplayMedia fallback check:", displayMediaErr);
        }
      }

      // If getDisplayMedia was not available or threw unsupported, fallback to desktopSources via getUserMedia in Electron
      if (!stream && (window as any)?.bella?.isDesktop && (window as any)?.bella?.getDesktopSources) {
        const sources = await (window as any).bella.getDesktopSources();
        const primarySource = sources?.[0];
        if (primarySource) {
          stream = await (navigator.mediaDevices as any).getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: primarySource.id,
                minWidth: 1280,
                maxWidth: 1920,
                maxHeight: 1080,
                maxFrameRate: 5,
              }
            }
          });
        }
      }

      if (!stream) {
        throw new Error("Unable to capture screen on this platform.");
      }

      screenStreamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(e => console.error("Video play warning:", e));
      screenVideoRef.current = video;

      setIsScreenSharing(true);
      setIsScreenSharingPaused(false);

      // If Bella is currently disconnected, wake her up once for the screen share session
      if (stateRef.current === "disconnected") {
        setSleepReason("none");
        sessionRef.current?.connect();
      }

      // Stop handling when native stop sharing bar button ends
      const shareStartedAt = Date.now();
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (Date.now() - shareStartedAt < 3000) {
            // Source died instantly — classic sign of OS-level capture denial.
            console.warn("[Screen Sharing] Capture source ended immediately; engaging GDI fallback.");
            stopScreenSharing();
            startGdiFrameFallback();
          } else {
            stopScreenSharing();
          }
        };
      }

      // Set up frame capture interval (one frame every 2 seconds is highly robust, preventing overload)
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
      screenIntervalRef.current = setInterval(() => {
        captureFrameAndSend();
      }, 2000);

      // Promptly capture first frame immediately
      setTimeout(() => {
        captureFrameAndSend();
      }, 500);

    } catch (e: any) {
      console.error("Screen sharing permission declined or missing API:", e);
      // BELLA 6.0 — OS denied WebRTC capture; switch to the GDI fallback
      // instead of showing a dead-end error (capture still works there).
      setErrorText(null);
      startGdiFrameFallback();
    }
  };

  const stopScreenSharing = () => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }

    // BELLA 6.0 — also stop the GDI fallback poller
    if (gdiFrameTimerRef.current) {
      clearInterval(gdiFrameTimerRef.current);
      gdiFrameTimerRef.current = null;
    }
    setIsGdiCapture(false);

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current = null;
    }

    setIsScreenSharing(false);
    setIsScreenSharingPaused(false);
  };

  const pauseScreenSharing = () => {
    setIsScreenSharingPaused(true);
  };

  const resumeScreenSharing = () => {
    setIsScreenSharingPaused(false);
    // Refresh first frame immediately
    setTimeout(() => {
      captureFrameAndSend();
    }, 100);
  };

  const switchScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
    }
    await startScreenSharing();
  };

  // ===========================================================================
  // BELLA 6.0 — Screen Recorder (voice-controlled, saved to ~/Videos/BellaRecordings)
  // ===========================================================================
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const [isRecordingScreen, setIsRecordingScreen] = useState(false);

  const startScreenRecording = async () => {
    try {
      if (recorderRef.current) return;
      let stream: MediaStream | null = null;
      if (navigator.mediaDevices?.getDisplayMedia) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: false,
        });
      }
      if (!stream && screenStreamRef.current) {
        // Reuse the active vision stream if the user declines the picker
        stream = new MediaStream(screenStreamRef.current.getVideoTracks());
      }
      if (!stream) throw new Error("No display source available for recording.");

      recorderStreamRef.current = stream;
      recorderChunksRef.current = [];
      const mimeCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported?.(m)) || "";
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size > 0) recorderChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(recorderChunksRef.current, { type: "video/webm" });
        recorderChunksRef.current = [];
        const fileName = `bella-recording-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.webm`;
        try {
          if ((window as any).bella?.saveRecording) {
            const buf = await blob.arrayBuffer();
            const res = await (window as any).bella.saveRecording(buf, fileName);
            console.log("[Recorder] Saved:", res.path);
          } else {
            // Browser dev fallback: trigger a download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch (err) {
          console.error("[Recorder] save failed:", err);
        }
        stream?.getTracks().forEach(t => { try { t.stop(); } catch {} });
        recorderRef.current = null;
        recorderStreamRef.current = null;
        setIsRecordingScreen(false);
      };
      rec.start(1000);
      recorderRef.current = rec;
      setIsRecordingScreen(true);
    } catch (err: any) {
      console.error("[Recorder] start failed:", err);
      setErrorText(`Recording failed to start: ${err.message || err}`);
    }
  };

  const stopScreenRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      setIsRecordingScreen(false);
    }
  };

  const pauseScreenRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.pause();
  };

  const resumeScreenRecording = () => {
    if (recorderRef.current?.state === "paused") recorderRef.current.resume();
  };

  // ===========================================================================
  // BELLA 6.0 — Voice Guardian enrollment (record 3 "Hey Bella" samples)
  // ===========================================================================
  const runGuardianEnrollment = useCallback(async () => {
    const encodeWav = (buffer: AudioBuffer): string => {
      const numCh = buffer.numberOfChannels;
      const len = buffer.length;
      const sampleRate = buffer.sampleRate;
      const bytes = new DataView(new ArrayBuffer(44 + len * numCh * 2));
      const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) bytes.setUint8(off + i, s.charCodeAt(i)); };
      wstr(0, "RIFF"); bytes.setUint32(4, 36 + len * numCh * 2, true); wstr(8, "WAVE");
      wstr(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true);
      bytes.setUint16(22, numCh, true); bytes.setUint32(24, sampleRate, true);
      bytes.setUint32(28, sampleRate * numCh * 2, true); bytes.setUint16(32, numCh * 2, true);
      bytes.setUint16(34, 16, true); wstr(36, "data"); bytes.setUint32(40, len * numCh * 2, true);
      let off = 44;
      for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < numCh; ch++) {
          const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
          bytes.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          off += 2;
        }
      }
      let binary = "";
      const arr = new Uint8Array(bytes.buffer);
      for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
      return btoa(binary);
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const samples: string[] = [];
      const ctx = new AudioContext();
      for (let i = 0; i < 3; i++) {
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        const done = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
        recorder.start();
        await new Promise(r => setTimeout(r, 1800)); // ~1.8s of speech per sample
        recorder.stop();
        await done;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const ab = await blob.arrayBuffer();
        // Decode & re-encode as WAV PCM16 so the server fingerprinter can parse it
        const audioBuf = await ctx.decodeAudioData(ab.slice(0));
        samples.push(encodeWav(audioBuf));
      }
      stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      ctx.close();
      const res = await fetch("/api/guardian/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples }),
      });
      const json = await res.json();
      console.log("[Guardian] Enrollment result:", json);
    } catch (err: any) {
      console.error("[Guardian] enrollment failed:", err);
      setErrorText(`Voice enrollment failed: ${err.message || err}`);
    }
  }, []);

  // ===========================================================================
  // BELLA 6.0 — Whiteboard & study engine
  // ===========================================================================
  const [wbOpen, setWbOpen] = useState(false);
  const [wbTopic, setWbTopic] = useState("");
  const [wbPending, setWbPending] = useState<WbElement | null>(null);
  const [wbDrawSignal, setWbDrawSignal] = useState(0);
  const [wbClearSignal, setWbClearSignal] = useState(0);
  const [wbSaveSignal, setWbSaveSignal] = useState(0);
  const [wbSaveName, setWbSaveName] = useState("");

  // ===========================================================================
  // BELLA 6.0 — capability-layer WS events dispatcher
  // ===========================================================================
  const activePersonaIdRef = useRef<string | null>(null);

  const reconnectForPersona = useCallback(() => {
    setTimeout(() => {
      if (sessionRef.current && sessionRef.current.getState() !== "disconnected") {
        console.log("[Bella 6.0] Reconnecting live session so the new persona voice applies.");
        sessionRef.current.disconnect();
        setTimeout(() => {
          setSleepReason("none");
          sessionRef.current?.connect();
        }, 700);
      }
    }, 1200);
  }, []);

  // Settings-panel → HUD bridges (BELLA 6.0 tab)
  useEffect(() => {
    const onEnroll = () => void runGuardianEnrollment();
    const onReconnect = () => reconnectForPersona();
    window.addEventListener("bella:guardian-enroll", onEnroll);
    window.addEventListener("bella:reconnect-persona", onReconnect);
    return () => {
      window.removeEventListener("bella:guardian-enroll", onEnroll);
      window.removeEventListener("bella:reconnect-persona", onReconnect);
    };
  }, [runGuardianEnrollment, reconnectForPersona]);

  const handleBellaEvent = useCallback((event: { type: string } & Record<string, any>) => {
    console.log("[Bella 6.0 Event]", event.type, event);
    switch (event.type) {
      case "recorder_start": void startScreenRecording(); break;
      case "recorder_stop": stopScreenRecording(); break;
      case "recorder_pause": pauseScreenRecording(); break;
      case "recorder_resume": resumeScreenRecording(); break;
      case "guardian_enroll": void runGuardianEnrollment(); break;
      case "hud_move":
        if ((window as any).bella?.positionHudCorner) {
          const where = String(event.where || "");
          if (/left/.test(where)) (window as any).bella.positionHudCorner(/top/.test(where) ? "top-left" : "bottom-left");
          else if (/right/.test(where)) (window as any).bella.positionHudCorner(/top/.test(where) ? "top-right" : "bottom-right");
          else if (/center|middle/.test(where)) (window as any).bella.positionHudCorner("center");
          else if (/top/.test(where)) (window as any).bella.positionHudCorner("top-right");
          else (window as any).bella.positionHudCorner("bottom-right");
        }
        break;
      case "hud_visibility":
        if ((window as any).bella?.setHudVisibility) {
          (window as any).bella.setHudVisibility(!!event.visible);
        }
        break;
      case "whiteboard_open":
        setWbTopic(String(event.topic || ""));
        setWbOpen(true);
        break;
      case "whiteboard_draw":
        setWbPending(event.element || null);
        setWbDrawSignal(s => s + 1);
        break;
      case "whiteboard_clear":
        setWbClearSignal(s => s + 1);
        break;
      case "whiteboard_save":
        setWbSaveName(String(event.name || "whiteboard"));
        setWbSaveSignal(s => s + 1);
        break;
      case "whiteboard_close":
        setWbOpen(false);
        break;
      case "persona_changed":
        // Explicit voice switch — always applies via reconnect.
        if (event.theme) setThemeColor(String(event.theme));
        activePersonaIdRef.current = String(event.persona || "");
        reconnectForPersona();
        break;
      case "persona_info":
        // Server announces the active persona on EVERY connect. Only
        // reconnect if it genuinely differs from the one this session uses.
        if (event.theme) setThemeColor(String(event.theme));
        if (activePersonaIdRef.current === null) {
          // First announcement of this app run — adopt it silently.
          activePersonaIdRef.current = String(event.persona || "");
        } else if (String(event.persona || "") !== activePersonaIdRef.current) {
          activePersonaIdRef.current = String(event.persona || "");
          reconnectForPersona();
        }
        break;
      default:
        break;
    }
  }, [runGuardianEnrollment, reconnectForPersona]);

  const [activeEmotion, setActiveEmotion] = useState<BellaEmotion>("idle");
  const [themeColor, setThemeColor] = useState<string>("charcoal");
  const [userCaption, setUserCaption] = useState<string>("");
  const [characterState, setCharacterState] = useState<"idle" | "thinking" | "talking">("idle");
  const [isMiniMode, setIsMiniMode] = useState<boolean>(false);

  // Sync mini mode state with native Electron window
  useEffect(() => {
    if ((window as any).bella?.setMiniMode) {
      (window as any).bella.setMiniMode(isMiniMode);
    }
  }, [isMiniMode]);

  // Voice triggers for floating / expanding
  useEffect(() => {
    if (!userCaption) return;
    const lower = userCaption.toLowerCase();
    if (
      lower.includes("shrink") ||
      lower.includes("mini mode") ||
      lower.includes("float mode") ||
      lower.includes("float character") ||
      lower.includes("corner avatar") ||
      lower.includes("go to corner")
    ) {
      setIsMiniMode(true);
    } else if (
      lower.includes("expand stage") ||
      lower.includes("full screen") ||
      lower.includes("maximize") ||
      lower.includes("exit mini") ||
      lower.includes("full stage")
    ) {
      setIsMiniMode(false);
    }

    // Direct Voice Triggers for Continuous Camera Vision
    if (
      lower.includes("open camera") ||
      lower.includes("turn on camera") ||
      lower.includes("start camera") ||
      lower.includes("use camera") ||
      lower.includes("enable camera") ||
      lower.includes("look at this") ||
      lower.includes("look through camera") ||
      lower.includes("can you see this") ||
      lower.includes("see what i'm showing") ||
      lower.includes("see what im showing")
    ) {
      setShowCameraVision(true);
    } else if (
      lower.includes("turn off camera") ||
      lower.includes("stop camera") ||
      lower.includes("turn off the camera") ||
      lower.includes("stop using camera") ||
      lower.includes("stop the camera") ||
      lower.includes("close the camera") ||
      lower.includes("disable camera") ||
      lower.includes("shut off camera")
    ) {
      setShowCameraVision(false);
    }

    // BELLA 6.0 — "so jao": hands-free sleep; wake word re-activates her
    if (
      /\bso jao\b/.test(lower) ||
      lower.includes("go to sleep") ||
      lower.includes("sleep now bella") ||
      lower.includes("bella sleep") ||
      lower.includes("goodnight bella") ||
      lower.includes("good night bella")
    ) {
      console.log("[Bella 6.0] Sleep command received ('so jao').");
      setSleepReason("auto"); // auto standby keeps the offline wake word armed
      if (sessionRef.current && sessionRef.current.getState() !== "disconnected") {
        sessionRef.current.disconnect();
      }
    }

    // BELLA 6.0 — hide/show her own window by voice
    if (/(hide yourself|hide your window|hide hud|hide the window)/.test(lower)) {
      (window as any).bella?.setHudVisibility?.(false);
    } else if (/(show yourself|come back|unhide|show your window|show hud)/.test(lower)) {
      (window as any).bella?.setHudVisibility?.(true);
    }
  }, [userCaption]);

  const detectEmotionFromText = (text: string): BellaEmotion => {
    const lower = text.toLowerCase();
    if (lower.includes("haha") || lower.includes("lol") || lower.includes("funny") || lower.includes("joke") || lower.includes("hehe") || lower.includes("wink")) return "playful";
    if (lower.includes("happy") || lower.includes("harmony") || lower.includes("glad") || lower.includes("joy") || lower.includes("wonderful") || lower.includes("love") || lower.includes("smile")) return "happy";
    if (lower.includes("wow") || lower.includes("awesome") || lower.includes("excited") || lower.includes("amazing") || lower.includes("yay") || lower.includes("incredible") || lower.includes("hype")) return "excited";
    if (lower.includes("really?") || lower.includes("curious") || lower.includes("interest") || lower.includes("tell me more") || lower.includes("why") || lower.includes("how") || lower.includes("wonder")) return "curious";
    if (lower.includes("think") || lower.includes("calculat") || lower.includes("analyz") || lower.includes("hmmm") || lower.includes("process") || lower.includes("let me see") || lower.includes("conclude")) return "thinking";
    if (lower.includes("proud") || lower.includes("achieved") || lower.includes("expert") || lower.includes("skill") || lower.includes("confidence") || lower.includes("succeed")) return "proud";
    if (lower.includes("sad") || lower.includes("sorry") || lower.includes("unfortunate") || lower.includes("grief") || lower.includes("bad") || lower.includes("regret") || lower.includes("alas") || lower.includes("cry")) return "sad";
    if (lower.includes("shock") || lower.includes("surprise") || lower.includes("gasp") || lower.includes("unexpected") || lower.includes("seriously") || lower.includes("oh my")) return "surprised";
    if (lower.includes("blush") || lower.includes("shy") || lower.includes("embarrass") || lower.includes("nervous") || lower.includes("oops") || lower.includes("sorry about")) return "embarrassed";
    if (lower.includes("what?") || lower.includes("confus") || lower.includes("puzzled") || lower.includes("dont know") || lower.includes("not sure") || lower.includes("wait")) return "confused";
    return "idle";
  };
  const [modelCaption, setModelCaption] = useState<string>("");
  const [activeProjectorUrl, setActiveProjectorUrl] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Bella Autopilot system controller state
  const [browserTrigger, setBrowserTrigger] = useState<{
    type: string;
    args: any;
    id: string;
    callback: (res: any) => void;
  } | null>(null);

  // Bella recollections database core state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showMemoryDashboard, setShowMemoryDashboard] = useState<boolean>(false);

  // Proactive Intelligence System state
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings | null>(null);
  const [proactiveSuggestions, setProactiveSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState<ProactiveSuggestion | null>(null);

  // Personal AI Dashboard state
  const [showDashboard, setShowDashboard] = useState<boolean>(false);

  // V2: Settings + wake word state
  const [settings, setSettings] = useState<BellaSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const showSettingsRef = useRef<boolean>(false);
  useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);

  // Ensure window remains in full stage mode when Settings, Dashboard, or Memory Dashboard is open
  useEffect(() => {
    if (showSettings || showMemoryDashboard || showDashboard) {
      setIsMiniMode(false);
    }
  }, [showSettings, showMemoryDashboard, showDashboard]);

  // Global keyboard shortcut for Dashboard (Ctrl+D / Cmd+D)
  useEffect(() => {
    const handleDashboardHotkey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setShowDashboard((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleDashboardHotkey);
    return () => window.removeEventListener("keydown", handleDashboardHotkey);
  }, []);

  // Listen to taskbar click / restore full mode event from native desktop shell
  useEffect(() => {
    if ((window as any).bella?.onRestoreFullMode) {
      (window as any).bella.onRestoreFullMode(() => {
        setIsMiniMode(false);
      });
    }
  }, []);

  // Sleep mode & activation state:
  // "none"   = currently active / connected
  // "auto"   = entered sleep automatically after 60s inactivity (waiting for wake word)
  // "manual" = manually deactivated by user (wake word muted, requires manual click to activate)
  const [sleepReason, setSleepReason] = useState<"manual" | "auto" | "none">("manual");

  // V2: Wake word detector instance (Web Speech API + Web Audio VAD, lives for the app lifetime)
  const wakeDetectorRef = useRef<BellaWakeWordDetector | null>(null);
  // Ref indirection so the wake-word callback always calls the latest wake/connect handler
  const connectHandlerRef = useRef<() => void>(() => {});

  // 60-Second Auto-Sleep Inactivity Timer
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSleepSeconds = settings.autoSleepSeconds || 60;

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (state === "disconnected") return;

    // While user has Camera Vision open or is sharing Screen, DO NOT auto-sleep!
    if (showCameraVision || isScreenSharing) {
      return;
    }

    inactivityTimerRef.current = setTimeout(() => {
      console.log(`[Auto-Sleep] ${autoSleepSeconds}s of non-interaction elapsed. Transitioning Bella to auto-sleep standby (listening for wake word)...`);
      setSleepReason("auto");
      if (sessionRef.current && sessionRef.current.getState() !== "disconnected") {
        sessionRef.current.disconnect();
      }
    }, autoSleepSeconds * 1000);
  }, [state, autoSleepSeconds, showCameraVision, isScreenSharing]);

  // When Camera Vision is activated by user or voice, wake Bella once if she is currently disconnected
  const prevShowCameraVisionRef = useRef<boolean>(false);
  useEffect(() => {
    if (showCameraVision && !prevShowCameraVisionRef.current) {
      if (stateRef.current === "disconnected") {
        console.log("[Camera Vision] Camera activated while Bella is disconnected. Auto-activating Bella session...");
        setSleepReason("none");
        sessionRef.current?.connect();
      }
    }
    prevShowCameraVisionRef.current = showCameraVision;
  }, [showCameraVision]);

  // Maintain auto-sleep timer whenever connection state or visual streaming changes
  useEffect(() => {
    if (state !== "disconnected") {
      resetInactivityTimer();
    } else {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    }
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [state, showCameraVision, isScreenSharing, resetInactivityTimer]);

  // Initialize wake detector once on mount.
  useEffect(() => {
    const det = new BellaWakeWordDetector();
    wakeDetectorRef.current = det;
    return () => {
      det.stop();
    };
  }, []);

  // Start / stop wake word detection:
  // ONLY listen for wake word when in "auto" sleep standby (after 60s inactivity).
  // If user MANUALLY deactivated Bella (sleepReason === "manual"), wake word is completely disabled!
  useEffect(() => {
    const det = wakeDetectorRef.current;
    if (!det) return;
    if (settings.wakeWordEnabled && state === "disconnected" && sleepReason === "auto") {
      console.log(`[Wake Word] Auto-sleep standby active. Listening for "${settings.wakePhrase}" to auto-wake...`);
      det.start({
        phrase: settings.wakePhrase,
        sensitivity: settings.sensitivity,
        onTriggered: () => {
          console.log("[Wake Word] Wake phrase detected! Auto-waking Bella from standby.");
          setSleepReason("none");
          det.stop();
          connectHandlerRef.current();
        },
      });
    } else {
      det.stop();
    }
  }, [settings.wakeWordEnabled, settings.wakePhrase, settings.sensitivity, state, sleepReason]);

  // BELLA 6.0 — Phone Link: let the paired Android wake Bella from across the
  // house while she is in auto-sleep standby.
  useEffect(() => {
    if (state !== "disconnected" || sleepReason !== "auto") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/phone/wake-request");
        if (res.ok) {
          const data = await res.json();
          if (data.wake) {
            console.log("[Phone Link] Wake requested from paired phone.");
            setSleepReason("none");
            connectHandlerRef.current();
          }
        }
      } catch { /* offline / not paired */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [state, sleepReason]);

  // Handle settings changes: persist to localStorage + update state.
  const handleSettingsChange = (patch: Partial<BellaSettings>) => {
    const next = saveSettings(patch);
    setSettings(next);
  };

  const sessionRef = useRef<BellaAudioSession | null>(null);

  // Fetch initial recollections and proactive state from backend
  useEffect(() => {
    fetch("/api/memories")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setMemories(data);
        }
      })
      .catch(err => console.error("Initial persistent recollections load failure:", err));

    fetch("/api/proactive/settings")
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.enabled === "boolean") {
          setProactiveSettings(data);
        }
      })
      .catch(() => {});

    const pollSuggestions = () => {
      fetch("/api/proactive/suggestions")
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data.suggestions)) {
            setProactiveSuggestions(data.suggestions);
            if (data.suggestions.length > 0) {
              setActiveSuggestion((curr) => curr || data.suggestions[0]);
            } else {
              setActiveSuggestion(null);
            }
          }
        })
        .catch(() => {});
    };

    pollSuggestions();
    const sugInterval = setInterval(pollSuggestions, 8000);
    return () => clearInterval(sugInterval);
  }, []);

  const handleAcceptSuggestion = (id: string, action?: any) => {
    fetch("/api/proactive/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: id, action: "accepted" })
    }).catch(() => {});

    if (action && action.actionType === "open_folder") {
      fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "openFolder", args: action.payload || {} })
      }).catch(() => {});
    }

    setActiveSuggestion(null);
    setProactiveSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDismissSuggestion = (id: string) => {
    fetch("/api/proactive/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: id, action: "dismissed" })
    }).catch(() => {});

    setActiveSuggestion(null);
    setProactiveSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSnoozeSuggestion = (id: string) => {
    fetch("/api/proactive/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: id, action: "snoozed" })
    }).catch(() => {});

    setActiveSuggestion(null);
    setProactiveSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdateProactiveSettings = (patch: Partial<ProactiveSettings>) => {
    setProactiveSettings((prev) => {
      const next = prev ? { ...prev, ...patch } : (patch as ProactiveSettings);
      return next;
    });

    fetch("/api/proactive/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }).catch(() => {});
  };

  const handleResetProactiveFeedback = () => {
    fetch("/api/proactive/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: "all", action: "reset" })
    }).catch(() => {});
  };

  const handleCameraFrameCaptured = useCallback((base64: string) => {
    if (sessionRef.current && stateRef.current !== "disconnected") {
      sessionRef.current.sendVideoFrame(base64);
    }
  }, []);

  const handleAddManualMemory = async (category: MemoryCategory, text: string) => {
    try {
      const resp = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, text })
      });
      const saved = await resp.json();
      if (saved && saved.id) {
        setMemories((prev) => [...prev, saved]);
      }
    } catch (err) {
      console.error("Manual database recollect upload error:", err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const resp = await fetch(`/api/memories/${id}`, {
        method: "DELETE"
      });
      const resObj = await resp.json();
      if (resObj && resObj.success) {
        setMemories((prev) => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error("Manual memory delete execution failed:", err);
    }
  };

  const resetInactivityTimerRef = useRef<() => void>(() => {});
  useEffect(() => {
    resetInactivityTimerRef.current = resetInactivityTimer;
  }, [resetInactivityTimer]);

  // Initialize the audio session handlers once on mount
  useEffect(() => {
    sessionRef.current = new BellaAudioSession({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === "disconnected") {
          // Reset captions on disconnect
          setUserCaption("");
          setModelCaption("");
          setActiveEmotion("idle");
          setCharacterState("idle");
        } else if (newState === "listening") {
          // Return to receptive resting state
          setActiveEmotion("idle");
          setCharacterState("idle");
          resetInactivityTimerRef.current();
        } else if (newState === "speaking") {
          setCharacterState("talking");
          resetInactivityTimerRef.current();
        }
      },
      onTranscription: (role, text) => {
        resetInactivityTimerRef.current();
        if (role === "user") {
          setUserCaption(text);
          // Auto-clear the other caption when user starts talking
          setModelCaption("");
          setCharacterState("thinking");
        } else if (role === "model") {
          setModelCaption((prev) => {
            const next = prev + text;
            const newEmotion = detectEmotionFromText(next);
            setActiveEmotion(newEmotion);
            return next;
          });
          // Clear user caption when model replies
          setUserCaption("");
        }
      },
      onToolCall: (name, args, callback) => {
        resetInactivityTimerRef.current();
        console.log(`[App] Tool call triggered: ${name}`, args);
        
        const browserTools = [
          "browserOpen",
          "browserSearch",
          "browserClick",
          "browserMediaControl",
          "browserScroll",
          "browserType",
          "browserGoBack",
          "browserTabAction",
          "openWebsite"
        ];

        if (browserTools.includes(name)) {
          // Bring up the Holographic Browser Controller if it is not active
          if (!activeProjectorUrl) {
            let startingUrl = "about:blank";
            if ((name === "browserOpen" || name === "openWebsite") && args.url) {
              startingUrl = args.url;
            } else if (name === "browserSearch" && args.query) {
              const q = args.query.replace(/youtube|search|find|play/gi, "").trim() || args.query;
              startingUrl = `https://youtube.com/results?search_query=${encodeURIComponent(q)}`;
            }
            setActiveProjectorUrl(startingUrl);
          }

          // Map instructions directly onto Browser Agent
          setBrowserTrigger({
            type: name === "openWebsite" ? "browserOpen" : name,
            args,
            id: Math.random().toString(),
            callback: (res) => {
              callback(res);
              setBrowserTrigger(null);
            }
          });
        } else if (name === "changeBackground") {
          const colorName = args.color?.toLowerCase();
          const validColors = ["violet", "crimson", "emerald", "celestial", "gold", "rose", "charcoal"];
          
          if (colorName && validColors.includes(colorName)) {
            setThemeColor(colorName);
            callback({ result: `Successfully shifted aesthetic atmosphere to ${colorName}.` });
          } else {
            callback({ error: `Unsupported color '${colorName}'. Supported themes are: ${validColors.join(", ")}` });
          }
        } else {
          callback({ error: `Tool ${name} is not implemented.` });
        }
      },
      onError: (err) => {
        setErrorText(err);
      },
      onMemorySync: (updatedMemories) => {
        console.log("[App] WebSocket memories sync triggered:", updatedMemories);
        if (Array.isArray(updatedMemories)) {
          setMemories(updatedMemories);
        }
      },
      onDashboardSync: () => {
        console.log("[App] WebSocket dashboard sync triggered from voice tool execution");
        window.dispatchEvent(new CustomEvent("bella:dashboard_sync"));
      },
      onStartScreenShare: () => {
        console.log("[App] Voice triggered screen sharing start");
        void startScreenSharing();
      },
      onStopScreenShare: () => {
        console.log("[App] Voice triggered screen sharing stop");
        stopScreenSharing();
      },
      onMiniModeChange: (enabled) => {
        console.log("[App] Mini mode transition triggered:", enabled);
        setIsMiniMode(enabled);
      },
      onCameraModeChange: (cameraMode) => {
        console.log("[App] Camera mode transition triggered:", cameraMode);
        if (cameraMode === "OFF") {
          setShowCameraVision(false);
        } else {
          setShowCameraVision(true);
        }
      },
      onProactiveInit: (pSettings, pSuggestions) => {
        if (pSettings) setProactiveSettings(pSettings);
        if (Array.isArray(pSuggestions)) {
          setProactiveSuggestions(pSuggestions);
          if (pSuggestions.length > 0) {
            setActiveSuggestion(pSuggestions[0]);
          }
        }
      },
      onProactiveSuggestion: (suggestion) => {
        console.log("[App] New proactive suggestion received:", suggestion);
        setProactiveSuggestions((prev) => [suggestion, ...prev.filter((s) => s.id !== suggestion.id)]);
        setActiveSuggestion(suggestion);
      },
      onBellaEvent: handleBellaEvent
    });

    return () => {
      if (sessionRef.current) {
        sessionRef.current.disconnect();
      }
    };
  }, []);

  const handleToggleConnection = async () => {
    setErrorText(null);
    if (!sessionRef.current) return;

    if (state === "disconnected") {
      setSleepReason("none");
      await sessionRef.current.connect();
    } else {
      setSleepReason("manual");
      sessionRef.current.disconnect();
    }
  };
  // V2: keep the ref in sync so the wake-word callback calls this exact handler.
  connectHandlerRef.current = handleToggleConnection;

  // Maps theme colors to CSS ambient light spots
  const getAmbientStyles = () => {
    switch (themeColor) {
      case "violet":
        return "from-purple-950/40 via-violet-950/20 to-slate-950";
      case "crimson":
        return "from-red-950/40 via-orange-950/20 to-slate-950";
      case "emerald":
        return "from-emerald-950/40 via-teal-950/20 to-slate-950";
      case "celestial":
        return "from-sky-950/45 via-indigo-950/25 to-slate-950";
      case "gold":
        return "from-amber-950/30 via-yellow-950/15 to-slate-950";
      case "rose":
        return "from-rose-950/40 via-pink-950/20 to-slate-950";
      case "charcoal":
      default:
        return "from-slate-900/50 via-slate-950/30 to-slate-950";
    }
  };

  const getThemeTextGlow = () => {
    switch (themeColor) {
      case "violet": return "text-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.5)]";
      case "crimson": return "text-rose-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]";
      case "emerald": return "text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]";
      case "celestial": return "text-sky-400 drop-shadow-[0_0_12px_rgba(14,165,233,0.5)]";
      case "gold": return "text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]";
      case "rose": return "text-pink-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]";
      case "charcoal":
      default:
        return "text-indigo-400 drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]";
    }
  };

  const getOrbRingColor = () => {
    switch (state) {
      case "listening": return "border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.3)] bg-indigo-500/10";
      case "speaking": return "border-purple-500/70 shadow-[0_0_40px_rgba(168,85,247,0.4)] bg-purple-500/10";
      case "connecting": return "border-amber-500/50 animate-pulse bg-amber-500/10";
      case "disconnected":
      default:
        return "border-white/10 hover:border-indigo-500/30 bg-white/5";
    }
  };

  // Global Keyboard Shortcuts (Ctrl+K / Cmd+K for Command Palette, Ctrl+D for Dashboard)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setShowDashboard((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const handleCommandPaletteAction = (actionType: string, payload?: any) => {
    switch (actionType) {
      case "trigger_curiosity":
        fetch("/api/intelligence/curiosity")
          .then(r => r.json())
          .then(data => {
            if (data.question) {
              setActiveSuggestion({
                id: data.question.id,
                type: "knowledge_suggestion",
                category: "learning",
                title: "Curiosity Insight",
                message: data.question.question,
                explanation: data.question.explanation,
                level: "suggestion",
                score: { relevance: 0.9, urgency: 0.5, importance: 0.8, confidence: 0.85, intrusiveness: 0.2, finalScore: data.question.finalScore },
                sourceEvents: [],
                status: "shown",
                createdAt: new Date().toISOString()
              });
            }
          });
        break;
      case "get_recommendations":
      case "open_learning":
      case "open_projects":
      case "start_focus":
      case "new_task":
      case "new_note":
        setShowDashboard(true);
        break;
      case "open_memories":
        setShowMemoryDashboard(true);
        break;
      case "open_settings":
        setShowSettings(true);
        break;
      case "toggle_mini_mode":
        setIsMiniMode((prev) => !prev);
        break;
      case "toggle_camera_vision":
        setShowCameraVision((prev) => !prev);
        break;
      case "toggle_screen_share":
        if (isScreenSharing) stopScreenSharing();
        else startScreenSharing();
        break;
      case "activate_voice":
        if (state === "disconnected") {
          setSleepReason("none");
          sessionRef.current?.connect();
        }
        break;
      default:
        break;
    }
  };

  return (
    <div
      id="bella-holographic-desktop"
      className={`relative w-full h-screen overflow-hidden ${
        isMiniMode 
          ? "bg-transparent p-0 flex items-center justify-center pointer-events-auto" 
          : `bg-[#07080B] text-white ${getAmbientStyles()} theme-transition flex flex-col justify-between p-4 sm:p-6`
      } select-none`}
    >
      {/* Ambient Background Gradients matching Frosted Glass theme (Full stage only) */}
      {!isMiniMode && (
        <>
          <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/15 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-cyan-900/15 rounded-full blur-[150px] pointer-events-none" />
          <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] bg-indigo-800/10 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />
        </>
      )}

      {/* Custom title bar for frameless window (desktop only, full mode only) */}
      {!isMiniMode && (window as any)?.bella?.isDesktop && (
        <div
          className="absolute top-0 left-0 right-0 z-[999] flex items-center justify-between h-10 select-none backdrop-blur-xl bg-white/[0.03] border-b border-white/[0.06] shadow-[0_1px_12px_rgba(0,0,0,0.3)]"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        >
          {/* Left side - app title with subtle glass accent */}
          <div className="flex items-center gap-2.5 pl-4">
            <div className="w-2 h-2 rounded-full bg-gradient-to-br from-cyan-400/80 to-indigo-500/80 shadow-[0_0_6px_rgba(99,102,241,0.4)]" />
            <span className="text-[10px] font-semibold tracking-[0.35em] text-white/30 uppercase font-mono">
              BELLA
            </span>
          </div>
          {/* Right side - window controls (no-drag so buttons work) */}
          <div
            className="flex items-center h-full"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            <button
              onClick={() => (window as any).bella.minimizeWindow()}
              className="h-full px-4 flex items-center justify-center hover:bg-white/[0.08] text-white/30 hover:text-white/70 transition-all duration-200 cursor-pointer"
              title="Minimize"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={() => (window as any).bella.maximizeWindow()}
              className="h-full px-4 flex items-center justify-center hover:bg-white/[0.08] text-white/30 hover:text-white/70 transition-all duration-200 cursor-pointer"
              title="Maximize"
            >
              <Maximize2 size={11} />
            </button>
            <button
              onClick={() => (window as any).bella.closeWindow()}
              className="h-full px-4 flex items-center justify-center hover:bg-red-500/60 text-white/30 hover:text-white transition-all duration-200 cursor-pointer rounded-tr-none"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* FULL VIEWPORT HOLOGRAPHIC STAGE / FLOATING COMPANION */}
      <div className={`absolute inset-0 ${isMiniMode ? "z-50 pointer-events-auto" : "z-0 pointer-events-none"} select-none`}>
        <BellaCoreVisualizer
          session={sessionRef.current}
          state={state}
          themeColor={themeColor}
          activeEmotion={activeEmotion}
          characterState={characterState}
          isMiniMode={isMiniMode}
          onToggleMiniMode={() => setIsMiniMode(!isMiniMode)}
        />
      </div>

      {/* FULL STAGE FLOATING GLASS NAVBAR (Arc & Apple Inspired) */}
      {!isMiniMode && (
        <header className="relative z-30 w-full max-w-5xl mx-auto select-none pt-4 px-4">
          <div className="flex items-center justify-between px-4 py-2 rounded-2xl glass-panel shadow-2xl border border-white/[0.08]">
            {/* Left Brand & Live State Pill */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06] shadow-sm">
                <span className="text-xs font-bold tracking-[0.25em] text-white/90 uppercase font-display">
                  BELLA
                </span>
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    state === "speaking" ? "bg-purple-400" :
                    state === "listening" ? "bg-cyan-400" :
                    state === "connecting" ? "bg-amber-400" :
                    sleepReason === "auto" ? "bg-amber-400" : "hidden"
                  }`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    state === "speaking" ? "bg-purple-400" :
                    state === "listening" ? "bg-cyan-400" :
                    state === "connecting" ? "bg-amber-400" :
                    sleepReason === "auto" ? "bg-amber-400/90" : "bg-white/20"
                  }`} />
                </span>
                <span className="text-[10px] font-sans font-medium tracking-wide text-slate-400 uppercase hidden sm:inline">
                  {state === "speaking" ? "Speaking" :
                   state === "listening" ? "Listening" :
                   state === "connecting" ? "Linking" :
                   sleepReason === "auto" ? "Standby" : "Inactive"}
                </span>
              </div>
            </div>

            {/* Center View Switcher Tabs */}
            <nav className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.05]">
              <button
                onClick={() => {
                  setShowDashboard(false);
                  setShowMemoryDashboard(false);
                  setShowSettings(false);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-sans font-medium transition-all ${
                  !showDashboard && !showMemoryDashboard && !showSettings
                    ? "bg-white/10 text-white shadow-sm font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Stage
              </button>
              <button
                onClick={() => {
                  setShowMemoryDashboard(false);
                  setShowSettings(false);
                  setShowDashboard(true);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-sans font-medium transition-all ${
                  showDashboard
                    ? "bg-white/10 text-white shadow-sm font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Workspace
              </button>
              <button
                onClick={() => {
                  setShowDashboard(false);
                  setShowSettings(false);
                  setShowMemoryDashboard(true);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-sans font-medium transition-all ${
                  showMemoryDashboard
                    ? "bg-white/10 text-white shadow-sm font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Memories
              </button>
              <button
                onClick={() => {
                  setShowDashboard(false);
                  setShowMemoryDashboard(false);
                  setShowSettings(true);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-sans font-medium transition-all ${
                  showSettings
                    ? "bg-white/10 text-white shadow-sm font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Settings
              </button>
            </nav>

            {/* Right Action Controls */}
            <div className="flex items-center gap-2">
              {/* Quick Command Palette Trigger (Raycast style) */}
              <button
                onClick={() => setShowCommandPalette(true)}
                className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-xl glass-pill text-xs text-slate-400 hover:text-white transition cursor-pointer"
                title="Open Command Palette (Ctrl+K)"
              >
                <Search size={13} className="text-slate-400" />
                <span className="text-[11px] font-sans">Search</span>
                <kbd className="px-1.5 py-0.5 text-[9px] font-mono bg-white/[0.06] text-slate-400 rounded border border-white/10">
                  ⌘K
                </kbd>
              </button>

              {/* Real-time Camera Vision Button */}
              <button
                onClick={() => setShowCameraVision(!showCameraVision)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans transition-all duration-200 cursor-pointer ${
                  showCameraVision
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)] font-medium"
                    : "glass-pill text-slate-300 hover:text-white"
                }`}
                title="Camera Vision & Object Intelligence"
              >
                <Camera size={13} className={showCameraVision ? "animate-pulse text-cyan-400" : "text-slate-400"} />
                <span className="hidden sm:inline">Camera</span>
              </button>

              {/* Real-time Screen Sharing Button */}
              <button 
                onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans transition-all duration-200 cursor-pointer ${
                  isScreenSharing 
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)] font-medium" 
                    : "glass-pill text-slate-300 hover:text-white"
                }`}
                title="Share Screen with Bella"
              >
                <Monitor size={13} className={isScreenSharing && !isScreenSharingPaused ? "animate-pulse text-emerald-400" : "text-slate-400"} />
                <span className="hidden sm:inline">{isScreenSharing ? "Sharing" : "Screen"}</span>
              </button>

              {/* Float / Mini Mode Button */}
              <button
                onClick={() => setIsMiniMode(!isMiniMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans transition-all duration-200 cursor-pointer ${
                  isMiniMode
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.25)] font-medium"
                    : "glass-pill text-slate-300 hover:text-white"
                }`}
                title={isMiniMode ? "Expand to Full Stage" : "Float Mini Companion"}
              >
                <PictureInPicture2 size={13} className="text-indigo-400/80" />
                <span className="hidden sm:inline">{isMiniMode ? "Expand" : "Float"}</span>
              </button>

              {/* Master Activation / Deactivation Button */}
              <button
                onClick={() => {
                  if (state === "disconnected") {
                    setSleepReason("none");
                    sessionRef.current?.connect();
                  } else {
                    setSleepReason("manual");
                    sessionRef.current?.disconnect();
                  }
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs font-sans transition-all duration-200 cursor-pointer ${
                  state !== "disconnected"
                    ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.25)] font-medium"
                    : sleepReason === "auto"
                    ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)] font-medium"
                    : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)] font-medium"
                }`}
                title={
                  state !== "disconnected"
                    ? "Deactivate Voice Link"
                    : sleepReason === "auto"
                    ? "Wake up Bella immediately (or say 'Hey Bella')"
                    : "Activate Voice Link"
                }
              >
                <Power size={13} className={state !== "disconnected" ? "text-rose-400" : sleepReason === "auto" ? "text-amber-400" : "text-emerald-400"} />
                <span>{state !== "disconnected" ? "Deactivate" : sleepReason === "auto" ? "Wake" : "Activate"}</span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* CORE AVATAR AND VISUALS (Full stage only) */}
      {!isMiniMode && (
        <main className="relative z-10 flex-1 w-full max-w-4xl mx-auto flex flex-col items-center justify-between py-6">
          
          {/* Holographic Projection Screen Widget (if website opened) */}
          <AnimatePresence>
            {activeProjectorUrl && (
              <div className="absolute inset-x-0 top-0 z-30 flex justify-center p-2">
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  className="flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-indigo-500/20 bg-indigo-950/45 backdrop-blur-xl shadow-lg w-full max-w-md"
                >
                  <div className="flex items-center gap-3 overflow-hidden text-left">
                    <div className="p-2 ml-1 rounded-xl bg-indigo-500/20 text-indigo-300">
                      <Globe size={18} />
                    </div>
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-bold font-mono tracking-wide text-indigo-200 uppercase">Holographic Projection Broadcast</h4>
                      <p className="text-xs text-indigo-400 truncate max-w-[200px]">{activeProjectorUrl}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setActiveProjectorUrl(activeProjectorUrl)}
                      className="p-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-400 transition"
                      title="View Frame"
                    >
                      <Maximize2 size={14} />
                    </button>
                    <button
                      onClick={() => setActiveProjectorUrl(null)}
                      className="p-2 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Interactive suggestions prompt guide */}
          <AnimatePresence>
            {showGuide && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="mt-6 p-5 rounded-2xl border border-white/10 bg-slate-900/85 backdrop-blur-2xl max-w-md text-left w-full absolute z-40 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-3 text-white">
                  <div className="flex items-center gap-1.5 font-display text-sm font-bold tracking-wide">
                    <Compass size={16} className="text-indigo-400" />
                    <span>PLAYFUL CORE SUGGESTIONS</span>
                  </div>
                  <button 
                    onClick={() => setShowGuide(false)}
                    className="text-slate-400 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-400 mb-4 font-mono leading-relaxed">
                  Bella is equipped with dynamic visual modules and standard text browser projectors. Here are clever triggers to try speaking aloud:
                </p>
                <div className="space-y-2 text-xs font-serif italic text-indigo-300">
                  <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer font-sans normal-case text-slate-200">
                    ⚡ &quot;Bella, change atmosphere of your core to crimson&quot; <span className="text-[10px] font-mono text-indigo-400 block mt-0.5 font-medium">Shifts theme color background</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer font-sans normal-case text-slate-200">
                    ⚡ &quot;Open youtube.com on my screen please&quot; <span className="text-[10px] font-mono text-indigo-400 block mt-0.5 font-medium">Invokes browser projector panel</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer font-sans normal-case text-slate-200">
                    ⚡ &quot;Tell me a witty joke and change background to gold&quot; <span className="text-[10px] font-mono text-indigo-400 block mt-0.5 font-medium">Combines tools & voice</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Global Error Banner */}
          <AnimatePresence>
            {errorText && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="mt-6 flex items-start gap-3 p-4 rounded-2xl border border-rose-500/20 bg-rose-950/40 backdrop-blur-xl max-w-md w-full text-left"
              >
                <CircleAlert className="text-rose-400 shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-rose-300 font-mono">Core Error Protocol</h4>
                  <p className="text-xs text-rose-200 mt-1 leading-relaxed">{errorText}</p>
                  <button
                    onClick={() => setErrorText(null)}
                    className="mt-2 text-[10px] font-bold text-rose-400 underline font-mono uppercase"
                  >
                    Dismiss Code
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </main>
      )}

      {/* FOOTER INTERFACE WITH WAVEFORM AND CONTROLS (Full stage only) */}
      {!isMiniMode && (
        <footer className="relative z-10 w-full max-w-2xl mx-auto flex flex-col items-center gap-5 mt-auto">
          
          {/* Dynamic Minimalist Waveform Visualizer */}
          <div className="flex items-center justify-center gap-1 h-8 w-44">
            {[12, 28, 16, 32, 20, 8].map((baseHeight, idx) => {
              let heightFactor = 0.35;
              if (state === "speaking") {
                heightFactor = 0.35 + Math.sin(Date.now() * 0.02 + idx * 0.9) * 0.65;
              } else if (state === "listening") {
                heightFactor = 0.2 + Math.sin(Date.now() * 0.01 + idx * 0.5) * 0.4;
              } else {
                heightFactor = idx % 2 === 0 ? 0.25 : 0.12;
              }
              const calculatedHeight = Math.max(3, baseHeight * heightFactor);

              return (
                <div
                  key={idx}
                  className={`w-0.5 rounded-full transition-all duration-300 ${
                    state === "speaking" ? "bg-purple-400" : state === "listening" ? "bg-cyan-400" : "bg-white/10"
                  }`}
                  style={{ height: `${calculatedHeight}px` }}
                />
              );
            })}
          </div>

          {/* Glossy Beautiful Primary Connector Core Node */}
          <div className="flex items-center justify-center relative mb-4">
            <button 
              onClick={handleToggleConnection}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer ${
                state === "disconnected"
                  ? "bg-white/10 hover:bg-white/15 border border-white/15 text-white shadow-[0_0_20px_rgba(255,255,255,0.02)] hover:scale-105 active:scale-95"
                : state === "listening"
                  ? "bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/80 text-cyan-200 shadow-[0_0_35px_rgba(34,211,238,0.3)] animate-pulse scale-105"
                  : state === "speaking"
                  ? "bg-purple-500/90 hover:bg-purple-600 border border-purple-400/95 text-white shadow-[0_0_35px_rgba(168,85,247,0.4)] scale-105"
                  : "bg-amber-600 border border-amber-300 text-white animate-spin"
              }`}
              title={state === "disconnected" ? "Awake Bella" : "Sleep core"}
            >
              {state === "disconnected" ? (
                <Power className="opacity-80" size={24} />
              ) : state === "connecting" ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : state === "listening" ? (
                <Mic size={24} className="text-cyan-200" />
              ) : (
                <Volume2 size={24} className="text-white" />
              )}
            </button>

            {/* Quiet Reset Projection Anchor */}
            {(activeProjectorUrl || errorText) && (
              <button 
                onClick={() => {
                  if (activeProjectorUrl) setActiveProjectorUrl(null);
                  setErrorText(null);
                }}
                className="absolute right-[-60px] p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition duration-150 cursor-pointer"
                title="Reset Screen Broadcasts"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </footer>
      )}

      {/* Holographic Website frame projections — only in full mode so floating character is never obscured */}
      <AnimatePresence>
        {activeProjectorUrl && !isMiniMode && (
          <BrowserAgent
            url={activeProjectorUrl}
            onClose={() => {
              setActiveProjectorUrl(null);
              setBrowserTrigger(null);
            }}
            actionTrigger={browserTrigger}
          />
        )}
      </AnimatePresence>

      {/* Dynamic Floating Glassmorphic Screen Sharing Control Hub — positioned on bottom-left and hidden in mini mode */}
      <AnimatePresence>
        {isScreenSharing && !isMiniMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, x: -50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: -50 }}
            className={`fixed bottom-6 md:bottom-10 left-6 md:left-10 z-40 w-72 p-4 rounded-2xl border ${
              isScreenSharingPaused 
                ? "border-amber-500/20 bg-slate-950/80" 
                : "border-cyan-500/20 bg-slate-950/80"
            } backdrop-blur-2xl shadow-2xl overflow-hidden`}
          >
            {/* Header / Indicator */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isScreenSharingPaused ? "bg-amber-400" : "bg-cyan-400 animate-pulse"}`} />
                <span className="text-[10px] font-bold font-mono tracking-widest text-slate-200">
                  {isScreenSharingPaused ? "SCREEN VISION PAUSED" : "SCREEN VISION ACTIVE"}
                </span>
              </div>
              <button 
                onClick={stopScreenSharing}
                className="text-slate-400 hover:text-white transition-colors duration-150 p-1 rounded-lg hover:bg-white/5 cursor-pointer"
                title="Stop Sharing"
              >
                <X size={14} />
              </button>
            </div>

            {/* Smart Video PIP Preview Holder */}
            <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-900 border border-white/5 mb-3 flex items-center justify-center group select-none">
              {isGdiCapture ? (
                gdiPreviewSrc ? (
                  <img
                    src={gdiPreviewSrc}
                    alt="Screen share preview"
                    className={`w-full h-full object-cover transition-opacity duration-300 ${
                      isScreenSharingPaused ? "opacity-30 blur-sm" : "opacity-90"
                    }`}
                  />
                ) : (
                  <span className="text-[10px] font-mono text-slate-500 animate-pulse px-4 text-center">
                    GDI capture starting…
                  </span>
                )
              ) : (
                <video
                  ref={(el) => {
                    if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                      el.srcObject = screenStreamRef.current;
                      el.muted = true;
                      el.play().catch(err => console.log("Mini preview stream play issue:", err));
                    }
                  }}
                  className={`w-full h-full object-cover transition-opacity duration-300 ${
                    isScreenSharingPaused ? "opacity-30 blur-sm" : "opacity-90"
                  }`}
                  autoPlay
                  playsInline
                  muted
                />
              )}

              {isScreenSharingPaused && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] uppercase tracking-widest font-mono text-amber-400 font-bold px-2 py-1 bg-amber-950/40 border border-amber-500/20 rounded-md">
                    Transmission Paused
                  </span>
                </div>
              )}
              
              {!isScreenSharingPaused && screenVisionMode && (
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-400/20 text-[9px] font-mono text-cyan-300">
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
                  <span>{isGdiCapture ? "GDI Mode · 0.5 FPS" : "Streaming FPS: 0.5"}</span>
                </div>
              )}
            </div>

            {/* Quick Action Control Strip */}
            <div className="flex items-center justify-between gap-1.5 mb-2.5">
              {isScreenSharingPaused ? (
                <button
                  onClick={resumeScreenSharing}
                  className="flex-1 py-1.5 px-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-lg text-xs font-mono font-medium text-cyan-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Resume Streaming Feed"
                >
                  <Play size={10} />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  onClick={pauseScreenSharing}
                  className="flex-1 py-1.5 px-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-xs font-mono font-medium text-amber-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Pause Streaming Feed"
                >
                  <Pause size={10} />
                  <span>Pause</span>
                </button>
              )}

              <button
                onClick={switchScreenShare}
                className="py-1.5 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white flex items-center justify-center gap-1 transition-all cursor-pointer"
                title="Choose Another Screen or Window"
              >
                <RefreshCw size={11} />
                <span>Switch</span>
              </button>

              <button
                onClick={stopScreenSharing}
                className="py-1.5 px-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-xs font-mono text-rose-400 flex items-center justify-center gap-1 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                title="Terminate Stream"
              >
                <Square size={9} />
                <span>Stop</span>
              </button>
            </div>

            {/* Core Mode Configuration Toggle */}
            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-left">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold font-mono text-slate-200">SCREEN VISION MODE</span>
                <span className="text-[8px] text-slate-400 uppercase font-mono max-w-[150px]">Gemini Auto-Analysis</span>
              </div>
              <button
                onClick={() => setScreenVisionMode(!screenVisionMode)}
                className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${
                  screenVisionMode ? "bg-cyan-500" : "bg-white/10"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${
                    screenVisionMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Proactive Intelligence Suggestion Card */}
      {!isMiniMode && activeSuggestion && (
        <div className="fixed top-20 right-6 z-50 max-w-sm pointer-events-auto">
          <ProactiveSuggestionCard
            suggestion={activeSuggestion}
            onAccept={handleAcceptSuggestion}
            onDismiss={handleDismissSuggestion}
            onSnooze={handleSnoozeSuggestion}
          />
        </div>
      )}

      {/* BELLA 6.0 — Whiteboard & study overlay */}
      <Whiteboard
        open={wbOpen}
        topic={wbTopic}
        onClose={() => setWbOpen(false)}
        clearSignal={wbClearSignal}
        drawSignal={wbDrawSignal}
        pendingElement={wbPending}
        saveSignal={wbSaveSignal}
        saveName={wbSaveName}
      />

      {/* Recollections sliding core panel */}
      <MemoryDashboard
        isOpen={showMemoryDashboard}
        onClose={() => setShowMemoryDashboard(false)}
        memories={memories}
        onAddMemory={handleAddManualMemory}
        onDeleteMemory={handleDeleteMemory}
        themeColor={themeColor}
      />

      {/* Settings sliding core panel with integrated Recalls and Proactive AI management */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onChange={handleSettingsChange}
        themeColor={themeColor}
        memories={memories}
        onAddMemory={handleAddManualMemory}
        onDeleteMemory={handleDeleteMemory}
        proactiveSettings={proactiveSettings || undefined}
        onUpdateProactiveSettings={handleUpdateProactiveSettings}
        onResetProactiveFeedback={handleResetProactiveFeedback}
      />

      {/* Personal AI Dashboard Command Center Modal (Ctrl+D / Cmd+D) */}
      <PersonalAIDashboard
        isOpen={showDashboard}
        onClose={() => setShowDashboard(false)}
        onStartVoiceSession={handleToggleConnection}
        voiceState={state}
        themeColor={themeColor}
      />

      {/* Global Raycast-style Command Palette (Ctrl+K / Cmd+K) */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onSelectAction={handleCommandPaletteAction}
      />

      {/* Floating Camera Vision HUD Widget */}
      <CameraVisionWidget
        isOpen={showCameraVision}
        isMiniMode={isMiniMode}
        onClose={() => setShowCameraVision(false)}
        onFrameCaptured={handleCameraFrameCaptured}
        onRememberVisual={(summary) => {
          handleAddManualMemory("preference", summary);
        }}
        themeColor={themeColor}
      />
    </div>
  );
}
