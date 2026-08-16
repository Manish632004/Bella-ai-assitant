import React, { useState, useMemo } from "react";
import {
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Plus,
  TrendingUp,
  Trash2,
  Layers,
  Calendar,
  Check,
} from "lucide-react";
import { ProjectItem, ProjectStatus } from "../../../proactive/types";

interface ActiveProjectsSectionProps {
  projects: ProjectItem[];
  onSelectProject?: (project: ProjectItem) => void;
  onAddProject: () => void;
  onUpdateProgress?: (id: string, newProgress: number) => void;
  onUpdateStatus?: (id: string, newStatus: ProjectStatus) => void;
  onDeleteProject?: (id: string) => void;
  standalone?: boolean;
}

const NEXT_STATUS: Record<ProjectStatus, ProjectStatus> = {
  Active: "On Track",
  "On Track": "At Risk",
  "At Risk": "Blocked",
  Blocked: "Completed",
  Completed: "Paused",
  Paused: "Active",
};

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
  onUpdateProgress,
  onUpdateStatus,
  onDeleteProject,
  standalone = false,
}: ActiveProjectsSectionProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const filteredProjects = useMemo(() => {
    if (selectedStatus === "all") return projects;
    return projects.filter((p) => p.status.toLowerCase() === selectedStatus.toLowerCase());
  }, [projects, selectedStatus]);

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400">
            Active Projects &amp; Initiatives
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {projects.length} Total
          </span>
        </div>

        <button
          type="button"
          onClick={onAddProject}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-300 text-xs font-mono font-semibold transition cursor-pointer shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
      </div>

      {/* Standalone Filter Pills */}
      {standalone && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {["all", "Active", "On Track", "At Risk", "Blocked", "Completed"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setSelectedStatus(st)}
              className={`px-3 py-1 rounded-xl border text-[10px] font-mono uppercase tracking-wider transition cursor-pointer ${
                selectedStatus.toLowerCase() === st.toLowerCase()
                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-sm"
                  : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      )}

      {/* Project Grid */}
      {filteredProjects.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <FolderKanban className="w-6 h-6 mx-auto text-slate-500 mb-2" />
          <p className="text-xs font-mono text-slate-400">No projects found in this category.</p>
          <button
            type="button"
            onClick={onAddProject}
            className="mt-3 px-3.5 py-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-xs font-mono text-cyan-300 hover:bg-cyan-500/20 transition cursor-pointer"
          >
            + Create a project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProjects.map((project) => {
            const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.Active;

            return (
              <div
                key={project.id}
                className="group relative flex flex-col justify-between p-5 rounded-3xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.15] transition-all shadow-sm"
              >
                <div>
                  {/* Title & Status */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                        <FolderKanban className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-white/95 group-hover:text-cyan-300 transition-colors">
                          {project.name}
                        </h4>
                        {project.deadline && (
                          <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3 h-3" /> Due: {project.deadline}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onUpdateStatus) {
                            const next = NEXT_STATUS[project.status] || "Active";
                            onUpdateStatus(project.id, next);
                          }
                        }}
                        title="Click to cycle status (Active -> On Track -> At Risk -> Blocked -> Completed -> Paused)"
                        className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase border transition cursor-pointer hover:scale-105 active:scale-95 ${statusCfg.style}`}
                      >
                        {statusCfg.label} ⟳
                      </button>
                      {onDeleteProject && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProject(project.id);
                          }}
                          className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Delete project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  {project.description && (
                    <p className="text-xs font-sans text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                      {project.description}
                    </p>
                  )}

                  {/* Current Milestone / Next Task */}
                  {project.currentMilestone && (
                    <div className="mb-3 p-2.5 rounded-2xl bg-black/30 border border-white/[0.04] text-[11px] font-mono text-slate-300">
                      <span className="text-slate-500 uppercase tracking-wider block text-[9px] mb-0.5">
                        Current Milestone:
                      </span>
                      <span className="text-slate-200">{project.currentMilestone}</span>
                    </div>
                  )}
                </div>

                {/* Progress Bar & Quick Adjustments */}
                <div className="space-y-2 pt-3 border-t border-white/[0.05]">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-400">Completion</span>
                    <div className="flex items-center gap-2">
                      {onUpdateProgress && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => onUpdateProgress(project.id, Math.max(0, project.progressPercent - 10))}
                            className="px-1.5 py-0.2 rounded bg-white/5 hover:bg-white/15 text-slate-300"
                            title="-10%"
                          >
                            -10%
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateProgress(project.id, Math.min(100, project.progressPercent + 10))}
                            className="px-1.5 py-0.2 rounded bg-white/5 hover:bg-white/15 text-cyan-300"
                            title="+10%"
                          >
                            +10%
                          </button>
                        </div>
                      )}
                      <span className="font-bold text-white">{project.progressPercent}%</span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-500"
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
