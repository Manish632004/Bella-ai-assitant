/**
 * Memory Confidence Engine
 * Calculates confidence scores (0.0 - 1.0) and ensures guesses are marked as uncertain.
 */

import { PersonalMemory } from "./types";

export class MemoryConfidence {
  /**
   * Calculate initial confidence based on source and phrasing.
   */
  public static calculateConfidence(params: {
    source: PersonalMemory["source"];
    isDirectQuote?: boolean;
    frequencyCount?: number;
  }): number {
    switch (params.source) {
      case "explicit_user":
        return params.isDirectQuote ? 0.98 : 0.92;
      case "recommendation_feedback":
        return 0.85;
      case "activity_pattern": {
        const count = params.frequencyCount || 1;
        // Scales from 0.60 to max 0.82 based on repeated patterns
        return Math.min(0.82, 0.60 + count * 0.05);
      }
      case "inferred_context":
      default:
        return 0.65;
    }
  }

  /**
   * Formats text using uncertainty-aware phrasing if confidence is below 0.80.
   */
  public static formatWithUncertainty(text: string, confidence: number): { text: string; isUncertain: boolean } {
    const cleaned = text.trim();
    if (confidence >= 0.80) {
      return { text: cleaned, isUncertain: false };
    }

    if (
      cleaned.toLowerCase().startsWith("user may") ||
      cleaned.toLowerCase().startsWith("user might") ||
      cleaned.toLowerCase().startsWith("user appears to")
    ) {
      return { text: cleaned, isUncertain: true };
    }

    if (cleaned.toLowerCase().startsWith("user prefers")) {
      return {
        text: cleaned.replace(/^user prefers/i, "User may prefer"),
        isUncertain: true
      };
    }

    if (cleaned.toLowerCase().startsWith("user likes")) {
      return {
        text: cleaned.replace(/^user likes/i, "User seems to like"),
        isUncertain: true
      };
    }

    return {
      text: `User may have an interest in: ${cleaned}`,
      isUncertain: true
    };
  }

  /**
   * Boosts confidence when a memory is reinforced through ongoing interactions.
   */
  public static reinforce(currentConfidence: number, currentReinforcements: number): { confidence: number; count: number } {
    const nextCount = currentReinforcements + 1;
    // Asymptotic boost toward 0.95
    const boosted = currentConfidence + (1.0 - currentConfidence) * 0.25;
    return {
      confidence: Math.min(0.96, Math.round(boosted * 100) / 100),
      count: nextCount
    };
  }
}
