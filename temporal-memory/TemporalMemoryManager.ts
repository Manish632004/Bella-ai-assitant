/**
 * Temporal Memory Manager
 * Unified Orchestrator for 4-tier Temporal Session Memory system
 */

import fs from "fs/promises";
import { dataFile } from "../server_paths";
import { ConversationSummarizer } from "./ConversationSummarizer";
import { DailySummaryManager } from "./DailySummaryManager";
import { MemoryDecayManager } from "./MemoryDecayManager";
import { MemoryRetrievalEngine } from "./MemoryRetrievalEngine";
import { sessionContextManager, SessionContextManager } from "./SessionContextManager";
import {
  RankedTemporalMemory,
  TemporalMemoryItem,
  TemporalQuery,
  TemporalTurn
} from "./types";

const TEMPORAL_FILE = dataFile("temporal_memories.json");

export class TemporalMemoryManager {
  private memoryItems: TemporalMemoryItem[] = [];
  private sessionContext: SessionContextManager = sessionContextManager;
  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const data = await fs.readFile(TEMPORAL_FILE, "utf-8");
      this.memoryItems = JSON.parse(data);
      // Prune expired memories on startup
      const pruned = MemoryDecayManager.pruneExpired(this.memoryItems);
      this.memoryItems = pruned.active;
      await this.save();
    } catch {
      this.memoryItems = [];
      await this.save();
    }
    this.initialized = true;
  }

  public getSessionManager(): SessionContextManager {
    return this.sessionContext;
  }

  public recordConversationTurn(role: "user" | "model" | "system", text: string, actionTaken?: string): TemporalTurn {
    return this.sessionContext.recordTurn(role, text, actionTaken);
  }

  /**
   * Consolidates current session context into a structured Session Memory item.
   */
  public async consolidateCurrentSession(projectName?: string): Promise<TemporalMemoryItem | null> {
    await this.init();
    const turns = this.sessionContext.getActiveContext();
    if (turns.length === 0) return null;

    const summaryItem = ConversationSummarizer.summarizeTurns(
      turns,
      this.sessionContext.getSessionId(),
      projectName || this.sessionContext.getActiveProject()
    );

    if (summaryItem) {
      this.memoryItems.unshift(summaryItem);
      // Keep within reasonable bound
      if (this.memoryItems.length > 250) {
        this.memoryItems = this.memoryItems.slice(0, 200);
      }
      await this.save();
    }

    return summaryItem;
  }

  /**
   * Create or update a daily consolidated summary for a specific date (e.g. yesterday or today).
   */
  public async generateDailySummary(dateStr: string): Promise<TemporalMemoryItem | null> {
    await this.init();
    const sessionItems = this.memoryItems.filter(m => m.layer === "session_memory" && m.date === dateStr);
    if (sessionItems.length === 0) return null;

    const dailySummary = DailySummaryManager.consolidateDailySessions(dateStr, sessionItems);

    // Replace existing daily summary for this date if present
    this.memoryItems = this.memoryItems.filter(m => !(m.layer === "recent_memory" && m.date === dateStr));
    this.memoryItems.unshift(dailySummary);
    await this.save();
    return dailySummary;
  }

  /**
   * Natural relative query retrieval (e.g. "what were we doing yesterday?", "what did we decide earlier?").
   */
  public async queryTemporalMemory(queryText: string, currentProject?: string): Promise<{
    answers: RankedTemporalMemory[];
    formattedContext: string;
  }> {
    await this.init();
    const ranked = MemoryRetrievalEngine.retrieveMemories(
      this.memoryItems,
      { queryText },
      currentProject || this.sessionContext.getActiveProject()
    );

    let formattedContext = "";
    if (ranked.length > 0) {
      formattedContext = "=== RELEVANT TEMPORAL MEMORY SNIPPETS ===\n" +
        ranked.map(r => 
          `[${r.item.date} | ${r.matchedReason} | Match: ${Math.round(r.score.finalScore * 100)}%]\n` +
          `Title: ${r.item.title}\n` +
          `Summary: ${r.item.summary}\n` +
          (r.item.decisions.length > 0 ? `Decisions: ${r.item.decisions.join("; ")}\n` : "") +
          (r.item.tasksCompleted.length > 0 ? `Completed: ${r.item.tasksCompleted.join("; ")}\n` : "") +
          (r.item.problemsEncountered.length > 0 ? `Problems: ${r.item.problemsEncountered.join("; ")}\n` : "")
        ).join("\n") +
        "==========================================\n";
    }

    return { answers: ranked, formattedContext };
  }

  public async getTimeline(days = 7): Promise<TemporalMemoryItem[]> {
    await this.init();
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    return this.memoryItems.filter(m => m.date >= cutoffDate);
  }

  public async addManualItem(item: TemporalMemoryItem): Promise<TemporalMemoryItem> {
    await this.init();
    this.memoryItems.unshift(item);
    await this.save();
    return item;
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(TEMPORAL_FILE, JSON.stringify(this.memoryItems, null, 2), "utf-8");
    } catch (err) {
      console.error("[TemporalMemoryManager] Save error:", err);
    }
  }
}

export const temporalMemoryManager = new TemporalMemoryManager();
