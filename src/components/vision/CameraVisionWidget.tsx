/**
 * Camera Vision Widget
 * Floating Frosted Glass Camera HUD for Real-time Visual Intelligence
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Eye,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  X,
  Maximize2,
  Minimize2,
  BookmarkPlus
} from "lucide-react";
import { CameraDeviceInfo, VisionMode } from "../../lib/vision/types";
import { CameraVisionManager } from "../../lib/vision/CameraVisionManager";

interface CameraVisionWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  onFrameCaptured?: (base64Jpeg: string) => void;
  onRememberVisual?: (summary: string) => void;
  themeColor?: string;
}

export const CameraVisionWidget: React.FC<CameraVisionWidgetProps> = ({
  isOpen,
  onClose,
  onFrameCaptured,
  onRememberVisual,
  themeColor = "cyan"
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const managerRef = useRef<CameraVisionManager | null>(null);

  const [mode, setMode] = useState<VisionMode>("CONVERSATION");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [cameras, setCameras] = useState<CameraDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [statusText, setStatusText] = useState<string>("Ready");
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [lastSnapshotTaken, setLastSnapshotTaken] = useState<boolean>(false);

  // Initialize Camera Manager
  useEffect(() => {
    const manager = new CameraVisionManager({
      onFrameCaptured: (base64) => {
        if (onFrameCaptured) onFrameCaptured(base64);
      },
      onModeChange: (m) => setMode(m),
      onStatusChange: (s) => setStatusText(s)
    });
    managerRef.current = manager;

    manager.getAvailableCameras().then((devs) => {
      setCameras(devs);
      if (devs.length > 0) setSelectedCamera(devs[0].deviceId);
    });

    return () => {
      manager.stopCamera();
    };
  }, [onFrameCaptured]);

  // Handle open/close streaming
  useEffect(() => {
    if (isOpen) {
      if (managerRef.current && !managerRef.current.isStreaming()) {
        managerRef.current.startCamera(selectedCamera, mode, videoRef.current || undefined).then((ok) => {
          setIsStreaming(ok);
          if (ok && videoRef.current) {
            managerRef.current?.attachPreviewVideo(videoRef.current);
          }
        });
      }
    } else {
      if (managerRef.current && managerRef.current.isStreaming()) {
        managerRef.current.stopCamera();
        setIsStreaming(false);
      }
    }
  }, [isOpen, selectedCamera, mode]);

  const handleModeChange = (newMode: VisionMode) => {
    setMode(newMode);
    if (newMode === "OFF") {
      managerRef.current?.stopCamera();
      setIsStreaming(false);
    } else {
      if (!isStreaming) {
        managerRef.current?.startCamera(selectedCamera, newMode, videoRef.current || undefined).then((ok) => {
          setIsStreaming(ok);
          if (ok && videoRef.current) {
            managerRef.current?.attachPreviewVideo(videoRef.current);
          }
        });
      } else {
        managerRef.current?.setMode(newMode);
      }
    }
  };

  const handleTakeSnapshot = () => {
    if (managerRef.current) {
      const snap = managerRef.current.captureSnapshot();
      if (snap) {
        setLastSnapshotTaken(true);
        setStatusText("Snapshot Captured");
        setTimeout(() => setLastSnapshotTaken(false), 1200);
      }
    }
  };

  const handleRememberView = () => {
    if (onRememberVisual) {
      onRememberVisual("Observed visual subject through camera");
      setStatusText("Visual Memory Saved");
      setTimeout(() => setStatusText("Camera Connected"), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed bottom-24 right-6 z-50 transition-all duration-300 select-none ${
        isMinimized ? "w-72" : "w-88 sm:w-96"
      }`}
    >
      <div className="rounded-2xl glass-panel shadow-2xl border border-white/[0.1] overflow-hidden backdrop-blur-2xl bg-[#0E1017]/85 text-white">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="relative flex h-2.5 w-2.5">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isStreaming ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isStreaming ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
            </div>
            <span className="text-xs font-semibold tracking-wider font-display uppercase text-white/90">
              Camera Vision
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300">
              {mode}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition"
              title={isMinimized ? "Expand Preview" : "Minimize"}
            >
              {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition"
              title="Close Camera"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Video Preview Viewport */}
        {!isMinimized && (
          <div className="relative bg-black/60 aspect-video flex items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                isStreaming ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* Shutter flash animation */}
            {lastSnapshotTaken && (
              <div className="absolute inset-0 bg-white/40 animate-out fade-out duration-300 pointer-events-none" />
            )}

            {!isStreaming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
                <CameraOff size={28} className="opacity-50" />
                <span className="text-xs font-sans">Camera Offline</span>
              </div>
            )}

            {/* Target Reticle Overlay */}
            {isStreaming && (
              <div className="absolute inset-4 pointer-events-none border border-white/20 rounded-xl flex items-center justify-center">
                <div className="w-8 h-8 border border-white/40 rounded-full animate-pulse" />
              </div>
            )}
          </div>
        )}

        {/* Control Footer & Mode Switcher */}
        <div className="p-3 space-y-2.5">
          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-black/40 rounded-xl border border-white/[0.05]">
            <button
              onClick={() => handleModeChange("SNAPSHOT")}
              className={`py-1 text-[11px] font-sans font-medium rounded-lg transition-all ${
                mode === "SNAPSHOT"
                  ? "bg-white/15 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Snapshot
            </button>
            <button
              onClick={() => handleModeChange("CONVERSATION")}
              className={`py-1 text-[11px] font-sans font-medium rounded-lg transition-all ${
                mode === "CONVERSATION"
                  ? "bg-white/15 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Conversational
            </button>
            <button
              onClick={() => handleModeChange("REAL-TIME")}
              className={`py-1 text-[11px] font-sans font-medium rounded-lg transition-all ${
                mode === "REAL-TIME"
                  ? "bg-white/15 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Real-Time
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-2">
            {/* Snapshot Trigger */}
            <button
              onClick={handleTakeSnapshot}
              disabled={!isStreaming}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-sans font-medium transition cursor-pointer disabled:opacity-50"
            >
              <Eye size={13} />
              <span>Analyze Frame</span>
            </button>

            {/* Remember Visual */}
            <button
              onClick={handleRememberView}
              disabled={!isStreaming}
              className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl glass-pill text-xs text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Save structured observation to memory without saving video"
            >
              <BookmarkPlus size={13} className="text-purple-400" />
              <span>Remember</span>
            </button>

            {/* Stop/Start Camera */}
            <button
              onClick={() => handleModeChange(isStreaming ? "OFF" : "CONVERSATION")}
              className={`p-1.5 rounded-xl border text-xs transition cursor-pointer ${
                isStreaming
                  ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30"
                  : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30"
              }`}
              title={isStreaming ? "Turn Camera Off" : "Turn Camera On"}
            >
              {isStreaming ? <CameraOff size={14} /> : <Camera size={14} />}
            </button>
          </div>

          {/* Privacy Footnote */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-white/[0.04]">
            <div className="flex items-center gap-1">
              <ShieldCheck size={11} className="text-emerald-400" />
              <span>Privacy-first • Zero background recording</span>
            </div>
            <span className="font-mono text-slate-500">{statusText}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
