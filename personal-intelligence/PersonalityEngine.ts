/**
 * Personality Adaptation, Explainability, Privacy Controller & Feedback Engine
 */

import fs from "fs/promises";
import { dataFile } from "../server_paths";
import { memoryManager } from "./MemoryManager";
import { PersonalityAdaptationState, UserFeedbackRecord } from "./types";

const FEEDBACK_FILE = dataFile("personal_feedback.json");

export class FeedbackEngine {
  private feedbackLog: UserFeedbackRecord[] = [];
  private mutedTopicTags: Set<string> = new Set();
  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const data = await fs.readFile(FEEDBACK_FILE, "utf-8");
      this.feedbackLog = JSON.parse(data);
      this.feedbackLog
        .filter(f => f.feedback === "never_ask_again" && f.topicTag)
        .forEach(f => this.mutedTopicTags.add(f.topicTag!.toLowerCase()));
    } catch {
      this.feedbackLog = [];
      await this.save();
    }
    this.initialized = true;
  }

  public async recordFeedback(record: Omit<UserFeedbackRecord, "id" | "timestamp">): Promise<UserFeedbackRecord> {
    await this.init();
    const entry: UserFeedbackRecord = {
      ...record,
      id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString()
    };

    if (entry.feedback === "never_ask_again" && entry.topicTag) {
      this.mutedTopicTags.add(entry.topicTag.toLowerCase());
    }

    this.feedbackLog.unshift(entry);
    if (this.feedbackLog.length > 200) {
      this.feedbackLog.pop();
    }
    await this.save();
    return entry;
  }

  public isTopicMuted(topicTag?: string): boolean {
    if (!topicTag) return false;
    return this.mutedTopicTags.has(topicTag.toLowerCase().trim());
  }

  public async unblockTopic(topicTag: string): Promise<void> {
    await this.init();
    this.mutedTopicTags.delete(topicTag.toLowerCase().trim());
    this.feedbackLog = this.feedbackLog.filter(
      f => !(f.topicTag?.toLowerCase() === topicTag.toLowerCase() && f.feedback === "never_ask_again")
    );
    await this.save();
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(FEEDBACK_FILE, JSON.stringify(this.feedbackLog, null, 2), "utf-8");
    } catch (err) {
      console.error("[FeedbackEngine] Save error:", err);
    }
  }
}

export class ExplainabilityEngine {
  /**
   * Generates a conversational explanation of why a proactive action was initiated.
   */
  public static explainAction(details: {
    type: "question" | "recommendation" | "project_checkin";
    title?: string;
    contextSnippet?: string;
    matchedMemories?: string[];
    explanation?: string;
  }): string {
    if (details.explanation) {
      return details.explanation;
    }

    if (details.type === "question") {
      return `I noticed you were working with ${details.contextSnippet || "this topic"}, and asking helps me understand your preferences for future suggestions.`;
    }

    if (details.type === "recommendation") {
      const memStr = details.matchedMemories && details.matchedMemories.length > 0
        ? ` because you previously liked ${details.matchedMemories[0]}`
        : "";
      return `I recommended "${details.title || "this"}"${memStr} and thought it would match your current interests.`;
    }

    return "This was suggested to help you maintain momentum on your current active goals.";
  }
}

export class PrivacyController {
  private static SENSITIVE_KEYWORDS = [
    "password", "secret", "token", "ssn", "credit card", "bank", "api_key", "bearer"
  ];

  /**
   * Sanitizes text to prevent accidental ingestion of private credentials into memories.
   */
  public static sanitizeInput(text: string): { safe: boolean; sanitized: string } {
    const lower = text.toLowerCase();
    for (const kw of this.SENSITIVE_KEYWORDS) {
      if (lower.includes(kw)) {
        return {
          safe: false,
          sanitized: text.replace(new RegExp(kw, "gi"), "[REDACTED]")
        };
      }
    }
    return { safe: true, sanitized: text };
  }

  /**
   * Atomic total wipe of all persistent personal intelligence data.
   */
  public static async wipeAllPersonalData(): Promise<{ success: boolean; message: string }> {
    try {
      await memoryManager.clearCategory("identity");
      await memoryManager.clearCategory("preference");
      await memoryManager.clearCategory("interest");
      await memoryManager.clearCategory("goal");
      await memoryManager.clearCategory("learning");
      await memoryManager.clearCategory("workflow");
      return { success: true, message: "All personal memories and intelligence traces permanently deleted." };
    } catch (err: any) {
      return { success: false, message: `Wipe failed: ${err.message}` };
    }
  }
}

export class PersonalityEngine {
  private state: PersonalityAdaptationState = {
    responseLength: "balanced",
    formality: "casual_warm",
    humorLevel: "gentle",
    proactivityLevel: "balanced",
    learningPace: "step_by_step"
  };

  public getState(): PersonalityAdaptationState {
    return { ...this.state };
  }

  public updateState(patch: Partial<PersonalityAdaptationState>): PersonalityAdaptationState {
    this.state = { ...this.state, ...patch };
    return this.getState();
  }

  public getPromptGuidance(): string {
    return `[COMMUNICATION STYLE ADAPTATION]\n` +
      `- Length: ${this.state.responseLength} responses\n` +
      `- Tone: ${this.state.formality} with ${this.state.humorLevel} humor\n` +
      `- Learning Pace: ${this.state.learningPace}\n`;
  }
}

export const feedbackEngine = new FeedbackEngine();
export const personalityEngine = new PersonalityEngine();
