/**
 * Core Type Definitions for the Personal Intelligence & Context-Aware Companion Layer
 */

export type ContextSource =
  | "active_app"
  | "active_window"
  | "browser_page"
  | "screen_content"
  | "current_media"
  | "active_project"
  | "active_task"
  | "calendar"
  | "notes"
  | "search_history"
  | "recent_conversation"
  | "long_term_memory"
  | "current_activity"
  | "learning_progress"
  | "user_preferences";

export interface ContextPermissionMatrix {
  screen: boolean;      // Default: false
  microphone: boolean;  // Default: false
  camera: boolean;      // Default: false
  browser: boolean;     // Default: false
  files: boolean;       // Default: false
  calendar: boolean;    // Default: false
  activeApp: boolean;   // Default: true (for basic app-aware help)
  media: boolean;       // Default: true (for playback control)
  learning: boolean;    // Default: true (for curriculum tracking)
  projects: boolean;    // Default: true (for dashboard sync)
}

export type ActivityState =
  | "focus"
  | "coding"
  | "studying"
  | "media"
  | "gaming"
  | "meeting"
  | "idle"
  | "speaking"
  | "general";

export interface CurrentContextSnapshot {
  timestamp: string;
  activityState: ActivityState;
  activeApp?: string;
  activeWindow?: string;
  browserUrl?: string;
  browserTitle?: string;
  mediaPlaying?: {
    title?: string;
    artist?: string;
    source?: string;
    durationSeconds?: number;
    currentTimeSeconds?: number;
  };
  activeProject?: {
    id: string;
    name: string;
    milestone?: string;
    status: string;
    daysInactive?: number;
  };
  activeTask?: {
    id: string;
    title: string;
    priority: string;
  };
  screenContentSummary?: string;
  recentTopics: string[];
  recentErrors: string[];
}

export type MemoryCategory =
  | "identity"
  | "preference"
  | "interest"
  | "goal"
  | "project"
  | "learning"
  | "habit"
  | "workflow"
  | "recommendation"
  | "conversationContext";

export interface PersonalMemory {
  id: string;
  category: MemoryCategory;
  text: string;
  confidence: number;      // 0.0 - 1.0 (Never claim 100% certainty for inferred guesses)
  source: "explicit_user" | "inferred_context" | "activity_pattern" | "recommendation_feedback";
  importance: number;      // 0.1 - 1.0
  confirmedByUser?: boolean;
  topicTags: string[];
  createdAt: string;
  updatedAt: string;
  lastReinforcedAt: string;
  reinforcementCount: number;
  decayRate: number;       // 0.01 - 0.1 per day
  expiresAt?: string;
  isUncertain?: boolean;
}

export type CuriosityCategory =
  | "interest_discovery"
  | "preference_discovery"
  | "goal_discovery"
  | "knowledge_discovery";

export interface CuriosityQuestion {
  id: string;
  category: CuriosityCategory;
  question: string;
  contextSnippet: string;
  relevanceScore: number;       // 0.0 - 1.0
  confidenceScore: number;      // 0.0 - 1.0
  personalizationValue: number; // 0.0 - 1.0
  interruptionCost: number;     // 0.0 - 1.0
  finalScore: number;           // 0.0 - 1.0
  suggestedAction?: {
    type: "confirm_memory" | "create_note" | "open_resource" | "start_chat";
    label: string;
    payload?: any;
  };
  potentialMemoryPayoff: {
    category: MemoryCategory;
    template: string;
  };
  explanation: string;          // Transparent reason for "Why did you ask this?"
  createdAt: string;
}

export interface RecommendationItem {
  id: string;
  type: "anime" | "media" | "book" | "tool" | "learning_resource" | "project_step" | "general";
  title: string;
  description: string;
  reasoning: string;            // "Because you liked X and value Y..."
  matchConfidence: number;      // 0.0 - 1.0
  sourcePreferences: string[];
  uncertaintyDisclaimer?: string; // "You might enjoy this based on..."
  suggestedActionUrl?: string;
  status: "suggested" | "accepted" | "dismissed" | "snoozed";
  createdAt: string;
}

export interface ProactiveTimingPolicy {
  enabled: boolean;
  curiosityEnabled: boolean;
  automaticMemory: "OFF" | "LOW" | "MEDIUM" | "HIGH";
  recommendationsEnabled: boolean;
  voiceInitiationEnabled: boolean;
  minMinutesBetweenInteractions: number; // e.g. 15, 30, 60
  maxInteractionsPerHour: number;        // e.g. 1, 2, 4
  quietHours: {
    enabled: boolean;
    startHour: number; // e.g. 22 (10 PM)
    endHour: number;   // e.g. 8 (8 AM)
  };
  focusModeSuppression: boolean;
}

export type ProactiveState =
  | "idle"
  | "observing"
  | "thinking"
  | "curious"
  | "suggesting"
  | "listening"
  | "learning"
  | "remembering";

export interface UserFeedbackRecord {
  id: string;
  actionId: string;
  actionType: "question" | "recommendation" | "memory_confirm" | "project_alert";
  topicTag?: string;
  feedback: "accepted" | "dismissed" | "snoozed" | "never_ask_again";
  timestamp: string;
}

export interface PersonalityAdaptationState {
  responseLength: "concise" | "balanced" | "detailed";
  formality: "casual_warm" | "balanced" | "structured";
  humorLevel: "gentle" | "subtle" | "none";
  proactivityLevel: "low" | "balanced" | "high";
  learningPace: "step_by_step" | "comprehensive";
}
