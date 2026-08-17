/**
 * Natural Curiosity Engine & Contextual Question Generator
 * Evaluates candidate questions using strict quality scoring:
 * Score = (Relevance * 0.35 + Confidence * 0.25 + PersonalizationValue * 0.40) - InterruptionCost
 */

import { memoryManager } from "./MemoryManager";
import { CurrentContextSnapshot, CuriosityQuestion } from "./types";

export class QuestionGenerator {
  /**
   * Generates candidate curiosity questions based on active context and stored memories.
   */
  public static async generateCandidates(context: CurrentContextSnapshot): Promise<CuriosityQuestion[]> {
    const candidates: CuriosityQuestion[] = [];
    const memories = await memoryManager.getMemories();
    const now = new Date().toISOString();

    const app = (context.activeApp || "").toLowerCase();
    const win = (context.activeWindow || "").toLowerCase();
    const title = (context.browserTitle || "").toLowerCase();
    const combined = `${app} ${win} ${title} ${context.recentTopics.join(" ")}`;

    // 1. Media / Anime / Show Discovery
    if (context.activityState === "media" || combined.includes("youtube") || combined.includes("anime") || combined.includes("crunchyroll")) {
      const showName = context.mediaPlaying?.title || title.split("-")[0]?.trim() || "this show";
      candidates.push({
        id: `cur_${Date.now()}_anime`,
        category: "interest_discovery",
        question: `Hey, I noticed you're checking out ${showName}. What do you like most about it — the story, characters, or art style?`,
        contextSnippet: `User is watching media: "${showName}"`,
        relevanceScore: 0.88,
        confidenceScore: 0.82,
        personalizationValue: 0.90,
        interruptionCost: 0.20, // Low cost during media watching
        finalScore: 0.0,
        explanation: `You're currently watching ${showName}, and learning what storytelling elements you value helps me recommend matching titles later.`,
        potentialMemoryPayoff: {
          category: "preference",
          template: `User values {response} in entertainment and media.`
        },
        createdAt: now
      });
    }

    // 2. Cybersecurity / Web Pentesting Goal Discovery
    if (combined.includes("burp") || combined.includes("sql") || combined.includes("xss") || combined.includes("csrf") || combined.includes("pentest")) {
      candidates.push({
        id: `cur_${Date.now()}_cyber`,
        category: "goal_discovery",
        question: "You've been studying web security vulnerabilities quite a bit! Are you preparing for a certification (like OSCP/CEH) or building practical pentesting skills?",
        contextSnippet: `Active study on web security / Burp Suite`,
        relevanceScore: 0.92,
        confidenceScore: 0.85,
        personalizationValue: 0.95,
        interruptionCost: 0.25,
        finalScore: 0.0,
        explanation: "You've spent time learning web vulnerabilities; understanding your end goal helps tailor upcoming labs and study paths.",
        potentialMemoryPayoff: {
          category: "goal",
          template: `User's cybersecurity objective is {response}.`
        },
        createdAt: now
      });
    }

    // 3. Repeated Coding Errors / Knowledge Discovery
    if (context.recentErrors.length >= 2 || (context.activityState === "coding" && combined.includes("error"))) {
      const errorSample = context.recentErrors[0] || "this issue";
      candidates.push({
        id: `cur_${Date.now()}_error`,
        category: "knowledge_discovery",
        question: "I noticed you ran into that error a couple of times. Would you like me to explain the root cause and save a quick troubleshooting note for next time?",
        contextSnippet: `Repeated build/runtime errors detected`,
        relevanceScore: 0.95,
        confidenceScore: 0.90,
        personalizationValue: 0.85,
        interruptionCost: 0.15, // Helpful assistance during blockers
        finalScore: 0.0,
        explanation: "You ran into the same error multiple times; saving the resolution note will prevent future debugging delays.",
        potentialMemoryPayoff: {
          category: "workflow",
          template: `Resolution pattern for ${errorSample}.`
        },
        createdAt: now
      });
    }

    // 4. AI Agent / Architecture Exploration
    if (combined.includes("agent") || combined.includes("llm") || combined.includes("model")) {
      candidates.push({
        id: `cur_${Date.now()}_agent`,
        category: "preference_discovery",
        question: "You've been exploring AI agent systems lately. Do you prefer fully autonomous background task agents or voice-first interactive companions?",
        contextSnippet: `Researching AI agent architectures`,
        relevanceScore: 0.85,
        confidenceScore: 0.80,
        personalizationValue: 0.88,
        interruptionCost: 0.30,
        finalScore: 0.0,
        explanation: "Understanding your preferred agent interaction paradigm helps personalize how Bella communicates with you.",
        potentialMemoryPayoff: {
          category: "preference",
          template: `User prefers {response} AI agent architectures.`
        },
        createdAt: now
      });
    }

    return candidates;
  }
}

export class CuriosityEngine {
  /**
   * Evaluate candidates and return the highest quality curiosity question, or null if below threshold.
   */
  public async evaluateBestQuestion(
    context: CurrentContextSnapshot,
    qualityThreshold = 0.55
  ): Promise<CuriosityQuestion | null> {
    // Suppress curiosity during meetings or focus mode
    if (context.activityState === "meeting" || context.activityState === "speaking") {
      return null;
    }

    const candidates = await QuestionGenerator.generateCandidates(context);
    if (candidates.length === 0) return null;

    for (const q of candidates) {
      // Calculate final score
      q.finalScore = Math.round(
        ((q.relevanceScore * 0.35 + q.confidenceScore * 0.25 + q.personalizationValue * 0.40) - q.interruptionCost) * 100
      ) / 100;
    }

    // Sort by highest score
    candidates.sort((a, b) => b.finalScore - a.finalScore);
    const top = candidates[0];

    return top.finalScore >= qualityThreshold ? top : null;
  }
}

export const curiosityEngine = new CuriosityEngine();
