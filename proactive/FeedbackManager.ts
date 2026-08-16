import { SuggestionFeedback, ProactiveCategory, SuggestionType } from "./types";
import fs from "fs/promises";
import path from "path";

export interface CategoryWeights {
  tasks: number;
  projects: number;
  learning: number;
  calendar: number;
  coding: number;
  cybersecurity: number;
  files: number;
  browser: number;
  screen: number;
  mic: number;
  camera: number;
}

const DEFAULT_WEIGHTS: CategoryWeights = {
  tasks: 1.0,
  projects: 1.0,
  learning: 1.0,
  calendar: 1.0,
  coding: 1.0,
  cybersecurity: 1.1, // slightly elevated for cybersecurity focus
  files: 0.8,
  browser: 0.8,
  screen: 0.8,
  mic: 0.8,
  camera: 0.8,
};

export class FeedbackManager {
  private feedbackHistory: SuggestionFeedback[] = [];
  private weights: CategoryWeights = { ...DEFAULT_WEIGHTS };
  private dismissalCounts = new Map<string, number>(); // key: category or suggestion title/type -> count
  private persistenceFile: string;

  constructor(filePath?: string) {
    this.persistenceFile = filePath || path.join(process.cwd(), "proactive_feedback.json");
  }

  public async init(): Promise<void> {
    try {
      const data = await fs.readFile(this.persistenceFile, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed.history)) {
        this.feedbackHistory = parsed.history;
      }
      if (parsed.weights) {
        this.weights = { ...DEFAULT_WEIGHTS, ...parsed.weights };
      }
      if (parsed.dismissals && typeof parsed.dismissals === "object") {
        for (const [k, v] of Object.entries(parsed.dismissals)) {
          this.dismissalCounts.set(k, Number(v) || 0);
        }
      }
    } catch {
      // File does not exist yet or parse error, use defaults
    }
  }

  public async recordFeedback(feedback: Omit<SuggestionFeedback, "id" | "timestamp">): Promise<void> {
    const item: SuggestionFeedback = {
      id: Math.random().toString(36).substring(2, 11),
      ...feedback,
      timestamp: new Date().toISOString(),
    };

    this.feedbackHistory.push(item);
    if (this.feedbackHistory.length > 200) {
      this.feedbackHistory = this.feedbackHistory.slice(-100);
    }

    // Dynamic weight adjustment
    const cat = feedback.category;
    if (feedback.action === "accepted" || feedback.action === "completed") {
      this.weights[cat] = Math.min(1.5, (this.weights[cat] || 1.0) + 0.05);
      // Reset or decrease dismissal penalty
      const curDismiss = this.dismissalCounts.get(cat) || 0;
      if (curDismiss > 0) this.dismissalCounts.set(cat, Math.max(0, curDismiss - 1));
    } else if (feedback.action === "dismissed" || feedback.action === "rejected") {
      const current = (this.dismissalCounts.get(cat) || 0) + 1;
      this.dismissalCounts.set(cat, current);

      // Rule: If dismissed 3+ times, reduce future weight
      if (current >= 3) {
        this.weights[cat] = Math.max(0.4, (this.weights[cat] || 1.0) - 0.15);
      } else {
        this.weights[cat] = Math.max(0.6, (this.weights[cat] || 1.0) - 0.05);
      }
    }

    await this.persist();
  }

  public getCategoryWeight(category: ProactiveCategory): number {
    return this.weights[category] ?? 1.0;
  }

  public getDismissalCount(key: string): number {
    return this.dismissalCounts.get(key) || 0;
  }

  public getFeedbackHistory(): SuggestionFeedback[] {
    return [...this.feedbackHistory];
  }

  public async resetFeedback(): Promise<void> {
    this.feedbackHistory = [];
    this.weights = { ...DEFAULT_WEIGHTS };
    this.dismissalCounts.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const payload = {
        history: this.feedbackHistory,
        weights: this.weights,
        dismissals: Object.fromEntries(this.dismissalCounts.entries()),
      };
      await fs.writeFile(this.persistenceFile, JSON.stringify(payload, null, 2), "utf-8");
    } catch (err) {
      console.warn("[FeedbackManager] Failed to persist feedback:", err);
    }
  }
}
