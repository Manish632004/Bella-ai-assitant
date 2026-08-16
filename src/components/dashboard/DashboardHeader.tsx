import React from "react";
import {
  Sparkles,
  Search,
  Plus,
  Brain,
  CheckSquare,
  Timer,
  FileText,
  Command,
} from "lucide-react";

interface DashboardHeaderProps {
  greeting: {
    greetingText: string;
    subText: string;
    userName: string;
  };
  onOpenCommandPalette: () => void;
  onQuickAction: (action: "task" | "note" | "focus" | "memory" | "project") => void;
}

export function DashboardHeader({
  greeting,
  onOpenCommandPalette,
  onQuickAction,
}: DashboardHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/[0.06]">
      {/* Personalized Greeting */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white font-sans">
            {greeting.greetingText}
          </h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
            <Sparkles className="w-2.5 h-2.5 mr-1" />
            AI Ready
          </span>
        </div>
        <p className="text-sm font-sans text-slate-400">
          {greeting.subText}
        </p>
      </div>

      {/* Action Strip: Command Search + Quick Action Buttons */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Global Search / Command trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-mono text-slate-300 hover:text-white transition-all shadow-sm cursor-pointer group"
        >
          <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-400 transition-colors" />
          <span>Search or Command</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-white/[0.06] text-slate-400 rounded border border-white/[0.08]">
            <Command className="w-2.5 h-2.5" /> K
          </kbd>
        </button>

        {/* Quick action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onQuickAction("task")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 text-xs font-mono font-medium transition cursor-pointer"
            title="Create Task"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Task</span>
          </button>

          <button
            type="button"
            onClick={() => onQuickAction("note")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 hover:text-white text-xs font-mono transition cursor-pointer"
            title="Create Note"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Note</span>
          </button>

          <button
            type="button"
            onClick={() => onQuickAction("focus")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 text-xs font-mono font-medium transition cursor-pointer"
            title="Start Focus Session"
          >
            <Timer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Focus</span>
          </button>

          <button
            type="button"
            onClick={() => onQuickAction("memory")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 hover:text-white text-xs font-mono transition cursor-pointer"
            title="Add to Memory Core"
          >
            <Brain className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
