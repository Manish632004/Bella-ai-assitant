/**
 * Memory Retrieval & Relative Time Query Engine
 * Parses relative temporal expressions ("an hour ago", "yesterday", "continue where we stopped")
 * and ranks candidates by Recency, Relevance, Importance, and Project Context.
 */

import {
  MemoryRankingScore,
  RankedTemporalMemory,
  RelativeTimeIntent,
  TemporalMemoryItem,
  TemporalQuery
} from "./types";

export class MemoryRetrievalEngine {
  /**
   * Parse relative time intent from natural user query text.
   */
  public static parseIntent(queryText: string): { intent: RelativeTimeIntent; targetDate?: string } {
    const lower = queryText.toLowerCase().trim();

    // 1. "an hour ago" / "earlier"
    if (lower.includes("hour ago") || lower.includes("an hour ago") || lower.includes("few minutes ago") || lower.includes("just now")) {
      return { intent: "last_hour" };
    }

    // 2. "yesterday"
    if (lower.includes("yesterday")) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { intent: "yesterday", targetDate: d.toISOString().split("T")[0] };
    }

    // 3. "continue from where we stopped" / "continue yesterday" / "continue what we were doing"
    if (lower.includes("continue") || lower.includes("resume") || lower.includes("where we stopped") || lower.includes("where we left off")) {
      return { intent: "continue_project" };
    }

    // 4. "what did we decide" / "decisions"
    if (lower.includes("decide") || lower.includes("decision") || lower.includes("agreed on")) {
      return { intent: "decisions" };
    }

    // 5. "what was the problem" / "issue" / "bug" / "error"
    if (lower.includes("problem") || lower.includes("issue") || lower.includes("error") || lower.includes("blocker") || lower.includes("bug")) {
      return { intent: "problems" };
    }

    // 6. "what did we finish today" / "tasks completed"
    if (lower.includes("finish") || lower.includes("completed") || lower.includes("done today") || lower.includes("accomplished")) {
      return { intent: "completed_tasks" };
    }

    // 7. "earlier today" / "today"
    if (lower.includes("earlier") || lower.includes("today")) {
      return { intent: "earlier_today", targetDate: new Date().toISOString().split("T")[0] };
    }

    // 8. "recent days" / "past week"
    if (lower.includes("past week") || lower.includes("recent days") || lower.includes("last week")) {
      return { intent: "recent_days" };
    }

    return { intent: "general_search" };
  }

  /**
   * Search and rank temporal memories.
   */
  public static retrieveMemories(
    items: TemporalMemoryItem[],
    query: TemporalQuery,
    currentProject?: string
  ): RankedTemporalMemory[] {
    const { intent, targetDate } = query.relativeIntent 
      ? { intent: query.relativeIntent, targetDate: query.targetDate }
      : this.parseIntent(query.queryText);

    const now = Date.now();
    const ranked: RankedTemporalMemory[] = [];
    const queryTokens = new Set(query.queryText.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));

    for (const item of items) {
      let matchedReason = "Relevant context";
      let intentMatch = false;

      const itemCreatedMs = new Date(item.createdAt).getTime();
      const ageHours = (now - itemCreatedMs) / (1000 * 60 * 60);

      // Intent-specific filtering & matching
      switch (intent) {
        case "last_hour":
          if (ageHours <= 2.5) {
            intentMatch = true;
            matchedReason = "Occurred within the last 1–2 hours";
          }
          break;

        case "yesterday": {
          const yesterdayStr = targetDate || new Date(now - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
          if (item.date === yesterdayStr) {
            intentMatch = true;
            matchedReason = `Activity logged yesterday (${yesterdayStr})`;
          }
          break;
        }

        case "continue_project":
          if (item.tasksCompleted.length > 0 || (currentProject && item.activeProject === currentProject)) {
            intentMatch = true;
            matchedReason = `Most recent active project milestone for ${item.activeProject || "current workspace"}`;
          }
          break;

        case "decisions":
          if (item.decisions.length > 0) {
            intentMatch = true;
            matchedReason = `Contains ${item.decisions.length} recorded decision(s)`;
          }
          break;

        case "problems":
          if (item.problemsEncountered.length > 0) {
            intentMatch = true;
            matchedReason = `Contains ${item.problemsEncountered.length} encountered problem(s)`;
          }
          break;

        case "completed_tasks":
          if (item.tasksCompleted.length > 0) {
            intentMatch = true;
            matchedReason = `Contains ${item.tasksCompleted.length} completed task(s)`;
          }
          break;

        case "earlier_today": {
          const todayStr = new Date().toISOString().split("T")[0];
          if (item.date === todayStr) {
            intentMatch = true;
            matchedReason = "Occurred earlier today";
          }
          break;
        }

        default:
          intentMatch = true;
          break;
      }

      // Compute Multi-Factor Ranking Score
      // 1. Recency Score (0.0 to 1.0, decays over 7 days)
      const ageDays = ageHours / 24;
      const recencyScore = Math.max(0.1, 1.0 - Math.min(1.0, ageDays / 7));

      // 2. Relevance Score (Jaccard similarity between query tokens and item text)
      const itemTokens = new Set(
        `${item.title} ${item.summary} ${item.decisions.join(" ")} ${item.tasksCompleted.join(" ")} ${item.topicTags.join(" ")}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
      );

      let commonCount = 0;
      for (const t of queryTokens) {
        if (itemTokens.has(t)) commonCount++;
      }
      const relevanceScore = queryTokens.size > 0 ? Math.min(1.0, (commonCount / queryTokens.size) * (intentMatch ? 1.3 : 1.0)) : (intentMatch ? 0.8 : 0.4);

      // 3. Importance Score
      const importanceScore = item.importance || 0.5;

      // 4. Project Context Match Score
      const projectMatchScore = currentProject && item.activeProject && item.activeProject.toLowerCase() === currentProject.toLowerCase() ? 1.0 : 0.2;

      // Weighted Final Score with intent boost
      const baseScore = (recencyScore * 0.25) + (relevanceScore * 0.35) + (importanceScore * 0.20) + (projectMatchScore * 0.20);
      const finalScore = Math.round(
        (intentMatch ? Math.min(1.0, baseScore + 0.30) : baseScore) * 100
      ) / 100;

      if (finalScore >= 0.25 || intentMatch) {
        ranked.push({
          item,
          score: {
            recencyScore: Math.round(recencyScore * 100) / 100,
            relevanceScore: Math.round(relevanceScore * 100) / 100,
            importanceScore: Math.round(importanceScore * 100) / 100,
            projectMatchScore: Math.round(projectMatchScore * 100) / 100,
            finalScore
          },
          matchedReason
        });
      }
    }

    // Sort by highest final score
    ranked.sort((a, b) => b.score.finalScore - a.score.finalScore);

    const limit = query.limit || 5;
    return ranked.slice(0, limit);
  }
}
