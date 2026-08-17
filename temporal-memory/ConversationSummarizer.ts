/**
 * Conversation Summarizer
 * Automatically converts raw conversational turns into structured, lightweight summaries.
 */

import { sessionContextManager } from "./SessionContextManager";
import { TemporalMemoryItem, TemporalTurn } from "./types";

export class ConversationSummarizer {
  /**
   * Summarizes a slice of turns into a structured session memory item.
   */
  public static summarizeTurns(
    turns: TemporalTurn[],
    sessionId: string,
    projectName?: string
  ): TemporalMemoryItem | null {
    if (turns.length === 0) return null;

    const userTurns = turns.filter(t => t.role === "user").map(t => t.text);
    const modelTurns = turns.filter(t => t.role === "model").map(t => t.text);
    const workingState = sessionContextManager.getSessionWorkingState();

    const dateStr = new Date().toISOString().split("T")[0];
    const now = new Date().toISOString();

    // Extract core topics from user utterances
    const allText = turns.map(t => t.text).join(" ");
    const topicTags: string[] = [];
    if (allText.toLowerCase().includes("computer") || allText.toLowerCase().includes("action")) topicTags.push("computer_actions");
    if (allText.toLowerCase().includes("memory") || allText.toLowerCase().includes("temporal")) topicTags.push("memory_system");
    if (allText.toLowerCase().includes("browser") || allText.toLowerCase().includes("web")) topicTags.push("browser_automation");
    if (allText.toLowerCase().includes("security") || allText.toLowerCase().includes("pentest")) topicTags.push("cybersecurity");
    if (allText.toLowerCase().includes("anime") || allText.toLowerCase().includes("movie")) topicTags.push("media");

    // Formulate concise summary
    let summary = `Conversation covering ${topicTags.length > 0 ? topicTags.join(", ") : "general assistance"}.`;
    if (userTurns.length > 0) {
      const mainSubject = userTurns[0].slice(0, 90);
      summary = `Discussed: "${mainSubject}". Handled ${turns.length} turns with ${workingState.tasksCompleted.length} actions/tasks.`;
    }

    const title = projectName 
      ? `Working on ${projectName} (${dateStr})` 
      : topicTags.length > 0 ? `Session: ${topicTags[0].replace("_", " ").toUpperCase()}` : `Session on ${dateStr}`;

    // Expires in 36 hours (session memory layer)
    const expiresAt = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

    return {
      id: `sess_mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      layer: "session_memory",
      sessionId,
      date: dateStr,
      title,
      summary,
      details: turns.slice(-6).map(t => `${t.role}: ${t.text}`).join("\n"),
      decisions: workingState.decisions,
      tasksCompleted: workingState.tasksCompleted,
      problemsEncountered: workingState.problemsEncountered,
      activeProject: projectName || workingState.project,
      topicTags,
      importance: workingState.tasksCompleted.length > 0 || workingState.decisions.length > 0 ? 0.8 : 0.5,
      source: "conversation",
      createdAt: now,
      updatedAt: now,
      expiresAt
    };
  }
}
