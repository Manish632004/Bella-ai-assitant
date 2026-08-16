import { ProactiveScore, ProactiveLevel, ProactiveCategory } from "./types";
import { FeedbackManager } from "./FeedbackManager";

export class ScoringEngine {
  private feedbackManager: FeedbackManager;

  constructor(feedbackManager: FeedbackManager) {
    this.feedbackManager = feedbackManager;
  }

  /**
   * Thresholds for proactivity levels
   */
  public static getThreshold(level: ProactiveLevel): number {
    switch (level) {
      case "OFF":
        return 999.0; // Never surface
      case "LOW":
        return 0.78;  // Only critical/high-urgency items
      case "MEDIUM":
        return 0.50;  // Standard task/learning/project opportunities
      case "HIGH":
        return 0.30;  // More exploratory suggestions
      default:
        return 0.50;
    }
  }

  public calculateScore(
    params: {
      relevance: number;      // 0.0 - 1.0
      urgency: number;        // 0.0 - 1.0
      importance: number;     // 0.0 - 1.0
      confidence: number;     // 0.0 - 1.0
      intrusiveness?: number; // 0.0 - 1.0 (default 0.2)
      category: ProactiveCategory;
      key?: string;           // identifier for dismissal checks
    }
  ): ProactiveScore {
    const relevance = Math.max(0, Math.min(1, params.relevance));
    const urgency = Math.max(0, Math.min(1, params.urgency));
    const importance = Math.max(0, Math.min(1, params.importance));
    const confidence = Math.max(0, Math.min(1, params.confidence));
    const intrusiveness = Math.max(0, Math.min(1, params.intrusiveness ?? 0.2));

    // Base score calculation: weighted combination
    // Importance (35%) + Urgency (25%) + Relevance (25%) + Confidence (15%) - Intrusiveness penalty (20%)
    let raw = (
      importance * 0.35 +
      urgency * 0.25 +
      relevance * 0.25 +
      confidence * 0.15 -
      intrusiveness * 0.20
    );

    // Apply feedback weight for category
    const catWeight = this.feedbackManager.getCategoryWeight(params.category);
    raw *= catWeight;

    // Apply repeat dismissal penalty if key provided
    if (params.key) {
      const dismissals = this.feedbackManager.getDismissalCount(params.key);
      if (dismissals >= 3) {
        raw *= 0.5; // Halve the score if user dismissed 3+ times
      } else if (dismissals > 0) {
        raw *= (1 - dismissals * 0.15);
      }
    }

    const finalScore = Math.max(0, Math.min(1, raw));

    return {
      relevance,
      urgency,
      importance,
      confidence,
      intrusiveness,
      finalScore,
    };
  }

  public shouldSurface(score: ProactiveScore, level: ProactiveLevel): boolean {
    if (level === "OFF") return false;
    const threshold = ScoringEngine.getThreshold(level);
    return score.finalScore >= threshold;
  }
}
