import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  CheckSquare,
  FolderKanban,
  BookOpen,
  Brain,
  Timer,
  Plus,
  Sparkles,
  Command,
  ArrowRight,
  X,
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
  category: "actions" | "tasks" | "projects" | "learning" | "memories";
  actionType: string;
  payload?: any;
}

const DEFAULT_COMMANDS: SearchItem[] = [
  { id: "cmd-focus", title: "Start 25m Focus Session", subtitle: "Deep work session with AI companion support", category: "actions", actionType: "start_focus" },
  { id: "cmd-task", title: "Create New Priority Task", subtitle: "Add to today's focus queue", category: "actions", actionType: "new_task" },
  { id: "cmd-note", title: "Capture Quick Note", subtitle: "Save note or concept to memory", category: "actions", actionType: "new_note" },
  { id: "cmd-rev", title: "Review SQL Injection & Web Security", subtitle: "Spaced repetition revision session", category: "actions", actionType: "start_review", payload: { topic: "SQL Injection" } },
  { id: "cmd-proj", title: "Open AI Desktop Assistant Project", subtitle: "Jump to active project milestone", category: "actions", actionType: "open_project", payload: { id: "proj-1" } },
  { id: "cmd-talk", title: "Talk to Bella (Multimodal Voice Link)", subtitle: "Activate live voice call companion", category: "actions", actionType: "activate_voice" },
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

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (Array.isArray(data.results)) {
          const mapped: SearchItem[] = data.results.map((r: any) => ({
            id: r.id,
            title: r.title,
            subtitle: r.subtitle,
            category: r.category || "tasks",
            actionType: `open_${r.category}`,
            payload: { id: r.id, title: r.title },
          }));
          setResults(mapped.length > 0 ? mapped : DEFAULT_COMMANDS.filter((c) => c.title.toLowerCase().includes(query.toLowerCase())));
        }
      } catch {
        // Fallback filter
        setResults(DEFAULT_COMMANDS.filter((c) => c.title.toLowerCase().includes(query.toLowerCase())));
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Keyboard navigation (Arrow keys, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
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
      <div className="fixed inset-0 z-[120] flex items-start justify-center pt-20 px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/75 backdrop-blur-md"
        />

        {/* Command Palette Card */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: -10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: -10 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="relative z-10 w-full max-w-xl rounded-2xl bg-slate-900/95 border border-white/10 shadow-2xl backdrop-blur-2xl overflow-hidden font-sans"
        >
          {/* Search Input Bar */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08]">
            <Search className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search tasks, projects, learning, notes, or type a command..."
              className="w-full bg-transparent border-none text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
            <kbd className="px-2 py-0.5 text-[10px] font-mono bg-white/[0.06] text-slate-400 rounded border border-white/10 shrink-0">
              ESC
            </kbd>
          </div>

          {/* Results List */}
          <div className="max-h-[340px] overflow-y-auto p-2 space-y-1">
            {results.length === 0 ? (
              <div className="p-8 text-center text-xs font-mono text-slate-500">
                No matching commands or resources found.
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
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition ${
                      isSelected ? "bg-cyan-500/15 border border-cyan-500/30 text-white" : "text-slate-300 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={`p-1.5 rounded-lg border shrink-0 ${
                          isSelected ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" : "bg-white/[0.05] text-slate-400 border-white/10"
                        }`}
                      >
                        {item.category === "projects" ? (
                          <FolderKanban className="w-3.5 h-3.5" />
                        ) : item.category === "learning" ? (
                          <BookOpen className="w-3.5 h-3.5" />
                        ) : item.category === "memories" ? (
                          <Brain className="w-3.5 h-3.5" />
                        ) : item.actionType === "start_focus" ? (
                          <Timer className="w-3.5 h-3.5" />
                        ) : (
                          <CheckSquare className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate text-white">{item.title}</div>
                        <div className="text-[10px] font-mono text-slate-400 truncate">{item.subtitle}</div>
                      </div>
                    </div>

                    <ArrowRight className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-cyan-300" : "text-slate-600"}`} />
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Shortcuts */}
          <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-t border-white/[0.06] text-[10px] font-mono text-slate-500">
            <div className="flex items-center gap-3">
              <span>↑↓ Navigate</span>
              <span>↵ Select</span>
            </div>
            <span>Global Command Center</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
