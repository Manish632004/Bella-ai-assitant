import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  CheckSquare,
  FolderKanban,
  BookOpen,
  Brain,
  Timer,
  Sparkles,
  Command,
  ArrowRight,
  Shield,
  Settings,
  Power,
  Mic,
  Monitor,
  Lightbulb,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAction: (actionType: string, payload?: any) => void;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  category: "Intelligence & Curiosity" | "Workspace & Actions" | "System Controls" | "Learning & Security";
  actionType: string;
  payload?: any;
}

const DEFAULT_COMMANDS: SearchItem[] = [
  { id: "cmd-curiosity", title: "Evaluate Contextual Curiosity", subtitle: "Ask what Bella is curious about right now", category: "Intelligence & Curiosity", actionType: "trigger_curiosity" },
  { id: "cmd-recommend", title: "Get Personalized Recommendations", subtitle: "Anime, tools, media, and next learning topics", category: "Intelligence & Curiosity", actionType: "get_recommendations" },
  { id: "cmd-memory", title: "View Persistent Memories", subtitle: "Inspect and manage confirmed preferences", category: "Intelligence & Curiosity", actionType: "open_memories" },
  { id: "cmd-focus", title: "Start 25m Focus Session", subtitle: "Deep work session with AI companion support", category: "Workspace & Actions", actionType: "start_focus" },
  { id: "cmd-task", title: "Create Priority Task", subtitle: "Add to today's focus queue", category: "Workspace & Actions", actionType: "new_task" },
  { id: "cmd-note", title: "Capture Quick Note", subtitle: "Save insight directly to memory", category: "Workspace & Actions", actionType: "new_note" },
  { id: "cmd-proj", title: "Open Active Projects", subtitle: "View architecture milestones and gap analysis", category: "Workspace & Actions", actionType: "open_projects" },
  { id: "cmd-cyber", title: "Cybersecurity & Learning Tracks", subtitle: "Web pentesting labs and prerequisite paths", category: "Learning & Security", actionType: "open_learning" },
  { id: "cmd-camera", title: "Toggle Real-Time Camera Vision", subtitle: "Allow Bella to see objects, documents, and diagrams via camera", category: "System Controls", actionType: "toggle_camera_vision" },
  { id: "cmd-screen", title: "Toggle Multimodal Screen Vision", subtitle: "Allow Bella to see your active screen", category: "System Controls", actionType: "toggle_screen_share" },
  { id: "cmd-float", title: "Toggle Floating Companion (PiP)", subtitle: "Switch between Full Stage and Floating Capsule", category: "System Controls", actionType: "toggle_mini_mode" },
  { id: "cmd-settings", title: "Open Companion Settings", subtitle: "Privacy permissions, quiet hours, and voice style", category: "System Controls", actionType: "open_settings" },
];

export function CommandPalette({ isOpen, onClose, onSelectAction }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>(DEFAULT_COMMANDS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults(DEFAULT_COMMANDS);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(DEFAULT_COMMANDS);
      return;
    }

    const lower = query.toLowerCase().trim();
    const filtered = DEFAULT_COMMANDS.filter(
      (c) => c.title.toLowerCase().includes(lower) || c.subtitle.toLowerCase().includes(lower) || c.category.toLowerCase().includes(lower)
    );
    setResults(filtered);
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation (Arrow keys, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        const item = results[selectedIndex];
        onSelectAction(item.actionType, item.payload);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[140] flex items-start justify-center pt-24 px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-xl"
        />

        {/* Command Palette Card */}
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: -12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: -12 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-xl rounded-2xl glass-panel shadow-2xl overflow-hidden font-sans border border-white/[0.09]"
        >
          {/* Search Input Bar */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08] bg-white/[0.015]">
            <Search className="w-4 h-4 text-indigo-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command or search workspace..."
              className="w-full bg-transparent border-none text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none tracking-wide"
            />
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white/[0.06] text-slate-400 rounded border border-white/10 shrink-0">
                ESC
              </kbd>
            </div>
          </div>

          {/* Results List */}
          <div className="max-h-[360px] overflow-y-auto p-2 space-y-1">
            {results.length === 0 ? (
              <div className="p-10 text-center text-xs font-sans text-slate-500">
                No matching commands found.
              </div>
            ) : (
              results.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelectAction(item.actionType, item.payload);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "bg-indigo-500/15 border border-indigo-500/30 text-white shadow-sm"
                        : "text-slate-300 hover:bg-white/[0.035] border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={`p-1.5 rounded-lg border shrink-0 ${
                          isSelected
                            ? "bg-indigo-500/25 text-indigo-300 border-indigo-500/40"
                            : "bg-white/[0.04] text-slate-400 border-white/[0.06]"
                        }`}
                      >
                        {item.category === "Intelligence & Curiosity" ? (
                          <Sparkles className="w-3.5 h-3.5" />
                        ) : item.category === "Learning & Security" ? (
                          <Shield className="w-3.5 h-3.5" />
                        ) : item.category === "System Controls" ? (
                          <Settings className="w-3.5 h-3.5" />
                        ) : (
                          <CheckSquare className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate text-white">{item.title}</div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">{item.subtitle}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                        {item.category}
                      </span>
                      <ArrowRight className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-indigo-300" : "text-slate-600"}`} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Shortcuts */}
          <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-t border-white/[0.06] text-[11px] font-sans text-slate-500">
            <div className="flex items-center gap-3">
              <span><kbd className="font-mono text-[10px] text-slate-400">↑↓</kbd> Navigate</span>
              <span><kbd className="font-mono text-[10px] text-slate-400">↵</kbd> Select</span>
            </div>
            <div className="flex items-center gap-1.5 text-indigo-400/80">
              <Command className="w-3 h-3" />
              <span>Raycast Command Center</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
