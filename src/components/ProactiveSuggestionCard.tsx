import React, { useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  Clock,
  X,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  BookOpen,
  FolderKanban,
  CheckSquare,
  Calendar,
  Code,
  Shield,
  FileText,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ProactiveSuggestion, ProactiveCategory } from "../../proactive/types";

interface ProactiveSuggestionCardProps {
  suggestion: ProactiveSuggestion | null;
  onAccept: (id: string, action?: any) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
}

const CATEGORY_ICONS: Record<ProactiveCategory, any> = {
  tasks: CheckSquare,
  projects: FolderKanban,
  learning: BookOpen,
  calendar: Calendar,
  coding: Code,
  cybersecurity: Shield,
  files: FileText,
  browser: Sparkles,
  screen: Sparkles,
  mic: Sparkles,
  camera: Sparkles,
};

const CATEGORY_COLORS: Record<ProactiveCategory, { badge: string; border: string; glow: string }> = {
  tasks: { badge: "bg-blue-500/20 text-blue-300", border: "border-blue-500/30", glow: "shadow-blue-500/10" },
  projects: { badge: "bg-purple-500/20 text-purple-300", border: "border-purple-500/30", glow: "shadow-purple-500/10" },
  learning: { badge: "bg-emerald-500/20 text-emerald-300", border: "border-emerald-500/30", glow: "shadow-emerald-500/10" },
  calendar: { badge: "bg-amber-500/20 text-amber-300", border: "border-amber-500/30", glow: "shadow-amber-500/10" },
  coding: { badge: "bg-cyan-500/20 text-cyan-300", border: "border-cyan-500/30", glow: "shadow-cyan-500/10" },
  cybersecurity: { badge: "bg-rose-500/20 text-rose-300", border: "border-rose-500/30", glow: "shadow-rose-500/10" },
  files: { badge: "bg-slate-500/20 text-slate-300", border: "border-slate-500/30", glow: "shadow-slate-500/10" },
  browser: { badge: "bg-indigo-500/20 text-indigo-300", border: "border-indigo-500/30", glow: "shadow-indigo-500/10" },
  screen: { badge: "bg-teal-500/20 text-teal-300", border: "border-teal-500/30", glow: "shadow-teal-500/10" },
  mic: { badge: "bg-pink-500/20 text-pink-300", border: "border-pink-500/30", glow: "shadow-pink-500/10" },
  camera: { badge: "bg-orange-500/20 text-orange-300", border: "border-orange-500/30", glow: "shadow-orange-500/10" },
};

export function ProactiveSuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  onSnooze,
}: ProactiveSuggestionCardProps) {
  const [showExplanation, setShowExplanation] = useState(false);

  if (!suggestion) return null;

  const IconComponent = CATEGORY_ICONS[suggestion.category] || Sparkles;
  const style = CATEGORY_COLORS[suggestion.category] || CATEGORY_COLORS.tasks;

  const isImportant = suggestion.level === "important" || suggestion.level === "critical";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -15, scale: 0.95 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className={`relative z-50 w-full max-w-md backdrop-blur-xl bg-slate-900/90 border ${style.border} rounded-2xl p-4 shadow-2xl ${style.glow} text-slate-100 font-sans`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${style.badge}`}>
              <IconComponent className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider font-mono text-slate-400">
                  {suggestion.category}
                </span>
                {isImportant && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                    <ShieldAlert className="w-2.5 h-2.5" /> High Priority
                  </span>
                )}
              </div>
              <h4 className="text-sm font-semibold text-white/95 leading-snug">
                {suggestion.title}
              </h4>
            </div>
          </div>

          <button
            onClick={() => onDismiss(suggestion.id)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="Dismiss suggestion"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message */}
        <p className="text-xs text-slate-300 leading-relaxed pl-8 mb-3">
          {suggestion.message}
        </p>

        {/* Explainability toggle */}
        <div className="pl-8 mb-3">
          <button
            type="button"
            onClick={() => setShowExplanation(!showExplanation)}
            className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 font-mono transition-colors cursor-pointer"
          >
            <HelpCircle className="w-3 h-3 text-cyan-400" />
            <span>Why am I seeing this?</span>
            {showExplanation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <AnimatePresence>
            {showExplanation && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 p-2 rounded-lg bg-black/40 border border-white/5 text-[11px] font-mono text-slate-300">
                  {suggestion.explanation}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10 pl-8">
          <button
            type="button"
            onClick={() => onSnooze(suggestion.id)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Clock className="w-3 h-3" />
            Snooze 1h
          </button>

          <button
            type="button"
            onClick={() => onAccept(suggestion.id, suggestion.suggestedAction)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold font-mono bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-lg shadow-cyan-500/20 flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Accept
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
