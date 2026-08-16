import { ContextEngine } from "./ContextEngine";
import fs from "fs/promises";
import path from "path";

async function runDashboardTests() {
  console.log("=== RUNNING PERSONAL AI DASHBOARD TESTS ===");

  const testDir = path.join(process.cwd(), "scratch_test_dashboard");
  await fs.mkdir(testDir, { recursive: true });

  const contextEngine = new ContextEngine(path.join(testDir, "test_data.json"));
  await contextEngine.init();

  // Test 1: Dashboard Summary Generation
  console.log("\n[Test 1] Testing getDashboardSummary()...");
  const summary = await contextEngine.getDashboardSummary("Manish");
  console.log("Greeting:", summary.greeting.greetingText);
  console.log("AI Briefing Summary:", summary.aiBriefing.summary);
  console.log("Today Focus Count:", summary.todayFocus.length);
  console.log("Active Projects Count:", summary.activeProjects.length);
  console.log("Cybersecurity Proficiency Categories:", summary.learningSummary.cybersecurityProficiency.length);
  
  if (!summary.greeting.greetingText.includes("Manish")) {
    throw new Error("Test 1 Failed: Greeting should contain user name");
  }
  if (summary.todayFocus.length === 0) {
    throw new Error("Test 1 Failed: Today's focus should have priorities seeded");
  }
  console.log("✓ Test 1 Passed: Dashboard summary aggregation works.");

  // Test 2: Task CRUD Operations
  console.log("\n[Test 2] Testing Task CRUD...");
  const newTask = await contextEngine.addTask({
    title: "Implement PortSwigger SQLi Exploit script",
    category: "Cybersecurity",
    priority: "high",
    status: "pending",
    estimatedMinutes: 45,
  });
  console.log("Created Task:", newTask.title, `(${newTask.id})`);
  
  const updatedTask = await contextEngine.updateTask(newTask.id, { status: "completed" });
  if (!updatedTask || updatedTask.status !== "completed") {
    throw new Error("Test 2 Failed: Task update status failed");
  }
  
  const deleted = await contextEngine.deleteTask(newTask.id);
  if (!deleted) {
    throw new Error("Test 2 Failed: Task deletion failed");
  }
  console.log("✓ Test 2 Passed: Task CRUD operations work.");

  // Test 3: Project CRUD Operations
  console.log("\n[Test 3] Testing Project CRUD...");
  const newProj = await contextEngine.addProject({
    name: "Red Team Automation Toolkit",
    description: "Automated reconnaissance and vulnerability scanning suite",
    status: "Active",
    progressPercent: 25,
    currentMilestone: "Port scanning engine",
  });
  console.log("Created Project:", newProj.name, `(${newProj.id})`);

  const updatedProj = await contextEngine.updateProject(newProj.id, { progressPercent: 50 });
  if (!updatedProj || updatedProj.progressPercent !== 50) {
    throw new Error("Test 3 Failed: Project update failed");
  }

  const projDeleted = await contextEngine.deleteProject(newProj.id);
  if (!projDeleted) {
    throw new Error("Test 3 Failed: Project deletion failed");
  }
  console.log("✓ Test 3 Passed: Project CRUD operations work.");

  // Test 4: Quick Capture Auto-Classifier
  console.log("\n[Test 4] Testing Quick Capture Auto-Classifier...");
  const taskCapture = await contextEngine.processQuickCapture("Finish authentication module tomorrow");
  console.log("Captured:", taskCapture.type, "->", taskCapture.message);
  if (taskCapture.type !== "task") {
    throw new Error("Test 4 Failed: Expected task type classification");
  }

  const ideaCapture = await contextEngine.processQuickCapture("Idea: AI agent with voice synthesis for penetration testing");
  console.log("Captured:", ideaCapture.type, "->", ideaCapture.message);
  if (ideaCapture.type !== "idea") {
    throw new Error("Test 4 Failed: Expected idea type classification");
  }
  console.log("✓ Test 4 Passed: Quick Capture classification works.");

  // Test 5: Universal Search
  console.log("\n[Test 5] Testing Universal Search...");
  const searchResults = await contextEngine.searchAll("SQL");
  console.log(`Found ${searchResults.length} results for 'SQL':`);
  searchResults.forEach((r) => console.log(`- [${r.category.toUpperCase()}] ${r.title} (${r.subtitle})`));
  if (searchResults.length === 0) {
    throw new Error("Test 5 Failed: Search should return results for 'SQL'");
  }
  console.log("✓ Test 5 Passed: Universal search works.");

  // Cleanup test folder
  await fs.rm(testDir, { recursive: true, force: true });
  console.log("\n=================================================");
  console.log("ALL PERSONAL AI DASHBOARD TESTS PASSED! ✓");
  console.log("=================================================\n");
}

runDashboardTests().catch((err) => {
  console.error("Dashboard test failure:", err);
  process.exit(1);
});
