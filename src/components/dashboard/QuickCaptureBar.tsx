import React, { useState, useMemo } from "react";
import {
  Sparkles,
  CornerDownLeft,
  CheckSquare,
  FileText,
  Lightbulb,
  FolderKanban,
  Brain,
  ChevronDown,
} from "lucide-react";

interface QuickCaptureBarProps {
  onCapture: (text: string, type?: "task" | "note" | "idea" | "project" | "memory") => Promise<void>;
}

type CaptureType = "task" | "note" | "idea" | "project" | "memory";

const TYPE_CONFIG: Record<CaptureType, { label: string; icon: any; color: string; bg: string }> = {
  task: { label: "Task", icon: CheckSquare, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/30" },
  note: { label: "Note", icon: FileText, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  idea: { label: "Idea", icon: Lightbulb, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
  project: { label: "Project", icon: FolderKanban, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
  memory: { label: "Memory", icon: Brain, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
};

export function QuickCaptureBar({ onCapture }: QuickCaptureBarProps) {
  const [text, setText] = useState("");
  const [overrideType, setOverrideType] = useState<CaptureType | null>(null);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Auto-detect type from input string
  const detectedType = useMemo<CaptureType>(() => {
    if (overrideType) return overrideType;
    const lower = text.toLowerCase();
    if (lower.startsWith("todo:") || lower.startsWith("task:") || lower.includes("finish ") || lower.includes("complete ") || lower.includes("due ")) {
      return "task";
    }
    if (lower.startsWith("project:") || lower.includes("start project ") || lower.includes("build platform")) {
      return "project";
    }
    if (lower.startsWith("remember:") || lower.startsWith("recall:") || lower.includes("my favorite") || lower.includes("i like ") || lower.includes("my goal")) {
      return "memory";
    }
    if (lower.startsWith("idea:") || lower.includes("what if ") || lower.includes("concept:")) {
      return "idea";
    }
    return "note";
  }, [text, overrideType]);

  const config = TYPE_CONFIG[detectedType];
  const IconComponent = config.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;

    setSubmitting(true);
    try {
      await onCapture(text.trim(), overrideType || undefined);
      setText("");
      setOverrideType(null);
    } catch (err) {
      console.error("[QuickCapture] Error submitting:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 p-2 pl-3.5 rounded-2xl bg-slate-900/80 border border-white/[0.08] hover:border-white/[0.15] focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/30 transition-all backdrop-blur-xl shadow-lg"
      >
        {/* Type Badge & Override Dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowTypeMenu(!showTypeMenu)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-mono font-medium transition cursor-pointer ${config.bg} ${config.color}`}
          >
            <IconComponent className="w-3 h-3" />
            <span>{config.label}</span>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {/* Type Selection Dropdown */}
          {showTypeMenu && (
            <div className="absolute top-full left-0 mt-1.5 z-50 w-32 p-1 rounded-xl bg-slate-900 border border-white/10 shadow-2xl backdrop-blur-2xl">
              {(Object.keys(TYPE_CONFIG) as CaptureType[]).map((t) => {
                const cfg = TYPE_CONFIG[t];
                const Icon = cfg.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setOverrideType(t);
                      setShowTypeMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition text-left cursor-pointer ${
                      detectedType === t ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon className={`w-3 h-3 ${cfg.color}`} />
                    <span>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Input */}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you want to remember or accomplish? (Type idea, task, note, project...)"
          className="flex-1 bg-transparent border-none text-xs sm:text-sm font-sans text-white placeholder:text-slate-500 focus:outline-none"
        />

        {/* Submit action button */}
        <button
          type="submit"
          disabled={!text.trim() || submitting}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-cyan-500 hover:text-slate-950 text-slate-300 text-xs font-mono transition disabled:opacity-30 disabled:hover:bg-white/[0.06] disabled:hover:text-slate-300 cursor-pointer"
        >
          <span>Capture</span>
          <CornerDownLeft className="w-3 h-3" />
        </button>
      </form>
    </div>
  );
}
