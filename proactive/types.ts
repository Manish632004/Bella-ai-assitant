/**
 * Types & Contracts for BELLA Proactive Intelligence System
 */

export type ProactiveLevel = "OFF" | "LOW" | "MEDIUM" | "HIGH";

export type ProactiveCategory =
  | "tasks"
  | "projects"
  | "learning"
  | "calendar"
  | "coding"
  | "cybersecurity"
  | "files"
  | "browser"
  | "screen"
  | "mic"
  | "camera";

export type SuggestionType =
  | "task_suggestion"
  | "learning_suggestion"
  | "project_suggestion"
  | "knowledge_suggestion"
  | "file_suggestion"
  | "coding_suggestion"
  | "calendar_suggestion"
  | "cybersecurity_suggestion";

export type SuggestionPriorityLevel = "silent" | "suggestion" | "important" | "critical";

export type SuggestionStatus =
  | "pending"
  | "shown"
  | "accepted"
  | "dismissed"
  | "snoozed"
  | "expired";

export interface ActionProposal {
  actionType: "open_app" | "open_url" | "open_folder" | "create_note" | "run_command" | "custom";
  payload: Record<string, unknown>;
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
  affectedResource?: string;
}

export interface ProactiveScore {
  relevance: number;      // 0.0 - 1.0
  urgency: number;        // 0.0 - 1.0
  importance: number;     // 0.0 - 1.0
  confidence: number;     // 0.0 - 1.0
  intrusiveness: number;  // 0.0 - 1.0 (higher = more intrusive)
  finalScore: number;     // 0.0 - 1.0
}

export interface ProactiveSuggestion {
  id: string;
  type: SuggestionType;
  category: ProactiveCategory;
  title: string;
  message: string;
  explanation: string;
  level: SuggestionPriorityLevel;
  score: ProactiveScore;
  sourceEvents: string[];
  suggestedAction?: ActionProposal;
  status: SuggestionStatus;
  createdAt: string;
  expiresAt?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  category?: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "in_progress" | "completed";
  dueDate?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  status: "active" | "paused" | "completed";
  lastActiveAt: string;
  tasksCount?: number;
  openTasksCount?: number;
}

export interface LearningTopic {
  id: string;
  topic: string;
  domain: "cybersecurity" | "programming" | "general";
  lastReviewedAt: string;
  retentionScore: number; // 0.0 - 1.0
  reviewCount: number;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
}

export interface PermissionState {
  tasks: boolean;
  projects: boolean;
  learning: boolean;
  calendar: boolean;
  coding: boolean;
  cybersecurity: boolean;
  files: boolean;
  browser: boolean;
  screen: boolean;
  mic: boolean;
  camera: boolean;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string; // e.g. "22:00"
  end: string;   // e.g. "08:00"
}

export interface ProactiveSettings {
  enabled: boolean;
  level: ProactiveLevel;
  permissions: PermissionState;
  quietHours: QuietHoursConfig;
  dailyBriefingEnabled: boolean;
  dailyReviewEnabled: boolean;
  cooldownMinutes: number;
  maxSuggestionsPerDay: number;
}

export interface SuggestionFeedback {
  id: string;
  suggestionId: string;
  category: ProactiveCategory;
  type: SuggestionType;
  action: "accepted" | "dismissed" | "snoozed" | "completed" | "rejected";
  timestamp: string;
}

export interface ProactiveEvent<T = unknown> {
  id: string;
  type: string;
  category: ProactiveCategory;
  payload: T;
  timestamp: string;
}

export interface UserContext {
  currentTime: Date;
  currentApplication?: string;
  activeProject?: string;
  currentTask?: string;
  goals: string[];
  tasks: TaskItem[];
  projects: ProjectItem[];
  calendarEvents: CalendarEventItem[];
  learningTopics: LearningTopic[];
  memories: Array<{ id: string; category: string; text: string }>;
  settings: ProactiveSettings;
}
