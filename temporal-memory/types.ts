/**
 * Core Type Definitions for Temporal Session Memory System
 * 4-Layer Hierarchy: Active Context -> Session Memory -> Recent Memory (1-7d) -> Long-Term Memory
 */

export type TemporalLayer =
  | "active_context"   // Last few minutes (current conversation turns, recent actions)
  | "session_memory"   // Current day (working decisions, tasks completed, problems, temporary context)
  | "recent_memory"    // Previous 1-7 days (consolidated daily summaries, project momentum)
  | "long_term_memory"; // Permanent (user-approved preferences, identity, core goals)

export interface TemporalTurn {
  id: string;
  role: "user" | "model" | "system";
  text: string;
  timestamp: string; // ISO
  actionTaken?: string;
}

export interface TemporalMemoryItem {
  id: string;
  layer: TemporalLayer;
  sessionId: string;
  date: string; // YYYY-MM-DD
  title: string;
  summary: string;
  details?: string;
  decisions: string[];
  tasksCompleted: string[];
  problemsEncountered: string[];
  activeProject?: string;
  topicTags: string[];
  importance: number; // 0.1 - 1.0
  source: "conversation" | "action" | "task" | "project" | "daily_consolidation";
  createdAt: string; // ISO
  updatedAt: string; // ISO
  expiresAt?: string; // ISO (null for permanent long_term_memory)
}

export type RelativeTimeIntent =
  | "last_hour"
  | "earlier_today"
  | "today"
  | "yesterday"
  | "recent_days"
  | "continue_project"
  | "problems"
  | "decisions"
  | "completed_tasks"
  | "general_search";

export interface TemporalQuery {
  queryText: string;
  relativeIntent?: RelativeTimeIntent;
  targetDate?: string; // YYYY-MM-DD
  projectFilter?: string;
  limit?: number;
}

export interface MemoryRankingScore {
  recencyScore: number;       // 0.0 - 1.0
  relevanceScore: number;     // 0.0 - 1.0
  importanceScore: number;    // 0.0 - 1.0
  projectMatchScore: number;  // 0.0 - 1.0
  finalScore: number;         // 0.0 - 1.0
}

export interface RankedTemporalMemory {
  item: TemporalMemoryItem;
  score: MemoryRankingScore;
  matchedReason: string;
}

export interface TemporalPolicySettings {
  activeContextMaxTurns: number;       // e.g. 15 turns
  sessionMemoryExpiryHours: number;    // e.g. 24-48 hours
  recentMemoryRetentionDays: number;   // e.g. 30 days
  autoSummarizeIntervalMinutes: number; // e.g. 10 minutes
}
