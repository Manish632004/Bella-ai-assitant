/**
 * Visual Memory Manager
 * Converts camera observations into concise, privacy-safe text summaries
 * without permanently saving raw video frames.
 */

import { VisionSubject, VisualMemoryItem } from "./types";

export class VisualMemoryManager {
  /**
   * Formulates a structured visual memory item from an observation or "Remember this" prompt.
   */
  public static createVisualMemory(
    summary: string,
    subject: VisionSubject = "general",
    topicTags: string[] = []
  ): VisualMemoryItem {
    const now = new Date();
    // Visual context expires after 36 hours unless upgraded to long-term memory
    const expiresAt = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();

    const tags = Array.from(new Set(["visual_context", subject, ...topicTags]));

    return {
      id: `vis_mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: "visual_context",
      summary: summary.trim(),
      subject,
      timestamp: now.toISOString(),
      expiresAt,
      topicTags: tags
    };
  }

  /**
   * Formats visual memories for injection into AI system context.
   */
  public static formatVisualContext(items: VisualMemoryItem[]): string {
    if (items.length === 0) return "";
    return (
      "=== RECENT VISUAL CONTEXT (CAMERA OBSERVATIONS) ===\n" +
      items
        .map(
          item =>
            `[${item.timestamp} | ${item.subject.toUpperCase()}]\nSummary: ${item.summary}`
        )
        .join("\n---\n") +
      "\n================================================\n"
    );
  }
}
