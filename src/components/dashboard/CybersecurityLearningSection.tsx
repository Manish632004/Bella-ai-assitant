import React from "react";
import {
  Shield,
  BookOpen,
  Award,
  Clock,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { CybersecurityProficiency, LearningTopic } from "../../../proactive/types";

interface CybersecurityLearningSectionProps {
  learningSummary: {
    overallProgressPercent: number;
    currentFocus: string;
    weeklyCompletions: {
      labs: number;
      topics: number;
      revisions: number;
    };
    nextRecommendation: string;
    cybersecurityProficiency: CybersecurityProficiency[];
  };
  revisionQueue: LearningTopic[];
  onStartReview: (topic: string) => void;
  onGenerateQuiz?: (topic: string) => void;
}

export function CybersecurityLearningSection({
  learningSummary,
  revisionQueue,
  onStartReview,
  onGenerateQuiz,
}: CybersecurityLearningSectionProps) {
  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400">
            Cybersecurity &amp; Learning Hub
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/10 text-rose-300 border border-rose-500/20">
            {learningSummary.overallProgressPercent}% Overall
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Card: Estimated Proficiency Matrix */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <Shield className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                Estimated Proficiency
              </h4>
            </div>
            <span className="text-[9px] font-mono text-slate-500 uppercase">
              Calculated from labs &amp; reviews
            </span>
          </div>

          {/* Proficiency Bars */}
          <div className="space-y-2.5 pt-1">
            {learningSummary.cybersecurityProficiency.map((prof) => (
              <div key={prof.category} className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-300 font-medium">{prof.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">
                      {prof.completedLabs}/{prof.totalLabs} labs
                    </span>
                    <span className="text-white font-bold">{prof.proficiencyPercent}%</span>
                  </div>
                </div>

                <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      prof.proficiencyPercent >= 80
                        ? "bg-emerald-400"
                        : prof.proficiencyPercent >= 50
                        ? "bg-cyan-400"
                        : "bg-rose-400"
                    }`}
                    style={{ width: `${prof.proficiencyPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Weekly Completed Stats */}
          <div className="pt-2 border-t border-white/[0.06] grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-xl bg-black/20 border border-white/[0.04]">
              <span className="text-base font-mono font-bold text-white block">
                {learningSummary.weeklyCompletions.labs}
              </span>
              <span className="text-[9px] font-mono text-slate-400 uppercase">Labs Completed</span>
            </div>
            <div className="p-2 rounded-xl bg-black/20 border border-white/[0.04]">
              <span className="text-base font-mono font-bold text-cyan-300 block">
                {learningSummary.weeklyCompletions.topics}
              </span>
              <span className="text-[9px] font-mono text-slate-400 uppercase">Topics Covered</span>
            </div>
            <div className="p-2 rounded-xl bg-black/20 border border-white/[0.04]">
              <span className="text-base font-mono font-bold text-emerald-300 block">
                {learningSummary.weeklyCompletions.revisions}
              </span>
              <span className="text-[9px] font-mono text-slate-400 uppercase">Revisions</span>
            </div>
          </div>
        </div>

        {/* Right Card: Spaced Revision Queue */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                  Spaced Revision Queue
                </h4>
              </div>
              <span className="text-[9px] font-mono text-slate-500 uppercase">
                Memory Decay Curve
              </span>
            </div>

            {/* Revision Items */}
            <div className="space-y-2">
              {revisionQueue.slice(0, 4).map((item) => {
                const isDueToday = item.retentionScore < 0.65;
                const isDueTomorrow = item.retentionScore >= 0.65 && item.retentionScore < 0.8;

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-white/[0.06] bg-black/20 hover:bg-white/[0.04] transition"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Priority Dot */}
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isDueToday ? "bg-rose-400 animate-pulse" : isDueTomorrow ? "bg-amber-400" : "bg-emerald-400"
                        }`}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-white truncate">{item.topic}</div>
                        <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2">
                          <span>{item.category || "Security"}</span>
                          <span>•</span>
                          <span>Retention: {Math.round(item.retentionScore * 100)}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Review Button */}
                    <button
                      type="button"
                      onClick={() => onStartReview(item.topic)}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono font-semibold transition shrink-0 cursor-pointer"
                    >
                      Review
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Next Recommended Learning Path */}
          {learningSummary.nextRecommendation && (
            <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-xs font-sans text-indigo-200">
              <span className="font-bold text-indigo-300 block text-[10px] font-mono uppercase tracking-wider mb-0.5">
                Next Recommendation:
              </span>
              {learningSummary.nextRecommendation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
