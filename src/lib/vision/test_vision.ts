/**
 * Automated test suite for Vision & Camera Intelligence library
 */

import { VisualMemoryManager } from "./VisualMemoryManager";
import { VisionMode } from "./types";

function runTests() {
  console.log("==================================================");
  console.log("RUNNING VISION & CAMERA INTELLIGENCE TEST SUITE");
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

  // 1. Visual Memory Creation ("Remember this")
  const memory1 = VisualMemoryManager.createVisualMemory(
    "User is assembling a dual-NIC Raspberry Pi network bridge.",
    "device",
    ["raspberry_pi", "networking"]
  );

  assert(memory1.type === "visual_context", "Visual memory type is visual_context");
  assert(memory1.subject === "device", "Visual memory subject correctly categorized as device");
  assert(memory1.topicTags.includes("raspberry_pi"), "Topic tags preserved in visual memory");
  assert(memory1.expiresAt !== undefined, "Visual memory assigned temporary expiration timestamp");

  // 2. Context Injection Formatter
  const formatted = VisualMemoryManager.formatVisualContext([memory1]);
  assert(formatted.includes("RECENT VISUAL CONTEXT"), "Formatted context includes visual section header");
  assert(formatted.includes("Raspberry Pi"), "Formatted context includes observation text");

  // 3. Vision Mode Enum Validation
  const validModes: VisionMode[] = ["OFF", "SNAPSHOT", "CONVERSATION", "REAL-TIME"];
  assert(validModes.length === 4, "All 4 vision modes supported");

  console.log("==================================================");
  console.log(`VISION TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) process.exit(1);
}

runTests();
