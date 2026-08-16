/**
 * Test Suite for Computer Action Engine
 */

import {
  computerActionEngine,
  ActionValidator,
  ActionVerifier,
  AppRegistry,
  ComputerAction,
} from "./index";

async function runTests() {
  console.log("=== RUNNING COMPUTER ACTION ENGINE TESTS ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`✗ [FAIL] ${testName}`);
      failed++;
    }
  }

  // --- Test 1: Application Registry Resolution ---
  console.log("[Test 1] Testing AppRegistry...");
  const chrome = AppRegistry.resolve("chrome");
  assert(chrome !== null && chrome.id === "chrome", "Resolve 'chrome'");
  const vscode = AppRegistry.resolve("Visual Studio Code");
  assert(vscode !== null && vscode.executable === "Code.exe", "Resolve 'Visual Studio Code'");
  const invalidApp = AppRegistry.resolve("arbitrary_malicious_script.exe");
  assert(invalidApp === null, "Reject unregistered executable");

  // --- Test 2: Action Validator ---
  console.log("\n[Test 2] Testing ActionValidator...");
  const validMouse: ComputerAction = { type: "mouse.click", coordinates: { x: 500, y: 300 } };
  assert(ActionValidator.validate(validMouse).valid === true, "Valid mouse click coordinates");

  const invalidMouseCoords: ComputerAction = { type: "mouse.click", coordinates: { x: -50, y: 300 } };
  assert(ActionValidator.validate(invalidMouseCoords).valid === false, "Reject negative mouse coordinates");

  const validUrlNav: ComputerAction = { type: "browser.navigate", target: "https://google.com" };
  assert(ActionValidator.validate(validUrlNav).valid === true, "Valid URL navigation");

  const disallowedProtocol: ComputerAction = { type: "browser.navigate", target: "file:///etc/passwd" };
  assert(ActionValidator.validate(disallowedProtocol).valid === false, "Reject disallowed file:// protocol");

  const validAppOpen: ComputerAction = { type: "app.open", target: "notepad" };
  assert(ActionValidator.validate(validAppOpen).valid === true, "Valid safe app.open");

  const unlistedAppOpen: ComputerAction = { type: "app.open", target: "unlisted_trojan_app" };
  assert(ActionValidator.validate(unlistedAppOpen).valid === false, "Reject unlisted app.open");

  // --- Test 3: Action Verifier ---
  console.log("\n[Test 3] Testing ActionVerifier...");
  const navVerify = await ActionVerifier.verify(
    { type: "browser.navigate", target: "https://example.com" },
    null,
    { url: "https://example.com/login" }
  );
  assert(navVerify.verified === true, "Verify domain matching post-navigation");

  const typeVerify = await ActionVerifier.verify(
    { type: "browser.type", target: "username", value: "Manish" },
    null,
    { value: "Manish" }
  );
  assert(typeVerify.verified === true, "Verify input content post-typing");

  // --- Test 4: ActionExecutor Validation and Execution Flow ---
  console.log("\n[Test 4] Testing ActionExecutor Validation & Dispatch...");
  const rejectedResult = await computerActionEngine.execute({
    type: "app.open",
    target: "dangerous_app.exe",
  });
  assert(rejectedResult.success === false, "Executor correctly rejects invalid action before run");

  // --- Test 5: Batch Execution Engine ---
  console.log("\n[Test 5] Testing Batch Execution...");
  const batchActions: ComputerAction[] = [
    { type: "app.open", target: "notepad" },
    { type: "keyboard.press", value: "enter" },
  ];
  const batchResults = await computerActionEngine.executeBatch(batchActions, { stopOnError: false });
  assert(Array.isArray(batchResults) && batchResults.length === 2, "Batch executes sequentially with full status array");

  const invalidBatch: ComputerAction[] = [
    { type: "app.open", target: "malicious_unlisted_app" },
    { type: "keyboard.press", value: "enter" },
  ];
  const stoppedBatch = await computerActionEngine.executeBatch(invalidBatch, { stopOnError: true });
  assert(stoppedBatch.length === 1 && !stoppedBatch[0].success, "Batch stops immediately on validation failure with stopOnError: true");

  console.log("\n=================================================");
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
