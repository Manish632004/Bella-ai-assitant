/**
 * Daily Summary Manager
 * Layer 3: RECENT MEMORY (Consolidated digests for previous 1–7 days)
 */

import { TemporalMemoryItem } from "./types";

export class DailySummaryManager {
  /**
   * Consolidates multiple session memories from a specific date into a unified daily digest.
   */
  public static consolidateDailySessions(
    dateStr: string,
    sessionItems: TemporalMemoryItem[]
  ): TemporalMemoryItem {
    const matching = sessionItems.filter(item => item.date === dateStr);

    const allDecisions = Array.from(new Set(matching.flatMap(m => m.decisions)));
    const allTasks = Array.from(new Set(matching.flatMap(m => m.tasksCompleted)));
    const allProblems = Array.from(new Set(matching.flatMap(m => m.problemsEncountered)));
    const allProjects = Array.from(new Set(matching.map(m => m.activeProject).filter(Boolean))) as string[];
    const allTags = Array.from(new Set(matching.flatMap(m => m.topicTags)));

    const now = new Date().toISOString();
    // Daily summary retained for 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    let summaryText = `Daily Summary for ${dateStr}: Completed ${allTasks.length} tasks and recorded ${allDecisions.length} decisions.`;
    if (allProjects.length > 0) {
      summaryText = `Worked on ${allProjects.join(", ")}. Completed: ${allTasks.slice(0, 3).join("; ") || "various sprint milestones"}.`;
    }

    return {
      id: `daily_${dateStr.replace(/-/g, "")}`,
      layer: "recent_memory",
      sessionId: `daily_summary_${dateStr}`,
      date: dateStr,
      title: `Daily Summary: ${dateStr}`,
      summary: summaryText,
      decisions: allDecisions,
      tasksCompleted: allTasks,
      problemsEncountered: allProblems,
      activeProject: allProjects[0],
      topicTags: allTags,
      importance: 0.85,
      source: "daily_consolidation",
      createdAt: now,
      updatedAt: now,
      expiresAt
    };
  }
}
