import {
  DashboardSummary,
  TaskItem,
  ProjectItem,
  LearningTopic,
  ActivityItem,
  CybersecurityProficiency,
} from "../../../proactive/types";

export type DashboardTab =
  | "overview"
  | "tasks"
  | "projects"
  | "learning"
  | "cybersecurity"
  | "activity"
  | "settings";

export type DashboardDensity = "compact" | "comfortable" | "spacious";

export interface DashboardPreferences {
  density: DashboardDensity;
  showBriefing: boolean;
  showFocus: boolean;
  showProjects: boolean;
  showLearning: boolean;
  showCybersecurity: boolean;
  showActivity: boolean;
  showCharacterPanel: boolean;
}

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  density: "comfortable",
  showBriefing: true,
  showFocus: true,
  showProjects: true,
  showLearning: true,
  showCybersecurity: true,
  showActivity: true,
  showCharacterPanel: true,
};
