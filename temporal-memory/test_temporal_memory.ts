/**
 * Automated Test Suite for Temporal Session Memory System
 */

import {
  sessionContextManager,
  ConversationSummarizer,
  DailySummaryManager,
  MemoryDecayManager,
  MemoryRetrievalEngine,
  temporalMemoryManager,
  TemporalMemoryItem
} from "./index";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING TEMPORAL SESSION MEMORY TEST SUITE");
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
  await temporalMemoryManager.init();
  assert(true, "TemporalMemoryManager initialized");

  // 2. Active Context (Layer 1) Tracking & Turn Inspection
  sessionContextManager.startNewSession("AI Desktop Assistant");
  sessionContextManager.recordTurn("user", "We decided to implement the computer action engine using PyAutoGUI and Win32.");
  sessionContextManager.recordTurn("model", "Great decision! I will build tools_mouse.py and tools_keyboard.py.");
  sessionContextManager.recordTurn("user", "I finished building the browser automation layer today.");
  sessionContextManager.recordTurn("model", "Error: failed with duplicate changeSong declaration.");

  const workingState = sessionContextManager.getSessionWorkingState();
  assert(workingState.decisions.length > 0, "Decisions auto-extracted from turns");
  assert(workingState.tasksCompleted.length > 0, "Completed tasks auto-extracted from turns");
  assert(workingState.problemsEncountered.length > 0, "Problems auto-extracted from turns");

  // 3. Conversation Summarizer (Layer 2 - Session Memory)
  const sessionItem = await temporalMemoryManager.consolidateCurrentSession("AI Desktop Assistant");
  assert(sessionItem !== null, "Session summarized successfully");
  assert(sessionItem!.layer === "session_memory", "Summary categorized in session_memory layer");
  assert(sessionItem!.expiresAt !== undefined, "Session memory assigned 36-hour expiration");

  // 4. Daily Summary Consolidation (Layer 3 - Recent Memory 1-7 days)
  const todayStr = new Date().toISOString().split("T")[0];
  const dailyItem = await temporalMemoryManager.generateDailySummary(todayStr);
  assert(dailyItem !== null, "Daily summary consolidated");
  assert(dailyItem!.layer === "recent_memory", "Daily summary categorized in recent_memory layer");
  assert(dailyItem!.tasksCompleted.length > 0, "Tasks aggregated into daily summary");

  // 5. Relative Time Intent Parsing
  const intent1 = MemoryRetrievalEngine.parseIntent("what did we do an hour ago?");
  assert(intent1.intent === "last_hour", "Parsed 'an hour ago' intent");

  const intent2 = MemoryRetrievalEngine.parseIntent("what were we working on yesterday?");
  assert(intent2.intent === "yesterday", "Parsed 'yesterday' intent");

  const intent3 = MemoryRetrievalEngine.parseIntent("continue from where we stopped");
  assert(intent3.intent === "continue_project", "Parsed 'continue from where we stopped' intent");

  const intent4 = MemoryRetrievalEngine.parseIntent("what was the problem we encountered?");
  assert(intent4.intent === "problems", "Parsed 'problem' intent");

  const intent5 = MemoryRetrievalEngine.parseIntent("what did we decide earlier?");
  assert(intent5.intent === "decisions", "Parsed 'decisions' intent");

  // 6. Natural Language Retrieval & Multi-factor Ranking
  // Inject mock yesterday memory
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  await temporalMemoryManager.addManualItem({
    id: `mock_yesterday_1`,
    layer: "recent_memory",
    sessionId: "sess_yesterday",
    date: yesterday,
    title: "Computer Action System Architecture",
    summary: "Worked on AI assistant computer-control system and implemented browser automation layer.",
    decisions: ["Use hardware mouse_event for zero latency clicks"],
    tasksCompleted: ["Browser automation layer", "Screen sharing pipeline"],
    problemsEncountered: ["Windows SetForegroundWindow focus block"],
    activeProject: "AI Desktop Assistant",
    topicTags: ["computer_actions", "browser_automation"],
    importance: 0.9,
    source: "daily_consolidation",
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString()
  });

  const queryYesterday = await temporalMemoryManager.queryTemporalMemory("what were we working on yesterday?", "AI Desktop Assistant");
  assert(queryYesterday.answers.length > 0, "Retrieved memory for 'yesterday'");
  assert(queryYesterday.answers[0].item.date === yesterday, "Top ranked item is from yesterday");
  assert(queryYesterday.formattedContext.includes("Computer Action System"), "Formatted context contains clear summary snippets");

  const queryDecisions = await temporalMemoryManager.queryTemporalMemory("what did we decide earlier?");
  assert(queryDecisions.answers.length > 0, "Retrieved memory for 'decisions'");
  assert(queryDecisions.answers[0].item.decisions.length > 0, "Top ranked item contains decisions");

  const queryContinue = await temporalMemoryManager.queryTemporalMemory("continue where we stopped", "AI Desktop Assistant");
  assert(queryContinue.answers.length > 0, "Retrieved memory for 'continue where we stopped'");

  // 7. Memory Decay & Expiration
  const mockExpired: TemporalMemoryItem = {
    id: "expired_item",
    layer: "session_memory",
    sessionId: "old_sess",
    date: "2026-01-01",
    title: "Old Session",
    summary: "Temporary context",
    decisions: [],
    tasksCompleted: [],
    problemsEncountered: [],
    topicTags: [],
    importance: 0.3,
    source: "conversation",
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
  };

  const decayPruning = MemoryDecayManager.pruneExpired([mockExpired, sessionItem!]);
  assert(decayPruning.prunedCount === 1, "Expired temporary item pruned");
  assert(decayPruning.active.length === 1, "Unexpired session memory retained");

  console.log("==================================================");
  console.log(`TEMPORAL MEMORY TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Temporal test execution error:", err);
  process.exit(1);
});
