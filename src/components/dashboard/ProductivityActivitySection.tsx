import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Sparkles,
  HelpCircle,
  FileText,
  FolderKanban,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import { ActivityItem } from "../../../proactive/types";

interface ProductivityActivitySectionProps {
  productivitySnapshot: {
    focusHours: string;
    tasksCompleted: number;
    labsCompleted: number;
    notesCreated: number;
  };
  recentActivity: ActivityItem[];
  recommendations: Array<{
    id: string;
    title: string;
    reason: string;
    category: string;
    actionLabel?: string;
  }>;
  onExecuteRecommendation?: (recId: string) => void;
}

const TYPE_ICONS: Record<string, any> = {
  projects: FolderKanban,
  learning: BookOpen,
  notes: FileText,
  tasks: CheckCircle2,
  ai: Sparkles,
};

export function ProductivityActivitySection({
  productivitySnapshot,
  recentActivity,
  recommendations,
  onExecuteRecommendation,
}: ProductivityActivitySectionProps) {
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null);

  const filteredActivity =
    activityFilter === "all"
      ? recentActivity
      : recentActivity.filter((a) => a.type === activityFilter);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left 2 Cols: Productivity Stats & Recent Activity Stream */}
      <div className="lg:col-span-2 space-y-4">
        {/* Productivity Snapshot Strip */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 block mb-3">
            Productivity Snapshot (This Week)
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-black/25 border border-white/[0.04]">
              <span className="text-xl font-mono font-bold text-white block">
                {productivitySnapshot.focusHours}
              </span>
              <span className="text-[10px] font-mono text-slate-400 uppercase">Focus Time</span>
            </div>

            <div className="p-3 rounded-xl bg-black/25 border border-white/[0.04]">
              <span className="text-xl font-mono font-bold text-cyan-300 block">
                {productivitySnapshot.tasksCompleted}
              </span>
              <span className="text-[10px] font-mono text-slate-400 uppercase">Tasks Done</span>
            </div>

            <div className="p-3 rounded-xl bg-black/25 border border-white/[0.04]">
              <span className="text-xl font-mono font-bold text-emerald-300 block">
                {productivitySnapshot.labsCompleted}
              </span>
              <span className="text-[10px] font-mono text-slate-400 uppercase">Labs Completed</span>
            </div>

            <div className="p-3 rounded-xl bg-black/25 border border-white/[0.04]">
              <span className="text-xl font-mono font-bold text-purple-300 block">
                {productivitySnapshot.notesCreated}
              </span>
              <span className="text-[10px] font-mono text-slate-400 uppercase">Notes &amp; Ideas</span>
            </div>
          </div>
        </div>

        {/* Recent Activity List with Filters */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-300">
                Recent Activity
              </span>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
              {["all", "projects", "learning", "notes", "tasks"].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActivityFilter(f)}
                  className={`px-2.5 py-0.5 rounded-lg text-[10px] font-mono uppercase tracking-wider transition cursor-pointer ${
                    activityFilter === f
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Activity items */}
          <div className="space-y-2 pt-1">
            {filteredActivity.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-slate-500">
                No activity recorded in this category.
              </div>
            ) : (
              filteredActivity.map((act) => {
                const Icon = TYPE_ICONS[act.type] || Activity;
                return (
                  <div
                    key={act.id}
                    className="flex items-start gap-2.5 p-2 rounded-xl bg-black/20 border border-white/[0.04] hover:bg-white/[0.03] transition"
                  >
                    <div className="p-1 rounded-lg bg-white/[0.05] text-slate-400 mt-0.5 shrink-0">
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-slate-200 block truncate">
                        {act.title}
                      </span>
                      {act.description && (
                        <span className="text-[10px] text-slate-400 block line-clamp-1">
                          {act.description}
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] font-mono text-slate-500 shrink-0 mt-0.5">
                      {new Date(act.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right Col: AI Recommendations */}
      <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] space-y-3 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-300">
              ✦ Recommended for You
            </span>
          </div>

          <div className="space-y-2.5">
            {recommendations.map((rec, i) => (
              <div
                key={rec.id}
                className="p-3 rounded-xl border border-white/[0.06] bg-black/20 hover:bg-white/[0.03] transition space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono font-bold text-cyan-400">{i + 1}.</span>
                    <span className="text-xs font-medium text-white">{rec.title}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedReasonId(expandedReasonId === rec.id ? null : rec.id)}
                    className="text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                    title="Why am I seeing this?"
                  >
                    <HelpCircle className="w-3 h-3 text-cyan-400" />
                  </button>
                </div>

                <p className="text-[11px] font-sans text-slate-400 leading-relaxed">
                  {rec.reason}
                </p>

                {rec.actionLabel && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => onExecuteRecommendation && onExecuteRecommendation(rec.id)}
                      className="flex items-center gap-1 text-[10px] font-mono font-bold text-cyan-300 hover:text-cyan-200 transition cursor-pointer"
                    >
                      <span>{rec.actionLabel}</span>
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 text-[10px] font-mono text-cyan-300 text-center">
          Proactive suggestions adapt automatically to your focus signals
        </div>
      </div>
    </div>
  );
}
