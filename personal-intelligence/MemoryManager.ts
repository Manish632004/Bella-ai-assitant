/**
 * Advanced Personal Memory Manager
 * Stores and manages categorized memories with confidence scoring, decay, and confirmation support.
 */

import fs from "fs/promises";
import { dataFile } from "../server_paths";
import { MemoryConfidence } from "./MemoryConfidence";
import { MemoryDecay } from "./MemoryDecay";
import { MemoryCategory, PersonalMemory } from "./types";

const PERSONAL_MEMORY_FILE = dataFile("personal_memories.json");

export class MemoryManager {
  private memories: PersonalMemory[] = [];
  private disabledCategories: Set<MemoryCategory> = new Set();
  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const data = await fs.readFile(PERSONAL_MEMORY_FILE, "utf-8");
      this.memories = JSON.parse(data);
      // Prune decayed observations on startup
      this.memories = MemoryDecay.pruneDecayed(this.memories);
      await this.save();
    } catch {
      this.memories = [];
      await this.save();
    }
    this.initialized = true;
  }

  public async getMemories(filterCategory?: MemoryCategory): Promise<PersonalMemory[]> {
    await this.init();
    let result = this.memories.filter(m => !this.disabledCategories.has(m.category));
    if (filterCategory) {
      result = result.filter(m => m.category === filterCategory);
    }
    return JSON.parse(JSON.stringify(result));
  }

  public async addMemory(input: {
    category: MemoryCategory;
    text: string;
    source?: PersonalMemory["source"];
    importance?: number;
    confirmedByUser?: boolean;
    topicTags?: string[];
  }): Promise<PersonalMemory> {
    await this.init();

    const source = input.source || (input.confirmedByUser ? "explicit_user" : "inferred_context");
    const baseConf = MemoryConfidence.calculateConfidence({ source });
    const { text, isUncertain } = MemoryConfidence.formatWithUncertainty(input.text, baseConf);

    const now = new Date().toISOString();
    const newMemory: PersonalMemory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      category: input.category,
      text,
      confidence: baseConf,
      source,
      importance: input.importance || 0.7,
      confirmedByUser: Boolean(input.confirmedByUser),
      topicTags: input.topicTags || [],
      createdAt: now,
      updatedAt: now,
      lastReinforcedAt: now,
      reinforcementCount: 1,
      decayRate: input.confirmedByUser ? 0 : 0.02,
      isUncertain
    };

    // Check for existing similar memory to reinforce instead of duplicate
    const existing = this.memories.find(
      m => m.category === input.category && (m.text.toLowerCase() === text.toLowerCase() || m.text.includes(text) || text.includes(m.text))
    );

    if (existing) {
      const reinforced = MemoryConfidence.reinforce(existing.confidence, existing.reinforcementCount);
      existing.confidence = reinforced.confidence;
      existing.reinforcementCount = reinforced.count;
      existing.lastReinforcedAt = now;
      existing.updatedAt = now;
      if (input.confirmedByUser) {
        existing.confirmedByUser = true;
        existing.decayRate = 0;
        existing.isUncertain = false;
      }
      await this.save();
      return existing;
    }

    this.memories.unshift(newMemory);
    await this.save();
    return newMemory;
  }

  public async confirmMemory(memoryId: string): Promise<PersonalMemory | null> {
    await this.init();
    const mem = this.memories.find(m => m.id === memoryId);
    if (!mem) return null;

    mem.confirmedByUser = true;
    mem.confidence = 0.98;
    mem.isUncertain = false;
    mem.decayRate = 0;
    mem.updatedAt = new Date().toISOString();
    await this.save();
    return mem;
  }

  public async deleteMemory(memoryId: string): Promise<boolean> {
    await this.init();
    const beforeLen = this.memories.length;
    this.memories = this.memories.filter(m => m.id !== memoryId);
    const deleted = this.memories.length < beforeLen;
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  public async clearCategory(category: MemoryCategory): Promise<number> {
    await this.init();
    const beforeLen = this.memories.length;
    this.memories = this.memories.filter(m => m.category !== category);
    const count = beforeLen - this.memories.length;
    if (count > 0) {
      await this.save();
    }
    return count;
  }

  public setCategoryEnabled(category: MemoryCategory, enabled: boolean): void {
    if (enabled) {
      this.disabledCategories.delete(category);
    } else {
      this.disabledCategories.add(category);
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(PERSONAL_MEMORY_FILE, JSON.stringify(this.memories, null, 2), "utf-8");
    } catch (err) {
      console.error("[MemoryManager] Save error:", err);
    }
  }
}

export const memoryManager = new MemoryManager();
