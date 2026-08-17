/**
 * Personal Recommendation Engine
 * Combines context, memory preferences, and topic similarity to formulate uncertainty-aware recommendations.
 */

import { memoryManager } from "./MemoryManager";
import { SimilarityEngine } from "./PreferenceEngine";
import { CurrentContextSnapshot, RecommendationItem } from "./types";

export class RecommendationEngine {
  /**
   * Generates relevant recommendations based on current activity and long-term memories.
   */
  public async generateRecommendations(
    context: CurrentContextSnapshot,
    limit = 3
  ): Promise<RecommendationItem[]> {
    const memories = await memoryManager.getMemories();
    const recommendations: RecommendationItem[] = [];
    const now = new Date().toISOString();

    const currentTitle = (context.browserTitle || context.activeWindow || "").toLowerCase();
    const recentTopicsStr = context.recentTopics.join(" ").toLowerCase();
    const combinedContext = `${currentTitle} ${recentTopicsStr} ${context.screenContentSummary || ""}`;

    // 1. Anime / Media Recommendation Scenario
    const animeMemories = memories.filter(
      m => m.category === "preference" || m.category === "interest"
    ).filter(m => m.text.toLowerCase().includes("anime") || m.text.toLowerCase().includes("story"));

    if (context.activityState === "media" || combinedContext.includes("anime") || animeMemories.length > 0) {
      const storyPreference = memories.some(m => m.text.toLowerCase().includes("story"));
      const psychologicalPref = memories.some(m => m.text.toLowerCase().includes("psychological"));

      if (psychologicalPref || storyPreference) {
        recommendations.push({
          id: `rec_${Date.now()}_anime`,
          type: "anime",
          title: "Steins;Gate / Monster",
          description: "High-stakes psychological thrillers with intricate character development.",
          reasoning: "Based on your preference for psychological anime with strong narrative storytelling.",
          matchConfidence: 0.88,
          sourcePreferences: animeMemories.map(m => m.text),
          uncertaintyDisclaimer: "You might enjoy this based on the storytelling depth in shows you've liked before.",
          status: "suggested",
          createdAt: now
        });
      }
    }

    // 2. Cybersecurity / Web Pentesting Scenario
    const cyberMemories = memories.filter(
      m => m.text.toLowerCase().includes("burp") || m.text.toLowerCase().includes("pentest") || m.text.toLowerCase().includes("vulnerability")
    );

    if (context.activityState === "studying" || combinedContext.includes("burp") || cyberMemories.length > 0) {
      recommendations.push({
        id: `rec_${Date.now()}_sec`,
        type: "learning_resource",
        title: "PortSwigger Web Security Academy: Authentication & JWT Labs",
        description: "Hands-on labs covering broken authentication, session hijacking, and JWT bypasses.",
        reasoning: "You've been studying web vulnerability concepts and Burp Suite; authentication labs are the natural next progression.",
        matchConfidence: 0.91,
        sourcePreferences: cyberMemories.map(m => m.text),
        uncertaintyDisclaimer: "This could be a helpful next step for your cybersecurity learning roadmap.",
        suggestedActionUrl: "https://portswigger.net/web-security/authentication",
        status: "suggested",
        createdAt: now
      });
    }

    // 3. AI Agent Architecture / Coding Scenario
    const aiMemories = memories.filter(
      m => m.text.toLowerCase().includes("ai") || m.text.toLowerCase().includes("agent") || m.text.toLowerCase().includes("memory")
    );

    if (context.activityState === "coding" || combinedContext.includes("agent") || aiMemories.length > 0) {
      recommendations.push({
        id: `rec_${Date.now()}_dev`,
        type: "project_step",
        title: "Semantic Routing & Permission Gate Layer",
        description: "Add strict permission gating before executing destructive computer actions.",
        reasoning: "Your assistant project has core memory and vision active; adding permission checks ensures safe automated computer control.",
        matchConfidence: 0.85,
        sourcePreferences: aiMemories.map(m => m.text),
        uncertaintyDisclaimer: "I think this would make your assistant project robust and ready for production.",
        status: "suggested",
        createdAt: now
      });
    }

    return recommendations.slice(0, limit);
  }
}

export const recommendationEngine = new RecommendationEngine();
