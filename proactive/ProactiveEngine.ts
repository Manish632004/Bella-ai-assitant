import {
  ProactiveSettings,
  ProactiveSuggestion,
  UserContext,
  SuggestionFeedback,
  ProactiveLevel,
  PermissionState,
} from "./types";
import { EventBus } from "./EventBus";
import { PermissionManager, DEFAULT_PERMISSIONS } from "./PermissionManager";
import { FeedbackManager } from "./FeedbackManager";
import { ContextEngine } from "./ContextEngine";
import { ScoringEngine } from "./ScoringEngine";
import { TriggerEngine } from "./TriggerEngine";
import { NotificationManager } from "./NotificationManager";
import fs from "fs/promises";
import path from "path";

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  level: "MEDIUM",
  permissions: { ...DEFAULT_PERMISSIONS },
  quietHours: {
    enabled: true,
    start: "23:00",
    end: "08:00",
  },
  dailyBriefingEnabled: true,
  dailyReviewEnabled: false,
  cooldownMinutes: 15,
  maxSuggestionsPerDay: 8,
};

export class ProactiveEngine {
  private settings: ProactiveSettings = { ...DEFAULT_PROACTIVE_SETTINGS };
  private eventBus: EventBus;
  private permissionManager: PermissionManager;
  private feedbackManager: FeedbackManager;
  private contextEngine: ContextEngine;
  private scoringEngine: ScoringEngine;
  private triggerEngine: TriggerEngine;
  private notificationManager: NotificationManager;

  private settingsFile: string;
  private evalTimer: NodeJS.Timeout | null = null;
  private onSuggestionCallbacks = new Set<(suggestion: ProactiveSuggestion) => void>();

  constructor(baseDir?: string) {
    const dir = baseDir || process.cwd();
    this.settingsFile = path.join(dir, "proactive_settings.json");

    this.eventBus = EventBus.getInstance();
    this.permissionManager = new PermissionManager(this.settings.permissions);
    this.feedbackManager = new FeedbackManager(path.join(dir, "proactive_feedback.json"));
    this.contextEngine = new ContextEngine(path.join(dir, "proactive_data.json"));
    this.scoringEngine = new ScoringEngine(this.feedbackManager);
    this.triggerEngine = new TriggerEngine(this.scoringEngine, this.permissionManager);
    this.notificationManager = new NotificationManager();
  }

  public async init(): Promise<void> {
    await this.loadSettings();
    await this.feedbackManager.init();
    await this.contextEngine.init();

    // Start background evaluation loop (runs every 60 seconds)
    if (this.evalTimer) clearInterval(this.evalTimer);
    this.evalTimer = setInterval(() => {
      void this.runEvaluationCycle();
    }, 60000);

    // Initial evaluation after 5 seconds on startup
    setTimeout(() => {
      void this.runEvaluationCycle();
    }, 5000);

    console.log("[Proactive Engine] Initialized (Level: " + this.settings.level + ", Enabled: " + this.settings.enabled + ")");
  }

  public stop(): void {
    if (this.evalTimer) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }
  }

  public async runEvaluationCycle(): Promise<ProactiveSuggestion[]> {
    if (!this.settings.enabled || this.settings.level === "OFF") {
      return [];
    }

    try {
      const context = await this.contextEngine.getContext(this.settings);
      const candidates = this.triggerEngine.evaluateContext(context);

      const delivered: ProactiveSuggestion[] = [];
      for (const candidate of candidates) {
        const check = this.notificationManager.canDeliverSuggestion(candidate, this.settings);
        if (check.allowed) {
          this.notificationManager.recordDelivery(candidate);
          delivered.push(candidate);

          // Notify listeners (e.g. WebSocket bridge to client)
          for (const cb of this.onSuggestionCallbacks) {
            try {
              cb(candidate);
            } catch (err) {
              console.error("[Proactive Engine] Callback error:", err);
            }
          }

          // Deliver at most 1 suggestion per evaluation cycle to prevent overwhelming user
          break;
        }
      }

      return delivered;
    } catch (err) {
      console.error("[Proactive Engine] Error in evaluation cycle:", err);
      return [];
    }
  }

  public onSuggestion(callback: (suggestion: ProactiveSuggestion) => void): () => void {
    this.onSuggestionCallbacks.add(callback);
    return () => {
      this.onSuggestionCallbacks.delete(callback);
    };
  }

  public async getSettings(): Promise<ProactiveSettings> {
    return { ...this.settings };
  }

  public async updateSettings(patch: Partial<ProactiveSettings>): Promise<ProactiveSettings> {
    this.settings = {
      ...this.settings,
      ...patch,
      permissions: {
        ...this.settings.permissions,
        ...(patch.permissions || {}),
      },
      quietHours: {
        ...this.settings.quietHours,
        ...(patch.quietHours || {}),
      },
    };

    this.permissionManager.updatePermissions(this.settings.permissions);
    await this.saveSettings();
    return this.getSettings();
  }

  public getActiveSuggestions(): ProactiveSuggestion[] {
    return this.notificationManager.getActiveSuggestions();
  }

  public async recordFeedback(feedback: {
    suggestionId: string;
    action: "accepted" | "dismissed" | "snoozed" | "completed";
  }): Promise<void> {
    const active = this.getActiveSuggestions().find((s) => s.id === feedback.suggestionId);
    const category = active?.category || "tasks";
    const type = active?.type || "task_suggestion";

    if (feedback.action === "accepted" || feedback.action === "completed") {
      this.notificationManager.acceptSuggestion(feedback.suggestionId);
    } else if (feedback.action === "snoozed") {
      this.notificationManager.snoozeSuggestion(feedback.suggestionId, 60);
    } else {
      this.notificationManager.dismissSuggestion(feedback.suggestionId);
    }

    await this.feedbackManager.recordFeedback({
      suggestionId: feedback.suggestionId,
      category,
      type,
      action: feedback.action,
    });
  }

  public async getDailyBriefing(): Promise<{
    date: string;
    greeting: string;
    priorityTasks: string[];
    learningOpportunities: string[];
    projectCheckins: string[];
    availableSlots: string;
  }> {
    const context = await this.contextEngine.getContext(this.settings);
    const pendingTasks = context.tasks.filter((t) => t.status !== "completed");
    const topPriorities = pendingTasks.slice(0, 3).map((t) => t.title);

    const learning = context.learningTopics
      .filter((l) => l.retentionScore < 0.75)
      .map((l) => `${l.topic} (${Math.round((1 - l.retentionScore) * 100)}% decay)`);

    const projects = context.projects
      .filter((p) => p.status === "active")
      .map((p) => p.name);

    return {
      date: new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      greeting: "Good morning! Here is your daily focus briefing.",
      priorityTasks: topPriorities,
      learningOpportunities: learning,
      projectCheckins: projects,
      availableSlots: "Optimal focus window: 2:00 PM – 4:30 PM",
    };
  }

  public getContextEngine(): ContextEngine {
    return this.contextEngine;
  }

  public getEventBus(): EventBus {
    return this.eventBus;
  }

  private async loadSettings(): Promise<void> {
    try {
      const data = await fs.readFile(this.settingsFile, "utf-8");
      const parsed = JSON.parse(data);
      this.settings = {
        ...DEFAULT_PROACTIVE_SETTINGS,
        ...parsed,
        permissions: {
          ...DEFAULT_PROACTIVE_SETTINGS.permissions,
          ...(parsed.permissions || {}),
        },
        quietHours: {
          ...DEFAULT_PROACTIVE_SETTINGS.quietHours,
          ...(parsed.quietHours || {}),
        },
      };
      this.permissionManager.updatePermissions(this.settings.permissions);
    } catch {
      await this.saveSettings();
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      await fs.writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (err) {
      console.warn("[Proactive Engine] Error saving settings:", err);
    }
  }
}

// Export singleton instance for server
let engineInstance: ProactiveEngine | null = null;
export function getProactiveEngine(): ProactiveEngine {
  if (!engineInstance) {
    engineInstance = new ProactiveEngine();
  }
  return engineInstance;
}
