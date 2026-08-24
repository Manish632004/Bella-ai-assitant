import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BellaAudioSession, LiveState } from "../lib/audio";
import { Sparkles, Maximize2, Minimize2, Move } from "lucide-react";

export type BellaEmotion = 
  | "idle" 
  | "happy" 
  | "excited" 
  | "curious" 
  | "thinking" 
  | "proud" 
  | "sad" 
  | "confused" 
  | "surprised" 
  | "embarrassed" 
  | "playful";

interface BellaCoreVisualizerProps {
  session: BellaAudioSession | null;
  state: LiveState;
  themeColor: string; // Violet, crimson, emerald, celestial, gold, rose, charcoal
  activeEmotion?: BellaEmotion;
  characterState: "idle" | "thinking" | "talking";
  isMiniMode?: boolean;
  onToggleMiniMode?: () => void;
  personaId?: string; // bella | friday | venom
}

export const BellaCoreVisualizer: React.FC<BellaCoreVisualizerProps> = ({
  session,
  state,
  themeColor,
  activeEmotion = "idle",
  characterState,
  isMiniMode = false,
  onToggleMiniMode,
  personaId = "bella",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const miniAnimationRef = useRef<number | null>(null);
  const isPersonaCanvas = personaId === "friday" || personaId === "venom";
  
  // Video element refs for character state machine
  const idleVideoRef = useRef<HTMLVideoElement | null>(null);
  const thinkingVideoRef = useRef<HTMLVideoElement | null>(null);
  const talkingVideoRef = useRef<HTMLVideoElement | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);

  const handleVideoError = (videoName: string) => {
    console.warn(`[Bella Web Video] Failed to load video source for: ${videoName}`);
    setHasError(true);
  };

  // Interaction and tracking references
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.4 });
  const targetMouseRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.4 });
  
  // Physics & Animation states
  const speechVolumeRef = useRef<number>(0);

  // Floating sci-fi background particle arrays
  const particlesRef = useRef<Array<{
    x: number;
    y: number;
    speed: number;
    size: number;
    opacity: number;
  }>>([]);

  // Synchronized video playback state manager (highly polished and flicker-free)
  useEffect(() => {
    const playVideo = (videoEl: HTMLVideoElement | null) => {
      if (!videoEl) return;
      try {
        videoEl.currentTime = 0;
        const playPromise = videoEl.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            console.warn("Autoplay block detected, retrying muted play:", error);
          });
        }
      } catch (err) {}
    };

    const pauseVideo = (videoEl: HTMLVideoElement | null) => {
      if (!videoEl) return;
      try {
        videoEl.pause();
      } catch (err) {}
    };

    if (characterState === "idle") {
      playVideo(idleVideoRef.current);
      pauseVideo(thinkingVideoRef.current);
      pauseVideo(talkingVideoRef.current);
    } else if (characterState === "thinking") {
      playVideo(thinkingVideoRef.current);
      pauseVideo(idleVideoRef.current);
      pauseVideo(talkingVideoRef.current);
    } else if (characterState === "talking") {
      playVideo(talkingVideoRef.current);
      pauseVideo(idleVideoRef.current);
      pauseVideo(thinkingVideoRef.current);
    }
  }, [characterState]);

  // Cursor position tracking hook
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetMouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  // Theme matching mapping function (extremely beautiful cinematic color tones)
  const getGlowColors = () => {
    switch (themeColor) {
      case "violet":
        return { primary: "rgba(147, 51, 234, 1)", secondary: "rgba(192, 38, 211, 0.8)", glow: "rgba(168, 85, 247, 0.7)" };
      case "crimson":
        return { primary: "rgba(225, 29, 72, 1)", secondary: "rgba(234, 88, 12, 0.8)", glow: "rgba(244, 63, 94, 0.7)" };
      case "emerald":
        return { primary: "rgba(5, 150, 105, 1)", secondary: "rgba(13, 148, 136, 0.8)", glow: "rgba(16, 185, 129, 0.7)" };
      case "celestial":
        return { primary: "rgba(2, 132, 199, 1)", secondary: "rgba(8, 145, 178, 0.8)", glow: "rgba(14, 165, 233, 0.7)" };
      case "gold":
        return { primary: "rgba(202, 138, 4, 1)", secondary: "rgba(217, 119, 6, 0.8)", glow: "rgba(234, 179, 8, 0.7)" };
      case "rose":
        return { primary: "rgba(219, 39, 119, 1)", secondary: "rgba(220, 38, 38, 0.8)", glow: "rgba(236, 72, 153, 0.7)" };
      default:
        return { primary: "rgba(34, 211, 238, 1)", secondary: "rgba(79, 70, 229, 0.8)", glow: "rgba(6, 182, 212, 0.7)" };
    }
  };

  // ==========================================
  // Persona-specific canvas scenes (Friday / Venom) + Bella's voice orb.
  // All are driven by the live session's frequency data.
  // ==========================================
  const freqRef = useRef<Uint8Array>(new Uint8Array(128));
  const venomTendrilsRef = useRef<Array<{ a: number; len: number; sp: number; ph: number }>>([]);
  const fridayRotRef = useRef<number>(0);

  const drawBellaOrb = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, vol: number, freq: Uint8Array) => {
    const pulse = 1 + vol * 0.35;
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5 * pulse);
    core.addColorStop(0, "rgba(233,213,255,0.95)");
    core.addColorStop(0.25, "rgba(192,132,252,0.55)");
    core.addColorStop(0.6, "rgba(147,51,234,0.22)");
    core.addColorStop(1, "rgba(88,28,135,0)");
    ctx.save();
    ctx.shadowColor = "rgba(168,85,247,0.9)";
    ctx.shadowBlur = 40 + vol * 60;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.35 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Circular waveform ring synced to voice frequencies
    ctx.beginPath();
    const steps = freq.length;
    for (let i = 0; i <= steps; i++) {
      const f = freq[i % steps] / 255;
      const ang = (i / steps) * Math.PI * 2 - Math.PI / 2;
      const r = R * (1.15 + f * 0.55 + vol * 0.12);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r * 0.92; // slightly elliptical
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(216,180,254,${0.5 + vol * 0.45})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  };

  const drawFridayScene = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vol: number, freq: Uint8Array) => {
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.26;
    fridayRotRef.current += 0.004 + vol * 0.02;
    const rot = fridayRotRef.current;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Faint tactical grid backdrop
    ctx.strokeStyle = "rgba(34,211,238,0.05)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 48) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (let gy = 0; gy < h; gy += 48) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

    ctx.translate(cx, cy);

    // Rotating arc groups (Iron-Man-Jarvis style)
    for (let g = 0; g < 3; g++) {
      const rr = R * (0.72 + g * 0.24);
      const dir = g % 2 === 0 ? 1 : -1;
      const segs = 4 + g * 2;
      for (let sgi = 0; sgi < segs; sgi++) {
        const start = rot * dir + (sgi / segs) * Math.PI * 2;
        const span = (Math.PI * 2 / segs) * (0.42 + (g === 1 ? freq[(g * 7 + sgi * 5) % freq.length] / 400 : vol * 0.25));
        ctx.beginPath();
        ctx.arc(0, 0, rr, start, start + span);
        ctx.strokeStyle = g === 1 ? "rgba(251,191,36,0.75)" : "rgba(34,211,238,0.85)";
        ctx.lineWidth = g === 0 ? 2.4 : 1.4;
        ctx.shadowColor = g === 1 ? "rgba(251,191,36,0.8)" : "rgba(34,211,238,0.8)";
        ctx.shadowBlur = 10 + vol * 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // Center reticle
    ctx.strokeStyle = "rgba(34,211,238,0.9)";
    ctx.lineWidth = 1.6;
    const ret = R * 0.3 * (1 + vol * 0.18);
    ctx.beginPath(); ctx.arc(0, 0, ret, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-ret * 1.5, 0); ctx.lineTo(-ret * 0.7, 0);
    ctx.moveTo(ret * 0.7, 0); ctx.lineTo(ret * 1.5, 0);
    ctx.moveTo(0, -ret * 1.5); ctx.lineTo(0, -ret * 0.7);
    ctx.moveTo(0, ret * 0.7); ctx.lineTo(0, ret * 1.5);
    ctx.stroke();
    ctx.fillStyle = `rgba(165,243,252,${0.5 + vol * 0.5})`;
    ctx.beginPath(); ctx.arc(0, 0, 4 + vol * 5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();

    // Bottom EQ bars
    const bars = 40, bw = w / bars;
    ctx.fillStyle = "rgba(34,211,238,0.65)";
    for (let i = 0; i < bars; i++) {
      const v = freq[Math.floor((i / bars) * freq.length)] / 255;
      const bh = 6 + v * 70 * (0.5 + vol);
      ctx.fillRect(i * bw + 2, h - 14 - bh, bw - 4, bh);
    }
  };

  const drawVenomScene = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vol: number, freq: Uint8Array) => {
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.24;

    if (!venomTendrilsRef.current.length) {
      venomTendrilsRef.current = Array.from({ length: 14 }, (_, i) => ({
        a: (i / 14) * Math.PI * 2,
        len: 0.4 + Math.random() * 0.8,
        sp: 0.5 + Math.random(),
        ph: Math.random() * Math.PI * 2,
      }));
    }

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Blood vignette
    const vg = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, Math.max(w, h) * 0.6);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(120,10,20,${0.10 + vol * 0.16})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    ctx.translate(cx, cy);

    // Symbiote blob — jagged noise-perturbed outline
    ctx.beginPath();
    const pts = 64;
    for (let i = 0; i <= pts; i++) {
      const ang = (i / pts) * Math.PI * 2;
      const n =
        Math.sin(ang * 5 + t * 0.0016) * 0.06 +
        Math.sin(ang * 9 - t * 0.0023) * 0.04 +
        Math.sin(ang * 17 + t * 0.0031) * 0.03 +
        vol * 0.16 * Math.abs(Math.sin(ang * 3 + t * 0.005));
      const r = R * (1 + n) * (1 + vol * 0.12);
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r * 0.95;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const bodyG = ctx.createRadialGradient(0, 0, R * 0.15, 0, 0, R * 1.2);
    bodyG.addColorStop(0, "#101018");
    bodyG.addColorStop(0.75, "#05050a");
    bodyG.addColorStop(1, "#000");
    ctx.fillStyle = bodyG;
    ctx.shadowColor = `rgba(220,38,38,${0.5 + vol * 0.5})`;
    ctx.shadowBlur = 30 + vol * 70;
    ctx.fill();
    ctx.strokeStyle = `rgba(239,68,68,${0.55 + vol * 0.4})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // White angular eyes that narrow with volume
    const squint = 1 - Math.min(0.7, vol * 1.4);
    ctx.fillStyle = "rgba(240,240,245,0.95)";
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * R * 0.34, -R * 0.18);
      ctx.rotate(side * 0.42);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.30, R * 0.085 * squint + 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Lashing tendrils
    for (const td of venomTendrilsRef.current) {
      const ang = td.a + Math.sin(t * 0.0008 * td.sp + td.ph) * 0.35;
      const reach = R * (1.05 + td.len * (0.5 + vol * 1.1) * (0.6 + 0.4 * Math.sin(t * 0.003 * td.sp + td.ph)));
      const x1 = Math.cos(ang) * R * 0.98, y1 = Math.sin(ang) * R * 0.94;
      const x2 = Math.cos(ang) * reach, y2 = Math.sin(ang) * reach;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(
        Math.cos(ang - 0.25) * reach * 0.8, Math.sin(ang - 0.25) * reach * 0.8,
        x2, y2
      );
      ctx.strokeStyle = `rgba(20,20,26,0.95)`;
      ctx.lineWidth = 5 + vol * 4;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.strokeStyle = `rgba(239,68,68,${0.35 + vol * 0.4})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    // Inner red heartbeat
    const hb = (Math.sin(t * 0.004) + 1) / 2;
    ctx.fillStyle = `rgba(185,28,28,${0.10 + hb * 0.16 + vol * 0.2})`;
    ctx.beginPath(); ctx.arc(0, R * 0.05, R * 0.32 * (1 + hb * 0.15), 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    // Generate responsive background floating stars
    const generateParticles = () => {
      const count = Math.min(60, Math.floor(width / 24));
      particlesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height + height * 0.1,
        speed: Math.random() * 0.35 + 0.12,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.6 + 0.2,
      }));
    };

    generateParticles();

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
      generateParticles();
    };

    window.addEventListener("resize", handleResize);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const systemTime = performance.now();
      const colors = getGlowColors();

      // Dynamic Audio analysis fetching from real voice session
      let audioLevel = 0;
      let bufferLength = 64;
      const dataArray = new Uint8Array(bufferLength);
      let activeAnalyser = null;

      if (state === "speaking" && session?.outputAnalyser) {
        activeAnalyser = session.outputAnalyser;
      } else if (state === "listening" && session?.inputAnalyser) {
        activeAnalyser = session.inputAnalyser;
      }

      if (activeAnalyser) {
        try {
          activeAnalyser.getByteFrequencyData(dataArray);
          activeAnalyser.getByteFrequencyData(freqRef.current);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          audioLevel = sum / bufferLength; // 0 to 255
        } catch (e) {}
      }

      // Smooth amplitude tracking for real-time particle excitation
      speechVolumeRef.current += (audioLevel / 255 - speechVolumeRef.current) * 0.2;

      // Cinematic ambient stardust sizing
      const baseScale = height / 440;
      const s = Math.max(0.95, Math.min(1.85, baseScale)); // scale multiplier

      // Smooth cursor mouse tracking lag
      mouseRef.current.x += (targetMouseRef.current.x - mouseRef.current.x) * 0.05;
      mouseRef.current.y += (targetMouseRef.current.y - mouseRef.current.y) * 0.05;

      const centerX = width / 2;

      // ==========================================
      // PERSONA BRANCH — Friday & Venom replace the whole scene.
      // ==========================================
      if (personaId === "friday" || personaId === "venom") {
        const vol = speechVolumeRef.current;
        ctx.clearRect(0, 0, width, height);
        if (personaId === "friday") {
          drawFridayScene(ctx, width, height, systemTime, vol, freqRef.current);
        } else {
          drawVenomScene(ctx, width, height, systemTime, vol, freqRef.current);
        }
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      // ==========================================
      // 1. DRAW GRAND STAGE VOLUMETRIC PROJECTOR BEAM (Cinematic Glow Backlight)
      // ==========================================
      ctx.save();
      const projectorCenterY = height + 40;
      const baseDiameterX = 280 * s;

      // Volumetric light beams shooting up from projector base
      const conicalBeamGrad = ctx.createLinearGradient(centerX, height * 0.25, centerX, height);
      conicalBeamGrad.addColorStop(0, "rgba(0,0,0,0)");
      conicalBeamGrad.addColorStop(0.4, colors.primary.replace("1)", "0.03)"));
      conicalBeamGrad.addColorStop(0.75, colors.primary.replace("1)", "0.08)"));
      conicalBeamGrad.addColorStop(1, colors.secondary.replace("0.8)", "0.18)"));

      ctx.fillStyle = conicalBeamGrad;
      ctx.beginPath();
      ctx.moveTo(centerX - baseDiameterX * 0.35, projectorCenterY - 145);
      ctx.lineTo(centerX + baseDiameterX * 0.35, projectorCenterY - 145);
      ctx.lineTo(centerX + baseDiameterX * 1.5, height);
      ctx.lineTo(centerX - baseDiameterX * 1.5, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ==========================================
      // 2. MINIMALIST ATMOSPHERE NEURAL FIELDS (SUBTLE GLITCH)
      // ==========================================
      const applyGlitch = (state === "connecting" && Math.random() < 0.1) || (Math.random() < 0.005);
      if (applyGlitch) {
        ctx.save();
        ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2);
        ctx.fillStyle = Math.random() < 0.5 ? "rgba(236,72,153,0.03)" : "rgba(34,211,238,0.03)";
        ctx.fillRect(0, 0, width, height);
      }

      // ==========================================
      // 3. UPDATE AND DRAW HOLOGRAM NEURAL PARTICLES RISING (Cinematic Stardust)
      // ==========================================
      particlesRef.current.forEach((p) => {
        const riseSpeed = p.speed * (1 + speechVolumeRef.current * 1.8);
        p.y -= riseSpeed;
        
        // Horizontal drift sway
        p.x += Math.sin(p.y * 0.015 + p.size) * 0.4;
        
        // Transparency matches base lift height
        const currentOpacity = p.opacity * Math.max(0, p.y / height);

        // Recirculate particle if it reaches up too high near her crown
        if (p.y < height * 0.12) {
          p.y = height + Math.random() * 30;
          p.x = Math.random() * width;
        }

        ctx.fillStyle = colors.primary.replace("1)", `${currentOpacity * 0.45})`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * s, 0, Math.PI * 2);
        ctx.fill();
      });

      if (applyGlitch) {
        ctx.restore();
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [session, state, themeColor, activeEmotion, characterState, personaId]);

  // Mini-mode persona canvas (Friday/Venom PiP) — separate small rAF loop.
  useEffect(() => {
    if (!isMiniMode || !isPersonaCanvas) return;
    const canvas = miniCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const loop = () => {
      const w = (canvas.width = canvas.offsetWidth || 240);
      const h = (canvas.height = canvas.offsetHeight || 180);
      let active = null;
      if (state === "speaking" && session?.outputAnalyser) active = session.outputAnalyser;
      else if (state === "listening" && session?.inputAnalyser) active = session.inputAnalyser;
      try { active?.getByteFrequencyData(freqRef.current); } catch {}
      let sum = 0;
      for (let i = 0; i < freqRef.current.length; i++) sum += freqRef.current[i];
      const vol = sum / freqRef.current.length / 255;
      const t = performance.now();
      if (personaId === "friday") drawFridayScene(ctx, w, h, t, vol, freqRef.current);
      else drawVenomScene(ctx, w, h, t, vol, freqRef.current);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [isMiniMode, isPersonaCanvas, personaId, session, state]);

  const handlePointerDragStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Prevent browser default drag / selection behavior so the OS
    // doesn't interpret pointer movement as a window resize gesture.
    e.preventDefault();
    e.stopPropagation();

    let lastScreenX = e.screenX;
    let lastScreenY = e.screenY;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.screenX - lastScreenX;
      const deltaY = moveEvent.screenY - lastScreenY;
      lastScreenX = moveEvent.screenX;
      lastScreenY = moveEvent.screenY;

      if ((window as any)?.bella?.moveWindow) {
        (window as any).bella.moveWindow(deltaX, deltaY);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div className={`relative w-full h-full flex items-center justify-center ${isMiniMode ? "pointer-events-auto" : "overflow-hidden"}`}>
      {/* 1. Behind Overlay / Soft Atmospheric Backlight Glow (Z-index 0) - only in full stage mode */}
      {!isMiniMode && (
        <div className="absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none z-0">
          <div className={`w-[600px] h-[600px] rounded-full blur-[160px] opacity-20 transition-all duration-1000 ${
            themeColor === "violet" ? "bg-indigo-600/30" :
            themeColor === "crimson" ? "bg-rose-600/30" :
            themeColor === "emerald" ? "bg-emerald-600/30" :
            themeColor === "celestial" ? "bg-cyan-600/25" :
            themeColor === "gold" ? "bg-amber-600/25" :
            themeColor === "rose" ? "bg-pink-600/30" :
            "bg-indigo-600/25"
          } ${characterState === "talking" ? "scale-110 opacity-30 animate-pulse-glow" : "scale-100"}`} />
        </div>
      )}

      {/* 2. Character Videos state crossfade manager */}
      {isMiniMode ? (
        // FLOATING DRAGGABLE MINI COMPANION (PiP Mode)
        <div
          className={`fixed ${
            (window as any)?.bella?.isDesktop 
              ? "inset-0 w-full h-full" 
              : "bottom-8 right-8 w-56 sm:w-64 aspect-[4/3]"
          } z-50 flex items-center justify-center cursor-grab active:cursor-grabbing select-none pointer-events-auto`}
          onPointerDown={handlePointerDragStart}
        >
          {/* Subtle Ambient Floating Glow */}
          <div className="absolute inset-2 rounded-full blur-3xl opacity-35 bg-indigo-500/20 pointer-events-none animate-pulse-glow" />

          {/* Active Status Glass Chip */}
          <div
            className="absolute bottom-3 right-4 z-50 flex items-center gap-2 px-3 py-1 rounded-full glass-panel text-[10px] font-sans font-medium text-slate-200 pointer-events-auto shadow-lg"
          >
            <span className={`w-2 h-2 rounded-full ${
              characterState === "talking" ? "bg-purple-400 animate-ping" :
              characterState === "thinking" ? "bg-amber-400 animate-pulse" :
              "bg-cyan-400 animate-pulse"
            }`} />
            <span className="capitalize tracking-wide">{characterState}</span>
          </div>

          {/* Persona canvas (Friday/Venom) in PiP mode */}
          {isPersonaCanvas && (
            <canvas
              ref={miniCanvasRef}
              className="relative w-full h-full z-10 pointer-events-none"
              onDoubleClick={() => onToggleMiniMode && onToggleMiniMode()}
            />
          )}

          {/* Character Video container - grabbing anywhere on the character drags Bella */}
          {!isPersonaCanvas && (
          <div
            onDoubleClick={() => onToggleMiniMode && onToggleMiniMode()}
            className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
            title="Drag anywhere to move Bella. Double-click or click Taskbar icon for Full Stage."
          >
            {/* IDLE VIDEO */}
            <video
              ref={idleVideoRef}
              src="/assets/idle.mp4"
              loop
              muted
              playsInline
              autoPlay
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                characterState === "idle" ? "opacity-100 z-10" : "opacity-0 z-0"
              }`}
              style={{
                maskImage: "radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 75%)",
                WebkitMaskImage: "radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 75%)",
              }}
              onError={() => handleVideoError("idle")}
            />

            {/* THINKING VIDEO */}
            <video
              ref={thinkingVideoRef}
              src="/assets/thinking.mp4"
              loop
              muted
              playsInline
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                characterState === "thinking" ? "opacity-100 z-10" : "opacity-0 z-0"
              }`}
              style={{
                maskImage: "radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 75%)",
                WebkitMaskImage: "radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 75%)",
              }}
              onError={() => handleVideoError("thinking")}
            />

            {/* TALKING VIDEO */}
            <video
              ref={talkingVideoRef}
              src="/assets/talking.mp4"
              loop
              muted
              playsInline
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                characterState === "talking" ? "opacity-100 z-10" : "opacity-0 z-0"
              }`}
              style={{
                maskImage: "radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 75%)",
                WebkitMaskImage: "radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 75%)",
              }}
              onError={() => handleVideoError("talking")}
            />
          </div>
          )}
        </div>
      ) : (
        // FULL STAGE CHARACTER
        <div 
          id="bella-animated-presence"
          className="absolute z-10 w-full h-full flex items-center justify-center pointer-events-auto transition-all duration-700"
        >
          <div className="relative w-full max-w-4xl aspect-[16/9] flex items-center justify-center scale-[0.95] sm:scale-110 select-none pointer-events-none md:max-h-[72vh] max-h-[62vh]">
            {/* Subtle Outer Ambient Shadow Cast */}
            <div className="absolute inset-0 rounded-[2.5rem] blur-[30px] opacity-20 bg-cyan-600/15 pointer-events-none mix-blend-screen" />

            {/* IDLE VIDEO */}
            {!isPersonaCanvas && (
            <video
              ref={idleVideoRef}
              src="/assets/idle.mp4"
              loop
              muted
              playsInline
              autoPlay
              className={`absolute inset-0 w-full h-full object-cover rounded-[2.5rem] transition-opacity duration-700 ease-in-out ${
                characterState === "idle" ? "opacity-100 z-10 animate-fade-in" : "opacity-0 z-0"
              }`}
              style={{
                maskImage: "radial-gradient(circle, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 80%)",
                WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 80%)",
              }}
              onError={() => handleVideoError("idle")}
            />
            )}

            {/* THINKING VIDEO */}
            {!isPersonaCanvas && (
            <video
              ref={thinkingVideoRef}
              src="/assets/thinking.mp4"
              loop
              muted
              playsInline
              className={`absolute inset-0 w-full h-full object-cover rounded-[2.5rem] transition-opacity duration-700 ease-in-out ${
                characterState === "thinking" ? "opacity-100 z-10 animate-fade-in" : "opacity-0 z-0"
              }`}
              style={{
                maskImage: "radial-gradient(circle, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 80%)",
                WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 80%)",
              }}
              onError={() => handleVideoError("thinking")}
            />
            )}

            {/* TALKING VIDEO */}
            {!isPersonaCanvas && (
            <video
              ref={talkingVideoRef}
              src="/assets/talking.mp4"
              loop
              muted
              playsInline
              className={`absolute inset-0 w-full h-full object-cover rounded-[2.5rem] transition-opacity duration-700 ease-in-out ${
                characterState === "talking" ? "opacity-100 z-10 animate-fade-in" : "opacity-0 z-0"
              }`}
              style={{
                maskImage: "radial-gradient(circle, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 80%)",
                WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 80%)",
              }}
              onError={() => handleVideoError("talking")}
            />
            )}

            {/* Faint cybernetic visual edge grid guard */}
            <div className="absolute inset-0 rounded-[2.5rem] border border-white/5 pointer-events-none bg-radial-gradient from-transparent to-black/35" />

            {/* Video Placeholder/Fallback Tutorial Overlay if asset files are absent */}
            {hasError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#05060f]/90 backdrop-blur-md rounded-3xl p-6 text-center z-50 pointer-events-auto border border-white/5 shadow-2xl animate-fade-in">
                <Sparkles className="text-cyan-400 mb-2 animate-pulse" size={32} />
                <h3 className="text-sm font-bold tracking-widest font-mono text-white select-none">AWAITING VIDEOS CORES</h3>
                <p className="text-xs text-slate-400 mt-2 max-w-xs leading-relaxed font-sans">
                  Please place your character video assets inside the <code className="text-cyan-300 font-mono">/assets</code> directory of your workspace named exactly:
                </p>
                <div className="mt-3 space-y-1.5 text-left font-mono text-[10px] text-cyan-200 bg-white/5 px-4 py-2.5 rounded-xl border border-white/5">
                  <div>• idle.mp4 (State: Idle)</div>
                  <div>• thinking.mp4 (State: Thinking)</div>
                  <div>• talking.mp4 (State: Talking)</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Foreground Hover-Responsive Canvas for glowing particles (Holographic Overlay Z-index 20) */}
      {!isMiniMode && (
        <canvas
          id="bella-hologram-living-canvas"
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
        />
      )}
    </div>
  );
};
