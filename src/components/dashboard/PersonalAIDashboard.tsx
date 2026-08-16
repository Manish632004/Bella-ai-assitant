import React, { useState, useEffect } from "react";
import {
  Sparkles,
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  BookOpen,
  Shield,
  Activity,
  Settings as SettingsIcon,
  X,
  Plus,
  Command,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  Brain,
  Volume2,
  Mic,
  Power,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DashboardSummary, TaskItem, ProjectItem, ActivityItem } from "../../../proactive/types";
import { DashboardTab, DashboardPreferences, DEFAULT_DASHBOARD_PREFERENCES } from "./types";
import { DashboardHeader } from "./DashboardHeader";
import { AIBriefingCard } from "./AIBriefingCard";
import { TodayFocusSection } from "./TodayFocusSection";
import { QuickCaptureBar } from "./QuickCaptureBar";
import { ActiveProjectsSection } from "./ActiveProjectsSection";
import { CybersecurityLearningSection } from "./CybersecurityLearningSection";
import { ProductivityActivitySection } from "./ProductivityActivitySection";
import { CommandPalette } from "./CommandPalette";

interface PersonalAIDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  onStartVoiceSession?: () => void;
  voiceState?: string;
  themeColor: string;
}

export function PersonalAIDashboard({
  isOpen,
  onClose,
  onStartVoiceSession,
  voiceState = "disconnected",
  themeColor,
}: PersonalAIDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<DashboardPreferences>(DEFAULT_DASHBOARD_PREFERENCES);
  const [showPreferencesModal, setShowPreferencesModal] = useState<boolean>(false);

  // New Task Modal state
  const [showNewTaskModal, setShowNewTaskModal] = useState<boolean>(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("Inbox");
  const [newTaskPriority, setNewTaskPriority] = useState<"low" | "medium" | "high" | "critical">("high");
  const [newTaskMinutes, setNewTaskMinutes] = useState(45);

  // Fetch summary payload
  const fetchSummary = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard/summary");
      const data = await res.json();
      if (data && data.greeting) {
        setSummary(data);
      }
    } catch (err) {
      console.error("[Dashboard] Fetch summary error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchSummary();
    }
  }, [isOpen]);

  // Global Hotkey for Command Palette (`Ctrl+K` or `Cmd+K`) & `Escape`
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Quick Action Handler
  const handleQuickAction = (action: "task" | "note" | "focus" | "memory" | "project") => {
    if (action === "task") {
      setShowNewTaskModal(true);
    } else if (action === "focus") {
      handleStartFocus();
    } else if (action === "note" || action === "memory") {
      setShowCommandPalette(true);
    }
  };

  // Quick Capture Handler
  const handleQuickCapture = async (text: string, type?: any) => {
    try {
      const res = await fetch("/api/quick-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, type }),
      });
      const data = await res.json();
      if (data.item) {
        await fetchSummary();
      }
    } catch (err) {
      console.error("[Dashboard] Quick capture failed:", err);
    }
  };

  // Task Handlers
  const handleToggleTask = async (id: string, completed: boolean) => {
    try {
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: completed ? "completed" : "pending" }),
      });
      await fetchSummary();
    } catch (err) {
      console.error("[Dashboard] Toggle task error:", err);
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      await fetchSummary();
    } catch (err) {
      console.error("[Dashboard] Delete task error:", err);
    }
  };

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          category: newTaskCategory,
          priority: newTaskPriority,
          estimatedMinutes: newTaskMinutes,
        }),
      });
      setNewTaskTitle("");
      setShowNewTaskModal(false);
      await fetchSummary();
    } catch (err) {
      console.error("[Dashboard] Create task error:", err);
    }
  };

  // Learning Review Handler
  const handleStartReview = async (topic: string) => {
    try {
      await fetch("/api/learning/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      await fetchSummary();
    } catch (err) {
      console.error("[Dashboard] Record review error:", err);
    }
  };

  // Start Focus Trigger
  const handleStartFocus = () => {
    if (onStartVoiceSession && voiceState === "disconnected") {
      onStartVoiceSession();
    }
  };

  // Command Palette Action Executor
  const handleExecuteCommand = (actionType: string, payload?: any) => {
    if (actionType === "start_focus") {
      handleStartFocus();
    } else if (actionType === "new_task") {
      setShowNewTaskModal(true);
    } else if (actionType === "start_review" && payload?.topic) {
      void handleStartReview(payload.topic);
    } else if (actionType === "activate_voice" && onStartVoiceSession) {
      onStartVoiceSession();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden font-sans">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-2xl"
        />

        {/* Master Dashboard Workspace Window */}
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 15 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="relative z-10 w-full h-full max-w-[1550px] max-h-[94vh] m-2 sm:m-4 rounded-3xl bg-slate-950/95 border border-white/10 shadow-[0_20px_70px_rgba(0,0,0,0.8)] backdrop-blur-3xl flex overflow-hidden text-slate-100"
        >
          {/* ───────────────── LEFT SIDEBAR NAVIGATION ───────────────── */}
          <aside className="w-56 shrink-0 border-r border-white/[0.06] bg-slate-950/60 p-4 flex flex-col justify-between hidden md:flex">
            {/* Top Brand & Workspace Select */}
            <div className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                  <span className="text-xs font-semibold tracking-[0.3em] font-mono uppercase text-white/90">
                    BELLA OS
                  </span>
                </div>
              </div>

              {/* Navigation Menu Links */}
              <nav className="space-y-1">
                {[
                  { id: "overview", label: "Overview", icon: LayoutDashboard },
                  { id: "tasks", label: "Today's Focus", icon: CheckSquare },
                  { id: "projects", label: "Active Projects", icon: FolderKanban },
                  { id: "cybersecurity", label: "Cybersecurity Hub", icon: Shield },
                  { id: "activity", label: "Activity Stream", icon: Activity },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as DashboardTab)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-mono transition text-left cursor-pointer ${
                        isActive
                          ? "bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/25 shadow-sm"
                          : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Bottom Quick Status & Customizer */}
            <div className="space-y-2 pt-4 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setShowPreferencesModal(!showPreferencesModal)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-white hover:bg-white/[0.04] transition cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Customize View</span>
              </button>

              <div className="p-3 rounded-xl bg-black/30 border border-white/[0.04] text-[10px] font-mono text-slate-400">
                <div className="flex items-center justify-between mb-1">
                  <span>Proactivity</span>
                  <span className="text-cyan-300 font-bold">MEDIUM</span>
                </div>
                <div className="text-[9px] text-slate-500 leading-tight">
                  Spaced revision &amp; task reminders active
                </div>
              </div>
            </div>
          </aside>

          {/* ───────────────── CENTER MAIN WORKSPACE ───────────────── */}
          <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Top Bar (Close button & Companion panel toggle) */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.06] shrink-0 bg-slate-950/40">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  Command Center
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-xs font-mono text-slate-400 capitalize">{activeTab}</span>
              </div>

              <div className="flex items-center gap-2">
                {/* Companion Side Panel Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    setPreferences((p) => ({ ...p, showCharacterPanel: !p.showCharacterPanel }))
                  }
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  title={preferences.showCharacterPanel ? "Collapse AI Companion Panel" : "Show AI Companion Panel"}
                >
                  {preferences.showCharacterPanel ? (
                    <PanelRightClose className="w-4 h-4" />
                  ) : (
                    <PanelRightOpen className="w-4 h-4" />
                  )}
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  title="Close Dashboard"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Dashboard Workspace Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loading && !summary ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : summary ? (
                <>
                  {/* 1. Header with Personalized Greeting */}
                  <DashboardHeader
                    greeting={summary.greeting}
                    onOpenCommandPalette={() => setShowCommandPalette(true)}
                    onQuickAction={handleQuickAction}
                  />

                  {/* 2. Quick Capture Input Bar */}
                  <QuickCaptureBar onCapture={handleQuickCapture} />

                  {/* 3. AI Daily Focus Briefing Card */}
                  {preferences.showBriefing && (
                    <AIBriefingCard
                      briefing={summary.aiBriefing}
                      onStartFocus={handleStartFocus}
                    />
                  )}

                  {/* 4. Today's Focus Section */}
                  {preferences.showFocus && (
                    <TodayFocusSection
                      tasks={summary.todayFocus}
                      onToggleTask={handleToggleTask}
                      onDeleteTask={handleDeleteTask}
                      onStartFocusTask={handleStartFocus}
                      onAddTask={() => setShowNewTaskModal(true)}
                    />
                  )}

                  {/* 5. Active Projects Section */}
                  {preferences.showProjects && (
                    <ActiveProjectsSection
                      projects={summary.activeProjects}
                      onAddProject={() => setShowNewTaskModal(true)}
                    />
                  )}

                  {/* 6. Cybersecurity Learning & Spaced Revision Section */}
                  {preferences.showCybersecurity && (
                    <CybersecurityLearningSection
                      learningSummary={summary.learningSummary}
                      revisionQueue={summary.revisionQueue}
                      onStartReview={handleStartReview}
                    />
                  )}

                  {/* 7. Productivity Snapshot & Filterable Activity */}
                  {preferences.showActivity && (
                    <ProductivityActivitySection
                      productivitySnapshot={summary.productivitySnapshot}
                      recentActivity={summary.recentActivity}
                      recommendations={summary.recommendations}
                      onExecuteRecommendation={(recId) => {
                        if (recId === "rec-1") handleStartReview("SQL Injection");
                        else if (recId === "rec-2") handleStartFocus();
                        else if (recId === "rec-3") handleStartReview("Access Control");
                      }}
                    />
                  )}
                </>
              ) : null}
            </div>
          </main>

          {/* ───────────────── RIGHT AI COMPANION PANEL (COLLAPSIBLE) ───────────────── */}
          <AnimatePresence>
            {preferences.showCharacterPanel && (
              <motion.aside
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 310, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0 border-l border-white/[0.06] bg-slate-950/70 p-5 flex flex-col justify-between hidden xl:flex overflow-hidden"
              >
                {/* Companion Identity Header */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                        Bella AI Companion
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase ${
                        voiceState === "listening"
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 animate-pulse"
                          : voiceState === "speaking"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-white/[0.06] text-slate-400"
                      }`}
                    >
                      {voiceState === "listening" ? "Listening" : voiceState === "speaking" ? "Speaking" : "Resting"}
                    </span>
                  </div>

                  {/* Character Companion Status Display Card */}
                  <div className="relative aspect-square w-full rounded-2xl bg-gradient-to-br from-indigo-950/30 via-slate-900/60 to-slate-950/80 border border-white/[0.08] p-4 flex flex-col items-center justify-center text-center shadow-inner">
                    <div className="w-16 h-16 rounded-full bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.25)] mb-3">
                      <Brain className="w-8 h-8 text-cyan-300" />
                    </div>

                    <h4 className="text-xs font-mono font-semibold text-white mb-1">
                      Context Synchronized
                    </h4>
                    <p className="text-[11px] font-sans text-slate-400 leading-snug px-2">
                      &ldquo;Ready to help you tackle your Web Security revision and AI assistant tasks!&rdquo;
                    </p>
                  </div>

                  {/* Quick Voice Talk Button */}
                  <button
                    type="button"
                    onClick={onStartVoiceSession}
                    className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 font-mono font-semibold text-xs transition cursor-pointer ${
                      voiceState === "disconnected"
                        ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
                        : "bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30"
                    }`}
                  >
                    {voiceState === "disconnected" ? (
                      <>
                        <Mic className="w-3.5 h-3.5" />
                        <span>Start Voice Session</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Voice Active</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Companion Mood & Active Goal Preview */}
                <div className="space-y-2 pt-4 border-t border-white/[0.06] text-[10px] font-mono text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>Active Companion Mood</span>
                    <span className="text-cyan-300 font-bold uppercase">Focused &amp; Cozy</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Focus Goal</span>
                    <span className="text-white truncate max-w-[140px]">AI Assistant Project</span>
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Global Command Palette Modal */}
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onSelectAction={handleExecuteCommand}
        />

        {/* New Task Modal */}
        <AnimatePresence>
          {showNewTaskModal && (
            <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowNewTaskModal(false)}
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              />

              <motion.form
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onSubmit={handleCreateTaskSubmit}
                className="relative z-10 w-full max-w-md p-5 rounded-2xl bg-slate-900 border border-white/10 shadow-2xl space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold font-mono uppercase text-white">Create New Task</h3>
                  <button
                    type="button"
                    onClick={() => setShowNewTaskModal(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase">Task Title</label>
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="e.g. Complete PortSwigger SQL Injection lab"
                    required
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase">Category / Project</label>
                    <input
                      type="text"
                      value={newTaskCategory}
                      onChange={(e) => setNewTaskCategory(e.target.value)}
                      placeholder="e.g. Cybersecurity"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase">Priority</label>
                    <select
                      value={newTaskPriority}
                      onChange={(e) => setNewTaskPriority(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                    >
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNewTaskModal(false)}
                    className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs font-mono text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-semibold"
                  >
                    Create Task
                  </button>
                </div>
              </motion.form>
            </div>
          )}
        </AnimatePresence>
      </div>
    </AnimatePresence>
  );
}
