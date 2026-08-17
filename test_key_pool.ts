/**
 * Gemini API Key Pool & Failover Test Suite
 */

import { geminiKeyPool } from "./GeminiKeyPoolManager";
import { keyVault } from "./server_key_vault";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING GEMINI API KEY POOL TEST SUITE");
  console.log("==================================================");

  // 1. Test key masking
  const sampleKey = "AIzaSyD7-test-key-example-9876543210-7X21";
  const masked = geminiKeyPool.maskKey(sampleKey);
  assert(masked.startsWith("AIzaSy"), "Masked key contains valid prefix");
  assert(masked.endsWith("7X21"), "Masked key contains valid suffix");
  assert(!masked.includes("example-9876"), "Masked key hides the secret body");

  // 2. Test KeyVault encryption and decryption round-trip
  const testId = "test_vault_key_1";
  keyVault.storeRawKey(testId, sampleKey);
  const decrypted = keyVault.getRawKey(testId);
  assert(decrypted === sampleKey, "KeyVault securely encrypts and decrypts secret key");
  keyVault.deleteRawKey(testId);
  assert(keyVault.getRawKey(testId) === null, "KeyVault securely deletes key");

  // 3. Test Key Pool Management
  const key1 = geminiKeyPool.addKey("Test Primary Key", "AIzaSyKey1111111111111111111111111111", 1);
  const key2 = geminiKeyPool.addKey("Test Secondary Key", "AIzaSyKey2222222222222222222222222222", 2);
  const key3 = geminiKeyPool.addKey("Test Backup Key", "AIzaSyKey3333333333333333333333333333", 3);

  assert(key1.priority === 1, "Key 1 priority set to 1");
  assert(key2.priority === 2, "Key 2 priority set to 2");

  // 4. Test Active Key Selection - Stable on highest priority without rotating
  const active1 = geminiKeyPool.getActiveKey();
  assert(active1 !== null && active1.id === key1.id, "Active key is highest priority Key 1");
  
  const active2 = geminiKeyPool.getActiveKey();
  assert(active2 !== null && active2.id === key1.id, "Active key stays on Key 1 without rotating on subsequent calls");

  // 5. Test Rate-Limit Failover
  geminiKeyPool.reportSuccess(key1.id);
  const updatedK1 = geminiKeyPool.getAllKeys().find(k => k.id === key1.id);
  assert(updatedK1?.requestCount === 1, "Request count incremented on success");

  // Simulate 429 Rate Limit error on Key 1
  const failoverResult = geminiKeyPool.reportFailure(key1.id, new Error("429 RESOURCE_EXHAUSTED: You exceeded your current quota"));
  assert(failoverResult.switched === true, "Failover triggered upon quota error");
  assert(failoverResult.nextKey?.id === key2.id, "Automatic failover switched to Key 2");

  const k1Status = geminiKeyPool.getAllKeys().find(k => k.id === key1.id);
  assert(k1Status?.status === "quota_exceeded", "Failing key marked quota_exceeded");
  assert(Boolean(k1Status?.cooldownUntil), "Failing key assigned cooldown timer");

  // 6. Test Subsequent Active Key Selection
  const activeAfterFailover = geminiKeyPool.getActiveKey();
  assert(activeAfterFailover?.id === key2.id, "Next active key is Key 2");

  // 7. Test Cooldown Expiration Recovery Simulation
  if (k1Status) {
    k1Status.cooldownUntil = new Date(Date.now() - 1000).toISOString(); // simulate expired
  }
  const restored = geminiKeyPool.checkCooldowns();
  assert(restored === true, "Cooldown monitor detected expired cooldown");
  
  const k1Restored = geminiKeyPool.getAllKeys().find(k => k.id === key1.id);
  assert(k1Restored?.status === "available", "Expired key restored back to available status");

  // 8. Clean up test keys
  geminiKeyPool.removeKey(key1.id);
  geminiKeyPool.removeKey(key2.id);
  geminiKeyPool.removeKey(key3.id);

  console.log("==================================================");
  console.log("KEY POOL TESTS: ALL PASSED (100%)");
  console.log("==================================================");
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
