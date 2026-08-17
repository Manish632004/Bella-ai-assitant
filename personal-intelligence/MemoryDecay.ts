/**
 * Memory Decay & Expiration Engine
 * Simulates cognitive forgetting for unreinforced low-confidence observations.
 */

import { PersonalMemory } from "./types";

export class MemoryDecay {
  /**
   * Evaluates memory decay over time.
   * Explicit core identity / confirmed preferences do not decay.
   * Inferred, unconfirmed observations decay over 14–30 days unless reinforced.
   */
  public static evaluateDecay(memory: PersonalMemory, currentTimeMs: number = Date.now()): PersonalMemory | null {
    // Confirmed or explicit core memories do not decay
    if (memory.confirmedByUser || memory.source === "explicit_user" || memory.category === "identity") {
      return memory;
    }

    const lastReinforcedMs = new Date(memory.lastReinforcedAt || memory.createdAt).getTime();
    const elapsedDays = Math.max(0, (currentTimeMs - lastReinforcedMs) / (1000 * 60 * 60 * 24));

    if (elapsedDays < 1) {
      return memory;
    }

    // Daily decay rate (defaults to 0.02 = 2% per day)
    const decayFactor = Math.pow(1 - (memory.decayRate || 0.02), elapsedDays);
    const updatedConfidence = Math.round(memory.confidence * decayFactor * 100) / 100;

    // If confidence drops below 0.35, prune/forget it
    if (updatedConfidence < 0.35) {
      return null;
    }

    return {
      ...memory,
      confidence: updatedConfidence
    };
  }

  /**
   * Applies decay across a list of memories, removing decayed ones.
   */
  public static pruneDecayed(memories: PersonalMemory[]): PersonalMemory[] {
    const now = Date.now();
    const alive: PersonalMemory[] = [];

    for (const mem of memories) {
      const evaluated = this.evaluateDecay(mem, now);
      if (evaluated !== null) {
        alive.push(evaluated);
      }
    }

    return alive;
  }
}
