/**
 * Personal Intelligence & Context-Aware Companion System
 * Main root export
 */

import { contextEngine, ContextEngine } from "./ContextEngine";
import { contextPermissionManager, ContextPermissionManager } from "./ContextPermissionManager";
import { curiosityEngine, CuriosityEngine, QuestionGenerator } from "./CuriosityEngine";
import { MemoryConfidence } from "./MemoryConfidence";
import { MemoryDecay } from "./MemoryDecay";
import { memoryManager, MemoryManager } from "./MemoryManager";
import {
  feedbackEngine,
  FeedbackEngine,
  ExplainabilityEngine,
  PrivacyController,
  personalityEngine,
  PersonalityEngine
} from "./PersonalityEngine";
import {
  interestEngine,
  InterestEngine,
  PreferenceEngine,
  SimilarityEngine
} from "./PreferenceEngine";
import {
  ProjectIntelligence,
  LearningIntelligence,
  GoalEngine
} from "./ProjectIntelligence";
import {
  recommendationEngine,
  RecommendationEngine
} from "./RecommendationEngine";
import {
  conversationInitiator,
  ConversationInitiator,
  interactionTiming,
  InteractionTiming
} from "./InteractionTiming";

export * from "./types";
export {
  ContextEngine,
  contextEngine,
  ContextPermissionManager,
  contextPermissionManager,
  CuriosityEngine,
  curiosityEngine,
  QuestionGenerator,
  MemoryConfidence,
  MemoryDecay,
  MemoryManager,
  memoryManager,
  PreferenceEngine,
  InterestEngine,
  interestEngine,
  SimilarityEngine,
  RecommendationEngine,
  recommendationEngine,
  ProjectIntelligence,
  LearningIntelligence,
  GoalEngine,
  InteractionTiming,
  interactionTiming,
  ConversationInitiator,
  conversationInitiator,
  PersonalityEngine,
  personalityEngine,
  ExplainabilityEngine,
  PrivacyController,
  FeedbackEngine,
  feedbackEngine
};

export class PersonalIntelligenceFacade {
  public async init(): Promise<void> {
    await contextPermissionManager.init();
    await memoryManager.init();
    await feedbackEngine.init();
    console.log("[PersonalIntelligence] System initialized successfully.");
  }
}

export const personalIntelligence = new PersonalIntelligenceFacade();
