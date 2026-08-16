import React, { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Play,
  MoreVertical,
  Trash2,
  Sparkles,
  Tag,
  AlertCircle,
  Plus,
} from "lucide-react";
import { TaskItem } from "../../../proactive/types";

interface TodayFocusSectionProps {
  tasks: TaskItem[];
  onToggleTask: (id: string, completed: boolean) => void;
  onDeleteTask: (id: string) => void;
  onStartFocusTask: (task: TaskItem) => void;
  onAddTask: () => void;
}

const PRIORITY_BADGES: Record<string, { label: string; style: string }> = {
  critical: { label: "CRITICAL", style: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
  high: { label: "HIGH", style: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  medium: { label: "MED", style: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  low: { label: "LOW", style: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
};

export function TodayFocusSection({
  tasks,
  onToggleTask,
  onDeleteTask,
  onStartFocusTask,
  onAddTask,
}: TodayFocusSectionProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400">
            Today&apos;s Focus
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] text-slate-300">
            {tasks.filter((t) => t.status !== "completed").length} active
          </span>
        </div>

        <button
          type="button"
          onClick={onAddTask}
          className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Task</span>
        </button>
      </div>

      {/* Task List */}
      {tasks.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400/60 mb-2" />
          <p className="text-xs font-mono text-slate-400">All priorities cleared for today.</p>
          <button
            type="button"
            onClick={onAddTask}
            className="mt-3 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer"
          >
            + Add a priority
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task, idx) => {
            const isCompleted = task.status === "completed";
            const priorityCfg = PRIORITY_BADGES[task.priority] || PRIORITY_BADGES.medium;
            const indexStr = String(idx + 1).padStart(2, "0");

            return (
              <div
                key={task.id}
                className={`group relative flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                  isCompleted
                    ? "border-white/[0.04] bg-white/[0.01] opacity-50"
                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.15]"
                }`}
              >
                {/* Left: Number + Checkbox + Title + Meta */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Priority Number */}
                  <span className="text-xs font-mono font-bold text-slate-500 group-hover:text-cyan-400 transition-colors shrink-0">
                    {indexStr}
                  </span>

                  {/* Completion Toggle */}
                  <button
                    type="button"
                    onClick={() => onToggleTask(task.id, !isCompleted)}
                    className="text-slate-500 hover:text-cyan-400 transition-colors shrink-0 cursor-pointer"
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>

                  {/* Title & Metadata */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-sm font-sans font-medium leading-snug break-words ${
                          isCompleted ? "line-through text-slate-500" : "text-white/95"
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-slate-400">
                      {task.category && (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Tag className="w-2.5 h-2.5" />
                          {task.category}
                        </span>
                      )}
                      {task.estimatedMinutes && (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-2.5 h-2.5" />
                          ~{task.estimatedMinutes} min
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${priorityCfg.style}`}
                      >
                        {priorityCfg.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Quick Action Controls */}
                <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  {!isCompleted && (
                    <button
                      type="button"
                      onClick={() => onStartFocusTask(task)}
                      className="p-1.5 rounded-lg text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition cursor-pointer"
                      title="Focus on this task"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDeleteTask(task.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                    title="Delete task"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
