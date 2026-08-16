import { ProactiveEngine, DEFAULT_PROACTIVE_SETTINGS } from "./ProactiveEngine";
import { ScoringEngine } from "./ScoringEngine";
import { FeedbackManager } from "./FeedbackManager";
import { PermissionManager, DEFAULT_PERMISSIONS } from "./PermissionManager";
import { NotificationManager } from "./NotificationManager";
import fs from "fs/promises";
import path from "path";

async function runTests() {
  console.log("=== RUNNING PROACTIVE INTELLIGENCE ENGINE TESTS ===");

  const testDir = path.join(process.cwd(), "scratch_test_proactive");
  await fs.mkdir(testDir, { recursive: true });

  const feedbackManager = new FeedbackManager(path.join(testDir, "test_feedback.json"));
  await feedbackManager.init();

  const permManager = new PermissionManager({ ...DEFAULT_PERMISSIONS });
  const scoringEngine = new ScoringEngine(feedbackManager);
  const notifManager = new NotificationManager();

  // Test 1: Scoring Thresholds
  console.log("\n[Test 1] Scoring thresholds & level filtering...");
  const highUrgencyScore = scoringEngine.calculateScore({
    relevance: 0.9,
    urgency: 0.95,
    importance: 0.9,
    confidence: 0.95,
    category: "tasks",
  });
  console.log("High Urgency Score:", highUrgencyScore.finalScore);
  if (!scoringEngine.shouldSurface(highUrgencyScore, "LOW")) {
    throw new Error("Test 1 Failed: High urgency item should surface on LOW level");
  }
  if (scoringEngine.shouldSurface(highUrgencyScore, "OFF")) {
    throw new Error("Test 1 Failed: Nothing should surface on OFF level");
  }
  console.log("✓ Test 1 Passed: Scoring threshold filtering correct.");

  // Test 2: Permission Enforcement (Default Deny)
  console.log("\n[Test 2] Privacy & Category Permissions...");
  if (permManager.isCategoryAllowed("screen")) {
    throw new Error("Test 2 Failed: Screen should be default deny (false)");
  }
  if (permManager.isCategoryAllowed("mic")) {
    throw new Error("Test 2 Failed: Mic should be default deny (false)");
  }
  if (!permManager.isCategoryAllowed("tasks")) {
    throw new Error("Test 2 Failed: Tasks should be allowed by default");
  }
  permManager.setCategory("files", true);
  if (!permManager.isCategoryAllowed("files")) {
    throw new Error("Test 2 Failed: Files should be allowed after explicit opt-in");
  }
  console.log("✓ Test 2 Passed: Privacy default-deny and category toggling work.");

  // Test 3: Feedback Manager & 3-Dismissal Penalty
  console.log("\n[Test 3] Feedback Learning & Dismissal Penalty...");
  const initialWeight = feedbackManager.getCategoryWeight("tasks");
  await feedbackManager.recordFeedback({ suggestionId: "s1", category: "tasks", type: "task_suggestion", action: "dismissed" });
  await feedbackManager.recordFeedback({ suggestionId: "s2", category: "tasks", type: "task_suggestion", action: "dismissed" });
  await feedbackManager.recordFeedback({ suggestionId: "s3", category: "tasks", type: "task_suggestion", action: "dismissed" });

  const penalizedWeight = feedbackManager.getCategoryWeight("tasks");
  console.log(`Weight before: ${initialWeight}, after 3 dismissals: ${penalizedWeight}`);
  if (penalizedWeight >= initialWeight) {
    throw new Error("Test 3 Failed: Weight did not decrease after 3 dismissals");
  }

  await feedbackManager.recordFeedback({ suggestionId: "s4", category: "tasks", type: "task_suggestion", action: "accepted" });
  const recoveredWeight = feedbackManager.getCategoryWeight("tasks");
  console.log(`Weight after accept: ${recoveredWeight}`);
  if (recoveredWeight <= penalizedWeight) {
    throw new Error("Test 3 Failed: Weight did not recover after acceptance");
  }
  console.log("✓ Test 3 Passed: Feedback learning & demotion working.");

  // Test 4: Proactive Engine Lifecycle & Triggers
  console.log("\n[Test 4] Proactive Engine Full Evaluation Cycle...");
  const engine = new ProactiveEngine(testDir);
  await engine.init();

  const suggestions = await engine.runEvaluationCycle();
  console.log(`Generated ${suggestions.length} suggestion(s) on initial evaluation:`);
  for (const s of suggestions) {
    console.log(`- [${s.category.toUpperCase()}] ${s.title}: "${s.message}" (Score: ${s.score.finalScore.toFixed(2)})`);
    console.log(`  Explanation: "${s.explanation}"`);
  }

  if (suggestions.length === 0) {
    throw new Error("Test 4 Failed: Expected at least one proactive suggestion from initial context seed");
  }

  // Test 5: Daily Briefing
  console.log("\n[Test 5] Daily Focus Briefing...");
  const briefing = await engine.getDailyBriefing();
  console.log("Briefing Date:", briefing.date);
  console.log("Priority Tasks:", briefing.priorityTasks);
  console.log("Learning Opportunities:", briefing.learningOpportunities);
  if (!briefing.priorityTasks || briefing.priorityTasks.length === 0) {
    throw new Error("Test 5 Failed: Daily briefing should include pending priority tasks");
  }
  console.log("✓ Test 5 Passed: Daily Focus Briefing working.");

  engine.stop();
  // Cleanup test folder
  await fs.rm(testDir, { recursive: true, force: true });
  console.log("\n=================================================");
  console.log("ALL PROACTIVE INTELLIGENCE ENGINE TESTS PASSED! ✓");
  console.log("=================================================\n");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
