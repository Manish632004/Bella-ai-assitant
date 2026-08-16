import {
  UserContext,
  ProactiveSuggestion,
  SuggestionType,
  ProactiveCategory,
  SuggestionPriorityLevel,
  ActionProposal,
} from "./types";
import { ScoringEngine } from "./ScoringEngine";
import { PermissionManager } from "./PermissionManager";

export class TriggerEngine {
  private scoringEngine: ScoringEngine;
  private permissionManager: PermissionManager;

  constructor(scoringEngine: ScoringEngine, permissionManager: PermissionManager) {
    this.scoringEngine = scoringEngine;
    this.permissionManager = permissionManager;
  }

  public evaluateContext(context: UserContext): ProactiveSuggestion[] {
    const suggestions: ProactiveSuggestion[] = [];

    // 1. Task Deadlines & Priority Trigger
    if (this.permissionManager.isCategoryAllowed("tasks")) {
      this.checkTaskDeadlines(context, suggestions);
      this.checkUnfinishedPriorityTasks(context, suggestions);
    }

    // 2. Inactive Projects Trigger
    if (this.permissionManager.isCategoryAllowed("projects")) {
      this.checkInactiveProjects(context, suggestions);
    }

    // 3. Spaced Repetition & Learning Review Trigger
    if (this.permissionManager.isCategoryAllowed("learning")) {
      this.checkLearningRetention(context, suggestions);
    }

    // 4. Specialized Cybersecurity Trigger
    if (this.permissionManager.isCategoryAllowed("cybersecurity")) {
      this.checkCybersecurityMilestones(context, suggestions);
    }

    // 5. Calendar / Available Focus Window Trigger
    if (this.permissionManager.isCategoryAllowed("calendar")) {
      this.checkScheduleAndFocusWindows(context, suggestions);
    }

    // Sort by final score descending
    return suggestions.sort((a, b) => b.score.finalScore - a.score.finalScore);
  }

  private checkTaskDeadlines(context: UserContext, out: ProactiveSuggestion[]): void {
    const now = Date.now();
    for (const task of context.tasks) {
      if (task.status === "completed" || !task.dueDate) continue;

      const due = new Date(task.dueDate).getTime();
      const diffHours = (due - now) / 3600000;

      if (diffHours > 0 && diffHours <= 24) {
        // Approaching deadline (within 24 hours)
        const score = this.scoringEngine.calculateScore({
          relevance: 0.9,
          urgency: 0.9,
          importance: 0.85,
          confidence: 0.95,
          intrusiveness: 0.25,
          category: "tasks",
          key: `task-deadline-${task.id}`,
        });

        if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
          out.push({
            id: `sug-task-due-${task.id}`,
            type: "task_suggestion",
            category: "tasks",
            title: "Upcoming Task Deadline",
            message: `I noticed your task "${task.title}" is due soon (within ${Math.round(diffHours)} hours). Would you like to work on it now?`,
            explanation: `You are seeing this because "${task.title}" has an active deadline approaching in less than 24 hours.`,
            level: diffHours <= 6 ? "important" : "suggestion",
            score,
            sourceEvents: [`task_deadline_${task.id}`],
            status: "pending",
            createdAt: new Date().toISOString(),
            suggestedAction: {
              actionType: "custom",
              payload: { taskId: task.id, title: task.title },
              requiresConfirmation: false,
            },
          });
        }
      } else if (diffHours < 0 && diffHours > -72) {
        // Overdue task
        const score = this.scoringEngine.calculateScore({
          relevance: 0.95,
          urgency: 0.85,
          importance: 0.8,
          confidence: 0.95,
          intrusiveness: 0.2,
          category: "tasks",
          key: `task-overdue-${task.id}`,
        });

        if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
          out.push({
            id: `sug-task-overdue-${task.id}`,
            type: "task_suggestion",
            category: "tasks",
            title: "Pending Overdue Task",
            message: `"${task.title}" is currently pending past its due date. Would you like me to help you schedule time to complete it?`,
            explanation: `You are seeing this because the scheduled due date for "${task.title}" has passed and the task is still open.`,
            level: "important",
            score,
            sourceEvents: [`task_overdue_${task.id}`],
            status: "pending",
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  private checkUnfinishedPriorityTasks(context: UserContext, out: ProactiveSuggestion[]): void {
    const highPriority = context.tasks.filter((t) => t.status !== "completed" && (t.priority === "high" || t.priority === "critical"));
    if (highPriority.length > 0) {
      const topTask = highPriority[0];
      const ageDays = (Date.now() - new Date(topTask.createdAt).getTime()) / 86400000;

      if (ageDays >= 2) {
        const score = this.scoringEngine.calculateScore({
          relevance: 0.8,
          urgency: 0.65,
          importance: 0.85,
          confidence: 0.9,
          intrusiveness: 0.2,
          category: "tasks",
          key: `task-pending-priority-${topTask.id}`,
        });

        if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
          out.push({
            id: `sug-task-priority-${topTask.id}`,
            type: "task_suggestion",
            category: "tasks",
            title: "Priority Task Opportunity",
            message: `Your high-priority task "${topTask.title}" has been open for a couple of days. Would you like to resume it?`,
            explanation: `You are seeing this because "${topTask.title}" is marked as high priority and has been pending for ${Math.round(ageDays)} days.`,
            level: "suggestion",
            score,
            sourceEvents: [`task_high_priority_${topTask.id}`],
            status: "pending",
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  private checkInactiveProjects(context: UserContext, out: ProactiveSuggestion[]): void {
    const now = Date.now();
    for (const proj of context.projects) {
      if (proj.status !== "active") continue;
      const lastActive = new Date(proj.lastActiveAt).getTime();
      const inactiveDays = (now - lastActive) / 86400000;

      if (inactiveDays >= 3 && inactiveDays <= 14) {
        const score = this.scoringEngine.calculateScore({
          relevance: 0.75,
          urgency: 0.45,
          importance: 0.75,
          confidence: 0.85,
          intrusiveness: 0.15,
          category: "projects",
          key: `project-inactive-${proj.id}`,
        });

        if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
          out.push({
            id: `sug-project-inactive-${proj.id}`,
            type: "project_suggestion",
            category: "projects",
            title: "Project Progress Check-in",
            message: `Your project "${proj.name}" has been quiet for ${Math.round(inactiveDays)} days. Would you like to pick up where you left off?`,
            explanation: `You are seeing this because "${proj.name}" is an active goal that hasn't had logged progress in ${Math.round(inactiveDays)} days.`,
            level: "suggestion",
            score,
            sourceEvents: [`project_inactive_${proj.id}`],
            status: "pending",
            createdAt: new Date().toISOString(),
            suggestedAction: {
              actionType: "open_folder",
              payload: { path: "Desktop" },
              requiresConfirmation: false,
            },
          });
        }
      }
    }
  }

  private checkLearningRetention(context: UserContext, out: ProactiveSuggestion[]): void {
    const now = Date.now();
    for (const topic of context.learningTopics) {
      const daysSinceReview = (now - new Date(topic.lastReviewedAt).getTime()) / 86400000;

      // Spaced repetition review trigger: > 10 days since last review
      if (daysSinceReview >= 10 && topic.retentionScore < 0.85) {
        const score = this.scoringEngine.calculateScore({
          relevance: 0.8,
          urgency: 0.55,
          importance: 0.8,
          confidence: 0.9,
          intrusiveness: 0.2,
          category: "learning",
          key: `learning-review-${topic.id}`,
        });

        if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
          out.push({
            id: `sug-learning-review-${topic.id}`,
            type: "learning_suggestion",
            category: "learning",
            title: "Spaced Learning Revision",
            message: `You studied "${topic.topic}" ${Math.round(daysSinceReview)} days ago. Would you like a quick 5-minute refresher session?`,
            explanation: `You are seeing this because your spaced repetition review interval for "${topic.topic}" is due to reinforce memory retention.`,
            level: "suggestion",
            score,
            sourceEvents: [`learning_review_${topic.id}`],
            status: "pending",
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  private checkCybersecurityMilestones(context: UserContext, out: ProactiveSuggestion[]): void {
    const sqliReviewed = context.learningTopics.some((t) => t.topic.toLowerCase().includes("sql") && t.retentionScore >= 0.6);
    const hasXss = context.learningTopics.some((t) => t.topic.toLowerCase().includes("xss"));

    // If user has mastered SQL Injection fundamentals but hasn't practiced XSS yet
    if (sqliReviewed && !hasXss) {
      const score = this.scoringEngine.calculateScore({
        relevance: 0.85,
        urgency: 0.4,
        importance: 0.75,
        confidence: 0.85,
        intrusiveness: 0.15,
        category: "cybersecurity",
        key: "cyber-next-xss",
      });

      if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
        out.push({
          id: "sug-cyber-xss-next",
          type: "cybersecurity_suggestion",
          category: "cybersecurity",
          title: "Next Cybersecurity Topic",
          message: `Since you've made great progress on web security fundamentals, Cross-Site Scripting (XSS) would be a natural next topic. Would you like me to outline a quick guide?`,
          explanation: `You are seeing this because you completed SQL injection concepts and your learning profile indicates readiness for client-side web vulnerabilities.`,
          level: "suggestion",
          score,
          sourceEvents: ["cyber_curriculum_progression"],
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  private checkScheduleAndFocusWindows(context: UserContext, out: ProactiveSuggestion[]): void {
    const hour = new Date().getHours();
    // Daily planning window between 8:00 AM and 11:00 AM
    if (hour >= 8 && hour <= 11 && context.settings.dailyBriefingEnabled) {
      const pendingCount = context.tasks.filter((t) => t.status !== "completed").length;
      if (pendingCount > 0) {
        const score = this.scoringEngine.calculateScore({
          relevance: 0.75,
          urgency: 0.4,
          importance: 0.7,
          confidence: 0.8,
          intrusiveness: 0.2,
          category: "calendar",
          key: "daily-morning-plan",
        });

        if (this.scoringEngine.shouldSurface(score, context.settings.level)) {
          out.push({
            id: `sug-daily-plan-${new Date().toISOString().slice(0, 10)}`,
            type: "calendar_suggestion",
            category: "calendar",
            title: "Daily Focus Briefing",
            message: `Good morning! You have ${pendingCount} open task${pendingCount > 1 ? "s" : ""} for today. Would you like a quick summary of today's priorities?`,
            explanation: `You are seeing this during your morning planning window with active pending tasks.`,
            level: "suggestion",
            score,
            sourceEvents: ["morning_planning_window"],
            status: "pending",
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }
}
