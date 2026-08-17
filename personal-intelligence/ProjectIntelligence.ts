/**
 * Project Intelligence, Learning Intelligence, and Goal Planning Engine
 */

import { memoryManager } from "./MemoryManager";
import { CurrentContextSnapshot } from "./types";

export interface ProjectGapAnalysis {
  projectId: string;
  projectName: string;
  completedAreas: string[];
  missingComponents: string[];
  recommendedNextStep: string;
  isStalled: boolean;
  daysInactive: number;
}

export class ProjectIntelligence {
  /**
   * Evaluates project completion and identifies missing architectural pieces.
   */
  public static analyzeProject(project: {
    id: string;
    name: string;
    milestone?: string;
    status: string;
    daysInactive?: number;
  }): ProjectGapAnalysis {
    const nameLower = project.name.toLowerCase();
    const daysInactive = project.daysInactive || 0;
    const isStalled = daysInactive >= 3;

    // AI Assistant Project Pattern
    if (nameLower.includes("assistant") || nameLower.includes("agent") || nameLower.includes("bella")) {
      return {
        projectId: project.id,
        projectName: project.name,
        completedAreas: ["Long-term Memory Core", "3D/2D Avatar Visualizer", "Multimodal Screen Vision"],
        missingComponents: ["Security Permission Layer for Computer Control", "Action Verification Layer"],
        recommendedNextStep: "Implement the security permission and confirmation layer before expanding computer control.",
        isStalled,
        daysInactive
      };
    }

    // Default Project Pattern
    return {
      projectId: project.id,
      projectName: project.name,
      completedAreas: [project.milestone || "Initial Setup"],
      missingComponents: ["Automated Test Suite", "Deployment Pipeline"],
      recommendedNextStep: `Continue progress on ${project.milestone || "the current sprint goals"}.`,
      isStalled,
      daysInactive
    };
  }

  /**
   * Generates friendly check-in prompt for stalled projects.
   */
  public static generateStalledProjectCheckIn(analysis: ProjectGapAnalysis): {
    message: string;
    actions: { label: string; action: string }[];
  } | null {
    if (!analysis.isStalled) return null;

    return {
      message: `You haven't worked on your "${analysis.projectName}" project for ${analysis.daysInactive} days. Would you like to continue from where you left off?`,
      actions: [
        { label: "Continue Project", action: "resume_project" },
        { label: "Later", action: "snooze_project" },
        { label: "Not Interested", action: "dismiss_project" }
      ]
    };
  }
}

export interface LearningGapAnalysis {
  studiedTopics: string[];
  missingPrerequisites: string[];
  suggestedNextTopic: string;
  reasoning: string;
}

export class LearningIntelligence {
  /**
   * Identifies knowledge gaps and suggests logical study progressions.
   */
  public static analyzeLearningPath(context: CurrentContextSnapshot): LearningGapAnalysis | null {
    const topics = context.recentTopics.map(t => t.toLowerCase());
    const combined = topics.join(" ");

    // Cybersecurity Curriculum
    if (combined.includes("sql") || combined.includes("xss") || combined.includes("csrf") || combined.includes("burp")) {
      return {
        studiedTopics: ["SQL Injection", "Cross-Site Scripting (XSS)", "CSRF Basics"],
        missingPrerequisites: ["Broken Authentication", "Session Token Management", "JWT Security"],
        suggestedNextTopic: "Authentication & Session Security",
        reasoning: "You've covered the primary input injection vulnerabilities; understanding session and token handling is essential for comprehensive web penetration testing."
      };
    }

    // AI & Local LLM Curriculum
    if (combined.includes("rag") || combined.includes("embeddings") || combined.includes("llm")) {
      return {
        studiedTopics: ["Vector Embeddings", "Retrieval-Augmented Generation (RAG)"],
        missingPrerequisites: ["Hybrid Re-ranking", "Context Window Compression"],
        suggestedNextTopic: "Context Window Optimization & Re-ranking",
        reasoning: "To reduce latency and hallucinations in memory retrieval, adding a re-ranking layer is the next major optimization."
      };
    }

    return null;
  }
}

export class GoalEngine {
  /**
   * Breaks high-level user goal into an organized, step-by-step implementation plan.
   */
  public static createGoalRoadmap(goalTitle: string): { stepNumber: number; title: string; description: string }[] {
    const lower = goalTitle.toLowerCase();

    if (lower.includes("ai assistant") || lower.includes("personal agent") || lower.includes("companion")) {
      return [
        { stepNumber: 1, title: "Architecture & Safety Bounds", description: "Define permission model, API boundaries, and safe execution guardrails." },
        { stepNumber: 2, title: "Context & Memory Layer", description: "Build persistent memory store, confidence scoring, and activity detection." },
        { stepNumber: 3, title: "Natural Voice & Multimodal Vision", description: "Integrate low-latency audio streaming and screen frame vision." },
        { stepNumber: 4, title: "Computer Action Layer", description: "Implement mouse, keyboard, and application control with action verifiers." },
        { stepNumber: 5, title: "Personalization & Continuity", description: "Connect long-term preferences, curiosity engine, and adaptive personality." }
      ];
    }

    return [
      { stepNumber: 1, title: "Goal Definition & Scope", description: `Outline exact deliverables and requirements for "${goalTitle}".` },
      { stepNumber: 2, title: "Architecture & Planning", description: "Design components, dependencies, and necessary tools." },
      { stepNumber: 3, title: "Core Implementation", description: "Build initial working prototype with validation tests." },
      { stepNumber: 4, title: "Refinement & Polish", description: "Optimize performance and finalize documentation." }
    ];
  }
}
