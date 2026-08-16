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

export default function App() {
  const [state, setState] = useState<LiveState>("disconnected");

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

    if (stateRef.current === "disconnected") {
      return;
    }

    try {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      if (!screenCanvasRef.current) {
        screenCanvasRef.current = document.createElement("canvas");
      }
      const canvas = screenCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Restrict maximum resolution size to keep payload light for Gemini Live
      const maxDim = 960;
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

      // Highly compressed JPEG standard is optimized and preserves details perfectly
      const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
      const base64 = dataUrl.split(",")[1];

      if (sessionRef.current && stateRef.current !== "disconnected") {
        sessionRef.current.sendVideoFrame(base64);
      }
    } catch (err) {
      console.error("[Screen Capture] Failed drawing frame to canvas:", err);
    }
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

      // Stop handling when native stop sharing bar button ends
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenSharing();
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
      if (e.name !== "NotAllowedError") {
        setErrorText(`Could not capture screen: ${e.message || e}`);
      }
    }
  };

  const stopScreenSharing = () => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }

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

    inactivityTimerRef.current = setTimeout(() => {
      console.log(`[Auto-Sleep] ${autoSleepSeconds}s of non-interaction elapsed. Transitioning Bella to auto-sleep standby (listening for wake word)...`);
      setSleepReason("auto");
      if (sessionRef.current && sessionRef.current.getState() !== "disconnected") {
        sessionRef.current.disconnect();
      }
    }, autoSleepSeconds * 1000);
  }, [state, autoSleepSeconds]);

  // Maintain auto-sleep timer whenever connection state changes
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
  }, [state, resetInactivityTimer]);

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
      onMiniModeChange: (enabled) => {
        console.log("[App] Mini mode transition triggered:", enabled);
        setIsMiniMode(enabled);
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
      }
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

  return (
    <div
      id="bella-holographic-desktop"
      className={`relative w-full h-screen overflow-hidden ${
        isMiniMode 
          ? "bg-transparent p-0 flex items-center justify-center pointer-events-auto" 
          : `bg-[#020205] text-white ${getAmbientStyles()} theme-transition flex flex-col justify-between p-6 sm:p-10`
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

      {/* FULL STAGE FLOATING GLASS NAVBAR */}
      {!isMiniMode && (
        <header className="relative z-30 w-full max-w-4xl mx-auto select-none">
          <div className="flex items-center justify-between px-5 py-2.5 rounded-2xl bg-white/[0.03] backdrop-blur-2xl border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37),inset_0_1px_1px_0_rgba(255,255,255,0.08)]">
            {/* Left Brand & Live State Badge */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
                <span className="text-xs font-semibold tracking-[0.35em] text-white/70 uppercase font-mono">
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
                <span className="text-[9px] font-mono tracking-wider text-white/40 uppercase hidden sm:inline">
                  {state === "speaking" ? "SPEAKING" :
                   state === "listening" ? "LISTENING" :
                   state === "connecting" ? "LINKING" :
                   sleepReason === "auto" ? "STANDBY (SAY WAKE WORD)" : "INACTIVE"}
                </span>
              </div>
            </div>

            {/* Right Action Glass Pill Buttons */}
            <div className="flex items-center gap-2">
              {/* Manual Master Activation / Deactivation Button */}
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
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-[11px] font-mono tracking-wider transition-all duration-200 cursor-pointer ${
                  state !== "disconnected"
                    ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.3)] font-semibold"
                    : sleepReason === "auto"
                    ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)] font-semibold"
                    : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)] font-semibold"
                }`}
                title={
                  state !== "disconnected"
                    ? "Manually Deactivate Bella (Disables wake word until manual activation)"
                    : sleepReason === "auto"
                    ? "Wake up Bella immediately (or say 'Hey Bella')"
                    : "Manually Activate Bella"
                }
              >
                <Power size={13} className={state !== "disconnected" ? "text-rose-400" : sleepReason === "auto" ? "text-amber-400" : "text-emerald-400"} />
                <span>{state !== "disconnected" ? "DEACTIVATE" : sleepReason === "auto" ? "WAKE UP" : "ACTIVATE"}</span>
              </button>

              {/* Float / Mini Mode Button */}
              <button
                onClick={() => setIsMiniMode(!isMiniMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono tracking-wider transition-all duration-200 cursor-pointer ${
                  isMiniMode
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)] font-semibold"
                    : "bg-white/[0.03] hover:bg-white/[0.08] text-white/60 hover:text-white border-white/[0.06] hover:border-white/[0.15]"
                }`}
                title={isMiniMode ? "Expand to Full Stage" : "Float Mini Companion"}
              >
                <PictureInPicture2 size={13} className="text-cyan-400/80" />
                <span>{isMiniMode ? "EXPAND" : "FLOAT"}</span>
              </button>

              {/* Personal AI Dashboard Button */}
              <button
                onClick={() => {
                  if (isMiniMode) {
                    setIsMiniMode(false);
                  }
                  setShowDashboard(!showDashboard);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono tracking-wider transition-all duration-200 cursor-pointer ${
                  showDashboard
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)] font-semibold"
                    : "bg-white/[0.03] hover:bg-white/[0.08] text-white/60 hover:text-white border-white/[0.06] hover:border-white/[0.15]"
                }`}
                title="Personal AI Dashboard (Ctrl+D)"
              >
                <LayoutDashboard size={13} className={showDashboard ? "text-cyan-400" : "text-white/40"} />
                <span>DASHBOARD</span>
              </button>

              {/* Real-time Screen Sharing Button */}
              <button 
                onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono tracking-wider transition-all duration-200 cursor-pointer ${
                  isScreenSharing 
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)] font-semibold" 
                    : "bg-white/[0.03] hover:bg-white/[0.08] text-white/60 hover:text-white border-white/[0.06] hover:border-white/[0.15]"
                }`}
                title="Share Screen with Bella"
              >
                <Monitor size={13} className={isScreenSharing && !isScreenSharingPaused ? "animate-pulse text-emerald-400" : "text-white/40"} />
                <span>{isScreenSharing ? "SHARING" : "SHARE SCREEN"}</span>
              </button>

              {/* Settings Configuration Button */}
              <button
                onClick={() => {
                  if (isMiniMode) {
                    setIsMiniMode(false);
                  }
                  setShowSettings(!showSettings);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono tracking-wider transition-all duration-200 cursor-pointer ${
                  showSettings
                    ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.3)] font-semibold"
                    : "bg-white/[0.03] hover:bg-white/[0.08] text-white/60 hover:text-white border-white/[0.06] hover:border-white/[0.15]"
                }`}
                title="Bella Configuration"
              >
                <SettingsIcon size={13} className={showSettings ? "animate-spin [animation-duration:6s] text-indigo-400" : "text-white/40"} />
                <span>SETTINGS</span>
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

      {/* Holographic Website frame projections */}
      <AnimatePresence>
        {activeProjectorUrl && (
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

      {/* Dynamic Floating Glassmorphic Screen Sharing Control Hub */}
      <AnimatePresence>
        {isScreenSharing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: 50 }}
            className={`absolute bottom-6 md:bottom-10 right-6 md:right-10 z-50 w-72 p-4 rounded-2xl border ${
              isScreenSharingPaused 
                ? "border-amber-500/20 bg-slate-950/70" 
                : "border-cyan-500/20 bg-slate-950/70"
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
                  <span>Streaming FPS: 0.5</span>
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
    </div>
  );
}
