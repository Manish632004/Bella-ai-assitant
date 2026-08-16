import React, { useEffect, useState } from "react";
import {
  Settings,
  X,
  Power,
  Mic,
  Cpu,
  Info,
  Check,
  AlertTriangle,
  Volume2,
  Sparkles,
  Brain,
  Plus,
  Trash2,
  User,
  Heart,
  Target,
  Briefcase,
  Users,
  Flame,
  Compass,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { BellaSettings } from "../lib/settingsStore";
import { Memory, MemoryCategory } from "../lib/memoryTypes";
import { ProactiveSettings, ProactiveLevel } from "../../proactive/types";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Current settings (owned by App so wake-word state stays in sync). */
  settings: BellaSettings;
  /** Persist a settings patch (also notifies App of changes). */
  onChange: (patch: Partial<BellaSettings>) => void;
  themeColor: string;
  /** Active recollections database */
  memories?: Memory[];
  /** Handler to add new recollection */
  onAddMemory?: (category: MemoryCategory, text: string) => Promise<void>;
  /** Handler to delete a recollection */
  onDeleteMemory?: (id: string) => Promise<void>;
  /** Proactive Intelligence settings */
  proactiveSettings?: ProactiveSettings;
  /** Handler to update proactive settings */
  onUpdateProactiveSettings?: (patch: Partial<ProactiveSettings>) => void;
  /** Handler to reset proactive feedback memory */
  onResetProactiveFeedback?: () => void;
}

type SettingsTab = "general" | "proactive" | "recalls" | "voice" | "system" | "about";

/** A single toggle row matching the existing switch style. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="pt-2.5 pb-1 border-t border-white/5 flex items-center justify-between text-left">
      <div className="flex flex-col pr-4">
        <span className="text-[11px] font-bold font-mono text-slate-200">{label}</span>
        <span className="text-[9px] text-slate-400 font-mono">
          {description}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none shrink-0 cursor-pointer ${
          checked ? "bg-cyan-500" : "bg-white/10"
        }`}
      >
        <div
          className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/** Proactive Intelligence Settings Tab */
function ProactiveSettingsSection({
  proactiveSettings,
  onUpdateProactiveSettings,
  onResetProactiveFeedback,
}: {
  proactiveSettings?: ProactiveSettings;
  onUpdateProactiveSettings?: (patch: Partial<ProactiveSettings>) => void;
  onResetProactiveFeedback?: () => void;
}) {
  const activePS: ProactiveSettings = {
    enabled: proactiveSettings?.enabled ?? true,
    level: proactiveSettings?.level ?? "MEDIUM",
    permissions: {
      tasks: proactiveSettings?.permissions?.tasks ?? true,
      projects: proactiveSettings?.permissions?.projects ?? true,
      learning: proactiveSettings?.permissions?.learning ?? true,
      calendar: proactiveSettings?.permissions?.calendar ?? true,
      coding: proactiveSettings?.permissions?.coding ?? true,
      cybersecurity: proactiveSettings?.permissions?.cybersecurity ?? true,
      files: proactiveSettings?.permissions?.files ?? false,
      browser: proactiveSettings?.permissions?.browser ?? false,
      screen: proactiveSettings?.permissions?.screen ?? false,
      mic: proactiveSettings?.permissions?.mic ?? false,
      camera: proactiveSettings?.permissions?.camera ?? false,
    },
    quietHours: {
      enabled: proactiveSettings?.quietHours?.enabled ?? true,
      start: proactiveSettings?.quietHours?.start ?? "23:00",
      end: proactiveSettings?.quietHours?.end ?? "08:00",
    },
    dailyBriefingEnabled: proactiveSettings?.dailyBriefingEnabled ?? true,
    dailyReviewEnabled: proactiveSettings?.dailyReviewEnabled ?? false,
    cooldownMinutes: proactiveSettings?.cooldownMinutes ?? 15,
    maxSuggestionsPerDay: proactiveSettings?.maxSuggestionsPerDay ?? 8,
  };

  const updateSettings = onUpdateProactiveSettings || (() => {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Proactive Intelligence Engine
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
            Context-aware anticipation &amp; timely assistance
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-[10px] font-mono font-bold uppercase tracking-wider">
          <Sparkles size={12} />
          <span>{activePS.enabled ? activePS.level : "OFF"}</span>
        </div>
      </div>

      {/* Master Toggle */}
      <ToggleRow
        label="PROACTIVE ASSISTANCE"
        description="Allow Bella to proactively notice tasks, deadlines, and learning opportunities"
        checked={activePS.enabled}
        onChange={(v) => updateSettings({ enabled: v })}
      />

      {activePS.enabled && (
        <>
          {/* Proactivity Level Selector */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-300">
              Proactivity Level
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(["OFF", "LOW", "MEDIUM", "HIGH"] as ProactiveLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => updateSettings({ level: lvl })}
                  className={`py-2 px-2 rounded-xl border text-[10px] font-mono font-semibold tracking-wider transition-all cursor-pointer ${
                    activePS.level === lvl
                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                      : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <p className="text-[9px] font-mono text-slate-400 leading-normal">
              {activePS.level === "OFF" && "No proactive behavior. Bella will only respond to direct commands."}
              {activePS.level === "LOW" && "High-priority only: urgent deadlines, critical blockers, and important reminders."}
              {activePS.level === "MEDIUM" && "Standard companion: tracks tasks, project check-ins, and spaced learning reviews."}
              {activePS.level === "HIGH" && "Full context: offers workflow recommendations, knowledge connections, and daily briefings."}
            </p>
          </div>

          {/* Category Permissions Matrix (Default-Deny Privacy) */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-300">
                Context Categories &amp; Privacy (Default Deny)
              </label>
              <span className="text-[8px] font-mono text-slate-500 uppercase">
                Privacy Boundaries
              </span>
            </div>

            <div className="space-y-1">
              <ToggleRow
                label="TASKS &amp; DEADLINES"
                description="Monitor pending tasks, approaching due dates, and priority blockers"
                checked={activePS.permissions.tasks}
                onChange={(v) => updateSettings({ permissions: { ...activePS.permissions, tasks: v } })}
              />
              <ToggleRow
                label="PROJECTS"
                description="Track project milestones and inactivity check-ins"
                checked={activePS.permissions.projects}
                onChange={(v) => updateSettings({ permissions: { ...activePS.permissions, projects: v } })}
              />
              <ToggleRow
                label="SPACED LEARNING"
                description="Proactively suggest topic revisions based on retention decay"
                checked={activePS.permissions.learning}
                onChange={(v) => updateSettings({ permissions: { ...activePS.permissions, learning: v } })}
              />
              <ToggleRow
                label="CYBERSECURITY ADVICE"
                description="Suggest next learning paths, lab prerequisites, and certifications"
                checked={activePS.permissions.cybersecurity}
                onChange={(v) => updateSettings({ permissions: { ...activePS.permissions, cybersecurity: v } })}
              />
              <ToggleRow
                label="CALENDAR &amp; PLANNING"
                description="Morning focus briefing and available work slot suggestions"
                checked={activePS.permissions.calendar}
                onChange={(v) => updateSettings({ permissions: { ...activePS.permissions, calendar: v } })}
              />
              <ToggleRow
                label="LOCAL FILES &amp; DOWNLOADS"
                description="Notice downloaded study materials (Off by default for privacy)"
                checked={activePS.permissions.files}
                onChange={(v) => updateSettings({ permissions: { ...activePS.permissions, files: v } })}
              />
            </div>
          </div>

          {/* Quiet Hours & Anti-Distraction */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-300">
                Quiet Hours &amp; Cooldown
              </label>
              <span className="text-[8px] font-mono text-slate-500 uppercase">
                Anti-Annoyance
              </span>
            </div>

            <ToggleRow
              label="ENABLE QUIET HOURS"
              description="Mute non-critical proactive suggestions during focus or sleep hours"
              checked={activePS.quietHours.enabled}
              onChange={(v) => updateSettings({ quietHours: { ...activePS.quietHours, enabled: v } })}
            />

            {activePS.quietHours.enabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-slate-400">Start Time</span>
                  <input
                    type="time"
                    value={activePS.quietHours.start}
                    onChange={(e) => updateSettings({ quietHours: { ...activePS.quietHours, start: e.target.value } })}
                    className="w-full bg-slate-900/90 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-slate-400">End Time</span>
                  <input
                    type="time"
                    value={activePS.quietHours.end}
                    onChange={(e) => updateSettings({ quietHours: { ...activePS.quietHours, end: e.target.value } })}
                    className="w-full bg-slate-900/90 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            )}

            <ToggleRow
              label="MORNING BRIEFING"
              description="Show a gentle daily priority overview during morning planning"
              checked={activePS.dailyBriefingEnabled}
              onChange={(v) => updateSettings({ dailyBriefingEnabled: v })}
            />
          </div>

          {/* Reset Feedback Memory */}
          {onResetProactiveFeedback && (
            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold font-mono text-slate-300">Reset Preference Learning</span>
                <span className="block text-[9px] text-slate-500 font-mono">
                  Clear dismissal penalties and restore default suggestion weights
                </span>
              </div>
              <button
                type="button"
                onClick={onResetProactiveFeedback}
                className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SettingsPanel({
  isOpen,
  onClose,
  settings,
  onChange,
  themeColor,
  memories = [],
  onAddMemory,
  onDeleteMemory,
  proactiveSettings,
  onUpdateProactiveSettings,
  onResetProactiveFeedback,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [agentHealth, setAgentHealth] = useState<{
    online: boolean;
    toolCount?: number;
    cpu?: string;
    ram?: string;
  }>({ online: false });

  // Recalls Tab State
  const [memoryFilterCategory, setMemoryFilterCategory] = useState<MemoryCategory | "all">("all");
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [newMemoryCategory, setNewMemoryCategory] = useState<MemoryCategory>("identity");
  const [newMemoryText, setNewMemoryText] = useState("");
  const [submittingMemory, setSubmittingMemory] = useState(false);

  // Category Configuration for Recalls
  const categoryConfig: Record<MemoryCategory, { label: string; icon: any; color: string; bg: string }> = {
    identity: { 
      label: "Identity", 
      icon: User, 
      color: "text-amber-400 border-amber-500/25", 
      bg: "bg-amber-500/5 hover:bg-amber-500/10" 
    },
    preference: { 
      label: "Preferences", 
      icon: Heart, 
      color: "text-pink-400 border-pink-500/25", 
      bg: "bg-pink-500/5 hover:bg-pink-500/10" 
    },
    goal: { 
      label: "Life Goals", 
      icon: Target, 
      color: "text-emerald-400 border-emerald-500/25", 
      bg: "bg-emerald-500/5 hover:bg-emerald-500/10" 
    },
    project: { 
      label: "Projects", 
      icon: Briefcase, 
      color: "text-cyan-400 border-cyan-500/25", 
      bg: "bg-cyan-500/5 hover:bg-cyan-500/10" 
    },
    relationship: { 
      label: "Relationships", 
      icon: Users, 
      color: "text-purple-400 border-purple-500/25", 
      bg: "bg-purple-500/5 hover:bg-purple-500/10" 
    },
    emotional: { 
      label: "Milestones", 
      icon: Flame, 
      color: "text-red-400 border-red-500/25", 
      bg: "bg-red-500/5 hover:bg-red-500/10" 
    },
    behavior: { 
      label: "Habits", 
      icon: Brain, 
      color: "text-indigo-400 border-indigo-500/25", 
      bg: "bg-indigo-500/5 hover:bg-indigo-500/10" 
    },
  };

  // Enumerate microphones (mirrors how audio.ts grabs getUserMedia).
  useEffect(() => {
    if (!isOpen) return;
    const enumerate = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMics(devices.filter((d) => d.kind === "audioinput"));
      } catch {
        /* permission may be needed first */
      }
    };
    enumerate();
  }, [isOpen]);

  // Probe desktop agent health
  useEffect(() => {
    if (!isOpen) return;
    const probe = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8765/health", { cache: "no-store" });
        if (!res.ok) {
          setAgentHealth({ online: false });
          return;
        }
        const data = await res.json();
        setAgentHealth({ online: true, toolCount: data.tool_count });
      } catch {
        try {
          const res2 = await fetch("/api/agent-health", { cache: "no-store" });
          if (res2.ok) {
            const d = await res2.json();
            setAgentHealth({ online: !!d.online, toolCount: d.tool_count });
            return;
          }
        } catch {
          /* ignore */
        }
        setAgentHealth({ online: false });
      }
    };
    probe();
    const id = setInterval(probe, 5000);
    return () => clearInterval(id);
  }, [isOpen]);

  const getThemeBadgeGlow = () => {
    switch (themeColor) {
      case "violet": return "border-purple-500/30 text-purple-400 bg-purple-500/10";
      case "crimson": return "border-rose-500/30 text-rose-400 bg-rose-500/10";
      case "emerald": return "border-emerald-500/30 text-emerald-400 bg-emerald-500/10";
      case "celestial": return "border-sky-500/30 text-sky-400 bg-sky-500/10";
      case "gold": return "border-amber-500/30 text-amber-400 bg-amber-500/10";
      case "rose": return "border-pink-500/30 text-pink-400 bg-pink-500/10";
      case "charcoal":
      default:
        return "border-indigo-500/30 text-indigo-400 bg-indigo-500/10";
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: "general", label: "GENERAL", icon: Power },
    { id: "proactive", label: "PROACTIVE AI", icon: Compass },
    { id: "recalls", label: "RECALLS", icon: Brain },
    { id: "voice", label: "VOICE", icon: Mic },
    { id: "system", label: "SYSTEM", icon: Cpu },
    { id: "about", label: "ABOUT", icon: Info },
  ];

  const filteredMemories = memoryFilterCategory === "all"
    ? memories
    : memories.filter((m) => m.category === memoryFilterCategory);

  const handleAddMemorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryText.trim() || !onAddMemory) return;

    setSubmittingMemory(true);
    try {
      await onAddMemory(newMemoryCategory, newMemoryText.trim());
      setNewMemoryText("");
      setIsAddingMemory(false);
    } catch (err) {
      console.error("[SettingsPanel] Error adding memory:", err);
    } finally {
      setSubmittingMemory(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
          {/* Centered Modal Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-md"
          />

          {/* Centered Modal Card Container */}
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xl max-h-[85vh] bg-[#070712]/95 border border-white/15 rounded-3xl backdrop-blur-2xl flex flex-col shadow-[0_25px_70px_rgba(0,0,0,0.85),0_0_40px_rgba(6,182,212,0.1)] overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border ${getThemeBadgeGlow()}`}>
                  <Settings size={20} className="animate-spin [animation-duration:6s]" />
                </div>
                <div>
                  <h3 className="font-display font-medium text-base tracking-tight text-white flex items-center gap-2">
                    Bella Configuration
                    <Sparkles size={13} className="text-cyan-400" />
                  </h3>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                    System settings &amp; preferences
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition cursor-pointer"
                title="Close Settings"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tab selector row */}
            <div className="px-6 py-3 border-b border-white/5 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono tracking-wider transition shrink-0 cursor-pointer ${
                      active
                        ? "border-cyan-400 bg-cyan-400/15 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.25)] font-semibold"
                        : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                    }`}
                  >
                    <Icon size={12} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* ---------------- GENERAL ---------------- */}
              {activeTab === "general" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Startup &amp; Appearance
                  </div>

                  <ToggleRow
                    label="LAUNCH AT STARTUP"
                    description="Start Bella silently when Windows logs in"
                    checked={settings.autoStart}
                    onChange={(v) => {
                      onChange({ autoStart: v });
                      void fetch("/api/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ autoStart: v }),
                      }).catch(() => {});
                    }}
                  />

                  <ToggleRow
                    label="UI ANIMATIONS"
                    description="Enable motion and visual transitions"
                    checked={settings.animations}
                    onChange={(v) => onChange({ animations: v })}
                  />

                  {settings.autoStart && (
                    <div className="mt-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-2">
                      <Check size={14} className="text-emerald-400 shrink-0" />
                      <span className="text-[10px] font-mono text-emerald-300">
                        Auto-start configured in Windows registry (HKCU\...\Run).
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ---------------- PROACTIVE INTELLIGENCE ---------------- */}
              {activeTab === "proactive" && (
                <ProactiveSettingsSection
                  proactiveSettings={proactiveSettings}
                  onUpdateProactiveSettings={onUpdateProactiveSettings}
                  onResetProactiveFeedback={onResetProactiveFeedback}
                />
              )}

              {/* ---------------- RECALLS (MEMORIES) ---------------- */}
              {activeTab === "recalls" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                        Recollections &amp; Memory Core
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {memories.length} item(s) memorized
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAddingMemory(!isAddingMemory)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-mono tracking-wider transition-all cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                    >
                      <Plus size={13} />
                      <span>{isAddingMemory ? "CANCEL" : "ADD RECALL"}</span>
                    </button>
                  </div>

                  {/* Add New Memory Form */}
                  <AnimatePresence>
                    {isAddingMemory && (
                      <motion.form
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        onSubmit={handleAddMemorySubmit}
                        className="p-4 rounded-2xl border border-cyan-500/30 bg-cyan-950/30 backdrop-blur-xl space-y-3 overflow-hidden"
                      >
                        <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold flex items-center gap-1.5">
                          <Plus size={12} />
                          <span>Insert Custom Memory</span>
                        </div>

                        {/* Category Selector */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                            Category Dimension
                          </label>
                          <select
                            value={newMemoryCategory}
                            onChange={(e) => setNewMemoryCategory(e.target.value as MemoryCategory)}
                            className="w-full bg-slate-900/90 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                          >
                            {Object.entries(categoryConfig).map(([key, config]) => (
                              <option key={key} value={key}>
                                {config.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Memory Description Input */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                            Memory Description
                          </label>
                          <textarea
                            value={newMemoryText}
                            onChange={(e) => setNewMemoryText(e.target.value)}
                            placeholder="e.g., Manish loves building intelligent cybersecurity tools."
                            rows={3}
                            className="w-full bg-slate-900/90 border border-white/10 rounded-xl p-3 text-xs font-sans text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 resize-none"
                            required
                          />
                        </div>

                        {/* Submit Button */}
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setIsAddingMemory(false)}
                            className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white text-xs font-mono transition cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={submittingMemory || !newMemoryText.trim()}
                            className="px-4 py-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs font-mono tracking-wider transition cursor-pointer disabled:opacity-50 font-semibold"
                          >
                            {submittingMemory ? "Committing..." : "Save Memory"}
                          </button>
                        </div>
                      </motion.form>
                    )}
                  </AnimatePresence>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setMemoryFilterCategory("all")}
                      className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono tracking-wider transition shrink-0 cursor-pointer ${
                        memoryFilterCategory === "all"
                          ? "border-cyan-400 bg-cyan-400/20 text-cyan-300"
                          : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                      }`}
                    >
                      ALL ({memories.length})
                    </button>
                    {Object.entries(categoryConfig).map(([cat, config]) => {
                      const count = memories.filter((m) => m.category === cat).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setMemoryFilterCategory(cat as MemoryCategory)}
                          className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono tracking-wider transition shrink-0 cursor-pointer ${
                            memoryFilterCategory === cat
                              ? "border-cyan-400 bg-cyan-400/20 text-cyan-300"
                              : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                          }`}
                        >
                          {config.label.toUpperCase()} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* Memory Cards List */}
                  <div className="space-y-2 pt-1 max-h-[380px] overflow-y-auto pr-1">
                    {filteredMemories.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl border border-white/5 bg-white/[0.02]">
                        <Brain size={24} className="mx-auto text-slate-600 mb-2" />
                        <p className="text-xs font-mono text-slate-500">No memories found in this category.</p>
                      </div>
                    ) : (
                      filteredMemories.map((m) => {
                        const cfg = categoryConfig[m.category] || categoryConfig.identity;
                        const CategoryIcon = cfg.icon;
                        return (
                          <div
                            key={m.id}
                            className="p-3 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-all group relative"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                <div className={`p-1.5 rounded-lg border ${cfg.color} ${cfg.bg} shrink-0 mt-0.5`}>
                                  <CategoryIcon size={12} />
                                </div>
                                <div className="space-y-0.5 flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                                      {cfg.label}
                                    </span>
                                    <span className="text-[8px] font-mono text-slate-600">
                                      {new Date(m.createdAt).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  </div>
                                  <p className="text-xs font-sans text-slate-200 leading-relaxed break-words">
                                    {m.text}
                                  </p>
                                </div>
                              </div>

                              {onDeleteMemory && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteMemory(m.id)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition opacity-60 hover:opacity-100 cursor-pointer shrink-0"
                                  title="Delete Memory"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ---------------- VOICE ---------------- */}
              {activeTab === "voice" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Voice &amp; Microphone
                  </div>

                  <ToggleRow
                    label="WAKE WORD DETECTION"
                    description="Listen continuously for wake phrase while Bella sleeps"
                    checked={settings.wakeWordEnabled}
                    onChange={(v) => onChange({ wakeWordEnabled: v })}
                  />

                  {settings.wakeWordEnabled && (
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-mono tracking-wider text-slate-300 uppercase">
                        Wake Phrase
                      </label>
                      <input
                        type="text"
                        value={settings.wakePhrase}
                        onChange={(e) => onChange({ wakePhrase: e.target.value })}
                        placeholder="e.g. hey bella"
                        className="w-full bg-slate-900/90 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 placeholder:text-slate-600"
                      />
                      <span className="text-[8px] text-slate-500 uppercase font-mono">
                        Speak this phrase to wake Bella up automatically
                      </span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-mono tracking-wider text-slate-300 uppercase">
                      Active Microphone
                    </label>
                    <select
                      value={settings.micDeviceId}
                      onChange={(e) => onChange({ micDeviceId: e.target.value })}
                      className="w-full bg-slate-900/90 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                    >
                      <option value="default">System Default</option>
                      {mics.map((m, i) => (
                        <option key={m.deviceId || i} value={m.deviceId}>
                          {m.label || `Microphone ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    <span className="text-[8px] text-slate-500 uppercase font-mono">
                      {mics.length === 0
                        ? "Grant mic permission to list devices"
                        : `${mics.length} device(s) detected`}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-mono tracking-wider text-slate-300 uppercase">
                        Sensitivity
                      </label>
                      <span className="text-[10px] font-mono text-cyan-300">
                        {settings.sensitivity}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings.sensitivity}
                      onChange={(e) => onChange({ sensitivity: Number(e.target.value) })}
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                    <span className="text-[8px] text-slate-500 uppercase font-mono">
                      Higher = faster re-arm &amp; more matches
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-mono tracking-wider text-slate-300 uppercase">
                        Auto-Sleep Inactivity Timeout
                      </label>
                      <span className="text-[10px] font-mono text-cyan-300">
                        {settings.autoSleepSeconds || 60}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={300}
                      step={5}
                      value={settings.autoSleepSeconds || 60}
                      onChange={(e) => onChange({ autoSleepSeconds: Number(e.target.value) })}
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                    <span className="text-[8px] text-slate-500 uppercase font-mono">
                      Automatically puts Bella to sleep after non-interaction
                    </span>
                  </div>
                </div>
              )}

              {/* ---------------- SYSTEM ---------------- */}
              {activeTab === "system" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Desktop Control Agent
                  </div>

                  <div
                    className={`p-4 rounded-xl border flex items-center gap-3 ${
                      agentHealth.online
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-rose-500/20 bg-rose-500/5"
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        agentHealth.online ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                      }`}
                    />
                    <div className="flex-1">
                      <div className="text-xs font-mono text-white">
                        {agentHealth.online ? "Agent Online" : "Agent Offline"}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {agentHealth.online
                          ? `${agentHealth.toolCount ?? 0} tools registered`
                          : "Start the Python agent on port 8765"}
                      </div>
                    </div>
                    <Cpu size={16} className="text-slate-500" />
                  </div>

                  <div className="p-3 rounded-xl border border-white/5 bg-white/5 space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      <Volume2 size={12} /> Capabilities
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300">
                      <span>✓ App control</span>
                      <span>✓ Browser</span>
                      <span>✓ Volume</span>
                      <span>✓ Brightness</span>
                      <span>✓ Power</span>
                      <span>✓ Files</span>
                      <span>✓ Screenshot</span>
                      <span>✓ Clipboard</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------- ABOUT ---------------- */}
              {activeTab === "about" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    About Bella
                  </div>

                  <div className="p-4 rounded-xl border border-white/5 bg-white/5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Info size={14} className="text-cyan-400" />
                      <span className="text-sm font-display text-white">BELLA AI Assistant</span>
                    </div>
                    <div className="space-y-1.5 text-[10px] font-mono text-slate-400">
                      <div className="flex justify-between">
                        <span>VERSION</span>
                        <span className="text-slate-300">V2.0.0</span>
                      </div>
                      <div className="flex justify-between">
                        <span>ENGINE</span>
                        <span className="text-slate-300">Gemini Live</span>
                      </div>
                      <div className="flex justify-between">
                        <span>DESKTOP</span>
                        <span className="text-slate-300">FastAPI Agent</span>
                      </div>
                      <div className="flex justify-between">
                        <span>WAKE WORD</span>
                        <span className="text-slate-300">Web Speech API</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-amber-500/15 bg-amber-500/5 flex items-start gap-2">
                    <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[10px] font-mono text-amber-300/70 leading-relaxed">
                      Keep this tab active for wake-word detection. Microphone access
                      is required for voice activation.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer status bar */}
            <div className="px-6 py-2.5 border-t border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
              <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                Preferences auto-saved
              </span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                Bella Core V2
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
