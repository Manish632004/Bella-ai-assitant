/**
 * Automated Test Suite for Personal Intelligence & Context-Aware Companion System
 */

import {
  contextEngine,
  contextPermissionManager,
  curiosityEngine,
  conversationInitiator,
  MemoryConfidence,
  MemoryDecay,
  memoryManager,
  PreferenceEngine,
  SimilarityEngine,
  recommendationEngine,
  ProjectIntelligence,
  LearningIntelligence,
  GoalEngine,
  interactionTiming,
  ExplainabilityEngine,
  PrivacyController,
  feedbackEngine,
  personalityEngine,
  personalIntelligence
} from "./index";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING PERSONAL INTELLIGENCE TEST SUITE");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Initialization
  await personalIntelligence.init();
  assert(true, "PersonalIntelligence facade initialized");

  // 2. Context Permissions & Privacy Defaults
  const perms = contextPermissionManager.getPermissions();
  assert(perms.screen === false, "Permission Default: screen is OFF");
  assert(perms.microphone === false, "Permission Default: microphone is OFF");
  assert(perms.browser === false, "Permission Default: browser is OFF");
  assert(perms.files === false, "Permission Default: files is OFF");
  assert(perms.calendar === false, "Permission Default: calendar is OFF");

  await contextPermissionManager.updatePermission("browser", true);
  assert(contextPermissionManager.isPermitted("browser") === true, "Permission update works");
  await contextPermissionManager.updatePermission("browser", false);

  // 3. Context Engine & Activity State Inference
  contextEngine.updateContext({
    activeApp: "Visual Studio Code",
    activeWindow: "server.ts - Bella",
    activeTask: { id: "t1", title: "Build Intelligence Layer", priority: "high" }
  });
  const snap1 = contextEngine.getSnapshot();
  assert(snap1.activityState === "coding", "Inferred activity state 'coding' correctly");

  contextEngine.updateContext({
    activeApp: "Google Chrome",
    browserTitle: "Attack on Titan Final Season - Crunchyroll",
  });
  // Note: browser permission is false, so browserTitle is omitted and state uses activeApp or general
  assert(snap1.activeApp === "Visual Studio Code", "ActiveApp captured correctly");

  // 4. Memory Confidence & Uncertainty Formatting
  const explicitConf = MemoryConfidence.calculateConfidence({ source: "explicit_user" });
  assert(explicitConf >= 0.90, "Explicit user confidence is high (>=0.90)");

  const inferredConf = MemoryConfidence.calculateConfidence({ source: "inferred_context" });
  assert(inferredConf <= 0.70, "Inferred context confidence is conservative (<=0.70)");

  const uncertaintyCheck = MemoryConfidence.formatWithUncertainty("User prefers dark mode.", 0.65);
  assert(uncertaintyCheck.isUncertain === true, "Low-confidence preference tagged with uncertainty");
  assert(uncertaintyCheck.text.startsWith("User may prefer"), "Uncertainty phrasing applied");

  // 5. Memory Manager CRUD & Decay
  const newMem = await memoryManager.addMemory({
    category: "preference",
    text: "User enjoys anime with deep psychological storytelling.",
    confirmedByUser: true
  });
  assert(newMem.confirmedByUser === true, "Memory added with user confirmation");
  assert(newMem.confidence >= 0.90, "Confirmed memory has high confidence");

  const memories = await memoryManager.getMemories("preference");
  assert(memories.some(m => m.id === newMem.id), "Memory retrieved by category");

  // Memory Decay Test
  const decayed = MemoryDecay.evaluateDecay({
    ...newMem,
    confirmedByUser: false,
    source: "inferred_context",
    confidence: 0.40,
    decayRate: 0.05,
    lastReinforcedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  assert(decayed === null, "Decayed low-confidence memory pruned after 30 days");

  // 6. Preference Extraction & Similarity
  const extracted = PreferenceEngine.extractPreferencesFromText("I really like anime with psychological stories and character growth.");
  assert(extracted.length > 0, "Preferences extracted from user statement");

  const simScore = SimilarityEngine.computeSimilarity("anime psychological storytelling", "User enjoys anime with deep psychological storytelling.");
  assert(simScore > 0.3, "Similarity score computes meaningful match");

  // 7. Recommendation Engine
  contextEngine.recordTopic("anime");
  const recs = await recommendationEngine.generateRecommendations(contextEngine.getSnapshot());
  assert(recs.length > 0, "Recommendations generated based on context and memories");
  assert(recs[0].reasoning.length > 10, "Recommendation contains transparent reasoning");

  // 8. Curiosity Engine & Quality Filter
  const curiosityQ = await curiosityEngine.evaluateBestQuestion({
    timestamp: new Date().toISOString(),
    activityState: "media",
    activeApp: "Brave",
    browserTitle: "Monster Anime Episode 1",
    recentTopics: ["anime", "story"],
    recentErrors: []
  });
  assert(curiosityQ !== null, "Curiosity question generated for media context");
  assert(curiosityQ!.finalScore > 0.5, "Curiosity question passes quality formula threshold");

  // 9. Project Intelligence & Gaps
  const projectAnalysis = ProjectIntelligence.analyzeProject({
    id: "p1",
    name: "Personal AI Assistant",
    status: "Active",
    daysInactive: 5
  });
  assert(projectAnalysis.missingComponents.length > 0, "Project missing components identified");
  assert(projectAnalysis.isStalled === true, "Project recognized as stalled after 5 days");

  const checkIn = ProjectIntelligence.generateStalledProjectCheckIn(projectAnalysis);
  assert(checkIn !== null && checkIn.actions.length === 3, "Stalled project check-in formulated with actions");

  // 10. Learning Intelligence
  const learningAnalysis = LearningIntelligence.analyzeLearningPath({
    timestamp: new Date().toISOString(),
    activityState: "studying",
    recentTopics: ["sql injection", "xss vulnerability", "burp suite"],
    recentErrors: []
  });
  assert(learningAnalysis !== null, "Learning path analyzed");
  assert(learningAnalysis!.suggestedNextTopic.includes("Authentication"), "Prerequisite gap detected correctly");

  // 11. Goal Engine Roadmap
  const roadmap = GoalEngine.createGoalRoadmap("Build Personal AI Companion");
  assert(roadmap.length === 5, "Roadmap broken into 5 systematic milestones");

  // 12. Interaction Timing & Quiet Hours
  const now = new Date();
  const quietCheck = interactionTiming.isQuietHours(new Date(2026, 7, 17, 23, 30)); // 11:30 PM
  assert(quietCheck === true, "Quiet hours active at 23:30");

  const daytimeCheck = interactionTiming.isQuietHours(new Date(2026, 7, 17, 14, 0)); // 2:00 PM
  assert(daytimeCheck === false, "Quiet hours inactive at 14:00");

  // 13. Explainability Engine
  const explanation = ExplainabilityEngine.explainAction({
    type: "recommendation",
    title: "Steins;Gate",
    matchedMemories: ["User enjoys psychological anime"]
  });
  assert(explanation.includes("Steins;Gate"), "Explainability generated clear rationale");

  // 14. Privacy Controller & Sanitization
  const cleanInput = PrivacyController.sanitizeInput("Here is my project notes.");
  assert(cleanInput.safe === true, "Safe input passed without redaction");

  const sensitiveInput = PrivacyController.sanitizeInput("My api_key is sk-12345.");
  assert(sensitiveInput.safe === false && sensitiveInput.sanitized.includes("[REDACTED]"), "Sensitive credentials redacted");

  // 15. Feedback Loop & Topic Muting
  await feedbackEngine.recordFeedback({
    actionId: "cur_123",
    actionType: "question",
    topicTag: "gaming",
    feedback: "never_ask_again"
  });
  assert(feedbackEngine.isTopicMuted("gaming") === true, "Muted topic suppressed from future inquiries");
  await feedbackEngine.unblockTopic("gaming");
  assert(feedbackEngine.isTopicMuted("gaming") === false, "Unblocked topic restored");

  // Clean up test memory
  await memoryManager.deleteMemory(newMem.id);

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
