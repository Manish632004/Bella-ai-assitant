import React, { useState } from "react";
import { X, FolderKanban, Plus, Sparkles, Calendar, Layers } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ProjectStatus } from "../../../proactive/types";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (projectData: {
    name: string;
    description: string;
    status: ProjectStatus;
    progressPercent: number;
    currentMilestone?: string;
    deadline?: string;
  }) => Promise<void>;
}

export function NewProjectModal({
  isOpen,
  onClose,
  onCreateProject,
}: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("Active");
  const [progressPercent, setProgressPercent] = useState<number>(10);
  const [currentMilestone, setCurrentMilestone] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      await onCreateProject({
        name: name.trim(),
        description: description.trim(),
        status,
        progressPercent,
        currentMilestone: currentMilestone.trim() || undefined,
        deadline: deadline.trim() || undefined,
      });
      setName("");
      setDescription("");
      setCurrentMilestone("");
      setDeadline("");
      onClose();
    } catch (err) {
      console.error("[NewProjectModal] Create project error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />

      <motion.form
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-lg p-6 rounded-3xl bg-slate-900 border border-white/15 shadow-2xl space-y-4 text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              <FolderKanban className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold font-mono uppercase text-white">
                Create New Project
              </h3>
              <p className="text-[10px] font-mono text-slate-400">
                Track milestones, progress &amp; priority deliverables
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl border border-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Project Name */}
        <div className="space-y-1">
          <label className="text-[10px] font-mono text-slate-400 uppercase">Project Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Red Team Tooling / Portfolio Rebuild"
            required
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
          />
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-[10px] font-mono text-slate-400 uppercase">Description &amp; Scope</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="High-level objectives, tech stack, and goals..."
            rows={2}
            className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-sans text-white focus:outline-none focus:border-cyan-400 resize-none"
          />
        </div>

        {/* Status & Progress Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-slate-400 uppercase">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
            >
              <option value="Active">Active</option>
              <option value="On Track">On Track</option>
              <option value="At Risk">At Risk</option>
              <option value="Blocked">Blocked</option>
              <option value="Completed">Completed</option>
              <option value="Paused">Paused</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono text-slate-400 uppercase">Initial Progress</label>
              <span className="text-[10px] font-mono text-cyan-300 font-bold">{progressPercent}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progressPercent}
              onChange={(e) => setProgressPercent(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer pt-1"
            />
          </div>
        </div>

        {/* Current Milestone & Target Deadline */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-slate-400 uppercase">Current Milestone</label>
            <input
              type="text"
              value={currentMilestone}
              onChange={(e) => setCurrentMilestone(e.target.value)}
              placeholder="e.g. Sprint 1 MVP"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono text-slate-400 uppercase">Target Deadline</label>
            <input
              type="text"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="e.g. End of Month"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold transition cursor-pointer disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Project"}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
