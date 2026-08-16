import React from "react";
import {
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Plus,
  TrendingUp,
} from "lucide-react";
import { ProjectItem, ProjectStatus } from "../../../proactive/types";

interface ActiveProjectsSectionProps {
  projects: ProjectItem[];
  onSelectProject?: (project: ProjectItem) => void;
  onAddProject: () => void;
}

const STATUS_CONFIG: Record<ProjectStatus, { label: string; style: string }> = {
  Active: { label: "Active", style: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  "On Track": { label: "On Track", style: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  "At Risk": { label: "At Risk", style: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  Blocked: { label: "Blocked", style: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  Completed: { label: "Completed", style: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  Paused: { label: "Paused", style: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
};

export function ActiveProjectsSection({
  projects,
  onSelectProject,
  onAddProject,
}: ActiveProjectsSectionProps) {
  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400">
            Active Projects
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] text-slate-300">
            {projects.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onAddProject}
          className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
      </div>

      {/* Project Grid */}
      {projects.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <FolderKanban className="w-6 h-6 mx-auto text-slate-500 mb-2" />
          <p className="text-xs font-mono text-slate-400">No active projects yet.</p>
          <button
            type="button"
            onClick={onAddProject}
            className="mt-3 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer"
          >
            + Create your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((project) => {
            const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.Active;

            return (
              <div
                key={project.id}
                onClick={() => onSelectProject && onSelectProject(project)}
                className="group relative flex flex-col justify-between p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.15] transition-all cursor-pointer shadow-sm"
              >
                <div>
                  {/* Title & Status */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-white/[0.05] text-slate-300 border border-white/10">
                        <FolderKanban className="w-3.5 h-3.5" />
                      </div>
                      <h4 className="text-sm font-semibold text-white/95 group-hover:text-cyan-300 transition-colors">
                        {project.name}
                      </h4>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase border ${statusCfg.style}`}
                    >
                      {statusCfg.label}
                    </span>
                  </div>

                  {/* Description */}
                  {project.description && (
                    <p className="text-xs font-sans text-slate-400 line-clamp-2 mb-3">
                      {project.description}
                    </p>
                  )}

                  {/* Current Milestone / Next Task */}
                  {project.currentMilestone && (
                    <div className="mb-3 p-2 rounded-xl bg-black/30 border border-white/[0.04] text-[11px] font-mono text-slate-300">
                      <span className="text-slate-500 uppercase tracking-wider block text-[9px] mb-0.5">
                        Current Milestone:
                      </span>
                      <span className="text-slate-200">{project.currentMilestone}</span>
                    </div>
                  )}
                </div>

                {/* Progress Bar & Meta */}
                <div className="space-y-1.5 pt-2 border-t border-white/[0.05]">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-400">Progress</span>
                    <span className="font-bold text-white">{project.progressPercent}%</span>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, project.progressPercent))}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
