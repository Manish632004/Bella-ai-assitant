import React, { useState, useMemo } from "react";
import { Memory, MemoryCategory } from "../lib/memoryTypes";
import { 
  Brain, 
  X, 
  Trash2, 
  Plus, 
  User, 
  Heart, 
  Target, 
  Briefcase, 
  Users, 
  Flame, 
  Sparkles,
  GraduationCap,
  Wrench,
  BookOpen,
  Film,
  Camera,
  Layers,
  Search,
  CheckCircle2,
  Database
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface MemoryDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  memories: Memory[];
  onAddMemory: (category: MemoryCategory, text: string) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  themeColor: string;
}

export function MemoryDashboard({
  isOpen,
  onClose,
  memories,
  onAddMemory,
  onDeleteMemory,
  themeColor
}: MemoryDashboardProps) {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<string>("preference");
  const [isAdding, setIsAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Comprehensive Category Configuration
  const categoryConfig: Record<string, { label: string; icon: any; color: string; bg: string }> = {
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
      label: "Goals", 
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
    interest: { 
      label: "Interests", 
      icon: Sparkles, 
      color: "text-purple-400 border-purple-500/25", 
      bg: "bg-purple-500/5 hover:bg-purple-500/10" 
    },
    learning: { 
      label: "Learning", 
      icon: BookOpen, 
      color: "text-blue-400 border-blue-500/25", 
      bg: "bg-blue-500/5 hover:bg-blue-500/10" 
    },
    education: { 
      label: "Education", 
      icon: GraduationCap, 
      color: "text-teal-400 border-teal-500/25", 
      bg: "bg-teal-500/5 hover:bg-teal-500/10" 
    },
    tools: { 
      label: "Tools", 
      icon: Wrench, 
      color: "text-amber-300 border-amber-400/25", 
      bg: "bg-amber-400/5 hover:bg-amber-400/10" 
    },
    relationship: { 
      label: "Relationships", 
      icon: Users, 
      color: "text-indigo-400 border-indigo-500/25", 
      bg: "bg-indigo-500/5 hover:bg-indigo-500/10" 
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
    media: { 
      label: "Media", 
      icon: Film, 
      color: "text-rose-400 border-rose-500/25", 
      bg: "bg-rose-500/5 hover:bg-rose-500/10" 
    },
    visual_context: {
      label: "Vision",
      icon: Camera,
      color: "text-cyan-300 border-cyan-400/25",
      bg: "bg-cyan-400/5 hover:bg-cyan-400/10"
    }
  };

  const getCategoryConfig = (cat?: string) => {
    if (cat && categoryConfig[cat]) {
      return categoryConfig[cat];
    }
    return {
      label: cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : "General",
      icon: Layers,
      color: "text-cyan-400 border-cyan-500/25",
      bg: "bg-cyan-500/5 hover:bg-cyan-500/10"
    };
  };

  const filteredMemories = useMemo(() => {
    return memories.filter((m) => {
      const matchCat = activeTab === "all" || (m.category || "").toLowerCase() === activeTab.toLowerCase();
      const matchSearch = !searchQuery.trim() || m.text.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchCat && matchSearch;
    });
  }, [memories, activeTab, searchQuery]);

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    setSubmitting(true);
    try {
      await onAddMemory(newCategory as MemoryCategory, newText.trim());
      setNewText("");
      setIsAdding(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return "Permanent";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "Permanent";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return "Permanent";
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-md"
          />

          {/* Centered Premium Glass Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-4xl max-h-[85vh] rounded-2xl glass-panel border border-white/[0.1] bg-[#0E1017]/95 shadow-2xl flex flex-col overflow-hidden text-white z-10"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <Brain size={20} className="animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-bold text-lg tracking-tight text-white/95">
                      Memory Core
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] text-slate-300 border border-white/10">
                      {memories.length} memories
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans mt-0.5">
                    Continuous long-term recollections and personal preferences
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAdding(!isAdding)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans font-medium transition cursor-pointer ${
                    isAdding
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                      : "bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 border border-white/10"
                  }`}
                >
                  <Plus size={13} />
                  <span>{isAdding ? "Close Form" : "Add Memory"}</span>
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-xl hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
                  title="Close (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Quick Filter & Search Bar */}
            <div className="px-6 py-3 border-b border-white/[0.06] bg-black/20 flex flex-col sm:flex-row items-center gap-3 justify-between">
              {/* Search input */}
              <div className="relative w-full sm:w-72">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter memories by keyword..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition font-sans"
                />
              </div>

              {/* Dynamic Category Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto no-scrollbar py-0.5">
                <button
                  onClick={() => setActiveTab("all")}
                  className={`px-3 py-1 rounded-xl text-xs font-sans font-medium transition cursor-pointer shrink-0 ${
                    activeTab === "all"
                      ? "bg-white/15 text-white shadow-sm font-semibold border border-white/15"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  All ({memories.length})
                </button>
                {Object.keys(categoryConfig).map((cat) => {
                  const config = getCategoryConfig(cat);
                  const count = memories.filter(
                    (m) => (m.category || "").toLowerCase() === cat.toLowerCase()
                  ).length;
                  if (count === 0 && !["identity", "preference", "goal", "project", "interest", "learning"].includes(cat)) {
                    return null;
                  }
                  const active = activeTab.toLowerCase() === cat.toLowerCase();
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveTab(cat)}
                      className={`px-2.5 py-1 rounded-xl text-xs font-sans font-medium transition cursor-pointer shrink-0 ${
                        active
                          ? "bg-white/15 text-white shadow-sm font-semibold border border-white/15"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {config.label} {count > 0 ? `(${count})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Manual Entry Form */}
            <AnimatePresence>
              {isAdding && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b border-white/[0.08] bg-[#141722]/80"
                >
                  <form onSubmit={handleManualAdd} className="p-5 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-2 font-sans">
                        Category
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Object.keys(categoryConfig).map((cat) => {
                          const cfg = getCategoryConfig(cat);
                          const Icon = cfg.icon;
                          const active = newCategory === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setNewCategory(cat)}
                              className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-sans transition cursor-pointer ${
                                active
                                  ? "border-purple-500 bg-purple-500/15 text-purple-200 font-semibold"
                                  : "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.05]"
                              }`}
                            >
                              <Icon size={13} className={active ? "text-purple-400" : "text-slate-400"} />
                              <span className="truncate">{cfg.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-2 font-sans">
                        Recollection Statement
                      </label>
                      <textarea
                        value={newText}
                        onChange={(e) => setNewText(e.target.value)}
                        placeholder="e.g. The user prefers hands-on cybersecurity labs and real-world network projects."
                        required
                        rows={3}
                        className="w-full p-3 text-xs rounded-xl border border-white/10 bg-black/40 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 font-sans resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsAdding(false)}
                        className="px-3 py-1.5 rounded-xl border border-white/10 text-xs text-slate-400 hover:text-white transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition disabled:opacity-50 cursor-pointer shadow-lg shadow-purple-600/20"
                      >
                        {submitting ? "Saving..." : "Save Memory"}
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Memory Items Grid / List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {filteredMemories.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center text-slate-500">
                  <Brain size={32} className="opacity-30 mb-3" />
                  <p className="text-sm font-medium text-slate-300">No memories matched</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    {searchQuery ? "Try a different search term." : "Speak with Bella or add a manual memory to get started."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredMemories.map((m) => {
                    const cfg = getCategoryConfig(m.category);
                    const Icon = cfg.icon;

                    return (
                      <div
                        key={m.id}
                        className={`p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] ${cfg.bg} hover:border-white/[0.12] transition-all group flex flex-col justify-between`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <div className={`p-1.5 rounded-lg border bg-black/40 ${cfg.color}`}>
                                <Icon size={12} />
                              </div>
                              <span className={`text-[10px] font-sans font-semibold uppercase tracking-wider ${cfg.color}`}>
                                {cfg.label}
                              </span>
                            </div>

                            <button
                              onClick={() => onDeleteMemory(m.id)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition cursor-pointer"
                              title="Delete memory"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          <p className="text-xs text-slate-200 font-sans leading-relaxed font-normal">
                            {m.text}
                          </p>
                        </div>

                        <div className="mt-3 pt-2 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-slate-500 font-mono">
                          <span>{formatDate(m.createdAt)}</span>
                          <span className="text-slate-600">Verified</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/[0.06] bg-black/30 flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400" />
                <span>Memories automatically personalize voice conversations</span>
              </div>
              <span className="font-mono text-[10px] text-slate-500">Local JSON Storage</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
