/**
 * Gemini API Key Pool & Automatic Failover Manager
 * Manages multiple Gemini API keys with priority ordering, health testing,
 * automatic rate-limit failover, and cooldown recovery.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { DATA_DIR } from "./server_paths";
import { keyVault } from "./server_key_vault";
import { GeminiApiKey, KeyStatus, KeyTestResult } from "./src/lib/keys/types";

const META_FILE = path.join(DATA_DIR, "gemini_keys_meta.json");

export class GeminiKeyPoolManager {
  private keys: GeminiApiKey[] = [];
  private activeKeyId: string | null = null;
  private cooldownInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.loadMetadata();
    this.ensureDefaultImport();
    this.startCooldownMonitor();
  }

  public maskKey(rawKey: string): string {
    const trimmed = (rawKey || "").trim();
    if (trimmed.length <= 8) return "••••••••";
    const prefix = trimmed.slice(0, 6);
    const suffix = trimmed.slice(-4);
    return `${prefix}••••••••${suffix}`;
  }

  private loadMetadata(): void {
    try {
      if (fs.existsSync(META_FILE)) {
        const raw = fs.readFileSync(META_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.keys = parsed;
          return;
        }
      }
    } catch (e) {
      console.warn("[KeyPool] Warning reading keys metadata:", e);
    }
    this.keys = [];
  }

  private saveMetadata(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(META_FILE, JSON.stringify(this.keys, null, 2), "utf-8");
    } catch (e) {
      console.error("[KeyPool] Failed saving keys metadata:", e);
    }
  }

  private ensureDefaultImport(): void {
    if (this.keys.length > 0) return;

    // Check if an existing key is in .env or secrets.json
    let existingKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!existingKey) {
      const secretsFile = path.join(DATA_DIR, "secrets.json");
      if (fs.existsSync(secretsFile)) {
        try {
          const sec = JSON.parse(fs.readFileSync(secretsFile, "utf-8"));
          existingKey = sec.geminiApiKey;
        } catch {}
      }
    }

    if (existingKey && existingKey.trim()) {
      const id = "gemini_key_" + crypto.randomBytes(4).toString("hex");
      keyVault.storeRawKey(id, existingKey.trim());

      const initialKey: GeminiApiKey = {
        id,
        name: "Primary Gemini Key",
        maskedKey: this.maskKey(existingKey),
        enabled: true,
        priority: 1,
        status: "available",
        requestCount: 0,
        failureCount: 0,
        createdAt: new Date().toISOString()
      };

      this.keys.push(initialKey);
      this.saveMetadata();
      console.log("[KeyPool] Imported existing Gemini API key into secure key pool.");
    }
  }

  private startCooldownMonitor(): void {
    if (this.cooldownInterval) clearInterval(this.cooldownInterval);
    this.cooldownInterval = setInterval(() => {
      this.checkCooldowns();
    }, 5000);
  }

  public checkCooldowns(): boolean {
    const now = Date.now();
    let updated = false;

    for (const k of this.keys) {
      if (
        (k.status === "rate_limited" || k.status === "quota_exceeded" || k.status === "error") &&
        k.cooldownUntil
      ) {
        const until = new Date(k.cooldownUntil).getTime();
        if (now >= until) {
          k.status = k.enabled ? "available" : "disabled";
          k.cooldownUntil = undefined;
          k.lastErrorMessage = undefined;
          updated = true;
          console.log(`[KeyPool] Cooldown expired for key "${k.name}" (${k.id}). Restored to ${k.status}.`);
        }
      }
    }

    if (updated) {
      this.saveMetadata();
    }
    return updated;
  }

  /**
   * Get the active key or select the highest-priority available key.
   * Does NOT rotate on every call; stays on current active key unless unavailable.
   */
  public getActiveKey(): { id: string; key: string; name: string } | null {
    this.checkCooldowns();

    // Check if current active key is still enabled and available/active
    if (this.activeKeyId) {
      const current = this.keys.find(k => k.id === this.activeKeyId);
      if (current && current.enabled && (current.status === "active" || current.status === "available")) {
        const raw = keyVault.getRawKey(current.id);
        if (raw) {
          current.status = "active";
          current.lastUsedAt = new Date().toISOString();
          this.saveMetadata();
          return { id: current.id, key: raw, name: current.name };
        }
      }
    }

    // Find highest priority available key
    const available = this.keys
      .filter(k => k.enabled && (k.status === "available" || k.status === "active"))
      .sort((a, b) => a.priority - b.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const candidate of available) {
      const raw = keyVault.getRawKey(candidate.id);
      if (raw) {
        // Demote previous active if different
        if (this.activeKeyId && this.activeKeyId !== candidate.id) {
          const prev = this.keys.find(k => k.id === this.activeKeyId);
          if (prev && prev.status === "active") prev.status = "available";
        }

        this.activeKeyId = candidate.id;
        candidate.status = "active";
        candidate.lastUsedAt = new Date().toISOString();
        this.saveMetadata();
        return { id: candidate.id, key: raw, name: candidate.name };
      }
    }

    return null;
  }

  public getRawKeyById(id: string): string | null {
    return keyVault.getRawKey(id);
  }

  public reportSuccess(keyId: string): void {
    const key = this.keys.find(k => k.id === keyId);
    if (key) {
      key.requestCount++;
      key.lastUsedAt = new Date().toISOString();
      if (key.status !== "active") key.status = "active";
      this.saveMetadata();
    }
  }

  public reportFailure(keyId: string, error: any): { switched: boolean; nextKey: { id: string; key: string; name: string } | null } {
    const key = this.keys.find(k => k.id === keyId);
    const errString = (error?.message || error?.reason || String(error || "")).toLowerCase();
    const now = Date.now();

    if (key) {
      key.failureCount++;
      key.lastErrorAt = new Date().toISOString();
      key.lastErrorMessage = error?.message || error?.reason || String(error);

      if (
        errString.includes("quota") ||
        errString.includes("resource_exhausted") ||
        errString.includes("429") ||
        errString.includes("rate limit")
      ) {
        key.status = errString.includes("quota") ? "quota_exceeded" : "rate_limited";
        // 60s for rate limit, 5 minutes for quota
        const cooldownMs = errString.includes("quota") ? 5 * 60 * 1000 : 60 * 1000;
        key.cooldownUntil = new Date(now + cooldownMs).toISOString();
        console.warn(`[KeyPool] Key "${key.name}" (${key.id}) marked ${key.status}. Cooldown until ${key.cooldownUntil}.`);
      } else if (
        errString.includes("invalid") ||
        errString.includes("api_key_invalid") ||
        errString.includes("unauthenticated") ||
        errString.includes("400")
      ) {
        key.status = "invalid";
        console.warn(`[KeyPool] Key "${key.name}" (${key.id}) marked invalid.`);
      } else {
        key.status = "error";
        key.cooldownUntil = new Date(now + 30 * 1000).toISOString();
      }

      if (this.activeKeyId === keyId) {
        this.activeKeyId = null;
      }
      this.saveMetadata();
    }

    // Attempt automatic failover to the next best key
    const next = this.getActiveKey();
    return {
      switched: Boolean(next && next.id !== keyId),
      nextKey: next
    };
  }

  public async testKey(idOrRaw: string): Promise<KeyTestResult> {
    let rawKey = idOrRaw;
    const existing = this.keys.find(k => k.id === idOrRaw);
    if (existing) {
      const decrypted = keyVault.getRawKey(existing.id);
      if (!decrypted) {
        return { success: false, status: "error", message: "Failed to decrypt key from vault." };
      }
      rawKey = decrypted;
    }

    const start = Date.now();
    try {
      const ai = new GoogleGenAI({ apiKey: rawKey });
      const resp = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: "Respond with the single word: OK",
        config: { maxOutputTokens: 10 }
      });

      const latencyMs = Date.now() - start;
      if (resp && (resp.text !== undefined || (resp.candidates && resp.candidates.length > 0))) {
        if (existing) {
          existing.status = existing.enabled ? "available" : "disabled";
          existing.cooldownUntil = undefined;
          existing.lastErrorMessage = undefined;
          this.saveMetadata();
        }
        return {
          success: true,
          status: "available",
          message: "Key verified active & responding.",
          latencyMs
        };
      }
      return { success: false, status: "error", message: "Unexpected response from Gemini API.", latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const msg = err?.message || String(err);
      const lower = msg.toLowerCase();

      let status: KeyStatus = "error";
      if (lower.includes("quota") || lower.includes("resource_exhausted") || lower.includes("429")) {
        status = "quota_exceeded";
      } else if (lower.includes("invalid") || lower.includes("api_key_invalid") || lower.includes("unauthenticated")) {
        status = "invalid";
      }

      if (existing) {
        existing.status = status;
        existing.lastErrorAt = new Date().toISOString();
        existing.lastErrorMessage = msg;
        this.saveMetadata();
      }

      return {
        success: false,
        status,
        message: msg,
        latencyMs
      };
    }
  }

  public addKey(name: string, rawKey: string, priority?: number): GeminiApiKey {
    const trimmed = (rawKey || "").trim();
    if (!trimmed) throw new Error("API key cannot be empty.");
    if (trimmed.length < 10) throw new Error("API key appears too short.");

    const id = "gemini_key_" + crypto.randomBytes(4).toString("hex");
    keyVault.storeRawKey(id, trimmed);

    const maxPriority = this.keys.reduce((max, k) => Math.max(max, k.priority || 0), 0);
    const assignedPriority = typeof priority === "number" ? priority : maxPriority + 1;

    const newKey: GeminiApiKey = {
      id,
      name: (name || "").trim() || `Gemini Key ${this.keys.length + 1}`,
      maskedKey: this.maskKey(trimmed),
      enabled: true,
      priority: assignedPriority,
      status: "available",
      requestCount: 0,
      failureCount: 0,
      createdAt: new Date().toISOString()
    };

    this.keys.push(newKey);
    this.saveMetadata();
    return newKey;
  }

  public removeKey(id: string): boolean {
    const index = this.keys.findIndex(k => k.id === id);
    if (index !== -1) {
      keyVault.deleteRawKey(id);
      this.keys.splice(index, 1);
      if (this.activeKeyId === id) this.activeKeyId = null;
      this.saveMetadata();
      return true;
    }
    return false;
  }

  public updateKey(id: string, patch: { name?: string; enabled?: boolean; priority?: number }): GeminiApiKey | null {
    const key = this.keys.find(k => k.id === id);
    if (!key) return null;

    if (typeof patch.name === "string" && patch.name.trim()) {
      key.name = patch.name.trim();
    }
    if (typeof patch.enabled === "boolean") {
      key.enabled = patch.enabled;
      if (!patch.enabled) {
        key.status = "disabled";
        if (this.activeKeyId === id) this.activeKeyId = null;
      } else if (key.status === "disabled") {
        key.status = "available";
      }
    }
    if (typeof patch.priority === "number") {
      key.priority = patch.priority;
    }

    this.saveMetadata();
    return key;
  }

  public reorderKeys(orderedIds: string[]): GeminiApiKey[] {
    orderedIds.forEach((id, index) => {
      const key = this.keys.find(k => k.id === id);
      if (key) {
        key.priority = index + 1;
      }
    });
    this.saveMetadata();
    return this.getAllKeys();
  }

  public getAllKeys(): GeminiApiKey[] {
    this.checkCooldowns();
    return this.keys.sort((a, b) => a.priority - b.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
}

export const geminiKeyPool = new GeminiKeyPoolManager();
