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
  RefreshCw,
  Search,
  Check,
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
import { NewProjectModal } from "./NewProjectModal";
import { RevisionModal } from "./RevisionModal";

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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Task Modal state
  const [showNewTaskModal, setShowNewTaskModal] = useState<boolean>(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("Inbox");
  const [newTaskPriority, setNewTaskPriority] = useState<"low" | "medium" | "high" | "critical">("high");
  const [newTaskMinutes, setNewTaskMinutes] = useState(45);

  // New Project Modal state
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);

  // Interactive Revision Modal state
  const [activeRevisionTopic, setActiveRevisionTopic] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Fetch summary payload
  const fetchSummary = async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      const res = await fetch("/api/dashboard/summary");
      if (!res.ok) throw new Error("Dashboard summary API failed");
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
      void fetchSummary(true);
    }

    const handleSync = () => {
      console.log("[PersonalAIDashboard] Live dashboard sync triggered");
      void fetchSummary(false);
    };
    window.addEventListener("bella:dashboard_sync", handleSync);
    return () => window.removeEventListener("bella:dashboard_sync", handleSync);
  }, [isOpen]);

  // Global Hotkey for Command Palette (`Ctrl+K` or `Cmd+K`) & `Escape`
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
      if (e.key === "Escape" && isOpen && !showCommandPalette && !showNewTaskModal && !showNewProjectModal && !activeRevisionTopic) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showCommandPalette, showNewTaskModal, showNewProjectModal, activeRevisionTopic, onClose]);

  // Quick Action Handler
  const handleQuickAction = (action: "task" | "note" | "focus" | "memory" | "project") => {
    if (action === "task") {
      setShowNewTaskModal(true);
    } else if (action === "project") {
      setShowNewProjectModal(true);
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
        showToast(data.message || "Captured successfully!");
        await fetchSummary();
      }
    } catch (err) {
      console.error("[Dashboard] Quick capture failed:", err);
    }
  };

  // Task Handlers
  const handleToggleTask = async (id: string, completed: boolean) => {
    try {
      // Optimistic update
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          todayFocus: prev.todayFocus.map((t) =>
            t.id === id ? { ...t, status: completed ? "completed" : "pending" } : t
          ),
        };
      });

      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: completed ? "completed" : "pending" }),
      });
      await fetchSummary();
      showToast(completed ? "Task marked complete! 🎉" : "Task restored to pending.");
    } catch (err) {
      console.error("[Dashboard] Toggle task error:", err);
      await fetchSummary();
    }
  };

  const handleUpdateTaskPriority = async (id: string, newPriority: "low" | "medium" | "high" | "critical") => {
    try {
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          todayFocus: prev.todayFocus.map((t) =>
            t.id === id ? { ...t, priority: newPriority } : t
          ),
        };
      });

      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
      await fetchSummary();
      showToast(`Priority updated to ${newPriority.toUpperCase()}`);
    } catch (err) {
      console.error("[Dashboard] Update priority error:", err);
      await fetchSummary();
    }
  };

  const handleEditTask = async (id: string, newTitle: string, newPriority?: "low" | "medium" | "high" | "critical") => {
    try {
      const patch: any = { title: newTitle };
      if (newPriority) patch.priority = newPriority;

      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          todayFocus: prev.todayFocus.map((t) =>
            t.id === id ? { ...t, ...patch } : t
          ),
        };
      });

      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await fetchSummary();
      showToast("Task updated!");
    } catch (err) {
      console.error("[Dashboard] Edit task error:", err);
      await fetchSummary();
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          todayFocus: prev.todayFocus.filter((t) => t.id !== id),
        };
      });

      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      await fetchSummary();
      showToast("Task removed.");
    } catch (err) {
      console.error("[Dashboard] Delete task error:", err);
      await fetchSummary();
    }
  };

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          category: newTaskCategory,
          priority: newTaskPriority,
          estimatedMinutes: newTaskMinutes,
        }),
      });
      if (res.ok) {
        setNewTaskTitle("");
        setShowNewTaskModal(false);
        await fetchSummary();
        showToast("New task created!");
      }
    } catch (err) {
      console.error("[Dashboard] Create task error:", err);
    }
  };

  // Project Handlers
  const handleCreateProject = async (projectData: any) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
      if (res.ok) {
        await fetchSummary();
        showToast(`Project "${projectData.name}" created!`);
      }
    } catch (err) {
      console.error("[Dashboard] Create project error:", err);
    }
  };

  const handleUpdateProjectProgress = async (id: string, newProgress: number) => {
    try {
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activeProjects: prev.activeProjects.map((p) =>
            p.id === id ? { ...p, progressPercent: newProgress } : p
          ),
        };
      });

      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progressPercent: newProgress }),
      });
      await fetchSummary();
    } catch (err) {
      console.error("[Dashboard] Update project progress error:", err);
      await fetchSummary();
    }
  };

  const handleUpdateProjectStatus = async (id: string, newStatus: any) => {
    try {
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activeProjects: prev.activeProjects.map((p) =>
            p.id === id ? { ...p, status: newStatus } : p
          ),
        };
      });

      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchSummary();
      showToast(`Project status: ${newStatus}`);
    } catch (err) {
      console.error("[Dashboard] Update project status error:", err);
      await fetchSummary();
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activeProjects: prev.activeProjects.filter((p) => p.id !== id),
        };
      });

      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      await fetchSummary();
      showToast("Project deleted.");
    } catch (err) {
      console.error("[Dashboard] Delete project error:", err);
      await fetchSummary();
    }
  };

  // Learning Review & Spaced Repetition Handlers
  const handleOpenReviewModal = (topic: string) => {
    setActiveRevisionTopic(topic);
  };

  const handleRecordRetentionScore = async (topic: string, retentionChange: number) => {
    try {
      await fetch("/api/learning/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, retentionChange }),
      });
      await fetchSummary();
      showToast(`Revision logged for ${topic}!`);
    } catch (err) {
      console.error("[Dashboard] Record review error:", err);
    }
  };

  // Start Focus Trigger
  const handleStartFocus = () => {
    if (onStartVoiceSession && voiceState === "disconnected") {
      onStartVoiceSession();
      showToast("Bella voice session initiated!");
    }
  };

  // Command Palette Action Executor
  const handleExecuteCommand = (actionType: string, payload?: any) => {
    if (actionType === "start_focus") {
      handleStartFocus();
    } else if (actionType === "new_task") {
      setShowNewTaskModal(true);
    } else if (actionType === "new_project") {
      setShowNewProjectModal(true);
    } else if (actionType === "start_review" && payload?.topic) {
      handleOpenReviewModal(payload.topic);
    } else if (actionType === "activate_voice" && onStartVoiceSession) {
      onStartVoiceSession();
    }
  };

  if (!isOpen) return null;

  const navTabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "tasks", label: "Today's Focus", icon: CheckSquare },
    { id: "projects", label: "Active Projects", icon: FolderKanban },
    { id: "cybersecurity", label: "Cybersecurity Hub", icon: Shield },
    { id: "activity", label: "Activity Stream", icon: Activity },
  ];

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
          className="relative z-10 w-full h-full max-w-[1580px] max-h-[94vh] m-2 sm:m-4 rounded-3xl bg-slate-950/95 border border-white/10 shadow-[0_20px_70px_rgba(0,0,0,0.8)] backdrop-blur-3xl flex overflow-hidden text-slate-100"
        >
          {/* ───────────────── LEFT SIDEBAR NAVIGATION ───────────────── */}
          <aside className="w-60 shrink-0 border-r border-white/[0.06] bg-slate-950/70 p-5 flex flex-col justify-between hidden md:flex">
            {/* Top Brand & Workspace Select */}
            <div className="space-y-6">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]" />
                  <span className="text-xs font-semibold tracking-[0.3em] font-mono uppercase text-white">
                    BELLA OS
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchSummary(true)}
                  className="p-1 rounded-lg text-slate-500 hover:text-cyan-300 transition"
                  title="Refresh Dashboard"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
                </button>
              </div>

              {/* Navigation Menu Links */}
              <nav className="space-y-1.5">
                {navTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as DashboardTab)}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-mono transition text-left cursor-pointer ${
                        isActive
                          ? "bg-cyan-500/20 text-cyan-200 font-semibold border border-cyan-400/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                          : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Bottom Quick Status */}
            <div className="space-y-2 pt-4 border-t border-white/[0.06]">
              <div className="p-3.5 rounded-2xl bg-black/40 border border-white/[0.04] text-[10px] font-mono text-slate-400">
                <div className="flex items-center justify-between mb-1">
                  <span>AI Companion Mode</span>
                  <span className="text-cyan-300 font-bold uppercase">Active</span>
                </div>
                <div className="text-[9px] text-slate-500 leading-tight">
                  Continuous context analysis &amp; proactive memory synchronization
                </div>
              </div>
            </div>
          </aside>

          {/* ───────────────── CENTER MAIN WORKSPACE ───────────────── */}
          <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950/30">
            {/* Top Bar (Breadcrumb, mobile tabs, companion toggle, and close) */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.06] shrink-0 bg-slate-950/60 backdrop-blur-md">
              {/* Breadcrumb + Mobile tab switcher */}
              <div className="flex items-center gap-3 overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                    Command Center
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-xs font-mono text-cyan-400 font-semibold capitalize">{activeTab}</span>
                </div>

                {/* Mobile / Compact Tab Pills */}
                <div className="flex items-center gap-1 md:hidden">
                  {navTabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id as DashboardTab)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono transition ${
                        activeTab === t.id
                          ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                          : "text-slate-400 bg-white/5"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Command Palette Trigger */}
                <button
                  type="button"
                  onClick={() => setShowCommandPalette(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-mono transition cursor-pointer"
                  title="Open Command Palette (Ctrl+K)"
                >
                  <Command className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline text-[11px]">Command Palette</span>
                  <kbd className="hidden sm:inline px-1 py-0.2 rounded bg-black/40 text-[9px] font-mono text-slate-400">
                    Ctrl+K
                  </kbd>
                </button>

                {/* Companion Side Panel Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    setPreferences((p) => ({ ...p, showCharacterPanel: !p.showCharacterPanel }))
                  }
                  className="p-2 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer hidden xl:flex"
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
                  className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition cursor-pointer"
                  title="Close Dashboard (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Toast feedback bar */}
            <AnimatePresence>
              {toastMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-cyan-500/20 border-b border-cyan-500/30 px-6 py-2 flex items-center justify-between text-xs font-mono text-cyan-200"
                >
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{toastMessage}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scrollable Dashboard Workspace Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loading && !summary ? (
                <div className="h-64 flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-mono text-slate-400">Synchronizing Personal Command Center...</span>
                </div>
              ) : summary ? (
                <>
                  {/* ───────────────── 1. OVERVIEW TAB ───────────────── */}
                  {activeTab === "overview" && (
                    <div className="space-y-6">
                      {/* Header with Personalized Greeting */}
                      <DashboardHeader
                        greeting={summary.greeting}
                        onOpenCommandPalette={() => setShowCommandPalette(true)}
                        onQuickAction={handleQuickAction}
                      />

                      {/* Quick Capture Input Bar */}
                      <QuickCaptureBar onCapture={handleQuickCapture} />

                      {/* AI Daily Focus Briefing Card */}
                      {preferences.showBriefing && (
                        <AIBriefingCard
                          briefing={summary.aiBriefing}
                          onStartFocus={handleStartFocus}
                        />
                      )}

                      {/* Today's Focus Section */}
                      {preferences.showFocus && (
                        <TodayFocusSection
                          tasks={summary.todayFocus}
                          onToggleTask={handleToggleTask}
                          onDeleteTask={handleDeleteTask}
                          onStartFocusTask={handleStartFocus}
                          onAddTask={() => setShowNewTaskModal(true)}
                          onUpdatePriority={handleUpdateTaskPriority}
                          onEditTask={handleEditTask}
                        />
                      )}

                      {/* Active Projects Section */}
                      {preferences.showProjects && (
                        <ActiveProjectsSection
                          projects={summary.activeProjects}
                          onAddProject={() => setShowNewProjectModal(true)}
                          onUpdateProgress={handleUpdateProjectProgress}
                          onUpdateStatus={handleUpdateProjectStatus}
                          onDeleteProject={handleDeleteProject}
                        />
                      )}

                      {/* Cybersecurity Learning & Spaced Revision Section */}
                      {preferences.showCybersecurity && (
                        <CybersecurityLearningSection
                          learningSummary={summary.learningSummary}
                          revisionQueue={summary.revisionQueue}
                          onStartReview={handleOpenReviewModal}
                        />
                      )}

                      {/* Productivity Snapshot & Activity */}
                      {preferences.showActivity && (
                        <ProductivityActivitySection
                          productivitySnapshot={summary.productivitySnapshot}
                          recentActivity={summary.recentActivity}
                          recommendations={summary.recommendations}
                          onExecuteRecommendation={(recId) => {
                            if (recId === "rec-1") handleOpenReviewModal("SQL Injection");
                            else if (recId === "rec-2") handleStartFocus();
                            else if (recId === "rec-3") handleOpenReviewModal("Access Control");
                          }}
                        />
                      )}
                    </div>
                  )}

                  {/* ───────────────── 2. TODAY'S FOCUS TAB (DEDICATED) ───────────────── */}
                  {activeTab === "tasks" && (
                    <div className="space-y-6">
                      <QuickCaptureBar onCapture={handleQuickCapture} />
                      <TodayFocusSection
                        tasks={summary.todayFocus}
                        onToggleTask={handleToggleTask}
                        onDeleteTask={handleDeleteTask}
                        onStartFocusTask={handleStartFocus}
                        onAddTask={() => setShowNewTaskModal(true)}
                        onUpdatePriority={handleUpdateTaskPriority}
                        onEditTask={handleEditTask}
                        standalone={true}
                      />
                    </div>
                  )}

                  {/* ───────────────── 3. ACTIVE PROJECTS TAB (DEDICATED) ───────────────── */}
                  {activeTab === "projects" && (
                    <div className="space-y-6">
                      <ActiveProjectsSection
                        projects={summary.activeProjects}
                        onAddProject={() => setShowNewProjectModal(true)}
                        onUpdateProgress={handleUpdateProjectProgress}
                        onUpdateStatus={handleUpdateProjectStatus}
                        onDeleteProject={handleDeleteProject}
                        standalone={true}
                      />
                    </div>
                  )}

                  {/* ───────────────── 4. CYBERSECURITY HUB TAB (DEDICATED) ───────────────── */}
                  {activeTab === "cybersecurity" && (
                    <div className="space-y-6">
                      <CybersecurityLearningSection
                        learningSummary={summary.learningSummary}
                        revisionQueue={summary.revisionQueue}
                        onStartReview={handleOpenReviewModal}
                      />
                    </div>
                  )}

                  {/* ───────────────── 5. ACTIVITY STREAM TAB (DEDICATED) ───────────────── */}
                  {activeTab === "activity" && (
                    <div className="space-y-6">
                      <ProductivityActivitySection
                        productivitySnapshot={summary.productivitySnapshot}
                        recentActivity={summary.recentActivity}
                        recommendations={summary.recommendations}
                        onExecuteRecommendation={(recId) => {
                          if (recId === "rec-1") handleOpenReviewModal("SQL Injection");
                          else if (recId === "rec-2") handleStartFocus();
                          else if (recId === "rec-3") handleOpenReviewModal("Access Control");
                        }}
                      />
                    </div>
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
                    className={`w-full py-2.5 px-4 rounded-2xl flex items-center justify-center gap-2 font-mono font-semibold text-xs transition cursor-pointer ${
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

        {/* Global Command Palette Modal (Ctrl+K) */}
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onSelectAction={handleExecuteCommand}
        />

        {/* New Task Modal */}
        <AnimatePresence>
          {showNewTaskModal && (
            <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowNewTaskModal(false)}
                className="absolute inset-0 bg-black/75 backdrop-blur-sm"
              />

              <motion.form
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onSubmit={handleCreateTaskSubmit}
                className="relative z-10 w-full max-w-md p-6 rounded-3xl bg-slate-900 border border-white/15 shadow-2xl space-y-4 text-white"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      <CheckSquare className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold font-mono uppercase text-white">Create New Task</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewTaskModal(false)}
                    className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-white"
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
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
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

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase">Estimated Time</label>
                  <div className="flex gap-2">
                    {[15, 30, 45, 60, 90].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setNewTaskMinutes(mins)}
                        className={`flex-1 py-1.5 rounded-xl border text-[10px] font-mono transition ${
                          newTaskMinutes === mins
                            ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                            : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setShowNewTaskModal(false)}
                    className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-xs font-mono text-slate-300 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold"
                  >
                    Create Task
                  </button>
                </div>
              </motion.form>
            </div>
          )}
        </AnimatePresence>

        {/* New Project Modal */}
        <NewProjectModal
          isOpen={showNewProjectModal}
          onClose={() => setShowNewProjectModal(false)}
          onCreateProject={handleCreateProject}
        />

        {/* Spaced Revision Card Modal */}
        {activeRevisionTopic && (
          <RevisionModal
            isOpen={!!activeRevisionTopic}
            topic={activeRevisionTopic}
            onClose={() => setActiveRevisionTopic(null)}
            onRecordRetention={handleRecordRetentionScore}
          />
        )}
      </div>
    </AnimatePresence>
  );
}
