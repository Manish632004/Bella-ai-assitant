/**
 * Memory Decay & Expiration Manager for Temporal Layers
 */

import { TemporalMemoryItem } from "./types";

export class MemoryDecayManager {
  /**
   * Prunes items that have passed their expiration timestamp.
   */
  public static pruneExpired(items: TemporalMemoryItem[], currentTimeMs: number = Date.now()): {
    active: TemporalMemoryItem[];
    prunedCount: number;
  } {
    const active: TemporalMemoryItem[] = [];
    let prunedCount = 0;

    for (const item of items) {
      // Long-term memories never expire automatically
      if (item.layer === "long_term_memory" || !item.expiresAt) {
        active.push(item);
        continue;
      }

      const expiryMs = new Date(item.expiresAt).getTime();
      if (currentTimeMs < expiryMs) {
        active.push(item);
      } else {
        prunedCount++;
      }
    }

    return { active, prunedCount };
  }
}
