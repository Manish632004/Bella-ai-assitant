/**
 * Preference & Interest Engine with Similarity Matching
 */

import { memoryManager } from "./MemoryManager";
import { PersonalMemory } from "./types";

export interface UserInterestProfile {
  topic: string;
  category: "anime" | "tech" | "music" | "cybersecurity" | "gaming" | "general";
  affinityScore: number; // 0.0 - 1.0
  subtopics: string[];
  lastObserved: string;
}

export class InterestEngine {
  private interestMap: Map<string, UserInterestProfile> = new Map();

  public recordInteraction(topic: string, category: UserInterestProfile["category"], subtopics: string[] = []): void {
    const key = topic.toLowerCase().trim();
    const existing = this.interestMap.get(key);
    const now = new Date().toISOString();

    if (existing) {
      existing.affinityScore = Math.min(1.0, existing.affinityScore + 0.15);
      existing.subtopics = Array.from(new Set([...existing.subtopics, ...subtopics]));
      existing.lastObserved = now;
    } else {
      this.interestMap.set(key, {
        topic,
        category,
        affinityScore: 0.5,
        subtopics,
        lastObserved: now
      });
    }
  }

  public getTopInterests(limit = 5): UserInterestProfile[] {
    return Array.from(this.interestMap.values())
      .sort((a, b) => b.affinityScore - a.affinityScore)
      .slice(0, limit);
  }

  public getInterest(topic: string): UserInterestProfile | undefined {
    return this.interestMap.get(topic.toLowerCase().trim());
  }
}

export class PreferenceEngine {
  /**
   * Extract potential preference statements from user text utterances.
   */
  public static extractPreferencesFromText(text: string): { category: "preference" | "interest"; statement: string; topics: string[] }[] {
    const results: { category: "preference" | "interest"; statement: string; topics: string[] }[] = [];
    const lower = text.toLowerCase();

    // Positive preferences
    const likeMatches = text.match(/(?:i really like|i love|i prefer|i enjoy|i like)\s+([^.!?]+)/i);
    if (likeMatches && likeMatches[1]) {
      const target = likeMatches[1].trim();
      if (target.length > 2 && target.length < 80) {
        results.push({
          category: "preference",
          statement: `User enjoys ${target}.`,
          topics: target.split(/[\s,]+/).filter(w => w.length > 3)
        });
      }
    }

    // Specific domain interests (Anime, Cybersecurity, Coding)
    if (lower.includes("anime") || lower.includes("manga")) {
      results.push({
        category: "interest",
        statement: `User follows anime and related storytelling media.`,
        topics: ["anime", "animation", "storytelling"]
      });
    }

    if (lower.includes("burp suite") || lower.includes("pentest") || lower.includes("cybersecurity") || lower.includes("ctf")) {
      results.push({
        category: "interest",
        statement: `User is actively practicing web penetration testing and cybersecurity.`,
        topics: ["cybersecurity", "pentest", "vulnerabilities"]
      });
    }

    if (lower.includes("ai agent") || lower.includes("local llm") || lower.includes("memory system")) {
      results.push({
        category: "interest",
        statement: `User is interested in AI agent architecture and local LLM systems.`,
        topics: ["ai_agents", "local_llm", "architecture"]
      });
    }

    return results;
  }
}

export class SimilarityEngine {
  /**
   * Token-based Jaccard similarity between two text snippets (0.0 to 1.0).
   */
  public static computeSimilarity(textA: string, textB: string): number {
    const tokensA = new Set(textA.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2));
    const tokensB = new Set(textB.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2));

    if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

    let intersectionCount = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersectionCount++;
    }

    const unionCount = new Set([...tokensA, ...tokensB]).size;
    return unionCount > 0 ? intersectionCount / unionCount : 0.0;
  }

  /**
   * Match current context against stored memories.
   */
  public static findRelevantMemories(contextStr: string, memories: PersonalMemory[], threshold = 0.2): { memory: PersonalMemory; score: number }[] {
    const matches: { memory: PersonalMemory; score: number }[] = [];

    for (const mem of memories) {
      const score = this.computeSimilarity(contextStr, mem.text);
      if (score >= threshold) {
        matches.push({ memory: mem, score });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }
}

export const interestEngine = new InterestEngine();
