import React, { useState } from "react";
import {
  Sparkles,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Play,
  ListTodo,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AIBriefingCardProps {
  briefing: {
    title: string;
    summary: string;
    reasoning: string;
    recommendedFocus: string;
    estimatedMinutes: number;
    actionLabel?: string;
    planDetails?: string[];
  };
  onStartFocus: () => void;
  onViewPlan?: () => void;
}

export function AIBriefingCard({
  briefing,
  onStartFocus,
  onViewPlan,
}: AIBriefingCardProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/40 via-slate-900/80 to-slate-950/90 backdrop-blur-xl p-5 shadow-xl shadow-indigo-950/20">
      {/* Subtle ambient highlight */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Sparkles className="w-4 h-4 text-indigo-300" />
          </div>
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-indigo-300">
            AI Daily Briefing
          </span>
        </div>

        {/* Explainability button ("Why?") */}
        <button
          type="button"
          onClick={() => setShowReasoning(!showReasoning)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] font-mono text-slate-300 hover:text-white transition cursor-pointer"
        >
          <HelpCircle className="w-3 h-3 text-cyan-400" />
          <span>Why?</span>
          {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Briefing Summary */}
      <p className="text-sm font-sans text-slate-200 leading-relaxed mb-4">
        {briefing.summary}
      </p>

      {/* Recommended Focus Strip */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/30 border border-white/[0.06] mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="text-xs font-sans text-slate-300">
            <span className="font-semibold text-white">Recommended focus:</span>{" "}
            {briefing.recommendedFocus}
          </div>
        </div>
        <span className="text-[11px] font-mono font-bold text-cyan-300 shrink-0">
          ~{briefing.estimatedMinutes}m
        </span>
      </div>

      {/* Collapsible Reasoning & Plan Drawers */}
      <AnimatePresence>
        {showReasoning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-3"
          >
            <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-xs font-mono text-indigo-200/90 leading-relaxed">
              <span className="font-bold uppercase tracking-wider text-indigo-300 block mb-1">
                Context &amp; Reasoning:
              </span>
              {briefing.reasoning}
            </div>
          </motion.div>
        )}

        {showPlan && briefing.planDetails && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-3"
          >
            <div className="p-3 rounded-xl bg-slate-900/90 border border-white/10 text-xs font-mono text-slate-300 space-y-1.5">
              <span className="font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Recommended Daily Timeline:
              </span>
              {briefing.planDetails.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-slate-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Footer */}
      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.06]">
        {briefing.planDetails && (
          <button
            type="button"
            onClick={() => setShowPlan(!showPlan)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer"
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span>{showPlan ? "Hide Plan" : "View Plan"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onStartFocus}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-semibold text-xs transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{briefing.actionLabel || "Start Focus"}</span>
        </button>
      </div>
    </div>
  );
}
