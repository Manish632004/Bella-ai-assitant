import { useCallback, useEffect, useRef, useState } from "react";
import { X, Download, Trash2 } from "lucide-react";

export interface WbElement {
  type: "line" | "arrow" | "rect" | "circle" | "text" | "path";
  x?: number; y?: number; x2?: number; y2?: number;
  w?: number; h?: number; r?: number;
  points?: [number, number][];
  text?: string;
  color?: string;
  width?: number;
}

const VIRTUAL = 1000; // normalized coordinate space

function drawElement(ctx: CanvasRenderingContext2D, el: WbElement): void {
  const color = el.color || "#e2e8f0";
  const lw = Math.max(1.5, (el.width ?? 3) * 1.2);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const px = (v?: number) => ((v ?? 0) / VIRTUAL) * ctx.canvas.width;
  const py = (v?: number) => ((v ?? 0) / VIRTUAL) * ctx.canvas.height;

  switch (el.type) {
    case "line": {
      ctx.beginPath();
      ctx.moveTo(px(el.x), py(el.y));
      ctx.lineTo(px(el.x2), py(el.y2));
      ctx.stroke();
      break;
    }
    case "arrow": {
      const x1 = px(el.x), y1 = py(el.y), xa = px(el.x2), ya = py(el.y2);
      const angle = Math.atan2(ya - y1, xa - x1);
      const head = Math.max(8, lw * 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(xa, ya);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xa - head * Math.cos(angle - Math.PI / 6), ya - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(xa - head * Math.cos(angle + Math.PI / 6), ya - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "rect": {
      ctx.strokeRect(px(el.x), py(el.y), px(el.w), py(el.h));
      break;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(px(el.x), py(el.y), ((el.r ?? 50) / VIRTUAL) * ctx.canvas.width, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "path": {
      if (!el.points?.length) break;
      ctx.beginPath();
      el.points.forEach(([vx, vy], i) => {
        if (i === 0) ctx.moveTo(px(vx), py(vy));
        else ctx.lineTo(px(vx), py(vy));
      });
      ctx.stroke();
      break;
    }
    case "text": {
      const isTitle = (el.y ?? 0) <= 90;
      const size = isTitle ? Math.max(20, ctx.canvas.width * 0.032) : Math.max(13, ctx.canvas.width * 0.018);
      ctx.font = `${isTitle ? "700" : "500"} ${size}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      String(el.text ?? "")
        .split("\n")
        .forEach((line, i) => ctx.fillText(line, px(el.x), py(el.y) + i * size * 1.25));
      break;
    }
  }
}

interface WhiteboardProps {
  open: boolean;
  topic: string;
  onClose: () => void;
  /** Increment to wipe all elements. */
  clearSignal: number;
  drawSignal: number;
  pendingElement: WbElement | null;
  saveSignal: number;
  saveName: string;
}

export function Whiteboard(props: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elementsRef = useRef<WbElement[]>([]);
  const [savedPath, setSavedPath] = useState<string>("");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Dark board background
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // subtle grid
    ctx.strokeStyle = "rgba(148,163,184,0.07)";
    ctx.lineWidth = 1;
    const step = canvas.width / 20;
    for (let gx = step; gx < canvas.width; gx += step) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
    }
    for (let gy = step; gy < canvas.height; gy += step) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
    }
    for (const el of elementsRef.current) drawElement(ctx, el);
  }, []);

  // Size the canvas to the viewport once on open
  useEffect(() => {
    if (!props.open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    elementsRef.current = [];
    redraw();
  }, [props.open, redraw]);

  // New element arrives
  useEffect(() => {
    if (!props.pendingElement || !props.open) return;
    elementsRef.current.push(props.pendingElement);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.drawSignal]);

  // Voice-driven clear
  useEffect(() => {
    if (!props.clearSignal || !props.open) return;
    elementsRef.current = [];
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clearSignal]);

  useEffect(() => {
    if (!props.open) return;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  // Save request
  useEffect(() => {
    if (!props.saveSignal || !props.open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const fileName = `${(props.saveName || "whiteboard").replace(/[\\/:*?"<>|]/g, "-")}.png`;
    (async () => {
      try {
        if ((window as any).bella?.saveImage) {
          const blob = await (await fetch(dataUrl)).blob();
          const buf = await blob.arrayBuffer();
          const res = await (window as any).bella.saveImage(buf, fileName);
          setSavedPath(res?.path || "saved");
        } else {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = fileName;
          a.click();
          setSavedPath(fileName);
        }
      } catch (err) {
        console.error("[Whiteboard] save failed:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.saveSignal]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-[#0b1020]">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Floating toolbar */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400 mr-2 truncate max-w-[40vw]">
          {props.topic || "Whiteboard"}
        </span>
        <button
          onClick={() => { elementsRef.current = []; redraw(); }}
          title="Clear board"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={() => { /* handled via voice or parent triggers saveSignal */ }}
          title="Save PNG"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"
        >
          <Download size={16} />
        </button>
        <button
          onClick={props.onClose}
          title="Close"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"
        >
          <X size={16} />
        </button>
      </div>

      {savedPath && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
          Saved ✓ {savedPath}
        </div>
      )}
    </div>
  );
}
