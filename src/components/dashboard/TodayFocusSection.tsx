import React, { useState, useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Play,
  Trash2,
  Tag,
  Plus,
  Search,
  Filter,
  Flame,
  Check,
  Edit2,
  X,
} from "lucide-react";
import { TaskItem } from "../../../proactive/types";

interface TodayFocusSectionProps {
  tasks: TaskItem[];
  onToggleTask: (id: string, completed: boolean) => void;
  onDeleteTask: (id: string) => void;
  onStartFocusTask: (task: TaskItem) => void;
  onAddTask: () => void;
  onUpdatePriority?: (id: string, newPriority: "low" | "medium" | "high" | "critical") => void;
  onEditTask?: (id: string, newTitle: string, newPriority?: "low" | "medium" | "high" | "critical") => void;
  standalone?: boolean;
}

const PRIORITY_BADGES: Record<string, { label: string; style: string; next: "low" | "medium" | "high" | "critical" }> = {
  critical: { label: "CRITICAL", style: "bg-rose-500/20 text-rose-300 border-rose-500/30", next: "low" },
  high: { label: "HIGH", style: "bg-amber-500/20 text-amber-300 border-amber-500/30", next: "critical" },
  medium: { label: "MED", style: "bg-blue-500/20 text-blue-300 border-blue-500/30", next: "high" },
  low: { label: "LOW", style: "bg-slate-500/20 text-slate-300 border-slate-500/30", next: "medium" },
};

export function TodayFocusSection({
  tasks,
  onToggleTask,
  onDeleteTask,
  onStartFocusTask,
  onAddTask,
  onUpdatePriority,
  onEditTask,
  standalone = false,
}: TodayFocusSectionProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showCompleted, setShowCompleted] = useState<boolean>(true);

  // Inline editing state: taskId -> newTitle
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState<string>("");

  // Extract distinct categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    tasks.forEach((t) => {
      if (t.category) cats.add(t.category);
    });
    return Array.from(cats);
  }, [tasks]);

  // Filter tasks based on search, category, and status
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (!showCompleted && t.status === "completed") return false;
      if (selectedCategory !== "all" && t.category?.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchCat = t.category?.toLowerCase().includes(q);
        if (!matchTitle && !matchCat) return false;
      }
      return true;
    });
  }, [tasks, searchQuery, selectedCategory, showCompleted]);

  const activeCount = tasks.filter((t) => t.status !== "completed").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  const startEditing = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setEditTitleInput(task.title);
  };

  const saveEditing = (taskId: string) => {
    if (editTitleInput.trim() && onEditTask) {
      onEditTask(taskId, editTitleInput.trim());
    }
    setEditingTaskId(null);
  };

  const handlePriorityClick = (task: TaskItem) => {
    if (!onUpdatePriority) return;
    const currentCfg = PRIORITY_BADGES[task.priority] || PRIORITY_BADGES.medium;
    onUpdatePriority(task.id, currentCfg.next);
  };

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400">
            Today&apos;s Focus &amp; Action Queue
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {activeCount} active
          </span>
          {completedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {completedCount} completed
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onAddTask}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-300 text-xs font-mono font-semibold transition cursor-pointer shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Priority</span>
        </button>
      </div>

      {/* Standalone Filter / Search Toolbar */}
      {standalone && (
        <div className="flex items-center justify-between gap-3 flex-wrap p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tasks by name or tag..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950/80 border border-white/10 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
            />
          </div>

          {/* Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono transition cursor-pointer ${
                selectedCategory === "all"
                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                  : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              All ({tasks.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono transition cursor-pointer ${
                  selectedCategory.toLowerCase() === cat.toLowerCase()
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                    : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400/60 mb-2" />
          <p className="text-xs font-mono text-slate-400">
            {searchQuery ? "No tasks matching your filter." : "All priorities cleared for today."}
          </p>
          <button
            type="button"
            onClick={onAddTask}
            className="mt-3 px-3.5 py-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-xs font-mono text-cyan-300 hover:bg-cyan-500/20 transition cursor-pointer"
          >
            + Add a priority
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task, idx) => {
            const isCompleted = task.status === "completed";
            const priorityCfg = PRIORITY_BADGES[task.priority] || PRIORITY_BADGES.medium;
            const indexStr = String(idx + 1).padStart(2, "0");
            const isEditing = editingTaskId === task.id;

            return (
              <div
                key={task.id}
                className={`group relative flex items-center justify-between gap-3 p-3.5 rounded-2xl border transition-all ${
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
                    className="text-slate-500 hover:text-cyan-400 transition-colors shrink-0 cursor-pointer p-0.5"
                    title={isCompleted ? "Mark incomplete" : "Mark completed"}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>

                  {/* Title & Metadata */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2 py-0.5">
                        <input
                          type="text"
                          value={editTitleInput}
                          onChange={(e) => setEditTitleInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditing(task.id);
                            if (e.key === "Escape") setEditingTaskId(null);
                          }}
                          autoFocus
                          className="flex-1 px-2.5 py-1 rounded-lg bg-black/60 border border-cyan-400 text-xs font-mono text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => saveEditing(task.id)}
                          className="p-1 rounded-lg bg-cyan-500 text-black hover:bg-cyan-400 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTaskId(null)}
                          className="p-1 rounded-lg bg-white/10 text-white hover:bg-white/20 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-sm font-sans font-medium leading-snug break-words ${
                            isCompleted ? "line-through text-slate-500" : "text-white/95"
                          }`}
                        >
                          {task.title}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-slate-400 flex-wrap">
                      {task.category && (
                        <span className="flex items-center gap-1 text-slate-400 bg-white/[0.03] px-1.5 py-0.2 rounded border border-white/[0.05]">
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

                      {/* Clickable Priority badge to cycle priority */}
                      <button
                        type="button"
                        onClick={() => handlePriorityClick(task)}
                        title="Click to cycle priority (Low -> Med -> High -> Critical)"
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold border transition cursor-pointer hover:scale-105 active:scale-95 ${priorityCfg.style}`}
                      >
                        {priorityCfg.label} ⟳
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right: Quick Action Controls */}
                <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEditing(task)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-cyan-300 hover:bg-white/10 transition cursor-pointer"
                      title="Edit task title"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {!isCompleted && (
                    <button
                      type="button"
                      onClick={() => onStartFocusTask(task)}
                      className="p-1.5 rounded-xl text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/15 transition cursor-pointer"
                      title="Focus on this task with Bella"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDeleteTask(task.id)}
                    className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
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
