/**
 * Types & Contracts for BELLA Proactive Intelligence System & Personal AI Dashboard
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
  estimatedMinutes?: number;
  dueDate?: string;
  projectId?: string;
  createdAt: string;
  updatedAt?: string;
}

export type ProjectStatus = "Active" | "On Track" | "At Risk" | "Blocked" | "Completed" | "Paused";

export interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  progressPercent: number;
  currentMilestone?: string;
  nextTask?: string;
  deadline?: string;
  lastActiveAt: string;
  tasksCount?: number;
  openTasksCount?: number;
}

export interface LearningTopic {
  id: string;
  topic: string;
  domain: "cybersecurity" | "programming" | "general";
  category?: string; // e.g. "Web Security", "Active Directory", "Linux"
  lastReviewedAt: string;
  retentionScore: number; // 0.0 - 1.0
  reviewCount: number;
  dueStatus?: "today" | "tomorrow" | "upcoming";
}

export interface CybersecurityProficiency {
  category: "Networking" | "Linux" | "Web Security" | "SOC" | "Active Directory" | "Cloud Security";
  proficiencyPercent: number;
  completedLabs: number;
  totalLabs: number;
  status: "active" | "improving" | "mastered";
}

export interface CalendarEventItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
}

export interface ActivityItem {
  id: string;
  title: string;
  type: "all" | "projects" | "learning" | "notes" | "tasks" | "ai";
  description?: string;
  timestamp: string;
  linkId?: string;
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

export interface DashboardSummary {
  greeting: {
    greetingText: string;
    subText: string;
    userName: string;
  };
  aiBriefing: {
    title: string;
    summary: string;
    reasoning: string;
    recommendedFocus: string;
    estimatedMinutes: number;
    actionLabel?: string;
    planDetails?: string[];
  };
  todayFocus: TaskItem[];
  activeProjects: ProjectItem[];
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
  taskStats: {
    today: number;
    upcoming: number;
    overdue: number;
    completed: number;
  };
  productivitySnapshot: {
    focusHours: string;
    tasksCompleted: number;
    labsCompleted: number;
    notesCreated: number;
  };
  recentActivity: ActivityItem[];
  recommendations: Array<{
    id: string;
    title: string;
    reason: string;
    category: ProactiveCategory;
    actionLabel?: string;
  }>;
}
